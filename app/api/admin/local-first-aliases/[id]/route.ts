import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import {
  LocalFirstAliasStatus,
  LocalFirstAliasValidationStatus,
} from "@prisma/client";
import { requireAdmin } from "@/app/lib/admin-roles";
import { authOptions } from "@/app/lib/auth";
import {
  LocalFirstAliasValidationError,
  validateLocalFirstAlias,
} from "@/app/lib/local-first-alias-validation";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

const ACTIONS = new Set([
  "approve",
  "reject",
  "disable",
  "enable",
  "updateTarget",
  "note",
]);

function validationStatusForPrisma(status: string) {
  if (status === "VALIDATED") return LocalFirstAliasValidationStatus.VALIDATED;
  if (status === "FAILED") return LocalFirstAliasValidationStatus.FAILED;
  return LocalFirstAliasValidationStatus.NEEDS_REVIEW;
}

async function readRouteParams(ctx: any) {
  const maybeParams = ctx?.params;
  return maybeParams && typeof maybeParams.then === "function"
    ? await maybeParams
    : maybeParams;
}

function readOptionalString(body: any, key: string) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, key)) {
    return { provided: false as const, value: undefined };
  }

  const raw = body?.[key];
  if (raw == null) return { provided: true as const, value: null };

  const value = String(raw).trim();
  return { provided: true as const, value: value || null };
}

function readRequiredReason(body: any) {
  const reason = String(body?.reason || "").trim();
  if (!reason) {
    return null;
  }
  return reason;
}

function readCooldownUntil(value: unknown) {
  if (value == null || String(value).trim() === "") return null;

  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("INVALID_COOLDOWN_UNTIL");
  }

  return date;
}

function selectLocalFirstAliasItem() {
  return {
    id: true,
    city: true,
    aliasType: true,
    sourceBairro: true,
    sourceRua: true,
    targetBairro: true,
    targetRua: true,
    sampleBairro: true,
    sampleRua: true,
    sampleQuadra: true,
    sampleLote: true,
    status: true,
    source: true,
    confidence: true,
    usageCount: true,
    cooldownUntil: true,
    lastUsedAt: true,
    lastAttemptAt: true,
    lastValidationStatus: true,
    lastValidationReason: true,
    lastFailureReason: true,
    lastAiReason: true,
    reviewedAt: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
  };
}

