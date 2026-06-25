"use client";

import { useEffect, useMemo, useState } from "react";

type AliasStatus = "PENDING" | "APPROVED" | "REJECTED" | "DISABLED";
type AliasType = "BAIRRO" | "RUA" | "BAIRRO_RUA";
type AliasAction =
  | "validate"
  | "approve"
  | "reject"
  | "disable"
  | "updateTarget"
  | "note";

type AliasRow = {
  id: string;
  city: string;
  aliasType: AliasType;
  sourceBairro: string;
  sourceRua: string;
  targetBairro: string | null;
  targetRua: string | null;
  status: AliasStatus;
  source: string;
  confidence: number;
  usageCount: number;
  lastValidationStatus: string;
  lastFailureReason: string | null;
  updatedAt: string;
  notes?: string | null;
};

type AliasStats = {
  totalAliases: number;
  approved: number;
  pending: number;
  rejected: number;
  disabled: number;
  totalUsage: number;
  approvedGoiania: number;
  approvedAparecida: number;
  pendingGoiania: number;
  pendingAparecida: number;
  aliasesUsedToday: number;
  aliasesUsedLast7Days: number;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ActionModalState = {
  action: AliasAction;
  alias: AliasRow;
};

const PAGE_SIZE = 50;

const EMPTY_STATS: AliasStats = {
  totalAliases: 0,
  approved: 0,
  pending: 0,
  rejected: 0,
  disabled: 0,
  totalUsage: 0,
  approvedGoiania: 0,
  approvedAparecida: 0,
  pendingGoiania: 0,
  pendingAparecida: 0,
  aliasesUsedToday: 0,
  aliasesUsedLast7Days: 0,
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatPercent(value: number) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function actionTitle(action: AliasAction) {
  if (action === "validate") return "Validar alias";
  if (action === "approve") return "Aprovar alias";
  if (action === "reject") return "Rejeitar alias";
  if (action === "disable") return "Desativar alias";
  if (action === "updateTarget") return "Editar target";
  return "Editar nota";
}

export default function LocalFirstAliasesAdminPage() {
  const [items, setItems] = useState<AliasRow[]>([]);
  const [stats, setStats] = useState<AliasStats>(EMPTY_STATS);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ActionModalState | null>(null);
  const [validationResult, setValidationResult] = useState<any>(null);

  const [city, setCity] = useState("");
  const [status, setStatus] = useState("");
  const [aliasType, setAliasType] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [sampleQuadra, setSampleQuadra] = useState("");
  const [sampleLote, setSampleLote] = useState("");
  const [targetBairro, setTargetBairro] = useState("");
  const [targetRua, setTargetRua] = useState("");
  const [reason, setReason] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState("");
  const [notes, setNotes] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (city) params.set("city", city);
    if (status) params.set("status", status);
    if (aliasType) params.set("aliasType", aliasType);
    if (q.trim()) params.set("q", q.trim());
    return params.toString();
  }, [aliasType, city, page, q, status]);

  async function loadStats() {
    const res = await fetch("/api/admin/local-first-aliases/stats", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { "Cache-Control": "no-store" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Erro ao carregar metricas.");
    setStats(data?.stats || EMPTY_STATS);
  }

  async function loadAliases() {
    const res = await fetch(`/api/admin/local-first-aliases?${queryString}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { "Cache-Control": "no-store" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Erro ao listar aliases.");
    setItems(Array.isArray(data?.items) ? data.items : []);
    setPagination(data?.pagination || {
      page,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 0,
    });
  }

  async function loadAll() {
    try {
      setLoading(true);
      setError(null);
      await Promise.all([loadStats(), loadAliases()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar aliases.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [queryString]);

  function resetFilters() {
    setCity("");
    setStatus("");
    setAliasType("");
    setQ("");
    setPage(1);
  }

  function openModal(action: AliasAction, alias: AliasRow) {
    setModal({ action, alias });
    setValidationResult(null);
    setSampleQuadra("");
    setSampleLote("");
    setTargetBairro(alias.targetBairro || "");
    setTargetRua(alias.targetRua || "");
    setReason("");
    setCooldownUntil("");
    setNotes(alias.notes || "");
  }

  function closeModal() {
    if (busyId) return;
    setModal(null);
    setValidationResult(null);
  }

  async function submitModal(event: React.FormEvent) {
    event.preventDefault();
    if (!modal) return;

    const action = modal.action;
    const alias = modal.alias;

    if ((action === "validate" || action === "approve") && (!sampleQuadra.trim() || !sampleLote.trim())) {
      alert("sampleQuadra e sampleLote sao obrigatorios.");
      return;
    }

    if ((action === "reject" || action === "disable") && !reason.trim()) {
      alert("reason e obrigatorio.");
      return;
    }

    setBusyId(alias.id);
    try {
      const endpoint = `/api/admin/local-first-aliases/${alias.id}`;
      const isValidate = action === "validate";
      const payload: Record<string, unknown> = {};

      if (isValidate || action === "approve") {
        payload.sampleQuadra = sampleQuadra.trim();
        payload.sampleLote = sampleLote.trim();
        if (targetBairro.trim()) payload.targetBairro = targetBairro.trim();
        if (targetRua.trim()) payload.targetRua = targetRua.trim();
      }

      if (action === "reject" || action === "disable") {
        payload.action = action;
        payload.reason = reason.trim();
        if (cooldownUntil.trim() && action === "reject") {
          payload.cooldownUntil = cooldownUntil.trim();
        }
      } else if (action === "updateTarget") {
        payload.action = "updateTarget";
        payload.targetBairro = targetBairro.trim() || null;
        payload.targetRua = targetRua.trim() || null;
      } else if (action === "note") {
        payload.action = "note";
      } else if (action === "approve") {
        payload.action = "approve";
      }

      if (!isValidate && notes.trim()) payload.notes = notes.trim();

      const res = await fetch(isValidate ? `${endpoint}/validate` : endpoint, {
        method: isValidate ? "POST" : "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setValidationResult(data?.result || data?.validation || data || null);
        alert(data?.error || "Acao nao concluida.");
        return;
      }

      if (isValidate) {
        setValidationResult(data);
      } else {
        setModal(null);
      }

      await loadAll();
    } finally {
      setBusyId(null);
    }
  }

  async function enableAlias(alias: AliasRow) {
    const ok = confirm("Reativar este alias como PENDING?");
    if (!ok) return;

    setBusyId(alias.id);
    try {
      const res = await fetch(`/api/admin/local-first-aliases/${alias.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao reativar alias.");
        return;
      }
      await loadAll();
    } finally {
      setBusyId(null);
    }
  }

  const metricCards = [
    ["Total", stats.totalAliases],
    ["Pendentes", stats.pending],
    ["Aprovados", stats.approved],
    ["Rejeitados", stats.rejected],
    ["Desativados", stats.disabled],
    ["Uso total", stats.totalUsage],
    ["Aprovados GOI", stats.approvedGoiania],
    ["Aprovados APA", stats.approvedAparecida],
  ] as const;

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Aliases LocalFirst</h1>
          <p className="mt-2 text-sm text-slate-600">
            Gestao administrativa de aliases de bairro e rua.
          </p>
        </div>

        <button
          type="button"
          className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          onClick={loadAll}
        >
          Recarregar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </div>
            <div className="mt-2 text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="grid gap-3 md:grid-cols-5">
          <select
            className="rounded-xl border px-3 py-2 text-sm"
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas cidades</option>
            <option value="GOIANIA">GOIANIA</option>
            <option value="APARECIDA">APARECIDA</option>
          </select>

          <select
            className="rounded-xl border px-3 py-2 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos status</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="DISABLED">DISABLED</option>
          </select>

          <select
            className="rounded-xl border px-3 py-2 text-sm"
            value={aliasType}
            onChange={(event) => {
              setAliasType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos tipos</option>
            <option value="BAIRRO">BAIRRO</option>
            <option value="RUA">RUA</option>
            <option value="BAIRRO_RUA">BAIRRO_RUA</option>
          </select>

          <input
            className="rounded-xl border px-3 py-2 text-sm"
            placeholder="Buscar"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />

          <button
            type="button"
            className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            onClick={resetFilters}
          >
            Limpar
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="font-semibold">Aliases</div>
          <div className="text-sm text-slate-500">
            {pagination.total} registros
          </div>
        </div>

        {error && <div className="p-5 text-sm text-red-700">{error}</div>}
        {loading && <div className="p-5 text-sm text-slate-600">Carregando...</div>}

        {!loading && !error && items.length === 0 && (
          <div className="p-5 text-sm text-slate-600">Nenhum alias encontrado.</div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="overflow-x-auto p-5">
            <table className="min-w-[1500px] w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-2 pr-3">Cidade</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Origem</th>
                  <th className="py-2 pr-3">Target</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Fonte</th>
                  <th className="py-2 pr-3">Conf.</th>
                  <th className="py-2 pr-3">Uso</th>
                  <th className="py-2 pr-3">Validacao</th>
                  <th className="py-2 pr-3">Falha</th>
                  <th className="py-2 pr-3">Atualizado</th>
                  <th className="py-2 pr-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const busy = busyId === item.id;

                  return (
                    <tr key={item.id} className="border-b align-top last:border-b-0">
                      <td className="py-3 pr-3 font-medium">{item.city}</td>
                      <td className="py-3 pr-3">{item.aliasType}</td>
                      <td className="py-3 pr-3">
                        <div>{item.sourceBairro || "-"}</div>
                        <div className="text-xs text-slate-500">{item.sourceRua || "-"}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div>{item.targetBairro || "-"}</div>
                        <div className="text-xs text-slate-500">{item.targetRua || "-"}</div>
                      </td>
                      <td className="py-3 pr-3">{item.status}</td>
                      <td className="py-3 pr-3">{item.source}</td>
                      <td className="py-3 pr-3">{formatPercent(item.confidence)}</td>
                      <td className="py-3 pr-3">{item.usageCount}</td>
                      <td className="py-3 pr-3">{item.lastValidationStatus}</td>
                      <td className="max-w-[220px] py-3 pr-3 text-xs text-slate-600">
                        {item.lastFailureReason || "-"}
                      </td>
                      <td className="py-3 pr-3">{formatDate(item.updatedAt)}</td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => openModal("validate", item)}>Validar</button>
                          <button className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => openModal("approve", item)}>Aprovar</button>
                          <button className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => openModal("reject", item)}>Rejeitar</button>
                          <button className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => openModal("disable", item)}>Desativar</button>
                          <button className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => enableAlias(item)}>Reativar</button>
                          <button className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => openModal("updateTarget", item)}>Target</button>
                          <button className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => openModal("note", item)}>Nota</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t px-5 py-4 text-sm">
          <button
            type="button"
            className="rounded-xl border px-3 py-2 disabled:opacity-50"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </button>
          <div className="text-slate-600">
            Pagina {pagination.page} de {Math.max(1, pagination.totalPages)}
          </div>
          <button
            type="button"
            className="rounded-xl border px-3 py-2 disabled:opacity-50"
            disabled={page >= pagination.totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            Proxima
          </button>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl ring-1 ring-black/10">
            <div className="text-lg font-semibold">{actionTitle(modal.action)}</div>
            <div className="mt-1 text-sm text-slate-500">
              {modal.alias.city} / {modal.alias.aliasType} / {modal.alias.sourceBairro}
            </div>

            <form onSubmit={submitModal} className="mt-5 space-y-4">
              {(modal.action === "validate" || modal.action === "approve") && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">sampleQuadra</label>
                    <input className="mt-1 w-full rounded-xl border p-3" value={sampleQuadra} onChange={(event) => setSampleQuadra(event.target.value)} autoFocus />
                  </div>
                  <div>
                    <label className="text-sm font-medium">sampleLote</label>
                    <input className="mt-1 w-full rounded-xl border p-3" value={sampleLote} onChange={(event) => setSampleLote(event.target.value)} />
                  </div>
                </div>
              )}

              {(modal.action === "validate" || modal.action === "approve" || modal.action === "updateTarget") && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">targetBairro</label>
                    <input className="mt-1 w-full rounded-xl border p-3" value={targetBairro} onChange={(event) => setTargetBairro(event.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">targetRua</label>
                    <input className="mt-1 w-full rounded-xl border p-3" value={targetRua} onChange={(event) => setTargetRua(event.target.value)} />
                  </div>
                </div>
              )}

              {(modal.action === "reject" || modal.action === "disable") && (
                <div>
                  <label className="text-sm font-medium">reason</label>
                  <input className="mt-1 w-full rounded-xl border p-3" value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
                </div>
              )}

              {modal.action === "reject" && (
                <div>
                  <label className="text-sm font-medium">cooldownUntil</label>
                  <input className="mt-1 w-full rounded-xl border p-3" value={cooldownUntil} onChange={(event) => setCooldownUntil(event.target.value)} placeholder="2026-12-31T23:59:00.000Z" />
                </div>
              )}

              {modal.action !== "validate" && (
                <div>
                  <label className="text-sm font-medium">notes</label>
                  <textarea className="mt-1 min-h-24 w-full rounded-xl border p-3" value={notes} onChange={(event) => setNotes(event.target.value)} />
                </div>
              )}

              {validationResult && (
                <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(validationResult, null, 2)}
                </pre>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60" disabled={busyId === modal.alias.id} onClick={closeModal}>
                  Fechar
                </button>
                <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={busyId === modal.alias.id}>
                  {busyId === modal.alias.id ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
