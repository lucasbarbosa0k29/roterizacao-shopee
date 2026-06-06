import fs from "fs";
import path from "path";

export type GoianiaLocalFirstMatchType =
  | "exact"
  | "compound_lot"
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

// Server-side local source. Keep guarded by explicit Goiânia env flags.
const PARTITION_DIR = process.env.ROTTA_GOIANIA_LOCAL_FIRST_DIR
  ? path.resolve(process.env.ROTTA_GOIANIA_LOCAL_FIRST_DIR)
  : path.join(process.cwd(), "app", "data", "goiania_local_first_by_bairro_v4");
const partitionCache = new Map<string, Partition | null>();
const BAIRRO_PREFIXES = [
  "RESIDENCIAL",
  "RES",
  "CONDOMINIO",
  "JARDIM",
  "SETOR",
  "PARQUE",
  "VILA",
  "VILLAGE",
];

function isShadowEnabled() {
  return process.env.ROTTA_GOIANIA_LOCAL_FIRST_SHADOW === "1";
}

function isBypassEnabled() {
  return process.env.ROTTA_GOIANIA_LOCAL_FIRST_BYPASS === "1";
}

function isGoianiaLocalFirstEnabled() {
  return isShadowEnabled() || isBypassEnabled();
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

function stripBairroPrefix(bairroKey: string) {
  for (const prefix of BAIRRO_PREFIXES) {
    if (!bairroKey.startsWith(`${prefix} `)) continue;
    const stripped = bairroKey.slice(prefix.length + 1).trim();
    return stripped || null;
  }

  return null;
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
  if (partitionCache.has(bairroKey)) return partitionCache.get(bairroKey) || null;

  const fileName = `${normalizeFileKey(bairroKey) || "SEM_BAIRRO"}.json`;
  const filePath = path.join(PARTITION_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    partitionCache.set(bairroKey, null);
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as Partition;
  partitionCache.set(bairroKey, parsed);
  return parsed;
}

function compareCandidate(a: LocalFirstCandidate, b: LocalFirstCandidate) {
  const ar = a.c === "HIGH" ? 0 : a.c === "MEDIUM" ? 1 : 2;
  const br = b.c === "HIGH" ? 0 : b.c === "MEDIUM" ? 1 : 2;
  if (ar !== br) return ar - br;
  return (Number(a.d) || Number.POSITIVE_INFINITY) - (Number(b.d) || Number.POSITIVE_INFINITY);
}

function positiveShadowResult(args: {
  matchType: "exact" | "compound_lot";
  reason: string;
  key: string;
  candidates: LocalFirstCandidate[];
}): GoianiaLocalFirstShadow {
  const candidates = [...args.candidates].sort(compareCandidate);
  const best = candidates[0] || null;

  return {
    attempted: true,
    found: true,
    matchType: args.matchType,
    confidence: best?.c || null,
    distanceM: Number.isFinite(best?.d) ? Number(best.d) : null,
    candidatesCount: candidates.length,
    reason: args.reason,
    key: args.key,
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
  matchType: Exclude<GoianiaLocalFirstMatchType, "exact" | "compound_lot">;
  reason: string;
  key: string | null;
  candidatesCount?: number;
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
    candidate: null,
  };
}

function lookupGoianiaLocalFirstByKeys(args: {
  bairroKey: string;
  quadraKey: string;
  loteKey: string;
  key: string;
  exactReason?: string;
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

export function lookupGoianiaLocalFirstShadow(args: {
  city: string;
  bairro: string;
  quadra: string;
  lote: string;
}): GoianiaLocalFirstShadow {
  if (!isGoianiaLocalFirstEnabled()) return disabledShadow();

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

  if (!bairroKey || !quadraKey || !loteKey) {
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
    key,
  });

  if (originalResult.matchType !== "bairro_not_found") return originalResult;

  const bairroWithoutPrefix = stripBairroPrefix(bairroKey);
  if (!bairroWithoutPrefix) return originalResult;

  const prefixResult = lookupGoianiaLocalFirstByKeys({
    bairroKey: bairroWithoutPrefix,
    quadraKey,
    loteKey,
    key: buildNormalizedKey(bairroWithoutPrefix, quadraKey, loteKey),
    exactReason: "prefix_resolved_exact",
    compoundReason: "prefix_resolved_compound_lot",
  });

  if (prefixResult.matchType === "exact" || prefixResult.matchType === "compound_lot") return prefixResult;

  return originalResult;
}
