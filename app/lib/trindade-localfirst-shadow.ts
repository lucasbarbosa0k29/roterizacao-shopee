import fs from "node:fs";
import path from "node:path";

import type {
  TrindadeDecisionSimulation,
  TrindadeShadowComparison,
  TrindadeShadowComparisonDetails,
  TrindadeShadowFlags,
  TrindadeShadowInput,
  TrindadeShadowMatchType,
  TrindadeShadowResult,
  TrindadePromotionSimulation,
  TrindadeSafetyGate,
  TrindadeShadowConfidence,
  TrindadeStreetBairroResolution,
} from "./trindade-shadow-types";

type LocalFirstRecord = {
  key: string;
  normalizedKey?: string;
  id?: number;
  code?: Record<string, string | number | boolean | null>;
  context?: Record<string, string | number | boolean | null>;
  name?: Record<string, string | number | boolean | null>;
  relations?: Record<string, string | null | undefined>;
  geometry?: {
    centroid?: { type: "Point"; coordinates: [number, number] };
    bbox?: [number, number, number, number];
  };
  confidence?: {
    initial?: number;
    reason?: string;
  };
  relation?: {
    orphan?: boolean;
    weak?: boolean;
    fallbackRequired?: boolean;
  };
  aliases?: string[];
  search?: {
    tokens?: string[];
  };
};

type LocalFirstIndex = {
  byKey?: Record<string, LocalFirstRecord>;
};

type TrindadeAliasEntry = {
  type?: string;
  input?: string;
  normalized?: string;
  value?: string;
  confidence?: number;
  notes?: string;
};

type TrindadeAliasesFile = {
  aliases?: TrindadeAliasEntry[];
  [key: string]: unknown;
};

type LoadedTrindadeLocalFirst = {
  manifest: Record<string, unknown> | null;
  lotes: LocalFirstIndex | null;
  quadras: LocalFirstIndex | null;
  logradouros: LocalFirstIndex | null;
  bairros: LocalFirstIndex | null;
  loteamentos: LocalFirstIndex | null;
  aliases: TrindadeAliasesFile | null;
};

const BASE_DIR = path.join(process.cwd(), "data", "localfirst", "trindade");

const cache: LoadedTrindadeLocalFirst = {
  manifest: null,
  lotes: null,
  quadras: null,
  logradouros: null,
  bairros: null,
  loteamentos: null,
  aliases: null,
};

const nameIndexCache = {
  bairros: null as Map<string, LocalFirstRecord> | null,
  loteamentos: null as Map<string, LocalFirstRecord> | null,
  logradouros: null as Map<string, LocalFirstRecord[]> | null,
};

const lotIndexCache = {
  byQuadraLote: null as Map<string, LocalFirstRecord[]> | null,
  byBairroQuadraLote: null as Map<string, LocalFirstRecord[]> | null,
};

