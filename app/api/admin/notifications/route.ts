import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { requireAdmin, requireSuperAdmin } from "@/app/lib/admin-roles";
import { canBroadcastNotifications } from "@/app/lib/notification-admin";
import { prisma } from "@/app/lib/prisma";
import {
  NotificationAudienceChanged, previewNotificationAudience, sendNotificationCampaign, type NotificationAudience,
} from "@/app/lib/notifications";

const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

function readAudience(kind: unknown, value: unknown): NotificationAudience | null {
  const target = typeof value === "string" ? value.trim() : "";
  if (kind === "user" && target.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(target)) {
    return { kind, target: target.toLowerCase() };
  }
  if (kind === "all" || kind === "no-subscription") return { kind };
  if (kind === "plan" && (target === "BASIC" || target === "PRO")) return { kind, target };
  return null;
}

export async function GET(request: Request) {
  const user = (await getServerSession(authOptions))?.user;
  if (!user?.id || !requireAdmin(user)) return response({ error: "Acesso restrito." }, 403);
  const params = new URL(request.url).searchParams;
  const canBroadcast = canBroadcastNotifications(user);
  if (params.get("mode") === "preview") {
    if (!canBroadcast) return response({ error: "Envio coletivo restrito a administradores autorizados." }, 403);
    const audience = readAudience(params.get("kind"), params.get("target"));
    if (!audience || audience.kind === "user") return response({ error: "Selecione um público coletivo válido." }, 400);
    return response({ recipientCount: await previewNotificationAudience(audience) });
  }
  const scope = requireSuperAdmin(user) ? {} : { authorId: user.id };
  const before = params.get("before");
  const cursor = before && before.length <= 140
    ? await prisma.notificationCampaign.findFirst({ where: { ...scope, id: before } })
    : null;
  const campaigns = await prisma.notificationCampaign.findMany({
    where: {
      ...scope,
      ...(cursor ? { OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 21,
  });
  return response({
    campaigns: campaigns.slice(0, 20),
    next: campaigns.length > 20 ? campaigns[19].id : null,
    canBroadcast,
  });
}

export async function POST(request: Request) {
  const user = (await getServerSession(authOptions))?.user;
  if (!user?.id || !requireAdmin(user)) return response({ error: "Acesso restrito." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response({ error: "Formato inválido." }, 415);
  }
  const input = await request.json().catch(() => null);
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  const requestId = input?.requestId;
  if (!title || title.length > 120 || !body || body.length > 2000 ||
      typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    return response({ error: "Informe um título e uma mensagem válidos." }, 400);
  }

  const audience = readAudience(input.kind, input.target);
  if (!audience) return response({ error: "Selecione um público válido." }, 400);
  const collective = audience.kind !== "user";
  if (collective && !canBroadcastNotifications(user)) {
    return response({ error: "Envio coletivo restrito a administradores autorizados." }, 403);
  }
  const expectedRecipientCount = collective ? input.expectedRecipientCount : undefined;
  if (collective && (!Number.isSafeInteger(expectedRecipientCount) || expectedRecipientCount <= 0)) {
    return response({ error: "Confira e confirme a prévia dos destinatários." }, 400);
  }
  try {
    const result = await sendNotificationCampaign(user.id, { audience, title, body, requestId, expectedRecipientCount });
    if ("conflict" in result) return response({ error: "O identificador já foi usado em outro envio." }, 409);
    return response({ campaign: result.campaign }, 201);
  } catch (error) {
    if (error instanceof NotificationAudienceChanged) {
      return response({ error: "A quantidade de destinatários mudou. Confira a nova prévia antes de enviar." }, 409);
    }
    throw error;
  }
}
