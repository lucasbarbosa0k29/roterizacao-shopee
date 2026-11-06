import { NextResponse } from "next/server";
import { AuthRequestError } from "./auth-rate-limit";

export function checkAuthOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configured = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  const expected = new URL(configured || request.url).origin;
  if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site") throw new AuthRequestError("Solicitação não permitida.", 403);
}

export async function authBody(request: Request): Promise<Record<string, unknown>> {
  checkAuthOrigin(request);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthRequestError("Solicitação inválida.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 8192) { await reader.cancel(); throw new AuthRequestError("Solicitação muito grande.", 413); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new AuthRequestError("Solicitação inválida."); }
}

export function authError(error: unknown) {
  if (error instanceof AuthRequestError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  // Never log raw Prisma/provider errors: they can contain documents or credentials.
  console.error("[AUTH_OPERATION_FAILED]");
  return NextResponse.json({ error: "Não foi possível concluir agora. Tente novamente mais tarde." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
