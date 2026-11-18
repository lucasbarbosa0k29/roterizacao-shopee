import fs from "fs";
import path from "path";
import { checkAparecidaTerritory, polygonEdgeDistance } from "@/app/lib/aparecida-territory";
import { normalizeQLIdentity } from "@/app/lib/quadra-lote-normalization";

import RBush from "rbush";
import bbox from "@turf/bbox";
import buffer from "@turf/buffer";
import booleanIntersects from "@turf/boolean-intersects";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { logMemoryDiagnostics } from "@/app/lib/memory-diagnostics";
import { normalizeStreetNameWithoutType, normalizeStreetText } from "@/app/lib/street-normalization";
import type {
  LocalFirstCandidateValidationInput,
  LocalFirstCandidateValidationResult,
  LocalFirstStreetMatchType,
} from "@/app/lib/local-first-validation-types";

type Feature = {
  type: "Feature";
  geometry: any;
  properties?: Record<string, any>;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

type RTreeItem = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  i: number;
};

type LoadedDataset = {
  geo?: FeatureCollection;
  tree?: RBush<RTreeItem>;
  filePath?: string;
  missing?: boolean;
  disabled?: boolean;
};

type CentroidRecord = {
  bairro: string;
  quadra: string;
  lote: string;
  lat: number;
  lng: number;
};

type StreetCentroidRecord = CentroidRecord & {
  streetFullName: string;
  nearDist: number | null;
};

type LoadedCentroids = {
  records?: CentroidRecord[];
  index?: Map<string, number[]>;
  missing?: boolean;
  disabled?: boolean;
};

type LoadedStreetCentroids = {
  records?: StreetCentroidRecord[];
  index?: Map<string, number[]>;
  missing?: boolean;
  disabled?: boolean;
};

export type AparecidaLocalLotCandidate = {
  quadra: string;
  lote: string;
  bairro: string;
  centroid: { lat: number; lng: number };
  strongMatch: true;
  bairroDivergenteLocalForte?: boolean;
  localAliasAccepted?: boolean;
  bairroPriority?: "exact" | "alias" | "mismatch";
  bairroMismatchLocalFirst?: boolean;
  canFinalizeLocalFirst?: boolean;
  territoryVerified?: boolean;
  streetVerified?: boolean;
  validationReason?: string;
  stopPaidSearch?: boolean;
};

const dataset: LoadedDataset = {};
const centroids: LoadedCentroids = {};
const streetCentroids: LoadedStreetCentroids = {};
const coordinateCache = new Map<string, any>();
const LOCAL_ALIAS_MAX_SPREAD_METERS = 120;
const APARECIDA_CENTROID_CACHE_TTL_MS = 15 * 60 * 1000;

let centroidCacheActiveReaders = 0;
let centroidCacheClearPending = false;
let centroidCacheTtlTimer: ReturnType<typeof setTimeout> | null = null;
let centroidCacheLastAccessAt = 0;
let centroidsEverLoaded = false;
let streetCentroidsEverLoaded = false;

export function getAparecidaLocalLotsCacheSnapshot() {
  return {
    datasetLoaded: !!dataset.geo && !!dataset.tree,
    centroidsLoaded: !!centroids.records && !!centroids.index,
    streetCentroidsLoaded: !!streetCentroids.records && !!streetCentroids.index,
    coordinateCacheSize: coordinateCache.size,
    centroidCacheActiveReaders,
    centroidCacheClearPending,
    centroidCacheTtlArmed: !!centroidCacheTtlTimer,
    centroidCacheLastAccessAt,
  };
}

function logAparecidaCentroidCacheEvent(event: string, extra: Record<string, unknown> = {}) {
  logMemoryDiagnostics(event, {
    route: "aparecida-local-lots",
    cacheSizes: getAparecidaLocalLotsCacheSnapshot(),
    ...extra,
  });
}

function cancelAparecidaCentroidCacheTtlTimer() {
  if (centroidCacheTtlTimer) {
    clearTimeout(centroidCacheTtlTimer);
    centroidCacheTtlTimer = null;
  }
}

function hasAparecidaCentroidCacheData() {
  return !!centroids.records || !!centroids.index || !!streetCentroids.records || !!streetCentroids.index;
}

function armAparecidaCentroidCacheTtl() {
  cancelAparecidaCentroidCacheTtlTimer();

  if (!hasAparecidaCentroidCacheData()) return;

  centroidCacheTtlTimer = setTimeout(() => {
    centroidCacheTtlTimer = null;
    logAparecidaCentroidCacheEvent("CACHE_TTL_EXPIRED", {
      ttlMs: APARECIDA_CENTROID_CACHE_TTL_MS,
      activeReaders: centroidCacheActiveReaders,
    });

    if (centroidCacheActiveReaders > 0) {
      centroidCacheClearPending = true;
      logAparecidaCentroidCacheEvent("CACHE_CLEAR_DEFERRED", {
        reason: "TTL_EXPIRED_DURING_ACTIVE_USE",
        activeReaders: centroidCacheActiveReaders,
      });
      return;
    }

    clearAparecidaCentroidCaches("TTL_EXPIRED");
  }, APARECIDA_CENTROID_CACHE_TTL_MS);

  centroidCacheTtlTimer.unref?.();
}

function touchAparecidaCentroidCache() {
  centroidCacheLastAccessAt = Date.now();
  if (centroidCacheActiveReaders === 0 && !centroidCacheClearPending) {
    armAparecidaCentroidCacheTtl();
  }
}

