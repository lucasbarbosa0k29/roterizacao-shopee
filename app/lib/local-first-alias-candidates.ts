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

const GOIANIA_JARDINS_CERRADO_NUMBERS = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);

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

function normalizeStreetComparable(value: string | null | undefined) {
  return normalizeText(value).replace(/^(R|RUA|AV|AVENIDA)\s+/, "");
}

function pushUnique(values: string[], value: string) {
  const normalized = normalizeText(value);
  if (!normalized || values.some((existing) => normalizeText(existing) === normalized)) {
    return;
  }
  values.push(value.trim());
}

function normalizeCerradoNumber(value: string) {
  if (!/^\d+$/.test(value)) return value;
  return String(Number(value));
}

function splitLettersAndNumbers(value: string) {
  return normalizeText(value).replace(/([A-Z])([0-9])/g, "$1 $2");
}

function isGenericCerradoBairro(bairro: string) {
  const normalized = splitLettersAndNumbers(bairro);
  return /^CERRADO\s+\d+$/.test(normalized);
}

function isWeakStreetInput(rua: string) {
  const normalized = normalizeText(rua);
  return normalized === "R" || normalized === "RUA";
}

function loteLooksLikeBuildingToken(lote: string) {
  const normalized = normalizeText(lote).replace(/\s+/g, "");
  if (!normalized) return false;
  if (/AP|APT|APTO|BL|BLC|BLOCO|COND|CASA|CS|SOB|LOTE/.test(normalized)) return true;
  return /^\d+[A-Z]{2,}/.test(normalized) || /^[A-Z]\d+[A-Z]{2,}/.test(normalized);
}

function buildGoianiaJardinsCerradoBairroVariants(bairro: string) {
  const variants: string[] = [];
  const normalized = splitLettersAndNumbers(bairro)
    .replace(/\bJD\b/g, "JARDIM")
    .replace(/\bRESID\b/g, "RESIDENCIAL")
    .replace(/\bRES\b/g, "RESIDENCIAL")
    .replace(/\bJARDIM\b/g, "JARDINS")
    .replace(/\bCERRADO\s*0+(\d+)\b/g, "CERRADO $1")
    .trim();

  if (!/\bCERRADO\b/.test(normalized)) return variants;

  const match = normalized.match(/\bCERRADO\s+(\d+)\b/);
  if (!match) return variants;

  const number = normalizeCerradoNumber(match[1]);
  if (!GOIANIA_JARDINS_CERRADO_NUMBERS.has(number)) return variants;

  const hasJardinsSignal =
    /\bJARDINS?\b/.test(normalized) ||
    /\bRESIDENCIAL\b/.test(normalized) ||
    /^CERRADO\s+\d+$/.test(normalized);

  if (!hasJardinsSignal) return variants;

  pushUnique(variants, `Jardins do Cerrado ${number}`);
  return variants;
}

function buildBairroVariants(bairro: string, city: LocalFirstValidationCity) {
  const variants: string[] = [];
  const normalized = normalizeText(bairro);
  pushUnique(variants, bairro);

  for (const prefix of BAIRRO_PREFIXES) {
    if (!normalized.startsWith(`${prefix} `)) continue;
    pushUnique(variants, normalized.slice(prefix.length + 1));
  }

  if (city === "GOIANIA") {
    for (const variant of buildGoianiaJardinsCerradoBairroVariants(bairro)) {
      pushUnique(variants, variant);
    }
  }

  return variants;
}

function buildGoianiaJcStreetVariants(rua: string) {
  const variants: string[] = [];
  const normalized = normalizeText(rua);
  const match = normalized.match(/^(?:(RUA|R)\s*)?JC\s*0*([0-9]{3})([A-Z]?)$/);
  if (!match) return variants;

  const [, streetType, number, suffix] = match;
  const code = `JC-${number}${suffix || ""}`;
  if (streetType === "R") {
    pushUnique(variants, `R ${code}`);
  } else {
    pushUnique(variants, `Rua ${code}`);
  }
  pushUnique(variants, `R ${code}`);
  pushUnique(variants, `Rua ${code}`);
  return variants;
}

