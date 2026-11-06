import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { prisma } from "./prisma";
import { secureDigest } from "./account-security";

export class AuthRequestError extends Error {
  constructor(message: string, public status = 400, public retryAfter = 0) { super(message); }
}

export async function consumeAuthLimit(scope: string, identity: string, limit: number, windowMs: number) {
  const key = secureDigest("AUTH_RATE_LIMIT_SECRET", scope, identity);
  const window = Math.floor(Date.now() / windowMs);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO "ApiUsageCounter" ("id", "service", "periodType", "periodKey", "count", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${`AUTH:${scope}:${key}`}, 'MINUTE', ${String(window)}, 1, NOW(), NOW())
    ON CONFLICT ("service", "periodType", "periodKey")
    DO UPDATE SET "count" = "ApiUsageCounter"."count" + 1, "updatedAt" = NOW()
    RETURNING "count"
  `);
  if (!rows[0] || rows[0].count > limit) {
    throw new AuthRequestError("Muitas solicitações. Aguarde para tentar novamente.", 429, Math.ceil(((window + 1) * windowMs - Date.now()) / 1000));
  }
}

export async function limitAuthRequest(headers: Headers, scope: string, email: string) {
  // Always enforce identity and global limits. IP is supplementary, never proof of uniqueness.
  await consumeAuthLimit(`${scope}:global`, "all", scope === "register" ? 100 : 300, 60_000);
  await consumeAuthLimit(`${scope}:email`, email, scope === "verify" ? 20 : 5, 60 * 60_000);
  const ip = process.env.AUTH_TRUST_PROXY === "1" ? headers.get("cf-connecting-ip")?.trim() : null;
  if (ip && isIP(ip)) await consumeAuthLimit(`${scope}:ip`, ip, 30, 60 * 60_000);
}

let lastPrune = 0;
export async function pruneAuthData() {
  if (Date.now() - lastPrune < 60 * 60_000) return;
  lastPrune = Date.now();
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  await prisma.apiUsageCounter.deleteMany({ where: { service: { startsWith: "AUTH:" }, NOT: { service: { startsWith: "AUTH:mail:" } }, updatedAt: { lt: cutoff } } });
  await prisma.apiUsageCounter.deleteMany({ where: { service: { startsWith: "AUTH:mail:" }, updatedAt: { lt: new Date(Date.now() - 62 * 24 * 60 * 60_000) } } });
  await prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: cutoff } } });
}
