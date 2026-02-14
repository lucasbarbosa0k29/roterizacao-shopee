import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";

function isAdmin(session: any) {
  const role = (session?.user as any)?.role;
  return session?.user && role === "ADMIN";
}

async function getIdFromCtx(ctx: any) {
  const maybeParams = ctx?.params;
  const params =
    maybeParams && typeof maybeParams.then === "function"
      ? await maybeParams
      : maybeParams;

  return String(params?.id || "");
}

// PATCH /api/admin/users/[id]  -> ativa/desativa
export async function PATCH(req: Request, ctx: any) {
  try {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = await getIdFromCtx(ctx);
    if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const body = await req.json().catch(() => null);
    const active = typeof body?.active === "boolean" ? body.active : undefined;

    if (typeof active !== "boolean") {
      return NextResponse.json(
        { error: "Campo 'active' inválido." },
        { status: 400 }
      );
    }

    const myId = String((session?.user as any)?.id || "");
    if (id === myId && active === false) {
      return NextResponse.json(
        { error: "Você não pode desativar sua própria conta ADMIN." },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { active },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, user: updated });
  } catch (e) {
    console.error("Erro admin PATCH user:", e);
    return NextResponse.json(
      { error: "Erro ao atualizar usuário." },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users/[id] -> excluir
export async function DELETE(req: Request, ctx: any) {
  try {
    const session = await getServerSession(authOptions);
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = await getIdFromCtx(ctx);
    if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const myId = String((session?.user as any)?.id || "");
    if (id === myId) {
      return NextResponse.json(
        { error: "Você não pode excluir sua própria conta ADMIN." },
        { status: 400 }
      );
    }

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Erro admin DELETE user:", e);
    return NextResponse.json(
      { error: "Erro ao excluir usuário." },
      { status: 500 }
    );
  }
}