function acquireAparecidaCentroidLease() {
  centroidCacheActiveReaders += 1;
  centroidCacheLastAccessAt = Date.now();
  cancelAparecidaCentroidCacheTtlTimer();
}

function releaseAparecidaCentroidLease() {
  centroidCacheActiveReaders = Math.max(0, centroidCacheActiveReaders - 1);
  centroidCacheLastAccessAt = Date.now();

  if (centroidCacheActiveReaders > 0) return;

  if (centroidCacheClearPending) {
    centroidCacheClearPending = false;
    clearAparecidaCentroidCaches("TTL_EXPIRED_AFTER_ACTIVE_USE");
    return;
  }

  armAparecidaCentroidCacheTtl();
}

export function clearAparecidaCentroidCaches(reason: string) {
  cancelAparecidaCentroidCacheTtlTimer();

  const hadData =
    !!centroids.records ||
    !!centroids.index ||
    !!streetCentroids.records ||
    !!streetCentroids.index ||
    coordinateCache.size > 0;

  centroids.records = undefined;
  centroids.index = undefined;
  streetCentroids.records = undefined;
  streetCentroids.index = undefined;
  coordinateCache.clear();
  centroidCacheClearPending = false;

  if (hadData) {
    logAparecidaCentroidCacheEvent("CACHE_CLEARED", {
      reason,
      coordinateCacheCleared: true,
    });
  }
}

function disableDataset(reason: string, error?: unknown) {
  dataset.disabled = true;
  console.error("[APARECIDA_LOCAL_LOTS_DISABLED]", {
    reason,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  });
  return dataset;
}

function disableCentroids(reason: string, error?: unknown) {
  centroids.disabled = true;
  console.error("[APARECIDA_LOCAL_CENTROIDS_DISABLED]", {
    reason,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  });
  return centroids;
}

function disableStreetCentroids(reason: string, error?: unknown) {
  streetCentroids.disabled = true;
  console.error("[APARECIDA_LOCAL_STREET_CENTROIDS_DISABLED]", {
    reason,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  });
  return streetCentroids;
}

function normalizeText(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function repairAparecidaBairroEncoding(value: string) {
  return String(value || "")
    .replace(/BRAS\uFFFDLIA/gi, "BRASILIA")
    .replace(/NA\uFFFDOES/gi, "NACOES")
    .replace(/CEC\uFFFDLIA/gi, "CECILIA")
    .replace(/EL\uFFFDSIOS/gi, "ELISIOS")
    .replace(/EL\uFFFDSIO/gi, "ELISIO")
    .replace(/PARA\uFFFDSO/gi, "PARAISO")
    .replace(/CONTINUA\uFFFDAO/gi, "CONTINUACAO")
    .replace(/SAT\uFFFDLITE/gi, "SATELITE")
    .replace(/ACR\uFFFDSCIMO/gi, "ACRESCIMO")
    .replace(/GOI\uFFFDNIA/gi, "GOIANIA");
}

const canonicalLot = normalizeQLIdentity;
const normalizeQuadraLoteValue = normalizeQLIdentity;

function normalizeBairroValue(value: string) {
  return normalizeText(repairAparecidaBairroEncoding(value))
    .replace(/\bELISEOS\b/g, "ELISIOS")
    .replace(/\s+/g, " ");
}

function normalizeAparecidaBairroPairKey(left: string, right: string) {
  const a = normalizeAparecidaBairroForLocalFirstCompare(left);
  const b = normalizeAparecidaBairroForLocalFirstCompare(right);
  if (!a || !b) return "";
  return a < b ? `${a}|||${b}` : `${b}|||${a}`;
}

export function normalizeAparecidaBairroForLocalFirstCompare(value: string, normalizeTypography = true) {
  let text = normalizeAparecidaBairroForCompare(value);
  if (normalizeTypography) text = text
    .replace(/[-–—.,;:()[\]{}]/g, " ")
    .replace(/\b(PRIMEIR[AO]|SEGUND[AO]|TERCEIR[AO]|QUART[AO]|QUINT[AO]|SEXT[AO]|SETIM[AO]|OITAV[AO]|NON[AO]|DECIM[AO])(?=\s+(?:ETAPA|COMPLEMENTO|GLEBA)\b)/g, (word) => {
      const ordinals: Record<string, string> = { PRIMEIRA: "1", PRIMEIRO: "1", SEGUNDA: "2", SEGUNDO: "2", TERCEIRA: "3", TERCEIRO: "3", QUARTA: "4", QUARTO: "4", QUINTA: "5", QUINTO: "5", SEXTA: "6", SEXTO: "6", SETIMA: "7", SETIMO: "7", OITAVA: "8", OITAVO: "8", NONA: "9", NONO: "9", DECIMA: "10", DECIMO: "10" };
      return ordinals[word] || word;
    });
  return text.replace(/\b(?:QDRA|QUADRA|QDR|QDA|QD|LTS|LTT|LTE|LOTE|LOT|LT)\d*\b.*$/g, "")
    .replace(/\s+/g, " ").trim();
}

function normalizeAparecidaBairroStageToken(token: string) {
  const stageMap: Record<string, string> = {
    "1": "I",
    "2": "II",
    "3": "III",
    "4": "IV",
    "5": "V",
    "6": "VI",
    "7": "VII",
    "8": "VIII",
    "9": "IX",
    "10": "X",
  };

  return stageMap[token] || token;
}

export function normalizeAparecidaTerritoryName(value: string) {
  return normalizeAparecidaBairroForLocalFirstCompare(value)
    .replace(/^(?:(?:JARDIM|JD|SETOR|ST|RESIDENCIAL|RES|PARQUE|PQ|VILA|VL|LOTEAMENTO)\s+)+/, "")
    .replace(/\b(?:PLANICIES|PLANICES)\b/g, "PLANICIE")
    .split(" ").map(normalizeAparecidaBairroStageToken).join(" ");
}

function normalizeAparecidaBairroForLocalFirstTokens(value: string, normalizeTypography = true) {
  return normalizeAparecidaBairroForLocalFirstCompare(value, normalizeTypography)
    .split(" ")
    .filter(Boolean)
    .map(normalizeAparecidaBairroStageToken)
    .filter((token) => !APARECIDA_BAIRRO_GENERIC_TOKENS.has(token));
}

function areAparecidaBairroStageTokensOnly(value: string) {
  if (!value) return false;
  return value
    .split(" ")
    .filter(Boolean)
    .every((token) => /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/.test(token));
}

function isAparecidaBairroSafeLocalFirstSuffix(value: string) {
  const tokens = value.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => areAparecidaBairroStageTokensOnly(token));
}

