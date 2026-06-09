import { Prisma, type PaymentProductType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

const MAX_FULFILLMENT_ATTEMPTS = 3;

type FulfillmentResult =
  | {
      fulfilled: true;
      paymentTransactionId: string;
      productType: PaymentProductType;
      fulfilledSourceId: string;
    }
  | {
      fulfilled: false;
      paymentTransactionId: string;
      reason: "ALREADY_FULFILLED_OR_NOT_APPROVED";
    };

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function getPlanCode(productType: PaymentProductType) {
  switch (productType) {
    case "BASIC_PLAN":
      return "BASIC";
    case "PRO_PLAN":
      return "PRO";
    default:
      return null;
  }
}

function isSerializableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function fulfillApprovedPaymentTransactionOnce(
  paymentTransactionId: string
): Promise<FulfillmentResult> {
  return prisma.$transaction(
    async (tx) => {
      const now = new Date();

      const claimed = await tx.paymentTransaction.updateMany({
        where: {
          id: paymentTransactionId,
          status: "APPROVED",
          fulfilledAt: null,
        },
        data: {
          fulfilledAt: now,
        },
      });

      if (claimed.count === 0) {
        return {
          fulfilled: false,
          paymentTransactionId,
          reason: "ALREADY_FULFILLED_OR_NOT_APPROVED",
        };
      }

      const transaction = await tx.paymentTransaction.findUnique({
        where: { id: paymentTransactionId },
        select: {
          id: true,
          userId: true,
          productType: true,
          quantity: true,
          mercadoPagoPaymentId: true,
          externalReference: true,
        },
      });

      if (!transaction) {
        throw new Error(`PaymentTransaction not found after claim: ${paymentTransactionId}`);
      }

      if (transaction.productType === "EXTRA_ROUTE") {
        const routeCredit = await tx.routeCredit.create({
          data: {
            userId: transaction.userId,
            delta: transaction.quantity,
            reason: "MANUAL_PAYMENT",
            notes: [
              `Mercado Pago payment ${transaction.mercadoPagoPaymentId ?? "unknown"}`,
              `PaymentTransaction ${transaction.id}`,
              `External reference ${transaction.externalReference}`,
            ].join(" | "),
          },
          select: { id: true },
        });

        await tx.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            fulfilledSourceId: routeCredit.id,
          },
        });

        return {
          fulfilled: true,
          paymentTransactionId: transaction.id,
          productType: transaction.productType,
          fulfilledSourceId: routeCredit.id,
        };
      }

      const planCode = getPlanCode(transaction.productType);
      if (!planCode) {
        throw new Error(`Unsupported payment product type: ${transaction.productType}`);
      }

      const plan = await tx.subscriptionPlan.findFirst({
        where: {
          code: planCode,
          isActive: true,
        },
        select: {
          id: true,
          code: true,
          durationDays: true,
        },
      });

      if (!plan || !plan.durationDays || plan.durationDays <= 0) {
        throw new Error(`Active subscription plan with duration not found: ${planCode}`);
      }

      await tx.userSubscription.updateMany({
        where: {
          userId: transaction.userId,
          status: "ACTIVE",
        },
        data: {
          status: "REVOKED",
        },
      });

      const startsAt = now;
      const expiresAt = addDays(startsAt, plan.durationDays);

      const subscription = await tx.userSubscription.create({
        data: {
          userId: transaction.userId,
          planId: plan.id,
          status: "ACTIVE",
          source: "MANUAL_PAYMENT",
          startsAt,
          expiresAt,
          notes: [
            `Mercado Pago payment ${transaction.mercadoPagoPaymentId ?? "unknown"}`,
            `PaymentTransaction ${transaction.id}`,
            `External reference ${transaction.externalReference}`,
          ].join(" | "),
        },
        select: { id: true },
      });

      await tx.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          fulfilledSourceId: subscription.id,
        },
      });

      return {
        fulfilled: true,
        paymentTransactionId: transaction.id,
        productType: transaction.productType,
        fulfilledSourceId: subscription.id,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function fulfillApprovedPaymentTransaction(
  paymentTransactionId: string
): Promise<FulfillmentResult> {
  for (let attempt = 1; attempt <= MAX_FULFILLMENT_ATTEMPTS; attempt += 1) {
    try {
      return await fulfillApprovedPaymentTransactionOnce(paymentTransactionId);
    } catch (error) {
      if (
        isSerializableTransactionError(error) &&
        attempt < MAX_FULFILLMENT_ATTEMPTS
      ) {
        continue;
      }

      throw error;
    }
  }

  return {
    fulfilled: false,
    paymentTransactionId,
    reason: "ALREADY_FULFILLED_OR_NOT_APPROVED",
  };
}
