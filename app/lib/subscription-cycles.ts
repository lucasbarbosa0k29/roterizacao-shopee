import type { PaymentProvider, Prisma } from "@prisma/client";

const DAY_MS = 86_400_000;

export function legacyEarlyRenewalEnabled() {
  return process.env.LEGACY_EARLY_RENEWAL_ENABLED === "1";
}

export function startedSubscription(now: Date): Prisma.UserSubscriptionWhereInput {
  return {
    startsAt: { lte: now },
    OR: [
      { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { status: "SCHEDULED", expiresAt: { gt: now } },
    ],
  };
}

export async function lockSubscriptionOwner(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

export async function hasConflictingPaidCycle(
  db: Pick<Prisma.TransactionClient, "userSubscription">,
  userId: string,
  productType: "BASIC_PLAN" | "PRO_PLAN",
  now: Date
) {
  const cycle = await db.userSubscription.findFirst({
    where: {
      userId,
      status: { in: ["ACTIVE", "SCHEDULED"] },
      plan: { code: { not: productType === "BASIC_PLAN" ? "BASIC" : "PRO" } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  return Boolean(cycle);
}

export class ScheduledRenewalError extends Error {}

export function administrativelyRevocable(now: Date): Prisma.UserSubscriptionWhereInput {
  return { OR: [{ status: "ACTIVE" }, { status: "SCHEDULED", startsAt: { lte: now }, expiresAt: { gt: now } }] };
}

export async function guardAdminCycleChange(tx: Prisma.TransactionClient, userId: string) {
  await lockSubscriptionOwner(tx, userId);
  const future = await tx.userSubscription.findFirst({
    where: { userId, status: "SCHEDULED", startsAt: { gt: new Date() } },
    select: { id: true },
  });
  if (future) {
    throw new ScheduledRenewalError("A conta possui renovações pagas agendadas. Revise os ciclos antes de alterar o plano.");
  }
}

export async function createPaidSubscriptionCycle(
  tx: Prisma.TransactionClient,
  payment: { id: string; userId: string; provider: PaymentProvider; productType: "BASIC_PLAN" | "PRO_PLAN" },
  now: Date,
  notes: string,
  administrativeRecovery = false
) {
  // Caller holds the User row lock until the payment and cycle commit.
  const code = payment.productType === "BASIC_PLAN" ? "BASIC" : "PRO";
  const plan = await tx.subscriptionPlan.findUnique({ where: { code } });
  if (!plan?.isActive || !plan.durationDays || plan.durationDays <= 0) {
    return { review: "PLAN_UNAVAILABLE" } as const;
  }

  const remaining = await tx.userSubscription.findMany({
    where: {
      userId: payment.userId,
      status: { in: ["ACTIVE", "SCHEDULED"] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { startsAt: "asc" },
    include: { plan: { select: { isActive: true } } },
  });
  const canSchedule = payment.provider === "INFINITEPAY" || legacyEarlyRenewalEnabled();
  const hasScheduled = remaining.some((cycle) => cycle.status === "SCHEDULED");
  let startsAt = now;
  if (!canSchedule && !hasScheduled && !administrativeRecovery) {
    // Preserve the previous release's policy and the enum it can read.
    await tx.userSubscription.updateMany({
      where: { userId: payment.userId, status: "ACTIVE" },
      data: { status: "REVOKED" },
    });
  } else {
    const gaps: { from: number; to: number }[] = [];
    for (const [index, cycle] of remaining.entries()) {
      if (cycle.planId !== plan.id) return { review: "PLAN_CHANGE_REQUIRES_REVIEW" } as const;
      if (!cycle.plan.isActive || !cycle.expiresAt || cycle.expiresAt <= cycle.startsAt ||
          (index > 0 && cycle.startsAt < startsAt)) {
        return { review: "CYCLE_CONFLICT" } as const;
      }
      if (index > 0 && cycle.startsAt > startsAt) {
        gaps.push({ from: startsAt.getTime(), to: cycle.startsAt.getTime() });
      }
      startsAt = cycle.expiresAt;
    }
    if (gaps.length) {
      // Paid renewals retain their original dates when a cycle is refunded.
      const refunded = await tx.userSubscription.findMany({
        where: {
          userId: payment.userId, planId: plan.id, status: "REVOKED",
          paymentTransaction: { provider: "INFINITEPAY", status: "REFUNDED" },
        },
        select: { startsAt: true, expiresAt: true },
      });
      const refundedEnds = new Map(refunded.map((cycle) => [cycle.startsAt.getTime(), cycle.expiresAt?.getTime()]));
      for (const { from, to } of gaps) {
        let boundary = from;
        while (boundary < to) {
          const next = refundedEnds.get(boundary);
          if (next === undefined || next <= boundary || next > to) return { review: "CYCLE_CONFLICT" } as const;
          boundary = next;
        }
      }
    }
    if (startsAt > now && !canSchedule && !hasScheduled) {
      return { review: "CYCLE_CONFLICT" } as const;
    }
  }

  const subscription = await tx.userSubscription.create({
    data: {
      userId: payment.userId,
      planId: plan.id,
      paymentTransactionId: payment.id,
      notes,
      source: payment.provider === "INFINITEPAY" ? "INFINITEPAY_LINK" : "MANUAL_PAYMENT",
      status: startsAt > now ? "SCHEDULED" : "ACTIVE",
      startsAt,
      // A fixed-duration period with an exclusive end. Daily accrual uses the São Paulo calendar.
      expiresAt: new Date(startsAt.getTime() + plan.durationDays * DAY_MS),
    },
    select: { id: true },
  });
  return { subscription } as const;
}
