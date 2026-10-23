"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  compareGoogleManualSearchResults,
  sortGoogleManualSearchResults,
  type GoogleManualSearchLatLng,
  type GoogleManualSearchRequest,
  type GoogleManualSearchResult,
} from "@/app/lib/google-manual-search";
import {
  buildGoogleManualSearchCacheKey,
  googleManualSearchCache,
} from "@/app/lib/google-manual-search-cache";
import {
  getGooglePlacesErrorCode,
  getGooglePlacesUserMessage,
  shouldFallbackToLegacy,
} from "@/app/lib/google-places-new";

type LatLng = GoogleManualSearchLatLng;
type GoogleSearchResult = GoogleManualSearchResult;

type Props = {
  center?: LatLng | null;
  queryContext?: string;
  searchText?: string;
  searchRequestId?: number;
  city?: string;
  district?: string;
  onSearchLoading?: (loading: boolean) => void;
  onSearchMessage?: (message: string) => void;
  onSearchResults?: (results: GoogleSearchResult[]) => void;
  onPick: (pos: LatLng) => void;
};

const GOOGLE_MAPS_SCRIPT_ID = "google-maps-js-api";
const DEFAULT_GOIANIA_CENTER: LatLng = { lat: -16.6869, lng: -49.2643 };
const DEFAULT_APARECIDA_CENTER: LatLng = { lat: -16.8233, lng: -49.2439 };
const GOOGLE_PIN_ZOOM = 19;
const GOOGLE_FALLBACK_ZOOM = 13;
const GOOGLE_MAPS_UNAVAILABLE_MESSAGE =
  "Google Maps indisponivel no momento. Verifique se o faturamento e as restricoes da chave estao ativos no Google Cloud.";

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFallbackCenter(city?: string): LatLng {
  const normalizedCity = normalizeText(city);
  if (normalizedCity.includes("aparecida")) {
    return DEFAULT_APARECIDA_CENTER;
  }
  if (normalizedCity.includes("goiania")) {
    return DEFAULT_GOIANIA_CENTER;
  }
  return DEFAULT_APARECIDA_CENTER;
}

function syncGoogleMapToCenter(args: {
  google: any;
  map: any;
  marker: any;
  center: LatLng;
  zoom: number;
}) {
  const { google, map, marker, center, zoom } = args;
  marker.setPosition(center);
  map.setCenter(center);
  map.setZoom(zoom);
  google.maps.event.trigger(map, "resize");
  map.setCenter(center);
  map.setZoom(zoom);
}

let googleMapsPromise: Promise<any> | null = null;
let googleMapsAuthFailed = false;
let googleAuthFailureHookInstalled = false;
let previousGmAuthFailure: any = null;
const googleAuthFailureListeners = new Set<() => void>();

function notifyGoogleAuthFailure() {
  googleMapsAuthFailed = true;
  for (const listener of Array.from(googleAuthFailureListeners)) {
    try {
      listener();
    } catch {}
  }
}

function installGoogleAuthFailureHook() {
  if (typeof window === "undefined" || googleAuthFailureHookInstalled) return;

  googleAuthFailureHookInstalled = true;
  previousGmAuthFailure = (window as any).gm_authFailure;

  (window as any).gm_authFailure = () => {
    notifyGoogleAuthFailure();
    if (typeof previousGmAuthFailure === "function") {
      try {
        previousGmAuthFailure();
      } catch {}
    }
  };
}

function onGoogleAuthFailure(listener: () => void) {
  googleAuthFailureListeners.add(listener);
  return () => {
    googleAuthFailureListeners.delete(listener);
  };
}

