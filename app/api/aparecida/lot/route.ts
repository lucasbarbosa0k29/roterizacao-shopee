import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import RBush from "rbush";

import bbox from "@turf/bbox";
import buffer from "@turf/buffer";
import booleanIntersects from "@turf/boolean-intersects";
import { point } from "@turf/helpers";

export const runtime = "nodejs";

/* =====================
   TYPES
===================== */
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

/* =====================
   CACHE GLOBAL
===================== */
let cached: {
  geo?: FeatureCollection;
  tree?: RBush<RTreeItem>;
  filePath?: string;
  missing?: boolean;
} = {};

// 🔥 CACHE DE RESULTADOS (QUADRA / LOTE)
const arcgisResultCache = new Map<string, any>();

function coordCacheKey(lat: number, lng: number) {
  // ~30–40 metros
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/* =====================
   COORD HELPERS
===================== */
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

/* =====================
   LOAD GEOJSON (1x)
===================== */
function loadAparecida() {
  if (cached.missing) return cached;
  if (cached.geo && cached.tree) return cached;

  const candidates = [
    path.join(process.cwd(), "public", "data", "aparecida_lotes.geojson"),
  ];

  const filePath = candidates.find((p) => fs.existsSync(p));

  if (!filePath) {
    cached.missing = true;
    return cached;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  let geo = JSON.parse(raw) as FeatureCollection;

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
    try {
      const [minX, minY, maxX, maxY] = bbox(geo.features[i] as any);
      items.push({ minX, minY, maxX, maxY, i });
    } catch {}
  }

  tree.load(items);

  cached.geo = geo;
  cached.tree = tree;
  cached.filePath = filePath;
  cached.missing = false;

  return cached;
}

function pickFirstString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/* =====================
   GET /api/aparecida/lot
===================== */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ found: false });
    }

    // 🔥 CACHE POR BLOCO
    const cacheKey = coordCacheKey(lat, lng);
    if (arcgisResultCache.has(cacheKey)) {
      return NextResponse.json({
        ...arcgisResultCache.get(cacheKey),
        cached: true,
      });
    }

    const { geo, tree, missing } = loadAparecida();
    if (missing || !geo || !tree) {
      return NextResponse.json({ found: false });
    }

    const candidates = tree.search({
      minX: lng,
      minY: lat,
      maxX: lng,
      maxY: lat,
    });

    if (!candidates.length) {
      arcgisResultCache.set(cacheKey, { found: false });
      return NextResponse.json({ found: false });
    }

    const pt = point([lng, lat]);
    const ptBuffer = buffer(pt, 2, { units: "meters" });

    for (const c of candidates) {
      const f = geo.features[c.i];
      if (!f) continue;

      if (booleanIntersects(ptBuffer as any, f as any)) {
        const p = f.properties || {};

        const result = {
          found: true,
          quadra: pickFirstString(p, ["quadra", "num_qdr", "NUM_QDR", "QD"]),
          lote: pickFirstString(p, ["lote", "num_lot", "NUM_LOT", "LT"]),
          bairro: pickFirstString(p, ["bairro", "nm_bai", "NM_BAI", "SETOR"]),
        };

        arcgisResultCache.set(cacheKey, result);
        return NextResponse.json({ ...result, cached: false });
      }
    }

    arcgisResultCache.set(cacheKey, { found: false });
    return NextResponse.json({ found: false });
  } catch {
    return NextResponse.json({ found: false });
  }
}