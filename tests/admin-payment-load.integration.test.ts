import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, mock, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { SUPER_ADMIN_EMAIL } from "../app/lib/admin-roles";

const url = process.env.TEST_DATABASE_URL;
assert.ok(url && url === process.env.DATABASE_URL && /^[a-f0-9]{16}$/.test(process.env.TEST_DB_RUN_ID ?? ""));
const local = new URL(url);
assert.equal(local.protocol, "postgresql:");
assert.equal(local.hostname, "127.0.0.1");
assert.equal(local.pathname, `/rotta_auth_test_${process.env.TEST_DB_RUN_ID}`);
local.searchParams.set("connection_limit", "9");
local.searchParams.set("pool_timeout", "10");
const prisma = new PrismaClient({ datasourceUrl: local.toString(), log: [{ level: "query", emit: "event" }] });
const globals = globalThis as unknown as { prisma: PrismaClient };
globals.prisma = prisma;
let statements = 0;
prisma.$on("query", () => { statements++; });

const users = Array.from({ length: 210 }, (_, i) => {
  const label = String(i).padStart(3, "0");
  return { id: `load-user-${label}`, name: `Carga ${label}`, email: `load-${label}@fixture.test`, password: "fixture",
    active: i !== 209, emailVerificationRequired: i === 208 };
});
const { id: first } = users[0];
const startsAt = new Date(Date.now() - 10 * 86_400_000);
const expiresAt = new Date(startsAt.getTime() + 30 * 86_400_000);
const scheduledEnd = new Date(expiresAt.getTime() + 30 * 86_400_000);
let sessionCookie: string;
let normalAdminCookie: string;
let linkCalls = 0;
const require = createRequire(import.meta.url);
const nextHeaders = require("next/headers") as typeof import("next/headers");
mock.method(nextHeaders, "headers", async () => new Headers() as Awaited<ReturnType<typeof nextHeaders.headers>>);
mock.method(nextHeaders, "cookies", async () => ({
  getAll: () => [{ name: "next-auth.session-token", value: sessionCookie }],
}) as Awaited<ReturnType<typeof nextHeaders.cookies>>);

let adminSubscriptions: typeof import("../app/api/admin/subscriptions/route");
let adminUsers: typeof import("../app/api/admin/users/route");
let access: typeof import("../app/lib/access-control");
let issuing: typeof import("../app/lib/infinitepay-checkout");
let financial: typeof import("../app/lib/admin-subscription-list");
let originalFinancial: Awaited<ReturnType<typeof financial.getAdminFinancialSummary>>;

