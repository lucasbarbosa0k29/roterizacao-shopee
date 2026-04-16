import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import RBush from "rbush";

import bbox from "@turf/bbox";
import buffer from "@turf/buffer";
import booleanIntersects from "@turf/boolean-intersects";
import { point } from "@turf/helpers";

export const runtime = "nodejs";

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

let cached: {
  geo?: FeatureCollection;
  tree?: RBush<RTreeItem>;
  filePath?: string;
  missing?: boolean;
} = {};

const gynLotCache = new Map<string, any>();

function coordCacheKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
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

function loadGoiania() {
  if (cached.missing) return cached;
  if (cached.geo && cached.tree) return cached;

  const candidates = [
    path.join(process.cwd(), "public", "data", "goiania_lotes.geojson"),
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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "lat/lng inválidos" }, { status: 400 });
    }

    const cacheKey = coordCacheKey(lat, lng);
    if (gynLotCache.has(cacheKey)) {
      return NextResponse.json({
        ok: true,
        lat,
        lng,
        ...gynLotCache.get(cacheKey),
        cached: true,
      });
    }

    const { geo, tree, missing } = loadGoiania();
    if (missing || !geo || !tree) {
      return NextResponse.json({
        ok: true,
        lat,
        lng,
        quadra: "",
        lote: "",
        bairro: "",
        raw: { hasFeature: false, missing: true },
      });
    }

    const candidates = tree.search({
      minX: lng,
      minY: lat,
      maxX: lng,
      maxY: lat,
    });

    if (!candidates.length) {
      const result = {
        quadra: "",
        lote: "",
        bairro: "",
        raw: { hasFeature: false },
      };
      gynLotCache.set(cacheKey, result);
      return NextResponse.json({ ok: true, lat, lng, ...result, cached: false });
    }

    const pt = point([lng, lat]);
    const ptBuffer = buffer(pt, 2, { units: "meters" });

    for (const c of candidates) {
      const f = geo.features[c.i];
      if (!f) continue;

      if (booleanIntersects(ptBuffer as any, f as any)) {
        const p = f.properties || {};

        const result = {
          quadra: pickFirstString(p, [
            "nm_qdr",
            "quadra",
            "QUADRA",
            "ci_qdr",
            "CI_QDR",
            "qd",
            "QD",
            "num_qdr",
            "NUM_QDR",
          ]),
          lote: pickFirstString(p, [
            "nm_lot",
            "lote",
            "LOTE",
            "ci_lot",
            "CI_LOT",
            "lt",
            "LT",
            "num_lot",
            "NUM_LOT",
          ]),
          bairro: pickFirstString(p, [
            "bairro",
            "BAIRRO",
            "nm_bai",
            "NM_BAI",
            "setor",
            "SETOR",
          ]),
          raw: { hasFeature: true },
        };

        gynLotCache.set(cacheKey, result);
        return NextResponse.json({ ok: true, lat, lng, ...result, cached: false });
      }
    }

    const result = {
      quadra: "",
      lote: "",
      bairro: "",
      raw: { hasFeature: false },
    };
    gynLotCache.set(cacheKey, result);
    return NextResponse.json({ ok: true, lat, lng, ...result, cached: false });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Erro no proxy Goiânia", details: String(e) },
      { status: 500 }
    );
  }
}
