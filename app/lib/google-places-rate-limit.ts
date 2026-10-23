import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { ApiUsagePeriodType, Prisma } from "@prisma/client";

export type GooglePlacesSearchMode = "new" | "compare";

export type GooglePlacesRateLimitConfig = {
  newUserPerMinute: number;
  newUserPerDay: number;
  newIpPerMinute: number;
  compareUserPerMinute: number;
  compareUserPerDay: number;
  compareIpPerMinute: number;
  trustProxy: boolean;
  compareUserIds: Set<string>;
  compareEmails: Set<string>;
};

export type GooglePlacesRateLimitResult = {
  allowed: boolean;
  dimension: "user-minute" | "user-day" | "ip-minute";
  count: number;
  limit: number;
  retryAfterSeconds: number;
};

type IncrementCounter = (input: {
  service: string;
  periodKey: string;
  periodType?: ApiUsagePeriodType;
}) => Promise<number>;

const DEFAULT_CONFIG: Omit<GooglePlacesRateLimitConfig, "compareUserIds" | "compareEmails"> = {
  newUserPerMinute: 10,
  newUserPerDay: 100,
  newIpPerMinute: 20,
  compareUserPerMinute: 2,
  compareUserPerDay: 20,
  compareIpPerMinute: 4,
  trustProxy: false,
};

let lastPruneAt = 0;

async function getPrisma() {
  const prismaModule = await import("./prisma");
  return prismaModule.prisma;
}

function readNonNegativeInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readList(env: NodeJS.ProcessEnv, name: string) {
  return new Set(
    String(env[name] ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function readGooglePlacesRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): GooglePlacesRateLimitConfig {
  return {
    newUserPerMinute: readNonNegativeInt(
      env,
      "GOOGLE_PLACES_NEW_USER_PER_MINUTE",
      DEFAULT_CONFIG.newUserPerMinute,
    ),
    newUserPerDay: readNonNegativeInt(
      env,
      "GOOGLE_PLACES_NEW_USER_PER_DAY",
      DEFAULT_CONFIG.newUserPerDay,
    ),
    newIpPerMinute: readNonNegativeInt(
      env,
      "GOOGLE_PLACES_NEW_IP_PER_MINUTE",
      DEFAULT_CONFIG.newIpPerMinute,
    ),
    compareUserPerMinute: readNonNegativeInt(
      env,
      "GOOGLE_PLACES_COMPARE_USER_PER_MINUTE",
      DEFAULT_CONFIG.compareUserPerMinute,
    ),
    compareUserPerDay: readNonNegativeInt(
      env,
      "GOOGLE_PLACES_COMPARE_USER_PER_DAY",
      DEFAULT_CONFIG.compareUserPerDay,
    ),
    compareIpPerMinute: readNonNegativeInt(
      env,
      "GOOGLE_PLACES_COMPARE_IP_PER_MINUTE",
      DEFAULT_CONFIG.compareIpPerMinute,
    ),
    trustProxy: env.GOOGLE_PLACES_TRUST_PROXY === "1",
    compareUserIds: readList(env, "GOOGLE_PLACES_COMPARE_USER_IDS"),
    compareEmails: readList(env, "GOOGLE_PLACES_COMPARE_EMAILS"),
  };
}

export function isCompareAuthorized(
  principal: { id?: unknown; email?: unknown; role?: unknown },
  config: GooglePlacesRateLimitConfig,
) {
  if (String(principal.role ?? "").toUpperCase() !== "ADMIN") return false;
  const id = String(principal.id ?? "").trim().toLowerCase();
  const email = String(principal.email ?? "").trim().toLowerCase();
  return Boolean(
    (id && config.compareUserIds.has(id)) || (email && config.compareEmails.has(email)),
  );
}

function validAddress(value: string | null | undefined) {
  return Boolean(value && isIP(value.trim()));
}

export function getTrustedClientIp(
  headers: Headers,
  trustProxy: boolean,
) {
  if (!trustProxy) return null;

  // Render may append to X-Forwarded-For, so a client can control one of
  // its entries. Only trust the edge header that Render/Cloudflare replaces.
  const renderClientIp = headers.get("cf-connecting-ip")?.trim();
  return validAddress(renderClientIp) ? renderClientIp! : null;
}

function hashIp(ip: string) {
  const secret = process.env.NEXTAUTH_SECRET || "google-places-rate-limit";
  return createHash("sha256").update(`${secret}:${ip}`).digest("hex");
}

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

function utcMinute(now: Date) {
  return Math.floor(now.getTime() / 60_000).toString();
}

export async function incrementGooglePlacesCounter({
  service,
  periodKey,
  periodType = ApiUsagePeriodType.MINUTE,
}: Parameters<IncrementCounter>[0]) {
  const prisma = await getPrisma();
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO "ApiUsageCounter"
      ("id", "service", "periodType", "periodKey", "count", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${service}, ${periodType}::"ApiUsagePeriodType", ${periodKey}, 1, NOW(), NOW())
    ON CONFLICT ("service", "periodType", "periodKey")
    DO UPDATE SET "count" = "ApiUsageCounter"."count" + 1, "updatedAt" = NOW()
    RETURNING "count"
  `);

  return Number(rows[0]?.count ?? 0);
}

async function pruneOldGooglePlacesCounters(now: Date) {
  if (now.getTime() - lastPruneAt < 10 * 60_000) return;
  lastPruneAt = now.getTime();
  const prisma = await getPrisma();
  const rateLimitCutoff = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
  const fallbackMetricCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  await prisma.apiUsageCounter.deleteMany({
    where: {
      OR: [
        {
          service: { startsWith: "GOOGLE_PLACES_MANUAL:" },
          updatedAt: { lt: rateLimitCutoff },
        },
        {
          service: { startsWith: "GOOGLE_PLACES_FALLBACK:" },
          updatedAt: { lt: fallbackMetricCutoff },
        },
      ],
    },
  });
}

function getLimits(mode: GooglePlacesSearchMode, config: GooglePlacesRateLimitConfig) {
  return mode === "compare"
    ? {
        userPerMinute: config.compareUserPerMinute,
        userPerDay: config.compareUserPerDay,
        ipPerMinute: config.compareIpPerMinute,
      }
    : {
        userPerMinute: config.newUserPerMinute,
        userPerDay: config.newUserPerDay,
        ipPerMinute: config.newIpPerMinute,
      };
}

function denied(
  dimension: GooglePlacesRateLimitResult["dimension"],
  count: number,
  limit: number,
  retryAfterSeconds: number,
): GooglePlacesRateLimitResult {
  return { allowed: false, dimension, count, limit, retryAfterSeconds };
}

export async function consumeGooglePlacesRateLimit(input: {
  userId: string;
  mode: GooglePlacesSearchMode;
  clientIp?: string | null;
  now?: Date;
  config?: GooglePlacesRateLimitConfig;
  incrementCounter?: IncrementCounter;
}): Promise<GooglePlacesRateLimitResult> {
  const now = input.now ?? new Date();
  const config = input.config ?? readGooglePlacesRateLimitConfig();
  const increment = input.incrementCounter ?? incrementGooglePlacesCounter;
  const limits = getLimits(input.mode, config);

  if (!input.incrementCounter) {
    void pruneOldGooglePlacesCounters(now).catch((error) => {
      console.warn("[GOOGLE_PLACES_RATE_LIMIT_PRUNE_ERROR]", error);
    });
  }

  const servicePrefix = `GOOGLE_PLACES_MANUAL:${input.mode}`;
  const userMinute = await increment({
    service: `${servicePrefix}:USER:${input.userId}:MINUTE`,
    periodKey: utcMinute(now),
  });
  if (limits.userPerMinute === 0 || userMinute > limits.userPerMinute) {
    return denied("user-minute", userMinute, limits.userPerMinute, 60);
  }

  const userDay = await increment({
    service: `${servicePrefix}:USER:${input.userId}:DAY`,
    periodKey: utcDay(now),
    periodType: ApiUsagePeriodType.DAY,
  });
  if (limits.userPerDay === 0 || userDay > limits.userPerDay) {
    return denied("user-day", userDay, limits.userPerDay, 86_400);
  }

  if (input.clientIp && limits.ipPerMinute >= 0) {
    const ipMinute = await increment({
      service: `${servicePrefix}:IP:${hashIp(input.clientIp)}:MINUTE`,
      periodKey: utcMinute(now),
    });
    if (limits.ipPerMinute === 0 || ipMinute > limits.ipPerMinute) {
      return denied("ip-minute", ipMinute, limits.ipPerMinute, 60);
    }
  }

  return {
    allowed: true,
    dimension: "user-minute",
    count: userMinute,
    limit: limits.userPerMinute,
    retryAfterSeconds: 0,
  };
}
