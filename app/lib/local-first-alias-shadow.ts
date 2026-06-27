import {
  LocalFirstAliasSource,
  LocalFirstAliasType,
  LocalFirstAliasValidationStatus,
} from "@prisma/client";
import { suggestLocalFirstAliasWithGemini } from "@/app/lib/local-first-alias-ai";
import { buildLocalFirstAliasCandidatePack } from "@/app/lib/local-first-alias-candidates";
import {
  createPendingLocalFirstAlias,
  findApprovedLocalFirstAlias,
  findLocalFirstAliasInCooldown,
  normalizeAliasText,
  normalizeLocalFirstAliasCity,
} from "@/app/lib/local-first-aliases";

export type LocalFirstAliasShadowState = {
  jobId: string;
  seenKeys: Set<string>;
  geminiCalls: number;
  maxGeminiCalls: number;
  shadowTasks: Promise<unknown>[];
};

export type RunLocalFirstAliasShadowInput = {
  state: LocalFirstAliasShadowState;
  city: string;
  sourceBairro: string;
  sourceRua: string;
  quadra: string;
  lote: string;
  failureReason?: string | null;
  rowSequence?: string | number | null;
};

export type LocalFirstAliasShadowResult = {
  attempted: boolean;
  skippedReason?: string | null;
  savedAliasId?: string | null;
  rejectedReason?: string | null;
};

export function getLocalFirstAliasShadowSnapshot(state: LocalFirstAliasShadowState) {
  return {
    jobId: state.jobId,
    shadowTasksSize: state.shadowTasks.length,
    seenKeysSize: state.seenKeys.size,
    geminiCalls: state.geminiCalls,
    maxGeminiCalls: state.maxGeminiCalls,
  };
}

const DEFAULT_MAX_GEMINI_CALLS_PER_JOB = 30;

export function isLocalFirstAliasShadowEnabled() {
  return process.env.ROTTA_LOCAL_FIRST_ALIAS_SHADOW === "1";
}

function readMaxGeminiCallsPerJob() {
  const parsed = Number.parseInt(
    String(process.env.ROTTA_LOCAL_FIRST_ALIAS_SHADOW_MAX_PER_JOB || ""),
    10,
  );

  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MAX_GEMINI_CALLS_PER_JOB;
  }

  return parsed;
}

export function createLocalFirstAliasShadowState(
  jobId: string,
): LocalFirstAliasShadowState {
  return {
    jobId,
    seenKeys: new Set<string>(),
    geminiCalls: 0,
    maxGeminiCalls: readMaxGeminiCallsPerJob(),
    shadowTasks: [],
  };
}

function logShadow(event: string, payload: Record<string, unknown>) {
  console.info(`[${event}]`, payload);
}

function normalizeSupportedCity(value: string) {
  const city = normalizeLocalFirstAliasCity(value);
  if (city === "GOIANIA" || city === "APARECIDA") return city;
  return null;
}

function buildDedupeKey(args: {
  city: string;
  sourceBairro: string;
  sourceRua: string;
}) {
  return [
    normalizeLocalFirstAliasCity(args.city),
    normalizeAliasText(args.sourceBairro),
    normalizeAliasText(args.sourceRua),
  ].join("::");
}

function resolveAliasType(args: {
  bairroAlias: string | null;
  ruaAlias: string | null;
}) {
  if (args.bairroAlias && args.ruaAlias) return LocalFirstAliasType.BAIRRO_RUA;
  if (args.ruaAlias) return LocalFirstAliasType.RUA;
  return LocalFirstAliasType.BAIRRO;
}

function skip(
  input: RunLocalFirstAliasShadowInput,
  reason: string,
): LocalFirstAliasShadowResult {
  logShadow("ALIAS_SHADOW_SKIPPED", {
    jobId: input.state.jobId,
    sequence: input.rowSequence ?? "",
    reason,
  });

  return {
    attempted: false,
    skippedReason: reason,
  };
}

