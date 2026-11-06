import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import { NextRequest } from "next/server";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { NextAuthOptions } from "next-auth";
import type { CredentialsConfig } from "next-auth/providers/credentials";

type AuthCallbacks = NonNullable<NextAuthOptions["callbacks"]>;
type JwtCallbackInput = Parameters<NonNullable<AuthCallbacks["jwt"]>>[0];
type SessionCallbackInput = Parameters<NonNullable<AuthCallbacks["session"]>>[0];
function sessionReadInput(token: JwtCallbackInput["token"]): JwtCallbackInput {
  // NextAuth's JWT session path omits user; its v4 declaration requires that field.
  return { token, account: null } as JwtCallbackInput;
}
function credentialsProvider(options: NextAuthOptions) {
  // NextAuth v4 stores the supplied Credentials config in .options at runtime.
  const provider = options.providers[0] as CredentialsConfig & { options: CredentialsConfig };
  assert.equal(provider.type, "credentials");
  return provider.options;
}

// Refuse accidental use of any supplied application/Neon URL, even when tests run directly.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || databaseUrl !== process.env.DATABASE_URL) throw new Error("Use npm run test:auth:integration (isolated database only)");
const parsed = new URL(databaseUrl);
if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== `/rotta_auth_test_${process.env.TEST_DB_RUN_ID}` || !process.env.TEST_DB_RUN_ID) throw new Error("Unsafe test database");

const db = new PrismaClient({ datasourceUrl: databaseUrl });
mock.method(dns, "resolveMx", async () => [{ exchange: "mx.example.test", priority: 10 }]);
const sent = new Map<string, string>();
let deliveryStatus = 200;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://api.resend.com/emails") {
    const body = JSON.parse(String(init?.body));
    sent.set(body.to[0], body.text.match(/código é: (\d{6})/)[1]);
    return new Response("{}", { status: deliveryStatus });
  }
  if (url.startsWith("https://brasilapi.com.br/")) return Response.json({ razao_social: "Empresa teste", descricao_situacao_cadastral: "ATIVA" });
  throw new Error("Unexpected external network request in test");
};

// Imports occur after the database guard, never before.
async function modules() {
  const service = await import("../app/lib/auth-service");
  const security = await import("../app/lib/account-security");
  const access = await import("../app/lib/access-control");
  const auth = await import("../app/lib/auth");
  const limits = await import("../app/lib/auth-rate-limit");
  return { ...service, ...security, ...access, ...auth, ...limits };
}
async function user(cpf = "52998224725") {
  return db.user.create({ data: { email: `${randomUUID()}@example.test`, password: await bcrypt.hash("test-password-123", 10), documentType: "CPF", cpf } });
}
async function ageCode(userId: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD") {
  await db.authChallenge.update({ where: { userId_purpose: { userId, purpose } }, data: { requestedAt: new Date(Date.now() - 61_000) } });
}

test("legacy login, active subscription, credits and paid fulfillment remain compatible", async () => {
  const { authOptions, getUserAccessSnapshot } = await modules();
  const legacy = await db.user.findUniqueOrThrow({ where: { id: "legacy-user" } });
  assert.equal(legacy.emailVerificationRequired, false);
  assert.equal(legacy.emailVerifiedAt, null);
  const logged = await credentialsProvider(authOptions).authorize({ email: legacy.email, password: "legacy123456" }, {});
  assert.ok(logged);
  assert.equal(logged.id, legacy.id);
  const normalizedLogin = await credentialsProvider(authOptions).authorize({ email: ' LEGACY@EXAMPLE.TEST ', password: 'legacy123456' }, {});
  assert.equal(normalizedLogin?.id, legacy.id);
  const rootAuth = await import('../auth');
  assert.equal(rootAuth.authOptions, authOptions);
  assert.equal(typeof rootAuth.default, 'function');
  // v4 types require sign-in/database-only fields even during JWT session reads.
  const jwt = await authOptions.callbacks!.jwt!(sessionReadInput({ id: legacy.id, role: "USER" }));
  assert.equal(jwt.valid, true);
  const access = await getUserAccessSnapshot(legacy.id);
  assert.equal(access.canStartRoute, true);
  assert.equal(access.routeCreditsBalance, 7);
  const { fulfillApprovedPaymentTransaction } = await import("../app/lib/payment-fulfillment");
  assert.equal((await fulfillApprovedPaymentTransaction("legacy-payment")).fulfilled, false);
});

