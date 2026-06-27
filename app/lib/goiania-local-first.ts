import fs from "fs";
import path from "path";
import {
  compareGoianiaStreet,
  normalizeGoianiaStreetName,
  type GoianiaStreetComparison,
} from "@/app/lib/goiania-street-normalization";
import { logMemoryDiagnostics } from "@/app/lib/memory-diagnostics";
import type {
  LocalFirstCandidateValidationInput,
  LocalFirstCandidateValidationResult,
  LocalFirstStreetMatchType,
} from "@/app/lib/local-first-validation-types";

export type GoianiaLocalFirstMatchType =
  | "exact"
  | "exact_canonical"
  | "exact_alphanumeric_canonical"
  | "compound_lot_canonical"
  | "compound_lot"
  | "partition_fallback_exact"
  | "structural_alias_exact"
  | "alias_bairro_exact"
  | "ranking_v2_exact"
  | "same_quadra"
  | "not_found"
  | "missing_parts"
  | "bairro_not_found";

export type GoianiaLocalFirstShadow = {
  attempted: boolean;
  found: boolean;
  matchType: GoianiaLocalFirstMatchType;
  confidence: "HIGH" | "MEDIUM" | null;
  distanceM: number | null;
  candidatesCount: number;
  reason: string;
  key: string | null;
  localFirstStreetCompatibility?: GoianiaStreetComparison | null;
  localFirstStreetScoreAdjustment?: number;
  localFirstScoreBeforeStreet?: number | null;
  localFirstScoreAfterStreet?: number | null;
  localFirstStreetLabel?: string | null;
  localFirstStreetAdjustedCandidatesCount?: number;
  localFirstWinnerChangedByStreet?: boolean;
  localFirstWinnerBeforeStreetLabel?: string | null;
  localFirstWinnerAfterStreetLabel?: string | null;
  fallbackFrom?: string | null;
  fallbackTo?: string | null;
  fallbackStreetCompatibility?: GoianiaStreetComparison | null;
  structuralAliasFrom?: string | null;
  structuralAliasTo?: string | null;
  structuralAliasStreetCompatibility?: GoianiaStreetComparison | null;
  structuralAliasCandidatesCount?: number;
  aliasBairroApplied?: boolean;
  aliasBairroFrom?: string | null;
  aliasBairroTo?: string | null;
  aliasBairroStreetCompatibility?: GoianiaStreetComparison | null;
  aliasBairroUniqueCandidate?: boolean;
  aliasBairroCandidatesCount?: number;
  rankingV2Attempted?: boolean;
  rankingV2CandidatesCount?: number;
  rankingV2WinnerScore?: number | null;
  rankingV2RunnerUpScore?: number | null;
  rankingV2ScoreGap?: number | null;
  rankingV2WinnerPartition?: string | null;
  rankingV2WinnerStreet?: string | null;
  rankingV2StreetCompatibility?: GoianiaStreetComparison | null;
  rankingV2Reason?: string | null;
  rankingV2BlockedReason?: string | null;
  rankingV21Applied?: boolean;
  rankingV21BairroPreference?: boolean;
  rankingV21BairroCompatible?: boolean | null;
  rankingV21BairroPenalty?: number | null;
  rankingV21SelectedBecauseBairro?: boolean;
  rankingV21BlockedBecauseBairroConflict?: boolean;
  rankingV2PartitionScan?: RankingV2PartitionScanDiagnostics;
  candidate: {
    bairro: string;
    quadra: string;
    lote: string;
    streetLabel: string | null;
    lat: number | null;
    lng: number | null;
    sourceIndex: number | null;
  } | null;
};

type LocalFirstCandidate = {
  b?: string;
  q?: string;
  l?: string;
  r?: string;
  d?: number;
  c?: "HIGH" | "MEDIUM";
  lat?: number;
  lng?: number;
  si?: number;
};

type Partition = {
  index?: Record<string, LocalFirstCandidate[]>;
};

type StreetToPartitionsIndex = {
  streets?: Record<string, string[]>;
};

type RankingV2PartitionScanDiagnostics = {
  mode: "bairro" | "bairro_street_intersection" | "street" | "wide" | "none";
  scannedPartitions: number;
  bairroCandidatesCount: number;
  streetCandidatesCount: number;
  intersectionCount: number;
  limited: boolean;
};

type RankingV2Candidate = {
  partitionKey: string;
  key: string;
  candidate: LocalFirstCandidate;
  streetCompatibility: GoianiaStreetComparison;
  score: number;
  bairroCompatible: boolean;
  bairroPenalty: number;
};

// Server-side local source. Keep guarded by explicit Goiânia env flags.
const PARTITION_DIR = process.env.ROTTA_GOIANIA_LOCAL_FIRST_DIR
  ? path.resolve(process.env.ROTTA_GOIANIA_LOCAL_FIRST_DIR)
  : path.join(process.cwd(), "app", "data", "goiania_local_first_by_bairro_v4");
const STREET_TO_PARTITIONS_PATH = path.join(process.cwd(), "app", "data", "goiania-street-to-partitions.json");
const partitionCache = new Map<string, Partition | null>();
const PARTITION_CACHE_MAX_ENTRIES = 40;
const GOIANIA_LOCALFIRST_MAX_PARTITIONS_PER_LOOKUP = readPositiveIntegerEnv(
  "GOIANIA_LOCALFIRST_MAX_PARTITIONS_PER_LOOKUP",
  80,
);
const allPartitionKeysCache: { value?: string[] } = {};
const streetToPartitionsCache: { value?: StreetToPartitionsIndex } = {};
const BAIRRO_PREFIXES = [
  "CONJUNTO",
  "RESIDENCIAL",
  "RES",
  "CONDOMINIO",
  "JARDIM",
  "SETOR",
  "PARQUE",
  "VILA",
  "VILLAGE",
];

export function getGoianiaLocalFirstCacheSnapshot() {
  return {
    partitionCacheSize: partitionCache.size,
    allPartitionKeysLoaded: Array.isArray(allPartitionKeysCache.value),
    streetToPartitionsLoaded: !!streetToPartitionsCache.value,
  };
}