export async function PATCH(req: Request, ctx: any) {
  const session = await getServerSession(authOptions);

  if (!requireAdmin(session?.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const params = await readRouteParams(ctx);
    const id = String(params?.id || "").trim();

    if (!id) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const action = String(body?.action || "").trim();

    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { error: "Ação inválida." },
        { status: 400 },
      );
    }

    const alias = await prisma.localFirstAlias.findUnique({
      where: { id },
      select: {
        id: true,
        city: true,
        aliasType: true,
        sourceBairro: true,
        sourceRua: true,
        targetBairro: true,
        targetRua: true,
        sampleBairro: true,
        sampleRua: true,
        sampleQuadra: true,
        sampleLote: true,
        status: true,
      },
    });

    if (!alias) {
      return NextResponse.json(
        { error: "Alias não encontrado." },
        { status: 404 },
      );
    }

    const now = new Date();
    const notes = readOptionalString(body, "notes");
    let validationResponse: any = null;
    let data: Record<string, unknown> = {};

    if (action === "approve") {
      const sampleQuadra = String(body?.sampleQuadra || alias.sampleQuadra || "").trim();
      const sampleLote = String(body?.sampleLote || alias.sampleLote || "").trim();

      if (!sampleQuadra || !sampleLote) {
        return NextResponse.json(
          { error: "sampleQuadra e sampleLote são obrigatórios." },
          { status: 400 },
        );
      }

      const targetBairro = readOptionalString(body, "targetBairro");
      const targetRua = readOptionalString(body, "targetRua");

      validationResponse = validateLocalFirstAlias(alias, {
        sampleQuadra,
        sampleLote,
        targetBairro: targetBairro.provided ? targetBairro.value : undefined,
        targetRua: targetRua.provided ? targetRua.value : undefined,
      });

      const result = validationResponse.result;
      if (result.validationStatus !== "VALIDATED") {
        await prisma.localFirstAlias.update({
          where: { id },
          data: {
            lastAttemptAt: now,
            lastValidationStatus: validationStatusForPrisma(
              result.validationStatus,
            ),
            lastValidationReason: result.reason,
            lastFailureReason: result.failureReason ?? null,
            sampleBairro: alias.sampleBairro || alias.sourceBairro || null,
            sampleRua: alias.sampleRua || alias.sourceRua || null,
            sampleQuadra,
            sampleLote,
          },
        });

        return NextResponse.json(
          {
            error: "Alias não validado pelo LocalFirst.",
            validationStatus: result.validationStatus,
            validationReason: result.reason,
            failureReason: result.failureReason ?? null,
            appliedInput: validationResponse.appliedInput,
            result,
          },
          { status: 409 },
        );
      }

      data = {
        status: LocalFirstAliasStatus.APPROVED,
        reviewedAt: now,
        cooldownUntil: null,
        lastAttemptAt: now,
        lastValidationStatus: validationStatusForPrisma(
          result.validationStatus,
        ),
        lastValidationReason: result.reason,
        lastFailureReason: result.failureReason ?? null,
        sampleBairro: alias.sampleBairro || alias.sourceBairro || null,
        sampleRua: alias.sampleRua || alias.sourceRua || null,
        sampleQuadra,
        sampleLote,
        ...(notes.provided ? { notes: notes.value } : {}),
        ...(targetBairro.provided ? { targetBairro: targetBairro.value } : {}),
        ...(targetRua.provided ? { targetRua: targetRua.value } : {}),
      };
    } else if (action === "reject") {
      const reason = readRequiredReason(body);
      if (!reason) {
        return NextResponse.json(
          { error: "reason é obrigatório." },
          { status: 400 },
        );
      }

      let cooldownUntil: Date | null = null;
      try {
        cooldownUntil = readCooldownUntil(body?.cooldownUntil);
      } catch {
        return NextResponse.json(
          { error: "cooldownUntil inválido." },
          { status: 400 },
        );
      }

      data = {
        status: LocalFirstAliasStatus.REJECTED,
        reviewedAt: now,
        lastFailureReason: reason,
        lastValidationReason: reason,
        cooldownUntil,
        ...(notes.provided ? { notes: notes.value } : {}),
      };
    } else if (action === "disable") {
      const reason = readRequiredReason(body);
      if (!reason) {
        return NextResponse.json(
          { error: "reason é obrigatório." },
          { status: 400 },
        );
      }

      data = {
        status: LocalFirstAliasStatus.DISABLED,
        reviewedAt: now,
        lastFailureReason: reason,
        lastValidationReason: reason,
        ...(notes.provided ? { notes: notes.value } : {}),
      };
    } else if (action === "enable") {
      data = {
        status: LocalFirstAliasStatus.PENDING,
        cooldownUntil: null,
        reviewedAt: null,
        ...(notes.provided ? { notes: notes.value } : {}),
      };
    } else if (action === "updateTarget") {
      const targetBairro = readOptionalString(body, "targetBairro");
      const targetRua = readOptionalString(body, "targetRua");

      if (!targetBairro.provided && !targetRua.provided) {
        return NextResponse.json(
          { error: "targetBairro ou targetRua é obrigatório." },
          { status: 400 },
        );
      }

      data = {
        ...(targetBairro.provided ? { targetBairro: targetBairro.value } : {}),
        ...(targetRua.provided ? { targetRua: targetRua.value } : {}),
        ...(notes.provided ? { notes: notes.value } : {}),
        ...(alias.status === LocalFirstAliasStatus.APPROVED
          ? { status: LocalFirstAliasStatus.PENDING }
          : {}),
        lastValidationStatus: LocalFirstAliasValidationStatus.NOT_VALIDATED,
        lastValidationReason: null,
        lastFailureReason: null,
      };
    } else if (action === "note") {
      data = {
        notes: notes.provided ? notes.value : null,
      };
    }

    const item = await prisma.localFirstAlias.update({
      where: { id },
      data,
      select: selectLocalFirstAliasItem(),
    });

    return NextResponse.json({
      ok: true,
      action,
      item,
      ...(validationResponse
        ? {
            validation: {
              validationStatus: validationResponse.result.validationStatus,
              validationReason: validationResponse.result.reason,
              failureReason: validationResponse.result.failureReason ?? null,
              appliedInput: validationResponse.appliedInput,
              result: validationResponse.result,
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof LocalFirstAliasValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }

    console.error("PATCH /api/admin/local-first-aliases/[id] error:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar alias LocalFirst." },
      { status: 500 },
    );
  }
}
