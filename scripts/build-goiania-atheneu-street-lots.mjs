import fs from "node:fs";
import path from "node:path";
import RBush from "rbush";

const ROOT = process.cwd();
const LOTES = path.join(ROOT, "public", "data", "goiania_lotes.geojson");
const BAIRROS = path.join(ROOT, "public", "data", "goiania_bairros.geojson");
const REDE = path.join(ROOT, "public", "data", "goiania_redeviaria_full.geojson");
const OUTPUT = path.join(ROOT, "app", "data", "goiania_local_first_special", "atheneu-street-lots.json");

const ATHENEU_BAIRRO_ID = "000400000167";
const MAX_DISTANCE_M = 50;
const AMBIGUITY_GAP_M = 3;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function compact(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeText(value) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeStreet(value) {
  return normalizeText(value)
    .replace(/^(RUA|R)\s+/, "")
    .replace(/\b(UNID|UN|U)\b/g, "UNIDADE")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLot(value) {
  return normalizeText(value).replace(/^0+(\d+)$/, "$1");
}

function isGenericLotOrArea(value) {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (normalized === "-" || normalized === "S N" || normalized === "SN") return true;
  if (normalized.includes("APM") || normalized.includes("AREA")) return true;
  return !/\d/.test(normalized);
}

function isGenericQuadraArea(value) {
  const normalized = normalizeText(value);
  return normalized.includes("APM") || normalized.includes("AREA");
}

function ringCentroid(ring) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-12) return null;
  return [x / (3 * area), y / (3 * area)];
}

function centroid(geometry) {
  const polygon = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates[0];
  const outer = polygon[0];
  const center = ringCentroid(outer);
  if (center) return center;
  const points = outer.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

function bbox(polygon) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of polygon) {
    for (const [x, y] of ring) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  }
  return box;
}

function inRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(point, polygon) {
  if (!inRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((ring) => inRing(point, ring));
}

function lonLatToUtm31982(lng, lat) {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const lam0 = (-51 * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = ep2 * Math.cos(phi) ** 2;
  const bigA = Math.cos(phi) * (lam - lam0);
  const m =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x =
    500000 +
    k0 *
      n *
      (bigA +
        ((1 - t + c) * bigA ** 3) / 6 +
        ((5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * bigA ** 5) / 120);
  const y =
    10000000 +
    k0 *
      (m +
        n *
          Math.tan(phi) *
          (bigA ** 2 / 2 +
            ((5 - t + 9 * c + 4 * c ** 2) * bigA ** 4) / 24 +
            ((61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * bigA ** 6) / 720));
  return [x, y];
}

function distancePointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function streetLabel(properties) {
  const typed = [compact(properties?.tp_log), compact(properties?.nm_log)].filter(Boolean).join(" ");
  return typed || compact(properties?.nm) || null;
}

function buildStreetIndex(rede) {
  const index = new RBush();
  for (const feature of rede.features) {
    if (String(feature.properties?.id_bai || "") !== ATHENEU_BAIRRO_ID) continue;
    const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        index.insert({
          minX: Math.min(a[0], b[0]),
          minY: Math.min(a[1], b[1]),
          maxX: Math.max(a[0], b[0]),
          maxY: Math.max(a[1], b[1]),
          a,
          b,
          properties: feature.properties,
        });
      }
    }
  }
  return index;
}

function nearestStreets(index, lng, lat) {
  const [x, y] = lonLatToUtm31982(lng, lat);
  let candidates = [];
  for (const radius of [30, 80, 120, 250]) {
    candidates = index.search({
      minX: x - radius,
      minY: y - radius,
      maxX: x + radius,
      maxY: y + radius,
    });
    if (candidates.length) break;
  }

  return candidates
    .map((candidate) => ({
      label: streetLabel(candidate.properties),
      key: normalizeStreet(streetLabel(candidate.properties)),
      distance: distancePointSegment(x, y, candidate.a[0], candidate.a[1], candidate.b[0], candidate.b[1]),
      properties: candidate.properties,
    }))
    .filter((candidate) => candidate.label && candidate.key.includes("UNIDADE"))
    .sort((a, b) => a.distance - b.distance);
}

const bairros = readJson(BAIRROS);
const atheneu = bairros.features.find((feature) => String(feature.properties?.id || "") === ATHENEU_BAIRRO_ID);
if (!atheneu) throw new Error("Poligono do bairro Atheneu nao encontrado.");

const atheneuPolygons = (atheneu.geometry.type === "Polygon" ? [atheneu.geometry.coordinates] : atheneu.geometry.coordinates).map(
  (polygon) => ({ polygon, bbox: bbox(polygon) }),
);
const lotes = readJson(LOTES);
const streetIndex = buildStreetIndex(readJson(REDE));

const keys = {};
const stats = {
  totalLotes: 0,
  outsideAtheneu: 0,
  withoutSafeLot: 0,
  genericAreaCandidate: 0,
  withoutUnitStreet: 0,
  lowAssociationConfidence: 0,
  ambiguousAssociation: 0,
  indexed: 0,
};
const streets = new Set();

for (let sourceIndex = 0; sourceIndex < lotes.features.length; sourceIndex++) {
  const feature = lotes.features[sourceIndex];
  const [lng, lat] = centroid(feature.geometry);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  stats.totalLotes++;

  const inAtheneu = atheneuPolygons.some(
    (item) =>
      lng >= item.bbox[0] &&
      lng <= item.bbox[2] &&
      lat >= item.bbox[1] &&
      lat <= item.bbox[3] &&
      inPolygon([lng, lat], item.polygon),
  );
  if (!inAtheneu) {
    stats.outsideAtheneu++;
    continue;
  }

  const quadra = compact(feature.properties?.nm_qdr);
  const lot = compact(feature.properties?.nm_lot);
  if (isGenericLotOrArea(lot)) {
    stats.withoutSafeLot++;
    continue;
  }
  if (isGenericQuadraArea(quadra)) {
    stats.genericAreaCandidate++;
    continue;
  }

  const nearest = nearestStreets(streetIndex, lng, lat);
  if (!nearest.length) {
    stats.withoutUnitStreet++;
    continue;
  }

  const winner = nearest[0];
  if (winner.distance > MAX_DISTANCE_M) {
    stats.lowAssociationConfidence++;
    continue;
  }
  const competitor = nearest.find((candidate) => candidate.key !== winner.key);
  if (competitor && competitor.distance - winner.distance < AMBIGUITY_GAP_M) {
    stats.ambiguousAssociation++;
    continue;
  }

  const lotKey = normalizeLot(lot);
  const key = `${winner.key}|${lotKey}`;
  const item = {
    street: winner.label,
    streetKey: winner.key,
    lot,
    lotKey,
    lat: Math.round(lat * 1e7) / 1e7,
    lng: Math.round(lng * 1e7) / 1e7,
    distanceToStreetM: Math.round(winner.distance * 100) / 100,
    confidence: "HIGH",
    sourceIndex,
  };
  keys[key] = [...(keys[key] || []), item];
  streets.add(winner.key);
  stats.indexed++;
}

const payload = {
  metadata: {
    version: 1,
    city: "Goiânia",
    bairroKey: "ATHENEU",
    bairroLabel: "Atheneu",
    indexType: "street_lot",
    source: {
      lotes: path.relative(ROOT, LOTES).replaceAll("\\", "/"),
      rede: path.relative(ROOT, REDE).replaceAll("\\", "/"),
    },
    generatedAt: new Date().toISOString(),
    maxDistanceM: MAX_DISTANCE_M,
    ambiguityGapM: AMBIGUITY_GAP_M,
    totalKeys: Object.keys(keys).length,
    totalCandidates: Object.values(keys).reduce((sum, candidates) => sum + candidates.length, 0),
    totalUnitStreets: streets.size,
    stats,
  },
  keys: Object.fromEntries(Object.entries(keys).sort(([a], [b]) => a.localeCompare(b))),
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(payload)}\n`, "utf8");
console.log(JSON.stringify(payload.metadata, null, 2));
