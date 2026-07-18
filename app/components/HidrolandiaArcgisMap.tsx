"use client";

import React, { useEffect, useRef } from "react";

type Props = {
  center?: { lat: number; lng: number } | null;
  onPick: (pos: { lat: number; lng: number }) => void;
};

type HidrolandiaLayerKey = "setores" | "quadras" | "lotes" | "ruas";

type LayerConfig = {
  key: HidrolandiaLayerKey;
  title: string;
  url: string;
  geometry: "polygon" | "line";
  visible: boolean;
  outFields: string[];
  labelExpression: string;
  labelMinScale: number;
  fields: { fieldName: string; label: string }[];
};

const ARCGIS_THEME_ID = "arcgis-theme-light-css";
const ARCGIS_THEME_HREF =
  "https://js.arcgis.com/4.34/@arcgis/core/assets/esri/themes/light/main.css";

const LAYER_CONFIGS: LayerConfig[] = [
  {
    key: "setores",
    title: "Hidrolandia - Setores",
    url: "/data/hidrolandia/hidrolandia_setores_mapa.web4326.geojson",
    geometry: "polygon",
    visible: false,
    outFields: ["cidade", "tipo", "setor", "source"],
    labelExpression: `return DefaultValue($feature.setor, "");`,
    labelMinScale: 50000,
    fields: [
      { fieldName: "setor", label: "Setor" },
      { fieldName: "tipo", label: "Tipo" },
    ],
  },
  {
    key: "quadras",
    title: "Hidrolandia - Quadras",
    url: "/data/hidrolandia/hidrolandia_quadras_mapa.web4326.geojson",
    geometry: "polygon",
    visible: true,
    outFields: ["cidade", "tipo", "setor", "quadra", "source"],
    labelExpression: `
      var q = Trim(DefaultValue($feature.quadra, ""));
      if (IsEmpty(q)) {
        return "";
      }
      return "Qd " + q;
    `,
    labelMinScale: 12000,
    fields: [
      { fieldName: "setor", label: "Setor" },
      { fieldName: "quadra", label: "Quadra" },
      { fieldName: "tipo", label: "Tipo" },
    ],
  },
  {
    key: "lotes",
    title: "Hidrolandia - Lotes",
    url: "/data/hidrolandia/hidrolandia_lotes_mapa.web4326.geojson",
    geometry: "polygon",
    visible: true,
    outFields: ["cidade", "tipo", "setor", "quadra", "lote", "rua", "source"],
    labelExpression: `
      var q = Trim(DefaultValue($feature.quadra, ""));
      var l = Trim(DefaultValue($feature.lote, ""));
      if (IsEmpty(q) || IsEmpty(l)) {
        return "";
      }
      return "Qd " + q + " Lt " + l;
    `,
    labelMinScale: 4000,
    fields: [
      { fieldName: "setor", label: "Setor" },
      { fieldName: "quadra", label: "Quadra" },
      { fieldName: "lote", label: "Lote" },
      { fieldName: "rua", label: "Rua" },
      { fieldName: "tipo", label: "Tipo" },
    ],
  },
  {
    key: "ruas",
    title: "Hidrolandia - Ruas",
    url: "/data/hidrolandia/hidrolandia_ruas_mapa.web4326.geojson",
    geometry: "line",
    visible: false,
    outFields: ["cidade", "tipo", "nome_rua", "comprimento", "source"],
    labelExpression: `return DefaultValue($feature.nome_rua, "");`,
    labelMinScale: 16000,
    fields: [
      { fieldName: "nome_rua", label: "Rua" },
      { fieldName: "comprimento", label: "Comprimento" },
      { fieldName: "tipo", label: "Tipo" },
    ],
  },
];

let arcgisModulesPromise: Promise<any[]> | null = null;
let sharedView: any = null;
let sharedMap: any = null;
let sharedLayers: Partial<Record<HidrolandiaLayerKey, any>> = {};
let sharedMarker: any = null;
let sharedSelectedGraphic: any = null;
let sharedGraphic: any = null;
let sharedPoint: any = null;
let sharedSearch: any = null;
let sharedClickHandle: any = null;
let latestOnPick: Props["onPick"] | null = null;
let mapInitialized = false;
let suppressNextCenterGoTo = false;
let lastExternalCenterKey = "";

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

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function configureMobilePopup(view: any) {
  if (!view?.popup || !isMobileViewport()) return;

  try {
    view.popup.dockEnabled = false;
    view.popup.dockOptions = {
      buttonEnabled: false,
      breakpoint: false,
    };
    view.popup.visibleElements = {
      closeButton: true,
      collapseButton: false,
      actionBar: false,
      featureNavigation: false,
    };
  } catch {}
}

function refreshSharedView() {
  if (!sharedView) return;

  try {
    sharedView.resize?.();
  } catch {}

  try {
    sharedView.requestRender?.();
  } catch {}
}

