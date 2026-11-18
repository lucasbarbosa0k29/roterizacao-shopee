import fs from "node:fs";
import path from "node:path";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import RBush from "rbush";
import {
  checkAparecidaStreetGeometry,
  checkAparecidaTerritory,
  findContainingBoundaries,
  polygonEdgeDistance,
  loadStreets,
} from "@/app/lib/aparecida-territory";
import {
  compareAparecidaStreetForValidation,
  lookupStrictAparecidaParcel,
  normalizeAparecidaTerritoryName,
} from "@/app/lib/aparecida-local-lots";
import { normalizeQLIdentity } from "@/app/lib/quadra-lote-normalization";
import { checkLocalShopeeStreet, findLocalShopeeBairro, findLocalShopeeParcel } from "@/app/lib/shopee-gps-local-territory";
import { isShopeeGpsCity } from "@/app/lib/shopee-gps-scope";
import { normalizeStreetText } from "@/app/lib/street-normalization";

type Position = { lat: number; lng: number };
type Boundary = NonNullable<Parameters<typeof checkAparecidaTerritory>[3]>[number];
type Street = NonNullable<Parameters<typeof checkAparecidaStreetGeometry>[3]>[number];

// Broad envelopes around the local city layers. These only rule out distant
// points and reversed axes. They are not municipal boundaries.
const cityEnvelopes: Readonly<Record<string, readonly [number, number, number, number]>> = {
  "APARECIDA DE GOIANIA": [-49.43, -16.92, -49.13, -16.68],
  "HIDROLANDIA": [-49.56, -17.21, -49.08, -16.81],
  "GOIANIA": [-49.49, -16.87, -49.10, -16.42],
  "TRINDADE": [-49.70, -16.81, -49.33, -16.50],
};

type ParcelProperties = { quadra?: string; lote?: string };
type IndexedParcel = {
  minX: number; minY: number; maxX: number; maxY: number;
  feature: Feature<Polygon | MultiPolygon, ParcelProperties>;
};
let hidrolandiaParcels: RBush<IndexedParcel> | null | undefined;

function lookupStrictHidrolandiaParcel({ lat, lng }: Position) {
  if (hidrolandiaParcels === undefined) {
    try {
      const file = path.join(process.cwd(), "public/data/hidrolandia/hidrolandia_lotes_mapa.web4326.geojson");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      hidrolandiaParcels = new RBush<IndexedParcel>().load(data.features.flatMap(
        (feature: IndexedParcel["feature"]) => {
          if (feature.geometry?.type !== "Polygon" && feature.geometry?.type !== "MultiPolygon") return [];
          const [minX, minY, maxX, maxY] = bbox(feature);
          return [{ minX, minY, maxX, maxY, feature }];
        },
      ));
    } catch {
      hidrolandiaParcels = null;
    }
  }
  const hits = hidrolandiaParcels?.search({ minX: lng, minY: lat, maxX: lng, maxY: lat })
    .filter(({ feature }) => booleanPointInPolygon([lng, lat], feature, { ignoreBoundary: true }));
  if (hits?.length !== 1) return null;
  const { quadra, lote } = hits[0].feature.properties;
  return { quadra, lote, edgeDistanceM: polygonEdgeDistance({ lat, lng }, hits[0].feature.geometry) };
}

let hidrolandia: { boundaries: Boundary[]; streets: Street[] } | null | undefined;

