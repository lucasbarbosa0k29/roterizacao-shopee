import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type SubscriptionListRow = {
  id: string;
  latestSubscriptionId: string | null;
  latestPaymentId: string | null;
  planOrigin: string;
  subscriptionStatusLabel: string;
};

type SubscriptionSummary = {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  activePlans: number;
  basicPlans: number;
  proPlans: number;
  freePlans: number;
  usersWithCredits: number;
  expiredPlans: number;
  pendingPayments: number;
};

type PaymentTotals = {
  revenueCommercialTotalCents: number;
  revenueCommercialMonthCents: number;
  revenueCommercial30dCents: number;
  revenueInternalTestTotalCents: number;
  revenueInternalTestMonthCents: number;
  commercialCount: number;
  basicPlansSold: number;
  proPlansSold: number;
  extraRouteTransactions: number;
  extraRouteUnits: number;
  extraRouteRevenueCents: number;
};

type PlanTotals = { mrrBasicCents: number; mrrProCents: number };

const filters: Record<string, Prisma.Sql> = {
  ACTIVE: Prisma.sql`active`,
  INACTIVE: Prisma.sql`NOT active`,
  BASIC: Prisma.sql`code = 'BASIC'`,
  PRO: Prisma.sql`code = 'PRO'`,
  NO_PLAN: Prisma.sql`code IS NULL`,
  WITH_CREDITS: Prisma.sql`"creditsAvailable" > 0`,
  NO_CREDITS: Prisma.sql`"creditsAvailable" <= 0`,
  EXPIRED: Prisma.sql`"subscriptionStatusLabel" = 'VENCIDO'`,
  PENDING: Prisma.sql`"subscriptionStatusLabel" = 'PAGAMENTO PENDENTE'`,
};

