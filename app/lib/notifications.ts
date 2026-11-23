import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const DAY_MS = 86_400_000;
const RETENTION_MS = 90 * DAY_MS;
const PAGE_SIZE = 20;

function inbox(userId: string, now: Date): Prisma.NotificationRecipientWhereInput {
  return { userId, deletedAt: null, expiresAt: { gt: now } };
}

export async function getNotificationCount(userId: string, now = new Date()) {
  return prisma.notificationRecipient.count({ where: { ...inbox(userId, now), readAt: null } });
}

export async function listNotifications(userId: string, before?: string, now = new Date()) {
  const cursor = before
    ? await prisma.notificationRecipient.findUnique({
        where: { userId_messageId: { userId, messageId: before } },
        select: { createdAt: true, messageId: true },
      })
    : null;
  const rows = await prisma.notificationRecipient.findMany({
    where: {
      ...inbox(userId, now),
      ...(cursor ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, messageId: { lt: cursor.messageId } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { messageId: "desc" }],
    take: PAGE_SIZE + 1,
    select: { messageId: true, createdAt: true, readAt: true, message: { select: { title: true, body: true } } },
  });
  return {
    items: rows.slice(0, PAGE_SIZE),
    next: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].messageId : null,
    unread: await getNotificationCount(userId, now),
    asOf: now.toISOString(),
  };
}

export async function updateNotificationInbox(
  userId: string,
  action: "read" | "delete",
  scope: { messageId: string } | { through: Date },
  now = new Date(),
) {
  await prisma.notificationRecipient.updateMany({
    where: {
      ...inbox(userId, now),
      ...("messageId" in scope ? scope : { createdAt: { lte: scope.through } }),
      ...(action === "read" ? { readAt: null } : {}),
    },
    data: action === "read" ? { readAt: now } : { deletedAt: now },
  });
  return getNotificationCount(userId, now);
}

// For future domain events. The caller supplies its transaction and a stable event key.
export async function publishAccountNotification(
  tx: Prisma.TransactionClient,
  event: { eventKey: string; userId: string; title: string; body: string; occurredAt: Date },
  now = new Date(),
) {
  const expiresAt = new Date(event.occurredAt.getTime() + RETENTION_MS);
  if (expiresAt <= now) return;
  const { eventKey, title, body, userId, occurredAt: createdAt } = event;
  const claim = await tx.notificationMessage.createMany({
    data: { eventKey, title, body, createdAt, expiresAt },
    skipDuplicates: true,
  });
  if (!claim.count) return;
  const message = await tx.notificationMessage.findUniqueOrThrow({ where: { eventKey }, select: { id: true } });
  await tx.notificationRecipient.createMany({
    data: { userId, messageId: message.id, createdAt, expiresAt },
  });
}

export type NotificationAudience =
  | { kind: "user"; target: string }
  | { kind: "all" }
  | { kind: "plan"; target: "BASIC" | "PRO" }
  | { kind: "no-subscription" };

function notificationAudienceFilter(audience: NotificationAudience, utc: string) {
  if (audience.kind === "all") return Prisma.sql`TRUE`;
  if (audience.kind === "user") return Prisma.sql`u.active AND u.email = ${audience.target}`;

  // Match the effective subscription ordering used by access-control.
  const currentPlan = Prisma.sql`(SELECT p."code"::text FROM "UserSubscription" s
    JOIN "SubscriptionPlan" p ON p.id = s."planId"
    WHERE s."userId" = u.id AND p."isActive" AND s."startsAt" <= ${utc}::timestamp
      AND ((s.status = 'ACTIVE' AND (s."expiresAt" IS NULL OR s."expiresAt" > ${utc}::timestamp))
        OR (s.status = 'SCHEDULED' AND s."expiresAt" > ${utc}::timestamp))
    ORDER BY s."startsAt" DESC, s."createdAt" DESC, s.id DESC LIMIT 1)`;
  return audience.kind === "no-subscription"
    ? Prisma.sql`${currentPlan} IS NULL`
    : Prisma.sql`${currentPlan} = ${audience.target}`;
}

export async function previewNotificationAudience(audience: NotificationAudience) {
  const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "User" u
    WHERE ${notificationAudienceFilter(audience, new Date().toISOString())}
  `;
  return row.count;
}

export class NotificationAudienceChanged extends Error {}

export async function sendNotificationCampaign(
  authorId: string,
  input: { requestId: string; audience: NotificationAudience; title: string; body: string; expectedRecipientCount?: number },
) {
  const id = `${authorId}:${input.requestId}`;
  const { audience, title, body } = input;
  const target = "target" in audience ? audience.target : null;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + RETENTION_MS);
  const createdUtc = createdAt.toISOString();

  return prisma.$transaction(async (tx) => {
    const claim = await tx.notificationCampaign.createMany({
      data: { id, authorId, title, body, audience: audience.kind, target, createdAt, recipientCount: 0 },
      skipDuplicates: true,
    });
    if (!claim.count) {
      const previous = await tx.notificationCampaign.findUniqueOrThrow({ where: { id } });
      if (previous.title !== title || previous.body !== body ||
          previous.audience !== audience.kind || previous.target !== target) return { conflict: true } as const;
      return { campaign: previous } as const;
    }

    const message = await tx.notificationMessage.create({
      data: { title, body, createdAt, expiresAt },
      select: { id: true },
    });
    const recipientCount = await tx.$executeRaw`
      INSERT INTO "NotificationRecipient" ("userId", "messageId", "createdAt", "expiresAt")
      SELECT u.id, ${message.id}, ${createdUtc}::timestamp, ${expiresAt.toISOString()}::timestamp
      FROM "User" u WHERE ${notificationAudienceFilter(audience, createdUtc)}
    `;
    if (input.expectedRecipientCount !== undefined && input.expectedRecipientCount !== recipientCount) {
      throw new NotificationAudienceChanged();
    }
    if (!recipientCount) await tx.notificationMessage.delete({ where: { id: message.id } });
    const campaign = await tx.notificationCampaign.update({
      where: { id },
      data: { recipientCount },
    });
    return { campaign } as const;
  }, { timeout: 20_000 });
}

export async function purgeExpiredNotifications(now = new Date()) {
  return prisma.$executeRaw`
    DELETE FROM "NotificationMessage" WHERE id IN (
      SELECT id FROM "NotificationMessage" WHERE "expiresAt" <= ${now.toISOString()}::timestamp
      ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED
    )
  `;
}
