import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { Prisma, PrismaClient, type PaymentProductType } from "@prisma/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(databaseUrl && databaseUrl === process.env.DATABASE_URL && process.env.TEST_DB_RUN_ID);
const database = new URL(databaseUrl);
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, `/rotta_auth_test_${process.env.TEST_DB_RUN_ID}`);

process.env.INFINITEPAY_API_KEY = "synthetic-infinitepay-key";
process.env.INFINITEPAY_HANDLE = "rotta_test";
process.env.INFINITEPAY_APP_URL = "https://rotta.example.test";
process.env.MERCADOPAGO_ACCESS_TOKEN = "synthetic-mercadopago-key";
delete process.env.INFINITEPAY_CHECKOUT_ENABLED;

const products = { EXTRA_ROUTE: 199, BASIC_PLAN: 3999, PRO_PLAN: 6999 };
const issued = new Map<string, { items: Array<{ price: number; quantity: number }>; options: Record<string, unknown> }>();
const overrides = new Map<string, { paid?: boolean; amount?: number; paidAmount?: number; failure?: boolean }>();
const mercadoPagoPayments = new Map<string, { id: string; status: string; external_reference: string }>();
const requests: Array<{ path: string; order: string; body: string }> = [];
let failNextLink = false;
let nextLinkResponse: (() => Response) | undefined;
let checkoutWriteFailure: "save" | "save-and-mark" | null = null;
const failureClient = new PrismaClient({ log: [] }).$extends({
  query: {
    paymentTransaction: {
      async updateMany({ args, query }) {
        const isSave = typeof args.data.infinitePayCheckoutUrl === "string";
        const isMark = args.data.checkoutRetryAt === null;
        if (checkoutWriteFailure && (isSave || (checkoutWriteFailure === "save-and-mark" && isMark))) {
          throw new Prisma.PrismaClientKnownRequestError("secret connection data", { code: "P2024", clientVersion: "test" });
        }
        return query(args);
      },
    },
  },
});
Reflect.set(globalThis, "prisma", failureClient);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const path = String(url);
  const mercadoPago = mercadoPagoPayments.get(path);
  if (mercadoPago) {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-mercadopago-key");
    return Response.json(mercadoPago);
  }
  assert.equal(new Headers(init?.headers).get("X-Api-Key"), "synthetic-infinitepay-key");
  assert.equal(init?.method, "POST");
  const input = JSON.parse(String(init?.body));
  requests.push({ path, order: input.order_nsu, body: String(init?.body) });
  if (path === "https://api.checkout.infinitepay.io/links") {
    assert.equal(input.handle, "rotta_test");
    assert.equal(input.webhook_url, "https://rotta.example.test/api/webhooks/infinitepay");
    assert.equal(input.redirect_url, "https://rotta.example.test/api/payments/infinitepay/return");
    issued.set(input.order_nsu, input);
    if (failNextLink) {
      failNextLink = false;
      throw new Error("simulated lost response after the gateway received the order");
    }
    if (nextLinkResponse) {
      const respond = nextLinkResponse;
      nextLinkResponse = undefined;
      return respond();
    }
    return Response.json({ url: `https://checkout.infinitepay.com.br/pay/${input.order_nsu}`, slug: input.order_nsu });
  }
  assert.equal(path, "https://api.checkout.infinitepay.io/payment_check");
  assert.equal(input.handle, "rotta_test");
  assert.equal(input.slug, input.order_nsu);
  const checkout = issued.get(input.order_nsu);
  assert.ok(checkout && input.transaction_nsu);
  const override = overrides.get(input.order_nsu);
  if (override?.failure) return new Response(null, { status: 503 });
  const item = checkout.items[0];
  const amount = override?.amount ?? item.price * item.quantity;
  return Response.json({ success: true, paid: override?.paid ?? true, amount, paid_amount: override?.paidAmount ?? amount + 10 });
};

const DAY = 86_400_000;
type Services = Awaited<ReturnType<typeof importServices>>;
let services: Services;

async function importServices() {
  const { prisma } = await import("../app/lib/prisma");
  const checkout = await import("../app/lib/infinitepay-checkout");
  const payments = await import("../app/lib/infinitepay-payments");
  const access = await import("../app/lib/access-control");
  const legacy = await import("../app/lib/payment-fulfillment");
  const cycles = await import("../app/lib/subscription-cycles");
  const review = await import("../app/lib/payment-review");
  const refunds = await import("../app/lib/infinitepay-refund");
  return { prisma, ...checkout, ...payments, ...access, ...legacy, ...cycles, ...review, ...refunds };
}

before(async () => {
  services = await importServices();
  for (const [code, dailyRouteLimit] of [["BASIC", 1], ["PRO", 2]] as const) {
    const fields = { name: code, durationDays: 30, dailyRouteLimit, isActive: true };
    await services.prisma.subscriptionPlan.upsert({ where: { code }, update: fields, create: { code, ...fields } });
  }
});

