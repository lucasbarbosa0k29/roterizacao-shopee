export type TrindadeShadowMatchType =
  | "MATCH_FORTE"
  | "MATCH_MEDIO"
  | "MATCH_RUA_BAIRRO"
  | "MATCH_FALLBACK"
  | "SKIPPED";

export type TrindadeShadowComparison =
  | "AGREE_EXACT"
  | "AGREE_APPROX"
  | "DIFF_BUT_ACCEPTABLE"
  | "DIFF_CONFLICT"
  | "NO_LOCAL_CANDIDATE"
  | "SKIPPED_NOT_TRINDADE"
  | "SKIPPED_FLAG_OFF";

export type TrindadeShadowFlags = {
  exactKeyMatch: boolean;
  fallbackUsed: boolean;
  aliasUsed: boolean;
  relationshipUsed: boolean;
  weakRelation: boolean;
  conflictWithHere: boolean;
  manualMemorySovereign: boolean;
  currentResultPreserved: boolean;
};

export type TrindadeShadowComparisonDetails = {
  currentStatus: string | null;
  currentSource: string | null;
  currentLat: number | null;
  currentLng: number | null;
  currentMatchedKey: string | null;
  comparisonResult: TrindadeShadowComparison;
};

export type TrindadeStreetBairroResolutionLevel =
  | "STRONG_STREET_BAIRRO"
  | "MEDIUM_STREET_BAIRRO"
  | "WEAK_STREET_BAIRRO"
  | "NONE";

export type TrindadeStreetBairroResolution = {
  level: TrindadeStreetBairroResolutionLevel;
  cdlogradouro: string | null;
  tipologradouro: string | null;
  bairroKey?: string | null;
  normalizedStreet: string;
  normalizedBairro: string;
  candidatesCount: number;
  usedAlias: boolean;
  streetAliasUsed?: boolean;
  bairroAliasUsed?: boolean;
  exactStreetMatch?: boolean;
  exactBairroMatch?: boolean;
  uniqueCandidate?: boolean;
  reason: string | null;
};

export type TrindadePromotionSimulation = {
  eligible: boolean;
  promotedMatchType: "MATCH_RUA_BAIRRO" | null;
  promotedTo: "MATCH_RUA_BAIRRO" | null;
  fromMatchType: string;
  reason: string;
};

export type TrindadeShadowConfidenceBucket = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type TrindadeShadowConfidence = {
  score: number;
  bucket: TrindadeShadowConfidenceBucket;
  reasons: string[];
};

export type TrindadeDecisionSimulation = {
  currentWinner: string;
  simulatedWinner: "CURRENT" | "TRINDADE_LOCALFIRST" | "UNCHANGED";
  wouldReplaceCurrent: boolean;
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  safeguards: string[];
};

export type TrindadeSafetyGate = {
  pass: boolean;
  blockers: string[];
  warnings: string[];
  ruleVersion: "trindade-localfirst-gate-v1";
};

export type TrindadeShadowInput = {
  city?: string;
  bairro?: string;
  rua?: string;
  cdbairro?: string;
  cdlogradouro?: string;
  nmlogradouro?: string;
  tipologradouro?: string;
  quadra?: string;
  lote?: string;
  loteamento?: string;
  cdloteamento?: string;
  cdquadra?: string;
  cdlote?: string;
  rawAddress?: string;
  cep?: string;
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

export type TrindadeShadowResult = {
  enabled?: boolean;
  cityDetected: boolean;
  skipped: boolean;
  localFirstFound: boolean;
  matchType: TrindadeShadowMatchType;
  confidence: number;
  matchedKey: string | null;
  matchedLayer: "lotes" | "quadras" | "logradouros" | "bairros" | "loteamentos" | null;
  fallbackUsed: boolean;
  conflictWithHere: boolean;
  comparisonResult: TrindadeShadowComparison;
  comparison?: TrindadeShadowComparisonDetails | null;
  reason?: string | null;
  flags: TrindadeShadowFlags;
  notes: string[];
  candidate?: {
    key: string;
    layer: string;
    reason: string;
  } | null;
  streetBairroResolution?: TrindadeStreetBairroResolution | null;
  promotionSimulation?: TrindadePromotionSimulation | null;
  shadowConfidence?: TrindadeShadowConfidence | null;
  decisionSimulation?: TrindadeDecisionSimulation | null;
  safetyGate?: TrindadeSafetyGate | null;
};
