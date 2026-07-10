"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useStandaloneDisplayMode } from "../lib/useStandaloneDisplayMode";

const WHATSAPP_SUPPORT_URL = "https://wa.me/5562996344134";

const highlights = [
  "Importação assistida de planilhas",
  "Conferência visual por mapa",
  "Exportação final para o Circuit",
];

type AuthMode = "login" | "signup";

function maskCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function maskWhatsapp(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function WhatsAppIcon() {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#dcf8d7] text-[#147d4f] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="currentColor">
        <path d="M19.05 4.93A9.92 9.92 0 0 0 12.01 2C6.49 2 2 6.49 2 12.01c0 1.76.46 3.48 1.33 4.99L2 22l5.15-1.29a10 10 0 0 0 4.86 1.25h.01c5.52 0 10.01-4.49 10.01-10.01 0-2.68-1.04-5.2-2.98-7.02Zm-7.04 15.39h-.01a8.3 8.3 0 0 1-4.24-1.16l-.3-.17-3.06.77.82-2.98-.2-.31a8.3 8.3 0 0 1-1.28-4.44c0-4.57 3.72-8.29 8.3-8.29 2.21 0 4.29.86 5.85 2.43a8.22 8.22 0 0 1 2.43 5.86c0 4.57-3.72 8.29-8.31 8.29Zm4.55-6.19c-.25-.12-1.47-.73-1.7-.82-.23-.08-.39-.12-.56.12-.17.25-.66.82-.81.98-.15.17-.3.19-.56.06a6.63 6.63 0 0 1-1.96-1.2 7.38 7.38 0 0 1-1.36-1.69c-.14-.25-.01-.38.11-.5.11-.11.25-.3.38-.45.12-.15.17-.25.26-.42.08-.17.04-.32-.02-.45-.06-.12-.56-1.35-.77-1.85-.2-.49-.4-.42-.56-.43h-.48c-.16 0-.42.06-.64.3-.22.25-.85.84-.85 2.05 0 1.2.87 2.36.99 2.52.12.17 1.72 2.62 4.17 3.67.58.25 1.03.4 1.38.52.58.18 1.1.15 1.52.09.46-.07 1.47-.6 1.67-1.18.21-.59.21-1.09.15-1.18-.06-.1-.23-.17-.48-.3Z" />
      </svg>
    </span>
  );
}

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/importar-planilha";
  const isTwaModeDetected = useStandaloneDisplayMode();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [cnpjResponsibilityAccepted, setCnpjResponsibilityAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const showTwaLogin = mounted && isTwaModeDetected;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setInfo(null);

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

  async function onSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);

    if (!password || !confirmPassword || password !== confirmPassword) {
      setErr("As senhas informadas não coincidem.");
      return;
    }

    if (!cnpjResponsibilityAccepted) {
      setErr("Você precisa confirmar que está autorizado a utilizar este CNPJ.");
      return;
    }

    if (!termsAccepted) {
      setErr("Você precisa aceitar os Termos de Uso e a Política de Privacidade para criar sua conta.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email: email.trim().toLowerCase(),
        whatsapp,
        password,
        cnpj,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setLoading(false);
      setErr(typeof data?.error === "string" ? data.error : "Não foi possível criar sua conta.");
      return;
    }

    const pendingCnpjMessage =
      data?.cnpjVerificationStatus === "PENDING_VERIFICATION"
        ? "Cadastro criado com sucesso. Seu CNPJ ficou pendente de verificação, mas você já pode acessar o Rotta normalmente."
        : null;

    if (pendingCnpjMessage) {
      setInfo(pendingCnpjMessage);
    }

    const loginRes = await signIn("credentials", {
      redirect: false,
      email: email.trim().toLowerCase(),
      password,
      callbackUrl,
    });

    setLoading(false);

    if (!loginRes || loginRes.error) {
      setMode("login");
      setCnpjResponsibilityAccepted(false);
      setTermsAccepted(false);
      setPassword("");
      setConfirmPassword("");
      setErr(
        pendingCnpjMessage
          ? `${pendingCnpjMessage} Entre com seu e-mail e senha para continuar.`
          : "Conta criada. Entre com seu e-mail e senha para continuar."
      );
      return;
    }

    setCnpjResponsibilityAccepted(false);
    setTermsAccepted(false);
    setPassword("");
    setConfirmPassword("");
    router.push(callbackUrl);
  }

  if (showTwaLogin) {
    const isSignup = mode === "signup";

    return (
      <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(30,64,75,0.55),transparent_34%),linear-gradient(160deg,#020b10_0%,#07161d_38%,#0c2a31_100%)] px-4 py-8 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[url('/rottafundo.png')] bg-[length:1000px_auto] bg-right-bottom bg-no-repeat opacity-[0.12]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_16%,rgba(45,212,191,0.16),transparent_22%),radial-gradient(circle_at_70%_82%,rgba(31,90,107,0.28),transparent_30%)]" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
          <div className="w-full rounded-[30px] border border-white/10 bg-[rgba(6,16,22,0.82)] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[22px] border border-cyan-100/20 bg-slate-950 shadow-[0_0_34px_rgba(45,212,191,0.22)]">
                <img src="/rotta-logo.png" alt="Rotta" className="h-full w-full object-contain" />
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-white">Rotta</h1>
              <p className="mt-2 text-sm leading-6 text-white/68">
                Acesse sua conta para continuar a operação.
              </p>
            </div>

            <div className="mt-7 grid grid-cols-2 rounded-2xl border border-white/10 bg-white/6 p-1 text-sm font-semibold">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setErr(null);
                  setInfo(null);
                  setCnpjResponsibilityAccepted(false);
                  setTermsAccepted(false);
                  setPassword("");
                  setConfirmPassword("");
                }}
                className={`rounded-xl px-3 py-2 transition ${!isSignup ? "bg-white text-slate-950" : "text-white/70"}`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setErr(null);
                  setInfo(null);
                  setCnpjResponsibilityAccepted(false);
                  setTermsAccepted(false);
                  setPassword("");
                  setConfirmPassword("");
                }}
                className={`rounded-xl px-3 py-2 transition ${isSignup ? "bg-white text-slate-950" : "text-white/70"}`}
              >
                Criar conta
              </button>
            </div>

            <form onSubmit={isSignup ? onSignupSubmit : onSubmit} className="mt-6 space-y-4">
              {isSignup && (
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/62">
                    Nome completo
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3.5 text-white outline-none transition placeholder:text-white/34 focus:border-[#2dd4bf] focus:bg-white/8 focus:ring-4 focus:ring-cyan-400/12"
                    placeholder="Seu nome"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/62">
                  E-mail
                </label>
                <input
                  type="email"
                  className="w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3.5 text-white outline-none transition placeholder:text-white/34 focus:border-[#2dd4bf] focus:bg-white/8 focus:ring-4 focus:ring-cyan-400/12"
                  placeholder="voce@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {isSignup && (
                <>
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/62">
                      WhatsApp
                    </label>
                    <input
                      type="tel"
                      className="w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3.5 text-white outline-none transition placeholder:text-white/34 focus:border-[#2dd4bf] focus:bg-white/8 focus:ring-4 focus:ring-cyan-400/12"
                      placeholder="(62) 99999-9999"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(maskWhatsapp(e.target.value))}
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/62">
                      CNPJ
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3.5 text-white outline-none transition placeholder:text-white/34 focus:border-[#2dd4bf] focus:bg-white/8 focus:ring-4 focus:ring-cyan-400/12"
                      placeholder="00.000.000/0000-00"
                      value={cnpj}
                      onChange={(e) => setCnpj(maskCnpj(e.target.value))}
                      required
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm leading-5 text-white/78">
                    <input
                      type="checkbox"
                      checked={cnpjResponsibilityAccepted}
                      onChange={(e) => setCnpjResponsibilityAccepted(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent accent-[#2dd4bf]"
                    />
                    <span>
                      Declaro que este CNPJ é meu. O uso indevido de CNPJ de terceiros poderá resultar no bloqueio permanente da conta, sem aviso prévio.
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm leading-5 text-white/78">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent accent-[#2dd4bf]"
                    />
                    <span>
                      Li e aceito os{" "}
                      <a
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-cyan-100 underline underline-offset-2"
                      >
                        Termos de Uso
                      </a>{" "}
                      e a{" "}
                      <a
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-cyan-100 underline underline-offset-2"
                      >
                        Política de Privacidade
                      </a>{" "}
                      do Rotta.
                    </span>
                  </label>
                </>
              )}

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/62">
                  Senha
                </label>
                <input
                  type="password"
                  className="w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3.5 text-white outline-none transition placeholder:text-white/34 focus:border-[#2dd4bf] focus:bg-white/8 focus:ring-4 focus:ring-cyan-400/12"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {isSignup && (
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/62">
                    Confirmar senha
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3.5 text-white outline-none transition placeholder:text-white/34 focus:border-[#2dd4bf] focus:bg-white/8 focus:ring-4 focus:ring-cyan-400/12"
                    placeholder="Confirme sua senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              )}

              {err && (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {err}
                </div>
              )}

              {info && (
                <div className="rounded-2xl border border-emerald-300/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
                  {info}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[linear-gradient(135deg,#17313b_0%,#2a6c66_100%)] px-4 py-3.5 font-semibold text-white shadow-[0_18px_34px_rgba(23,49,59,0.34)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (isSignup ? "Criando..." : "Entrando...") : isSignup ? "Criar conta" : "Entrar"}
              </button>
            </form>

            <a
              href={WHATSAPP_SUPPORT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left"
            >
              <WhatsAppIcon />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  Precisa de ajuda para criar sua conta? Entre em contato pelo WhatsApp.
                </div>
              </div>
            </a>
          </div>
        </div>
      </div>
    );
  }

  const isSignup = mode === "signup";

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 bg-[radial-gradient(circle_at_18%_12%,rgba(45,212,191,0.24),transparent_30%),radial-gradient(circle_at_82%_74%,rgba(31,90,107,0.34),transparent_34%),linear-gradient(135deg,#030a0e_0%,#07161d_42%,#102a32_100%)]">
      <div className="pointer-events-none absolute inset-0 bg-[url('/rottafundo.png')] bg-[length:1100px_auto] bg-right-bottom bg-no-repeat opacity-[0.24]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_52%,rgba(45,212,191,0.16),transparent_26%),linear-gradient(90deg,rgba(3,10,14,0.88)_0%,rgba(3,10,14,0.42)_48%,rgba(3,10,14,0.82)_100%)]" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid w-full overflow-hidden rounded-[36px] border border-white/35 bg-white/86 shadow-[0_34px_100px_rgba(2,12,17,0.28)] backdrop-blur-xl lg:grid-cols-[1.1fr_0.9fr]">
          <section className="relative flex min-h-[430px] overflow-hidden bg-[linear-gradient(160deg,#07161d_0%,#102a32_42%,#0d3c43_100%)] p-6 text-white sm:p-8 lg:min-h-[700px] lg:flex-col lg:justify-between lg:p-10">
            <div className="absolute inset-0 bg-[url('/rotta-sidebar-bg.png')] bg-cover bg-[50%_4%] opacity-[0.06]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,10,14,0.78)_0%,rgba(7,22,29,0.88)_58%,rgba(3,10,14,0.96)_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.24),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.10),transparent_24%)]" />

            <div className="relative z-10 flex w-full flex-col justify-between gap-10">
              <div>
                <div className="inline-flex h-20 w-20 items-center justify-center overflow-hidden rounded-[28px] border border-cyan-100/35 bg-slate-950 shadow-[0_0_38px_rgba(45,212,191,0.26),0_18px_30px_rgba(0,0,0,0.22)]">
                  <img src="/rotta-logo.png" alt="Rotta" className="h-full w-full object-contain" />
                </div>

                <div className="mt-8 max-w-xl">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/62">
                    Console Operacional
                  </div>
                  <h1 className="mt-4 text-5xl font-black tracking-tight text-white">Rotta</h1>
                  <p className="mt-3 text-lg font-medium text-white/82">
                    Roteirização, conferência e exportação em um só fluxo.
                  </p>
                  <p className="mt-6 max-w-lg text-sm leading-7 text-white/68">
                    Transforme planilhas operacionais em rotas revisadas, organizadas e prontas para o Circuit.
                  </p>
                </div>
              </div>

              <div className="grid gap-3">
                {highlights.map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-2xl border border-cyan-100/14 bg-white/10 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dff5ef] text-sm font-bold text-[#0f5f58]">
                      ✓
                    </div>
                    <div className="text-sm text-white/88">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="flex min-h-[560px] items-center justify-center bg-[linear-gradient(180deg,rgba(252,254,253,0.96)_0%,rgba(244,248,247,0.98)_100%)] px-5 py-8 sm:px-8 lg:min-h-[700px] lg:px-12">
            <div className="w-full max-w-md">
              <div className="rounded-[32px] border border-slate-200/80 bg-white/88 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-8">
                <div>
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

                <div className="mt-7 grid grid-cols-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setErr(null);
                      setInfo(null);
                      setCnpjResponsibilityAccepted(false);
                      setTermsAccepted(false);
                      setPassword("");
                      setConfirmPassword("");
                    }}
                    className={`rounded-xl px-3 py-2 transition ${!isSignup ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
                  >
                    Entrar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setErr(null);
                      setInfo(null);
                      setCnpjResponsibilityAccepted(false);
                      setTermsAccepted(false);
                      setPassword("");
                      setConfirmPassword("");
                    }}
                    className={`rounded-xl px-3 py-2 transition ${isSignup ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
                  >
                    Criar conta
                  </button>
                </div>

                <form onSubmit={isSignup ? onSignupSubmit : onSubmit} className="mt-6 space-y-5">
                  {isSignup && (
                    <div>
                      <label className="mb-2.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Nome completo
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1f5a6b] focus:bg-white focus:ring-4 focus:ring-[#d8ece7]"
                        placeholder="Seu nome"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                  )}
                  <div>
                    <label className="mb-2.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Usuário (email)
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

                  {isSignup && (
                    <>
                      <div>
                        <label className="mb-2.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          WhatsApp
                        </label>
                        <input
                          type="tel"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1f5a6b] focus:bg-white focus:ring-4 focus:ring-[#d8ece7]"
                          placeholder="(62) 99999-9999"
                          value={whatsapp}
                          onChange={(e) => setWhatsapp(maskWhatsapp(e.target.value))}
                          required
                        />
                      </div>

                      <div>
                        <label className="mb-2.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          CNPJ
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1f5a6b] focus:bg-white focus:ring-4 focus:ring-[#d8ece7]"
                          placeholder="00.000.000/0000-00"
                          value={cnpj}
                          onChange={(e) => setCnpj(maskCnpj(e.target.value))}
                          required
                        />
                      </div>

                      <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-5 text-slate-700">
                        <input
                          type="checkbox"
                          checked={cnpjResponsibilityAccepted}
                          onChange={(e) => setCnpjResponsibilityAccepted(e.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#1f5a6b]"
                        />
                        <span>
                          Declaro que este CNPJ é meu. O uso indevido de CNPJ de terceiros poderá resultar no bloqueio permanente da conta, sem aviso prévio.
                        </span>
                      </label>

                      <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-5 text-slate-700">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => setTermsAccepted(e.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#1f5a6b]"
                        />
                        <span>
                          Li e aceito os{" "}
                          <a
                            href="/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-[#1f5a6b] underline underline-offset-2"
                          >
                            Termos de Uso
                          </a>{" "}
                          e a{" "}
                          <a
                            href="/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-[#1f5a6b] underline underline-offset-2"
                          >
                            Política de Privacidade
                          </a>{" "}
                          do Rotta.
                        </span>
                      </label>
                    </>
                  )}

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

                  {isSignup && (
                    <div>
                      <label className="mb-2.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Confirmar senha
                      </label>
                      <input
                        type="password"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1f5a6b] focus:bg-white focus:ring-4 focus:ring-[#d8ece7]"
                        placeholder="Confirme sua senha"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  )}

                  {err && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {err}
                    </div>
                  )}

                  {info && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      {info}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-2xl bg-[linear-gradient(135deg,#17313b_0%,#1f5a6b_100%)] px-4 py-3.5 font-semibold text-white shadow-[0_18px_34px_rgba(23,49,59,0.24)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? (isSignup ? "Criando..." : "Entrando...") : isSignup ? "Criar conta" : "Entrar"}
                  </button>
                </form>

                <a
                  href={WHATSAPP_SUPPORT_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left"
                >
                  <WhatsAppIcon />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      Precisa de ajuda para criar sua conta? Entre em contato pelo WhatsApp.
                    </div>
                  </div>
                </a>

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
