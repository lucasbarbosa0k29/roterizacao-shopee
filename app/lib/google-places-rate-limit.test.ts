import test from "node:test";
import assert from "node:assert/strict";
const rateLimitModule: typeof import("./google-places-rate-limit") = await import(
  new URL("./google-places-rate-limit.ts", import.meta.url).href
);
const {
  consumeGooglePlacesRateLimit,
  getTrustedClientIp,
  isCompareAuthorized,
  readGooglePlacesRateLimitConfig,
} = rateLimitModule;

function makeConfig(overrides: Partial<ReturnType<typeof readGooglePlacesRateLimitConfig>> = {}) {
  return {
    ...readGooglePlacesRateLimitConfig({ NODE_ENV: "test" }),
    ...overrides,
  };
}

test("rate limit atômico permite somente o limite em chamadas concorrentes", async () => {
  const counters = new Map<string, number>();
  const incrementCounter = async ({ service, periodKey }: { service: string; periodKey: string }) => {
    const key = `${service}:${periodKey}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  };
  const config = makeConfig({
    newUserPerMinute: 3,
    newUserPerDay: 100,
    newIpPerMinute: 100,
  });

  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      consumeGooglePlacesRateLimit({
        userId: "user-1",
        mode: "new",
        config,
        incrementCounter,
      }),
    ),
  );

  assert.equal(results.filter((result) => result.allowed).length, 3);
  assert.equal(results.filter((result) => !result.allowed)[0]?.dimension, "user-minute");
});

test("rate limit por IP é aplicado depois do limite do usuário", async () => {
  const counters = new Map<string, number>();
  const incrementCounter = async ({ service, periodKey }: { service: string; periodKey: string }) => {
    const key = `${service}:${periodKey}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  };
  const config = makeConfig({
    newUserPerMinute: 20,
    newUserPerDay: 100,
    newIpPerMinute: 2,
  });

  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      consumeGooglePlacesRateLimit({
        userId: "user-1",
        mode: "new",
        clientIp: "192.0.2.1",
        config,
        incrementCounter,
      }),
    ),
  );

  assert.equal(results.filter((result) => result.allowed).length, 2);
  assert.equal(results.find((result) => !result.allowed)?.dimension, "ip-minute");
});

test("IP encaminhado só é usado quando o proxy está explicitamente confiável", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.5, 10.0.0.1",
    "x-real-ip": "198.51.100.5",
    "cf-connecting-ip": "203.0.113.10",
  });
  assert.equal(getTrustedClientIp(headers, false), null);
  assert.equal(getTrustedClientIp(headers, true), "203.0.113.10");
});

test("não aceita X-Forwarded-For ou X-Real-IP como identidade confiável", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.5",
    "x-real-ip": "198.51.100.5",
  });
  assert.equal(getTrustedClientIp(headers, true), null);
});

test("compare exige ADMIN e allowlist interna", () => {
  const config = makeConfig({
    compareUserIds: new Set(["admin-1"]),
    compareEmails: new Set(["qa@example.com"]),
  });
  assert.equal(isCompareAuthorized({ id: "admin-1", role: "ADMIN" }, config), true);
  assert.equal(isCompareAuthorized({ id: "user-1", role: "USER" }, config), false);
  assert.equal(isCompareAuthorized({ email: "qa@example.com", role: "ADMIN" }, config), true);
  assert.equal(isCompareAuthorized({ email: "other@example.com", role: "ADMIN" }, config), false);
});
