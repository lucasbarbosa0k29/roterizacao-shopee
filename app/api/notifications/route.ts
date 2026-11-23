import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { getNotificationCount, listNotifications, updateNotificationInbox } from "@/app/lib/notifications";

const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const userId = (await getServerSession(authOptions))?.user?.id;
  if (!userId) return response({ error: "Sessão necessária." }, 401);
  const params = new URL(request.url).searchParams;
  if (params.get("mode") === "count") return response({ unread: await getNotificationCount(userId) });
  return response(await listNotifications(userId, params.get("before")?.slice(0, 100)));
}

export async function PATCH(request: Request) {
  const userId = (await getServerSession(authOptions))?.user?.id;
  if (!userId) return response({ error: "Sessão necessária." }, 401);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response({ error: "Formato inválido." }, 415);
  }
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== "read" && action !== "delete") return response({ error: "Ação inválida." }, 400);
  if (typeof body.messageId === "string" && body.messageId.length <= 100 && body.messageId) {
    return response({ unread: await updateNotificationInbox(userId, action, { messageId: body.messageId }) });
  }
  const now = new Date();
  const through = new Date(typeof body.through === "string" ? body.through : "");
  if (!Number.isFinite(through.getTime()) || through > now) {
    return response({ error: "Atualize a lista antes de tentar novamente." }, 400);
  }
  return response({ unread: await updateNotificationInbox(userId, action, { through }, now) });
}
