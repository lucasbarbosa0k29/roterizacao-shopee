"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const highlights = [
  "Importação assistida de planilhas",
  "Conferência visual por mapa",
  "Exportação final para o Circuit",
];

export default function LoginClient() {
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
      setErr("Usuario ou senha invalidos.");
      return;
    }

    router.push(callbackUrl);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(31,90,107,0.16),transparent_28%),linear-gradient(180deg,#f7faf9_0%,#eef4f3_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid w-full overflow-hidden rounded-[36px] border border-slate-200/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.10)] lg:grid-cols-[1.15fr_0.85fr]">
          <section className="relative hidden min-h-[680px] overflow-hidden bg-[linear-gradient(160deg,#10242c_0%,#17313b_38%,#1f5a6b_100%)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(223,245,239,0.18),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.10),transparent_24%)]" />

            <div className="relative z-10">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-[linear-gradient(145deg,#f7fffd_0%,#dff5ef_65%,#bfe6da_100%)] shadow-[0_18px_30px_rgba(0,0,0,0.22)]">
                <span className="bg-[linear-gradient(180deg,#17313b_0%,#1f5a6b_100%)] bg-clip-text text-3xl font-black text-transparent">
                  R
                </span>
              </div>

              <div className="mt-8 max-w-xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">
                  Operação Inteligente
                </div>
                <h1 className="mt-4 text-5xl font-black tracking-tight text-white">
                  Rotta
                </h1>
                <p className="mt-3 text-lg font-medium text-white/82">
                  Roteirização, conferência e exportação em um só fluxo.
                </p>
                <p className="mt-6 max-w-lg text-sm leading-7 text-white/68">
                  Transforme planilhas operacionais em rotas revisadas, organizadas e prontas para o Circuit.
                </p>
              </div>
            </div>

            <div className="relative z-10 grid gap-3">
              {highlights.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 backdrop-blur"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dff5ef] text-sm font-bold text-[#0f5f58]">
                    ✓
                  </div>
                  <div className="text-sm text-white/88">{item}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-[680px] items-center justify-center bg-[linear-gradient(180deg,#fcfefd_0%,#f4f8f7_100%)] px-5 py-8 sm:px-8 lg:px-12">
            <div className="w-full max-w-md">
              <div className="mb-8 text-center lg:hidden">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-[linear-gradient(145deg,#17313b_0%,#1f5a6b_100%)] shadow-[0_18px_30px_rgba(23,49,59,0.22)]">
                  <span className="text-3xl font-black text-white">R</span>
                </div>
                <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-900">
                  Rotta
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  Roteirização, conferência e exportação em um só fluxo.
                </p>
              </div>

              <div className="rounded-[32px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8">
                <div className="hidden lg:block">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1f5a6b]">
                    Acesso seguro
                  </div>
                  <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">
                    Entrar no Rotta
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Acesse sua central de operação para revisar endereços, corrigir pontos no mapa e finalizar suas rotas.
                  </p>
                </div>

                <form onSubmit={onSubmit} className="mt-8 space-y-5">
                  <div>
                    <label className="mb-2.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Usuario (email)
                    </label>
                    <input
                      type="email"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1f5a6b] focus:bg-white focus:ring-4 focus:ring-[#d8ece7]"
                      placeholder="voce@empresa.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Senha
                    </label>
                    <input
                      type="password"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1f5a6b] focus:bg-white focus:ring-4 focus:ring-[#d8ece7]"
                      placeholder="Digite sua senha"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>

                  {err && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {err}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-2xl bg-[linear-gradient(135deg,#17313b_0%,#1f5a6b_100%)] px-4 py-3.5 font-semibold text-white shadow-[0_18px_34px_rgba(23,49,59,0.24)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "Entrando..." : "Entrar"}
                  </button>
                </form>

                <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs leading-6 text-slate-500">
                  Acesso seguro ao painel operacional da sua roteirização.
                </div>

                <p className="mt-6 text-center text-xs text-slate-400">
                  Rotta © 2026
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
