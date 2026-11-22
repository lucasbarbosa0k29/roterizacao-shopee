import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { accessAccountSelect, getAdminAccessSnapshots } from "@/app/lib/access-control";
import { adminPage, readAdminPagination } from "@/app/lib/admin-pagination";
import { getAdminFinancialSummary, listAdminSubscriptionIds } from "@/app/lib/admin-subscription-list";
import { requireSuperAdmin } from "@/app/lib/admin-roles";
import { administrativelyRevocable, guardAdminCycleChange, ScheduledRenewalError } from "@/app/lib/subscription-cycles";

export const runtime = "nodejs";

type ActiveSubscriptionSnapshot = {
  id: string;
  code: "FREE" | "BASIC" | "PRO";
  name: string;
  startsAt: string;
  expiresAt: string | null;
  dailyRouteLimit: number;
  isUnlimited: boolean;
  source: "ADMIN_GRANT" | "TRIAL" | "INFINITEPAY_LINK" | "MANUAL_PAYMENT";
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "SCHEDULED";
};

type PaymentTransactionSnapshot = {
  id: string;
  provider: "MERCADOPAGO" | "ASAAS" | "INFINITEPAY";
  fulfillmentReviewReason: string | null;
  productType: "EXTRA_ROUTE" | "BASIC_PLAN" | "PRO_PLAN";
  quantity: number;
  amountCents: number;
  currency: string;
  status: "PENDING" | "REQUIRES_ACTION" | "APPROVED" | "REJECTED" | "CANCELED" | "REFUNDED" | "EXPIRED" | "FULFILLED";
  mercadoPagoPreferenceId: string | null;
  mercadoPagoPaymentId: string | null;
  externalReference: string;
  initPoint: string | null;
  sandboxInitPoint: string | null;
  approvedAt: string | null;
  fulfilledAt: string | null;
  fulfilledSourceId: string | null;
  createdAt: string;
  updatedAt: string;
};

type RouteCreditSnapshot = {
  id: string;
  delta: number;
  reason: "ADMIN_GRANT" | "MANUAL_PAYMENT" | "ADJUSTMENT" | "CONSUMPTION";
  notes: string | null;
  createdAt: string;
};

