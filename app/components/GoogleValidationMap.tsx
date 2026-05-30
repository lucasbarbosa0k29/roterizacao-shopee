"use client";

import React, { useEffect, useRef, useState } from "react";

type LatLng = { lat: number; lng: number };

type GoogleSearchResult = {
  id: string;
  name: string;
  address: string;
  pos: LatLng;
};

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

function splitTerms(value: unknown) {
  return normalizeText(value)
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
}

function distanceMeters(a: LatLng, b: LatLng) {
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
  result: GoogleSearchResult;
  searchText?: string;
  queryContext?: string;
  city?: string;
  district?: string;
  center?: LatLng | null;
}) {
  const name = normalizeText(params.result.name);
  const address = normalizeText(params.result.address);
  const combined = `${name} ${address}`.trim();

  const searchTerms = splitTerms(params.searchText);
  const contextTerms = splitTerms(params.queryContext);
  const cityTerms = splitTerms(params.city);
  const districtTerms = splitTerms(params.district);

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

  if (params.center) {
    const meters = distanceMeters(params.center, params.result.pos);
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

function sortGoogleResults(
  results: GoogleSearchResult[],
  context: {
    searchText?: string;
    queryContext?: string;
    city?: string;
    district?: string;
    center?: LatLng | null;
  }
) {
  return results
    .map((result, index) => ({
      result,
      index,
      score: scoreGooglePlaceResult({ result, ...context }),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((item) => item.result);
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
            zoom: center ? 17 : 13,
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

  function runManualSearch() {
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
            sortGoogleResults(mappedResults, {
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
    markerRef.current.setPosition(center);
    mapRef.current.setCenter(center);
    mapRef.current.setZoom(17);
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
