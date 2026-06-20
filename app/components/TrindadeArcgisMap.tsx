/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
"use client";

import React, { useEffect, useRef, useState } from "react";

import {
  formatTrindadeCentroidForPopupClient,
  getTrindadeCentroidClientStats,
  loadTrindadeCentroidsClient,
  searchTrindadeCentroidsClient,
  type TrindadeCentroidRecord as TrindadeCentroidClientRecord,
  type TrindadeCentroidSearchResult as TrindadeCentroidClientSearchResult,
  findTrindadeCentroidByQuadraLoteClient,
  findTrindadeCentroidByStreetBairroClient,
  findTrindadeCentroidByTripleClient,
} from "../lib/trindade-local-centroids.client";

type LayerKey = "quadras" | "lotes" | "logradouros" | "bairros" | "loteamentos";

type ManifestLayer = {
  key: LayerKey;
  file: string;
  label: string;
  visibleByDefault: boolean;
};

type ManifestStatus = {
  ok: boolean;
  message: string;
  outputCrs: string | null;
  cleanedCount: number | null;
  layerCount: number | null;
};

type TrindadePickDetails = {
  lat: number;
  lng: number;
  label: string;
  quadra: string;
  lote: string;
  bairro: string;
  logradouro: string;
  loteamento: string;
  address: string;
  quadraDisplay?: string;
  loteDisplay?: string;
  bairroDisplay?: string;
  logradouroDisplay?: string;
  loteamentoDisplay?: string;
  rawCodes?: {
    cdloteamento?: string;
    cdquadra?: string;
    cdlote?: string;
    cdlogradouro?: string;
    cdbairro?: string;
    idbairro?: string;
  };
};

type TrindadeFocusRequest = {
  lat?: number | null;
  lng?: number | null;
  city?: string;
  address?: string;
  bairro?: string;
  quadra?: string;
  lote?: string;
  loteamento?: string;
  logradouro?: string;
};

type TrindadeLookupRecord = {
  properties: Record<string, any>;
  center: { lat: number; lng: number } | null;
};

type TrindadeCentroidRecord = {
  sourceIndex: number;
  lat: number;
  lng: number;
  cdloteamento: string;
  cdquadra: string;
  cdlote: string;
  quadraDisplay: string;
  loteDisplay: string;
  cdlogradouro: string;
  logradouroNome: string;
  cdbairro: string;
  bairroNome: string;
  loteamentoNome: string;
  streetFullName: string;
  nearDist: number | null;
};

type TrindadeLookupState = {
  ready: boolean;
  lotesByCdloteamentoCdquadraCdLote: Map<string, TrindadeLookupRecord[]>;
  lotesByCdQuadraCdLote: Map<string, TrindadeLookupRecord[]>;
  lotesByCdloteamentoCdquadra: Map<string, TrindadeLookupRecord[]>;
  logradourosByCdlogradouro: Map<string, TrindadeLookupRecord>;
  logradourosByName: Map<string, TrindadeLookupRecord>;
  logradourosByNameAndBairro: Map<string, TrindadeLookupRecord>;
  bairrosByCdbairro: Map<string, TrindadeLookupRecord>;
  bairrosByIdbairro: Map<string, TrindadeLookupRecord>;
  bairrosByName: Map<string, TrindadeLookupRecord>;
  loteamentosByCdloteamento: Map<string, TrindadeLookupRecord>;
  quadrasByCdloteamentoCdquadra: Map<string, TrindadeLookupRecord>;
  quadrasByCdquadra: Map<string, TrindadeLookupRecord[]>;
};

type TrindadeCentroidState = {
  ready: boolean;
  byTriple: Map<string, TrindadeCentroidRecord[]>;
  byPair: Map<string, TrindadeCentroidRecord[]>;
  byStreetBairro: Map<string, TrindadeCentroidRecord[]>;
};

type TrindadeFocusTrace = {
  source?: "center" | "centroid-client-triple" | "centroid-client-pair" | "centroid-client-street-bairro" | "centroid-client-search" | "fallback";
  manualDataSource?: "centroid-only";
  geojsonLoadedInManual?: boolean;
  centroidCache?: {
    loadCount: number;
    cacheHits: number;
  };
  candidatesCount?: number;
  loadCount?: number;
  cacheHits?: number;
  quadraOriginal: string;
  loteOriginal: string;
  loteamentoOriginal: string;
  ruaOriginal: string;
  ruaSanitizada: string;
  bairroDetectado: string;
  keyTriple: string;
  keyPair: string;
  tripleCandidates: number;
  pairCandidates: number;
  candidateWinner: string;
  fallbackReason: string;
};

type TrindadeFocusResolution = {
  lat: number;
  lng: number;
  zoom: number;
  reason: string;
  trace: TrindadeFocusTrace;
};

const TRINDADE_BBOX = {
  xmin: -49.6956565589,
  ymin: -16.8128905666,
  xmax: -49.3800317265,
  ymax: -16.4893645071,
};

const ARCGIS_THEME_ID = "arcgis-theme-light-css";
const ARCGIS_THEME_HREF =
  "https://js.arcgis.com/4.34/@arcgis/core/assets/esri/themes/light/main.css";

const MANIFEST_URL = "/data/trindade-clean/manifest.json";
const BASE_URL = "/data/trindade-clean";
const CENTROIDS_URL = "/data/trindade-clean/trindade_lot_centroids.json";
const CENTROIDS_WITH_STREET_URL = "/data/trindade-clean/trindade_lot_centroids_with_street.json";
const MANUAL_VISUAL_LOTES_URL = "/data/trindade-clean/trindade_lotes.visual.geojson";
const MANUAL_CENTROID_PICK_RADIUS_METERS = 45;

const LAYER_CONFIGS: ManifestLayer[] = [
  { key: "quadras", file: "quadras.geojson", label: "Quadras", visibleByDefault: true },
  { key: "lotes", file: "lotes.geojson", label: "Lotes", visibleByDefault: false },
  { key: "logradouros", file: "logradouros.geojson", label: "Logradouros", visibleByDefault: false },
  { key: "bairros", file: "bairros.geojson", label: "Bairros", visibleByDefault: false },
  { key: "loteamentos", file: "loteamentos.geojson", label: "Loteamentos", visibleByDefault: false },
];

let arcgisModulesPromise: Promise<any[]> | null = null;
let sharedView: any = null;
let sharedMap: any = null;
let sharedGraphic: any = null;
let sharedPoint: any = null;
let sharedExtent: any = null;
let sharedMarker: any = null;
let sharedSelectedGraphic: any = null;
let sharedManualVisualLayer: any = null;
let sharedManualClickCenterKey = "";
let sharedManualClickCenterEchoesToSuppress = 0;
let sharedArcgisLayerDeps: {
  GeoJSONLayer: any;
  SimpleRenderer: any;
  LabelClass: any;
} | null = null;
let mapInitialized = false;

function loadArcgisModules() {
  if (!arcgisModulesPromise) {
    arcgisModulesPromise = Promise.all([
      import("@arcgis/core/config"),
      import("@arcgis/core/Map"),
      import("@arcgis/core/layers/GeoJSONLayer"),
      import("@arcgis/core/views/MapView"),
      import("@arcgis/core/Graphic"),
      import("@arcgis/core/geometry/Point"),
      import("@arcgis/core/geometry/Extent"),
      import("@arcgis/core/widgets/Search"),
      import("@arcgis/core/renderers/SimpleRenderer"),
      import("@arcgis/core/layers/support/LabelClass"),
    ]);
  }

  return arcgisModulesPromise;
}

function buildTrindadeManualVisualLayer(GeoJSONLayer: any, SimpleRenderer: any, LabelClass: any) {
  const lotsUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${MANUAL_VISUAL_LOTES_URL}`
      : MANUAL_VISUAL_LOTES_URL;

  return new GeoJSONLayer({
    url: lotsUrl,
    title: "Trindade - Lotes Visual",
    outFields: ["cdloteamento", "cdquadra", "cdlote", "quadraDisplay", "loteDisplay"],
    visible: true,
    labelsVisible: true,
    popupEnabled: false,
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
    labelingInfo: [
      new LabelClass({
        labelExpressionInfo: {
          expression: `
            var q = Trim(DefaultValue($feature.quadraDisplay, ""));
            var l = Trim(DefaultValue($feature.loteDisplay, ""));
            if (IsEmpty(q)) {
              return "";
            }
            if (IsEmpty(l)) {
              return "Qd " + q;
            }
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
  });
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCoord(value: number) {
  return Number(value).toFixed(6);
}

function normalizeLookupKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function formatCodeForDisplay(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.toUpperCase() === "NAN") return "";

  let compact = raw;
  while (compact.length > 1 && compact.startsWith("0")) {
    compact = compact.slice(1);
  }

  return compact || raw;
}

function buildSafeLabelCodeExpression(fieldName: string, prefix: string) {
  return `
    var raw = Text(DefaultValue($feature.${fieldName}, ""));
    if (IsEmpty(raw)) { return ""; }
    raw = Trim(raw);
    if (IsEmpty(raw) || Upper(raw) == "NAN") { return ""; }
    while (Count(raw) > 1 && Left(raw, 1) == "0") {
      raw = Right(raw, Count(raw) - 1);
    }
    if (IsEmpty(raw) || Upper(raw) == "NAN") { return ""; }
    return "${prefix} " + raw;
  `;
}

function buildSafeLotLabelExpression(quadraField: string, loteField: string) {
  return `
    function normalizeDisplayCode(value) {
      var raw = Trim(Text(DefaultValue(value, "")));
      if (IsEmpty(raw) || Upper(raw) == "NAN" || Upper(raw) == "S/N") { return ""; }
      while (Count(raw) > 1 && Left(raw, 1) == "0") {
        raw = Right(raw, Count(raw) - 1);
      }
      if (IsEmpty(raw) || Upper(raw) == "NAN") { return ""; }
      return raw;
    }
    var q = normalizeDisplayCode($feature.${quadraField});
    var l = normalizeDisplayCode($feature.${loteField});
    var text = "";
    if (!IsEmpty(q)) { text = "Qd " + q; }
    if (!IsEmpty(l)) {
      if (IsEmpty(text)) {
        text = "Lt " + l;
      } else {
        text = text + " Lt " + l;
      }
    }
    return text;
  `;
}

