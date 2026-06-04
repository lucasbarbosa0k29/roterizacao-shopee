import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CURRENT_PATH = path.join(ROOT, "public", "data", "aparecida_lot_centroids.json");
const SOURCE_PATH = path.join(ROOT, "public", "data", "raw", "lotes_aparecidafinal.geojson");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "aparecida_lot_centroids_with_street.json");
const DEGREE_TO_METERS = 111320;

function normalizeKey(value) {
  return String(value ?? "")
    .replace(/\uFFFD/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLotQuadra(value) {
  return normalizeKey(value).replace(/^0+(?=\d)/, "");
}

function compactSpaces(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function hasText(value) {
  return compactSpaces(value) !== "";
}

function buildStreetFullName(properties) {
  const type = compactSpaces(properties?.tp_log);
  const name = compactSpaces(properties?.nm_log);
  const complement = compactSpaces(properties?.nm_compl);
  const typedName = [type, name].filter(hasText).join(" ").trim();

  if (hasText(typedName)) return typedName.replace(/\s+/g, " ");
  if (hasText(complement)) return complement.replace(/\s+/g, " ");
  return "";
}

function convertNearDist(value) {
  const nearDist = Number(value);
  if (!Number.isFinite(nearDist) || nearDist < 0) return null;
  return Math.round(nearDist * DEGREE_TO_METERS * 100) / 100;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateRecord(index, current, sourceProperties) {
  const checks = [
    {
      label: "bairro",
      current: normalizeKey(current?.bairro),
      source: normalizeKey(sourceProperties?.nm_bai),
      rawCurrent: current?.bairro,
      rawSource: sourceProperties?.nm_bai,
    },
    {
      label: "quadra",
      current: normalizeLotQuadra(current?.quadra),
      source: normalizeLotQuadra(sourceProperties?.num_qdr),
      rawCurrent: current?.quadra,
      rawSource: sourceProperties?.num_qdr,
    },
    {
      label: "lote",
      current: normalizeLotQuadra(current?.lote),
      source: normalizeLotQuadra(sourceProperties?.num_lot),
      rawCurrent: current?.lote,
      rawSource: sourceProperties?.num_lot,
    },
  ];

  const mismatch = checks.find((check) => check.current !== check.source);
  if (!mismatch) return;

  throw new Error(
    [
      `Structural validation failed at index ${index}.`,
      `Field: ${mismatch.label}`,
      `Current: ${JSON.stringify(mismatch.rawCurrent)} -> ${mismatch.current}`,
      `Source: ${JSON.stringify(mismatch.rawSource)} -> ${mismatch.source}`,
    ].join("\n"),
  );
}

const current = readJson(CURRENT_PATH);
const source = readJson(SOURCE_PATH);

if (!Array.isArray(current)) {
  throw new Error("Current centroid base must be an array.");
}

const features = Array.isArray(source?.features) ? source.features : null;
if (!features) {
  throw new Error("Source GeoJSON must contain a features array.");
}

if (current.length !== features.length) {
  throw new Error(
    `Record count mismatch: current=${current.length}, source=${features.length}`,
  );
}

const enriched = [];
const streetCounts = new Map();
let streetFilled = 0;
let nearDistNull = 0;

for (let i = 0; i < current.length; i++) {
  const record = current[i];
  const properties = features[i]?.properties || {};

  validateRecord(i, record, properties);

  const streetFullName = buildStreetFullName(properties);
  const nearDist = convertNearDist(properties.NEAR_DIST);

  if (streetFullName) {
    streetFilled++;
    streetCounts.set(streetFullName, (streetCounts.get(streetFullName) || 0) + 1);
  }
  if (nearDist === null) nearDistNull++;

  enriched.push({
    bairro: record.bairro,
    quadra: record.quadra,
    lote: record.lote,
    lat: record.lat,
    lng: record.lng,
    streetFullName,
    nearDist,
  });
}

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(enriched)}\n`, "utf8");

const outputStats = fs.statSync(OUTPUT_PATH);
const top20Ruas = [...streetCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 20)
  .map(([streetFullName, count]) => ({ streetFullName, count }));

const sampleIndexes = [
  0,
  1,
  2,
  3,
  4,
  1000,
  5000,
  10000,
  25000,
  50000,
  75000,
  100000,
  125000,
  150000,
  175000,
  200000,
  current.length - 4,
  current.length - 3,
  current.length - 2,
  current.length - 1,
].filter((index) => index >= 0 && index < enriched.length);

const samples = sampleIndexes.map((index) => ({
  index,
  bairro: enriched[index].bairro,
  quadra: enriched[index].quadra,
  lote: enriched[index].lote,
  lat: enriched[index].lat,
  lng: enriched[index].lng,
  streetFullName: enriched[index].streetFullName,
  nearDist: enriched[index].nearDist,
}));

console.log(
  JSON.stringify(
    {
      outputPath: path.relative(ROOT, OUTPUT_PATH),
      outputBytes: outputStats.size,
      outputMB: Math.round((outputStats.size / 1024 / 1024) * 100) / 100,
      records: enriched.length,
      streetFullNameFilled: streetFilled,
      streetFullNameFilledPct: Math.round((streetFilled / enriched.length) * 10000) / 100,
      nearDistNull,
      nearDistNullPct: Math.round((nearDistNull / enriched.length) * 10000) / 100,
      top20Ruas,
      samples,
    },
    null,
    2,
  ),
);
