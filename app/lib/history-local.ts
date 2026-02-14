// app/lib/history-local.ts

export type SavedHistory = {
  id: string;
  name: string;
  savedAt: number;
  rows: any[];

  manualEdits?: Record<string, any>;
  manualGroups?: Record<string, number[]>;
  autoGrouped?: boolean;
  autoBreakIds?: string[];
  groupMode?: boolean;
  selectedIdxs?: number[];

  view?: "upload" | "results";
};

const KEY = "rp_history_v1";
const TTL_MS = 24 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function readAllRaw(): SavedHistory[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: SavedHistory[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function listHistory(): SavedHistory[] {
  const items = readAllRaw().filter(
    (it) => now() - (it?.savedAt ?? 0) <= TTL_MS
  );
  return items.sort((a, b) => b.savedAt - a.savedAt);
}

export function getHistory(id: string): SavedHistory | null {
  return listHistory().find((it) => it.id === id) ?? null;
}

export function saveHistory(item: SavedHistory) {
  const items = listHistory();
  const next = [item, ...items.filter((it) => it.id !== item.id)];
  writeAll(next);
  return item;
}

export function updateHistory(
  id: string,
  patch: Partial<Omit<SavedHistory, "id">>
) {
  const items = listHistory();
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return null;

  const updated: SavedHistory = {
    ...items[idx],
    ...patch,
    id,
    savedAt: now(),
  };

  const next = [updated, ...items.filter((it) => it.id !== id)];
  writeAll(next);
  return updated;
}

export function deleteHistory(id: string) {
  const items = listHistory().filter((it) => it.id !== id);
  writeAll(items);
}

export function clearHistory() {
  writeAll([]);
}