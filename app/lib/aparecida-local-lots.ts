import fs from "fs";
import path from "path";

import RBush from "rbush";
import bbox from "@turf/bbox";
import buffer from "@turf/buffer";
import booleanIntersects from "@turf/boolean-intersects";
import { point } from "@turf/helpers";

type Feature = {
  type: "Feature";
  geometry: any;
  properties?: Record<string, any>;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

type RTreeItem = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  i: number;
};

type LoadedDataset = {
  geo?: FeatureCollection;
  tree?: RBush<RTreeItem>;
  filePath?: string;
  missing?: boolean;
  disabled?: boolean;
};

type CentroidRecord = {
  bairro: string;
  quadra: string;
  lote: string;
  lat: number;
  lng: number;
};

type LoadedCentroids = {
  records?: CentroidRecord[];
  index?: Map<string, number[]>;
  missing?: boolean;
  disabled?: boolean;
};

export type AparecidaLocalLotCandidate = {
  quadra: string;
  lote: string;
  bairro: string;
  centroid: { lat: number; lng: number };
  strongMatch: true;
};

const dataset: LoadedDataset = {};
const centroids: LoadedCentroids = {};
const coordinateCache = new Map<string, any>();

function disableDataset(reason: string, error?: unknown) {
  dataset.disabled = true;
  console.error("[APARECIDA_LOCAL_LOTS_DISABLED]", {
    reason,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  });
  return dataset;
}

function disableCentroids(reason: string, error?: unknown) {
  centroids.disabled = true;
  console.error("[APARECIDA_LOCAL_CENTROIDS_DISABLED]", {
    reason,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  });
  return centroids;
}

function normalizeText(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalLot(value: string) {
  let t = String(value || "")
    .toUpperCase()
    .trim()
    .replace(/^[\s\-:]+|[\s\-:]+$/g, "")
    .replace(/[^A-Z0-9\-]/g, "");

  if (/^\d/.test(t)) {
    const compact = t.replace(/-/g, "");
    const m = compact.match(/^0*(\d+)([A-Z][A-Z0-9]*)?$/);
    if (m) return `${String(Number(m[1]))}${m[2] || ""}`;
    if (/^\d+$/.test(compact)) return String(Number(compact));
    return compact;
  }

  const m = t.match(/^0*(\d+)([A-Z][A-Z0-9\-]*)?$/);
  if (m) return `${String(Number(m[1]))}${m[2] || ""}`;

  if (/^\d+$/.test(t)) return String(Number(t));
  return t;
}

function normalizeQuadraLoteValue(value: string) {
  return canonicalLot(value);
}

function normalizeBairroValue(value: string) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function bairroCompatible(expected: string, actual: string) {
  const left = normalizeBairroValue(expected);
  const right = normalizeBairroValue(actual);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const leftTokens = left.split(" ").filter((t) => t.length >= 4);
  const rightTokens = right.split(" ").filter((t) => t.length >= 4);

  return leftTokens.some((token) => rightTokens.includes(token));
}

function coordCacheKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function looksSwapped(geo: FeatureCollection) {
  const f = geo.features?.find((x) => x?.geometry?.coordinates);
  if (!f) return false;

  const c = f.geometry.coordinates;
  const sample =
    Array.isArray(c?.[0]?.[0]) ? c[0][0] :
    Array.isArray(c?.[0]?.[0]?.[0]) ? c[0][0][0] :
    c?.[0];

  if (!Array.isArray(sample) || sample.length < 2) return false;

  const a = Number(sample[0]);
  const b = Number(sample[1]);

  const xLooksLat = a > -25 && a < -10;
  const yLooksLng = b > -52 && b < -46;

  return xLooksLat && yLooksLng;
}

function flipCoordsDeep(coords: any): any {
  if (!Array.isArray(coords)) return coords;

  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    return [coords[1], coords[0], ...coords.slice(2)];
  }

  return coords.map(flipCoordsDeep);
}

function flipGeometry(geom: any) {
  if (!geom) return geom;
  return { ...geom, coordinates: flipCoordsDeep(geom.coordinates) };
}

