import {
  ApiUsagePeriodType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

const HERE_DISCOVER_SERVICE = "HERE_DISCOVER";
const RESERVE_RETRIES = 4;

type DbClient = PrismaClient | Prisma.TransactionClient;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DiscoverBudgetDecision = {
  allowed: boolean;
  reason: string;
  count: number;
  projected: number;
};

function normalizeCompareText(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function textIncludesEither(a: string, b: string) {
  const left = normalizeCompareText(a);
  const right = normalizeCompareText(b);
  return !!left && !!right && (left.includes(right) || right.includes(left));
}

function isAparecidaCityName(value: string) {
  const city = normalizeCompareText(value);
  return city.includes("APARECIDA");
}

function getEnvInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") {
    return fallback;
  }

  const num = Number(String(raw).trim());
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
}

export function getCurrentMonthKey(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function getCurrentDayKey(now = new Date()) {
  const day = String(now.getDate()).padStart(2, "0");
  return `${getCurrentMonthKey(now)}-${day}`;
}

function getMonthMetrics(now = new Date()) {
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = Math.max(now.getDate(), 1);
  const daysRemaining = Math.max(totalDays - now.getDate() + 1, 1);
  return { totalDays, daysPassed, daysRemaining };
}

function buildDiscoverBudgetDecision(params: {
  count: number;
  todayCount: number;
  now?: Date;
  reasonAllowed?: string;
}): DiscoverBudgetDecision {
  const now = params.now || new Date();
  const monthlyLimit = getEnvInt("HERE_DISCOVER_MONTHLY_LIMIT", 5000);
  const softLimit = getEnvInt("HERE_DISCOVER_SOFT_LIMIT", 4500);
  const { totalDays, daysPassed, daysRemaining } = getMonthMetrics(now);

  const count = Math.max(params.count, 0);
  const todayCount = Math.max(params.todayCount, 0);
  const projected = (count / daysPassed) * totalDays;
  const remaining = monthlyLimit - count;
  const dailyBudget = daysRemaining > 0 ? remaining / daysRemaining : 0;

  if (count >= monthlyLimit) {
    return {
      allowed: false,
      reason: `MONTHLY_LIMIT_REACHED ${count}/${monthlyLimit}`,
      count,
      projected,
    };
  }

  if (count >= softLimit) {
    return {
      allowed: false,
      reason: `SOFT_LIMIT_REACHED ${count}/${softLimit}`,
      count,
      projected,
    };
  }

  if (projected > monthlyLimit) {
    return {
      allowed: false,
      reason: `PROJECTION_EXCEEDED ${projected.toFixed(0)}/${monthlyLimit}`,
      count,
      projected,
    };
  }

  if (todayCount >= dailyBudget) {
    return {
      allowed: false,
      reason: `DAILY_BUDGET_EXCEEDED ${todayCount}/${dailyBudget.toFixed(2)}`,
      count,
      projected,
    };
  }

  return {
    allowed: true,
    reason: params.reasonAllowed || "DISCOVER_BUDGET_OK",
    count,
    projected,
  };
}

export function shouldAttemptDiscoverFromQuality(params: {
  geocodeItemCount: number;
  geocodeItemsWithCoords: number;
  bestGeocodeScoreOverall: number;
  bestGeocodeItem?: any;
  expectedCity?: string;
  expectedBairro?: string;
  expectedRua?: string;
  discoverQuery?: string;
  geocodeConfidence?: number;
  geocodeHardMismatch?: boolean;
  geocodeFlags?: string[];
}): { allowed: boolean; reason: string } {
  const {
    geocodeItemCount,
    geocodeItemsWithCoords,
    bestGeocodeScoreOverall,
    bestGeocodeItem,
    expectedCity,
    expectedBairro,
    expectedRua,
    discoverQuery,
    geocodeConfidence,
    geocodeHardMismatch,
    geocodeFlags,
  } = params;

  const bestAddress = bestGeocodeItem?.address || {};
  const bestCity = String(bestAddress?.city || bestAddress?.county || "");
  const bestBairro = String(bestAddress?.district || bestAddress?.subdistrict || "");
  const cityMismatch =
    !!expectedCity &&
    !!bestCity &&
    !textIncludesEither(expectedCity, bestCity);
  const bairroMismatch =
    !!expectedBairro &&
    !!bestBairro &&
    !textIncludesEither(expectedBairro, bestBairro);
  const aparecidaMismatch =
    !!expectedCity &&
    !!bestCity &&
    isAparecidaCityName(expectedCity) !== isAparecidaCityName(bestCity);

  const ruaNormalized = normalizeCompareText(expectedRua || "");
  const bairroNormalized = normalizeCompareText(expectedBairro || "");
  const cityNormalized = normalizeCompareText(expectedCity || "");
  const queryNormalized = normalizeCompareText(discoverQuery || "");

  const hasUsefulDiscoverQuery =
    !!queryNormalized &&
    (
      (ruaNormalized.length >= 6 && cityNormalized.length >= 4) ||
      (ruaNormalized.length >= 6 && bairroNormalized.length >= 5) ||
      (bairroNormalized.length >= 5 && cityNormalized.length >= 4)
    );

  const flags = new Set(geocodeFlags || []);
  const hasUsefulConfidenceFlag =
    flags.has("HERE_SPREAD_HIGH") ||
    flags.has("HERE_UNCERTAIN") ||
    flags.has("BAIRRO_MISMATCH") ||
    flags.has("CIDADE_MISMATCH") ||
    flags.has("RUA_MISMATCH");

  if (typeof geocodeConfidence === "number") {
    if (geocodeConfidence >= 85 && !geocodeHardMismatch) {
      return { allowed: false, reason: "CONFIDENCE_HIGH_SKIP_DISCOVER" };
    }

    if (geocodeHardMismatch) {
      if (!hasUsefulDiscoverQuery) {
        return { allowed: false, reason: "HARD_MISMATCH_QUERY_WEAK" };
      }
      return { allowed: true, reason: "HARD_MISMATCH_WITH_USEFUL_QUERY" };
    }

    if (geocodeConfidence >= 70 && geocodeConfidence <= 84) {
      if (hasUsefulConfidenceFlag && hasUsefulDiscoverQuery) {
        return { allowed: true, reason: "CONFIDENCE_MEDIUM_WITH_SIGNAL" };
      }
      return { allowed: false, reason: "CONFIDENCE_MEDIUM_SKIP_DISCOVER" };
    }

    if (geocodeConfidence < 70) {
      if (hasUsefulDiscoverQuery) {
        return { allowed: true, reason: "CONFIDENCE_LOW_WITH_USEFUL_QUERY" };
      }
      return { allowed: false, reason: "CONFIDENCE_LOW_QUERY_WEAK" };
    }
  }

  if (geocodeItemCount <= 0) {
    return { allowed: true, reason: "NO_GEOCODE_ITEMS" };
  }

  if (geocodeItemsWithCoords <= 0) {
    return { allowed: true, reason: "GEOCODE_WITHOUT_VALID_COORDS" };
  }

  if (bestGeocodeScoreOverall < 50) {
    return { allowed: true, reason: "GEOCODE_REALLY_BAD_SCORE" };
  }

  if (aparecidaMismatch) {
    return { allowed: true, reason: "GEOCODE_CITY_CLUSTER_MISMATCH" };
  }

  if (cityMismatch) {
    return { allowed: true, reason: "GEOCODE_CITY_MISMATCH" };
  }

  if (bairroMismatch && bestGeocodeScoreOverall < 95) {
    return { allowed: true, reason: "GEOCODE_BAIRRO_MISMATCH" };
  }

  if (bestGeocodeScoreOverall < 75) {
    return { allowed: true, reason: "GEOCODE_WEAK_WITH_COORDS" };
  }

  if (bestGeocodeScoreOverall >= 80) {
    return { allowed: false, reason: "GEOCODE_SCORE_GOOD_ENOUGH" };
  }

  return { allowed: false, reason: "GEOCODE_USABLE_SKIP_DISCOVER" };
}

export async function getDiscoverBudgetDecision(
  db: DbClient = prisma,
  now = new Date(),
): Promise<DiscoverBudgetDecision> {
  const monthKey = getCurrentMonthKey(now);
  const dayKey = getCurrentDayKey(now);
  const monthlyBootstrap = getEnvInt("HERE_DISCOVER_CURRENT_USAGE", 0);

  const [monthlyCounter, dailyCounter] = await Promise.all([
    db.apiUsageCounter.findUnique({
      where: {
        service_periodType_periodKey: {
          service: HERE_DISCOVER_SERVICE,
          periodType: ApiUsagePeriodType.MONTH,
          periodKey: monthKey,
        },
      },
      select: { count: true },
    }),
    db.apiUsageCounter.findUnique({
      where: {
        service_periodType_periodKey: {
          service: HERE_DISCOVER_SERVICE,
          periodType: ApiUsagePeriodType.DAY,
          periodKey: dayKey,
        },
      },
      select: { count: true },
    }),
  ]);

  console.info("[DISCOVER_DB_READ]", {
    monthCount: monthlyCounter?.count ?? monthlyBootstrap,
    dayCount: dailyCounter?.count ?? 0,
  });

  return buildDiscoverBudgetDecision({
    count: monthlyCounter?.count ?? monthlyBootstrap,
    todayCount: dailyCounter?.count ?? 0,
    now,
  });
}

export async function reserveDiscoverUsage(
  now = new Date(),
): Promise<DiscoverBudgetDecision> {
  const monthKey = getCurrentMonthKey(now);
  const dayKey = getCurrentDayKey(now);
  const monthlyBootstrap = getEnvInt("HERE_DISCOVER_CURRENT_USAGE", 0);

  for (let attempt = 0; attempt < RESERVE_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          console.info("[DISCOVER_DB_INCREMENT]", {
            monthKey,
            dayKey,
          });

          const monthWhere = {
            service_periodType_periodKey: {
              service: HERE_DISCOVER_SERVICE,
              periodType: ApiUsagePeriodType.MONTH,
              periodKey: monthKey,
            },
          };

          const dayWhere = {
            service_periodType_periodKey: {
              service: HERE_DISCOVER_SERVICE,
              periodType: ApiUsagePeriodType.DAY,
              periodKey: dayKey,
            },
          };

          const monthlyCounter = await tx.apiUsageCounter.upsert({
            where: monthWhere,
            update: {},
            create: {
              service: HERE_DISCOVER_SERVICE,
              periodType: ApiUsagePeriodType.MONTH,
              periodKey: monthKey,
              count: monthlyBootstrap,
            },
            select: { count: true },
          });

          const dailyCounter = await tx.apiUsageCounter.upsert({
            where: dayWhere,
            update: {},
            create: {
              service: HERE_DISCOVER_SERVICE,
              periodType: ApiUsagePeriodType.DAY,
              periodKey: dayKey,
              count: 0,
            },
            select: { count: true },
          });

          const decision = buildDiscoverBudgetDecision({
            count: monthlyCounter.count,
            todayCount: dailyCounter.count,
            now,
          });

          if (!decision.allowed) {
            return decision;
          }

          // 🔥 PERSISTENT DISCOVER USAGE COUNTER
          const updatedMonthlyCounter = await tx.apiUsageCounter.update({
            where: monthWhere,
            data: {
              count: { increment: 1 },
            },
            select: { count: true },
          });

          await tx.apiUsageCounter.update({
            where: dayWhere,
            data: {
              count: { increment: 1 },
            },
          });

          return buildDiscoverBudgetDecision({
            count: updatedMonthlyCounter.count,
            todayCount: dailyCounter.count + 1,
            now,
            reasonAllowed: "DISCOVER_RESERVED",
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error: any) {
      if (error?.code === "P2034" && attempt + 1 < RESERVE_RETRIES) {
        await sleep(25 * (attempt + 1) + Math.floor(Math.random() * 25));
        continue;
      }

      throw error;
    }
  }

  return {
    allowed: false,
    reason: "DISCOVER_RESERVE_FAILED",
    count: 0,
    projected: 0,
  };
}

export async function debugDiscoverUsage() {
  const rows = await prisma.apiUsageCounter.findMany({
    where: { service: "HERE_DISCOVER" },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  console.info("[DISCOVER_DEBUG_DB]", rows);
  return rows;
}
