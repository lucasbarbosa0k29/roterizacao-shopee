import type { PaymentTransaction, Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { createPaidSubscriptionCycle, lockSubscriptionOwner } from "./subscription-cycles";

export const MANUAL_REFUND_RECORDED = "MANUAL_REFUND_RECORDED";

// The caller holds the user and payment row locks through the transaction.
export async function grantPaymentBenefit(
  tx: Prisma.TransactionClient,
  payment: PaymentTransaction,
  now: Date,
  administrativeRecovery = false
) {
  const paymentTransactionId = payment.id;
  if (payment.status !== "APPROVED" || payment.fulfilledAt || payment.fulfillmentReviewReason) {
    return { fulfilled: false, paymentTransactionId, reason: "ALREADY_FULFILLED_OR_NOT_APPROVED" } as const;
  }

  const provider = payment.provider === "INFINITEPAY" ? "InfinitePay" : payment.provider === "ASAAS" ? "Asaas" : "Mercado Pago";
  const providerId = payment.infinitePayTransactionId ?? payment.asaasPaymentId ?? payment.mercadoPagoPaymentId;
  const notes = `${provider} payment ${providerId ?? "unknown"} | PaymentTransaction ${payment.id} | External reference ${payment.externalReference}`;
  let fulfilledSourceId: string;
  if (payment.productType === "EXTRA_ROUTE") {
    const credit = await tx.routeCredit.create({
      data: { userId: payment.userId, paymentTransactionId, delta: payment.quantity, reason: "MANUAL_PAYMENT", notes },
      select: { id: true },
    });
    fulfilledSourceId = credit.id;
  } else {
    const result = await createPaidSubscriptionCycle(
      tx, { id: payment.id, userId: payment.userId, provider: payment.provider, productType: payment.productType },
      now, notes, administrativeRecovery
    );
    if ("review" in result && result.review) {
      await tx.paymentTransaction.update({
        where: { id: paymentTransactionId },
        data: { fulfillmentReviewReason: result.review },
      });
      return { fulfilled: false, paymentTransactionId, reason: result.review } as const;
    }
    fulfilledSourceId = result.subscription.id;
  }

  await tx.paymentTransaction.update({
    where: { id: paymentTransactionId },
    data: { fulfilledAt: now, fulfilledSourceId },
  });
  return { fulfilled: true, paymentTransactionId, productType: payment.productType, fulfilledSourceId } as const;
}

export async function fulfillApprovedPaymentTransaction(paymentTransactionId: string) {
  const order = await prisma.paymentTransaction.findUnique({
    where: { id: paymentTransactionId },
    select: { userId: true, provider: true },
  });
  if (!order || order.provider === "INFINITEPAY") {
    return { fulfilled: false, paymentTransactionId, reason: "ALREADY_FULFILLED_OR_NOT_APPROVED" } as const;
  }
  return prisma.$transaction(async (tx) => {
    await lockSubscriptionOwner(tx, order.userId);
    await tx.$queryRaw`SELECT id FROM "PaymentTransaction" WHERE id = ${paymentTransactionId} FOR UPDATE`;
    const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: paymentTransactionId } });
    return grantPaymentBenefit(tx, payment, new Date());
  }, { isolationLevel: "ReadCommitted" });
}