export function getTrindadeLocalFirstCacheSnapshot() {
  return {
    loaded: !!cache.manifest || !!cache.lotes || !!cache.quadras || !!cache.logradouros || !!cache.bairros || !!cache.loteamentos || !!cache.aliases,
    nameIndexSizes: {
      bairros: nameIndexCache.bairros?.size ?? 0,
      loteamentos: nameIndexCache.loteamentos?.size ?? 0,
      logradouros: nameIndexCache.logradouros?.size ?? 0,
    },
    lotIndexSizes: {
      byQuadraLote: lotIndexCache.byQuadraLote?.size ?? 0,
      byBairroQuadraLote: lotIndexCache.byBairroQuadraLote?.size ?? 0,
    },
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
}

function normalizeText(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompactText(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

function preserveCode(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeLoteCode(value: unknown) {
  const text = preserveCode(value);
  if (!text) return "";
  if (/^\d+$/.test(text)) return text.padStart(5, "0");
  return text.toUpperCase();
}

function normalizeQuadraCode(value: unknown) {
  const text = preserveCode(value);
  if (!text) return "";
  if (/^\d+$/.test(text)) return text.padStart(5, "0");
  return text.toUpperCase();
}

function getRecordCentroid(record: LocalFirstRecord) {
  const coordinates = record.geometry?.centroid?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const [lng, lat] = coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

function buildCandidateFromRecord(
  record: LocalFirstRecord,
  layer: TrindadeShadowResult["matchedLayer"],
  reason: string,
) {
  const centroid = getRecordCentroid(record);
  return {
    key: record.key,
    layer: layer || "lotes",
    reason,
    lat: centroid?.lat ?? null,
    lng: centroid?.lng ?? null,
  };
}

function normalizeGenericCode(value: unknown) {
  const text = preserveCode(value);
  if (!text) return "";
  return text.toUpperCase();
}

function normalizeCity(value: unknown) {
  return normalizeCompactText(String(value || ""));
}

function normalizeBairroAliasKey(value: string) {
  return normalizeText(value);
}

function normalizeStreetName(value: string) {
  return normalizeText(value)
    .replace(/([A-Z])(?=\d)/g, "$1 ")
    .replace(/(\d)(?=[A-Z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bAVENIDA\b/g, "AV")
    .replace(/\bRUA\b/g, "R")
    .replace(/\bALAMEDA\b/g, "AL")
    .replace(/\bTRAVESSA\b/g, "TV")
    .replace(/\bVILA\b/g, "VL")
    .replace(/\s+/g, " ")
    .trim();
}

function stripStreetPrefix(value: string) {
  return normalizeText(value)
    .replace(/^(?:RUA|R|AVENIDA|AV|ALAMEDA|AL|TRAVESSA|TV|VILA|VL|RODOVIA|ROD)\b\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStreetSearchKey(type: string, value: string) {
  const street = normalizeText(value)
    .replace(/\bAVENIDA\b/g, "AV")
    .replace(/\bRUA\b/g, "R")
    .replace(/\bALAMEDA\b/g, "AL")
    .replace(/\bTRAVESSA\b/g, "TV")
    .replace(/\bVILA\b/g, "VL")
    .replace(/\s+/g, " ")
    .trim();
  if (!street) return "";

  const preparedStreet = street.replace(/([A-Z])(?=\d)/g, "$1 ").replace(/(\d)(?=[A-Z])/g, "$1 ").replace(/\s+/g, " ").trim();
  if (!preparedStreet) return "";

  const typed = normalizeStreetType(type);
  const hasPrefix = /^(RUA|R|AV|AL|TV|VL|ROD)\b/.test(preparedStreet);
  return normalizeStreetName(hasPrefix ? preparedStreet : [typed, preparedStreet].filter(Boolean).join(" "));
}

function buildStreetSearchKeys(type: string, value: string, rawValue?: string) {
  const keys = new Set<string>();
  const seeds = new Set<string>();

  const normalizedValueSeed = extractStreetSeedFromRawAddress(value);
  if (normalizedValueSeed) seeds.add(normalizedValueSeed);

  if (rawValue) {
    const normalizedRawSeed = extractStreetSeedFromRawAddress(rawValue);
    if (normalizedRawSeed) seeds.add(normalizedRawSeed);
  }

  for (const seed of seeds) {
    addStreetSearchVariant(keys, type, seed);
  }

  return [...keys];
}

function normalizeStreetType(value: string) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text === "R" || text === "R.") return "RUA";
  if (text === "AV" || text === "AV.") return "AV";
  if (text === "AVENIDA") return "AV";
  return text;
}

function extractStreetSeedFromRawAddress(value: string) {
  const text = normalizeText(value)
    .replace(/[.,;:/\\|\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  const cutPattern =
    /\b(?:ESQUINA\s+COM|ESQ\s*C|CONDOMINIO|PADARIA|ACIMA\s+DO|EM\s+FRENTE|PROXIMO|PR[OÓ]XIMO|QUADRA|QUDRA|QDRA|QR|QD|LOTE|LT|N\s*\d+|S\s*\/\s*N|SN|SEM\s+NUMERO|NUMERO|Nº)\b/i;
  const cutIndex = text.search(cutPattern);
  const seed = cutIndex >= 0 ? text.slice(0, cutIndex).trim() : text;
  return seed.replace(/\s+/g, " ").trim();
}

function addStreetSearchVariant(keys: Set<string>, type: string, seed: string) {
  const baseStreet = normalizeText(seed)
    .replace(/\bAVENIDA\b/g, "AV")
    .replace(/\bRUA\b/g, "R")
    .replace(/\bALAMEDA\b/g, "AL")
    .replace(/\bTRAVESSA\b/g, "TV")
    .replace(/\bVILA\b/g, "VL")
    .replace(/\s+/g, " ")
    .trim();
  if (!baseStreet) return;

  const preparedStreet = baseStreet
    .replace(/([A-Z])(?=\d)/g, "$1 ")
    .replace(/(\d)(?=[A-Z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
  if (!preparedStreet) return;

  const typed = normalizeStreetType(type);
  const hasPrefix = /^(RUA|R|AV|AL|TV|VL|ROD)\b/.test(preparedStreet);
  const primary = normalizeStreetName(hasPrefix ? preparedStreet : [typed, preparedStreet].filter(Boolean).join(" "));
  if (primary) keys.add(primary);

  const stripped = stripStreetPrefix(preparedStreet);
  if (stripped) {
    const strippedKey = normalizeStreetName([typed, stripped].filter(Boolean).join(" "));
    if (strippedKey) keys.add(strippedKey);

    if (typed === "AV") {
      const ruaKey = normalizeStreetName(["RUA", stripped].filter(Boolean).join(" "));
      if (ruaKey) keys.add(ruaKey);
    } else if (typed === "RUA") {
      const avKey = normalizeStreetName(["AV", stripped].filter(Boolean).join(" "));
      if (avKey) keys.add(avKey);
    }
  }

  if (preparedStreet.startsWith("R S ")) {
    const withoutS = normalizeStreetName(preparedStreet.replace(/^R S\s+/, "R "));
    if (withoutS) keys.add(withoutS);
    const justName = normalizeStreetName(preparedStreet.replace(/^R S\s+/, "RUA "));
    if (justName) keys.add(justName);
  }
}

function isFlagEnabled() {
  return String(process.env.ROTTA_TRINDADE_LOCALFIRST_SHADOW || "").trim() === "1";
}

function loadIndex(fileName: string) {
  const filePath = path.join(BASE_DIR, fileName);
  return readJson<LocalFirstIndex>(filePath);
}

function loadAliases() {
  const filePath = path.join(BASE_DIR, "aliases.json");
  return readJson<TrindadeAliasesFile>(filePath);
}

function loadManifest() {
  const filePath = path.join(BASE_DIR, "manifest.json");
  return readJson<Record<string, unknown>>(filePath);
}

function ensureLoaded() {
  if (!cache.manifest) cache.manifest = loadManifest();
  if (!cache.lotes) cache.lotes = loadIndex("lotes-index.json");
  if (!cache.quadras) cache.quadras = loadIndex("quadras-index.json");
  if (!cache.logradouros) cache.logradouros = loadIndex("logradouros-index.json");
  if (!cache.bairros) cache.bairros = loadIndex("bairros-index.json");
  if (!cache.loteamentos) cache.loteamentos = loadIndex("loteamentos-index.json");
  if (!cache.aliases) cache.aliases = loadAliases();
}

function getRecords(index: LocalFirstIndex | null): LocalFirstRecord[] {
  const byKey = index?.byKey || {};
  return Object.values(byKey);
}

function getTopLevelAliases(type: "bairro" | "logradouro") {
  ensureLoaded();

  return (cache.aliases?.aliases || []).filter(
    (alias): alias is TrindadeAliasEntry =>
      alias?.type === type &&
      typeof alias.value === "string" &&
      typeof alias.input === "string" &&
      alias.input.trim().length > 0 &&
      alias.value.trim().length > 0,
  );
}

function resolveBairroAliasKey(alias: TrindadeAliasEntry) {
  return normalizeBairroAliasKey(alias.normalized || alias.input || "");
}

function resolveBairroTargetKey(alias: TrindadeAliasEntry) {
  return normalizeBairroAliasKey(alias.value || "");
}

function resolveLogradouroAliasKey(alias: TrindadeAliasEntry) {
  return normalizeStreetSearchKey("", alias.input || alias.normalized || "");
}

function resolveLogradouroTargetKey(alias: TrindadeAliasEntry) {
  return normalizeStreetSearchKey("", alias.value || "");
}

function applyBairroAliases(index: Map<string, LocalFirstRecord>) {
  for (const alias of getTopLevelAliases("bairro")) {
    const aliasKey = resolveBairroAliasKey(alias);
    const targetKey = resolveBairroTargetKey(alias);
    if (!aliasKey || !targetKey) continue;

    const target = index.get(targetKey) || null;
    if (!target) continue;

    const existing = index.get(aliasKey) || null;
    if (existing && existing !== target) continue;
    if (!existing) index.set(aliasKey, target);
  }
}

function applyLogradouroAliases(index: Map<string, LocalFirstRecord[]>) {
  for (const alias of getTopLevelAliases("logradouro")) {
    const aliasKey = resolveLogradouroAliasKey(alias);
    const targetKey = resolveLogradouroTargetKey(alias);
    if (!aliasKey || !targetKey) continue;

    const targetBucket = index.get(targetKey) || [];
    if (targetBucket.length !== 1) continue;

    const target = targetBucket[0];
    const existingBucket = index.get(aliasKey) || null;
    if (existingBucket && (existingBucket.length !== 1 || existingBucket[0] !== target)) continue;
    if (!existingBucket) index.set(aliasKey, [target]);
  }
}

function buildBairroNameIndex() {
  if (nameIndexCache.bairros) return nameIndexCache.bairros;
  ensureLoaded();

  const index = new Map<string, LocalFirstRecord>();
  for (const record of getRecords(cache.bairros)) {
    const normalizedName = normalizeBairroAliasKey(String(record.name?.nmbairro || record.normalizedKey || ""));
    if (normalizedName) index.set(normalizedName, record);
    for (const alias of record.aliases || []) {
      const normalizedAlias = normalizeBairroAliasKey(alias);
      if (normalizedAlias && !index.has(normalizedAlias)) index.set(normalizedAlias, record);
    }
  }
  applyBairroAliases(index);
  nameIndexCache.bairros = index;
  return index;
}

function buildLoteamentoNameIndex() {
  if (nameIndexCache.loteamentos) return nameIndexCache.loteamentos;
  ensureLoaded();

  const index = new Map<string, LocalFirstRecord>();
  for (const record of getRecords(cache.loteamentos)) {
    const normalizedName = normalizeText(String(record.name?.nmloteamento || record.normalizedKey || ""));
    if (normalizedName) index.set(normalizedName, record);
    for (const alias of record.aliases || []) {
      const normalizedAlias = normalizeText(alias);
      if (normalizedAlias && !index.has(normalizedAlias)) index.set(normalizedAlias, record);
    }
  }
  nameIndexCache.loteamentos = index;
  return index;
}

function buildLogradouroNameIndex() {
  if (nameIndexCache.logradouros) return nameIndexCache.logradouros;
  ensureLoaded();

  const index = new Map<string, LocalFirstRecord[]>();
  for (const record of getRecords(cache.logradouros)) {
    const full = normalizeStreetName(String(record.name?.full || ""));
    const name = normalizeStreetName(String(record.name?.nmlogradouro || ""));
    const type = normalizeStreetType(String(record.name?.tipologradouro || ""));
    const variants = [full, name].filter(Boolean);
    for (const variant of variants) {
      const bucket = index.get(variant) || [];
      bucket.push(record);
      index.set(variant, bucket);
    }
    if (type && name) {
      const typed = normalizeStreetName(`${type} ${name}`);
      const bucket = index.get(typed) || [];
      bucket.push(record);
      index.set(typed, bucket);
    }
    for (const alias of record.aliases || []) {
      for (const aliasKey of buildStreetSearchKeys(type, alias)) {
        const bucket = index.get(aliasKey) || [];
        bucket.push(record);
        index.set(aliasKey, bucket);
      }
    }
  }
  applyLogradouroAliases(index);
  nameIndexCache.logradouros = index;
  return index;
}

function buildLoteQuadraIndex() {
  if (lotIndexCache.byQuadraLote) return lotIndexCache.byQuadraLote;
  ensureLoaded();

  const index = new Map<string, LocalFirstRecord[]>();
  for (const record of getRecords(cache.lotes)) {
    const code = record.code || {};
    const bucketKey = `${preserveCode(code.cdquadra)}|${normalizeLoteCode(code.cdlote)}`;
    if (!bucketKey || bucketKey === "|") continue;
    const bucket = index.get(bucketKey) || [];
    bucket.push(record);
    index.set(bucketKey, bucket);
  }

  lotIndexCache.byQuadraLote = index;
  return index;
}

function getBairroCode(record: LocalFirstRecord | null | undefined) {
  return preserveCode(
    record?.context?.cdbairro ||
      record?.relations?.bairroKey ||
      record?.code?.cdbairro ||
      record?.code?.cdloteamento ||
      record?.key ||
      "",
  );
}

function buildBairroQuadraLoteIndex() {
  if (lotIndexCache.byBairroQuadraLote) return lotIndexCache.byBairroQuadraLote;
  ensureLoaded();

  const index = new Map<string, LocalFirstRecord[]>();
  for (const record of getRecords(cache.lotes)) {
    const code = record.code || {};
    const bairroKey = getBairroCode(record);
    const quadraKey = normalizeQuadraCode(code.cdquadra);
    const loteKey = normalizeLoteCode(code.cdlote);
    const bucketKey = `${bairroKey}|${quadraKey}|${loteKey}`;
    if (!bairroKey || !quadraKey || !loteKey) continue;
    const bucket = index.get(bucketKey) || [];
    bucket.push(record);
    index.set(bucketKey, bucket);
  }

  lotIndexCache.byBairroQuadraLote = index;
  return index;
}

function detectCity(value: unknown) {
  const city = normalizeCity(value);
  return city.includes("TRINDADE");
}

function buildFlags(): TrindadeShadowFlags {
  return {
    exactKeyMatch: false,
    fallbackUsed: false,
    aliasUsed: false,
    relationshipUsed: false,
    weakRelation: false,
    conflictWithHere: false,
    manualMemorySovereign: true,
    currentResultPreserved: true,
  };
}

function buildSkippedResult(
  comparisonResult: TrindadeShadowComparison,
  notes: string[],
  cityDetected = false,
): TrindadeShadowResult {
  return {
    enabled: true,
    cityDetected,
    skipped: true,
    localFirstFound: false,
    matchType: "SKIPPED",
    confidence: 0,
    matchedKey: null,
    matchedLayer: null,
    fallbackUsed: false,
    conflictWithHere: false,
    comparisonResult,
    comparison: null,
    reason: notes[0] || comparisonResult,
    flags: buildFlags(),
    notes,
    candidate: null,
    streetBairroResolution: {
      level: "NONE",
      cdlogradouro: null,
      tipologradouro: null,
      normalizedStreet: "",
      normalizedBairro: "",
      candidatesCount: 0,
      usedAlias: false,
      streetAliasUsed: false,
      bairroAliasUsed: false,
      exactStreetMatch: false,
      exactBairroMatch: false,
      uniqueCandidate: false,
      reason: notes[0] || comparisonResult,
    },
    promotionSimulation: {
      eligible: false,
      promotedMatchType: null,
      promotedTo: null,
      fromMatchType: "SKIPPED",
      reason: notes[0] || comparisonResult,
    },
    shadowConfidence: {
      score: 0,
      bucket: "LOW",
      reasons: [`base=SKIPPED:0`, `reason=${notes[0] || comparisonResult}`],
    },
    decisionSimulation: null,
    safetyGate: null,
  };
}

export function isTrindadeCandidate(input: TrindadeShadowInput): boolean {
  return detectCity(input.city);
}

export function normalizeTrindadeInput(input: TrindadeShadowInput) {
  return {
    rawCity: String(input.city || ""),
    rawBairro: String(input.bairro || ""),
    rawRua: String(input.rua || ""),
    rawCdbairro: String(input.cdbairro || ""),
    rawCdlogradouro: String(input.cdlogradouro || ""),
    rawNmlogradouro: String(input.nmlogradouro || ""),
    rawTipologradouro: String(input.tipologradouro || ""),
    rawQuadra: String(input.quadra || ""),
    rawLote: String(input.lote || ""),
    rawLoteamento: String(input.loteamento || ""),
    rawCdloteamento: String(input.cdloteamento || ""),
    rawCdquadra: String(input.cdquadra || ""),
    rawCdlote: String(input.cdlote || ""),
    rawAddress: String(input.rawAddress || ""),
    rawCep: String(input.cep || ""),
    city: normalizeText(String(input.city || "")),
    bairro: normalizeText(String(input.bairro || "")),
    rua: normalizeStreetName(String(input.rua || "")),
    cdbairro: normalizeGenericCode(input.cdbairro || input.bairro || ""),
    cdlogradouro: normalizeGenericCode(input.cdlogradouro || ""),
    nmlogradouro: normalizeStreetName(String(input.nmlogradouro || "")),
    tipologradouro: normalizeStreetType(String(input.tipologradouro || "")),
    quadra: normalizeQuadraCode(input.quadra || input.cdquadra || ""),
    lote: normalizeLoteCode(input.lote || input.cdlote || ""),
    loteamento: normalizeGenericCode(input.loteamento || input.cdloteamento || ""),
    cdloteamento: normalizeGenericCode(input.cdloteamento || input.loteamento || ""),
    cdquadra: normalizeQuadraCode(input.cdquadra || input.quadra || ""),
    cdlote: normalizeLoteCode(input.cdlote || input.lote || ""),
    cep: preserveCode(input.cep || ""),
  };
}

function makeConfidence(matchType: TrindadeShadowMatchType, flags: TrindadeShadowFlags) {
  if (matchType === "MATCH_FORTE") return flags.fallbackUsed ? 0.88 : 0.98;
  if (matchType === "MATCH_MEDIO") return flags.fallbackUsed ? 0.84 : 0.92;
  if (matchType === "MATCH_RUA_BAIRRO") return flags.weakRelation ? 0.76 : 0.88;
  if (matchType === "MATCH_FALLBACK") return flags.aliasUsed ? 0.68 : 0.58;
  return 0;
}

function compareResultType(
  shadow: TrindadeShadowResult,
  currentResult: TrindadeShadowInput["currentResult"],
): {
  conflictWithHere: boolean;
  comparisonResult: TrindadeShadowComparison;
  notes: string[];
} {
  const notes: string[] = [];

  if (!currentResult) {
    return {
      conflictWithHere: false,
      comparisonResult: shadow.localFirstFound ? "DIFF_BUT_ACCEPTABLE" : "NO_LOCAL_CANDIDATE",
      notes: ["no_current_result"],
    };
  }

  const source = normalizeText(String(currentResult.source || ""));
  const currentMatchedKey = preserveCode(currentResult.matchedKey || "");
  const currentMatchType = normalizeText(String(currentResult.matchType || ""));

  const currentIsManual = source.includes("MEMORY");
  const currentIsHere = source.includes("HERE");
  const sameKey = !!currentMatchedKey && currentMatchedKey === shadow.matchedKey;
  const sameType = !!currentMatchType && normalizeText(shadow.matchType) === currentMatchType;

  if (currentIsManual) {
    notes.push("manual_memory_sovereign");
    if (sameKey) {
      return { conflictWithHere: false, comparisonResult: "AGREE_EXACT", notes };
    }
    if (sameType) {
      return { conflictWithHere: false, comparisonResult: "AGREE_APPROX", notes };
    }
    return { conflictWithHere: true, comparisonResult: "DIFF_CONFLICT", notes };
  }

  if (currentIsHere) {
    if (sameKey) {
      return { conflictWithHere: false, comparisonResult: "AGREE_EXACT", notes };
    }

    if (
      shadow.fallbackUsed ||
      shadow.matchType === "MATCH_FALLBACK" ||
      shadow.matchType === "MATCH_RUA_BAIRRO"
    ) {
      return { conflictWithHere: true, comparisonResult: "DIFF_BUT_ACCEPTABLE", notes };
    }

    return { conflictWithHere: true, comparisonResult: "DIFF_CONFLICT", notes };
  }

  if (sameKey) {
    return { conflictWithHere: false, comparisonResult: "AGREE_APPROX", notes };
  }

  return { conflictWithHere: true, comparisonResult: "DIFF_BUT_ACCEPTABLE", notes };
}

function resolveBairroAnchorForLote(
  input: ReturnType<typeof normalizeTrindadeInput>,
  streetBairroResolution?: TrindadeStreetBairroResolution | null,
) {
  ensureLoaded();

  const bairroIndex = buildBairroNameIndex();
  if (streetBairroResolution?.level !== "NONE" && streetBairroResolution?.uniqueCandidate) {
    const byStreetResolution = bairroIndex.get(streetBairroResolution.normalizedBairro) || null;
    if (byStreetResolution) return byStreetResolution;
  }

  const bairroCandidate = findBairroCandidate(input);
  return bairroCandidate?.record || null;
}

function buildBairroQuadraLoteLookupKeys(
  input: ReturnType<typeof normalizeTrindadeInput>,
  streetBairroResolution?: TrindadeStreetBairroResolution | null,
) {
  const keys = new Set<string>();
  const streetBairroKey = preserveCode(streetBairroResolution?.bairroKey || "");
  if (streetBairroKey) keys.add(streetBairroKey);

  const bairroAnchor = resolveBairroAnchorForLote(input, streetBairroResolution);
  const anchorKey = getBairroCode(bairroAnchor);
  if (anchorKey) keys.add(anchorKey);

  return [...keys];
}

function findOperationalBairroQuadraLoteCandidate(
  input: ReturnType<typeof normalizeTrindadeInput>,
  streetBairroResolution?: TrindadeStreetBairroResolution | null,
) {
  ensureLoaded();

  const normalizedQuadra = normalizeQuadraCode(input.rawCdquadra || input.cdquadra);
  const normalizedLote = normalizeLoteCode(input.rawCdlote || input.cdlote);
  if (!normalizedQuadra || !normalizedLote) return null;

  for (const bairroKey of buildBairroQuadraLoteLookupKeys(input, streetBairroResolution)) {
    const bucket = buildBairroQuadraLoteIndex().get(`${bairroKey}|${normalizedQuadra}|${normalizedLote}`) || [];
    if (bucket.length !== 1) continue;

    const [record] = bucket;
    return {
      record,
      matchType: "MATCH_MEDIO" as TrindadeShadowMatchType,
      matchedLayer: "lotes" as const,
      fallbackUsed: false,
      reason: "street bairro qdlt bucket",
      key: record.key,
      flags: { exact: true, fallback: false },
    };
  }

  return null;
}

function findLoteCandidate(
  input: ReturnType<typeof normalizeTrindadeInput>,
  streetBairroResolution?: TrindadeStreetBairroResolution | null,
) {
  ensureLoaded();
  const rawCdloteamento = preserveCode(input.rawCdloteamento);
  const rawCdquadra = preserveCode(input.rawCdquadra);
  const rawCdlote = preserveCode(input.rawCdlote);
  const normalizedQuadra = normalizeQuadraCode(rawCdquadra || input.cdquadra);
  const normalizedLote = normalizeLoteCode(rawCdlote || input.cdlote);
  const bairroKeys = buildBairroQuadraLoteLookupKeys(input, streetBairroResolution);
  if (bairroKeys.length && normalizedQuadra && normalizedLote) {
    for (const bairroKey of bairroKeys) {
      const bairroBucket = buildBairroQuadraLoteIndex().get(`${bairroKey}|${normalizedQuadra}|${normalizedLote}`) || [];
      if (bairroBucket.length !== 1) continue;

      const [record] = bairroBucket;
      return {
        record,
        matchType: "MATCH_MEDIO" as TrindadeShadowMatchType,
        matchedLayer: "lotes" as const,
        fallbackUsed: false,
        reason: "bairro+quadra+lote bucket",
        key: record.key,
        flags: { exact: true, fallback: false },
      };
    }

    // Bairro canônico já foi resolvido: não deixamos o fluxo escapar para outro bairro.
    return null;
  }

  const exactKey = `${rawCdloteamento || input.cdloteamento}|${normalizedQuadra}|${normalizedLote}`;
  const byExact = cache.lotes?.byKey?.[exactKey] || null;
  if (
    byExact &&
    rawCdloteamento === input.cdloteamento &&
    normalizeQuadraCode(rawCdquadra || input.cdquadra) === input.cdquadra &&
    normalizeLoteCode(rawCdlote || input.cdlote) === input.cdlote
  ) {
    return {
      record: byExact,
      matchType: "MATCH_FORTE" as TrindadeShadowMatchType,
      matchedLayer: "lotes" as const,
      fallbackUsed: false,
      reason: "exact lot key",
      key: byExact.key,
      flags: { exact: true, fallback: false },
    };
  }

  const bucket = buildLoteQuadraIndex().get(`${input.cdquadra}|${normalizedLote}`) || [];
  if (bucket.length === 1) {
    const [record] = bucket;
    return {
      record,
      matchType: "MATCH_MEDIO" as TrindadeShadowMatchType,
      matchedLayer: "lotes" as const,
      fallbackUsed: false,
      reason: "quadra+lote bucket",
      key: record.key,
      flags: { exact: true, fallback: false },
    };
  }

  const normalizedKey = `${input.cdloteamento}|${input.cdquadra}|${normalizedLote}`;
  const fallbackRecord = cache.lotes?.byKey?.[normalizedKey] || null;
  if (fallbackRecord) {
    return {
      record: fallbackRecord,
      matchType: "MATCH_FALLBACK" as TrindadeShadowMatchType,
      matchedLayer: "lotes" as const,
      fallbackUsed: normalizedLote !== rawCdlote,
      reason: normalizedLote !== rawCdlote ? "lote code normalized" : "fallback lot key",
      key: fallbackRecord.key,
      flags: { exact: normalizedLote === rawCdlote, fallback: true },
    };
  }

  return null;
}

function findQuadraCandidate(input: ReturnType<typeof normalizeTrindadeInput>) {
  ensureLoaded();
  const rawCdloteamento = preserveCode(input.rawCdloteamento);
  const rawCdquadra = preserveCode(input.rawCdquadra);
  const exactKey = `${rawCdloteamento || input.cdloteamento}|${normalizeQuadraCode(rawCdquadra || input.cdquadra)}`;
  let record = cache.quadras?.byKey?.[exactKey] || null;
  if (!record) {
    const bucket = getRecords(cache.quadras).filter((item) => normalizeQuadraCode(item.code?.cdquadra) === input.cdquadra);
    if (bucket.length === 1) {
      record = bucket[0];
    }
  }
  if (!record) return null;
  return {
    record,
    matchType: "MATCH_MEDIO" as TrindadeShadowMatchType,
    matchedLayer: "quadras" as const,
    fallbackUsed: false,
      reason: "exact quadra key",
      key: record.key,
    };
}

function findLoteamentoCandidate(input: ReturnType<typeof normalizeTrindadeInput>) {
  ensureLoaded();
  const byCode = cache.loteamentos?.byKey?.[input.cdloteamento] || null;
  if (byCode) {
    return {
      record: byCode,
      matchedLayer: "loteamentos" as const,
      fallbackUsed: false,
      reason: "exact loteamento code",
      key: byCode.key,
    };
  }

  const nameIndex = buildLoteamentoNameIndex();
  const byName = nameIndex.get(normalizeText(input.loteamento)) || null;
  if (byName) {
    return {
      record: byName,
      matchedLayer: "loteamentos" as const,
      fallbackUsed: true,
      reason: "loteamento alias/name fallback",
      key: byName.key,
    };
  }

  return null;
}

function findBairroCandidate(input: ReturnType<typeof normalizeTrindadeInput>) {
  ensureLoaded();
  const byCode =
    cache.bairros?.byKey?.[input.cdbairro] ||
    cache.bairros?.byKey?.[normalizeGenericCode(input.cdbairro)] ||
    cache.bairros?.byKey?.[normalizeGenericCode(input.bairro)] ||
    null;
  if (byCode) {
    return {
      record: byCode,
      matchedLayer: "bairros" as const,
      fallbackUsed: false,
      reason: "exact bairro code",
      key: byCode.key,
    };
  }

  const nameIndex = buildBairroNameIndex();
  const byName = nameIndex.get(normalizeBairroAliasKey(input.bairro)) || null;
  if (byName) {
    return {
      record: byName,
      matchedLayer: "bairros" as const,
      fallbackUsed: true,
      reason: "bairro alias/name fallback",
      key: byName.key,
    };
  }

  return null;
}

function findLogradouroCandidate(input: ReturnType<typeof normalizeTrindadeInput>) {
  ensureLoaded();
  const byCode =
    cache.logradouros?.byKey?.[input.cdlogradouro] ||
    cache.logradouros?.byKey?.[normalizeGenericCode(input.cdlogradouro)] ||
    null;
  if (byCode) {
    return {
      record: byCode,
      matchedLayer: "logradouros" as const,
      fallbackUsed: false,
      weakRelation: !!byCode.relation?.weak,
      reason: "exact logradouro code",
      key: byCode.key,
    };
  }

  const nameIndex = buildLogradouroNameIndex();
  for (const logradouroInput of buildStreetSearchKeys(
    input.tipologradouro,
    input.nmlogradouro || input.rua,
    input.rawRua || input.rawAddress,
  )) {
    const byName = nameIndex.get(logradouroInput)?.[0] || null;
    if (byName) {
      return {
        record: byName,
        matchedLayer: "logradouros" as const,
        fallbackUsed: true,
        weakRelation: true,
        reason: "logradouro name fallback",
        key: byName.key,
      };
    }
  }

  return null;
}

function buildStreetBairroResolution(
  input: ReturnType<typeof normalizeTrindadeInput>,
): TrindadeStreetBairroResolution {
  ensureLoaded();

  const streetSeed = extractStreetSeedFromRawAddress(
    input.rawRua || input.rawAddress || input.nmlogradouro || input.rua || "",
  );
  const normalizedStreet = normalizeStreetName(
    normalizeStreetSearchKey(input.tipologradouro, streetSeed || input.nmlogradouro || input.rua),
  );
  const normalizedBairro = normalizeBairroAliasKey(input.bairro);
  const streetTypeAliasUsed =
    !!input.rawTipologradouro &&
    normalizeStreetType(input.rawTipologradouro) !== normalizeText(input.rawTipologradouro);

  if (!normalizedStreet) {
    return {
      level: "NONE",
      cdlogradouro: null,
      tipologradouro: null,
      bairroKey: null,
      normalizedStreet,
      normalizedBairro,
      candidatesCount: 0,
      usedAlias: streetTypeAliasUsed,
      streetAliasUsed: streetTypeAliasUsed,
      bairroAliasUsed: false,
      exactStreetMatch: false,
      exactBairroMatch: false,
      uniqueCandidate: false,
      reason: "missing normalized street",
    };
  }

  const streetIndex = buildLogradouroNameIndex();
  const uniqueStreetCandidates = new Map<string, LocalFirstRecord>();
  for (const streetKey of buildStreetSearchKeys(
    input.tipologradouro,
    input.nmlogradouro || input.rua,
    input.rawRua || input.rawAddress,
  )) {
    for (const record of streetIndex.get(streetKey) || []) {
      if (record?.key) uniqueStreetCandidates.set(record.key, record);
    }
  }
  const streetCandidates = [...uniqueStreetCandidates.values()];
  if (!streetCandidates.length) {
    return {
      level: "NONE",
      cdlogradouro: null,
      tipologradouro: null,
      bairroKey: null,
      normalizedStreet,
      normalizedBairro,
      candidatesCount: 0,
      usedAlias: streetTypeAliasUsed,
      streetAliasUsed: streetTypeAliasUsed,
      bairroAliasUsed: false,
      exactStreetMatch: false,
      exactBairroMatch: false,
      uniqueCandidate: false,
      reason: "no street candidate",
    };
  }

  if (!normalizedBairro) {
    return {
      level: "NONE",
      cdlogradouro: null,
      tipologradouro: null,
      bairroKey: null,
      normalizedStreet,
      normalizedBairro,
      candidatesCount: 0,
      usedAlias: streetTypeAliasUsed,
      streetAliasUsed: streetTypeAliasUsed,
      bairroAliasUsed: false,
      exactStreetMatch: !streetTypeAliasUsed,
      exactBairroMatch: false,
      uniqueCandidate: false,
      reason: "missing bairro",
    };
  }

  const bairroIndex = buildBairroNameIndex();
  const bairroRecord = bairroIndex.get(normalizedBairro) || null;
  const canonicalBairroName = normalizeBairroAliasKey(
    String(bairroRecord?.name?.nmbairro || bairroRecord?.normalizedKey || ""),
  );
  const bairroAliasUsed = !!bairroRecord && canonicalBairroName !== normalizedBairro;
  const bairroId = preserveCode(bairroRecord?.code?.idbairro || bairroRecord?.id || "");

  const pairCandidates = streetCandidates.filter((record) => {
    const recordBairroName = normalizeBairroAliasKey(String(record.context?.bairro || ""));
    const recordBairroId = preserveCode(record.context?.idbairro || "");
    if (!bairroRecord) {
      return recordBairroName === normalizedBairro;
    }
    return (
      (bairroId && recordBairroId === bairroId) ||
      (canonicalBairroName && recordBairroName === canonicalBairroName)
    );
  });

  if (!pairCandidates.length) {
    return {
      level: "NONE",
      cdlogradouro: null,
      tipologradouro: null,
      bairroKey: null,
      normalizedStreet,
      normalizedBairro,
      candidatesCount: 0,
      usedAlias: streetTypeAliasUsed || bairroAliasUsed,
      streetAliasUsed: streetTypeAliasUsed,
      bairroAliasUsed,
      exactStreetMatch: !streetTypeAliasUsed,
      exactBairroMatch: !bairroAliasUsed,
      uniqueCandidate: false,
      reason: "street candidate without bairro pair",
    };
  }

  if (pairCandidates.length > 1) {
    const first = pairCandidates[0];
    return {
      level: "WEAK_STREET_BAIRRO",
      cdlogradouro: preserveCode(first.code?.cdlogradouro || first.code?.idlogradouro || first.key) || first.key,
      tipologradouro: preserveCode(first.name?.tipologradouro || "") || null,
      bairroKey: preserveCode(first.context?.cdbairro || first.relations?.bairroKey || first.code?.cdbairro || first.code?.cdloteamento || first.key) || null,
      normalizedStreet,
      normalizedBairro,
      candidatesCount: pairCandidates.length,
      usedAlias: streetTypeAliasUsed || bairroAliasUsed,
      streetAliasUsed: streetTypeAliasUsed,
      bairroAliasUsed,
      exactStreetMatch: !streetTypeAliasUsed,
      exactBairroMatch: !bairroAliasUsed,
      uniqueCandidate: false,
      reason: "ambiguous street+bairro candidates",
    };
  }

  const [candidate] = pairCandidates;
  const candidateCdlogradouro = preserveCode(candidate.code?.cdlogradouro || candidate.code?.idlogradouro || candidate.key);
  const candidateTipologradouro = preserveCode(candidate.name?.tipologradouro || "");
  const candidateWeak = !!candidate.relation?.weak || !!candidate.relation?.fallbackRequired;
  const usedAlias = streetTypeAliasUsed || bairroAliasUsed;

  if (!usedAlias && !candidateWeak) {
    return {
      level: "STRONG_STREET_BAIRRO",
      cdlogradouro: candidateCdlogradouro || candidate.key,
      tipologradouro: candidateTipologradouro || null,
      bairroKey: preserveCode(candidate.context?.cdbairro || candidate.relations?.bairroKey || candidate.code?.cdbairro || candidate.code?.cdloteamento || candidate.key) || null,
      normalizedStreet,
      normalizedBairro,
      candidatesCount: 1,
      usedAlias: false,
      streetAliasUsed: false,
      bairroAliasUsed: false,
      exactStreetMatch: true,
      exactBairroMatch: true,
      uniqueCandidate: true,
      reason: "exact rua+bairro unique candidate",
    };
  }

  if (candidateWeak) {
    return {
      level: "WEAK_STREET_BAIRRO",
      cdlogradouro: candidateCdlogradouro || candidate.key,
      tipologradouro: candidateTipologradouro || null,
      bairroKey: preserveCode(candidate.context?.cdbairro || candidate.relations?.bairroKey || candidate.code?.cdbairro || candidate.code?.cdloteamento || candidate.key) || null,
      normalizedStreet,
      normalizedBairro,
      candidatesCount: 1,
      usedAlias,
      streetAliasUsed: streetTypeAliasUsed,
      bairroAliasUsed,
      exactStreetMatch: !streetTypeAliasUsed,
      exactBairroMatch: !bairroAliasUsed,
      uniqueCandidate: true,
      reason: "unique candidate but weak relation",
    };
  }

  return {
    level: "MEDIUM_STREET_BAIRRO",
    cdlogradouro: candidateCdlogradouro || candidate.key,
    tipologradouro: candidateTipologradouro || null,
    bairroKey: preserveCode(candidate.context?.cdbairro || candidate.relations?.bairroKey || candidate.code?.cdbairro || candidate.code?.cdloteamento || candidate.key) || null,
    normalizedStreet,
    normalizedBairro,
    candidatesCount: 1,
    usedAlias,
    streetAliasUsed: streetTypeAliasUsed,
    bairroAliasUsed,
    exactStreetMatch: !streetTypeAliasUsed,
    exactBairroMatch: !bairroAliasUsed,
    uniqueCandidate: true,
    reason: streetTypeAliasUsed
      ? "street alias with exact bairro"
      : "exact street with bairro alias",
  };
}

function buildPromotionSimulation(
  input: {
    matchType: TrindadeShadowMatchType;
    matchedLayer: TrindadeShadowResult["matchedLayer"];
    streetBairroResolution: TrindadeStreetBairroResolution | null | undefined;
    comparisonResult?: TrindadeShadowComparison | null;
    normalized: ReturnType<typeof normalizeTrindadeInput>;
  },
): TrindadePromotionSimulation {
  const fromMatchType = input.matchType;
  const hasStreetBairroResolution = input.streetBairroResolution?.level !== "NONE";
  const hasUniqueCandidate = !!input.streetBairroResolution?.uniqueCandidate;
  const isOperationalLotLayer = input.matchedLayer === "lotes";
  const isOperationalStreetLayer = input.matchedLayer === "logradouros";
  const hasSafeComparison = input.comparisonResult !== "DIFF_CONFLICT";
  const hasQuadraLote = !!input.normalized.quadra && !!input.normalized.lote;
  const eligible =
    hasSafeComparison &&
    hasStreetBairroResolution &&
    (
      (isOperationalLotLayer && hasQuadraLote && hasUniqueCandidate) ||
      isOperationalStreetLayer
    );

  return {
    eligible,
    promotedMatchType: eligible ? "MATCH_RUA_BAIRRO" : null,
    promotedTo: eligible ? "MATCH_RUA_BAIRRO" : null,
    fromMatchType,
    reason: eligible
      ? isOperationalStreetLayer
        ? "logradouro_rua_bairro_promotion"
        : "lote_unique_street_bairro_promotion"
      : !isOperationalLotLayer
        ? (!isOperationalStreetLayer ? "unsafe_match_layer" : !hasSafeComparison
            ? "diff_conflict"
            : !hasStreetBairroResolution
              ? "missing_street_bairro"
              : "current_match_type_not_eligible")
        : !hasQuadraLote
          ? "missing_quadra_lote"
          : !hasStreetBairroResolution
            ? "missing_street_bairro"
            : !hasUniqueCandidate
              ? "multiple_candidates"
              : !hasSafeComparison
                ? "diff_conflict"
                : "current_match_type_not_eligible",
  };
}

function buildShadowConfidence(
  matchType: TrindadeShadowMatchType,
  flags: TrindadeShadowFlags,
  streetBairroResolution: TrindadeStreetBairroResolution | null | undefined,
  normalized: ReturnType<typeof normalizeTrindadeInput>,
): TrindadeShadowConfidence {
  const reasons: string[] = [];
  const baseScoreByMatchType: Record<TrindadeShadowMatchType, number> = {
    MATCH_FORTE: 100,
    MATCH_MEDIO: 85,
    MATCH_RUA_BAIRRO: 70,
    MATCH_FALLBACK: 50,
    SKIPPED: 0,
  };

  let score = baseScoreByMatchType[matchType] ?? 0;
  reasons.push(`base=${matchType}:${score}`);

  if (streetBairroResolution?.level === "STRONG_STREET_BAIRRO") {
    score += 10;
    reasons.push("street_bairro_strong:+10");
  }
  if (streetBairroResolution?.uniqueCandidate) {
    score += 5;
    reasons.push("unique_candidate:+5");
  }
  if (streetBairroResolution?.exactBairroMatch) {
    score += 5;
    reasons.push("bairro_exact:+5");
  }
  if (normalized.quadra && normalized.lote) {
    score += 5;
    reasons.push("quadra_lote_valid:+5");
  }
  if (streetBairroResolution?.streetAliasUsed || streetBairroResolution?.bairroAliasUsed) {
    score -= 15;
    reasons.push("alias_used:-15");
  }
  if (flags.weakRelation) {
    score -= 20;
    reasons.push("weak_relation:-20");
  }
  if ((streetBairroResolution?.candidatesCount || 0) > 1) {
    score -= 20;
    reasons.push("multiple_candidates:-20");
  }

  score = Math.max(0, Math.min(100, score));
  const bucket =
    score >= 90 ? "VERY_HIGH" : score >= 75 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";

  return { score, bucket, reasons };
}

function buildDecisionSimulation(
  input: {
    cityDetected: boolean;
    localFirstFound: boolean;
    matchType: TrindadeShadowMatchType;
    currentResult: TrindadeShadowInput["currentResult"] | null;
    streetBairroResolution: TrindadeStreetBairroResolution | null | undefined;
    promotionSimulation: TrindadePromotionSimulation | null | undefined;
    comparisonResult: TrindadeShadowComparison;
    conflictWithHere: boolean;
    matchedLayer: TrindadeShadowResult["matchedLayer"];
  },
): TrindadeDecisionSimulation {
  const currentWinner = input.currentResult?.source || input.currentResult?.matchType || "UNKNOWN";
  const wouldReplaceCurrent =
    input.cityDetected &&
    input.localFirstFound &&
    !!input.promotionSimulation?.eligible &&
    input.comparisonResult !== "DIFF_CONFLICT" &&
    !input.conflictWithHere;

  const simulatedWinner = wouldReplaceCurrent
    ? "TRINDADE_LOCALFIRST"
    : input.comparisonResult === "AGREE_EXACT" || input.comparisonResult === "AGREE_APPROX"
      ? "UNCHANGED"
      : "CURRENT";

  let riskLevel: TrindadeDecisionSimulation["riskLevel"] = "MEDIUM";
  if (wouldReplaceCurrent) {
    riskLevel = "LOW";
  } else if (!input.cityDetected || input.comparisonResult === "DIFF_CONFLICT" || input.conflictWithHere) {
    riskLevel = "HIGH";
  } else if (
    !input.localFirstFound ||
    !input.promotionSimulation?.eligible ||
    input.streetBairroResolution?.level === "NONE"
  ) {
    riskLevel = "MEDIUM";
  }

  const safeguards = [
    input.cityDetected ? "city_trindade" : "city_not_trindade",
    input.localFirstFound ? "local_first_found" : "no_local_candidate",
    input.promotionSimulation?.eligible ? "promotion_eligible" : "not_promotion_eligible",
    input.streetBairroResolution?.level !== "NONE"
      ? "street_bairro_resolved"
      : "missing_street_bairro",
    input.streetBairroResolution?.uniqueCandidate ? "unique_candidate" : "non_unique_candidate",
    input.comparisonResult !== "DIFF_CONFLICT" ? "no_diff_conflict" : "diff_conflict",
    input.matchedLayer ? `matched_layer:${input.matchedLayer}` : "matched_layer:none",
  ];

  return {
    currentWinner,
    simulatedWinner,
    wouldReplaceCurrent,
    reason: wouldReplaceCurrent
      ? "decision_simulation_localfirst_wins"
      : !input.cityDetected
        ? "city_not_trindade"
      : !input.localFirstFound
        ? "no_local_candidate"
        : !input.promotionSimulation?.eligible
          ? "not_promotion_eligible"
          : input.streetBairroResolution?.level === "NONE"
            ? "missing_street_bairro"
            : input.comparisonResult === "DIFF_CONFLICT" || input.conflictWithHere
              ? "diff_conflict"
              : "current_wins",
    riskLevel,
    safeguards,
  };
}

function buildSafetyGate(
  input: {
    cityDetected: boolean;
    decisionSimulation: TrindadeDecisionSimulation;
    promotionSimulation: TrindadePromotionSimulation | null | undefined;
    streetBairroResolution: TrindadeStreetBairroResolution | null | undefined;
    comparisonResult: TrindadeShadowComparison;
    matchedLayer: TrindadeShadowResult["matchedLayer"];
    fallbackUsed: boolean;
    flags: TrindadeShadowFlags;
    currentResult: TrindadeShadowInput["currentResult"] | null;
    normalized: ReturnType<typeof normalizeTrindadeInput>;
  },
): TrindadeSafetyGate {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.cityDetected) blockers.push("city_not_trindade");
  if (!input.decisionSimulation.wouldReplaceCurrent) {
    if (!input.promotionSimulation?.eligible) blockers.push("not_promotion_eligible");
    if (!input.streetBairroResolution || input.streetBairroResolution.level === "NONE") {
      blockers.push("missing_street_bairro");
    } else if (input.streetBairroResolution.level !== "STRONG_STREET_BAIRRO") {
      blockers.push("weak_street_bairro");
    }
    if ((input.streetBairroResolution?.candidatesCount || 0) > 1) blockers.push("multiple_candidates");
    if (input.comparisonResult === "DIFF_CONFLICT") blockers.push("diff_conflict");
    if (!(input.matchedLayer === "logradouros" || input.matchedLayer === "lotes")) {
      blockers.push("unsafe_match_layer");
    }
  }

  if (input.decisionSimulation.riskLevel === "HIGH") blockers.push("high_risk");
  if (input.promotionSimulation?.eligible && input.streetBairroResolution?.level !== "STRONG_STREET_BAIRRO") {
    blockers.push("weak_street_bairro");
  }
  if (input.promotionSimulation?.eligible && (input.streetBairroResolution?.candidatesCount || 0) > 1) {
    blockers.push("multiple_candidates");
  }
  if (input.fallbackUsed) warnings.push("fallback_used");
  if (input.streetBairroResolution?.streetAliasUsed || input.streetBairroResolution?.bairroAliasUsed) {
    warnings.push("alias_used");
  }
  if (input.flags.weakRelation) warnings.push("weak_relation");
  if (!input.normalized.quadra || !input.normalized.lote) warnings.push("no_quadra_lote");
  if (String(input.currentResult?.source || "").includes("HERE") && input.comparisonResult !== "AGREE_EXACT") {
    warnings.push("here_disagrees");
  }
  if (String(input.currentResult?.source || "").includes("GOOGLE") && input.comparisonResult !== "AGREE_EXACT") {
    warnings.push("google_disagrees");
  }

  const pass =
    input.decisionSimulation.wouldReplaceCurrent &&
    input.decisionSimulation.riskLevel === "LOW" &&
    !!input.promotionSimulation?.eligible &&
    input.streetBairroResolution?.level !== "NONE" &&
    input.comparisonResult !== "DIFF_CONFLICT" &&
    (
      (
        input.matchedLayer === "lotes" &&
        Boolean(input.normalized.quadra) &&
        Boolean(input.normalized.lote) &&
        !!input.streetBairroResolution?.uniqueCandidate &&
        String(input.promotionSimulation?.reason || "") === "lote_unique_street_bairro_promotion"
      ) ||
      (
        input.matchedLayer === "logradouros" &&
        String(input.promotionSimulation?.reason || "") === "logradouro_rua_bairro_promotion"
      )
    );

  return {
    pass,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    ruleVersion: "trindade-localfirst-gate-v1",
  };
}

export async function runTrindadeLocalFirstShadow(
  input: TrindadeShadowInput,
): Promise<TrindadeShadowResult> {
  const cityDetected = isTrindadeCandidate(input);
  if (!isFlagEnabled()) {
    return buildSkippedResult("SKIPPED_FLAG_OFF", ["feature_flag_off"], cityDetected);
  }

  if (!cityDetected) {
    return buildSkippedResult("SKIPPED_NOT_TRINDADE", ["city_not_trindade"], false);
  }

  const normalized = normalizeTrindadeInput(input);
  ensureLoaded();
  const streetBairroResolution = buildStreetBairroResolution(normalized);

  const notes: string[] = [];
  let flags = buildFlags();
  let candidate: TrindadeShadowResult["candidate"] = null;
  let localFirstFound = false;
  let matchedKey: string | null = null;
  let matchedLayer: TrindadeShadowResult["matchedLayer"] = null;
  let matchType: TrindadeShadowMatchType = "SKIPPED";
  let fallbackUsed = false;

  const lotamento = findLoteamentoCandidate(normalized);
  const quadra = findQuadraCandidate(normalized);
  const operationalLote = findOperationalBairroQuadraLoteCandidate(normalized, streetBairroResolution);
  const lote = operationalLote || findLoteCandidate(normalized, streetBairroResolution);
  const bairro = findBairroCandidate(normalized);
  const logradouro = findLogradouroCandidate(normalized);

  if (operationalLote) {
    localFirstFound = true;
    matchedKey = operationalLote.record.key;
    matchedLayer = "lotes";
    matchType = operationalLote.matchType;
    fallbackUsed = false;
    flags = {
      ...flags,
      exactKeyMatch: true,
      fallbackUsed: false,
      relationshipUsed: true,
      weakRelation: false,
      aliasUsed: false,
    };
    notes.push("matched direct bairro+quadra+lote");
    candidate = buildCandidateFromRecord(operationalLote.record, "lotes", operationalLote.reason);
  } else if (lotamento && quadra && lote && lote.matchType === "MATCH_FORTE" && !lote.fallbackUsed) {
    localFirstFound = true;
    matchedKey = lote.record.key;
    matchedLayer = "lotes";
    matchType = "MATCH_FORTE";
    fallbackUsed = false;
    flags = {
      ...flags,
      exactKeyMatch: true,
      fallbackUsed: false,
      relationshipUsed: false,
      weakRelation: false,
      aliasUsed: false,
    };
    notes.push("matched composite lot chain");
    candidate = buildCandidateFromRecord(lote.record, "lotes", lote.reason);
  } else if (quadra && lote) {
    localFirstFound = true;
    matchedKey = lote.record.key;
    matchedLayer = "lotes";
    matchType = lote.matchType === "MATCH_FALLBACK" ? "MATCH_FALLBACK" : "MATCH_MEDIO";
    fallbackUsed = lote.fallbackUsed || false;
    flags = {
      ...flags,
      exactKeyMatch: lote.matchType === "MATCH_MEDIO" && !lote.fallbackUsed,
      fallbackUsed,
      weakRelation: false,
      aliasUsed: false,
      relationshipUsed: true,
    };
    notes.push("matched quadra+lote");
    candidate = buildCandidateFromRecord(lote.record, "lotes", lote.reason);
  } else if (logradouro && bairro) {
    localFirstFound = true;
    matchedKey = logradouro.record.key;
    matchedLayer = "logradouros";
    matchType = logradouro.fallbackUsed ? "MATCH_FALLBACK" : "MATCH_RUA_BAIRRO";
    fallbackUsed = logradouro.fallbackUsed || bairro.fallbackUsed;
    flags = {
      ...flags,
      exactKeyMatch: !fallbackUsed,
      fallbackUsed,
      aliasUsed: !!bairro.fallbackUsed,
      relationshipUsed: true,
      weakRelation: !!logradouro.weakRelation || !!bairro.fallbackUsed,
    };
    notes.push("matched rua+bairro");
    candidate = buildCandidateFromRecord(logradouro.record, "logradouros", logradouro.reason);
  } else if (lote) {
    localFirstFound = true;
    matchedKey = lote.record.key;
    matchedLayer = "lotes";
    matchType = "MATCH_FALLBACK";
    fallbackUsed = true;
    flags = {
      ...flags,
      exactKeyMatch: false,
      fallbackUsed: true,
      relationshipUsed: false,
      aliasUsed: false,
      weakRelation: !!lote.record.relation?.weak || !!lote.record.relation?.fallbackRequired,
    };
    notes.push("resolved by code fallback");
    candidate = buildCandidateFromRecord(lote.record, "lotes", lote.reason);
  } else if (logradouro) {
    localFirstFound = true;
    matchedKey = logradouro.record.key;
    matchedLayer = "logradouros";
    matchType = "MATCH_FALLBACK";
    fallbackUsed = true;
    flags = {
      ...flags,
      exactKeyMatch: false,
      fallbackUsed: true,
      relationshipUsed: true,
      aliasUsed: false,
      weakRelation: true,
    };
    notes.push("resolved street without reliable bairro");
    candidate = buildCandidateFromRecord(logradouro.record, "logradouros", logradouro.reason);
  } else {
    const promotionSimulation = buildPromotionSimulation({
      matchType: "SKIPPED",
      matchedLayer: null,
      streetBairroResolution,
      comparisonResult: "NO_LOCAL_CANDIDATE",
      normalized,
    });
    const shadowConfidence = buildShadowConfidence("SKIPPED", flags, streetBairroResolution, normalized);
    const decisionSimulation = buildDecisionSimulation({
      cityDetected: true,
      localFirstFound: false,
      matchType: "SKIPPED",
      currentResult: input.currentResult || null,
      streetBairroResolution,
      promotionSimulation,
      comparisonResult: "NO_LOCAL_CANDIDATE",
      conflictWithHere: false,
      matchedLayer: null,
    });
    const safetyGate = buildSafetyGate({
      cityDetected: true,
      decisionSimulation,
      promotionSimulation,
      streetBairroResolution,
      comparisonResult: "NO_LOCAL_CANDIDATE",
      matchedLayer: null,
      fallbackUsed: false,
      flags,
      currentResult: input.currentResult || null,
      normalized,
    });
    return {
      cityDetected: true,
      skipped: false,
      localFirstFound: false,
      matchType: "SKIPPED",
      confidence: 0,
      matchedKey: null,
      matchedLayer: null,
      fallbackUsed: false,
      conflictWithHere: false,
      comparisonResult: "NO_LOCAL_CANDIDATE",
      flags,
      notes: ["no_local_candidate"],
      candidate: null,
      streetBairroResolution,
      promotionSimulation,
      shadowConfidence,
      decisionSimulation,
      safetyGate,
    };
  }

  if (matchType === "MATCH_FORTE" && fallbackUsed) {
    matchType = "MATCH_FALLBACK";
  }
  if (matchType === "MATCH_FORTE" && lote?.fallbackUsed) {
    matchType = "MATCH_FALLBACK";
  }

  const confidence = makeConfidence(matchType, flags);
  const shadowForComparison: TrindadeShadowResult = {
    enabled: true,
    cityDetected: true,
    skipped: false,
    localFirstFound,
    matchType,
    confidence,
    matchedKey,
    matchedLayer,
    fallbackUsed,
    conflictWithHere: false,
    comparisonResult: "NO_LOCAL_CANDIDATE",
    comparison: null,
    reason: notes[0] || null,
    flags,
    notes,
    candidate,
    streetBairroResolution,
    promotionSimulation: null,
    shadowConfidence: null,
  };

  const comparison = compareTrindadeShadowWithCurrent(shadowForComparison, input.currentResult || null);
  const comparisonDetails: TrindadeShadowComparisonDetails = {
    currentStatus: input.currentResult?.status ?? null,
    currentSource: input.currentResult?.source ?? null,
    currentLat: Number.isFinite(Number(input.currentResult?.lat)) ? Number(input.currentResult?.lat) : null,
    currentLng: Number.isFinite(Number(input.currentResult?.lng)) ? Number(input.currentResult?.lng) : null,
    currentMatchedKey: input.currentResult?.matchedKey ?? null,
    comparisonResult: comparison.comparisonResult,
  };
  const promotionSimulation = buildPromotionSimulation({
    matchType,
    matchedLayer,
    streetBairroResolution,
    comparisonResult: comparison.comparisonResult,
    normalized,
  });
  const shadowConfidence = buildShadowConfidence(matchType, flags, streetBairroResolution, normalized);
  const shadow: TrindadeShadowResult = {
    ...shadowForComparison,
    promotionSimulation,
    shadowConfidence,
  };
  shadow.conflictWithHere = comparison.conflictWithHere;
  shadow.comparisonResult = comparison.comparisonResult;
  shadow.comparison = comparisonDetails;
  shadow.reason = candidate?.reason || shadow.reason || comparison.notes[0] || comparison.comparisonResult;
  shadow.notes = [...shadow.notes, ...comparison.notes];

  if (shadow.matchType === "MATCH_FALLBACK") {
    shadow.flags.fallbackUsed = true;
  }
  shadow.flags.conflictWithHere = shadow.conflictWithHere;
  shadow.flags.manualMemorySovereign = true;
  shadow.flags.currentResultPreserved = true;
  shadow.decisionSimulation = buildDecisionSimulation({
    cityDetected: true,
    localFirstFound,
    matchType,
    currentResult: input.currentResult || null,
    streetBairroResolution,
    promotionSimulation,
    comparisonResult: shadow.comparisonResult,
    conflictWithHere: shadow.conflictWithHere,
    matchedLayer: shadow.matchedLayer,
  });
  shadow.safetyGate = buildSafetyGate({
    cityDetected: true,
    decisionSimulation: shadow.decisionSimulation,
    promotionSimulation,
    streetBairroResolution,
    comparisonResult: shadow.comparisonResult,
    matchedLayer: shadow.matchedLayer,
    fallbackUsed,
    flags,
    currentResult: input.currentResult || null,
    normalized,
  });

  return shadow;
}

export function compareTrindadeShadowWithCurrent(
  shadow: TrindadeShadowResult,
  currentResult: TrindadeShadowInput["currentResult"],
) {
  return compareResultType(shadow, currentResult);
}