test("CPF unique constraint prevents simultaneous accounts; CPF does not create Company", async () => {
  const before = await db.company.count();
  const results = await Promise.allSettled([user(), user()]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal(await db.company.count(), before);
  const u = await db.user.findUniqueOrThrow({ where: { cpf: "52998224725" } });
  assert.equal(u.companyId, null);
  const { getUserAccessSnapshot, consumeRouteAllowance, authOptions } = await modules();
  await assert.rejects(getUserAccessSnapshot(u.id), /Confirme/);
  await assert.rejects(consumeRouteAllowance({ userId: u.id, jobId: "never-create", role: "USER" }), /Confirme/);
  await assert.rejects(async () => credentialsProvider(authOptions).authorize({ email: u.email, password: "test-password-123" }, {}), /EMAIL_VERIFICATION_REQUIRED/);
});

test("verification codes: wrong, attempts, resend cooldown, expiry, replacement and concurrent use", async () => {
  const { issueAuthCode, verifyAuthCode } = await modules();
  const u = await db.user.findUniqueOrThrow({ where: { cpf: "52998224725" } });
  await issueAuthCode(u.id, "VERIFY_EMAIL");
  let code = sent.get(u.email)!;
  const row = await db.authChallenge.findUniqueOrThrow({ where: { userId_purpose: { userId: u.id, purpose: "VERIFY_EMAIL" } } });
  assert.notEqual(row.codeHash, code);
  await assert.rejects(issueAuthCode(u.id, "VERIFY_EMAIL"), /Aguarde/);
  for (let i = 0; i < 5; i++) assert.equal((await verifyAuthCode(u.email, "VERIFY_EMAIL", "invalid")).ok, false);
  assert.equal((await verifyAuthCode(u.email, "VERIFY_EMAIL", code)).ok, false);
  await ageCode(u.id, "VERIFY_EMAIL");
  await issueAuthCode(u.id, "VERIFY_EMAIL");
  await db.authChallenge.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await verifyAuthCode(u.email, "VERIFY_EMAIL", sent.get(u.email)!)).ok, false);
  await ageCode(u.id, "VERIFY_EMAIL");
  await issueAuthCode(u.id, "VERIFY_EMAIL");
  const currentCode = sent.get(u.email)!;
  if (code !== currentCode) assert.equal((await verifyAuthCode(u.email, "VERIFY_EMAIL", code)).ok, false);
  code = currentCode;
  const results = await Promise.all([verifyAuthCode(u.email, "VERIFY_EMAIL", code), verifyAuthCode(u.email, "VERIFY_EMAIL", code)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt);
  const credits = await db.routeCredit.findMany({ where: { userId: u.id } });
  assert.deepEqual(credits.map(c => [c.delta, c.reason]), [[1, "PROMOTIONAL"]]);
  assert.equal(await db.signupBenefit.count({ where: { documentType: "CPF" } }), 1);
});

test("delete and recreate same CPF cannot reuse benefit", async () => {
  const { issueAuthCode, verifyAuthCode } = await modules();
  const old = await db.user.findUniqueOrThrow({ where: { cpf: "52998224725" } });
  await db.user.delete({ where: { id: old.id } }); // Only synthetic records in guarded loopback database.
  const recreated = await user();
  await issueAuthCode(recreated.id, "VERIFY_EMAIL");
  assert.equal((await verifyAuthCode(recreated.email, "VERIFY_EMAIL", sent.get(recreated.email)!)).ok, true);
  assert.equal(await db.routeCredit.count({ where: { userId: recreated.id } }), 0);
  assert.equal(await db.signupBenefit.count({ where: { documentType: "CPF" } }), 1);
});

test("CNPJ unique constraint and two promotional credits preserved", async () => {
  await assert.rejects(db.company.create({ data: { cnpj: "11222333000181", razaoSocial: "duplicate", situacaoCadastral: "ATIVA" } }));
  const company = await db.company.create({ data: { cnpj: "11444777000161", razaoSocial: "PJ fixture", situacaoCadastral: "ATIVA", cnpjVerificationStatus: "VERIFIED" } });
  const u = await db.user.create({ data: { email: "pj@example.test", password: "unused-hash", companyId: company.id, documentType: "CNPJ" } });
  const { issueAuthCode, verifyAuthCode } = await modules();
  await issueAuthCode(u.id, "VERIFY_EMAIL");
  assert.equal((await verifyAuthCode(u.email, "VERIFY_EMAIL", sent.get(u.email)!)).ok, true);
  assert.equal((await db.routeCredit.aggregate({ where: { userId: u.id, reason: "PROMOTIONAL" }, _sum: { delta: true } }))._sum.delta, 2);
});

test("Resend failure and quota do not verify account; later resend works", async () => {
  const { issueAuthCode, verifyAuthCode } = await modules();
  const u = await user("11144477735");
  for (const status of [503, 429]) {
    deliveryStatus = status;
    assert.equal((await issueAuthCode(u.id, "VERIFY_EMAIL")).ok, false);
    assert.equal((await verifyAuthCode(u.email, "VERIFY_EMAIL", sent.get(u.email)!)).ok, false);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt, null);
    await ageCode(u.id, "VERIFY_EMAIL");
  }
  deliveryStatus = 200;
  assert.equal((await issueAuthCode(u.id, "VERIFY_EMAIL")).ok, true);
  assert.equal((await verifyAuthCode(u.email, "VERIFY_EMAIL", sent.get(u.email)!)).ok, true);
});

