import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { requireAdmin } from "@/app/lib/admin-roles";
import { prisma } from "@/app/lib/prisma";
import { LocalFirstAliasValidationStatus } from "@prisma/client";
import {
  LocalFirstAliasValidationError,
  validateLocalFirstAlias,
} from "@/app/lib/local-first-alias-validation";

export const runtime = "nodejs";

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

export async function POST(req: Request, ctx: any) {
  const session = await getServerSession(authOptions);

  if (!requireAdmin(session?.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const params = await readRouteParams(ctx);
    const id = String(params?.id || "").trim();

    if (!id) {
      return NextResponse.json({ error: "ID invalido." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
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
      },
    });

    if (!alias) {
      return NextResponse.json(
        { error: "Alias nao encontrado." },
        { status: 404 },
      );
    }

    const sampleQuadra = String(body?.sampleQuadra || alias.sampleQuadra || "").trim();
    const sampleLote = String(body?.sampleLote || alias.sampleLote || "").trim();

    if (!sampleQuadra || !sampleLote) {
      return NextResponse.json(
        { error: "sampleQuadra e sampleLote sao obrigatorios." },
        { status: 400 },
      );
    }

    const validation = validateLocalFirstAlias(alias, {
      sampleQuadra,
      sampleLote,
      targetBairro:
        body?.targetBairro == null ? undefined : String(body.targetBairro),
      targetRua: body?.targetRua == null ? undefined : String(body.targetRua),
    });
    const result = validation.result;

    await prisma.localFirstAlias.update({
      where: { id },
      data: {
        lastAttemptAt: new Date(),
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

    return NextResponse.json({
      ok: true,
      aliasId: validation.aliasId,
      validationStatus: result.validationStatus,
      validationReason: result.reason,
      failureReason: result.failureReason ?? null,
      appliedInput: validation.appliedInput,
      result,
    });
  } catch (error) {
    if (error instanceof LocalFirstAliasValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }

    console.error("POST /api/admin/local-first-aliases/[id]/validate error:", error);
    return NextResponse.json(
      { error: "Erro ao validar alias LocalFirst." },
      { status: 500 },
    );
  }
}
