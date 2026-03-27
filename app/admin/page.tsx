"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Job = {
  id: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  originalName?: string | null;
  totalStops: number;
  processedStops: number;
  errorMessage?: string | null;
  createdAt: string;
  user: { name?: string | null; email: string; role: string };
};

type ObservabilityRow = {
  day: string;
  discoverToday: number;
  memoryCreated: number;
  memoryTotalAccumulated: number;
  manualCreateOk: number;
  manualUpdateOk: number;
  manualHitOnly: number;
  manualSaveError: number;
  manualSaveOkTotal: number;
  batchSaveOk: number;
  batchSaveError: number;
  memoryHealth: "OK" | "ATENCAO" | "CRITICO";
};

type ObservabilityData = {
  discoverMonth: number;
  discoverToday: number;
  memoryHitToday: number;
  memoryLookupToday: number;
  memoryHitRateToday: number;
  memoryTotalStored: number;
  memoryCreatedToday: number;
  manualCreateOkToday: number;
  manualUpdateOkToday: number;
  manualHitOnlyToday: number;
  manualSaveErrorToday: number;
  manualSaveOkToday: number;
  batchSaveOkToday: number;
  batchSaveErrorToday: number;
  memoryHealth: "OK" | "ATENCAO" | "CRITICO";
  dailyRows: ObservabilityRow[];
};

