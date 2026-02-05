// app/lib/history.ts

export type SavedHistory = {
  id: string;
  name: string;
  savedAt: number;

  // ✅ dados principais
  rows: any[];

  // ✅ tudo que você mexe na tela
  manualEdits?: Record<string, any>; // ⚠️ JSON sempre vira string
  manualGroups?: Record<string, number[]>;
  autoGrouped?: boolean;
  autoBreakIds?: string[]; // Set vira array
  groupMode?: boolean;
  selectedIdxs?: number[]; // Set vira array

  // ✅ opcional
  view?: "upload" | "results";
};

const KEY = "rp_history_v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

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

export function cleanupHistory() {
  const items = readAllRaw();
  const keep = items.filter((it) => now() - (it?.savedAt ?? 0) <= TTL_MS);
  if (keep.length !== items.length) writeAll(keep);
  return keep;
}

export function listHistory(): SavedHistory[] {
  return cleanupHistory().sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export function getHistory(id: string): SavedHistory | null {
  const items = cleanupHistory();
  return items.find((it) => it.id === id) ?? null;
}

/**
 * ✅ Salva (cria/replace) um item completo
 * Use quando terminar o processamento/import.
 */
export function saveHistory(item: SavedHistory) {
  const items = cleanupHistory();
  const next = [item, ...items.filter((it) => it.id !== item.id)];
  writeAll(next);
  return item;
}

/**
 * ✅ Atualiza um item existente (patch) sem perder o resto.
 * Use quando você editar: manualEdits, agrupamentos, etc.
 *
 * Obs: também atualiza savedAt para manter "vivo" por 24h desde a última edição.
 */
export function updateHistory(
  id: string,
  patch: Partial<Omit<SavedHistory, "id">>
): SavedHistory | null {
  const items = cleanupHistory();
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return null;

  const current = items[idx];

  const updated: SavedHistory = {
    ...current,
    ...patch,
    id,
    savedAt: now(), // renova TTL a cada edição
  };

  const next = [updated, ...items.filter((it) => it.id !== id)];
  writeAll(next);
  return updated;
}

export function deleteHistory(id: string) {
  const items = cleanupHistory();
  const next = items.filter((it) => it.id !== id);
  writeAll(next);
  return next;
}

export function clearHistory() {
  writeAll([]);
  return [];
}