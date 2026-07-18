import fs from "node:fs";
import path from "node:path";

import type {
  HidrolandiaDecisionSimulation,
  HidrolandiaLocalFirstDecision,
  HidrolandiaLocalFirstCandidate,
  HidrolandiaProcessShadowAudit,
  HidrolandiaProcessShadowInput,
  HidrolandiaSafetyGate,
  HidrolandiaSetorResolution,
  HidrolandiaShadowFlags,
  HidrolandiaShadowInput,
  HidrolandiaShadowMatchType,
  HidrolandiaShadowResult,
  HidrolandiaStreetResolution,
} from "./hidrolandia-shadow-types";

type HidrolandiaIndex = {
  version: number;
  scope: string;
  byKey: Record<string, HidrolandiaLocalFirstCandidate[]>;
  promotionByKey?: Record<string, HidrolandiaLocalFirstCandidate[]>;
  stats?: Record<string, unknown>;
};

type NormalizedInput = {
  city: string;
  setor: string;
  lookupSetor: string;
  quadra: string;
  lote: string;
  rua: string;
  key: string;
  quadraLoteKey: string;
};

type RunOptions = {
  candidatesOverride?: HidrolandiaLocalFirstCandidate[];
  promotionCandidatesOverride?: HidrolandiaLocalFirstCandidate[];
  allowPromotion?: boolean;
  approvedSetorAliases?: Record<string, string>;
  approvedStreetAliases?: Record<string, string>;
};

type PartialFallbackLevel = "SETOR_RUA_QUADRA" | "SETOR_RUA";

type PartialFallbackDecision = {
  level: PartialFallbackLevel;
  source:
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA"
    | "LOCALFIRST_HIDROLANDIA_RUA_FALLBACK";
  matchType:
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA"
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA_FALLBACK";
  decisionReason:
    | "PARCIAL_LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
    | "PARCIAL_LOCALFIRST_HIDROLANDIA_SETOR_RUA"
    | "PARTIAL_LOCALFIRST_HIDROLANDIA_RUA_AFTER_HERE_FAILURE";
  shadowMatchType:
    | "MATCH_SETOR_RUA_QUADRA_PARCIAL"
    | "MATCH_SETOR_RUA_PARCIAL"
    | "MATCH_SETOR_RUA_AFTER_HERE_PARCIAL";
  reason:
    | "safe_partial_setor_rua_quadra_anchor"
    | "safe_partial_setor_rua_anchor"
    | "safe_partial_setor_rua_after_here_anchor";
  matchedKey: string;
  candidate: HidrolandiaLocalFirstCandidate;
  sourceCandidates: HidrolandiaLocalFirstCandidate[];
  warnings: string[];
};

const INDEX_PATH = path.join(process.cwd(), "data", "localfirst", "hidrolandia", "lotes-index.json");
const STRONG_STREET_RELATIONS: HidrolandiaStreetResolution[] = [
  "RUA_EXACT",
  "RUA_ALIAS_APROVADO",
  "RUA_COMPATIVEL_FORTE",
];
const STRONG_SETOR_RELATIONS: HidrolandiaSetorResolution[] = [
  "SETOR_EXACT",
  "SETOR_ALIAS_APROVADO",
  "SETOR_COMPATIVEL_FORTE",
];
const HIDROLANDIA_APPROVED_SETOR_ALIASES: Record<string, string> = {
  NAZARE: "BAIRRO NAZARE",
};
const HIDROLANDIA_APPROVED_STREET_ALIASES: Record<string, string> = {
  "R RAIMUNDO NONATO": "R RAIMUNDO NONATO DA SILVA",
  "AV GOIANIA": "AVENIDA GOIANIA",
  "ALAMEDAS DOS EUCALIPTOS": "ALAMEDA DOS EUCALIPTOS",
};

let cache: HidrolandiaIndex | null = null;

function readIndex(): HidrolandiaIndex {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8").replace(/^\uFEFF/, "")) as HidrolandiaIndex;
  }
  return cache;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompactText(value: unknown) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeCode(value: unknown) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
}