function loadGoogleMaps(apiKey: string) {
  if (typeof window === "undefined") return Promise.reject(new Error("window unavailable"));

  installGoogleAuthFailureHook();

  if (googleMapsAuthFailed) return Promise.reject(new Error("Google Maps auth failed"));
  if ((window as any).google?.maps?.Map) return Promise.resolve((window as any).google);
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener(
        "load",
        () => {
          const google = (window as any).google;
          if (googleMapsAuthFailed || !google?.maps?.Map) {
            reject(new Error("Google Maps did not initialize"));
            return;
          }
          resolve(google);
        },
        { once: true }
      );
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      "&v=weekly&language=pt-BR&region=BR&libraries=places";
    script.onload = () => {
      window.setTimeout(() => {
        const google = (window as any).google;
        if (googleMapsAuthFailed || !google?.maps?.Map) {
          reject(new Error("Google Maps did not initialize"));
          return;
        }
        resolve(google);
      }, 0);
    };
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

type GoogleManualSearchMode = "legacy" | "new" | "compare";

const GOOGLE_MANUAL_SEARCH_RADIUS_M = 12000;
const GOOGLE_MANUAL_SEARCH_LANGUAGE = "pt-BR";
const GOOGLE_MANUAL_SEARCH_REGION = "BR";

function getGoogleManualSearchMode(): GoogleManualSearchMode {
  const mode = String(
    process.env.NEXT_PUBLIC_GOOGLE_PLACES_MANUAL_SEARCH_MODE || "legacy",
  ).toLowerCase();
  if (mode === "new" || mode === "compare") return mode;
  return "legacy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeNewSearchResults(payload: unknown): GoogleSearchResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return [];

  return payload.results.filter((value: unknown): value is GoogleSearchResult => {
    if (!isRecord(value) || !isRecord(value.pos)) return false;
    return (
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.address === "string" &&
      isFiniteCoordinate(value.pos.lat) &&
      isFiniteCoordinate(value.pos.lng) &&
      value.pos.lat >= -90 &&
      value.pos.lat <= 90 &&
      value.pos.lng >= -180 &&
      value.pos.lng <= 180
    );
  });
}

function buildGooglePlacesClientError(message: string, code?: unknown) {
  const error = new Error(message) as Error & { code?: string };
  if (typeof code === "string") error.code = code;
  return error;
}

function GoogleValidationMap({
  center,
  queryContext,
  searchText,
  searchRequestId = 0,
  city,
  district,
  onSearchLoading,
  onSearchMessage,
  onSearchResults,
  onPick,
}: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const clickListenerRef = useRef<any>(null);
  const placesServiceRef = useRef<any>(null);
  const internalPickKeyRef = useRef("");
  const searchRunIdRef = useRef(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const apiKey = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
    if (!apiKey) {
      setError(GOOGLE_MAPS_UNAVAILABLE_MESSAGE);
      return;
    }

    let cancelled = false;
    const setUnavailableError = () => {
      if (!cancelled) setError(GOOGLE_MAPS_UNAVAILABLE_MESSAGE);
    };
    const removeAuthFailureListener = onGoogleAuthFailure(setUnavailableError);

    loadGoogleMaps(apiKey)
      .then((google) => {
        if (cancelled || !divRef.current) return;
        if (googleMapsAuthFailed || !google?.maps?.Map || !google?.maps?.places?.PlacesService) {
          setUnavailableError();
          return;
        }

        const initial = center ?? getFallbackCenter(city);
        let map: any = null;
        let marker: any = null;

        try {
          map = new google.maps.Map(divRef.current, {
            center: initial,
            zoom: center ? GOOGLE_PIN_ZOOM : GOOGLE_FALLBACK_ZOOM,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
            zoomControl: true,
          });

          marker = new google.maps.Marker({
            position: initial,
            map,
            draggable: false,
          });

          placesServiceRef.current = new google.maps.places.PlacesService(map);
        } catch {
          setUnavailableError();
          return;
        }

        if (cancelled || googleMapsAuthFailed) {
          try {
            marker?.setMap?.(null);
          } catch {}
          setUnavailableError();
          return;
        }

        const pick = (pos: LatLng) => {
          internalPickKeyRef.current = `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;
          marker.setPosition(pos);
          onSearchResults?.([]);
          onPick(pos);
        };

        clickListenerRef.current = map.addListener("click", (event: any) => {
          const latLng = event?.latLng;
          if (!latLng) return;
          pick({ lat: latLng.lat(), lng: latLng.lng() });
        });

        mapRef.current = map;
        markerRef.current = marker;

        const stableZoom = center ? GOOGLE_PIN_ZOOM : GOOGLE_FALLBACK_ZOOM;
        syncGoogleMapToCenter({ google, map, marker, center: initial, zoom: stableZoom });
        let didPostLoadSync = false;
        const syncAfterGoogleLoad = () => {
          if (didPostLoadSync || cancelled || mapRef.current !== map || markerRef.current !== marker) return;
          didPostLoadSync = true;
          syncGoogleMapToCenter({ google, map, marker, center: initial, zoom: stableZoom });
        };
        google.maps.event.addListenerOnce(map, "idle", syncAfterGoogleLoad);
        google.maps.event.addListenerOnce(map, "tilesloaded", syncAfterGoogleLoad);
        window.requestAnimationFrame(() => {
          if (cancelled || mapRef.current !== map || markerRef.current !== marker) return;
          syncGoogleMapToCenter({ google, map, marker, center: initial, zoom: stableZoom });
        });
        window.setTimeout(() => {
          if (cancelled || mapRef.current !== map || markerRef.current !== marker) return;
          syncGoogleMapToCenter({ google, map, marker, center: initial, zoom: stableZoom });
        }, 120);
      })
      .catch(() => {
        setUnavailableError();
      });

    return () => {
      cancelled = true;
      removeAuthFailureListener();
      try {
        clickListenerRef.current?.remove?.();
      } catch {}
      try {
        markerRef.current?.setMap?.(null);
      } catch {}
      if (divRef.current) {
        divRef.current.replaceChildren();
      }
      searchRunIdRef.current += 1;
      clickListenerRef.current = null;
      markerRef.current = null;
      placesServiceRef.current = null;
      mapRef.current = null;
    };
  }, []);

  function buildSearchQuery() {
    return [searchText, queryContext, district, city, "GO", "Brasil"]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(", ");
  }

  /*
  function runLegacyManualSearchWithoutCache() {
    const service = placesServiceRef.current;
    const map = mapRef.current;
    const marker = markerRef.current;
    const query = buildSearchQuery();
    const runId = searchRunIdRef.current + 1;
    searchRunIdRef.current = runId;

    onSearchMessage?.("");
    onSearchResults?.([]);
    if (!query || !service || !map || !marker) return;

    const searchCenter = center ?? getFallbackCenter(city);

    let finished = false;
    const timeoutMs = 12000;
    const timeoutId = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      onSearchLoading?.(false);
      onSearchMessage?.("Não foi possível buscar no Google Maps. Tente novamente.");
      if (process.env.NODE_ENV !== "production") {
        console.warn("[GoogleValidationMap] textSearch timeout", { query });
      }
    }, timeoutMs);

    const done = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeoutId);
      onSearchLoading?.(false);
    };

    onSearchLoading?.(true);
    try {
      service.textSearch(
        {
          query,
          location: new (window as any).google.maps.LatLng(searchCenter.lat, searchCenter.lng),
          radius: 12000,
        },
        (results: any[], status: string) => {
          if (searchRunIdRef.current !== runId) return;
          done();

          const google = (window as any).google;
          const okStatus = google?.maps?.places?.PlacesServiceStatus?.OK;

          if (status !== okStatus) {
            if (status !== google?.maps?.places?.PlacesServiceStatus?.ZERO_RESULTS && process.env.NODE_ENV !== "production") {
              console.warn("[GoogleValidationMap] textSearch non-OK status", { query, status });
            }
            if (status === google?.maps?.places?.PlacesServiceStatus?.ZERO_RESULTS) {
              onSearchMessage?.("Nenhum resultado encontrado no Google Maps.");
              return;
            }
            onSearchMessage?.("Não foi possível buscar no Google Maps. Tente novamente.");
            return;
          }

          if (!results?.length) {
            onSearchMessage?.("Nenhum resultado encontrado no Google Maps.");
            return;
          }

          const mappedResults: GoogleSearchResult[] = results
            .map((result: any, idx: number) => {
              const location = result?.geometry?.location;
              if (!location) return null;
              return {
                id: String(result?.place_id || idx),
                name: String(result?.name || "Resultado sem nome"),
                address: String(result?.formatted_address || result?.vicinity || ""),
                pos: { lat: location.lat(), lng: location.lng() },
              };
            })
            .filter(Boolean) as GoogleSearchResult[];

          if (!mappedResults.length) {
            onSearchMessage?.("Nenhum resultado encontrado no Google Maps.");
            return;
          }

          onSearchResults?.(
            sortGoogleManualSearchResults(mappedResults, {
              searchText,
              queryContext,
              city,
              district,
              center,
            }).slice(0, 5)
          );
        }
      );
    } catch (error) {
      if (searchRunIdRef.current !== runId) return;
      done();
      onSearchMessage?.("Não foi possível buscar no Google Maps. Tente novamente.");
      if (process.env.NODE_ENV !== "production") {
        console.warn("[GoogleValidationMap] textSearch threw", { query, error });
      }
    }
  }
  */

  function runLegacySearch(
    request: GoogleManualSearchRequest,
  ): Promise<GoogleSearchResult[]> {
    const service = placesServiceRef.current;
    if (!service) return Promise.reject(new Error("GOOGLE_PLACES_LEGACY_UNAVAILABLE"));

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("GOOGLE_PLACES_LEGACY_TIMEOUT"));
      }, 12000);

      const finish = (factory: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        factory();
      };

      try {
        service.textSearch(
          {
            query: request.query,
            location: new (window as any).google.maps.LatLng(
              request.center.lat,
              request.center.lng,
            ),
            radius: request.radius,
          },
          (results: any[], status: string) => {
            const google = (window as any).google;
            const okStatus = google?.maps?.places?.PlacesServiceStatus?.OK;
            const zeroResultsStatus = google?.maps?.places?.PlacesServiceStatus?.ZERO_RESULTS;

            if (status !== okStatus && status !== zeroResultsStatus) {
              if (process.env.NODE_ENV !== "production") {
                console.warn("[GoogleValidationMap] legacy textSearch non-OK status", {
                  query: request.query,
                  status,
                });
              }
              finish(() => reject(new Error(`GOOGLE_PLACES_LEGACY_${status}`)));
              return;
            }

            const mappedResults: GoogleSearchResult[] = (results || [])
              .map((result: any, idx: number) => {
                const location = result?.geometry?.location;
                if (!location) return null;
                return {
                  id: String(result?.place_id || idx),
                  name: String(result?.name || "Resultado sem nome"),
                  address: String(result?.formatted_address || result?.vicinity || ""),
                  pos: { lat: location.lat(), lng: location.lng() },
                } satisfies GoogleSearchResult;
              })
              .filter(Boolean) as GoogleSearchResult[];

            finish(() => resolve(mappedResults));
          },
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  async function runNewSearch(
    request: GoogleManualSearchRequest,
    mode: "new" | "compare" = "new",
  ): Promise<GoogleSearchResult[]> {
    const response = await fetch("/api/google-places/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: request.query,
        city: request.city,
        district: request.district,
        center: request.center,
        radius: request.radius,
        language: request.language,
        region: request.region,
        mode,
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `GOOGLE_PLACES_NEW_HTTP_${response.status}`;
      throw buildGooglePlacesClientError(
        errorMessage,
        isRecord(payload) ? payload.code : undefined,
      );
    }
    const results = normalizeNewSearchResults(payload);
    if (
      isRecord(payload) &&
      Array.isArray(payload.results) &&
      payload.results.length > 0 &&
      results.length === 0
    ) {
      throw buildGooglePlacesClientError(
        "Resposta inválida do Google Places.",
        "GOOGLE_PLACES_NEW_INVALID_RESPONSE",
      );
    }
    return results;
  }

  function cacheSearch(
    request: GoogleManualSearchRequest,
    factory: () => Promise<GoogleSearchResult[]>,
  ) {
    return googleManualSearchCache.getOrCreate(
      buildGoogleManualSearchCacheKey(request),
      factory,
    );
  }

  async function runManualSearch() {
    const map = mapRef.current;
    const marker = markerRef.current;
    const query = buildSearchQuery();
    const runId = searchRunIdRef.current + 1;
    searchRunIdRef.current = runId;
    const mode = getGoogleManualSearchMode();

    onSearchMessage?.("");
    onSearchResults?.([]);
    if (!query || !map || !marker) return;
    if ((mode === "legacy" || mode === "compare") && !placesServiceRef.current) return;

    const searchCenter = center ?? getFallbackCenter(city);
    const requestBase = {
      query,
      city: String(city || "").trim(),
      district: String(district || "").trim(),
      center: searchCenter,
      radius: GOOGLE_MANUAL_SEARCH_RADIUS_M,
      language: GOOGLE_MANUAL_SEARCH_LANGUAGE,
      region: GOOGLE_MANUAL_SEARCH_REGION,
    } satisfies Omit<GoogleManualSearchRequest, "provider">;
    const legacyRequest: GoogleManualSearchRequest = { ...requestBase, provider: "legacy" };
    const newRequest: GoogleManualSearchRequest = { ...requestBase, provider: "new" };

    onSearchLoading?.(true);
    try {
      let results: GoogleSearchResult[] = [];

      if (mode === "legacy") {
        results = await cacheSearch(legacyRequest, () => runLegacySearch(legacyRequest));
      } else if (mode === "new") {
        try {
          results = await cacheSearch(newRequest, () => runNewSearch(newRequest));
        } catch (error) {
          if (!shouldFallbackToLegacy(error)) throw error;
          console.warn("[GoogleValidationMap] Places New failed; falling back to Legacy", {
            code: getGooglePlacesErrorCode(error),
          });
          results = await cacheSearch(legacyRequest, () => runLegacySearch(legacyRequest));
        }
      } else {
        let newResults: GoogleSearchResult[];
        try {
          newResults = await cacheSearch(newRequest, () => runNewSearch(newRequest, "compare"));
        } catch (error) {
          if (!shouldFallbackToLegacy(error)) throw error;
          console.warn("[GoogleValidationMap] Compare New failed; using Legacy", {
            code: getGooglePlacesErrorCode(error),
          });
          results = await cacheSearch(legacyRequest, () => runLegacySearch(legacyRequest));
          newResults = [];
        }

        if (newResults.length || results.length === 0) {
          try {
            const legacyResults = await cacheSearch(
              legacyRequest,
              () => runLegacySearch(legacyRequest),
            );
            const comparisonOptions = {
              searchText,
              queryContext,
              city,
              district,
              center,
            };
            const finalLegacy = sortGoogleManualSearchResults(
              legacyResults,
              comparisonOptions,
            ).slice(0, 5);
            const finalNew = sortGoogleManualSearchResults(
              newResults,
              comparisonOptions,
            ).slice(0, 5);
            results = finalLegacy;
            console.info("[GOOGLE_PLACES_MANUAL_COMPARE]", {
              query,
              displayedProvider: "legacy",
              comparison: compareGoogleManualSearchResults(finalLegacy, finalNew),
            });
          } catch (legacyError) {
            results = newResults;
            console.warn("[GoogleValidationMap] Legacy failed during compare", legacyError);
          }
        }
      }

      if (searchRunIdRef.current !== runId) return;
      if (!results.length) {
        onSearchMessage?.("Nenhum resultado encontrado no Google Maps.");
        return;
      }

      onSearchResults?.(
        sortGoogleManualSearchResults(results, {
          searchText,
          queryContext,
          city,
          district,
          center,
        }).slice(0, 5),
      );
    } catch (error) {
      if (searchRunIdRef.current !== runId) return;
      onSearchMessage?.(getGooglePlacesUserMessage(error));
      if (process.env.NODE_ENV !== "production") {
        console.warn("[GoogleValidationMap] manual search failed", { query, mode, error });
      }
    } finally {
      if (searchRunIdRef.current === runId) onSearchLoading?.(false);
    }
  }

  useEffect(() => {
    if (!searchRequestId) return;
    runManualSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequestId]);

  useEffect(() => {
    if (!center || !mapRef.current || !markerRef.current) return;
    const centerKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    if (internalPickKeyRef.current === centerKey) {
      internalPickKeyRef.current = "";
      return;
    }
    const google = (window as any).google;
    if (google?.maps?.event) {
      syncGoogleMapToCenter({
        google,
        map: mapRef.current,
        marker: markerRef.current,
        center,
        zoom: GOOGLE_PIN_ZOOM,
      });
      return;
    }
    markerRef.current.setPosition(center);
    mapRef.current.setZoom(GOOGLE_PIN_ZOOM);
    mapRef.current.setCenter(center);
  }, [center]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 px-4">
        <div className="max-w-md rounded-2xl border bg-white/95 p-5 text-center shadow-lg">
          <div className="text-lg font-bold text-slate-900">Google Maps</div>
          <div className="mt-2 text-sm font-medium text-slate-700">
            Google Maps indisponivel no momento.
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Verifique se o faturamento e as restricoes da chave estao ativos no Google Cloud.
          </div>
        </div>
      </div>
    );
  }

  return <div ref={divRef} className="h-full w-full bg-white" />;
}

export default React.memo(GoogleValidationMap);
