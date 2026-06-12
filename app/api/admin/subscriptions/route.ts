import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getUserAccessSnapshot } from "@/app/lib/access-control";
import { requireSuperAdmin } from "@/app/lib/admin-roles";

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
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
};

type PaymentTransactionSnapshot = {
  id: string;
  provider: "MERCADOPAGO";
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

type SubscriptionHistoryRow = {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  access: Awaited<ReturnType<typeof getUserAccessSnapshot>>;
  currentSubscription: ActiveSubscriptionSnapshot | null;
  latestSubscription: ActiveSubscriptionSnapshot | null;
  latestPayment: PaymentTransactionSnapshot | null;
  recentPayments: PaymentTransactionSnapshot[];
  recentRouteCredits: RouteCreditSnapshot[];
  recentAdminActions: AdminActionSnapshot[];
  planOrigin: "manual" | "Mercado Pago" | "avulso" | "sem plano";
  subscriptionStatusLabel: string;
  creditsAvailable: number;
  creditsUsedInCycle: number;
  cycleStartAt: string | null;
  cycleExpiresAt: string | null;
};

type FinancialSummary = {
  revenueCommercialTotalCents: number;
  revenueCommercialMonthCents: number;
  revenueCommercial30dCents: number;
  revenueInternalTestTotalCents: number;
  revenueInternalTestMonthCents: number;
  mrrBasicCents: number;
  mrrProCents: number;
  mrrTotalCents: number;
  basicPlansSold: number;
  proPlansSold: number;
  plansSold: number;
  extraRouteTransactions: number;
  extraRouteUnits: number;
  extraRouteRevenueCents: number;
  ticketAverageCents: number;
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

function normalizeDateString(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function getPlanOrigin(user: SubscriptionHistoryRow): "manual" | "Mercado Pago" | "avulso" | "sem plano" {
  const active = user.currentSubscription;
  const latestPayment = user.latestPayment;

  if (active) {
    if (active.source === "ADMIN_GRANT" || active.source === "TRIAL") {
      return "manual";
    }

    if (active.source === "MANUAL_PAYMENT" || active.source === "INFINITEPAY_LINK") {
      return "Mercado Pago";
    }
  }

  if (
    latestPayment &&
    (latestPayment.productType === "BASIC_PLAN" || latestPayment.productType === "PRO_PLAN") &&
    ["APPROVED", "FULFILLED"].includes(latestPayment.status)
  ) {
    return "Mercado Pago";
  }

  if (user.creditsAvailable > 0) {
    return "avulso";
  }

  return "sem plano";
}

function getSubscriptionStatusLabel(user: SubscriptionHistoryRow) {
  if (user.access.isBlocked) return "BLOQUEADO";
  if (user.currentSubscription) return "ATIVO";
  if (user.latestPayment && ["PENDING", "REQUIRES_ACTION"].includes(user.latestPayment.status)) {
    return "PAGAMENTO PENDENTE";
  }

  if (
    user.latestSubscription &&
    user.latestSubscription.expiresAt &&
    new Date(user.latestSubscription.expiresAt).getTime() < Date.now()
  ) {
    return "VENCIDO";
  }

  if (user.latestSubscription?.status === "REVOKED") {
    return "PAUSADO";
  }

  if (user.latestSubscription?.status === "EXPIRED") {
    return "VENCIDO";
  }

  return user.creditsAvailable > 0 ? "COM CRÉDITOS" : "SEM PLANO";
}

const FINANCIAL_INTERNAL_EMAILS = new Set(["teste123@gmail.com", "123@gmail.com"]);

function isCommercialUser(user: { role: "ADMIN" | "USER"; email: string }) {
  return user.role === "USER" && !FINANCIAL_INTERNAL_EMAILS.has(user.email.toLowerCase());
}

function isInternalOrTestUser(user: { role: "ADMIN" | "USER"; email: string }) {
  return user.role === "ADMIN" || FINANCIAL_INTERNAL_EMAILS.has(user.email.toLowerCase());
}

async function buildUserRow(user: {
  id: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const [access, subscriptions, paymentTransactions, routeCredits, adminActions] =
    await Promise.all([
      getUserAccessSnapshot(user.id),
      prisma.userSubscription.findMany({
        where: { userId: user.id },
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
        take: 8,
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
      }),
      prisma.paymentTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      prisma.routeCredit.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.adminAccessLog.findMany({
        where: { targetUserId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
    ]);

  const currentSubscription = subscriptions.find((item) => item.status === "ACTIVE") ?? null;
  const latestSubscription = subscriptions[0] ?? null;
  const latestPayment = paymentTransactions[0] ?? null;
  const routeCreditsBalance = access.routeCreditsBalance;
  const creditsAvailable = routeCreditsBalance + access.subscriptionCycleRemaining;

  const row: SubscriptionHistoryRow = {
    id: user.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    access,
    currentSubscription: currentSubscription ? serializeSubscriptionRow(currentSubscription) : null,
    latestSubscription: latestSubscription ? serializeSubscriptionRow(latestSubscription) : null,
    latestPayment: latestPayment ? serializePaymentTransaction(latestPayment) : null,
    recentPayments: paymentTransactions.map(serializePaymentTransaction),
    recentRouteCredits: routeCredits.map(serializeRouteCredit),
    recentAdminActions: adminActions.map(serializeAdminAction),
    planOrigin: "sem plano",
    subscriptionStatusLabel: "SEM PLANO",
    creditsAvailable,
    creditsUsedInCycle: access.subscriptionCycleUsed,
    cycleStartAt:
      normalizeDateString(access.activeSubscription?.startsAt) ??
      normalizeDateString(latestSubscription?.startsAt) ??
      null,
    cycleExpiresAt:
      normalizeDateString(access.activeSubscription?.expiresAt) ??
      normalizeDateString(latestSubscription?.expiresAt) ??
      null,
  };

  row.planOrigin = getPlanOrigin(row);
  row.subscriptionStatusLabel = getSubscriptionStatusLabel(row);

  return row;
}

async function buildFinancialSummary(): Promise<FinancialSummary> {
  const approvedPayments = await prisma.paymentTransaction.findMany({
    where: {
      status: {
        in: ["APPROVED", "FULFILLED"],
      },
    },
    select: {
      productType: true,
      quantity: true,
      amountCents: true,
      createdAt: true,
      user: {
        select: {
          role: true,
          email: true,
        },
      },
    },
  });

  const activeSubscriptions = await prisma.userSubscription.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: {
        gt: new Date(),
      },
      plan: {
        code: {
          in: ["BASIC", "PRO"],
        },
        isActive: true,
      },
      user: {
        role: "USER",
        email: {
          notIn: Array.from(FINANCIAL_INTERNAL_EMAILS),
        },
      },
    },
    select: {
      plan: {
        select: {
          code: true,
          dailyRouteLimit: true,
        },
      },
    },
  });

  const commercialPayments = approvedPayments.filter((payment) => isCommercialUser(payment.user));
  const internalTestPayments = approvedPayments.filter((payment) => isInternalOrTestUser(payment.user));

  const revenueCommercialTotalCents = commercialPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const revenueCommercialMonthCents = commercialPayments.reduce((sum, payment) => {
    return payment.createdAt >= new Date(new Date().getFullYear(), new Date().getMonth(), 1) ? sum + payment.amountCents : sum;
  }, 0);
  const revenueCommercial30dCents = commercialPayments.reduce((sum, payment) => {
    return payment.createdAt >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) ? sum + payment.amountCents : sum;
  }, 0);
  const revenueInternalTestTotalCents = internalTestPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const revenueInternalTestMonthCents = internalTestPayments.reduce((sum, payment) => {
    return payment.createdAt >= new Date(new Date().getFullYear(), new Date().getMonth(), 1) ? sum + payment.amountCents : sum;
  }, 0);

  const planPayments = commercialPayments.filter((payment) => payment.productType === "BASIC_PLAN" || payment.productType === "PRO_PLAN");
  const basicPlansSold = planPayments.filter((payment) => payment.productType === "BASIC_PLAN").length;
  const proPlansSold = planPayments.filter((payment) => payment.productType === "PRO_PLAN").length;
  const plansSold = planPayments.length;
  const extraRoutePayments = commercialPayments.filter((payment) => payment.productType === "EXTRA_ROUTE");
  const extraRouteTransactions = extraRoutePayments.length;
  const extraRouteUnits = extraRoutePayments.reduce((sum, payment) => sum + payment.quantity, 0);
  const extraRouteRevenueCents = extraRoutePayments.reduce((sum, payment) => sum + payment.amountCents, 0);

  const ticketAverageCents =
    commercialPayments.length > 0
      ? revenueCommercialTotalCents / commercialPayments.length
      : 0;

  const mrrBasicUsers = activeSubscriptions.filter((sub) => sub.plan.code === "BASIC").length;
  const mrrProUsers = activeSubscriptions.filter((sub) => sub.plan.code === "PRO").length;
  const mrrBasicCents = mrrBasicUsers * 3999;
  const mrrProCents = mrrProUsers * 6999;

  return {
    revenueCommercialTotalCents,
    revenueCommercialMonthCents,
    revenueCommercial30dCents,
    revenueInternalTestTotalCents,
    revenueInternalTestMonthCents,
    mrrBasicCents,
    mrrProCents,
    mrrTotalCents: mrrBasicCents + mrrProCents,
    basicPlansSold,
    proPlansSold,
    plansSold,
    extraRouteTransactions,
    extraRouteUnits,
    extraRouteRevenueCents,
    ticketAverageCents,
  };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!requireSuperAdmin(session?.user as any)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      orderBy: [{ createdAt: "desc" }, { email: "asc" }],
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

    const rows = await Promise.all(users.map((user) => buildUserRow(user)));
    const financialSummary = await buildFinancialSummary();

    const summary = {
      totalUsers: rows.length,
      activeUsers: rows.filter((row) => row.active).length,
      inactiveUsers: rows.filter((row) => !row.active).length,
      activePlans: rows.filter((row) => !!row.currentSubscription).length,
      basicPlans: rows.filter((row) => row.currentSubscription?.code === "BASIC").length,
      proPlans: rows.filter((row) => row.currentSubscription?.code === "PRO").length,
      freePlans: rows.filter((row) => row.currentSubscription?.code === "FREE").length,
      usersWithCredits: rows.filter((row) => row.access.routeCreditsBalance > 0).length,
      expiredPlans: rows.filter((row) => row.subscriptionStatusLabel === "VENCIDO").length,
      pendingPayments: rows.filter((row) => row.subscriptionStatusLabel === "PAGAMENTO PENDENTE").length,
    };

    return NextResponse.json({
      ok: true,
      summary,
      financialSummary,
      users: rows,
    });
  } catch (error) {
    console.error("Erro admin subscriptions GET:", error);
    return NextResponse.json(
      { error: "Erro ao listar assinaturas." },
      { status: 500 }
    );
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
        where: { userId, status: "ACTIVE" },
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
          where: { userId },
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
          status: "ACTIVE",
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

    const refreshed = await buildUserRow({
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      role: targetUser.role,
      active: targetUser.active,
      createdAt: targetUser.createdAt,
      updatedAt: targetUser.updatedAt,
    });

    return NextResponse.json({
      ok: true,
      user: refreshed,
    });
  } catch (error) {
    console.error("Erro admin subscriptions PATCH:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar assinaturas." },
      { status: 500 }
    );
  }
}