type AdminActionSnapshot = {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string;
  admin: {
    id: string;
    name: string | null;
    email: string;
  };
};

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
  await guardAdminCycleChange(tx, userId);
  await tx.userSubscription.updateMany({
    where: {
      userId,
      ...administrativelyRevocable(new Date()),
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

function serializeSubscriptionRow(subscription: any): ActiveSubscriptionSnapshot {
  return {
    id: subscription.id,
    code: subscription.plan.code,
    name: subscription.plan.name,
    startsAt: subscription.startsAt.toISOString(),
    expiresAt: subscription.expiresAt?.toISOString() ?? null,
    dailyRouteLimit: subscription.plan.dailyRouteLimit,
    isUnlimited: subscription.plan.isUnlimited,
    source: subscription.source,
    status: subscription.status,
  };
}

function serializePaymentTransaction(transaction: any): PaymentTransactionSnapshot {
  return {
    id: transaction.id,
    provider: transaction.provider,
    fulfillmentReviewReason: transaction.fulfillmentReviewReason ?? null,
    productType: transaction.productType,
    quantity: transaction.quantity,
    amountCents: transaction.amountCents,
    currency: transaction.currency,
    status: transaction.status,
    mercadoPagoPreferenceId: transaction.mercadoPagoPreferenceId ?? null,
    mercadoPagoPaymentId: transaction.mercadoPagoPaymentId ?? null,
    externalReference: transaction.externalReference,
    initPoint: transaction.initPoint ?? null,
    sandboxInitPoint: transaction.sandboxInitPoint ?? null,
    approvedAt: transaction.approvedAt?.toISOString() ?? null,
    fulfilledAt: transaction.fulfilledAt?.toISOString() ?? null,
    fulfilledSourceId: transaction.fulfilledSourceId ?? null,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

function serializeRouteCredit(credit: any): RouteCreditSnapshot {
  return {
    id: credit.id,
    delta: credit.delta,
    reason: credit.reason,
    notes: credit.notes ?? null,
    createdAt: credit.createdAt.toISOString(),
  };
}

function serializeAdminAction(log: any): AdminActionSnapshot {
  return {
    id: log.id,
    action: log.action,
    metadata: log.metadata ?? null,
    createdAt: log.createdAt.toISOString(),
    admin: {
      id: log.admin.id,
      name: log.admin.name ?? null,
      email: log.admin.email,
    },
  };
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!requireSuperAdmin(session?.user as any)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = new URL(request.url).searchParams;
    const userId = params.get("historyFor");
    if (userId !== null) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
      const payments = await prisma.paymentTransaction.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 8,
      });
      const credits = await prisma.routeCredit.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
      });
      const actions = await prisma.adminAccessLog.findMany({
        where: { targetUserId: userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        include: { admin: { select: { id: true, name: true, email: true } } },
      });
      return NextResponse.json({
        recentPayments: payments.map(serializePaymentTransaction),
        recentRouteCredits: credits.map(serializeRouteCredit),
        recentAdminActions: actions.map(serializeAdminAction),
      });
    }

    const now = new Date();
    const { requestedPage, pageSize, query } = readAdminPagination(params);
    const list = await listAdminSubscriptionIds(now, params.get("filter") ?? "ALL", query, requestedPage, pageSize);
    const ids = list.rows.map((row) => row.id);
    const users = ids.length ? await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { ...accessAccountSelect, name: true, email: true, createdAt: true, updatedAt: true },
    }) : [];
    const access = await getAdminAccessSnapshots(users, now);
    const subscriptionIds = list.rows.flatMap((row) => row.latestSubscriptionId ? [row.latestSubscriptionId] : []);
    const subscriptions = subscriptionIds.length ? await prisma.userSubscription.findMany({
      where: { id: { in: subscriptionIds } },
      include: { plan: true },
    }) : [];
    const paymentIds = list.rows.flatMap((row) => row.latestPaymentId ? [row.latestPaymentId] : []);
    const payments = paymentIds.length ? await prisma.paymentTransaction.findMany({
      where: { id: { in: paymentIds } },
    }) : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    const subscriptionsById = new Map(subscriptions.map((subscription) => [subscription.id, serializeSubscriptionRow(subscription)]));
    const paymentsById = new Map(payments.map((payment) => [payment.id, serializePaymentTransaction(payment)]));
    const financialSummary = await getAdminFinancialSummary(now);

    const rows = list.rows.flatMap((row) => {
      const user = usersById.get(row.id);
      const snapshot = access.get(row.id);
      if (!user || !snapshot) return [];
      const { id, name, email, role, active, createdAt, updatedAt } = user;
      const latestSubscription = row.latestSubscriptionId ? subscriptionsById.get(row.latestSubscriptionId) ?? null : null;
      const current = snapshot.activeSubscription;
      return [{
        id, userId: id, name, email, role, active, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(),
        access: snapshot,
        currentSubscription: current,
        latestSubscription,
        latestPayment: row.latestPaymentId ? paymentsById.get(row.latestPaymentId) ?? null : null,
        planOrigin: row.planOrigin,
        subscriptionStatusLabel: row.subscriptionStatusLabel,
        creditsAvailable: snapshot.routeCreditsBalance + snapshot.subscriptionCycleRemaining,
        creditsUsedInCycle: snapshot.subscriptionCycleUsed,
        cycleStartAt: current?.startsAt ?? latestSubscription?.startsAt ?? null,
        cycleExpiresAt: current?.expiresAt ?? latestSubscription?.expiresAt ?? null,
      }];
    });

    return NextResponse.json({
      ok: true,
      summary: list.summary,
      financialSummary,
      pagination: adminPage(requestedPage, pageSize, list.total),
      users: rows,
    });
  } catch (error) {
    console.error("Erro admin subscriptions GET:", error);
    return NextResponse.json({ error: "Erro ao listar assinaturas." }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: any) {
  try {
    const session = await getServerSession(authOptions);
    if (!requireSuperAdmin(session?.user as any)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const maybeParams = ctx?.params;
    const params =
      maybeParams && typeof maybeParams.then === "function"
        ? await maybeParams
        : maybeParams;
    const userId = String(params?.userId || "");
    if (!userId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const adminId = String((session?.user as any)?.id || "");
    const body = await req.json().catch(() => null);
    const rawAction = String(body?.action ?? "").trim().toUpperCase();
    const planCode = String(body?.planCode ?? "").trim().toUpperCase();
    const credits = Number(body?.credits);
    const notes = String(body?.notes ?? "").trim();

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
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

    if (!targetUser) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    if (targetUser.role === "ADMIN") {
      return NextResponse.json(
        { error: "Ações de plano não são aplicadas a contas ADMIN." },
        { status: 400 }
      );
    }

    const now = new Date();
    const plan = planCode
      ? await prisma.subscriptionPlan.findFirst({
          where: {
            code: planCode as any,
            isActive: true,
          },
          select: {
            id: true,
            code: true,
            name: true,
            durationDays: true,
            dailyRouteLimit: true,
            isUnlimited: true,
            isActive: true,
          },
        })
      : null;

    if (rawAction === "SET_PLAN" && planCode !== "NONE" && !plan) {
      return NextResponse.json(
        { error: `Plano ${planCode || "inválido"} não encontrado.` },
        { status: 400 }
      );
    }

    if (rawAction === "RENEW_CYCLE" || rawAction === "REACTIVATE_SUBSCRIPTION") {
      const existingActive = await prisma.userSubscription.findFirst({
        where: { userId, ...administrativelyRevocable(new Date()) },
        include: {
          plan: {
            select: {
              id: true,
              code: true,
              name: true,
              durationDays: true,
              dailyRouteLimit: true,
              isUnlimited: true,
              isActive: true,
            },
          },
        },
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
      });

      const fallbackSubscription =
        existingActive ||
        (await prisma.userSubscription.findFirst({
          where: { userId, startsAt: { lte: new Date() } },
          include: {
            plan: {
              select: {
                id: true,
                code: true,
                name: true,
                durationDays: true,
                dailyRouteLimit: true,
                isUnlimited: true,
                isActive: true,
              },
            },
          },
          orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
        }));

      if (!fallbackSubscription) {
        return NextResponse.json(
          { error: "O usuário não possui plano para renovar ou reativar." },
          { status: 400 }
        );
      }

      const activePlan = fallbackSubscription.plan;
      const activeDurationDays = activePlan.durationDays ?? (activePlan.isUnlimited ? null : 30);
      const expiresAt = activeDurationDays ? addDays(now, activeDurationDays) : null;

      await prisma.$transaction(async (tx) => {
        await revokeActiveSubscriptions(tx, userId);
        const usageReset = await resetTodayRouteUsageForAdminChange(tx, userId);

        const subscription = await tx.userSubscription.create({
          data: {
            userId,
            planId: activePlan.id,
            status: "ACTIVE",
            source: "ADMIN_GRANT",
            startsAt: now,
            expiresAt,
            grantedByAdminId: adminId,
            notes:
              rawAction === "RENEW_CYCLE"
                ? "Renovação manual de ciclo via admin."
                : "Reativação manual de assinatura via admin.",
          },
        });

        await logAdminAction(tx, {
          adminId,
          targetUserId: userId,
          action: rawAction,
          metadata: {
            planCode: activePlan.code,
            expiresAt: expiresAt?.toISOString() ?? null,
            subscriptionId: subscription.id,
            resetTodayUsageCount: usageReset.resetTodayUsageCount,
            resetTodayUsageDayKey: usageReset.resetTodayUsageDayKey,
          },
        });
      });
    } else if (rawAction === "SET_PLAN") {
      await prisma.$transaction(async (tx) => {
        await revokeActiveSubscriptions(tx, userId);
        const usageReset = await resetTodayRouteUsageForAdminChange(tx, userId);

        if (planCode !== "NONE" && plan) {
          const expiresAt = plan.isUnlimited || !plan.durationDays ? null : addDays(now, plan.durationDays);
          const subscription = await tx.userSubscription.create({
            data: {
              userId,
              planId: plan.id,
              status: "ACTIVE",
              source: "ADMIN_GRANT",
              startsAt: now,
              expiresAt,
              grantedByAdminId: adminId,
              notes: notes || `Plano ajustado manualmente via admin: ${plan.code}.`,
            },
          });

          await logAdminAction(tx, {
            adminId,
            targetUserId: userId,
            action: "SET_PLAN",
            metadata: {
              planCode: plan.code,
              expiresAt: expiresAt?.toISOString() ?? null,
              subscriptionId: subscription.id,
              resetTodayUsageCount: usageReset.resetTodayUsageCount,
              resetTodayUsageDayKey: usageReset.resetTodayUsageDayKey,
            },
          });
        } else {
          await logAdminAction(tx, {
            adminId,
            targetUserId: userId,
            action: "SET_PLAN",
            metadata: {
              planCode: "NONE",
              resetTodayUsageCount: usageReset.resetTodayUsageCount,
              resetTodayUsageDayKey: usageReset.resetTodayUsageDayKey,
            },
          });
        }
      });
    } else if (rawAction === "PAUSE_SUBSCRIPTION" || rawAction === "CANCEL_SUBSCRIPTION") {
      const activeSubscriptions = await prisma.userSubscription.findMany({
        where: {
          userId,
          ...administrativelyRevocable(new Date()),
        },
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          planId: true,
          plan: {
            select: {
              code: true,
            },
          },
          expiresAt: true,
        },
      });

      if (activeSubscriptions.length === 0) {
        return NextResponse.json({ error: "O usuário não possui plano ativo." }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        await revokeActiveSubscriptions(tx, userId);
        const usageReset = await resetTodayRouteUsageForAdminChange(tx, userId);

        await logAdminAction(tx, {
          adminId,
          targetUserId: userId,
          action: rawAction,
          metadata: {
            revokedSubscriptionIds: activeSubscriptions.map((item) => item.id),
            previousPlanCodes: activeSubscriptions.map((item) => item.plan.code),
            previousExpiresAt: activeSubscriptions.map((item) => item.expiresAt?.toISOString() ?? null),
            resetTodayUsageCount: usageReset.resetTodayUsageCount,
            resetTodayUsageDayKey: usageReset.resetTodayUsageDayKey,
          },
        });
      });
    } else if (rawAction === "ADD_ROUTE_CREDITS" || rawAction === "REMOVE_ROUTE_CREDITS") {
      if (!Number.isInteger(credits) || credits <= 0) {
        return NextResponse.json(
          { error: "Campo 'credits' inválido. Use inteiro positivo." },
          { status: 400 }
        );
      }

      if (rawAction === "REMOVE_ROUTE_CREDITS") {
        const creditsBefore = await getRouteCreditsBalance(prisma, userId);
        if (creditsBefore <= 0) {
          return NextResponse.json(
            { error: "O usuário não possui créditos para remover." },
            { status: 400 }
          );
        }

        if (credits > creditsBefore) {
          return NextResponse.json(
            { error: "Não é permitido remover mais créditos do que o saldo atual." },
            { status: 400 }
          );
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.routeCredit.create({
          data: {
            userId,
            delta: rawAction === "ADD_ROUTE_CREDITS" ? credits : -credits,
            reason: "ADJUSTMENT",
            notes:
              notes ||
              (rawAction === "ADD_ROUTE_CREDITS"
                ? `Crédito manual via admin: +${credits}`
                : `Remoção manual de ${credits} crédito(s) via admin.`),
          },
        });

        await logAdminAction(tx, {
          adminId,
          targetUserId: userId,
          action: rawAction,
          metadata: {
            delta: rawAction === "ADD_ROUTE_CREDITS" ? credits : -credits,
            notes: notes || null,
          },
        });
      });
    } else {
      return NextResponse.json({ error: "Ação administrativa inválida." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ScheduledRenewalError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Erro admin subscriptions PATCH:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar assinaturas." },
      { status: 500 }
    );
  }
}