function buildLotKeyVariants(attrs: Record<string, any>) {
  const rawCdLoteamento = safeText(attrs.cdloteamento || attrs.mslinkloteamento || "");
  const rawCdQuadra = safeText(attrs.cdquadra || attrs.quadra || attrs.num_qdr || attrs.nm_qdr || "");
  const rawCdLote = safeText(attrs.cdlote || attrs.lote || attrs.num_lot || attrs.nm_lot || "");

  const normalized = {
    cdloteamento: normalizeLookupKey(formatCodeForDisplay(rawCdLoteamento)),
    cdquadra: normalizeLookupKey(formatCodeForDisplay(rawCdQuadra)),
    cdlote: normalizeLookupKey(formatCodeForDisplay(rawCdLote)),
  };

  const raw = {
    cdloteamento: normalizeLookupKey(rawCdLoteamento),
    cdquadra: normalizeLookupKey(rawCdQuadra),
    cdlote: normalizeLookupKey(rawCdLote),
  };

  const triple = [
    [raw.cdloteamento, raw.cdquadra, raw.cdlote].join("|"),
    [normalized.cdloteamento, normalized.cdquadra, normalized.cdlote].join("|"),
  ].filter(Boolean);

  const pair = [
    [raw.cdquadra, raw.cdlote].join("|"),
    [normalized.cdquadra, normalized.cdlote].join("|"),
  ].filter(Boolean);

  return { raw, normalized, triple, pair };
}

function getLotCandidateScore(
  record: TrindadeLookupRecord,
  normalizedStreet: string,
  normalizedBairro: string,
  lookups: TrindadeLookupState,
) {
  const attrs = record?.properties || {};
  let score = 0;
  const notes: string[] = [];

  const logradouroCd = normalizeLookupKey(attrs.cdlogradouro);
  if (normalizedStreet && logradouroCd) {
    const logradouroRecord = lookups.logradourosByCdlogradouro.get(logradouroCd);
    const logradouroName = normalizeLookupKey(logradouroRecord?.properties?.nmlogradouro || "");
    if (logradouroName && normalizedStreet === logradouroName) {
      score += 3;
      notes.push("logradouro");
    }
  }

  const bairroCd = normalizeLookupKey(attrs.cdbairro);
  const bairroId = normalizeLookupKey(attrs.idbairro);
  let bairroName = "";
  if (bairroCd) {
    bairroName = normalizeLookupKey(lookups.bairrosByCdbairro.get(bairroCd)?.properties?.nmbairro || "");
  }
  if (!bairroName && bairroId) {
    bairroName = normalizeLookupKey(lookups.bairrosByIdbairro.get(bairroId)?.properties?.nmbairro || "");
  }
  if (!bairroName) {
    bairroName = normalizeLookupKey(attrs.bairro || "");
  }

  if (normalizedBairro && bairroName && normalizedBairro === bairroName) {
    score += 3;
    notes.push("bairro");
  }

  return { score, notes };
}

function collectLotCandidateBuckets(
  lookups: TrindadeLookupState,
  cdloteamento: string,
  cdquadra: string,
  cdlote: string,
) {
  const tripleKey = [cdloteamento, cdquadra, cdlote].join("|");
  const pairKey = [cdquadra, cdlote].join("|");

  const triple = tripleKey.split("|").every((part) => !part)
    ? []
    : lookups.lotesByCdloteamentoCdquadraCdLote.get(tripleKey) || [];
  const pair = pairKey.split("|").every((part) => !part)
    ? []
    : lookups.lotesByCdQuadraCdLote.get(pairKey) || [];

  const combined = new Set<TrindadeLookupRecord>();
  for (const record of triple) combined.add(record);
  for (const record of pair) combined.add(record);

  return {
    tripleKey,
    pairKey,
    triple,
    pair,
    combined: Array.from(combined),
  };
}

function pickBestLotCandidate(
  candidates: TrindadeLookupRecord[],
  normalizedStreet: string,
  normalizedBairro: string,
  lookups: TrindadeLookupState,
) {
  let best: { record: TrindadeLookupRecord; score: number } | null = null;
  let tie = false;

  for (const record of candidates) {
    const result = getLotCandidateScore(record, normalizedStreet, normalizedBairro, lookups);
    if (!best || result.score > best.score) {
      best = { record, score: result.score };
      tie = false;
      continue;
    }
    if (best && result.score === best.score) {
      tie = true;
    }
  }

  if (!best || best.score <= 0 || tie) return null;
  return best.record;
}

function describeLotCandidate(record: TrindadeLookupRecord | null | undefined) {
  if (!record) return "";
  const attrs = record.properties || {};
  const key = [
    safeText(attrs.cdloteamento || attrs.mslinkloteamento || ""),
    safeText(attrs.cdquadra || attrs.quadra || ""),
    safeText(attrs.cdlote || attrs.lote || ""),
  ]
    .map((part) => formatCodeForDisplay(part) || normalizeLookupKey(part))
    .filter(Boolean)
    .join("|");
  const nameBits = [
    safeText(attrs.nmlogradouro || attrs.nmbairro || attrs.nmloteamento || ""),
    safeText(attrs.cdlogradouro || attrs.cdbairro || attrs.cdloteamento || ""),
  ].filter(Boolean);
  return [key, ...nameBits].filter(Boolean).join(" / ");
}

function buildCentroidKeyVariants(record: TrindadeCentroidRecord) {
  const cdloteamento = normalizeLookupKey(formatCodeForDisplay(record.cdloteamento));
  const cdquadra = normalizeLookupKey(formatCodeForDisplay(record.cdquadra));
  const cdlote = normalizeLookupKey(formatCodeForDisplay(record.cdlote));
  const street = normalizeLookupKey(record.streetFullName || record.logradouroNome || "");
  const bairro = normalizeLookupKey(record.bairroNome || "");

  return {
    triple: [cdloteamento, cdquadra, cdlote].join("|"),
    pair: [cdquadra, cdlote].join("|"),
    streetBairro: street && bairro ? `${street}|${bairro}` : "",
  };
}

function collectCentroidBuckets(
  centroids: TrindadeCentroidState,
  cdloteamento: string,
  cdquadra: string,
  cdlote: string,
) {
  const tripleKey = [cdloteamento, cdquadra, cdlote].join("|");
  const pairKey = [cdquadra, cdlote].join("|");
  const triple = tripleKey.split("|").every((part) => !part) ? [] : centroids.byTriple.get(tripleKey) || [];
  const pair = pairKey.split("|").every((part) => !part) ? [] : centroids.byPair.get(pairKey) || [];
  const combined = new Set<TrindadeCentroidRecord>();
  for (const record of triple) combined.add(record);
  for (const record of pair) combined.add(record);

  return {
    tripleKey,
    pairKey,
    triple,
    pair,
    combined: Array.from(combined),
  };
}

function getCentroidCandidateScore(
  record: TrindadeCentroidRecord,
  normalizedStreet: string,
  normalizedBairro: string,
  normalizedLoteamento: string,
) {
  let score = 0;
  const notes: string[] = [];
  const street = normalizeLookupKey(record.streetFullName || record.logradouroNome || "");
  const bairro = normalizeLookupKey(record.bairroNome || "");
  const loteamento = normalizeLookupKey(record.loteamentoNome || "");

  if (normalizedStreet && street && normalizedStreet === street) {
    score += 3;
    notes.push("street");
  }
  if (normalizedBairro && bairro && normalizedBairro === bairro) {
    score += 3;
    notes.push("bairro");
  }
  if (normalizedLoteamento && loteamento && normalizedLoteamento === loteamento) {
    score += 2;
    notes.push("loteamento");
  }

  return { score, notes };
}

function pickBestCentroidCandidate(
  candidates: TrindadeCentroidRecord[],
  normalizedStreet: string,
  normalizedBairro: string,
  normalizedLoteamento: string,
) {
  let best: { record: TrindadeCentroidRecord; score: number } | null = null;
  let tie = false;

  for (const record of candidates) {
    const result = getCentroidCandidateScore(record, normalizedStreet, normalizedBairro, normalizedLoteamento);
    if (!best || result.score > best.score) {
      best = { record, score: result.score };
      tie = false;
      continue;
    }
    if (best && result.score === best.score) {
      tie = true;
    }
  }

  if (!best || best.score <= 0 || tie) return null;
  return best.record;
}

function describeCentroidCandidate(record: TrindadeCentroidRecord | null | undefined) {
  if (!record) return "";
  const key = [
    safeText(record.cdloteamento || ""),
    safeText(record.cdquadra || ""),
    safeText(record.cdlote || ""),
  ]
    .map((part) => formatCodeForDisplay(part) || normalizeLookupKey(part))
    .filter(Boolean)
    .join("|");
  const nameBits = [safeText(record.streetFullName || record.logradouroNome || ""), safeText(record.bairroNome || "")].filter(Boolean);
  return [key, ...nameBits].filter(Boolean).join(" / ");
}

function buildManualFreePickDetails(lat: number, lng: number): TrindadePickDetails {
  return {
    lat,
    lng,
    label: "Ponto manual",
    quadra: "",
    lote: "",
    bairro: "",
    logradouro: "",
    loteamento: "",
    address: `${formatCoord(lat)}, ${formatCoord(lng)}`,
    quadraDisplay: "",
    loteDisplay: "",
    bairroDisplay: "",
    logradouroDisplay: "",
    loteamentoDisplay: "",
  };
}

function buildManualLotPopupHtml(input: { bairro?: string; quadra?: string; lote?: string }) {
  const bairro = safeText(input.bairro || "");
  const quadra = safeText(input.quadra || "");
  const lote = safeText(input.lote || "");

  return `
    <div style="font-size:${isMobileViewport() ? "11px" : "13px"}; line-height:1.35; max-width:${isMobileViewport() ? "220px" : "320px"};">
      <div><strong>Bairro:</strong> ${escapeHtml(bairro || "-")}</div>
      <div><strong>Quadra:</strong> ${escapeHtml(quadra || "-")}</div>
      <div><strong>Lote:</strong> ${escapeHtml(lote || "-")}</div>
    </div>
  `;
}

function openLotPopup(input: { bairro?: string; quadra?: string; lote?: string }, lat: number, lng: number) {
  if (!sharedView) return;

  const bairro = safeText(input.bairro || "");
  const quadra = safeText(input.quadra || "");
  const lote = safeText(input.lote || "");

  try {
    sharedView.popup.open({
      location: {
        type: "point",
        latitude: lat,
        longitude: lng,
      },
      title: "Trindade local - revisÃ£o manual",
      content: buildManualLotPopupHtml({ bairro, quadra, lote }),
    });
  } catch {}
}

