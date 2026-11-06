// Explicit opt-in, server-side only. Never enable simulated flows for a remote database.
export function localDevelopmentEnabled() {
  if (process.env.ROTTA_LOCAL_DEV !== "1") return false;
  let localDatabase = false;
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    localDatabase = url.protocol === "postgresql:" && url.hostname === "127.0.0.1" && url.pathname === "/rotta_local_dev";
  } catch { /* Invalid configuration must fail closed. */ }
  if (process.env.NODE_ENV !== "development" || !localDatabase) {
    throw new Error("O modo local exige NODE_ENV=development e o banco rotta_local_dev em 127.0.0.1.");
  }
  return true;
}
