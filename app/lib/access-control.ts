import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

type AccessPlanCode = "FREE" | "BASIC" | "PRO";
type AccessRole = "ADMIN" | "USER";
type AllowanceSource = "ADMIN" | "FREE" | "SUBSCRIPTION_DAILY" | "EXTRA_CREDIT" | "NONE";
type AccessCode =
  | "OK"
  | "ACCESS_BLOCKED"
  | "NO_ACTIVE_SUBSCRIPTION"
  | "NO_ROUTE_CREDITS";

type AccessControlDb = Prisma.TransactionClient | typeof prisma;

export type UserAccessSnapshot = {
  userId: string;
  role: AccessRole;
  isAdmin: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  activeSubscription: null | {
    id: string;
    code: AccessPlanCode;
    name: string;
    startsAt: string;
    expiresAt: string | null;
    dailyRouteLimit: number;
    isUnlimited: boolean;
    source: "ADMIN_GRANT" | "TRIAL" | "INFINITEPAY_LINK" | "MANUAL_PAYMENT";
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
  };
  todayRouteUsage: number;
  planRouteUsageToday: number;
  routeCreditsBalance: number;
  canStartRoute: boolean;
  allowanceSource: AllowanceSource;
  dailyRouteLimit: number | null;
  isUnlimited: boolean;
  message: string | null;
  code: AccessCode;
};

export class AccessControlError extends Error {
  code: Exclude<AccessCode, "OK">;
  status: number;

  constructor(code: Exclude<AccessCode, "OK">, message: string, status = 403) {
    super(message);
    this.name = "AccessControlError";
    this.code = code;
    this.status = status;
  }
}

export type ConsumeRouteAllowanceInput = {
  userId: string;
  jobId: string;
  role: AccessRole;
};

export type ConsumeRouteAllowanceResult = {
  alreadyConsumed: boolean;
  source: Exclude<AllowanceSource, "ADMIN" | "NONE">;
  routeUsageId: string;
  subscriptionId: string | null;
};

function getSaoPauloDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isUnlimitedPlan(plan: { code: AccessPlanCode; isUnlimited: boolean }) {
  return plan.code === "FREE" || plan.isUnlimited;
}

export async function getTodayRouteUsage(userId: string) {
  const usageDayKey = getSaoPauloDayKey();

  const count = await prisma.routeUsage.count({
    where: {
      userId,
      usageDayKey,
    },
  });

  return count;
}

async function getRouteCreditBalanceFromDb(db: AccessControlDb, userId: string) {
  const result = await db.routeCredit.aggregate({
    where: { userId },
    _sum: { delta: true },
  });

  return result._sum.delta ?? 0;
}

export async function getRouteCreditBalance(userId: string) {
  return getRouteCreditBalanceFromDb(prisma, userId);
}

async function getDailySubscriptionUsageFromDb(
  db: AccessControlDb,
  userId: string,
  usageDayKey: string
) {
  return db.routeUsage.count({
    where: {
      userId,
      usageDayKey,
      source: "SUBSCRIPTION_DAILY",
    },
  });
}

async function getActiveSubscriptionFromDb(db: AccessControlDb, userId: string) {
  const now = new Date();

  const subscription = await db.userSubscription.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      plan: {
        isActive: true,
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    include: {
      plan: true,
    },
  });

  return subscription;
}

async function getActiveSubscription(userId: string) {
  return getActiveSubscriptionFromDb(prisma, userId);
}

function serializeActiveSubscription(activeSubscription: NonNullable<Awaited<ReturnType<typeof getActiveSubscription>>>) {
  return {
    id: activeSubscription.id,
    code: activeSubscription.plan.code,
    name: activeSubscription.plan.name,
    startsAt: activeSubscription.startsAt.toISOString(),
    expiresAt: activeSubscription.expiresAt?.toISOString() ?? null,
    dailyRouteLimit: activeSubscription.plan.dailyRouteLimit,
    isUnlimited: activeSubscription.plan.isUnlimited,
    source: activeSubscription.source,
    status: activeSubscription.status,
  };
}

