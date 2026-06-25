import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { requireAdmin } from "@/app/lib/admin-roles";
import { prisma } from "@/app/lib/prisma";
import { LocalFirstAliasStatus } from "@prisma/client";
import { getLocalFirstAliasCityVariants } from "@/app/lib/local-first-aliases";

export const runtime = "nodejs";

const CITY_GOIANIA = "GOIANIA";
const CITY_APARECIDA_VARIANTS = getLocalFirstAliasCityVariants("APARECIDA");

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return startOfDay(date);
}

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!requireAdmin(session?.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const todayStart = startOfDay(new Date());
    const last7DaysStart = daysAgo(6);

    const [
      totalAliases,
      approved,
      pending,
      rejected,
      disabled,
      totalUsageAgg,
      approvedGoiania,
      approvedAparecida,
      pendingGoiania,
      pendingAparecida,
      aliasesUsedToday,
      aliasesUsedLast7Days,
    ] = await Promise.all([
      prisma.localFirstAlias.count(),
      prisma.localFirstAlias.count({ where: { status: LocalFirstAliasStatus.APPROVED } }),
      prisma.localFirstAlias.count({ where: { status: LocalFirstAliasStatus.PENDING } }),
      prisma.localFirstAlias.count({ where: { status: LocalFirstAliasStatus.REJECTED } }),
      prisma.localFirstAlias.count({ where: { status: LocalFirstAliasStatus.DISABLED } }),
      prisma.localFirstAlias.aggregate({
        _sum: { usageCount: true },
      }),
      prisma.localFirstAlias.count({
        where: {
          status: LocalFirstAliasStatus.APPROVED,
          city: CITY_GOIANIA,
        },
      }),
      prisma.localFirstAlias.count({
        where: {
          status: LocalFirstAliasStatus.APPROVED,
          city: { in: CITY_APARECIDA_VARIANTS },
        },
      }),
      prisma.localFirstAlias.count({
        where: {
          status: LocalFirstAliasStatus.PENDING,
          city: CITY_GOIANIA,
        },
      }),
      prisma.localFirstAlias.count({
        where: {
          status: LocalFirstAliasStatus.PENDING,
          city: { in: CITY_APARECIDA_VARIANTS },
        },
      }),
      prisma.localFirstAlias.count({
        where: {
          lastUsedAt: {
            gte: todayStart,
          },
        },
      }),
      prisma.localFirstAlias.count({
        where: {
          lastUsedAt: {
            gte: last7DaysStart,
          },
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      stats: {
        totalAliases,
        approved,
        pending,
        rejected,
        disabled,
        totalUsage: totalUsageAgg._sum.usageCount ?? 0,
        approvedGoiania,
        approvedAparecida,
        pendingGoiania,
        pendingAparecida,
        aliasesUsedToday,
        aliasesUsedLast7Days,
      },
    });
  } catch (error) {
    console.error("GET /api/admin/local-first-aliases/stats error:", error);
    return NextResponse.json(
      { error: "Erro ao carregar métricas de aliases." },
      { status: 500 },
    );
  }
}
