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
  const p = point([position.lng, position.lat]);
  const containing = boundaries.filter(x => {
    const [minX, minY, maxX, maxY] = x.bbox;
    if (position.lng < minX || position.lng > maxX || position.lat < minY || position.lat > maxY) return false;
    return booleanPointInPolygon(p, { type: "Feature", properties: {}, geometry: x.geometry }, { ignoreBoundary: true });
  });
  const keys = new Set(containing.map(x => normalizeName(x.name)));
  return { available: true, known: true, matched: keys.size === 1 && [...keys].every(belongsToExpected), actualNames: containing.map(x => x.name) };
}

type StreetSegment = {
  name: string;
  bbox: [number, number, number, number];
  geometry: { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
};
let streetCache: StreetSegment[] | null | undefined;
function loadStreets(): StreetSegment[] | null {
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
) {
  const radius = 20;
  const yScale = Math.PI / 180 * 6371000;
  const xScale = yScale * Math.cos(position.lat * Math.PI / 180);
  let distance = Infinity;
  for (const street of streets || []) {
    const [minX, minY, maxX, maxY] = street.bbox;
    if (position.lng < minX - radius / xScale || position.lng > maxX + radius / xScale ||
        position.lat < minY - radius / yScale || position.lat > maxY + radius / yScale) continue;
    if (!matchesStreet(expected, street.name)) continue;
    const lines = street.geometry.type === "LineString"
      ? [street.geometry.coordinates as number[][]] : street.geometry.coordinates as number[][][];
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = [(line[i - 1][0] - position.lng) * xScale, (line[i - 1][1] - position.lat) * yScale];
      const b = [(line[i][0] - position.lng) * xScale, (line[i][1] - position.lat) * yScale];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared)) : 0;
      distance = Math.min(distance, Math.hypot(a[0] + t * dx, a[1] + t * dy));
    }
  }
  return { matched: distance <= radius, distanceMeters: Number.isFinite(distance) ? distance : null };
}