function isJcStreetVariant(value: string) {
  return /\bJC\s*-?\s*[0-9]{3}[A-Z]?\b/i.test(value);
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

  for (const variant of buildGoianiaJcStreetVariants(rua)) {
    pushUnique(variants, variant);
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

  if (isWeakStreetInput(rua)) {
    return emptyPack(input, "PACK_WEAK", {
      riskFlags: ["PARSER_STREET_WEAK"],
    });
  }

  if (loteLooksLikeBuildingToken(lote)) {
    return emptyPack(input, "PACK_WEAK", {
      riskFlags: ["LOTE_HAS_BUILDING_TOKEN"],
    });
  }

  diagnostics.signals.push("QD_LT_PRESENT");
  if (input.failureReason) diagnostics.signals.push(`FAILURE_${normalizeText(input.failureReason)}`);

  const bairroVariants = buildBairroVariants(bairro, input.city);
  const ruaVariants = buildRuaVariants(rua);
  const sourceIsGenericCerradoBairro = input.city === "GOIANIA" && isGenericCerradoBairro(bairro);

  if (sourceIsGenericCerradoBairro) {
    diagnostics.riskFlags.push("GENERIC_CERRADO_BAIRRO");
  }
  if (bairroVariants.some((variant) => normalizeText(variant).startsWith("JARDINS DO CERRADO "))) {
    diagnostics.signals.push("GOIANIA_JARDINS_CERRADO_VARIANT");
  }
  if (ruaVariants.some(isJcStreetVariant)) {
    diagnostics.signals.push("JC_STREET_HYPHEN_VARIANT");
    diagnostics.signals.push("JC_STREET_CODE_NORMALIZED");
  }

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
      if (
        result.candidate?.streetLabel &&
        normalizeStreetComparable(result.candidate.streetLabel) !==
          normalizeStreetComparable(ruaVariant)
      ) {
        pairRiskFlags.push("LOCAL_STREET_DIFFERS_FROM_INPUT");
      }
      if (sourceIsGenericCerradoBairro) {
        pairRiskFlags.push("GENERIC_CERRADO_BAIRRO");
        pairRiskFlags.push("CERRADO_VARIANT_WEAK");
      }
      if (normalizeText(bairroVariant) !== normalizeText(bairro)) {
        pairSignals.push("BAIRRO_TEXT_VARIANT");
        if (normalizeText(bairroVariant).startsWith("JARDINS DO CERRADO ")) {
          pairSignals.push("GOIANIA_JARDINS_CERRADO_VARIANT");
          pairSignals.push("CERRADO_CANONICAL_BAIRRO");
        }
        if (/\b0+[0-9]\b/.test(normalizeText(bairro)) || /[A-Z][0-9]/.test(normalizeText(bairro))) {
          pairSignals.push("BAIRRO_NUMBER_NORMALIZED");
        }
        if (BAIRRO_PREFIXES.some((prefix) => normalizeText(bairro).startsWith(`${prefix} `))) {
          pairSignals.push("BAIRRO_PREFIX_REMOVED");
        }
      }
      if (normalizeText(ruaVariant) !== normalizeText(rua)) {
        pairSignals.push("RUA_TEXT_VARIANT");
        if (isJcStreetVariant(ruaVariant)) {
          pairSignals.push("JC_STREET_HYPHEN_VARIANT");
          pairSignals.push("JC_STREET_CODE_NORMALIZED");
        }
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
    const cerradoTopBairros = new Set(
      equivalentTopPairs
        .map((pair) => normalizeText(pair.bairroName))
        .filter((name) => name.startsWith("JARDINS DO CERRADO ")),
    );
    if (cerradoTopBairros.size > 1) {
      diagnostics.riskFlags.push("MULTIPLE_CERRADO_PARTITIONS");
    }
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
