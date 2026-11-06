import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { normalizeEmail } from "@/app/lib/email-validation";
import { authBody, authError } from "@/app/lib/auth-http";
import { AuthRequestError, consumeAuthLimit, limitAuthRequest, pruneAuthData } from "@/app/lib/auth-rate-limit";
import { changePassword, issueAuthCode, resetPassword, verifyAuthCode } from "@/app/lib/auth-service";

export const runtime = "nodejs";
const genericSendMessage = "Se houver uma conta elegível, você receberá um código. Se o envio estiver indisponível ou o código não chegar, aguarde e solicite novamente.";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await context.params;
    if (!["send-verification", "verify-email", "forgot-password", "verify-reset", "reset-password", "change-password"].includes(action)) throw new AuthRequestError("Operação não encontrada.", 404);
    const body = await authBody(request);
    const email = normalizeEmail(String(body.email ?? ""));
    const password = String(body.password ?? "");
    if (action === "change-password") {
      const session = await getServerSession(authOptions);
      const user = session?.user as { id?: string; sessionVersion?: number } | undefined;
      if (!user?.id) throw new AuthRequestError("Entre novamente para continuar.", 401);
      await consumeAuthLimit("password-change", user.id, 5, 15 * 60_000);
      if (password !== body.confirmPassword) throw new AuthRequestError("As novas senhas não coincidem.");
      await changePassword(user.id, user.sessionVersion ?? 0, String(body.currentPassword ?? ""), password);
      return NextResponse.json({ ok: true, message: "Senha alterada. Entre novamente com a nova senha." });
    }
    if (!email || email.length > 254) throw new AuthRequestError("Informe um e-mail válido.");
    const isSend = action === "send-verification" || action === "forgot-password";
    await limitAuthRequest(request.headers, isSend ? action : "verify", email);
    await pruneAuthData();
    if (isSend) {
      // Identical HTTP response for missing, disabled, verified and pending accounts,
      // including delivery failures and cooldowns. Rate limits precede lookup.
      try {
        const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (user) await issueAuthCode(user.id, action === "forgot-password" ? "RESET_PASSWORD" : "VERIFY_EMAIL");
      } catch { /* Generic response prevents account enumeration. */ }
      return NextResponse.json({ ok: true, message: genericSendMessage, retryAfter: 60 }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "reset-password") {
      if (password !== body.confirmPassword) throw new AuthRequestError("As novas senhas não coincidem.");
      const token = String(body.resetToken ?? "");
      if (!/^[a-f0-9]{64}$/.test(token) || !await resetPassword(email, token, password)) throw new AuthRequestError("Autorização inválida ou expirada. Solicite outro código.");
      return NextResponse.json({ ok: true, message: "Senha redefinida. Entre com a nova senha." });
    }
    const result = await verifyAuthCode(email, action === "verify-email" ? "VERIFY_EMAIL" : "RESET_PASSWORD", String(body.code ?? ""));
    if (!result.ok) throw new AuthRequestError("Código inválido, expirado ou bloqueado por tentativas. Solicite outro código quando permitido.");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authError(error); }
}
