export type MemorySnapshot = {
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  arrayBuffersMB: number;
};

export function getMemorySnapshot(): MemorySnapshot {
  const memory = process.memoryUsage();

  return {
    rssMB: Math.round(memory.rss / 1024 / 1024),
    heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
    externalMB: Math.round(memory.external / 1024 / 1024),
    arrayBuffersMB: Math.round(memory.arrayBuffers / 1024 / 1024),
  };
}

export function logMemory(label: string, extra: Record<string, unknown> = {}) {
  console.info("[MEMORY]", {
    label,
    ...getMemorySnapshot(),
    ...extra,
  });
}