function loadHidrolandia() {
  if (hidrolandia !== undefined) return hidrolandia;
  try {
    const load = (layer: "setores" | "ruas") => JSON.parse(fs.readFileSync(path.join(
      process.cwd(), "public", "data", "hidrolandia", `hidrolandia_${layer}_mapa.web4326.geojson`,
    ), "utf8")).features;
    const withBounds = (geometry: { coordinates: unknown }) => {
      const bbox: Boundary["bbox"] = [Infinity, Infinity, -Infinity, -Infinity];
      const visit = (coords: unknown) => {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === "number" && typeof coords[1] === "number") {
          bbox[0] = Math.min(bbox[0], coords[0]);
          bbox[1] = Math.min(bbox[1], coords[1]);
          bbox[2] = Math.max(bbox[2], coords[0]);
          bbox[3] = Math.max(bbox[3], coords[1]);
        } else {
          coords.forEach(visit);
        }
      };
      visit(geometry.coordinates);
      return bbox;
    };
    const boundaries = load("setores").flatMap((feature: {
      geometry: Boundary["geometry"] | null; properties: { setor?: string };
    }, id: number) => {
      const { geometry, properties } = feature;
      return geometry && properties.setor && ["Polygon", "MultiPolygon"].includes(geometry.type)
        ? [{ id, name: properties.setor, geometry, bbox: withBounds(geometry) }] : [];
    });
    const streets = load("ruas").flatMap((feature: {
      geometry: Street["geometry"] | null; properties: { nome_rua?: string };
    }) => {
      const { geometry, properties } = feature;
      return geometry && properties.nome_rua && ["LineString", "MultiLineString"].includes(geometry.type)
        ? [{ name: properties.nome_rua, geometry, bbox: withBounds(geometry) }] : [];
    });
    hidrolandia = { boundaries, streets };
  } catch {
    hidrolandia = null;
  }
  return hidrolandia;
}

export const SHOPEE_STREET_RADIUS_M = 300;
const STRONG_STREET_M = 20;
// A GPS at a mapped edge is often on the road or access to a neighboring lot.
const PARCEL_INTERIOR_M = 12;
const BAIRRO_INTERIOR_M = 25;

type SheetPoint = { lat: unknown; lng: unknown; city: string; bairro: string };
type RecoveryInput = SheetPoint & { normalizedCity: string; state: string; quadra: string; lote: string };
type Rejection = "INVALID_COORDINATES" | "CITY_UNVERIFIED" | "CITY_CONFLICT" | "BAIRRO_CONFLICT" | "PARCEL_CONFLICT";
type MainRejection = Rejection | "BAIRRO_UNVERIFIED" | "STREET_OVER_300M";
type Evidence = {
  coveredBairros?: string[];
  bairroEdgeM?: number | null;
  expectedParcel?: { quadra: string; lote: string };
  containingParcel?: { quadra?: string; lote?: string; edgeDistanceM: number | null } | null;
  parcelMatches?: boolean;
};
type GpsDecision<R extends string, T = Position> =
  ({ position: T; reason?: never } | { position?: never; reason: R }) & { evidence?: Evidence };
export type ShopeeMainPosition = Position & {
  quality: "STREET_STRONG" | "STREET_NEAR" | "BAIRRO_ONLY";
  distanceM: number | null;
};

const cityKey = (city: string) => normalizeStreetText(city).replace(/ (?:GO|GOIAS)$/, "");
const tiledCity = (city: string) => city === "GOIANIA" ? "goiania" : city === "TRINDADE" ? "trindade" : null;

export function readShopeeAddressParcel(original: string) {
  const address = original.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/(\d)(?=(?:LOTE|LT)\s*[:.]?\s*\d)/g, "$1 ");
  const read = (marker: string) => {
    const tokens = [...address.matchAll(new RegExp(
      `\\b(?:${marker})[\\s:.#-]*([A-Z]?\\d+[A-Z]?|[A-Z])(?=\\b|$)`, "g",
    ))];
    const unique = new Set<string>();
    for (const match of tokens) {
      const token = match[1];
      const tail = address.slice(match.index! + match[0].length);
      // A range, slash, or block/unit label is not a single parcel identity.
      if (/^\s*(?:[\/-]|E\b|A\s+)\s*[A-Z]?\d/i.test(tail) || /^\s+\d/.test(tail)) return "";
      if (/^0+$/.test(token)) continue;
      const suffix = tail.match(/^\s+([A-Z])(?=\s*(?:$|[,;]|CASA\b|CS\b|QD\b|LT\b))/)?.[1];
      unique.add(suffix ? token + suffix : token);
    }
    return unique.size === 1 ? [...unique][0] : "";
  };
  // Keep suffix spelling from the original text. Avoid taking a value from Gemini.
  return { quadra: read("QUADRA|QDRA|QDA|QDR|QUAD|QD|Q"), lote: read("LOTE|LTS|LTT|LTE|LT") };
}

