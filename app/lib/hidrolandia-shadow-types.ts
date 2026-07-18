export type HidrolandiaShadowMatchType =
  | "MATCH_UNICO_ESTRUTURAL"
  | "MATCH_SETOR_RUA_QUADRA_PARCIAL"
  | "MATCH_SETOR_RUA_PARCIAL"
  | "MATCH_SETOR_RUA_AFTER_HERE_PARCIAL"
  | "MATCH_MULTIPLO"
  | "BLOCKED"
  | "NO_CANDIDATE"
  | "SKIPPED";

export type HidrolandiaShadowComparison =
  | "LOCAL_CANDIDATE_ONLY"
  | "NO_LOCAL_CANDIDATE"
  | "SKIPPED_NOT_HIDROLANDIA"
  | "SKIPPED_FLAG_OFF"
  | "CURRENT_RESULT_PRESERVED";

export type HidrolandiaStreetResolution =
  | "RUA_EXACT"
  | "RUA_ALIAS_APROVADO"
  | "RUA_COMPATIVEL_FORTE"
  | "RUA_FRACA"
  | "RUA_MISMATCH"
  | "RUA_AUSENTE"
  | "RUA_AMBIGUA";

export type HidrolandiaSetorResolution =
  | "SETOR_EXACT"
  | "SETOR_ALIAS_APROVADO"
  | "SETOR_COMPATIVEL_FORTE"
  | "SETOR_FRACO"
  | "SETOR_MISMATCH"
  | "SETOR_AUSENTE"
  | "SETOR_AMBIGUO";

export type HidrolandiaShadowFlags = {
  currentResultPreserved: true;
  manualMemorySovereign: true;
  localFirstAppliedAsFinal: false;
  addressMemoryWriteBlocked: true;
  exactKeyMatch: boolean;
  multipleCandidates: boolean;
  structuralDuplicate: boolean;
  specialLot: boolean;
  invalidCoordinate: boolean;
  suspiciousGeometry: boolean;
  outsideOrUnknownCadastralCoverage: boolean;
};

export type HidrolandiaDecisionSimulation = {
  currentWinner: "CURRENT";
  simulatedWinner: "UNCHANGED" | "HIDROLANDIA_LOCALFIRST";
  wouldReplaceCurrent: boolean;
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  safeguards: string[];
};

export type HidrolandiaSafetyGate = {
  pass: boolean;
  blockers: string[];
  warnings: string[];
  ruleVersion: "hidrolandia-localfirst-gate-v1";
};

export type HidrolandiaShadowInput = {
  city?: string;
  setor?: string;
  bairro?: string;
  quadra?: string;
  lote?: string;
  rua?: string;
  rawAddress?: string;
  currentResult?: {
    source?: string;
    lat?: number | null;
    lng?: number | null;
    matchedKey?: string | null;
    matchType?: string | null;
    confidence?: number | null;
    status?: "OK" | "PARCIAL" | "PENDENTE" | string;
  } | null;
};

export type HidrolandiaLocalFirstCandidate = {
  featureId?: string;
  sourceIndex?: number;
  key: string;
  quadraLoteKey?: string;
  setorOriginal: string;
  setorNormalizado: string;
  quadraOriginal: string;
  quadraNormalizada: string;
  loteOriginal: string;
  loteNormalizado: string;
  ruaOriginal?: string;
  ruaNormalizada?: string;
  lat: number | null;
  lng: number | null;
  origem?: string;
  geometryType?: string | null;
  tipoCadastro?: string;
  safetyStatus?: string;
  structuralStatus?: string;
  flags?: {
    specialLot?: boolean;
    centroidOutsidePolygon?: boolean;
    representativePointInsidePolygon?: boolean;
    representativePointSuspicious?: boolean;
    outsideOrUnknownCadastralCoverage?: boolean;
  };
  blockers?: string[];
  warnings?: string[];
  confidence?: number;
  geometryHash?: string;
  sourceFile?: string;
  sourceFeatureId?: string;
  candidateCountForKey?: number;
  candidateCountForQuadraLote?: number;
  cadastralCoverageStatus?:
    | "INSIDE_CADASTRAL_COVERAGE"
    | "OUTSIDE_CADASTRAL_COVERAGE"
    | "CADASTRAL_COVERAGE_UNKNOWN"
    | string;
  representativePointMethod?: string;
};

