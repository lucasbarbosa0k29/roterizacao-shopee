import test, { after, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { encode } from "next-auth/jwt";
import type { PrismaClient } from "@prisma/client";
import type { UserAccessSnapshot } from "../app/lib/access-control";

type ListedUser = {
  id: string;
  role: "ADMIN" | "USER";
  active: boolean;
  access: UserAccessSnapshot;
};

// In-memory fixtures only: no Prisma connection, migration or provider request.
const environment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/rotta_admin_users_test",
  NEXTAUTH_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "synthetic-admin-users-session-secret-for-tests-only",
  ROTTA_LOCAL_DEV: "0",
};
const previousEnvironment = Object.fromEntries(
  Object.keys(environment).map(key => [key, process.env[key]])
);
Object.assign(process.env, environment);

const now = new Date();
function account(id: string, changes: Partial<ReturnType<typeof baseAccount>> = {}) {
  return { ...baseAccount(id), ...changes };
}
function baseAccount(id: string) {
  return {
    id, name: `Fixture ${id}`, email: `${id}@example.test`,
    password: "synthetic-password-hash", role: "USER" as "ADMIN" | "USER",
    active: true, emailVerificationRequired: false,
    emailVerifiedAt: null as Date | null, sessionVersion: 0,
    documentType: null as "CPF" | "CNPJ" | null,
    accessBlockedAt: null as Date | null,
    accessBlockReason: null as string | null,
    createdAt: now, updatedAt: now,
  };
}
const accounts = new Map([
  account("legacy-admin", { role: "ADMIN" }),
  account("confirmed-admin", { role: "ADMIN", emailVerificationRequired: true, emailVerifiedAt: now }),
  account("inactive-admin", { role: "ADMIN", active: false }),
  account("pending-admin", { role: "ADMIN", emailVerificationRequired: true }),
  account("revoked-admin", { role: "ADMIN", sessionVersion: 1 }),
  account("legacy-user"),
  account("inactive-user", { active: false }),
  account("pending-user", { emailVerificationRequired: true, documentType: "CPF" }),
  account("confirmed-user", { emailVerificationRequired: true, emailVerifiedAt: now, documentType: "CNPJ" }),
  account("blocked-user", { accessBlockedAt: now, accessBlockReason: "Synthetic manual block" }),
].map(value => [value.id, value]));
const balances = new Map([
  ["legacy-user", 7], ["inactive-user", 5], ["pending-user", 3],
  ["confirmed-user", 2], ["blocked-user", 4], ["pending-admin", 9],
]);
const subscriptions = new Map(
  ["legacy-user", "inactive-user", "pending-user", "pending-admin"].map(userId => [userId, {
    id: `subscription-${userId}`, userId, status: "ACTIVE", source: "MANUAL_PAYMENT",
    startsAt: new Date(now.getTime() - 2 * 86_400_000),
    expiresAt: new Date(now.getTime() + 28 * 86_400_000),
    plan: { code: "BASIC", name: "Fixture plan", dailyRouteLimit: 5, isUnlimited: false },
  }])
);
let sessionCookie: string | undefined;
let listQueries = 0;
let failSubscriptionRead = false;
const unexpectedOperations: string[] = [];

function model<T extends object>(name: string, methods: T): T {
  return new Proxy(methods, {
    get(target, key) {
      if (Object.hasOwn(target, key)) return Reflect.get(target, key);
      return () => {
        unexpectedOperations.push(`${name}.${String(key)}`);
        throw new Error("Unexpected database operation in admin-users regression test");
      };
    },
  });
}
function selected(value: ReturnType<typeof baseAccount>, select?: Record<string, boolean>) {
  return structuredClone(select
    ? Object.fromEntries(Object.entries(value).filter(([key]) => select[key]))
    : value);
}
const database = model("database", {
  user: model("user", {
    findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
      const value = accounts.get(where.id);
      return value ? selected(value, select) : null;
    },
    findMany: async ({ select }: { select: Record<string, boolean> }) => {
      listQueries++;
      return [...accounts.values()].map(value => selected(value, select));
    },
  }),
  routeCredit: model("routeCredit", {
    aggregate: async ({ where }: { where: { userId: string } }) => ({ _sum: { delta: balances.get(where.userId) ?? null } }),
  }),
  userSubscription: model("userSubscription", {
    findFirst: async ({ where }: { where: { userId: string } }) => {
      if (failSubscriptionRead) throw new Error("Synthetic subscription read failure");
      return structuredClone(subscriptions.get(where.userId) ?? null);
    },
  }),
  routeUsage: model("routeUsage", { count: async () => 2 }),
  importJob: model("importJob", { findFirst: async () => null }),
});