const APARECIDA_BAIRRO_DENYLIST = new Set([
  normalizeAparecidaBairroPairKey("JARDIM LUZ", "VEIGA JARDIM"),
  normalizeAparecidaBairroPairKey("CIDADE SATELITE SAO LUIZ", "CIDADE LIVRE"),
  normalizeAparecidaBairroPairKey("PAPILLON PARK", "VIRGINIA PARK"),
  normalizeAparecidaBairroPairKey("MARIA INES", "CRUZEIRO DO SUL"),
  normalizeAparecidaBairroPairKey("MARIA", "MARIA INES"),
  normalizeAparecidaBairroPairKey("SANTA", "SANTA LUZIA"),
  normalizeAparecidaBairroPairKey("GOIANI", "GOIANIA PARK SUL"),
  normalizeAparecidaBairroPairKey("GARAVELO", "VILLAGE GARAVELO"),
  normalizeAparecidaBairroPairKey("SETOR GARAVELO", "VILLAGE GARAVELO"),
  normalizeAparecidaBairroPairKey("SANTO ANTONIO", "SANTO ANDRE"),
  normalizeAparecidaBairroPairKey("JARDIM LUZ", "JARDIM HELVECIA"),
  normalizeAparecidaBairroPairKey("JARDIM LUZ", "JARDIM CRISTAL"),
  normalizeAparecidaBairroPairKey("JARDIM LUZ", "JARDIM IPANEMA"),
  normalizeAparecidaBairroPairKey("JARDIM LUZ", "JARDIM RIO GRANDE"),
  normalizeAparecidaBairroPairKey("SETOR SANTO ANDRE", "SANTO ANTONIO"),
  normalizeAparecidaBairroPairKey("SETOR SANTO ANDRE", "INDUSTRIAL SANTO ANTONIO"),
  normalizeAparecidaBairroPairKey("SETOR SANTO ANDRE", "CONJUNTO HABITACIONAL PROGRESSO"),
  normalizeAparecidaBairroPairKey("SETOR SANTO ANDRE", "CONJUNTO PROGRESSO"),
  normalizeAparecidaBairroPairKey("RESIDENCIAL CARAIBAS", "CRUZEIRO DO SUL"),
  normalizeAparecidaBairroPairKey("RESIDENCIAL CARAIBAS", "MONT SERRAT"),
  normalizeAparecidaBairroPairKey("RESIDENCIAL CARAIBAS", "ANA ROSA"),
]);

const APARECIDA_BAIRRO_ALLOWLIST = new Set([
  normalizeAparecidaBairroPairKey("SETOR PLANICIE", "PLANICIES"),
  normalizeAparecidaBairroPairKey("CIDADE VERA CRUZ", "CIDADE VERA CRUZ - JARDINS MONACO"),
  normalizeAparecidaBairroPairKey("CIDADE VERA CRUZ", "CIDADE VERA CRUZ - JARDINS VIENA"),
  normalizeAparecidaBairroPairKey("CIDADE VERA CRUZ", "CIDADE VERA CRUZ - COND. EMPRESARIAL VILLAGE"),
  normalizeAparecidaBairroPairKey("CARDOSO", "CARDOSO CONTINUACAO"),
  normalizeAparecidaBairroPairKey("CIDADE VERA CRUZ 2", "CIDADE VERA CRUZ"),
  normalizeAparecidaBairroPairKey("CIDADE VERA CRUZ II", "CIDADE VERA CRUZ"),
  normalizeAparecidaBairroPairKey("GARAVELO PARK", "GARAVELO"),
  normalizeAparecidaBairroPairKey("SETOR GARAVELO", "GARAVELO"),
]);

const APARECIDA_BAIRRO_GENERIC_TOKENS = new Set([
  "JARDIM",
  "JD",
  "CIDADE",
  "PARK",
  "PARQUE",
  "SETOR",
  "ST",
  "RESIDENCIAL",
  "RES",
  "VILA",
  "VL",
  "SANTA",
  "SANTO",
  "SAO",
  "LUZ",
  "VERA",
  "LIVRE",
  "CRUZ",
  "VALE",
  "NOVA",
  "SITIO",
  "SITIOS",
  "ACRESCIMO",
  "CONTINUACAO",
  "COMPLEMENTO",
  "ETAPA",
  "GLEBA",
  "CONJUNTO",
  "BAIRRO",
  "INDUSTRIAL",
]);

function isAparecidaBairroDenied(left: string, right: string) {
  return APARECIDA_BAIRRO_DENYLIST.has(normalizeAparecidaBairroPairKey(left, right));
}

