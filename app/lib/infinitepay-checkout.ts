import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { canUseAccount } from "./account-security";
import {
  createInfinitePayLink, INFINITEPAY_PRODUCTS, infinitePayAppOrigin, infinitePayCredentials,
  isRecord, paymentReference,
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

  if (!order.payment) return { state: order.state };
  const payment = order.payment;
  const orderNsu = payment.externalReference;
  const now = new Date();
  if (payment.status !== "PENDING") return { state: "ORDER_CLOSED", orderNsu } as const;
  if (!payment.checkoutExpiresAt || payment.checkoutExpiresAt <= now) return { state: "EXPIRED", orderNsu } as const;
  const storedInput = payment.infinitePayCheckoutInput;
  if (!isRecord(storedInput) || storedInput.handle !== handle) return { state: "CHECKOUT_REVIEW", orderNsu } as const;
  if (payment.infinitePayCheckoutUrl) {
    return { state: "READY", orderNsu, checkoutUrl: payment.infinitePayCheckoutUrl } as const;
  }
  if (payment.checkoutAttempts > 0) {
    const state = payment.checkoutRetryAt && payment.checkoutRetryAt > now ? "CHECKOUT_PENDING" : "CHECKOUT_REVIEW";
    return { state, orderNsu } as const;
  }

  const claimed = await prisma.paymentTransaction.updateMany({
    where: {
      id: payment.id, status: "PENDING", infinitePayCheckoutUrl: null,
      checkoutAttempts: 0, checkoutExpiresAt: { gt: now },
    },
    data: { checkoutAttempts: { increment: 1 }, checkoutRetryAt: new Date(now.getTime() + ISSUANCE_WINDOW_MS) },
  });
  if (!claimed.count) return { state: "CHECKOUT_PENDING", orderNsu } as const;

  const link = await createInfinitePayLink(key, storedInput).catch(() => null);
  if (!link) return { state: "CHECKOUT_REVIEW", orderNsu } as const;
  const saved = await prisma.paymentTransaction.updateMany({
    where: { id: payment.id, status: "PENDING", checkoutAttempts: 1, infinitePayCheckoutUrl: null },
    data: { infinitePayCheckoutUrl: link.url, infinitePaySlug: link.slug, checkoutRetryAt: null },
  });
  if (!saved.count) return { state: "CHECKOUT_PENDING", orderNsu } as const;
  return { state: "READY", orderNsu, checkoutUrl: link.url } as const;
}