export function assessShopeeSheetGps(input: SheetPoint & {
  street: string; normalizedCity?: string; state?: string; quadra?: string; lote?: string;
}): GpsDecision<MainRejection, ShopeeMainPosition> {
  const compatible = recoverShopeeSheetGps({
    ...input, normalizedCity: input.normalizedCity ?? input.city, state: input.state ?? "GO",
    quadra: input.quadra ?? "", lote: input.lote ?? "",
  });
  const { evidence } = compatible;
  if (!compatible.position) return { reason: compatible.reason, evidence };
  const position = compatible.position;
  const city = cityKey(input.city);
  const tiled = tiledCity(city);
  const hidro = city === "HIDROLANDIA" ? loadHidrolandia() : null;
  const aparecida = city === "APARECIDA DE GOIANIA";
  const territory = tiled ? findLocalShopeeBairro(tiled, input.bairro, position)
    : aparecida ? checkAparecidaTerritory(input.bairro, position, normalizeAparecidaTerritoryName)
    : hidro ? checkAparecidaTerritory(input.bairro, position, normalizeStreetText, hidro.boundaries) : null;
  if (!territory?.matched) return { reason: "BAIRRO_UNVERIFIED", evidence };
  const { street } = input;
  const bairroOnly = { position: { ...position, quality: "BAIRRO_ONLY" as const, distanceM: null }, evidence };
  if (!street.trim()) return bairroOnly;
  const sameStreet = (expected: string, actual: string) =>
    compareAparecidaStreetForValidation(expected, actual) === "STREET_MATCH";
  const streets = aparecida ? loadStreets() : hidro?.streets;
  // Look farther only to distinguish a nearby named road beyond the allowed
  // radius from an unrelated homonym elsewhere or a missing road layer.
  const diagnosticRadius = 600;
  const result = tiled
    ? checkLocalShopeeStreet(tiled, street, position, sameStreet, diagnosticRadius)
    : streets && checkAparecidaStreetGeometry(street, position, sameStreet, streets, diagnosticRadius);
  const distanceM = result?.distanceMeters;
  if (distanceM == null || distanceM > diagnosticRadius) return bairroOnly;
  if (distanceM > SHOPEE_STREET_RADIUS_M + 1e-8) return { reason: "STREET_OVER_300M", evidence };
  const expected = evidence?.expectedParcel;
  const strong = distanceM <= STRONG_STREET_M + 1e-8 && (evidence?.bairroEdgeM ?? 0) >= BAIRRO_INTERIOR_M &&
    (!expected?.quadra && !expected?.lote || evidence?.parcelMatches === true);
  return { position: { ...position, quality: strong ? "STREET_STRONG" : "STREET_NEAR", distanceM }, evidence };
}

export function validateShopeeSheetGps(input: Parameters<typeof assessShopeeSheetGps>[0]): Position | null {
  const result = assessShopeeSheetGps(input).position;
  return result ? { lat: result.lat, lng: result.lng } : null;
}

