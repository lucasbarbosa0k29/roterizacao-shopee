"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listHistoryDb,
  deleteHistoryDb,
  clearHistoryDb,
  type DbHistoryListItem,
} from "../lib/history-db";

type HistoryItem = DbHistoryListItem;

type AccessSnapshot = {
  canStartRoute: boolean;
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
};

export default function HistoricoPage() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAccess() {
    const res = await fetch("/api/access/me", {
      credentials: "include",
      cache: "no-store",
      headers: { "Cache-Control": "no-store" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Erro ao carregar acesso.");
    return data as AccessSnapshot;
  }

  async function refresh() {
    try {
      setLoading(true);
      const [access, data] = await Promise.all([loadAccess(), listHistoryDb()]);
      setItems(data);
      if (access.code === "ACCESS_BLOCKED" || (!access.canStartRoute && data.length === 0)) {
        router.replace("/planos");
      }
    } catch (e: any) {
      alert(e?.message || "Erro ao carregar histórico.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function openFromHistory(it: HistoryItem) {
    // ✅ VOLTA PRA TELA PRINCIPAL (HOME) e carrega o job pelo banco
    router.push(`/?job=${encodeURIComponent(it.id)}`);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl font-bold mb-1">Histórico de importação</h1>
        <p className="text-sm text-slate-600 mb-6">
          Histórico por usuário (salvo no banco).
        </p>

        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => refresh()}
            className="px-3 py-2 rounded-md border bg-white hover:bg-slate-50 text-sm"
          >
            Atualizar
          </button>

          <button
            type="button"
            onClick={async () => {
              const ok = confirm("Limpar TODO o histórico do usuário?");
              if (!ok) return;
              try {
                await clearHistoryDb();
                window.dispatchEvent(new Event("history-db-changed"));
                await refresh();
              } catch (e: any) {
                alert(e?.message || "Erro ao limpar.");
              }
            }}
            className="px-3 py-2 rounded-md border bg-white hover:bg-slate-50 text-sm"
          >
            Limpar tudo
          </button>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow p-6 text-slate-700">
            Carregando...
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-slate-700">
            Nenhuma planilha no histórico ainda.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow divide-y">
            {items.map((it) => (
              <div
                key={it.id}
                className="p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-medium text-slate-900">{it.name}</div>
                  <div className="text-sm text-slate-600">
                    {new Date(it.savedAt).toLocaleString("pt-BR")}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openFromHistory(it)}
                    className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
                  >
                    Abrir
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      const ok = confirm("Apagar este item do histórico?");
                      if (!ok) return;
                      try {
                        await deleteHistoryDb(it.id);
                        window.dispatchEvent(new Event("history-db-changed"));
                        await refresh();
                      } catch (e: any) {
                        alert(e?.message || "Erro ao apagar.");
                      }
                    }}
                    className="px-3 py-2 rounded-md border text-sm bg-white hover:bg-slate-50"
                  >
                    Apagar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
