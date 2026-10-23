import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ApiUsagePeriodType } from "@prisma/client";
import { authOptions } from "@/app/lib/auth";
import type { GoogleManualSearchRequest } from "@/app/lib/google-manual-search";
import {
  buildGoogleManualSearchCacheKey,
  SingleFlightCache,
} from "@/app/lib/google-manual-search-cache";
import {
  buildGooglePlacesNewSearchPayload,
  fetchWithGooglePlacesTimeout,
  getGooglePlacesErrorCode,
  GooglePlacesNewError,
  GOOGLE_PLACES_NEW_DEFAULT_TIMEOUT_MS,
  GOOGLE_PLACES_NEW_ENDPOINT,
  GOOGLE_PLACES_NEW_FIELD_MASK,
  getGooglePlacesNewPlaces,
  isGooglePlacesNewResponse,
  mapGooglePlacesNewResponse,
  shouldFallbackToLegacy,
} from "@/app/lib/google-places-new";
import {
  consumeGooglePlacesRateLimit,
  getTrustedClientIp,
  incrementGooglePlacesCounter,
  isCompareAuthorized,
  readGooglePlacesRateLimitConfig,
  type GooglePlacesSearchMode,
} from "@/app/lib/google-places-rate-limit";

export const runtime = "nodejs";

const serverGooglePlacesSingleFlight = new SingleFlightCache<
  Awaited<ReturnType<typeof performGooglePlacesNewSearch>>
>();

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSearchRequest(body: unknown): Omit<GoogleManualSearchRequest, "provider"> | null {
  const data = isRecord(body) ? body : {};
  const query = typeof data.query === "string" ? data.query.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const district = typeof data.district === "string" ? data.district.trim() : "";
  const language = typeof data.language === "string" ? data.language.trim() : "pt-BR";
  const region = typeof data.region === "string" ? data.region.trim() : "BR";
  const center = isRecord(data.center) ? data.center : null;
  const radius = Number(data.radius);

  if (!query || query.length > 500) return null;
  if (city.length > 120 || district.length > 120) return null;
  if (!/^[A-Za-z]{2,12}(?:-[A-Za-z0-9]{2,12})?$/.test(language)) return null;
  if (!/^[A-Za-z]{2}$/.test(region)) return null;
  if (
    !center ||
    !isFiniteCoordinate(center.lat) ||
    !isFiniteCoordinate(center.lng) ||
    center.lat < -90 ||
    center.lat > 90 ||
    center.lng < -180 ||
    center.lng > 180
  ) {
    return null;
  }
  if (!Number.isFinite(radius) || radius < 0 || radius > 50000) return null;

  return {
    query,
    city,
    district,
    center: { lat: Number(center.lat), lng: Number(center.lng) },
    radius,
    language,
    region,
  };
}

function readTimeoutMs() {
  const value = Number(process.env.GOOGLE_PLACES_NEW_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 1_000 && value <= 30_000
    ? value
    : GOOGLE_PLACES_NEW_DEFAULT_TIMEOUT_MS;
}

function classifyUpstreamError(status: number, payload: unknown) {
  const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const reason = `${String(errorPayload.status ?? "")} ${String(errorPayload.message ?? "")}`.toLowerCase();
  if (status === 429 || /quota|resource_exhausted|over_query_limit/.test(reason)) {
    return new GooglePlacesNewError(
      "GOOGLE_PLACES_NEW_QUOTA",
      "A cota do Google Places foi atingida.",
      status,
    );
  }
  if (status === 401 || status === 403 || /permission_denied|api key/.test(reason)) {
    return new GooglePlacesNewError(
      "GOOGLE_PLACES_NEW_FORBIDDEN",
      "A configuração da API do Google Places não permite esta consulta.",
      status,
    );
  }
  if (status >= 400 && status < 500) {
    return new GooglePlacesNewError(
      "GOOGLE_PLACES_NEW_CONFIG",
      "A requisição enviada ao Google Places é inválida.",
      status,
    );
  }
  return new GooglePlacesNewError(
    "GOOGLE_PLACES_NEW_UPSTREAM",
    "O Google Places está temporariamente indisponível.",
    status,
  );
}

async function recordGooglePlacesFailure(mode: GooglePlacesSearchMode, code: string) {
  try {
    await incrementGooglePlacesCounter({
      service: `GOOGLE_PLACES_FALLBACK:${mode}:${code}`,
      periodKey: new Date().toISOString().slice(0, 10),
      periodType: ApiUsagePeriodType.DAY,
    });
  } catch (error) {
    console.warn("[GOOGLE_PLACES_FAILURE_METRIC_ERROR]", { mode, code, error });
  }
}

async function performGooglePlacesNewSearch(
  request: Omit<GoogleManualSearchRequest, "provider">,
) {
  const apiKey = (process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!apiKey) {
    throw new GooglePlacesNewError(
      "GOOGLE_PLACES_NEW_CONFIG",
      "GOOGLE_PLACES_API_KEY não configurada.",
    );
  }

  let response: Response;
  try {
    response = await fetchWithGooglePlacesTimeout(
      GOOGLE_PLACES_NEW_ENDPOINT,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_PLACES_NEW_FIELD_MASK,
        },
        body: JSON.stringify(buildGooglePlacesNewSearchPayload(request)),
      },
      readTimeoutMs(),
    );
  } catch (error) {
    throw error instanceof GooglePlacesNewError
      ? error
      : new GooglePlacesNewError("GOOGLE_PLACES_NEW_NETWORK", "Falha de rede.");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw classifyUpstreamError(response.status, payload);
  if (!isGooglePlacesNewResponse(payload)) {
    throw new GooglePlacesNewError(
      "GOOGLE_PLACES_NEW_INVALID_RESPONSE",
      "Resposta inválida do Google Places.",
      response.status,
    );
  }

  const places = getGooglePlacesNewPlaces(payload) ?? [];
  const results = mapGooglePlacesNewResponse(payload);
  if (places.length > 0 && results.length === 0) {
    throw new GooglePlacesNewError(
      "GOOGLE_PLACES_NEW_INVALID_RESPONSE",
      "A resposta do Google Places não contém coordenadas válidas.",
      response.status,
    );
  }
  return results;
}