test("password reset: single-use token, hash, legacy login and JWT/API revocation", async () => {
  const { issueAuthCode, verifyAuthCode, resetPassword, authOptions } = await modules();
  await issueAuthCode("legacy-user", "RESET_PASSWORD");
  const verified = await verifyAuthCode("legacy@example.test", "RESET_PASSWORD", sent.get("legacy@example.test")!);
  assert.ok(verified.ok && verified.resetToken);
  if (!verified.ok || !verified.resetToken) throw new Error("missing token");
  assert.equal(await resetPassword("legacy@example.test", verified.resetToken, "replacement-password-123"), true);
  assert.equal(await resetPassword("legacy@example.test", verified.resetToken, "another-password-123"), false);
  const u = await db.user.findUniqueOrThrow({ where: { id: "legacy-user" } });
  assert.equal(await bcrypt.compare("replacement-password-123", u.password), true);
  assert.equal(u.sessionVersion, 1);
  const oldJwt = await authOptions.callbacks!.jwt!(sessionReadInput({ id: u.id, role: "USER" }));
  assert.equal(oldJwt.valid, false);
  const oldSession = await authOptions.callbacks!.session!({ session: { user: { email: u.email }, expires: "" }, token: oldJwt } as SessionCallbackInput);
  assert.equal(oldSession.user, undefined);
  const { getServerSession } = await import("next-auth");
  const signedOld = await encode({ token: { id: u.id, role: "USER", email: u.email }, secret: process.env.NEXTAUTH_SECRET! });
  const request = Object.assign(new IncomingMessage(new Socket()), { cookies: { "next-auth.session-token": signedOld } });
  const apiSession = await getServerSession(request, new ServerResponse(request), authOptions);
  assert.equal(apiSession?.user, undefined);
  const { getCurrentAuthToken } = await import("../app/lib/current-auth-token");
  const encrypted = await encode({ token: { id: u.id, role: "ADMIN" }, secret: process.env.NEXTAUTH_SECRET! });
  assert.equal(await getCurrentAuthToken({ req: new NextRequest("http://localhost:3000/api/access/me", { headers: { cookie: `next-auth.session-token=${encrypted}` } }), secret: process.env.NEXTAUTH_SECRET }), null);
  const login = await credentialsProvider(authOptions).authorize({ email: u.email, password: "replacement-password-123" }, {});
  assert.ok(login);
  assert.equal(login.id, u.id);
});

test("change password requires current password, differs from old and revokes prior version", async () => {
  const { changePassword, authOptions } = await modules();
  await assert.rejects(changePassword("legacy-user", 1, "wrong", "next-password-123"), /incorreta/);
  await assert.rejects(changePassword("legacy-user", 1, "replacement-password-123", "replacement-password-123"), /diferente/);
  await changePassword("legacy-user", 1, "replacement-password-123", "next-password-123");
  const oldJwt = await authOptions.callbacks!.jwt!(sessionReadInput({ id: "legacy-user", sessionVersion: 1 }));
  assert.equal(oldJwt.valid, false);
  await assert.rejects(changePassword("legacy-user", 1, "next-password-123", "third-password-123"), /novamente/);
});

test("persistent rate limiter remains atomic under concurrent requests", async () => {
  const { consumeAuthLimit } = await modules();
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => consumeAuthLimit("test-concurrent", "identity", 3, 3600_000)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 3);
});

test("credentials endpoint applies persistent login limits before account lookup", async () => {
  const { authOptions } = await modules();
  const authorize = credentialsProvider(authOptions).authorize;
  for (let i = 0; i < 20; i++) assert.equal(await authorize({ email: 'login-limit@example.test', password: 'wrong' }, {}), null);
  await assert.rejects(authorize({ email: ' LOGIN-LIMIT@EXAMPLE.TEST ', password: 'wrong' }, {}), /Muitas solicitações/);
});

test("password recovery cannot bypass email verification or grant signup credits", async () => {
  const pending = await user('93541134780');
  const { issueAuthCode, verifyAuthCode, resetPassword, authOptions } = await modules();
  await issueAuthCode(pending.id, 'RESET_PASSWORD');
  const result = await verifyAuthCode(pending.email, 'RESET_PASSWORD', sent.get(pending.email)!);
  assert.ok(result.ok && result.resetToken);
  if (!result.ok || !result.resetToken) throw new Error('missing synthetic reset token');
  assert.equal(await resetPassword(pending.email, '0'.repeat(64), 'replacement-pending-123'), false);
  await db.authChallenge.update({ where: { userId_purpose: { userId: pending.id, purpose: 'RESET_PASSWORD' } }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal(await resetPassword(pending.email, result.resetToken, 'replacement-pending-123'), false);
  await ageCode(pending.id, 'RESET_PASSWORD');
  await issueAuthCode(pending.id, 'RESET_PASSWORD');
  const fresh = await verifyAuthCode(pending.email, 'RESET_PASSWORD', sent.get(pending.email)!);
  if (!fresh.ok || !fresh.resetToken) throw new Error('missing fresh synthetic reset token');
  assert.equal(await resetPassword(pending.email, fresh.resetToken, 'replacement-pending-123'), true);
  await assert.rejects(credentialsProvider(authOptions).authorize({ email: pending.email, password: 'replacement-pending-123' }, {}), /EMAIL_VERIFICATION_REQUIRED/);
  assert.equal(await db.routeCredit.count({ where: { userId: pending.id } }), 0);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: pending.id } })).emailVerifiedAt, null);
});

