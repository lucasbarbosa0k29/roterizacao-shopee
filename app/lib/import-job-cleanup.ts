import { prisma } from "@/app/lib/prisma";

const IMPORT_JOB_RETENTION_HOURS = 24;
const CLEANUP_THROTTLE_MS = 30 * 60 * 1000;

let lastCleanupAtMs = 0;

export async function cleanupOldImportJobsIfNeeded() {
  const nowMs = Date.now();

  if (nowMs - lastCleanupAtMs < CLEANUP_THROTTLE_MS) {
    return;
  }

  lastCleanupAtMs = nowMs;

  try {
    const cutoff = new Date(nowMs - IMPORT_JOB_RETENTION_HOURS * 60 * 60 * 1000);

    await prisma.importJob.deleteMany({
      where: {
        updatedAt: { lt: cutoff },
      },
    });
  } catch (e) {
    console.warn("ImportJob automatic cleanup failed:", e);
  }
}
