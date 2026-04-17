import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { cleanupOldImportJobsIfNeeded } from "@/app/lib/import-job-cleanup";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ((token as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    void cleanupOldImportJobsIfNeeded();

    const jobs = await prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        originalName: true,
        totalStops: true,
        processedStops: true,
        errorMessage: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return NextResponse.json({ jobs });
  } catch (e) {
    console.error("GET /api/admin/import-jobs error:", e);

    const isDbOffline =
      e instanceof Prisma.PrismaClientInitializationError ||
      (e instanceof Error && e.message.includes("Can't reach database server"));

    if (isDbOffline) {
      return NextResponse.json(
        { error: "Banco de dados indisponível no momento." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: "Erro ao carregar importações." },
      { status: 500 },
    );
  }
}
