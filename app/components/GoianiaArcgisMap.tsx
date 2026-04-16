"use client";

import React, { useEffect, useRef } from "react";

type Props = {
  center?: { lat: number; lng: number } | null;
  onPick: (pos: { lat: number; lng: number }) => void;
};

const GOIANIA_LOTES_URL = "/data/goiania_lotes.geojson";
const ARCGIS_THEME_ID = "arcgis-theme-light-css";
const ARCGIS_THEME_HREF =
  "https://js.arcgis.com/4.34/@arcgis/core/assets/esri/themes/light/main.css";

let arcgisModulesPromise: Promise<any[]> | null = null;

function loadArcgisModules() {
  if (!arcgisModulesPromise) {
    arcgisModulesPromise = Promise.all([
      import("@arcgis/core/config"),
      import("@arcgis/core/Map"),
      import("@arcgis/core/layers/GeoJSONLayer"),
      import("@arcgis/core/views/MapView"),
      import("@arcgis/core/Graphic"),
      import("@arcgis/core/geometry/Point"),
      import("@arcgis/core/widgets/Search"),
      import("@arcgis/core/renderers/SimpleRenderer"),
      import("@arcgis/core/layers/support/LabelClass"),
    ]);
  }
  return arcgisModulesPromise;
}

function ensureArcgisThemeCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById(ARCGIS_THEME_ID)) return;

  const link = document.createElement("link");
  link.id = ARCGIS_THEME_ID;
  link.rel = "stylesheet";
  link.href = ARCGIS_THEME_HREF;
  document.head.appendChild(link);
}

// SINGLETONS (mantem o mapa vivo, sem flash)
let sharedView: any = null;
let sharedMap: any = null;
let sharedLotLayer: any = null;
let sharedMarker: any = null;
let sharedSelectedLotGraphic: any = null;
let sharedGraphic: any = null;
let sharedPoint: any = null;
let sharedSearch: any = null;
let mapInitialized = false;

// controle anti-flash
let suppressNextCenterGoTo = false;
let lastExternalCenterKey = "";

