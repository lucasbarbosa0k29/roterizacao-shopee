"use client";

export const dynamic = "force-dynamic";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/importar-planilha";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);

    const res = await signIn("credentials", {
      redirect: false,
      email: email.trim().toLowerCase(),
      password,
      callbackUrl,
    });

    setLoading(false);

    if (!res || res.error) {
      setErr("Usuário ou senha inválidos.");
      return;
    }

    router.push(callbackUrl);
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
          {/* Ícone laranja */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500 shadow-md">
            <span className="text-xl font-extrabold text-white">RT</span>
          </div>

          <h1 className="text-center text-2xl font-bold text-slate-900">
            RT Shopee
          </h1>
          <p className="mt-1 text-center text-sm text-slate-500">
            Entre para gerenciar suas rotas
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold tracking-wide text-slate-600">
                USUÁRIO (EMAIL)
              </label>
              <input
                type="email"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-orange-400"
                placeholder="seuemail@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold tracking-wide text-slate-600">
                SENHA
              </label>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-orange-400"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {err && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white shadow-md hover:bg-orange-600 disabled:opacity-60"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">
            RT Shopee © Copyright 2026
          </p>
        </div>
      </div>
    </div>
  );
}