export async function getUserAccessSnapshot(userId: string): Promise<UserAccessSnapshot> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      active: true,
      accessBlockedAt: true,
      accessBlockReason: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const isAdmin = user.role === "ADMIN";
  const isBlocked = !!user.accessBlockedAt;

  if (isAdmin) {
    return {
      userId: user.id,
      role: user.role,
      isAdmin: true,
      isBlocked,
      blockReason: user.accessBlockReason ?? null,
      activeSubscription: null,
      todayRouteUsage: 0,
      planRouteUsageToday: 0,
      routeCreditsBalance: await getRouteCreditBalance(user.id),
      canStartRoute: true,
      allowanceSource: "ADMIN",
      dailyRouteLimit: null,
      isUnlimited: true,
      message: null,
      code: "OK",
    };
  }

  const usageDayKey = getSaoPauloDayKey();
  const [activeSubscription, todayRouteUsage, routeCreditsBalance, dailySubscriptionUsage] =
    await Promise.all([
      getActiveSubscription(user.id),
      getTodayRouteUsage(user.id),
      getRouteCreditBalance(user.id),
      getDailySubscriptionUsageFromDb(prisma, user.id, usageDayKey),
    ]);

  if (isBlocked) {
    return {
      userId: user.id,
      role: user.role,
      isAdmin: false,
      isBlocked: true,
      blockReason: user.accessBlockReason ?? null,
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            code: activeSubscription.plan.code,
            name: activeSubscription.plan.name,
            startsAt: activeSubscription.startsAt.toISOString(),
            expiresAt: activeSubscription.expiresAt?.toISOString() ?? null,
            dailyRouteLimit: activeSubscription.plan.dailyRouteLimit,
            isUnlimited: activeSubscription.plan.isUnlimited,
            source: activeSubscription.source,
            status: activeSubscription.status,
          }
        : null,
      todayRouteUsage,
      planRouteUsageToday: dailySubscriptionUsage,
      routeCreditsBalance,
      canStartRoute: false,
      allowanceSource: "NONE",
      dailyRouteLimit: activeSubscription?.plan.dailyRouteLimit ?? null,
      isUnlimited: activeSubscription ? isUnlimitedPlan(activeSubscription.plan) : false,
      message: user.accessBlockReason ?? "Seu acesso está bloqueado.",
      code: "ACCESS_BLOCKED",
    };
  }

  if (!activeSubscription && routeCreditsBalance <= 0) {
    return {
      userId: user.id,
      role: user.role,
      isAdmin: false,
      isBlocked: false,
      blockReason: user.accessBlockReason ?? null,
      activeSubscription: null,
      todayRouteUsage,
      planRouteUsageToday: dailySubscriptionUsage,
      routeCreditsBalance,
      canStartRoute: false,
      allowanceSource: "NONE",
      dailyRouteLimit: null,
      isUnlimited: false,
      message: "Nenhum plano ativo encontrado.",
      code: "NO_ACTIVE_SUBSCRIPTION",
    };
  }

  if (!activeSubscription && routeCreditsBalance > 0) {
    return {
      userId: user.id,
      role: user.role,
      isAdmin: false,
      isBlocked: false,
      blockReason: null,
      activeSubscription: null,
      todayRouteUsage,
      planRouteUsageToday: dailySubscriptionUsage,
      routeCreditsBalance,
      canStartRoute: true,
      allowanceSource: "EXTRA_CREDIT",
      dailyRouteLimit: null,
      isUnlimited: false,
      message: null,
      code: "OK",
    };
  }

  const subscription = activeSubscription;
  if (!subscription) {
    throw new Error("Active subscription expected");
  }
  const isFree = isUnlimitedPlan(subscription.plan);
  const hasDailyAllowance =
    isFree || dailySubscriptionUsage < subscription.plan.dailyRouteLimit;

  if (hasDailyAllowance) {
    return {
      userId: user.id,
      role: user.role,
      isAdmin: false,
      isBlocked: false,
      blockReason: null,
      activeSubscription: serializeActiveSubscription(subscription),
      todayRouteUsage,
      planRouteUsageToday: dailySubscriptionUsage,
      routeCreditsBalance,
      canStartRoute: true,
      allowanceSource: isFree ? "FREE" : "SUBSCRIPTION_DAILY",
      dailyRouteLimit: isFree ? null : subscription.plan.dailyRouteLimit,
      isUnlimited: isFree,
      message: null,
      code: "OK",
    };
  }

  if (routeCreditsBalance > 0) {
    return {
      userId: user.id,
      role: user.role,
      isAdmin: false,
      isBlocked: false,
      blockReason: null,
      activeSubscription: serializeActiveSubscription(subscription),
      todayRouteUsage,
      planRouteUsageToday: dailySubscriptionUsage,
      routeCreditsBalance,
      canStartRoute: true,
      allowanceSource: "EXTRA_CREDIT",
      dailyRouteLimit: subscription.plan.dailyRouteLimit,
      isUnlimited: false,
      message: null,
      code: "OK",
    };
  }

  return {
    userId: user.id,
    role: user.role,
    isAdmin: false,
    isBlocked: false,
    blockReason: null,
    activeSubscription: serializeActiveSubscription(subscription),
    todayRouteUsage,
    planRouteUsageToday: dailySubscriptionUsage,
    routeCreditsBalance,
    canStartRoute: false,
    allowanceSource: "NONE",
    dailyRouteLimit: subscription.plan.dailyRouteLimit,
    isUnlimited: false,
    message: "Limite diário atingido e não há créditos disponíveis.",
    code: "NO_ROUTE_CREDITS",
  };
}

