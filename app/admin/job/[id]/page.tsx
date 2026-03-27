"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Job = {
  id: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  originalName?: string | null;
  totalStops: number;
  processedStops: number;
  errorMessage?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  resultJson?: any;
  resultSavedAt?: string | null;
  user?: { name?: string | null; email: string; role: string };
};

type Status =
  | "OK"
  | "PARCIAL"
  | "NAO_ENCONTRADO"
  | "MANUAL"
  | "CONFIRMADO"
  | "REVISAO";

function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8",
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function hasManualEditData(manual: any) {
  return !!(
    manual &&
    (
      (manual.address && String(manual.address).trim()) ||
      typeof manual.lat === "number" ||
      typeof manual.lng === "number" ||
      (manual.quadra && String(manual.quadra).trim()) ||
      (manual.lote && String(manual.lote).trim()) ||
      (manual.notes && String(manual.notes).trim())
    )
  );
}

function getDerivedRowStatus(row: any, manual: any): Status {
  if (manual?.confirmed) return "CONFIRMADO";
  if (hasManualEditData(manual)) return "MANUAL";
  return (row?.status || "NAO_ENCONTRADO") as Status;
}

function isMemoryHitRow(row: any) {
  const reason = String(row?.decisionReason || "").toUpperCase();
  return reason.startsWith("MEMORY");
}