function loadAparecidaDataset() {
  if (dataset.missing || dataset.disabled) return dataset;
  if (dataset.geo && dataset.tree) return dataset;

  const filePath = path.join(process.cwd(), "public", "data", "aparecida_lotes.min.geojson");
  if (!fs.existsSync(filePath)) {
    dataset.missing = true;
    return dataset;
  }

  try {
    const parsed = (() => {
      const raw = fs.readFileSync(filePath, "utf8");
      if (raw.trimStart().startsWith("version https://git-lfs.github.com/spec")) {
        return { reason: "GIT_LFS_POINTER" } as const;
      }

      try {
        return { geo: JSON.parse(raw) as FeatureCollection } as const;
      } catch (error) {
        return { reason: "INVALID_JSON", error } as const;
      }
    })();

    if ("reason" in parsed) {
      return disableDataset(parsed.reason || "LOAD_FAILED", "error" in parsed ? parsed.error : undefined);
    }

    let geo = parsed.geo;

    if (geo?.type !== "FeatureCollection" || !Array.isArray(geo.features)) {
      return disableDataset("INVALID_FEATURE_COLLECTION");
    }

    if (looksSwapped(geo)) {
      geo = {
        type: "FeatureCollection",
        features: geo.features.map((f) => ({
          ...f,
          geometry: flipGeometry(f.geometry),
        })),
      };
    }

    const tree = new RBush<RTreeItem>();
    const items: RTreeItem[] = [];

    for (let i = 0; i < geo.features.length; i++) {
      const feature = geo.features[i];
      try {
        const [minX, minY, maxX, maxY] = bbox(feature as any);
        items.push({ minX, minY, maxX, maxY, i });
      } catch {}
    }

    tree.load(items);

    dataset.geo = geo;
    dataset.tree = tree;
    dataset.filePath = filePath;
    dataset.missing = false;

    return dataset;
  } catch (error) {
    return disableDataset("LOAD_FAILED", error);
  }
}

function loadAparecidaCentroids() {
  if (centroids.missing || centroids.disabled) return centroids;
  if (centroids.records && centroids.index) return centroids;

  const filePath = path.join(process.cwd(), "public", "data", "aparecida_lot_centroids.json");
  if (!fs.existsSync(filePath)) {
    centroids.missing = true;
    return centroids;
  }

  try {
    const records = (() => {
      const raw = fs.readFileSync(filePath, "utf8");
      if (raw.trimStart().startsWith("version https://git-lfs.github.com/spec")) {
        return null;
      }
      return JSON.parse(raw) as CentroidRecord[];
    })();
    if (!records) return disableCentroids("GIT_LFS_POINTER");
    if (!Array.isArray(records)) return disableCentroids("INVALID_JSON_STRUCTURE");

    const index = new Map<string, number[]>();
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (
        !record ||
        !Number.isFinite(record.lat) ||
        !Number.isFinite(record.lng)
      ) {
        return disableCentroids("INVALID_RECORD");
      }

      const q = normalizeQuadraLoteValue(record.quadra);
      const l = canonicalLot(record.lote);
      if (!q || !l) continue;

      const key = `${q}__${l}`;
      const bucket = index.get(key) || [];
      bucket.push(i);
      index.set(key, bucket);
    }

    centroids.records = records;
    centroids.index = index;
    return centroids;
  } catch (error) {
    return disableCentroids("LOAD_FAILED", error);
  }
}

function pickFirstString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function polygonCentroid(ring: number[][]) {
  if (!Array.isArray(ring) || ring.length < 3) return null;

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i] || [];
    const [x2, y2] = ring[i + 1] || [];
    if (![x1, y1, x2, y2].every((n) => Number.isFinite(Number(n)))) continue;

    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }

  if (!twiceArea) return null;
  const area = twiceArea / 2;
  return {
    lng: cx / (6 * area),
    lat: cy / (6 * area),
  };
}

