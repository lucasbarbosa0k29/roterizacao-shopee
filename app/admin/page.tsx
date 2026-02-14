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

export default function AdminPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
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
        return;
      }

      setJobs(data.jobs ?? []);
    } catch (err) {
      console.error("Erro ao carregar admin:", err);
      setJobs([]);
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

  // Refresh a cada 30s, só se tiver job rodando
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

        {/* ✅ BOTÃO PARA CRIAR/GERENCIAR USUÁRIOS */}
        <Link
          href="/admin/users"
          className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700"
        >
          Usuários
        </Link>
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

            const canOpen = j.status === "DONE";
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
                          canOpen ? "Abrir resultado" : "Só libera quando DONE"
                        }
                      >
                        Abrir
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