export async function runLocalFirstAliasShadow(
  input: RunLocalFirstAliasShadowInput,
): Promise<LocalFirstAliasShadowResult> {
  try {
    if (!isLocalFirstAliasShadowEnabled()) return skip(input, "SHADOW_DISABLED");

    const city = normalizeSupportedCity(input.city);
    if (!city) return skip(input, "UNSUPPORTED_CITY");

    const sourceBairro = String(input.sourceBairro || "").trim();
    const sourceRua = String(input.sourceRua || "").trim();
    const quadra = String(input.quadra || "").trim();
    const lote = String(input.lote || "").trim();

    if (!sourceBairro || !sourceRua || !quadra || !lote) {
      return skip(input, "MISSING_REQUIRED_INPUT");
    }

    const approved = await findApprovedLocalFirstAlias({
      city,
      aliasType: LocalFirstAliasType.BAIRRO_RUA,
      sourceBairro,
      sourceRua,
    });
    if (approved) return skip(input, "APPROVED_ALIAS_EXISTS");

    const cooldown = await findLocalFirstAliasInCooldown({
      city,
      aliasType: LocalFirstAliasType.BAIRRO_RUA,
      sourceBairro,
      sourceRua,
    });
    if (cooldown) return skip(input, "ALIAS_COOLDOWN");

    const pack = buildLocalFirstAliasCandidatePack({
      city,
      bairro: sourceBairro,
      rua: sourceRua,
      quadra,
      lote,
      failureReason: input.failureReason ?? null,
    });

    logShadow("ALIAS_SHADOW_PACK", {
      jobId: input.state.jobId,
      sequence: input.rowSequence ?? "",
      city,
      eligibleForAi: pack.eligibleForAi,
      skipReason: pack.skipReason ?? null,
      pairs: pack.candidatePairs.length,
    });

    if (pack.eligibleForAi !== true || pack.skipReason) {
      return skip(input, pack.skipReason || "PACK_NOT_ELIGIBLE");
    }

    if (input.state.geminiCalls >= input.state.maxGeminiCalls) {
      return skip(input, "JOB_LIMIT_REACHED");
    }

    if (!process.env.GEMINI_API_KEY) {
      return skip(input, "GEMINI_API_KEY_MISSING");
    }

    const dedupeKey = buildDedupeKey({ city, sourceBairro, sourceRua });
    if (input.state.seenKeys.has(dedupeKey)) {
      return skip(input, "DUPLICATE_KEY_IN_JOB");
    }
    input.state.seenKeys.add(dedupeKey);

    input.state.geminiCalls += 1;
    const ai = await suggestLocalFirstAliasWithGemini({ pack });

    if (!ai.accepted || !ai.suggestion) {
      logShadow("ALIAS_SHADOW_AI_REJECTED", {
        jobId: input.state.jobId,
        sequence: input.rowSequence ?? "",
        city,
        rejectedReason: ai.rejectedReason ?? null,
      });

      return {
        attempted: ai.attempted,
        rejectedReason: ai.rejectedReason ?? null,
      };
    }

    const aliasType = resolveAliasType({
      bairroAlias: ai.suggestion.bairroAlias,
      ruaAlias: ai.suggestion.ruaAlias,
    });

    const result = await createPendingLocalFirstAlias({
      city,
      aliasType,
      sourceBairro,
      sourceRua,
      targetBairro: ai.suggestion.bairroAlias,
      targetRua: ai.suggestion.ruaAlias,
      confidence: ai.suggestion.confidence,
      source: LocalFirstAliasSource.AI,
      lastAiReason: ai.suggestion.reason,
      lastValidationStatus: LocalFirstAliasValidationStatus.NEEDS_REVIEW,
      lastValidationReason: "alias_shadow_ai_suggestion_pending",
      lastFailureReason: null,
    });

    logShadow("ALIAS_SHADOW_AI_ACCEPTED", {
      jobId: input.state.jobId,
      sequence: input.rowSequence ?? "",
      city,
      aliasId: result.alias.id,
      aliasType,
      confidence: ai.suggestion.confidence,
    });

    return {
      attempted: true,
      savedAliasId: result.alias.id,
    };
  } catch (error) {
    console.warn("[ALIAS_SHADOW_ERROR]", {
      jobId: input.state.jobId,
      sequence: input.rowSequence ?? "",
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      attempted: false,
      rejectedReason: "ALIAS_SHADOW_ERROR",
    };
  }
}
