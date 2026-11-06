import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { AccessControlError, getUserAccessSnapshot } from "@/app/lib/access-control";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const snapshot = await getUserAccessSnapshot(userId);
    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof AccessControlError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("GET /api/access/me error:", error);
    return NextResponse.json(
      { error: "Erro ao carregar acesso do usuário." },
      { status: 500 }
    );
  }
}
