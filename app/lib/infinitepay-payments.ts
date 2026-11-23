import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { checkInfinitePayPayment, INFINITEPAY_PRODUCTS, infinitePayCredentials, InfinitePayError, isRecord, paymentReference } from "./infinitepay";
import { grantPaymentBenefit } from "./payment-fulfillment";
import { lockSubscriptionOwner } from "./subscription-cycles";

const MAX_CHECKS = 12;
const CLAIM_MS = 45_000;
type SignalKind = "confirm" | "refunded" | "chargeback";

export function readInfinitePaySignal(data: unknown, source: "webhook" | "return" | "admin") {
  if (!isRecord(data)) return null;
  const kind: SignalKind = data.event === "refunded" || data.event === "chargeback" ? data.event : "confirm";
  if ((source === "return" && kind !== "confirm") ||
      (source === "webhook" && kind === "confirm" && data.event != null && data.event !== "paid") ||
      (source === "admin" && data.event != null && data.event !== "paid" && kind === "confirm")) return null;
  const orderNsu = paymentReference(data.order_nsu);
  const transactionNsu = paymentReference(data.transaction_nsu);
  const slug = paymentReference(source === "webhook" ? data.invoice_slug : data.slug);
  return orderNsu && transactionNsu && slug ? { orderNsu, transactionNsu, slug, kind } : null;
}

type Signal = NonNullable<ReturnType<typeof readInfinitePaySignal>>;

export async function recordInfinitePaySignal(signal: Signal, userId?: string) {
  const payment = await prisma.paymentTransaction.findUnique({ where: { externalReference: signal.orderNsu } });
  if (!payment || payment.provider !== "INFINITEPAY" || (userId && payment.userId !== userId)) return null;
  const identity = {
    paymentTransactionId: payment.id, kind: signal.kind, slug: signal.slug, transactionNsu: signal.transactionNsu,
  };
  // Reversal notices never update the payment or revoke a benefit.
  await prisma.paymentEvent.createMany({
    data: {
      ...identity, status: signal.kind === "confirm" ? "PENDING" : "REVIEW",
      lastError: signal.kind === "confirm" ? null : "UNVERIFIED_REVERSAL",
      nextAttemptAt: new Date(),
    },
    skipDuplicates: true,
  });
  const event = await prisma.paymentEvent.findUnique({
    where: { paymentTransactionId_kind_slug_transactionNsu: identity },
    select: { id: true },
  });
  return event?.id ?? null;
}

