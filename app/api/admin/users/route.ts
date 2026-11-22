// app/api/admin/users/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { passwordPolicyError } from "@/app/lib/password-policy.js";
import type { Prisma } from "@prisma/client";
import { accessAccountSelect, getAdminAccessSnapshots } from "@/app/lib/access-control";
import { adminPage, readAdminPagination } from "@/app/lib/admin-pagination";
import { isSuperAdmin, requireAdmin } from "@/app/lib/admin-roles";
import {
  DUPLICATE_WHATSAPP_MESSAGE,
  INVALID_WHATSAPP_MESSAGE,
  normalizeBrazilianWhatsapp,
} from "@/app/lib/whatsapp";

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
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!requireAdmin(session?.user as any)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = new URL(request.url).searchParams;
    const { query, requestedPage, pageSize } = readAdminPagination(params);
    const where: Prisma.UserWhereInput = {};
    const canSeeAdmins = isSuperAdmin(session?.user as any);
    if (!canSeeAdmins) where.role = "USER";
    if (params.get("active") === "1") where.active = true;
    if (query) {
      const contains = query.replace(/[\\%_]/g, "\\$&");
      where.OR = [
        { name: { contains, mode: "insensitive" } },
        { email: { contains, mode: "insensitive" } },
        ...(["ADMIN", "USER"] as const).filter((role) => role.includes(query.toUpperCase())).map((role) => ({ role })),
      ];
    }
    const pagination = adminPage(requestedPage, pageSize, await prisma.user.count({ where }));
    const users = await prisma.user.findMany({
      where,
      orderBy: [{ name: { sort: "asc", nulls: "last" } }, { email: "asc" }, { id: "asc" }],
      skip: (pagination.page - 1) * pageSize,
      take: pageSize,
      select: {
        ...accessAccountSelect,
        name: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const access = await getAdminAccessSnapshots(users, new Date());
    return NextResponse.json({
      ok: true,
      pagination,
      users: users.map(({ emailVerificationRequired: _required, emailVerifiedAt: _verified, ...user }) => ({
        ...user,
        access: access.get(user.id),
      })),
    });
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
    const whatsappInput = String(body?.whatsapp ?? "").trim();
    const whatsapp = whatsappInput ? normalizeBrazilianWhatsapp(whatsappInput) : null;
    const password = String(body?.password ?? "");
    const roleReq = String(body?.role ?? "USER").toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
    const canCreateAdmin = isSuperAdmin(session?.user as any);

    if (!email || !password) {
      return NextResponse.json({ error: "Email e senha são obrigatórios." }, { status: 400 });
    }

    const policyError = passwordPolicyError(password);
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });

    if (whatsappInput && !whatsapp) {
      return NextResponse.json({ error: INVALID_WHATSAPP_MESSAGE }, { status: 400 });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "Esse email já está cadastrado." }, { status: 409 });
    }

    if (whatsapp) {
      const whatsappExists = await prisma.user.findFirst({ where: { whatsapp }, select: { id: true } });
      if (whatsappExists) {
        return NextResponse.json({ error: DUPLICATE_WHATSAPP_MESSAGE }, { status: 409 });
      }
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
          whatsapp,
          password: hash,
          role: roleReq as any,
          active: true,
          emailVerificationRequired: false,
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

      await tx.routeCredit.create({
        data: {
          userId: createdUser.id,
          delta: 2,
          reason: "ADMIN_GRANT",
          notes: "Créditos concedidos pelo administrador ao criar a conta",
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
    if (e?.code === "P2002") {
      const target = Array.isArray(e?.meta?.target) ? e.meta.target : [];
      if (target.includes("whatsapp")) {
        return NextResponse.json({ error: DUPLICATE_WHATSAPP_MESSAGE }, { status: 409 });
      }
    }

    console.error("Erro admin create user:", e);
    return NextResponse.json({ error: "Erro ao criar usuário." }, { status: 500 });
  }
}
