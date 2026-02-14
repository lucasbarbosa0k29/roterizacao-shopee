import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getToken } from "next-auth/jwt";

export const runtime = "nodejs";

async function requireAdmin(req: Request) {
  const token = await getToken({
    req: req as any,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const role = (token as any)?.role;
  if (!token || role !== "ADMIN") return null;
  return token;
}

// ✅ Next 15/16: params pode vir como Promise
async function getIdFromCtx(ctx: any) {
  const params = await ctx?.params; // <- aqui é o ponto
  const id = String(params?.id || "").trim();
  return id;
}

export async function GET(req: Request, ctx: any) {
  const ok = await requireAdmin(req);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = await getIdFromCtx(ctx);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const job = await prisma.importJob.findUnique({
    where: { id },
    include: { user: true },
  });

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ job });
}

export async function DELETE(req: Request, ctx: any) {
  const ok = await requireAdmin(req);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = await getIdFromCtx(ctx);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.importJob.delete({
    where: { id },
  });

  return NextResponse.json({ ok: true });
}