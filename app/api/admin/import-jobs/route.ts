import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ((token as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ✅ LIMPA AUTOMÁTICO: apaga tudo que tiver mais de 36 horas
  try {
    const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000);
    await prisma.importJob.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
  } catch (e) {
    // não quebra a listagem se der erro na limpeza
    console.warn("ImportJob cleanup failed:", e);
  }

  const jobs = await prisma.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  return NextResponse.json({ jobs });
}