#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  if (match) args.set(match[1], match[2]);
}

const days = Number(args.get("days") || 7);
const take = Number(args.get("take") || 100);
const limitExamples = Number(args.get("examples") || 5);
const jsonOutput = args.get("json") === "1" || args.get("json") === "true";

function normalizeKey(value) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\bANT NIO\b/g, "ANTONIO")
    .replace(/\bCONTINUA AO\b/g, "CONTINUACAO")
    .replace(/\bNA OES\b/g, "NACOES")
    .replace(/\bPARA SO\b/g, "PARAISO")
    .replace(/\bSAT LITE\b/g, "SATELITE")
    .replace(/\s+/g, " ")
    .trim();
}

function pickLocalAliasAccepted(row) {
  const md = row.memoryDebug || {};
  const value =
    row.localLotLocalAliasAccepted ??
    md.localLotLocalAliasAccepted ??
    md.aparecidaShadowDebug?.localCandidate?.localAliasAccepted ??
    md.aparecidaShadowDebug?.localCandidate?.localAliasAccepted;
  return value === true;
}

function isFinalLocal(row) {
  const md = row.memoryDebug || {};
  const finalRankedKind = row.finalRankedKind ?? md.finalRankedKind;
  const top = Array.isArray(row.hereRankTop5) ? row.hereRankTop5[0] : null;
  return (
    finalRankedKind === "local" ||
    row.localLotUsedAsFinal === true ||
    md.localLotUsedAsFinal === true ||
    row.decisionReason === "LOCAL_APARECIDA_LOT_OK" ||
    top?.from === "LOCAL_APARECIDA_LOT"
  );
}

function getRowsFromJob(job) {
  if (Array.isArray(job.resultJson)) return job.resultJson;
  if (Array.isArray(job.resultJson?.results)) return job.resultJson.results;

  if (job.resultPath && fs.existsSync(job.resultPath)) {
    const raw = fs.readFileSync(job.resultPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.results)) return parsed.results;
  }

  return [];
}

function addCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map, limit) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function tokenSet(value) {
  return new Set(String(value || "").split(/\s+/).filter(Boolean));
}