before(async () => {
  Object.assign(process.env, {
    INFINITEPAY_API_KEY: "synthetic-admin-load-key",
    INFINITEPAY_HANDLE: "synthetic-load",
    INFINITEPAY_APP_URL: "https://load.fixture.test",
  });
  mock.method(globalThis, "fetch", async (endpoint: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(endpoint), "https://api.checkout.infinitepay.io/links");
    const { order_nsu, items } = JSON.parse(String(init?.body));
    assert.deepEqual(items.map(({ price, quantity }: { price: number; quantity: number }) => ({ price, quantity })),
      [{ price: 199, quantity: 10 }]);
    linkCalls++;
    return Response.json({ url: `https://checkout.infinitepay.com.br/pay/${order_nsu}`, slug: order_nsu });
  });
  adminSubscriptions = await import("../app/api/admin/subscriptions/route");
  adminUsers = await import("../app/api/admin/users/route");
  access = await import("../app/lib/access-control");
  issuing = await import("../app/lib/infinitepay-checkout");
  financial = await import("../app/lib/admin-subscription-list");
  originalFinancial = await financial.getAdminFinancialSummary(new Date());
  const admin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL }, update: { role: "ADMIN", active: true, emailVerificationRequired: false },
    create: { email: SUPER_ADMIN_EMAIL, role: "ADMIN", password: "fixture", emailVerificationRequired: false },
  });
  const normal = await prisma.user.create({
    data: { email: "load-admin@fixture.test", role: "ADMIN", password: "fixture", emailVerificationRequired: false },
  });
  const makeCookie = (user: typeof admin) => encode({
    secret: process.env.NEXTAUTH_SECRET!,
    token: { id: user.id, email: user.email, role: user.role, sessionVersion: user.sessionVersion },
  });
  sessionCookie = await makeCookie(admin);
  normalAdminCookie = await makeCookie(normal);
  await prisma.user.createMany({ data: users });
  const plan = await prisma.subscriptionPlan.upsert({
    where: { code: "BASIC" }, update: { dailyRouteLimit: 1, isActive: true },
    create: { code: "BASIC", name: "Basic", durationDays: 30, dailyRouteLimit: 1 },
  });
  await prisma.userSubscription.createMany({ data: [
    { id: "load-current-cycle", userId: first, planId: plan.id, startsAt, expiresAt, source: "MANUAL_PAYMENT" },
    { id: "load-scheduled-cycle", userId: first, planId: plan.id, startsAt: expiresAt, expiresAt: scheduledEnd, source: "INFINITEPAY_LINK", status: "SCHEDULED" },
    { id: "load-expired-cycle", userId: users[1].id, planId: plan.id, startsAt: new Date(0), expiresAt: startsAt,
      source: "MANUAL_PAYMENT", status: "EXPIRED" },
  ] });
  await prisma.routeCredit.createMany({ data: [
    { userId: first, delta: 5, reason: "MANUAL_PAYMENT" },
    { userId: first, delta: -1, reason: "CONSUMPTION" },
  ] });
  await prisma.routeUsage.create({
    data: { userId: first, subscriptionId: "load-current-cycle", source: "SUBSCRIPTION_DAILY", usageDayKey: "2026-01-01" },
  });
  await prisma.importJob.create({ data: { id: "load-workspace", userId: first, status: "PENDING" } });
  await prisma.paymentTransaction.createMany({ data: [
    { userId: first, provider: "ASAAS", status: "APPROVED", productType: "BASIC_PLAN", amountCents: 3999, externalReference: "load-asaas" },
    { userId: first, provider: "MERCADOPAGO", status: "FULFILLED", productType: "EXTRA_ROUTE", amountCents: 398, quantity: 2, externalReference: "load-mercadopago" },
  ] });
  await prisma.adminAccessLog.create({ data: { adminId: admin.id, targetUserId: first, action: "LOAD_FIXTURE" } });
});

after(async () => {
  mock.restoreAll();
  await prisma.$disconnect();
});

type Row = {
  id: string; access: Awaited<ReturnType<typeof access.getUserAccessSnapshot>>;
  latestSubscription?: { id: string }; recentPayments?: unknown;
  subscriptionStatusLabel?: string;
};
type List = {
  users: Row[]; pagination: { page: number; pages: number; pageSize: number; total: number };
  summary?: { totalUsers: number }; financialSummary?: typeof originalFinancial;
};

async function adminList(route: typeof adminUsers.GET | typeof adminSubscriptions.GET, query: string) {
  const response = await route(new Request(`http://localhost/admin-test?${query}`));
  assert.equal(response.status, 200);
  return await response.json() as List;
}

test("210 users, both admin views and simultaneous checkouts fit the nine-connection pool", { timeout: 30_000 }, async (t) => {
  const before = statements;
  await adminList(adminSubscriptions.GET, "q=Carga&pageSize=1");
  const one = statements - before;
  const before50 = statements;
  const full = await adminList(adminSubscriptions.GET, "q=Carga&pageSize=50");
  const fifty = statements - before50;
  assert.equal(full.users.length, 50);
  assert.equal(full.pagination.total, 210);
  assert.ok(fifty <= one + 2 && fifty <= 20, `statement count grew from ${one} to ${fifty}`);

  const concurrentBefore = statements;
  const start = performance.now();
  const userLists = [];
  const subscriptionLists = [];
  for (let page = 1; page <= 5; page++) {
    userLists.push(adminList(adminUsers.GET, `q=Carga&pageSize=50&page=${page}`));
    subscriptionLists.push(adminList(adminSubscriptions.GET, `q=Carga&pageSize=50&page=${page}`));
  }
  const checkout = () => issuing.startInfinitePayCheckout(users[2].id, {
    productType: "EXTRA_ROUTE", quantity: 10, idempotencyKey: randomUUID(),
  });
  const [listUsers, listSubscriptions, checkoutResults] = await Promise.all([
    Promise.all(userLists), Promise.all(subscriptionLists), Promise.all([checkout(), checkout(), checkout()]),
  ]);
  for (const pages of [listUsers, listSubscriptions]) {
    assert.equal(new Set(pages.flatMap((page) => page.users.map((user) => user.id))).size, 210);
    assert.deepEqual(pages.map((page) => page.pagination.page), [1, 2, 3, 4, 5]);
  }
  assert.ok(checkoutResults.some((result) => result.state === "READY"));
  assert.equal(new Set(checkoutResults.map(({ orderNsu }) => orderNsu)).size, 1);
  assert.equal(linkCalls, 1);
  t.diagnostic(`Subscrições: ${one} instruções SQL com 1 usuário e ${fifty} com 50. Carga conjunta: ${statements - concurrentBefore} instruções em ${Math.round(performance.now() - start)} ms.`);
});

