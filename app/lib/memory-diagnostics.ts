import { getMemorySnapshot } from "@/app/lib/memory-observability";

export function isMemoryDiagnosticsEnabled() {
  return process.env.MEMORY_DIAGNOSTICS === "true";
}

export function logMemoryDiagnostics(label: string, extra: Record<string, unknown> = {}) {
  if (!isMemoryDiagnosticsEnabled()) return;

  console.info("[MEMORY_DIAGNOSTICS]", {
    label,
    ...getMemorySnapshot(),
    ...extra,
  });
}

export function logCacheSnapshot(label: string, extra: Record<string, unknown> = {}) {
  if (!isMemoryDiagnosticsEnabled()) return;

  console.info("[CACHE_SNAPSHOT]", {
    label,
    ...extra,
  });
}
