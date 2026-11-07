"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { readSessionHint, removeSessionHint } from "../lib/browser-session";
import { PASSWORD_MIN_LENGTH } from "../lib/password-policy.js";

type Mode = "verify" | "recover" | "change";
const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-[#1f5a6b] focus:ring-2 focus:ring-teal-100";
const buttonClass = "w-full rounded-xl bg-[#17313b] px-4 py-3 font-semibold text-white disabled:opacity-50";
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

function pendingConfirmation(key: string) {
  return readSessionHint(key) || "";
}

export default function AccountSecurityForm({ mode }: { mode: Mode }) {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  // Do not expose editable SSR fields before React attaches their change handlers.
  // Initial confirmation hints are browser-local and must not differ during hydration.
  if (!hydrated) return <main role="status" className="min-h-screen bg-[#f4f7f6] p-10 text-center text-slate-700">Carregando formulário seguro...</main>;
  return <AccountSecurityFields key={mode} mode={mode} />;
}

function AccountSecurityFields({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState(() => mode === "verify" ? pendingConfirmation("rotta-confirm-email") : "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [stage, setStage] = useState<"email" | "code" | "password">(mode === "verify" ? "code" : mode === "change" ? "password" : "email");
  const [message, setMessage] = useState(() => mode === "verify" ? pendingConfirmation("rotta-confirm-message") || "Sua conta pendente pode ser confirmada aqui. Informe seu e-mail e o código recebido ou solicite um novo código." : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (mode === "verify") {
      removeSessionHint("rotta-confirm-message");
    }
  }, [mode]);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  async function request(action: string, values: Record<string, string>) {
    const response = await fetch(`/api/account/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const result = await response.json();
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      if (retry > 0) setRemaining(retry);
      throw new Error(result.error || "Não foi possível concluir. Tente novamente.");
    }
    return result;
  }

  async function sendCode() {
    if (!email.trim() || !email.includes("@")) { setError("Informe seu e-mail."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await request(mode === "verify" ? "send-verification" : "forgot-password", { email });
      setMessage(result.message); setRemaining(result.retryAfter || 60); setStage("code"); setCode(""); setResetToken("");
    } catch (error) { setError(error instanceof Error ? error.message : "Falha de conexão. Tente novamente."); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (stage === "email") { await sendCode(); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      if (stage === "code") {
        const result = await request(mode === "verify" ? "verify-email" : "verify-reset", { email, code });
        if (mode === "verify") {
          setDone(true); setMessage("E-mail confirmado. Sua conta está pronta. Entre para continuar.");
          removeSessionHint("rotta-confirm-email");
        } else { setResetToken(result.resetToken); setStage("password"); setCode(""); }
      } else {
        if (password !== confirmPassword) throw new Error("As novas senhas não coincidem.");
        const result = await request(mode === "change" ? "change-password" : "reset-password", { email, password, confirmPassword, currentPassword, resetToken });
        setPassword(""); setCurrentPassword(""); setConfirmPassword(""); setResetToken(""); setDone(true); setMessage(result.message);
        if (mode === "change") await signOut({ callbackUrl: "/login?passwordChanged=1" });
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Falha de conexão. Tente novamente."); }
    finally { setBusy(false); }
  }

  const recoveryCodeStage = mode === "recover" && stage === "code";

  return <main className="flex min-h-screen items-start justify-center bg-[#f4f7f6] px-4 py-10 text-slate-900 sm:py-16">
    <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1f5a6b]">Rotta</p>
      <h1 className="mt-3 text-2xl font-semibold">{mode === "verify" ? "Confirme seu e-mail" : mode === "recover" ? recoveryCodeStage ? "Confira seu e-mail" : "Recuperar senha" : "Segurança"}</h1>
      <p className="mt-2 text-sm text-slate-600">{mode === "change"
        ? "Altere sua senha. Após salvar, entre novamente nos seus dispositivos."
        : recoveryCodeStage
          ? "Se o endereço informado estiver cadastrado, enviaremos um código de 6 dígitos para redefinir sua senha."
          : "Os códigos são válidos por 10 minutos. Confira também a caixa de spam."}</p>
      {(message || recoveryCodeStage) && <p role="status" className="mt-5 rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{recoveryCodeStage
        ? "O código é válido por 10 minutos. Não recebeu? Verifique a caixa de spam ou solicite um novo código."
        : message}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!done && <form onSubmit={submit} className="mt-6 space-y-5">
        {mode !== "change" && <label className="block text-sm font-medium">E-mail
          <input className={inputClass} type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy || stage === "password"} onChange={event => { setEmail(event.target.value); setCode(""); setResetToken(""); }} />
        </label>}
        {stage === "code" && <label className="block text-sm font-medium">Código de 6 dígitos
          <input className={`${inputClass} text-center text-xl tracking-[0.35em]`} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} />
        </label>}
        {stage === "password" && <>
          {mode === "change" && <label className="block text-sm font-medium">Senha atual<input className={inputClass} type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>}
          <label className="block text-sm font-medium">Nova senha<input className={inputClass} type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required value={password} onChange={event => setPassword(event.target.value)} /></label>
          <p className="text-xs text-slate-600">Use pelo menos {PASSWORD_MIN_LENGTH} caracteres. Prefira uma frase longa e exclusiva para sua conta.</p>
          <label className="block text-sm font-medium">Confirmar nova senha<input className={inputClass} type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>
        </>}
        <button disabled={busy} className={buttonClass}>{busy ? "Aguarde..." : stage === "email" ? "Enviar código" : stage === "code" ? "Confirmar código" : "Salvar nova senha"}</button>
        {stage === "code" && <button type="button" disabled={busy || remaining > 0} onClick={sendCode} className="w-full py-2 text-sm font-medium text-[#1f5a6b] disabled:opacity-50">{remaining > 0 ? `Solicitar novo código em ${remaining}s` : "Enviar / reenviar código"}</button>}
        {mode === "recover" && stage === "password" && <button type="button" onClick={() => { setStage("email"); setResetToken(""); setPassword(""); setConfirmPassword(""); }} className="text-sm underline">Solicitar outro código</button>}
      </form>}
      <Link href="/login" className="mt-6 block text-center text-sm font-semibold text-[#1f5a6b] underline">{done ? "Entrar com e-mail e senha" : "Voltar para o login"}</Link>
    </section>
  </main>;
}