test("Mercado Pago confirms and grants legacy credits once with the rollout disabled", async () => {
  const user = await account();
  const orderNsu = randomUUID();
  const capture = "1700000001";
  await services.prisma.paymentTransaction.create({
    data: { userId: user.id, provider: "MERCADOPAGO", productType: "EXTRA_ROUTE", amountCents: 199,
      externalReference: orderNsu },
  });
  mercadoPagoPayments.set(`https://api.mercadopago.com/v1/payments/${capture}`, {
    id: capture, status: "approved", external_reference: orderNsu,
  });
  const { POST } = await import("../app/api/webhooks/mercadopago/route");
  const notification = () => POST(new Request("https://rotta.example.test/api/webhooks/mercadopago", {
    method: "POST", body: JSON.stringify({ type: "payment", data: { id: capture } }),
  }));
  const responses = await Promise.all([notification(), notification()]);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal((await payment(orderNsu)).mercadoPagoPaymentId, capture);
  assert.equal(await services.prisma.routeCredit.count({ where: { userId: user.id } }), 1);
});

after(async () => {
  globalThis.fetch = originalFetch;
  await services?.prisma.$disconnect();
});

async function account() {
  return services.prisma.user.create({
    data: { email: `${randomUUID()}@infinitepay.example.test`, password: "fixture", emailVerificationRequired: false },
  });
}

async function checkout(userId: string, productType: PaymentProductType, quantity = 1, key = randomUUID()) {
  const input = services.readCheckoutRequest({ productType, quantity }, key);
  assert.ok(input);
  const result = await services.startInfinitePayCheckout(userId, input);
  assert.equal(result.state, "READY");
  return result.orderNsu;
}

function webhook(orderNsu: string, transactionNsu: string = randomUUID(), event?: string) {
  const signal = services.readInfinitePaySignal({ order_nsu: orderNsu, transaction_nsu: transactionNsu, invoice_slug: orderNsu, event }, "webhook");
  assert.ok(signal);
  return signal;
}

async function confirm(orderNsu: string, transactionNsu?: string) {
  const eventId = await services.recordInfinitePaySignal(webhook(orderNsu, transactionNsu));
  assert.ok(eventId);
  await services.processInfinitePayEvent(eventId);
  return eventId;
}

function payment(orderNsu: string) {
  return services.prisma.paymentTransaction.findUniqueOrThrow({
    where: { externalReference: orderNsu }, include: { routeCredit: true, subscription: true },
  });
}

function event(id: string) {
  return services.prisma.paymentEvent.findUniqueOrThrow({ where: { id } });
}

async function existingCycle(userId: string, code: "BASIC" | "PRO", startsAt: Date, expiresAt: Date, status: "ACTIVE" | "SCHEDULED" = "ACTIVE") {
  return services.prisma.userSubscription.create({
    data: { user: { connect: { id: userId } }, plan: { connect: { code } }, source: "MANUAL_PAYMENT", startsAt, expiresAt, status },
  });
}

for (const [product, price] of Object.entries(products) as Array<[PaymentProductType, number]>) {
  test(`charges ${product} at ${price} cents and grants exactly its benefit`, async () => {
    const user = await account();
    const order = await checkout(user.id, product);
    assert.equal(issued.get(order)?.items[0].price, price);
    assert.equal(issued.get(order)?.options.assured_installments, 1);
    assert.equal(issued.get(order)?.options.single_payment, true);
    assert.deepEqual(issued.get(order)?.options.payment_methods_enabled, ["credit_card", "pix"]);
    await confirm(order);
    const paid = await payment(order);
    assert.equal(paid.status, "APPROVED");
    assert.equal(paid.paidAmountCents, price + 10);
    assert.ok(paid.fulfilledAt);
    if (product === "EXTRA_ROUTE") {
      assert.equal(paid.routeCredit?.delta, 1);
    } else {
      assert.ok(paid.subscription?.expiresAt);
      assert.equal(paid.subscription.status, "ACTIVE");
      assert.equal(paid.subscription.expiresAt.getTime() - paid.subscription.startsAt.getTime(), 30 * DAY);
      const access = await services.getUserAccessSnapshot(user.id);
      assert.equal(access.subscriptionCycleRemaining, product === "BASIC_PLAN" ? 1 : 2);
    }
  });
}

test("an existing order keeps its original checkout options and reuses the issued link", async () => {
  const user = await account();
  const idempotencyKey = randomUUID();
  const orderNsu = randomUUID();
  const checkoutExpiresAt = new Date(Date.now() + 60 * 60_000);
  const originalInput = {
    handle: "rotta_test",
    order_nsu: orderNsu,
    items: [{ description: "Rotta - Rota avulsa", quantity: 1, price: 199 }],
    redirect_url: "https://rotta.example.test/api/payments/infinitepay/return",
    webhook_url: "https://rotta.example.test/api/webhooks/infinitepay",
    options: {
      single_payment: true,
      valid_until: checkoutExpiresAt.toISOString(),
      require_delivery_address: false,
      payment_methods_enabled: ["credit_card", "pix"],
    },
  };
  await services.prisma.paymentTransaction.create({
    data: {
      userId: user.id, provider: "INFINITEPAY", productType: "EXTRA_ROUTE", quantity: 1,
      amountCents: 199, externalReference: orderNsu, idempotencyKey, checkoutExpiresAt,
      infinitePayCheckoutInput: originalInput,
    },
  });

  assert.equal(await checkout(user.id, "EXTRA_ROUTE", 1, idempotencyKey), orderNsu);
  const stored = await payment(orderNsu);
  assert.deepEqual(stored.infinitePayCheckoutInput, originalInput);
  const replay = await services.startInfinitePayCheckout(user.id, {
    productType: "EXTRA_ROUTE", quantity: 1, idempotencyKey: randomUUID(),
  });
  assert.deepEqual(replay, { state: "READY", orderNsu, checkoutUrl: stored.infinitePayCheckoutUrl });
  const linkCalls = requests.filter((request) => request.order === orderNsu && request.path.endsWith("/links"));
  assert.equal(linkCalls.length, 1);
  assert.deepEqual(JSON.parse(linkCalls[0].body), originalInput);
});

