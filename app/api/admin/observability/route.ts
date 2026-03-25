import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
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

  const data = await getAdminObservabilitySnapshot();
  return NextResponse.json(data);
}
