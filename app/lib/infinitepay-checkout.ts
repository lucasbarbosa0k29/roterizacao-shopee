import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PaymentTransaction } from "@prisma/client";
import { prisma } from "./prisma";
import { canUseAccount } from "./account-security";
import {
  createInfinitePayLink, INFINITEPAY_PRODUCTS, infinitePayAppOrigin, infinitePayCredentials,
  InfinitePayError, isRecord, paymentReference,
} from "./infinitepay";
import { hasConflictingPaidCycle, lockSubscriptionOwner } from "./subscription-cycles";

const LINK_VALIDITY_MS = 60 * 60_000;
const ISSUANCE_WINDOW_MS = 30_000;

export function readCheckoutRequest(body: unknown, header: string | null) {
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "productType" && key !== "quantity")) return null;
  const productType = body.productType;
  if (productType !== "EXTRA_ROUTE" && productType !== "BASIC_PLAN" && productType !== "PRO_PLAN") return null;
  const quantity = body.quantity === undefined ? 1 : body.quantity;
  const idempotencyKey = paymentReference(header);
  const product = INFINITEPAY_PRODUCTS[productType];
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 ||
      quantity > product.maxQuantity || !idempotencyKey || idempotencyKey.length < 16) return null;
  return { productType, quantity, idempotencyKey } as const;
}

type CheckoutInput = NonNullable<ReturnType<typeof readCheckoutRequest>>;

export function logInfinitePayCheckoutFailure(
  stage: "order" | "provider" | "mark-review" | "save-link",
  error: unknown,
  startedAt: number,
  orderNsu?: string | null,
) {
  const code = error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code)
    ? error.code
    : error instanceof InfinitePayError && /^(HTTP_[1-5]\d{2}|TIMEOUT|COMMUNICATION_FAILURE|INVALID_RESPONSE|INVALID_LINK|APP_URL_INVALID|CONFIG_MISSING)$/.test(error.message)
      ? error.message
      : "UNEXPECTED";
  console.error("InfinitePay checkout", {
    stage,
    code,
    durationMs: Math.round(performance.now() - startedAt),
    orderTrace: orderNsu ? createHash("sha256").update(orderNsu).digest("hex").slice(0, 16) : undefined,
  });
}

const issuanceSelect = {
  externalReference: true, status: true, checkoutExpiresAt: true,
  infinitePayCheckoutUrl: true, checkoutAttempts: true, checkoutRetryAt: true,
} as const;

function readIssuanceState(payment: Pick<PaymentTransaction, keyof typeof issuanceSelect>, now: Date) {
  const orderNsu = payment.externalReference;
  if (payment.status !== "PENDING") return { state: "ORDER_CLOSED", orderNsu } as const;
  if (!payment.checkoutExpiresAt || payment.checkoutExpiresAt <= now) return { state: "EXPIRED", orderNsu } as const;
  if (payment.infinitePayCheckoutUrl) {
    return { state: "READY", orderNsu, checkoutUrl: payment.infinitePayCheckoutUrl } as const;
  }
  if (payment.checkoutRetryAt && payment.checkoutRetryAt > now) return { state: "CHECKOUT_PENDING", orderNsu } as const;
  return { state: "CHECKOUT_REVIEW", orderNsu } as const;
}

async function rereadIssuance(id: string, orderNsu: string | null) {
  const payment = await prisma.paymentTransaction.findUnique({ where: { id }, select: issuanceSelect });
  return payment ? readIssuanceState(payment, new Date()) : { state: "ORDER_CLOSED", orderNsu } as const;
}

async function markIssuanceForReview(where: Prisma.PaymentTransactionWhereInput, id: string, orderNsu: string | null) {
  const startedAt = performance.now();
  try {
    const marked = await prisma.paymentTransaction.updateMany({ where, data: { checkoutRetryAt: null } });
    if (!marked.count) return await rereadIssuance(id, orderNsu);
  } catch (error) {
    logInfinitePayCheckoutFailure("mark-review", error, startedAt, orderNsu);
  }
  return { state: "CHECKOUT_REVIEW", orderNsu } as const;
}

