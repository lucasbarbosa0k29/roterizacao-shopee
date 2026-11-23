import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

test("central de notificações no PostgreSQL local isolado", { timeout: 120_000 }, async (t) => {
  const cfg = JSON.parse(readFileSync(".local/rotta/config.json", "utf8"));
  assert.equal(cfg.database, "rotta_local_dev");
  assert.equal(cfg.port, 54329);
  assert.ok(typeof cfg.appPassword === "string" && /^[a-f0-9]{64}$/.test(cfg.appPassword));
  const schema = `notification_test_${randomUUID().replaceAll("-", "")}`;
  const base = new URL("postgresql://rotta_app@127.0.0.1:54329/rotta_local_dev");
  base.password = cfg.appPassword;
  const control = new PrismaClient({ datasourceUrl: base.href, log: [] });
  let created = false;
  let db: PrismaClient | undefined;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    const [identity] = await control.$queryRaw<Array<{ db: string; host: string; port: number }>>`
      SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port
    `;
    assert.deepEqual(identity, { db: "rotta_local_dev", host: "127.0.0.1", port: 54329 });
    await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    base.searchParams.set("schema", schema);
    process.env.DATABASE_URL = base.href;
    try {
      execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
        env: { ...process.env, DIRECT_URL: base.href, CHECKPOINT_DISABLE: "1" },
        stdio: "pipe",
      });
    } catch {
      throw new Error("Falha ao preparar o schema de teste exclusivamente local.");
    }
    ({ prisma: db } = await import("../app/lib/prisma"));
    const {
      getNotificationCount, listNotifications, NotificationAudienceChanged, previewNotificationAudience,
      publishAccountNotification, purgeExpiredNotifications,
      sendNotificationCampaign, updateNotificationInbox,
    } = await import("../app/lib/notifications");
    const [a, b, inactive] = await Promise.all([
      db.user.create({ data: { email: "a@example.test", password: "fixture", role: "ADMIN" } }),
      db.user.create({ data: { email: "b@example.test", password: "fixture" } }),
      db.user.create({ data: { email: "inactive@example.test", password: "fixture", active: false } }),
    ]);
    const send = (audience: Parameters<typeof sendNotificationCampaign>[1]["audience"], requestId = randomUUID()) =>
      sendNotificationCampaign(a.id, { audience, title: "Aviso", body: "Mensagem", requestId });

    await t.test("envio individual, geral, por plano efetivo e repetição concorrente", async () => {
      const plan = await db!.subscriptionPlan.create({ data: { code: "BASIC", name: "Basic", dailyRouteLimit: 1 } });
      await db!.userSubscription.create({
        data: { userId: b.id, planId: plan.id, startsAt: new Date(Date.now() - 1000), source: "ADMIN_GRANT" },
      });
      assert.equal(await previewNotificationAudience({ kind: "all" }), 3);
      assert.equal(await previewNotificationAudience({ kind: "plan", target: "BASIC" }), 1);
      assert.equal(await previewNotificationAudience({ kind: "plan", target: "PRO" }), 0);
      assert.equal(await previewNotificationAudience({ kind: "no-subscription" }), 2);
      await assert.rejects(sendNotificationCampaign(a.id, {
        audience: { kind: "all" }, title: "Prévia desatualizada", body: "Teste",
        requestId: randomUUID(), expectedRecipientCount: 2,
      }), NotificationAudienceChanged);
      assert.equal(await db!.notificationCampaign.count(), 0);
      assert.equal(await db!.notificationMessage.count(), 0);
      assert.equal((await send({ kind: "user", target: a.email })).campaign?.recipientCount, 1);
      assert.equal((await send({ kind: "plan", target: "BASIC" })).campaign?.recipientCount, 1);
      const retryId = randomUUID();
      const results = await Promise.all([send({ kind: "all" }, retryId), send({ kind: "all" }, retryId)]);
      assert.deepEqual(results.map((result) => result.campaign?.recipientCount), [3, 3]);
      assert.equal(await getNotificationCount(a.id), 2);
      assert.equal(await getNotificationCount(b.id), 2);
      assert.equal(await getNotificationCount(inactive.id), 1);
      assert.equal(await db!.notificationCampaign.count(), 3);
    });

    await t.test("leitura e exclusão individual ou coletiva isoladas por destinatário", async () => {
      const first = await listNotifications(a.id);
      const shared = (await listNotifications(b.id)).items.find((item) => first.items.some((own) => own.messageId === item.messageId))!;
      const privateMessage = first.items.find((item) => item.messageId !== shared.messageId)!;
      assert.equal(await updateNotificationInbox(b.id, "delete", { messageId: privateMessage.messageId }), 2);
      assert.equal(await updateNotificationInbox(a.id, "read", { messageId: shared.messageId }), 1);
      assert.equal(await getNotificationCount(b.id), 2);
      assert.equal(await updateNotificationInbox(a.id, "read", { through: new Date(first.asOf) }), 0);
      await updateNotificationInbox(a.id, "delete", { messageId: privateMessage.messageId });
      assert.equal((await listNotifications(a.id)).items.length, 1);
      await updateNotificationInbox(a.id, "delete", { through: new Date(first.asOf) });
      assert.equal((await listNotifications(a.id)).items.length, 0);
      assert.equal((await listNotifications(b.id)).items.length, 2);
      assert.equal(await db!.notificationCampaign.count(), 3);
    });

    await t.test("evento automático idempotente, retenção no limite e limpeza física", async () => {
      const fixed = new Date("2030-01-01T00:00:00.000Z");
      const older = new Date(fixed.getTime() - 90 * 86_400_000);
      const event = { eventKey: "test:reward", userId: a.id, title: "Bônus", body: "Teste", occurredAt: older };
      const beforeExpiry = new Date(fixed.getTime() - 1);
      await db!.$transaction(async (tx) => {
        await publishAccountNotification(tx, event, beforeExpiry);
        await publishAccountNotification(tx, event, beforeExpiry);
      });
      assert.equal(await getNotificationCount(a.id, beforeExpiry), 1);
      assert.equal(await getNotificationCount(a.id, fixed), 0);
      assert.ok(await purgeExpiredNotifications(fixed) >= 1);
      assert.equal(await db!.notificationMessage.count({ where: { eventKey: event.eventKey } }), 0);
      assert.equal(await db!.notificationRecipient.count(), 0);
      assert.equal(await db!.notificationCampaign.count(), 3);
    });
  } finally {
    await db?.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (created) await control.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await control.$disconnect();
  }
});
