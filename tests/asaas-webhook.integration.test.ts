import test, { after, afterEach, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PaymentProductType } from "@prisma/client";
import { NextRequest } from "next/server";

// Direct execution must fail before importing the application's database client.
const databaseUrl = process.env.TEST_DATABASE_URL;
const runId = process.env.TEST_DB_RUN_ID;
if (!databaseUrl || databaseUrl !== process.env.DATABASE_URL || !runId || !/^[a-f0-9]{16}$/.test(runId)) {
  throw new Error("Use node scripts/asaas-webhook-integration.mjs (isolated database only)");
}
const parsed = new URL(databaseUrl);
if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== `/rotta_asaas_test_${runId}`) {
  throw new Error("Unsafe test database");
}
let db: typeof import("../app/lib/prisma").prisma;
let POST: typeof import("../app/api/webhooks/asaas/route").POST;
before(async () => {
  ({ prisma: db } = await import("../app/lib/prisma"));
  ({ POST } = await import("../app/api/webhooks/asaas/route"));
});
const SECRET = "synthetic-webhook-secret-for-offline-tests";
const WRONG = "synthetic-different-asaas-auth-token";
let networkCalls = 0;
let logged: unknown[][] = [];
beforeEach(() => {
  process.env.ASAAS_WEBHOOK_SECRET = SECRET;
  Object.assign(process.env, { NODE_ENV: "test" });
  networkCalls = 0;
  logged = [];
  mock.method(globalThis, "fetch", async () => {
    networkCalls++;
    throw new Error("External providers forbidden in webhook tests");
  });
  for (const method of ["error", "warn", "log"] as const) {
    mock.method(console, method, (...args: unknown[]) => { logged.push(args); });
  }
});
afterEach(() => {
  mock.restoreAll();
  assert.equal(networkCalls, 0, "webhook must not call an external provider");
  const output = JSON.stringify(logged);
  for (const secret of [SECRET, WRONG]) assert.equal(output.includes(secret), false, "secrets must not be logged");
});
after(async () => { await db.$disconnect(); });

