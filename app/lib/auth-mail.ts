import { localDevelopmentEnabled } from "./local-development.js";

export type MailResult = { ok: true } | { ok: false; retryAfter: number };

export async function sendAuthEmail(email: string, code: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD", idempotencyKey: string): Promise<MailResult> {
  if (localDevelopmentEnabled()) {
    // Capture only. No fallback to Resend if the local inbox is unavailable.
    try {
      const response = await fetch("http://127.0.0.1:8025/capture", {
        method: "POST", signal: AbortSignal.timeout(3000),
        headers: { "Content-Type": "application/json", "X-Rotta-Mail-Token": process.env.ROTTA_LOCAL_MAIL_TOKEN || "" },
        body: JSON.stringify({ to: email, code, purpose, id: idempotencyKey }),
      });
      return response.ok ? { ok: true } : { ok: false, retryAfter: 60 };
    } catch { return { ok: false, retryAfter: 60 }; }
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) return { ok: false, retryAfter: 60 };
  const subject = purpose === "VERIFY_EMAIL" ? "Confirme seu e-mail no Rotta" : "Redefina sua senha no Rotta";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from, to: [email], subject, text: `${subject}\n\nSeu código é: ${code}\n\nEle é válido por 10 minutos e pode ser usado uma única vez. Não compartilhe este código. Se você não solicitou, ignore esta mensagem.` }),
    });
    if (response.ok) return { ok: true };
    // Do not log provider payloads, recipient addresses, codes or request bodies.
    const retry = Number(response.headers.get("retry-after"));
    return { ok: false, retryAfter: Number.isFinite(retry) && retry > 0 ? Math.min(86400, Math.ceil(retry)) : 60 };
  } catch {
    return { ok: false, retryAfter: 60 };
  }
}