function errorResponse(error: unknown) {
  const code = getGooglePlacesErrorCode(error) ?? "GOOGLE_PLACES_NEW_UPSTREAM";
  const status =
    code === "GOOGLE_PLACES_NEW_QUOTA"
      ? 429
      : code === "GOOGLE_PLACES_NEW_CONFIG" || code === "GOOGLE_PLACES_NEW_FORBIDDEN"
        ? 502
        : code === "GOOGLE_PLACES_NEW_INVALID_RESPONSE"
          ? 502
          : 504;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Falha ao buscar no Google Maps.", code },
    { status },
  );
}

export async function POST(req: Request) {
  let mode: GooglePlacesSearchMode = "new";
  try {
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user as
      | (NonNullable<typeof session>["user"] & {
          id?: unknown;
          role?: unknown;
        })
      | undefined;
    const userId = typeof sessionUser?.id === "string" ? sessionUser.id : undefined;
    if (!sessionUser || !userId) {
      return NextResponse.json(
        { error: "Não autenticado.", code: "GOOGLE_PLACES_UNAUTHORIZED" },
        { status: 401 },
      );
    }

    if (process.env.GOOGLE_PLACES_NEW_MANUAL_SEARCH_ENABLED !== "1") {
      return NextResponse.json(
        { error: "Places API New desativada para busca manual.", code: "GOOGLE_PLACES_NEW_DISABLED" },
        { status: 503 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido.", code: "GOOGLE_PLACES_INVALID_REQUEST" },
        { status: 400 },
      );
    }
    const requestedMode = isRecord(body) && body.mode === "compare" ? "compare" : "new";
    mode = requestedMode;
    const request = readSearchRequest(body);
    if (!request) {
      return NextResponse.json(
        { error: "Parâmetros de busca inválidos.", code: "GOOGLE_PLACES_INVALID_REQUEST" },
        { status: 400 },
      );
    }

    const rateConfig = readGooglePlacesRateLimitConfig();
    if (
      mode === "compare" &&
      !isCompareAuthorized(
        { id: userId, email: sessionUser.email, role: sessionUser.role },
        rateConfig,
      )
    ) {
      return NextResponse.json(
        { error: "Modo compare não autorizado.", code: "GOOGLE_PLACES_COMPARE_FORBIDDEN" },
        { status: 403 },
      );
    }

    const rateLimit = await consumeGooglePlacesRateLimit({
      userId,
      mode,
      clientIp: getTrustedClientIp(req.headers, rateConfig.trustProxy),
      config: rateConfig,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Limite temporário de buscas do Google Places excedido.",
          code: "GOOGLE_PLACES_RATE_LIMITED",
          dimension: rateLimit.dimension,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const cacheRequest: GoogleManualSearchRequest = { ...request, provider: "new" };
    const cacheKey = buildGoogleManualSearchCacheKey(cacheRequest);
    const results = await serverGooglePlacesSingleFlight.getOrCreate(
      cacheKey,
      () => performGooglePlacesNewSearch(request),
    );

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const code = getGooglePlacesErrorCode(error);
    if (code) {
      if (shouldFallbackToLegacy(error)) {
        void recordGooglePlacesFailure(mode, code);
      }
      console.error("[GOOGLE_PLACES_NEW_SEARCH_ERROR]", { mode, code, error });
      return errorResponse(error);
    }

    console.error("[GOOGLE_PLACES_NEW_SEARCH_ERROR]", error);
    return NextResponse.json(
      {
        error: "Serviço temporariamente indisponível para a busca do Google Maps.",
        code: "GOOGLE_PLACES_RATE_LIMITER_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