test("failed verification transaction does not consume code or leave a claimed benefit", async () => {
  const pending = await user('39053344705');
  const { issueAuthCode, verifyAuthCode } = await modules();
  await issueAuthCode(pending.id, 'VERIFY_EMAIL');
  const secret = process.env.DOCUMENT_HMAC_SECRET;
  try {
    delete process.env.DOCUMENT_HMAC_SECRET;
    await assert.rejects(verifyAuthCode(pending.email, 'VERIFY_EMAIL', sent.get(pending.email)!), /DOCUMENT_HMAC_SECRET/);
  } finally { process.env.DOCUMENT_HMAC_SECRET = secret; }
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: pending.id } })).emailVerifiedAt, null);
  assert.equal((await db.authChallenge.findUniqueOrThrow({ where: { userId_purpose: { userId: pending.id, purpose: 'VERIFY_EMAIL' } } })).consumedAt, null);
  assert.equal(await db.routeCredit.count({ where: { userId: pending.id } }), 0);
  assert.equal((await verifyAuthCode(pending.email, 'VERIFY_EMAIL', sent.get(pending.email)!)).ok, true);
});

test("recovery endpoint does not disclose missing or existing email; rejects mismatching passwords", async () => {
  const { POST } = await import("../app/api/account/auth/[action]/route");
  async function call(action: string, body: object) {
    return POST(new Request(`http://localhost:3000/api/account/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });
  }
  const missing = await call("forgot-password", { email: "missing@example.test" });
  const existing = await call("forgot-password", { email: "legacy@example.test" });
  assert.equal(missing.status, existing.status);
  assert.deepEqual(await missing.json(), await existing.json());
  assert.equal((await call("reset-password", { email: "legacy@example.test", password: "new-password-123", confirmPassword: "different" })).status, 400);
});

test("public signup: concurrent CPF, normalized email, duplicate CNPJ, pending resume and server validation", async () => {
  const { POST } = await import("../app/api/register/route");
  const body = { name: "Cadastro teste", email: "signup-one@gmail.com", password: "signup-password-123", whatsapp: "62912345001", cpf: "123.456.789-09", documentType: "CPF", termsAccepted: true, documentResponsibilityAccepted: true };
  const call = (values: object) => POST(new Request("http://localhost:3000/api/register", { method: "POST", body: JSON.stringify(values) }));
  const first = await call({ ...body, email: " SIGNUP-ONE@gmail.com " });
  assert.equal(first.status, 201, JSON.stringify(await first.json()));
  const u = await db.user.findUniqueOrThrow({ where: { email: body.email } });
  assert.equal(u.cpf, "12345678909");
  assert.equal(u.companyId, null);
  assert.equal(await db.routeCredit.count({ where: { userId: u.id } }), 0);
  const resumed = await call(body);
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).requiresEmailVerification, true);
  const duplicate = await call({ ...body, email: "signup-two@gmail.com", whatsapp: "62912345002" });
  assert.equal(duplicate.status, 409);
  assert.equal((await call({ ...body, email: "invalid@gmail.com", cpf: "00000000000" })).status, 400);
  assert.equal((await call({ ...body, email: "no-terms@gmail.com", termsAccepted: false })).status, 400);
  const company = await call({ ...body, email: "duplicate-company@gmail.com", documentType: "CNPJ", cnpj: "11222333000181", whatsapp: "62912345003" });
  assert.equal(company.status, 409);
  const concurrent = await Promise.all([
    call({ ...body, email: "race-a@gmail.com", cpf: "16899535009", whatsapp: "62912345004" }),
    call({ ...body, email: "race-b@gmail.com", cpf: "16899535009", whatsapp: "62912345005" }),
  ]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
});

test("resend endpoint limits repeated requests without revealing whether email exists", async () => {
  const { POST } = await import("../app/api/account/auth/[action]/route");
  const responses = [];
  for (let i = 0; i < 6; i++) responses.push(await POST(new Request("http://localhost:3000/api/account/auth/send-verification", { method: "POST", body: JSON.stringify({ email: "absent-rate@example.test" }) }), { params: Promise.resolve({ action: "send-verification" }) }));
  assert.deepEqual(responses.map(r => r.status), [200, 200, 200, 200, 200, 429]);
  assert.ok(Number(responses[5].headers.get("retry-after")) > 0);
});

test("public CNPJ signup grants two credits only after verification and survives account recreation", async () => {
  const { POST } = await import('../app/api/register/route');
  const { issueAuthCode, verifyAuthCode, documentFingerprint } = await modules();
  const body = { name: 'Cadastro PJ', email: 'public-pj@gmail.com', password: 'signup-pj-password-123', whatsapp: '62912345999', cnpj: '04.252.011/0001-10', documentType: 'CNPJ', termsAccepted: true, documentResponsibilityAccepted: true };
  const response = await POST(new Request('http://localhost:3000/api/register', { method: 'POST', body: JSON.stringify(body) }));
  assert.equal(response.status, 201);
  const created = await db.user.findUniqueOrThrow({ where: { email: body.email }, include: { company: true } });
  assert.equal(created.cpf, null);
  assert.equal(created.company?.cnpj, '04252011000110');
  assert.equal(created.emailVerifiedAt, null);
  assert.equal(await db.routeCredit.count({ where: { userId: created.id } }), 0);
  assert.equal((await verifyAuthCode(created.email, 'VERIFY_EMAIL', sent.get(created.email)!)).ok, true);
  assert.equal((await db.routeCredit.aggregate({ where: { userId: created.id }, _sum: { delta: true } }))._sum.delta, 2);
  await db.user.delete({ where: { id: created.id } });
  assert.equal(await db.signupBenefit.count({ where: { documentFingerprint: documentFingerprint('CNPJ', '04252011000110') } }), 1);
  const recreated = await db.user.create({ data: { email: 'recreated-pj@example.test', password: 'unused-hash', companyId: created.companyId, documentType: 'CNPJ' } });
  await issueAuthCode(recreated.id, 'VERIFY_EMAIL');
  assert.equal((await verifyAuthCode(recreated.email, 'VERIFY_EMAIL', sent.get(recreated.email)!)).ok, true);
  assert.equal(await db.routeCredit.count({ where: { userId: recreated.id } }), 0);
});

test("protected administrative API rejects a correctly signed revoked JWT", async () => {
  const { GET } = await import("../app/api/admin/import-jobs/route");
  const token = await encode({ token: { id: "legacy-user", role: "ADMIN", sessionVersion: 0 }, secret: process.env.NEXTAUTH_SECRET! });
  const response = await GET(new NextRequest("http://localhost:3000/api/admin/import-jobs", { headers: { cookie: `next-auth.session-token=${token}` } }));
  assert.equal(response.status, 401);
});

test("paid CPF/CNPJ entitlements and extra-credit fulfillment remain idempotent", async () => {
  const { fulfillApprovedPaymentTransaction } = await import("../app/lib/payment-fulfillment");
  const { getUserAccessSnapshot } = await modules();
  const cpf = await db.user.findUniqueOrThrow({ where: { cpf: "52998224725" } });
  const cnpj = await db.user.findUniqueOrThrow({ where: { email: "pj@example.test" } });
  for (const u of [cpf, cnpj]) {
    const payment = await db.paymentTransaction.create({ data: { userId: u.id, provider: "ASAAS", productType: "BASIC_PLAN", amountCents: 3999, externalReference: randomUUID(), status: "APPROVED" } });
    assert.equal((await fulfillApprovedPaymentTransaction(payment.id)).fulfilled, true);
    assert.equal((await fulfillApprovedPaymentTransaction(payment.id)).fulfilled, false);
    assert.equal((await getUserAccessSnapshot(u.id)).canStartRoute, true);
  }
  const extra = await db.paymentTransaction.create({ data: { userId: cpf.id, provider: "ASAAS", productType: "EXTRA_ROUTE", amountCents: 398, quantity: 2, externalReference: randomUUID(), status: "APPROVED" } });
  const results = await Promise.all([fulfillApprovedPaymentTransaction(extra.id), fulfillApprovedPaymentTransaction(extra.id)]);
  assert.equal(results.filter(r => r.fulfilled).length, 1);
  const credits = await db.routeCredit.findMany({ where: { userId: cpf.id } });
  assert.deepEqual(credits.map(c => [c.delta, c.reason]), [[2, "MANUAL_PAYMENT"]]);
});

test("Asaas webhook authenticates header and legacy URL; duplicate events grant credits once", async () => {
  const { POST } = await import('../app/api/webhooks/asaas/route');
  process.env.ASAAS_WEBHOOK_SECRET = 'synthetic-webhook-only-'.repeat(3);
  const account = await db.user.findUniqueOrThrow({ where: { email: 'pj@example.test' } });
  const transaction = await db.paymentTransaction.create({ data: { userId: account.id, provider: 'ASAAS', productType: 'EXTRA_ROUTE', amountCents: 199, externalReference: randomUUID(), status: 'PENDING' } });
  const payload = { id: 'synthetic-event', event: 'PAYMENT_RECEIVED', payment: { id: 'synthetic-asaas-id', externalReference: transaction.externalReference, status: 'RECEIVED', value: 1.99 } };
  const call = (body: object, header?: string, legacy = false) => POST(new NextRequest(`http://localhost:3000/api/webhooks/asaas${legacy ? '?secret=' + process.env.ASAAS_WEBHOOK_SECRET : ''}`, { method: 'POST', headers: header ? { 'asaas-access-token': header } : {}, body: JSON.stringify(body) }));
  assert.equal((await call(payload)).status, 401);
  assert.equal((await call(payload, 'wrong')).status, 401);
  assert.equal((await call(payload, process.env.ASAAS_WEBHOOK_SECRET)).status, 200);
  assert.equal((await call(payload, undefined, true)).status, 200);
  assert.equal(await db.routeCredit.count({ where: { userId: account.id, notes: { contains: transaction.id } } }), 1);
  const otherProvider = await db.paymentTransaction.create({ data: { userId: account.id, provider: 'MERCADOPAGO', productType: 'EXTRA_ROUTE', amountCents: 199, externalReference: randomUUID(), status: 'PENDING' } });
  assert.equal((await call({ ...payload, payment: { ...payload.payment, id: 'wrong-provider-id', externalReference: otherProvider.externalReference } }, process.env.ASAAS_WEBHOOK_SECRET)).status, 409);
  assert.equal((await db.paymentTransaction.findUniqueOrThrow({ where: { id: otherProvider.id } })).status, 'PENDING');
});

test("alphanumeric CNPJ remains canonical across signup, uniqueness, verification and mocked checkout data", async () => {
  const { POST } = await import('../app/api/register/route');
  const { verifyAuthCode, checkoutCustomerData } = await modules();
  const body = { name: 'Alphanumeric fixture', email: 'alpha-cnpj@gmail.com', password: 'alpha-cnpj-password-123', whatsapp: '62912345998', cnpj: '12.abc.345/01de-35', documentType: 'CNPJ', termsAccepted: true, documentResponsibilityAccepted: true };
  const call = (values: object) => POST(new Request('http://localhost:3000/api/register', { method: 'POST', body: JSON.stringify(values) }));
  assert.equal((await call(body)).status, 201);
  const created = await db.user.findUniqueOrThrow({ where: { email: body.email }, include: { company: true } });
  assert.equal(created.company?.cnpj, '12ABC34501DE35');
  assert.equal((await call({ ...body, email: 'alpha-duplicate@gmail.com', whatsapp: '62912345997', cnpj: '12ABC34501DE35' })).status, 409);
  assert.equal((await verifyAuthCode(created.email, 'VERIFY_EMAIL', sent.get(created.email)!)).ok, true);
  assert.equal(checkoutCustomerData(created)?.cpfCnpj, '12ABC34501DE35');
  assert.equal((await db.routeCredit.aggregate({ where: { userId: created.id }, _sum: { delta: true } }))._sum.delta, 2);
});

test("CPF/CNPJ signup and password recovery accept eight characters, reject seven and preserve the hash limit", async () => {
  const { POST: register } = await import('../app/api/register/route');
  const { POST: account } = await import('../app/api/account/auth/[action]/route');
  const { issueAuthCode, verifyAuthCode, authOptions, changePassword } = await modules();
  const callRegister = (body: object) => register(new Request('http://localhost:3000/api/register', { method: 'POST', body: JSON.stringify(body) }));
  const callAccount = (body: object) => account(new Request('http://localhost:3000/api/account/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ action: 'reset-password' }) });
  for (const [type, document, whatsapp] of [['CPF', '90000000175', '62912345871'], ['CNPJ', '12345678000195', '62912345872']] as const) {
    const email = `eight-${type.toLowerCase()}@gmail.com`;
    const body = { name: 'Password boundary fixture', email, whatsapp, password: '1234567', documentType: type, [type === 'CPF' ? 'cpf' : 'cnpj']: document, termsAccepted: true, documentResponsibilityAccepted: true };
    assert.equal((await callRegister(body)).status, 400);
    assert.equal(await db.user.count({ where: { email } }), 0);
    assert.equal((await callRegister({ ...body, password: 'a'.repeat(73) })).status, 400);
    assert.equal((await callRegister({ ...body, password: '12345678' })).status, 201);
    const created = await db.user.findUniqueOrThrow({ where: { email } });
    assert.ok(await bcrypt.compare('12345678', created.password));
    assert.equal(created.emailVerifiedAt, null);
    await assert.rejects(credentialsProvider(authOptions).authorize({ email, password: '12345678' }, {}), /EMAIL_VERIFICATION_REQUIRED/);
    assert.equal((await verifyAuthCode(email, 'VERIFY_EMAIL', sent.get(email)!)).ok, true);
    assert.ok(await credentialsProvider(authOptions).authorize({ email, password: '12345678' }, {}));
    await issueAuthCode(created.id, 'RESET_PASSWORD');
    const reset = await verifyAuthCode(email, 'RESET_PASSWORD', sent.get(email)!);
    assert.ok(reset.ok && reset.resetToken);
    if (!reset.ok || !reset.resetToken) throw new Error('Synthetic reset token missing');
    const resetBody = { email, resetToken: reset.resetToken, password: 'abcdefg', confirmPassword: 'abcdefg' };
    assert.equal((await callAccount(resetBody)).status, 400);
    assert.equal((await callAccount({ ...resetBody, password: 'a'.repeat(73), confirmPassword: 'a'.repeat(73) })).status, 400);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: created.id } })).password, created.password);
    assert.equal((await callAccount({ ...resetBody, password: 'abcdefgh', confirmPassword: 'abcdefgh' })).status, 200);
    const changed = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(await bcrypt.compare('abcdefgh', changed.password));
    assert.equal(changed.sessionVersion, created.sessionVersion + 1);
    assert.ok(await credentialsProvider(authOptions).authorize({ email, password: 'abcdefgh' }, {}));
    await assert.rejects(changePassword(changed.id, changed.sessionVersion, 'abcdefgh', '1234567'), /8 caracteres/);
    await changePassword(changed.id, changed.sessionVersion, 'abcdefgh', '!@#$%^&*');
    const symbolPassword = await db.user.findUniqueOrThrow({ where: { id: changed.id } });
    assert.ok(await bcrypt.compare('!@#$%^&*', symbolPassword.password));
  }
});

