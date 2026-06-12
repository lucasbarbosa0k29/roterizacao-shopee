const COMMERCIAL_MARKERS = new Set([
  "LOJA",
  "OFICINA",
  "DISTRIBUIDORA",
  "ACADEMIA",
  "CLINICA",
  "HOSPITAL",
  "ESCOLA",
  "FARMACIA",
  "SUPERMERCADO",
  "EMPRESA",
  "RESTAURANTE",
  "LANCHONETE",
  "PADARIA",
  "CONVENIENCIA",
  "AUTOPECAS",
  "AUTO",
  "PECAS",
  "MERCADO",
  "IGREJA",
  "ESCRITORIO",
  "BAR",
  "POSTO",
  "ATACADAO",
  "ASSAI",
  "BRETAS",
  "DROGASIL",
  "PAGUE",
  "MENOS",
  "MATERIAL",
  "MATERIAIS",
  "ESTUDIO",
  "STUDIO",
  "LABORATORIO",
  "FERRAGENS",
]);

const COMMERCIAL_PHRASES = [
  "PAGUE MENOS",
];

const RESIDENTIAL_BLOCKERS = new Set([
  "APT",
  "APTO",
  "APART",
  "APARTAMENTO",
  "AP",
  "BLOCO",
  "TORRE",
  "ANDAR",
  "SALA",
  "CASA",
  "RESIDENCIAL",
  "CONDOMINIO",
  "COND",
  "ALPHAVILLE",
  "JARDINS",
  "LOTEAMENTO",
]);

const ADDRESS_MARKERS = new Set([
  "RUA",
  "AVENIDA",
  "AV",
  "ALAMEDA",
  "TRAVESSA",
  "TV",
  "VIELA",
  "VIA",
  "R",
  "QUADRA",
  "QD",
  "Q",
  "LOTE",
  "LT",
  "L",
]);

const STOPWORDS = new Set([
  "DE",
  "DA",
  "DO",
  "DAS",
  "DOS",
  "E",
  "A",
  "O",
  "AO",
  "NA",
  "NO",
  "NAS",
  "NOS",
]);

const BAD_GOOGLE_TYPES = new Set([
  "locality",
  "political",
  "route",
  "neighborhood",
  "sublocality",
  "sublocality_level_1",
  "sublocality_level_2",
  "administrative_area_level_1",
  "administrative_area_level_2",
]);

const GOOD_GOOGLE_TYPES = new Set([
  "establishment",
  "point_of_interest",
  "store",
  "school",
  "hospital",
  "pharmacy",
  "doctor",
  "gym",
  "church",
  "restaurant",
  "meal_takeaway",
  "grocery_or_supermarket",
  "shopping_mall",
  "lodging",
  "convenience_store",
  "car_repair",
  "auto_repair",
]);

type Point = { lat: number; lng: number };

export type GoogleCommercialFallbackPlan = {
  shouldAttempt: boolean;
  blockedReason: string | null;
  commercialName: string;
  query: string;
};

export type GoogleCommercialFallbackResult = {
  accepted: boolean;
  rejectedReason: string | null;
  score: number;
  similarity: number;
  cityMatch: boolean;
  coordinateDistanceM: number | null;
  item: any | null;
};

function normalizeText(value: string) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(
    normalizeText(value)
      .split(/\s+/g)
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => !STOPWORDS.has(token)),
  );
}

function hasResidentialBlocker(text: string) {
  const up = normalizeText(text);
  return Array.from(RESIDENTIAL_BLOCKERS).some((token) => new RegExp(`\\b${token}\\b`).test(up));
}

function hasAddressMarker(text: string) {
  const up = normalizeText(text);
  return Array.from(ADDRESS_MARKERS).some((token) => new RegExp(`\\b${token}\\b`).test(up));
}

function hasCommercialSignal(text: string) {
  const up = normalizeText(text);
  if (Array.from(COMMERCIAL_MARKERS).some((token) => new RegExp(`\\b${token}\\b`).test(up))) {
    return true;
  }
  return COMMERCIAL_PHRASES.some((phrase) => up.includes(phrase));
}

function isStreetLike(text: string) {
  const up = normalizeText(text);
  return /^(RUA|AVENIDA|AV|ALAMEDA|TRAVESSA|TV|VIELA|VIA|R)\b/.test(up);
}