function attachSharedView(container: HTMLDivElement | null) {
  if (!container || !sharedView) return;

  try {
    if (sharedView.container !== container) {
      sharedView.container = container;
    }
    configureMobilePopup(sharedView);
    requestAnimationFrame(refreshSharedView);
  } catch {}
}

function detachSharedView(container: HTMLDivElement | null) {
  if (!container || !sharedView) return;

  try {
    if (sharedView.container === container) {
      sharedView.container = null;
    }
  } catch {}
}

function absoluteDataUrl(url: string) {
  return typeof window !== "undefined" ? `${window.location.origin}${url}` : url;
}

function buildLayer(
  config: LayerConfig,
  GeoJSONLayer: any,
  SimpleRenderer: any,
  LabelClass: any,
) {
  return new GeoJSONLayer({
    url: absoluteDataUrl(config.url),
    title: config.title,
    outFields: config.outFields,
    visible: config.visible,
    labelsVisible: false,
    popupEnabled: false,
    renderer: new SimpleRenderer({
      symbol:
        config.geometry === "line"
          ? {
              type: "simple-line",
              color: [14, 165, 233, 0.82],
              width: 1.25,
            }
          : {
              type: "simple-fill",
              color: [0, 0, 0, 0.015],
              outline: {
                color: config.key === "lotes" ? [17, 24, 39, 0.88] : [15, 118, 110, 0.78],
                width: config.key === "lotes" ? 0.55 : 0.8,
              },
            },
    }),
    labelingInfo: [
      new LabelClass({
        labelExpressionInfo: { expression: config.labelExpression },
        symbol: {
          type: "text",
          color: [15, 23, 42, 0.92],
          haloColor: [255, 255, 255, 0.96],
          haloSize: 1.2,
          font: {
            family: "Arial",
            size: 9,
            weight: "normal",
          },
        },
        labelPlacement: "always-horizontal",
        minScale: config.labelMinScale,
        maxScale: 0,
      }),
    ],
  });
}

function getLayerConfigByLayer(layer: any) {
  return LAYER_CONFIGS.find((config) => sharedLayers[config.key] === layer) || null;
}

function getHitTestLayers() {
  return LAYER_CONFIGS.map((config) => sharedLayers[config.key]).filter(
    (layer) => Boolean(layer) && layer.visible !== false,
  );
}