function insideCityEnvelope(city: string, { lng, lat }: Position) {
  const [west, south, east, north] = cityEnvelopes[city];
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

export function recoverShopeeSheetGps(input: RecoveryInput): GpsDecision<Rejection> {
  const { lat, lng } = input;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) ||
      !Number.isFinite(lng) || lat === 0 || lng === 0 || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { reason: "INVALID_COORDINATES" };
  }
  const city = cityKey(input.city);
  if (!isShopeeGpsCity(city)) return { reason: "CITY_UNVERIFIED" };
  const position = { lat, lng };
  if (!["GO", "GOIAS"].includes(normalizeStreetText(input.state)) ||
      (input.normalizedCity && cityKey(input.normalizedCity) !== city) ||
      !insideCityEnvelope(city, position)) return { reason: "CITY_CONFLICT" };

  const aparecida = city === "APARECIDA DE GOIANIA";
  const hidro = city === "HIDROLANDIA";
  const tiled = tiledCity(city);
  const local = tiled ? findLocalShopeeBairro(tiled, input.bairro, position) : null;
  const hidroBoundaries = loadHidrolandia()?.boundaries ?? null;
  const apHits = findContainingBoundaries(position);
  const hidroHits = findContainingBoundaries(position, hidroBoundaries);
  const ownHits = aparecida ? apHits : hidro ? hidroHits : [];
  const coveredHere = !!ownHits.length || !!local?.actualNames.length;
  const deep = (hits: typeof apHits) => hits.length === 1 &&
    (polygonEdgeDistance(position, hits[0].geometry) ?? 0) >= BAIRRO_INTERIOR_M;
  if (!coveredHere) {
    const positiveForeign = [!aparecida && deep(apHits), !hidro && deep(hidroHits)];
    for (const other of ["GOIANIA", "TRINDADE"] as const) {
      const otherTileCity = tiledCity(other);
      if (other !== city && otherTileCity && insideCityEnvelope(other, position)) {
        const hit = findLocalShopeeBairro(otherTileCity, "", position);
        positiveForeign.push((hit.edgeDistanceM ?? 0) >= BAIRRO_INTERIOR_M);
      }
    }
    if (positiveForeign.filter(Boolean).length === 1) return { reason: "CITY_CONFLICT" };
  }
  const normalizeBairro = aparecida ? normalizeAparecidaTerritoryName : normalizeStreetText;
  const territory = aparecida ? checkAparecidaTerritory(input.bairro, position, normalizeBairro)
    : hidro ? checkAparecidaTerritory(input.bairro, position, normalizeBairro, hidroBoundaries) : local;
  const bairroEdgeM = local?.edgeDistanceM ?? (ownHits.length === 1
    ? polygonEdgeDistance(position, ownHits[0].geometry) : null);
  const evidence: Evidence = { coveredBairros: local?.actualNames ?? ownHits.map(x => x.name), bairroEdgeM };
  if (territory?.known && !territory.matched && (bairroEdgeM ?? 0) >= BAIRRO_INTERIOR_M &&
      new Set(territory.actualNames.map(normalizeBairro)).size === 1) {
    return { reason: "BAIRRO_CONFLICT", evidence };
  }

  const atomicKey = (value: string) => {
    const key = normalizeQLIdentity(tiled === "trindade" ? value.trim().replace(/^0+(?=[A-Z0-9])/i, "") : value);
    // "AREA" is a generic cadastral placeholder, not a quadra or lot ID.
    return /^[A-Z0-9]+$/.test(key) && !/^(?:0+|SN|SEM|AREA|INDEFINIDO)$/.test(key) ? key : "";
  };
  const quadra = atomicKey(input.quadra);
  const lote = atomicKey(input.lote);
  evidence.expectedParcel = { quadra, lote };
  if (quadra || lote) {
    const parcel = aparecida ? lookupStrictAparecidaParcel(lat, lng)
      : hidro ? lookupStrictHidrolandiaParcel(position) : tiled ? findLocalShopeeParcel(tiled, position) : null;
    evidence.containingParcel = parcel;
    const actualQuadra = atomicKey(parcel?.quadra || "");
    const actualLote = atomicKey(parcel?.lote || "");
    const differs = !!(quadra && actualQuadra && quadra !== actualQuadra || lote && actualLote && lote !== actualLote);
    evidence.parcelMatches = !!parcel && (!quadra || quadra === actualQuadra) && (!lote || lote === actualLote);
    if (differs && (parcel?.edgeDistanceM ?? 0) >= PARCEL_INTERIOR_M) return { reason: "PARCEL_CONFLICT", evidence };
  }
  return { position, evidence };
}
