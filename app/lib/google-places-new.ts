import type {
  GoogleManualSearchLatLng,
  GoogleManualSearchRequest,
  GoogleManualSearchResult,
} from "./google-manual-search";

export const GOOGLE_PLACES_NEW_ENDPOINT =
  "https://places.googleapis.com/v1/places:searchText";

export const GOOGLE_PLACES_NEW_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location";
export const GOOGLE_PLACES_NEW_DEFAULT_TIMEOUT_MS = 10_000;

export type GooglePlacesNewErrorCode =
  | "GOOGLE_PLACES_NEW_TIMEOUT"
  | "GOOGLE_PLACES_NEW_NETWORK"
  | "GOOGLE_PLACES_NEW_UPSTREAM"
  | "GOOGLE_PLACES_NEW_QUOTA"
  | "GOOGLE_PLACES_NEW_FORBIDDEN"
  | "GOOGLE_PLACES_NEW_CONFIG"
  | "GOOGLE_PLACES_NEW_INVALID_RESPONSE"
  | "GOOGLE_PLACES_NEW_DISABLED"
  | "GOOGLE_PLACES_UNAUTHORIZED"
  | "GOOGLE_PLACES_INVALID_REQUEST"
  | "GOOGLE_PLACES_COMPARE_FORBIDDEN"
  | "GOOGLE_PLACES_RATE_LIMITED"
  | "GOOGLE_PLACES_RATE_LIMITER_UNAVAILABLE";

export class GooglePlacesNewError extends Error {
  readonly code: GooglePlacesNewErrorCode;
  readonly status?: number;

  constructor(code: GooglePlacesNewErrorCode, message: string, status?: number) {
    super(message);
    this.name = "GooglePlacesNewError";
    this.code = code;
    this.status = status;
  }
}

export function getGooglePlacesErrorCode(error: unknown) {
  if (error instanceof GooglePlacesNewError) return error.code;
  if (isRecord(error) && typeof error.code === "string") {
    return error.code as GooglePlacesNewErrorCode;
  }
  return undefined;
}

export function shouldFallbackToLegacy(error: unknown) {
  const code = getGooglePlacesErrorCode(error);
  if (!code) return true;
  return [
    "GOOGLE_PLACES_NEW_TIMEOUT",
    "GOOGLE_PLACES_NEW_NETWORK",
    "GOOGLE_PLACES_NEW_UPSTREAM",
  ].includes(code);
}

export function getGooglePlacesUserMessage(error: unknown) {
  switch (getGooglePlacesErrorCode(error)) {
    case "GOOGLE_PLACES_RATE_LIMITED":
    case "GOOGLE_PLACES_NEW_QUOTA":
      return "O limite de buscas do Google Places foi atingido. Tente novamente mais tarde.";
    case "GOOGLE_PLACES_NEW_TIMEOUT":
    case "GOOGLE_PLACES_NEW_NETWORK":
    case "GOOGLE_PLACES_NEW_UPSTREAM":
      return "O Google Maps está temporariamente indisponível. Tente novamente.";
    case "GOOGLE_PLACES_NEW_FORBIDDEN":
    case "GOOGLE_PLACES_NEW_CONFIG":
    case "GOOGLE_PLACES_NEW_DISABLED":
      return "A busca do Google Places não está disponível no momento.";
    case "GOOGLE_PLACES_NEW_INVALID_RESPONSE":
      return "O Google Places retornou uma resposta inválida. Tente novamente.";
    case "GOOGLE_PLACES_INVALID_REQUEST":
      return "Revise o texto da busca e tente novamente.";
    case "GOOGLE_PLACES_UNAUTHORIZED":
      return "Faça login para pesquisar no Google Maps.";
    case "GOOGLE_PLACES_RATE_LIMITER_UNAVAILABLE":
      return "Não foi possível validar o limite de buscas. Tente novamente.";
    default:
      return "Não foi possível buscar no Google Maps. Tente novamente.";
  }
}

export async function fetchWithGooglePlacesTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = GOOGLE_PLACES_NEW_DEFAULT_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new GooglePlacesNewError(
        "GOOGLE_PLACES_NEW_TIMEOUT",
        "A busca do Google Places excedeu o tempo limite.",
      );
    }
    throw new GooglePlacesNewError(
      "GOOGLE_PLACES_NEW_NETWORK",
      "Falha de rede ao consultar o Google Places.",
      undefined,
    );
  } finally {
    clearTimeout(timer);
  }
}

export type GooglePlacesNewSearchPayload = {
  textQuery: string;
  languageCode: string;
  regionCode: string;
  maxResultCount: number;
  locationBias: {
    circle: {
      center: {
        latitude: number;
        longitude: number;
      };
      radius: number;
    };
  };
};

export function buildGooglePlacesNewSearchPayload(
  request: Omit<GoogleManualSearchRequest, "provider">,
): GooglePlacesNewSearchPayload {
  return {
    textQuery: buildGooglePlacesNewTextQuery(request),
    languageCode: request.language,
    regionCode: request.region.toUpperCase(),
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: {
          latitude: request.center.lat,
          longitude: request.center.lng,
        },
        radius: request.radius,
      },
    },
  };
}

function normalizeQueryText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildGooglePlacesNewTextQuery(
  request: Pick<GoogleManualSearchRequest, "query" | "city">,
) {
  const query = request.query.trim();
  const city = request.city.trim();
  if (!city || /\d/.test(query)) return query;

  const normalizedQuery = normalizeQueryText(query);
  const queryTerms = normalizedQuery.split(" ").filter(Boolean);
  const normalizedCity = normalizeQueryText(city);
  if (queryTerms.length > 3 || !normalizedCity || normalizedQuery.includes(normalizedCity)) {
    return query;
  }

  return `${query}, ${city}`;
}

function isFiniteCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidLatitude(value: unknown) {
  return isFiniteCoordinate(value) && Number(value) >= -90 && Number(value) <= 90;
}

function isValidLongitude(value: unknown) {
  return isFiniteCoordinate(value) && Number(value) >= -180 && Number(value) <= 180;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function mapGooglePlacesNewResponse(payload: unknown): GoogleManualSearchResult[] {
  const places = getGooglePlacesNewPlaces(payload);
  if (!places) return [];

  return places
    .map((value: unknown, index: number) => {
      const place = isRecord(value) ? value : {};
      const location = isRecord(place.location) ? place.location : {};
      if (!isValidLatitude(location?.latitude) || !isValidLongitude(location?.longitude)) {
        return null;
      }

      const displayName = isRecord(place.displayName) ? place.displayName : {};
      const id = String(place.id || place.name || index).trim();
      return {
        id,
        name: String(displayName.text || "Resultado sem nome"),
        address: String(place.formattedAddress || ""),
        pos: {
          lat: Number(location.latitude),
          lng: Number(location.longitude),
        } satisfies GoogleManualSearchLatLng,
      } satisfies GoogleManualSearchResult;
    })
    .filter(Boolean) as GoogleManualSearchResult[];
}

export function getGooglePlacesNewPlaces(payload: unknown): unknown[] | null {
  if (!isRecord(payload)) return null;
  if (payload.places === undefined) return [];
  return Array.isArray(payload.places) ? payload.places : null;
}

export function isGooglePlacesNewResponse(
  payload: unknown,
): payload is { places?: unknown[] } {
  return getGooglePlacesNewPlaces(payload) !== null;
}

