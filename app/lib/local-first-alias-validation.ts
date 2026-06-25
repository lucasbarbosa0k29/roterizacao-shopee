import { resolveAparecidaLocalFirstCandidate } from "@/app/lib/aparecida-local-lots";
import { resolveGoianiaLocalFirstCandidate } from "@/app/lib/goiania-local-first";
import type {
  LocalFirstCandidateValidationInput,
  LocalFirstCandidateValidationResult,
  LocalFirstValidationCity,
} from "@/app/lib/local-first-validation-types";

export type LocalFirstAliasValidationAlias = {
  id: string;
  city: string;
  aliasType: "BAIRRO" | "RUA" | "BAIRRO_RUA";
  sourceBairro: string;
  sourceRua: string;
  targetBairro?: string | null;
  targetRua?: string | null;
};

export type LocalFirstAliasValidationRequest = {
  sampleQuadra: string;
  sampleLote: string;
  targetBairro?: string | null;
  targetRua?: string | null;
};

export type LocalFirstAliasValidationResponse = {
  aliasId: string;
  appliedInput: LocalFirstCandidateValidationInput;
  result: LocalFirstCandidateValidationResult;
};

export class LocalFirstAliasValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "LocalFirstAliasValidationError";
  }
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(value: string | null | undefined) {
  if (!value) return "";
  return stripAccents(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeLocalFirstValidationCity(
  value: string,
): LocalFirstValidationCity {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  if (normalized.includes("APARECIDA")) return "APARECIDA";
  if (normalized.includes("GOIANIA")) return "GOIANIA";

  throw new LocalFirstAliasValidationError(
    "Cidade não suportada para validação LocalFirst.",
    "UNSUPPORTED_CITY",
  );
}

function buildNeedsReviewResult(args: {
  city: LocalFirstValidationCity;
  reason: string;
  appliedInput: LocalFirstCandidateValidationInput;
}): LocalFirstCandidateValidationResult {
  return {
    attempted: false,
    found: false,
    validationStatus: "NEEDS_REVIEW",
    reason: args.reason,
    failureReason: args.reason,
    city: args.city,
    matchType: "alias_validation_guard",
    streetMatchType: null,
    candidateCount: 0,
    candidateUnique: false,
    candidate: null,
    diagnostics: {
      appliedInput: args.appliedInput,
    },
  };
}

function applyAlias(args: {
  alias: LocalFirstAliasValidationAlias;
  request: LocalFirstAliasValidationRequest;
  city: LocalFirstValidationCity;
}): LocalFirstCandidateValidationInput {
  const sampleQuadra = String(args.request.sampleQuadra || "").trim();
  const sampleLote = String(args.request.sampleLote || "").trim();

  if (!sampleQuadra || !sampleLote) {
    throw new LocalFirstAliasValidationError(
      "sampleQuadra e sampleLote são obrigatórios.",
      "MISSING_SAMPLE_QD_LT",
    );
  }

  const sourceBairro = String(args.alias.sourceBairro || "").trim();
  const sourceRua = String(args.alias.sourceRua || "").trim();
  const targetBairro = String(
    args.request.targetBairro ?? args.alias.targetBairro ?? "",
  ).trim();
  const targetRua = String(
    args.request.targetRua ?? args.alias.targetRua ?? "",
  ).trim();

  if (!sourceBairro) {
    throw new LocalFirstAliasValidationError(
      "Alias sem bairro de origem.",
      "MISSING_SOURCE_BAIRRO",
    );
  }

  if (args.alias.aliasType === "BAIRRO") {
    if (!targetBairro) {
      throw new LocalFirstAliasValidationError(
        "Alias de bairro exige targetBairro para validação.",
        "MISSING_TARGET_BAIRRO",
      );
    }

    return {
      city: args.city,
      bairro: targetBairro,
      rua: targetRua || sourceRua || null,
      quadra: sampleQuadra,
      lote: sampleLote,
    };
  }

  if (args.alias.aliasType === "RUA") {
    if (!sourceRua) {
      throw new LocalFirstAliasValidationError(
        "Alias de rua exige sourceRua.",
        "MISSING_SOURCE_RUA",
      );
    }
    if (!targetRua) {
      throw new LocalFirstAliasValidationError(
        "Alias de rua exige targetRua para validação.",
        "MISSING_TARGET_RUA",
      );
    }

    return {
      city: args.city,
      bairro: sourceBairro,
      rua: targetRua,
      quadra: sampleQuadra,
      lote: sampleLote,
    };
  }

  if (args.alias.aliasType === "BAIRRO_RUA") {
    if (!targetBairro) {
      throw new LocalFirstAliasValidationError(
        "Alias de bairro e rua exige targetBairro para validação.",
        "MISSING_TARGET_BAIRRO",
      );
    }
    if (!targetRua) {
      throw new LocalFirstAliasValidationError(
        "Alias de bairro e rua exige targetRua para validação.",
        "MISSING_TARGET_RUA",
      );
    }

    return {
      city: args.city,
      bairro: targetBairro,
      rua: targetRua,
      quadra: sampleQuadra,
      lote: sampleLote,
    };
  }

  throw new LocalFirstAliasValidationError(
    "Tipo de alias não suportado.",
    "UNSUPPORTED_ALIAS_TYPE",
  );
}

export function validateLocalFirstAlias(
  alias: LocalFirstAliasValidationAlias,
  request: LocalFirstAliasValidationRequest,
): LocalFirstAliasValidationResponse {
  const city = normalizeLocalFirstValidationCity(alias.city);
  const appliedInput = applyAlias({ alias, request, city });
  const hasEffectiveRua = !!String(appliedInput.rua || "").trim();

  if (alias.aliasType === "BAIRRO" && !hasEffectiveRua) {
    return {
      aliasId: alias.id,
      appliedInput,
      result: buildNeedsReviewResult({
        city,
        reason: "alias_bairro_street_required",
        appliedInput,
      }),
    };
  }

  const result =
    city === "GOIANIA"
      ? resolveGoianiaLocalFirstCandidate(appliedInput)
      : resolveAparecidaLocalFirstCandidate(appliedInput);

  if (alias.aliasType === "BAIRRO" && result.validationStatus === "VALIDATED") {
    return {
      aliasId: alias.id,
      appliedInput,
      result: {
        ...result,
        validationStatus: "NEEDS_REVIEW",
        reason: "alias_bairro_street_required",
        failureReason: "alias_bairro_street_required",
      },
    };
  }

  return {
    aliasId: alias.id,
    appliedInput,
    result,
  };
}