function isAparecidaBairroAllowed(left: string, right: string) {
  return APARECIDA_BAIRRO_ALLOWLIST.has(normalizeAparecidaBairroPairKey(left, right));
}

function tokenizeAparecidaBairro(value: string) {
  return normalizeAparecidaBairroForCompare(value)
    .split(" ")
    .filter(Boolean);
}

function hasStrongSharedAparecidaBairroToken(left: string, right: string) {
  const rightTokens = new Set(tokenizeAparecidaBairro(right));
  return tokenizeAparecidaBairro(left).some(
    (token) => rightTokens.has(token) && !APARECIDA_BAIRRO_GENERIC_TOKENS.has(token),
  );
}

export function normalizeAparecidaBairroForCompare(value: string) {
  return normalizeBairroValue(value);
}

export function areAparecidaBairrosCompatible(expected: string, actual: string, normalizeTypography = true) {
  const left = normalizeAparecidaBairroForLocalFirstCompare(expected, normalizeTypography);
  const right = normalizeAparecidaBairroForLocalFirstCompare(actual, normalizeTypography);
  if (!left || !right) return false;
  if (isAparecidaBairroDenied(left, right)) return false;
  const newTerritorialAlias = normalizeAparecidaBairroPairKey(left, right) === normalizeAparecidaBairroPairKey("SETOR PLANICIE", "PLANICIES");
  if (isAparecidaBairroAllowed(left, right) && (normalizeTypography || !newTerritorialAlias)) return true;
  if (left === right) return true;

  const leftTokens = normalizeAparecidaBairroForLocalFirstTokens(left, normalizeTypography);
  const rightTokens = normalizeAparecidaBairroForLocalFirstTokens(right, normalizeTypography);
  if (!leftTokens.length || !rightTokens.length) return false;

  const leftKey = leftTokens.join(" ");
  const rightKey = rightTokens.join(" ");
  if (leftKey === rightKey) return true;

  if (leftKey.startsWith(`${rightKey} `)) {
    return isAparecidaBairroSafeLocalFirstSuffix(leftKey.slice(rightKey.length).trim());
  }

  if (rightKey.startsWith(`${leftKey} `)) {
    return isAparecidaBairroSafeLocalFirstSuffix(rightKey.slice(leftKey.length).trim());
  }

  return false;
}

function bairroCompatible(expected: string, actual: string) {
  return areAparecidaBairrosCompatible(expected, actual);
}

function centroidDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function maxCentroidSpreadMeters(records: CentroidRecord[]) {
  let max = 0;
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      max = Math.max(max, centroidDistanceMeters(records[i], records[j]));
    }
  }
  return max;
}

function coordCacheKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function looksSwapped(geo: FeatureCollection) {
  const f = geo.features?.find((x) => x?.geometry?.coordinates);
  if (!f) return false;

  const c = f.geometry.coordinates;
  const sample =
    Array.isArray(c?.[0]?.[0]) ? c[0][0] :
    Array.isArray(c?.[0]?.[0]?.[0]) ? c[0][0][0] :
    c?.[0];

  if (!Array.isArray(sample) || sample.length < 2) return false;

  const a = Number(sample[0]);
  const b = Number(sample[1]);

  const xLooksLat = a > -25 && a < -10;
  const yLooksLng = b > -52 && b < -46;

  return xLooksLat && yLooksLng;
}

function flipCoordsDeep(coords: any): any {
  if (!Array.isArray(coords)) return coords;

  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    return [coords[1], coords[0], ...coords.slice(2)];
  }

  return coords.map(flipCoordsDeep);
}

function flipGeometry(geom: any) {
  if (!geom) return geom;
  return { ...geom, coordinates: flipCoordsDeep(geom.coordinates) };
}

function loadAparecidaDataset() {
  if (dataset.missing || dataset.disabled) return dataset;
  if (dataset.geo && dataset.tree) return dataset;

  const filePath = path.join(process.cwd(), "public", "data", "aparecida_lotes.min.geojson");
  if (!fs.existsSync(filePath)) {
    dataset.missing = true;
    return dataset;
  }

  try {
    logMemoryDiagnostics("aparecida:before-load-dataset", {
      route: "aparecida-local-lots",
      filePath,
      cacheSizes: {
        ...getAparecidaLocalLotsCacheSnapshot(),
      },
    });
    const parsed = (() => {
      const raw = fs.readFileSync(filePath, "utf8");
      if (raw.trimStart().startsWith("version https://git-lfs.github.com/spec")) {
        return { reason: "GIT_LFS_POINTER" } as const;
      }

      try {
        return { geo: JSON.parse(raw) as FeatureCollection } as const;
      } catch (error) {
        return { reason: "INVALID_JSON", error } as const;
      }
    })();

    if ("reason" in parsed) {
      return disableDataset(parsed.reason || "LOAD_FAILED", "error" in parsed ? parsed.error : undefined);
    }

    let geo = parsed.geo;

    if (geo?.type !== "FeatureCollection" || !Array.isArray(geo.features)) {
      return disableDataset("INVALID_FEATURE_COLLECTION");
    }

    if (looksSwapped(geo)) {
      geo = {
        type: "FeatureCollection",
        features: geo.features.map((f) => ({
          ...f,
          geometry: flipGeometry(f.geometry),
        })),
      };
    }

    const tree = new RBush<RTreeItem>();
    const items: RTreeItem[] = [];

    for (let i = 0; i < geo.features.length; i++) {
      const feature = geo.features[i];
      try {
        const [minX, minY, maxX, maxY] = bbox(feature as any);
        items.push({ minX, minY, maxX, maxY, i });
      } catch {}
    }

    tree.load(items);

    dataset.geo = geo;
    dataset.tree = tree;
    dataset.filePath = filePath;
    dataset.missing = false;

    logMemoryDiagnostics("aparecida:after-load-dataset", {
      route: "aparecida-local-lots",
      filePath,
      cacheSizes: {
        ...getAparecidaLocalLotsCacheSnapshot(),
        features: geo.features.length,
      },
    });

    return dataset;
  } catch (error) {
    return disableDataset("LOAD_FAILED", error);
  }
}

