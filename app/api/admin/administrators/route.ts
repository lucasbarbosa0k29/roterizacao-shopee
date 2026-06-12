import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { isSuperAdmin, requireSuperAdmin } from "@/app/lib/admin-roles";

export const runtime = "nodejs";

type AdminUserRow = {
  id: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  createdAt: string;
  isSuperAdmin: boolean;
};

type AdminAuditRow = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; email: string; name: string | null };
  target: { id: string; email: string; name: string | null };
  metadata: any;
};

function serializeUser(user: {
  id: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    isSuperAdmin: isSuperAdmin(user),
  } satisfies AdminUserRow;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!requireSuperAdmin(session?.user as any)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [users, logs] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.adminAccessLog.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        action: true,
        createdAt: true,
        metadata: true,
        admin: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        targetUser: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    users: users.map(serializeUser),
    auditLogs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      createdAt: log.createdAt.toISOString(),
      actor: {
        id: log.admin.id,
        email: log.admin.email,
        name: log.admin.name ?? null,
      },
      target: {
        id: log.targetUser.id,
        email: log.targetUser.email,
        name: log.targetUser.name ?? null,
      },
      metadata: log.metadata ?? null,
    })) satisfies AdminAuditRow[],
  });
}