function geometryCentroid(geometry: any): { lat: number; lng: number } | null {
  if (!geometry?.coordinates) return null;

  const coords = geometry.coordinates;
  const candidates: any[] = [];

  if (geometry.type === "Polygon" && Array.isArray(coords)) {
    candidates.push(coords);
  } else if (geometry.type === "MultiPolygon" && Array.isArray(coords)) {
    for (const poly of coords) {
      if (Array.isArray(poly)) candidates.push(poly);
    }
  } else {
    return null;
  }

  let best: { lat: number; lng: number } | null = null;
  let bestAbsArea = 0;

  for (const poly of candidates) {
    const outer: any[] = poly?.[0];
    if (!Array.isArray(outer)) continue;
    const centroid = polygonCentroid(outer as number[][]);
    if (centroid) {
      const area = Math.abs(
        (outer as any[]).reduce((acc, cur, idx) => {
          if (idx === outer.length - 1) return acc;
          const [x1, y1] = outer[idx] || [];
          const [x2, y2] = outer[idx + 1] || [];
          return acc + (x1 * y2 - x2 * y1);
        }, 0),
      );
      if (area > bestAbsArea) {
        best = centroid;
        bestAbsArea = area;
      }
    }
  }

  if (best) return best;

  try {
    const [minX, minY, maxX, maxY] = bbox({ type: "Feature", geometry } as any);
    return {
      lng: (minX + maxX) / 2,
      lat: (minY + maxY) / 2,
    };
  } catch {
    return null;
  }
}

export function lookupAparecidaLotByCoordinates(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { found: false as const };
  }

  const cacheKey = coordCacheKey(lat, lng);
  if (coordinateCache.has(cacheKey)) {
    return { ...coordinateCache.get(cacheKey), cached: true };
  }

  const { geo, tree, missing } = loadAparecidaDataset();
  if (missing || !geo || !tree) {
    return { found: false as const };
  }

  const candidates = tree.search({
    minX: lng,
    minY: lat,
    maxX: lng,
    maxY: lat,
  });

  if (!candidates.length) {
    coordinateCache.set(cacheKey, { found: false });
    return { found: false as const };
  }

  const pt = point([lng, lat]);
  const ptBuffer = buffer(pt, 2, { units: "meters" });

  for (const c of candidates) {
    const f = geo.features[c.i];
    if (!f) continue;

    if (booleanIntersects(ptBuffer as any, f as any)) {
      const p = f.properties || {};
      const result = {
        found: true as const,
        quadra: pickFirstString(p, ["quadra", "num_qdr", "NUM_QDR", "QD"]),
        lote: pickFirstString(p, ["lote", "num_lot", "NUM_LOT", "LT"]),
        bairro: pickFirstString(p, ["bairro", "nm_bai", "NM_BAI", "SETOR"]),
      };

      coordinateCache.set(cacheKey, result);
      return { ...result, cached: false };
    }
  }

  coordinateCache.set(cacheKey, { found: false });
  return { found: false as const };
}

export function findAparecidaLocalLotCandidate(args: {
  quadra: string;
  lote: string;
  bairro: string;
  rua?: string;
  cidade?: string;
  cep?: string;
}) {
  const q = normalizeQuadraLoteValue(args.quadra || "");
  const l = canonicalLot(args.lote || "");
  const bairro = String(args.bairro || "").trim();

  if (!q || !l || !bairro) return null;

  const { records, index, missing } = loadAparecidaCentroids();
  if (missing || !records || !index) return null;

  const bucket = index.get(`${q}__${l}`);
  if (!bucket || !bucket.length) return null;

  const candidates = bucket
    .map((recordIndex) => {
      const record = records[recordIndex];
      if (!record) return null;
      const featureBairro = record.bairro;
      if (!bairroCompatible(bairro, featureBairro)) return null;
      return {
        quadra: normalizeQuadraLoteValue(record.quadra),
        lote: canonicalLot(record.lote),
        bairro: featureBairro,
        centroid: { lat: record.lat, lng: record.lng },
        strongMatch: true as const,
      } as AparecidaLocalLotCandidate;
    })
    .filter(Boolean) as AparecidaLocalLotCandidate[];

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const ba = normalizeBairroValue(a.bairro);
    const bb = normalizeBairroValue(b.bairro);
    const target = normalizeBairroValue(bairro);
    const aExact = ba === target ? 1 : 0;
    const bExact = bb === target ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return 0;
  });

  return candidates[0];
}