test("server filters, global accounting and on-demand history preserve existing entitlements", async () => {
  const matching = await adminList(adminSubscriptions.GET, "q=Carga&filter=WITH_CREDITS");
  assert.deepEqual(matching.users.map(({ id }) => id), [first]);
  const entry = matching.users[0];
  assert.equal(entry.access.routeCreditsBalance, 4);
  assert.equal(entry.access.subscriptionCycleUsed, 1);
  assert.equal(entry.access.activeSubscription?.id, "load-current-cycle");
  assert.equal(entry.latestSubscription?.id, "load-current-cycle");
  assert.equal(entry.access.scheduledSubscriptions[0]?.id, "load-scheduled-cycle");
  assert.equal(entry.access.activeWorkspaceAccess?.id, "load-workspace");
  assert.deepEqual(entry.access, await access.getUserAccessSnapshot(first));
  assert.equal(entry.recentPayments, undefined);
  assert.equal(matching.financialSummary!.basicPlansSold - originalFinancial.basicPlansSold, 1);
  assert.equal(matching.financialSummary!.extraRouteRevenueCents - originalFinancial.extraRouteRevenueCents, 398);
  assert.equal(matching.financialSummary!.extraRouteUnits - originalFinancial.extraRouteUnits, 2);
  assert.ok(matching.summary!.totalUsers >= 210);

  const expired = await adminList(adminSubscriptions.GET, "q=Carga&filter=EXPIRED");
  assert.deepEqual(expired.users.map(({ id }) => id), [users[1].id]);
  const tail = await adminList(adminUsers.GET, "q=Carga&page=999&active=1");
  assert.equal(tail.pagination.total, 209);
  assert.equal(tail.pagination.page, tail.pagination.pages);

  const history = () => adminSubscriptions.GET(new Request(`http://localhost/admin-test?historyFor=${first}`));
  const response = await history();
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.recentPayments.length, 2);
  assert.equal(detail.recentRouteCredits.length, 2);
  assert.equal(detail.recentAdminActions.length, 1);
  const originalCookie = sessionCookie;
  try {
    sessionCookie = normalAdminCookie;
    assert.equal((await history()).status, 403);
    assert.equal((await adminList(adminUsers.GET, "q=load-admin@fixture.test")).pagination.total, 0);
  } finally {
    sessionCookie = originalCookie;
  }
});

test("subscription filters use the same São Paulo credit boundary as user access", async () => {
  const userId = users[3].id;
  const now = new Date("2026-11-23T03:01:00.000Z");
  const cycle = await prisma.userSubscription.create({
    data: {
      user: { connect: { id: userId } }, plan: { connect: { code: "BASIC" } }, source: "MANUAL_PAYMENT",
      startsAt: new Date("2026-11-23T02:59:00.000Z"), expiresAt: new Date("2026-12-23T02:59:00.000Z"),
    },
  });
  await prisma.routeUsage.create({
    data: { userId, subscriptionId: cycle.id, source: "SUBSCRIPTION_DAILY", usageDayKey: "2026-11-22" },
  });
  const list = await financial.listAdminSubscriptionIds(now, "WITH_CREDITS", userId, 1, 25);
  assert.deepEqual(list.rows.map((row) => row.id), [userId]);
  assert.equal((await access.getUserAccessSnapshot(userId, now)).subscriptionCycleRemaining, 1);
});