function loadAparecidaCentroids() {
  if (centroids.missing || centroids.disabled) return centroids;
  if (centroids.records && centroids.index) {
    touchAparecidaCentroidCache();
    return centroids;
  }

  const filePath = path.join(process.cwd(), "public", "data", "aparecida_lot_centroids.json");
  if (!fs.existsSync(filePath)) {
    centroids.missing = true;
    return centroids;
  }

  try {
    logMemoryDiagnostics("aparecida:before-load-centroids", {
      route: "aparecida-local-lots",
      filePath,
      cacheSizes: {
        ...getAparecidaLocalLotsCacheSnapshot(),
      },
    });
    const records = (() => {
      const raw = fs.readFileSync(filePath, "utf8");
      if (raw.trimStart().startsWith("version https://git-lfs.github.com/spec")) {
        return null;
      }
      return JSON.parse(raw) as CentroidRecord[];
    })();
    if (!records) return disableCentroids("GIT_LFS_POINTER");
    if (!Array.isArray(records)) return disableCentroids("INVALID_JSON_STRUCTURE");

    const index = new Map<string, number[]>();
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (
        !record ||
        !Number.isFinite(record.lat) ||
        !Number.isFinite(record.lng)
      ) {
        return disableCentroids("INVALID_RECORD");
      }

      const q = normalizeQuadraLoteValue(record.quadra);
      const l = canonicalLot(record.lote);
      if (!q || !l) continue;

      const key = `${q}__${l}`;
      const bucket = index.get(key) || [];
      bucket.push(i);
      index.set(key, bucket);
    }

    centroids.records = records;
    centroids.index = index;
    const eventName = centroidsEverLoaded ? "CACHE_RELOADED" : "CACHE_LOAD";
    centroidsEverLoaded = true;
    touchAparecidaCentroidCache();
    logAparecidaCentroidCacheEvent(eventName, {
      cacheName: "centroids",
      route: "aparecida-local-lots",
      filePath,
      records: records.length,
      indexKeys: index.size,
    });
    return centroids;
  } catch (error) {
    return disableCentroids("LOAD_FAILED", error);
  }
}

function streetCentroidKey(bairro: string, quadra: string, lote: string) {
  const b = normalizeBairroValue(bairro);
  const q = normalizeQuadraLoteValue(quadra);
  const l = canonicalLot(lote);
  if (!b || !q || !l) return "";
  return `${b}__${q}__${l}`;
}

function loadAparecidaStreetCentroids() {
  if (streetCentroids.missing || streetCentroids.disabled) return streetCentroids;
  if (streetCentroids.records && streetCentroids.index) {
    touchAparecidaCentroidCache();
    return streetCentroids;
  }

  const filePath = path.join(process.cwd(), "public", "data", "aparecida_lot_centroids_with_street.json");
  if (!fs.existsSync(filePath)) {
    streetCentroids.missing = true;
    return streetCentroids;
  }

  try {
    logMemoryDiagnostics("aparecida:before-load-street-centroids", {
      route: "aparecida-local-lots",
      filePath,
      cacheSizes: {
        ...getAparecidaLocalLotsCacheSnapshot(),
      },
    });
    const records = (() => {
      const raw = fs.readFileSync(filePath, "utf8");
      if (raw.trimStart().startsWith("version https://git-lfs.github.com/spec")) {
        return null;
      }
      return JSON.parse(raw) as StreetCentroidRecord[];
    })();
    if (!records) return disableStreetCentroids("GIT_LFS_POINTER");
    if (!Array.isArray(records)) return disableStreetCentroids("INVALID_JSON_STRUCTURE");

    const index = new Map<string, number[]>();
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record) continue;

      const key = streetCentroidKey(record.bairro, record.quadra, record.lote);
      if (!key) continue;

      const bucket = index.get(key) || [];
      bucket.push(i);
      index.set(key, bucket);
    }

    streetCentroids.records = records;
    streetCentroids.index = index;
    const eventName = streetCentroidsEverLoaded ? "CACHE_RELOADED" : "CACHE_LOAD";
    streetCentroidsEverLoaded = true;
    touchAparecidaCentroidCache();
    logAparecidaCentroidCacheEvent(eventName, {
      cacheName: "streetCentroids",
      route: "aparecida-local-lots",
      filePath,
      records: records.length,
      indexKeys: index.size,
    });
    return streetCentroids;
  } catch (error) {
    return disableStreetCentroids("LOAD_FAILED", error);
  }
}

function isValidNearDist(value: unknown) {
  return Number.isFinite(value) && Number(value) >= 0;
}

function compareStreetCentroidCandidate(a: StreetCentroidRecord, b: StreetCentroidRecord) {
  const aHasStreet = String(a.streetFullName || "").trim() ? 1 : 0;
  const bHasStreet = String(b.streetFullName || "").trim() ? 1 : 0;
  if (aHasStreet !== bHasStreet) return bHasStreet - aHasStreet;

  const aValidNear = isValidNearDist(a.nearDist);
  const bValidNear = isValidNearDist(b.nearDist);
  if (aValidNear !== bValidNear) return aValidNear ? -1 : 1;

  if (aValidNear && bValidNear) {
    return Number(a.nearDist) - Number(b.nearDist);
  }

  return 0;
}

