import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { Prisma } from "@prisma/client";
import { getAdminObservabilitySnapshot } from "@/app/lib/admin-observability";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = await getToken({
    req: req as any,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ((token as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const data = await getAdminObservabilitySnapshot();
    return NextResponse.json(data);
  } catch (e) {
    console.error("GET /api/admin/observability error:", e);

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
      { error: "Erro ao carregar observabilidade." },
      { status: 500 },
    );
  }
}
