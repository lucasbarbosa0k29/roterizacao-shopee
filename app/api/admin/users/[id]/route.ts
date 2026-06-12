import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { getUserAccessSnapshot } from "@/app/lib/access-control";
import { isSuperAdmin, requireAdmin } from "@/app/lib/admin-roles";

async function getIdFromCtx(ctx: any) {
  const maybeParams = ctx?.params;
  const params =
    maybeParams && typeof maybeParams.then === "function"
      ? await maybeParams
      : maybeParams;

  return String(params?.id || "");
}

const ADMIN_USER_ACTIONS = [
  "UPDATE_NAME",
  "RESET_PASSWORD",
  "GRANT_FREE",
  "GRANT_BASIC_30",
  "GRANT_PRO_30",
  "GRANT_TRIAL_7",
  "GRANT_TRIAL_15",
  "GRANT_TRIAL_30",
  "ADD_ROUTE_CREDITS",
  "REMOVE_ROUTE_CREDITS",
  "REVOKE_ACTIVE_SUBSCRIPTION",
  "BLOCK_ACCESS",
  "UNBLOCK_ACCESS",
] as const;

type AdminUserAction = (typeof ADMIN_USER_ACTIONS)[number];

function isAdminUserAction(value: string): value is AdminUserAction {
  return ADMIN_USER_ACTIONS.includes(value as AdminUserAction);
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function getSaoPauloDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function revokeActiveSubscriptions(tx: any, userId: string) {
  await tx.userSubscription.updateMany({
    where: {
      userId,
      status: "ACTIVE",
    },
    data: {
      status: "REVOKED",
    },
  });
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

async function getRouteCreditsBalance(tx: any, userId: string) {
  const result = await tx.routeCredit.aggregate({
    where: { userId },
    _sum: { delta: true },
  });

  return result._sum.delta ?? 0;
}

async function resetTodayRouteUsageForAdminChange(tx: any, userId: string) {
  const usageDayKey = getSaoPauloDayKey();

  const result = await tx.routeUsage.updateMany({
    where: {
      userId,
      usageDayKey,
      source: "SUBSCRIPTION_DAILY",
    },
    data: {
      source: "ADMIN_OVERRIDE",
    },
  });

  return {
    resetTodayUsageCount: result.count,
    resetTodayUsageDayKey: usageDayKey,
  };
}

// PATCH /api/admin/users/[id]
export async function PATCH(req: Request, ctx: any) {
  try {
    const session = await getServerSession(authOptions);
    if (!requireAdmin(session?.user as any)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = await getIdFromCtx(ctx);
    if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const adminId = String((session?.user as any)?.id || "");
    const body = await req.json().catch(() => null);
    const rawAction = String(body?.action ?? "").trim().toUpperCase();
    const active = typeof body?.active === "boolean" ? body.active : undefined;
    const credits = Number(body?.credits);
    const reason = String(body?.reason ?? "").trim();
    const notes = String(body?.notes ?? "").trim();
    const newName = String(body?.name ?? "").trim();
    const newPassword = String(body?.password ?? "");

    const targetUser = await prisma.user.findUnique({
      where: { id },
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

    if (!targetUser) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const actorIsSuperAdmin = isSuperAdmin(session?.user as any);
    const targetIsProtectedSuperAdmin = String(targetUser.email || "").trim().toLowerCase() ===
      "lucasbarbosa0k29@gmail.com";

    if (targetUser.role === "ADMIN" && !actorIsSuperAdmin) {
      return NextResponse.json(
        { error: "Somente SUPER_ADMIN pode alterar contas ADMIN." },
        { status: 403 }
      );
    }

    if (!rawAction) {
      if (typeof active !== "boolean") {
        return NextResponse.json({ error: "Campo 'active' inválido." }, { status: 400 });
      }

      if (id === adminId && active === false) {
        return NextResponse.json(
          { error: "Você não pode desativar sua própria conta ADMIN." },
          { status: 400 }
        );
      }

      if (targetIsProtectedSuperAdmin && active === false) {
        return NextResponse.json(
          { error: "O super admin protegido não pode ser desativado." },
          { status: 400 }
        );
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { active },
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

      return NextResponse.json({ ok: true, user: updated });
    }

    if (!isAdminUserAction(rawAction)) {
      return NextResponse.json(
        { error: "Ação administrativa inválida." },
        { status: 400 }
      );
    }

    if (rawAction === "UPDATE_NAME") {
      if (!newName) {
        return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { name: newName },
        });

        await logAdminAction(tx, {
          adminId,
          targetUserId: id,
          action: "UPDATE_NAME",
          metadata: {
            previousName: targetUser.name,
            newName,
          },
        });
      });

      const refreshedUser = await prisma.user.findUnique({
        where: { id },
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

      const access = await getUserAccessSnapshot(id);

      return NextResponse.json({
        ok: true,
        user: {
          ...refreshedUser,
          access,
        },
      });
    }

    if (rawAction === "RESET_PASSWORD") {
      if (targetUser.role === "ADMIN") {
        return NextResponse.json(
          { error: "Redefinição de senha de ADMIN não está disponível por segurança." },
          { status: 400 }
        );
      }

      if (!newPassword || newPassword.length < 6) {
        return NextResponse.json(
          { error: "Senha precisa ter no mínimo 6 caracteres." },
          { status: 400 }
        );
      }

      const now = new Date();
      const hash = await bcrypt.hash(newPassword, 10);

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { password: hash },
        });

        await logAdminAction(tx, {
          adminId,
          targetUserId: id,
          action: "RESET_PASSWORD",
          metadata: {
            passwordResetAt: now.toISOString(),
          },
        });
      });

      const refreshedUser = await prisma.user.findUnique({
        where: { id },
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

      const access = await getUserAccessSnapshot(id);

      return NextResponse.json({
        ok: true,
        user: {
          ...refreshedUser,
          access,
        },
      });
    }

    if (targetUser.role === "ADMIN") {
      return NextResponse.json(
        { error: "Ações comerciais não podem ser executadas em contas ADMIN." },
        { status: 400 }
      );
    }

    if (rawAction === "ADD_ROUTE_CREDITS" && (!Number.isInteger(credits) || credits <= 0)) {
      return NextResponse.json(
        { error: "Campo 'credits' inválido. Use inteiro positivo." },
        { status: 400 }
      );
    }

    if (
      rawAction === "REMOVE_ROUTE_CREDITS" &&
      (!Number.isInteger(credits) || credits <= 0)
    ) {
      return NextResponse.json(
        { error: "Campo 'credits' inválido. Use inteiro positivo." },
        { status: 400 }
      );
    }

    if (rawAction === "BLOCK_ACCESS" && !reason) {
      return NextResponse.json(
        { error: "Campo 'reason' é obrigatório para bloquear acesso." },
        { status: 400 }
      );
    }

    const now = new Date();

    switch (rawAction) {
      case "GRANT_FREE": {
        const plan = await prisma.subscriptionPlan.findFirst({
          where: { code: "FREE", isActive: true },
          select: { id: true, code: true, name: true },
        });

        if (!plan) {
          return NextResponse.json({ error: "Plano FREE não encontrado." }, { status: 400 });
        }

        await prisma.$transaction(async (tx) => {
          await revokeActiveSubscriptions(tx, id);
          const usageReset = await resetTodayRouteUsageForAdminChange(tx, id);

          const subscription = await tx.userSubscription.create({
            data: {
              userId: id,
              planId: plan.id,
              status: "ACTIVE",
              source: "ADMIN_GRANT",
              startsAt: now,
              expiresAt: null,
              grantedByAdminId: adminId,
              notes: "Liberação manual de plano FREE ilimitado.",
            },
          });

          await logAdminAction(tx, {
            adminId,
            targetUserId: id,
            action: "GRANT_FREE",
            metadata: {
              resetTodayUsageCount: usageReset.resetTodayUsageCount,
              resetTodayUsageDayKey: usageReset.resetTodayUsageDayKey,
              planCode: plan.code,
              subscriptionId: subscription.id,
            },
          });
        });
        break;
      }

      case "GRANT_BASIC_30":
      case "GRANT_PRO_30": {
        const planCode = rawAction === "GRANT_BASIC_30" ? "BASIC" : "PRO";
        const plan = await prisma.subscriptionPlan.findFirst({
          where: { code: planCode, isActive: true },
          select: { id: true, code: true, name: true },
        });

        if (!plan) {
          return NextResponse.json({ error: `Plano ${planCode} não encontrado.` }, { status: 400 });
        }

        const expiresAt = addDays(now, 30);

        await prisma.$transaction(async (tx) => {
          await revokeActiveSubscriptions(tx, id);
          const usageReset = await resetTodayRouteUsageForAdminChange(tx, id);

          const subscription = await tx.userSubscription.create({
            data: {
              userId: id,
              planId: plan.id,
              status: "ACTIVE",
              source: "ADMIN_GRANT",
              startsAt: now,
              expiresAt,
              grantedByAdminId: adminId,
              notes: `Liberação manual de plano ${planCode} por 30 dias.`,
            },
          });

          await logAdminAction(tx, {
            adminId,
            targetUserId: id,
            action: rawAction,
            metadata: {
              resetTodayUsageCount: usageReset.resetTodayUsageCount,
              resetTodayUsageDayKey: usageReset.resetTodayUsageDayKey,
              planCode: plan.code,
              expiresAt: expiresAt.toISOString(),
              subscriptionId: subscription.id,
            },
          });
        });
        break;
      }

      case "GRANT_TRIAL_7":
      case "GRANT_TRIAL_15":
      case "GRANT_TRIAL_30": {
        const trialDays =
          rawAction === "GRANT_TRIAL_7" ? 7 : rawAction === "GRANT_TRIAL_15" ? 15 : 30;
        const planCode =
          String(body?.planCode ?? "").trim().toUpperCase() === "PRO" ? "PRO" : "BASIC";

        const plan = await prisma.subscriptionPlan.findFirst({
          where: { code: planCode, isActive: true },
          select: { id: true, code: true, name: true },
        });

        if (!plan) {
          return NextResponse.json({ error: `Plano ${planCode} não encontrado.` }, { status: 400 });
        }

        const expiresAt = addDays(now, trialDays);

        await prisma.$transaction(async (tx) => {
          await revokeActiveSubscriptions(tx, id);
          const usageReset = await resetTodayRouteUsageForAdminChange(tx, id);

          const subscription = await tx.userSubscription.create({
            data: {
              userId: id,
              planId: plan.id,
              status: "ACTIVE",
              source: "TRIAL",
              startsAt: now,
              expiresAt,
              grantedByAdminId: adminId,
              notes: `Teste grátis por ${trialDays} dias.`,
            },
          });

          await logAdminAction(tx, {
            adminId,
            targetUserId: id,
            action: rawAction,
            metadata: {
              resetTodayUsageCount: usageReset.resetTodayUsageCount,
              resetTodayUsageDayKey: usageReset.resetTodayUsageDayKey,
              planCode: plan.code,
              trialDays,
              expiresAt: expiresAt.toISOString(),
              subscriptionId: subscription.id,
            },
          });
        });
        break;
      }

      case "ADD_ROUTE_CREDITS": {
        await prisma.$transaction(async (tx) => {
          await tx.routeCredit.create({
            data: {
              userId: id,
              delta: credits,
              reason: "ADJUSTMENT",
              notes: body?.notes
                ? String(body.notes).trim()
                : `Crédito manual via admin: +${credits}`,
            },
          });

          await logAdminAction(tx, {
            adminId,
            targetUserId: id,
            action: "ADD_ROUTE_CREDITS",
            metadata: {
              delta: credits,
              notes: body?.notes ? String(body.notes).trim() : null,
            },
          });
        });
        break;
      }

      case "REMOVE_ROUTE_CREDITS": {
        const result = await prisma.$transaction(async (tx) => {
          const creditsBefore = await getRouteCreditsBalance(tx, id);

          if (creditsBefore <= 0) {
            return {
              ok: false as const,
              status: 400,
              error: "O usuário não possui créditos para remover.",
            };
          }

          if (credits > creditsBefore) {
            return {
              ok: false as const,
              status: 400,
              error: "Não é permitido remover mais créditos do que o saldo atual.",
            };
          }

          const creditsAfter = creditsBefore - credits;

          await tx.routeCredit.create({
            data: {
              userId: id,
              delta: -credits,
              reason: "ADJUSTMENT",
              notes: notes || `Remoção manual de ${credits} crédito(s) via admin.`,
            },
          });

          await logAdminAction(tx, {
            adminId,
            targetUserId: id,
            action: "REMOVE_ROUTE_CREDITS",
            metadata: {
              creditsBefore,
              creditsRemoved: credits,
              creditsAfter,
              notes: notes || null,
            },
          });

          return { ok: true as const };
        });

        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: result.status });
        }

        break;
      }

      case "REVOKE_ACTIVE_SUBSCRIPTION": {
        const result = await prisma.$transaction(async (tx) => {
          const activeSubscriptions = await tx.userSubscription.findMany({
            where: {
              userId: id,
              status: "ACTIVE",
            },
            include: {
              plan: {
                select: {
                  code: true,
                },
              },
            },
            orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
          });

          if (activeSubscriptions.length === 0) {
            return {
              ok: false as const,
              status: 400,
              error: "O usuário não possui plano ativo.",
            };
          }

          const revokedSubscriptionIds = activeSubscriptions.map((item: any) => item.id);
          const previousPlanCodes = activeSubscriptions.map((item: any) => item.plan.code);
          const previousExpiresAt = activeSubscriptions.map(
            (item: any) => item.expiresAt?.toISOString() ?? null
          );

          await tx.userSubscription.updateMany({
            where: {
              userId: id,
              status: "ACTIVE",
            },
            data: {
              status: "REVOKED",
            },
          });

          const usageReset = await resetTodayRouteUsageForAdminChange(tx, id);

          await logAdminAction(tx, {
            adminId,
            targetUserId: id,
            action: "REVOKE_ACTIVE_SUBSCRIPTION",
            metadata: {
              revokedSubscriptionIds,
              previousPlanCodes,
              previousExpiresAt,
              resetTodayUsageCount: usageReset.resetTodayUsageCount,
              resetTodayUsageDayKey: usageReset.resetTodayUsageDayKey,
            },
          });

          return { ok: true as const };
        });

        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: result.status });
        }

        break;
      }

      case "BLOCK_ACCESS": {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id },
            data: {
              accessBlockedAt: now,
              accessBlockReason: reason,
            },
          });

          await logAdminAction(tx, {
            adminId,
            targetUserId: id,
            action: "BLOCK_ACCESS",
            metadata: {
              reason,
              blockedAt: now.toISOString(),
            },
          });
        });
        break;
      }

      case "UNBLOCK_ACCESS": {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id },
            data: {
              accessBlockedAt: null,
              accessBlockReason: null,
            },
          });

          await logAdminAction(tx, {
            adminId,
            targetUserId: id,
            action: "UNBLOCK_ACCESS",
            metadata: {
              unblockedAt: now.toISOString(),
            },
          });
        });
        break;
      }
    }

    const refreshedUser = await prisma.user.findUnique({
      where: { id },
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

    const access = await getUserAccessSnapshot(id);

    return NextResponse.json({
      ok: true,
      user: {
        ...refreshedUser,
        access,
      },
    });
  } catch (e) {
    console.error("Erro admin PATCH user:", e);
    return NextResponse.json(
      { error: "Erro ao atualizar usuário." },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users/[id] -> excluir
export async function DELETE(req: Request, ctx: any) {
  try {
    const session = await getServerSession(authOptions);
    if (!requireAdmin(session?.user as any)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = await getIdFromCtx(ctx);
    if (!id) return NextResponse.json({ error: "ID invÃƒÂ¡lido" }, { status: 400 });

    const myId = String((session?.user as any)?.id || "");
    const actorIsSuperAdmin = isSuperAdmin(session?.user as any);
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
      },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }
    if (id === myId) {
      return NextResponse.json(
        { error: "VocÃƒÂª nÃƒÂ£o pode excluir sua prÃƒÂ³pria conta ADMIN." },
        { status: 400 }
      );
    }

    if (String(targetUser.email || "").trim().toLowerCase() === "lucasbarbosa0k29@gmail.com") {
      return NextResponse.json(
        { error: "O super admin protegido não pode ser removido." },
        { status: 400 }
      );
    }

    if (targetUser.role === "ADMIN" && !actorIsSuperAdmin) {
      return NextResponse.json(
        { error: "Somente SUPER_ADMIN pode remover contas ADMIN." },
        { status: 403 }
      );
    }

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Erro admin DELETE user:", e);
    return NextResponse.json(
      { error: "Erro ao excluir usuÃƒÂ¡rio." },
      { status: 500 }
    );
  }
}
