export type LocalFirstValidationCity = "GOIANIA" | "APARECIDA";

export type LocalFirstValidationStatus =
  | "VALIDATED"
  | "FAILED"
  | "NEEDS_REVIEW";

export type LocalFirstStreetMatchType =
  | "STREET_MATCH"
  | "STREET_PARTIAL_MATCH"
  | "STREET_MISMATCH"
  | "STREET_UNKNOWN";

export type LocalFirstCandidateValidationInput = {
  city: LocalFirstValidationCity;
  bairro: string;
  rua?: string | null;
  quadra: string;
  lote: string;
  originalAddress?: string | null;
};

export type LocalFirstValidatedCandidate = {
  bairro: string;
  quadra: string;
  lote: string;
  streetLabel?: string | null;
};

export type LocalFirstCandidateValidationResult = {
  attempted: boolean;
  found: boolean;
  validationStatus: LocalFirstValidationStatus;
  reason: string;
  failureReason?: string | null;
  city: LocalFirstValidationCity;
  matchType?: string | null;
  streetMatchType?: LocalFirstStreetMatchType | null;
  candidateCount: number;
  candidateUnique: boolean;
  candidate?: LocalFirstValidatedCandidate | null;
  diagnostics?: Record<string, unknown>;
};