function formatCoord(value: number) {
  return Number(value).toFixed(6);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export default function GoianiaArcgisMap({ center, onPick }: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);

  // =========================
  // INIT / REATTACH
  // =========================
  useEffect(() => {
    ensureArcgisThemeCss();

    if (mapInitialized) {
      if (divRef.current && sharedView) {
        sharedView.container = divRef.current;

        if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
          const key = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;

          if (key !== lastExternalCenterKey) {
            lastExternalCenterKey = key;
            suppressNextCenterGoTo = false;

            Promise.resolve(sharedView.when?.()).then(() => {
              try {
                sharedView.goTo(
                  { center: [center.lng, center.lat], zoom: 18 },
                  { animate: false }
                );
              } catch {}

              setMarker(center.lat, center.lng);
            });
          } else {
            setMarker(center.lat, center.lng);
          }
        }
      }
      return;
    }

    mapInitialized = true;

    (async () => {
      try {
        const [
          { default: esriConfig },
          { default: Map },
          { default: GeoJSONLayer },
          { default: MapView },
          { default: Graphic },
          { default: Point },
          { default: Search },
          { default: SimpleRenderer },
          { default: LabelClass },
        ] = await loadArcgisModules();

        const apiKey = process.env.NEXT_PUBLIC_ARCGIS_API_KEY;
        if (apiKey) esriConfig.apiKey = apiKey;

        if (!divRef.current) {
          mapInitialized = false;
          return;
        }

        if (!sharedLotLayer) {
          sharedLotLayer = new GeoJSONLayer({
            url: GOIANIA_LOTES_URL,
            title: "mapa_goiania_local",
            outFields: ["*"],
            labelsVisible: true,
            labelingInfo: [
              new LabelClass({
                labelExpressionInfo: {
                  expression: `
                    var q = DefaultValue($feature.nm_qdr, "");
                    var l = DefaultValue($feature.nm_lot, "");
                    return "Qd " + q + " Lt " + l;
                  `,
                },
                symbol: {
                  type: "text",
                  color: [24, 24, 27, 0.92],
                  haloColor: [245, 241, 232, 0.95],
                  haloSize: 1.2,
                  font: {
                    family: "Arial",
                    size: 9,
                    weight: "normal",
                  },
                },
                labelPlacement: "always-horizontal",
                minScale: 4000,
                maxScale: 0,
              }),
            ],
            renderer: new SimpleRenderer({
              symbol: {
                type: "simple-fill",
                color: [0, 0, 0, 0],
                outline: {
                  color: [38, 38, 38, 0.88],
                  width: 0.7,
                },
              },
            }),
            popupTemplate: {
              title: "Goiânia",
              content: [
                {
                  type: "fields",
                  fieldInfos: [
                    { fieldName: "nm_qdr", label: "Quadra" },
                    { fieldName: "nm_lot", label: "Lote" },
                  ],
                },
              ],
            },
          });
        }

        if (!sharedMap) {
          sharedMap = new Map({
            basemap: "topo-vector",
          });
        }

        sharedView = new MapView({
          container: divRef.current,
          map: sharedMap,
          center: center ? [center.lng, center.lat] : [-49.2643, -16.6869],
          zoom: center ? 18 : 16,
        });

        try {
          sharedView.popup.autoPanEnabled = false;
        } catch {}

        sharedGraphic = Graphic;
        sharedPoint = Point;

        if (!sharedSearch) {
          sharedSearch = new Search({
            view: sharedView,
            includeDefaultSources: true,
          });
          sharedView.ui.add(sharedSearch, "top-right");
        }

        sharedView.on("click", (event: any) => {
          const p = sharedView.toMap({ x: event.x, y: event.y });
          if (!p) return;

          const lat = Number(p.latitude);
          const lng = Number(p.longitude);

          suppressNextCenterGoTo = true;
          setMarker(lat, lng);
          onPick({ lat, lng });

          Promise.resolve(
            sharedView.hitTest(event, { include: [sharedLotLayer] })
          )
            .then((hit: any) => {
              const feature =
                hit?.results?.find((r: any) => r?.graphic?.layer === sharedLotLayer)?.graphic ||
                null;

              if (!feature) {
                clearSelectedLot();
                try {
                  sharedView.popup.close();
                } catch {}
                return;
              }

              highlightSelectedLot(feature);
              openLotPopup(feature, lat, lng);
            })
            .catch((err: any) => {
              console.error("[GoianiaArcgisMap] hitTest failed:", err);
            });
        });

        if (center) {
          lastExternalCenterKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;

          try {
            await sharedView.when?.();
            await sharedView.goTo(
              { center: [center.lng, center.lat], zoom: 18 },
              { animate: false }
            );
          } catch {}

          setMarker(center.lat, center.lng);
        }

        if (!sharedMap.layers.includes(sharedLotLayer)) {
          sharedMap.add(sharedLotLayer);
        }
      } catch (err) {
        console.error("[GoianiaArcgisMap] init failed:", err);

        try {
          sharedView?.destroy?.();
        } catch {}

        sharedView = null;
        sharedMap = null;
        sharedLotLayer = null;
        sharedSearch = null;
        sharedMarker = null;
        sharedSelectedLotGraphic = null;
        sharedGraphic = null;
        sharedPoint = null;
        mapInitialized = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (key === lastExternalCenterKey) {
      setMarker(center.lat, center.lng);
      return;
    }

    lastExternalCenterKey = key;

    try {
      sharedView.goTo(
        { center: [center.lng, center.lat], zoom: 18 },
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

  function clearSelectedLot() {
    if (!sharedView || !sharedSelectedLotGraphic) return;

    try {
      sharedView.graphics.remove(sharedSelectedLotGraphic);
    } catch {}

    sharedSelectedLotGraphic = null;
  }

  function highlightSelectedLot(feature: any) {
    if (!sharedView || !sharedGraphic || !feature?.geometry) return;

    clearSelectedLot();

    sharedSelectedLotGraphic = new sharedGraphic({
      geometry: feature.geometry,
      symbol: {
        type: "simple-fill",
        color: [255, 255, 255, 0.04],
        outline: {
          color: [17, 24, 39, 0.98],
          width: 1.6,
        },
      },
    });

    sharedView.graphics.add(sharedSelectedLotGraphic);
  }

  function openLotPopup(feature: any, lat: number, lng: number) {
    if (!sharedView || !feature) return;

    const attrs = feature.attributes || {};
    const quadra = escapeHtml(attrs.nm_qdr || "");
    const lote = escapeHtml(attrs.nm_lot || "");
    const latText = formatCoord(lat);
    const lngText = formatCoord(lng);

    try {
      sharedView.popup.open({
        location: {
          type: "point",
          latitude: lat,
          longitude: lng,
        },
        title: "Goiânia",
        content: `
          <div style="font-size:13px; line-height:1.5;">
            <div><strong>Coordenadas:</strong> ${latText}, ${lngText}</div>
            <div style="height:8px;"></div>
            <div><strong>Quadra:</strong> ${quadra || "-"}</div>
            <div style="height:8px;"></div>
            <div><strong>Lote:</strong> ${lote || "-"}</div>
          </div>
        `,
      });
    } catch {}
  }

  // =========================
  // BOTAO CENTRALIZAR NO PINO
  // =========================
  function goToPin() {
    if (!sharedView || !sharedMarker) return;

    try {
      sharedView.goTo({ target: sharedMarker.geometry, zoom: 18 }, { animate: true });
    } catch {}
  }

  return (
    <div className="relative w-full h-full bg-white">
      <div ref={divRef} className="absolute inset-0" />

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
