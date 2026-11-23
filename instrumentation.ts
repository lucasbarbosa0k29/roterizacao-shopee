export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startNotificationRetention } = await import("./app/lib/notification-retention");
    startNotificationRetention();
  }
}