function loadStreetToPartitionsIndex() {
  if (streetToPartitionsCache.value) return streetToPartitionsCache.value;
  if (!fs.existsSync(STREET_TO_PARTITIONS_PATH)) {
    streetToPartitionsCache.value = { streets: {} };
    return streetToPartitionsCache.value;
  }

  streetToPartitionsCache.value = JSON.parse(
    fs.readFileSync(STREET_TO_PARTITIONS_PATH, "utf8").replace(/^\uFEFF/, ""),
  ) as StreetToPartitionsIndex;
  return streetToPartitionsCache.value;
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isGoianiaLocalFirstWideScanEnabled() {
  return (
    process.env.GOIANIA_LOCALFIRST_ALLOW_WIDE_SCAN === "true" ||
    process.env.GOIANIA_LOCALFIRST_ALLOW_WIDE_SCAN === "1"
  );
}

function getCachedPartition(bairroKey: string) {
  if (!partitionCache.has(bairroKey)) {
    return { hit: false, partition: null };
  }

  const partition = partitionCache.get(bairroKey) || null;
  partitionCache.delete(bairroKey);
  partitionCache.set(bairroKey, partition);
  return { hit: true, partition };
}

function rememberPartition(bairroKey: string, partition: Partition | null) {
  if (partitionCache.has(bairroKey)) {
    partitionCache.delete(bairroKey);
  }

  partitionCache.set(bairroKey, partition);
  evictLeastRecentlyUsedPartitions();
}

function evictLeastRecentlyUsedPartitions() {
  while (partitionCache.size > PARTITION_CACHE_MAX_ENTRIES) {
    const oldestKey = partitionCache.keys().next().value;
    if (!oldestKey) return;
    partitionCache.delete(oldestKey);
  }
}

const GOIANIA_PARTITION_FALLBACKS: Record<string, string> = {
  "JARDIM ATLANTICO": "ATLANTICO",
  "RESIDENCIAL ITAIPU": "ITAIPU",
  "PARQUE ANHANGUERA": "ANHANGUERA",
  "PARQUE ANHANGUERA II": "ANHANGUERA_II",
  "JARDIM CARAVELAS 1 ETAPA": "CARAVELAS_1_ETAPA",
  "JARDIM CARAVELAS": "CARAVELAS",
  "RESIDENCIAL SANTA FE": "SANTA_FE",
  "SETOR GARAVELO": "GARAVELO",
  "SETOR GARAVELO B": "GARAVELO",
  "SETOR FAICALVILLE": "FAICALVILLE",
  "SETOR ANDREIA": "ANDREIA",
  "RESIDENCIAL BARCELONA": "BARCELONA",
  "RESIDENCIAL ELI FORTE": "ELI_FORTE",
  "FORTEVILLE EXTENSAO": "FORTE_VILLE_EXTENSAO",
  "RESIDENCIAL FORTEVILLE EXTENSAO": "FORTE_VILLE_EXTENSAO",
  "CONDOMINIO AMIN CAMARGO": "AMIM_CAMARGO",
};

const GOIANIA_STRUCTURAL_ALIAS_FALLBACKS: Record<string, string[]> = {
  "CONJUNTO HABITACIONAL BALIZA": ["BALIZA"],
  "VILA REZENDE": ["REZENDE"],
  "BAIRRO SANTA RITA": ["SANTA_RITA"],
  "VILA SANTA RITA 5 ETAPA": ["SANTA_RITA_5_ETAPA"],
  "JARDINS MADRI": ["MADRI"],
  "CONDOMINIO JARDINS MADRI": ["MADRI"],
  "JARDIM CARAVELAS 1 ETAPA": ["CARAVELAS"],
  "RESIDENCIAL ITAIPU GOIANIA": ["ITAIPU"],
  "CONDOMINIO AMIN CAMARGO": ["AMIM_CAMARGO"],
  "RESIDENCIAL SANTA FE": ["SANTA_FE_I"],
  "JARDIM ATLANTICO": ["PRIVE_ATLANTICO"],
  "SETOR ANDREIA": ["ANDREIA"],
  "RESIDENCIAL ELI FORTE": ["ELI_FORTE_EXTENSAO"],
  "FORTEVILLE EXTENSAO": ["FORTE_VILLE_EXTENSAO"],
  "RESIDENCIAL FORTEVILLE EXTENSAO": ["FORTE_VILLE_EXTENSAO"],
};

const GOIANIA_BAIRRO_ALIASES_V1: Record<string, string[]> = {
  "RESIDENCIAL SERRA AZUL ETAPA I": ["SERRA_AZUL"],
  "JARDIM PETROPOLIS": ["PETROPOLIS"],
  "RESIDENCIAL PETROPOLIS": ["PETROPOLIS"],
  "PARQUE JOAO BRAZ": ["INDUSTRIAL_JOAO_BRAZ", "INDUSTRIAL_JOAO_BRAZ_2"],
  "PARQUE INDUSTRIAL JOAO BRAZ": ["INDUSTRIAL_JOAO_BRAZ", "INDUSTRIAL_JOAO_BRAZ_2"],
  "SETOR DAS NACOES": ["DAS_NACOES"],
  "JARDIM ELI FORTE": ["ELI_FORTE"],
  "JARDIM SAO JOSE": ["SAO_JOSE"],
  "SETOR COIMBRA": ["COIMBRA"],
  "VILA SANTA RITA": ["SANTA_RITA_ACRESCIMO"],
  "CIDADE VERA CRUZ": ["VERA_CRUZ"],
  "CONJUNTO VERA CRUZ": ["VERA_CRUZ"],
  "CONJUNTO VERA CRUZ 1": ["VERA_CRUZ"],
  "CONJUNTO VERA CRUZ I": ["VERA_CRUZ"],
  "CONJUNTO VERA CRUZ II": ["VERA_CRUZ"],
  "CONJUNTO VERA CRUZ III": ["VERA_CRUZ"],
  "CONJUNTO VERA CRUZ IV": ["VERA_CRUZ"],
  "CONJUNTO VERA CRUZ V": ["VERA_CRUZ"],
  "RESIDENCIAL GOIANIA VIVA": ["GOIANIA_VIVA"],
  "PARQUE OESTE INDUSTRIAL": ["OESTE_INDUSTRIAL"],
  "PARQUE OESTE INDUSTRIAL EXTENSAO": ["OESTE_INDUSTRIAL_EXTENSAO"],
  "PARQUE OESTE INDUSTRIAL PROLONGAMENTO": ["OESTE_INDUSTRIAL_PROLONGAMENTO"],
  "JARDIM DO CERRADO 1": ["JARDINS_DO_CERRADO_1"],
  "JARDIM DO CERRADO 2": ["JARDINS_DO_CERRADO_2"],
  "JARDIM DO CERRADO 3": ["JARDINS_DO_CERRADO_3"],
  "JARDIM DO CERRADO 4": ["JARDINS_DO_CERRADO_4"],
  "JARDIM DO CERRADO 5": ["JARDINS_DO_CERRADO_5"],
  "JARDIM DO CERRADO 6": ["JARDINS_DO_CERRADO_6"],
  "JARDIM DO CERRADO 7": ["JARDINS_DO_CERRADO_7"],
  "JARDIM DO CERRADO 8": ["JARDINS_DO_CERRADO_8"],
  "JARDIM DO CERRADO 9": ["JARDINS_DO_CERRADO_9"],
  "JARDIM DO CERRADO 10": ["JARDINS_DO_CERRADO_10"],
  "JARDIM DO CERRADO 11": ["JARDINS_DO_CERRADO_11"],
  "JARDINS DO CERRADO 01": ["JARDINS_DO_CERRADO_1"],
  "JARDINS DO CERRADO 02": ["JARDINS_DO_CERRADO_2"],
  "JARDINS DO CERRADO 03": ["JARDINS_DO_CERRADO_3"],
  "JARDINS DO CERRADO 04": ["JARDINS_DO_CERRADO_4"],
  "JARDINS DO CERRADO 05": ["JARDINS_DO_CERRADO_5"],
  "JARDINS DO CERRADO 06": ["JARDINS_DO_CERRADO_6"],
  "JARDINS DO CERRADO 07": ["JARDINS_DO_CERRADO_7"],
  "JARDINS DO CERRADO 08": ["JARDINS_DO_CERRADO_8"],
  "JARDINS DO CERRADO 09": ["JARDINS_DO_CERRADO_9"],
};

function isShadowEnabled() {
  return process.env.ROTTA_GOIANIA_LOCAL_FIRST_SHADOW === "1";
}

function isBypassEnabled() {
  return process.env.ROTTA_GOIANIA_LOCAL_FIRST_BYPASS === "1";
}

function isGoianiaLocalFirstEnabled() {
  return true;
}

function compact(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value: string) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeFileKey(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function isGoianiaCity(value: string) {
  const key = normalizeKey(value).replace(/\s+/g, "");
  return key.includes("GOIANIA") && !key.includes("APARECIDA");
}

function buildKey(bairro: string, quadra: string, lote: string) {
  return [normalizeKey(bairro), normalizeKey(quadra), normalizeKey(lote)].join("|");
}

function buildNormalizedKey(bairroKey: string, quadraKey: string, loteKey: string) {
  return [bairroKey, quadraKey, loteKey].join("|");
}

function canonicalizeNumericToken(value: string) {
  if (!/^\d+$/.test(value)) return value;
  return String(Number(value));
}

function canonicalizeAlphanumericToken(value: string) {
  const match = value.match(/^0+(\d+)([A-Z])$/);
  if (!match) return value;
  return `${Number(match[1])}${match[2]}`;
}

function canonicalizeLookupToken(value: string) {
  const alphanumeric = canonicalizeAlphanumericToken(value);
  if (alphanumeric !== value) {
    return { value: alphanumeric, kind: "alphanumeric" as const };
  }

  const numeric = canonicalizeNumericToken(value);
  if (numeric !== value) {
    return { value: numeric, kind: "numeric" as const };
  }

  return { value, kind: "none" as const };
}

function buildCompoundLotCanonicalKeys(args: {
  bairroKey: string;
  quadraKeys: string[];
  rawLote: string;
}) {
  const raw = compact(args.rawLote).toUpperCase();
  if (!/(\/|-|\bE\b)/.test(raw)) return [];

  const parts = raw
    .split(/\s*(?:\/|-|\bE\b)\s*/i)
    .map((part) => normalizeKey(part))
    .filter(Boolean);

  if (parts.length < 2 || !parts.every((part) => /^\d+$/.test(part))) {
    return [];
  }

  const normalizedParts = parts.map(canonicalizeNumericToken);
  const loteVariants = [normalizedParts.join(" ")];

  if (/^\d+\s*-\s*\d+$/.test(raw)) {
    loteVariants.push(raw.replace(/\s+/g, ""));
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const quadraKey of args.quadraKeys) {
    for (const loteKey of loteVariants) {
      const key = buildNormalizedKey(args.bairroKey, quadraKey, normalizeKey(loteKey));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }

  return keys;
}

function stripBairroPrefix(bairroKey: string) {
  for (const prefix of BAIRRO_PREFIXES) {
    if (!bairroKey.startsWith(`${prefix} `)) continue;
    const stripped = bairroKey.slice(prefix.length + 1).trim();
    return stripped || null;
  }

  return null;
}

function resolveGoianiaPartitionFallback(bairroKey: string) {
  const normalized = normalizeKey(bairroKey);
  const fallback = GOIANIA_PARTITION_FALLBACKS[normalized];
  if (!fallback) return null;
  return {
    from: normalized,
    to: normalizeKey(fallback),
  };
}

function resolveGoianiaStructuralAliasFallbacks(bairroKey: string) {
  const normalized = normalizeKey(bairroKey);
  const fallbackTargets = GOIANIA_STRUCTURAL_ALIAS_FALLBACKS[normalized] || [];
  return fallbackTargets.map((fallback) => ({
    from: normalized,
    to: normalizeKey(fallback),
  }));
}

function resolveGoianiaBairroAliasesV1(bairroKey: string) {
  const normalized = normalizeKey(bairroKey);
  const targets = GOIANIA_BAIRRO_ALIASES_V1[normalized] || [];
  return targets.map((target) => ({
    from: normalized,
    to: normalizeKey(target),
  }));
}

function keyParts(key: string) {
  const [bairro = "", quadra = "", lote = ""] = String(key).split("|");
  return { bairro, quadra, lote };
}

function loteHasToken(lotePart: string, loteKey: string) {
  if (!loteKey) return false;
  return lotePart.split(/\s+/).filter(Boolean).includes(loteKey);
}

function disabledShadow(): GoianiaLocalFirstShadow {
  return {
    attempted: false,
    found: false,
    matchType: "not_found",
    confidence: null,
    distanceM: null,
    candidatesCount: 0,
    reason: "shadow_disabled",
    key: null,
    candidate: null,
  };
}

function loadPartition(bairroKey: string) {
  const cached = getCachedPartition(bairroKey);
  if (cached.hit) return cached.partition;

  const fileName = `${normalizeFileKey(bairroKey) || "SEM_BAIRRO"}.json`;
  const filePath = path.join(PARTITION_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    rememberPartition(bairroKey, null);
    return null;
  }

  logMemoryDiagnostics("goiania-local-first:before-load-partition", {
    route: "goiania-local-first",
    bairroKey,
    filePath,
    cacheSizes: {
      ...getGoianiaLocalFirstCacheSnapshot(),
    },
  });
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as Partition;
  rememberPartition(bairroKey, parsed);
  logMemoryDiagnostics("goiania-local-first:after-load-partition", {
    route: "goiania-local-first",
    bairroKey,
    filePath,
    cacheSizes: {
      ...getGoianiaLocalFirstCacheSnapshot(),
    },
  });
  return parsed;
}

function loadAllPartitionKeys() {
  if (allPartitionKeysCache.value) return allPartitionKeysCache.value;
  if (!fs.existsSync(PARTITION_DIR)) {
    allPartitionKeysCache.value = [];
    return allPartitionKeysCache.value;
  }

  logMemoryDiagnostics("goiania-local-first:before-load-partition-keys", {
    route: "goiania-local-first",
    partitionDir: PARTITION_DIR,
    cacheSizes: {
      ...getGoianiaLocalFirstCacheSnapshot(),
    },
  });
  allPartitionKeysCache.value = fs
    .readdirSync(PARTITION_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => normalizeKey(path.basename(fileName, ".json").replace(/_/g, " ")))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  logMemoryDiagnostics("goiania-local-first:after-load-partition-keys", {
    route: "goiania-local-first",
    partitionDir: PARTITION_DIR,
    cacheSizes: {
      ...getGoianiaLocalFirstCacheSnapshot(),
    },
  });

  return allPartitionKeysCache.value;
}

function hasValidCoords(candidate: LocalFirstCandidate | null | undefined) {
  return Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng);
}

function isSafeRankingV2Street(compatibility: GoianiaStreetComparison | null | undefined) {
  return compatibility === "STREET_MATCH" || compatibility === "STREET_PARTIAL_MATCH";
}

function isBairroCompatibleForRankingV2(inputBairroKey: string, partitionKey: string) {
  if (!inputBairroKey || !partitionKey) return false;
  if (inputBairroKey === partitionKey) return true;
  if (stripBairroPrefix(inputBairroKey) === partitionKey) return true;
  if (stripBairroPrefix(partitionKey) === inputBairroKey) return true;
  return false;
}

function addPartitionKeyCandidate(candidates: string[], seen: Set<string>, value: string | null | undefined) {
  const normalized = normalizeKey(value || "");
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push(normalized);
}

function buildGoianiaRankingV2CandidatePartitionKeys(inputBairroKey: string, allPartitionKeys: string[]) {
  const allPartitionKeysSet = new Set(allPartitionKeys);
  const candidates: string[] = [];
  const seen = new Set<string>();
  const normalizedBairroKey = normalizeKey(inputBairroKey);
  const bairroWithoutPrefix = stripBairroPrefix(normalizedBairroKey);
  const sourceBairros = [normalizedBairroKey, bairroWithoutPrefix].filter(Boolean) as string[];

  for (const sourceBairro of sourceBairros) {
    addPartitionKeyCandidate(candidates, seen, sourceBairro);
    addPartitionKeyCandidate(
      candidates,
      seen,
      resolveGoianiaPartitionFallback(sourceBairro)?.to,
    );

    for (const alias of resolveGoianiaStructuralAliasFallbacks(sourceBairro)) {
      addPartitionKeyCandidate(candidates, seen, alias.to);
    }

    for (const alias of resolveGoianiaBairroAliasesV1(sourceBairro)) {
      addPartitionKeyCandidate(candidates, seen, alias.to);
    }
  }

  return candidates.filter((partitionKey) => allPartitionKeysSet.has(partitionKey));
}

function buildGoianiaRankingV2StreetPartitionKeys(inputStreet: string, allPartitionKeys: string[]) {
  const streetKey = normalizeGoianiaStreetName(inputStreet);
  if (!streetKey) return [];

  const allPartitionKeysSet = new Set(allPartitionKeys);
  const streets = loadStreetToPartitionsIndex().streets || {};
  const candidates = Array.isArray(streets[streetKey]) ? streets[streetKey] : [];
  return candidates.filter((partitionKey) => allPartitionKeysSet.has(partitionKey));
}

function limitGoianiaRankingV2PartitionScan(args: {
  inputBairroKey: string;
  partitionKeys: string[];
  scanMode: RankingV2PartitionScanDiagnostics["mode"];
}) {
  if (args.partitionKeys.length <= GOIANIA_LOCALFIRST_MAX_PARTITIONS_PER_LOOKUP) {
    return {
      partitionKeys: args.partitionKeys,
      limited: false,
    };
  }

  logMemoryDiagnostics("GOIANIA_LOCALFIRST_PARTITION_SCAN_LIMITED", {
    route: "goiania-local-first",
    inputBairroKey: args.inputBairroKey,
    scanMode: args.scanMode,
    totalPartitionKeys: args.partitionKeys.length,
    maxPartitionsPerLookup: GOIANIA_LOCALFIRST_MAX_PARTITIONS_PER_LOOKUP,
    cacheSizes: {
      ...getGoianiaLocalFirstCacheSnapshot(),
    },
  });

  return {
    partitionKeys: args.partitionKeys.slice(0, GOIANIA_LOCALFIRST_MAX_PARTITIONS_PER_LOOKUP),
    limited: true,
  };
}

function buildGoianiaRankingV2PartitionKeys(args: {
  inputBairroKey: string;
  inputStreet?: string;
}) {
  const allPartitionKeys = loadAllPartitionKeys();
  const candidatePartitionKeys = buildGoianiaRankingV2CandidatePartitionKeys(
    args.inputBairroKey,
    allPartitionKeys,
  );
  const streetPartitionKeys = buildGoianiaRankingV2StreetPartitionKeys(
    args.inputStreet || "",
    allPartitionKeys,
  );
  const hasUsefulBairro = !!normalizeKey(args.inputBairroKey);
  const hasUsefulStreet = streetPartitionKeys.length > 0;
  const streetPartitionSet = new Set(streetPartitionKeys);
  const intersection = candidatePartitionKeys.filter((partitionKey) => streetPartitionSet.has(partitionKey));
  let partitionKeys: string[] = [];
  let scanMode: RankingV2PartitionScanDiagnostics["mode"] = "none";

  if (hasUsefulBairro && hasUsefulStreet) {
    partitionKeys = intersection.length ? intersection : candidatePartitionKeys;
    scanMode = intersection.length ? "bairro_street_intersection" : "bairro";
  } else if (hasUsefulBairro) {
    partitionKeys = candidatePartitionKeys;
    scanMode = "bairro";
  } else if (hasUsefulStreet) {
    partitionKeys = streetPartitionKeys.slice(0, 20);
    scanMode = "street";
  }

  if (isGoianiaLocalFirstWideScanEnabled()) {
    partitionKeys = [...new Set([...partitionKeys, ...allPartitionKeys])];
    scanMode = "wide";
  }

  const limited = limitGoianiaRankingV2PartitionScan({
    inputBairroKey: args.inputBairroKey,
    partitionKeys,
    scanMode,
  });

  return {
    partitionKeys: limited.partitionKeys,
    diagnostics: {
      mode: scanMode,
      scannedPartitions: limited.partitionKeys.length,
      bairroCandidatesCount: candidatePartitionKeys.length,
      streetCandidatesCount: streetPartitionKeys.length,
      intersectionCount: intersection.length,
      limited: limited.limited,
    },
  };
}

function emptyRankingV2Diagnostic(args: {
  reason: string;
  key: string;
  candidatesCount?: number;
  winnerScore?: number | null;
  runnerUpScore?: number | null;
  scoreGap?: number | null;
  winnerPartition?: string | null;
  winnerStreet?: string | null;
  streetCompatibility?: GoianiaStreetComparison | null;
  rankingV21Applied?: boolean;
  rankingV21BairroPreference?: boolean;
  rankingV21BairroCompatible?: boolean | null;
  rankingV21BairroPenalty?: number | null;
  rankingV21SelectedBecauseBairro?: boolean;
  rankingV21BlockedBecauseBairroConflict?: boolean;
  partitionScan?: RankingV2PartitionScanDiagnostics;
}): GoianiaLocalFirstShadow {
  return {
    ...negativeShadowResult({
      matchType: "not_found",
      reason: args.reason,
      key: args.key,
      candidatesCount: args.candidatesCount ?? 0,
    }),
    rankingV2Attempted: true,
    rankingV2CandidatesCount: args.candidatesCount ?? 0,
    rankingV2WinnerScore: args.winnerScore ?? null,
    rankingV2RunnerUpScore: args.runnerUpScore ?? null,
    rankingV2ScoreGap: args.scoreGap ?? null,
    rankingV2WinnerPartition: args.winnerPartition ?? null,
    rankingV2WinnerStreet: args.winnerStreet ?? null,
    rankingV2StreetCompatibility: args.streetCompatibility ?? null,
    rankingV2Reason: args.reason,
    rankingV2BlockedReason: args.reason,
    rankingV21Applied: args.rankingV21Applied ?? true,
    rankingV21BairroPreference: args.rankingV21BairroPreference ?? false,
    rankingV21BairroCompatible: args.rankingV21BairroCompatible ?? null,
    rankingV21BairroPenalty: args.rankingV21BairroPenalty ?? null,
    rankingV21SelectedBecauseBairro: args.rankingV21SelectedBecauseBairro ?? false,
    rankingV21BlockedBecauseBairroConflict: args.rankingV21BlockedBecauseBairroConflict ?? false,
    rankingV2PartitionScan: args.partitionScan,
  };
}

function compareCandidate(a: LocalFirstCandidate, b: LocalFirstCandidate) {
  const ar = a.c === "HIGH" ? 0 : a.c === "MEDIUM" ? 1 : 2;
  const br = b.c === "HIGH" ? 0 : b.c === "MEDIUM" ? 1 : 2;
  if (ar !== br) return ar - br;
  return (Number(a.d) || Number.POSITIVE_INFINITY) - (Number(b.d) || Number.POSITIVE_INFINITY);
}

function localFirstBaseScore(candidate: LocalFirstCandidate) {
  const confidenceScore = candidate.c === "HIGH" ? 70 : candidate.c === "MEDIUM" ? 45 : 20;
  const distance = Number.isFinite(candidate.d) ? Number(candidate.d) : 200;
  return confidenceScore + Math.max(0, 30 - Math.min(distance, 300) / 10);
}

function streetScoreAdjustment(compatibility: GoianiaStreetComparison | null) {
  if (compatibility === "STREET_MATCH") return 25;
  if (compatibility === "STREET_PARTIAL_MATCH") return 10;
  if (compatibility === "STREET_MISMATCH") return -40;
  return 0;
}

function scoreCandidateWithStreet(candidate: LocalFirstCandidate, inputStreet: string) {
  const baseScore = localFirstBaseScore(candidate);
  const streetLabel = String(candidate.r || "").trim();
  const compatibility = inputStreet && streetLabel ? compareGoianiaStreet(inputStreet, streetLabel) : null;
  const adjustment = streetScoreAdjustment(compatibility);

  return {
    candidate,
    streetCompatibility: compatibility,
    streetScoreAdjustment: adjustment,
    scoreBeforeStreet: baseScore,
    scoreAfterStreet: baseScore + adjustment,
    streetLabel: streetLabel || null,
  };
}

function positiveShadowResult(args: {
  matchType:
    | "exact"
    | "exact_canonical"
    | "exact_alphanumeric_canonical"
    | "compound_lot_canonical"
    | "compound_lot"
    | "partition_fallback_exact"
    | "structural_alias_exact"
    | "alias_bairro_exact";
  reason: string;
  key: string;
  candidates: LocalFirstCandidate[];
  inputStreet?: string;
  fallbackFrom?: string | null;
  fallbackTo?: string | null;
  structuralAliasFrom?: string | null;
  structuralAliasTo?: string | null;
  structuralAliasCandidatesCount?: number;
  aliasBairroFrom?: string | null;
  aliasBairroTo?: string | null;
  aliasBairroStreetCompatibility?: GoianiaStreetComparison | null;
  aliasBairroCandidatesCount?: number;
}): GoianiaLocalFirstShadow {
  const inputStreet = normalizeKey(args.inputStreet || "");
  const candidatesBeforeStreet = [...args.candidates].sort(compareCandidate);
  const bestBeforeStreet = candidatesBeforeStreet[0] || null;
  const scoredCandidates = candidatesBeforeStreet
    .map((candidate, index) => ({ ...scoreCandidateWithStreet(candidate, inputStreet), index }))
    .sort((a, b) => {
      if (b.scoreAfterStreet !== a.scoreAfterStreet) return b.scoreAfterStreet - a.scoreAfterStreet;
      return compareCandidate(a.candidate, b.candidate) || a.index - b.index;
    });
  const bestScored = scoredCandidates[0] || null;
  const best = bestScored?.candidate || null;
  const adjustedCandidatesCount = scoredCandidates.filter((candidate) => candidate.streetScoreAdjustment !== 0).length;
  const winnerChangedByStreet =
    !!bestBeforeStreet &&
    !!best &&
    (bestBeforeStreet.si !== best.si ||
      bestBeforeStreet.lat !== best.lat ||
      bestBeforeStreet.lng !== best.lng ||
      bestBeforeStreet.r !== best.r);

  return {
    attempted: true,
    found: true,
    matchType: args.matchType,
    confidence: best?.c || null,
    distanceM: Number.isFinite(best?.d) ? Number(best.d) : null,
    candidatesCount: candidatesBeforeStreet.length,
    reason: args.reason,
    key: args.key,
    localFirstStreetCompatibility: bestScored?.streetCompatibility ?? null,
    localFirstStreetScoreAdjustment: bestScored?.streetScoreAdjustment ?? 0,
    localFirstScoreBeforeStreet: bestScored?.scoreBeforeStreet ?? null,
    localFirstScoreAfterStreet: bestScored?.scoreAfterStreet ?? null,
    localFirstStreetLabel: bestScored?.streetLabel ?? null,
    localFirstStreetAdjustedCandidatesCount: adjustedCandidatesCount,
    localFirstWinnerChangedByStreet: winnerChangedByStreet,
    localFirstWinnerBeforeStreetLabel: bestBeforeStreet?.r ? String(bestBeforeStreet.r) : null,
    localFirstWinnerAfterStreetLabel: best?.r ? String(best.r) : null,
    fallbackFrom: args.fallbackFrom ?? null,
    fallbackTo: args.fallbackTo ?? null,
    fallbackStreetCompatibility: args.fallbackFrom ? bestScored?.streetCompatibility ?? null : null,
    structuralAliasFrom: args.structuralAliasFrom ?? null,
    structuralAliasTo: args.structuralAliasTo ?? null,
    structuralAliasStreetCompatibility: args.structuralAliasFrom
      ? bestScored?.streetCompatibility ?? null
      : null,
    structuralAliasCandidatesCount: args.structuralAliasCandidatesCount ?? 0,
    aliasBairroApplied: args.matchType === "alias_bairro_exact",
    aliasBairroFrom: args.aliasBairroFrom ?? null,
    aliasBairroTo: args.aliasBairroTo ?? null,
    aliasBairroStreetCompatibility: args.aliasBairroStreetCompatibility ?? null,
    aliasBairroUniqueCandidate:
      args.aliasBairroCandidatesCount === undefined
        ? undefined
        : args.aliasBairroCandidatesCount === 1,
    aliasBairroCandidatesCount: args.aliasBairroCandidatesCount ?? 0,
    candidate: best
      ? {
          bairro: String(best.b || ""),
          quadra: String(best.q || ""),
          lote: String(best.l || ""),
          streetLabel: best.r ? String(best.r) : null,
          lat: Number.isFinite(best.lat) ? Number(best.lat) : null,
          lng: Number.isFinite(best.lng) ? Number(best.lng) : null,
          sourceIndex: Number.isFinite(best.si) ? Number(best.si) : null,
        }
      : null,
  };
}

function negativeShadowResult(args: {
  matchType: Exclude<
    GoianiaLocalFirstMatchType,
    "exact" | "exact_canonical" | "exact_alphanumeric_canonical" | "compound_lot_canonical" | "compound_lot"
    | "structural_alias_exact" | "alias_bairro_exact"
  >;
  reason: string;
  key: string | null;
  candidatesCount?: number;
  structuralAliasFrom?: string | null;
  structuralAliasTo?: string | null;
  structuralAliasStreetCompatibility?: GoianiaStreetComparison | null;
  structuralAliasCandidatesCount?: number;
  aliasBairroApplied?: boolean;
  aliasBairroFrom?: string | null;
  aliasBairroTo?: string | null;
  aliasBairroStreetCompatibility?: GoianiaStreetComparison | null;
  aliasBairroCandidatesCount?: number;
}): GoianiaLocalFirstShadow {
  return {
    attempted: true,
    found: false,
    matchType: args.matchType,
    confidence: null,
    distanceM: null,
    candidatesCount: args.candidatesCount || 0,
    reason: args.reason,
    key: args.key,
    structuralAliasFrom: args.structuralAliasFrom ?? null,
    structuralAliasTo: args.structuralAliasTo ?? null,
    structuralAliasStreetCompatibility: args.structuralAliasStreetCompatibility ?? null,
    structuralAliasCandidatesCount: args.structuralAliasCandidatesCount ?? 0,
    aliasBairroApplied: args.aliasBairroApplied ?? false,
    aliasBairroFrom: args.aliasBairroFrom ?? null,
    aliasBairroTo: args.aliasBairroTo ?? null,
    aliasBairroStreetCompatibility: args.aliasBairroStreetCompatibility ?? null,
    aliasBairroUniqueCandidate:
      args.aliasBairroCandidatesCount === undefined
        ? undefined
        : args.aliasBairroCandidatesCount === 1,
    aliasBairroCandidatesCount: args.aliasBairroCandidatesCount ?? 0,
    candidate: null,
  };
}

function lookupGoianiaStructuralAliasFallback(args: {
  fromBairroKey: string;
  quadraKey: string;
  loteKey: string;
  inputStreet?: string;
}): GoianiaLocalFirstShadow | null {
  const aliases = resolveGoianiaStructuralAliasFallbacks(args.fromBairroKey);
  if (!aliases.length) return null;

  let bestDiagnostic: GoianiaLocalFirstShadow | null = null;

  for (const alias of aliases) {
    const partition = loadPartition(alias.to);
    const index = partition?.index || null;
    const key = buildNormalizedKey(alias.to, args.quadraKey, args.loteKey);
    const candidates = index && Array.isArray(index[key]) ? index[key] : [];
    const candidatesCount = candidates.length;

    if (!candidatesCount) {
      bestDiagnostic =
        bestDiagnostic ||
        negativeShadowResult({
          matchType: "bairro_not_found",
          reason: "goiania_structural_alias_no_exact_qd_lt",
          key,
          structuralAliasFrom: alias.from,
          structuralAliasTo: alias.to,
          structuralAliasCandidatesCount: 0,
        });
      continue;
    }

    const first = candidates[0];
    const streetCompatibility =
      args.inputStreet && first?.r ? compareGoianiaStreet(args.inputStreet, String(first.r)) : "STREET_UNKNOWN";
    const hasSafeStreet =
      streetCompatibility === "STREET_MATCH" || streetCompatibility === "STREET_PARTIAL_MATCH";
    const hasValidCoords =
      candidatesCount === 1 &&
      Number.isFinite(first?.lat) &&
      Number.isFinite(first?.lng);
    const hasHighConfidence = first?.c === "HIGH";

    if (candidatesCount === 1 && hasSafeStreet && hasValidCoords && hasHighConfidence) {
      return positiveShadowResult({
        matchType: "structural_alias_exact",
        reason: "goiania_structural_alias_exact",
        key,
        candidates,
        inputStreet: args.inputStreet,
        structuralAliasFrom: alias.from,
        structuralAliasTo: alias.to,
        structuralAliasCandidatesCount: candidatesCount,
      });
    }

    const reason =
      candidatesCount !== 1
        ? "goiania_structural_alias_multiple_candidates"
        : streetCompatibility === "STREET_UNKNOWN"
          ? "goiania_structural_alias_street_unknown"
          : streetCompatibility === "STREET_MISMATCH"
            ? "goiania_structural_alias_street_mismatch"
            : !hasValidCoords
              ? "goiania_structural_alias_invalid_coords"
              : !hasHighConfidence
                ? "goiania_structural_alias_not_high_confidence"
                : "goiania_structural_alias_not_safe";

    bestDiagnostic =
      bestDiagnostic ||
      negativeShadowResult({
        matchType: "bairro_not_found",
        reason,
        key,
        candidatesCount,
        structuralAliasFrom: alias.from,
        structuralAliasTo: alias.to,
        structuralAliasStreetCompatibility: streetCompatibility,
        structuralAliasCandidatesCount: candidatesCount,
      });
  }

  return bestDiagnostic;
}

function lookupGoianiaBairroAliasV1(args: {
  fromBairroKey: string;
  quadraKey: string;
  loteKey: string;
  inputStreet?: string;
}): GoianiaLocalFirstShadow | null {
  const aliases = resolveGoianiaBairroAliasesV1(args.fromBairroKey);
  if (!aliases.length) return null;

  let bestDiagnostic: GoianiaLocalFirstShadow | null = null;
  const safeMatches: Array<{
    alias: { from: string; to: string };
    key: string;
    candidates: LocalFirstCandidate[];
    streetCompatibility: GoianiaStreetComparison;
  }> = [];

  for (const alias of aliases) {
    const partition = loadPartition(alias.to);
    const index = partition?.index || null;
    const key = buildNormalizedKey(alias.to, args.quadraKey, args.loteKey);

    if (!index) {
      bestDiagnostic =
        bestDiagnostic ||
        negativeShadowResult({
          matchType: "bairro_not_found",
          reason: "goiania_alias_bairro_no_qd_lt",
          key,
          aliasBairroApplied: true,
          aliasBairroFrom: alias.from,
          aliasBairroTo: alias.to,
          aliasBairroCandidatesCount: 0,
        });
      continue;
    }

    const candidates = Array.isArray(index[key]) ? index[key] : [];
    const candidatesCount = candidates.length;

    if (!candidatesCount) {
      bestDiagnostic =
        bestDiagnostic ||
        negativeShadowResult({
          matchType: "not_found",
          reason: "goiania_alias_bairro_no_qd_lt",
          key,
          aliasBairroApplied: true,
          aliasBairroFrom: alias.from,
          aliasBairroTo: alias.to,
          aliasBairroCandidatesCount: 0,
        });
      continue;
    }

    const first = candidates[0];
    const streetCompatibility =
      args.inputStreet && first?.r ? compareGoianiaStreet(args.inputStreet, String(first.r)) : "STREET_UNKNOWN";
    const uniqueCandidate = candidatesCount === 1;
    const hasSafeStreet =
      streetCompatibility === "STREET_MATCH" || streetCompatibility === "STREET_PARTIAL_MATCH";
    const hasValidCoords = Number.isFinite(first?.lat) && Number.isFinite(first?.lng);
    const hasHighConfidence = first?.c === "HIGH";

    if (uniqueCandidate && hasSafeStreet && hasValidCoords && hasHighConfidence) {
      safeMatches.push({ alias, key, candidates, streetCompatibility });
      continue;
    }

    const reason =
      !uniqueCandidate
        ? "goiania_alias_bairro_multiple_candidates"
        : streetCompatibility === "STREET_MISMATCH"
          ? "goiania_alias_bairro_street_mismatch"
          : streetCompatibility === "STREET_UNKNOWN"
            ? "goiania_alias_bairro_street_unknown"
            : !hasHighConfidence
              ? "goiania_alias_bairro_not_high_confidence"
              : !hasValidCoords
                ? "goiania_alias_bairro_invalid_coords"
                : "goiania_alias_bairro_no_qd_lt";

    bestDiagnostic =
      bestDiagnostic ||
      negativeShadowResult({
        matchType: "not_found",
        reason,
        key,
        candidatesCount,
        aliasBairroApplied: true,
        aliasBairroFrom: alias.from,
        aliasBairroTo: alias.to,
        aliasBairroStreetCompatibility: streetCompatibility,
        aliasBairroCandidatesCount: candidatesCount,
      });
  }

  if (safeMatches.length === 1) {
    const match = safeMatches[0];
    return positiveShadowResult({
      matchType: "alias_bairro_exact",
      reason: "goiania_alias_bairro_exact",
      key: match.key,
      candidates: match.candidates,
      inputStreet: args.inputStreet,
      aliasBairroFrom: match.alias.from,
      aliasBairroTo: match.alias.to,
      aliasBairroStreetCompatibility: match.streetCompatibility,
      aliasBairroCandidatesCount: match.candidates.length,
    });
  }

  if (safeMatches.length > 1) {
    const first = safeMatches[0];
    return negativeShadowResult({
      matchType: "not_found",
      reason: "goiania_alias_bairro_multiple_candidates",
      key: first.key,
      candidatesCount: safeMatches.reduce((sum, match) => sum + match.candidates.length, 0),
      aliasBairroApplied: true,
      aliasBairroFrom: first.alias.from,
      aliasBairroTo: safeMatches.map((match) => match.alias.to).join("|"),
      aliasBairroStreetCompatibility: first.streetCompatibility,
      aliasBairroCandidatesCount: safeMatches.reduce((sum, match) => sum + match.candidates.length, 0),
    });
  }

  return bestDiagnostic;
}

function lookupGoianiaLocalFirstByKeys(args: {
  bairroKey: string;
  quadraKey: string;
  loteKey: string;
  rawLote: string;
  key: string;
  inputStreet?: string;
  exactReason?: string;
  canonicalExactReason?: string;
  compoundReason?: string;
}): GoianiaLocalFirstShadow {
  const partition = loadPartition(args.bairroKey);
  const index = partition?.index || null;

  if (!index) {
    return negativeShadowResult({
      matchType: "bairro_not_found",
      reason: "bairro_partition_not_found",
      key: args.key,
    });
  }

  const exact = Array.isArray(index[args.key]) ? index[args.key] : [];
  if (exact.length) {
    return positiveShadowResult({
      matchType: "exact",
      reason: args.exactReason || "exact_key",
      key: args.key,
      candidates: exact,
      inputStreet: args.inputStreet,
    });
  }

  const canonicalQuadraKey = canonicalizeLookupToken(args.quadraKey);
  const canonicalLoteKey = canonicalizeLookupToken(args.loteKey);
  const canonicalKey = buildNormalizedKey(args.bairroKey, canonicalQuadraKey.value, canonicalLoteKey.value);
  const canonicalExact =
    canonicalKey !== args.key && Array.isArray(index[canonicalKey]) ? index[canonicalKey] : [];

  if (canonicalExact.length) {
    const hasAlphanumericCanonical =
      canonicalQuadraKey.kind === "alphanumeric" || canonicalLoteKey.kind === "alphanumeric";

    return positiveShadowResult({
      matchType: hasAlphanumericCanonical ? "exact_alphanumeric_canonical" : "exact_canonical",
      reason: hasAlphanumericCanonical
        ? "zero_pad_alphanumeric_normalized_exact_key"
        : args.canonicalExactReason || "zero_pad_normalized_exact_key",
      key: canonicalKey,
      candidates: canonicalExact,
      inputStreet: args.inputStreet,
    });
  }

  const compoundCanonicalKeys = buildCompoundLotCanonicalKeys({
    bairroKey: args.bairroKey,
    quadraKeys: [...new Set([args.quadraKey, canonicalQuadraKey.value])],
    rawLote: args.rawLote,
  }).filter((candidateKey) => candidateKey !== args.key && candidateKey !== canonicalKey);
  const compoundCanonicalMatches = compoundCanonicalKeys.filter((candidateKey) => {
    const candidates = index[candidateKey];
    return Array.isArray(candidates) && candidates.length > 0;
  });

  if (compoundCanonicalMatches.length === 1) {
    const matchedKey = compoundCanonicalMatches[0];
    return positiveShadowResult({
      matchType: "compound_lot_canonical",
      reason: "compound_lot_normalized_key",
      key: matchedKey,
      candidates: index[matchedKey] || [],
      inputStreet: args.inputStreet,
    });
  }

  const compoundKeys = Object.keys(index).filter((candidateKey) => {
    const parts = keyParts(candidateKey);
    return (
      parts.bairro === args.bairroKey &&
      parts.quadra === args.quadraKey &&
      parts.lote !== args.loteKey &&
      loteHasToken(parts.lote, args.loteKey)
    );
  });

  if (compoundKeys.length) {
    const matchedKey = compoundKeys.length === 1 ? compoundKeys[0] : args.key;
    return positiveShadowResult({
      matchType: "compound_lot",
      reason: args.compoundReason || (compoundKeys.length === 1 ? "compound_lot" : "compound_lot_ambiguous"),
      key: matchedKey,
      candidates: compoundKeys.flatMap((candidateKey) => index[candidateKey] || []),
      inputStreet: args.inputStreet,
    });
  }

  const sameQuadraKeys = Object.keys(index).filter((candidateKey) => {
    const parts = keyParts(candidateKey);
    return parts.bairro === args.bairroKey && parts.quadra === args.quadraKey;
  });

  if (sameQuadraKeys.length) {
    const candidatesCount = sameQuadraKeys.reduce(
      (sum, candidateKey) => sum + (Array.isArray(index[candidateKey]) ? index[candidateKey].length : 0),
      0,
    );

    return negativeShadowResult({
      matchType: "same_quadra",
      reason: "same_bairro_same_quadra_lote_not_found",
      key: args.key,
      candidatesCount,
    });
  }

  return negativeShadowResult({
    matchType: "not_found",
    reason: "no_local_first_match",
    key: args.key,
  });
}

function scoreRankingV2Candidate(args: {
  candidate: LocalFirstCandidate;
  partitionKey: string;
  inputBairroKey: string;
  streetCompatibility: GoianiaStreetComparison;
  qdLtStreetGroupSize: number;
}) {
  let score = 100;
  const bairroCompatible = isBairroCompatibleForRankingV2(args.inputBairroKey, args.partitionKey);
  let bairroPenalty = 0;

  if (args.streetCompatibility === "STREET_MATCH") score += 80;
  if (args.streetCompatibility === "STREET_PARTIAL_MATCH") score += 45;

  if (args.partitionKey === args.inputBairroKey) {
    score += 120;
  } else if (bairroCompatible) {
    score += 95;
  } else {
    bairroPenalty = -60;
    score += bairroPenalty;
  }

  if (args.qdLtStreetGroupSize === 1) score += 40;
  if (args.candidate.c === "HIGH") score += 20;

  return {
    score,
    bairroCompatible,
    bairroPenalty,
  };
}

function rankingV2StreetRank(value: GoianiaStreetComparison) {
  return value === "STREET_MATCH" ? 2 : value === "STREET_PARTIAL_MATCH" ? 1 : 0;
}

function isRankingV21SafeBairroCandidate(candidate: RankingV2Candidate) {
  return (
    candidate.bairroCompatible &&
    isSafeRankingV2Street(candidate.streetCompatibility) &&
    candidate.candidate.c === "HIGH" &&
    hasValidCoords(candidate.candidate)
  );
}

function lookupGoianiaRankingV2(args: {
  inputBairroKey: string;
  quadraKey: string;
  loteKey: string;
  rawLote: string;
  inputStreet?: string;
  key: string;
}): GoianiaLocalFirstShadow {
  const inputStreet = compact(args.inputStreet || "");
  if (!args.quadraKey || !args.loteKey) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_no_qd_lt",
      key: args.key,
    });
  }

  if (!inputStreet) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_no_street_match",
      key: args.key,
    });
  }

  const rawCandidates: Array<{
    partitionKey: string;
    key: string;
    candidate: LocalFirstCandidate;
    streetCompatibility: GoianiaStreetComparison;
  }> = [];
  let sawStreetMismatch = false;
  let sawStreetUnknown = false;
  const partitionScan = buildGoianiaRankingV2PartitionKeys({
    inputBairroKey: args.inputBairroKey,
    inputStreet,
  });

  if (!partitionScan.partitionKeys.length) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_no_partition_scope",
      key: args.key,
      partitionScan: partitionScan.diagnostics,
    });
  }

  for (const partitionKey of partitionScan.partitionKeys) {
    const partition = loadPartition(partitionKey);
    const index = partition?.index || null;
    if (!index) continue;

    const canonicalQuadraKey = canonicalizeLookupToken(args.quadraKey);
    const canonicalLoteKey = canonicalizeLookupToken(args.loteKey);
    const lookupKeys = [
      buildNormalizedKey(partitionKey, args.quadraKey, args.loteKey),
      buildNormalizedKey(partitionKey, canonicalQuadraKey.value, canonicalLoteKey.value),
      ...buildCompoundLotCanonicalKeys({
        bairroKey: partitionKey,
        quadraKeys: [...new Set([args.quadraKey, canonicalQuadraKey.value])],
        rawLote: args.rawLote,
      }),
    ];

    for (const lookupKey of [...new Set(lookupKeys)]) {
      const candidates = Array.isArray(index[lookupKey]) ? index[lookupKey] : [];
      for (const candidate of candidates) {
        const compatibility = candidate.r
          ? compareGoianiaStreet(inputStreet, String(candidate.r))
          : "STREET_UNKNOWN";

        if (compatibility === "STREET_MISMATCH") {
          sawStreetMismatch = true;
          continue;
        }
        if (compatibility === "STREET_UNKNOWN") {
          sawStreetUnknown = true;
          continue;
        }
        if (!isSafeRankingV2Street(compatibility)) continue;

        rawCandidates.push({
          partitionKey,
          key: lookupKey,
          candidate,
          streetCompatibility: compatibility,
        });
      }
    }
  }

  if (!rawCandidates.length) {
    return emptyRankingV2Diagnostic({
      reason: sawStreetMismatch
        ? "goiania_ranking_v2_street_mismatch"
        : sawStreetUnknown
          ? "goiania_ranking_v2_no_street_match"
          : "goiania_ranking_v2_no_candidate",
      key: args.key,
      partitionScan: partitionScan.diagnostics,
    });
  }

  const groupCounts = new Map<string, number>();
  for (const candidate of rawCandidates) {
    const streetKey = normalizeKey(candidate.candidate.r || "");
    const groupKey = [candidate.key, candidate.streetCompatibility, streetKey].join("|");
    groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
  }

  const scoredCandidates: RankingV2Candidate[] = rawCandidates.map((candidate) => {
    const streetKey = normalizeKey(candidate.candidate.r || "");
    const groupKey = [candidate.key, candidate.streetCompatibility, streetKey].join("|");
    const rankingScore = scoreRankingV2Candidate({
      candidate: candidate.candidate,
      partitionKey: candidate.partitionKey,
      inputBairroKey: args.inputBairroKey,
      streetCompatibility: candidate.streetCompatibility,
      qdLtStreetGroupSize: groupCounts.get(groupKey) || 0,
    });
    return {
      ...candidate,
      score: rankingScore.score,
      bairroCompatible: rankingScore.bairroCompatible,
      bairroPenalty: rankingScore.bairroPenalty,
    };
  });

  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (rankingV2StreetRank(b.streetCompatibility) !== rankingV2StreetRank(a.streetCompatibility)) {
      return rankingV2StreetRank(b.streetCompatibility) - rankingV2StreetRank(a.streetCompatibility);
    }
    const aBairro = isBairroCompatibleForRankingV2(args.inputBairroKey, a.partitionKey) ? 1 : 0;
    const bBairro = isBairroCompatibleForRankingV2(args.inputBairroKey, b.partitionKey) ? 1 : 0;
    return bBairro - aBairro;
  });

  const evidencePartitions = new Map<string, Set<string>>();
  for (const candidate of scoredCandidates) {
    const evidenceKey = [
      normalizeKey(candidate.candidate.r || ""),
      candidate.streetCompatibility,
    ].join("|");
    if (!evidencePartitions.has(evidenceKey)) {
      evidencePartitions.set(evidenceKey, new Set());
    }
    evidencePartitions.get(evidenceKey)?.add(candidate.partitionKey);
  }
  const hasMultipleEvidencePartitions = [...evidencePartitions.values()].some((partitions) => partitions.size > 1);
  const safeBairroCandidates = scoredCandidates.filter(isRankingV21SafeBairroCandidate);
  const hasSafeBairroCandidate = safeBairroCandidates.length > 0;
  const bestSafeBairroCandidate = safeBairroCandidates[0] || null;
  const topScoredCandidate = scoredCandidates[0] || null;
  const topIncompatibleCandidate = scoredCandidates.find((candidate) => !candidate.bairroCompatible) || null;
  const incompatibleHasClearlySuperiorStreet =
    !!topIncompatibleCandidate &&
    !!bestSafeBairroCandidate &&
    rankingV2StreetRank(topIncompatibleCandidate.streetCompatibility) >
      rankingV2StreetRank(bestSafeBairroCandidate.streetCompatibility);
  const incompatibleGap =
    topIncompatibleCandidate && bestSafeBairroCandidate
      ? topIncompatibleCandidate.score - bestSafeBairroCandidate.score
      : null;
  const incompatibleCanOverrideBairro =
    incompatibleHasClearlySuperiorStreet && incompatibleGap !== null && incompatibleGap >= 30;
  const bairroCandidateShouldWin =
    !!bestSafeBairroCandidate &&
    !!topScoredCandidate &&
    !topScoredCandidate.bairroCompatible &&
    !incompatibleCanOverrideBairro;
  const rankedCandidates =
    bairroCandidateShouldWin || (hasMultipleEvidencePartitions && hasSafeBairroCandidate)
      ? [
          ...safeBairroCandidates,
          ...scoredCandidates.filter((candidate) => !safeBairroCandidates.includes(candidate)),
        ]
      : scoredCandidates;

  const winner = rankedCandidates[0] || null;
  const runnerUp = rankedCandidates[1] || null;
  const runnerUpScore = runnerUp?.score ?? null;
  const scoreGap = winner && runnerUp ? winner.score - runnerUp.score : null;
  const winnerSelectedBecauseBairro =
    !!winner &&
    ((bairroCandidateShouldWin && winner.bairroCompatible) ||
      (hasMultipleEvidencePartitions && winner.bairroCompatible));

  if (!winner) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_no_candidate",
      key: args.key,
      candidatesCount: scoredCandidates.length,
      partitionScan: partitionScan.diagnostics,
    });
  }

  if (hasMultipleEvidencePartitions && !hasSafeBairroCandidate) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_multiple_candidates",
      key: args.key,
      candidatesCount: scoredCandidates.length,
      winnerScore: winner.score,
      runnerUpScore,
      scoreGap,
      winnerPartition: winner.partitionKey,
      winnerStreet: winner.candidate.r ? String(winner.candidate.r) : null,
      streetCompatibility: winner.streetCompatibility,
      rankingV21BairroCompatible: winner.bairroCompatible,
      rankingV21BairroPenalty: winner.bairroPenalty,
      rankingV21BlockedBecauseBairroConflict: true,
      partitionScan: partitionScan.diagnostics,
    });
  }

  if (
    topScoredCandidate &&
    !topScoredCandidate.bairroCompatible &&
    hasSafeBairroCandidate &&
    !incompatibleCanOverrideBairro &&
    !bairroCandidateShouldWin
  ) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_bairro_conflict",
      key: args.key,
      candidatesCount: scoredCandidates.length,
      winnerScore: topScoredCandidate.score,
      runnerUpScore: bestSafeBairroCandidate?.score ?? null,
      scoreGap:
        bestSafeBairroCandidate && topScoredCandidate
          ? topScoredCandidate.score - bestSafeBairroCandidate.score
          : null,
      winnerPartition: topScoredCandidate.partitionKey,
      winnerStreet: topScoredCandidate.candidate.r ? String(topScoredCandidate.candidate.r) : null,
      streetCompatibility: topScoredCandidate.streetCompatibility,
      rankingV21BairroPreference: true,
      rankingV21BairroCompatible: false,
      rankingV21BairroPenalty: topScoredCandidate.bairroPenalty,
      rankingV21BlockedBecauseBairroConflict: true,
      partitionScan: partitionScan.diagnostics,
    });
  }

  const tiedWinners = scoredCandidates.filter((candidate) => candidate.score === winner.score);
  const effectiveTiedWinners = (winner.bairroCompatible && hasSafeBairroCandidate)
    ? tiedWinners.filter((candidate) => candidate.bairroCompatible)
    : tiedWinners;
  const hasMultiplePartitionsAtTop = new Set(effectiveTiedWinners.map((candidate) => candidate.partitionKey)).size > 1;
  if (effectiveTiedWinners.length > 1 || hasMultiplePartitionsAtTop) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_multiple_candidates",
      key: args.key,
      candidatesCount: scoredCandidates.length,
      winnerScore: winner.score,
      runnerUpScore,
      scoreGap,
      winnerPartition: winner.partitionKey,
      winnerStreet: winner.candidate.r ? String(winner.candidate.r) : null,
      streetCompatibility: winner.streetCompatibility,
      rankingV21BairroPreference: hasSafeBairroCandidate,
      rankingV21BairroCompatible: winner.bairroCompatible,
      rankingV21BairroPenalty: winner.bairroPenalty,
      rankingV21BlockedBecauseBairroConflict: hasMultipleEvidencePartitions,
      partitionScan: partitionScan.diagnostics,
    });
  }

  if (winner.score < 180) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_no_candidate",
      key: args.key,
      candidatesCount: scoredCandidates.length,
      winnerScore: winner.score,
      runnerUpScore,
      scoreGap,
      winnerPartition: winner.partitionKey,
      winnerStreet: winner.candidate.r ? String(winner.candidate.r) : null,
      streetCompatibility: winner.streetCompatibility,
      rankingV21BairroPreference: hasSafeBairroCandidate,
      rankingV21BairroCompatible: winner.bairroCompatible,
      rankingV21BairroPenalty: winner.bairroPenalty,
      partitionScan: partitionScan.diagnostics,
    });
  }

  if (runnerUp && !winnerSelectedBecauseBairro && (scoreGap === null || scoreGap < 30)) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_score_too_close",
      key: args.key,
      candidatesCount: scoredCandidates.length,
      winnerScore: winner.score,
      runnerUpScore,
      scoreGap,
      winnerPartition: winner.partitionKey,
      winnerStreet: winner.candidate.r ? String(winner.candidate.r) : null,
      streetCompatibility: winner.streetCompatibility,
      rankingV21BairroPreference: hasSafeBairroCandidate,
      rankingV21BairroCompatible: winner.bairroCompatible,
      rankingV21BairroPenalty: winner.bairroPenalty,
      partitionScan: partitionScan.diagnostics,
    });
  }

  if (!hasValidCoords(winner.candidate)) {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_invalid_coords",
      key: args.key,
      candidatesCount: scoredCandidates.length,
      winnerScore: winner.score,
      runnerUpScore,
      scoreGap,
      winnerPartition: winner.partitionKey,
      winnerStreet: winner.candidate.r ? String(winner.candidate.r) : null,
      streetCompatibility: winner.streetCompatibility,
      rankingV21BairroPreference: hasSafeBairroCandidate,
      rankingV21BairroCompatible: winner.bairroCompatible,
      rankingV21BairroPenalty: winner.bairroPenalty,
      partitionScan: partitionScan.diagnostics,
    });
  }

  if (winner.candidate.c !== "HIGH") {
    return emptyRankingV2Diagnostic({
      reason: "goiania_ranking_v2_not_high_confidence",
      key: args.key,
      candidatesCount: scoredCandidates.length,
      winnerScore: winner.score,
      runnerUpScore,
      scoreGap,
      winnerPartition: winner.partitionKey,
      winnerStreet: winner.candidate.r ? String(winner.candidate.r) : null,
      streetCompatibility: winner.streetCompatibility,
      rankingV21BairroPreference: hasSafeBairroCandidate,
      rankingV21BairroCompatible: winner.bairroCompatible,
      rankingV21BairroPenalty: winner.bairroPenalty,
      partitionScan: partitionScan.diagnostics,
    });
  }

  return {
    attempted: true,
    found: true,
    matchType: "ranking_v2_exact",
    confidence: winner.candidate.c || null,
    distanceM: Number.isFinite(winner.candidate.d) ? Number(winner.candidate.d) : null,
    candidatesCount: 1,
    reason: "goiania_ranking_v2_exact",
    key: winner.key,
    localFirstStreetCompatibility: winner.streetCompatibility,
    localFirstStreetScoreAdjustment: streetScoreAdjustment(winner.streetCompatibility),
    localFirstScoreBeforeStreet: localFirstBaseScore(winner.candidate),
    localFirstScoreAfterStreet: winner.score,
    localFirstStreetLabel: winner.candidate.r ? String(winner.candidate.r) : null,
    rankingV2Attempted: true,
    rankingV2CandidatesCount: scoredCandidates.length,
    rankingV2WinnerScore: winner.score,
    rankingV2RunnerUpScore: runnerUpScore,
    rankingV2ScoreGap: scoreGap,
    rankingV2WinnerPartition: winner.partitionKey,
    rankingV2WinnerStreet: winner.candidate.r ? String(winner.candidate.r) : null,
    rankingV2StreetCompatibility: winner.streetCompatibility,
    rankingV2Reason: "goiania_ranking_v2_exact",
    rankingV2BlockedReason: null,
    rankingV21Applied: true,
    rankingV21BairroPreference: hasSafeBairroCandidate,
    rankingV21BairroCompatible: winner.bairroCompatible,
    rankingV21BairroPenalty: winner.bairroPenalty,
    rankingV21SelectedBecauseBairro: winnerSelectedBecauseBairro,
    rankingV21BlockedBecauseBairroConflict: false,
    rankingV2PartitionScan: partitionScan.diagnostics,
    candidate: {
      bairro: String(winner.candidate.b || ""),
      quadra: String(winner.candidate.q || ""),
      lote: String(winner.candidate.l || ""),
      streetLabel: winner.candidate.r ? String(winner.candidate.r) : null,
      lat: Number.isFinite(winner.candidate.lat) ? Number(winner.candidate.lat) : null,
      lng: Number.isFinite(winner.candidate.lng) ? Number(winner.candidate.lng) : null,
      sourceIndex: Number.isFinite(winner.candidate.si) ? Number(winner.candidate.si) : null,
    },
  };
}