function utcTimestamp(date: Date) {
  // Prisma stores DateTime in timestamp columns as UTC. Bind an explicit UTC
  // wall time so the PostgreSQL session timezone does not shift comparisons.
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

// Read-only projection used to filter and count globally before loading a page.
// Match the cycle and allowance rules in subscription-cycles.ts and access-control.ts.
export async function listAdminSubscriptionIds(
  now: Date, filter: string, query: string, requestedPage: number, pageSize: number,
) {
  const predicate = Object.hasOwn(filters, filter) ? filters[filter] : Prisma.sql`true`;
  const dbNow = utcTimestamp(now);
  const [result] = await prisma.$queryRaw<{
    rows: SubscriptionListRow[]; summary: SubscriptionSummary; total: number;
  }[]>`
    WITH balances AS (
      SELECT "userId", sum(delta) AS amount FROM "RouteCredit" GROUP BY "userId"
    ), facts AS (
      SELECT u.id, u.name, u.email, u.active, current_cycle.code, current_cycle.source,
        latest.id AS "latestSubscriptionId", latest.status AS "latestStatus", latest."expiresAt" AS "latestExpiry",
        payment.id AS "latestPaymentId", payment.status AS "paymentStatus", payment.provider, payment."productType",
        u."accessBlockedAt" IS NOT NULL OR NOT eligible.ok AS blocked,
        coalesce(balances.amount, 0) AS "routeCreditsBalance",
        coalesce(balances.amount, 0) + CASE WHEN current_cycle.id IS NULL THEN 0 ELSE greatest(0,
          current_cycle."dailyRouteLimit" * least(
            greatest(0, (timezone('America/Sao_Paulo', least(${dbNow}, coalesce(current_cycle."expiresAt", ${dbNow})) AT TIME ZONE 'UTC'))::date
              - (timezone('America/Sao_Paulo', current_cycle."startsAt" AT TIME ZONE 'UTC'))::date + 1),
            CASE WHEN current_cycle."expiresAt" IS NULL THEN 2147483647
              ELSE ceil(extract(epoch FROM current_cycle."expiresAt" - current_cycle."startsAt") / 86400) END
          ) - usage.count
        ) END AS "creditsAvailable"
      FROM "User" u
      CROSS JOIN LATERAL (
        SELECT u.active AND (NOT u."emailVerificationRequired" OR u."emailVerifiedAt" IS NOT NULL) AS ok
      ) eligible
      LEFT JOIN balances ON balances."userId" = u.id
      LEFT JOIN LATERAL (
        SELECT s.id, s.source, s."startsAt", s."expiresAt", p.code, p."dailyRouteLimit"
        FROM "UserSubscription" s JOIN "SubscriptionPlan" p ON p.id = s."planId"
        WHERE s."userId" = u.id AND NOT (u.role = 'ADMIN' AND eligible.ok)
          AND p."isActive" AND s."startsAt" <= ${dbNow}
          AND (s.status IN ('ACTIVE', 'SCHEDULED') AND s."expiresAt" > ${dbNow}
            OR s.status = 'ACTIVE' AND s."expiresAt" IS NULL)
        ORDER BY s."startsAt" DESC, s."createdAt" DESC, s.id DESC LIMIT 1
      ) current_cycle ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS count FROM "RouteUsage" r
        WHERE r."subscriptionId" = current_cycle.id AND r.source = 'SUBSCRIPTION_DAILY'
      ) usage ON current_cycle.id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT id, status, "expiresAt" FROM "UserSubscription"
        WHERE "userId" = u.id AND "startsAt" <= ${dbNow}
        ORDER BY "startsAt" DESC, "createdAt" DESC, id DESC LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT id, provider, "productType", status FROM "PaymentTransaction"
        WHERE "userId" = u.id ORDER BY "createdAt" DESC, id DESC LIMIT 1
      ) payment ON true
    ), classified AS (
      SELECT *, CASE
        WHEN source = 'INFINITEPAY_LINK' THEN 'InfinitePay'
        WHEN source IN ('ADMIN_GRANT', 'TRIAL') THEN 'manual'
        WHEN code IS NOT NULL AND provider = 'ASAAS' AND "paymentStatus" IN ('APPROVED', 'FULFILLED') THEN 'Asaas'
        WHEN source = 'MANUAL_PAYMENT' THEN 'Mercado Pago'
        WHEN "productType" IN ('BASIC_PLAN', 'PRO_PLAN') AND "paymentStatus" IN ('APPROVED', 'FULFILLED')
          THEN CASE provider WHEN 'INFINITEPAY' THEN 'InfinitePay' WHEN 'ASAAS' THEN 'Asaas' ELSE 'Mercado Pago' END
        WHEN "creditsAvailable" > 0 THEN 'avulso' ELSE 'sem plano'
      END AS "planOrigin", CASE
        WHEN blocked THEN 'BLOQUEADO'
        WHEN code IS NOT NULL THEN 'ATIVO'
        WHEN "paymentStatus" IN ('PENDING', 'REQUIRES_ACTION') THEN 'PAGAMENTO PENDENTE'
        WHEN "latestExpiry" < ${dbNow} THEN 'VENCIDO'
        WHEN "latestStatus" = 'REVOKED' THEN 'PAUSADO'
        WHEN "latestStatus" = 'EXPIRED' THEN 'VENCIDO'
        WHEN "creditsAvailable" > 0 THEN 'COM CRÉDITOS' ELSE 'SEM PLANO'
      END AS "subscriptionStatusLabel"
      FROM facts
    ), filtered AS (
      SELECT * FROM classified WHERE ${predicate} AND strpos(lower(concat_ws(' | ',
        id, coalesce(name, ''), email, coalesce(code::text, ''), "planOrigin")), lower(${query})) > 0
    ), totals AS (
      SELECT count(*)::int AS total FROM filtered
    ), page AS (
      SELECT id, "latestSubscriptionId", "latestPaymentId", "planOrigin", "subscriptionStatusLabel",
        row_number() OVER (ORDER BY lower(nullif(btrim(name), '')) NULLS LAST, lower(email), id) AS position
      FROM filtered ORDER BY position
      LIMIT ${pageSize} OFFSET (
        SELECT (least(${Math.min(requestedPage, 2147483647)}::int, greatest(1, ceil(total::numeric / ${pageSize})::int)) - 1)::bigint
          * ${pageSize} FROM totals
      )
    )
    SELECT totals.total,
      (SELECT coalesce(jsonb_agg(to_jsonb(page) - 'position' ORDER BY position), '[]'::jsonb) FROM page) AS rows,
      (SELECT jsonb_build_object(
        'totalUsers', count(*), 'activeUsers', count(*) FILTER (WHERE active),
        'inactiveUsers', count(*) FILTER (WHERE NOT active), 'activePlans', count(code),
        'basicPlans', count(*) FILTER (WHERE code = 'BASIC'),
        'proPlans', count(*) FILTER (WHERE code = 'PRO'), 'freePlans', count(*) FILTER (WHERE code = 'FREE'),
        'usersWithCredits', count(*) FILTER (WHERE "routeCreditsBalance" > 0),
        'expiredPlans', count(*) FILTER (WHERE "subscriptionStatusLabel" = 'VENCIDO'),
        'pendingPayments', count(*) FILTER (WHERE "subscriptionStatusLabel" = 'PAGAMENTO PENDENTE')
      ) FROM classified) AS summary
    FROM totals
  `;
  return result;
}

export async function getAdminFinancialSummary(now: Date) {
  const dbNow = utcTimestamp(now);
  const monthStart = utcTimestamp(new Date(now.getFullYear(), now.getMonth(), 1));
  const last30Days = utcTimestamp(new Date(now.getTime() - 30 * 86_400_000));
  const internalEmails = Prisma.join(["teste123@gmail.com", "123@gmail.com"]);
  const [totals] = await prisma.$queryRaw<{ payments: PaymentTotals; plans: PlanTotals }[]>`
    WITH payments AS (
      SELECT p."productType", p.quantity, p."amountCents" AS amount, p."createdAt",
        u.role = 'USER' AND lower(u.email) NOT IN (${internalEmails}) AS commercial
      FROM "PaymentTransaction" p JOIN "User" u ON u.id = p."userId"
      WHERE p.status IN ('APPROVED', 'FULFILLED')
    ), plans AS (
      SELECT p.code FROM "UserSubscription" s
      JOIN "SubscriptionPlan" p ON p.id = s."planId" JOIN "User" u ON u.id = s."userId"
      WHERE s."startsAt" <= ${dbNow} AND s."expiresAt" > ${dbNow} AND s.status IN ('ACTIVE', 'SCHEDULED')
        AND p."isActive" AND p.code IN ('BASIC', 'PRO') AND u.role = 'USER' AND u.email NOT IN (${internalEmails})
    )
    SELECT (SELECT jsonb_build_object(
      'revenueCommercialTotalCents', coalesce(sum(amount) FILTER (WHERE commercial), 0),
      'revenueCommercialMonthCents', coalesce(sum(amount) FILTER (WHERE commercial AND "createdAt" >= ${monthStart}), 0),
      'revenueCommercial30dCents', coalesce(sum(amount) FILTER (WHERE commercial AND "createdAt" >= ${last30Days}), 0),
      'revenueInternalTestTotalCents', coalesce(sum(amount) FILTER (WHERE NOT commercial), 0),
      'revenueInternalTestMonthCents', coalesce(sum(amount) FILTER (WHERE NOT commercial AND "createdAt" >= ${monthStart}), 0),
      'commercialCount', count(*) FILTER (WHERE commercial),
      'basicPlansSold', count(*) FILTER (WHERE commercial AND "productType" = 'BASIC_PLAN'),
      'proPlansSold', count(*) FILTER (WHERE commercial AND "productType" = 'PRO_PLAN'),
      'extraRouteTransactions', count(*) FILTER (WHERE commercial AND "productType" = 'EXTRA_ROUTE'),
      'extraRouteUnits', coalesce(sum(quantity) FILTER (WHERE commercial AND "productType" = 'EXTRA_ROUTE'), 0),
      'extraRouteRevenueCents', coalesce(sum(amount) FILTER (WHERE commercial AND "productType" = 'EXTRA_ROUTE'), 0)
    ) FROM payments) AS payments, (SELECT jsonb_build_object(
      'mrrBasicCents', count(*) FILTER (WHERE code = 'BASIC') * 3999,
      'mrrProCents', count(*) FILTER (WHERE code = 'PRO') * 6999
    ) FROM plans) AS plans
  `;
  const { commercialCount, ...payments } = totals.payments;
  return {
    ...payments,
    ...totals.plans,
    plansSold: payments.basicPlansSold + payments.proPlansSold,
    mrrTotalCents: totals.plans.mrrBasicCents + totals.plans.mrrProCents,
    ticketAverageCents: commercialCount ? payments.revenueCommercialTotalCents / commercialCount : 0,
  };
}
