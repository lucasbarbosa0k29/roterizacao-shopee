import { resolveAparecidaLocalFirstCandidate } from "@/app/lib/aparecida-local-lots";
import { resolveGoianiaLocalFirstCandidate } from "@/app/lib/goiania-local-first";
import type {
  LocalFirstCandidateValidationResult,
  LocalFirstValidationCity,
} from "@/app/lib/local-first-validation-types";

export type LocalFirstAliasCandidatePackInput = {
  city: LocalFirstValidationCity;
  bairro: string;
  rua: string;
  quadra: string;
  lote: string;
  failureReason?: string | null;
  limits?: {
    maxBairros?: number;
    maxRuas?: number;
    maxPairs?: number;
  };
};

export type LocalFirstAliasCandidate = {
  id: string;
  name: string;
  normalizedName: string;
  score: number;
  signals: string[];
  riskFlags: string[];
};

export type LocalFirstAliasCandidatePair = {
  id: string;
  bairroCandidateId: string;
  ruaCandidateId: string;
  bairroName: string;
  ruaName: string;
  score: number;
  signals: string[];
  riskFlags: string[];
};

export type LocalFirstAliasCandidatePack = {
  city: LocalFirstValidationCity;
  source: {
    bairro: string;
    rua: string;
    quadra: string;
    lote: string;
  };
  eligibleForAi: boolean;
  skipReason?: string | null;
  bairroCandidates: LocalFirstAliasCandidate[];
  ruaCandidates: LocalFirstAliasCandidate[];
  candidatePairs: LocalFirstAliasCandidatePair[];
  diagnostics: {
    signals: string[];
    riskFlags: string[];
  };
};

const DEFAULT_LIMITS = {
  maxBairros: 10,
  maxRuas: 15,
  maxPairs: 8,
};

const BAIRRO_PREFIXES = [
  "BAIRRO",
  "CONDOMINIO",
  "CONJUNTO",
  "JARDIM",
  "PARQUE",
  "RES",
  "RESIDENCIAL",
  "SETOR",
  "VILA",
  "VILLAGE",
];