export function findAparecidaLocalStreetCandidate(args: {
  bairro: string;
  quadra: string;
  lote: string;
  position?: { lat: number; lng: number };
}): { streetFullName: string; nearDist: number | null } | null {
  const { records, index, missing } = loadAparecidaStreetCentroids();
  if (missing || !records || !index) return null;

  const key = streetCentroidKey(args.bairro, args.quadra, args.lote);
  if (!key) return null;

  const bucket = index.get(key);
  if (!bucket || !bucket.length) return null;

  const candidates = bucket
    .map((recordIndex) => records[recordIndex])
    .filter((record) => !!record && (!args.position || centroidDistanceMeters(record, args.position) < 1)) as StreetCentroidRecord[];
  if (!candidates.length) return null;

  candidates.sort(compareStreetCentroidCandidate);
  const best = candidates[0];

  return {
    streetFullName: String(best.streetFullName || "").trim(),
    nearDist: isValidNearDist(best.nearDist) ? Number(best.nearDist) : null,
  };
}

function pickFirstString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function polygonCentroid(ring: number[][]) {
  if (!Array.isArray(ring) || ring.length < 3) return null;

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i] || [];
    const [x2, y2] = ring[i + 1] || [];
    if (![x1, y1, x2, y2].every((n) => Number.isFinite(Number(n)))) continue;

    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }

  if (!twiceArea) return null;
  const area = twiceArea / 2;
  return {
    lng: cx / (6 * area),
    lat: cy / (6 * area),
  };
}

function geometryCentroid(geometry: any): { lat: number; lng: number } | null {
  if (!geometry?.coordinates) return null;

  const coords = geometry.coordinates;
  const candidates: any[] = [];

  if (geometry.type === "Polygon" && Array.isArray(coords)) {
    candidates.push(coords);
  } else if (geometry.type === "MultiPolygon" && Array.isArray(coords)) {
    for (const poly of coords) {
      if (Array.isArray(poly)) candidates.push(poly);
    }
  } else {
    return null;
  }

  let best: { lat: number; lng: number } | null = null;
  let bestAbsArea = 0;

  for (const poly of candidates) {
    const outer: any[] = poly?.[0];
    if (!Array.isArray(outer)) continue;
    const centroid = polygonCentroid(outer as number[][]);
    if (centroid) {
      const area = Math.abs(
        (outer as any[]).reduce((acc, cur, idx) => {
          if (idx === outer.length - 1) return acc;
          const [x1, y1] = outer[idx] || [];
          const [x2, y2] = outer[idx + 1] || [];
          return acc + (x1 * y2 - x2 * y1);
        }, 0),
      );
      if (area > bestAbsArea) {
        best = centroid;
        bestAbsArea = area;
      }
    }
  }

  if (best) return best;

  try {
    const [minX, minY, maxX, maxY] = bbox({ type: "Feature", geometry } as any);
    return {
      lng: (minX + maxX) / 2,
      lat: (minY + maxY) / 2,
    };
  } catch {
    return null;
  }
}

// A recovery veto requires one unambiguous containing parcel. The legacy
// lookup also uses a small buffer for its interactive map behavior.
export function lookupStrictAparecidaParcel(lat: number, lng: number) {
  const { geo, tree } = loadAparecidaDataset();
  if (!geo || !tree) return null;
  const hits = tree.search({ minX: lng, minY: lat, maxX: lng, maxY: lat })
    .map(({ i }) => geo.features[i])
    .filter((f) => (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon") &&
      booleanPointInPolygon([lng, lat], f.geometry, { ignoreBoundary: true }));
  if (hits.length !== 1) return null;
  return {
    quadra: pickFirstString(hits[0].properties || {}, ["quadra", "num_qdr", "NUM_QDR", "QD"]),
    lote: pickFirstString(hits[0].properties || {}, ["lote", "num_lot", "NUM_LOT", "LT"]),
    edgeDistanceM: polygonEdgeDistance({ lat, lng }, hits[0].geometry),
  };
}

export function lookupAparecidaLotByCoordinates(lat: number, lng: number) {
  acquireAparecidaCentroidLease();
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { found: false as const };
    }

    const cacheKey = coordCacheKey(lat, lng);
    if (coordinateCache.has(cacheKey)) {
      return { ...coordinateCache.get(cacheKey), cached: true };
    }

    const { geo, tree, missing } = loadAparecidaDataset();
    if (missing || !geo || !tree) {
      return { found: false as const };
    }

    const candidates = tree.search({
      minX: lng,
      minY: lat,
      maxX: lng,
      maxY: lat,
    });

    if (!candidates.length) {
      coordinateCache.set(cacheKey, { found: false });
      return { found: false as const };
    }

    const pt = point([lng, lat]);
    const ptBuffer = buffer(pt, 2, { units: "meters" });

    for (const c of candidates) {
      const f = geo.features[c.i];
      if (!f) continue;

      if (booleanIntersects(ptBuffer as any, f as any)) {
        const p = f.properties || {};
        const result = {
          found: true as const,
          quadra: pickFirstString(p, ["quadra", "num_qdr", "NUM_QDR", "QD"]),
          lote: pickFirstString(p, ["lote", "num_lot", "NUM_LOT", "LT"]),
          bairro: pickFirstString(p, ["bairro", "nm_bai", "NM_BAI", "SETOR"]),
        };

        coordinateCache.set(cacheKey, result);
        return { ...result, cached: false };
      }
    }

    coordinateCache.set(cacheKey, { found: false });
    return { found: false as const };
  } finally {
    releaseAparecidaCentroidLease();
  }
}

