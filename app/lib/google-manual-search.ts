export type GoogleManualSearchLatLng = {
  lat: number;
  lng: number;
};

export type GoogleManualSearchResult = {
  id: string;
  name: string;
  address: string;
  pos: GoogleManualSearchLatLng;
};

export type GoogleManualSearchRequest = {
  provider: "legacy" | "new";
  query: string;
  city: string;
  district: string;
  center: GoogleManualSearchLatLng;
  radius: number;
  language: string;
  region: string;
};

export type GoogleManualSearchSortContext = {
  searchText?: string;
  queryContext?: string;
  city?: string;
  district?: string;
  center?: GoogleManualSearchLatLng | null;
};

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTerms(value: unknown) {
  return normalizeText(value)
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
}

export function distanceMeters(
  a: GoogleManualSearchLatLng,
  b: GoogleManualSearchLatLng,
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function scoreTermMatches(text: string, terms: string[], weight: number) {
  if (!text || !terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += weight;
  }
  return score;
}

function scoreGooglePlaceResult(params: {
  result: GoogleManualSearchResult;
  context: GoogleManualSearchSortContext;
}) {
  const name = normalizeText(params.result.name);
  const address = normalizeText(params.result.address);
  const combined = `${name} ${address}`.trim();

  const searchTerms = splitTerms(params.context.searchText);
  const contextTerms = splitTerms(params.context.queryContext);
  const cityTerms = splitTerms(params.context.city);
  const districtTerms = splitTerms(params.context.district);

  let score = 0;
  score += scoreTermMatches(name, searchTerms, 12);
  score += scoreTermMatches(address, searchTerms, 7);
  score += scoreTermMatches(combined, contextTerms, 3);
  score += scoreTermMatches(address, cityTerms, 18);
  score += scoreTermMatches(address, districtTerms, 14);

  if (cityTerms.length && !cityTerms.some((term) => address.includes(term))) {
    score -= 16;
  }

  if (districtTerms.length && !districtTerms.some((term) => address.includes(term))) {
    score -= 6;
  }

  if (address.includes("goias") || address.includes(" go ")) score += 4;

  if (params.context.center) {
    const meters = distanceMeters(params.context.center, params.result.pos);
    if (meters <= 1500) score += 16;
    else if (meters <= 5000) score += 10;
    else if (meters <= 12000) score += 4;
    else if (meters > 35000) score -= 10;
  }

  if (searchTerms.length && !searchTerms.some((term) => combined.includes(term))) {
    score -= 12;
  }

  return score;
}

export function sortGoogleManualSearchResults(
  results: GoogleManualSearchResult[],
  context: GoogleManualSearchSortContext,
) {
  return results
    .map((result, index) => ({
      result,
      index,
      score: scoreGooglePlaceResult({ result, context }),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((item) => item.result);
}

export type GoogleManualSearchComparison = {
  legacyCount: number;
  newCount: number;
  sameOrder: boolean;
  commonIds: number;
  maxCommonCoordinateDistanceM: number | null;
  coordinateMismatchesOver10m: number;
};

export function compareGoogleManualSearchResults(
  legacyResults: GoogleManualSearchResult[],
  newResults: GoogleManualSearchResult[],
): GoogleManualSearchComparison {
  const newById = new Map(newResults.map((result) => [result.id, result]));
  let commonIds = 0;
  let maxCommonCoordinateDistanceM: number | null = null;
  let coordinateMismatchesOver10m = 0;

  for (const legacyResult of legacyResults) {
    const newResult = newById.get(legacyResult.id);
    if (!newResult) continue;
    commonIds += 1;
    const distance = distanceMeters(legacyResult.pos, newResult.pos);
    maxCommonCoordinateDistanceM = Math.max(maxCommonCoordinateDistanceM ?? 0, distance);
    if (distance > 10) coordinateMismatchesOver10m += 1;
  }

  return {
    legacyCount: legacyResults.length,
    newCount: newResults.length,
    sameOrder:
      legacyResults.length === newResults.length &&
      legacyResults.every((result, index) => result.id === newResults[index]?.id),
    commonIds,
    maxCommonCoordinateDistanceM,
    coordinateMismatchesOver10m,
  };
}

