// app/api/process/route.ts
import { NextResponse } from "next/server";
import {
  getDiscoverBudgetDecision,
  reserveDiscoverUsage,
  shouldAttemptDiscoverFromQuality,
} from "@/app/lib/here-discover-budget";
import {
  auditApproximateMemoryOperationalRisk,
  buildApproximateMemoryShadowHint,
  type ApproxOperationalRisk,
  tryApproximateMemoryMatch,
  tryApproximateMemoryTextHint,
  type ApproxMemorySearchHint,
  type ApproxMemoryStrength,
} from "@/app/lib/address-memory-approx";
import {
  applyUrbanPatternToRealQueries,
  buildUrbanPatternQueries,
  normalizeUrbanStreet,
  type UrbanPatternType,
} from "@/app/lib/urban-normalization";
import {
  computeGeocodeConfidence,
  type GeocodeConfidenceLevel,
} from "@/app/lib/geocode-confidence";
import {
  incrementDailyMetric,
  METRIC_MEMORY_BATCH_SAVE_ERROR,
  METRIC_MEMORY_BATCH_SAVE_OK,
  METRIC_MEMORY_HIT_TOTAL,
  METRIC_MEMORY_LOOKUP_TOTAL,
} from "@/app/lib/admin-observability";
import { saveJobResult } from "@/app/lib/job-storage";
import { prisma } from "@/app/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { AccessControlError, consumeRouteAllowance } from "@/app/lib/access-control";
import { Prisma } from "@prisma/client";
import {
  areAparecidaBairrosCompatible,
  findAparecidaLocalLotCandidate,
  findAparecidaLocalStreetCandidate,
} from "@/app/lib/aparecida-local-lots";
import { buildCondoMemoryKeyPlan, type CondoMemoryKeyKind } from "@/app/lib/condo-memory-keys";
import {
  buildGoogleCommercialFallbackPlan,
  lookupGoogleCommercialFallbackCandidate,
} from "@/app/lib/google-commercial-fallback";
import {
  lookupGoianiaLocalFirstShadow,
  type GoianiaLocalFirstShadow,
} from "@/app/lib/goiania-local-first";


export const runtime = "nodejs";
const PROGRESS_BATCH_SIZE = 25;
const MAX_ROUTE_STOPS = 200;
const GOOGLE_COMMERCIAL_FALLBACK_ENABLED = ["1", "true", "yes"].includes(
  String(process.env.GOOGLE_COMMERCIAL_FALLBACK_ENABLED || "").trim().toLowerCase(),
);
const GOOGLE_COMMERCIAL_FALLBACK_MAX_PER_JOB = 5;

type GoogleCommercialFallbackRunState = {
  jobId: string;
  googleCommercialFallbackCalls: number;
};

type Normalized = {
  rua: string;
  numero: string;
  quadra: string;
  lote: string;
  bairro: string; // setor
  cidade: string;
  estado: string;
  cep?: string;
  observacao: string;
};

type InputRow = {
  sequence?: any;
  original: string; // <-- TEM QUE SER O "Destination Address" cru
  bairro?: string;
  city?: string;
  cep?: string;
};

type AparecidaShadowDebug = {
  flags: string[];
  expectedRua: string;
  actualRua: string;
  actualRuaSource: "input" | "candidate" | "arcgis" | "unknown";
  expectedBairro: string;
  actualBairro: string;
  expectedQuadra: string;
  actualQuadra: string;
  expectedLote: string;
  actualLote: string;
  source: string | null;
  localCandidate?: {
    quadra: string;
    lote: string;
    bairro: string;
    hasRua: boolean;
    localAliasAccepted: boolean;
    bairroDivergenteLocalForte: boolean;
  } | null;
};

type AparecidaLocalStreetShadowStatus =
  | "STREET_MATCH"
  | "STREET_MISMATCH"
  | "STREET_MISSING"
  | "STREET_UNSAFE_NEAR_DIST"
  | "STREET_NOT_CHECKED";

type AparecidaLocalStreetShadow = {
  expectedRua: string;
  localStreetFullName: string;
  nearDist: number | null;
  streetStatus: AparecidaLocalStreetShadowStatus;
  streetMatch: boolean | null;
};

type AparecidaBlockedLocalFirstPair = {
  expectedBairro: string;
  localBairro: string;
  quadra: string;
  lote: string;
  motivo: string;
  blockedPairKey: string;
};

type MemoryDebugRow = {
  memoryKey: string;
  memoryBaseKey: string | null;
  memoryHit: boolean;
  memoryHitKind: "exact" | "base" | CondoMemoryKeyKind | null;
  matchedKey: string | null;
  hereSkippedBecauseMemory: boolean;
  decisionReason: string;
  usedApproxMemory?: boolean;
  geocodeConfidence?: number;
  geocodeConfidenceLevel?: GeocodeConfidenceLevel;
  geocodeConfidenceHardMismatch?: boolean;
  geocodeConfidenceFlags?: string[];
  aparecidaShadowFlags?: string[];
  aparecidaShadowDebug?: AparecidaShadowDebug | null;
  aparecidaLocalStreetShadow?: AparecidaLocalStreetShadow | null;
  aparecidaBlockedLocalFirstPair?: AparecidaBlockedLocalFirstPair | null;
  approxMemoryStrength?: ApproxMemoryStrength | null;
  approxMemoryScore?: number | null;
  approxMemoryReasons?: string[];
  approxMemoryUsedAsFinal?: boolean;
  approxMemoryUsedAsHint?: boolean;
  approxOperationalRisk?: ApproxOperationalRisk | null;
  approxOperationalRiskReasons?: string[];
  approxOperationalWouldStillSkipHere?: boolean;
  approxOperationalSafeForAutoSave?: boolean;
  approxOperationalRecommendedAction?: string | null;
  approxHintApplied?: boolean;
  approxHintReason?: string | null;
  approxHintFieldsUsed?: string[];
  approxHintSource?: "TEXT_HINT" | "SHADOW_MEDIUM" | null;
  approxHintBecameBestGeocodeQuery?: boolean;
  autoSaveWouldAllow?: boolean;
  autoSaveWouldBlockReason?: string | null;
  autoSaveWouldBlockReasons?: string[];
  autoSaveCurrentBehaviorWouldSave?: boolean;
  autoSaveHardeningApplied?: boolean;
  autoSaveHardeningBlockedReason?: string | null;
  autoSaveDisabled?: boolean;
  autoSaveDisabledReason?: string | null;
  manualMemoryProtected?: boolean;
  manualMemoryProtectionReason?: string | null;
  localLotCandidateFound?: boolean;
  localLotStrongMatch?: boolean;
  localLotQuadra?: string | null;
  localLotLote?: string | null;
  localLotBairro?: string | null;
  localLotBoostApplied?: boolean;
  localLotUsedAsFinal?: boolean;
  localLotBlockedByBairro?: boolean;
  localFirstGoianiaAttempted?: boolean;
  localFirstGoianiaFound?: boolean;
  localFirstGoianiaMatchType?: GoianiaLocalFirstShadow["matchType"];
  localFirstGoianiaConfidence?: "HIGH" | "MEDIUM" | null;
  localFirstGoianiaDistanceM?: number | null;
  localFirstGoianiaCandidatesCount?: number;
  localFirstGoianiaReason?: string;
  localFirstGoianiaKey?: string | null;
  localFirstGoianiaCandidateEligible?: boolean;
  localFirstGoianiaCandidateScore?: number | null;
  localFirstGoianiaWouldBeatFinal?: boolean;
  localFirstGoianiaDistanceToFinalM?: number | null;
  localFirstGoianiaCandidateLat?: number | null;
  localFirstGoianiaCandidateLng?: number | null;
  localFirstGoianiaCandidateStreet?: string | null;
  localFirstGoianiaWouldBypass?: boolean;
  localFirstGoianiaBypassReason?: string | null;
  localFirstGoianiaUsedAsFinal?: boolean;
  googleCommercialFallbackAttempted?: boolean;
  googleCommercialFallbackFound?: boolean;
  googleCommercialFallbackRejectedReason?: string | null;
  googleCommercialFallbackQuery?: string | null;
  googleCommercialFallbackCommercialName?: string | null;
  googleCommercialFallbackScore?: number | null;
  googleCommercialFallbackSimilarity?: number | null;
  googleCommercialFallbackDistanceM?: number | null;
  googleCommercialFallbackLat?: number | null;
  googleCommercialFallbackLng?: number | null;
  googleCommercialFallbackTitle?: string | null;
  googleCommercialFallbackApplied?: boolean;
  urbanPatternDetected?: boolean;
  urbanPatternType?: string | null;
  urbanPatternQuery?: string | null;
  urbanPatternImprovedRanking?: boolean;
  urbanPatternBestCandidateKind?: string | null;
  urbanPatternSpreadReduction?: number | null;
  urbanPatternWouldReplaceWeakQuery?: boolean;
  urbanPatternAppliedToRealQueries?: boolean;
  urbanPatternAppliedReason?: string | null;
  urbanPatternReplacedQuery?: string | null;
  urbanPatternRealQueryIndex?: number | null;
  urbanPatternBecameBestGeocodeQuery?: boolean;
};

type RankedHereEntry = {
  it: any;
  score: number;
  from: string;
  kind: "geocode" | "discover";
};

type RankedHereEntryWithArcgis = RankedHereEntry & {
  arc?: any;
  arcScore?: number;
  total?: number;
};

type DiscoverGateDebugRow = {
  preliminaryGeocodeConfidence: number | null;
  preliminaryGeocodeHardMismatch: boolean;
  preliminaryGeocodeFlags: string[];
  discoverQualityAllowed: boolean;
  discoverQualityReason: string;
  acceptedEarly: boolean;
  shouldBypassAcceptedEarly: boolean;
  acceptedEarlyBypassReason: string | null;
  budgetAllowed: boolean | null;
  budgetReason: string | null;
  discoverAttempted: boolean;
  discoverReserved: boolean;
  discoverSeenInTop5: boolean;
  discoverWonFinalRanking: boolean;
};

function onlyDigits(s: string) {
  return (s || "").replace(/\D+/g, "");
}

function normalizeCep(s: string) {
  const d = onlyDigits(s);
  if (d.length === 8) return d;
  return (s || "").trim();
}

function cleanAddressForHere(s: string) {
  let t = String(s || "").trim();
  t = t.replace(/\bQD\.?\s*/gi, "Quadra ");
  t = t.replace(/\bLT\.?\s*/gi, "Lote ");
  t = t.replace(/\s+,/g, ",").replace(/,+/g, ",").replace(/\s{2,}/g, " ").trim();
  return t;
}

function separateCompactQuadraLoteTokens(value: string) {
  return String(value || "")
    .replace(/(\d)(QUADRA|QUAD|QDR|QD|Q)(?=\d)/gi, "$1 $2")
    .replace(/(\d)(LT|LOTE|L)(?=\d)/gi, "$1 $2");
}

function stripQuadraLoteFromStreet(q: string) {
  let t = separateCompactQuadraLoteTokens(q);
  t = t.replace(/\b(?:QDR|QUAD)\.?\s*[-:]?\s*\d+[A-Z]?\b/gi, " ");
  t = t.replace(/\bQ\.?\s*[-:]?\s*\d+[A-Z]?\b/gi, " ");
  t = t.replace(/\bL\.?\s*[-:]?\s*\d+[A-Z]?\b/gi, " ");
  t = t.replace(
    /\b(QUADRA|QD|Q\.)\s*[-:]?\s*[A-Z0-9\-]+(?:\s+(?:LOTE|LOT|LT|L(?![A-Z]))\.?\s*[-:]?\s*[A-Z0-9\-]+(?:\s+[A-Z])?)?/gi,
    " ",
  );
  t = t.replace(/\b(LOTE|LOT|LT|L(?![A-Z]))\.?\s*[-:]?\s*[A-Z0-9\-]+(?:\s+[A-Z])?\b/gi, " ");
  t = t.replace(/\s+,/g, ",").replace(/,+/g, ",").replace(/\s{2,}/g, " ").trim();
  return t;
}