function collectUniqueCentroidRecords(centroids: TrindadeCentroidState) {
  const unique = new Map<string, TrindadeCentroidRecord>();
  const add = (record: TrindadeCentroidRecord) => {
    const key = [
      record.sourceIndex,
      record.lat.toFixed(6),
      record.lng.toFixed(6),
      record.cdloteamento,
      record.cdquadra,
      record.cdlote,
    ].join("|");
    if (!unique.has(key)) {
      unique.set(key, record);
    }
  };

  for (const records of centroids.byTriple.values()) {
    for (const record of records) add(record);
  }
  for (const records of centroids.byPair.values()) {
    for (const record of records) add(record);
  }
  for (const records of centroids.byStreetBairro.values()) {
    for (const record of records) add(record);
  }

  return Array.from(unique.values());
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestCentroidForManualPick(
  centroids: TrindadeCentroidState,
  lat: number,
  lng: number,
  maxDistanceMeters: number,
) {
  const records = collectUniqueCentroidRecords(centroids);
  let best: { record: TrindadeCentroidRecord; distanceMeters: number } | null = null;

  for (const record of records) {
    const distance = distanceMeters(lat, lng, record.lat, record.lng);
    if (!Number.isFinite(distance) || distance > maxDistanceMeters) continue;
    if (!best || distance < best.distanceMeters) {
      best = { record, distanceMeters: distance };
    }
  }

  return {
    record: best?.record || null,
    distanceMeters: best?.distanceMeters ?? null,
    candidatesCount: records.length,
  };
}

function getFeatureSelectionKey(feature: any) {
  const attrs = feature?.attributes || {};
  const layerName = String(feature?.layer?.title || "").toLowerCase();

  if (layerName.includes("lote")) {
    return [
      "lote",
      safeText(attrs.cdloteamento || attrs.mslinkloteamento || ""),
      safeText(attrs.cdquadra || attrs.quadra || attrs.num_qdr || attrs.nm_qdr || ""),
      safeText(attrs.cdlote || attrs.lote || attrs.num_lot || attrs.nm_lot || ""),
      safeText(attrs.idlote || ""),
    ].join("|");
  }

  if (layerName.includes("quadra")) {
    return [
      "quadra",
      safeText(attrs.cdloteamento || attrs.mslinkloteamento || ""),
      safeText(attrs.cdquadra || attrs.quadra || attrs.num_qdr || attrs.nm_qdr || ""),
      safeText(attrs.idquadra || ""),
    ].join("|");
  }

  if (layerName.includes("logradouro")) {
    return ["logradouro", safeText(attrs.cdlogradouro || ""), safeText(attrs.idlogradouro || "")].join("|");
  }

  if (layerName.includes("bairro")) {
    return ["bairro", safeText(attrs.cdbairro || ""), safeText(attrs.idbairro || "")].join("|");
  }

  if (layerName.includes("loteamento")) {
    return ["loteamento", safeText(attrs.cdloteamento || ""), safeText(attrs.idloteamento || "")].join("|");
  }

  return [
    layerName || "feature",
    safeText(attrs.id || attrs.objectid || attrs.OBJECTID || ""),
    safeText(attrs.cdloteamento || ""),
    safeText(attrs.cdquadra || ""),
    safeText(attrs.cdlote || ""),
  ].join("|");
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function stripLotNoiseFromStreet(text: string) {
  return String(text || "")
    .replace(/\b(?:qd|quadra)\.?\s*[-:]?\s*[A-Za-z0-9-]+\b/gi, " ")
    .replace(/\b(?:lt|lote)\.?\s*[-:]?\s*[A-Za-z0-9-]+\b/gi, " ")
    .replace(/\bS\/N\b/gi, " ")
    .replace(/\bSN\b/gi, " ")
    .replace(/[,;.-]+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizePlanStreet(address: string, fallbackStreet = "") {
  const raw = safeText(address || fallbackStreet);
  const firstPart = raw.split(",")[0] || raw;
  const cleaned = stripLotNoiseFromStreet(firstPart);
  return cleaned || stripLotNoiseFromStreet(fallbackStreet);
}

function sanitizePlanBairro(address: string, fallbackBairro = "") {
  const direct = safeText(fallbackBairro);
  if (direct) return direct;
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const preferred = parts.find((part) =>
    /(?:^|\s)(?:bairro|bairr[oÃƒÂ´]|setor|jd|jardim|vila|parque|residencial|loteamento|condominio|condomÃƒÂ­nio)\b/i.test(part)
  );

  if (preferred) return preferred;
  return safeText(extractBairroFromAddress(address));
}

function extractBairroFromAddress(address: string) {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^(?:bairro|bairr[oÃƒÂ´])[:\s-]+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function getGeometryCenter(geometry: any) {
  const points: Array<[number, number]> = [];

  function visit(value: any) {
    if (!value) return;
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      points.push([Number(value[0]), Number(value[1])]);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    }
  }

  visit(geometry?.coordinates);

  if (!points.length) return null;

  let minX = points[0][0];
  let minY = points[0][1];
  let maxX = points[0][0];
  let maxY = points[0][1];
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    lng: (minX + maxX) / 2,
    lat: (minY + maxY) / 2,
  };
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

function isValidManifest(data: any) {
  if (!data || typeof data !== "object") return false;
  if (String(data.outputCrs || "").toUpperCase() !== "EPSG:4326") return false;
  if (!Array.isArray(data.layers) || data.layers.length < 5) return false;
  return true;
}

function createEmptyLookupState(): TrindadeLookupState {
  return {
    ready: false,
    lotesByCdloteamentoCdquadraCdLote: new Map(),
    lotesByCdQuadraCdLote: new Map(),
    lotesByCdloteamentoCdquadra: new Map(),
    logradourosByCdlogradouro: new Map(),
    logradourosByName: new Map(),
    logradourosByNameAndBairro: new Map(),
    bairrosByCdbairro: new Map(),
    bairrosByIdbairro: new Map(),
    bairrosByName: new Map(),
    loteamentosByCdloteamento: new Map(),
    quadrasByCdloteamentoCdquadra: new Map(),
    quadrasByCdquadra: new Map(),
  };
}

function createEmptyCentroidState(): TrindadeCentroidState {
  return {
    ready: false,
    byTriple: new Map(),
    byPair: new Map(),
    byStreetBairro: new Map(),
  };
}

type Props = {
  mode?: "preview" | "manual";
  showChrome?: boolean;
  center?: { lat: number; lng: number } | null;
  focusRequest?: TrindadeFocusRequest | null;
  onPick?: (pos: { lat: number; lng: number }) => void;
  onPickDetails?: (details: TrindadePickDetails) => void;
};

function buildOperationalPickDetails(
  feature: any,
  lat: number,
  lng: number,
  lookups: TrindadeLookupState,
): TrindadePickDetails {
  const attrs = feature?.attributes || {};
  const layerName = String(feature?.layer?.title || "").toLowerCase();

  const rawCdLoteamento = safeText(attrs.cdloteamento || attrs.mslinkloteamento || "");
  const rawCdQuadra = safeText(attrs.cdquadra || attrs.quadra || attrs.num_qdr || attrs.nm_qdr || "");
  const rawCdLote = safeText(attrs.cdlote || attrs.lote || attrs.num_lot || attrs.nm_lot || "");
  const rawCdLogradouro = safeText(attrs.cdlogradouro || "");
  const rawCdBairro = safeText(attrs.cdbairro || "");
  const rawIdBairro = safeText(attrs.idbairro || "");
  const sourceIsLogradouro = layerName.includes("logradouro");
  const sourceIsBairro = layerName.includes("bairro");
  const sourceIsLoteamento = layerName.includes("loteamento");

  const quadraDisplay = formatCodeForDisplay(rawCdQuadra);
  const loteDisplay = formatCodeForDisplay(rawCdLote);

  const loteamentoRecord = rawCdLoteamento
    ? lookups.loteamentosByCdloteamento.get(normalizeLookupKey(rawCdLoteamento))
    : null;
  const bairroRecord =
    (rawCdBairro && lookups.bairrosByCdbairro.get(normalizeLookupKey(rawCdBairro))) ||
    (rawIdBairro && lookups.bairrosByIdbairro.get(normalizeLookupKey(rawIdBairro))) ||
    null;
  const logradouroRecord = rawCdLogradouro
    ? lookups.logradourosByCdlogradouro.get(normalizeLookupKey(rawCdLogradouro))
    : null;
  const logradouroDisplay =
    safeText(logradouroRecord?.properties?.nmlogradouro) ||
    (sourceIsLogradouro ? safeText(attrs.nmlogradouro) : "");
  const bairroDisplay =
    safeText(bairroRecord?.properties?.nmbairro) ||
    (sourceIsBairro ? safeText(attrs.nmbairro) : "") ||
    (sourceIsLogradouro ? safeText(logradouroRecord?.properties?.bairro) : "");
  const loteamentoDisplay =
    safeText(loteamentoRecord?.properties?.nmloteamento) ||
    (sourceIsLoteamento ? safeText(attrs.nmloteamento) : "");

  const fallbackLabel = [quadraDisplay ? `Qd ${quadraDisplay}` : "", loteDisplay ? `Lt ${loteDisplay}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();

  const cleanedParts = [
    logradouroDisplay || "",
    bairroDisplay ? `Bairro ${bairroDisplay}` : "",
    quadraDisplay ? `Qd ${quadraDisplay}` : "",
    loteDisplay ? `Lt ${loteDisplay}` : "",
    loteamentoDisplay ? `Loteamento ${loteamentoDisplay}` : "",
  ].filter((part) => String(part || "").trim());

  const label =
    sourceIsLogradouro
      ? logradouroDisplay
      : sourceIsBairro
        ? bairroDisplay
        : sourceIsLoteamento
          ? loteamentoDisplay
          : fallbackLabel;

  const address = cleanedParts.length ? cleanedParts.join(" - ") : label || "NÃƒÂ£o identificado";

  return {
    lat,
    lng,
    label: label || address || "NÃƒÂ£o identificado",
    quadra: quadraDisplay,
    lote: loteDisplay,
    bairro: bairroDisplay,
    logradouro: logradouroDisplay,
    loteamento: loteamentoDisplay,
    address,
    quadraDisplay,
    loteDisplay,
    bairroDisplay,
    logradouroDisplay,
    loteamentoDisplay,
    rawCodes: {
      cdloteamento: rawCdLoteamento || undefined,
      cdquadra: rawCdQuadra || undefined,
      cdlote: rawCdLote || undefined,
      cdlogradouro: rawCdLogradouro || undefined,
      cdbairro: rawCdBairro || undefined,
      idbairro: rawIdBairro || undefined,
    },
  };
}

async function resolveManualFocus(
  request: TrindadeFocusRequest | null | undefined,
  lookups: TrindadeLookupState,
  centroids: TrindadeCentroidState,
): Promise<TrindadeFocusResolution | null> {
  if (!request) return null;

  if (
    typeof request.lat === "number" &&
    typeof request.lng === "number" &&
    Number.isFinite(request.lat) &&
    Number.isFinite(request.lng)
  ) {
    return {
      lat: request.lat,
      lng: request.lng,
      zoom: 18,
      reason: "current-coord",
      trace: {
        source: "center",
        candidatesCount: 0,
        loadCount: 0,
        cacheHits: 0,
        quadraOriginal: safeText(request.quadra || ""),
        loteOriginal: safeText(request.lote || ""),
        loteamentoOriginal: safeText(request.loteamento || ""),
        ruaOriginal: safeText(request.address || request.logradouro || ""),
        ruaSanitizada: sanitizePlanStreet(request.address || request.logradouro || "", request.logradouro || ""),
        bairroDetectado: sanitizePlanBairro(request.address || "", request.bairro || ""),
        keyTriple: "",
        keyPair: "",
        tripleCandidates: 0,
        pairCandidates: 0,
        candidateWinner: "current-coord",
        fallbackReason: "current-coord",
      },
    };
  }

  const quadraOriginal = safeText(request.quadra || "");
  const loteOriginal = safeText(request.lote || "");
  const loteamentoOriginal = safeText(request.loteamento || "");
  const ruaOriginal = safeText(request.address || request.logradouro || "");
  const ruaSanitizada = sanitizePlanStreet(request.address || request.logradouro || "", request.logradouro || "");
  const bairroDetected = sanitizePlanBairro(request.address || "", request.bairro || "");

  const cdloteamento = normalizeLookupKey(formatCodeForDisplay(loteamentoOriginal));
  const cdquadra = normalizeLookupKey(formatCodeForDisplay(quadraOriginal));
  const cdlote = normalizeLookupKey(formatCodeForDisplay(loteOriginal));
  const bairroText = bairroDetected;
  const streetText = ruaSanitizada;
  const normalizedStreet = normalizeLookupKey(streetText);
  const normalizedBairro = normalizeLookupKey(bairroText || extractBairroFromAddress(request.address || ""));
  const normalizedLoteamento = normalizeLookupKey(loteamentoOriginal);
  const focusTraceBase: TrindadeFocusTrace = {
    source: "fallback",
    candidatesCount: 0,
    loadCount: 0,
    cacheHits: 0,
    quadraOriginal,
    loteOriginal,
    loteamentoOriginal,
    ruaOriginal,
    ruaSanitizada,
    bairroDetectado: bairroText,
    keyTriple: [cdloteamento, cdquadra, cdlote].join("|"),
    keyPair: [cdquadra, cdlote].join("|"),
    tripleCandidates: 0,
    pairCandidates: 0,
    candidateWinner: "",
    fallbackReason: "",
  };

  const clientStats = await getTrindadeCentroidClientStats();

  const tripleCandidates = await findTrindadeCentroidByTripleClient(cdloteamento, cdquadra, cdlote);
  if (tripleCandidates.length === 1) {
    const centroid = tripleCandidates[0];
    return {
      lat: centroid.lat,
      lng: centroid.lng,
      zoom: 18,
      reason: "centroid-client-triple",
      trace: {
        ...focusTraceBase,
        source: "centroid-client-triple",
        candidatesCount: tripleCandidates.length,
        loadCount: clientStats.loadCount,
        cacheHits: clientStats.cacheHits,
        candidateWinner: describeCentroidCandidate(centroid),
        fallbackReason: "centroid-client-triple",
      },
    };
  }

  if (tripleCandidates.length > 1) {
    const bestCentroid = pickBestCentroidCandidate(
      tripleCandidates,
      normalizedStreet,
      normalizedBairro,
      normalizedLoteamento,
    );
    if (bestCentroid && Number.isFinite(bestCentroid.lat) && Number.isFinite(bestCentroid.lng)) {
      return {
        lat: bestCentroid.lat,
        lng: bestCentroid.lng,
        zoom: 18,
        reason: "centroid-client-triple",
        trace: {
          ...focusTraceBase,
          source: "centroid-client-triple",
          candidatesCount: tripleCandidates.length,
          loadCount: clientStats.loadCount,
          cacheHits: clientStats.cacheHits,
          candidateWinner: describeCentroidCandidate(bestCentroid),
          fallbackReason: "centroid-client-triple",
        },
      };
    }
  }

  const pairCandidates = await findTrindadeCentroidByQuadraLoteClient(cdquadra, cdlote);
  if (pairCandidates.length === 1) {
    const centroid = pairCandidates[0];
    return {
      lat: centroid.lat,
      lng: centroid.lng,
      zoom: 18,
      reason: "centroid-client-pair",
      trace: {
        ...focusTraceBase,
        source: "centroid-client-pair",
        candidatesCount: pairCandidates.length,
        loadCount: clientStats.loadCount,
        cacheHits: clientStats.cacheHits,
        candidateWinner: describeCentroidCandidate(centroid),
        fallbackReason: "centroid-client-pair",
      },
    };
  }

  if (pairCandidates.length > 1) {
    const bestCentroid = pickBestCentroidCandidate(
      pairCandidates,
      normalizedStreet,
      normalizedBairro,
      normalizedLoteamento,
    );
    if (bestCentroid && Number.isFinite(bestCentroid.lat) && Number.isFinite(bestCentroid.lng)) {
      return {
        lat: bestCentroid.lat,
        lng: bestCentroid.lng,
        zoom: 18,
        reason: "centroid-client-pair",
        trace: {
          ...focusTraceBase,
          source: "centroid-client-pair",
          candidatesCount: pairCandidates.length,
          loadCount: clientStats.loadCount,
          cacheHits: clientStats.cacheHits,
          candidateWinner: describeCentroidCandidate(bestCentroid),
          fallbackReason: "centroid-client-pair",
        },
      };
    }
  }

  const streetCandidates = await findTrindadeCentroidByStreetBairroClient(streetText, bairroText);
  if (streetCandidates.length === 1) {
    const centroid = streetCandidates[0];
    return {
      lat: centroid.lat,
      lng: centroid.lng,
      zoom: 17,
      reason: "centroid-client-street-bairro",
      trace: {
        ...focusTraceBase,
        source: "centroid-client-street-bairro",
        candidatesCount: streetCandidates.length,
        loadCount: clientStats.loadCount,
        cacheHits: clientStats.cacheHits,
        candidateWinner: describeCentroidCandidate(centroid),
        fallbackReason: "centroid-client-street-bairro",
      },
    };
  }

  if (streetCandidates.length > 1) {
    const bestCentroid = pickBestCentroidCandidate(
      streetCandidates,
      normalizedStreet,
      normalizedBairro,
      normalizedLoteamento,
    );
    if (bestCentroid && Number.isFinite(bestCentroid.lat) && Number.isFinite(bestCentroid.lng)) {
      return {
        lat: bestCentroid.lat,
        lng: bestCentroid.lng,
        zoom: 17,
        reason: "centroid-client-street-bairro",
        trace: {
          ...focusTraceBase,
          source: "centroid-client-street-bairro",
          candidatesCount: streetCandidates.length,
          loadCount: clientStats.loadCount,
          cacheHits: clientStats.cacheHits,
          candidateWinner: describeCentroidCandidate(bestCentroid),
          fallbackReason: "centroid-client-street-bairro",
        },
      };
    }
  }

  const centroidBuckets = collectCentroidBuckets(centroids, cdloteamento, cdquadra, cdlote);
  const buckets = collectLotCandidateBuckets(lookups, cdloteamento, cdquadra, cdlote);

  if (cdquadra && cdlote) {
    if (centroidBuckets.combined.length === 1) {
      const centroid = centroidBuckets.combined[0];
      if (Number.isFinite(centroid.lat) && Number.isFinite(centroid.lng)) {
        return {
          lat: centroid.lat,
          lng: centroid.lng,
          zoom: 18,
          reason: "centroid-lote-exato",
          trace: {
            ...focusTraceBase,
            source: "fallback",
            candidatesCount: centroidBuckets.combined.length,
            candidateWinner: describeCentroidCandidate(centroid),
            fallbackReason: "centroid-lote-exato",
          },
        };
      }
    }

    if (centroidBuckets.combined.length > 1) {
      const bestCentroid = pickBestCentroidCandidate(
        centroidBuckets.combined,
        normalizedStreet,
        normalizedBairro,
        normalizedLoteamento,
      );
      if (bestCentroid && Number.isFinite(bestCentroid.lat) && Number.isFinite(bestCentroid.lng)) {
        return {
          lat: bestCentroid.lat,
          lng: bestCentroid.lng,
          zoom: 18,
          reason: "centroid-lote-exato-desempate",
          trace: {
            ...focusTraceBase,
            source: "fallback",
            candidatesCount: centroidBuckets.combined.length,
            candidateWinner: describeCentroidCandidate(bestCentroid),
            fallbackReason: "centroid-lote-exato-desempate",
          },
        };
      }
    }

    if (buckets.combined.length === 1 && buckets.combined[0]?.center) {
      return {
        ...buckets.combined[0].center!,
        zoom: 18,
        reason: "lote-exato",
        trace: {
          ...focusTraceBase,
          source: "fallback",
          candidatesCount: buckets.combined.length,
          candidateWinner: describeLotCandidate(buckets.combined[0]),
          fallbackReason: "lote-exato",
        },
      };
    }

    if (buckets.combined.length > 1) {
      const best = pickBestLotCandidate(buckets.combined, normalizedStreet, normalizedBairro, lookups);
      if (best?.center) {
        return {
          ...best.center,
          zoom: 18,
          reason: "lote-exato-desempate",
          trace: {
            ...focusTraceBase,
            source: "fallback",
            candidatesCount: buckets.combined.length,
            candidateWinner: describeLotCandidate(best),
            fallbackReason: "lote-exato-desempate",
          },
        };
      }
    }
  }

  if (normalizedStreet && normalizedBairro) {
    const centroidStreetBucket = centroids.byStreetBairro.get(`${normalizedStreet}|${normalizedBairro}`);
    if (centroidStreetBucket?.length === 1) {
      const centroid = centroidStreetBucket[0];
      if (Number.isFinite(centroid.lat) && Number.isFinite(centroid.lng)) {
        return {
          lat: centroid.lat,
          lng: centroid.lng,
          zoom: 17,
          reason: "centroid-logradouro+bairro",
          trace: {
            ...focusTraceBase,
            source: "fallback",
            candidatesCount: centroidStreetBucket.length,
            candidateWinner: describeCentroidCandidate(centroid),
            fallbackReason: "centroid-logradouro+bairro",
          },
        };
      }
    }
    if (centroidStreetBucket?.length && centroidStreetBucket.length > 1) {
      const bestCentroid = pickBestCentroidCandidate(
        centroidStreetBucket,
        normalizedStreet,
        normalizedBairro,
        normalizedLoteamento,
      );
      if (bestCentroid && Number.isFinite(bestCentroid.lat) && Number.isFinite(bestCentroid.lng)) {
        return {
          lat: bestCentroid.lat,
          lng: bestCentroid.lng,
          zoom: 17,
          reason: "centroid-logradouro+bairro-desempate",
          trace: {
            ...focusTraceBase,
            source: "fallback",
            candidatesCount: centroidStreetBucket.length,
            candidateWinner: describeCentroidCandidate(bestCentroid),
            fallbackReason: "centroid-logradouro+bairro-desempate",
          },
        };
      }
    }
  }

  if (normalizedStreet && normalizedBairro) {
    const exact = lookups.logradourosByNameAndBairro.get(`${normalizedStreet}|${normalizedBairro}`);
    if (exact?.center) {
        return {
          ...exact.center,
          zoom: 17,
          reason: "logradouro+bairro",
          trace: {
            ...focusTraceBase,
            source: "fallback",
            candidatesCount: 1,
            candidateWinner: "logradouro+bairro",
            fallbackReason: "logradouro+bairro",
          },
      };
    }
  }

  if (normalizedStreet) {
    const byName = lookups.logradourosByName.get(normalizedStreet);
    if (byName?.center) {
        return {
          ...byName.center,
          zoom: 17,
          reason: "logradouro",
          trace: {
            ...focusTraceBase,
            source: "fallback",
            candidatesCount: 1,
            candidateWinner: "logradouro",
            fallbackReason: "logradouro",
          },
      };
    }
  }

  if (normalizedBairro) {
    const byBairro = lookups.bairrosByName.get(normalizedBairro);
    if (byBairro?.center) {
        return {
          ...byBairro.center,
          zoom: 16,
          reason: "bairro",
          trace: {
            ...focusTraceBase,
            source: "fallback",
            candidatesCount: 1,
            candidateWinner: "bairro",
            fallbackReason: "bairro",
          },
      };
    }
  }

  return {
    lat: TRINDADE_BBOX.ymax - (TRINDADE_BBOX.ymax - TRINDADE_BBOX.ymin) / 2,
    lng: TRINDADE_BBOX.xmin + (TRINDADE_BBOX.xmax - TRINDADE_BBOX.xmin) / 2,
    zoom: 12,
    reason: "bbox",
    trace: {
      ...focusTraceBase,
      source: "fallback",
      candidatesCount: 0,
      candidateWinner: "",
      fallbackReason: "bbox",
    },
  };
}

export default function TrindadeArcgisMap({
  mode = "preview",
  showChrome = true,
  center,
  onPick,
  onPickDetails,
  focusRequest,
}: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<Partial<Record<LayerKey, any>>>({});
  const [manifestStatus, setManifestStatus] = useState<ManifestStatus>({
    ok: false,
    message: "Carregando manifest local...",
    outputCrs: null,
    cleanedCount: null,
    layerCount: null,
  });
  const [layerVisibility, setLayerVisibility] = useState<Record<LayerKey, boolean>>({
    quadras: true,
    lotes: mode === "manual",
    logradouros: false,
    bairros: false,
    loteamentos: false,
  });
  const lookupRef = useRef<TrindadeLookupState>(createEmptyLookupState());
  const centroidRef = useRef<TrindadeCentroidState>(createEmptyCentroidState());
  const [lookupReady, setLookupReady] = useState(false);
  const [centroidsReady, setCentroidsReady] = useState(false);
  const lastFocusTraceRef = useRef<TrindadeFocusTrace | null>(null);
  const lastSelectionKeyRef = useRef("");
  const lastPopupSelectionKeyRef = useRef("");
  const lastGoToSignatureRef = useRef("");
  const suppressNextCenterGoToRef = useRef(false);
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [manualSearchResults, setManualSearchResults] = useState<TrindadeCentroidClientSearchResult[]>([]);
  const [manualSearchLoading, setManualSearchLoading] = useState(false);
  const [manualSearchCacheStats, setManualSearchCacheStats] = useState({
    loadCount: 0,
    cacheHits: 0,
  });
  const manualSearchTraceRef = useRef<{
    source: string;
    candidatesCount: number;
    loadCount: number;
    cacheHits: number;
    query: string;
  } | null>(null);

  async function safeGoTo(target: any, signature: string) {
    if (!sharedView) return;
    if (signature && signature === lastGoToSignatureRef.current) return;
    lastGoToSignatureRef.current = signature;

    try {
      await sharedView.when?.();
      await sharedView.goTo(target, { animate: false });
    } catch (error: any) {
      const message = String(error?.message || error || "");
      const name = String(error?.name || "");
      if (message.includes("goto-interrupted") || name.includes("goto-interrupted")) {
        return;
      }
      console.error("[TrindadeArcgisMap] goTo failed:", error);
    }
  }

  function setMarker(lat: number, lng: number) {
    if (!sharedView || !sharedPoint || !sharedGraphic) return;

    const pt = new sharedPoint({ latitude: lat, longitude: lng });

    if (sharedMarker) {
      try {
        sharedView.graphics.remove(sharedMarker);
      } catch {}
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

  function buildPickDetailsFromCentroid(record: TrindadeCentroidClientRecord): TrindadePickDetails {
    const popup = formatTrindadeCentroidForPopupClient(record);
    const quadraValue = record.quadraDisplay || record.cdquadra || "";
    const loteValue = record.loteDisplay || record.cdlote || "";
    const bairroValue = record.bairroNome || "";
    const logradouroValue = record.streetFullName || record.logradouroNome || "";
    const loteamentoValue = record.loteamentoNome || "";

    return {
      lat: record.lat,
      lng: record.lng,
      label: popup.primaryLabel || popup.summary,
      quadra: quadraValue,
      lote: loteValue,
      bairro: bairroValue,
      logradouro: logradouroValue,
      loteamento: loteamentoValue,
      address: popup.summary,
      quadraDisplay: quadraValue,
      loteDisplay: loteValue,
      bairroDisplay: bairroValue,
      logradouroDisplay: logradouroValue,
      loteamentoDisplay: loteamentoValue,
      rawCodes: {
        cdloteamento: record.cdloteamento || undefined,
        cdquadra: record.cdquadra || undefined,
        cdlote: record.cdlote || undefined,
        cdlogradouro: record.cdlogradouro || undefined,
        cdbairro: record.cdbairro || undefined,
      },
    };
  }

  async function focusOnCentroidResult(
    result: TrindadeCentroidClientSearchResult,
    source: string,
  ) {
    const record = result.record;
    const popup = formatTrindadeCentroidForPopupClient(record);
    const signature = `${record.lat.toFixed(6)},${record.lng.toFixed(6)}|${source}`;
    const stats = await getTrindadeCentroidClientStats();

    manualSearchTraceRef.current = {
      source,
      candidatesCount: result.matchedTokens.length ? 1 : 0,
      loadCount: stats.loadCount,
      cacheHits: stats.cacheHits,
      query: popup.primaryLabel,
    };

    lastFocusTraceRef.current = {
      ...lastFocusTraceRef.current,
      source: source as any,
      candidatesCount: result.matchedTokens.length ? 1 : 0,
      loadCount: stats.loadCount,
      cacheHits: stats.cacheHits,
      quadraOriginal: record.cdquadra || "",
      loteOriginal: record.cdlote || "",
      loteamentoOriginal: record.cdloteamento || "",
      ruaOriginal: record.streetFullName || record.logradouroNome || "",
      ruaSanitizada: record.streetFullName || record.logradouroNome || "",
      bairroDetectado: record.bairroNome || "",
      keyTriple: [record.cdloteamento, record.cdquadra, record.cdlote].join("|"),
      keyPair: [record.cdquadra, record.cdlote].join("|"),
      tripleCandidates: 0,
      pairCandidates: 0,
      candidateWinner: popup.primaryLabel,
      fallbackReason: source,
    };

    setMarker(record.lat, record.lng);
    onPick?.({ lat: record.lat, lng: record.lng });
    onPickDetails?.(buildPickDetailsFromCentroid(record));
    void safeGoTo({ center: [record.lng, record.lat], zoom: 18 }, signature);
  }

  async function selectManualSearchResult(result: TrindadeCentroidClientSearchResult) {
    await focusOnCentroidResult(result, "centroid-client-search");
  }

  useEffect(() => {
    if (mode === "manual") return;

    let alive = true;

    (async () => {
      try {
        const res = await fetch(MANIFEST_URL, {
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        });
        const data = await res.json().catch(() => null);

        if (!alive) return;

        if (!res.ok || !isValidManifest(data)) {
          setManifestStatus({
            ok: false,
            message: "Manifest local indisponÃƒÂ­vel ou invÃƒÂ¡lido.",
            outputCrs: data?.outputCrs ? String(data.outputCrs) : null,
            cleanedCount: Number.isFinite(Number(data?.totals?.cleanedCount))
              ? Number(data?.totals?.cleanedCount)
              : null,
            layerCount: Array.isArray(data?.layers) ? data.layers.length : null,
          });
          return;
        }

        setManifestStatus({
          ok: true,
          message: "Manifest local validado.",
          outputCrs: String(data.outputCrs || null),
          cleanedCount: Number.isFinite(Number(data?.totals?.cleanedCount))
            ? Number(data.totals.cleanedCount)
            : null,
          layerCount: Array.isArray(data.layers) ? data.layers.length : null,
        });
      } catch {
        if (!alive) return;
        setManifestStatus({
          ok: false,
          message: "Falha ao ler manifest local.",
          outputCrs: null,
          cleanedCount: null,
          layerCount: null,
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== "manual") {
      return;
    }

    let alive = true;

    (async () => {
      try {
        const store = await loadTrindadeCentroidsClient();
        if (!alive) return;

        lookupRef.current = createEmptyLookupState();
        centroidRef.current = {
          ready: store.ready,
          byTriple: store.byTriple,
          byPair: store.byPair,
          byStreetBairro: store.byStreetBairro,
        };
        setManualSearchCacheStats({
          loadCount: store.stats.loadCount,
          cacheHits: store.stats.cacheHits,
        });
        setLookupReady(true);
        setCentroidsReady(true);
      } catch {
        if (!alive) return;
        lookupRef.current = createEmptyLookupState();
        centroidRef.current = createEmptyCentroidState();
        setLookupReady(false);
        setCentroidsReady(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [mode]);

  useEffect(() => {
    ensureArcgisThemeCss();

    if (mapInitialized) {
      if (divRef.current && sharedView) {
        sharedView.container = divRef.current;
        configureMobilePopup(sharedView);
      }

      if (sharedMap && sharedManualVisualLayer) {
        const manualLayerPresent = sharedMap.layers.includes(sharedManualVisualLayer);
        if (mode === "manual" && !manualLayerPresent) {
          sharedMap.add(sharedManualVisualLayer);
        }
      }

      Object.entries(layerVisibility).forEach(([key, visible]) => {
        const layer = layersRef.current[key as LayerKey];
        if (!layer) return;
        layer.visible = visible;
        layer.labelsVisible = visible;
      });

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
          { default: Extent },
          { default: Search },
          { default: SimpleRenderer },
          { default: LabelClass },
        ] = await loadArcgisModules();
        sharedArcgisLayerDeps = { GeoJSONLayer, SimpleRenderer, LabelClass };

        const apiKey = process.env.NEXT_PUBLIC_ARCGIS_API_KEY;
        if (apiKey) esriConfig.apiKey = apiKey;

        if (!divRef.current) {
          mapInitialized = false;
          return;
        }

        if (!sharedMap) {
          sharedMap = new Map({
            basemap: "topo-vector",
          });
        }

        if (!sharedExtent) {
          sharedExtent = new Extent({
            xmin: TRINDADE_BBOX.xmin,
            ymin: TRINDADE_BBOX.ymin,
            xmax: TRINDADE_BBOX.xmax,
            ymax: TRINDADE_BBOX.ymax,
            spatialReference: { wkid: 4326 },
          });
        }

        if (mode === "manual" && !sharedManualVisualLayer) {
          sharedManualVisualLayer = buildTrindadeManualVisualLayer(GeoJSONLayer, SimpleRenderer, LabelClass);
        }

        if (mode === "manual" && sharedManualVisualLayer && !sharedMap.layers.includes(sharedManualVisualLayer)) {
          sharedMap.add(sharedManualVisualLayer);
        }

        const createLayer = (
          key: LayerKey,
          title: string,
          fileName: string,
          fieldMap: {
            title: string;
            fields: { fieldName: string; label: string }[];
            labelExpression: string;
            minScale?: number;
          },
          visible: boolean,
        ) =>
          new GeoJSONLayer({
            url: `${BASE_URL}/${fileName}`,
            title,
            outFields: ["*"],
            visible,
            labelsVisible: visible,
            popupEnabled: mode !== "manual",
            renderer: new SimpleRenderer({
              symbol: key === "logradouros"
                ? {
                    type: "simple-line",
                    color: [14, 165, 233, 0.82],
                    width: 1.2,
                  }
                : {
                    type: "simple-fill",
                    color: [0, 0, 0, 0.02],
                    outline: {
                      color: key === "lotes" ? [17, 24, 39, 0.9] : [15, 118, 110, 0.82],
                      width: key === "lotes" ? 0.6 : 0.8,
                    },
                  },
            }),
            labelingInfo: [
              new LabelClass({
                labelExpressionInfo: { expression: fieldMap.labelExpression },
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
                minScale: fieldMap.minScale || 0,
                maxScale: 0,
              }),
            ],
            popupTemplate:
              mode === "manual"
                ? undefined
                : {
                    title: fieldMap.title,
                    content: [
                      {
                        type: "fields",
                        fieldInfos: fieldMap.fields,
                      },
                    ],
                  },
          });

        const layers: Partial<Record<LayerKey, any>> = {};
        if (mode !== "manual") {
          layers.quadras = createLayer(
            "quadras",
            "Trindade - Quadras",
            "quadras.geojson",
            {
              title: "Quadra",
              labelExpression: buildSafeLabelCodeExpression("cdquadra", "Qd"),
              fields: [
                { fieldName: "idquadra", label: "ID Quadra" },
                { fieldName: "cdloteamento", label: "Loteamento" },
                { fieldName: "cdquadra", label: "Quadra" },
                { fieldName: "status", label: "Status" },
                { fieldName: "linkado", label: "Linkado" },
              ],
              minScale: 12000,
            },
            true,
          );
          layers.lotes = createLayer(
            "lotes",
            "Trindade - Lotes",
            "lotes.geojson",
            {
              title: "Lote",
              labelExpression: buildSafeLotLabelExpression("cdquadra", "cdlote"),
              fields: [
                { fieldName: "idlote", label: "ID Lote" },
                { fieldName: "cdloteamento", label: "Loteamento" },
                { fieldName: "cdquadra", label: "Quadra" },
                { fieldName: "cdlote", label: "Lote" },
                { fieldName: "cdzona", label: "Zona" },
                { fieldName: "cdsetor", label: "Setor" },
                { fieldName: "cdlogradouro", label: "Logradouro" },
                { fieldName: "cdbairro", label: "Bairro" },
                { fieldName: "tipo", label: "Tipo" },
              ],
              minScale: 2500,
            },
            false,
          );
          layers.logradouros = createLayer(
            "logradouros",
            "Trindade - Logradouros",
            "logradouros.geojson",
            {
              title: "Logradouro",
              labelExpression: `return DefaultValue($feature.nmlogradouro, "");`,
              fields: [
                { fieldName: "idlogradouro", label: "ID Logradouro" },
                { fieldName: "cdlogradouro", label: "CÃƒÂ³digo" },
                { fieldName: "nmlogradouro", label: "Logradouro" },
                { fieldName: "tipologradouro", label: "Tipo" },
                { fieldName: "bairro", label: "Bairro" },
                { fieldName: "idbairro", label: "ID Bairro" },
              ],
              minScale: 0,
            },
            false,
          );
          layers.bairros = createLayer(
            "bairros",
            "Trindade - Bairros",
            "bairros.geojson",
            {
              title: "Bairro",
              labelExpression: `return DefaultValue($feature.nmbairro, "");`,
              fields: [
                { fieldName: "idbairro", label: "ID Bairro" },
                { fieldName: "cdbairro", label: "CÃƒÂ³digo" },
                { fieldName: "nmbairro", label: "Bairro" },
                { fieldName: "cor", label: "Cor" },
              ],
              minScale: 0,
            },
            false,
          );
          layers.loteamentos = createLayer(
            "loteamentos",
            "Trindade - Loteamentos",
            "loteamentos.geojson",
            {
              title: "Loteamento",
              labelExpression: `return DefaultValue($feature.nmloteamento, "");`,
              fields: [
                { fieldName: "idloteamento", label: "ID Loteamento" },
                { fieldName: "cdloteamento", label: "CÃƒÂ³digo" },
                { fieldName: "nmloteamento", label: "Loteamento" },
                { fieldName: "idempresa", label: "Empresa" },
              ],
              minScale: 0,
            },
            false,
          );
        }

        layersRef.current = layers;

        const manualHasValidCenter = Boolean(center && Number.isFinite(center.lat) && Number.isFinite(center.lng));
        const manualDefaultCenter: [number, number] = [
          TRINDADE_BBOX.xmin + (TRINDADE_BBOX.xmax - TRINDADE_BBOX.xmin) / 2,
          TRINDADE_BBOX.ymax - (TRINDADE_BBOX.ymax - TRINDADE_BBOX.ymin) / 2,
        ];

        sharedView = new MapView({
          container: divRef.current,
          map: sharedMap,
          center:
            mode === "manual"
              ? manualHasValidCenter
                ? [center!.lng, center!.lat]
                : manualDefaultCenter
              : undefined,
          extent: mode === "manual" ? undefined : sharedExtent,
          zoom: mode === "manual" ? (manualHasValidCenter ? 18 : 12) : 12,
          constraints: {
            rotationEnabled: false,
          },
          popup: {
            dockEnabled: false,
          },
        });

        if (mode === "manual" && center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
          lastGoToSignatureRef.current = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}|center`;
        }

        sharedGraphic = Graphic;
        sharedPoint = Point;

        try {
          sharedView.popup.autoPanEnabled = false;
        } catch {}
        configureMobilePopup(sharedView);

        if (mode === "manual") {
          try {
            sharedView.ui.remove("zoom");
          } catch {}
        }

        if (mode === "manual" && center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
          try {
            await sharedView.when?.();
          } catch {}

          setMarker(center.lat, center.lng);
        }

        if (mode !== "manual") {
          const search = new Search({
            view: sharedView,
            includeDefaultSources: true,
          });
          sharedView.ui.add(search, "top-right");
        }

        sharedView.on("click", async (event: any) => {
          const p = event?.mapPoint ?? sharedView.toMap({ x: event?.x, y: event?.y });
          if (!p) return;

          const lat = Number(p.latitude ?? p.y);
          const lng = Number(p.longitude ?? p.x);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

          if (mode === "manual") {
            Promise.resolve(
              sharedView.hitTest(event, {
                include: sharedManualVisualLayer ? [sharedManualVisualLayer] : [],
              }),
            )
              .then((hit: any) => {
                const feature =
                  hit?.results?.find((r: any) => r?.graphic?.layer === sharedManualVisualLayer)?.graphic ||
                  null;

                if (!feature) {
                  if (sharedSelectedGraphic) {
                    try {
                      sharedView.graphics.remove(sharedSelectedGraphic);
                    } catch {}
                    sharedSelectedGraphic = null;
                  }
                  lastSelectionKeyRef.current = "";
                  lastPopupSelectionKeyRef.current = "";
                  try {
                    sharedView.popup.close();
                  } catch {}
                  setMarker(lat, lng);
                  sharedManualClickCenterKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
                  sharedManualClickCenterEchoesToSuppress = 3;
                  suppressNextCenterGoToRef.current = true;
                  onPick?.({ lat, lng });
                  onPickDetails?.(buildManualFreePickDetails(lat, lng));
                  return;
                }

                const attrs = feature.attributes || {};
                const cdloteamento = String(attrs.cdloteamento || "");
                const cdquadra = String(attrs.cdquadra || "");
                const cdlote = String(attrs.cdlote || "");
                const quadraDisplay = String(attrs.quadraDisplay || cdquadra || "");
                const loteDisplay = String(attrs.loteDisplay || cdlote || "");
                const selectionKey = `${cdloteamento}|${cdquadra}|${cdlote}`;
                const popupKey = `${selectionKey}|${lat.toFixed(6)},${lng.toFixed(6)}`;

                if (sharedSelectedGraphic) {
                  try {
                    sharedView.graphics.remove(sharedSelectedGraphic);
                  } catch {}
                  sharedSelectedGraphic = null;
                }

                sharedSelectedGraphic = new sharedGraphic({
                  geometry: feature.geometry,
                  symbol: {
                    type: "simple-fill",
                    color: [255, 255, 255, 0.03],
                    outline: {
                      color: [15, 23, 42, 0.98],
                      width: 1.6,
                    },
                  },
                });
                sharedView.graphics.add(sharedSelectedGraphic);

                setMarker(lat, lng);

                if (popupKey !== lastPopupSelectionKeyRef.current) {
                  lastPopupSelectionKeyRef.current = popupKey;
                  openLotPopup(
                    {
                      bairro: safeText(attrs.bairroDisplay || attrs.bairro || attrs.nmbairro || attrs.setor || attrs.nmsetor || ""),
                      quadra: quadraDisplay,
                      lote: loteDisplay,
                    },
                    lat,
                    lng,
                  );
                }

                sharedManualClickCenterKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
                sharedManualClickCenterEchoesToSuppress = 3;
                suppressNextCenterGoToRef.current = true;
                onPick?.({ lat, lng });

                const exactCentroid = collectCentroidBuckets(
                  centroidRef.current,
                  cdloteamento,
                  cdquadra,
                  cdlote,
                ).combined[0];
                onPickDetails?.(
                  exactCentroid ? buildPickDetailsFromCentroid(exactCentroid) : buildManualFreePickDetails(lat, lng),
                );
              })
              .catch((err: any) => {
                console.error("[TrindadeArcgisMap] manual hitTest failed:", err);
                const centroidMatch = findNearestCentroidForManualPick(
                  centroidRef.current,
                  lat,
                  lng,
                  MANUAL_CENTROID_PICK_RADIUS_METERS,
                );
                const pickedRecord = centroidMatch.record;
                if (!pickedRecord) {
                  if (sharedSelectedGraphic) {
                    try {
                      sharedView.graphics.remove(sharedSelectedGraphic);
                    } catch {}
                    sharedSelectedGraphic = null;
                  }
                  lastSelectionKeyRef.current = "";
                  lastPopupSelectionKeyRef.current = "";
                  try {
                    sharedView.popup.close();
                  } catch {}
                  return;
                }

                const pickedLat = pickedRecord.lat;
                const pickedLng = pickedRecord.lng;
                const popupKey = `centroid:${pickedRecord.sourceIndex}|${pickedLat.toFixed(6)},${pickedLng.toFixed(6)}`;

                sharedManualClickCenterKey = `${pickedLat.toFixed(6)},${pickedLng.toFixed(6)}`;
                sharedManualClickCenterEchoesToSuppress = 3;
                setMarker(pickedLat, pickedLng);
                if (popupKey !== lastPopupSelectionKeyRef.current) {
                  lastPopupSelectionKeyRef.current = popupKey;
                  openLotPopup(
                    {
                      bairro: pickedRecord.bairroNome || "",
                      quadra: pickedRecord.quadraDisplay || pickedRecord.cdquadra || "",
                      lote: pickedRecord.loteDisplay || pickedRecord.cdlote || "",
                    },
                    pickedLat,
                    pickedLng,
                  );
                }

                suppressNextCenterGoToRef.current = true;
                onPick?.({ lat: pickedLat, lng: pickedLng });
                onPickDetails?.(buildPickDetailsFromCentroid(pickedRecord));
              });
          }

          const pt = new sharedPoint({ latitude: lat, longitude: lng });

          if (sharedMarker) {
            try {
              sharedView.graphics.remove(sharedMarker);
            } catch {}
          }

          sharedMarker = new sharedGraphic({
            geometry: pt,
            symbol: {
              type: "simple-marker",
              style: "circle",
              color: [239, 68, 68, 0.88],
              size: 10,
              outline: { color: [255, 255, 255, 1], width: 2 },
            },
          });

          sharedView.graphics.add(sharedMarker);

          Promise.resolve(
            sharedView.hitTest(event, {
              include: Object.values(layers),
            }),
          )
            .then((hit: any) => {
              const priority: LayerKey[] = [
                "lotes",
                "quadras",
                "logradouros",
                "bairros",
                "loteamentos",
              ];

              const feature =
                priority
                  .map((layerKey) => {
                    const layer = layersRef.current[layerKey];
                    return (
                      hit?.results?.find((r: any) => r?.graphic?.layer === layer)?.graphic || null
                    );
                  })
                  .find(Boolean) ||
                hit?.results?.find((r: any) => r?.graphic?.geometry)?.graphic ||
                null;

              onPick?.({ lat, lng });

              if (!feature) {
                if (sharedSelectedGraphic) {
                  try {
                    sharedView.graphics.remove(sharedSelectedGraphic);
                  } catch {}
                  sharedSelectedGraphic = null;
                  lastSelectionKeyRef.current = "";
                  lastPopupSelectionKeyRef.current = "";
                }
                try {
                  sharedView.popup.close();
                } catch {}
                const freePickDetails = buildManualFreePickDetails(lat, lng);
                setMarker(lat, lng);
                sharedManualClickCenterKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
                sharedManualClickCenterEchoesToSuppress = 3;
                suppressNextCenterGoToRef.current = true;
                onPick?.({ lat, lng });
                onPickDetails?.(freePickDetails);
                return;
              }

              const details = buildOperationalPickDetails(feature, lat, lng, lookupRef.current);
              onPickDetails?.(details);

              const selectionKey = getFeatureSelectionKey(feature);

              const selectionChanged = selectionKey !== lastSelectionKeyRef.current;

              if (selectionChanged) {
                lastSelectionKeyRef.current = selectionKey;

                if (sharedSelectedGraphic) {
                  try {
                    sharedView.graphics.remove(sharedSelectedGraphic);
                  } catch {}
                  sharedSelectedGraphic = null;
                }
              }

              const geometryType = String(feature?.geometry?.type || "").toLowerCase();
              const symbol =
                geometryType === "polyline" || geometryType === "line" || geometryType === "linestring"
                  ? {
                      type: "simple-line",
                      color: [15, 23, 42, 0.98],
                      width: 2.2,
                    }
                  : geometryType === "point"
                    ? {
                        type: "simple-marker",
                        style: "circle",
                        color: [255, 255, 255, 0.9],
                        size: 10,
                        outline: { color: [15, 23, 42, 0.98], width: 2 },
                      }
                    : {
                        type: "simple-fill",
                        color: [255, 255, 255, 0.03],
                        outline: {
                          color: [15, 23, 42, 0.98],
                          width: 1.6,
                        },
                      };
              if (selectionChanged) {
                sharedSelectedGraphic = new sharedGraphic({
                  geometry: feature.geometry,
                  symbol,
                });

                sharedView.graphics.add(sharedSelectedGraphic);
              }

              const popupKey = `${selectionKey}|${lat.toFixed(6)},${lng.toFixed(6)}`;
              if (popupKey === lastPopupSelectionKeyRef.current) {
                return;
              }
              lastPopupSelectionKeyRef.current = popupKey;

              const attrs = feature.attributes || {};
              const fields = Object.keys(attrs)
                .slice(0, 6)
                .map((key) => `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(attrs[key])}</div>`)
                .join("");

              try {
                sharedView.popup.open({
                  location: {
                    type: "point",
                    latitude: lat,
                    longitude: lng,
                  },
                  title: "Preview local de Trindade",
                  content: `
                    <div style="font-size:${isMobileViewport() ? "11px" : "13px"}; line-height:1.35; max-width:${isMobileViewport() ? "220px" : "320px"};">
                      <div><strong>Coordenadas:</strong> ${formatCoord(lat)}, ${formatCoord(lng)}</div>
                      <div style="height:6px;"></div>
                      ${fields || "<div>Sem atributos.</div>"}
                    </div>
                  `,
                });
              } catch {}
            })
            .catch(() => {});
        });

        if (mode !== "manual") {
          sharedMap.addMany(Object.values(layers));
        }

        if (mode === "manual" && sharedManualVisualLayer && !sharedMap.layers.includes(sharedManualVisualLayer)) {
          sharedManualVisualLayer.visible = true;
          sharedManualVisualLayer.labelsVisible = true;
          sharedMap.add(sharedManualVisualLayer);
        }

        Object.entries(layerVisibility).forEach(([key, visible]) => {
          const layer = layersRef.current[key as LayerKey];
          if (!layer) return;
          layer.visible = visible;
          layer.labelsVisible = visible;
        });

        try {
          if (mode !== "manual") {
            await safeGoTo(sharedExtent, "sharedExtent");
          }
        } catch {}
      } catch (error) {
        console.error("[TrindadeArcgisMap] init failed:", error);

        try {
          sharedView?.destroy?.();
        } catch {}

        sharedView = null;
        sharedMap = null;
        sharedGraphic = null;
        sharedPoint = null;
        sharedExtent = null;
        sharedMarker = null;
        sharedSelectedGraphic = null;
        mapInitialized = false;
        }
      })();

    return () => {
      try {
        if (sharedView?.container) {
          sharedView.container = null;
        }
      } catch {}
      try {
        if (sharedSelectedGraphic && sharedView?.graphics?.includes?.(sharedSelectedGraphic)) {
          sharedView.graphics.remove(sharedSelectedGraphic);
        }
      } catch {}
      sharedSelectedGraphic = null;
      lastSelectionKeyRef.current = "";
      lastPopupSelectionKeyRef.current = "";
      try {
        sharedView?.popup?.close?.();
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (!mapInitialized) return;

    Object.entries(layerVisibility).forEach(([key, visible]) => {
      const layer = layersRef.current[key as LayerKey];
      if (!layer) return;
      layer.visible = visible;
      layer.labelsVisible = visible;
    });
  }, [layerVisibility]);

  useEffect(() => {
    if (!mapInitialized || !sharedMap) return;

    if (mode === "manual") {
      if (!sharedArcgisLayerDeps) return;

      if (!sharedManualVisualLayer) {
        sharedManualVisualLayer = buildTrindadeManualVisualLayer(
          sharedArcgisLayerDeps.GeoJSONLayer,
          sharedArcgisLayerDeps.SimpleRenderer,
          sharedArcgisLayerDeps.LabelClass,
        );
      }

      if (sharedManualVisualLayer && !sharedMap.layers.includes(sharedManualVisualLayer)) {
        sharedManualVisualLayer.visible = true;
        sharedManualVisualLayer.labelsVisible = true;
        sharedMap.add(sharedManualVisualLayer);
      }

      return;
    }

    if (sharedManualVisualLayer && sharedMap.layers.includes(sharedManualVisualLayer)) {
      sharedMap.remove(sharedManualVisualLayer);
    }
  }, [mode]);

  useEffect(() => {
    if (!mapInitialized || !sharedView || !center) return;
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;

    const centerKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    if (mode === "manual") {
      if (centerKey === sharedManualClickCenterKey && sharedManualClickCenterEchoesToSuppress > 0) {
        sharedManualClickCenterEchoesToSuppress -= 1;
        setMarker(center.lat, center.lng);
        lastGoToSignatureRef.current = `${centerKey}|center`;
        return;
      }
    }
    if (suppressNextCenterGoToRef.current) {
      suppressNextCenterGoToRef.current = false;
      return;
    }
    void safeGoTo(
      { center: [center.lng, center.lat], zoom: 18 },
      `${center.lat.toFixed(6)},${center.lng.toFixed(6)}|center`,
    );
    setMarker(center.lat, center.lng);
  }, [center]);

  useEffect(() => {
    if (mode !== "manual") {
      setManualSearchQuery("");
      setManualSearchResults([]);
      setManualSearchLoading(false);
      return;
    }

    let alive = true;
    const query = manualSearchQuery.trim();

    if (!query) {
      setManualSearchResults([]);
      setManualSearchLoading(false);
      void getTrindadeCentroidClientStats().then((stats) => {
        if (!alive) return;
        setManualSearchCacheStats({
          loadCount: stats.loadCount,
          cacheHits: stats.cacheHits,
        });
      });
      return () => {
        alive = false;
      };
    }

    setManualSearchLoading(true);
    const timer = setTimeout(() => {
      (async () => {
        const results = await searchTrindadeCentroidsClient(query);
        if (!alive) return;
        setManualSearchResults(results);

        const stats = await getTrindadeCentroidClientStats();
        if (!alive) return;
        setManualSearchCacheStats({
          loadCount: stats.loadCount,
          cacheHits: stats.cacheHits,
        });
        setManualSearchLoading(false);
      })().catch(() => {
        if (!alive) return;
        setManualSearchResults([]);
        setManualSearchLoading(false);
      });
    }, 180);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [mode, manualSearchQuery]);

  const focusKey = [
    focusRequest?.lat ?? "",
    focusRequest?.lng ?? "",
    focusRequest?.address ?? "",
    focusRequest?.bairro ?? "",
    focusRequest?.quadra ?? "",
    focusRequest?.lote ?? "",
    focusRequest?.loteamento ?? "",
    focusRequest?.logradouro ?? "",
    mode,
  ].join("|");
  const focusAppliedRef = useRef("");

  useEffect(() => {
    focusAppliedRef.current = "";
  }, [focusKey]);

  useEffect(() => {
    if (mode !== "manual") return;
    if (!mapInitialized || !sharedView || !lookupReady || !centroidsReady) return;
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) return;

    const hasExplicitManualFocusRequest = Boolean(
      focusRequest?.lat ||
        focusRequest?.lng ||
        focusRequest?.address ||
        focusRequest?.bairro ||
        focusRequest?.quadra ||
        focusRequest?.lote ||
        focusRequest?.loteamento ||
        focusRequest?.logradouro,
    );

    if (!hasExplicitManualFocusRequest) return;

    let cancelled = false;

    (async () => {
      const resolved = await resolveManualFocus(focusRequest, lookupRef.current, centroidRef.current);
      if (!resolved || cancelled) return;

      lastFocusTraceRef.current = resolved.trace;

      const signature = `${resolved.lat.toFixed(6)},${resolved.lng.toFixed(6)}|${resolved.reason}`;
      if (focusAppliedRef.current === signature) return;
      focusAppliedRef.current = signature;
      const resolvedKey = `${resolved.lat.toFixed(6)},${resolved.lng.toFixed(6)}`;
      if (
        mode === "manual" &&
        resolvedKey === sharedManualClickCenterKey &&
        sharedManualClickCenterEchoesToSuppress > 0
      ) {
        sharedManualClickCenterEchoesToSuppress -= 1;
        setMarker(resolved.lat, resolved.lng);
        lastGoToSignatureRef.current = `${resolvedKey}|${resolved.reason}`;
        return;
      }
      void safeGoTo(
        { center: [resolved.lng, resolved.lat], zoom: resolved.zoom },
        `${resolved.lat.toFixed(6)},${resolved.lng.toFixed(6)}|${resolved.reason}`,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, lookupReady, centroidsReady, center, focusRequest]);

  function toggleLayer(key: LayerKey) {
    setLayerVisibility((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <>
      <div className="relative h-full w-full overflow-hidden bg-white">
        <div className="absolute inset-0">
          <div ref={divRef} className="h-full w-full" />
        </div>

      {showChrome && (
        <>
      {mode !== "manual" && (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-slate-950/80 via-slate-950/35 to-transparent px-3 pt-3 md:px-4 md:pt-4">
        <div className="pointer-events-auto rounded-3xl border border-cyan-200/14 bg-slate-950/78 px-4 py-3 text-white shadow-[0_24px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl md:px-5 md:py-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex items-center rounded-full border border-cyan-200/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                Preview local - sem integraÃƒÂ§ÃƒÂ£o ao processamento
              </div>
              <h1 className="mt-2 text-xl font-black tracking-tight text-white md:text-2xl">
                Preview LocalFirst Trindade
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-white/72">
                VisualizaÃƒÂ§ÃƒÂ£o local da base limpa de Trindade usando apenas arquivos estÃƒÂ¡ticos do projeto.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-[11px] text-white/80">
              <div className="font-semibold text-white">{manifestStatus.message}</div>
              <div className="mt-1 space-y-0.5">
                <div>CRS: {manifestStatus.outputCrs || "-"}</div>
                <div>Camadas: {manifestStatus.layerCount ?? "-"}</div>
                <div>Features limpas: {manifestStatus.cleanedCount ?? "-"}</div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {LAYER_CONFIGS.map((layer) => {
              const active = layerVisibility[layer.key];
              return (
                <button
                  key={layer.key}
                  type="button"
                  onClick={() => toggleLayer(layer.key)}
                  className={[
                    "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
                    active
                      ? "border-cyan-200/35 bg-cyan-300/18 text-cyan-50"
                      : "border-white/10 bg-white/5 text-white/68 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  {layer.label}
                </button>
              );
            })}
          </div>
          </div>
        </div>

          )}

          {mode === "manual" && (
            <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-3 text-slate-900 shadow-none">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <label className="flex-1">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Busca por centroides
                  </span>
                  <input
                    value={manualSearchQuery}
                    onChange={(event) => setManualSearchQuery(event.target.value)}
                    placeholder="Rua, bairro, quadra, lote ou loteamento"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-cyan-300"
                  />
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <div>Cache: {manualSearchCacheStats.loadCount}/{manualSearchCacheStats.cacheHits}</div>
                  <div>Status: {manualSearchLoading ? "pesquisando..." : manualSearchQuery.trim() ? `${manualSearchResults.length} resultados` : "aguardando"}</div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <div>manualDataSource: centroid-only</div>
                <div>geojsonLoadedInManual: false</div>
                <div>
                  centroidCache: {manualSearchCacheStats.loadCount}/{manualSearchCacheStats.cacheHits}
                </div>
              </div>

              {manualSearchResults.length > 0 && (
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {manualSearchResults.slice(0, 6).map((result) => {
                    const popup = formatTrindadeCentroidForPopupClient(result.record);
                    return (
                      <button
                        key={`${result.record.sourceIndex}-${result.record.lat}-${result.record.lng}`}
                        type="button"
                        onClick={() => {
                          void selectManualSearchResult(result);
                        }}
                        className="rounded-2xl border border-slate-200 bg-white p-3 text-left text-slate-900 transition hover:border-cyan-300 hover:bg-slate-50"
                      >
                        <div className="text-[12px] font-semibold text-slate-900">{popup.primaryLabel}</div>
                        <div className="mt-1 text-[11px] leading-4 text-slate-600">{popup.summary}</div>
                        <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                          Score {result.score} | Qd {result.record.quadraDisplay || result.record.cdquadra} Lt {result.record.loteDisplay || result.record.cdlote}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showChrome && mode !== "manual" && (
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-slate-950/88 via-slate-950/35 to-transparent px-3 pb-3 md:px-4 md:pb-4">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-2 text-[11px] text-white/70 backdrop-blur-xl">
          Lotes comeÃƒÂ§a desligado por padrÃƒÂ£o para reduzir peso. Quadras aparece primeiro; os demais
          layers podem ser ativados sob demanda.
        </div>
      </div>
      )}
      </div>
    </>
  );
}