async function fixture(productType: PaymentProductType = "EXTRA_ROUTE") {
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.test`, password: "synthetic-unused-hash" } });
  const plan = await db.subscriptionPlan.upsert({
    where: { code: "BASIC" }, update: {},
    create: { code: "BASIC", name: "Fixture Basic", durationDays: 30, dailyRouteLimit: 1 },
  });
  const credit = await db.routeCredit.create({ data: { userId: user.id, delta: 7, reason: "ADJUSTMENT" } });
  const subscription = await db.userSubscription.create({
    data: { userId: user.id, planId: plan.id, source: "MANUAL_PAYMENT", startsAt: new Date(), expiresAt: new Date(Date.now() + 86400_000) },
  });
  const legacyPayment = await db.paymentTransaction.create({
    data: { userId: user.id, provider: "ASAAS", productType: "EXTRA_ROUTE", amountCents: 199,
      externalReference: `legacy-${suffix}`, status: "APPROVED", fulfilledAt: new Date(), fulfilledSourceId: credit.id },
  });
  const transaction = await db.paymentTransaction.create({
    data: { userId: user.id, provider: "ASAAS", productType, quantity: 3, amountCents: 597,
      externalReference: `fixture-${suffix}`, status: "PENDING" },
  });
  const payload = { id: `evt_fixture_${suffix}`, event: "PAYMENT_CONFIRMED", payment: {
    id: `pay_fixture_${suffix}`, externalReference: transaction.externalReference, status: "CONFIRMED", value: 5.97,
  } };
  const call = (auth: { header?: string; query?: string } = {}, body: unknown = payload) => {
    const url = new URL("http://localhost:3000/api/webhooks/asaas");
    if (auth.query !== undefined) url.searchParams.set("secret", auth.query);
    const headers = new Headers({ "content-type": "application/json" });
    if (auth.header !== undefined) headers.set("asaas-access-token", auth.header);
    return POST(new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) }));
  };
  const payment = () => db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
  const purchasedCredits = () => db.routeCredit.findMany({ where: { userId: user.id, reason: "MANUAL_PAYMENT" } });
  const assertLegacyUnchanged = async () => {
    assert.deepEqual(await db.routeCredit.findUniqueOrThrow({ where: { id: credit.id } }), credit);
    assert.deepEqual(await db.userSubscription.findUniqueOrThrow({ where: { id: subscription.id } }), subscription);
    assert.deepEqual(await db.paymentTransaction.findUniqueOrThrow({ where: { id: legacyPayment.id } }), legacyPayment);
  };
  return { user, transaction, payload, call, payment, purchasedCredits, assertLegacyUnchanged };
}

const authenticationCases = [
  { name: "legacy URL", auth: { query: SECRET }, status: 200 },
  { name: "current header", auth: { header: SECRET }, status: 200 },
  { name: "both credentials valid", auth: { header: SECRET, query: SECRET }, status: 200 },
  { name: "divergent header with valid legacy URL", auth: { header: WRONG, query: SECRET }, status: 200 },
  { name: "valid header with divergent URL", auth: { header: SECRET, query: WRONG }, status: 200 },
  { name: "empty header with valid legacy URL", auth: { header: "", query: SECRET }, status: 200 },
  { name: "valid header with empty URL secret", auth: { header: SECRET, query: "" }, status: 200 },
  { name: "legacy whitespace normalization", auth: { query: `  ${SECRET}  ` }, status: 200 },
  { name: "invalid header", auth: { header: WRONG }, status: 401 },
  { name: "invalid URL secret", auth: { query: WRONG }, status: 401 },
  { name: "both invalid and equal", auth: { header: WRONG, query: WRONG }, status: 401 },
  { name: "both invalid and divergent", auth: { header: WRONG, query: "another-invalid-fixture" }, status: 401 },
  { name: "invalid header with empty URL secret", auth: { header: WRONG, query: "" }, status: 401 },
  { name: "empty header with invalid URL secret", auth: { header: "", query: WRONG }, status: 401 },
  { name: "missing authentication", auth: {}, status: 401 },
  { name: "both empty", auth: { header: "", query: "" }, status: 401 },
  { name: "whitespace only", auth: { header: "   ", query: "   " }, status: 401 },
  { name: "secret prefix", auth: { header: SECRET.slice(0, -1) }, status: 401 },
  { name: "secret with suffix", auth: { query: `${SECRET}-extra` }, status: 401 },
  { name: "Bearer is not a supported format", auth: { header: `Bearer ${SECRET}` }, status: 401 },
];
for (const entry of authenticationCases) {
  test(`authentication: ${entry.name}`, async () => {
    const f = await fixture();
    const response = await f.call(entry.auth);
    assert.equal(response.status, entry.status);
    const payment = await f.payment();
    const credits = await f.purchasedCredits();
    if (entry.status === 200) {
      assert.deepEqual(await response.json(), { ok: true, paymentTransactionId: f.transaction.id });
      assert.equal(payment.status, "APPROVED");
      assert.ok(payment.approvedAt);
      assert.ok(payment.fulfilledAt);
      assert.equal(credits.length, 1);
      assert.equal(credits[0].delta, 3);
      assert.equal(payment.fulfilledSourceId, credits[0].id);
    } else {
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
      assert.deepEqual(payment, f.transaction);
      assert.equal(credits.length, 0);
    }
    await f.assertLegacyUnchanged();
  });
}

for (const mode of ["production", "development", "test"]) {
  for (const configured of [undefined, "", "   "]) {
    test(`missing server secret fails closed in ${mode} (${JSON.stringify(configured)})`, async () => {
      const f = await fixture();
      Object.assign(process.env, { NODE_ENV: mode });
      if (configured === undefined) delete process.env.ASAAS_WEBHOOK_SECRET;
      else process.env.ASAAS_WEBHOOK_SECRET = configured;
      const response = await f.call({ header: SECRET, query: SECRET });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Webhook secret not configured." });
      assert.deepEqual(await f.payment(), f.transaction);
      assert.equal((await f.purchasedCredits()).length, 0);
      await f.assertLegacyUnchanged();
    });
  }
}

test("unauthenticated requests are rejected before parsing the payload", async () => {
  const request = new NextRequest("http://localhost:3000/api/webhooks/asaas", { method: "POST", body: "not-json" });
  const json = mock.method(request, "json", async () => { throw new Error("Payload must stay unread"); });
  assert.equal((await POST(request)).status, 401);
  assert.equal(json.mock.callCount(), 0);
});

test("duplicate confirmed/received events across both authentication formats grant credits once", async () => {
  const f = await fixture();
  assert.equal((await f.call({ header: WRONG, query: SECRET })).status, 200);
  const fulfilled = await f.payment();
  const credits = await f.purchasedCredits();
  assert.equal((await f.call({ header: SECRET })).status, 200);
  assert.equal((await f.call({ query: SECRET }, { ...f.payload, id: "evt_fixture_received", event: "PAYMENT_RECEIVED",
    payment: { ...f.payload.payment, status: "RECEIVED" } })).status, 200);
  assert.deepEqual(await f.purchasedCredits(), credits);
  const after = await f.payment();
  assert.equal(after.status, "APPROVED");
  assert.deepEqual(after.approvedAt, fulfilled.approvedAt);
  assert.deepEqual(after.fulfilledAt, fulfilled.fulfilledAt);
  assert.equal(after.fulfilledSourceId, fulfilled.fulfilledSourceId);
  await f.assertLegacyUnchanged();
});

test("simultaneous duplicate webhooks grant credits once using real serializable transactions", async () => {
  const f = await fixture();
  const responses = await Promise.all([
    f.call({ header: SECRET }), f.call({ header: WRONG, query: SECRET }),
  ]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const credits = await f.purchasedCredits();
  assert.equal(credits.length, 1);
  assert.equal(credits[0].delta, 3);
  assert.equal((await f.payment()).fulfilledSourceId, credits[0].id);
  await f.assertLegacyUnchanged();
});

test("failed credit grant rolls back the claim and a webhook retry grants credits once", async () => {
  const f = await fixture();
  // A genuine database constraint failure inside the transaction must roll back fulfilledAt.
  await db.$executeRaw`ALTER TABLE "RouteCredit" ADD CONSTRAINT "fixture_reject_credit" CHECK (delta <> 3) NOT VALID`;
  try {
    assert.equal((await f.call({ query: SECRET, header: WRONG })).status, 500);
    const failed = await f.payment();
    assert.equal(failed.status, "APPROVED");
    assert.equal(failed.fulfilledAt, null);
    assert.equal(failed.fulfilledSourceId, null);
    assert.equal((await f.purchasedCredits()).length, 0);
  } finally {
    await db.$executeRaw`ALTER TABLE "RouteCredit" DROP CONSTRAINT "fixture_reject_credit"`;
  }
  assert.equal((await f.call({ header: SECRET })).status, 200);
  assert.equal((await f.call({ query: SECRET })).status, 200);
  assert.equal((await f.purchasedCredits()).length, 1);
  await f.assertLegacyUnchanged();
});

for (const product of ["BASIC_PLAN", "PRO_PLAN"] as const) {
  test(`duplicate ${product} confirmation preserves the subscription granted by the first event`, async () => {
    await db.subscriptionPlan.upsert({ where: { code: "PRO" }, update: {},
      create: { code: "PRO", name: "Fixture Pro", durationDays: 30, dailyRouteLimit: 10 } });
    const f = await fixture(product);
    assert.equal((await f.call({ header: WRONG, query: SECRET })).status, 200);
    const subscriptions = await db.userSubscription.findMany({ where: { userId: f.user.id }, orderBy: { id: "asc" } });
    assert.equal(subscriptions.length, 2);
    assert.equal(subscriptions.filter(s => s.status === "ACTIVE").length, 1);
    assert.equal(subscriptions.filter(s => s.status === "REVOKED").length, 1);
    assert.equal((await f.purchasedCredits()).length, 0);
    assert.equal((await f.call({ header: SECRET })).status, 200);
    assert.deepEqual(await db.userSubscription.findMany({ where: { userId: f.user.id }, orderBy: { id: "asc" } }), subscriptions);
  });
}

test("pending payment grants no credits", async () => {
  const f = await fixture();
  assert.equal((await f.call({ query: SECRET }, { ...f.payload, event: "PAYMENT_CREATED",
    payment: { ...f.payload.payment, status: "PENDING" } })).status, 200);
  const payment = await f.payment();
  assert.equal(payment.status, "PENDING");
  assert.equal(payment.fulfilledAt, null);
  assert.equal((await f.purchasedCredits()).length, 0);
  await f.assertLegacyUnchanged();
});

test("Asaas authentication cannot fulfill another provider's payment", async () => {
  const f = await fixture();
  await db.paymentTransaction.update({ where: { id: f.transaction.id }, data: { provider: "MERCADOPAGO" } });
  assert.equal((await f.call({ header: SECRET })).status, 409);
  assert.equal((await f.payment()).status, "PENDING");
  assert.equal((await f.purchasedCredits()).length, 0);
  await f.assertLegacyUnchanged();
});

test("exceptions and unknown payment identifiers cannot leak credentials through logs", async () => {
  const f = await fixture();
  assert.equal((await f.call({ header: SECRET }, { event: "PAYMENT_CONFIRMED", payment: { id: SECRET, externalReference: WRONG } })).status, 200);
  for (const error of [new Error(`${SECRET} ${WRONG}`),
    new Prisma.PrismaClientKnownRequestError(`${SECRET} ${WRONG}`, { code: "P2002", clientVersion: "fixture" })]) {
    const request = new NextRequest("http://localhost:3000/api/webhooks/asaas", { method: "POST" });
    const headers = mock.method(request.headers, "get", () => { throw error; });
    try {
      assert.equal((await POST(request)).status, "code" in error ? 200 : 500);
    } finally { headers.mock.restore(); }
  }
  assert.deepEqual(await f.payment(), f.transaction);
  await f.assertLegacyUnchanged();
});