const globals = globalThis as unknown as { prisma?: PrismaClient };
const previousPrisma = globals.prisma;
globals.prisma = database as unknown as PrismaClient;
mock.method(globalThis, "fetch", async () => {
  throw new Error("External network forbidden in admin-users regression test");
});
mock.method(console, "error", () => {});
const requireFromProject = createRequire(resolve("package.json"));
const nextHeaders = requireFromProject("next/headers") as typeof import("next/headers");
mock.method(nextHeaders, "headers", async () => new Headers() as Awaited<ReturnType<typeof nextHeaders.headers>>);
mock.method(nextHeaders, "cookies", async () => ({
  getAll: () => sessionCookie ? [{ name: "next-auth.session-token", value: sessionCookie }] : [],
}) as Awaited<ReturnType<typeof nextHeaders.cookies>>);

let route: typeof import("../app/api/admin/users/route");
let access: typeof import("../app/lib/access-control");
before(async () => {
  route = await import("../app/api/admin/users/route");
  access = await import("../app/lib/access-control");
});
beforeEach(() => {
  sessionCookie = undefined;
  listQueries = 0;
  failSubscriptionRead = false;
  unexpectedOperations.length = 0;
});
after(() => {
  mock.restoreAll();
  if (previousPrisma === undefined) delete globals.prisma;
  else globals.prisma = previousPrisma;
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function signInAs(id: string, claims: Record<string, unknown> = {}) {
  const value = accounts.get(id);
  sessionCookie = await encode({
    secret: environment.NEXTAUTH_SECRET,
    // Omitting sessionVersion exercises JWTs issued before account_security.
    token: { id, email: value?.email ?? "missing@example.test", role: value?.role ?? "ADMIN", ...claims },
  });
}

test("authorized legacy administrator lists active, inactive and pending users with real entitlements", async () => {
  const beforeAccounts = structuredClone([...accounts]);
  const beforeBalances = structuredClone([...balances]);
  const beforeSubscriptions = structuredClone([...subscriptions]);
  await signInAs("legacy-admin");
  const response = await route.GET();
  assert.equal(response.status, 200);
  const result = await response.json() as { ok: boolean; users: ListedUser[] };
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.users.map(row => row.id).sort(),
    [...accounts.values()].filter(value => value.role === "USER").map(value => value.id).sort()
  );
  const rows = new Map(result.users.map(row => [row.id, row]));
  for (const id of ["legacy-user", "inactive-user", "pending-user"]) {
    const snapshot = rows.get(id)!.access;
    assert.equal(snapshot.routeCreditsBalance, balances.get(id));
    assert.equal(snapshot.activeSubscription?.id, `subscription-${id}`);
    assert.equal(snapshot.activeSubscription?.code, "BASIC");
    assert.equal(snapshot.subscriptionCycleUsed, 2);
    assert.ok(snapshot.subscriptionCycleAllowance > 0);
  }
  assert.equal(rows.get("legacy-user")!.access.canStartRoute, true);
  assert.equal(rows.get("confirmed-user")!.access.canStartRoute, true);
  assert.equal(rows.get("inactive-user")!.active, false);
  assert.equal(rows.get("pending-user")!.active, true);
  for (const id of ["inactive-user", "pending-user", "blocked-user"]) {
    assert.equal(rows.get(id)!.access.code, "ACCESS_BLOCKED");
    assert.equal(rows.get(id)!.access.isBlocked, true);
    assert.equal(rows.get(id)!.access.canUseApp, false);
    assert.equal(rows.get(id)!.access.canStartRoute, false);
  }
  assert.equal(rows.get("blocked-user")!.access.routeCreditsBalance, 4);
  assert.equal(rows.get("blocked-user")!.access.blockReason, "Synthetic manual block");
  assert.equal(result.users.some(row => row.role === "ADMIN"), false);
  for (const row of result.users) {
    assert.equal(Object.hasOwn(row, "password"), false);
    assert.equal(Object.hasOwn(row, "cpf"), false);
  }
  assert.deepEqual([...accounts], beforeAccounts);
  assert.deepEqual([...balances], beforeBalances);
  assert.deepEqual([...subscriptions], beforeSubscriptions);
  assert.deepEqual(unexpectedOperations, []);
});

test("confirmed administrator and current session version remain authorized", async () => {
  for (const id of ["confirmed-admin", "revoked-admin"]) {
    await signInAs(id, { sessionVersion: accounts.get(id)!.sessionVersion });
    assert.equal((await route.GET()).status, 200);
  }
});

for (const denied of [
  { name: "anonymous", id: null },
  { name: "ordinary user", id: "legacy-user" },
  { name: "stale ADMIN claim on ordinary user", id: "legacy-user", claims: { role: "ADMIN" } },
  { name: "inactive administrator", id: "inactive-admin" },
  { name: "pending administrator", id: "pending-admin" },
  { name: "revoked administrator session", id: "revoked-admin" },
  { name: "deleted administrator", id: "missing-admin" },
]) {
  test(`administrative list denies ${denied.name} before querying users`, async () => {
    if (denied.id) await signInAs(denied.id, denied.claims);
    const response = await route.GET();
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Forbidden" });
    assert.equal(listQueries, 0);
    assert.deepEqual(unexpectedOperations, []);
  });
}

test("administrative list denies a tampered session cookie", async () => {
  await signInAs("legacy-admin");
  sessionCookie += "tampered";
  assert.equal((await route.GET()).status, 403);
  assert.equal(listQueries, 0);
});

test("pending and inactive accounts remain blocked in protected snapshots and route consumption", async () => {
  for (const id of ["pending-user", "inactive-user", "pending-admin", "inactive-admin"]) {
    await assert.rejects(access.getUserAccessSnapshot(id), {
      name: "AccessControlError", code: "ACCESS_BLOCKED", status: 403,
    });
    await assert.rejects(access.consumeRouteAllowance({
      userId: id, jobId: "never-created", role: accounts.get(id)!.role,
    }), { name: "AccessControlError", code: "ACCESS_BLOCKED", status: 403 });
  }
  assert.deepEqual(unexpectedOperations, []);
});

test("eligible legacy and confirmed accounts retain their protected access snapshots", async () => {
  for (const id of ["legacy-user", "confirmed-user", "blocked-user", "legacy-admin", "confirmed-admin"]) {
    assert.deepEqual(
      await access.getUserAccessSnapshot(id),
      await access.getAdminUserAccessSnapshot(id)
    );
  }
  assert.deepEqual(unexpectedOperations, []);
});

test("administrative inspection of a pending administrator preserves entitlements without enabling access", async () => {
  const snapshot = await access.getAdminUserAccessSnapshot("pending-admin");
  assert.equal(snapshot.isAdmin, true);
  assert.equal(snapshot.role, "ADMIN");
  assert.equal(snapshot.code, "ACCESS_BLOCKED");
  assert.equal(snapshot.canUseApp, false);
  assert.equal(snapshot.canStartRoute, false);
  assert.equal(snapshot.routeCreditsBalance, 9);
  assert.equal(snapshot.activeSubscription?.id, "subscription-pending-admin");
  assert.deepEqual(unexpectedOperations, []);
});

test("unexpected database failures remain errors instead of fabricated zero balances", async () => {
  await signInAs("legacy-admin");
  failSubscriptionRead = true;
  const response = await route.GET();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Erro ao listar usuários." });
  assert.deepEqual(unexpectedOperations, []);
});
