// app/lib/history.ts

export type DbHistoryListItem = {
  id: string;
  name: string;
  savedAt: number;
};

export async function listHistoryDb(): Promise<DbHistoryListItem[]> {
  const res = await fetch("/api/history", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { "Cache-Control": "no-store" },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao listar histórico.");

  return Array.isArray(data.items) ? data.items : [];
}

export async function getHistoryDb(id: string): Promise<any> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { "Cache-Control": "no-store" },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao abrir histórico.");

  return data.job;
}

export async function updateHistoryDb(
  id: string,
  payload: { rows?: any[]; workspace?: any }
) {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao salvar histórico.");

  return true;
}

export async function deleteHistoryDb(id: string) {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao apagar.");

  return true;
}

export async function clearHistoryDb() {
  const res = await fetch(`/api/history`, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao limpar.");

  return true;
}