for (const code of ["BASIC", "PRO"] as const) {
  test(`early ${code} renewal preserves accrued credits and switches at the exact boundary`, async () => {
    const user = await account();
    const end = new Date(Date.now() + 22 * DAY);
    const active = await existingCycle(user.id, code, new Date(end.getTime() - 30 * DAY), end);
    await services.prisma.routeUsage.create({
      data: { userId: user.id, subscriptionId: active.id, source: "SUBSCRIPTION_DAILY", usageDayKey: "2026-11-01" },
    });
    await services.prisma.routeCredit.create({ data: { userId: user.id, reason: "PROMOTIONAL", delta: 7 } });
    const observed = new Date();
    const before = await services.getUserAccessSnapshot(user.id, observed);
    const order = await checkout(user.id, code === "BASIC" ? "BASIC_PLAN" : "PRO_PLAN");
    const id = await confirm(order);
    const renewed = (await payment(order)).subscription;
    assert.ok(renewed, `Expected a renewal, event: ${JSON.stringify(await event(id))}`);
    assert.equal(renewed.status, "SCHEDULED");
    assert.deepEqual(renewed.startsAt, active.expiresAt);
    assert.deepEqual(await services.prisma.userSubscription.findUnique({ where: { id: active.id } }), active);
    const after = await services.getUserAccessSnapshot(user.id, observed);
    assert.equal(after.activeSubscription?.id, active.id);
    assert.equal(after.subscriptionCycleRemaining, before.subscriptionCycleRemaining);
    assert.equal(after.routeCreditsBalance, 7);
    assert.deepEqual(after.scheduledSubscriptions.map(({ id }) => id), [renewed.id]);
    await assert.rejects(
      services.prisma.$transaction((tx) => services.guardAdminCycleChange(tx, user.id)),
      services.ScheduledRenewalError
    );
    const beforeBoundary = await services.getUserAccessSnapshot(user.id, new Date(end.getTime() - 1));
    assert.equal(beforeBoundary.activeSubscription?.id, active.id);
    assert.ok(beforeBoundary.subscriptionCycleRemaining > 0);
    const boundary = await services.getUserAccessSnapshot(user.id, end);
    assert.equal(boundary.activeSubscription?.id, renewed.id);
    assert.equal(boundary.activeSubscription?.status, "ACTIVE");
    assert.equal(boundary.subscriptionCycleUsed, 0);
    assert.equal(boundary.subscriptionCycleRemaining, code === "BASIC" ? 1 : 2);
    assert.equal(boundary.scheduledSubscriptions.length, 0);
    assert.equal(boundary.routeCreditsBalance, 7);
    assert.equal((await services.getUserAccessSnapshot(user.id, renewed.expiresAt!)).activeSubscription, null);
  });
}

test("multiple paid renewals enqueue contiguous cycles without losing the current plan", async () => {
  const user = await account();
  const current = await existingCycle(user.id, "BASIC", new Date(Date.now() - DAY), new Date(Date.now() + 29 * DAY));
  for (let count = 0; count < 4; count++) {
    await confirm(await checkout(user.id, "BASIC_PLAN"));
  }
  const cycles = await services.prisma.userSubscription.findMany({ where: { userId: user.id }, orderBy: { startsAt: "asc" } });
  assert.equal(cycles.length, 5);
  assert.deepEqual(cycles[0], current);
  assert.equal(new Set(cycles.slice(1).map((cycle) => cycle.paymentTransactionId)).size, 4);
  for (let index = 1; index < cycles.length; index++) {
    assert.deepEqual(cycles[index].startsAt, cycles[index - 1].expiresAt);
    assert.equal(cycles[index].status, "SCHEDULED");
  }
});

test("expired plans start anew and neither legacy future ACTIVE nor SCHEDULED grants early access", async () => {
  const expiredUser = await account();
  await existingCycle(expiredUser.id, "BASIC", new Date(Date.now() - 31 * DAY), new Date(Date.now() - DAY));
  assert.equal((await services.getUserAccessSnapshot(expiredUser.id)).canStartRoute, false);
  const order = await checkout(expiredUser.id, "PRO_PLAN");
  await confirm(order);
  assert.equal((await payment(order)).subscription?.status, "ACTIVE");
  const futureUser = await account();
  const start = new Date(Date.now() + DAY);
  for (const status of ["ACTIVE", "SCHEDULED"] as const) {
    await existingCycle(futureUser.id, "BASIC", start, new Date(start.getTime() + DAY), status);
  }
  const access = await services.getUserAccessSnapshot(futureUser.id);
  assert.equal(access.activeSubscription, null);
  assert.equal(access.canStartRoute, false);
  assert.equal(access.scheduledSubscriptions.length, 1);
  const job = await services.prisma.importJob.create({ data: { userId: futureUser.id } });
  await assert.rejects(
    services.consumeRouteAllowance({ userId: futureUser.id, jobId: job.id, role: "USER" }),
    { code: "NO_ACTIVE_SUBSCRIPTION" }
  );
  const due = await existingCycle(futureUser.id, "BASIC", new Date(Date.now() - 1000), start, "SCHEDULED");
  const consumed = await services.consumeRouteAllowance({ userId: futureUser.id, jobId: job.id, role: "USER" });
  assert.equal(consumed.source, "SUBSCRIPTION_DAILY");
  assert.equal(consumed.subscriptionId, due.id);
});

