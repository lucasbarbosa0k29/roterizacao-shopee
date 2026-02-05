"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listHistory,
  deleteHistory,
  clearHistory,
  type SavedHistory,
} from "../lib/history";

type HistoryItem = {
  id: string;
  name: string;
  savedAt: number;
  rowsCount: number;
};

export default function HistoricoPage() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);

  function refresh() {
    const data = listHistory().map((h: SavedHistory) => ({
      id: h.id,
      name: h.name,
      savedAt: h.savedAt,
      rowsCount: Array.isArray(h.rows) ? h.rows.length : 0,
    }));
    setItems(data);
  }

  function openFromHistory(it: HistoryItem) {
    // ✅ O JEITO CERTO:
    // Vai para a Home passando o history na URL
    // A Home (page.tsx) vai ler ?history=... e restaurar com getHistory(historyId)
    router.push(`/?history=${encodeURIComponent(it.id)}`);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl font-bold mb-1">Histórico de importação</h1>
        <p className="text-sm text-slate-600 mb-6">
          Planilhas salvas por até 24 horas.
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
            onClick={() => {
              clearHistory();
              refresh();
            }}
            className="px-3 py-2 rounded-md border bg-white hover:bg-slate-50 text-sm"
          >
            Limpar tudo
          </button>
        </div>

        {items.length === 0 ? (
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
                    {new Date(it.savedAt).toLocaleString()} • {it.rowsCount} linhas
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
                    onClick={() => {
                      deleteHistory(it.id);
                      refresh();
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