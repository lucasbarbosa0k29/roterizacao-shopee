"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { isSuperAdmin } from "@/app/lib/admin-roles";

type AdministratorRow = {
  id: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  createdAt: string;
  isSuperAdmin: boolean;
};

type AuditRow = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; email: string; name: string | null };
  target: { id: string; email: string; name: string | null };
  metadata: {
    actorEmail?: string;
    targetEmail?: string;
    action?: string;
    before?: { role?: string; active?: boolean };
    after?: { role?: string; active?: boolean };
    createdAt?: string;
  } | null;
};

type AdminAdministratorsResponse = {
  ok: true;
  users: AdministratorRow[];
  auditLogs: AuditRow[];
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function roleLabel(user: AdministratorRow) {
  return user.isSuperAdmin ? "SUPER_ADMIN" : user.role;
}

export default function AdminAdministratorsPage() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<AdministratorRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const canAccess = isSuperAdmin(session?.user as any);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/administrators", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });

      const data = (await res.json().catch(() => ({}))) as Partial<AdminAdministratorsResponse> & {
        error?: string;
      };

      if (!res.ok) {
        setUsers([]);
        setAuditLogs([]);
        return;
      }

      setUsers(Array.isArray(data.users) ? data.users : []);
      setAuditLogs(Array.isArray(data.auditLogs) ? data.auditLogs : []);
    } catch (error) {
      console.error("Erro ao carregar administradores:", error);
      setUsers([]);
      setAuditLogs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "loading") return;
    if (!canAccess) return;
    load();
  }, [canAccess, status]);

  const superAdminCount = useMemo(
    () => users.filter((user) => user.isSuperAdmin || (user.role === "ADMIN" && user.isSuperAdmin)).length,
    [users]
  );

  async function runAction(user: AdministratorRow, action: string) {
    const ok = confirm(`Executar ${action} para ${user.email}?`);
    if (!ok) return;

    try {
      setSavingId(user.id);
      const res = await fetch(`/api/admin/administrators/${user.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao executar ação.");
        return;
      }

      await load();
    } finally {
      setSavingId(null);
    }
  }

  if (status === "loading") {
    return <div className="p-8 text-slate-600">Carregando...</div>;
  }

  if (!canAccess) {
    return (
      <div className="p-8">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
          Acesso restrito. Esta área é visível apenas para SUPER_ADMIN.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Administradores</h1>
          <p className="mt-2 text-slate-600">
            Controle de permissões administrativas. Acesso restrito ao SUPER_ADMIN.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          SUPER_ADMIN ativos: <span className="font-semibold text-slate-950">{superAdminCount}</span>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 font-semibold">Equipe administrativa</div>
        {loading ? (
          <div className="p-5 text-slate-600">Carregando administradores...</div>
        ) : users.length === 0 ? (
          <div className="p-5 text-slate-600">Nenhum usuário encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-5 py-3 font-semibold">Nome</th>
                  <th className="px-5 py-3 font-semibold">E-mail</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Criado em</th>
                  <th className="px-5 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const busy = savingId === user.id;
                  const isProtectedSuperAdmin = user.isSuperAdmin;
                  const canPromote = user.role === "USER" && !isProtectedSuperAdmin;
                  const canDemote = user.role === "ADMIN" && !isProtectedSuperAdmin;
                  const canToggleActive = !isProtectedSuperAdmin;

                  return (
                    <tr key={user.id} className="border-b border-slate-100 align-top">
                      <td className="px-5 py-4 font-semibold text-slate-950">{user.name || "-"}</td>
                      <td className="px-5 py-4 text-slate-700">{user.email}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {roleLabel(user)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={[
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            user.active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-600",
                          ].join(" ")}
                        >
                          {user.active ? "ATIVO" : "INATIVO"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-700">{formatDateTime(user.createdAt)}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy || !canPromote}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            onClick={() => runAction(user, "PROMOTE_TO_ADMIN")}
                          >
                            Promover
                          </button>
                          <button
                            type="button"
                            disabled={busy || !canDemote}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            onClick={() => runAction(user, "DEMOTE_TO_USER")}
                          >
                            Rebaixar
                          </button>
                          <button
                            type="button"
                            disabled={busy || !canToggleActive || user.active}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            onClick={() => runAction(user, "DISABLE_ADMIN_USER")}
                          >
                            Desativar
                          </button>
                          <button
                            type="button"
                            disabled={busy || !canToggleActive || !user.active}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            onClick={() => runAction(user, "ENABLE_ADMIN_USER")}
                          >
                            Ativar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 font-semibold">Auditoria</div>
        {auditLogs.length === 0 ? (
          <div className="p-5 text-slate-600">Sem ações recentes.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-950">{log.action}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTime(log.createdAt)} · Por: {log.actor.email}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {log.target.email}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                  <div>
                    <span className="font-semibold text-slate-700">Antes:</span>{" "}
                    {log.metadata?.before ? JSON.stringify(log.metadata.before) : "-"}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">Depois:</span>{" "}
                    {log.metadata?.after ? JSON.stringify(log.metadata.after) : "-"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