export async function processInfinitePayEvent(id: string) {
  const now = new Date();
  const event = await prisma.paymentEvent.findUnique({
    where: { id },
    include: { paymentTransaction: true },
  });
  if (!event || event.kind !== "confirm" || event.status !== "PENDING" || event.nextAttemptAt > now ||
      event.paymentTransaction.provider !== "INFINITEPAY") return;
  const leaseUntil = new Date(now.getTime() + CLAIM_MS);
  const pointer = { id, attempts: event.attempts + 1, status: "PENDING" as const, nextAttemptAt: leaseUntil };
  const claim = await prisma.paymentEvent.updateMany({
    where: { id, attempts: event.attempts, status: "PENDING", nextAttemptAt: { lte: now } },
    data: { attempts: { increment: 1 }, nextAttemptAt: leaseUntil },
  });
  if (!claim.count) return;

  async function finish(status: "PENDING" | "REVIEW" | "PROCESSED", reason: string | null) {
    const backoff = Math.min(60 * 60_000, 15_000 * 2 ** Math.min(pointer.attempts, MAX_CHECKS));
    await prisma.paymentEvent.updateMany({
      where: pointer,
      data: { status, lastError: reason, nextAttemptAt: new Date(Date.now() + backoff) },
    });
  }

  try {
    const order = event.paymentTransaction;
    if (event.attempts >= MAX_CHECKS) return await finish("REVIEW", "RETRY_LIMIT");
    if (order.fulfilledAt && order.infinitePayTransactionId === event.transactionNsu &&
        order.infinitePaySlug === event.slug) return await finish("PROCESSED", null);
    if (!order.checkoutAttempts || !isRecord(order.infinitePayCheckoutInput)) {
      return await finish("REVIEW", "CHECKOUT_NOT_ISSUED");
    }
    if (order.infinitePayCheckoutInput.handle !== infinitePayCredentials().handle) {
      return await finish("REVIEW", "MERCHANT_MISMATCH");
    }
    const checked = await checkInfinitePayPayment({
      orderNsu: order.externalReference, slug: event.slug, transactionNsu: event.transactionNsu,
    });
    if (!checked.paid) return await finish("PENDING", "PAYMENT_NOT_CONFIRMED");
    const product = INFINITEPAY_PRODUCTS[order.productType];
    if (order.currency !== "BRL" || order.quantity < 1 || order.quantity > product.maxQuantity ||
        order.amountCents !== product.price * order.quantity || checked.amount !== order.amountCents ||
        checked.paidAmount < checked.amount) {
      return await finish("REVIEW", "AMOUNT_OR_PRODUCT_MISMATCH");
    }

    await prisma.$transaction(async (tx) => {
      await lockSubscriptionOwner(tx, order.userId);
      const claimed = await tx.paymentEvent.updateMany({
        where: pointer, data: { nextAttemptAt: new Date(Date.now() + CLAIM_MS) },
      });
      if (!claimed.count) return;
      const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: order.id } });
      const review = payment.infinitePayTransactionId && payment.infinitePayTransactionId !== event.transactionNsu
        ? "CONFIRMED_DUPLICATE_CAPTURE"
        : payment.infinitePaySlug && payment.infinitePaySlug !== event.slug
          ? "CONFIRMED_OTHER_LINK"
          : !["PENDING", "APPROVED", "EXPIRED"].includes(payment.status)
            ? "ORDER_STATUS_REQUIRES_REVIEW" : null;
      if (review || payment.fulfilledAt || payment.fulfillmentReviewReason) {
        const reason = review ?? payment.fulfillmentReviewReason;
        await tx.paymentEvent.update({
          where: { id }, data: { status: reason ? "REVIEW" : "PROCESSED", lastError: reason },
        });
        return;
      }

      const approvedAt = new Date();
      const approved = await tx.paymentTransaction.update({
        where: { id: order.id },
        data: {
          status: "APPROVED", approvedAt: payment.approvedAt ?? approvedAt,
          infinitePayTransactionId: event.transactionNsu, infinitePaySlug: event.slug,
          paidAmountCents: checked.paidAmount,
        },
      });
      const result = await grantPaymentBenefit(tx, approved, approvedAt);
      await tx.paymentEvent.update({
        where: { id },
        data: { status: result.fulfilled ? "PROCESSED" : "REVIEW", lastError: result.fulfilled ? null : result.reason },
      });
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" &&
        String(error.meta?.target).includes("infinitePayTransactionId")) {
      return await finish("REVIEW", "CAPTURE_ALREADY_BOUND");
    }
    const reason = error instanceof InfinitePayError ? error.message : "PROCESSING_FAILURE";
    await finish(pointer.attempts >= MAX_CHECKS ? "REVIEW" : "PENDING", reason);
  }
}

export async function reconcileInfinitePayEvents() {
  const events = await prisma.paymentEvent.findMany({
    where: { kind: "confirm", status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: 8,
    select: { id: true },
  });
  await Promise.all(events.map(({ id }) => processInfinitePayEvent(id)));
  return events.length;
}

export async function retryInfinitePayEvent(id: string) {
  const updated = await prisma.paymentEvent.updateMany({
    where: {
      id, kind: "confirm", status: "REVIEW", paymentTransaction: { provider: "INFINITEPAY" },
      OR: [
        { lastError: { in: ["RETRY_LIMIT", "COMMUNICATION_FAILURE", "PROCESSING_FAILURE", "PAYMENT_NOT_CONFIRMED", "CONFIG_MISSING"] } },
        { lastError: { startsWith: "HTTP_" } },
      ],
    },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (!updated.count) return false;
  await processInfinitePayEvent(id);
  return true;
}

export async function getInfinitePayOrderStatus(userId: string, orderNsu: string) {
  const order = await prisma.paymentTransaction.findFirst({
    where: { userId, externalReference: orderNsu, provider: "INFINITEPAY" },
    select: {
      status: true, fulfilledAt: true, fulfillmentReviewReason: true, checkoutExpiresAt: true,
      checkoutAttempts: true, checkoutRetryAt: true, infinitePayCheckoutUrl: true,
    },
  });
  if (!order) return null;
  if (order.status === "REFUNDED") return "REFUNDED";
  if (order.fulfilledAt) return "COMPLETED";
  if (order.status === "APPROVED" && order.fulfillmentReviewReason) return "REVIEW";
  if (order.status !== "PENDING") return order.status;
  const now = new Date();
  if (order.checkoutExpiresAt && order.checkoutExpiresAt <= now) return "EXPIRED";
  if (!order.infinitePayCheckoutUrl && order.checkoutAttempts > 0) {
    return order.checkoutRetryAt && order.checkoutRetryAt > now ? "CHECKOUT_PENDING" : "CHECKOUT_REVIEW";
  }
  return "PENDING";
}
