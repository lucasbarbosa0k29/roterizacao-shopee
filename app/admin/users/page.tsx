"use client";

import { useEffect, useMemo, useState } from "react";

type UserRow = {
  id: string;
  name?: string | null;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  accessBlockedAt?: string | null;
  accessBlockReason?: string | null;
  access?: {
    isBlocked?: boolean;
    blockReason?: string | null;
    activeSubscription?: null | {
      code: "FREE" | "BASIC" | "PRO";
      name: string;
      expiresAt: string | null;
      source: "ADMIN_GRANT" | "TRIAL" | "INFINITEPAY_LINK" | "MANUAL_PAYMENT";
    };
    routeCreditsBalance?: number;
    code?: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
    canStartRoute?: boolean;
    allowanceSource?: "ADMIN" | "FREE" | "SUBSCRIPTION_DAILY" | "EXTRA_CREDIT" | "NONE";
  };
  createdAt: string;
  updatedAt: string;
};

export default function AdminUsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");
  const [creating, setCreating] = useState(false);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

  function getSafeAccess(user: UserRow) {
    return {
      isBlocked: user.access?.isBlocked ?? !!user.accessBlockedAt,
      blockReason: user.access?.blockReason ?? user.accessBlockReason ?? null,
      activeSubscription: user.access?.activeSubscription ?? null,
      routeCreditsBalance: user.access?.routeCreditsBalance ?? 0,
      code: user.access?.code ?? "NO_ACTIVE_SUBSCRIPTION",
      canStartRoute: user.access?.canStartRoute ?? false,
      allowanceSource: user.access?.allowanceSource ?? "NONE",
    } as const;
  }

  async function loadUsers() {
    try {
      setLoadingUsers(true);
      const res = await fetch("/api/admin/users", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao listar usuários.");
        setUsers([]);
        return;
      }

      setUsers(Array.isArray(data?.users) ? data.users : []);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return users.filter((u) => {
      if (onlyActive && !u.active) return false;
      if (!qq) return true;

      const hay = [u.name, u.email, u.role]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" | ");

      return hay.includes(qq);
    });
  }, [users, q, onlyActive]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();

    const emailClean = email.trim().toLowerCase();
    if (!emailClean) return alert("Email é obrigatório.");
    if (!password || password.length < 6) return alert("Senha mínimo 6 caracteres.");

    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: emailClean,
          password,
          role,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao criar usuário.");
        return;
      }

      alert(`Usuário criado: ${data?.user?.email || emailClean}`);

      setName("");
      setEmail("");
      setPassword("");
      setRole("USER");

      await loadUsers();
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(user: UserRow) {
    const ok = confirm(
      user.active ? `Desativar o usuário ${user.email}?` : `Ativar o usuário ${user.email}?`
    );
    if (!ok) return;

    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !user.active }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao atualizar usuário.");
        return;
      }

      await loadUsers();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(user: UserRow) {
    const ok = confirm(`Excluir o usuário ${user.email}?\n\nIsso NÃO tem volta.`);
    if (!ok) return;

    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao excluir usuário.");
        return;
      }

      await loadUsers();
    } finally {
      setBusyId(null);
    }
  }

  async function runAdminAction(
    user: UserRow,
    payload:
      | { action: "GRANT_FREE" }
      | { action: "GRANT_BASIC_30" }
      | { action: "GRANT_PRO_30" }
      | { action: "GRANT_TRIAL_7"; planCode?: "BASIC" | "PRO" }
      | { action: "GRANT_TRIAL_15"; planCode?: "BASIC" | "PRO" }
      | { action: "GRANT_TRIAL_30"; planCode?: "BASIC" | "PRO" }
      | { action: "ADD_ROUTE_CREDITS"; credits: number; notes?: string }
      | { action: "REMOVE_ROUTE_CREDITS"; credits: number; notes?: string }
      | { action: "REVOKE_ACTIVE_SUBSCRIPTION" }
      | { action: "BLOCK_ACCESS"; reason: string }
      | { action: "UNBLOCK_ACCESS" }
  ) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao executar ação.");
        return;
      }

      await loadUsers();
    } finally {
      setBusyId(null);
    }
  }

  async function grantCredits(user: UserRow) {
    const raw = prompt(`Quantos créditos adicionar para ${user.email}?`, "1");
    if (raw == null) return;

    const credits = Number(raw);
    if (!Number.isInteger(credits) || credits <= 0) {
      alert("Informe um número inteiro positivo.");
      return;
    }

    const notes = prompt("Observação (opcional):", "") ?? "";
    await runAdminAction(user, {
      action: "ADD_ROUTE_CREDITS",
      credits,
      notes: notes.trim() || undefined,
    });
  }

  async function removeCredits(user: UserRow) {
    const raw = prompt(`Quantos créditos remover de ${user.email}?`, "1");
    if (raw == null) return;

    const credits = Number(raw);
    if (!Number.isInteger(credits) || credits <= 0) {
      alert("Informe um número inteiro positivo.");
      return;
    }

    const notes = prompt("Motivo/observação da remoção (opcional):", "") ?? "";
    const ok = confirm(
      `Tem certeza que deseja remover ${credits} crédito(s) de ${user.email}?`
    );
    if (!ok) return;

    await runAdminAction(user, {
      action: "REMOVE_ROUTE_CREDITS",
      credits,
      notes: notes.trim() || undefined,
    });
  }

  async function revokeActiveSubscription(user: UserRow) {
    const ok = confirm("Tem certeza que deseja remover o plano ativo deste usuário?");
    if (!ok) return;

    await runAdminAction(user, {
      action: "REVOKE_ACTIVE_SUBSCRIPTION",
    });
  }

  async function blockAccess(user: UserRow) {
    const reason = prompt(`Motivo do bloqueio comercial para ${user.email}:`, "");
    if (reason == null) return;
    if (!reason.trim()) {
      alert("Motivo é obrigatório.");
      return;
    }

    await runAdminAction(user, {
      action: "BLOCK_ACCESS",
      reason: reason.trim(),
    });
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Usuários</h1>
          <p className="mt-2 text-slate-600">Aqui você cria contas e gerencia usuários ativos.</p>
        </div>

        <button
          type="button"
          className="px-3 py-2 rounded-xl border hover:bg-slate-50"
          onClick={() => (window.location.href = "/admin")}
        >
          Voltar
        </button>
      </div>

      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5 p-6">
        <div className="font-semibold mb-4">Criar usuário</div>

        <form onSubmit={onCreate} className="grid gap-3 max-w-xl">
          <div>
            <label className="text-sm font-medium">Nome (opcional)</label>
            <input
              className="mt-1 w-full rounded-xl border p-3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fulano"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              className="mt-1 w-full rounded-xl border p-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Senha</label>
            <input
              className="mt-1 w-full rounded-xl border p-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete="new-password"
            />
            <div className="text-xs text-slate-500 mt-1">Mínimo 6 caracteres.</div>
          </div>

          <div>
            <label className="text-sm font-medium">Tipo</label>
            <select
              className="mt-1 w-full rounded-xl border p-3"
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <div className="text-xs text-slate-500 mt-1">Dica: deixe só você como ADMIN.</div>
          </div>

          <button
            disabled={creating}
            className="mt-2 w-full rounded-xl bg-blue-600 text-white py-3 font-semibold disabled:opacity-60"
          >
            {creating ? "Criando..." : "Criar usuário"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
          <div className="font-semibold">Usuários cadastrados</div>

          <div className="flex items-center gap-3">
            <input
              className="px-3 py-2 rounded-xl border text-sm w-[260px]"
              placeholder="Buscar (nome, email, role...)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
              />
              só ativos
            </label>

            <button
              type="button"
              className="px-3 py-2 rounded-xl border hover:bg-slate-50"
              onClick={loadUsers}
            >
              Recarregar
            </button>
          </div>
        </div>

        {loadingUsers ? (
          <div className="p-5 text-slate-600">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-5 text-slate-600">Nenhum usuário encontrado.</div>
        ) : (
          <div className="p-5 overflow-auto">
            <table className="min-w-[1320px] w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600 border-b">
                  <th className="py-2 pr-3">Nome</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Plano</th>
                  <th className="py-2 pr-3">Créditos</th>
                  <th className="py-2 pr-3">Acesso comercial</th>
                  <th className="py-2 pr-3">Criado</th>
                  <th className="py-2 pr-3 text-right">Ações</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((u) => {
                  const busy = busyId === u.id;
                  const access = getSafeAccess(u);

                  return (
                    <tr key={u.id} className="border-b last:border-b-0 align-top">
                      <td className="py-2 pr-3">{u.name || "-"}</td>
                      <td className="py-2 pr-3">{u.email}</td>
                      <td className="py-2 pr-3">{u.role}</td>
                      <td className="py-2 pr-3">
                        {u.active ? (
                          <span className="text-green-700 font-semibold">ATIVO</span>
                        ) : (
                          <span className="text-slate-500 font-semibold">INATIVO</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {u.role === "ADMIN" ? (
                          <span className="font-semibold text-slate-500">ADMIN</span>
                        ) : access.activeSubscription ? (
                          <div className="leading-5">
                            <div className="font-semibold">{access.activeSubscription.code}</div>
                            <div className="text-xs text-slate-500">
                              {access.activeSubscription.expiresAt
                                ? `até ${new Date(access.activeSubscription.expiresAt).toLocaleString("pt-BR")}`
                                : "sem expiração"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">Sem plano</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {u.role === "ADMIN" ? "-" : access.routeCreditsBalance}
                      </td>
                      <td className="py-2 pr-3">
                        {u.role === "ADMIN" ? (
                          <span className="text-slate-500">Sempre liberado</span>
                        ) : access.isBlocked ? (
                          <div className="leading-5">
                            <div className="font-semibold text-red-700">Bloqueado</div>
                            <div className="text-xs text-slate-500">
                              {access.blockReason || "Sem motivo informado"}
                            </div>
                          </div>
                        ) : (
                          <div className="leading-5">
                            <div className="font-semibold text-green-700">
                              {access.canStartRoute ? "Liberado" : "Sem acesso"}
                            </div>
                            <div className="text-xs text-slate-500">{access.code}</div>
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {new Date(u.createdAt).toLocaleString("pt-BR")}
                      </td>

                      <td className="py-2 pr-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2 max-w-[560px] ml-auto">
                          <button
                            className={`text-sm hover:underline ${
                              busy ? "text-slate-400 cursor-wait" : "text-blue-700"
                            }`}
                            disabled={busy}
                            onClick={() => toggleActive(u)}
                          >
                            {u.active ? "Desativar" : "Ativar"}
                          </button>

                          {u.role === "USER" && (
                            <>
                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-emerald-700"
                                }`}
                                disabled={busy}
                                onClick={() => runAdminAction(u, { action: "GRANT_FREE" })}
                              >
                                FREE
                              </button>

                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-emerald-700"
                                }`}
                                disabled={busy}
                                onClick={() => runAdminAction(u, { action: "GRANT_BASIC_30" })}
                              >
                                BASIC 30d
                              </button>

                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-emerald-700"
                                }`}
                                disabled={busy}
                                onClick={() => runAdminAction(u, { action: "GRANT_PRO_30" })}
                              >
                                PRO 30d
                              </button>

                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-violet-700"
                                }`}
                                disabled={busy}
                                onClick={() =>
                                  runAdminAction(u, { action: "GRANT_TRIAL_7", planCode: "BASIC" })
                                }
                              >
                                Trial 7d
                              </button>

                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-violet-700"
                                }`}
                                disabled={busy}
                                onClick={() =>
                                  runAdminAction(u, { action: "GRANT_TRIAL_15", planCode: "BASIC" })
                                }
                              >
                                Trial 15d
                              </button>

                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-violet-700"
                                }`}
                                disabled={busy}
                                onClick={() =>
                                  runAdminAction(u, { action: "GRANT_TRIAL_30", planCode: "BASIC" })
                                }
                              >
                                Trial 30d
                              </button>

                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-amber-700"
                                }`}
                                disabled={busy}
                                onClick={() => grantCredits(u)}
                              >
                                +Créditos
                              </button>

                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-amber-900"
                                }`}
                                disabled={busy}
                                onClick={() => removeCredits(u)}
                              >
                                -Créditos
                              </button>

                              <button
                                className={`text-sm hover:underline ${
                                  busy ? "text-slate-400 cursor-wait" : "text-rose-700"
                                }`}
                                disabled={busy}
                                onClick={() => revokeActiveSubscription(u)}
                              >
                                Remover plano
                              </button>

                              {access.isBlocked ? (
                                <button
                                  className={`text-sm hover:underline ${
                                    busy ? "text-slate-400 cursor-wait" : "text-green-700"
                                  }`}
                                  disabled={busy}
                                  onClick={() => runAdminAction(u, { action: "UNBLOCK_ACCESS" })}
                                >
                                  Desbloquear
                                </button>
                              ) : (
                                <button
                                  className={`text-sm hover:underline ${
                                    busy ? "text-slate-400 cursor-wait" : "text-orange-700"
                                  }`}
                                  disabled={busy}
                                  onClick={() => blockAccess(u)}
                                >
                                  Bloquear
                                </button>
                              )}
                            </>
                          )}

                          <button
                            className={`text-sm hover:underline ${
                              busy ? "text-slate-400 cursor-wait" : "text-red-700"
                            }`}
                            disabled={busy}
                            onClick={() => deleteUser(u)}
                          >
                            Excluir
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
    </div>
  );
}