export default function HidrolandiaArcgisMap({ center, onPick }: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    latestOnPick = onPick;

    return () => {
      if (latestOnPick === onPick) {
        latestOnPick = null;
      }
    };
  }, [onPick]);

  useEffect(() => {
    ensureArcgisThemeCss();
    const container = divRef.current;

    if (mapInitialized) {
      if (container && sharedView) {
        attachSharedView(container);

        if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
          const key = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;

          if (key !== lastExternalCenterKey) {
            lastExternalCenterKey = key;
            suppressNextCenterGoTo = false;

            Promise.resolve(sharedView.when?.()).then(() => {
              try {
                sharedView.goTo(
                  { center: [center.lng, center.lat], zoom: 18 },
                  { animate: false },
                );
              } catch {}

              setMarker(center.lat, center.lng);
            });
          } else {
            setMarker(center.lat, center.lng);
          }
        }
      }
      return () => detachSharedView(container);
    }

    let mounted = true;
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

        if (!mounted || !container) {
          mapInitialized = false;
          return;
        }

        if (!sharedMap) {
          sharedMap = new Map({
            basemap: "topo-vector",
          });
        }

        if (!Object.keys(sharedLayers).length) {
          sharedLayers = LAYER_CONFIGS.reduce<Partial<Record<HidrolandiaLayerKey, any>>>(
            (acc, config) => {
              acc[config.key] = buildLayer(config, GeoJSONLayer, SimpleRenderer, LabelClass);
              return acc;
            },
            {},
          );
        }

        LAYER_CONFIGS.forEach((config) => {
          const layer = sharedLayers[config.key];
          if (layer && !sharedMap.layers.includes(layer)) {
            sharedMap.add(layer);
          }
        });

        sharedView = new MapView({
          container,
          map: sharedMap,
          center: center ? [center.lng, center.lat] : [-49.3213, -16.9881],
          zoom: center ? 18 : 14,
        });

        try {
          sharedView.popup.autoPanEnabled = false;
        } catch {}
        configureMobilePopup(sharedView);

        sharedGraphic = Graphic;
        sharedPoint = Point;

        if (!sharedSearch) {
          sharedSearch = new Search({
            view: sharedView,
            includeDefaultSources: true,
          });
          sharedView.ui.add(sharedSearch, "top-right");
        }

        if (!sharedClickHandle) sharedClickHandle = sharedView.on("click", (event: any) => {
          const view = sharedView;
          if (!view) return;

          const p = event?.mapPoint ?? view.toMap({ x: event?.x, y: event?.y });
          if (!p) return;

          const lat = Number(p.latitude ?? p.y);
          const lng = Number(p.longitude ?? p.x);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

          suppressNextCenterGoTo = true;
          setMarker(lat, lng);
          latestOnPick?.({ lat, lng });

          const hitLayers = getHitTestLayers();
          if (!hitLayers.length) return;

          Promise.resolve(view.hitTest(event, { include: hitLayers }))
            .then((hit: any) => {
              const feature =
                hit?.results?.find((r: any) => {
                  const layer = r?.graphic?.layer;
                  return layer && hitLayers.includes(layer);
                })?.graphic || null;

              if (!feature) {
                clearSelectedGraphic();
                try {
                  view.popup.close();
                } catch {}
                return;
              }

              highlightSelectedFeature(feature);
              openFeaturePopup(feature, lat, lng);
            })
            .catch((err: any) => {
              console.error("[HidrolandiaArcgisMap] hitTest failed:", err);
            });
        });

        if (center) {
          lastExternalCenterKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;

          try {
            await sharedView.when?.();
            await sharedView.goTo(
              { center: [center.lng, center.lat], zoom: 18 },
              { animate: false },
            );
          } catch {}

          setMarker(center.lat, center.lng);
        }

        for (const config of LAYER_CONFIGS) {
          const layer = sharedLayers[config.key];
          if (!layer) continue;

          try {
            await layer.when?.();
          } catch (error) {
            console.error(`[HidrolandiaArcgisMap] ${config.key} layer failed to load:`, error);
          }
        }
      } catch (error) {
        console.error("[HidrolandiaArcgisMap] init failed:", error);

        try {
          sharedView?.destroy?.();
        } catch {}

        sharedView = null;
        sharedMap = null;
        sharedLayers = {};
        sharedSearch = null;
        sharedMarker = null;
        sharedSelectedGraphic = null;
        sharedClickHandle = null;
        sharedGraphic = null;
        sharedPoint = null;
        mapInitialized = false;
      }
    })();

    return () => {
      mounted = false;
      detachSharedView(container);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const refreshIfAttached = () => {
      if (document.visibilityState === "hidden") return;
      if (sharedView?.container === divRef.current) refreshSharedView();
    };

    document.addEventListener("visibilitychange", refreshIfAttached);
    window.addEventListener("pageshow", refreshIfAttached);
    window.addEventListener("resize", refreshIfAttached);

    return () => {
      document.removeEventListener("visibilitychange", refreshIfAttached);
      window.removeEventListener("pageshow", refreshIfAttached);
      window.removeEventListener("resize", refreshIfAttached);
    };
  }, []);

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
        { animate: false },
      );
    } catch {}

    setMarker(center.lat, center.lng);
  }, [center]);

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

  function clearSelectedGraphic() {
    if (!sharedView || !sharedSelectedGraphic) return;

    try {
      sharedView.graphics.remove(sharedSelectedGraphic);
    } catch {}

    sharedSelectedGraphic = null;
  }

  function highlightSelectedFeature(feature: any) {
    if (!sharedView || !sharedGraphic || !feature?.geometry) return;

    clearSelectedGraphic();

    const config = getLayerConfigByLayer(feature.layer);
    sharedSelectedGraphic = new sharedGraphic({
      geometry: feature.geometry,
      symbol:
        config?.geometry === "line"
          ? {
              type: "simple-line",
              color: [17, 24, 39, 0.98],
              width: 3,
            }
          : {
              type: "simple-fill",
              color: [255, 255, 255, 0.04],
              outline: {
                color: [17, 24, 39, 0.98],
                width: 1.6,
              },
            },
    });

    sharedView.graphics.add(sharedSelectedGraphic);
  }

  function openFeaturePopup(feature: any, lat: number, lng: number) {
    if (!sharedView || !feature) return;

    const config = getLayerConfigByLayer(feature.layer);
    const attrs = feature.attributes || {};
    const latText = formatCoord(lat);
    const lngText = formatCoord(lng);
    const rows = (config?.fields || [])
      .map(({ fieldName, label }) => {
        const value = escapeHtml(attrs[fieldName] || "");
        return `<div style="height:6px;"></div><div><strong>${label}:</strong> ${value || "-"}</div>`;
      })
      .join("");

    try {
      sharedView.popup.open({
        location: {
          type: "point",
          latitude: lat,
          longitude: lng,
        },
        title: config?.title || "Hidrolandia",
        content: `
          <div style="font-size:${isMobileViewport() ? "11px" : "13px"}; line-height:1.35; max-width:${isMobileViewport() ? "220px" : "320px"};">
            <div><strong>Coordenadas:</strong> ${latText}, ${lngText}</div>
            ${rows}
          </div>
        `,
      });
    } catch {}
  }

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
