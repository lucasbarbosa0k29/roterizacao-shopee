import { purgeExpiredNotifications } from "./notifications";

const runtime = globalThis as typeof globalThis & { notificationRetentionTimer?: NodeJS.Timeout };
const INTERVAL_MS = 15 * 60_000;

export function startNotificationRetention() {
  if (runtime.notificationRetentionTimer) return;

  async function run() {
    try {
      // Limit work per tick, even after a long outage.
      for (let batch = 0; batch < 10; batch++) {
        if (await purgeExpiredNotifications() < 100) break;
      }
    } catch {
      console.error("Falha na limpeza de notificações expiradas.");
    } finally {
      runtime.notificationRetentionTimer = setTimeout(run, INTERVAL_MS).unref();
    }
  }
  runtime.notificationRetentionTimer = setTimeout(run, 30_000).unref();
}