test("São Paulo midnight accrues quota independently of UTC midnight", async () => {
  const user = await account();
  const start = new Date("2026-11-08T02:00:00Z");
  await existingCycle(user.id, "BASIC", start, new Date(start.getTime() + 30 * DAY));
  assert.equal((await services.getUserAccessSnapshot(user.id, new Date("2026-11-08T02:59:59.999Z"))).subscriptionCycleRemaining, 1);
  assert.equal((await services.getUserAccessSnapshot(user.id, new Date("2026-11-08T03:00:00Z"))).subscriptionCycleRemaining, 2);
});

test("checkout idempotency, server pricing and cross-owner status protection", async () => {
  const user = await account();
  const other = await account();
  const key = randomUUID();
  assert.equal(services.readCheckoutRequest({ productType: "EXTRA_ROUTE", price: 1 }, key), null);
  assert.equal(services.readCheckoutRequest({ productType: "EXTRA_ROUTE", quantity: 101 }, key), null);
  assert.equal(services.readCheckoutRequest({ productType: "BASIC_PLAN", quantity: 2 }, key), null);
  const input = services.readCheckoutRequest({ productType: "EXTRA_ROUTE", quantity: 100 }, key)!;
  const deviceInputs = Array.from({ length: 4 }, () => ({ ...input, idempotencyKey: randomUUID() }));
  const results = await Promise.all([input, input, ...deviceInputs].map((attempt) =>
    services.startInfinitePayCheckout(user.id, attempt)));
  const order = results[0].orderNsu!;
  assert.ok(results.every((result) => result.orderNsu === order));
  assert.equal(requests.filter((request) => request.order === order).length, 1);
  assert.equal((await payment(order)).amountCents, 19_900);
  const otherDevices = await Promise.all(deviceInputs.map((attempt) => services.startInfinitePayCheckout(user.id, attempt)));
  assert.ok(otherDevices.every((result) => result.orderNsu === order && result.state === "READY"));
  await confirm(order);
  const replay = await services.startInfinitePayCheckout(user.id, deviceInputs[0]);
  assert.equal(replay.orderNsu, order);
  assert.equal(replay.state, "ORDER_CLOSED");
  assert.equal(requests.filter(({ order: ref, path }) => ref === order && path.endsWith("/links")).length, 1);
  assert.equal((await services.startInfinitePayCheckout(user.id, { ...input, quantity: 1 })).state, "KEY_CONFLICT");
  assert.equal(await services.getInfinitePayOrderStatus(other.id, order), null);
  assert.equal(await services.recordInfinitePaySignal(webhook(order), other.id), null);
  const route = await import("../app/api/payments/infinitepay/checkout/route");
  assert.equal((await route.POST(new Request("https://rotta.example.test", { method: "POST" }))).status, 503);
});

test("a checkout on the .io host is saved and reused, with confirmation via the existing webhook", async () => {
  const user = await account();
  const input = services.readCheckoutRequest({ productType: "EXTRA_ROUTE", quantity: 10 }, randomUUID())!;
  const link = "https://checkout.infinitepay.io/synthetic-payment";
  nextLinkResponse = () => Response.json({ url: link }, { status: 201 });

  const first = await services.startInfinitePayCheckout(user.id, input);
  assert.equal(first.state, "READY");
  const orderNsu = first.orderNsu!;
  const original = await payment(orderNsu);
  assert.equal(original.infinitePayCheckoutUrl, link);
  assert.equal(original.infinitePaySlug, null);
  assert.equal(original.amountCents, 1990);
  const replay = await services.startInfinitePayCheckout(user.id, { ...input, idempotencyKey: randomUUID() });
  assert.deepEqual(replay, { state: "READY", orderNsu, checkoutUrl: link });
  assert.equal(requests.filter((request) => request.order === orderNsu && request.path.endsWith("/links")).length, 1);

  const capture = randomUUID();
  await confirm(orderNsu, capture);
  await confirm(orderNsu, capture);
  assert.equal((await payment(orderNsu)).routeCredit?.delta, 10);
  assert.equal(await services.prisma.routeCredit.count({ where: { userId: user.id } }), 1);
});

test("a second independently confirmed capture requires refund review and never grants twice", async () => {
  const user = await account();
  const admin = await account();
  const orderNsu = await checkout(user.id, "EXTRA_ROUTE");
  const primary = randomUUID();
  await confirm(orderNsu, primary);
  const captureReference = randomUUID();
  const eventId = await confirm(orderNsu, captureReference);
  assert.equal((await event(eventId)).lastError, "CONFIRMED_DUPLICATE_CAPTURE");
  const review = { action: "record-duplicate-refund", orderNsu, captureReference, eventId, evidence: "REFUND-21", amountCents: 199 } as const;
  assert.equal(await services.resolvePaymentReview(admin.id, { ...review, captureReference: primary }), null);
  assert.deepEqual(await services.resolvePaymentReview(admin.id, review), { resolved: true });
  assert.equal(await services.resolvePaymentReview(admin.id, review), null);
  assert.equal((await payment(orderNsu)).infinitePayTransactionId, primary);
  assert.equal((await payment(orderNsu)).status, "APPROVED");
  assert.equal(await services.prisma.routeCredit.count({ where: { userId: user.id } }), 1);
  assert.equal(await services.prisma.adminAccessLog.count({ where: { adminId: admin.id, targetUserId: user.id } }), 1);
});