export async function consumeRouteAllowance({
  userId,
  jobId,
  role,
}: ConsumeRouteAllowanceInput): Promise<ConsumeRouteAllowanceResult> {
  if (role === "ADMIN") {
    const existing = await prisma.routeUsage.findUnique({
      where: { importJobId: jobId },
      select: { id: true, source: true, subscriptionId: true },
    });

    if (existing) {
      return {
        alreadyConsumed: true,
        source: existing.source as ConsumeRouteAllowanceResult["source"],
        routeUsageId: existing.id,
        subscriptionId: existing.subscriptionId,
      };
    }

    return {
      alreadyConsumed: false,
      source: "FREE",
      routeUsageId: "",
      subscriptionId: null,
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.routeUsage.findUnique({
            where: { importJobId: jobId },
            select: { id: true, source: true, subscriptionId: true },
          });

          if (existing) {
            return {
              alreadyConsumed: true,
              source: existing.source as ConsumeRouteAllowanceResult["source"],
              routeUsageId: existing.id,
              subscriptionId: existing.subscriptionId,
            };
          }

          const user = await tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              accessBlockedAt: true,
              accessBlockReason: true,
            },
          });

          if (!user) {
            throw new AccessControlError("NO_ACTIVE_SUBSCRIPTION", "Usuário não encontrado.");
          }

          if (user.accessBlockedAt) {
            throw new AccessControlError(
              "ACCESS_BLOCKED",
              user.accessBlockReason ?? "Seu acesso está bloqueado."
            );
          }

          const usageDayKey = getSaoPauloDayKey();
          const [activeSubscription, routeCreditsBalance] = await Promise.all([
            getActiveSubscriptionFromDb(tx, userId),
            getRouteCreditBalanceFromDb(tx, userId),
          ]);

          if (activeSubscription) {
            const isFreePlan = isUnlimitedPlan(activeSubscription.plan);

            if (isFreePlan) {
              const usage = await tx.routeUsage.create({
                data: {
                  userId,
                  importJobId: jobId,
                  subscriptionId: activeSubscription.id,
                  source: "FREE",
                  usageDayKey,
                },
                select: { id: true, subscriptionId: true },
              });

              return {
                alreadyConsumed: false,
                source: "FREE",
                routeUsageId: usage.id,
                subscriptionId: usage.subscriptionId,
              };
            }

            const dailyUsage = await getDailySubscriptionUsageFromDb(tx, userId, usageDayKey);
            if (dailyUsage < activeSubscription.plan.dailyRouteLimit) {
              const usage = await tx.routeUsage.create({
                data: {
                  userId,
                  importJobId: jobId,
                  subscriptionId: activeSubscription.id,
                  source: "SUBSCRIPTION_DAILY",
                  usageDayKey,
                },
                select: { id: true, subscriptionId: true },
              });

              return {
                alreadyConsumed: false,
                source: "SUBSCRIPTION_DAILY",
                routeUsageId: usage.id,
                subscriptionId: usage.subscriptionId,
              };
            }
          }

          if (routeCreditsBalance > 0) {
            await tx.routeCredit.create({
              data: {
                userId,
                delta: -1,
                reason: "CONSUMPTION",
                notes: `Consumo da rota do job ${jobId}`,
              },
            });

            const usage = await tx.routeUsage.create({
              data: {
                userId,
                importJobId: jobId,
                subscriptionId: activeSubscription?.id ?? null,
                source: "EXTRA_CREDIT",
                usageDayKey,
              },
              select: { id: true, subscriptionId: true },
            });

            return {
              alreadyConsumed: false,
              source: "EXTRA_CREDIT",
              routeUsageId: usage.id,
              subscriptionId: usage.subscriptionId,
            };
          }

          if (!activeSubscription) {
            throw new AccessControlError(
              "NO_ACTIVE_SUBSCRIPTION",
              "Nenhum plano ativo ou crédito disponível."
            );
          }

          throw new AccessControlError(
            "NO_ROUTE_CREDITS",
            "Limite diário atingido e não há créditos disponíveis."
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error: any) {
      if (error instanceof AccessControlError) {
        throw error;
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          const existing = await prisma.routeUsage.findUnique({
            where: { importJobId: jobId },
            select: { id: true, source: true, subscriptionId: true },
          });

          if (existing) {
            return {
              alreadyConsumed: true,
              source: existing.source as ConsumeRouteAllowanceResult["source"],
              routeUsageId: existing.id,
              subscriptionId: existing.subscriptionId,
            };
          }
        }

        if (error.code === "P2034" && attempt === 0) {
          continue;
        }
      }

      throw error;
    }
  }

  throw new AccessControlError("NO_ROUTE_CREDITS", "Não foi possível consumir a rota.");
}