export async function startInfinitePayCheckout(userId: string, input: CheckoutInput) {
  const { key, handle } = infinitePayCredentials();
  const origin = infinitePayAppOrigin();
  const product = INFINITEPAY_PRODUCTS[input.productType];
  const order = await prisma.$transaction(async (tx) => {
    await lockSubscriptionOwner(tx, userId);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { active: true, emailVerificationRequired: true, emailVerifiedAt: true, accessBlockedAt: true },
    });
    if (!user || !canUseAccount(user) || user.accessBlockedAt) return { state: "UNAUTHORIZED" } as const;
    const intent = await tx.paymentCheckoutIntent.findUnique({
      where: { userId_key: { userId, key: input.idempotencyKey } },
      include: { paymentTransaction: true },
    });
    const existing = intent?.paymentTransaction ?? await tx.paymentTransaction.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      if (existing.provider !== "INFINITEPAY" || existing.productType !== input.productType ||
          existing.quantity !== input.quantity) return { state: "KEY_CONFLICT" } as const;
      return { payment: existing } as const;
    }

    const now = new Date();
    if (input.productType !== "EXTRA_ROUTE" && await hasConflictingPaidCycle(tx, userId, input.productType, now)) {
      return { state: "PLAN_CHANGE_REQUIRES_REVIEW" } as const;
    }
    const pending = await tx.paymentTransaction.findFirst({
      where: {
        userId, provider: "INFINITEPAY", productType: input.productType, quantity: input.quantity,
        amountCents: product.price * input.quantity, currency: "BRL",
        status: "PENDING", checkoutExpiresAt: { gt: now },
      },
      orderBy: { createdAt: "asc" },
    });
    if (pending) {
      await tx.paymentCheckoutIntent.create({
        data: { userId, key: input.idempotencyKey, paymentTransactionId: pending.id },
      });
      return { payment: pending } as const;
    }

    const externalReference = `rotta_${randomUUID()}`;
    const checkoutExpiresAt = new Date(now.getTime() + LINK_VALIDITY_MS);
    const checkoutInput = {
      handle,
      order_nsu: externalReference,
      items: [{ description: product.description, price: product.price, quantity: input.quantity }],
      redirect_url: `${origin}/api/payments/infinitepay/return`,
      webhook_url: `${origin}/api/webhooks/infinitepay`,
      options: {
        single_payment: true,
        valid_until: checkoutExpiresAt.toISOString(),
        require_delivery_address: false,
        payment_methods_enabled: ["credit_card", "pix"],
      },
    };
    const payment = await tx.paymentTransaction.create({
      data: {
        ...input, userId, provider: "INFINITEPAY", externalReference, checkoutExpiresAt,
        amountCents: product.price * input.quantity, infinitePayCheckoutInput: checkoutInput,
      },
    });
    return { payment } as const;
  }, { isolationLevel: "ReadCommitted" });

  if (!order.payment) return { state: order.state, orderNsu: undefined };
  const payment = order.payment;
  const orderNsu = payment.externalReference;
  const now = new Date();
  if (payment.status !== "PENDING") return { state: "ORDER_CLOSED", orderNsu } as const;
  if (!payment.checkoutExpiresAt || payment.checkoutExpiresAt <= now) return { state: "EXPIRED", orderNsu } as const;
  const storedInput = payment.infinitePayCheckoutInput;
  if (!isRecord(storedInput) || storedInput.handle !== handle) return { state: "CHECKOUT_REVIEW", orderNsu } as const;
  if (payment.infinitePayCheckoutUrl || payment.checkoutAttempts > 0) return readIssuanceState(payment, now);

  const claimed = await prisma.paymentTransaction.updateMany({
    where: {
      id: payment.id, status: "PENDING", infinitePayCheckoutUrl: null,
      checkoutAttempts: 0, checkoutExpiresAt: { gt: now },
    },
    data: { checkoutAttempts: { increment: 1 }, checkoutRetryAt: new Date(now.getTime() + ISSUANCE_WINDOW_MS) },
  });
  if (!claimed.count) return rereadIssuance(payment.id, orderNsu);

  const unissuedOrder = { id: payment.id, status: "PENDING", checkoutAttempts: 1, infinitePayCheckoutUrl: null } as const;
  const providerStartedAt = performance.now();
  let link: Awaited<ReturnType<typeof createInfinitePayLink>>;
  try {
    link = await createInfinitePayLink(key, storedInput);
  } catch (error) {
    logInfinitePayCheckoutFailure("provider", error, providerStartedAt, orderNsu);
    return markIssuanceForReview(unissuedOrder, payment.id, orderNsu);
  }

  const saveStartedAt = performance.now();
  try {
    const saved = await prisma.paymentTransaction.updateMany({
      where: unissuedOrder,
      data: { infinitePayCheckoutUrl: link.url, infinitePaySlug: link.slug, checkoutRetryAt: null },
    });
    if (!saved.count) return await rereadIssuance(payment.id, orderNsu);
  } catch (error) {
    // The provider may already have created a payable link. Keep the durable
    // attempt so a database failure never becomes another call to /links.
    logInfinitePayCheckoutFailure("save-link", error, saveStartedAt, orderNsu);
    return markIssuanceForReview(unissuedOrder, payment.id, orderNsu);
  }
  return { state: "READY", orderNsu, checkoutUrl: link.url } as const;
}
