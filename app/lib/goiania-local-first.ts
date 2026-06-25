import fs from "fs";
import path from "path";
import {
  compareGoianiaStreet,
  type GoianiaStreetComparison,
} from "@/app/lib/goiania-street-normalization";
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
    | "structural_alias_exact";
  reason: string;
  key: string;
  candidates: LocalFirstCandidate[];
  inputStreet?: string;
  fallbackFrom?: string | null;
  fallbackTo?: string | null;
  structuralAliasFrom?: string | null;
  structuralAliasTo?: string | null;
  structuralAliasCandidatesCount?: number;
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
    | "structural_alias_exact"
  >;
  reason: string;
  key: string | null;
  candidatesCount?: number;
  structuralAliasFrom?: string | null;
  structuralAliasTo?: string | null;
  structuralAliasStreetCompatibility?: GoianiaStreetComparison | null;
  structuralAliasCandidatesCount?: number;
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

  const bairroWithoutPrefix = stripBairroPrefix(bairroKey);
  if (!bairroWithoutPrefix) return originalResult;

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
    matchType === "structural_alias_exact"
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
