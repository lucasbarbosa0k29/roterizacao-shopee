"use client";

import React, { useEffect, useRef } from "react";

type Props = {
  center?: { lat: number; lng: number } | null;
  onPick: (pos: { lat: number; lng: number }) => void;
};

// WebMap Aparecida (quadra/lote)
const WEBMAP_ID = "9c9045a200f94fb78ef9b67811c8ca87";

// SINGLETONS (mantém o mapa vivo, sem flash)
let sharedView: any = null;
let sharedWebMap: any = null;
let sharedMarker: any = null;
let sharedGraphic: any = null;
let sharedPoint: any = null;
let sharedSearch: any = null;
let mapInitialized = false;

// controle anti-flash
let suppressNextCenterGoTo = false;
let lastExternalCenterKey = "";

export default function AparecidaArcgisMap({ center, onPick }: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);

  // =========================
  // INIT / REATTACH
  // =========================
  useEffect(() => {
    if (mapInitialized) {
      if (divRef.current && sharedView) {
        sharedView.container = divRef.current;
      }
      return;
    }

    mapInitialized = true;

    (async () => {
      const [
        { default: esriConfig },
        { default: WebMap },
        { default: MapView },
        { default: Graphic },
        { default: Point },
        { default: Search },
      ] = await Promise.all([
        import("@arcgis/core/config"),
        import("@arcgis/core/WebMap"),
        import("@arcgis/core/views/MapView"),
        import("@arcgis/core/Graphic"),
        import("@arcgis/core/geometry/Point"),
        import("@arcgis/core/widgets/Search"),
      ]);

      const apiKey = process.env.NEXT_PUBLIC_ARCGIS_API_KEY;
      if (apiKey) esriConfig.apiKey = apiKey;

      if (!divRef.current) return;

      if (!sharedWebMap) {
        sharedWebMap = new WebMap({
          portalItem: { id: WEBMAP_ID },
        });
      }

      sharedView = new MapView({
        container: divRef.current,
        map: sharedWebMap,
        center: center ? [center.lng, center.lat] : [-49.2439, -16.8233],
        zoom: center ? 18 : 16,
      });

      // evita puxão automático
      try {
        sharedView.popup.autoPanEnabled = false;
      } catch {}

      sharedGraphic = Graphic;
      sharedPoint = Point;

      // Search (uma vez só)
      if (!sharedSearch) {
        sharedSearch = new Search({
          view: sharedView,
          includeDefaultSources: true,
        });
        sharedView.ui.add(sharedSearch, "top-right");
      }

      // Clique no mapa
      sharedView.on("click", (event: any) => {
        const p = sharedView.toMap({ x: event.x, y: event.y });
        if (!p) return;

        const lat = Number(p.latitude);
        const lng = Number(p.longitude);

        suppressNextCenterGoTo = true;
        setMarker(lat, lng);
        onPick({ lat, lng });
      });

      if (center) {
        lastExternalCenterKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
        setMarker(center.lat, center.lng);
      }
    })();
  }, []);

  // =========================
  // UPDATE CENTER (externo)
  // =========================
  useEffect(() => {
    if (!center || !sharedView || !sharedPoint || !sharedGraphic) return;

    if (suppressNextCenterGoTo) {
      suppressNextCenterGoTo = false;
      return;
    }

    const key = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    if (key === lastExternalCenterKey) return;

    lastExternalCenterKey = key;

    try {
      sharedView.goTo(
        { center: [center.lng, center.lat] },
        { animate: false }
      );
    } catch {}

    setMarker(center.lat, center.lng);
  }, [center]);

  // =========================
  // MARKER
  // =========================
  function setMarker(lat: number, lng: number) {
    if (!sharedView || !sharedPoint || !sharedGraphic) return;

    const pt = new sharedPoint({ latitude: lat, longitude: lng });

    if (sharedMarker) {
      sharedView.graphics.remove(sharedMarker);
    }

    sharedMarker = new sharedGraphic({
      geometry: pt,
      symbol: {
        type: "simple-marker",
        style: "circle",
        color: [255, 0, 0, 0.85],
        size: 10,
        outline: { color: [255, 255, 255, 1], width: 2 },
      },
    });

    sharedView.graphics.add(sharedMarker);
  }

  // =========================
  // BOTÃO CENTRALIZAR NO PINO
  // =========================
  function goToPin() {
    if (!sharedView || !sharedMarker) return;

    try {
      sharedView.goTo(
        { target: sharedMarker.geometry },
        { animate: true }
      );
    } catch {}
  }

  return (
    <div className="relative w-full h-full bg-white">
      {/* MAPA */}
      <div ref={divRef} className="absolute inset-0" />

      {/* BOTÃO CENTRALIZAR (estilo Google Maps) */}
      <button
        type="button"
        onClick={goToPin}
        title="Centralizar no ponto"
        className="absolute bottom-20 right-4 z-30 w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-slate-100"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <line x1="12" y1="1" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="1" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="23" y2="12" />
        </svg>
      </button>
    </div>
  );
}