export default function AdminPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [obs, setObs] = useState<ObservabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);

      const res = await fetch("/api/admin/import-jobs", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("Erro /api/admin/import-jobs:", data);
        setJobs([]);
      } else {
        setJobs(data.jobs ?? []);
      }

      const obsRes = await fetch("/api/admin/observability", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });

      const obsData = await obsRes.json().catch(() => ({}));

      if (!obsRes.ok) {
        console.error("Erro /api/admin/observability:", obsData);
        setObs(null);
      } else {
        setObs(obsData);
      }
    } catch (err) {
      console.error("Erro ao carregar admin:", err);
      setJobs([]);
      setObs(null);
    } finally {
      setLoading(false);
    }
  }

  async function onDeleteJob(id: string) {
    const ok = confirm("Excluir essa importação? Isso vai remover do Admin.");
    if (!ok) return;

    try {
      setDeletingId(id);

      const res = await fetch(`/api/admin/import-jobs/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(data?.error || "Erro ao excluir.");
        return;
      }

      await load();
    } catch (e) {
      console.error("Erro ao excluir:", e);
      alert("Erro ao excluir.");
    } finally {
      setDeletingId(null);
    }
  }

  function onOpenJob(id: string) {
    window.location.href = `/admin/job/${id}`;
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setJobs((prev) => {
        const hasRunning = prev.some(
          (j) => j.status === "PENDING" || j.status === "PROCESSING"
        );
        if (hasRunning) load();
        return prev;
      });
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Administração</h1>
          <p className="mt-2 text-slate-600">
            Aqui você vê todas as importações e andamento do processamento.
          </p>
        </div>

        <Link
          href="/admin/users"
          className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700"
        >
          Usuários
        </Link>
      </div>

      <div className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 font-semibold border-b">
          Observabilidade Operacional
        </div>

        <div className="p-5">
          {!obs && (
            <div className="text-slate-600">Métricas operacionais indisponíveis.</div>
          )}

          {obs && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Discover no mês
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.discoverMonth}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Discover hoje
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.discoverToday}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Taxa de reaproveitamento da memória
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.memoryHitRateToday}%</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {obs.memoryHitToday} de {obs.memoryLookupToday} reaproveitados hoje
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Total de endereços na memória
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.memoryTotalStored}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Novos endereços criados hoje
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.memoryCreatedToday}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Saves manuais/background OK hoje
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.manualSaveOkToday}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Saves manuais/background com erro hoje
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.manualSaveErrorToday}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Saves batch OK hoje
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.batchSaveOkToday}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Saves batch com erro hoje
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.batchSaveErrorToday}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Saúde da memória
                  </div>
                  <div className="mt-2 text-2xl font-bold">{obs.memoryHealth}</div>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      <th className="px-3 py-2">Dia</th>
                      <th className="px-3 py-2">Novos criados</th>
                      <th className="px-3 py-2">Total acumulado</th>
                      <th className="px-3 py-2">Discover</th>
                      <th className="px-3 py-2">Manual create OK</th>
                      <th className="px-3 py-2">Manual update OK</th>
                      <th className="px-3 py-2">Manual hit_only</th>
                      <th className="px-3 py-2">Manual erro</th>
                      <th className="px-3 py-2">Manual total OK</th>
                      <th className="px-3 py-2">Batch OK</th>
                      <th className="px-3 py-2">Batch erro</th>
                      <th className="px-3 py-2">Saúde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obs.dailyRows.map((row) => (
                      <tr key={row.day} className="border-b last:border-b-0">
                        <td className="px-3 py-2">{row.day}</td>
                        <td className="px-3 py-2">{row.memoryCreated}</td>
                        <td className="px-3 py-2">{row.memoryTotalAccumulated}</td>
                        <td className="px-3 py-2">{row.discoverToday}</td>
                        <td className="px-3 py-2">{row.manualCreateOk}</td>
                        <td className="px-3 py-2">{row.manualUpdateOk}</td>
                        <td className="px-3 py-2">{row.manualHitOnly}</td>
                        <td className="px-3 py-2">{row.manualSaveError}</td>
                        <td className="px-3 py-2">{row.manualSaveOkTotal}</td>
                        <td className="px-3 py-2">{row.batchSaveOk}</td>
                        <td className="px-3 py-2">{row.batchSaveError}</td>
                        <td className="px-3 py-2 font-medium">{row.memoryHealth}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 font-semibold border-b">
          Últimas importações
        </div>

        <div className="divide-y">
          {loading && (
            <div className="p-5 text-slate-600">Carregando...</div>
          )}

          {!loading && jobs.length === 0 && (
            <div className="p-5 text-slate-600">
              Nenhuma importação registrada ainda.
            </div>
          )}

          {jobs.map((j) => {
            const pct =
              j.totalStops > 0
                ? Math.round((j.processedStops / j.totalStops) * 100)
                : 0;

            const canOpen = true;
            const isDeleting = deletingId === j.id;

            return (
              <div key={j.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold">
                      {j.originalName || "Planilha sem nome"}
                    </div>

                    <div className="text-sm text-slate-600">
                      Usuário: {j.user.email}{" "}
                      {j.user.name ? `(${j.user.name})` : ""}
                    </div>

                    <div className="text-xs text-slate-500 mt-1">
                      {new Date(j.createdAt).toLocaleString("pt-BR")}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-semibold">{j.status}</div>
                    <div className="text-xs text-slate-600">
                      {j.processedStops}/{j.totalStops} ({pct}%)
                    </div>

                    <div className="mt-2 flex items-center justify-end gap-3">
                      <button
                        className={`text-sm hover:underline ${
                          canOpen
                            ? "text-blue-700"
                            : "text-slate-400 cursor-not-allowed"
                        }`}
                        onClick={() => canOpen && onOpenJob(j.id)}
                        disabled={!canOpen}
                        title={
                          canOpen ? "Abrir detalhes da importação" : "Indisponível"
                        }
                      >
                        Detalhes
                      </button>

                      <button
                        className={`text-sm hover:underline ${
                          isDeleting
                            ? "text-slate-400 cursor-wait"
                            : "text-red-700"
                        }`}
                        onClick={() => onDeleteJob(j.id)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? "Excluindo..." : "Excluir"}
                      </button>
                    </div>
                  </div>
                </div>

                {j.status === "FAILED" && j.errorMessage && (
                  <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
                    Erro: {j.errorMessage}
                  </div>
                )}

                <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
