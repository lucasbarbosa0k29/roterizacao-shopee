export const runtime = "nodejs";

import { deleteJobResult } from "@/app/lib/job-storage";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { Prisma } from "@prisma/client";
import { cleanupOldImportJobsIfNeeded } from "@/app/lib/import-job-cleanup";

function isLocalDev() {
  return process.env.NODE_ENV !== "production";
}

function isTemporaryDbError(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;

  const message = String((error as any)?.message || error || "").toLowerCase();

  return (
    message.includes("can't reach database server") ||
    message.includes("failed to connect") ||
    message.includes("connection") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("authentication failed") ||
    message.includes("prismaclientinitializationerror")
  );
}

export async function GET() {
  try {
    void cleanupOldImportJobsIfNeeded();

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
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        originalName: true,
        resultSavedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const items = jobs.map((j) => ({
      id: j.id,
      name: j.originalName || "Planilha sem nome",
      savedAt: j.updatedAt.getTime(),
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    if (isLocalDev() && isTemporaryDbError(e)) {
      console.warn("GET /api/history degraded due to temporary DB error:", e);
      return NextResponse.json({
        ok: true,
        items: [],
        degraded: true,
        reason: "temporary_db_unavailable",
      });
    }

    console.error("GET /api/history error:", e);
    return NextResponse.json(
      { error: "Erro ao listar histórico." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    void cleanupOldImportJobsIfNeeded();

    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const jobs = await prisma.importJob.findMany({
      where: {
        userId,
        resultPath: { not: null },
      },
      select: {
        resultPath: true,
      },
    });

    await Promise.all(
      jobs.map((job) =>
        job.resultPath
          ? deleteJobResult(job.resultPath).catch((error) => {
              console.warn("Failed to delete job result file:", error);
            })
          : Promise.resolve()
      )
    );

    await prisma.importJob.updateMany({
      where: { userId },
      data: {
        resultPath: null,
        resultJson: Prisma.DbNull,
        workspaceJson: Prisma.DbNull,
        resultSavedAt: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isLocalDev() && isTemporaryDbError(e)) {
      console.warn("DELETE /api/history degraded due to temporary DB error:", e);
      return NextResponse.json(
        {
          error: "Histórico indisponível temporariamente no ambiente local.",
          degraded: true,
          reason: "temporary_db_unavailable",
        },
        { status: 503 }
      );
    }

    console.error("DELETE /api/history error:", e);
    return NextResponse.json(
      { error: "Erro ao limpar histórico." },
      { status: 500 }
    );
  }
}
