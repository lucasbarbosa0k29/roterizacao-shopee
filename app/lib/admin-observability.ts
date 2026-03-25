import { ApiUsagePeriodType, Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

export const METRIC_DISCOVER = "HERE_DISCOVER";
export const METRIC_MEMORY_CREATE_OK = "ADDRESS_MEMORY_CREATE_OK";
export const METRIC_MEMORY_UPDATE_OK = "ADDRESS_MEMORY_UPDATE_OK";
export const METRIC_MEMORY_HIT_ONLY = "ADDRESS_MEMORY_HIT_ONLY";
export const METRIC_MEMORY_SAVE_ERROR = "ADDRESS_MEMORY_SAVE_ERROR";
export const METRIC_MEMORY_BATCH_SAVE_OK = "ADDRESS_MEMORY_BATCH_SAVE_OK";
export const METRIC_MEMORY_BATCH_SAVE_ERROR = "ADDRESS_MEMORY_BATCH_SAVE_ERROR";
export const METRIC_MEMORY_HIT_TOTAL = "MEMORY_HIT_TOTAL";
export const METRIC_MEMORY_LOOKUP_TOTAL = "MEMORY_LOOKUP_TOTAL";

const OBS_DAYS = 7;
const APP_TIMEZONE = "America/Sao_Paulo";

export type MemoryHealth = "OK" | "ATENCAO" | "CRITICO";

export type ObservabilityRow = {
  day: string;
  dayKey: string;
  discoverToday: number;
  memoryCreated: number;
  memoryTotalAccumulated: number;
  manualCreateOk: number;
  manualUpdateOk: number;
  manualHitOnly: number;
  manualSaveError: number;
  manualSaveOkTotal: number;
  batchSaveOk: number;
  batchSaveError: number;
  memoryHealth: MemoryHealth;
};

export type AdminObservabilitySnapshot = {
  discoverMonth: number;
  discoverToday: number;
  memoryHitToday: number;
  memoryLookupToday: number;
  memoryHitRateToday: number;
  memoryTotalStored: number;
  memoryCreatedToday: number;
  manualCreateOkToday: number;
  manualUpdateOkToday: number;
  manualHitOnlyToday: number;
  manualSaveErrorToday: number;
  manualSaveOkToday: number;
  batchSaveOkToday: number;
  batchSaveErrorToday: number;
  memoryHealth: MemoryHealth;
  dailyRows: ObservabilityRow[];
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function getMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

export function getDayKey(now = new Date()) {
  return `${getMonthKey(now)}-${pad2(now.getDate())}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getRecentDays(now = new Date(), days = OBS_DAYS) {
  const today = startOfDay(now);
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(today, -(days - 1 - index));
    return {
      key: getDayKey(date),
      label: date.toLocaleDateString("pt-BR"),
      start: date,
    };
  });
}

function buildCounterMap(
  rows: Array<{ service: string; periodKey: string; count: number }>,
  service: string,
) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.service === service) {
      map.set(row.periodKey, row.count);
    }
  }
  return map;
}

function calculateMemoryHealth(params: {
  manualCreateOk: number;
  manualUpdateOk: number;
  manualHitOnly: number;
  manualSaveError: number;
  batchSaveOk: number;
  batchSaveError: number;
}): MemoryHealth {
  const todaySuccesses =
    params.manualCreateOk +
    params.manualUpdateOk +
    params.manualHitOnly +
    params.batchSaveOk;

  const todayErrors = params.manualSaveError + params.batchSaveError;
  const todayAttempts = todaySuccesses + todayErrors;
  const errorRate = todayAttempts > 0 ? todayErrors / todayAttempts : 0;

  if (todayErrors >= 10 || errorRate >= 0.2) {
    return "CRITICO";
  }

  if (todayErrors >= 3 || (errorRate >= 0.05 && errorRate < 0.2)) {
    return "ATENCAO";
  }

  if (todayErrors === 0 || (todayErrors <= 2 && errorRate < 0.05)) {
    return "OK";
  }

  return "ATENCAO";
}

export async function incrementDailyMetric(service: string) {
  const dayKey = getDayKey();

  await prisma.apiUsageCounter.upsert({
    where: {
      service_periodType_periodKey: {
        service,
        periodType: ApiUsagePeriodType.DAY,
        periodKey: dayKey,
      },
    },
    update: {
      count: { increment: 1 },
    },
    create: {
      service,
      periodType: ApiUsagePeriodType.DAY,
      periodKey: dayKey,
      count: 1,
    },
  });
}

export async function getAdminObservabilitySnapshot(
  now = new Date(),
): Promise<AdminObservabilitySnapshot> {
  const monthKey = getMonthKey(now);
  const todayKey = getDayKey(now);
  const recentDays = getRecentDays(now, OBS_DAYS);
  const dayKeys = recentDays.map((d) => d.key);

  const trackedServices = [
    METRIC_DISCOVER,
    METRIC_MEMORY_HIT_TOTAL,
    METRIC_MEMORY_LOOKUP_TOTAL,
    METRIC_MEMORY_CREATE_OK,
    METRIC_MEMORY_UPDATE_OK,
    METRIC_MEMORY_HIT_ONLY,
    METRIC_MEMORY_SAVE_ERROR,
    METRIC_MEMORY_BATCH_SAVE_OK,
    METRIC_MEMORY_BATCH_SAVE_ERROR,
  ];

  const [discoverMonthRow, dailyCounterRows, createdRows, memoryTotalStored] = await Promise.all([
    prisma.apiUsageCounter.findUnique({
      where: {
        service_periodType_periodKey: {
          service: METRIC_DISCOVER,
          periodType: ApiUsagePeriodType.MONTH,
          periodKey: monthKey,
        },
      },
      select: { count: true },
    }),
    prisma.apiUsageCounter.findMany({
      where: {
        service: { in: trackedServices },
        periodType: ApiUsagePeriodType.DAY,
        periodKey: { in: dayKeys },
      },
      select: {
        service: true,
        periodKey: true,
        count: true,
      },
    }),
    prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
      SELECT
        TO_CHAR(DATE_TRUNC('day', "createdAt" AT TIME ZONE ${APP_TIMEZONE}), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM "AddressMemory"
      WHERE "createdAt" >= ${recentDays[0].start}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.addressMemory.count(),
  ]);

  const createdMap = new Map(
    createdRows.map((row) => [row.day, Number(row.count)]),
  );

  const discoverMap = buildCounterMap(dailyCounterRows, METRIC_DISCOVER);
  const memoryHitMap = buildCounterMap(dailyCounterRows, METRIC_MEMORY_HIT_TOTAL);
  const memoryLookupMap = buildCounterMap(dailyCounterRows, METRIC_MEMORY_LOOKUP_TOTAL);
  const manualCreateMap = buildCounterMap(dailyCounterRows, METRIC_MEMORY_CREATE_OK);
  const manualUpdateMap = buildCounterMap(dailyCounterRows, METRIC_MEMORY_UPDATE_OK);
  const manualHitOnlyMap = buildCounterMap(dailyCounterRows, METRIC_MEMORY_HIT_ONLY);
  const manualErrorMap = buildCounterMap(dailyCounterRows, METRIC_MEMORY_SAVE_ERROR);
  const batchOkMap = buildCounterMap(dailyCounterRows, METRIC_MEMORY_BATCH_SAVE_OK);
  const batchErrorMap = buildCounterMap(dailyCounterRows, METRIC_MEMORY_BATCH_SAVE_ERROR);

  const dailyRowsBase = recentDays
    .map(({ key, label }) => {
      const discoverToday = discoverMap.get(key) ?? 0;
      const memoryCreated = createdMap.get(key) ?? 0;
      const manualCreateOk = manualCreateMap.get(key) ?? 0;
      const manualUpdateOk = manualUpdateMap.get(key) ?? 0;
      const manualHitOnly = manualHitOnlyMap.get(key) ?? 0;
      const manualSaveError = manualErrorMap.get(key) ?? 0;
      const batchSaveOk = batchOkMap.get(key) ?? 0;
      const batchSaveError = batchErrorMap.get(key) ?? 0;
      const manualSaveOkTotal =
        manualCreateOk + manualUpdateOk + manualHitOnly;

      return {
        day: label,
        dayKey: key,
        discoverToday,
        memoryCreated,
        memoryTotalAccumulated: 0,
        manualCreateOk,
        manualUpdateOk,
        manualHitOnly,
        manualSaveError,
        manualSaveOkTotal,
        batchSaveOk,
        batchSaveError,
        memoryHealth: calculateMemoryHealth({
          manualCreateOk,
          manualUpdateOk,
          manualHitOnly,
          manualSaveError,
          batchSaveOk,
          batchSaveError,
        }),
      };
    })
    .reverse();

  let runningTotal = memoryTotalStored;
  const dailyRows = dailyRowsBase.map((row, index) => {
    const nextRow = {
      ...row,
      memoryTotalAccumulated: runningTotal,
    };

    const nextDay = dailyRowsBase[index + 1];
    if (nextDay) {
      runningTotal -= nextDay.memoryCreated;
    }

    return nextRow;
  });

  const todayRow = dailyRows.find((row) => row.dayKey === todayKey);
  const memoryHitToday = memoryHitMap.get(todayKey) ?? 0;
  const memoryLookupToday = memoryLookupMap.get(todayKey) ?? 0;
  const memoryHitRateToday =
    memoryLookupToday > 0
      ? Math.round((memoryHitToday / memoryLookupToday) * 100)
      : 0;

  return {
    discoverMonth: discoverMonthRow?.count ?? 0,
    discoverToday: discoverMap.get(todayKey) ?? 0,
    memoryHitToday,
    memoryLookupToday,
    memoryHitRateToday,
    memoryTotalStored,
    memoryCreatedToday: createdMap.get(todayKey) ?? 0,
    manualCreateOkToday: todayRow?.manualCreateOk ?? 0,
    manualUpdateOkToday: todayRow?.manualUpdateOk ?? 0,
    manualHitOnlyToday: todayRow?.manualHitOnly ?? 0,
    manualSaveErrorToday: todayRow?.manualSaveError ?? 0,
    manualSaveOkToday: todayRow?.manualSaveOkTotal ?? 0,
    batchSaveOkToday: todayRow?.batchSaveOk ?? 0,
    batchSaveErrorToday: todayRow?.batchSaveError ?? 0,
    memoryHealth: todayRow?.memoryHealth ?? "OK",
    dailyRows,
  };
}