export function findAparecidaLocalLotCandidate(args: {
  quadra: string;
  lote: string;
  bairro: string;
  planilhaBairro?: string;
  rua?: string;
  cidade?: string;
  cep?: string;
  allowStrongBairroAlias?: boolean;
}) {
  acquireAparecidaCentroidLease();
  try {
  const q = normalizeQuadraLoteValue(args.quadra || "");
  const l = canonicalLot(args.lote || "");
  const bairro = String(args.bairro || "").trim();
  const sheetBairroSource = args.planilhaBairro || args.bairro || "";
  const sheetBairro = normalizeAparecidaBairroForCompare(sheetBairroSource);

  if (!q || !l || !bairro) return null;

  const { records, index, missing } = loadAparecidaCentroids();
  if (missing || !records || !index) return null;

  const bucket = index.get(`${q}__${l}`);
  if (!bucket || !bucket.length) return null;

  const bucketRecords = bucket
    .map((recordIndex) => records[recordIndex])
    .filter(Boolean) as CentroidRecord[];

  // Do not turn compound parcel text into an atomic cadastral key.
  if (!/^[A-Z0-9]+$/.test(q) || !/^[A-Z0-9]+$/.test(l)) return null;
  const candidates = bucketRecords.map((record): AparecidaLocalLotCandidate => {
    const position = { lat: record.lat, lng: record.lng };
    const exact = !!sheetBairro && normalizeAparecidaBairroForCompare(record.bairro) === sheetBairro;
    const alias = !!sheetBairro && areAparecidaBairrosCompatible(sheetBairroSource, record.bairro);
    const existingAlias = !!sheetBairro && areAparecidaBairrosCompatible(sheetBairroSource, record.bairro, false);
    const territory = checkAparecidaTerritory(sheetBairroSource, position, normalizeAparecidaTerritoryName);
    const localStreet = findAparecidaLocalStreetCandidate({ bairro: record.bairro, quadra: q, lote: l, position });
    const streetVerified = !!localStreet && localStreet.nearDist != null && localStreet.nearDist <= 20 &&
      compareAparecidaStreetForValidation(args.rua || "", localStreet.streetFullName) === "STREET_MATCH";
    // Existing exact names keep their path. A broader cadastral label requires
    // independent street evidence and a confirmed polygon of the sheet bairro.
    const spatialConflict = territory.known && !territory.matched;
    const streetConflict = !!localStreet && localStreet.nearDist != null && localStreet.nearDist <= 20 &&
      compareAparecidaStreetForValidation(args.rua || "", localStreet.streetFullName) === "STREET_MISMATCH";
    // Preserve established matches. Newly enabled typography/aliases need
    // independent territorial and street proof, never just a similar label.
    const allowed = exact || existingAlias ? !spatialConflict : alias && territory.matched && streetVerified;
    return {
      quadra: normalizeQuadraLoteValue(record.quadra), lote: canonicalLot(record.lote),
      bairro: record.bairro, centroid: position, strongMatch: true,
      bairroPriority: exact ? "exact" : alias ? "alias" : "mismatch",
      canFinalizeLocalFirst: allowed,
      bairroMismatchLocalFirst: !allowed,
      localAliasAccepted: !exact && allowed,
      territoryVerified: territory.matched, streetVerified,
      validationReason: allowed ? "LOCAL_CONTEXT_VALIDATED" : streetConflict ? "LOCAL_STREET_CONFLICT" : spatialConflict ? "LOCAL_TERRITORY_CONFLICT" : !alias && !exact ? "LOCAL_BAIRRO_MISMATCH" : "LOCAL_CONTEXT_UNVERIFIED",
      // Preserve the historical bypass only for previously accepted local matches.
      // A new street conflict blocks acceptance, not the existing HERE queries.
      stopPaidSearch: !allowed && (exact || existingAlias),
    };
  });
  const accepted = candidates.filter(x => x.canFinalizeLocalFirst);
  const distinct = new Map(accepted.map(x => [`${x.centroid.lat.toFixed(6)}|${x.centroid.lng.toFixed(6)}`, x]));
  if (distinct.size === 1) return [...distinct.values()][0];
  if (distinct.size > 1) return { ...accepted[0], canFinalizeLocalFirst: false, stopPaidSearch: true, validationReason: "LOCAL_MULTIPLE_PARCELS" };
  return candidates.find(x => x.stopPaidSearch || (x.territoryVerified && x.validationReason === "LOCAL_STREET_CONFLICT")) || candidates[0] || null;

  } finally {
    releaseAparecidaCentroidLease();
  }
}

export function compareAparecidaStreetForValidation(
  expected: string,
  actual: string,
): LocalFirstStreetMatchType {
  const type = (text: string) => {
    const first = normalizeStreetText(text).split(" ")[0];
    const types: Record<string, string> = { R: "RUA", RUA: "RUA", AV: "AVENIDA", AVENIDA: "AVENIDA", AL: "ALAMEDA", ALAMEDA: "ALAMEDA", TV: "TRAVESSA", TRAVESSA: "TRAVESSA" };
    return types[first] || "";
  };
  const name = (text: string) => normalizeStreetNameWithoutType(text)
    .replace(/^(?:DOUTOR|DR)\s+/, "")
    .replace(/\b(?:DE|DA|DO|DAS|DOS)\b/g, " ").replace(/\s+/g, " ").trim();
  const left = name(expected);
  const right = name(actual);
  if (!left || !right) return "STREET_UNKNOWN";
  if (type(expected) && type(actual) && type(expected) !== type(actual)) return "STREET_MISMATCH";
  if (left === right) return "STREET_MATCH";
  return "STREET_MISMATCH";
}