function resolveGoianiaLocalFirstCore(args: {
  city: string;
  bairro: string;
  quadra: string;
  lote: string;
  rua?: string;
}): GoianiaLocalFirstShadow {
  if (!isGoianiaCity(args.city)) {
    return {
      attempted: false,
      found: false,
      matchType: "not_found",
      confidence: null,
      distanceM: null,
      candidatesCount: 0,
      reason: "city_not_goiania",
      key: null,
      candidate: null,
    };
  }

  const bairroKey = normalizeKey(args.bairro);
  const quadraKey = normalizeKey(args.quadra);
  const loteKey = normalizeKey(args.lote);
  const key = buildKey(args.bairro, args.quadra, args.lote);

  if (!quadraKey || !loteKey) {
    return negativeShadowResult({
      matchType: "missing_parts",
      reason: "missing_bairro_quadra_or_lote",
      key,
    });
  }

  if (!bairroKey) {
    if (compact(args.rua || "")) {
      return lookupGoianiaRankingV2({
        inputBairroKey: "",
        quadraKey,
        loteKey,
        rawLote: args.lote,
        inputStreet: args.rua,
        key,
      });
    }

    return negativeShadowResult({
      matchType: "missing_parts",
      reason: "missing_bairro_quadra_or_lote",
      key,
    });
  }

  const originalResult = lookupGoianiaLocalFirstByKeys({
    bairroKey,
    quadraKey,
    loteKey,
    rawLote: args.lote,
    key,
    inputStreet: args.rua,
  });

  const partitionFallback = originalResult.matchType === "bairro_not_found"
    ? resolveGoianiaPartitionFallback(bairroKey)
    : null;

  if (partitionFallback) {
    const fallbackResult = lookupGoianiaLocalFirstByKeys({
      bairroKey: partitionFallback.to,
      quadraKey,
      loteKey,
      rawLote: args.lote,
      key: buildNormalizedKey(partitionFallback.to, quadraKey, loteKey),
      inputStreet: args.rua,
      exactReason: "goiania_partition_fallback_exact",
      canonicalExactReason: "goiania_partition_fallback_exact",
      compoundReason: "goiania_partition_fallback_exact",
    });

    if (
      fallbackResult.matchType === "exact" ||
      fallbackResult.matchType === "exact_canonical" ||
      fallbackResult.matchType === "exact_alphanumeric_canonical" ||
      fallbackResult.matchType === "compound_lot_canonical" ||
      fallbackResult.matchType === "compound_lot"
    ) {
      return {
        ...fallbackResult,
        matchType: "partition_fallback_exact",
        reason: "goiania_partition_fallback_exact",
        fallbackFrom: partitionFallback.from,
        fallbackTo: partitionFallback.to,
        fallbackStreetCompatibility: fallbackResult.localFirstStreetCompatibility ?? null,
      };
    }
  }

  if (originalResult.matchType === "bairro_not_found") {
    const structuralAliasResult = lookupGoianiaStructuralAliasFallback({
      fromBairroKey: bairroKey,
      quadraKey,
      loteKey,
      inputStreet: args.rua,
    });

    if (structuralAliasResult) return structuralAliasResult;
  }

  if (
    originalResult.matchType === "exact" ||
    originalResult.matchType === "exact_canonical" ||
    originalResult.matchType === "exact_alphanumeric_canonical" ||
    originalResult.matchType === "compound_lot_canonical" ||
    originalResult.matchType === "compound_lot"
  ) {
    return originalResult;
  }

  const resolveRankingV2 = () =>
    lookupGoianiaRankingV2({
      inputBairroKey: bairroKey,
      quadraKey,
      loteKey,
      rawLote: args.lote,
      inputStreet: args.rua,
      key,
    });

  const bairroWithoutPrefix = stripBairroPrefix(bairroKey);
  if (!bairroWithoutPrefix) return resolveRankingV2();

  const prefixResult = lookupGoianiaLocalFirstByKeys({
    bairroKey: bairroWithoutPrefix,
    quadraKey,
    loteKey,
    rawLote: args.lote,
    key: buildNormalizedKey(bairroWithoutPrefix, quadraKey, loteKey),
    inputStreet: args.rua,
    exactReason: "prefix_resolved_exact",
    canonicalExactReason: "prefix_resolved_zero_pad_normalized_exact",
    compoundReason: "prefix_resolved_compound_lot",
  });

  if (
    prefixResult.matchType === "exact" ||
    prefixResult.matchType === "exact_canonical" ||
    prefixResult.matchType === "exact_alphanumeric_canonical" ||
    prefixResult.matchType === "compound_lot_canonical" ||
    prefixResult.matchType === "compound_lot"
  ) {
    return prefixResult;
  }

  const rankingV2Result = resolveRankingV2();

  if (rankingV2Result.found) {
    return rankingV2Result;
  }

  const aliasBairroResult = lookupGoianiaBairroAliasV1({
    fromBairroKey: bairroKey,
    quadraKey,
    loteKey,
    inputStreet: args.rua,
  });

  if (aliasBairroResult?.found) {
    return aliasBairroResult;
  }

  if (rankingV2Result.rankingV2Attempted) {
    return aliasBairroResult || rankingV2Result;
  }

  return originalResult;
}