test("CNPJ signup requires a positive active registry result and leaves no account records on failure", async (t) => {
  const { POST } = await import("../app/api/register/route");
  const { verifyAuthCode } = await modules();
  const baseFetch = globalThis.fetch;
  const activeBrasil = () => Response.json({ razao_social: "Empresa fictícia", descricao_situacao_cadastral: "ATIVA" });
  const activeReceita = () => Response.json({ status: "OK", nome: "Empresa fictícia", situacao: "ATIVA" });
  const unavailable = () => new Response(null, { status: 503 });
  const notFound = () => new Response(null, { status: 404 });
  const cacheMiss = () => Response.json({ status: "ERROR", message: "not in cache" });
  const timeout = () => { throw new DOMException("Mocked timeout", "TimeoutError"); };
  const snapshot = async () => ({
    users: await db.user.count(), companies: await db.company.count(),
    benefits: await db.signupBenefit.count(), credits: await db.routeCredit.count(),
    challenges: await db.authChallenge.count(), mail: sent.size,
  });
  // Generated mathematical fixtures, used only with mocked registries in the guarded local database.
  const documents = ["90000000000184", "90000000000265", "90000000000346", "90000000000427", "90000000000508", "90000000000699", "90000000000770", "90000000000850", "90000000000931", "90000000001075", "90000000001156", "90000000001237", "90000000001318", "90000000001407", "90000000001580"];
  const cases: Array<{ name: string; brasil: () => Response; receita: () => Response; status: number; code?: string; invalid?: boolean; retry?: boolean }> = [
    { name: "invalid check digits", brasil: activeBrasil, receita: activeReceita, status: 400, code: "CNPJ_INVALID", invalid: true },
    ...["BAIXADA", "INAPTA", "SUSPENSA", "NULA"].map(status => ({
      name: `inactive ${status}`, brasil: () => Response.json({ razao_social: "Empresa fictícia", descricao_situacao_cadastral: status }),
      receita: activeReceita, status: 400, code: "CNPJ_INACTIVE",
    })),
    { name: "not found in either registry", brasil: notFound, receita: notFound, status: 400, code: "CNPJ_NOT_FOUND" },
    { name: "new company absent from cache can retry", brasil: notFound, receita: cacheMiss, status: 400, code: "CNPJ_NOT_FOUND", retry: true },
    { name: "both registries unavailable can retry", brasil: unavailable, receita: unavailable, status: 503, code: "CNPJ_UNAVAILABLE", retry: true },
    { name: "both registry timeouts", brasil: timeout, receita: timeout, status: 503, code: "CNPJ_UNAVAILABLE" },
    { name: "provider rate limit", brasil: () => new Response(null, { status: 429 }), receita: unavailable, status: 503, code: "CNPJ_RATE_LIMIT" },
    { name: "one registry missing and another unavailable", brasil: notFound, receita: unavailable, status: 503, code: "CNPJ_UNAVAILABLE" },
    { name: "ReceitaWS operational ERROR is temporary", brasil: unavailable, receita: () => Response.json({ status: "ERROR", message: "Serviço temporariamente indisponível" }), status: 503, code: "CNPJ_UNAVAILABLE" },
    { name: "malformed positive response is not a confirmation", brasil: () => Response.json({}), receita: unavailable, status: 503, code: "CNPJ_UNAVAILABLE" },
    { name: "BrasilAPI confirms active", brasil: activeBrasil, receita: unavailable, status: 201 },
    { name: "BrasilAPI fails and ReceitaWS confirms active", brasil: unavailable, receita: activeReceita, status: 201 },
  ];
  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, async (context) => {
      const requests: string[] = [];
      let retry = false;
      context.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://brasilapi.com.br/")) { requests.push("BRASILAPI"); return retry ? activeBrasil() : scenario.brasil(); }
        if (url.startsWith("https://www.receitaws.com.br/")) { requests.push("RECEITAWS"); return scenario.receita(); }
        return baseFetch(input, init); // Existing test adapter only; unexpected external requests throw.
      });
      const body = {
        name: "CNPJ security fixture", email: `cnpj-guard-${index}@gmail.com`, whatsapp: `629123456${String(index).padStart(2, "0")}`,
        password: "fixture-password-123", cnpj: "invalid" in scenario ? "90000000000185" : documents[index], documentType: "CNPJ",
        termsAccepted: true, documentResponsibilityAccepted: true,
      };
      const call = () => POST(new Request("http://localhost:3000/api/register", { method: "POST", body: JSON.stringify(body) }));
      const before = await snapshot();
      const response = await call();
      const result = await response.json();
      assert.equal(response.status, scenario.status);
      assert.deepEqual(requests, "invalid" in scenario ? [] : scenario.code === "CNPJ_INACTIVE" || scenario.name === "BrasilAPI confirms active" ? ["BRASILAPI"] : ["BRASILAPI", "RECEITAWS"]);
      if (scenario.status !== 201) {
        assert.equal(result.code, scenario.code);
        assert.deepEqual(await snapshot(), before, "Rejection must not create a user, company, benefit, credit, challenge or email");
        if (scenario.code === "CNPJ_NOT_FOUND") assert.equal(result.error, "CNPJ não localizado nas bases consultadas. Se o seu MEI/CNPJ foi aberto recentemente, entre em contato com o suporte pelo WhatsApp.");
        if (scenario.status === 503) {
          assert.equal(result.error, "Não foi possível concluir agora. Tente novamente mais tarde.");
          assert.equal(response.headers.get("retry-after"), "60");
        }
      }
      if ("retry" in scenario) {
        retry = true;
        assert.equal((await call()).status, 201, "Same email, document and phone can retry after registry recovery");
      }
      if (scenario.status === 201 || "retry" in scenario) {
        const created = await db.user.findUniqueOrThrow({ where: { email: body.email }, include: { company: true } });
        assert.equal(created.company?.cnpjVerificationStatus, "VERIFIED");
        assert.equal(created.company?.situacaoCadastral, "ATIVA");
        assert.equal(created.emailVerifiedAt, null);
        assert.equal(await db.routeCredit.count({ where: { userId: created.id } }), 0);
        assert.equal((await verifyAuthCode(created.email, "VERIFY_EMAIL", sent.get(created.email)!)).ok, true);
        assert.equal((await db.routeCredit.aggregate({ where: { userId: created.id }, _sum: { delta: true } }))._sum.delta, 2);
      }
    });
  }
});

