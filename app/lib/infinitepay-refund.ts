import { Prisma } from "@prisma/client";
import { MANUAL_REFUND_RECORDED } from "./payment-fulfillment";
import { prisma } from "./prisma";
import { lockSubscriptionOwner } from "./subscription-cycles";

type RefundInput = {
  orderNsu: string;
  captureReference: string;
  amountCents: number;
  evidence: string;
};

type CreditEntry = { id: string; delta: number; reversalOfCreditId: string | null };

// The historical ledger has no per-purchase consumption. Attribute ordinary
// debits to the oldest available credits, and refunds only to their own grant.
function unusedCredit(ledger: CreditEntry[], creditId: string): number | null {
  const lots: { remaining: number }[] = [];
  const byId = new Map<string, (typeof lots)[number]>();
  let oldest = 0;
  let debt = 0;
  for (const entry of ledger) {
    if (entry.reversalOfCreditId) {
      const origin = byId.get(entry.reversalOfCreditId);
      if (!origin || entry.delta > 0 || origin.remaining < -entry.delta) return null;
      origin.remaining += entry.delta;
    } else if (entry.delta > 0) {
      const covered = Math.min(debt, entry.delta);
      debt -= covered;
      const lot = { remaining: entry.delta - covered };
      byId.set(entry.id, lot);
      lots.push(lot);
    } else {
      let debit = -entry.delta;
      while (debit > 0 && oldest < lots.length) {
        const lot = lots[oldest];
        const used = Math.min(lot.remaining, debit);
        lot.remaining -= used;
        debit -= used;
        if (lot.remaining === 0) oldest++;
      }
      debt += debit;
    }
  }
  return byId.get(creditId)?.remaining ?? null;
}

export async function recordInfinitePayRefund(adminId: string, input: RefundInput) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const order = await tx.paymentTransaction.findUnique({
          where: { externalReference: input.orderNsu }, select: { id: true, userId: true },
        });
        if (!order) return null;
        await lockSubscriptionOwner(tx, order.userId);
        const payment = await tx.paymentTransaction.findUnique({
          where: { id: order.id },
          include: { routeCredit: true, subscription: { include: { plan: { select: { code: true } } } } },
        });
        if (!payment || payment.provider !== "INFINITEPAY" || payment.currency !== "BRL" ||
            !payment.approvedAt || payment.infinitePayTransactionId !== input.captureReference ||
            (payment.paidAmountCents ?? payment.amountCents) !== input.amountCents) return null;
        if (payment.status === "REFUNDED" && payment.fulfillmentReviewReason === MANUAL_REFUND_RECORDED) {
          return { resolved: true, alreadyRecorded: true } as const;
        }
        if (payment.status !== "APPROVED" && payment.status !== "FULFILLED") return null;

        let revokedCredits = 0;
        let consumedCredits = 0;
        let revokedSubscriptionId: string | null = null;
        if (payment.fulfilledAt) {
          if (payment.productType === "EXTRA_ROUTE") {
            const credit = payment.routeCredit;
            if (!credit || credit.id !== payment.fulfilledSourceId || credit.userId !== payment.userId ||
                credit.delta !== payment.quantity || credit.delta <= 0 || payment.subscription) return null;
            const ledger = await tx.routeCredit.findMany({
              where: { userId: payment.userId },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { id: true, delta: true, reversalOfCreditId: true, createdAt: true },
            });
            const remaining = unusedCredit(ledger, credit.id);
            if (remaining === null) return null;
            revokedCredits = remaining;
            consumedCredits = credit.delta - remaining;
            if (revokedCredits > 0) {
              await tx.routeCredit.create({
                data: {
                  userId: payment.userId, delta: -revokedCredits, reason: "ADJUSTMENT",
                  reversalOfCreditId: credit.id, notes: "Estorno de créditos InfinitePay",
                  createdAt: new Date(Math.max(Date.now(), (ledger.at(-1)?.createdAt.getTime() ?? 0) + 1)),
                },
              });
            }
          } else {
            const cycle = payment.subscription;
            const expectedPlan = payment.productType === "BASIC_PLAN" ? "BASIC" : "PRO";
            if (!cycle || cycle.id !== payment.fulfilledSourceId || cycle.userId !== payment.userId ||
                cycle.plan.code !== expectedPlan || cycle.source !== "INFINITEPAY_LINK" || payment.routeCredit) return null;
            if (cycle.status === "ACTIVE" || cycle.status === "SCHEDULED") {
              await tx.userSubscription.update({ where: { id: cycle.id }, data: { status: "REVOKED" } });
              revokedSubscriptionId = cycle.id;
            }
          }
        } else if (payment.status === "FULFILLED" || payment.fulfilledSourceId || payment.routeCredit || payment.subscription) {
          return null;
        }

        await tx.paymentTransaction.update({
          where: { id: payment.id },
          data: { status: "REFUNDED", fulfillmentReviewReason: MANUAL_REFUND_RECORDED },
        });
        if (payment.infinitePaySlug) {
          await tx.paymentEvent.updateMany({
            where: {
              paymentTransactionId: payment.id, kind: "refunded", status: "REVIEW",
              slug: payment.infinitePaySlug, transactionNsu: input.captureReference,
              lastError: "UNVERIFIED_REVERSAL",
            },
            data: { status: "PROCESSED", lastError: null },
          });
        }
        await tx.adminAccessLog.create({
          data: {
            adminId, targetUserId: payment.userId, action: "RECORD_INFINITEPAY_REFUND",
            metadata: { ...input, paymentTransactionId: payment.id, revokedSubscriptionId, revokedCredits, consumedCredits },
          },
        });
        return { resolved: true, alreadyRecorded: false, revokedSubscriptionId, revokedCredits, consumedCredits } as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt === 2 || !(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      const duplicateReversal = error.code === "P2002" && String(error.meta?.target).includes("reversalOfCreditId");
      if (error.code !== "P2034" && !duplicateReversal) throw error;
    }
  }
  return null;
}
