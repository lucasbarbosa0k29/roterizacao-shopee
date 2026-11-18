import fs from "fs";
import path from "path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";

export type AparecidaBoundary = {
  id: number;
  name: string;
  bbox: [number, number, number, number];
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: any };
};
type BoundaryDataset = {
  boundaries: AparecidaBoundary[];
};
let cached: BoundaryDataset | null | undefined;

function loadBoundaries(): BoundaryDataset | null {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(process.cwd(), "data", "localfirst", "aparecida", "bairros.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as BoundaryDataset;
    cached = Array.isArray(parsed.boundaries) ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function findTerritoryNames(
  position: { lat: number; lng: number },
  boundaries: AparecidaBoundary[] | null = loadBoundaries()?.boundaries ?? null,
) {
  return findContainingBoundaries(position, boundaries).map(x => x.name);
}

export function findContainingBoundaries(
  position: { lat: number; lng: number },
  boundaries: AparecidaBoundary[] | null = loadBoundaries()?.boundaries ?? null,
) {
  if (!boundaries || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return [];
  const p = point([position.lng, position.lat]);
  return boundaries.filter(x => {
    const [minX, minY, maxX, maxY] = x.bbox;
    if (position.lng < minX || position.lng > maxX || position.lat < minY || position.lat > maxY) return false;
    return booleanPointInPolygon(p, { type: "Feature", properties: {}, geometry: x.geometry }, { ignoreBoundary: true });
  });
}

// A textual alias alone cannot override the spreadsheet neighborhood.
// No buffers, nearest-neighborhood guesses or paid reverse lookups.
export function checkAparecidaTerritory(
  expected: string,
  position: { lat: number; lng: number },
  normalizeName: (name: string) => string,
  boundaries: AparecidaBoundary[] | null = loadBoundaries()?.boundaries ?? null,
) {
  const key = normalizeName(expected);
  // A generic bairro may include its explicitly named subdivisions. The
  // direction is intentional: "2 Etapa" never accepts the generic polygon.
  const belongsToExpected = (name: string) => name === key ||
    (name.startsWith(key + " ") && /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X) (?:ETAPA|COMPLEMENTO|GLEBA)$/.test(name.slice(key.length + 1)));
  const known = !!key && !!boundaries?.some(x => belongsToExpected(normalizeName(x.name)));
  if (!boundaries || !known || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    return { available: !!boundaries, known, matched: false, actualNames: [] as string[] };
  }
  const actualNames = findTerritoryNames(position, boundaries);
  const keys = new Set(actualNames.map(normalizeName));
  return { available: true, known: true, matched: keys.size === 1 && [...keys].every(belongsToExpected), actualNames };
}

type StreetSegment = {
  name: string;
  bbox: [number, number, number, number];
  geometry: { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
};
let streetCache: StreetSegment[] | null | undefined;
export function loadStreets(): StreetSegment[] | null {
  if (streetCache !== undefined) return streetCache;
  try {
    const file = path.join(process.cwd(), "data", "localfirst", "aparecida", "logradouros.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    streetCache = Array.isArray(parsed.streets) ? parsed.streets : null;
  } catch {
    streetCache = null;
  }
  return streetCache ?? null;
}

// Distances are evaluated only in a small neighborhood of the point, in meters.
// This corroborates a street reference, never a house or parcel location.
export function checkAparecidaStreetGeometry(
  expected: string,
  position: { lat: number; lng: number },
  matchesStreet: (expected: string, actual: string) => boolean,
  streets: StreetSegment[] | null = loadStreets(),
  radius = 20,
) {
  const yScale = Math.PI / 180 * 6371000;
  const xScale = yScale * Math.cos(position.lat * Math.PI / 180);
  return checkStreetGeometry(expected, [position.lng, position.lat], matchesStreet, streets, radius, xScale, yScale);
}

export function checkStreetGeometry(
  expected: string,
  [x, y]: [number, number],
  matchesStreet: (expected: string, actual: string) => boolean,
  streets: StreetSegment[] | null,
  radius: number,
  xScale = 1,
  yScale = 1,
) {
  const epsilon = 1e-8;
  const xRadius = (radius + epsilon) / xScale;
  const yRadius = (radius + epsilon) / yScale;
  let distance = Infinity;
  for (const street of streets || []) {
    const [minX, minY, maxX, maxY] = street.bbox;
    if (x < minX - xRadius || x > maxX + xRadius ||
        y < minY - yRadius || y > maxY + yRadius) continue;
    if (!matchesStreet(expected, street.name)) continue;
    const lines = street.geometry.type === "LineString"
      ? [street.geometry.coordinates as number[][]] : street.geometry.coordinates as number[][][];
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = [(line[i - 1][0] - x) * xScale, (line[i - 1][1] - y) * yScale];
      const b = [(line[i][0] - x) * xScale, (line[i][1] - y) * yScale];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared)) : 0;
      distance = Math.min(distance, Math.hypot(a[0] + t * dx, a[1] + t * dy));
    }
  }
  return { matched: distance <= radius + epsilon, distanceMeters: Number.isFinite(distance) ? distance : null };
}

export function polygonEdgeDistance(
  position: { lat: number; lng: number },
  geometry: AparecidaBoundary["geometry"],
) {
  const rings: number[][][] = geometry.type === "Polygon"
    ? geometry.coordinates : geometry.coordinates.flat();
  return checkAparecidaStreetGeometry("boundary", position, () => true, [{
    name: "boundary",
    bbox: [-Infinity, -Infinity, Infinity, Infinity],
    geometry: { type: "MultiLineString", coordinates: rings },
  }], Infinity).distanceMeters;
}