test("an approved legacy hold can be recovered without replacing an existing cycle or delivering twice", async () => {
  const user = await account();
  const admin = await account();
  const plan = await existingCycle(user.id, "BASIC", new Date(Date.now() - DAY), new Date(Date.now() + DAY));
  const orderNsu = randomUUID();
  const captureReference = randomUUID();
  const held = await services.prisma.paymentTransaction.create({
    data: { userId: user.id, externalReference: orderNsu, asaasPaymentId: captureReference,
      productType: "PRO_PLAN", provider: "ASAAS", amountCents: 6999, status: "APPROVED",
      approvedAt: new Date() },
  });
  const review = { action: "retry-benefit", orderNsu, captureReference, evidence: "RECEIPT-22", eventId: null, amountCents: 6999 } as const;
  assert.equal(await services.resolvePaymentReview(admin.id, { ...review, amountCents: 3999 }), null);
  assert.equal((await services.resolvePaymentReview(admin.id, review))?.resolved, false);
  assert.equal((await payment(orderNsu)).fulfillmentReviewReason, "PLAN_CHANGE_REQUIRES_REVIEW");
  assert.deepEqual(await services.prisma.userSubscription.findUnique({ where: { id: plan.id } }), plan);
  // Simulate reaching the previous cycle's natural expiry.
  await services.prisma.userSubscription.update({ where: { id: plan.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  const results = await Promise.all([services.resolvePaymentReview(admin.id, review), services.resolvePaymentReview(admin.id, review)]);
  assert.equal(results.filter(result => result?.resolved).length, 1);
  assert.equal(await services.prisma.userSubscription.count({ where: { paymentTransactionId: held.id } }), 1);
  assert.equal((await payment(orderNsu)).subscription?.status, "ACTIVE");
});

test("webhook and browser return deduplicate and independent confirmation grants only once", async () => {
  const user = await account();
  const order = await checkout(user.id, "EXTRA_ROUTE");
  const signal = webhook(order);
  const back = services.readInfinitePaySignal({ order_nsu: order, transaction_nsu: signal.transactionNsu, slug: order }, "return");
  assert.ok(back);
  const ids = await Promise.all([services.recordInfinitePaySignal(signal), services.recordInfinitePaySignal(back, user.id)]);
  assert.ok(ids[0]);
  assert.equal(ids[0], ids[1]);
  assert.equal((await payment(order)).fulfilledAt, null);
  await Promise.all([services.processInfinitePayEvent(ids[0]), services.processInfinitePayEvent(ids[0])]);
  await services.processInfinitePayEvent(ids[0]);
  assert.equal((await event(ids[0])).status, "PROCESSED");
  assert.equal(requests.filter(({ order: ref, path }) => ref === order && path.endsWith("/payment_check")).length, 1);
  assert.equal((await services.prisma.routeCredit.count({ where: { userId: user.id } })), 1);
});

test("a lost checkout response is reviewed without issuing a second link", async () => {
  const user = await account();
  const input = services.readCheckoutRequest({ productType: "EXTRA_ROUTE" }, randomUUID())!;
  failNextLink = true;
  const first = await services.startInfinitePayCheckout(user.id, input);
  assert.equal(first.state, "CHECKOUT_REVIEW");
  const order = first.orderNsu!;
  const stored = await payment(order);
  assert.equal(stored.infinitePayCheckoutUrl, null);
  assert.equal(stored.checkoutRetryAt, null);
  assert.equal((await services.startInfinitePayCheckout(user.id, input)).state, "CHECKOUT_REVIEW");
  assert.equal(await services.getInfinitePayOrderStatus(user.id, order), "CHECKOUT_REVIEW");
  const recovered = await services.startInfinitePayCheckout(user.id, { ...input, idempotencyKey: randomUUID() });
  assert.equal(recovered.state, "CHECKOUT_REVIEW");
  assert.equal(recovered.orderNsu, order);
  const matching = requests.filter((request) => request.order === order);
  assert.equal(matching.length, 1);
  await confirm(order);
  assert.ok((await payment(order)).fulfilledAt);
});

for (const [code, reply] of [
  ["HTTP_403", () => new Response("secret response body", { status: 403 })],
  ["HTTP_429", () => new Response("secret response body", { status: 429 })],
  ["TIMEOUT", () => { throw new DOMException("secret timeout detail", "TimeoutError"); }],
  ["INVALID_RESPONSE", () => new Response("{bad json secret response body")],
  ["INVALID_LINK", () => Response.json({ url: "https://outside.example.test/secret" })],
] as const) {
  test(`checkout records a sanitized ${code} and keeps the same order for review`, async (t) => {
    const logger = t.mock.method(console, "error", () => {});
    const user = await account();
    const input = services.readCheckoutRequest({ productType: "EXTRA_ROUTE" }, randomUUID())!;
    nextLinkResponse = reply;
    const result = await services.startInfinitePayCheckout(user.id, input);
    assert.equal(result.state, "CHECKOUT_REVIEW");
    const orderNsu = result.orderNsu!;
    const second = await services.startInfinitePayCheckout(user.id, { ...input, idempotencyKey: randomUUID() });
    assert.equal(second.state, "CHECKOUT_REVIEW");
    assert.equal(second.orderNsu, orderNsu);
    assert.equal(requests.filter((request) => request.order === orderNsu).length, 1);
    assert.equal(logger.mock.calls.length, 1);
    const entry = logger.mock.calls[0].arguments[1] as { code: string; stage: string; orderTrace: string };
    assert.equal(entry.code, code);
    assert.equal(entry.stage, "provider");
    assert.match(entry.orderTrace, /^[a-f0-9]{16}$/);
    assert.doesNotMatch(JSON.stringify(logger.mock.calls[0].arguments), /secret|example|synthetic|rotta_/i);
  });
}

test("P2024 after the provider created a link records review without reissuing", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  const user = await account();
  const input = services.readCheckoutRequest({ productType: "EXTRA_ROUTE" }, randomUUID())!;
  checkoutWriteFailure = "save";
  const result = await services.startInfinitePayCheckout(user.id, input).finally(() => { checkoutWriteFailure = null; });
  assert.equal(result.state, "CHECKOUT_REVIEW");
  const orderNsu = result.orderNsu!;
  assert.equal((await payment(orderNsu)).checkoutRetryAt, null);
  assert.equal(await services.getInfinitePayOrderStatus(user.id, orderNsu), "CHECKOUT_REVIEW");
  assert.equal((await services.startInfinitePayCheckout(user.id, input)).state, "CHECKOUT_REVIEW");
  assert.equal(requests.filter((request) => request.order === orderNsu).length, 1);
  assert.match(JSON.stringify(logger.mock.calls[0].arguments), /save-link.*P2024/);
  assert.doesNotMatch(JSON.stringify(logger.mock.calls[0].arguments), /secret|rotta_/);
  const capture = randomUUID();
  await confirm(orderNsu, capture);
  await confirm(orderNsu, capture);
  assert.equal(await services.prisma.routeCredit.count({ where: { userId: user.id } }), 1);
});

test("persistent exhaustion keeps a durable claim and becomes review once its window expires", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  const user = await account();
  const input = services.readCheckoutRequest({ productType: "EXTRA_ROUTE" }, randomUUID())!;
  checkoutWriteFailure = "save-and-mark";
  const result = await services.startInfinitePayCheckout(user.id, input).finally(() => { checkoutWriteFailure = null; });
  assert.equal(result.state, "CHECKOUT_REVIEW");
  assert.equal((await services.startInfinitePayCheckout(user.id, input)).state, "CHECKOUT_PENDING");
  const orderNsu = result.orderNsu!;
  const stored = await payment(orderNsu);
  assert.equal(stored.checkoutAttempts, 1);
  await services.prisma.paymentTransaction.update({ where: { id: stored.id }, data: { checkoutRetryAt: new Date(0) } });
  const retried = await services.startInfinitePayCheckout(user.id, { ...input, idempotencyKey: randomUUID() });
  assert.equal(retried.state, "CHECKOUT_REVIEW");
  assert.equal(retried.orderNsu, orderNsu);
  assert.equal(requests.filter((request) => request.order === orderNsu).length, 1);
  assert.match(JSON.stringify(logger.mock.calls[1].arguments), /mark-review.*P2024/);
});

test("a competing request sees pending only while the provider call is unfinished", async () => {
  const user = await account();
  const input = services.readCheckoutRequest({ productType: "EXTRA_ROUTE" }, randomUUID())!;
  const { promise: providerStarted, resolve: signalProvider } = Promise.withResolvers<void>();
  const { promise: resumeProvider, resolve: resume } = Promise.withResolvers<void>();
  const respond = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    if (String(args[0]).endsWith("/links")) {
      signalProvider();
      await resumeProvider;
    }
    return respond(...args);
  };
  const first = services.startInfinitePayCheckout(user.id, input);
  try {
    await providerStarted;
    const waiting = await services.startInfinitePayCheckout(user.id, { ...input, idempotencyKey: randomUUID() });
    assert.equal(waiting.state, "CHECKOUT_PENDING");
    assert.equal(await services.getInfinitePayOrderStatus(user.id, waiting.orderNsu!), "CHECKOUT_PENDING");
  } finally {
    resume();
    globalThis.fetch = respond;
    await first;
  }
  const ready = await services.startInfinitePayCheckout(user.id, input);
  assert.equal(ready.state, "READY");
  assert.equal(requests.filter((request) => request.order === ready.orderNsu).length, 1);
});

