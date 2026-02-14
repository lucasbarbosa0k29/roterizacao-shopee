"use client";

import { useEffect, useMemo, useState } from "react";

type UserRow = {
  id: string;
  name?: string | null;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function AdminUsersPage() {
  // ===== criar usuário =====
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");
  const [creating, setCreating] = useState(false);

  // ===== listar usuários =====
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

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
      user.active
        ? `Desativar o usuário ${user.email}?`
        : `Ativar o usuário ${user.email}?`
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
    const ok = confirm(
      `Excluir o usuário ${user.email}?\n\nIsso NÃO tem volta.`
    );
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

  return (
    <div className="p-8 space-y-8">
      {/* TOPO */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Usuários</h1>
          <p className="mt-2 text-slate-600">
            Aqui você cria contas e gerencia usuários ativos.
          </p>
        </div>

        <button
          type="button"
          className="px-3 py-2 rounded-xl border hover:bg-slate-50"
          onClick={() => (window.location.href = "/admin")}
        >
          Voltar
        </button>
      </div>

      {/* CRIAR */}
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
            <div className="text-xs text-slate-500 mt-1">
              Dica: deixe só você como ADMIN.
            </div>
          </div>

          <button
            disabled={creating}
            className="mt-2 w-full rounded-xl bg-blue-600 text-white py-3 font-semibold disabled:opacity-60"
          >
            {creating ? "Criando..." : "Criar usuário"}
          </button>
        </form>
      </div>

      {/* LISTA */}
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
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600 border-b">
                  <th className="py-2 pr-3">Nome</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Criado</th>
                  <th className="py-2 pr-3 text-right">Ações</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((u) => {
                  const busy = busyId === u.id;

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
                        {new Date(u.createdAt).toLocaleString("pt-BR")}
                      </td>

                      <td className="py-2 pr-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            className={`text-sm hover:underline ${
                              busy ? "text-slate-400 cursor-wait" : "text-blue-700"
                            }`}
                            disabled={busy}
                            onClick={() => toggleActive(u)}
                          >
                            {u.active ? "Desativar" : "Ativar"}
                          </button>

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