function extractSeedFromPart(part: string) {
  const normalized = normalizeText(part);
  if (!normalized) return "";
  if (hasResidentialBlocker(normalized)) return "";
  if (isStreetLike(normalized)) return "";

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (!tokens.length) return "";
  if (tokens.some((token) => ADDRESS_MARKERS.has(token))) return "";
  if (tokens.some((token) => /\d/.test(token))) return "";

  const hasSignal = hasCommercialSignal(normalized);
  const cleaned = tokens.filter((token) => !STOPWORDS.has(token));

  if (hasSignal) {
    const limited = cleaned.slice(0, 6);
    if (limited.length >= 1) {
      return limited.join(" ").trim();
    }
    return "";
  }

  if (cleaned.length >= 1 && cleaned.length <= 3) {
    return cleaned.join(" ").trim();
  }

  return "";
}

export function buildGoogleCommercialFallbackPlan(args: {
  addressRaw: string;
  city: string;
  aptLike: boolean;
  hasQL: boolean;
}): GoogleCommercialFallbackPlan {
  const city = String(args.city || "").trim();
  if (!city) {
    return {
      shouldAttempt: false,
      blockedReason: "MISSING_CITY",
      commercialName: "",
      query: "",
    };
  }

  if (args.aptLike) {
    return {
      shouldAttempt: false,
      blockedReason: "APT_OR_CONDO",
      commercialName: "",
      query: "",
    };
  }

  if (args.hasQL) {
    return {
      shouldAttempt: false,
      blockedReason: "HAS_QD_LT",
      commercialName: "",
      query: "",
    };
  }

  const raw = String(args.addressRaw || "").trim();
  if (!raw) {
    return {
      shouldAttempt: false,
      blockedReason: "EMPTY_ADDRESS",
      commercialName: "",
      query: "",
    };
  }

  if (hasResidentialBlocker(raw)) {
    return {
      shouldAttempt: false,
      blockedReason: "RESIDENTIAL_LIKE",
      commercialName: "",
      query: "",
    };
  }

  const parts = raw
    .split(/[,;/|]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  let commercialName = "";
  for (const part of parts) {
    const seed = extractSeedFromPart(part);
    if (seed) {
      commercialName = seed;
      break;
    }
  }

  if (!commercialName) {
    return {
      shouldAttempt: false,
      blockedReason: "NO_STRONG_COMMERCIAL_NAME",
      commercialName: "",
      query: "",
    };
  }

  const query = `${commercialName}, ${city}, GO, Brasil`;
  return {
    shouldAttempt: true,
    blockedReason: null,
    commercialName,
    query,
  };
}

function includesEither(a?: string, b?: string) {
  const left = normalizeText(a || "");
  const right = normalizeText(b || "");
  return !!left && !!right && (left.includes(right) || right.includes(left));
}

function similarityScore(a: string, b: string) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;

  let intersection = 0;
  for (const token of ta) {
    if (tb.has(token)) intersection += 1;
  }

  const union = new Set([...ta, ...tb]).size;
  return union ? intersection / union : 0;
}

function haversineMeters(a: Point, b: Point) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function getGoogleApiKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ""
  ).trim();
}

function pickGoogleTypes(types: string[] | undefined) {
  const list = Array.isArray(types) ? types.map((t) => String(t || "").toLowerCase()) : [];
  if (!list.length) return { allowed: false, blocked: false };
  const blocked = list.some((type) => BAD_GOOGLE_TYPES.has(type));
  const allowed = list.some((type) => GOOD_GOOGLE_TYPES.has(type)) || list.includes("establishment");
  return { allowed, blocked };
}

function buildGoogleItem(result: any, city: string, query: string) {
  const lat = result?.geometry?.location?.lat;
  const lng = result?.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const formatted = String(result?.formatted_address || "").trim();
  const name = String(result?.name || "").trim();
  return {
    id: `google:${String(result?.place_id || name || query).trim()}`,
    title: name || formatted || query,
    resultType: "google_place",
    address: {
      label: formatted || name || query,
      city: city || "",
      street: "",
      district: "",
      postalCode: "",
      countryCode: "BRA",
      countryName: "Brasil",
    },
    position: { lat, lng },
    googleTypes: Array.isArray(result?.types) ? result.types : [],
  };
}