test("mismatched amounts and reused captures never deliver benefits", async () => {
  const [a, b, c] = await Promise.all([account(), account(), account()]);
  const [first, second, mismatch] = await Promise.all([a, b, c].map((u) => checkout(u.id, "EXTRA_ROUTE")));
  const transactionNsu = randomUUID();
  await confirm(first, transactionNsu);
  const duplicateEvent = await confirm(second, transactionNsu);
  assert.equal((await event(duplicateEvent)).lastError, "CAPTURE_ALREADY_BOUND");
  assert.equal((await payment(second)).fulfilledAt, null);
  overrides.set(mismatch, { amount: 100 });
  const mismatchEvent = await confirm(mismatch);
  assert.equal((await event(mismatchEvent)).lastError, "AMOUNT_OR_PRODUCT_MISMATCH");
  assert.equal((await payment(mismatch)).status, "PENDING");
  const discounted = await checkout(c.id, "EXTRA_ROUTE", 2);
  overrides.set(discounted, { paidAmount: 100 });
  assert.equal((await event(await confirm(discounted))).lastError, "AMOUNT_OR_PRODUCT_MISMATCH");
});

test("a failed benefit write rolls back approval and the durable event retries", async () => {
  const user = await account();
  const order = await checkout(user.id, "EXTRA_ROUTE", 19);
  await services.prisma.$executeRaw`ALTER TABLE "RouteCredit" ADD CONSTRAINT "test_infinitepay_failure" CHECK (delta <> 19) NOT VALID`;
  let id: string;
  try {
    id = await confirm(order);
    assert.equal((await payment(order)).status, "PENDING");
    assert.equal((await payment(order)).infinitePayTransactionId, null);
    assert.equal((await event(id)).lastError, "PROCESSING_FAILURE");
  } finally {
    await services.prisma.$executeRaw`ALTER TABLE "RouteCredit" DROP CONSTRAINT "test_infinitepay_failure"`;
  }
  await services.prisma.paymentEvent.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
  await services.reconcileInfinitePayEvents();
  assert.equal((await payment(order)).routeCredit?.delta, 19);
});