export type HidrolandiaShadowResult = {
  enabled: boolean;
  cityDetected: boolean;
  skipped: boolean;
  localFirstFound: boolean;
  matchType: HidrolandiaShadowMatchType;
  confidence: number;
  matchedKey: string | null;
  candidateCount: number;
  comparisonResult: HidrolandiaShadowComparison;
  reason: string;
  flags: HidrolandiaShadowFlags;
  blockers: string[];
  warnings: string[];
  candidate: HidrolandiaLocalFirstCandidate | null;
  candidates?: HidrolandiaLocalFirstCandidate[];
  streetResolution: {
    relation: HidrolandiaStreetResolution;
    inputRua: string;
    normalizedRua: string;
    candidateRuas: string[];
    reason: string;
  };
  setorResolution: {
    relation: HidrolandiaSetorResolution;
    inputSetor: string;
    normalizedSetor: string;
    candidateSetores: string[];
    reason: string;
  };
  safetyGate: HidrolandiaSafetyGate;
  decisionSimulation: HidrolandiaDecisionSimulation;
};

export type HidrolandiaProcessShadowInput = HidrolandiaShadowInput;

export type HidrolandiaCandidateSummary = {
  featureId: string | null;
  setor: string;
  quadra: string;
  lote: string;
  rua: string;
  lat: number | null;
  lng: number | null;
  safetyStatus: string | null;
};

export type HidrolandiaProcessShadowAudit = {
  enabled: boolean;
  skipped: boolean;
  cityDetected: boolean;
  localFirstFound: boolean;
  matchedKey: string | null;
  candidateCount: number;
  matchType: HidrolandiaShadowMatchType;
  comparisonResult: HidrolandiaShadowComparison;
  reason: string;
  blockers: string[];
  warnings: string[];
  candidateSummary: HidrolandiaCandidateSummary | null;
  candidateFeatureIds: string[];
  streetResolution: HidrolandiaShadowResult["streetResolution"] | null;
  setorResolution: HidrolandiaShadowResult["setorResolution"] | null;
  safetyGate: {
    pass: boolean;
    blockers: string[];
  } | null;
  decisionSimulation: HidrolandiaDecisionSimulation;
  currentResultPreserved: true;
  manualMemorySovereign: true;
  localFirstAppliedAsFinal: boolean;
  addressMemoryWriteBlocked: true;
};

export type HidrolandiaLocalFirstDecision = {
  audit: HidrolandiaProcessShadowAudit;
  canPromote: boolean;
  canApplyPartial?: boolean;
  partialLevel?: "SETOR_RUA_QUADRA" | "SETOR_RUA" | "SETOR_RUA_AFTER_HERE" | null;
  partialSource?:
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA"
    | "LOCALFIRST_HIDROLANDIA_RUA_FALLBACK"
    | null;
  partialMatchType?:
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA"
    | "LOCALFIRST_HIDROLANDIA_SETOR_RUA_FALLBACK"
    | null;
  partialDecisionReason?:
    | "PARCIAL_LOCALFIRST_HIDROLANDIA_SETOR_RUA_QUADRA"
    | "PARCIAL_LOCALFIRST_HIDROLANDIA_SETOR_RUA"
    | "PARTIAL_LOCALFIRST_HIDROLANDIA_RUA_AFTER_HERE_FAILURE"
    | null;
  blockedReason: string;
  candidate: HidrolandiaLocalFirstCandidate | null;
  partialCandidate?: HidrolandiaLocalFirstCandidate | null;
};