function isGoianiaPositiveMatchType(matchType: GoianiaLocalFirstMatchType) {
  return (
    matchType === "exact" ||
    matchType === "exact_canonical" ||
    matchType === "exact_alphanumeric_canonical" ||
    matchType === "compound_lot_canonical" ||
    matchType === "compound_lot" ||
    matchType === "partition_fallback_exact" ||
    matchType === "structural_alias_exact" ||
    matchType === "alias_bairro_exact" ||
    matchType === "ranking_v2_exact"
  );
}

function toLocalFirstStreetMatchType(
  compatibility: GoianiaStreetComparison | null | undefined,
): LocalFirstStreetMatchType | null {
  return compatibility ?? null;
}

function mapGoianiaLocalFirstValidation(
  result: GoianiaLocalFirstShadow,
  args: {
    inputHadRua: boolean;
  },
): LocalFirstCandidateValidationResult {
  const streetMatchType = toLocalFirstStreetMatchType(
    result.localFirstStreetCompatibility ??
      result.fallbackStreetCompatibility ??
      result.structuralAliasStreetCompatibility ??
      result.aliasBairroStreetCompatibility ??
      null,
  );
  const candidateUnique = result.candidatesCount === 1;
  const hasCandidate = result.found && !!result.candidate;
  const hasPositiveMatch = isGoianiaPositiveMatchType(result.matchType);

  let validationStatus: LocalFirstCandidateValidationResult["validationStatus"] =
    "FAILED";
  let reason = result.reason;
  let failureReason: string | null = result.reason;

  if (hasCandidate && hasPositiveMatch) {
    if (streetMatchType === "STREET_MISMATCH") {
      validationStatus = "FAILED";
      reason = "goiania_street_mismatch";
      failureReason = "goiania_street_mismatch";
    } else if (!candidateUnique) {
      validationStatus = "NEEDS_REVIEW";
      reason = "goiania_multiple_candidates";
      failureReason = "goiania_multiple_candidates";
    } else if (!args.inputHadRua) {
      validationStatus = "NEEDS_REVIEW";
      reason = "goiania_street_required";
      failureReason = "goiania_street_required";
    } else if (streetMatchType === null) {
      validationStatus = "NEEDS_REVIEW";
      reason = "goiania_street_not_checked";
      failureReason = "goiania_street_not_checked";
    } else if (
      streetMatchType === "STREET_PARTIAL_MATCH" ||
      streetMatchType === "STREET_UNKNOWN"
    ) {
      validationStatus = "NEEDS_REVIEW";
      reason = "goiania_street_needs_review";
      failureReason = "goiania_street_needs_review";
    } else {
      validationStatus = "VALIDATED";
      reason = "goiania_validated";
      failureReason = null;
    }
  }

  return {
    attempted: result.attempted,
    found: result.found,
    validationStatus,
    reason,
    failureReason,
    city: "GOIANIA",
    matchType: result.matchType,
    streetMatchType,
    candidateCount: result.candidatesCount,
    candidateUnique,
    candidate: result.candidate
      ? {
          bairro: result.candidate.bairro,
          quadra: result.candidate.quadra,
          lote: result.candidate.lote,
          streetLabel: result.candidate.streetLabel,
        }
      : null,
    diagnostics: {
      confidence: result.confidence,
      key: result.key,
      localFirstStreetScoreAdjustment:
        result.localFirstStreetScoreAdjustment ?? null,
      localFirstScoreBeforeStreet: result.localFirstScoreBeforeStreet ?? null,
      localFirstScoreAfterStreet: result.localFirstScoreAfterStreet ?? null,
      localFirstStreetAdjustedCandidatesCount:
        result.localFirstStreetAdjustedCandidatesCount ?? null,
      localFirstWinnerChangedByStreet:
        result.localFirstWinnerChangedByStreet ?? null,
      localFirstWinnerBeforeStreetLabel:
        result.localFirstWinnerBeforeStreetLabel ?? null,
      localFirstWinnerAfterStreetLabel:
        result.localFirstWinnerAfterStreetLabel ?? null,
      fallbackFrom: result.fallbackFrom ?? null,
      fallbackTo: result.fallbackTo ?? null,
      structuralAliasFrom: result.structuralAliasFrom ?? null,
      structuralAliasTo: result.structuralAliasTo ?? null,
      structuralAliasCandidatesCount:
        result.structuralAliasCandidatesCount ?? null,
      aliasBairroApplied: result.aliasBairroApplied ?? false,
      aliasBairroFrom: result.aliasBairroFrom ?? null,
      aliasBairroTo: result.aliasBairroTo ?? null,
      aliasBairroStreetCompatibility:
        result.aliasBairroStreetCompatibility ?? null,
      aliasBairroUniqueCandidate:
        result.aliasBairroUniqueCandidate ?? null,
      aliasBairroCandidatesCount:
        result.aliasBairroCandidatesCount ?? null,
      rankingV2Attempted: result.rankingV2Attempted ?? false,
      rankingV2CandidatesCount: result.rankingV2CandidatesCount ?? 0,
      rankingV2WinnerScore: result.rankingV2WinnerScore ?? null,
      rankingV2RunnerUpScore: result.rankingV2RunnerUpScore ?? null,
      rankingV2ScoreGap: result.rankingV2ScoreGap ?? null,
      rankingV2WinnerPartition: result.rankingV2WinnerPartition ?? null,
      rankingV2WinnerStreet: result.rankingV2WinnerStreet ?? null,
      rankingV2StreetCompatibility: result.rankingV2StreetCompatibility ?? null,
      rankingV2Reason: result.rankingV2Reason ?? null,
      rankingV2BlockedReason: result.rankingV2BlockedReason ?? null,
      rankingV21Applied: result.rankingV21Applied ?? false,
      rankingV21BairroPreference: result.rankingV21BairroPreference ?? false,
      rankingV21BairroCompatible: result.rankingV21BairroCompatible ?? null,
      rankingV21BairroPenalty: result.rankingV21BairroPenalty ?? null,
      rankingV21SelectedBecauseBairro:
        result.rankingV21SelectedBecauseBairro ?? false,
      rankingV21BlockedBecauseBairroConflict:
        result.rankingV21BlockedBecauseBairroConflict ?? false,
      rankingV2PartitionScan: result.rankingV2PartitionScan ?? null,
      inputHadRua: args.inputHadRua,
      streetRequired: true,
    },
  };
}

export function lookupGoianiaLocalFirstShadow(args: {
  city: string;
  bairro: string;
  quadra: string;
  lote: string;
  rua?: string;
}): GoianiaLocalFirstShadow {
  if (!isGoianiaLocalFirstEnabled()) return disabledShadow();
  return resolveGoianiaLocalFirstCore(args);
}

export function resolveGoianiaLocalFirstCandidate(
  args: LocalFirstCandidateValidationInput,
): LocalFirstCandidateValidationResult {
  const inputHadRua = !!String(args.rua || "").trim();

  return mapGoianiaLocalFirstValidation(
    resolveGoianiaLocalFirstCore({
      city: args.city,
      bairro: args.bairro,
      quadra: args.quadra,
      lote: args.lote,
      rua: args.rua ?? undefined,
    }),
    { inputHadRua },
  );
}
