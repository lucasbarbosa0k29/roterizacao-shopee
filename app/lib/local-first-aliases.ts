import {
  LocalFirstAliasSource,
  LocalFirstAliasStatus,
  LocalFirstAliasType,
  LocalFirstAliasValidationStatus,
  type LocalFirstAlias,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

export type LocalFirstAliasKeyInput = {
  city: string;
  aliasType: LocalFirstAliasType;
  sourceBairro: string;
  sourceRua?: string | null;
};

export type CreatePendingLocalFirstAliasInput = LocalFirstAliasKeyInput & {
  targetBairro?: string | null;
  targetRua?: string | null;
  sampleBairro?: string | null;
  sampleRua?: string | null;
  sampleQuadra?: string | null;
  sampleLote?: string | null;
  confidence?: number;
  source?: LocalFirstAliasSource;
  lastAiReason?: string | null;
  lastValidationStatus?: LocalFirstAliasValidationStatus;
  lastValidationReason?: string | null;
  lastFailureReason?: string | null;
  cooldownUntil?: Date | null;
  notes?: string | null;
};

export type CreatePendingLocalFirstAliasResult = {
  alias: LocalFirstAlias;
  created: boolean;
  updated: boolean;
  approvedCacheHit: boolean;
};

export type UpdateLocalFirstAliasStatusInput = {
  id: string;
  status: LocalFirstAliasStatus;
  lastValidationStatus?: LocalFirstAliasValidationStatus;
  lastValidationReason?: string | null;
  lastFailureReason?: string | null;
  cooldownUntil?: Date | null;
  reviewedAt?: Date | null;
  notes?: string | null;
};

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeAliasText(value: string | null | undefined): string {
  if (!value) return "";

  return stripAccents(value)
    .toUpperCase()
    .replace(/[.,;:()[\]{}'"`´^~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLocalFirstAliasCity(
  value: string | null | undefined,
): string {
  const normalized = normalizeAliasText(value).replace(/\s+/g, "");

  if (normalized.includes("APARECIDA")) return "APARECIDA";
  if (normalized.includes("GOIANIA")) return "GOIANIA";

  return normalizeAliasText(value);
}

export function getLocalFirstAliasCityVariants(
  value: string | null | undefined,
): string[] {
  const normalized = normalizeAliasText(value);
  const canonical = normalizeLocalFirstAliasCity(normalized);

  if (canonical === "APARECIDA" || normalized === "APARECIDA DE GOIANIA") {
    return ["APARECIDA", "APARECIDA DE GOIANIA"];
  }

  if (canonical === "GOIANIA") return ["GOIANIA"];
  if (!normalized) return [];

  return [normalized];
}

function assertAliasKey(key: {
  aliasType: LocalFirstAliasType;
  sourceBairro: string;
  sourceRua: string;
}) {
  if (!key.sourceBairro) {
    throw new Error("sourceBairro is required for LocalFirstAlias");
  }

  if (
    (key.aliasType === LocalFirstAliasType.RUA ||
      key.aliasType === LocalFirstAliasType.BAIRRO_RUA) &&
    !key.sourceRua
  ) {
    throw new Error("sourceRua is required for street LocalFirstAlias");
  }
}

export function buildLocalFirstAliasKey(input: LocalFirstAliasKeyInput) {
  const key = {
    city: normalizeLocalFirstAliasCity(input.city),
    aliasType: input.aliasType,
    sourceBairro: normalizeAliasText(input.sourceBairro),
    sourceRua:
      input.aliasType === LocalFirstAliasType.BAIRRO
        ? ""
        : normalizeAliasText(input.sourceRua),
  };

  assertAliasKey(key);

  return key;
}

export function buildLocalFirstAliasUniqueWhere(
  input: LocalFirstAliasKeyInput,
): Prisma.LocalFirstAliasWhereUniqueInput {
  const key = buildLocalFirstAliasKey(input);

  return {
    city_aliasType_sourceBairro_sourceRua: key,
  };
}

function buildLocalFirstAliasCompatibleWhere(
  input: LocalFirstAliasKeyInput,
): Prisma.LocalFirstAliasWhereInput {
  const key = buildLocalFirstAliasKey(input);

  return {
    city: {
      in: getLocalFirstAliasCityVariants(key.city),
    },
    aliasType: key.aliasType,
    sourceBairro: key.sourceBairro,
    sourceRua: key.sourceRua,
  };
}

export async function findApprovedLocalFirstAlias(
  input: LocalFirstAliasKeyInput,
) {
  return prisma.localFirstAlias.findFirst({
    where: {
      ...buildLocalFirstAliasCompatibleWhere(input),
      status: LocalFirstAliasStatus.APPROVED,
    },
  });
}

export async function findLocalFirstAliasInCooldown(
  input: LocalFirstAliasKeyInput,
  now = new Date(),
) {
  return prisma.localFirstAlias.findFirst({
    where: {
      ...buildLocalFirstAliasCompatibleWhere(input),
      status: {
        in: [LocalFirstAliasStatus.REJECTED, LocalFirstAliasStatus.PENDING],
      },
      cooldownUntil: {
        gt: now,
      },
    },
  });
}

function clampConfidence(confidence: number | null | undefined) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}

function buildPendingAliasData(input: CreatePendingLocalFirstAliasInput) {
  return {
    targetBairro: input.targetBairro ?? null,
    targetRua: input.targetRua ?? null,
    sampleBairro: input.sampleBairro ?? null,
    sampleRua: input.sampleRua ?? null,
    sampleQuadra: input.sampleQuadra ?? null,
    sampleLote: input.sampleLote ?? null,
    confidence: clampConfidence(input.confidence),
    source: input.source ?? LocalFirstAliasSource.AI,
    lastAttemptAt: new Date(),
    lastAiReason: input.lastAiReason ?? null,
    lastValidationStatus:
      input.lastValidationStatus ??
      LocalFirstAliasValidationStatus.NOT_VALIDATED,
    lastValidationReason: input.lastValidationReason ?? null,
    lastFailureReason: input.lastFailureReason ?? null,
    cooldownUntil: input.cooldownUntil ?? null,
    notes: input.notes ?? null,
  };
}

export async function createPendingLocalFirstAlias(
  input: CreatePendingLocalFirstAliasInput,
): Promise<CreatePendingLocalFirstAliasResult> {
  const key = buildLocalFirstAliasKey(input);
  const compatibleWhere = buildLocalFirstAliasCompatibleWhere(input);
  const approvedExisting = await prisma.localFirstAlias.findFirst({
    where: {
      ...compatibleWhere,
      status: LocalFirstAliasStatus.APPROVED,
    },
  });

  if (approvedExisting) {
    return {
      alias: approvedExisting,
      created: false,
      updated: false,
      approvedCacheHit: true,
    };
  }

  const existing = await prisma.localFirstAlias.findFirst({
    where: compatibleWhere,
    orderBy: { updatedAt: "desc" },
  });
  const data = buildPendingAliasData(input);

  if (existing) {
    const nextData =
      existing.status === LocalFirstAliasStatus.DISABLED
        ? {
            lastAttemptAt: data.lastAttemptAt,
            lastAiReason: data.lastAiReason,
            lastValidationStatus: data.lastValidationStatus,
            lastValidationReason: data.lastValidationReason,
            lastFailureReason: data.lastFailureReason,
            cooldownUntil: data.cooldownUntil,
            notes: data.notes,
            sampleBairro: data.sampleBairro,
            sampleRua: data.sampleRua,
            sampleQuadra: data.sampleQuadra,
            sampleLote: data.sampleLote,
          }
        : {
            ...data,
            status: LocalFirstAliasStatus.PENDING,
          };

    const alias = await prisma.localFirstAlias.update({
      where: { id: existing.id },
      data: nextData,
    });

    return {
      alias,
      created: false,
      updated: true,
      approvedCacheHit: false,
    };
  }

  const alias = await prisma.localFirstAlias.create({
    data: {
      ...key,
      ...data,
      status: LocalFirstAliasStatus.PENDING,
    },
  });

  return {
    alias,
    created: true,
    updated: false,
    approvedCacheHit: false,
  };
}

export async function updateLocalFirstAliasStatus(
  input: UpdateLocalFirstAliasStatusInput,
) {
  return prisma.localFirstAlias.update({
    where: { id: input.id },
    data: {
      status: input.status,
      lastValidationStatus: input.lastValidationStatus,
      lastValidationReason: input.lastValidationReason,
      lastFailureReason: input.lastFailureReason,
      cooldownUntil: input.cooldownUntil,
      reviewedAt: input.reviewedAt,
      notes: input.notes,
    },
  });
}

export async function incrementLocalFirstAliasUsage(id: string) {
  return prisma.localFirstAlias.update({
    where: { id },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}