export async function lookupGoogleCommercialFallbackCandidate(args: {
  query: string;
  commercialName: string;
  city: string;
  currentPosition?: Point | null;
}) {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    return {
      accepted: false,
      rejectedReason: "MISSING_GOOGLE_API_KEY",
      score: 0,
      similarity: 0,
      cityMatch: false,
      coordinateDistanceM: null,
      item: null,
    } satisfies GoogleCommercialFallbackResult;
  }

  const query = String(args.query || "").trim();
  if (!query) {
    return {
      accepted: false,
      rejectedReason: "EMPTY_QUERY",
      score: 0,
      similarity: 0,
      cityMatch: false,
      coordinateDistanceM: null,
      item: null,
    } satisfies GoogleCommercialFallbackResult;
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("region", "br");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const payload = await res.json().catch(() => null);
  const results = Array.isArray(payload?.results) ? payload.results : [];

  if (!res.ok || !results.length || String(payload?.status || "").toUpperCase() !== "OK") {
    return {
      accepted: false,
      rejectedReason: `GOOGLE_${String(payload?.status || (res.ok ? "NO_RESULTS" : "HTTP_ERROR")).toUpperCase()}`,
      score: 0,
      similarity: 0,
      cityMatch: false,
      coordinateDistanceM: null,
      item: null,
    } satisfies GoogleCommercialFallbackResult;
  }

  const cityNorm = normalizeText(args.city || "");
  const commercialName = normalizeText(args.commercialName || "");
  const current = args.currentPosition || null;

  let best: {
    score: number;
    similarity: number;
    cityMatch: boolean;
    coordinateDistanceM: number | null;
    item: any;
  } | null = null;

  for (const result of results.slice(0, 5)) {
    const name = String(result?.name || "");
    const formatted = String(result?.formatted_address || "");
    const types = Array.isArray(result?.types) ? result.types : [];
    const typeCheck = pickGoogleTypes(types);
    if (typeCheck.blocked) continue;
    if (!typeCheck.allowed) continue;

    const nameNorm = normalizeText(name);
    const formattedNorm = normalizeText(formatted);
    const cityMatch =
      !!cityNorm && (formattedNorm.includes(cityNorm) || cityNorm.includes(formattedNorm));

    const exactName = includesEither(commercialName, nameNorm);
    const sim = similarityScore(commercialName, nameNorm);
    const formattedBoost = includesEither(commercialName, formattedNorm) ? 0.2 : 0;
    const similarity = Math.max(sim, exactName ? 1 : 0, Math.min(1, sim + formattedBoost));

    const position = result?.geometry?.location;
    if (typeof position?.lat !== "number" || typeof position?.lng !== "number") continue;

    let distanceM: number | null = null;
    if (current?.lat != null && current?.lng != null) {
      distanceM = haversineMeters(current, { lat: position.lat, lng: position.lng });
      if (distanceM > 150) continue;
    }

    let score = 0;
    if (similarity >= 0.95) score += 50;
    else if (similarity >= 0.85) score += 40;
    else if (similarity >= 0.7) score += 28;
    else if (similarity >= 0.55) score += 15;
    else continue;

    if (!cityMatch) continue;
    score += 25;
    if (typeCheck.allowed) score += 10;
    if (distanceM != null) {
      if (distanceM <= 50) score += 20;
      else if (distanceM <= 100) score += 14;
      else if (distanceM <= 150) score += 8;
      else continue;
    } else {
      score += 5;
    }

    if (best == null || score > best.score) {
      best = {
        score,
        similarity,
        cityMatch,
        coordinateDistanceM: distanceM,
        item: buildGoogleItem(result, args.city, query),
      };
    }
  }

  if (!best) {
    return {
      accepted: false,
      rejectedReason: "NO_GOOGLE_CANDIDATE",
      score: 0,
      similarity: 0,
      cityMatch: false,
      coordinateDistanceM: null,
      item: null,
    } satisfies GoogleCommercialFallbackResult;
  }

  const accepted =
    best.score >= 75 ||
    (current?.lat == null && current?.lng == null && best.score >= 65 && best.similarity >= 0.85);

  return {
    accepted,
    rejectedReason: accepted ? null : "LOW_SCORE",
    score: best.score,
    similarity: best.similarity,
    cityMatch: best.cityMatch,
    coordinateDistanceM: best.coordinateDistanceM,
    item: accepted ? best.item : null,
  } satisfies GoogleCommercialFallbackResult;
}