function normalizeText(value: string | null | undefined) {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function pushUnique(values: string[], value: string) {
  const normalized = normalizeText(value);
  if (!normalized || values.some((existing) => normalizeText(existing) === normalized)) {
    return;
  }
  values.push(value.trim());
}

function buildBairroVariants(bairro: string) {
  const variants: string[] = [];
  const normalized = normalizeText(bairro);
  pushUnique(variants, bairro);

  for (const prefix of BAIRRO_PREFIXES) {
    if (!normalized.startsWith(`${prefix} `)) continue;
    pushUnique(variants, normalized.slice(prefix.length + 1));
  }

  return variants;
}

function buildRuaVariants(rua: string) {
  const variants: string[] = [];
  const normalized = normalizeText(rua);
  pushUnique(variants, rua);

  const codeMatch = normalized.match(/^(?:RUA|R)\s*([A-Z]{1,4})\s*0*([0-9]+)([A-Z]?)$/);
  if (codeMatch) {
    const [, prefix, number, suffix] = codeMatch;
    const padded = number.padStart(3, "0");
    pushUnique(variants, `RUA ${prefix}-${padded}${suffix}`);
    pushUnique(variants, `RUA ${prefix}${Number(number)}${suffix}`);
  }

  if (normalized.startsWith("AV ")) {
    pushUnique(variants, `AVENIDA ${normalized.slice(3)}`);
  }

  if (normalized.startsWith("R ")) {
    pushUnique(variants, `RUA ${normalized.slice(2)}`);
  }

  return variants;
}

function resolveCandidate(args: {
  city: LocalFirstValidationCity;
  bairro: string;
  rua: string;
  quadra: string;
  lote: string;
}) {
  return args.city === "GOIANIA"
    ? resolveGoianiaLocalFirstCandidate(args)
    : resolveAparecidaLocalFirstCandidate(args);
}

function scoreValidationResult(result: LocalFirstCandidateValidationResult) {
  if (result.validationStatus === "VALIDATED") return 100;
  if (result.validationStatus === "NEEDS_REVIEW") return 60;
  return 0;
}

function buildCandidate(args: {
  id: string;
  name: string;
  score: number;
  signals: string[];
  riskFlags: string[];
}): LocalFirstAliasCandidate {
  return {
    id: args.id,
    name: args.name,
    normalizedName: normalizeText(args.name),
    score: args.score,
    signals: args.signals,
    riskFlags: args.riskFlags,
  };
}

function mergeCandidate(
  candidates: LocalFirstAliasCandidate[],
  candidate: LocalFirstAliasCandidate,
  limit: number,
) {
  const existing = candidates.find(
    (item) => item.normalizedName === candidate.normalizedName,
  );

  if (existing) {
    existing.score = Math.max(existing.score, candidate.score);
    existing.signals = Array.from(new Set([...existing.signals, ...candidate.signals]));
    existing.riskFlags = Array.from(
      new Set([...existing.riskFlags, ...candidate.riskFlags]),
    );
    return existing;
  }

  if (candidates.length >= limit) return null;
  candidates.push(candidate);
  return candidate;
}

function emptyPack(
  input: LocalFirstAliasCandidatePackInput,
  skipReason: string,
  diagnostics?: { signals?: string[]; riskFlags?: string[] },
): LocalFirstAliasCandidatePack {
  return {
    city: input.city,
    source: {
      bairro: input.bairro,
      rua: input.rua,
      quadra: input.quadra,
      lote: input.lote,
    },
    eligibleForAi: false,
    skipReason,
    bairroCandidates: [],
    ruaCandidates: [],
    candidatePairs: [],
    diagnostics: {
      signals: diagnostics?.signals || [],
      riskFlags: diagnostics?.riskFlags || [],
    },
  };
}

export function buildLocalFirstAliasCandidatePack(
  input: LocalFirstAliasCandidatePackInput,
): LocalFirstAliasCandidatePack {
  const limits = {
    maxBairros: input.limits?.maxBairros ?? DEFAULT_LIMITS.maxBairros,
    maxRuas: input.limits?.maxRuas ?? DEFAULT_LIMITS.maxRuas,
    maxPairs: input.limits?.maxPairs ?? DEFAULT_LIMITS.maxPairs,
  };
  const bairro = String(input.bairro || "").trim();
  const rua = String(input.rua || "").trim();
  const quadra = String(input.quadra || "").trim();
  const lote = String(input.lote || "").trim();
  const diagnostics = {
    signals: [] as string[],
    riskFlags: [] as string[],
  };

  if (input.city !== "GOIANIA" && input.city !== "APARECIDA") {
    return emptyPack(input, "UNSUPPORTED_CITY");
  }

  if (!bairro || !rua || !quadra || !lote) {
    return emptyPack(input, "MISSING_REQUIRED_INPUT");
  }

  diagnostics.signals.push("QD_LT_PRESENT");
  if (input.failureReason) diagnostics.signals.push(`FAILURE_${normalizeText(input.failureReason)}`);

  const bairroVariants = buildBairroVariants(bairro);
  const ruaVariants = buildRuaVariants(rua);
  const bairroCandidates: LocalFirstAliasCandidate[] = [];
  const ruaCandidates: LocalFirstAliasCandidate[] = [];
  const candidatePairs: LocalFirstAliasCandidatePair[] = [];
  const seenPairs = new Set<string>();

  for (const bairroVariant of bairroVariants) {
    for (const ruaVariant of ruaVariants) {
      const result = resolveCandidate({
        city: input.city,
        bairro: bairroVariant,
        rua: ruaVariant,
        quadra,
        lote,
      });

      if (!result.found || !result.candidate) continue;
      if (result.streetMatchType === "STREET_MISMATCH") {
        diagnostics.riskFlags.push("STREET_MISMATCH");
        continue;
      }

      const score = scoreValidationResult(result);
      if (score <= 0) continue;

      const pairRiskFlags: string[] = [];
      const pairSignals = ["LOCALFIRST_CANDIDATE", "QD_LT_PRESENT"];

      if (result.streetMatchType === "STREET_MATCH") pairSignals.push("STREET_PRESENT");
      if (result.validationStatus === "NEEDS_REVIEW") pairRiskFlags.push("NEEDS_REVIEW");
      if (!result.candidateUnique) pairRiskFlags.push("MULTIPLE_QD_LT_CANDIDATES");
      if (result.streetMatchType !== "STREET_MATCH") pairRiskFlags.push("STREET_NOT_STRONG");
      if (normalizeText(bairroVariant) !== normalizeText(bairro)) {
        pairSignals.push("BAIRRO_TEXT_VARIANT");
      }
      if (normalizeText(ruaVariant) !== normalizeText(rua)) {
        pairSignals.push("RUA_TEXT_VARIANT");
      }

      const bairroCandidate = mergeCandidate(
        bairroCandidates,
        buildCandidate({
          id: `bairro_${bairroCandidates.length + 1}`,
          name: result.candidate.bairro,
          score,
          signals: pairSignals,
          riskFlags: pairRiskFlags,
        }),
        limits.maxBairros,
      );
      const ruaName = result.candidate.streetLabel || ruaVariant;
      const ruaCandidate = mergeCandidate(
        ruaCandidates,
        buildCandidate({
          id: `rua_${ruaCandidates.length + 1}`,
          name: ruaName,
          score,
          signals: pairSignals,
          riskFlags: pairRiskFlags,
        }),
        limits.maxRuas,
      );

      if (!bairroCandidate || !ruaCandidate) {
        diagnostics.riskFlags.push("CANDIDATE_LIMIT_REACHED");
        continue;
      }

      const pairKey = `${bairroCandidate.normalizedName}|||${ruaCandidate.normalizedName}`;
      if (seenPairs.has(pairKey)) continue;
      if (candidatePairs.length >= limits.maxPairs) {
        diagnostics.riskFlags.push("PAIR_LIMIT_REACHED");
        continue;
      }

      seenPairs.add(pairKey);
      candidatePairs.push({
        id: `pair_${candidatePairs.length + 1}`,
        bairroCandidateId: bairroCandidate.id,
        ruaCandidateId: ruaCandidate.id,
        bairroName: bairroCandidate.name,
        ruaName: ruaCandidate.name,
        score,
        signals: pairSignals,
        riskFlags: pairRiskFlags,
      });
    }
  }

  const sortedPairs = candidatePairs.sort((a, b) => b.score - a.score);
  const topScore = sortedPairs[0]?.score ?? 0;
  const equivalentTopPairs = sortedPairs.filter((pair) => pair.score === topScore);

  if (!candidatePairs.length) {
    return {
      ...emptyPack(input, "NO_LOCAL_CANDIDATES", diagnostics),
      bairroCandidates,
      ruaCandidates,
      candidatePairs,
    };
  }

  if (equivalentTopPairs.length > 1) {
    diagnostics.riskFlags.push("MULTIPLE_SIMILAR_PAIRS");
  }

  const hasValidatedStrongPair =
    equivalentTopPairs.length === 1 &&
    sortedPairs[0].score >= 100 &&
    !sortedPairs[0].riskFlags.length;
  const hasStreetMismatch = diagnostics.riskFlags.includes("STREET_MISMATCH");
  const hasAmbiguousTopPairs = equivalentTopPairs.length > 1;
  const hasPlausibleNeedsReviewPair = sortedPairs.some(
    (pair) =>
      pair.riskFlags.includes("NEEDS_REVIEW") &&
      pair.signals.includes("LOCALFIRST_CANDIDATE") &&
      pair.signals.includes("QD_LT_PRESENT"),
  );

  let eligibleForAi = false;
  let skipReason: string | null = "PACK_WEAK";

  if (hasValidatedStrongPair) {
    skipReason = "LOCALFIRST_ALREADY_VALIDATED";
  } else if (hasStreetMismatch) {
    skipReason = "STREET_MISMATCH";
  } else if (hasAmbiguousTopPairs) {
    skipReason = "PACK_AMBIGUOUS";
  } else if (hasPlausibleNeedsReviewPair) {
    eligibleForAi = true;
    skipReason = null;
  }

  if (!eligibleForAi) {
    diagnostics.riskFlags.push("PACK_NEEDS_REVIEW");
  }

  return {
    city: input.city,
    source: {
      bairro,
      rua,
      quadra,
      lote,
    },
    eligibleForAi,
    skipReason,
    bairroCandidates,
    ruaCandidates,
    candidatePairs: sortedPairs,
    diagnostics,
  };
}
