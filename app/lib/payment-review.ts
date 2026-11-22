import { prisma } from "./prisma";
import { grantPaymentBenefit, MANUAL_REFUND_RECORDED } from "./payment-fulfillment";
import { lockSubscriptionOwner } from "./subscription-cycles";

const heldReasons = ["PLAN_UNAVAILABLE", "PLAN_CHANGE_REQUIRES_REVIEW", "CYCLE_CONFLICT"];
const separateCaptureReasons = ["CONFIRMED_DUPLICATE_CAPTURE", "CONFIRMED_OTHER_LINK", "ORDER_ALREADY_HAS_ANOTHER_CAPTURE"];

type Review = {
  action: "retry-benefit" | "record-refund" | "record-duplicate-refund";
  orderNsu: string;
  captureReference: string;
  evidence: string;
  amountCents: number;
  eventId: string | null;
};

export async function resolvePaymentReview(adminId: string, input: Review) {
  const order = await prisma.paymentTransaction.findUnique({
    where: { externalReference: input.orderNsu }, select: { id: true, userId: true },
  });
  if (!order) return null;

  return prisma.$transaction(async (tx) => {
    await lockSubscriptionOwner(tx, order.userId);
    await tx.$queryRaw`SELECT id FROM "PaymentTransaction" WHERE id = ${order.id} FOR UPDATE`;
    const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: order.id } });
    if (payment.amountCents !== input.amountCents) return null;
    if (input.action === "record-duplicate-refund") {
      if (!input.eventId || payment.provider !== "INFINITEPAY" ||
          payment.infinitePayTransactionId === input.captureReference) return null;
      const updated = await tx.paymentEvent.updateMany({
        where: {
          id: input.eventId, paymentTransactionId: payment.id, kind: "confirm", status: "REVIEW",
          transactionNsu: input.captureReference, lastError: { in: separateCaptureReasons },
        },
        data: { status: "PROCESSED", lastError: null },
      });
      if (!updated.count) return null;
    } else {
      const captureId = payment.infinitePayTransactionId ?? payment.asaasPaymentId ?? payment.mercadoPagoPaymentId;
      if (payment.status !== "APPROVED" || !payment.approvedAt || payment.fulfilledAt ||
          payment.fulfilledSourceId || captureId !== input.captureReference ||
          (payment.fulfillmentReviewReason && !heldReasons.includes(payment.fulfillmentReviewReason))) return null;

      if (input.action === "retry-benefit") {
        const cleared = await tx.paymentTransaction.update({
          where: { id: payment.id }, data: { fulfillmentReviewReason: null },
        });
        const result = await grantPaymentBenefit(tx, cleared, new Date(), true);
        if (!result.fulfilled) return { resolved: false, reason: result.reason } as const;
      } else {
        await tx.paymentTransaction.update({
          where: { id: payment.id }, data: { status: "REFUNDED", fulfillmentReviewReason: MANUAL_REFUND_RECORDED },
        });
      }
      if (payment.provider === "INFINITEPAY") {
        await tx.paymentEvent.updateMany({
          where: { paymentTransactionId: payment.id, transactionNsu: input.captureReference, status: "REVIEW",
            lastError: { in: heldReasons } },
          data: { status: "PROCESSED", lastError: null },
        });
      }
    }

    await tx.adminAccessLog.create({
      data: {
        adminId, targetUserId: payment.userId, action: "RESOLVE_PAYMENT_REVIEW",
        metadata: { ...input, paymentTransactionId: payment.id },
      },
    });
    return { resolved: true } as const;
  }, { isolationLevel: "ReadCommitted" });
}
