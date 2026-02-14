// app/lib/history-db.ts

export type DbHistoryListItem = {
  id: string;
  name: string;
  savedAt: number;
};

async function fetchJson(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || "Erro na requisição.");
  }

  return data;
}

// 🔹 LISTAR histórico do usuário
export async function listHistoryDb(): Promise<DbHistoryListItem[]> {
  const data = await fetchJson("/api/history");
  return data.items || [];
}

// 🔹 ABRIR job específico
export async function getHistoryDb(id: string) {
  const data = await fetchJson(`/api/history/${encodeURIComponent(id)}`);
  return data.job;
}

// 🔹 APAGAR um job (limpa resultJson)
export async function deleteHistoryDb(id: string) {
  await fetchJson(`/api/history/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// 🔹 LIMPAR todos jobs do usuário
export async function clearHistoryDb() {
  await fetchJson(`/api/history`, {
    method: "DELETE",
  });
}

// 🔹 SALVAR alterações (CONFIRMADO, AGRUPAR, ETC)
// ✅ AGORA ENVIA O PAYLOAD DIRETO (SEM EMBRULHAR EM resultJson)
export async function updateHistoryDb(
  id: string,
  payload: any
) {
  await fetchJson(`/api/history/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), // ✅ corrigido aqui
  });
}