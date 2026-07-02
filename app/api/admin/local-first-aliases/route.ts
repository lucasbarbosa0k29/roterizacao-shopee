import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { requireAdmin } from "@/app/lib/admin-roles";
import { prisma } from "@/app/lib/prisma";
import {
  LocalFirstAliasSource,
  LocalFirstAliasStatus,
  LocalFirstAliasType,
  Prisma,
} from "@prisma/client";
import {
  getLocalFirstAliasCityVariants,
  normalizeAliasText,
  normalizeLocalFirstAliasCity,
} from "@/app/lib/local-first-aliases";

export const runtime = "nodejs";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const VALID_SORT_FIELDS = ["createdAt", "updatedAt", "usageCount", "lastUsedAt"] as const;

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseEnumFilter<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  return (allowed as readonly string[]).includes(normalized)
    ? (normalized as T)
    : undefined;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!requireAdmin(session?.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const city = normalizeLocalFirstAliasCity(url.searchParams.get("city"));
    const cityVariants = city ? getLocalFirstAliasCityVariants(city) : [];
    const aliasType = parseEnumFilter(
      url.searchParams.get("aliasType"),
      Object.values(LocalFirstAliasType),
    );
    const status = parseEnumFilter(
      url.searchParams.get("status"),
      Object.values(LocalFirstAliasStatus),
    );
    const source = parseEnumFilter(
      url.searchParams.get("source"),
      Object.values(LocalFirstAliasSource),
    );
    const q = normalizeAliasText(url.searchParams.get("q"));
    const sortByParam = url.searchParams.get("sortBy");
    const sortDirParam = url.searchParams.get("sortDir");
    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      parsePositiveInt(url.searchParams.get("pageSize"), PAGE_SIZE_DEFAULT),
    );

    const sortBy = VALID_SORT_FIELDS.includes(sortByParam as any)
      ? (sortByParam as (typeof VALID_SORT_FIELDS)[number])
      : "createdAt";
    const sortDir = sortDirParam?.toLowerCase() === "asc" ? "asc" : "desc";
    const skip = (page - 1) * pageSize;

    const insensitiveMode: Prisma.QueryMode = "insensitive";

    const where: Prisma.LocalFirstAliasWhereInput = {
      ...(city ? { city: { in: cityVariants } } : {}),
      ...(aliasType ? { aliasType } : {}),
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
      ...(q
        ? {
            OR: [
              { sourceBairro: { contains: q, mode: insensitiveMode } },
              { sourceRua: { contains: q, mode: insensitiveMode } },
              { targetBairro: { contains: q, mode: insensitiveMode } },
              { targetRua: { contains: q, mode: insensitiveMode } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.localFirstAlias.count({ where }),
      prisma.localFirstAlias.findMany({
        where,
        orderBy:
          sortBy === "lastUsedAt"
            ? [{ lastUsedAt: sortDir }, { createdAt: "desc" }]
            : [{ [sortBy]: sortDir }, { createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          city: true,
          aliasType: true,
          sourceBairro: true,
          sourceRua: true,
          targetBairro: true,
          targetRua: true,
          sampleBairro: true,
          sampleRua: true,
          sampleQuadra: true,
          sampleLote: true,
          status: true,
          source: true,
          confidence: true,
          usageCount: true,
          cooldownUntil: true,
          lastUsedAt: true,
          lastAttemptAt: true,
          lastValidationStatus: true,
          lastValidationReason: true,
          lastFailureReason: true,
          lastAiReason: true,
          reviewedAt: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
      filters: {
        city: city || undefined,
        aliasType: aliasType || undefined,
        status: status || undefined,
        source: source || undefined,
        q: q || undefined,
      },
      sort: {
        sortBy,
        sortDir,
      },
    });
  } catch (error) {
    console.error("GET /api/admin/local-first-aliases error:", error);
    return NextResponse.json(
      { error: "Erro ao listar aliases." },
      { status: 500 },
    );
  }
}