test("gateway errors, unpaid replies and late confirmation retain a recoverable order", async () => {
  const user = await account();
  const order = await checkout(user.id, "BASIC_PLAN");
  const id = (await payment(order)).id;
  await services.prisma.paymentTransaction.update({ where: { id }, data: { checkoutExpiresAt: new Date(Date.now() - 1_000) } });
  assert.equal(await services.getInfinitePayOrderStatus(user.id, order), "EXPIRED");
  overrides.set(order, { failure: true });
  const signalId = await confirm(order);
  assert.equal((await event(signalId)).lastError, "HTTP_503");
  overrides.set(order, { paid: false });
  await services.prisma.paymentEvent.update({ where: { id: signalId }, data: { nextAttemptAt: new Date(0) } });
  await services.reconcileInfinitePayEvents();
  assert.equal((await event(signalId)).lastError, "PAYMENT_NOT_CONFIRMED");
  overrides.delete(order);
  await services.prisma.paymentEvent.update({ where: { id: signalId }, data: { nextAttemptAt: new Date(0) } });
  await services.reconcileInfinitePayEvents();
  assert.equal(await services.getInfinitePayOrderStatus(user.id, order), "COMPLETED");
});

test("a paid plan change and unverified reversals go to review without revoking anything", async () => {
  const user = await account();
  const order = await checkout(user.id, "PRO_PLAN");
  const basic = await existingCycle(user.id, "BASIC", new Date(Date.now() - DAY), new Date(Date.now() + DAY));
  const otherRequest = services.readCheckoutRequest({ productType: "PRO_PLAN" }, randomUUID())!;
  assert.equal((await services.startInfinitePayCheckout(user.id, otherRequest)).state, "PLAN_CHANGE_REQUIRES_REVIEW");
  const capture = randomUUID();
  await confirm(order, capture);
  assert.equal((await payment(order)).fulfillmentReviewReason, "PLAN_CHANGE_REQUIRES_REVIEW");
  assert.equal((await payment(order)).subscription, null);
  assert.deepEqual(await services.prisma.userSubscription.findUnique({ where: { id: basic.id } }), basic);
  const avulsa = await checkout(user.id, "EXTRA_ROUTE");
  const extraCapture = randomUUID();
  await confirm(avulsa, extraCapture);
  const reversal = await services.recordInfinitePaySignal(webhook(avulsa, extraCapture, "refunded"));
  assert.ok(reversal);
  assert.equal((await event(reversal)).status, "REVIEW");
  assert.equal((await payment(avulsa)).routeCredit?.delta, 1);
});

async function paidRefundFixture(userId: string, product: PaymentProductType, quantity = 1) {
  const orderNsu = await checkout(userId, product, quantity);
  const captureReference = randomUUID();
  const amountCents = products[product] * quantity;
  overrides.set(orderNsu, { paidAmount: amountCents });
  await confirm(orderNsu, captureReference);
  return { orderNsu, captureReference, amountCents, evidence: randomUUID() };
}

for (const code of ["BASIC", "PRO"] as const) {
  test(`manual ${code} refund revokes only its cycle and leaves paid renewals on their original dates`, async () => {
    const [user, admin] = await Promise.all([account(), account()]);
    const product = code === "BASIC" ? "BASIC_PLAN" : "PRO_PLAN";
    const orders = [
      await paidRefundFixture(user.id, product),
      await paidRefundFixture(user.id, product),
      await paidRefundFixture(user.id, product),
    ];
    const target = code === "BASIC" ? orders[0] : orders[1];
    const originals = await Promise.all(orders.map(async (item) => (await payment(item.orderNsu)).subscription!));
    const notification = await services.recordInfinitePaySignal(webhook(target.orderNsu, target.captureReference, "refunded"));
    assert.ok(notification);
    const [first, second] = await Promise.all([
      services.recordInfinitePayRefund(admin.id, target), services.recordInfinitePayRefund(admin.id, target),
    ]);
    assert.ok(first?.resolved && second?.resolved);
    assert.equal(Number(first.alreadyRecorded) + Number(second.alreadyRecorded), 1);
    assert.equal((await event(notification)).status, "PROCESSED");

    const refunded = await payment(target.orderNsu);
    assert.equal(refunded.status, "REFUNDED");
    assert.ok(refunded.fulfilledAt);
    assert.equal(refunded.subscription?.status, "REVOKED");
    assert.equal(await services.getInfinitePayOrderStatus(user.id, target.orderNsu), "REFUNDED");
    await confirm(target.orderNsu, target.captureReference);
    assert.equal((await payment(target.orderNsu)).status, "REFUNDED");
    assert.equal((await payment(target.orderNsu)).subscription?.status, "REVOKED");

    for (const [index, item] of orders.entries()) {
      if (item !== target) assert.deepEqual((await payment(item.orderNsu)).subscription, originals[index]);
    }
    const future = originals[2];
    const snapshot = await services.getUserAccessSnapshot(user.id, future.startsAt);
    assert.equal(snapshot.activeSubscription?.id, future.id);
    const extension = await paidRefundFixture(user.id, product);
    assert.deepEqual((await payment(extension.orderNsu)).subscription?.startsAt, future.expiresAt);
    const actions = await services.prisma.adminAccessLog.findMany({
      where: { adminId: admin.id, targetUserId: user.id, action: "RECORD_INFINITEPAY_REFUND" },
    });
    assert.equal(actions.length, 1);
    assert.equal((actions[0].metadata as { evidence: string }).evidence, target.evidence);
  });
}

