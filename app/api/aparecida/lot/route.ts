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
  missing?: boolean; // ✅ novo
} = {};

// =====================
// Helpers: flip coords se estiver invertido
// =====================
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
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;

  const xLooksLat = a > -25 && a < -10; // -16.xxx
  const yLooksLng = b > -52 && b < -46; // -49.xxx

  return xLooksLat && yLooksLng;
}

// =====================
// Carrega e indexa 1x (sem quebrar o app se faltar arquivo)
// =====================
function loadAparecida() {
  // ✅ se já detectou que está faltando, não fica tentando toda hora
  if (cached.missing) return cached;

  if (cached.geo && cached.tree) return cached;

  // ✅ tenta mais de 1 nome (caso você tenha renomeado)
  const candidates = [
    path.join(process.cwd(), "public", "data", "aparecida_lotes.geojson"),
    path.join(process.cwd(), "public", "data", "aparecida_lotes.geojson"),
  ];

  const filePath = candidates.find((p) => fs.existsSync(p));

  // ✅ NÃO dá throw aqui (isso que causava 500 em loop)
  if (!filePath) {
    cached.missing = true;
    cached.geo = undefined;
    cached.tree = undefined;
    cached.filePath = candidates[0]; // só pra log/debug
    return cached;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  let geo = JSON.parse(raw) as FeatureCollection;

  if (geo.type !== "FeatureCollection" || !Array.isArray(geo.features)) {
    // ✅ se for inválido, marca como missing pra não ficar quebrando
    cached.missing = true;
    return cached;
  }

  // ✅ Corrige 1 vez se estiver invertido
  if (looksSwapped(geo)) {
    geo = {
      type: "FeatureCollection",
      features: (geo.features || []).map((f) => ({
        ...f,
        geometry: flipGeometry(f.geometry),
      })),
    };
  }

  // ✅ Recria o índice (tree)
  const tree = new RBush<RTreeItem>();
  const items: RTreeItem[] = [];

  for (let i = 0; i < geo.features.length; i++) {
    const f = geo.features[i];
    if (!f?.geometry) continue;

    try {
      const [minX, minY, maxX, maxY] = bbox(f as any);
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;
      items.push({ minX, minY, maxX, maxY, i });
    } catch {
      // ignora feature quebrada
    }
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
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

// =====================
// GET /api/aparecida/lot?lat=-16.7&lng=-49.3
// =====================
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "lat/lng inválidos" }, { status: 400 });
    }

    const { geo, tree, missing, filePath } = loadAparecida();

    // ✅ se não tem geojson, não quebra: só responde "não encontrado"
    if (missing || !geo || !tree) {
      return NextResponse.json({
        found: false,
        reason: "NO_GEOJSON",
        expectedPath: filePath || path.join(process.cwd(), "public", "data", "aparecida_lotes.geojson"),
      });
    }

    const candidates = tree.search({
      minX: lng,
      minY: lat,
      maxX: lng,
      maxY: lat,
    });

    if (!candidates.length) {
      return NextResponse.json({ found: false });
    }

    const pt = point([lng, lat]);
    const ptBuffer = buffer(pt, 2, { units: "meters" });

    for (const c of candidates) {
      const f = geo.features[c.i];
      if (!f) continue;

      try {
        if (booleanIntersects(ptBuffer as any, f as any)) {
          const p = f.properties || {};

          const quadra = pickFirstString(p, ["quadra", "num_qdr", "NUM_QDR", "QD", "qd"]);
          const lote = pickFirstString(p, ["lote", "num_lot", "NUM_LOT", "LT", "lt"]);
          const bairro = pickFirstString(p, ["bairro", "nm_bai", "NM_BAI", "BAIRRO", "setor", "SETOR"]);

          return NextResponse.json({
            found: true,
            quadra,
            lote,
            bairro,
          });
        }
      } catch {
        // ignora feature problemática
      }
    }

    return NextResponse.json({ found: false });
  } catch (err: any) {
    // ✅ mesmo erro interno: responde ok sem derrubar o app
    return NextResponse.json({
      found: false,
      reason: "INTERNAL_ERROR",
      error: err?.message || "Erro interno",
    });
  }
}