test("previously pending or inactive CNPJ accounts can verify email without receiving or reserving a benefit", async () => {
  const { issueAuthCode, verifyAuthCode, grantSignupBenefit, authTransaction, documentFingerprint } = await modules();
  for (const [index, [status, situation]] of ([
    ["PENDING_VERIFICATION", "PENDING_VERIFICATION"],
    ["PENDING_VERIFICATION", "ATIVA"],
    ["VERIFIED", "BAIXADA"],
  ] as const).entries()) {
    const company = await db.company.create({ data: {
      cnpj: ["90000000001660", "90000000001741", "90000000001822"][index],
      razaoSocial: "Historical synthetic fixture", cnpjVerificationStatus: status, situacaoCadastral: situation,
    } });
    const account = await db.user.create({ data: { email: `old-pending-${index}@example.test`, password: "unused-hash", documentType: "CNPJ", companyId: company.id } });
    await issueAuthCode(account.id, "VERIFY_EMAIL");
    assert.equal((await verifyAuthCode(account.email, "VERIFY_EMAIL", sent.get(account.email)!)).ok, true);
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: account.id } })).emailVerifiedAt);
    assert.equal(await authTransaction(tx => grantSignupBenefit(tx, account)), false);
    assert.equal(await db.routeCredit.count({ where: { userId: account.id } }), 0);
    assert.equal(await db.signupBenefit.count({ where: { documentFingerprint: documentFingerprint("CNPJ", company.cnpj) } }), 0);
  }
  // Existing granted credits/history must not be removed when verification is pending.
  const old = await db.user.findUniqueOrThrow({ where: { email: "cnpj-guard-13@gmail.com" } });
  assert.equal((await db.routeCredit.aggregate({ where: { userId: old.id }, _sum: { delta: true } }))._sum.delta, 2);
  await db.company.update({ where: { id: old.companyId! }, data: { cnpjVerificationStatus: "PENDING_VERIFICATION" } });
  const before = await db.routeCredit.findMany();
  const benefits = await db.signupBenefit.findMany();
  assert.equal(await authTransaction(tx => grantSignupBenefit(tx, old)), false);
  assert.deepEqual(await db.routeCredit.findMany(), before);
  assert.deepEqual(await db.signupBenefit.findMany(), benefits);
});

test("existing legacy passwords shorter than eight still authenticate without forced changes", async () => {
  const hash = await bcrypt.hash('old123', 10);
  const legacy = await db.user.create({ data: { email: 'short-legacy@example.test', password: hash, emailVerificationRequired: false } });
  const { authOptions } = await modules();
  assert.ok(await credentialsProvider(authOptions).authorize({ email: legacy.email, password: 'old123' }, {}));
  const afterLogin = await db.user.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.equal(afterLogin.password, hash);
  assert.equal(afterLogin.sessionVersion, 0);
  assert.equal(afterLogin.emailVerificationRequired, false);
});

after(async () => {
  mock.restoreAll();
  globalThis.fetch = originalFetch;
  await db.$disconnect();
  const { prisma } = await import("../app/lib/prisma");
  await prisma.$disconnect();
});