export default function AdminJobPage() {
  const params = useParams();
  const router = useRouter();
  const id = String((params as any)?.id || "");

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [onlyWithCoords, setOnlyWithCoords] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/import-jobs/${id}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao abrir job");
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

  useEffect(() => {
    if (!job) return;
    if (job.status !== "PENDING" && job.status !== "PROCESSING") return;

    const interval = setInterval(() => {
      load();
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  const resultEnvelope = useMemo(() => {
    const rj = job?.resultJson;
    if (!rj || typeof rj !== "object" || Array.isArray(rj)) return null;
    return rj as any;
  }, [job]);

  const rowsAll = useMemo(() => {
    if (!job) return [];

    const rj = job.resultJson;
    if (Array.isArray(rj)) return rj;

    const rows = (rj as any)?.rows;
    if (Array.isArray(rows)) return rows;

    return [];
  }, [job]);

  const manualEdits = useMemo(() => {
    return (resultEnvelope?.manualEdits ?? {}) as Record<string, any>;
  }, [resultEnvelope]);

  const hasProcessedRows = useMemo(() => {
    return rowsAll.some((r: any) =>
      typeof r?.status === "string" ||
      typeof r?.decisionReason === "string" ||
      typeof r?.normalizedLine === "string"
    );
  }, [rowsAll]);

  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rowsAll) s.add(String((r as any)?.status ?? ""));
    return ["ALL", ...Array.from(s).filter(Boolean).sort((a, b) => a.localeCompare(b))];
  }, [rowsAll]);

  const rowsFiltered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return rowsAll.filter((r: any) => {
      const st = String(r?.status ?? "");

      if (statusFilter !== "ALL" && st !== statusFilter) return false;

      const hasCoords =
        typeof r?.lat === "number" &&
        typeof r?.lng === "number" &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng);

      if (onlyWithCoords && !hasCoords) return false;

      if (!qq) return true;

      const hay = [
        r?.sequence,
        r?.status,
        r?.original,
        r?.normalizedLine,
        r?.bairro,
        r?.city,
        r?.cep,
        r?.quadraAuto,
        r?.loteAuto,
        r?.notesAuto,
        r?.decisionReason,
      ]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" | ");

      return hay.includes(qq);
    });
  }, [rowsAll, q, statusFilter, onlyWithCoords]);

  const summary = useMemo(() => {
    const by: Record<string, number> = {};
    for (const r of rowsAll) {
      const st = String((r as any)?.status ?? "SEM_STATUS");
      by[st] = (by[st] || 0) + 1;
    }
    return by;
  }, [rowsAll]);

  const metrics = useMemo(() => {
    const total = Number(job?.totalStops || rowsAll.length || 0);
    const processed = Number(job?.processedStops || 0);
    const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;

    const statusCounts: Record<string, number> = {
      OK: 0,
      PARCIAL: 0,
      NAO_ENCONTRADO: 0,
      MANUAL: 0,
      CONFIRMADO: 0,
      REVISAO: 0,
    };

    let memoryHits = 0;
    let manualCorrections = 0;

    rowsAll.forEach((row: any, idx: number) => {
      const manual = manualEdits[idx];
      const derivedStatus = getDerivedRowStatus(row, manual);
      statusCounts[derivedStatus] = (statusCounts[derivedStatus] || 0) + 1;

      if (manual?.review) {
        statusCounts.REVISAO = (statusCounts.REVISAO || 0) + 1;
      }

      if (hasManualEditData(manual)) {
        manualCorrections += 1;
      }

      if (isMemoryHitRow(row)) {
        memoryHits += 1;
      }
    });

    const memoryHitRate =
      total > 0 ? Math.round((memoryHits / total) * 100) : 0;

    return {
      total,
      processed,
      progressPct,
      memoryHits,
      memoryHitRate,
      manualCorrections,
      statusCounts,
    };
  }, [job, rowsAll, manualEdits]);

  function exportCircuitCSV() {
    const rows = rowsAll;
    const allowed = new Set(["OK", "MANUAL", "CONFIRMADO"]);
    const exportRows = rows.filter((r: any) => allowed.has(String(r?.status ?? "")));

    if (!exportRows.length) {
      alert("Não tem linhas OK/MANUAL para exportar.");
      return;
    }

    const header = ["Stop Name", "Address", "Latitude", "Longitude", "Notes"];

    const lines = exportRows.map((r: any) => {
      const stopName = `Seq ${r?.sequence ?? ""}`.trim() || "Stop";
      const address = String(r?.normalizedLine ?? "").trim() || String(r?.original ?? "").trim();
      const lat = typeof r?.lat === "number" ? String(r.lat) : "";
      const lng = typeof r?.lng === "number" ? String(r.lng) : "";

      const ql = [r?.quadraAuto ? `Q${r.quadraAuto}` : "", r?.loteAuto ? `L${r.loteAuto}` : ""]
        .filter(Boolean)
        .join(" ");
      const notesParts = [
        ql,
        String(r?.notesAuto ?? "").trim(),
        r?.decisionReason ? `reason:${r.decisionReason}` : "",
      ].filter((x) => String(x).trim().length > 0);

      const notes = notesParts.join(" | ");

      return [csvEscape(stopName), csvEscape(address), csvEscape(lat), csvEscape(lng), csvEscape(notes)].join(",");
    });

    const csv = [header.join(","), ...lines].join("\n");

    const fileBase = (job?.originalName || "importacao").replace(/[^\w\-]+/g, "_");
    downloadTextFile(`CIRCUIT_${fileBase}_${job?.id}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportResultJSON() {
    const json = JSON.stringify(rowsAll, null, 2);
    const fileBase = (job?.originalName || "importacao").replace(/[^\w\-]+/g, "_");
    downloadTextFile(`RESULT_${fileBase}_${job?.id}.json`, json, "application/json;charset=utf-8");
  }

  if (loading) return <div className="p-8">Carregando...</div>;
  if (!job) return <div className="p-8">Job não encontrado.</div>;

  const MAX = 300;
  const show = rowsFiltered.slice(0, MAX);

  return (
    <div className="p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Job</h1>

          <div className="text-sm text-slate-600 mt-1">
            <span className="font-semibold">Arquivo:</span>{" "}
            {job.originalName || "Planilha sem nome"}
          </div>

          <div className="text-sm text-slate-600">
            <span className="font-semibold">Status:</span> {job.status} —{" "}
            {job.processedStops}/{job.totalStops}
          </div>

          <div className="mt-3 h-2 w-full max-w-xl rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, metrics.progressPct))}%` }}
            />
          </div>

          <div className="text-xs text-slate-500 mt-1">
            Progresso: {metrics.progressPct}%
          </div>

          {job.resultSavedAt && (
            <div className="text-xs text-slate-500 mt-1">
              Resultado salvo em:{" "}
              {new Date(job.resultSavedAt).toLocaleString("pt-BR")}
            </div>
          )}

          <div className="text-xs text-slate-500 mt-2">
            Resumo:{" "}
            {Object.entries(summary)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([k, v]) => `${k}:${v}`)
              .join("  •  ")}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
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

          <div className="flex gap-2">
            <button
              className="px-3 py-2 rounded-xl border hover:bg-slate-50"
              onClick={exportResultJSON}
              title="Baixar o resultJson completo"
              disabled={!rowsAll.length}
            >
              Baixar JSON
            </button>

            <button
              className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={exportCircuitCSV}
              disabled={!rowsAll.length || job.status !== "DONE"}
              title={job.status === "DONE" ? "Exportar CSV para importar no Circuit" : "Só libera quando estiver DONE"}
            >
              Exportar Circuit (CSV)
            </button>
          </div>
        </div>
      </div>

      {job.status === "FAILED" && job.errorMessage && (
        <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
          Erro: {job.errorMessage}
        </div>
      )}

      {(job.status === "PENDING" || job.status === "PROCESSING") && (
        <div className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
          Visualização somente leitura. Este job ainda está em andamento e pode ser atualizado pelo usuário ou pelo processamento.
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total de linhas</div>
          <div className="mt-2 text-2xl font-bold">{metrics.total}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Memory hits</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? metrics.memoryHits : "-"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Reaproveitamento</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? `${metrics.memoryHitRate}%` : "-"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Correções manuais</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? metrics.manualCorrections : "-"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">OK</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? metrics.statusCounts.OK : "-"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">PARCIAL</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? metrics.statusCounts.PARCIAL : "-"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">NAO_ENCONTRADO</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? metrics.statusCounts.NAO_ENCONTRADO : "-"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">MANUAL</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? metrics.statusCounts.MANUAL : "-"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">CONFIRMADO</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? metrics.statusCounts.CONFIRMADO : "-"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">REVISAO</div>
          <div className="mt-2 text-2xl font-bold">{hasProcessedRows ? metrics.statusCounts.REVISAO : "-"}</div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 font-semibold border-b flex items-center justify-between gap-4">
          <div>
            {hasProcessedRows ? "Resultado/estado salvo" : "Prévia da importação"} ({rowsAll.length} linhas)
            {rowsAll.length > 0 && (
              <span className="text-xs text-slate-500 font-normal">
                {" "}
                — mostrando {show.length}/{rowsFiltered.length} (filtrado)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              className="px-3 py-2 rounded-xl border text-sm w-[260px]"
              placeholder="Buscar (rua, quadra, cep, status...)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <select
              className="px-3 py-2 rounded-xl border text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? "Todos status" : s}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onlyWithCoords}
                onChange={(e) => setOnlyWithCoords(e.target.checked)}
              />
              só com coords
            </label>
          </div>
        </div>

        {rowsAll.length === 0 ? (
          <div className="p-5 text-slate-600">
            Ainda não há conteúdo disponível para inspeção.
          </div>
        ) : (
          <div className="p-5 text-sm overflow-auto">
            <table className="min-w-[1400px] w-full">
              <thead>
                <tr className="text-left text-slate-600 border-b">
                  <th className="py-2 pr-3">Seq</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Original</th>
                  <th className="py-2 pr-3">End. encontrado</th>
                  <th className="py-2 pr-3">Bairro</th>
                  <th className="py-2 pr-3">Cidade</th>
                  <th className="py-2 pr-3">CEP</th>
                  <th className="py-2 pr-3">Quadra</th>
                  <th className="py-2 pr-3">Lote</th>
                  <th className="py-2 pr-3">Lat</th>
                  <th className="py-2 pr-3">Lng</th>
                  <th className="py-2 pr-3">Obs</th>
                  <th className="py-2 pr-3">Reason</th>
                </tr>
              </thead>

              <tbody>
                {show.map((r: any, idx: number) => (
                  <tr key={idx} className="border-b last:border-b-0 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{r.sequence ?? ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.status ?? ""}</td>
                    <td className="py-2 pr-3 min-w-[340px]">{r.original ?? ""}</td>
                    <td className="py-2 pr-3 min-w-[340px] text-slate-700">
                      {r.normalizedLine ?? ""}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.bairro ?? ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.city ?? ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.cep ?? ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.quadraAuto ?? ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.loteAuto ?? ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.lat ?? ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.lng ?? ""}</td>
                    <td className="py-2 pr-3 min-w-[240px]">{r.notesAuto ?? ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.decisionReason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {rowsFiltered.length > MAX && (
              <div className="text-xs text-slate-500 mt-3">
                Mostrando só as primeiras {MAX} linhas (filtradas) pra não travar.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
