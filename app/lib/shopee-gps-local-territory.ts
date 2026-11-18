import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { MultiPolygon, Polygon } from "geojson";
import { checkAparecidaStreetGeometry, checkStreetGeometry, polygonEdgeDistance } from "@/app/lib/aparecida-territory";
import { normalizeStreetText } from "@/app/lib/street-normalization";

type City = "goiania" | "trindade";
type Layer = "bairros" | "ruas" | "lotes";
type Bounds = [number, number, number, number];
type Position = { lat: number; lng: number };
type Street = NonNullable<Parameters<typeof checkStreetGeometry>[3]>[number];
type PolygonRow<T> = [T, Bounds, Polygon["type"] | MultiPolygon["type"], Polygon["coordinates"] | MultiPolygon["coordinates"]];
type StreetRow = [string, Bounds, Street["geometry"]["type"], Street["geometry"]["coordinates"]];
type Manifest = Record<Layer, { names: string[]; blocks: Record<string, [number, number]> }>;

const root = () => path.join(process.cwd(), "data", "localfirst", "shopee-gps-territory");
const manifests = new Map<City, Manifest | null>();
const tiles = new Map<string, unknown[] | null>();
const reported = new Set<string>();

function reportUnavailable(key: string) {
  if (reported.has(key)) return;
  reported.add(key);
  console.warn("[SHOPEE_GPS_ASSETS_UNAVAILABLE]", { key, action: "fall_back_without_missing_evidence" });
}

function manifest(city: City) {
  if (!manifests.has(city)) {
    let result: Manifest | null = null;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root(), city + ".json"), "utf8"));
      if (raw.version !== 1 || !fs.existsSync(path.join(root(), city + ".pack"))) throw new Error("missing pack");
      result = {
        bairros: { names: raw.layers.bairros.names, blocks: raw.layers.bairros.blocks },
        ruas: { names: raw.layers.ruas.names, blocks: raw.layers.ruas.blocks },
        lotes: { names: raw.layers.lotes.names, blocks: raw.layers.lotes.blocks },
      };
    } catch {
      reportUnavailable(city);
    }
    manifests.set(city, result);
  }
  return manifests.get(city) ?? null;
}

function readTile<T>(city: City, layer: Layer, x: number, y: number): T[] | null {
  const cell = `${x}_${y}`;
  const data = manifest(city);
  if (!data) return null;
  if (!Object.hasOwn(data[layer].blocks, cell)) return [];
  const key = `${city}/${layer}/${cell}`;
  if (!tiles.has(key)) {
    let parsed: unknown[] | null = null;
    try {
      const [offset, length] = data[layer].blocks[cell];
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0 || length > 4_000_000) {
        throw new Error("invalid block");
      }
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(path.join(root(), city + ".pack"), "r");
      try {
        if (fs.readSync(fd, buffer, 0, length, offset) !== length) throw new Error("incomplete pack");
      } finally {
        fs.closeSync(fd);
      }
      const value = JSON.parse(gunzipSync(buffer, { maxOutputLength: 4_000_000 }).toString("utf8"));
      if (!Array.isArray(value)) throw new Error("invalid JSON tile");
      parsed = value;
    } catch {
      reportUnavailable(city + "/" + layer);
    }
    if (tiles.size >= 48) tiles.delete(tiles.keys().next().value!);
    tiles.set(key, parsed);
  }
  return tiles.get(key) as T[] | null;
}

const cellAt = (coordinate: number, cell: number) => Math.floor(coordinate / cell);
function bairroKey(city: City, value: string) {
  const key = normalizeStreetText(value)
    .replace(/^JD /, "JARDIM ").replace(/^ST /, "SETOR ")
    .replace(/^VL /, "VILA ").replace(/^PQ /, "PARQUE ").replace(/^RES /, "RESIDENCIAL ")
    .replace(/^CJ /, "CONJUNTO ");
  if (city !== "trindade") return key;
  // These names point to the exact WFS polygons and retain the cadastral phase.
  return key.replace(/^RESIDENCIAL (ALTO DO CERRADO (?:I|II))$/, "$1")
    .replace(/^(?:COND|CONDOMINIO) (PARQVILLE QUARESMEIRA)$/, "$1");
}

