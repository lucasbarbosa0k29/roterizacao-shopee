"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listHistoryDb,
  deleteHistoryDb,
  clearHistoryDb,
  type DbHistoryListItem,
} from "../lib/history-db";

type HistoryItem = DbHistoryListItem & {
  status?: "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "REVIEW";
  totalStops?: number;
};

type AccessSnapshot = {
  canStartRoute: boolean;
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
};

function statusLabel(status: string) {
  if (status === "PROCESSING") return "Processando";
  if (status === "FAILED") return "Falha";
  if (status === "REVIEW") return "Em revisão";
  if (status === "PENDING") return "Pendente";
  return "Concluída";
}

function statusTone(status: string) {
  if (status === "PROCESSING") return "amber";
  if (status === "FAILED") return "rose";
  if (status === "REVIEW") return "amber";
  if (status === "PENDING") return "sky";
  return "emerald";
}

export default function HistoricoPage() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");

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
      const enriched = await Promise.all(
        (data as HistoryItem[]).map(async (item) => {
          try {
            const res = await fetch(`/api/history/${encodeURIComponent(item.id)}?mode=progress`, {
              credentials: "include",
              cache: "no-store",
              headers: { "Cache-Control": "no-store" },
            });
            if (!res.ok) return item;
            const body = await res.json().catch(() => null);
            const job = body?.job;
            return {
              ...item,
              status: job?.displayStatus ?? job?.status ?? item.status,
              totalStops: typeof job?.totalStops === "number" ? job.totalStops : item.totalStops,
            };
          } catch {
            return item;
          }
        })
      );
      setItems(enriched);
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
    router.push(`/?job=${encodeURIComponent(it.id)}`);
  }

  useEffect(() => {
    refresh();
  }, []);

  const totalStops = useMemo(
    () =>
      items.reduce((sum, item) => {
        const value = Number(item.totalStops ?? 0);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
    [items]
  );

  const statusCounts = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        const status = String(item.status || "DONE");
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [items]);

  const visibleItems = useMemo(() => {
    if (statusFilter === "ALL") return items;
    return items.filter((item) => String(item.status || "DONE") === statusFilter);
  }, [items, statusFilter]);

  return (
    <main className="min-h-screen bg-slate-100">
      <div data-rotta-twa-historico className="mx-auto max-w-6xl px-4 py-5">
        <section data-rotta-twa-historico-header className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#1f5a6b]">Histórico</p>
              <h1 className="mt-1 text-[22px] font-black tracking-tight text-slate-950">Suas rotas importadas</h1>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-rotta-historico-refresh
                onClick={() => refresh()}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-[#17313b] shadow-sm"
                aria-label="Atualizar"
                title="Atualizar"
              >
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 15-6.7" />
                  <path d="M18 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-15 6.7" />
                  <path d="M6 21v-5h5" />
                </svg>
              </button>

              <button
                type="button"
                data-rotta-historico-clear-top
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
                className="flex h-10 w-10 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 shadow-sm"
                aria-label="Limpar tudo"
                title="Limpar tudo"
              >
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M6 6l1 14h10l1-14" />
                  <path d="M10 10v6" />
                  <path d="M14 10v6" />
                </svg>
              </button>
            </div>
          </div>

          <p className="mt-1 text-sm text-slate-600">Suas rotas importadas</p>

          <div className="mt-4 grid grid-cols-2 gap-3" data-rotta-historico-summary>
            <article className="rounded-[20px] bg-[#f7fbfb] p-3 ring-1 ring-slate-200">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Rotas importadas</div>
              <div className="mt-1 text-[28px] font-black leading-none text-slate-900">{items.length}</div>
            </article>
            <article className="rounded-[20px] bg-[#fffaf0] p-3 ring-1 ring-slate-200">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Paradas totais</div>
              <div className="mt-1 text-[28px] font-black leading-none text-slate-900">{totalStops}</div>
            </article>
          </div>
        </section>

        {loading ? (
          <div className="bg-white rounded-lg shadow p-6 text-slate-700">Carregando...</div>
        ) : visibleItems.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-slate-700">
            Nenhuma planilha no histórico ainda.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3" data-rotta-historico-controls>
              <select
                data-rotta-historico-filter
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold leading-none text-slate-900 shadow-sm outline-none"
              >
                <option value="ALL">Todos os status</option>
                {Object.keys(statusCounts).map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)} ({statusCounts[status]})
                  </option>
                ))}
              </select>

            </div>

            <section className="space-y-3">
              {visibleItems.map((it) => {
                const status = String(it.status || "DONE");
                const stops = Number(it.totalStops ?? 0) || 0;
                return (
                  <article key={it.id} className="rounded-[20px] bg-white px-3.5 py-3.5 shadow-sm ring-1 ring-slate-200">
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" />
                          <path d="M14 3.5V8h4M9 12h6M9 16h6" />
                        </svg>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              {new Date(it.savedAt).toLocaleDateString("pt-BR")}
                            </div>
                            <div className="mt-1 max-h-10 overflow-hidden text-ellipsis text-[13px] font-black leading-5 text-slate-950">
                              {it.name}
                            </div>
                          </div>

                          <span
                            className={[
                              "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold",
                              statusTone(status) === "emerald"
                                ? "bg-emerald-50 text-emerald-700"
                                : statusTone(status) === "amber"
                                  ? "bg-amber-50 text-amber-700"
                                  : statusTone(status) === "rose"
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-sky-50 text-sky-700",
                            ].join(" ")}
                          >
                            {statusLabel(status)}
                          </span>
                        </div>

                        <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-600">
                          <span className="truncate">{new Date(it.savedAt).toLocaleString("pt-BR")}</span>
                          <span aria-hidden="true">•</span>
                          <span className="shrink-0">{stops} paradas</span>
                        </div>

                        <div className="mt-2.5 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openFromHistory(it)}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0f4f64] px-3 text-[12px] font-semibold text-white shadow-sm"
                          >
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M14 3h7v7" />
                              <path d="M10 14 21 3" />
                              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                            </svg>
                            Abrir rota
                          </button>

                          <button
                            type="button"
                            aria-label="Mais opções"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm"
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
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                              <circle cx="12" cy="5" r="1.6" />
                              <circle cx="12" cy="12" r="1.6" />
                              <circle cx="12" cy="19" r="1.6" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
