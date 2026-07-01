// app/api/admin/users/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { getUserAccessSnapshot } from "@/app/lib/access-control";
import { isSuperAdmin, requireAdmin } from "@/app/lib/admin-roles";

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

async function logAdminAction(
  tx: any,
  params: {
    adminId: string;
    targetUserId: string;
    action: string;
    metadata?: any;
  }
) {
  await tx.adminAccessLog.create({
    data: {
      adminId: params.adminId,
      targetUserId: params.targetUserId,
      action: params.action,
      metadata: params.metadata ?? null,
    },
  });
}

// ✅ LISTAR USUÁRIOS
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!requireAdmin(session?.user as any)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const canSeeAdmins = isSuperAdmin(session?.user as any);

    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        accessBlockedAt: true,
        accessBlockReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const visibleUsers = canSeeAdmins
      ? users
      : users.filter((user) => user.role !== "ADMIN");

    const usersWithAccess = await mapWithConcurrency(
      visibleUsers,
      2,
      async (user) => ({
        ...user,
        access: await getUserAccessSnapshot(user.id),
      })
    );

    return NextResponse.json({ ok: true, users: usersWithAccess });
  } catch (e) {
    console.error("Erro admin list users:", e);
    return NextResponse.json({ error: "Erro ao listar usuários." }, { status: 500 });
  }
}

// ✅ CRIAR USUÁRIO
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!requireAdmin(session?.user as any)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const roleReq = String(body?.role ?? "USER").toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
    const canCreateAdmin = isSuperAdmin(session?.user as any);

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

    if (roleReq === "ADMIN" && !canCreateAdmin) {
      return NextResponse.json(
        { error: "Somente SUPER_ADMIN pode criar novos administradores." },
        { status: 403 }
      );
    }

    const hash = await bcrypt.hash(password, 10);
    const actorId = String((session?.user as any)?.id || "");
    const actorEmail = String((session?.user as any)?.email || "").trim().toLowerCase();
    const createdAt = new Date().toISOString();

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
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

      await logAdminAction(tx, {
        adminId: actorId,
        targetUserId: createdUser.id,
        action: "CREATE_USER",
        metadata: {
          actorEmail,
          targetEmail: createdUser.email,
          action: "CREATE_USER",
          before: null,
          after: {
            id: createdUser.id,
            email: createdUser.email,
            name: createdUser.name ?? null,
            role: createdUser.role,
            active: createdUser.active,
          },
          createdAt,
        },
      });

      return createdUser;
    });

    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    console.error("Erro admin create user:", e);
    return NextResponse.json({ error: "Erro ao criar usuário." }, { status: 500 });
  }
}