function normalizeKey(text: string) {
  return String(text || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractConservativeHereHouseNumber(bestRankedAddress: any, bestItem: any) {
  const structuredCandidates = [
    bestRankedAddress?.houseNumber,
    bestRankedAddress?.address?.houseNumber,
    bestRankedAddress?.address?.house_number,
    bestRankedAddress?.address?.number,
  ]
    .map((value) => normalizeKey(String(value || "")))
    .filter((value) => /^[0-9]+[A-Z]?$/.test(value));

  if (structuredCandidates[0]) {
    return { number: structuredCandidates[0], confirmed: true, source: "structured" as const };
  }

  const label = normalizeKey(
    String(bestRankedAddress?.label || bestItem?.title || bestItem?.address?.label || ""),
  );
  if (!label) return { number: "", confirmed: false, source: null };

  if (/\b(APTO|APT|APARTAMENTO|APART|BLOCO|TORRE|SALA)\b/.test(label)) {
    return { number: "", confirmed: false, source: null };
  }

  const simpleMatch = label.match(
    /^(RUA|AVENIDA|AV|ALAMEDA)\s+[^,]+,\s*([0-9]+[A-Z]?)\b(?:\s*,.*)?$/,
  );
  if (simpleMatch?.[2]) {
    return {
      number: normalizeKey(simpleMatch[2]),
      confirmed: true,
      source: "label_simple" as const,
    };
  }

  return { number: "", confirmed: false, source: null };
}

type MemoryKeyCandidate = {
  key: string;
  kind: "exact" | "base" | CondoMemoryKeyKind;
};

function buildMemoryKeyCandidates(args: {
  addressRaw: string;
  cityForKey: string;
}) {
  const exactKey = normalizeKey(`${args.addressRaw} ${args.cityForKey}`);
  const baseAddressRaw = makeBaseAddress(args.addressRaw);
  const memoryBaseKey =
    baseAddressRaw && normalizeKey(baseAddressRaw) !== normalizeKey(args.addressRaw)
      ? normalizeKey(`${baseAddressRaw} ${args.cityForKey}`)
      : null;
  const condoPlan = buildCondoMemoryKeyPlan(args.addressRaw, args.cityForKey);

  const candidates: MemoryKeyCandidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: MemoryKeyCandidate) => {
    if (!candidate.key || seen.has(candidate.key)) return;
    seen.add(candidate.key);
    candidates.push(candidate);
  };

  push({ key: exactKey, kind: "exact" });
  for (const alias of condoPlan.keys) {
    push({ key: alias.key, kind: alias.kind });
  }
  if (memoryBaseKey) {
    push({ key: memoryBaseKey, kind: "base" });
  }

  return {
    exactKey,
    baseAddressRaw,
    memoryBaseKey,
    condoPlan,
    candidates,
  };
}
// REMOVE QUADRA/LOTE DA QUERY (pra não atrapalhar o HERE)
const APARECIDA_BLOCKED_LOCAL_FIRST_PAIRS = new Set([
  "JARDIM HELVECIA->JARDIM LUZ",
  "JARDIM HELVECIA->VEIGA JARDIM",
  "JARDIM CRISTAL->JARDIM LUZ",
  "JARDIM IPANEMA->JARDIM LUZ",
  "JARDIM RIO GRANDE->JARDIM LUZ",
  "SETOR SANTO ANDRE->INDUSTRIAL SANTO ANTONIO",
  "SETOR SANTO ANDRE->SANTO ANTONIO",
  "SETOR SANTO ANDRE->SANTO ANTONIO CONJUNTO HABITACIONAL PROGRESSO",
  "SETOR SANTO ANDRE->SANTO ANTONIO CONJUNTO PROGRESSO",
  "SETOR SANTO ANDRE->CONJUNTO HABITACIONAL PROGRESSO",
]);

function normalizeAparecidaBlockedLocalFirstBairroKey(value: string) {
  return normalizeKey(value)
    .replace(/\bANT NIO\b/g, "ANTONIO")
    .replace(/\bCONJ\b/g, "CONJUNTO")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAparecidaBlockedLocalFirstPair(args: {
  isAparecida: boolean;
  localLotCandidateFound: boolean;
  localLotLocalAliasAccepted: boolean;
  expectedBairro: string;
  localBairro: string;
  quadra: string;
  lote: string;
}): AparecidaBlockedLocalFirstPair | null {
  if (!args.isAparecida || !args.localLotCandidateFound || args.localLotLocalAliasAccepted) {
    return null;
  }

  const expectedBairroKey = normalizeAparecidaBlockedLocalFirstBairroKey(args.expectedBairro);
  const localBairroKey = normalizeAparecidaBlockedLocalFirstBairroKey(args.localBairro);
  const blockedPairKey = `${expectedBairroKey}->${localBairroKey}`;

  if (!APARECIDA_BLOCKED_LOCAL_FIRST_PAIRS.has(blockedPairKey)) {
    return null;
  }

  return {
    expectedBairro: args.expectedBairro,
    localBairro: args.localBairro,
    quadra: args.quadra,
    lote: args.lote,
    motivo: "APARECIDA_BLOCKED_LOCAL_FIRST_PAIR",
    blockedPairKey,
  };
}

function normalizeAparecidaLocalStreetKey(value: string) {
  let t = normalizeKey(value)
    .replace(/\bRUA\b/g, "R")
    .replace(/\bR\b/g, "R")
    .replace(/\bAVENIDA\b/g, "AV")
    .replace(/\bAV\b/g, "AV")
    .replace(/\bALAMEDA\b/g, "AL")
    .replace(/\bAL\b/g, "AL")
    .replace(/\bTRAVESSA\b/g, "TV")
    .replace(/\bTV\b/g, "TV")
    .replace(/\bPRACA\b/g, "PRC")
    .replace(/\bPCA\b/g, "PRC")
    .replace(/\bPC\b/g, "PRC")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  t = t.replace(/\b(\d+)\s+([A-Z])\b/g, "$1 $2");
  return t;
}

function stripAparecidaStreetType(value: string) {
  return value.replace(/^(?:R|AV|AL|TV|PRC)\s+/, "").trim();
}

function isShortAparecidaStreetKey(value: string) {
  const key = stripAparecidaStreetType(value);
  return key.length < 4 || /^[A-Z]$/.test(key);
}

function isCodeLikeAparecidaStreetKey(value: string) {
  return /^(?:R|AV|AL|TV|PRC)?\s*\d+\s*[A-Z]?$/.test(value.trim());
}

function compareAparecidaLocalStreet(expected: string, actual: string) {
  const left = normalizeAparecidaLocalStreetKey(expected);
  const right = normalizeAparecidaLocalStreetKey(actual);
  if (!left || !right || isShortAparecidaStreetKey(left) || isShortAparecidaStreetKey(right)) {
    return null;
  }

  if (left === right) return true;

  const leftWithoutType = stripAparecidaStreetType(left);
  const rightWithoutType = stripAparecidaStreetType(right);
  const leftCode = isCodeLikeAparecidaStreetKey(left);
  const rightCode = isCodeLikeAparecidaStreetKey(right);
  if (!leftCode && !rightCode && leftWithoutType.length >= 8 && leftWithoutType === rightWithoutType) {
    return true;
  }

  return false;
}

function buildAparecidaLocalStreetShadow(args: {
  debugMemory: boolean;
  isAparecida: boolean;
  finalRankedKind: string | null;
  expectedRua: string;
  bairro: string;
  quadra: string;
  lote: string;
}): AparecidaLocalStreetShadow | null {
  if (!args.debugMemory || !args.isAparecida || args.finalRankedKind !== "local") {
    return null;
  }

  const hasLocalCandidateKey =
    !!String(args.bairro || "").trim() &&
    !!String(args.quadra || "").trim() &&
    !!String(args.lote || "").trim();
  const record = hasLocalCandidateKey
    ? findAparecidaLocalStreetCandidate({
        bairro: args.bairro,
        quadra: args.quadra,
        lote: args.lote,
      })
    : null;

  if (!record) {
    return {
      expectedRua: args.expectedRua,
      localStreetFullName: "",
      nearDist: null,
      streetStatus: "STREET_NOT_CHECKED",
      streetMatch: null,
    };
  }

  const localStreetFullName = String(record.streetFullName || "").trim();
  const nearDist = Number.isFinite(record.nearDist) ? Number(record.nearDist) : null;

  if (!localStreetFullName) {
    return {
      expectedRua: args.expectedRua,
      localStreetFullName,
      nearDist,
      streetStatus: "STREET_MISSING",
      streetMatch: null,
    };
  }

  if (nearDist == null || nearDist > 20) {
    return {
      expectedRua: args.expectedRua,
      localStreetFullName,
      nearDist,
      streetStatus: "STREET_UNSAFE_NEAR_DIST",
      streetMatch: null,
    };
  }

  const streetMatch = compareAparecidaLocalStreet(args.expectedRua, localStreetFullName);
  if (streetMatch == null) {
    return {
      expectedRua: args.expectedRua,
      localStreetFullName,
      nearDist,
      streetStatus: "STREET_NOT_CHECKED",
      streetMatch: null,
    };
  }

  return {
    expectedRua: args.expectedRua,
    localStreetFullName,
    nearDist,
    streetStatus: streetMatch ? "STREET_MATCH" : "STREET_MISMATCH",
    streetMatch,
  };
}

function normalizedIncludesEither(expected: string, actual: string) {
  const left = normalizeKey(expected);
  const right = normalizeKey(actual);
  return !!left && !!right && (left.includes(right) || right.includes(left));
}

function buildAparecidaContextShadow(args: {
  isAparecida: boolean;
  expectedRua: string;
  actualRua: string;
  actualRuaSource: "input" | "candidate" | "arcgis" | "unknown";
  expectedBairro: string;
  actualBairro: string;
  expectedQuadra: string;
  actualQuadra: string;
  expectedLote: string;
  actualLote: string;
  source: string | null;
  localCandidate?: AparecidaShadowDebug["localCandidate"];
}): AparecidaShadowDebug | null {
  if (!args.isAparecida) return null;

  const flags: string[] = [];
  const expectedQuadra = String(args.expectedQuadra || "").trim();
  const actualQuadra = String(args.actualQuadra || "").trim();
  const expectedLote = String(args.expectedLote || "").trim();
  const actualLote = String(args.actualLote || "").trim();

  const bairroMismatch =
    !!String(args.expectedBairro || "").trim() &&
    !!String(args.actualBairro || "").trim() &&
    !normalizedIncludesEither(args.expectedBairro, args.actualBairro);

  const ruaVerified = args.actualRuaSource === "candidate" || args.actualRuaSource === "arcgis";
  const ruaMismatch =
    ruaVerified &&
    !!String(args.expectedRua || "").trim() &&
    !!String(args.actualRua || "").trim() &&
    !normalizedIncludesEither(args.expectedRua, args.actualRua);

  const qlMatch =
    !!expectedQuadra &&
    !!actualQuadra &&
    !!expectedLote &&
    !!actualLote &&
    sameText(expectedQuadra, actualQuadra) &&
    sameText(expectedLote, actualLote);
  const localRuaNotVerified = args.source === "local" && !ruaVerified;

  if (bairroMismatch) flags.push("APARECIDA_BAIRRO_MISMATCH_SHADOW");
  if (ruaMismatch) flags.push("APARECIDA_RUA_MISMATCH_SHADOW");
  if (qlMatch && (bairroMismatch || ruaMismatch)) {
    flags.push("APARECIDA_QL_MATCH_BUT_CONTEXT_MISMATCH_SHADOW");
  }
  if (localRuaNotVerified) flags.push("APARECIDA_LOCAL_RUA_NOT_VERIFIED_SHADOW");
  if (qlMatch && localRuaNotVerified) flags.push("APARECIDA_LOCAL_QL_ONLY_MATCH_SHADOW");
  if (qlMatch && bairroMismatch && localRuaNotVerified) {
    flags.push("APARECIDA_LOCAL_BAIRRO_MISMATCH_WITH_UNVERIFIED_RUA_SHADOW");
  }

  if (!flags.length) return null;

  return {
    flags,
    expectedRua: args.expectedRua,
    actualRua: args.actualRua,
    actualRuaSource: args.actualRuaSource,
    expectedBairro: args.expectedBairro,
    actualBairro: args.actualBairro,
    expectedQuadra,
    actualQuadra,
    expectedLote,
    actualLote,
    source: args.source,
    localCandidate: args.localCandidate || null,
  };
}

function isWeakStreetForMemoryHint(value: string) {
  const rua = normalizeKey(value);

  return (
    !rua ||
    rua.length < 8 ||
    /^(RUA|R|AVENIDA|AV|ALAMEDA|TRAVESSA|TV|VIELA|VIA)\s+\d+(?:\s+[A-Z])?$/i.test(rua)
  );
}
function stripQuadraLoteFromQuery(q: string) {
  let t = separateCompactQuadraLoteTokens(q);
  t = t.replace(/\b(?:QDR|QUAD)\.?\s*[-:]?\s*\d+[A-Z]?\b/gi, " ");
  t = t.replace(
    /\b(QUADRA|QD|Q(?![A-Z]))\.?\s*[-:]?\s*[A-Z0-9\-]+(?:\s+(?:LOTE|LOT|LT|L(?![A-Z]))\.?\s*[-:]?\s*[A-Z0-9\-]+(?:\s+[A-Z])?)?/gi,
    " ",
  );
  t = t.replace(/\b(LOTE|LOT|LT|L(?![A-Z]))\.?\s*[-:]?\s*[A-Z0-9\-]+(?:\s+[A-Z])?\b/gi, " ");
  t = t.replace(/\s+,/g, ",").replace(/,+/g, ",").replace(/\s{2,}/g, " ").trim();
  return t;
}

// ======= detectar "apartamento" (pra NÃO buscar) =======
function hasQuadraLoteText(s: string) {
  const up = String(s || "").toUpperCase();
  return /\b(QD|QUADRA|Q\.)\b/.test(up) || /\b(LT|LOTE|L\.)\b/.test(up);
}

function makeBaseAddress(address: string) {
  return String(address || "")
    .replace(/\b(APTO|APT|APART|APARTAMENTO)\b\s*[-:]?\s*[\w\/\-.]+/gi, " ")
    .replace(/\b(BLOCO|BL)\b\s*[-:]?\s*[\w\/\-.]+/gi, " ")
    .replace(/\b(TORRE)\b\s*[-:]?\s*[\w\/\-.]+/gi, " ")
    .replace(/\b(SALA)\b\s*[-:]?\s*[\w\/\-.]+/gi, " ")
    .replace(/\b(ED|EDIF|EDIFICIO|PREDIO)\b\s*[-:]?\s*[^,]+/gi, " ")
    .replace(/\b(EDIFICIO|EDIF[IÍ]CIO|EDIF\.?)\b\s*[-:]?\s*[^,]+/gi, " ")
    .replace(/\b(CONDOMINIO|CONDOM[IÍ]NIO|COND\.?)\b\s*[-:]?\s*[^,]+/gi, " ")
    .replace(/\b(RESIDENCIAL|RES\.)\b\s*[-:]?\s*[^,]+/gi, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isApartmentLike(s: string) {
  const up = normalizeKey(String(s || ""));
  return /\b(APT|APTO|APART|APARTAMENTO|AP|BLOCO|TORRE|ED|EDIF|PREDIO|CONDOMINIO|RESIDENCIAL|ANDAR|SALA)\b/.test(
    up,
  );
}

// Fallback regex (quando Gemini falha)
function extractByRegex(raw: string) {
  const up = String(raw || "").toUpperCase();

  let rua = "";
  const ruaMatch = up.match(
    /\b(RUA|AVENIDA|AV\.|AV|ALAMEDA|TRAVESSA|TV\.|TV|VIELA|VIA|R\.|R)\s+([A-Z0-9\-\s\.]+?)(?=\s*(?:,|$|\b(?:QDR\.?\s*\d|QUAD\.?\s*\d|QD|QUADRA|Q\.|LT|LOTE|L\.)\b))/,
  );
  if (ruaMatch) {
    rua = `${ruaMatch[1]} ${ruaMatch[2]}`.replace(/\s{2,}/g, " ").trim();
    rua = rua
      .replace(/^AVENIDA\b/, "Avenida")
      .replace(/^AV\.?\b/, "Av.")
      .replace(/^AV\b/, "Av.")
      .replace(/^RUA\b/, "Rua")
      .replace(/^R\.?\b/, "R")
      .replace(/^ALAMEDA\b/, "Alameda")
      .replace(/^TRAVESSA\b/, "Travessa")
      .replace(/^TV\.?\b/, "Tv.")
      .replace(/^VIELA\b/, "Viela")
      .replace(/^VIA\b/, "Via");
  }

  let quadra = "";
  const qd = up.match(
    new RegExp(
      String.raw`\b(QDR|QD|QUADRA|QUAD|Q\.)\.?\s*(${QUADRA_LOTE_TOKEN})(?:\s+([A-Z]))?(?=\s*(?:,|\.|$))`,
    ),
  );
  if (qd) quadra = String(qd[2] || "").trim();

  let lote = "";
  const lt = up.match(
    new RegExp(
      String.raw`\b(LT|LOTE|LOT|L\.)\s*(${QUADRA_LOTE_TOKEN})(?:\s+([A-Z]))?(?=\s*(?:,|\.|$))`,
    ),
  );
  if (lt) {
    const base = String(lt[2] || "").trim();
    const suffix = String(lt[3] || "").trim();
    lote = `${base}${suffix}`.trim();
  }

  return { rua, quadra, lote };
}
// ✅ Regex SMART: pega Q/L em vários formatos (Q40 L27, QD40LT27, QUADRA 40 LOTE 27, etc)
function normalizeQLValue(v: string, suffix = "") {
  let t = String(v || "")
    .toUpperCase()
    .trim()
    .replace(/^[\s\-:]+|[\s\-:]+$/g, "")
    .replace(/[^A-Z0-9\-]/g, "");

  const extra = String(suffix || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");

  if (/^[A-Z]/.test(t)) {
    const compact = t.replace(/-/g, "");
    if (/^[A-Z]$/.test(compact)) return compact;
    const m = compact.match(/^([A-Z])(\d+[A-Z0-9]*)?$/);
    if (m) return `${m[1]}${m[2] || extra}`;
    return compact;
  }

  if (/^\d/.test(t)) {
    const compact = t.replace(/-/g, "");
    const m = compact.match(/^0*(\d+)([A-Z][A-Z0-9]*)?$/);
    if (m) return `${String(Number(m[1]))}${m[2] || extra}`;
    if (/^\d+$/.test(compact)) return String(Number(compact));
    return compact;
  }

  const m = t.match(/^0*(\d+)([A-Z][A-Z0-9\-]*)?$/);
  if (m) return `${String(Number(m[1]))}${m[2] || extra}`;

  if (/^\d+$/.test(t)) return String(Number(t));
  return "";
}

const QUADRA_LOTE_VALUE_END =
  String.raw`(?=\s*(?:,|\.|$|\b(?:LOTE|LOT|LT|L(?![A-Z]))\b|\b(?:CASA|CS|BLOCO|BL|APTO|APT|APARTAMENTO)\b))`;

const QUADRA_LOTE_TOKEN =
  String.raw`(?:[A-Z](?:\s*[-:]?\s*\d+[A-Z0-9\-]*)?|[A-Z]|\d+[A-Z0-9]{0,5}(?:-[A-Z0-9]{1,3})?)`;

function extractQuadraLoteSmart(raw: string) {
  const up = separateCompactQuadraLoteTokens(raw).toUpperCase();
  const hasApartmentNoise = /\b(BLOCO|BL|APTO|APT|APARTAMENTO)\b/.test(up);

  let quadra = "";
  let lote = "";

  const qiMatch = up.match(
    new RegExp(
      String.raw`\b(?:QUADRA|QUAD|QDR|QD|Q)\.?\s*QI\s*0*([0-9][A-Z0-9\-]*)\b`,
    ),
  );
  if (qiMatch) quadra = `QI${normalizeQLValue(qiMatch[1])}`.trim();

  // 1) formatos explícitos: QUADRA/QD/Q + valor
  // pega: "QUADRA 40", "QD40", "Q. 40", "Q40", "Q-40"
  const qMatch = up.match(
    new RegExp(
      String.raw`\b(?:QUADRA|QUAD|QDR|QD|Q)\.?\s*[:\-]?\s*(${QUADRA_LOTE_TOKEN})(?:\s+([A-Z]))?${QUADRA_LOTE_VALUE_END}`,
    ),
  );
  if (qMatch) {
    const normalizedQuadra = normalizeQLValue(qMatch[1], qMatch[2]);
    if (!(hasApartmentNoise && normalizedQuadra.length === 1) && (!quadra || normalizedQuadra.length > quadra.length)) {
      quadra = normalizedQuadra;
    }
  }

  // 2) formatos explícitos: LOTE/LT/L + valor
  // pega: "LOTE 27", "LT27", "L. 27", "L27", "L-27"
  const lMatch = up.match(
    new RegExp(
      String.raw`\b(?:LOTE|LOT|LT|L(?![A-Z]))\.?\s*[:\-]?\s*(${QUADRA_LOTE_TOKEN})(?:\s+([A-Z]))?${QUADRA_LOTE_VALUE_END}`,
    ),
  );
  if (lMatch) {
    const normalizedLote = normalizeQLValue(lMatch[1], lMatch[2]);
    if (!(hasApartmentNoise && normalizedLote.length === 1) && (!lote || normalizedLote.length > lote.length)) {
      lote = normalizedLote;
    }
  }

  // 3) grudado tipo "QD40LT27" ou "Q40L27"
  if (!quadra || !lote) {
    const glued = up.match(/\b(?:QUADRA|QUAD|QDR|QD|Q)\.?\s*0*([0-9][A-Z0-9]{0,5})\s*(?:LOTE|LOT|LT|L(?![A-Z]))\.?\s*0*([0-9][A-Z0-9]{0,5})(?:\s+([A-Z]))?\b/);
    if (glued) {
      if (!quadra) quadra = normalizeQLValue(glued[1]);
      if (!lote) lote = normalizeQLValue(glued[2], glued[3]);
    }
  }

  // 4) ordem invertida: "L27 Q40"
  if (!quadra || !lote) {
    const inv = up.match(/\b(?:LOTE|LOT|LT|L(?![A-Z]))\.?\s*0*([0-9][A-Z0-9]{0,5})(?:\s+([A-Z]))?\s*(?:QUADRA|QUAD|QDR|QD|Q)\.?\s*0*([0-9][A-Z0-9]{0,5})\b/);
    if (inv) {
      if (!lote) lote = normalizeQLValue(inv[1], inv[2]);
      if (!quadra) quadra = normalizeQLValue(inv[3]);
    }
  }

  // 5) fallback bem conservador para "40/27" ou "40-27"
  // Só aceita se existir alguma palavra de contexto QD/QUADRA/LT/LOTE no texto
  if ((!quadra || !lote) && /\b(QDR|QD|QUADRA|QUAD|LT|LOTE)\b/.test(up)) {
    const pair = up.match(/\b(\d{1,3})\s*[\/\-]\s*(\d{1,3})\b/);
    if (pair) {
      if (!quadra) quadra = normalizeQLValue(pair[1]);
      if (!lote) lote = normalizeQLValue(pair[2]);
    }
  }

  return { quadra, lote };
}

function isAparecidaBairroNoise(value: string) {
  const up = normalizeKey(value);
  if (!up) return true;
  return /\b(APT|APTO|APART|APARTAMENTO|BLOCO|TORRE|EDIF|EDIFICIO|EDIFICIO|CONDOMINIO|RESIDENCIAL|SALA|CASA|LOJA|SOBRADO|FUNDO|IGREJA)\b/.test(up);
}

function normalizeAparecidaBairroCandidate(value: string) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s*\(([^)]*)\)\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return "";
  if (isAparecidaBairroNoise(cleaned)) return "";
  return cleaned;
}

function chooseAparecidaBairro(primary: string, fallback: string) {
  const fallbackClean = normalizeAparecidaBairroCandidate(fallback);
  if (fallbackClean) return fallbackClean;

  const primaryClean = normalizeAparecidaBairroCandidate(primary);
  if (primaryClean) return primaryClean;

  return "";
}

function mergeAparecidaLotValue(primary: string, fallback: string, tertiary: string) {
  const normalizeGoianiaQLValue = (value: string) => {
    let t = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s\-:]+/g, "");

    if (!t) return "";
    if (/^(BL|LT|L|Q|QD|QDR|QUADRA|QUAD|LOT|LOTE|SN|SN\/|S\/N)$/.test(t)) return "";

    t = t.replace(/^(?:QDR|QUADRA|QUAD|QD)(?=[A-Z0-9])/, "");
    if (/^Q\d/.test(t)) t = t.slice(1);

    if (/^(BL|LT|L|Q|QD|QDR|QUADRA|QUAD|LOT|LOTE|SN|SN\/|S\/N)$/.test(t)) return "";

    return t;
  };

  const scoreGoianiaQLValue = (value: string) => {
    const compact = String(value || "").trim().toUpperCase();
    const bareDigits = /^\d+$/.test(compact);
    const hasLetters = /[A-Z]/.test(compact);
    const startsWithLetters = /^[A-Z]/.test(compact);

    return (
      (hasLetters ? 2 : 0) +
      (startsWithLetters ? 1 : 0) +
      (!bareDigits ? 1 : 0) +
      compact.length / 100
    );
  };

  const values = [primary, fallback, tertiary]
    .map((v) => normalizeGoianiaQLValue(v))
    .filter(Boolean);
  if (!values.length) return "";

  const digitKey = (v: string) => v.replace(/[^0-9]/g, "");
  let best = values[0];

  for (const value of values.slice(1)) {
    if (digitKey(value) !== digitKey(best)) continue;
    if (scoreGoianiaQLValue(value) > scoreGoianiaQLValue(best)) {
      best = value;
    }
  }

  return best;
}

function pickAparecidaLocalFirstCandidate(args: {
  quadra: string;
  lote: string;
  normalizedBairro: string;
  originalBairro: string;
  rua: string;
  cidade: string;
  cep: string;
}) {
  const targets = [
    { label: "normalized" as const, bairro: normalizeAparecidaBairroCandidate(args.normalizedBairro) },
    { label: "original" as const, bairro: normalizeAparecidaBairroCandidate(args.originalBairro) },
  ].filter((entry) => !!entry.bairro);

  for (const target of targets) {
    const candidate = findAparecidaLocalLotCandidate({
      quadra: args.quadra,
      lote: args.lote,
      bairro: target.bairro,
      planilhaBairro: args.originalBairro || target.bairro || "",
      rua: args.rua,
      cidade: args.cidade,
      cep: args.cep,
      allowStrongBairroAlias: true,
    });

    if (!candidate) continue;
    if (
      !candidate.localAliasAccepted &&
      !areAparecidaBairrosCompatible(target.bairro, candidate.bairro)
    ) continue;

    return { candidate, matchedBy: target.label };
  }

  return null;
}

function pickAparecidaPartialStreetCandidate(args: {
  scored: RankedHereEntry[];
  rua: string;
  bairro: string;
  cidade: string;
  cep: string;
}) {
  const targetStreet = normalizeUrbanStreet(args.rua || "") || normalizeKey(args.rua || "");
  const targetCity = normalizeKey(args.cidade || "");
  const targetBairro = normalizeAparecidaBairroCandidate(args.bairro || "");
  if (!targetStreet || !targetCity) return null;

  let best:
    | {
        item: any;
        score: number;
        reason: "PARTIAL_STREET_LEVEL_MATCH" | "PARTIAL_SECTOR_MATCH";
      }
    | null = null;

  for (const entry of args.scored) {
    const pos = entry.it?.position;
    if (typeof pos?.lat !== "number" || typeof pos?.lng !== "number") continue;

    const address = entry.it?.address || {};
    const actualStreet = normalizeUrbanStreet(String(address.street || "")) || normalizeKey(String(address.street || ""));
    const actualCity = normalizeKey(String(address.city || address.county || ""));
    const actualBairro = normalizeAparecidaBairroCandidate(String(address.district || address.subdistrict || ""));

    const ruaOk =
      actualStreet === targetStreet ||
      actualStreet.includes(targetStreet) ||
      targetStreet.includes(actualStreet);
    if (!ruaOk) continue;

    const cidadeOk =
      actualCity === targetCity ||
      actualCity.includes(targetCity) ||
      targetCity.includes(actualCity);
    if (!cidadeOk) continue;

    const bairroOk =
      !targetBairro ||
      !actualBairro ||
      actualBairro === targetBairro ||
      actualBairro.includes(targetBairro) ||
      targetBairro.includes(actualBairro);
    if (!bairroOk) continue;

    const diag = computeGeocodeConfidence({
      source: "HERE_GEOCODE",
      expected: {
        rua: args.rua,
        bairro: args.bairro,
        cidade: args.cidade,
        cep: args.cep,
      },
      actual: {
        rua: String(address.street || ""),
        bairro: String(address.district || address.subdistrict || ""),
        cidade: String(address.city || address.county || ""),
        cep: String(address.postalCode || ""),
        resultType: String(entry.it?.resultType || ""),
      },
      hasCoords: true,
      hasQuadra: false,
      hasLote: false,
      hereSpreadMeters: 0,
      memoryStrength: "NONE",
      hardSignals: [],
    });

    if (diag.hardMismatch) continue;
    if (diag.flags.includes("CIDADE_MISMATCH")) continue;
    if (diag.flags.includes("BAIRRO_MISMATCH")) continue;
    if (diag.flags.includes("RUA_MISMATCH")) continue;

    const reason =
      diag.flags.includes("BAIRRO_MATCH") && diag.flags.includes("RUA_EXACT")
        ? "PARTIAL_STREET_LEVEL_MATCH"
        : "PARTIAL_SECTOR_MATCH";

    if (!best || entry.score > best.score) {
      best = {
        item: entry.it,
        score: entry.score,
        reason,
      };
    }
  }

  return best;
}

// ✅ SUA REGRA DE STATUS
function calcStatusLucas(n: { rua?: string; quadra?: string; lote?: string; bairro?: string }) {
  const rua = (n.rua || "").trim();
  const quadra = (n.quadra || "").trim();
  const lote = (n.lote || "").trim();
  const bairro = (n.bairro || "").trim(); // setor

  const hasRua = !!rua;
  const hasQ = !!quadra;
  const hasL = !!lote;
  const hasSetor = !!bairro;

  if (hasRua && hasQ && hasL) return "OK";

  const usefulCount = Number(hasRua) + Number(hasQ) + Number(hasL) + Number(hasSetor);
  if (usefulCount >= 2) return "PARCIAL";
  if (usefulCount === 0) return "NAO_ENCONTRADO";
  return "PARCIAL";
}

function auditAutoSaveMemory(params: {
  currentBehaviorWouldSave: boolean;
  status: string;
  lat: number | null;
  lng: number | null;
  geocodeConfidenceLevel: GeocodeConfidenceLevel;
  geocodeConfidenceHardMismatch: boolean;
  geocodeConfidenceFlags: string[];
  approxOperationalRisk: ApproxOperationalRisk | null;
  approxMemoryStrength: ApproxMemoryStrength | null;
  usedApproxMemory: boolean;
  approxMemoryUsedAsFinal: boolean;
  city: string;
}) {
  const blockedReasons: string[] = [];
  const pushReason = (reason: string) => {
    if (!blockedReasons.includes(reason)) blockedReasons.push(reason);
  };

  const structuralReasons: string[] = [];
  const pushStructural = (reason: string) => {
    if (!structuralReasons.includes(reason)) structuralReasons.push(reason);
  };

  if (params.status !== "OK") {
    pushReason("STATUS_NOT_OK");
    pushStructural("STATUS_NOT_OK");
  }
  if (params.lat == null || params.lng == null) {
    pushReason("MISSING_COORDS");
    pushStructural("MISSING_COORDS");
  }
  if (params.geocodeConfidenceHardMismatch) {
    pushReason("HARD_MISMATCH");
    pushStructural("HARD_MISMATCH");
  }
  if (params.geocodeConfidenceFlags.includes("HERE_SPREAD_HIGH")) {
    pushReason("HERE_SPREAD_HIGH");
    pushStructural("HERE_SPREAD_HIGH");
  }
  if (params.geocodeConfidenceFlags.includes("HERE_UNCERTAIN")) {
    pushReason("HERE_UNCERTAIN");
    pushStructural("HERE_UNCERTAIN");
  }
  if (params.geocodeConfidenceFlags.includes("RUA_MISMATCH")) {
    pushReason("RUA_MISMATCH");
    pushStructural("RUA_MISMATCH");
  }
  if (params.geocodeConfidenceFlags.includes("CIDADE_MISMATCH")) {
    pushReason("CIDADE_MISMATCH");
    pushStructural("CIDADE_MISMATCH");
  }
  if (params.geocodeConfidenceFlags.includes("BAIRRO_MISMATCH")) {
    pushReason("BAIRRO_MISMATCH");
    pushStructural("BAIRRO_MISMATCH");
  }
  if (params.geocodeConfidenceFlags.includes("QL_CONFLICT")) {
    pushReason("QL_CONFLICT");
    pushStructural("QL_CONFLICT");
  }
  if (params.approxOperationalRisk === "BAD") {
    pushReason("APPROX_RISK_BAD");
    pushStructural("APPROX_RISK_BAD");
  }
  if (params.approxOperationalRisk === "RISKY") {
    pushReason("APPROX_RISK_RISKY");
    pushStructural("APPROX_RISK_RISKY");
  }
  if (params.usedApproxMemory || params.approxMemoryUsedAsFinal) {
    pushReason("MEMORY_APPROX_AUTO_SAVE_BLOCKED");
    pushStructural("MEMORY_APPROX_AUTO_SAVE_BLOCKED");
  }

  if (params.geocodeConfidenceLevel !== "HIGH") {
    pushStructural("CONFIDENCE_NOT_HIGH");
  }
  if (params.geocodeConfidenceLevel === "LOW") {
    pushReason("CONFIDENCE_LOW");
  } else if (params.geocodeConfidenceLevel === "MEDIUM") {
    if (isAparecidaCity(params.city)) {
      pushReason("CONFIDENCE_MEDIUM_APARECIDA_BLOCKED");
    }
    if (params.approxMemoryStrength === "WEAK") {
      pushReason("CONFIDENCE_MEDIUM_MEMORY_WEAK");
    }
  }

  const hasRiskFlags =
    params.geocodeConfidenceHardMismatch ||
    params.geocodeConfidenceFlags.includes("HERE_SPREAD_HIGH") ||
    params.geocodeConfidenceFlags.includes("HERE_UNCERTAIN") ||
    params.geocodeConfidenceFlags.includes("RUA_MISMATCH") ||
    params.geocodeConfidenceFlags.includes("CIDADE_MISMATCH") ||
    params.geocodeConfidenceFlags.includes("BAIRRO_MISMATCH") ||
    params.geocodeConfidenceFlags.includes("QL_CONFLICT") ||
    params.approxOperationalRisk === "BAD" ||
    params.approxOperationalRisk === "RISKY" ||
    params.usedApproxMemory ||
    params.approxMemoryUsedAsFinal;

  const futureWouldAllow =
    params.currentBehaviorWouldSave &&
    params.status === "OK" &&
    params.lat != null &&
    params.lng != null &&
    params.geocodeConfidenceLevel === "HIGH" &&
    !hasRiskFlags &&
    true;

  const hardeningApplied = futureWouldAllow ? false : structuralReasons.length > 0;

  return {
    autoSaveWouldAllow: futureWouldAllow,
    autoSaveWouldBlockReason: futureWouldAllow
      ? null
      : (blockedReasons[0] || "AUTO_SAVE_SHADOW_BLOCKED"),
    autoSaveWouldBlockReasons: futureWouldAllow ? [] : blockedReasons,
    autoSaveCurrentBehaviorWouldSave: params.currentBehaviorWouldSave,
    autoSaveHardeningApplied: hardeningApplied,
    autoSaveHardeningBlockedReason: hardeningApplied
      ? (structuralReasons[0] || null)
      : null,
  };
}

function buildNormalizedLine(n: Normalized, fallback: string) {
  const rua = (n.rua || "").trim();
  const numero = (n.numero || "").trim();
  const quadra = (n.quadra || "").trim();
  const lote = (n.lote || "").trim();
  const cep = normalizeCep(n.cep || "");

  const parts: string[] = [];

  const ruaNumero = [rua, numero].filter(Boolean).join(", ");
  if (ruaNumero) parts.push(ruaNumero);

  const qdlt = [quadra ? `Quadra ${quadra}` : "", lote ? `Lote ${lote}` : ""]
    .filter(Boolean)
    .join(" ");
  if (qdlt) parts.push(qdlt);

  const bairro = (n.bairro || "").trim();
  const cidade = (n.cidade || "").trim();
  const estado = ((n.estado || "GO").trim() || "GO");

  if (bairro) parts.push(bairro);
  if (cidade) parts.push(cidade);
  if (estado) parts.push(estado);
  if (cep) parts.push(cep);

  const line = parts.join(", ").trim();
  return line || fallback;
}

// ====== limpar Q/L de dentro do complemento ======
function cleanComplementRemoveQuadraLote(obs: string) {
  let t = String(obs || "").trim();
  t = t.replace(/gemini\s*erro/gi, "").trim();

  t = t.replace(/\b(QUADRA|QD|Q\.)\s*[:\-]?\s*0*([A-Z0-9\-]+)\b/gi, "");
  t = t.replace(/\b(LOTE|LT|L\.)\s*[:\-]?\s*0*([A-Z0-9\-]+)\b/gi, "");

  t = t.replace(/\bQ\s*0*(\d+)\b/gi, "");
  t = t.replace(/\bL\s*0*(\d+)\b/gi, "");

  t = t.replace(/\bQD\s*0*(\d+)\b/gi, "");
  t = t.replace(/\bLT\s*0*(\d+)\b/gi, "");

  t = t.replace(/[-–—|]+/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

// ===== cidade Aparecida? (só pra decidir se pega quadra/lote no seu mapa) =====
function isAparecidaCity(v: string) {
  const s = String(v || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return s.includes("APARECIDA");
}

// ===== normalização simples de "Rua 25-e" vs "Rua vinte e cinco - E" =====
function numToPt(n: number) {
  const u: Record<number, string> = {
    0: "zero",
    1: "um",
    2: "dois",
    3: "tres",
    4: "quatro",
    5: "cinco",
    6: "seis",
    7: "sete",
    8: "oito",
    9: "nove",
    10: "dez",
    11: "onze",
    12: "doze",
    13: "treze",
    14: "quatorze",
    15: "quinze",
    16: "dezesseis",
    17: "dezessete",
    18: "dezoito",
    19: "dezenove",
  };
  const d: Record<number, string> = {
    20: "vinte",
    30: "trinta",
    40: "quarenta",
    50: "cinquenta",
    60: "sessenta",
    70: "setenta",
    80: "oitenta",
    90: "noventa",
  };
  if (n <= 19) return u[n] || String(n);
  const tens = Math.floor(n / 10) * 10;
  const ones = n % 10;
  if (ones === 0) return d[tens] || String(n);
  return `${d[tens] || tens} e ${u[ones] || ones}`;
}

function streetVariants(rua: string) {
  const base = String(rua || "").trim();
  if (!base) return [];

  const variants = new Set<string>();
  variants.add(base);

  const m = base.match(/\b(\d{1,3})\s*[-]?\s*([A-Za-z])\b/);
  if (m) {
    const num = Number(m[1]);
    const letter = String(m[2]).toUpperCase();
    const prefix = base.replace(m[0], "").trim() || "Rua";

    variants.add(`${prefix} ${num}-${letter}`.replace(/\s{2,}/g, " ").trim());
    variants.add(`${prefix} ${num} - ${letter}`.replace(/\s{2,}/g, " ").trim());
    variants.add(`${prefix} ${num} ${letter}`.replace(/\s{2,}/g, " ").trim());

    if (Number.isFinite(num) && num >= 0 && num <= 99) {
      const ext = numToPt(num);
      variants.add(`${prefix} ${ext} - ${letter}`.replace(/\s{2,}/g, " ").trim());
      variants.add(`${prefix} ${ext} ${letter}`.replace(/\s{2,}/g, " ").trim());
    }
  }

  return Array.from(variants);
}

function buildAparecidaStreetQuadraQueries(args: {
  rua: string;
  cidade: string;
  estado: string;
  quadra: string;
}) {
  const rua = cleanAddressForHere(stripQuadraLoteFromStreet(args.rua || ""));
  const cidade = cleanAddressForHere(args.cidade || "");
  const estado = cleanAddressForHere(args.estado || "GO") || "GO";
  const quadra = String(args.quadra || "").trim();

  if (!rua || !quadra) return [];

  const variants = new Set<string>();
  const add = (street: string) => {
    const cleaned = cleanAddressForHere(street);
    if (!cleaned) return;
    [
      [cleaned, `Quadra ${quadra}`, cidade, estado],
      [cleaned, `Q ${quadra}`, cidade, estado],
    ]
      .map((parts) => parts.filter(Boolean).join(", "))
      .map((query) => cleanAddressForHere(query))
      .filter(Boolean)
      .forEach((query) => variants.add(query));
  };

  add(rua);
  for (const variant of streetVariants(rua)) add(variant);

  const codeMatch = rua.match(/\b([A-Z])\s*0*(\d{1,3})\b/i);
  if (codeMatch) {
    const letter = String(codeMatch[1] || "").toUpperCase();
    const num = Number(codeMatch[2]);
    const compact = Number.isFinite(num) ? String(num) : String(codeMatch[2] || "");
    const padded = Number.isFinite(num) ? String(num).padStart(3, "0") : compact;
    add(rua.replace(codeMatch[0], `${letter}-${padded}`));
    add(rua.replace(codeMatch[0], `${letter}-${compact}`));
    add(`${letter}-${padded}`);
    add(`${letter}-${compact}`);
  }

  return Array.from(variants).slice(0, 6);
}

// ===== GEMINI =====
const GEMINI_MAX_CONCURRENT_FETCHES = 2;
let geminiActiveFetches = 0;
const geminiFetchQueue: Array<() => void> = [];

async function acquireGeminiFetchSlot() {
  const waited = geminiActiveFetches >= GEMINI_MAX_CONCURRENT_FETCHES;
  if (waited) {
    await new Promise<void>((resolve) =>
      geminiFetchQueue.push(() => {
        geminiActiveFetches += 1;
        resolve();
      })
    );
  } else {
    geminiActiveFetches += 1;
  }
  return { waited, active: geminiActiveFetches, queued: geminiFetchQueue.length };
}

function releaseGeminiFetchSlot() {
  geminiActiveFetches = Math.max(0, geminiActiveFetches - 1);
  const next = geminiFetchQueue.shift();
  if (next) next();
  return { active: geminiActiveFetches, queued: geminiFetchQueue.length };
}

async function geminiNormalize(params: {
  address: string;
  bairro?: string;
  city?: string;
  cep?: string;
  sequence?: string | number;
  skipExternalCall?: boolean;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const startedAt = Date.now();
  const debugGemini =
    process.env.NODE_ENV !== "production" &&
    process.env.ROTTA_DEBUG_GEMINI_NORMALIZE === "1";
  const logGemini = (event: string, details: Record<string, unknown>) => {
    if (!debugGemini) return;
    console.info(`[${event}]`, {
      sequence: params.sequence ?? "",
      durationMs: Date.now() - startedAt,
      ...details,
    });
  };

  if (params.skipExternalCall) {
    logGemini("GEMINI_SKIPPED_STRONG_MEMORY", {
      status: "SKIPPED",
      fallbackLocalAssumed: true,
    });
    const normalized: Normalized = {
      rua: "",
      numero: "",
      quadra: "",
      lote: "",
      bairro: params.bairro || "",
      cidade: params.city || "",
      estado: "GO",
      cep: params.cep || "",
      observacao: "",
    };
    return { normalized, raw: "", model, usedGemini: false as const, geminiOk: false as const };
  }

  if (!apiKey) {
    logGemini("GEMINI_CALL_ERROR", {
      status: "NO_API_KEY",
      fallbackLocalAssumed: true,
    });
    const normalized: Normalized = {
      rua: "",
      numero: "",
      quadra: "",
      lote: "",
      bairro: params.bairro || "",
      cidade: params.city || "",
      estado: "GO",
      cep: params.cep || "",
      observacao: "",
    };
    return { normalized, raw: "", model, usedGemini: false as const, geminiOk: false as const };
  }

  const prompt = `
Extraia o endereço em JSON puro, sem markdown ou explicações. Use "" quando ausente. Não invente dados.

Entrada: "${params.address}"
Bairro: "${params.bairro || ""}"
Cidade: "${params.city || ""}"
CEP: "${params.cep || ""}"

Regras:
- rua: somente a via; não inclua quadra ou lote.
- Separe tokens compactados como RC8QD15LT40 em rua="Rua RC8", quadra="15", lote="40". Preserve códigos de via como RC, CV e AC.
- numero, quadra e lote: somente o valor, sem zeros à esquerda. Para SN, use numero="".
- observacao: complemento curto.

{
  "rua": "",
  "numero": "",
  "quadra": "",
  "lote": "",
  "bairro": "",
  "cidade": "",
  "estado": "GO",
  "cep": "",
  "observacao": ""
}
`.trim();

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  let res: Response;
  const queueSlot = await acquireGeminiFetchSlot();
  if (queueSlot.waited) {
    logGemini("GEMINI_QUEUE_WAIT", queueSlot);
  }
  logGemini("GEMINI_QUEUE_ACQUIRED", queueSlot);
  try {
    logGemini("GEMINI_CALL_START", { status: "STARTED" });
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
    });
  } catch (error) {
    logGemini("GEMINI_CALL_ERROR", {
      status: "FETCH_ERROR",
      fallbackLocalAssumed: false,
    });
    throw error;
  } finally {
    logGemini("GEMINI_QUEUE_RELEASED", releaseGeminiFetchSlot());
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    logGemini("GEMINI_CALL_ERROR", {
      status: res.status,
      is429: res.status === 429,
      fallbackLocalAssumed: true,
    });
    const normalized: Normalized = {
      rua: "",
      numero: "",
      quadra: "",
      lote: "",
      bairro: params.bairro || "",
      cidade: params.city || "",
      estado: "GO",
      cep: params.cep || "",
      observacao: "",
    };
    return { normalized, raw: JSON.stringify(data || {}), model, usedGemini: false as const, geminiOk: false as const };
  }

  const rawText: string =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("")?.trim?.() || "";

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const rawJson = jsonMatch ? jsonMatch[0] : "{}";

  let parsed: any = null;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object") {
    logGemini("GEMINI_CALL_ERROR", {
      status: "INVALID_JSON",
      fallbackLocalAssumed: true,
    });
    const normalized: Normalized = {
      rua: "",
      numero: "",
      quadra: "",
      lote: "",
      bairro: params.bairro || "",
      cidade: params.city || "",
      estado: "GO",
      cep: params.cep || "",
      observacao: "",
    };
    return { normalized, raw: rawText, model, usedGemini: false as const, geminiOk: false as const };
  }

  const hasUsefulField = [
    "rua",
    "numero",
    "quadra",
    "lote",
    "bairro",
    "cidade",
    "cep",
    "observacao",
  ].some((field) => typeof parsed[field] === "string" && parsed[field].trim());

  if (!hasUsefulField) {
    logGemini("GEMINI_CALL_ERROR", {
      status: "INVALID_EMPTY_JSON",
      fallbackLocalAssumed: true,
    });
    const normalized: Normalized = {
      rua: "",
      numero: "",
      quadra: "",
      lote: "",
      bairro: params.bairro || "",
      cidade: params.city || "",
      estado: "GO",
      cep: params.cep || "",
      observacao: "",
    };
    return { normalized, raw: rawText, model, usedGemini: false as const, geminiOk: false as const };
  }

  const normalized: Normalized = {
    rua: typeof parsed?.rua === "string" ? parsed.rua : "",
    numero: typeof parsed?.numero === "string" ? parsed.numero : "",
    quadra: typeof parsed?.quadra === "string" ? parsed.quadra : "",
    lote: typeof parsed?.lote === "string" ? parsed.lote : "",
    bairro: typeof parsed?.bairro === "string" ? parsed.bairro : (params.bairro || ""),
    cidade: typeof parsed?.cidade === "string" ? parsed.cidade : (params.city || ""),
    estado: typeof parsed?.estado === "string" ? parsed.estado : "GO",
    cep: typeof parsed?.cep === "string" ? parsed.cep : (params.cep || ""),
    observacao: typeof parsed?.observacao === "string" ? parsed.observacao : "",
  };

  logGemini("GEMINI_CALL_SUCCESS", {
    status: res.status,
    parsedKeys: Object.keys(parsed),
    fallbackLocalAssumed: false,
  });

  return { normalized, raw: rawText, model, usedGemini: true as const, geminiOk: true as const };
}

// ===== HERE =====
async function hereGet(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function getHereKey() {
  return (process.env.HERE_API_KEY || process.env.NEXT_PUBLIC_HERE_API_KEY || "").trim();
}

async function getAtByCep(cep: string, city: string) {
  const hereKey = getHereKey();
  const c = normalizeCep(cep);
  if (!hereKey || !c) return null;

  const base = "https://geocode.search.hereapi.com/v1/geocode";
  const qs = new URLSearchParams({
    apiKey: hereKey,
    q: `${c}, ${city || "Goiânia"}, GO`,
    lang: "pt-BR",
    limit: "1",
    in: "countryCode:BRA",
  });

  const { ok, data } = await hereGet(`${base}?${qs.toString()}`);
  if (!ok) return null;

  const item = data?.items?.[0];
  const pos = item?.position;
  if (!pos?.lat || !pos?.lng) return null;

  return `${pos.lat},${pos.lng}`;
}

async function hereGeocode(q: string, at?: string) {
  const hereKey = getHereKey();
  if (!hereKey) return { found: false as const, best: null as any, all: [] as any[] };

  const base = "https://geocode.search.hereapi.com/v1/geocode";
  const qs = new URLSearchParams({
    q: cleanAddressForHere(q),
    apiKey: hereKey,
    lang: "pt-BR",
    limit: "10",
    in: "countryCode:BRA",
  });
  if (at) qs.set("at", at);

  const { ok, data } = await hereGet(`${base}?${qs.toString()}`);
  const items = data?.items || [];
  if (!ok || !items.length) return { found: false as const, best: null, all: items };
  return { found: true as const, best: items[0], all: items };
}

async function hereDiscover(q: string, at: string) {
  const hereKey = getHereKey();
  if (!hereKey) return { found: false as const, best: null as any, all: [] as any[] };

  const base = "https://discover.search.hereapi.com/v1/discover";
  const qs = new URLSearchParams({
    q: cleanAddressForHere(q),
    apiKey: hereKey,
    lang: "pt-BR",
    limit: "10",
    at,
    in: "countryCode:BRA",
  });

  const { ok, data } = await hereGet(`${base}?${qs.toString()}`);
  const items = data?.items || [];
  if (!ok || !items.length) return { found: false as const, best: null, all: items };
  return { found: true as const, best: items[0], all: items };
}

// ====== NOVO SCORE MELHORADO (NÃO ACEITA O 1º) ======
function scoreHereItemSmart(
  it: any,
  want: { cep?: string; city?: string; bairro?: string; rua?: string; quadra?: string; lote?: string },
) {
  const a = it?.address || {};
  const label = String(a?.label || it?.title || "").toUpperCase();
  const resultType = String(it?.resultType || "").toLowerCase();

  const cepWant = normalizeCep(want.cep || "");
  const cepGot = normalizeCep(a?.postalCode || "");

  const cityWant = String(want.city || "").trim().toUpperCase();
  const cityGot = String(a?.city || "").trim().toUpperCase();

  const bairroWant = String(want.bairro || "").trim().toUpperCase();
  const bairroGot = String(a?.district || a?.subdistrict || "").trim().toUpperCase();

  const ruaWant = String(want.rua || "").trim().toUpperCase();
  const streetGot = String(a?.street || "").trim().toUpperCase();

  const qWant = String(want.quadra || "").trim().toUpperCase();
  const lWant = String(want.lote || "").trim().toUpperCase();

  let s = 0;

  // preferência do tipo
  if (resultType === "housenumber") s += 60;
  else if (resultType === "street") s += 40;
  else if (resultType === "place") s += 15;

  // rua / label
  if (ruaWant && streetGot && (streetGot.includes(ruaWant) || ruaWant.includes(streetGot))) s += 35;
  if (ruaWant && label.includes(ruaWant)) s += 15;

  // cep / city / bairro
  if (cepWant && cepGot && cepWant === cepGot) s += 90;
  if (cityWant && cityGot && (cityGot.includes(cityWant) || cityWant.includes(cityGot))) s += 35;
  if (bairroWant && bairroGot && (bairroGot.includes(bairroWant) || bairroWant.includes(bairroGot))) s += 18;

  // quadra/lote (quando o HERE devolve no label - acontece às vezes)
  if (qWant) {
    const okQ =
      label.includes(`QUADRA ${qWant}`) ||
      label.includes(`QD ${qWant}`) ||
      label.includes(`Q ${qWant}`) ||
      label.includes(`Q${qWant}`);
    if (okQ) s += 45;
  }
  if (lWant) {
    const okL =
      label.includes(`LOTE ${lWant}`) ||
      label.includes(`LT ${lWant}`) ||
      label.includes(`L ${lWant}`) ||
      label.includes(`L${lWant}`);
    if (okL) s += 45;
  }

  // penaliza itens sem position
  if (!it?.position?.lat || !it?.position?.lng) s -= 999;

  return s;
}

function dedupeKeyForHere(it: any) {
  const a = it?.address || {};
  const label = String(a?.label || it?.title || "").trim();
  const lat = it?.position?.lat ?? "";
  const lng = it?.position?.lng ?? "";
  return `${label}::${lat},${lng}`;
}

function clusterPoints(
  points: Array<{ lat: number; lng: number }>,
  maxDistanceMeters = 120,
) {
  if (points.length < 2) return { ok: false, center: null };

  // converte metros aproximados para graus
  const toDeg = (m: number) => m / 111_320;

  const center = {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };

  const maxDeg = toDeg(maxDistanceMeters);

  const allNear = points.every(
    p =>
      Math.abs(p.lat - center.lat) <= maxDeg &&
      Math.abs(p.lng - center.lng) <= maxDeg,
  );

  return {
    ok: allNear,
    center: allNear ? center : null,
  };
}
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function sameText(a: string, b: string) {
  const x = String(a || "").trim().toUpperCase();
  const y = String(b || "").trim().toUpperCase();
  return !!x && !!y && x === y;
}

function scoreArcgisLotMatch(
  arc: any,
  want: { quadra?: string; lote?: string; bairro?: string },
) {
  // arc = retorno do /api/aparecida/lot
  if (!arc || !arc.found) return -50;

  const aq = String(arc.quadra || "").trim();
  const al = String(arc.lote || "").trim();
  const ab = String(arc.bairro || "").trim();

  const wq = String(want.quadra || "").trim();
  const wl = String(want.lote || "").trim();
  const wb = String(want.bairro || "").trim();

  let s = 200; // achou um lote já é MUITO bom

  if (wq && aq) s += sameText(wq, aq) ? 250 : -120;
  if (wl && al) s += sameText(wl, al) ? 250 : -120;

  if (wb && ab) s += (ab.toUpperCase().includes(wb.toUpperCase()) || wb.toUpperCase().includes(ab.toUpperCase())) ? 30 : 0;

  return s;
}

function scoreAparecidaRerankCandidate(args: {
  baseScore: number;
  item: any;
  arc: any;
  wantArc: { quadra?: string; lote?: string; bairro?: string };
  expected: { rua?: string; bairro?: string; cidade?: string; cep?: string; quadra?: string; lote?: string };
  hereSpreadMeters?: number;
}) {
  const address = args.item?.address || {};
  const actualRua = String(address?.street || "");
  const actualBairro = String(address?.district || address?.subdistrict || "");
  const actualCidade = String(address?.city || address?.county || "");
  const actualCep = String(address?.postalCode || "");
  const resultType = String(args.item?.resultType || "");

  const arcQuadra = String(args.arc?.quadra || "").trim();
  const arcLote = String(args.arc?.lote || "").trim();
  const qlConflict =
    !!args.arc?.found &&
    ((!!args.wantArc.quadra && !!arcQuadra && !sameText(args.wantArc.quadra, arcQuadra)) ||
      (!!args.wantArc.lote && !!arcLote && !sameText(args.wantArc.lote, arcLote)));

  const confidence = computeGeocodeConfidence({
    source: "HERE_GEOCODE",
    expected: args.expected,
    actual: {
      rua: actualRua,
      bairro: actualBairro,
      cidade: actualCidade,
      cep: actualCep,
      resultType,
    },
    hasCoords: !!args.item?.position?.lat && !!args.item?.position?.lng,
    hasQuadra: !!args.expected.quadra,
    hasLote: !!args.expected.lote,
    hereSpreadMeters: args.hereSpreadMeters,
    memoryStrength: "NONE",
    hardSignals: qlConflict ? ["QL_CONFLICT"] : [],
  });

  let total = args.baseScore + scoreArcgisLotMatch(args.arc, args.wantArc);

  if (confidence.hardMismatch) total -= 120;
  if (confidence.flags.includes("CIDADE_MISMATCH")) total -= 220;
  if (confidence.flags.includes("BAIRRO_MISMATCH")) total -= 140;
  if (confidence.flags.includes("RUA_MISMATCH")) total -= 50;
  if (confidence.flags.includes("QL_CONFLICT")) total -= 180;
  if (confidence.flags.includes("HERE_SPREAD_HIGH")) total -= 35;
  if (confidence.flags.includes("HERE_SPREAD_MEDIUM")) total -= 12;

  if (args.arc?.found) total += 15;
  if (confidence.level === "HIGH") total += 20;
  else if (confidence.level === "MEDIUM") total += 8;

  return {
    total,
    confidence,
    qlConflict,
  };
}

function maxPairDistanceMeters(points: Array<{ lat: number; lng: number }>) {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = haversineMeters(points[i], points[j]);
      if (d > max) max = d;
    }
  }
  return max;
}
function buildHereQueryVariants(args: {
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  original: string;
  normalizedLine: string;
}) {
  const cep = normalizeCep(args.cep || "");
  const cidade = (args.cidade || "").trim();
  const bairro = (args.bairro || "").trim();
  const estado = (args.estado || "GO").trim() || "GO";

  const full = cleanAddressForHere(args.normalizedLine || "");
  const fullNoQdLt = cleanAddressForHere(stripQuadraLoteFromQuery(full));

  const ruaOnly = cleanAddressForHere([stripQuadraLoteFromStreet(args.rua), args.numero].filter(Boolean).join(", "));

  const ruaCep = cleanAddressForHere([ruaOnly, cep, cidade, estado].filter(Boolean).join(", "));
  const ruaCity = cleanAddressForHere([ruaOnly, bairro, cidade, estado].filter(Boolean).join(", "));
  const originalClean = cleanAddressForHere(stripQuadraLoteFromStreet(args.original || ""));

  const ruaVariants = streetVariants(args.rua || "").map((rv) =>
    cleanAddressForHere([rv, args.numero].filter(Boolean).join(", ")),
  );

  const ruaVariantsCity = ruaVariants.map((rv) =>
    cleanAddressForHere([rv, bairro, cidade, estado].filter(Boolean).join(", ")),
  );

  const ruaVariantsCep = ruaVariants.map((rv) =>
    cleanAddressForHere([rv, cep, cidade, estado].filter(Boolean).join(", ")),
  );

  // ✅ limita (pra não ficar MUITO lento)
  const variants = [
    ruaCep,
    fullNoQdLt,
    ruaCity,
    ruaVariantsCep[0] || "",
    ruaVariantsCity[0] || "",
    full,
    originalClean,
  ]
    .map((x) => x.trim())
    .filter(Boolean);

  return Array.from(new Set(variants)).slice(0, 3);
}

function buildAparecidaRecoveryQueries(args: {
  rua: string;
  bairro: string;
  cidade: string;
  estado: string;
  quadra: string;
  lote: string;
}) {
  const rua = cleanAddressForHere(stripQuadraLoteFromStreet(args.rua || ""));
  const bairro = cleanAddressForHere(args.bairro || "");
  const cidade = cleanAddressForHere(args.cidade || "");
  const estado = cleanAddressForHere(args.estado || "GO") || "GO";
  const quadra = String(args.quadra || "").trim();
  const lote = String(args.lote || "").trim();

  const qlFull = [quadra ? `Quadra ${quadra}` : "", lote ? `Lote ${lote}` : ""]
    .filter(Boolean)
    .join(" ");

  const qlCompact = [quadra ? `Q ${quadra}` : "", lote ? `L ${lote}` : ""]
    .filter(Boolean)
    .join(" ");

  const streetQuadra = buildAparecidaStreetQuadraQueries({
    rua,
    cidade,
    estado,
    quadra,
  });

  const variants = [
    ...streetQuadra,
    [rua, qlFull, bairro, cidade, estado].filter(Boolean).join(", "),
    [rua, qlCompact, bairro, cidade, estado].filter(Boolean).join(", "),
    [rua, bairro, qlFull, cidade, estado].filter(Boolean).join(", "),
  ]
    .map((x) => cleanAddressForHere(x))
    .filter(Boolean);

  return Array.from(new Set(variants)).slice(0, 3);
}

// ===== chama seu /api/aparecida/lot (mapa real) =====
async function getAparecidaLotFromArcgis(baseOrigin: string, lat: number, lng: number) {
  try {
    const u = new URL("/api/aparecida/lot", baseOrigin);
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lng", String(lng));
    const r = await fetch(u.toString(), { method: "GET" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return null;
    if (!j.found) return { found: false };
    return j as { found: true; quadra?: string; lote?: string; bairro?: string };
  } catch {
    return null;
  }
}

// ===== processa 1 linha =====
async function processOne(
  row: InputRow,
  baseOrigin: string,
  debugMemory = false,
  runState?: GoogleCommercialFallbackRunState,
) {
  const addressRaw = String(row?.original || "").trim(); // <-- FIEL AO EXCEL
  const bairroIn = row?.bairro ? String(row.bairro) : "";
  const cityIn = row?.city ? String(row.city) : "";
  const cepIn = normalizeCep(String(row?.cep || ""));

  if (!addressRaw) {
    return {
      sequence: row?.sequence ?? "",
      bairro: bairroIn,
      city: cityIn,
      cep: cepIn,
      original: "",
      normalized: null,
      normalizedLine: "",
      status: "NAO_ENCONTRADO",
      lat: null,
      lng: null,
      model: "",
      usedGemini: false,
      notesAuto: "",
      quadraAuto: "",
      loteAuto: "",
      error: "Endereço vazio",
    };
  }

  // ✅ 0) MEMÓRIA GLOBAL: tenta reaproveitar coordenada já salva (ANTES do CONDOMINIO)
  const cityForKey = (cityIn || "").trim();
  const memoryKeyPlan = buildMemoryKeyCandidates({
    addressRaw,
    cityForKey,
  });
  const memoryKey = memoryKeyPlan.exactKey;
  const memoryBaseKey = memoryKeyPlan.memoryBaseKey;
  const condoMemoryKeyCandidates = memoryKeyPlan.candidates;

  await incrementDailyMetric(METRIC_MEMORY_LOOKUP_TOTAL).catch(() => {});

  let memoryHit: null | { lat: number; lng: number; label?: string | null } = null;
  let memoryHitKind:
    | null
    | "exact"
    | "base"
    | CondoMemoryKeyKind = null;
  let matchedMemoryKey: string | null = null;
  let approxMemoryHit: null | { lat: number; lng: number; label?: string | null } = null;
  let approxMemoryTextHint: null | { suggestedAddressLine: string; reason: string } = null;
  let approxShadowSearchHint: ApproxMemorySearchHint | null = null;
  let approxMemoryStrength: ApproxMemoryStrength | null = null;
  let approxMemoryScore: number | null = null;
  let approxMemoryReasons: string[] = [];
  let approxMemoryMatchedBy: string[] = [];
  let approxMemoryUsedAsFinal = false;
  let approxMemoryUsedAsHint = false;
  let approxOperationalRisk: ApproxOperationalRisk | null = null;
  let approxOperationalRiskReasons: string[] = [];
  let approxOperationalWouldStillSkipHere = false;
  let approxOperationalSafeForAutoSave = false;
  let approxOperationalRecommendedAction: string | null = null;
  let approxHintApplied = false;
  let approxHintReason: string | null = null;
  let approxHintFieldsUsed: string[] = [];
  let approxHintSource: "TEXT_HINT" | "SHADOW_MEDIUM" | null = null;
  let approxHintBecameBestGeocodeQuery = false;
  let urbanPatternDetected = false;
  let urbanPatternType: UrbanPatternType | null = null;
  let urbanPatternQuery: string | null = null;
  let urbanPatternImprovedRanking = false;
  let urbanPatternBestCandidateKind: string | null = null;
  let urbanPatternSpreadReduction: number | null = null;
  let urbanPatternWouldReplaceWeakQuery = false;
  let urbanPatternAppliedToRealQueries = false;
  let urbanPatternAppliedReason: string | null = null;
  let urbanPatternReplacedQuery: string | null = null;
  let urbanPatternRealQueryIndex: number | null = null;
  let urbanPatternBecameBestGeocodeQuery = false;

  try {
    for (const candidate of condoMemoryKeyCandidates) {
      const mem = await prisma.addressMemory.findUnique({
        where: { key: candidate.key },
        select: { lat: true, lng: true, label: true },
      });

      if (mem?.lat == null || mem?.lng == null) continue;

      memoryHit = mem;
      memoryHitKind = candidate.kind;
      matchedMemoryKey = candidate.key;

      // incrementa contador de uso
      await prisma.addressMemory.update({
        where: { key: candidate.key },
        data: { hitCount: { increment: 1 } },
      });

      break;
    }
  } catch (e) {
    console.warn("AddressMemory lookup failed:", e);
  }

  if (memoryHit) {
    await incrementDailyMetric(METRIC_MEMORY_HIT_TOTAL).catch(() => {});
  }

  if (debugMemory) {
    console.info("[MEMORY_LOOKUP_RESULT]", {
      original: addressRaw,
      city: cityIn,
      memoryKey,
      memoryBaseKey,
      memoryHit: !!memoryHit,
      memoryHitKind,
      matchedMemoryKey,
    });
  }

  const aptLike = isApartmentLike(addressRaw);
  const hasQL = hasQuadraLoteText(addressRaw);

  if (aptLike && !hasQL) {
    console.info("[CONDOMINIO_NO_QD_LT_CONTINUE]", {
      sequence: row?.sequence ?? "",
      bairro: bairroIn,
      city: cityIn,
      original: addressRaw,
      memoryHit: !!memoryHit,
    });
  }

  // 1) Gemini
  const rx = extractByRegex(addressRaw);
  const smartQL = extractQuadraLoteSmart(addressRaw);
  const localRuaBeforeGemini = stripQuadraLoteFromStreet(rx.rua || "").trim();
  const cityForGeminiSkipKey = normalizeKey(cityIn);
  const isGoianiaForGeminiSkip =
    cityForGeminiSkipKey.includes("GOIANIA") &&
    !cityForGeminiSkipKey.includes("APARECIDA");
  const skipGeminiForStrongExactMemory =
    isGoianiaForGeminiSkip &&
    memoryHitKind === "exact" &&
    memoryHit?.lat != null &&
    memoryHit?.lng != null &&
    !!localRuaBeforeGemini &&
    !!smartQL.quadra &&
    !!smartQL.lote;

  const g = await geminiNormalize({
    address: addressRaw,
    bairro: bairroIn,
    city: cityIn,
    cep: cepIn,
    sequence: row?.sequence,
    skipExternalCall: skipGeminiForStrongExactMemory,
  });

  // 1.1) fallback regex se Gemini falhar
 const finalRua = stripQuadraLoteFromStreet(g.normalized.rua || rx.rua || "").trim();

 const finalQuadra = mergeAparecidaLotValue(g.normalized.quadra || "", smartQL.quadra || "", rx.quadra || "").trim();
 const finalLote = mergeAparecidaLotValue(g.normalized.lote || "", smartQL.lote || "", rx.lote || "").trim();

  if (
    process.env.NODE_ENV !== "production" &&
    process.env.ROTTA_DEBUG_GEMINI_NORMALIZE === "1"
  ) {
    console.info("[GEMINI_POST_PARSE]", {
      sequence: row?.sequence ?? "",
      status: g.geminiOk ? "GEMINI_OK" : "LOCAL_FALLBACK",
      fallbackLocalAssumed: !g.geminiOk,
      geminiRuaChanged: !!g.normalized.rua && finalRua !== g.normalized.rua,
      geminiQuadraChanged: !!g.normalized.quadra && finalQuadra !== g.normalized.quadra,
      geminiLoteChanged: !!g.normalized.lote && finalLote !== g.normalized.lote,
      smartQLFilledQuadra: !g.normalized.quadra && !!smartQL.quadra,
      smartQLFilledLote: !g.normalized.lote && !!smartQL.lote,
    });
  }

  const obsCleanRaw = String(g.normalized.observacao || "")
    .trim()
    .replace(/\bQ\s*0+(\d+)/gi, "Q$1")
    .replace(/\bL\s*0+(\d+)/gi, "L$1")
    .replace(/\bQUADRA\s*0+(\d+)/gi, "Q$1")
    .replace(/\bLOTE\s*0+(\d+)/gi, "L$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  const notesAuto = cleanComplementRemoveQuadraLote(obsCleanRaw);

  const normalized: Normalized = {
    ...g.normalized,
    rua: finalRua,
    quadra: finalQuadra,
    lote: finalLote,
    bairro: chooseAparecidaBairro(g.normalized.bairro || "", bairroIn || ""),
    cidade: (g.normalized.cidade || cityIn || "").trim(),
    cep: normalizeCep((g.normalized.cep || cepIn || "").trim()),
    estado: (g.normalized.estado || "GO").trim() || "GO",
    numero: (g.normalized.numero || "").trim(),
    observacao: obsCleanRaw.replace(/gemini\s*erro/gi, "").trim(),
  };

  const isRuaFraca = isWeakStreetForMemoryHint(normalized.rua);

  if (!memoryHit) {
    const approx = await tryApproximateMemoryMatch({
      addressRaw,
      city: normalized.cidade || cityIn,
      bairro: normalized.bairro || bairroIn,
      rua: normalized.rua,
      quadra: normalized.quadra,
      lote: normalized.lote,
    });

    if (approx.shadow) {
      approxMemoryStrength = approx.shadow.strength;
      approxMemoryScore = approx.shadow.score;
      approxMemoryReasons = approx.shadow.reasons;
      approxMemoryMatchedBy = approx.shadow.matchedBy;
      const approxOperationalAudit = auditApproximateMemoryOperationalRisk({
        shadow: approx.shadow,
        city: normalized.cidade || cityIn,
        rua: normalized.rua,
        lote: normalized.lote,
      });
      approxOperationalRisk = approxOperationalAudit.risk;
      approxOperationalRiskReasons = approxOperationalAudit.reasons;
      approxOperationalWouldStillSkipHere = approxOperationalAudit.wouldStillSkipHere;
      approxOperationalSafeForAutoSave = approxOperationalAudit.safeForAutoSave;
      approxOperationalRecommendedAction = approxOperationalAudit.recommendedAction;
      approxShadowSearchHint = buildApproximateMemoryShadowHint({
        shadow: approx.shadow,
        city: normalized.cidade || cityIn,
        rua: normalized.rua,
      });
    }

    if (approx.matched && approx.lat != null && approx.lng != null) {
      approxMemoryHit = {
        lat: approx.lat,
        lng: approx.lng,
        label: approx.label || null,
      };
      approxMemoryUsedAsFinal = true;
    }
  }

  if (!memoryHit && !approxMemoryHit && isRuaFraca) {
    const hint = await tryApproximateMemoryTextHint({
      city: normalized.cidade || cityIn,
      bairro: normalized.bairro || bairroIn,
      rua: normalized.rua,
    });

    if (hint.matched && hint.suggestedAddressLine) {
      approxMemoryTextHint = {
        suggestedAddressLine: hint.suggestedAddressLine,
        reason: hint.reason || "MEMORY_TEXT_HINT",
      };
      approxMemoryUsedAsHint = true;
    }
  }

  // 2) normalizedLine (só pra debug/visual — você não vai usar no export)
  const fallbackLine =
    `${addressRaw}${bairroIn ? `, ${bairroIn}` : ""}${cityIn ? `, ${cityIn}` : ""}, GO${cepIn ? `, ${cepIn}` : ""}`.trim();
  const normalizedLine = buildNormalizedLine(normalized, fallbackLine);

  const cityForDecision = normalized.cidade || cityIn || "";
  const isAparecida = isAparecidaCity(cityForDecision);
  const goianiaLocalFirstShadowEnabled = process.env.ROTTA_GOIANIA_LOCAL_FIRST_SHADOW === "1";
  const goianiaLocalFirstBypassEnabled = process.env.ROTTA_GOIANIA_LOCAL_FIRST_BYPASS === "1";
  const exposeGoianiaLocalFirstDiagnostics =
    goianiaLocalFirstShadowEnabled || goianiaLocalFirstBypassEnabled;
  const localFirstGoianiaShadow = lookupGoianiaLocalFirstShadow({
    city: cityForDecision,
    bairro: normalized.bairro || bairroIn,
    quadra: normalized.quadra,
    lote: normalized.lote,
  });
  const localFirstGoianiaCandidate = localFirstGoianiaShadow.candidate;
  let localFirstGoianiaCandidateEligible = false;
  let localFirstGoianiaCandidateScore: number | null = null;
  let localFirstGoianiaWouldBeatFinal = false;
  let localFirstGoianiaDistanceToFinalM: number | null = null;
  let localFirstGoianiaCandidateLat: number | null = localFirstGoianiaCandidate?.lat ?? null;
  let localFirstGoianiaCandidateLng: number | null = localFirstGoianiaCandidate?.lng ?? null;
  let localFirstGoianiaCandidateStreet: string | null = localFirstGoianiaCandidate?.streetLabel ?? null;
  let localFirstGoianiaWouldBypass = false;
  let localFirstGoianiaBypassReason: string | null = null;
  let localFirstGoianiaUsedAsFinal = false;

  const resolveGoianiaLocalFirstBypassReason = () => {
    const cityKey = normalizeKey(cityForDecision).replace(/\s+/g, "");
    if (!cityKey.includes("GOIANIA") || cityKey.includes("APARECIDA")) return "CITY_NOT_GOIANIA";
    if (!(normalized.bairro || bairroIn)) return "MISSING_BAIRRO";
    if (!normalized.quadra) return "MISSING_QUADRA";
    if (!normalized.lote) return "MISSING_LOTE";
    if (localFirstGoianiaShadow.matchType === "same_quadra") return "SAME_QUADRA";
    if (localFirstGoianiaShadow.matchType === "missing_parts") return "MISSING_PARTS";
    if (localFirstGoianiaShadow.matchType === "bairro_not_found") return "BAIRRO_NOT_FOUND";
    if (!localFirstGoianiaShadow.found || !localFirstGoianiaCandidate) return "NO_LOCAL_CANDIDATE";
    if (
      localFirstGoianiaShadow.matchType !== "exact" &&
      localFirstGoianiaShadow.matchType !== "compound_lot"
    ) {
      return "NO_LOCAL_CANDIDATE";
    }
    if (localFirstGoianiaShadow.confidence !== "HIGH") return "NOT_HIGH_CONFIDENCE";
    if (
      typeof localFirstGoianiaShadow.distanceM !== "number" ||
      localFirstGoianiaShadow.distanceM > 120
    ) {
      return "DISTANCE_OVER_LIMIT";
    }
    if (
      typeof localFirstGoianiaCandidate.lat !== "number" ||
      typeof localFirstGoianiaCandidate.lng !== "number"
    ) {
      return "NO_LOCAL_CANDIDATE";
    }
    return "WOULD_BYPASS";
  };

  localFirstGoianiaBypassReason = resolveGoianiaLocalFirstBypassReason();
  localFirstGoianiaWouldBypass = localFirstGoianiaBypassReason === "WOULD_BYPASS";
  localFirstGoianiaCandidateEligible = localFirstGoianiaWouldBypass;
  const goianiaVerticalCondoCityKey = normalizeKey(cityForDecision).replace(/\s+/g, "");
  const goianiaVerticalCondoDetected =
    goianiaVerticalCondoCityKey.includes("GOIANIA") &&
    !goianiaVerticalCondoCityKey.includes("APARECIDA") &&
    memoryKeyPlan.condoPlan.shouldAttempt &&
    memoryKeyPlan.condoPlan.hasVerticalSignal;
  const goianiaVerticalCondoMemoryHit = goianiaVerticalCondoDetected && !!memoryHit;

// 3) GEOLOCALIZAÇÃO: ✅ prioriza MEMÓRIA GLOBAL; se não tiver, usa HERE
  let lat: number | null = memoryHit?.lat ?? approxMemoryHit?.lat ?? null;
  let lng: number | null = memoryHit?.lng ?? approxMemoryHit?.lng ?? null;

  // 🔒 variáveis que vão ser usadas mais abaixo (mesmo se pular HERE)
  let decisionReason: string = memoryHit
    ? memoryHitKind === "base"
      ? "MEMORY_HIT_BASE"
      : "MEMORY_HIT"
    : approxMemoryHit
      ? "MEMORY_APPROX_HIT"
    : "OK_CONFIDENT";
  let bestHereScore = memoryHit || approxMemoryHit ? 999 : -999;
  let bestItem: any = null;
  let finalRankedKind: "geocode" | "discover" | "local" | null = null;
  let aparecidaLowConfidence: { downgrade: boolean; clearCoords: boolean } | null = null;
  let localLotCandidateFound = false;
  let localLotStrongMatch = false;
  let localLotBoostApplied = false;
  let localLotUsedAsFinal = false;
  let localLotBlockedByBairro = false;
  let localLotQuadra = "";
  let localLotLote = "";
  let localLotBairro = "";
  let localLotLocalAliasAccepted = false;
  let localLotBairroDivergenteLocalForte = false;
  let localLotBairroMismatchLocalFirst = false;
  let localLotCanFinalizeLocalFirst = true;
  let localLotFinalItem: any = null;
  let localLotFinalScore = -999;
  let localLotFinalArc: any = null;
  let localFirstBypassHere = false;
  let localFirstMatchedBy: "normalized" | "original" | null = null;
  let aparecidaBlockedLocalFirstPair: AparecidaBlockedLocalFirstPair | null = null;
  let partialStreetFallbackUsed = false;
  let partialStreetFallbackReason: "PARTIAL_STREET_LEVEL_MATCH" | "PARTIAL_SECTOR_MATCH" | null = null;

  let enriched: RankedHereEntryWithArcgis[] = [];
  let bestArcgisFromTop: any = null;

  let hereUncertain = false;
  let hereSpreadMeters = 0;
  let discoverGateDebug: DiscoverGateDebugRow | null = null;
  let googleCommercialFallbackAttempted = false;
  let googleCommercialFallbackFound = false;
  let googleCommercialFallbackRejectedReason: string | null = null;
  let googleCommercialFallbackQuery: string | null = null;
  let googleCommercialFallbackCommercialName: string | null = null;
  let googleCommercialFallbackScore: number | null = null;
  let googleCommercialFallbackSimilarity: number | null = null;
  let googleCommercialFallbackDistanceM: number | null = null;
  let googleCommercialFallbackLat: number | null = null;
  let googleCommercialFallbackLng: number | null = null;
  let googleCommercialFallbackTitle: string | null = null;
  let googleCommercialFallbackApplied = false;

  // ✅ Só roda HERE quando NÃO tiver memória
  const scored: RankedHereEntry[] = [];

  if (
    goianiaLocalFirstBypassEnabled &&
    localFirstGoianiaWouldBypass &&
    localFirstGoianiaCandidate
  ) {
    const localCandidateLat = localFirstGoianiaCandidate.lat as number;
    const localCandidateLng = localFirstGoianiaCandidate.lng as number;
    const localAddressLabel = cleanAddressForHere(
      [
        localFirstGoianiaCandidate.streetLabel || normalized.rua || "Goiânia",
        `Quadra ${localFirstGoianiaCandidate.quadra}`,
        `Lote ${localFirstGoianiaCandidate.lote}`,
        localFirstGoianiaCandidate.bairro || normalized.bairro || bairroIn,
        normalized.cidade || cityIn || "Goiânia",
        normalized.estado || "GO",
        normalizeCep(normalized.cep || cepIn),
      ]
        .filter(Boolean)
        .join(", "),
    );

    bestItem = {
      title: localAddressLabel,
      id: `goiania-local-first:${localFirstGoianiaShadow.key}`,
      resultType: "street",
      address: {
        label: localAddressLabel,
        countryCode: "BRA",
        countryName: "Brasil",
        stateCode: "GO",
        state: "Goiás",
        city: normalized.cidade || cityIn || "Goiânia",
        district: localFirstGoianiaCandidate.bairro || normalized.bairro || bairroIn || "",
        street: localFirstGoianiaCandidate.streetLabel || normalized.rua || "",
        postalCode: normalizeCep(normalized.cep || cepIn),
      },
      position: {
        lat: localCandidateLat,
        lng: localCandidateLng,
      },
    };
    bestHereScore = 999;
    finalRankedKind = "local";
    lat = localCandidateLat;
    lng = localCandidateLng;
    decisionReason = "LOCAL_GOIANIA_FIRST_SAFE_BYPASS";
    localFirstBypassHere = true;
    localFirstGoianiaUsedAsFinal = true;
  }

  if (isAparecida && !memoryHit && !approxMemoryHit && normalized.quadra && normalized.lote) {
    const localFirstCandidate = pickAparecidaLocalFirstCandidate({
      quadra: normalized.quadra,
      lote: normalized.lote,
      normalizedBairro: normalized.bairro || "",
      originalBairro: bairroIn || "",
      rua: normalized.rua,
      cidade: normalized.cidade || cityIn,
      cep: normalized.cep || cepIn,
    });

    if (localFirstCandidate?.candidate) {
      const localAparecidaCandidate = localFirstCandidate.candidate;
      const localAddressLabel = cleanAddressForHere(
        [
          normalized.rua || "Aparecida",
          localAparecidaCandidate.quadra ? `Quadra ${localAparecidaCandidate.quadra}` : "",
          localAparecidaCandidate.lote ? `Lote ${localAparecidaCandidate.lote}` : "",
          localAparecidaCandidate.bairro || normalized.bairro || bairroIn,
          normalized.cidade || cityIn || "Aparecida de Goiânia",
          normalized.estado || "GO",
          normalizeCep(normalized.cep || cepIn),
        ]
          .filter(Boolean)
          .join(", "),
      );

      const localItem = {
        title: localAddressLabel,
        id: `aparecida-local:${localAparecidaCandidate.quadra}:${localAparecidaCandidate.lote}:${normalizeKey(localAparecidaCandidate.bairro)}`,
        resultType: "street",
        address: {
          label: localAddressLabel,
          countryCode: "BRA",
          countryName: "Brasil",
          stateCode: "GO",
          state: "Goiás",
          city: normalized.cidade || cityIn || "Aparecida de Goiânia",
          district: localAparecidaCandidate.bairro || normalized.bairro || bairroIn || "",
          street: normalized.rua || "",
          postalCode: normalizeCep(normalized.cep || cepIn),
        },
        position: {
          lat: localAparecidaCandidate.centroid.lat,
          lng: localAparecidaCandidate.centroid.lng,
        },
      };

      const localArc = {
        found: true,
        quadra: localAparecidaCandidate.quadra,
        lote: localAparecidaCandidate.lote,
        bairro: localAparecidaCandidate.bairro,
      };

      const localRerank = scoreAparecidaRerankCandidate({
        baseScore: scoreHereItemSmart(localItem, {
          cep: normalized.cep || cepIn,
          city: normalized.cidade || cityIn,
          bairro: normalized.bairro || bairroIn,
          rua: normalized.rua,
          quadra: normalized.quadra,
          lote: normalized.lote,
        }),
        item: localItem,
        arc: localArc,
        wantArc: {
          quadra: localAparecidaCandidate.quadra,
          lote: localAparecidaCandidate.lote,
          bairro: localAparecidaCandidate.bairro,
        },
        expected: {
          rua: normalized.rua,
          bairro: normalized.bairro || bairroIn,
          cidade: normalized.cidade || cityIn,
          cep: normalized.cep || cepIn,
          quadra: normalized.quadra,
          lote: normalized.lote,
        },
        hereSpreadMeters: 0,
      });

      localLotCandidateFound = true;
      localLotStrongMatch = true;
      localLotQuadra = localAparecidaCandidate.quadra || "";
      localLotLote = localAparecidaCandidate.lote || "";
      localLotBairro = localAparecidaCandidate.bairro || "";
      localLotLocalAliasAccepted = !!localAparecidaCandidate.localAliasAccepted;
      localLotBairroDivergenteLocalForte = !!localAparecidaCandidate.bairroDivergenteLocalForte;
      localFirstMatchedBy = localFirstCandidate.matchedBy;

      aparecidaBlockedLocalFirstPair = buildAparecidaBlockedLocalFirstPair({
        isAparecida,
        localLotCandidateFound,
        localLotLocalAliasAccepted,
        expectedBairro: normalized.bairro || bairroIn,
        localBairro: localLotBairro,
        quadra: localLotQuadra,
        lote: localLotLote,
      });

      if (aparecidaBlockedLocalFirstPair) {
        localLotBlockedByBairro = true;
        console.info("[APARECIDA_BLOCKED_LOCAL_FIRST_PAIR]", {
          sequence: row?.sequence ?? "",
          ...aparecidaBlockedLocalFirstPair,
        });
      } else {
        localLotBoostApplied = true;
        localLotUsedAsFinal = true;
        localLotFinalItem = localItem;
        localLotFinalScore = localRerank.total;
        localLotFinalArc = localArc;

        bestItem = localItem;
        bestArcgisFromTop = localArc;
        bestHereScore = localRerank.total;
        finalRankedKind = "local";
        lat = localAparecidaCandidate.centroid.lat;
        lng = localAparecidaCandidate.centroid.lng;
        scored.push({
          it: localItem,
          score: localRerank.total,
          from: "LOCAL_APARECIDA_LOT",
          kind: "geocode",
        });

        localFirstBypassHere = true;

        console.info("[LOCAL_FIRST_HIT]", {
          sequence: row?.sequence ?? "",
          matchedBy: localFirstMatchedBy,
          quadra: localLotQuadra,
          lote: localLotLote,
          bairro: localLotBairro,
          flags: [
            ...(localAparecidaCandidate.bairroDivergenteLocalForte
              ? ["BAIRRO_DIVERGENTE_LOCAL_FORTE"]
              : []),
            ...(localAparecidaCandidate.localAliasAccepted
              ? ["LOCAL_ALIAS_ACCEPTED"]
              : []),
          ],
        });
        console.info("[LOCAL_FIRST_BYPASS_HERE]", {
          sequence: row?.sequence ?? "",
          query: "LOCAL_APARECIDA_LOT",
          quadra: localLotQuadra,
          lote: localLotLote,
          bairro: localLotBairro,
        });
      }
    }
  }

  if (!memoryHit && !approxMemoryHit && !localFirstBypassHere) {
    discoverGateDebug = {
      preliminaryGeocodeConfidence: null,
      preliminaryGeocodeHardMismatch: false,
      preliminaryGeocodeFlags: [],
      discoverQualityAllowed: false,
      discoverQualityReason: "DISCOVER_NOT_EVALUATED",
      acceptedEarly: false,
      shouldBypassAcceptedEarly: false,
      acceptedEarlyBypassReason: null,
      budgetAllowed: null,
      budgetReason: null,
      discoverAttempted: false,
      discoverReserved: false,
      discoverSeenInTop5: false,
      discoverWonFinalRanking: false,
    };

    // base "at": se for Aparecida, começa perto de Aparecida; senão Goiânia
    const atBase = isAparecida ? "-16.8230,-49.2470" : "-16.8233,-49.2439";

    const atByCep = normalized.cep ? await getAtByCep(normalized.cep, normalized.cidade || cityIn) : null;
    const at = atByCep || atBase;

    const baseQueries = buildHereQueryVariants({
      rua: normalized.rua,
      numero: normalized.numero,
      bairro: normalized.bairro || bairroIn,
      cidade: normalized.cidade || cityIn,
      estado: normalized.estado || "GO",
      cep: normalized.cep || cepIn,
      original: addressRaw,
      normalizedLine,
    });

    const urbanPattern = buildUrbanPatternQueries({
      original: addressRaw,
      rua: normalized.rua,
      bairro: normalized.bairro || bairroIn,
      cidade: normalized.cidade || cityIn,
      estado: normalized.estado || "GO",
      cep: normalized.cep || cepIn,
      quadra: normalized.quadra,
      lote: normalized.lote,
    });

    const urbanPatternRealQueryApplication = applyUrbanPatternToRealQueries({
      queries: baseQueries,
      urbanPattern: urbanPattern,
      city: normalized.cidade || cityIn,
    });

    const queriesForHere = urbanPatternRealQueryApplication.updatedQueries;
    urbanPatternAppliedToRealQueries = urbanPatternRealQueryApplication.appliedToRealQueries;
    urbanPatternAppliedReason = urbanPatternRealQueryApplication.appliedReason;
    urbanPatternReplacedQuery = urbanPatternRealQueryApplication.replacedQuery;
    urbanPatternRealQueryIndex = urbanPatternRealQueryApplication.realQueryIndex;

    let queriesWithHint = queriesForHere;

    if (approxMemoryTextHint?.suggestedAddressLine) {
      approxHintApplied = true;
      approxHintReason = approxMemoryTextHint.reason || "MEMORY_TEXT_HINT";
      approxHintFieldsUsed = ["street_text_hint", "bairro_text_hint"];
      approxHintSource = "TEXT_HINT";

      queriesWithHint = [
        approxMemoryTextHint.suggestedAddressLine,
        ...queriesForHere.filter((q) => q !== approxMemoryTextHint?.suggestedAddressLine),
      ];
    } else if (approxShadowSearchHint?.suggestedAddressLine) {
      approxHintApplied = true;
      approxHintReason = approxShadowSearchHint.reason;
      approxHintFieldsUsed = approxShadowSearchHint.fieldsUsed;
      approxHintSource = "SHADOW_MEDIUM";
      approxMemoryUsedAsHint = true;

      queriesWithHint = Array.from(
        new Set([
          queriesForHere[0] || "",
          approxShadowSearchHint.suggestedAddressLine,
          ...queriesForHere.slice(1),
        ].filter(Boolean)),
      ).slice(0, 3);
    }

    const want = {
      cep: normalized.cep || cepIn,
      city: normalized.cidade || cityIn,
      bairro: normalized.bairro || bairroIn,
      rua: normalized.rua,
      quadra: normalized.quadra,
      lote: normalized.lote,
    };

    const seen = new Map<string, any>();
    const EARLY_ACCEPT_SCORE = 105;
    let bestGeocodeScoreOverall = -999;
    let bestGeocodeQuery = queriesWithHint[0] || "";
    let bestGeocodeItem: any = null;
    let preliminaryGeocodeConfidence: number | null = null;
    let preliminaryGeocodeHardMismatch = false;
    let preliminaryGeocodeFlags: string[] = [];
    let acceptedEarly = false;
    let geocodeItemCount = 0;
    let geocodeItemsWithCoords = 0;

    // ✅ coleta candidatos de TODAS queries e escolhe o melhor no final
    for (const qTry of queriesWithHint) {
      const g1 = await hereGeocode(qTry, at);
      let bestGeocodeScoreForQuery = -999;
      if (Array.isArray(g1.all) && g1.all.length) {
        for (const it of g1.all) {
          geocodeItemCount += 1;
          if (
            typeof it?.position?.lat === "number" &&
            typeof it?.position?.lng === "number"
          ) {
            geocodeItemsWithCoords += 1;
          }

          const key = dedupeKeyForHere(it);
          if (seen.has(key)) continue;
          seen.set(key, it);
          const sc = scoreHereItemSmart(it, want);
          if (sc > bestGeocodeScoreForQuery) bestGeocodeScoreForQuery = sc;
          if (sc > bestGeocodeScoreOverall) {
            bestGeocodeScoreOverall = sc;
            bestGeocodeQuery = qTry;
            bestGeocodeItem = it;
          }
          scored.push({ it, score: sc, from: qTry, kind: "geocode" });
        }
      }

      if (bestGeocodeScoreForQuery >= EARLY_ACCEPT_SCORE) {
        acceptedEarly = true;
        break;
      }
    }

    const initialGeocodeOnlyTopPoints = scored
      .filter((x) => x.kind === "geocode")
      .slice(0, 2)
      .map((x) => x.it?.position)
      .filter(
        (p): p is { lat: number; lng: number } =>
          !!p && typeof p.lat === "number" && typeof p.lng === "number",
      );

    const initialPreliminaryGeocodeSpreadMeters =
      initialGeocodeOnlyTopPoints.length >= 2 ? maxPairDistanceMeters(initialGeocodeOnlyTopPoints) : 0;

    const initialPreliminaryConfidenceDiag = bestGeocodeItem
      ? computeGeocodeConfidence({
          source: "HERE_GEOCODE",
          expected: {
            rua: normalized.rua,
            bairro: normalized.bairro || bairroIn,
            cidade: normalized.cidade || cityIn,
            cep: normalized.cep || cepIn,
            quadra: normalized.quadra,
            lote: normalized.lote,
          },
          actual: {
            rua: String(bestGeocodeItem?.address?.street || ""),
            bairro: String(
              bestGeocodeItem?.address?.district ||
                bestGeocodeItem?.address?.subdistrict ||
                "",
            ),
            cidade: String(
              bestGeocodeItem?.address?.city ||
                bestGeocodeItem?.address?.county ||
                "",
            ),
            cep: String(bestGeocodeItem?.address?.postalCode || ""),
            resultType: String(bestGeocodeItem?.resultType || ""),
          },
          hasCoords:
            typeof bestGeocodeItem?.position?.lat === "number" &&
            typeof bestGeocodeItem?.position?.lng === "number",
          hasQuadra: !!normalized.quadra,
          hasLote: !!normalized.lote,
          hereSpreadMeters: initialPreliminaryGeocodeSpreadMeters,
          memoryStrength: "NONE",
          hardSignals: initialPreliminaryGeocodeSpreadMeters > 250 ? ["HERE_UNCERTAIN"] : [],
        })
      : null;

    const shouldTryAparecidaRecovery =
      isAparecida &&
      !memoryHit &&
      !approxMemoryHit &&
      (!!bestGeocodeItem || bestGeocodeScoreOverall < 0) &&
      !!initialPreliminaryConfidenceDiag &&
      (
        initialPreliminaryConfidenceDiag.hardMismatch ||
        initialPreliminaryConfidenceDiag.flags.includes("BAIRRO_MISMATCH") ||
        initialPreliminaryConfidenceDiag.flags.includes("RUA_MISMATCH") ||
        initialPreliminaryConfidenceDiag.flags.includes("CIDADE_MISMATCH") ||
        initialPreliminaryConfidenceDiag.flags.includes("HERE_SPREAD_HIGH") ||
        initialPreliminaryGeocodeSpreadMeters > 250 ||
        bestGeocodeScoreOverall < 120
      );

    if (shouldTryAparecidaRecovery) {
      const recoveryQueries = buildAparecidaRecoveryQueries({
        rua: normalized.rua,
        bairro: normalized.bairro || bairroIn,
        cidade: normalized.cidade || cityIn,
        estado: normalized.estado || "GO",
        quadra: normalized.quadra,
        lote: normalized.lote,
      });

      if (recoveryQueries.length) {
        console.info("[APARECIDA_RECOVERY_CHECK]", {
          initialScore: bestGeocodeScoreOverall,
          initialFlags: initialPreliminaryConfidenceDiag.flags,
          queries: recoveryQueries,
        });

        for (const qTry of recoveryQueries) {
          const g1 = await hereGeocode(qTry, at);
          let bestGeocodeScoreForQuery = -999;
          if (Array.isArray(g1.all) && g1.all.length) {
            for (const it of g1.all) {
              geocodeItemCount += 1;
              if (
                typeof it?.position?.lat === "number" &&
                typeof it?.position?.lng === "number"
              ) {
                geocodeItemsWithCoords += 1;
              }

              const key = dedupeKeyForHere(it);
              if (seen.has(key)) continue;
              seen.set(key, it);
              const sc = scoreHereItemSmart(it, want);
              if (sc > bestGeocodeScoreForQuery) bestGeocodeScoreForQuery = sc;
              if (sc > bestGeocodeScoreOverall) {
                bestGeocodeScoreOverall = sc;
                bestGeocodeQuery = qTry;
                bestGeocodeItem = it;
              }
              scored.push({ it, score: sc, from: qTry, kind: "geocode" });
            }
          }

          if (bestGeocodeScoreForQuery >= EARLY_ACCEPT_SCORE) {
            acceptedEarly = true;
            break;
          }
        }
      }
    }

    const localAparecidaCandidate = isAparecida
      ? findAparecidaLocalLotCandidate({
          quadra: normalized.quadra,
          lote: normalized.lote,
          bairro: normalized.bairro || bairroIn,
          planilhaBairro: bairroIn || normalized.bairro || "",
          rua: normalized.rua,
          cidade: normalized.cidade || cityIn,
          cep: normalized.cep || cepIn,
        })
      : null;

    if (localAparecidaCandidate) {
      localLotCandidateFound = true;
      localLotStrongMatch = !!localAparecidaCandidate.strongMatch;
      localLotQuadra = localAparecidaCandidate.quadra || "";
      localLotLote = localAparecidaCandidate.lote || "";
      localLotBairro = localAparecidaCandidate.bairro || "";
      localLotLocalAliasAccepted = !!localAparecidaCandidate.localAliasAccepted;
      localLotBairroDivergenteLocalForte = !!localAparecidaCandidate.bairroDivergenteLocalForte;
      localLotBairroMismatchLocalFirst = !!localAparecidaCandidate.bairroMismatchLocalFirst;
      localLotCanFinalizeLocalFirst = localAparecidaCandidate.canFinalizeLocalFirst !== false;

      const localBlockedPair = buildAparecidaBlockedLocalFirstPair({
        isAparecida,
        localLotCandidateFound,
        localLotLocalAliasAccepted,
        expectedBairro: normalized.bairro || bairroIn,
        localBairro: localLotBairro,
        quadra: localLotQuadra,
        lote: localLotLote,
      });
      if (localBlockedPair && !aparecidaBlockedLocalFirstPair) {
        aparecidaBlockedLocalFirstPair = localBlockedPair;
        localLotBlockedByBairro = true;
        console.info("[APARECIDA_BLOCKED_LOCAL_FIRST_PAIR]", {
          sequence: row?.sequence ?? "",
          ...aparecidaBlockedLocalFirstPair,
        });
      }

      const localAddressLabel = cleanAddressForHere(
        [
          normalized.rua || "Aparecida",
          localAparecidaCandidate.quadra ? `Quadra ${localAparecidaCandidate.quadra}` : "",
          localAparecidaCandidate.lote ? `Lote ${localAparecidaCandidate.lote}` : "",
          localAparecidaCandidate.bairro || normalized.bairro || bairroIn,
          normalized.cidade || cityIn || "Aparecida de Goiânia",
          normalized.estado || "GO",
          normalizeCep(normalized.cep || cepIn),
        ]
          .filter(Boolean)
          .join(", "),
      );

      const localItem = {
        title: localAddressLabel,
        id: `aparecida-local:${localAparecidaCandidate.quadra}:${localAparecidaCandidate.lote}:${normalizeKey(localAparecidaCandidate.bairro)}`,
        resultType: "street",
        address: {
          label: localAddressLabel,
          countryCode: "BRA",
          countryName: "Brasil",
          stateCode: "GO",
          state: "Goiás",
          city: normalized.cidade || cityIn || "Aparecida de Goiânia",
          district: localAparecidaCandidate.bairro || normalized.bairro || bairroIn || "",
          street: normalized.rua || "",
          postalCode: normalizeCep(normalized.cep || cepIn),
        },
        position: {
          lat: localAparecidaCandidate.centroid.lat,
          lng: localAparecidaCandidate.centroid.lng,
        },
      };

      const localKey = dedupeKeyForHere(localItem);
      const localArc = {
        found: true,
        quadra: localAparecidaCandidate.quadra,
        lote: localAparecidaCandidate.lote,
        bairro: localAparecidaCandidate.bairro,
      };
      if (
        !aparecidaBlockedLocalFirstPair &&
        !localLotBlockedByBairro &&
        !seen.has(localKey)
      ) {
        localLotFinalArc = localArc;
        seen.set(localKey, localItem);
        const localRerank = scoreAparecidaRerankCandidate({
          baseScore: scoreHereItemSmart(localItem, want),
          item: localItem,
          arc: localArc,
          wantArc: {
            quadra: localAparecidaCandidate.quadra,
            lote: localAparecidaCandidate.lote,
            bairro: localAparecidaCandidate.bairro,
          },
          expected: {
            rua: normalized.rua,
            bairro: normalized.bairro || bairroIn,
            cidade: normalized.cidade || cityIn,
            cep: normalized.cep || cepIn,
            quadra: normalized.quadra,
            lote: normalized.lote,
          },
          hereSpreadMeters: initialPreliminaryGeocodeSpreadMeters,
        });
        const localScore = localRerank.total;
        localLotBoostApplied = true;
        localLotFinalItem = localItem;
        localLotFinalScore = localScore;
        localLotFinalArc = localArc;
        scored.push({
          it: localItem,
          score: localScore,
          from: "LOCAL_APARECIDA_LOT",
          kind: "geocode",
        });
        if (localScore > bestGeocodeScoreOverall) {
          bestGeocodeScoreOverall = localScore;
          bestGeocodeQuery = "LOCAL_APARECIDA_LOT";
          bestGeocodeItem = localItem;
        }

        if (localLotBairroMismatchLocalFirst) {
          console.info("[BAIRRO_MISMATCH_LOCALFIRST]", {
            sequence: row?.sequence ?? "",
            planilhaBairro: bairroIn || "",
            localBairro: localLotBairro,
            quadra: localLotQuadra,
            lote: localLotLote,
            matchedBy: localFirstMatchedBy,
          });
        }
      }
    }

    approxHintBecameBestGeocodeQuery =
      approxHintApplied &&
      !!bestGeocodeQuery &&
      (
        bestGeocodeQuery === approxMemoryTextHint?.suggestedAddressLine ||
        bestGeocodeQuery === approxShadowSearchHint?.suggestedAddressLine
      );

    urbanPatternBecameBestGeocodeQuery =
      urbanPatternAppliedToRealQueries &&
      !!bestGeocodeQuery &&
      bestGeocodeQuery === urbanPatternQuery;

    const cityForSpread = normalized.cidade || cityIn || "";
    const cityForSpreadKey = normalizeKey(cityForSpread).replace(/\s+/g, "");
    const isGoianiaForSpread =
      cityForSpreadKey.includes("GOIANIA") && !cityForSpreadKey.includes("APARECIDA");
    const geocodeSpreadCandidates = isGoianiaForSpread
      ? [...scored].sort((a, b) => b.score - a.score)
      : scored;

    const geocodeOnlyTopPoints = geocodeSpreadCandidates
      .filter((x) => x.kind === "geocode")
      .slice(0, 2)
      .map((x) => x.it?.position)
      .filter(
        (p): p is { lat: number; lng: number } =>
          !!p && typeof p.lat === "number" && typeof p.lng === "number",
      );

    const preliminaryGeocodeSpreadMeters =
      geocodeOnlyTopPoints.length >= 2 ? maxPairDistanceMeters(geocodeOnlyTopPoints) : 0;

    if (debugMemory) {
      urbanPatternDetected = urbanPattern.detected;
      urbanPatternType = urbanPattern.type;
      urbanPatternQuery = urbanPattern.query;

      const urbanQueryNormalized = cleanAddressForHere(urbanPattern.query || "");
      const existingQueriesNormalized = new Set(
        baseQueries.map((q) => cleanAddressForHere(q || "")),
      );

      if (urbanPattern.detected && urbanPattern.query && urbanQueryNormalized && !existingQueriesNormalized.has(urbanQueryNormalized)) {
        const urbanGeocode = await hereGeocode(urbanPattern.query, at);
        let urbanBestScore = -999;
        let urbanBestItem: any = null;
        const urbanSeen = new Set<string>();
        const urbanScored: RankedHereEntry[] = [];

        if (Array.isArray(urbanGeocode.all) && urbanGeocode.all.length) {
          for (const it of urbanGeocode.all) {
            const key = dedupeKeyForHere(it);
            if (urbanSeen.has(key)) continue;
            urbanSeen.add(key);
            const sc = scoreHereItemSmart(it, want);
            if (sc > urbanBestScore) {
              urbanBestScore = sc;
              urbanBestItem = it;
            }
            urbanScored.push({ it, score: sc, from: urbanPattern.query, kind: "geocode" });
          }
        }

        const urbanTopPoints = urbanScored
          .slice(0, 2)
          .map((x) => x.it?.position)
          .filter(
            (p): p is { lat: number; lng: number } =>
              !!p && typeof p.lat === "number" && typeof p.lng === "number",
          );

        const urbanSpreadMeters =
          urbanTopPoints.length >= 2 ? maxPairDistanceMeters(urbanTopPoints) : null;

        urbanPatternImprovedRanking = urbanBestScore > bestGeocodeScoreOverall;
        urbanPatternBestCandidateKind = urbanBestItem ? "geocode" : null;
        urbanPatternSpreadReduction =
          preliminaryGeocodeSpreadMeters > 0 && urbanSpreadMeters != null
            ? preliminaryGeocodeSpreadMeters - urbanSpreadMeters
            : null;
        urbanPatternWouldReplaceWeakQuery =
          urbanPatternImprovedRanking && bestGeocodeScoreOverall < 70;
      } else {
        urbanPatternImprovedRanking = false;
        urbanPatternBestCandidateKind = null;
        urbanPatternSpreadReduction = null;
        urbanPatternWouldReplaceWeakQuery = false;
      }
    }

    if (bestGeocodeItem) {
      const preliminaryConfidenceDiag = computeGeocodeConfidence({
        source: "HERE_GEOCODE",
        expected: {
          rua: normalized.rua,
          bairro: normalized.bairro || bairroIn,
          cidade: normalized.cidade || cityIn,
          cep: normalized.cep || cepIn,
          quadra: normalized.quadra,
          lote: normalized.lote,
        },
        actual: {
          rua: String(bestGeocodeItem?.address?.street || ""),
          bairro: String(
            bestGeocodeItem?.address?.district ||
              bestGeocodeItem?.address?.subdistrict ||
              "",
          ),
          cidade: String(
            bestGeocodeItem?.address?.city ||
              bestGeocodeItem?.address?.county ||
              "",
          ),
          cep: String(bestGeocodeItem?.address?.postalCode || ""),
          resultType: String(bestGeocodeItem?.resultType || ""),
        },
        hasCoords:
          typeof bestGeocodeItem?.position?.lat === "number" &&
          typeof bestGeocodeItem?.position?.lng === "number",
        hasQuadra: !!normalized.quadra,
        hasLote: !!normalized.lote,
        hereSpreadMeters: preliminaryGeocodeSpreadMeters,
        memoryStrength: "NONE",
        hardSignals: preliminaryGeocodeSpreadMeters > 250 ? ["HERE_UNCERTAIN"] : [],
      });

      preliminaryGeocodeConfidence = preliminaryConfidenceDiag.confidence;
      preliminaryGeocodeHardMismatch = preliminaryConfidenceDiag.hardMismatch;
      preliminaryGeocodeFlags = preliminaryConfidenceDiag.flags;
    }

    if (discoverGateDebug) {
      discoverGateDebug.preliminaryGeocodeConfidence = preliminaryGeocodeConfidence;
      discoverGateDebug.preliminaryGeocodeHardMismatch = preliminaryGeocodeHardMismatch;
      discoverGateDebug.preliminaryGeocodeFlags = preliminaryGeocodeFlags;
      discoverGateDebug.acceptedEarly = acceptedEarly;
    }

    console.info("[DISCOVER_QUALITY_CHECK]", {
      geocodeItemCount,
      geocodeItemsWithCoords,
      bestGeocodeScoreOverall,
      preliminaryGeocodeConfidence,
      preliminaryGeocodeHardMismatch,
      preliminaryGeocodeFlags,
    });

    const discoverQualityDecision = shouldAttemptDiscoverFromQuality({
      geocodeItemCount,
      geocodeItemsWithCoords,
      bestGeocodeScoreOverall,
      bestGeocodeItem,
      expectedCity: normalized.cidade || cityIn,
      expectedBairro: normalized.bairro || bairroIn,
      expectedRua: normalized.rua,
      discoverQuery: bestGeocodeQuery || queriesWithHint[0] || "",
      geocodeConfidence: preliminaryGeocodeConfidence ?? undefined,
      geocodeHardMismatch: preliminaryGeocodeHardMismatch,
      geocodeFlags: preliminaryGeocodeFlags,
    });

    if (discoverGateDebug) {
      discoverGateDebug.discoverQualityAllowed = discoverQualityDecision.allowed;
      discoverGateDebug.discoverQualityReason = discoverQualityDecision.reason;
    }

    const hasConfidenceOverrideFlag =
      preliminaryGeocodeFlags.includes("HERE_SPREAD_HIGH") ||
      preliminaryGeocodeFlags.includes("HERE_UNCERTAIN");

    const confidenceOverrideAcceptedEarly =
      preliminaryGeocodeHardMismatch &&
      hasConfidenceOverrideFlag &&
      discoverQualityDecision.allowed &&
      bestGeocodeScoreOverall < 160;

    const shouldBypassAcceptedEarly =
      acceptedEarly && confidenceOverrideAcceptedEarly;

    if (discoverGateDebug) {
      discoverGateDebug.shouldBypassAcceptedEarly = shouldBypassAcceptedEarly;
      discoverGateDebug.acceptedEarlyBypassReason = shouldBypassAcceptedEarly
        ? "HARD_MISMATCH_SPREAD_WITH_SCORE_LT_160"
        : null;
    }

    console.info("[DISCOVER_QUALITY_RESULT]", {
      allowed: discoverQualityDecision.allowed,
      reason: discoverQualityDecision.reason,
      acceptedEarly,
      shouldBypassAcceptedEarly,
    });


    if (
      (!acceptedEarly || shouldBypassAcceptedEarly) &&
      discoverQualityDecision.allowed &&
      !(localLotStrongMatch && localLotFinalItem)
    ) {
      const discoverQuery = bestGeocodeQuery || queriesWithHint[0] || "";

      if (discoverQuery) {
        // 🔥 DISCOVER LAST RESORT ONLY
        console.info("[DISCOVER_BUDGET_CHECK]");
        let budgetDecision:
          | Awaited<ReturnType<typeof getDiscoverBudgetDecision>>
          | null = null;

        try {
          budgetDecision = await getDiscoverBudgetDecision();
          if (discoverGateDebug) {
            discoverGateDebug.budgetAllowed = budgetDecision.allowed;
            discoverGateDebug.budgetReason = budgetDecision.reason;
          }
          console.info("[DISCOVER_BUDGET_RESULT]", budgetDecision);
        } catch (error) {
          console.warn("[DISCOVER_BUDGET_ERROR]", error);
          if (discoverGateDebug) {
            discoverGateDebug.budgetAllowed = false;
            discoverGateDebug.budgetReason = "DISCOVER_BUDGET_ERROR";
          }
        }

        if (!budgetDecision?.allowed) {
          // 🔥 COST GUARD: Discover blocked by budget
          console.warn("[DISCOVER_BLOCKED]", {
            reason: budgetDecision?.reason || "DISCOVER_BUDGET_ERROR",
          });
        } else {
          console.info("[DISCOVER_RESERVE_ATTEMPT]");
          let reservation:
            | Awaited<ReturnType<typeof reserveDiscoverUsage>>
            | null = null;

          try {
            reservation = await reserveDiscoverUsage();
            if (discoverGateDebug) {
              discoverGateDebug.discoverReserved = reservation.allowed;
              discoverGateDebug.budgetAllowed = reservation.allowed;
              discoverGateDebug.budgetReason = reservation.reason;
            }
            console.info("[DISCOVER_RESERVED]", reservation);
          } catch (error) {
            console.warn("[DISCOVER_RESERVE_ERROR]", error);
            if (discoverGateDebug) {
              discoverGateDebug.discoverReserved = false;
              discoverGateDebug.budgetAllowed = false;
              discoverGateDebug.budgetReason = "DISCOVER_RESERVE_ERROR";
            }
          }

          if (!reservation?.allowed) {
            // 🔥 COST GUARD: Discover blocked by budget
            console.warn("[DISCOVER_BLOCKED]", {
              reason: reservation?.reason || "DISCOVER_RESERVE_ERROR",
            });
          } else {
            if (discoverGateDebug) {
              discoverGateDebug.discoverAttempted = true;
            }
            console.info("[DISCOVER_CALL]", {
              query: discoverQuery,
            });
            const d1 = await hereDiscover(discoverQuery, at);
            if (Array.isArray(d1.all) && d1.all.length) {
              for (const it of d1.all) {
                const key = dedupeKeyForHere(it);
                if (seen.has(key)) continue;
                seen.set(key, it);
                const sc = scoreHereItemSmart(it, want);
                scored.push({ it, score: sc, from: discoverQuery, kind: "discover" });
              }
            }
          }
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    if (discoverGateDebug) {
      discoverGateDebug.discoverSeenInTop5 = scored
        .slice(0, 5)
        .some((x) => x.kind === "discover");
    }
    const bestScoredEntry = scored[0] ?? null;
    const partialStreetFallback = isAparecida && !localLotStrongMatch
      ? pickAparecidaPartialStreetCandidate({
          scored,
          rua: normalized.rua,
          bairro: normalized.bairro || bairroIn,
          cidade: normalized.cidade || cityIn,
          cep: normalized.cep || cepIn,
        })
      : null;

    // melhor candidato inicial (HERE puro)
    bestItem = bestScoredEntry?.it || null;
    bestHereScore = bestScoredEntry?.score ?? -999;
    finalRankedKind = bestScoredEntry?.kind ?? null;
    if (discoverGateDebug) {
      discoverGateDebug.discoverWonFinalRanking = bestScoredEntry?.kind === "discover";
    }

    const currentBestDiag = bestItem
      ? computeGeocodeConfidence({
          source: finalRankedKind === "discover" ? "HERE_DISCOVER" : "HERE_GEOCODE",
          expected: {
            rua: normalized.rua,
            bairro: normalized.bairro || bairroIn,
            cidade: normalized.cidade || cityIn,
            cep: normalized.cep || cepIn,
          },
          actual: {
            rua: String(bestItem?.address?.street || ""),
            bairro: String(bestItem?.address?.district || bestItem?.address?.subdistrict || ""),
            cidade: String(bestItem?.address?.city || bestItem?.address?.county || ""),
            cep: String(bestItem?.address?.postalCode || ""),
            resultType: String(bestItem?.resultType || ""),
          },
          hasCoords: !!bestItem?.position?.lat && !!bestItem?.position?.lng,
          hasQuadra: !!normalized.quadra,
          hasLote: !!normalized.lote,
          hereSpreadMeters: preliminaryGeocodeSpreadMeters,
          memoryStrength: "NONE",
          hardSignals: [],
        })
      : null;

    const currentBestNeedsPartialFallback =
      !!partialStreetFallback?.item &&
      (!bestItem ||
        !currentBestDiag ||
        currentBestDiag.hardMismatch ||
        currentBestDiag.flags.includes("RUA_MISMATCH") ||
        currentBestDiag.flags.includes("CIDADE_MISMATCH") ||
        currentBestDiag.flags.includes("BAIRRO_MISMATCH") ||
        !currentBestDiag.flags.includes("HAS_COORDS"));

    if (currentBestNeedsPartialFallback) {
      bestItem = partialStreetFallback!.item;
      bestHereScore = partialStreetFallback!.score;
      finalRankedKind = "geocode";
      partialStreetFallbackUsed = true;
      partialStreetFallbackReason = partialStreetFallback!.reason;
    } else if (partialStreetFallback?.item) {
      partialStreetFallbackUsed = true;
      partialStreetFallbackReason = partialStreetFallback.reason;
    }

    if (partialStreetFallbackUsed && partialStreetFallbackReason) {
      decisionReason = partialStreetFallbackReason;
    }

    // ✅ Aparecida: re-rank TOP 3 do HERE usando ArcGIS
    if (
      isAparecida &&
      scored.length &&
      !(localLotStrongMatch && localLotFinalItem) &&
      !(partialStreetFallbackUsed && !localLotUsedAsFinal)
    ) {
      const topK = 3;
      const top = scored.slice(0, topK);

      const wantArc = {
        quadra: normalized.quadra,
        lote: normalized.lote,
        bairro: normalized.bairro || bairroIn,
      };

      enriched = await Promise.all(
        top.map(async (x) => {
          const pos = x.it?.position;
          if (!pos?.lat || !pos?.lng) {
            return { ...x, arc: null, arcScore: -999, total: x.score - 999 };
          }

          const arc = await getAparecidaLotFromArcgis(baseOrigin, pos.lat, pos.lng);
          const rerank = scoreAparecidaRerankCandidate({
            baseScore: x.score,
            item: x.it,
            arc,
            wantArc,
            expected: {
              rua: normalized.rua,
              bairro: normalized.bairro || bairroIn,
              cidade: normalized.cidade || cityIn,
              cep: normalized.cep || cepIn,
              quadra: normalized.quadra,
              lote: normalized.lote,
            },
            hereSpreadMeters: preliminaryGeocodeSpreadMeters,
          });

          return { ...x, arc, total: rerank.total };
        }),
      );

      enriched.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));

      if (enriched[0]?.it) {
        bestItem = enriched[0].it;
        bestArcgisFromTop = enriched[0].arc || null;
        bestHereScore = enriched[0].total ?? enriched[0].score ?? bestHereScore;
        finalRankedKind = enriched[0].kind ?? finalRankedKind;
      }
    }

    if (
      isAparecida &&
      localLotStrongMatch &&
      localLotFinalItem &&
      !localLotBlockedByBairro
    ) {
      bestItem = localLotFinalItem;
      bestArcgisFromTop = localLotFinalArc || bestArcgisFromTop;
      bestHereScore = Math.max(bestHereScore, localLotFinalScore);
      finalRankedKind = "local";
      localLotUsedAsFinal = true;
    }

    if (isAparecida && bestItem) {
      const finalConfidenceDiag = computeGeocodeConfidence({
        source:
          finalRankedKind === "discover"
            ? "HERE_DISCOVER"
            : finalRankedKind === "local"
              ? "LOCAL_APARECIDA_LOT"
              : "HERE_GEOCODE",
        expected: {
          rua: normalized.rua,
          bairro: normalized.bairro || bairroIn,
          cidade: normalized.cidade || cityIn,
          cep: normalized.cep || cepIn,
          quadra: normalized.quadra,
          lote: normalized.lote,
        },
        actual: {
          rua: String(bestItem?.address?.street || ""),
          bairro: String(bestItem?.address?.district || bestItem?.address?.subdistrict || ""),
          cidade: String(bestItem?.address?.city || bestItem?.address?.county || ""),
          cep: String(bestItem?.address?.postalCode || ""),
          resultType: String(bestItem?.resultType || ""),
        },
        hasCoords: !!bestItem?.position?.lat && !!bestItem?.position?.lng,
        hasQuadra: !!normalized.quadra,
        hasLote: !!normalized.lote,
        hereSpreadMeters: preliminaryGeocodeSpreadMeters,
        memoryStrength: "NONE",
        hardSignals: preliminaryGeocodeHardMismatch ? ["HERE_UNCERTAIN"] : [],
      });

      const finalArcStrong = !!bestArcgisFromTop?.found;
      const finalPairTooTight = scored.slice(0, 2).length >= 2 && (bestHereScore - (scored[1]?.score ?? -999)) < 25;
      const shouldDowngradeAparecida =
        finalConfidenceDiag.hardMismatch &&
        !finalArcStrong &&
        (
          finalConfidenceDiag.flags.includes("BAIRRO_MISMATCH") ||
          finalConfidenceDiag.flags.includes("RUA_MISMATCH") ||
          finalConfidenceDiag.flags.includes("CIDADE_MISMATCH") ||
          finalConfidenceDiag.flags.includes("HERE_SPREAD_HIGH") ||
          finalPairTooTight
      );

    if (shouldDowngradeAparecida && !partialStreetFallbackUsed) {
        aparecidaLowConfidence = {
          downgrade: true,
          clearCoords: lat != null && lng != null && bestHereScore < 140,
        };
      }
    }

    // coordenada final SEMPRE do bestItem
    lat = bestItem?.position?.lat ?? null;
    lng = bestItem?.position?.lng ?? null;

    const MIN_SCORE = 90;
    if (bestHereScore < MIN_SCORE && !partialStreetFallbackUsed) {
      lat = null;
      lng = null;
      decisionReason = "LOW_SCORE";
    }

    // mede “espalhamento” dos melhores candidatos
    const topN = 2;

    const spreadSource =
      isAparecida && Array.isArray(enriched) && enriched.length ? enriched : scored;

    const pts = spreadSource
      .slice(0, topN)
      .map((x: any) => x?.it?.position)
      .filter(
        (p: any): p is { lat: number; lng: number } =>
          p && typeof p.lat === "number" && typeof p.lng === "number",
      );

    hereSpreadMeters = pts.length >= 2 ? maxPairDistanceMeters(pts) : 0;
    hereUncertain = hereSpreadMeters > 250;
  }

  const bestScore = bestHereScore;

 // 4) Aparecida: usa seu mapa real (ArcGIS) pra quadra/lote/bairro (só se tiver lat/lng)
let quadraAuto = normalized.quadra || "";
let loteAuto = normalized.lote || "";
let bairroAuto = normalized.bairro || bairroIn || "";

// ✅ usa o ArcGIS do PASSO 3 (top3) quando tiver.
// se não tiver, faz 1 chamada usando o lat/lng final.
let arcgisLot: any = null;

if (
  isAparecida &&
  lat != null &&
  lng != null &&
  !memoryHit &&
  !(partialStreetFallbackUsed && !localLotUsedAsFinal)
) {
  // bestArcgisFromTop vem do PASSO 3 (top 3 do HERE)
  arcgisLot =
    (localLotStrongMatch && localLotFinalArc) ||
    ((typeof bestArcgisFromTop !== "undefined" && bestArcgisFromTop) ? bestArcgisFromTop : null);

  // fallback: se o PASSO 3 não trouxe ArcGIS, busca 1x no ponto final
  if (!arcgisLot) {
    arcgisLot = await getAparecidaLotFromArcgis(baseOrigin, lat, lng);
  }

  if (arcgisLot?.found) {
    if (String(arcgisLot.quadra || "").trim()) quadraAuto = String(arcgisLot.quadra).trim();
    if (String(arcgisLot.lote || "").trim()) loteAuto = String(arcgisLot.lote).trim();
    if (String(arcgisLot.bairro || "").trim()) bairroAuto = String(arcgisLot.bairro).trim();
  }
}

  // 5) Status final (regra do Lucas)
  let status = calcStatusLucas({
    rua: normalized.rua,
    quadra: quadraAuto,
    lote: loteAuto,
    bairro: bairroAuto,
  });

  if (
    isAparecida &&
    aparecidaLowConfidence?.downgrade &&
    !(localLotUsedAsFinal && localLotStrongMatch) &&
    !partialStreetFallbackUsed
  ) {
    status = "PARCIAL";
    if (decisionReason === "OK_CONFIDENT") decisionReason = "APARECIDA_LOW_CONFIDENCE";
    if (aparecidaLowConfidence.clearCoords) {
      lat = null;
      lng = null;
    }
  }

  if (goianiaVerticalCondoMemoryHit && lat != null && lng != null) {
    status = "OK";
    decisionReason =
      memoryHitKind === "base"
        ? "GOIANIA_VERTICAL_CONDO_MEMORY_BASE"
        : "GOIANIA_VERTICAL_CONDO_MEMORY_HIT";
  }

  // ✅ apt/prédio sem QD/LT só cai no HERE se não houver memória vertical segura de Goiânia
  if (aptLike && !hasQL && lat != null && lng != null && !goianiaVerticalCondoMemoryHit) {
    const hereAddress = bestItem?.address || {};
    const hereHouseNumber = extractConservativeHereHouseNumber(hereAddress, bestItem);
    const hereStreet = normalizeKey(
      String(hereAddress?.street || hereAddress?.address?.street || ""),
    );
    const hereCity = normalizeKey(
      String(
        hereAddress?.city ||
          hereAddress?.county ||
          hereAddress?.address?.city ||
          hereAddress?.address?.county ||
          "",
      ),
    );
    const wantStreet = normalizeKey(String(normalized.rua || ""));
    const wantCity = normalizeKey(String(cityForDecision || ""));
    const wantNumber = normalizeKey(String(normalized.numero || ""));
    const hereNumber = normalizeKey(String(hereHouseNumber.number || ""));

    const streetOk =
      !!wantStreet &&
      !!hereStreet &&
      (hereStreet === wantStreet || hereStreet.includes(wantStreet) || wantStreet.includes(hereStreet));
    const cityOk =
      !!wantCity &&
      !!hereCity &&
      (hereCity === wantCity || hereCity.includes(wantCity) || wantCity.includes(hereCity));
    const numberOk = !!wantNumber && !!hereNumber && wantNumber === hereNumber;

    if (streetOk && numberOk && cityOk && !hereUncertain) {
      status = "OK";
      decisionReason = "OK_BUILDING_STREET_NUMBER";
    } else {
      status = "PARCIAL";
      decisionReason = !hereHouseNumber.confirmed || !hereNumber
        ? "BUILDING_NUMBER_UNCONFIRMED"
        : !numberOk
          ? "BUILDING_NUMBER_MISMATCH"
          : !streetOk
            ? "BUILDING_STREET_MISMATCH"
            : !cityOk
              ? "BUILDING_CITY_MISMATCH"
              : "BUILDING_STREET_ONLY";
    }
  }

// ✅ Para endereços normais: se faltar algo, rebaixa para PARCIAL
if (!aptLike && status === "OK" && (!normalized.rua || !quadraAuto || !loteAuto || lat == null || lng == null)) {
  status = "PARCIAL";
}

// ✅ se não tem lat/lng, NÃO deixa como OK (vira PARCIAL)
// (mas para apt/prédio a gente aceita OK só se tiver coord)
if (!aptLike && status === "OK" && (lat == null || lng == null)) {
  status = "PARCIAL";
  decisionReason = "NO_COORD";
}
// ✅ conflito entre Q/L do texto vs ArcGIS => vira PARCIAL (sem status novo)
const wantQ = String(normalized.quadra || "").trim();
const wantL = String(normalized.lote || "").trim();

const conflictQL =
  (wantQ && quadraAuto && wantQ !== quadraAuto) ||
  (wantL && loteAuto && wantL !== loteAuto);

if (conflictQL) {
  status = "PARCIAL";
  lat = null;
  lng = null;
  decisionReason = "QL_CONFLICT";
}
// ✅ se HERE está “espalhado”, não deixa virar OK automático
  if (hereUncertain && !(isAparecida && localLotUsedAsFinal && localLotStrongMatch)) {
    status = "PARCIAL";
    if (!partialStreetFallbackUsed) {
      decisionReason = "HERE_SPREAD";
    }
  }
// 🔒 PARTE 4.5 — TRAVA FINAL DE CONFIANÇA
if (status === "OK") {
  const buildingValidatedOk = aptLike && !hasQL && decisionReason === "OK_BUILDING_STREET_NUMBER";
  const goianiaVerticalCondoOK = goianiaVerticalCondoMemoryHit;
  const missingCore =
    !goianiaVerticalCondoOK &&
    (!normalized.rua ||
      (!buildingValidatedOk && !quadraAuto) ||
      (!buildingValidatedOk && !loteAuto) ||
      lat == null ||
      lng == null);

  if (missingCore) {
    status = "PARCIAL";
      decisionReason = "MISSING_CORE";
    }
  }

  const bestRankedAddress = bestItem?.address || {};

  const geocodeConfidenceDiag = computeGeocodeConfidence({
    source: localFirstGoianiaUsedAsFinal
      ? "LOCAL_GOIANIA_FIRST"
      : memoryHit
      ? memoryHitKind === "base"
        ? "MEMORY_BASE"
        : "MEMORY_EXACT"
      : approxMemoryHit
        ? "MEMORY_APPROX"
        : finalRankedKind === "discover"
          ? "HERE_DISCOVER"
          : finalRankedKind === "local"
            ? localFirstGoianiaUsedAsFinal
              ? "LOCAL_GOIANIA_FIRST"
              : "LOCAL_APARECIDA_LOT"
          : finalRankedKind === "geocode"
            ? "HERE_GEOCODE"
            : "NONE",
    expected: {
      rua: normalized.rua,
      bairro: normalized.bairro || bairroIn,
      cidade: normalized.cidade || cityIn,
      cep: normalized.cep || cepIn,
      quadra: normalized.quadra,
      lote: normalized.lote,
    },
    actual: {
      rua: String(bestRankedAddress?.street || ""),
      bairro: String(bestRankedAddress?.district || bestRankedAddress?.subdistrict || ""),
      cidade: String(bestRankedAddress?.city || bestRankedAddress?.county || ""),
      cep: String(bestRankedAddress?.postalCode || ""),
      resultType: String(bestItem?.resultType || ""),
    },
    hasCoords: lat != null && lng != null,
    hasQuadra: !!quadraAuto,
    hasLote: !!loteAuto,
    hereSpreadMeters,
    memoryStrength: memoryHit ? "STRONG" : approxMemoryHit ? "MEDIUM" : "NONE",
    hardSignals: [
      ...(conflictQL ? ["QL_CONFLICT"] : []),
      ...(hereUncertain ? ["HERE_UNCERTAIN"] : []),
      ...(decisionReason === "LOW_SCORE" ? ["LOW_SCORE"] : []),
    ],
  });
  const googleCommercialFallbackStatusBefore = status;
  if (
    GOOGLE_COMMERCIAL_FALLBACK_ENABLED &&
    !memoryHit &&
    !localLotUsedAsFinal &&
    !localFirstGoianiaUsedAsFinal &&
    ["PARCIAL", "HERE_SPREAD", "MISSING_CORE"].includes(googleCommercialFallbackStatusBefore)
  ) {
    const googleCommercialFallbackPlan = buildGoogleCommercialFallbackPlan({
      addressRaw,
      city: cityForDecision,
      aptLike,
      hasQL,
    });

    if (!googleCommercialFallbackPlan.shouldAttempt) {
      googleCommercialFallbackAttempted = false;
      googleCommercialFallbackRejectedReason = googleCommercialFallbackPlan.blockedReason || null;
    } else if (runState && runState.googleCommercialFallbackCalls >= GOOGLE_COMMERCIAL_FALLBACK_MAX_PER_JOB) {
      googleCommercialFallbackAttempted = false;
      googleCommercialFallbackRejectedReason = "SKIPPED_LIMIT";
      console.info("[GOOGLE_COMMERCIAL_FALLBACK_SKIPPED_LIMIT]", {
        sequence: row?.sequence ?? "",
        jobId: runState.jobId,
        calls: runState.googleCommercialFallbackCalls,
        limit: GOOGLE_COMMERCIAL_FALLBACK_MAX_PER_JOB,
        commercialName: googleCommercialFallbackPlan.commercialName,
      });
    } else {
      if (runState) {
        runState.googleCommercialFallbackCalls += 1;
      }
      googleCommercialFallbackAttempted = true;
      googleCommercialFallbackQuery = googleCommercialFallbackPlan.query;
      googleCommercialFallbackCommercialName = googleCommercialFallbackPlan.commercialName;

      console.info("[GOOGLE_COMMERCIAL_FALLBACK_ATTEMPT]", {
        sequence: row?.sequence ?? "",
        jobId: runState?.jobId ?? "",
        calls: runState?.googleCommercialFallbackCalls ?? 1,
        limit: GOOGLE_COMMERCIAL_FALLBACK_MAX_PER_JOB,
        commercialName: googleCommercialFallbackCommercialName,
        query: googleCommercialFallbackQuery,
        status,
        decisionReason,
        city: cityForDecision,
      });

      const googleCandidate = await lookupGoogleCommercialFallbackCandidate({
        query: googleCommercialFallbackQuery,
        commercialName: googleCommercialFallbackCommercialName,
        city: cityForDecision,
        currentPosition:
          lat != null && lng != null
            ? { lat, lng }
            : bestItem?.position?.lat != null && bestItem?.position?.lng != null
              ? { lat: bestItem.position.lat, lng: bestItem.position.lng }
              : null,
      });

      googleCommercialFallbackScore = googleCandidate.score;
      googleCommercialFallbackSimilarity = googleCandidate.similarity;
      googleCommercialFallbackDistanceM = googleCandidate.coordinateDistanceM;
      googleCommercialFallbackRejectedReason = googleCandidate.rejectedReason;

      if (googleCandidate.accepted && googleCandidate.item?.position) {
        googleCommercialFallbackFound = true;
        googleCommercialFallbackApplied = true;
        googleCommercialFallbackLat = googleCandidate.item.position.lat ?? null;
        googleCommercialFallbackLng = googleCandidate.item.position.lng ?? null;
        googleCommercialFallbackTitle = String(googleCandidate.item.title || "");
        lat = googleCommercialFallbackLat;
        lng = googleCommercialFallbackLng;
        status = "PARCIAL";
        decisionReason = "GOOGLE_COMMERCIAL_MATCH";
        console.info("[GOOGLE_COMMERCIAL_FALLBACK_SUCCESS]", {
          sequence: row?.sequence ?? "",
          jobId: runState?.jobId ?? "",
          commercialName: googleCommercialFallbackCommercialName,
          query: googleCommercialFallbackQuery,
          score: googleCommercialFallbackScore,
          similarity: googleCommercialFallbackSimilarity,
          distanceM: googleCommercialFallbackDistanceM,
          lat: googleCommercialFallbackLat,
          lng: googleCommercialFallbackLng,
          title: googleCommercialFallbackTitle,
          city: cityForDecision,
        });
      } else {
        googleCommercialFallbackRejectedReason = googleCandidate.rejectedReason || "REJECTED";
        console.info("[GOOGLE_COMMERCIAL_FALLBACK_REJECTED]", {
          sequence: row?.sequence ?? "",
          jobId: runState?.jobId ?? "",
          commercialName: googleCommercialFallbackCommercialName,
          query: googleCommercialFallbackQuery,
          reason: googleCommercialFallbackRejectedReason,
          score: googleCommercialFallbackScore,
          similarity: googleCommercialFallbackSimilarity,
          distanceM: googleCommercialFallbackDistanceM,
          city: cityForDecision,
        });
      }
    }
  }
// ✅ SALVAR NA MEMÓRIA GLOBAL (se válido)
const aparecidaShadowActualBairro =
  arcgisLot?.found && String(arcgisLot.bairro || "").trim()
    ? String(arcgisLot.bairro || "")
    : String(bestRankedAddress?.district || bestRankedAddress?.subdistrict || "");
const aparecidaShadowSource =
  finalRankedKind ?? (memoryHit ? "memory" : approxMemoryHit ? "approx_memory" : null);
const aparecidaShadowActualRuaSource =
  finalRankedKind === "local"
    ? "input"
    : String(bestRankedAddress?.street || "").trim()
      ? "candidate"
      : "unknown";
const aparecidaShadowDebug = buildAparecidaContextShadow({
  isAparecida,
  expectedRua: normalized.rua,
  actualRua: String(bestRankedAddress?.street || ""),
  actualRuaSource: aparecidaShadowActualRuaSource,
  expectedBairro: normalized.bairro || bairroIn,
  actualBairro: aparecidaShadowActualBairro,
  expectedQuadra: normalized.quadra,
  actualQuadra: quadraAuto,
  expectedLote: normalized.lote,
  actualLote: loteAuto,
  source: aparecidaShadowSource,
  localCandidate: localLotCandidateFound
    ? {
        quadra: localLotQuadra,
        lote: localLotLote,
        bairro: localLotBairro,
        hasRua: false,
        localAliasAccepted: localLotLocalAliasAccepted,
        bairroDivergenteLocalForte: localLotBairroDivergenteLocalForte,
      }
    : null,
});

if (debugMemory && aparecidaShadowDebug) {
  console.info("[APARECIDA_CONTEXT_SHADOW]", {
    sequence: row?.sequence ?? "",
    ...aparecidaShadowDebug,
  });
}

const aparecidaLocalStreetShadow = buildAparecidaLocalStreetShadow({
  debugMemory,
  isAparecida,
  finalRankedKind,
  expectedRua: normalized.rua,
  bairro: localLotBairro,
  quadra: localLotQuadra,
  lote: localLotLote,
});

  if (
    isAparecida &&
    localLotUsedAsFinal &&
    localLotStrongMatch &&
    !localLotBlockedByBairro &&
    lat != null &&
    lng != null &&
    !!localLotQuadra &&
    !!localLotLote &&
    !!localLotBairro &&
    !conflictQL
  ) {
    const shouldDowngradeAparecidaLocalLot =
      !localLotCanFinalizeLocalFirst ||
      (
        aparecidaLocalStreetShadow?.streetStatus === "STREET_MISMATCH" &&
        !!aparecidaShadowDebug?.flags?.includes("APARECIDA_BAIRRO_MISMATCH_SHADOW") &&
        !localLotLocalAliasAccepted &&
        !localLotBairroDivergenteLocalForte
      );

    if (shouldDowngradeAparecidaLocalLot) {
      status = "PARCIAL";
      decisionReason = "APARECIDA_LOCAL_LOT_REVIEW";
    } else {
      status = "OK";
      decisionReason = "LOCAL_APARECIDA_LOT_OK";
    }
} else if (isAparecida && partialStreetFallbackUsed) {
  status = "PARCIAL";
  if (partialStreetFallbackReason) {
    decisionReason = partialStreetFallbackReason;
  }
}

const aparecidaMemoryDebugFlags = [
  ...(aparecidaShadowDebug?.flags || []),
  ...(aparecidaBlockedLocalFirstPair
    ? ["APARECIDA_BLOCKED_LOCAL_FIRST_PAIR"]
    : []),
];

localFirstGoianiaCandidateLat = localFirstGoianiaCandidate?.lat ?? null;
localFirstGoianiaCandidateLng = localFirstGoianiaCandidate?.lng ?? null;
localFirstGoianiaCandidateStreet = localFirstGoianiaCandidate?.streetLabel ?? null;

localFirstGoianiaCandidateEligible = localFirstGoianiaWouldBypass;

if (localFirstGoianiaCandidateEligible && localFirstGoianiaCandidate) {
  const localCandidateLat = localFirstGoianiaCandidate.lat as number;
  const localCandidateLng = localFirstGoianiaCandidate.lng as number;
  const localCandidateDistanceM = localFirstGoianiaShadow.distanceM as number;
  const localAddressLabel = cleanAddressForHere(
    [
      localFirstGoianiaCandidate.streetLabel || normalized.rua || "Goiânia",
      `Quadra ${localFirstGoianiaCandidate.quadra}`,
      `Lote ${localFirstGoianiaCandidate.lote}`,
      localFirstGoianiaCandidate.bairro || normalized.bairro || bairroIn,
      normalized.cidade || cityIn || "Goiânia",
      normalized.estado || "GO",
      normalizeCep(normalized.cep || cepIn),
    ]
      .filter(Boolean)
      .join(", "),
  );

  const localItem = {
    title: localAddressLabel,
    id: `goiania-local-first:${localFirstGoianiaShadow.key}`,
    resultType: "street",
    address: {
      label: localAddressLabel,
      countryCode: "BRA",
      countryName: "Brasil",
      stateCode: "GO",
      state: "Goiás",
      city: normalized.cidade || cityIn || "Goiânia",
      district: localFirstGoianiaCandidate.bairro || normalized.bairro || bairroIn || "",
      street: localFirstGoianiaCandidate.streetLabel || normalized.rua || "",
      postalCode: normalizeCep(normalized.cep || cepIn),
    },
    position: {
      lat: localCandidateLat,
      lng: localCandidateLng,
    },
  };

  const localBaseScore = scoreHereItemSmart(localItem, {
    cep: normalized.cep || cepIn,
    city: normalized.cidade || cityIn,
    bairro: normalized.bairro || bairroIn,
    rua: normalized.rua,
    quadra: normalized.quadra,
    lote: normalized.lote,
  });
  const localEvidenceBonus =
    25 +
    (localFirstGoianiaShadow.matchType === "exact" ? 10 : 0) +
    (localCandidateDistanceM <= 50 ? 10 : 0);

  localFirstGoianiaCandidateScore = localBaseScore + localEvidenceBonus;
  localFirstGoianiaWouldBeatFinal = localFirstGoianiaCandidateScore > bestHereScore;

  if (lat != null && lng != null) {
    localFirstGoianiaDistanceToFinalM = haversineMeters(
      { lat: localCandidateLat, lng: localCandidateLng },
      { lat, lng },
    );
  }
}

const autoSaveCurrentBehaviorWouldSave =
  !localFirstGoianiaUsedAsFinal && !memoryHit && lat != null && lng != null && status === "OK";
const autoSaveAudit = auditAutoSaveMemory({
  currentBehaviorWouldSave: autoSaveCurrentBehaviorWouldSave,
  status,
  lat,
  lng,
  geocodeConfidenceLevel: geocodeConfidenceDiag.level,
  geocodeConfidenceHardMismatch: geocodeConfidenceDiag.hardMismatch,
  geocodeConfidenceFlags: geocodeConfidenceDiag.flags,
  approxOperationalRisk,
  approxMemoryStrength,
  usedApproxMemory: !!approxMemoryHit,
  approxMemoryUsedAsFinal,
  city: cityForDecision,
});

// Memória manual tem prioridade máxima: auto-save nunca pode sobrescrever um
// registro já confirmado pelo usuário.
const memoryProtectionKeys = memoryKeyPlan.candidates.map((candidate) => candidate.key);
const existingMemoryForAutoSave = autoSaveCurrentBehaviorWouldSave
  ? await prisma.addressMemory.findMany({
      where: { key: { in: memoryProtectionKeys } },
      select: { key: true, createdBy: true },
    })
  : [];
const manualMemoryProtected = existingMemoryForAutoSave.some((row) => !!row.createdBy);
const autoSaveDisabled = true;
const autoSaveDisabledReason = "MANUAL_MEMORY_ONLY_MODE";

const shouldAutoSaveAddressMemory =
  autoSaveCurrentBehaviorWouldSave &&
  autoSaveAudit.autoSaveWouldAllow &&
  !approxMemoryHit &&
  !approxMemoryUsedAsFinal &&
  geocodeConfidenceDiag.level === "HIGH" &&
  geocodeConfidenceDiag.hardMismatch !== true &&
  !manualMemoryProtected &&
  !autoSaveDisabled;

if (shouldAutoSaveAddressMemory) {
  const saveLat = lat as number;
  const saveLng = lng as number;
  try {
    await prisma.$transaction(
      memoryProtectionKeys.map((key) =>
        prisma.addressMemory.upsert({
          where: { key },
          update: {
            lat: saveLat,
            lng: saveLng,
            label: normalizedLine || addressRaw,
            updatedAt: new Date(),
          },
          create: {
            key,
            lat: saveLat,
            lng: saveLng,
            label: normalizedLine || addressRaw,
            createdBy: null,
          },
        }),
      ),
    );
    await incrementDailyMetric(METRIC_MEMORY_BATCH_SAVE_OK).catch(() => {});
  } catch (e) {
    await incrementDailyMetric(METRIC_MEMORY_BATCH_SAVE_ERROR).catch(() => {});
    console.warn("AddressMemory save failed:", e);
  }
}

  const goianiaLocalFirstDiagnostics = exposeGoianiaLocalFirstDiagnostics
    ? {
        localFirstGoianiaAttempted: localFirstGoianiaShadow.attempted,
        localFirstGoianiaFound: localFirstGoianiaShadow.found,
        localFirstGoianiaMatchType: localFirstGoianiaShadow.matchType,
        localFirstGoianiaConfidence: localFirstGoianiaShadow.confidence,
        localFirstGoianiaDistanceM: localFirstGoianiaShadow.distanceM,
        localFirstGoianiaCandidatesCount: localFirstGoianiaShadow.candidatesCount,
        localFirstGoianiaReason: localFirstGoianiaShadow.reason,
        localFirstGoianiaKey: localFirstGoianiaShadow.key,
        localFirstGoianiaCandidateEligible,
        localFirstGoianiaCandidateScore,
        localFirstGoianiaWouldBeatFinal,
        localFirstGoianiaDistanceToFinalM,
        localFirstGoianiaCandidateLat,
        localFirstGoianiaCandidateLng,
        localFirstGoianiaCandidateStreet,
        localFirstGoianiaWouldBypass,
        localFirstGoianiaBypassReason,
        localFirstGoianiaUsedAsFinal,
      }
    : {};

  const trindadeShadowEnabled = process.env.ROTTA_TRINDADE_LOCALFIRST_SHADOW === "1";
  const trindadeLocalFirstDecisionEnabled = process.env.ROTTA_TRINDADE_LOCALFIRST_DECISION === "1";
  const trindadeLocalFirstInspectAllEnabled =
    process.env.ROTTA_TRINDADE_LOCALFIRST_INSPECT_ALL === "1";
  const trindadeLocalFirstRuntimeEnabled = trindadeShadowEnabled || trindadeLocalFirstDecisionEnabled;
  let trindadeShadowAudit: Record<string, unknown> | null = null;
  let trindadeLocalFirstUsedAsFinal = false;
  let trindadeLocalFirstAppliedReason: string | null = null;
  let trindadeLocalFirstFinalSource: string | null = null;
  let trindadeLocalFirstFinalMatchType: string | null = null;
  let trindadeLocalFirstInspectApplied = false;
  let trindadeLocalFirstInspectAppliedReason: string | null = null;
  let trindadeLocalFirstInspectOriginalBlockedReason: string | null = null;
  let trindadeLocalFirstInspectOriginalSafetyGate: Record<string, unknown> | null = null;
  const trindadeDecisionCityDetected = normalizeKey(cityForDecision || "").includes("TRINDADE");
  const trindadeDecisionHasQuadra = Boolean(normalized.quadra || quadraAuto);
  const trindadeDecisionHasLote = Boolean(normalized.lote || loteAuto);
  if (trindadeLocalFirstRuntimeEnabled && trindadeDecisionCityDetected) {
    const trindadeCurrentResultForShadow = {
      source: memoryHit
        ? "MEMORY"
        : localFirstGoianiaUsedAsFinal
          ? "LOCALFIRST_GOIANIA"
          : finalRankedKind === "discover"
            ? "HERE_DISCOVER"
            : "HERE_GEOCODE",
      lat,
      lng,
      matchedKey: matchedMemoryKey || null,
      matchType: memoryHit
        ? "MEMORY"
        : localFirstGoianiaUsedAsFinal
          ? "LOCALFIRST_GOIANIA"
          : finalRankedKind === "discover"
            ? "HERE_DISCOVER"
            : "HERE_GEOCODE",
      confidence: geocodeConfidenceDiag.confidence,
      status,
    };

    try {
      const trindadeShadow = await import("@/app/lib/trindade-localfirst-shadow");
      const trindadeShadowInput = trindadeShadow.normalizeTrindadeInput({
        city: cityForDecision || cityIn || "",
        bairro: String(bairroIn || "").trim() || bairroAuto || "",
        rua: normalized.rua || "",
        cdbairro: normalized.bairro || bairroIn || "",
        cdlogradouro: normalized.rua || "",
        nmlogradouro: normalized.rua || "",
        tipologradouro: "",
        quadra: normalized.quadra || quadraAuto || "",
        lote: normalized.lote || loteAuto || "",
        loteamento: "",
        cdloteamento: "",
        cdquadra: normalized.quadra || quadraAuto || "",
        cdlote: normalized.lote || loteAuto || "",
        rawAddress: addressRaw,
        cep: normalized.cep || cepIn || "",
        currentResult: trindadeCurrentResultForShadow,
      });

      if (trindadeShadow.isTrindadeCandidate(trindadeShadowInput)) {
        const shadow = await trindadeShadow.runTrindadeLocalFirstShadow(trindadeShadowInput);
        const comparison = trindadeShadow.compareTrindadeShadowWithCurrent(
          shadow,
          trindadeCurrentResultForShadow,
        );
        const trindadeLocalFirstCandidate = shadow.candidate;
        const trindadeLocalFirstBlockedReason = !trindadeLocalFirstDecisionEnabled
          ? "flag_off"
          : !shadow.cityDetected
            ? "city_not_trindade"
            : !shadow.localFirstFound
              ? "no_local_candidate"
              : shadow.safetyGate?.pass !== true
                ? "safety_gate_blocked"
                : shadow.decisionSimulation?.riskLevel !== "LOW"
                  ? "risk_not_low"
                  : shadow.promotionSimulation?.eligible !== true
                    ? "promotion_not_eligible"
                    : shadow.streetBairroResolution?.level !== "STRONG_STREET_BAIRRO"
                      ? "weak_street_bairro"
                      : (shadow.streetBairroResolution?.candidatesCount || 0) !== 1
                        ? "multiple_candidates"
                        : shadow.matchedLayer !== "lotes"
                          ? "unsafe_match_layer"
                          : shadow.comparisonResult === "DIFF_CONFLICT"
                            ? "diff_conflict"
                            : !Number.isFinite(Number(trindadeLocalFirstCandidate?.lat)) ||
                                !Number.isFinite(Number(trindadeLocalFirstCandidate?.lng))
                              ? "candidate_without_coords"
                              : "not_promoted";
        const trindadeLocalFirstCanApply =
          trindadeLocalFirstDecisionEnabled &&
          shadow.cityDetected &&
          shadow.localFirstFound &&
          shadow.safetyGate?.pass === true &&
          shadow.comparisonResult !== "DIFF_CONFLICT" &&
          shadow.promotionSimulation?.eligible === true &&
          shadow.decisionSimulation?.riskLevel === "LOW" &&
          Number.isFinite(Number(trindadeLocalFirstCandidate?.lat)) &&
          Number.isFinite(Number(trindadeLocalFirstCandidate?.lng));
        const trindadeLocalFirstInspectBlockedReason =
          !trindadeLocalFirstInspectAllEnabled
            ? "inspect_flag_off"
            : !trindadeDecisionCityDetected
              ? "city_not_trindade"
              : !shadow.localFirstFound
                ? "no_local_candidate"
                : !trindadeLocalFirstCandidate
                ? "no_candidate"
                : !Number.isFinite(Number(trindadeLocalFirstCandidate.lat)) ||
                    !Number.isFinite(Number(trindadeLocalFirstCandidate.lng))
                  ? "candidate_without_coords"
                  : shadow.matchedLayer !== "lotes" &&
                      shadow.matchedLayer !== "quadras" &&
                      shadow.matchedLayer !== "logradouros"
                        ? "unsafe_match_layer"
                        : null;
        if (trindadeLocalFirstCanApply && trindadeLocalFirstCandidate) {
          lat = Number(trindadeLocalFirstCandidate.lat);
          lng = Number(trindadeLocalFirstCandidate.lng);
          trindadeLocalFirstUsedAsFinal = true;
          trindadeLocalFirstAppliedReason = "safety_gate_pass_v1";
          trindadeLocalFirstFinalSource = "LOCALFIRST_TRINDADE";
          trindadeLocalFirstFinalMatchType = "LOCALFIRST_TRINDADE";
        }
        if (
          trindadeLocalFirstInspectAllEnabled &&
          !trindadeLocalFirstUsedAsFinal &&
          trindadeDecisionCityDetected &&
          trindadeLocalFirstCandidate &&
          shadow.localFirstFound &&
          Number.isFinite(Number(trindadeLocalFirstCandidate.lat)) &&
          Number.isFinite(Number(trindadeLocalFirstCandidate.lng)) &&
          (shadow.matchedLayer === "lotes" ||
            shadow.matchedLayer === "quadras" ||
            shadow.matchedLayer === "logradouros")
        ) {
          lat = Number(trindadeLocalFirstCandidate.lat);
          lng = Number(trindadeLocalFirstCandidate.lng);
          trindadeLocalFirstUsedAsFinal = true;
          // Logradouro aqui é apenas para inspeção visual; nunca deve virar regra de produção.
          trindadeLocalFirstAppliedReason =
            shadow.matchedLayer === "logradouros"
              ? "trindade_localfirst_inspect_logradouro"
              : "trindade_localfirst_inspect_lote_quadra";
          trindadeLocalFirstFinalSource = "LOCALFIRST_TRINDADE";
          trindadeLocalFirstFinalMatchType = "LOCALFIRST_TRINDADE_INSPECT";
          trindadeLocalFirstInspectApplied = true;
          trindadeLocalFirstInspectAppliedReason = trindadeLocalFirstAppliedReason;
          trindadeLocalFirstInspectOriginalBlockedReason = trindadeLocalFirstBlockedReason;
          trindadeLocalFirstInspectOriginalSafetyGate = shadow.safetyGate
            ? { ...shadow.safetyGate }
            : null;
        }
        const comparisonPayload = {
          currentStatus: trindadeCurrentResultForShadow.status ?? null,
          currentSource: trindadeCurrentResultForShadow.source ?? null,
          currentLat: Number.isFinite(Number(trindadeCurrentResultForShadow.lat))
            ? Number(trindadeCurrentResultForShadow.lat)
            : null,
          currentLng: Number.isFinite(Number(trindadeCurrentResultForShadow.lng))
            ? Number(trindadeCurrentResultForShadow.lng)
            : null,
          currentMatchedKey: trindadeCurrentResultForShadow.matchedKey ?? null,
          comparisonResult: comparison.comparisonResult,
        };

        trindadeShadowAudit = {
          enabled: true,
          cityDetected: shadow.cityDetected,
          skipped: shadow.skipped,
          localFirstFound: shadow.localFirstFound,
          candidate: shadow.candidate || null,
          matchType: shadow.matchType,
          confidence: shadow.confidence,
          matchedKey: shadow.matchedKey,
          matchedLayer: shadow.matchedLayer,
          fallbackUsed: shadow.fallbackUsed,
          conflictWithHere: shadow.conflictWithHere || comparison.conflictWithHere,
          comparisonResult: comparison.comparisonResult,
          comparison: shadow.comparison || comparisonPayload,
          reason: shadow.reason || shadow.notes[0] || comparison.comparisonResult,
          flags: shadow.flags,
          notes: [...shadow.notes, ...comparison.notes],
          streetBairroResolution: shadow.streetBairroResolution || null,
          promotionSimulation: shadow.promotionSimulation || null,
          shadowConfidence: shadow.shadowConfidence || null,
          decisionSimulation: shadow.decisionSimulation || null,
          safetyGate: shadow.safetyGate || null,
          localFirstAppliedAsFinal: trindadeLocalFirstUsedAsFinal,
          localFirstAppliedReason: trindadeLocalFirstAppliedReason,
        };
      } else {
        trindadeShadowAudit = {
          enabled: true,
          cityDetected: false,
          skipped: true,
          localFirstFound: false,
          candidate: null,
          matchType: "SKIPPED",
          confidence: 0,
          matchedKey: null,
          matchedLayer: null,
          fallbackUsed: false,
          conflictWithHere: false,
          comparisonResult: "SKIPPED_NOT_TRINDADE",
          comparison: {
            currentStatus: trindadeCurrentResultForShadow.status ?? null,
            currentSource: trindadeCurrentResultForShadow.source ?? null,
            currentLat: Number.isFinite(Number(trindadeCurrentResultForShadow.lat))
              ? Number(trindadeCurrentResultForShadow.lat)
              : null,
            currentLng: Number.isFinite(Number(trindadeCurrentResultForShadow.lng))
              ? Number(trindadeCurrentResultForShadow.lng)
              : null,
            currentMatchedKey: trindadeCurrentResultForShadow.matchedKey ?? null,
            comparisonResult: "SKIPPED_NOT_TRINDADE",
          },
          reason: "shadow_skipped_not_trindade",
          flags: {
            exactKeyMatch: false,
            fallbackUsed: false,
            aliasUsed: false,
            relationshipUsed: false,
            weakRelation: false,
            conflictWithHere: false,
            manualMemorySovereign: true,
            currentResultPreserved: true,
          },
          notes: ["shadow_skipped_not_trindade"],
          streetBairroResolution: null,
          promotionSimulation: null,
          shadowConfidence: null,
          decisionSimulation: null,
          safetyGate: null,
          localFirstAppliedAsFinal: false,
          localFirstAppliedReason: null,
        };
      }
    } catch (error) {
      trindadeShadowAudit = {
        enabled: true,
        cityDetected: true,
        skipped: true,
        localFirstFound: false,
        candidate: null,
        matchType: "SKIPPED",
        confidence: 0,
        matchedKey: null,
        matchedLayer: null,
        fallbackUsed: false,
        conflictWithHere: false,
        comparisonResult: "NO_LOCAL_CANDIDATE",
        comparison: {
          currentStatus: trindadeCurrentResultForShadow.status ?? null,
          currentSource: trindadeCurrentResultForShadow.source ?? null,
          currentLat: Number.isFinite(Number(trindadeCurrentResultForShadow.lat))
            ? Number(trindadeCurrentResultForShadow.lat)
            : null,
          currentLng: Number.isFinite(Number(trindadeCurrentResultForShadow.lng))
            ? Number(trindadeCurrentResultForShadow.lng)
            : null,
          currentMatchedKey: trindadeCurrentResultForShadow.matchedKey ?? null,
          comparisonResult: "NO_LOCAL_CANDIDATE",
        },
        reason: error instanceof Error ? error.message : String(error),
        flags: {
          exactKeyMatch: false,
          fallbackUsed: false,
          aliasUsed: false,
          relationshipUsed: false,
          weakRelation: false,
          conflictWithHere: false,
          manualMemorySovereign: true,
          currentResultPreserved: true,
        },
        notes: [
          `shadow_error:${error instanceof Error ? error.message : String(error)}`,
        ],
        streetBairroResolution: null,
        promotionSimulation: null,
        shadowConfidence: null,
        decisionSimulation: null,
        safetyGate: null,
        localFirstAppliedAsFinal: false,
        localFirstAppliedReason: null,
      };
    }
  }

  const bairroFinal = String(bairroIn || "").trim() || bairroAuto;
  const result = {
    sequence: row?.sequence ?? "",
    bairro: bairroFinal,
    city: cityForDecision,
    cep: normalized.cep || cepIn,

    // ✅ ESTE É O CAMPO QUE TEM QUE IR PRA "Destination Address" NA TABELA
    original: addressRaw,

    normalized,
    normalizedLine,

    source: trindadeLocalFirstUsedAsFinal
      ? trindadeLocalFirstFinalSource || "LOCALFIRST_TRINDADE"
      : localFirstGoianiaUsedAsFinal
        ? "LOCALFIRST_GOIANIA"
        : memoryHit
          ? "MEMORY"
          : finalRankedKind === "discover"
            ? "HERE_DISCOVER"
            : "HERE_GEOCODE",
    matchType: trindadeLocalFirstUsedAsFinal
      ? trindadeLocalFirstFinalMatchType || "LOCALFIRST_TRINDADE"
      : localFirstGoianiaUsedAsFinal
        ? "LOCALFIRST_GOIANIA"
        : memoryHit
          ? "MEMORY"
          : finalRankedKind === "discover"
            ? "HERE_DISCOVER"
            : "HERE_GEOCODE",
    localFirstTrindadeUsedAsFinal: trindadeLocalFirstUsedAsFinal,
    localFirstTrindadeAppliedReason: trindadeLocalFirstAppliedReason,
    ...(trindadeLocalFirstInspectApplied
      ? {
          localFirstInspectApplied: true,
          appliedReason: trindadeLocalFirstInspectAppliedReason,
          originalBlockedReason: trindadeLocalFirstInspectOriginalBlockedReason,
          originalSafetyGate: trindadeLocalFirstInspectOriginalSafetyGate,
        }
      : {}),
    status,
    lat,
    lng,
    decisionReason,
    ...(GOOGLE_COMMERCIAL_FALLBACK_ENABLED
      ? {
          googleCommercialFallbackAttempted,
          googleCommercialFallbackFound,
          googleCommercialFallbackApplied,
          googleCommercialFallbackRejectedReason,
          googleCommercialFallbackQuery,
          googleCommercialFallbackCommercialName,
          googleCommercialFallbackScore,
          googleCommercialFallbackSimilarity,
          googleCommercialFallbackDistanceM,
          googleCommercialFallbackLat,
          googleCommercialFallbackLng,
          googleCommercialFallbackTitle,
        }
      : {}),
    geocodeConfidence: geocodeConfidenceDiag.confidence,
    geocodeConfidenceLevel: geocodeConfidenceDiag.level,
    geocodeConfidenceHardMismatch: geocodeConfidenceDiag.hardMismatch,
    geocodeConfidenceFlags: geocodeConfidenceDiag.flags,
    geocodeConfidenceReasons: geocodeConfidenceDiag.reasons,
    approxMemoryStrength,
    approxMemoryScore,
    approxMemoryReasons,
    approxMemoryMatchedBy,
    approxMemoryUsedAsFinal,
    approxMemoryUsedAsHint,
    approxOperationalRisk,
    approxOperationalRiskReasons,
    approxOperationalWouldStillSkipHere,
    approxOperationalSafeForAutoSave,
    approxOperationalRecommendedAction,
    approxHintApplied,
    approxHintReason,
    approxHintFieldsUsed,
    approxHintSource,
    approxHintBecameBestGeocodeQuery,
    autoSaveWouldAllow: autoSaveAudit.autoSaveWouldAllow,
    autoSaveWouldBlockReason: autoSaveAudit.autoSaveWouldBlockReason,
    autoSaveWouldBlockReasons: autoSaveAudit.autoSaveWouldBlockReasons,
    autoSaveCurrentBehaviorWouldSave: autoSaveAudit.autoSaveCurrentBehaviorWouldSave,
    autoSaveHardeningApplied: autoSaveAudit.autoSaveHardeningApplied,
    autoSaveHardeningBlockedReason: autoSaveAudit.autoSaveHardeningBlockedReason,
    autoSaveDisabled,
    autoSaveDisabledReason,
    manualMemoryProtected,
    manualMemoryProtectionReason: manualMemoryProtected ? "MANUAL_MEMORY_PROTECTED" : null,
    localLotCandidateFound,
    localLotStrongMatch,
    localLotQuadra,
    localLotLote,
    localLotBairro,
    localLotBoostApplied,
    localLotUsedAsFinal,
    localLotBlockedByBairro,
    ...goianiaLocalFirstDiagnostics,
    urbanPatternDetected,
    urbanPatternType,
    urbanPatternQuery,
    urbanPatternImprovedRanking,
    urbanPatternBestCandidateKind,
    urbanPatternSpreadReduction,
    urbanPatternWouldReplaceWeakQuery,
    urbanPatternAppliedToRealQueries,
    urbanPatternAppliedReason,
    urbanPatternReplacedQuery,
    urbanPatternRealQueryIndex,
    urbanPatternBecameBestGeocodeQuery,
    ...(discoverGateDebug ? { discoverGateDebug } : {}),
    ...(trindadeShadowAudit ? { trindadeShadow: trindadeShadowAudit } : {}),

    model: g.model,
    usedGemini: g.usedGemini,

    notesAuto,
    quadraAuto,
    loteAuto,

    // debug
    raw: g.raw,
    hereBest: scored[0]?.it || null,
    arcgisLotUsed: arcgisLot || null,
   hereRankTop5: scored.slice(0, 5).map((x: any) => ({
      score: x.score,
      label: x.it?.address?.label || x.it?.title || "",
      resultType: x.it?.resultType || "",
      from: x.from,
      kind: x.kind,
      pos: x.it?.position || null,
    })),
  };

  if (debugMemory) {
    (result as any).memoryDebug = {
      memoryKey,
      memoryBaseKey,
      memoryHit: !!memoryHit,
      memoryHitKind,
      matchedKey: matchedMemoryKey,
      hereSkippedBecauseMemory: !!memoryHit,
      decisionReason,
      ...(GOOGLE_COMMERCIAL_FALLBACK_ENABLED
        ? {
            googleCommercialFallbackAttempted,
            googleCommercialFallbackFound,
            googleCommercialFallbackApplied,
            googleCommercialFallbackRejectedReason,
            googleCommercialFallbackQuery,
            googleCommercialFallbackCommercialName,
            googleCommercialFallbackScore,
            googleCommercialFallbackSimilarity,
            googleCommercialFallbackDistanceM,
            googleCommercialFallbackLat,
            googleCommercialFallbackLng,
            googleCommercialFallbackTitle,
          }
        : {}),
      usedApproxMemory: !!approxMemoryHit,
      geocodeConfidence: geocodeConfidenceDiag.confidence,
      geocodeConfidenceLevel: geocodeConfidenceDiag.level,
      geocodeConfidenceHardMismatch: geocodeConfidenceDiag.hardMismatch,
      geocodeConfidenceFlags: geocodeConfidenceDiag.flags,
      aparecidaShadowFlags: aparecidaMemoryDebugFlags,
      aparecidaShadowDebug,
      aparecidaLocalStreetShadow,
      aparecidaBlockedLocalFirstPair,
      approxMemoryStrength,
      approxMemoryScore,
      approxMemoryReasons,
      approxMemoryUsedAsFinal,
      approxMemoryUsedAsHint,
      approxOperationalRisk,
      approxOperationalRiskReasons,
      approxOperationalWouldStillSkipHere,
      approxOperationalSafeForAutoSave,
      approxOperationalRecommendedAction,
      approxHintApplied,
      approxHintReason,
      approxHintFieldsUsed,
      approxHintSource,
      approxHintBecameBestGeocodeQuery,
      autoSaveWouldAllow: autoSaveAudit.autoSaveWouldAllow,
      autoSaveWouldBlockReason: autoSaveAudit.autoSaveWouldBlockReason,
      autoSaveWouldBlockReasons: autoSaveAudit.autoSaveWouldBlockReasons,
      autoSaveCurrentBehaviorWouldSave: autoSaveAudit.autoSaveCurrentBehaviorWouldSave,
      autoSaveHardeningApplied: autoSaveAudit.autoSaveHardeningApplied,
      autoSaveHardeningBlockedReason: autoSaveAudit.autoSaveHardeningBlockedReason,
      autoSaveDisabled,
      autoSaveDisabledReason,
      manualMemoryProtected,
      manualMemoryProtectionReason: manualMemoryProtected ? "MANUAL_MEMORY_PROTECTED" : null,
      localLotCandidateFound,
      localLotStrongMatch,
      localLotQuadra,
      localLotLote,
      localLotBairro,
      localLotBoostApplied,
      localLotUsedAsFinal,
      ...goianiaLocalFirstDiagnostics,
      urbanPatternDetected,
      urbanPatternType,
      urbanPatternQuery,
      urbanPatternImprovedRanking,
      urbanPatternBestCandidateKind,
      urbanPatternSpreadReduction,
      urbanPatternWouldReplaceWeakQuery,
      urbanPatternAppliedToRealQueries,
      urbanPatternAppliedReason,
      urbanPatternReplacedQuery,
      urbanPatternRealQueryIndex,
      urbanPatternBecameBestGeocodeQuery,
    } satisfies MemoryDebugRow;
  }

  return result;
}

// ===== HANDLER (BATCH) =====
export async function POST(req: Request) {
  let jobId = "";

  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const role = (((session?.user as any)?.role as string | undefined) ?? "USER") as
      | "ADMIN"
      | "USER";

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        accessBlockedAt: true,
        accessBlockReason: true,
      },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (currentUser.role !== "ADMIN" && currentUser.accessBlockedAt) {
      return NextResponse.json(
        {
          error: currentUser.accessBlockReason ?? "Seu acesso está bloqueado.",
          code: "ACCESS_BLOCKED",
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({} as any));

    const rowsIn: InputRow[] = Array.isArray(body?.rows) ? body.rows : [];
    const debugMemoryFromEnv = process.env.ROTTA_DEBUG_MEMORY === "1";
    const debugMemory = body?.debugMemory === true || debugMemoryFromEnv;
    if (debugMemoryFromEnv) {
      console.info("[ROTTA_DEBUG_MEMORY] debugMemory enabled by ROTTA_DEBUG_MEMORY=1");
    }
    if (!rowsIn.length) {
      return NextResponse.json({ error: "Envie { rows: [...] }" }, { status: 400 });
    }

    if (rowsIn.length > MAX_ROUTE_STOPS) {
      return NextResponse.json(
        { error: "A planilha excede o limite máximo de 200 paradas." },
        { status: 400 }
      );
    }

    jobId = String(body?.jobId || "").trim();

    if (!jobId && role === "USER") {
      return NextResponse.json(
        { error: "jobId é obrigatório para este usuário." },
        { status: 400 }
      );
    }

    if (jobId) {
      const job = await prisma.importJob.findUnique({
        where: { id: jobId },
        select: { id: true, userId: true, status: true },
      });

      if (!job) {
        return NextResponse.json({ error: "ImportJob não encontrado." }, { status: 404 });
      }

      if (role === "USER" && job.userId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (job.status === "PROCESSING") {
        return NextResponse.json(
          { error: "Este processamento já está em andamento." },
          { status: 409 }
        );
      }

      if (job.status === "DONE") {
        return NextResponse.json(
          { error: "Este processamento já foi concluído." },
          { status: 409 }
        );
      }

      await consumeRouteAllowance({
        userId,
        jobId: job.id,
        role,
      });

      const started = await prisma.importJob.updateMany({
        where: {
          id: job.id,
          status: { in: ["PENDING", "FAILED"] },
        },
        data: {
          status: "PROCESSING",
          startedAt: new Date(),
          finishedAt: null,
          totalStops: rowsIn.length,
          processedStops: 0,
          errorMessage: null,
          errorStack: null,
        },
      });

      if (!started.count) {
        const currentJob = await prisma.importJob.findUnique({
          where: { id: job.id },
          select: { status: true },
        });

        if (currentJob?.status === "PROCESSING") {
          return NextResponse.json(
            { error: "Este processamento já está em andamento." },
            { status: 409 }
          );
        }

        if (currentJob?.status === "DONE") {
          return NextResponse.json(
            { error: "Este processamento já foi concluído." },
            { status: 409 }
          );
        }

        return NextResponse.json(
          { error: "Este processamento não pode ser iniciado agora." },
          { status: 409 }
        );
      }
    }

    // ✅ Se não vier jobId, avisa no console (isso explica admin não atualizar)
    if (!jobId) {
      console.warn("⚠️ /api/process chamado SEM jobId — progresso não será salvo no banco.");
    }

    const baseOrigin = new URL(req.url).origin;
    const runState: GoogleCommercialFallbackRunState | undefined = GOOGLE_COMMERCIAL_FALLBACK_ENABLED
      ? {
          jobId,
          googleCommercialFallbackCalls: 0,
        }
      : undefined;

    const concurrency = 5;
    const results: any[] = new Array(rowsIn.length);
    let index = 0;
    let completedCount = 0;
    let lastPersistedCount = 0;

    async function worker() {
      while (index < rowsIn.length) {
        const i = index++;
        try {
          results[i] = await processOne(rowsIn[i], baseOrigin, debugMemory, runState);
        } catch (e: any) {
          results[i] = {
            sequence: rowsIn[i]?.sequence ?? "",
            bairro: rowsIn[i]?.bairro ?? "",
            city: rowsIn[i]?.city ?? "",
            cep: rowsIn[i]?.cep ?? "",
            original: String(rowsIn[i]?.original || ""),
            normalized: null,
            normalizedLine: "",
            status: "FAILED",
            lat: null,
            lng: null,
            model: "",
            usedGemini: false,
            notesAuto: "",
            quadraAuto: "",
            loteAuto: "",
            error: e?.message || "Erro ao processar linha",
          };
        } finally {
          completedCount += 1;

          if (jobId) {
            const shouldFlushProgress =
              completedCount - lastPersistedCount >= PROGRESS_BATCH_SIZE ||
              completedCount === rowsIn.length;

            if (shouldFlushProgress) {
              const nextProcessedStops = completedCount;
              lastPersistedCount = nextProcessedStops;

              await prisma.importJob.update({
                where: { id: jobId },
                data: {
                  processedStops: nextProcessedStops,
                  status: "PROCESSING",
                },
              });
            }
          }
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    let resultPath: string | null = null;

   // ✅ no final, marca DONE e salva resultado completo
if (jobId) {
  resultPath = await saveJobResult(jobId, results);
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "DONE",
      finishedAt: new Date(),
      processedStops: rowsIn.length,

      // 🔥 SALVA O RESULTADO FINAL NO BANCO
      resultPath,
      resultJson: results as Prisma.InputJsonValue,
      resultSavedAt: new Date(),
    },
  });
}


    let debugMemorySummary: any = undefined;

    if (debugMemory) {
      const rowsWithDebug = results.filter((r: any) => r?.memoryDebug);
      const hits = rowsWithDebug.filter((r: any) => r.memoryDebug.memoryHit).length;
      const baseHits = rowsWithDebug.filter((r: any) => r.memoryDebug.memoryHitKind === "base").length;
      const exactHits = rowsWithDebug.filter((r: any) => r.memoryDebug.memoryHitKind === "exact").length;
      const misses = rowsWithDebug.length - hits;
      const hereSkippedBecauseMemory = rowsWithDebug.filter((r: any) => r.memoryDebug.hereSkippedBecauseMemory).length;
      const countAparecidaShadow = (flag: string) =>
        rowsWithDebug.filter((r: any) => r.memoryDebug.aparecidaShadowFlags?.includes(flag)).length;
      const countAparecidaLocalStreetShadow = (status: AparecidaLocalStreetShadowStatus) =>
        rowsWithDebug.filter((r: any) => r.memoryDebug.aparecidaLocalStreetShadow?.streetStatus === status).length;
      const aparecidaShadowTotal = rowsWithDebug.filter(
        (r: any) => r.memoryDebug.aparecidaShadowFlags?.length,
      ).length;
      const aparecidaLocalStreetShadowTotal = rowsWithDebug.filter(
        (r: any) => r.memoryDebug.aparecidaLocalStreetShadow,
      ).length;

      debugMemorySummary = {
        enabled: true,
        totalRows: rowsWithDebug.length,
        hits,
        exactHits,
        baseHits,
        misses,
        hereSkippedBecauseMemory,
        aparecidaShadowTotal,
        aparecidaBairroMismatchShadow: countAparecidaShadow("APARECIDA_BAIRRO_MISMATCH_SHADOW"),
        aparecidaRuaMismatchShadow: countAparecidaShadow("APARECIDA_RUA_MISMATCH_SHADOW"),
        aparecidaQlMatchButContextMismatchShadow: countAparecidaShadow(
          "APARECIDA_QL_MATCH_BUT_CONTEXT_MISMATCH_SHADOW",
        ),
        aparecidaLocalRuaNotVerifiedShadow: countAparecidaShadow(
          "APARECIDA_LOCAL_RUA_NOT_VERIFIED_SHADOW",
        ),
        aparecidaLocalQlOnlyMatchShadow: countAparecidaShadow(
          "APARECIDA_LOCAL_QL_ONLY_MATCH_SHADOW",
        ),
        aparecidaLocalBairroMismatchWithUnverifiedRuaShadow: countAparecidaShadow(
          "APARECIDA_LOCAL_BAIRRO_MISMATCH_WITH_UNVERIFIED_RUA_SHADOW",
        ),
        aparecidaBlockedLocalFirstPair: countAparecidaShadow(
          "APARECIDA_BLOCKED_LOCAL_FIRST_PAIR",
        ),
        aparecidaLocalStreetShadowTotal,
        aparecidaLocalStreetMatchShadow: countAparecidaLocalStreetShadow("STREET_MATCH"),
        aparecidaLocalStreetMismatchShadow: countAparecidaLocalStreetShadow("STREET_MISMATCH"),
        aparecidaLocalStreetMissingShadow: countAparecidaLocalStreetShadow("STREET_MISSING"),
        aparecidaLocalStreetUnsafeNearDistShadow: countAparecidaLocalStreetShadow(
          "STREET_UNSAFE_NEAR_DIST",
        ),
        aparecidaLocalStreetNotCheckedShadow: countAparecidaLocalStreetShadow("STREET_NOT_CHECKED"),
      };

      console.info("[MEMORY_BATCH_SUMMARY]", debugMemorySummary);
    }

    return NextResponse.json({
      total: results.length,
      rows: results,
      ...(debugMemory ? { debugMemorySummary } : {}),
    });
  } catch (err: any) {
    if (err instanceof AccessControlError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
        },
        { status: err.status }
      );
    }

    console.error("Erro /api/process:", err);

    if (jobId) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: err?.message || "Erro desconhecido",
          errorStack: String(err?.stack || ""),
          finishedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ error: "Erro interno em /api/process" }, { status: 500 });
  }
}
