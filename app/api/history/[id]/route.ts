// app/api/history/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { Prisma } from "@prisma/client";

/**
 * Next.js 16+: params é Promise.
 * Por isso todos handlers abaixo usam:
 *   { params }: { params: Promise<{ id: string }> }
 * e depois:
 *   const { id } = await params;
 */

function normalizeResultJson(resultJson: any) {
  // 1) se veio NULL / JsonNull
  if (!resultJson) return null;

  // 2) HISTÓRICO ANTIGO: resultJson era um ARRAY direto => vira envelope
  if (Array.isArray(resultJson)) {
    return {
      version: 1,
      rows: resultJson,
      manualEdits: {},
      manualGroups: {},
      autoGrouped: false,
      autoBreakIds: [],
      groupMode: false,
      selectedIdxs: [],
      view: "results",
      name: null,
      updatedAtMs: Date.now(),
    };
  }

  // 3) formato atual: objeto com rows
  if (typeof resultJson === "object") {
    const rows = (resultJson as any)?.rows;

    // se rows existir e for array, tá OK
    if (Array.isArray(rows)) return resultJson;

    // se por algum motivo veio objeto sem rows, trata como vazio
    return null;
  }

  return null;
}

// ✅ ABRIR UM ITEM DO HISTÓRICO (do usuário logado)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ✅ Next 16: precisa await params
    const { id } = await params;
    const safeId = String(id || "").trim();

    const job = await prisma.importJob.findFirst({
      where: { id: safeId, userId },
      select: {
        id: true,
        originalName: true,
        status: true,
        totalStops: true,
        processedStops: true,
        resultJson: true,
        resultSavedAt: true,
        createdAt: true,
        errorMessage: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    const normalized = normalizeResultJson(job.resultJson);

    // ✅ VOLTA AO COMPORTAMENTO QUE VOCÊ TINHA:
    // Se não tem rows salvos, retorna 404 com a mensagem.
    if (
      !normalized ||
      !Array.isArray((normalized as any).rows) ||
      (normalized as any).rows.length === 0
    ) {
      return NextResponse.json(
        { error: "Histórico sem rows salvos (resultJson vazio)." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      job: {
        ...job,
        resultJson: normalized, // ✅ padronizado
      },
    });
  } catch (e) {
    console.error("GET /api/history/[id] error:", e);
    return NextResponse.json({ error: "Erro ao abrir histórico." }, { status: 500 });
  }
}

// ✅ SALVAR ALTERAÇÕES DO USUÁRIO (resultado + estado da tela)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const safeId = String(id || "").trim();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: true });
    }

    /**
     * ✅ IMPORTANTÍSSIMO:
     * Seu frontend (history-db.ts) manda:  body: JSON.stringify({ resultJson })
     * Então aqui a gente aceita:
     *  - body.resultJson (novo)
     *  - body (antigo, caso você mande o objeto direto)
     */
    const incoming = (body as any)?.resultJson ?? body;

    // normaliza/garante formato envelope
    const normalized = normalizeResultJson(incoming);

    // se vier inválido, não salva lixo
    if (!normalized || !Array.isArray((normalized as any).rows)) {
      return NextResponse.json(
        { error: "Payload inválido: resultJson sem rows." },
        { status: 400 },
      );
    }

    // ✅ TRAVA ANTI-VAZIO (NÃO SOBRESCREVE O RESULTADO BOM)
    const incomingRows = (normalized as any).rows as any[];
    if (!incomingRows.length) {
      return NextResponse.json({ ok: true, skipped: true, reason: "skip_empty_rows" });
    }

    // garante campos mínimos (evita undefined)
    const payload = {
      version: 1,
      rows: incomingRows, // ✅ usa a mesma referência validada
      manualEdits: (normalized as any).manualEdits ?? {},
      manualGroups: (normalized as any).manualGroups ?? {},
      autoGrouped: !!(normalized as any).autoGrouped,
      autoBreakIds: Array.isArray((normalized as any).autoBreakIds) ? (normalized as any).autoBreakIds : [],
      groupMode: !!(normalized as any).groupMode,
      selectedIdxs: Array.isArray((normalized as any).selectedIdxs) ? (normalized as any).selectedIdxs : [],
      view: (normalized as any).view ?? "results",
      name: (normalized as any).name ?? null,
      updatedAtMs: Date.now(),
    };

    const updated = await prisma.importJob.updateMany({
      where: { id: safeId, userId },
      data: {
        resultJson: payload as any,
        resultSavedAt: new Date(),
      },
    });

    if (!updated.count) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PATCH /api/history/[id] error:", e);
    return NextResponse.json({ error: "Erro ao salvar alterações." }, { status: 500 });
  }
}

// ✅ “APAGAR” DO HISTÓRICO (limpa só resultado salvo)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const safeId = String(id || "").trim();

    const updated = await prisma.importJob.updateMany({
      where: { id: safeId, userId },
      data: {
        resultJson: Prisma.JsonNull,
        resultSavedAt: null,
      },
    });

    if (!updated.count) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/history/[id] error:", e);
    return NextResponse.json({ error: "Erro ao apagar histórico." }, { status: 500 });
  }
}