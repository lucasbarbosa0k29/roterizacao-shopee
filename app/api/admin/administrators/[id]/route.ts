import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { isSuperAdmin, isSuperAdminEmail, requireSuperAdmin } from "@/app/lib/admin-roles";

export const runtime = "nodejs";

type AdminAction = "PROMOTE_TO_ADMIN" | "DEMOTE_TO_USER" | "ENABLE_ADMIN_USER" | "DISABLE_ADMIN_USER";

async function getIdFromCtx(ctx: any) {
  const maybeParams = ctx?.params;
  const params =
    maybeParams && typeof maybeParams.then === "function" ? await maybeParams : maybeParams;

  return String(params?.id || "").trim();
}

function getActionDescription(action: AdminAction, targetActive: boolean) {
  switch (action) {
    case "PROMOTE_TO_ADMIN":
      return "Promover para ADMIN";
    case "DEMOTE_TO_USER":
      return "Rebaixar para USER";
    case "ENABLE_ADMIN_USER":
      return targetActive ? "Usuário já está ativo" : "Ativar usuário";
    case "DISABLE_ADMIN_USER":
      return targetActive ? "Desativar usuário" : "Usuário já está inativo";
    default:
      return action;
  }
}

export async function PATCH(req: Request, ctx: any) {
  const session = await getServerSession(authOptions);
  if (!requireSuperAdmin(session?.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actor = session?.user as any;
  const actorEmail = String(actor?.email ?? "").trim().toLowerCase();
  const actorId = String(actor?.id ?? "").trim();

  const id = await getIdFromCtx(ctx);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "").trim().toUpperCase() as AdminAction;

  if (
    !["PROMOTE_TO_ADMIN", "DEMOTE_TO_USER", "ENABLE_ADMIN_USER", "DISABLE_ADMIN_USER"].includes(
      action
    )
  ) {
    return NextResponse.json({ error: "Ação administrativa inválida." }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }

  const targetEmail = String(targetUser.email).trim().toLowerCase();
  const targetIsSuperAdmin = isSuperAdminEmail(targetEmail);
  const actorIsTarget = actorId === targetUser.id || actorEmail === targetEmail;

  if (actorIsTarget && (action === "DEMOTE_TO_USER" || action === "DISABLE_ADMIN_USER")) {
    return NextResponse.json(
      { error: "Você não pode alterar sua própria permissão ou desativar sua própria conta." },
      { status: 400 }
    );
  }

  if (targetIsSuperAdmin && (action === "DEMOTE_TO_USER" || action === "DISABLE_ADMIN_USER")) {
    return NextResponse.json(
      { error: "O super admin protegido não pode ser rebaixado ou desativado." },
      { status: 400 }
    );
  }

  if (action === "PROMOTE_TO_ADMIN" && targetUser.role === "ADMIN") {
    return NextResponse.json({ error: "Usuário já é ADMIN." }, { status: 400 });
  }

  if (action === "DEMOTE_TO_USER" && targetUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Somente ADMIN pode ser rebaixado." }, { status: 400 });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let updatedRole = targetUser.role;
    let updatedActive = targetUser.active;

    if (action === "PROMOTE_TO_ADMIN") {
      updatedRole = "ADMIN";
      await tx.user.update({
        where: { id: targetUser.id },
        data: { role: "ADMIN" },
      });
    }

    if (action === "DEMOTE_TO_USER") {
      updatedRole = "USER";
      await tx.user.update({
        where: { id: targetUser.id },
        data: { role: "USER" },
      });
    }

    if (action === "ENABLE_ADMIN_USER") {
      updatedActive = true;
      await tx.user.update({
        where: { id: targetUser.id },
        data: { active: true },
      });
    }

    if (action === "DISABLE_ADMIN_USER") {
      updatedActive = false;
      await tx.user.update({
        where: { id: targetUser.id },
        data: { active: false },
      });
    }

    await tx.adminAccessLog.create({
      data: {
        adminId: actorId,
        targetUserId: targetUser.id,
        action,
        metadata: {
          actorEmail,
          targetEmail,
          action,
          before: {
            role: targetUser.role,
            active: targetUser.active,
          },
          after: {
            role: updatedRole,
            active: updatedActive,
          },
          createdAt: now.toISOString(),
        },
      },
    });

    const refreshed = await tx.user.findUnique({
      where: { id: targetUser.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return refreshed;
  });

  if (!result) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      ...result,
      isSuperAdmin: isSuperAdmin(result),
    },
    action: getActionDescription(action, targetUser.active),
  });
}
