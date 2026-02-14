export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { Prisma } from "@prisma/client";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const jobs = await prisma.importJob.findMany({
      where: {
        userId,
        resultSavedAt: { not: null },
      },
      orderBy: { resultSavedAt: "desc" },
      select: {
        id: true,
        originalName: true,
        resultSavedAt: true,
        createdAt: true,
      },
    });

    const items = jobs.map((j) => ({
      id: j.id,
      name: j.originalName || "Planilha sem nome",
      savedAt: (j.resultSavedAt ?? j.createdAt).getTime(),
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("GET /api/history error:", e);
    return NextResponse.json(
      { error: "Erro ao listar histórico." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.importJob.updateMany({
      where: { userId },
      data: {
        resultJson: Prisma.DbNull, // ✅
        resultSavedAt: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/history error:", e);
    return NextResponse.json(
      { error: "Erro ao limpar histórico." },
      { status: 500 }
    );
  }
}