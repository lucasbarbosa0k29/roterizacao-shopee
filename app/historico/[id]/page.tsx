"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRowDisplayIdentifier } from "@/app/lib/row-display-identifier";

type Job = {
  id: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  originalName?: string | null;
  totalStops: number;
  processedStops: number;
  resultJson?: unknown;
  resultSavedAt?: string | null;
  createdAt: string;
};

type TrindadeShadowAuditLike = {
  matchedLayer?: string | null;
  localFirstAppliedAsFinal?: boolean | null;
  localFirstAppliedReason?: string | null;
  streetBairroResolution?: {
    level?: string | null;
    uniqueCandidate?: boolean | null;
    exactBairroMatch?: boolean | null;
    exactStreetMatch?: boolean | null;
  } | null;
} | null;

type TrindadeResultRow = {
  status?: string | null;
  sequence?: string | number | null;
  sourceType?: string | null;
  cliente?: string | null;
  original?: string | null;
  source?: string | null;
  matchType?: string | null;
  quadraAuto?: string | null;
  loteAuto?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  trindadeShadow?: TrindadeShadowAuditLike;
  trindadeShadowAudit?: TrindadeShadowAuditLike;
  localFirstTrindadeUsedAsFinal?: boolean | null;
  localFirstInspectApplied?: boolean | null;
};

function getTrindadeShadow(row: TrindadeResultRow) {
  return row?.trindadeShadow || row?.trindadeShadowAudit || null;
}

function isTrindadeVisuallyValidated(row: TrindadeResultRow) {
  const trindadeShadow = getTrindadeShadow(row);
  if (trindadeShadow?.matchedLayer === "logradouros") return false;
  return (
    row?.localFirstInspectApplied !== true &&
    (
      row?.localFirstTrindadeUsedAsFinal === true ||
      row?.source === "LOCALFIRST_TRINDADE" ||
      row?.matchType === "LOCALFIRST_TRINDADE" ||
      trindadeShadow?.localFirstAppliedAsFinal === true
    )
  );
}

function getTrindadeStatusDisplayLabel(status: string, row: TrindadeResultRow) {
  if (status === "OK") return "Validado";
  if (status === "PARCIAL" && isTrindadeVisuallyValidated(row)) return "Validado";
  if (status === "PARCIAL") return "Aproximado";
  if (status === "NAO_ENCONTRADO" || status === "NÃO ENCONTRADO") return "Pendente";
  if (status === "CONFIRMADO") return "Confirmado";
  return getStatusDisplayLabel(status);
}

function getStatusDisplayLabel(status: string) {
  if (status === "OK") return "Validado";
  if (status === "PARCIAL") return "Aproximado";
  if (status === "NAO_ENCONTRADO" || status === "NÃO ENCONTRADO") return "Pendente";
  if (status === "CONFIRMADO") return "Confirmado";
  return status;
}

export default function HistoricoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String((params as { id?: string })?.id || "");

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);

      const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(data?.error || "Erro ao abrir historico.");
        setJob(null);
        return;
      }

      setJob(data.job);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="p-8">Carregando...</div>;
  if (!job) return <div className="p-8">Nao encontrado.</div>;

  const rows = (Array.isArray(job.resultJson) ? job.resultJson : []) as TrindadeResultRow[];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Historico</h1>
          <div className="text-sm text-slate-600 mt-1">
            <span className="font-semibold">Arquivo:</span>{" "}
            {job.originalName || "Planilha sem nome"}
          </div>
          <div className="text-sm text-slate-600">
            <span className="font-semibold">Status:</span> {job.status} —{" "}
            {job.processedStops}/{job.totalStops}
          </div>

          {job.resultSavedAt && (
            <div className="text-xs text-slate-500 mt-1">
              Resultado salvo em: {new Date(job.resultSavedAt).toLocaleString("pt-BR")}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded-xl border hover:bg-slate-50"
            onClick={() => router.back()}
          >
            Voltar
          </button>

          <button
            className="px-3 py-2 rounded-xl border hover:bg-slate-50"
            onClick={load}
          >
            Recarregar
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 font-semibold border-b">
          Resultado ({rows.length} linhas)
        </div>

        {rows.length === 0 ? (
          <div className="p-5 text-slate-600">Sem resultado salvo (resultJson vazio).</div>
        ) : (
          <div className="p-5 text-sm overflow-auto">
            <table className="min-w-[900px] w-full">
              <thead>
                <tr className="text-left text-slate-600 border-b">
                  <th className="py-2 pr-3">Seq</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Original</th>
                  <th className="py-2 pr-3">Quadra</th>
                  <th className="py-2 pr-3">Lote</th>
                  <th className="py-2 pr-3">Lat</th>
                  <th className="py-2 pr-3">Lng</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r: TrindadeResultRow, idx: number) => (
                  <tr key={idx} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">{getRowDisplayIdentifier(r)}</td>
                    <td className="py-2 pr-3">{getTrindadeStatusDisplayLabel(String(r.status ?? ""), r)}</td>
                    <td className="py-2 pr-3">{r.original ?? ""}</td>
                    <td className="py-2 pr-3">{r.quadraAuto ?? ""}</td>
                    <td className="py-2 pr-3">{r.loteAuto ?? ""}</td>
                    <td className="py-2 pr-3">{r.lat ?? ""}</td>
                    <td className="py-2 pr-3">{r.lng ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {rows.length > 500 && (
              <div className="text-xs text-slate-500 mt-3">
                Mostrando so as primeiras 500 linhas pra nao travar.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