export function resolveAparecidaLocalFirstCandidate(
  args: LocalFirstCandidateValidationInput,
): LocalFirstCandidateValidationResult {
  const inputHadRua = !!String(args.rua || "").trim();

  if (args.city !== "APARECIDA") {
    return {
      attempted: false,
      found: false,
      validationStatus: "FAILED",
      reason: "city_not_aparecida",
      failureReason: "city_not_aparecida",
      city: "APARECIDA",
      matchType: "city_not_aparecida",
      streetMatchType: null,
      candidateCount: 0,
      candidateUnique: false,
      candidate: null,
      diagnostics: {
        inputCity: args.city,
        inputHadRua,
      },
    };
  }

  const bairro = String(args.bairro || "").trim();
  const quadra = String(args.quadra || "").trim();
  const lote = String(args.lote || "").trim();

  if (!bairro || !quadra || !lote) {
    return {
      attempted: true,
      found: false,
      validationStatus: "FAILED",
      reason: "missing_bairro_quadra_or_lote",
      failureReason: "missing_bairro_quadra_or_lote",
      city: "APARECIDA",
      matchType: "missing_parts",
      streetMatchType: null,
      candidateCount: 0,
      candidateUnique: false,
      candidate: null,
      diagnostics: {
        inputHadRua,
        hasBairro: !!bairro,
        hasQuadra: !!quadra,
        hasLote: !!lote,
      },
    };
  }

  const candidate = findAparecidaLocalLotCandidate({
    bairro,
    planilhaBairro: bairro,
    quadra,
    lote,
    rua: args.rua ?? undefined,
    cidade: "Aparecida de Goiânia",
  });

  if (!candidate) {
    return {
      attempted: true,
      found: false,
      validationStatus: "FAILED",
      reason: "aparecida_qd_lt_not_found",
      failureReason: "aparecida_qd_lt_not_found",
      city: "APARECIDA",
      matchType: "not_found",
      streetMatchType: null,
      candidateCount: 0,
      candidateUnique: false,
      candidate: null,
      diagnostics: {
        inputHadRua,
      },
    };
  }

  const bairroCompatible = areAparecidaBairrosCompatible(bairro, candidate.bairro);
  const weakBairroCompatibility =
    candidate.localAliasAccepted === true ||
    candidate.bairroDivergenteLocalForte === true ||
    candidate.bairroPriority === "alias";

  let streetMatchType: LocalFirstStreetMatchType | null = null;
  let localStreet: { streetFullName: string; nearDist: number | null } | null = null;

  if (inputHadRua) {
    localStreet = findAparecidaLocalStreetCandidate({
      bairro: candidate.bairro,
      quadra: candidate.quadra,
      lote: candidate.lote,
    });

    const localStreetFullName = String(localStreet?.streetFullName || "").trim();
    streetMatchType = localStreetFullName
      ? compareAparecidaStreetForValidation(args.rua || "", localStreetFullName)
      : "STREET_UNKNOWN";
  }

  let validationStatus: LocalFirstCandidateValidationResult["validationStatus"] =
    "VALIDATED";
  let failureReason: string | null = null;
  let reason = "aparecida_validated";

  if (candidate.canFinalizeLocalFirst === false) {
    validationStatus = "FAILED";
    reason = "aparecida_cannot_finalize_local_first";
    failureReason = reason;
  } else if (!bairroCompatible) {
    validationStatus = "FAILED";
    reason = "aparecida_bairro_mismatch";
    failureReason = reason;
  } else if (inputHadRua && streetMatchType === "STREET_MISMATCH") {
    validationStatus = "FAILED";
    reason = "aparecida_street_mismatch";
    failureReason = reason;
  } else if (inputHadRua && !localStreet) {
    validationStatus = "NEEDS_REVIEW";
    reason = "aparecida_street_not_found";
    failureReason = reason;
  } else if (inputHadRua && streetMatchType !== "STREET_MATCH") {
    validationStatus = "NEEDS_REVIEW";
    reason = "aparecida_street_needs_review";
    failureReason = reason;
  } else if (weakBairroCompatibility) {
    validationStatus = "NEEDS_REVIEW";
    reason = "aparecida_bairro_needs_review";
    failureReason = reason;
  }

  return {
    attempted: true,
    found: true,
    validationStatus,
    reason,
    failureReason,
    city: "APARECIDA",
    matchType: candidate.bairroPriority ?? null,
    streetMatchType,
    candidateCount: 1,
    candidateUnique: true,
    candidate: {
      bairro: candidate.bairro,
      quadra: candidate.quadra,
      lote: candidate.lote,
      streetLabel: localStreet?.streetFullName ?? null,
    },
    diagnostics: {
      inputHadRua,
      bairroCompatible,
      canFinalizeLocalFirst: candidate.canFinalizeLocalFirst ?? null,
      localAliasAccepted: candidate.localAliasAccepted ?? false,
      bairroDivergenteLocalForte: candidate.bairroDivergenteLocalForte ?? false,
      bairroPriority: candidate.bairroPriority ?? null,
      localStreetNearDist: localStreet?.nearDist ?? null,
    },
  };
}
