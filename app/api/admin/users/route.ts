// app/api/admin/users/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";

function isAdmin(session: any) {
  const role = (session?.user as any)?.role;
  return !!session?.user && role === "ADMIN";
}

// ✅ LISTAR USUÁRIOS
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, users });
  } catch (e) {
    console.error("Erro admin list users:", e);
    return NextResponse.json({ error: "Erro ao listar usuários." }, { status: 500 });
  }
}

// ✅ CRIAR USUÁRIO
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const roleReq = String(body?.role ?? "USER").toUpperCase() === "ADMIN" ? "ADMIN" : "USER";

    if (!email || !password) {
      return NextResponse.json({ error: "Email e senha são obrigatórios." }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Senha precisa ter no mínimo 6 caracteres." }, { status: 400 });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "Esse email já está cadastrado." }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: name || null,
        email,
        password: hash,
        role: roleReq as any,
        active: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    console.error("Erro admin create user:", e);
    return NextResponse.json({ error: "Erro ao criar usuário." }, { status: 500 });
  }
}