function contains<T>([label, [west, south, east, north], type, coordinates]: PolygonRow<T>, { lng, lat }: Position) {
  if (lng < west || lng > east || lat < south || lat > north) return null;
  return booleanPointInPolygon([lng, lat], { type, coordinates } as Polygon | MultiPolygon,
    { ignoreBoundary: true }) ? label : null;
}

export function findLocalShopeeBairro(city: City, bairro: string, position: Position) {
  const data = manifest(city);
  const key = bairroKey(city, bairro);
  const known = !!key && !!data?.bairros.names.some(name => bairroKey(city, name) === key);
  const features = readTile<PolygonRow<string>>(city, "bairros", cellAt(position.lng, .01), cellAt(position.lat, .01));
  const hits = (features ?? []).filter(row => contains(row, position) !== null);
  const names = new Set(hits.map(row => bairroKey(city, row[0])));
  const edgeDistanceM = hits.length === 1 ? polygonEdgeDistance(position, {
    type: hits[0][2], coordinates: hits[0][3],
  }) : null;
  return { known, matched: names.size === 1 && names.has(key), actualNames: [...names], positionCovered: names.size === 1,
    edgeDistanceM };
}

export function findLocalShopeeParcel(city: City, position: Position) {
  const features = readTile<PolygonRow<[string, string]>>(city, "lotes", cellAt(position.lng, .01), cellAt(position.lat, .01));
  const matches = (features ?? []).filter(row => contains(row, position) !== null);
  if (matches.length !== 1) return null;
  const [[quadra, lote], , type, coordinates] = matches[0];
  return { quadra, lote, edgeDistanceM: polygonEdgeDistance(position, { type, coordinates }) };
}

export function checkLocalShopeeStreet(
  city: City, street: string, position: Position,
  matches: (expected: string, actual: string) => boolean, radius: number,
) {
  const projected = city === "goiania";
  const [x, y] = projected ? lonLatToUtm31982(position.lng, position.lat) : [position.lng, position.lat];
  const cell = projected ? 1000 : .01;
  // 1 degree exceeds 100 km throughout this service area.
  const buffer = projected ? radius : radius / 100000;
  const streets: Street[] = [];
  for (let i = cellAt(x - buffer, cell); i <= cellAt(x + buffer, cell); i++) {
    for (let j = cellAt(y - buffer, cell); j <= cellAt(y + buffer, cell); j++) {
      const rows = readTile<StreetRow>(city, "ruas", i, j);
      if (!rows) return null;
      for (const [name, bbox, type, coordinates] of rows) {
        if (matches(street, name)) streets.push({ name, bbox, geometry: { type, coordinates } });
      }
    }
  }
  const distance = projected
    ? checkStreetGeometry(street, [x, y], matches, streets, radius)
    : checkAparecidaStreetGeometry(street, position, matches, streets, radius);
  return {
    ...distance,
    known: distance.matched || !!manifest(city)?.ruas.names.some(name => matches(street, name)),
  };
}

// Use the same SIRGAS 2000 / UTM 22S transform as the local road audit.
function lonLatToUtm31982(lng: number, lat: number): [number, number] {
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
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) *
        Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x =
    500000 +
    k0 *
      n *
      (bigA +
        (1 - t + c) * bigA ** 3 / 6 +
        (5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * bigA ** 5 / 120);
  const y =
    10000000 +
    k0 *
      (m +
        n *
          Math.tan(phi) *
          (bigA ** 2 / 2 +
            (5 - t + 9 * c + 4 * c ** 2) * bigA ** 4 / 24 +
            (61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * bigA ** 6 / 720));
  return [x, y];
}