function bairroSimilarity(left, right) {
  const leftKey = String(left || "");
  const rightKey = String(right || "");
  if (!leftKey || !rightKey) return 0;
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return 1;

  const leftTokens = tokenSet(leftKey);
  const rightTokens = tokenSet(rightKey);
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function classifyGroup(group) {
  if (group.streetMismatchCount > 0) return "PROVAVEL ERRO REAL";
  if (bairroSimilarity(group.bairroPlanilhaKey, group.bairroLocalKey) >= 0.6) {
    return "POSSIVEL ALIAS/CADASTRAL";
  }
  if (group.aliasUnknownCount === group.count && group.count <= 2) return "INCERTO";
  if (group.lowConfidenceCount >= Math.ceil(group.count * 0.7)) return "PROVAVEL ERRO REAL";
  return "POSSIVEL ALIAS/CADASTRAL";
}

function makeRowAudit(job, row) {
  const md = row.memoryDebug || {};
  const streetShadow = md.aparecidaLocalStreetShadow || row.aparecidaLocalStreetShadow || null;
  const bairroPlanilha = String(row.bairro || md.expectedBairro || "").trim();
  const bairroLocal = String(row.localLotBairro || md.localLotBairro || "").trim();
  const confidence = Number(row.geocodeConfidence ?? md.geocodeConfidence);
  const lowConfidence =
    row.geocodeConfidenceLevel === "LOW" ||
    md.geocodeConfidenceLevel === "LOW" ||
    (Number.isFinite(confidence) && confidence <= 60);

  return {
    jobId: job.id,
    file: job.originalName || "",
    user: job.user?.name || job.user?.email || "",
    createdAt: job.createdAt,
    sequence: String(row.sequence ?? ""),
    original: String(row.original || ""),
    bairroPlanilha,
    bairroLocal,
    bairroPlanilhaKey: normalizeKey(bairroPlanilha),
    bairroLocalKey: normalizeKey(bairroLocal),
    ruaPlanilha: String(row.normalized?.rua || ""),
    ruaLocal: String(streetShadow?.localStreetFullName || row.hereBest?.address?.street || ""),
    quadra: String(row.localLotQuadra || row.normalized?.quadra || ""),
    lote: String(row.localLotLote || row.normalized?.lote || ""),
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    geocodeConfidence: Number.isFinite(confidence) ? confidence : null,
    geocodeConfidenceLevel: row.geocodeConfidenceLevel ?? md.geocodeConfidenceLevel ?? null,
    geocodeConfidenceFlags: row.geocodeConfidenceFlags ?? md.geocodeConfidenceFlags ?? [],
    lowConfidence,
    localAliasAccepted: pickLocalAliasAccepted(row),
    streetShadow,
    streetMismatch: streetShadow?.streetStatus === "STREET_MISMATCH",
  };
}

async function main() {
  const prisma = new PrismaClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const jobs = await prisma.importJob.findMany({
      where: {
        createdAt: { gte: since },
        status: "DONE",
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        originalName: true,
        createdAt: true,
        resultJson: true,
        resultPath: true,
        user: { select: { name: true, email: true } },
      },
    });

    const groups = new Map();
    let scannedRows = 0;
    let suspectedRows = 0;

    for (const job of jobs) {
      const rows = getRowsFromJob(job);
      scannedRows += rows.length;

      for (const row of rows) {
        const audit = makeRowAudit(job, row);
        if (!isFinalLocal(row)) continue;
        if (row.localLotCandidateFound !== true && row.memoryDebug?.localLotCandidateFound !== true) continue;
        if (!audit.bairroPlanilha || !audit.bairroLocal) continue;
        if (audit.bairroPlanilhaKey === audit.bairroLocalKey) continue;
        if (audit.localAliasAccepted) continue;
        if (!audit.geocodeConfidenceLevel && audit.geocodeConfidence == null && !audit.streetShadow) continue;
        if (!audit.lowConfidence && !audit.streetMismatch) continue;

        suspectedRows++;
        const pairKey = `${audit.bairroPlanilhaKey}->${audit.bairroLocalKey}`;
        if (!groups.has(pairKey)) {
          groups.set(pairKey, {
            pairKey,
            bairroPlanilha: audit.bairroPlanilha,
            bairroLocal: audit.bairroLocal,
            bairroPlanilhaKey: audit.bairroPlanilhaKey,
            bairroLocalKey: audit.bairroLocalKey,
            count: 0,
            lowConfidenceCount: 0,
            streetMismatchCount: 0,
            aliasUnknownCount: 0,
            sequences: [],
            jobs: new Map(),
            users: new Map(),
            ruasPlanilha: new Map(),
            ruasLocais: new Map(),
            examples: [],
          });
        }

        const group = groups.get(pairKey);
        group.count++;
        if (audit.geocodeConfidenceLevel === "LOW" || (audit.geocodeConfidence ?? 999) <= 60) {
          group.lowConfidenceCount++;
        }
        if (audit.streetMismatch) group.streetMismatchCount++;
        if (!audit.localAliasAccepted) group.aliasUnknownCount++;
        group.sequences.push(audit.sequence);
        addCount(group.jobs, `${audit.file} (${audit.jobId})`);
        addCount(group.users, audit.user);
        addCount(group.ruasPlanilha, audit.ruaPlanilha);
        addCount(group.ruasLocais, audit.ruaLocal);
        if (group.examples.length < limitExamples) group.examples.push(audit);
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      jobsScanned: jobs.length,
      rowsScanned: scannedRows,
      suspectedRows,
      groups: Array.from(groups.values())
        .sort((a, b) => b.count - a.count || a.pairKey.localeCompare(b.pairKey))
        .map((group) => ({
          pairKey: group.pairKey,
          bairroPlanilha: group.bairroPlanilha,
          bairroLocal: group.bairroLocal,
          count: group.count,
          classification: classifyGroup(group),
          lowConfidenceCount: group.lowConfidenceCount,
          streetMismatchCount: group.streetMismatchCount,
          sequences: group.sequences,
          jobs: topEntries(group.jobs, 10),
          users: topEntries(group.users, 10),
          ruasPlanilha: topEntries(group.ruasPlanilha, 10),
          ruasLocais: topEntries(group.ruasLocais, 10),
          examples: group.examples.map((ex) => ({
            sequence: ex.sequence,
            file: ex.file,
            user: ex.user,
            original: ex.original,
            bairroPlanilha: ex.bairroPlanilha,
            bairroLocal: ex.bairroLocal,
            ruaPlanilha: ex.ruaPlanilha,
            ruaLocal: ex.ruaLocal,
            quadra: ex.quadra,
            lote: ex.lote,
            lat: ex.lat,
            lng: ex.lng,
            geocodeConfidence: ex.geocodeConfidence,
            geocodeConfidenceLevel: ex.geocodeConfidenceLevel,
            geocodeConfidenceFlags: ex.geocodeConfidenceFlags,
            streetShadow: ex.streetShadow,
          })),
        })),
    };

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Aparecida Local First audit`);
    console.log(`Generated: ${report.generatedAt}`);
    console.log(`Window: last ${report.windowDays} day(s)`);
    console.log(`Jobs scanned: ${report.jobsScanned}`);
    console.log(`Rows scanned: ${report.rowsScanned}`);
    console.log(`Suspected rows: ${report.suspectedRows}`);
    console.log("");

    for (const group of report.groups) {
      console.log(`${group.count} | ${group.classification} | ${group.bairroPlanilha} -> ${group.bairroLocal}`);
      console.log(`  pairKey: ${group.pairKey}`);
      console.log(`  lowConfidence: ${group.lowConfidenceCount}; streetMismatch: ${group.streetMismatchCount}`);
      console.log(`  sequences: ${group.sequences.join(", ")}`);
      console.log(`  jobs: ${group.jobs.map((x) => `${x.value} [${x.count}]`).join("; ")}`);
      console.log(`  users: ${group.users.map((x) => `${x.value} [${x.count}]`).join("; ")}`);
      console.log(`  ruas planilha: ${group.ruasPlanilha.map((x) => `${x.value} [${x.count}]`).join("; ")}`);
      if (group.ruasLocais.length) {
        console.log(`  ruas locais: ${group.ruasLocais.map((x) => `${x.value} [${x.count}]`).join("; ")}`);
      }
      console.log("  examples:");
      for (const ex of group.examples) {
        console.log(
          `    seq ${ex.sequence}: ${ex.original} | ${ex.bairroPlanilha} -> ${ex.bairroLocal} | ` +
            `${ex.ruaPlanilha} -> ${ex.ruaLocal || "-"} | Q${ex.quadra} L${ex.lote} | ` +
            `${ex.lat},${ex.lng} | confidence ${ex.geocodeConfidenceLevel || "-"} ${ex.geocodeConfidence ?? "-"}`,
        );
      }
      console.log("");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