test("manual credit refunds remove only unspent credits from each purchase, including previously allocated debits", async () => {
  const [user, admin] = await Promise.all([account(), account()]);
  const first = await paidRefundFixture(user.id, "EXTRA_ROUTE", 3);
  const second = await paidRefundFixture(user.id, "EXTRA_ROUTE", 2);
  const job = await services.prisma.importJob.create({ data: { userId: user.id } });
  await services.consumeRouteAllowance({ userId: user.id, jobId: job.id, role: "USER" });
  const third = await paidRefundFixture(user.id, "EXTRA_ROUTE", 4);

  const undoSecond = await services.recordInfinitePayRefund(admin.id, second);
  assert.equal(undoSecond?.alreadyRecorded === false && undoSecond.revokedCredits, 2);
  const remaining = await Promise.all([
    services.recordInfinitePayRefund(admin.id, first), services.recordInfinitePayRefund(admin.id, first),
  ]);
  assert.ok(remaining.every((refund) => refund?.resolved));
  const undoFirst = remaining.find((refund) => refund?.alreadyRecorded === false);
  assert.equal(undoFirst?.revokedCredits, 2);
  assert.equal(undoFirst?.consumedCredits, 1);
  assert.equal(await services.getRouteCreditBalance(user.id), 4);
  assert.equal((await payment(third.orderNsu)).routeCredit?.delta, 4);
  assert.equal((await payment(third.orderNsu)).status, "APPROVED");
  assert.equal(await services.prisma.routeUsage.count({ where: { userId: user.id } }), 1);
  assert.equal(await services.prisma.routeCredit.count({ where: { userId: user.id, reversalOfCreditId: { not: null } } }), 2);
});

test("refund of fully used credits records the outcome without spending another purchase", async () => {
  const [user, admin] = await Promise.all([account(), account()]);
  const used = await paidRefundFixture(user.id, "EXTRA_ROUTE");
  const job = await services.prisma.importJob.create({ data: { userId: user.id } });
  await services.consumeRouteAllowance({ userId: user.id, jobId: job.id, role: "USER" });
  await paidRefundFixture(user.id, "EXTRA_ROUTE", 2);
  assert.deepEqual(await services.recordInfinitePayRefund(admin.id, used), {
    resolved: true, alreadyRecorded: false, revokedSubscriptionId: null, revokedCredits: 0, consumedCredits: 1,
  });
  assert.equal(await services.getRouteCreditBalance(user.id), 2);
  assert.equal((await payment(used.orderNsu)).status, "REFUNDED");
});

test("manual refund rejects mismatched capture and amount, even when a matching webhook is in review", async () => {
  const [user, admin] = await Promise.all([account(), account()]);
  const input = await paidRefundFixture(user.id, "EXTRA_ROUTE");
  await services.recordInfinitePaySignal(webhook(input.orderNsu, input.captureReference, "refunded"));
  assert.equal(await services.recordInfinitePayRefund(admin.id, { ...input, amountCents: 198 }), null);
  assert.equal(await services.recordInfinitePayRefund(admin.id, { ...input, captureReference: randomUUID() }), null);
  assert.equal((await payment(input.orderNsu)).status, "APPROVED");
  assert.equal(await services.getRouteCreditBalance(user.id), 1);
  assert.equal(await services.prisma.adminAccessLog.count({ where: { adminId: admin.id } }), 0);
});

test("concurrent refund and credit consumption do not create a negative balance", async () => {
  const [user, admin] = await Promise.all([account(), account()]);
  const input = await paidRefundFixture(user.id, "EXTRA_ROUTE");
  const job = await services.prisma.importJob.create({ data: { userId: user.id } });
  const [refund, consume] = await Promise.allSettled([
    services.recordInfinitePayRefund(admin.id, input),
    services.consumeRouteAllowance({ userId: user.id, jobId: job.id, role: "USER" }),
  ]);
  assert.equal(refund.status === "fulfilled" && refund.value?.resolved, true);
  if (consume.status === "rejected") assert.equal(consume.reason.code, "NO_ACTIVE_SUBSCRIPTION");
  const spent = await services.prisma.routeUsage.count({ where: { userId: user.id } });
  const reversed = await services.prisma.routeCredit.count({ where: { userId: user.id, reversalOfCreditId: { not: null } } });
  assert.equal(spent + reversed, 1);
  assert.equal(await services.getRouteCreditBalance(user.id), 0);
});