function normalizeStreetName(value: unknown) {
  return normalizeText(value)
    .replace(/\bAVENIDA\b/g, "AV")
    .replace(/\bRUA\b/g, "R")
    .replace(/\bALAMEDA\b/g, "AL")
    .replace(/\bTRAVESSA\b/g, "TV")
    .replace(/\bRODOVIA\b/g, "ROD")
    .replace(/\bDOUTOR\b/g, "DR")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveApprovedStreetAlias(
  street: string,
  overrides: Record<string, string> = {},
) {
  const aliases = mergeApprovedAliases(HIDROLANDIA_APPROVED_STREET_ALIASES, overrides);
  return aliases[street] || street;
}

function mergeApprovedAliases(defaults: Record<string, string>, overrides: Record<string, string> = {}) {
  return {
    ...defaults,
    ...overrides,
  };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeCity(value: unknown) {
  return normalizeCompactText(value);
}

function isValidCoordinate(candidate: HidrolandiaLocalFirstCandidate) {
  return (
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng) &&
    Number(candidate.lat) >= -90 &&
    Number(candidate.lat) <= 90 &&
    Number(candidate.lng) >= -180 &&
    Number(candidate.lng) <= 180
  );
}

function buildKey(parts: string[]) {
  return parts.join("|");
}

export function normalizeHidrolandiaInput(input: HidrolandiaShadowInput): NormalizedInput {
  const setor = normalizeText(input.setor || input.bairro || "");
  const lookupSetor = HIDROLANDIA_APPROVED_SETOR_ALIASES[setor] || setor;
  const quadra = normalizeCode(input.quadra || "");
  const lote = normalizeCode(input.lote || "");
  const rua = normalizeStreetName(input.rua || "");
  return {
    city: normalizeCity(input.city || ""),
    setor,
    lookupSetor,
    quadra,
    lote,
    rua,
    key: buildKey(["HIDROLANDIA", lookupSetor, quadra, lote]),
    quadraLoteKey: buildKey(["HIDROLANDIA", quadra, lote]),
  };
}

export function isHidrolandiaCandidate(input: HidrolandiaShadowInput) {
  return normalizeCity(input.city || "").includes("HIDROLANDIA");
}

export function getHidrolandiaLocalFirstCacheSnapshot() {
  const index = cache;
  return {
    loaded: !!index,
    indexPath: INDEX_PATH,
    keyCount: index ? Object.keys(index.byKey || {}).length : 0,
    stats: index?.stats || null,
  };
}

function getCandidatesByQuadraLote(index: HidrolandiaIndex, quadraLoteKey: string) {
  const result: HidrolandiaLocalFirstCandidate[] = [];
  for (const candidates of Object.values(index.byKey || {})) {
    for (const candidate of candidates) {
      if (candidate.quadraLoteKey === quadraLoteKey) result.push(candidate);
    }
  }
  return result;
}

function getAllCandidates(index: HidrolandiaIndex) {
  return Object.values(index.byKey || {}).flat();
}

function candidateSetor(candidate: HidrolandiaLocalFirstCandidate) {
  return normalizeText(candidate.setorNormalizado || candidate.setorOriginal || "");
}

function candidateStreet(candidate: HidrolandiaLocalFirstCandidate) {
  return normalizeStreetName(candidate.ruaOriginal || candidate.ruaNormalizada || "");
}

function candidateQuadra(candidate: HidrolandiaLocalFirstCandidate) {
  return normalizeCode(candidate.quadraNormalizada || candidate.quadraOriginal || "");
}

function isInsideCoverageAnchor(candidate: HidrolandiaLocalFirstCandidate) {
  return (
    candidate.cadastralCoverageStatus === "INSIDE_CADASTRAL_COVERAGE" &&
    isValidCoordinate(candidate) &&
    !candidate.flags?.representativePointSuspicious
  );
}

function isSafeUniqueAnchor(candidate: HidrolandiaLocalFirstCandidate) {
  return (
    isInsideCoverageAnchor(candidate) &&
    candidate.safetyStatus === "SAFE_UNIQUE" &&
    !(candidate.blockers || []).length
  );
}

function hasExactConflictThatBlocksFallback(blockers: string[], candidates: HidrolandiaLocalFirstCandidate[]) {
  if (!candidates.length) return false;
  return blockers.some((blocker) =>
    [
      "multiple_candidates",
      "multiple_promotion_candidates",
      "setor_mismatch",
      "setor_ambiguous",
      "street_mismatch",
      "street_ambiguous",
    ].includes(blocker),
  );
}

function averageCoordinate(candidates: HidrolandiaLocalFirstCandidate[]) {
  const valid = candidates.filter(isInsideCoverageAnchor);
  if (!valid.length) return null;
  const lat = valid.reduce((sum, candidate) => sum + Number(candidate.lat), 0) / valid.length;
  const lng = valid.reduce((sum, candidate) => sum + Number(candidate.lng), 0) / valid.length;
  return { lat, lng };
}

function buildPartialCandidate(
  level: PartialFallbackLevel,
  normalized: NormalizedInput,
  sourceCandidates: HidrolandiaLocalFirstCandidate[],
  anchor: HidrolandiaLocalFirstCandidate,
  lat: number,
  lng: number,
): HidrolandiaLocalFirstCandidate {
  const suffix = level === "SETOR_RUA_QUADRA" ? "SETOR_RUA_QUADRA" : "SETOR_RUA";
  const matchedKey =
    level === "SETOR_RUA_QUADRA"
      ? buildKey(["HIDROLANDIA", normalized.lookupSetor, normalized.rua, normalized.quadra])
      : buildKey(["HIDROLANDIA", normalized.lookupSetor, normalized.rua]);

  return {
    ...anchor,
    featureId: `hidrolandia-partial-${suffix.toLowerCase()}-${normalized.lookupSetor}-${normalized.rua}-${normalized.quadra || "SEM_QUADRA"}`,
    key: matchedKey,
    quadraLoteKey: buildKey(["HIDROLANDIA", normalized.quadra || "SEM_QUADRA", "SEM_LOTE"]),
    setorOriginal: anchor.setorOriginal || normalized.lookupSetor,
    setorNormalizado: normalized.lookupSetor,
    quadraOriginal: level === "SETOR_RUA_QUADRA" ? anchor.quadraOriginal || normalized.quadra : "",
    quadraNormalizada: level === "SETOR_RUA_QUADRA" ? anchor.quadraNormalizada || normalized.quadra : "",
    loteOriginal: "",
    loteNormalizado: "",
    ruaOriginal: anchor.ruaOriginal || normalized.rua,
    ruaNormalizada: anchor.ruaNormalizada || normalized.rua,
    lat,
    lng,
    safetyStatus: `PARTIAL_${suffix}_SAFE_ANCHOR`,
    structuralStatus: `PARTIAL_${suffix}`,
    blockers: [],
    warnings: [
      `partial_anchor_level:${level}`,
      `partial_source_candidate_count:${sourceCandidates.length}`,
      ...(anchor.warnings || []),
    ],
    confidence: level === "SETOR_RUA_QUADRA" ? 0.78 : 0.68,
    cadastralCoverageStatus: "INSIDE_CADASTRAL_COVERAGE",
    representativePointMethod:
      level === "SETOR_RUA_QUADRA"
        ? "PARTIAL_SAFE_UNIQUE_LOT_ANCHOR"
        : "PARTIAL_SECTOR_STREET_AVERAGE_ANCHOR",
  };
}

function buildAfterHereStreetFallbackCandidate(
  normalized: NormalizedInput,
  sourceCandidates: HidrolandiaLocalFirstCandidate[],
  anchor: HidrolandiaLocalFirstCandidate,
  lat: number,
  lng: number,
) {
  return {
    ...buildPartialCandidate("SETOR_RUA", normalized, sourceCandidates, anchor, lat, lng),
    featureId: `hidrolandia-after-here-street-${normalized.lookupSetor}-${normalized.rua}`,
    key: buildKey(["HIDROLANDIA", normalized.lookupSetor, normalized.rua, "AFTER_HERE"]),
    safetyStatus: "PARTIAL_SETOR_RUA_AFTER_HERE_SAFE_ANCHOR",
    structuralStatus: "PARTIAL_SETOR_RUA_AFTER_HERE",
    warnings: [
      "partial_result_not_lot_exact",
      "partial_setor_rua_after_here_anchor",
      `partial_source_candidate_count:${sourceCandidates.length}`,
      ...(anchor.warnings || []),
    ],
    confidence: 0.64,
    representativePointMethod: "PARTIAL_SETOR_RUA_AFTER_HERE_AVERAGE_ANCHOR",
  } satisfies HidrolandiaLocalFirstCandidate;
}

function buildFlags(candidates: HidrolandiaLocalFirstCandidate[]): HidrolandiaShadowFlags {
  const blockers = candidates.flatMap((candidate) => candidate.blockers || []);
  return {
    currentResultPreserved: true,
    manualMemorySovereign: true,
    localFirstAppliedAsFinal: false,
    addressMemoryWriteBlocked: true,
    exactKeyMatch: candidates.length > 0,
    multipleCandidates: candidates.length > 1,
    structuralDuplicate:
      blockers.includes("same_key_different_geometry") ||
      blockers.includes("duplicate_geometry") ||
      blockers.includes("same_quadra_lote_different_setor"),
    specialLot: candidates.some((candidate) => candidate.flags?.specialLot || candidate.blockers?.includes("special_lot")),
    invalidCoordinate: candidates.some((candidate) => candidate.blockers?.includes("invalid_coordinate") || !isValidCoordinate(candidate)),
    suspiciousGeometry: candidates.some(
      (candidate) => candidate.flags?.representativePointSuspicious || candidate.blockers?.includes("suspicious_representative_point"),
    ),
    outsideOrUnknownCadastralCoverage: candidates.some(
      (candidate) =>
        candidate.cadastralCoverageStatus !== "INSIDE_CADASTRAL_COVERAGE" ||
        candidate.blockers?.includes("outside_or_unknown_cadastral_coverage"),
    ),
  };
}

function resolveSetor(
  normalized: NormalizedInput,
  candidates: HidrolandiaLocalFirstCandidate[],
  approvedAliases: Record<string, string> = {},
) {
  const aliases = mergeApprovedAliases(HIDROLANDIA_APPROVED_SETOR_ALIASES, approvedAliases);
  const candidateSetores = unique(candidates.map((candidate) => candidate.setorNormalizado));
  let relation: HidrolandiaSetorResolution = "SETOR_EXACT";
  let reason = "setor_exact";
  const approvedTarget = aliases[normalized.setor] || "";

  if (!normalized.setor) {
    relation = "SETOR_AUSENTE";
    reason = "missing_setor";
  } else if (candidateSetores.length > 1) {
    relation = "SETOR_AMBIGUO";
    reason = "multiple_candidate_setores";
  } else if (candidateSetores.length === 1 && approvedTarget && approvedTarget === candidateSetores[0]) {
    relation = "SETOR_ALIAS_APROVADO";
    reason = "setor_alias_aprovado";
  } else if (candidateSetores.length === 1 && candidateSetores[0] !== normalized.setor) {
    relation = "SETOR_MISMATCH";
    reason = "setor_mismatch";
  } else if (!candidateSetores.length) {
    relation = "SETOR_FRACO";
    reason = "no_candidate_setor";
  }

  return {
    relation,
    inputSetor: normalized.setor,
    normalizedSetor: normalized.setor,
    candidateSetores,
    reason,
  };
}

function resolveStreet(
  normalized: NormalizedInput,
  candidates: HidrolandiaLocalFirstCandidate[],
  approvedAliases: Record<string, string> = {},
) {
  const aliases = mergeApprovedAliases(HIDROLANDIA_APPROVED_STREET_ALIASES, approvedAliases);
  const candidateRuas = unique(candidates.map((candidate) => normalizeStreetName(candidate.ruaOriginal || candidate.ruaNormalizada || "")));
  let relation: HidrolandiaStreetResolution = "RUA_EXACT";
  let reason = "rua_exact";
  const approvedTarget = aliases[normalized.rua] || "";

  if (!normalized.rua) {
    relation = candidateRuas.length > 1 ? "RUA_AMBIGUA" : "RUA_AUSENTE";
    reason = candidateRuas.length > 1 ? "missing_input_rua_multiple_candidate_ruas" : "missing_input_rua";
  } else if (candidateRuas.length > 1 && candidateRuas.includes(normalized.rua)) {
    relation = "RUA_AMBIGUA";
    reason = "multiple_candidate_ruas";
  } else if (candidateRuas.length === 1 && approvedTarget && approvedTarget === candidateRuas[0]) {
    relation = "RUA_ALIAS_APROVADO";
    reason = "rua_alias_aprovado";
  } else if (!candidateRuas.includes(normalized.rua)) {
    relation = "RUA_MISMATCH";
    reason = "rua_mismatch";
  }

  return {
    relation,
    inputRua: normalized.rua,
    normalizedRua: normalized.rua,
    candidateRuas,
    reason,
  };
}

function hasStrongSetorAndStreet(
  normalized: NormalizedInput,
  candidates: HidrolandiaLocalFirstCandidate[],
  options: RunOptions,
) {
  const setorResolution = resolveSetor(normalized, candidates, options.approvedSetorAliases);
  const streetResolution = resolveStreet(normalized, candidates, options.approvedStreetAliases);
  return {
    setorResolution,
    streetResolution,
    ok:
      STRONG_SETOR_RELATIONS.includes(setorResolution.relation) &&
      STRONG_STREET_RELATIONS.includes(streetResolution.relation),
  };
}

function findSetorRuaQuadraFallback(
  normalized: NormalizedInput,
  index: HidrolandiaIndex,
  options: RunOptions,
): PartialFallbackDecision | null {
  if (!normalized.setor || !normalized.rua || !normalized.quadra) return null;
  if (normalized.lote) return null;

  const candidates = getAllCandidates(index).filter(
    (candidate) =>
      candidateSetor(candidate) === normalized.lookupSetor &&
      candidateStreet(candidate) === resolveApprovedStreetAlias(normalized.rua, options.approvedStreetAliases) &&
      candidateQuadra(candidate) === normalized.quadra,
  );
  if (!candidates.length) return null;

  const relation = hasStrongSetorAndStreet(normalized, candidates, options);
  if (!relation.ok) return null;

  const candidateSetores = unique(candidates.map(candidateSetor));
  const candidateRuas = unique(candidates.map(candidateStreet));
  const candidateQuadras = unique(candidates.map(candidateQuadra));
  if (candidateSetores.length !== 1 || candidateRuas.length !== 1 || candidateQuadras.length !== 1) return null;

  const anchors = candidates.filter(isSafeUniqueAnchor);
  if (anchors.length !== 1) return null;

  const anchor = anchors[0];
  const candidate = buildPartialCandidate(
    "SETOR_RUA_QUADRA",
    normalized,
    candidates,
    anchor,
    Number(anchor.lat),
    Number(anchor.lng),
  );

  return {
    level: "SETOR_RUA_QUADRA",
    source: "LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA",
    matchType: "LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA",
    decisionReason: "PARCIAL_LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA",
    shadowMatchType: "MATCH_SETOR_RUA_QUADRA_PARCIAL",
    reason: "safe_partial_setor_rua_quadra_anchor",
    matchedKey: candidate.key,
    candidate,
    sourceCandidates: candidates,
    warnings: [
      "partial_result_not_lot_exact",
      "partial_setor_rua_quadra_anchor",
      `partial_source_candidate_count:${candidates.length}`,
    ],
  };
}

function findSetorRuaFallback(
  normalized: NormalizedInput,
  index: HidrolandiaIndex,
  options: RunOptions,
): PartialFallbackDecision | null {
  if (!normalized.setor || !normalized.rua) return null;
  if (normalized.quadra || normalized.lote) return null;

  const candidates = getAllCandidates(index).filter(
    (candidate) =>
      candidateSetor(candidate) === normalized.lookupSetor &&
      candidateStreet(candidate) === resolveApprovedStreetAlias(normalized.rua, options.approvedStreetAliases),
  );
  if (!candidates.length) return null;

  const relation = hasStrongSetorAndStreet(normalized, candidates, options);
  if (!relation.ok) return null;

  const candidateSetores = unique(candidates.map(candidateSetor));
  const candidateRuas = unique(candidates.map(candidateStreet));
  if (candidateSetores.length !== 1 || candidateRuas.length !== 1) return null;

  const anchors = candidates.filter(isInsideCoverageAnchor);
  const coordinate = averageCoordinate(anchors);
  if (!coordinate) return null;

  const anchor = anchors[0];
  const candidate = buildPartialCandidate(
    "SETOR_RUA",
    normalized,
    anchors,
    anchor,
    coordinate.lat,
    coordinate.lng,
  );

  return {
    level: "SETOR_RUA",
    source: "LOCALFIRST_HIDROLANDIA_SETOR_RUA",
    matchType: "LOCALFIRST_HIDROLANDIA_SETOR_RUA",
    decisionReason: "PARCIAL_LOCALFIRST_HIDROLANDIA_SETOR_RUA",
    shadowMatchType: "MATCH_SETOR_RUA_PARCIAL",
    reason: "safe_partial_setor_rua_anchor",
    matchedKey: candidate.key,
    candidate,
    sourceCandidates: anchors,
    warnings: [
      "partial_result_not_lot_exact",
      "partial_setor_rua_anchor",
      `partial_source_candidate_count:${candidates.length}`,
      `partial_inside_anchor_count:${anchors.length}`,
    ],
  };
}

function findPartialFallback(
  normalized: NormalizedInput,
  index: HidrolandiaIndex | null,
  options: RunOptions,
  exactBlockers: string[],
  exactCandidates: HidrolandiaLocalFirstCandidate[],
) {
  if (!index) return null;
  if (hasExactConflictThatBlocksFallback(exactBlockers, exactCandidates)) return null;
  return (
    findSetorRuaQuadraFallback(normalized, index, options) ||
    findSetorRuaFallback(normalized, index, options)
  );
}

function findAfterHereStreetFallback(
  normalized: NormalizedInput,
  index: HidrolandiaIndex | null,
  options: RunOptions,
) {
  if (!index) return null;
  if (!normalized.setor || !normalized.rua) return null;

  const resolvedStreet = resolveApprovedStreetAlias(normalized.rua, options.approvedStreetAliases);
  const candidates = getAllCandidates(index).filter(
    (candidate) =>
      candidateSetor(candidate) === normalized.lookupSetor &&
      candidateStreet(candidate) === resolvedStreet,
  );
  if (!candidates.length) return null;

  const relation = hasStrongSetorAndStreet(normalized, candidates, options);
  if (!relation.ok) return null;

  const candidateSetores = unique(candidates.map(candidateSetor));
  const candidateRuas = unique(candidates.map(candidateStreet));
  if (candidateSetores.length !== 1 || candidateRuas.length !== 1) return null;

  const anchors = candidates.filter(isInsideCoverageAnchor);
  const coordinate = averageCoordinate(anchors);
  if (!coordinate) return null;

  const anchor = anchors[0];
  const candidate = buildAfterHereStreetFallbackCandidate(
    normalized,
    anchors,
    anchor,
    coordinate.lat,
    coordinate.lng,
  );

  return {
    level: "SETOR_RUA" as const,
    source: "LOCALFIRST_HIDROLANDIA_RUA_FALLBACK" as const,
    matchType: "LOCALFIRST_HIDROLANDIA_SETOR_RUA_FALLBACK" as const,
    decisionReason: "PARTIAL_LOCALFIRST_HIDROLANDIA_RUA_AFTER_HERE_FAILURE" as const,
    shadowMatchType: "MATCH_SETOR_RUA_AFTER_HERE_PARCIAL" as const,
    reason: "safe_partial_setor_rua_after_here_anchor" as const,
    matchedKey: buildKey(["HIDROLANDIA", normalized.lookupSetor, normalized.rua, "AFTER_HERE"]),
    candidate,
    sourceCandidates: anchors,
    warnings: [
      "partial_result_not_lot_exact",
      "partial_setor_rua_after_here_anchor",
      `partial_source_candidate_count:${candidates.length}`,
      `partial_inside_anchor_count:${anchors.length}`,
    ],
  };
}

function buildDecisionSimulation(
  reason: string,
  riskLevel: "LOW" | "MEDIUM" | "HIGH",
  canPromote = false,
): HidrolandiaDecisionSimulation {
  return {
    currentWinner: "CURRENT",
    simulatedWinner: canPromote ? "HIDROLANDIA_LOCALFIRST" : "UNCHANGED",
    wouldReplaceCurrent: canPromote,
    reason,
    riskLevel,
    safeguards: [
      canPromote ? "promotion_flag_required_in_pipeline" : "shadow_only",
      "manual_memory_sovereign",
      "address_memory_write_blocked",
      "safe_unique_required",
      "setor_required",
      "street_mismatch_blocks",
      "inside_cadastral_coverage_required",
    ],
  };
}

function buildSafetyGate(blockers: string[], warnings: string[], allowPromotion = false): HidrolandiaSafetyGate {
  const normalizedBlockers = [...new Set(allowPromotion ? blockers : [...blockers, "promotion_disabled_shadow_only"])].sort();
  return {
    pass: allowPromotion && normalizedBlockers.length === 0,
    blockers: normalizedBlockers,
    warnings: [...new Set(warnings)].sort(),
    ruleVersion: "hidrolandia-localfirst-gate-v1",
  };
}

function compactCandidate(candidate: HidrolandiaLocalFirstCandidate | null): HidrolandiaProcessShadowAudit["candidateSummary"] {
  if (!candidate) return null;
  return {
    featureId: candidate.featureId || candidate.sourceFeatureId || null,
    setor: candidate.setorOriginal || "",
    quadra: candidate.quadraOriginal || "",
    lote: candidate.loteOriginal || "",
    rua: candidate.ruaOriginal || "",
    lat: Number.isFinite(candidate.lat) ? Number(candidate.lat) : null,
    lng: Number.isFinite(candidate.lng) ? Number(candidate.lng) : null,
    safetyStatus: candidate.safetyStatus || null,
  };
}

function compactFeatureIds(candidates: HidrolandiaLocalFirstCandidate[] | undefined) {
  return (candidates || [])
    .slice(0, 5)
    .map((candidate) => candidate.featureId || candidate.sourceFeatureId || "")
    .filter(Boolean);
}

function enforceProcessInvariants(
  audit: Omit<
    HidrolandiaProcessShadowAudit,
    | "currentResultPreserved"
    | "manualMemorySovereign"
    | "localFirstAppliedAsFinal"
    | "addressMemoryWriteBlocked"
  >,
): HidrolandiaProcessShadowAudit {
  return {
    ...audit,
    decisionSimulation: {
      ...audit.decisionSimulation,
      currentWinner: "CURRENT",
      simulatedWinner: "UNCHANGED",
      wouldReplaceCurrent: false,
    },
    currentResultPreserved: true,
    manualMemorySovereign: true,
    localFirstAppliedAsFinal: false,
    addressMemoryWriteBlocked: true,
  };
}

function toProcessAudit(shadow: HidrolandiaShadowResult): HidrolandiaProcessShadowAudit {
  return enforceProcessInvariants({
    enabled: true,
    skipped: shadow.skipped,
    cityDetected: shadow.cityDetected,
    localFirstFound: shadow.localFirstFound,
    matchedKey: shadow.matchedKey,
    candidateCount: shadow.candidateCount,
    matchType: shadow.matchType,
    comparisonResult: shadow.comparisonResult,
    reason: shadow.reason,
    blockers: shadow.blockers,
    warnings: shadow.warnings,
    candidateSummary: compactCandidate(shadow.candidate),
    candidateFeatureIds: compactFeatureIds(shadow.candidates),
    streetResolution: shadow.streetResolution,
    setorResolution: shadow.setorResolution,
    safetyGate: shadow.safetyGate
      ? {
          pass: false,
          blockers: shadow.safetyGate.blockers,
        }
      : null,
    decisionSimulation: shadow.decisionSimulation,
  });
}

function toDecisionAudit(shadow: HidrolandiaShadowResult, appliedAsFinal: boolean): HidrolandiaProcessShadowAudit {
  const audit = toProcessAudit(shadow);
  return {
    ...audit,
    safetyGate: shadow.safetyGate
      ? {
          pass: shadow.safetyGate.pass,
          blockers: shadow.safetyGate.blockers,
        }
      : null,
    decisionSimulation: {
      ...shadow.decisionSimulation,
      simulatedWinner: appliedAsFinal ? "HIDROLANDIA_LOCALFIRST" : shadow.decisionSimulation.simulatedWinner,
      wouldReplaceCurrent: appliedAsFinal,
    },
    localFirstAppliedAsFinal: appliedAsFinal,
  };
}

function buildProcessErrorAudit(reason: string, cityDetected = true): HidrolandiaProcessShadowAudit {
  return enforceProcessInvariants({
    enabled: true,
    skipped: true,
    cityDetected,
    localFirstFound: false,
    matchedKey: null,
    candidateCount: 0,
    matchType: "SKIPPED",
    comparisonResult: cityDetected ? "NO_LOCAL_CANDIDATE" : "SKIPPED_NOT_HIDROLANDIA",
    reason,
    blockers: [cityDetected ? "shadow_error" : "city_not_hidrolandia", "promotion_disabled_shadow_only"],
    warnings: cityDetected ? [`shadow_error:${reason}`] : [],
    candidateSummary: null,
    candidateFeatureIds: [],
    streetResolution: null,
    setorResolution: null,
    safetyGate: null,
    decisionSimulation: buildDecisionSimulation(cityDetected ? "shadow_error" : reason, "LOW"),
  });
}

function skippedResult(reason: string, comparisonResult: HidrolandiaShadowResult["comparisonResult"]): HidrolandiaShadowResult {
  const blockers = [reason, "promotion_disabled_shadow_only"];
  const warnings: string[] = [];
  return {
    enabled: true,
    cityDetected: false,
    skipped: true,
    localFirstFound: false,
    matchType: "SKIPPED",
    confidence: 0,
    matchedKey: null,
    candidateCount: 0,
    comparisonResult,
    reason,
    flags: buildFlags([]),
    blockers,
    warnings,
    candidate: null,
    candidates: [],
    streetResolution: {
      relation: "RUA_AUSENTE",
      inputRua: "",
      normalizedRua: "",
      candidateRuas: [],
      reason: "skipped",
    },
    setorResolution: {
      relation: "SETOR_AUSENTE",
      inputSetor: "",
      normalizedSetor: "",
      candidateSetores: [],
      reason: "skipped",
    },
    safetyGate: buildSafetyGate(blockers, warnings),
    decisionSimulation: buildDecisionSimulation(reason, "LOW"),
  };
}

export async function runHidrolandiaLocalFirstShadow(
  input: HidrolandiaShadowInput,
  options: RunOptions = {},
): Promise<HidrolandiaShadowResult> {
  if (!isHidrolandiaCandidate(input)) {
    return skippedResult("city_not_hidrolandia", "SKIPPED_NOT_HIDROLANDIA");
  }

  const normalized = normalizeHidrolandiaInput(input);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!normalized.setor) blockers.push("missing_setor");
  if (!normalized.quadra) blockers.push("missing_quadra");
  if (!normalized.lote) blockers.push("missing_lote");

  const index = options.candidatesOverride ? null : readIndex();
  let candidates = options.candidatesOverride || index?.byKey?.[normalized.key] || [];
  const promotionCandidates =
    options.promotionCandidatesOverride || index?.promotionByKey?.[normalized.key] || [];

  if (!candidates.length && index && normalized.quadra && normalized.lote) {
    const byQuadraLote = getCandidatesByQuadraLote(index, normalized.quadraLoteKey);
    if (byQuadraLote.length) {
      candidates = byQuadraLote;
      if (normalized.setor) blockers.push("setor_mismatch");
    }
  }

  const streetResolution = resolveStreet(normalized, candidates, options.approvedStreetAliases);
  const setorResolution = resolveSetor(normalized, candidates, options.approvedSetorAliases);
  const candidateBlockers = candidates.flatMap((candidate) => candidate.blockers || []);
  const candidateWarnings = candidates.flatMap((candidate) => candidate.warnings || []);

  blockers.push(...candidateBlockers);
  warnings.push(...candidateWarnings);

  if (!candidates.length) blockers.push("no_candidate");
  if (candidates.length > 1 && !(options.allowPromotion && promotionCandidates.length === 1)) {
    blockers.push("multiple_candidates");
  }
  if (setorResolution.relation === "SETOR_AUSENTE") blockers.push("missing_setor");
  if (setorResolution.relation === "SETOR_MISMATCH") blockers.push("setor_mismatch");
  if (setorResolution.relation === "SETOR_AMBIGUO") blockers.push("setor_ambiguous");
  if (streetResolution.relation === "RUA_MISMATCH") blockers.push("street_mismatch");
  if (streetResolution.relation === "RUA_AMBIGUA") blockers.push("street_ambiguous");
  if (streetResolution.relation === "RUA_AUSENTE") warnings.push("street_absent");

  for (const candidate of candidates) {
    if (!isValidCoordinate(candidate)) blockers.push("invalid_coordinate");
    if (!candidate.sourceFeatureId) blockers.push("missing_traceability");
    if (candidate.cadastralCoverageStatus !== "INSIDE_CADASTRAL_COVERAGE") {
      blockers.push("outside_or_unknown_cadastral_coverage");
    }
    if (candidate.flags?.representativePointSuspicious) blockers.push("suspicious_representative_point");
  }

  const promotionCandidate = promotionCandidates.length === 1 ? promotionCandidates[0] : null;
  if (options.allowPromotion) {
    if (!promotionCandidate) blockers.push(promotionCandidates.length > 1 ? "multiple_promotion_candidates" : "not_in_promotion_index");
    if (promotionCandidate?.safetyStatus !== "SAFE_UNIQUE") blockers.push("not_safe_unique");
    if (promotionCandidate && !isValidCoordinate(promotionCandidate)) blockers.push("invalid_coordinate");
    if (promotionCandidate?.cadastralCoverageStatus !== "INSIDE_CADASTRAL_COVERAGE") {
      blockers.push("outside_or_unknown_cadastral_coverage");
    }
    if (normalized.rua && !STRONG_STREET_RELATIONS.includes(streetResolution.relation)) {
      blockers.push("street_not_strong");
    }
    if (!normalized.rua) warnings.push("promotion_without_input_street");
    if (!STRONG_SETOR_RELATIONS.includes(setorResolution.relation)) {
      blockers.push("setor_not_strong");
    }
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  const uniqueWarnings = [...new Set(warnings)].sort();
  const flags = buildFlags(candidates);
  const canPromote = Boolean(options.allowPromotion && promotionCandidate && uniqueBlockers.length === 0);
  const selectedCandidate = canPromote ? promotionCandidate : candidates.length === 1 ? candidates[0] : null;
  const localFirstFound = candidates.length > 0;
  const matchType: HidrolandiaShadowMatchType = !localFirstFound
    ? "NO_CANDIDATE"
    : canPromote
      ? "MATCH_UNICO_ESTRUTURAL"
    : candidates.length > 1
      ? "MATCH_MULTIPLO"
      : uniqueBlockers.length > 0
        ? "BLOCKED"
        : "MATCH_UNICO_ESTRUTURAL";
  const riskLevel = canPromote ? "LOW" : uniqueBlockers.length > 0 || candidates.length !== 1 ? "HIGH" : "MEDIUM";
  const reason = canPromote ? "safe_unique_promotion_candidate" : uniqueBlockers[0] || "shadow_only_promotion_disabled";

  const partialFallback =
    !canPromote && options.allowPromotion
      ? findPartialFallback(normalized, index, options, uniqueBlockers, candidates)
      : null;

  if (partialFallback) {
    const partialWarnings = [...new Set([...uniqueWarnings, ...partialFallback.warnings])].sort();
    const partialCandidates = [partialFallback.candidate];
    return {
      enabled: true,
      cityDetected: true,
      skipped: false,
      localFirstFound: true,
      matchType: partialFallback.shadowMatchType,
      confidence: partialFallback.candidate.confidence ?? 0.68,
      matchedKey: partialFallback.matchedKey,
      candidateCount: 1,
      comparisonResult: "CURRENT_RESULT_PRESERVED",
      reason: partialFallback.reason,
      flags: buildFlags(partialCandidates),
      blockers: [],
      warnings: partialWarnings,
      candidate: partialFallback.candidate,
      candidates: partialCandidates,
      streetResolution: resolveStreet(normalized, partialCandidates, options.approvedStreetAliases),
      setorResolution: resolveSetor(normalized, partialCandidates, options.approvedSetorAliases),
      safetyGate: buildSafetyGate([], partialWarnings, options.allowPromotion),
      decisionSimulation: buildDecisionSimulation(partialFallback.reason, "LOW", true),
    };
  }

  return {
    enabled: true,
    cityDetected: true,
    skipped: false,
    localFirstFound,
    matchType,
    confidence: selectedCandidate?.confidence ?? (localFirstFound ? 0.3 : 0),
    matchedKey: localFirstFound ? normalized.key : null,
    candidateCount: canPromote ? 1 : candidates.length,
    comparisonResult: localFirstFound ? "CURRENT_RESULT_PRESERVED" : "NO_LOCAL_CANDIDATE",
    reason,
    flags,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    candidate: selectedCandidate,
    candidates: canPromote && selectedCandidate ? [selectedCandidate] : candidates.slice(0, 20),
    streetResolution,
    setorResolution,
    safetyGate: buildSafetyGate(uniqueBlockers, uniqueWarnings, options.allowPromotion),
    decisionSimulation: buildDecisionSimulation(reason, riskLevel, canPromote),
  };
}

export async function runHidrolandiaShadowForProcess(
  input: HidrolandiaProcessShadowInput,
): Promise<HidrolandiaProcessShadowAudit> {
  try {
    if (!isHidrolandiaCandidate(input)) {
      return buildProcessErrorAudit("shadow_skipped_not_hidrolandia", false);
    }
    const shadow = await runHidrolandiaLocalFirstShadow(input);
    return toProcessAudit(shadow);
  } catch (error) {
    return buildProcessErrorAudit(error instanceof Error ? error.message : String(error), true);
  }
}

export async function runHidrolandiaLocalFirstForProcess(
  input: HidrolandiaProcessShadowInput,
): Promise<HidrolandiaLocalFirstDecision> {
  try {
    if (!isHidrolandiaCandidate(input)) {
      const audit = buildProcessErrorAudit("shadow_skipped_not_hidrolandia", false);
      return {
        audit,
        canPromote: false,
        canApplyPartial: false,
        partialLevel: null,
        partialSource: null,
        partialMatchType: null,
        partialDecisionReason: null,
        blockedReason: "city_not_hidrolandia",
        candidate: null,
        partialCandidate: null,
      };
    }
    const shadow = await runHidrolandiaLocalFirstShadow(input, { allowPromotion: true });
    const candidate = shadow.candidate;
    const partialLevel =
      shadow.matchType === "MATCH_SETOR_RUA_QUADRA_PARCIAL"
        ? "SETOR_RUA_QUADRA"
        : shadow.matchType === "MATCH_SETOR_RUA_PARCIAL"
          ? "SETOR_RUA"
          : null;
    const canPromote =
      shadow.matchType === "MATCH_UNICO_ESTRUTURAL" &&
      shadow.safetyGate.pass === true &&
      shadow.decisionSimulation.riskLevel === "LOW" &&
      shadow.decisionSimulation.wouldReplaceCurrent === true &&
      shadow.decisionSimulation.simulatedWinner === "HIDROLANDIA_LOCALFIRST" &&
      candidate?.safetyStatus === "SAFE_UNIQUE" &&
      candidate?.cadastralCoverageStatus === "INSIDE_CADASTRAL_COVERAGE" &&
      isValidCoordinate(candidate);
    const canApplyPartial =
      !!partialLevel &&
      shadow.safetyGate.pass === true &&
      shadow.decisionSimulation.riskLevel === "LOW" &&
      shadow.decisionSimulation.wouldReplaceCurrent === true &&
      shadow.decisionSimulation.simulatedWinner === "HIDROLANDIA_LOCALFIRST" &&
      candidate?.cadastralCoverageStatus === "INSIDE_CADASTRAL_COVERAGE" &&
      isValidCoordinate(candidate);
    const applied = canPromote || canApplyPartial;
    return {
      audit: toDecisionAudit(shadow, applied),
      canPromote,
      canApplyPartial,
      partialLevel,
      partialSource:
        partialLevel === "SETOR_RUA_QUADRA"
          ? "LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
          : partialLevel === "SETOR_RUA"
            ? "LOCALFIRST_HIDROLANDIA_SETOR_RUA"
            : null,
      partialMatchType:
        partialLevel === "SETOR_RUA_QUADRA"
          ? "LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
          : partialLevel === "SETOR_RUA"
            ? "LOCALFIRST_HIDROLANDIA_SETOR_RUA"
            : null,
      partialDecisionReason:
        partialLevel === "SETOR_RUA_QUADRA"
          ? "PARCIAL_LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
          : partialLevel === "SETOR_RUA"
            ? "PARCIAL_LOCALFIRST_HIDROLANDIA_SETOR_RUA"
            : null,
      blockedReason: applied ? "not_blocked" : shadow.safetyGate.blockers[0] || shadow.reason,
      candidate: canPromote ? candidate : null,
      partialCandidate: canApplyPartial ? candidate : null,
    };
  } catch (error) {
    const audit = buildProcessErrorAudit(error instanceof Error ? error.message : String(error), true);
    return {
      audit,
      canPromote: false,
      canApplyPartial: false,
      partialLevel: null,
      partialSource: null,
      partialMatchType: null,
      partialDecisionReason: null,
      blockedReason: "shadow_error",
      candidate: null,
      partialCandidate: null,
    };
  }
}

export async function runHidrolandiaStreetFallbackAfterHere(
  input: HidrolandiaProcessShadowInput,
): Promise<HidrolandiaLocalFirstDecision> {
  try {
    if (!isHidrolandiaCandidate(input)) {
      const audit = buildProcessErrorAudit("shadow_skipped_not_hidrolandia", false);
      return {
        audit,
        canPromote: false,
        canApplyPartial: false,
        partialLevel: null,
        partialSource: null,
        partialMatchType: null,
        partialDecisionReason: null,
        blockedReason: "city_not_hidrolandia",
        candidate: null,
        partialCandidate: null,
      };
    }

    const normalized = normalizeHidrolandiaInput(input);
    const fallback = findAfterHereStreetFallback(normalized, readIndex(), {});

    if (!fallback) {
      const shadow = await runHidrolandiaLocalFirstShadow(input, { allowPromotion: true });
      return {
        audit: toDecisionAudit(shadow, false),
        canPromote: false,
        canApplyPartial: false,
        partialLevel: null,
        partialSource: null,
        partialMatchType: null,
        partialDecisionReason: null,
        blockedReason: shadow.safetyGate.blockers[0] || shadow.reason,
        candidate: null,
        partialCandidate: null,
      };
    }

    const shadow: HidrolandiaShadowResult = {
      enabled: true,
      cityDetected: true,
      skipped: false,
      localFirstFound: true,
      matchType: fallback.shadowMatchType,
      confidence: fallback.candidate.confidence ?? 0.64,
      matchedKey: fallback.matchedKey,
      candidateCount: 1,
      comparisonResult: "CURRENT_RESULT_PRESERVED",
      reason: fallback.reason,
      flags: buildFlags([fallback.candidate]),
      blockers: [],
      warnings: fallback.warnings,
      candidate: fallback.candidate,
      candidates: [fallback.candidate],
      streetResolution: resolveStreet(normalized, [fallback.candidate]),
      setorResolution: resolveSetor(normalized, [fallback.candidate]),
      safetyGate: buildSafetyGate([], fallback.warnings, true),
      decisionSimulation: buildDecisionSimulation(fallback.reason, "LOW", true),
    };

    return {
      audit: toDecisionAudit(shadow, true),
      canPromote: false,
      canApplyPartial: true,
      partialLevel: "SETOR_RUA_AFTER_HERE",
      partialSource: fallback.source,
      partialMatchType: fallback.matchType,
      partialDecisionReason: fallback.decisionReason,
      blockedReason: "not_blocked",
      candidate: null,
      partialCandidate: fallback.candidate,
    };
  } catch (error) {
    const audit = buildProcessErrorAudit(error instanceof Error ? error.message : String(error), true);
    return {
      audit,
      canPromote: false,
      canApplyPartial: false,
      partialLevel: null,
      partialSource: null,
      partialMatchType: null,
      partialDecisionReason: null,
      blockedReason: "shadow_error",
      candidate: null,
      partialCandidate: null,
    };
  }
}
