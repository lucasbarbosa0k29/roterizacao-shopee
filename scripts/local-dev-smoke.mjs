// Deliberately local-only. No credentials, codes, tokens or provider payloads are logged.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import nextEnv from '@next/env';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';

Object.assign(process.env, { NODE_ENV: 'development' });
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.ok(url.hostname === '127.0.0.1' && url.port === '54329' && url.pathname === '/rotta_local_dev', 'Smoke requires the dedicated local database');
const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
const base = 'http://localhost:3000';
const run = randomBytes(6).toString('hex');
const password = randomBytes(20).toString('hex');
const replacement = randomBytes(20).toString('hex');
const records = [];
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: base }, body: JSON.stringify(body) });
async function capturedCode(email, purpose) {
  const html = await (await fetch('http://127.0.0.1:8025/')).text();
  const label = purpose === 'VERIFY_EMAIL' ? 'Confirmação de e-mail' : 'Recuperação de senha';
  const article = html.split('<article>').find(part => part.includes(`${label} · ${email}</p>`));
  const code = article?.match(/<strong>(\d{6})<\/strong>/)?.[1];
  assert.ok(code, 'Expected a six-digit code in the local inbox');
  return code;
}
async function login(email, pass) {
  const csrfResponse = await fetch(base + '/api/auth/csrf');
  const { csrfToken } = await csrfResponse.json();
  const cookies = csrfResponse.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
  const response = await fetch(base + '/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookies, origin: base },
    body: new URLSearchParams({ csrfToken, email, password: pass, callbackUrl: base + '/importar-planilha', json: 'true' }), redirect: 'manual' });
  return response.headers.getSetCookie().filter(cookie => cookie.includes('next-auth.session-token=') && !cookie.startsWith('next-auth.session-token=;')).map(cookie => cookie.split(';')[0]).join('; ');
}
try {
  const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port');
  assert.ok(identity.database === 'rotta_local_dev' && identity.host === '127.0.0.1' && identity.port === 54329, 'Database identity must be local before test writes');
  console.log('PASS: identidade local comprovada antes das escritas do smoke test.');
  assert.equal((await fetch(base + '/login')).status, 200);
  for (const [type, document, whatsapp, quantity] of [['CPF', '93541134780', '62912345881', 1], ['CNPJ', '12ABC34501DE35', '62912345882', 2]]) {
    const email = `smoke-${type.toLowerCase()}-${run}@exemplo.test`;
    const signup = await post('/api/register', { name: 'Pessoa fictícia de verificação local', email, password, whatsapp, documentType: type, [type === 'CPF' ? 'cpf' : 'cnpj']: document, termsAccepted: true, documentResponsibilityAccepted: true });
    assert.equal(signup.status, 201, 'Synthetic signup should succeed');
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    records.push({ id: user.id, email, companyId: user.companyId, type, document });
    assert.equal(await db.routeCredit.count({ where: { userId: user.id } }), 0);
    assert.ok(!await login(email, password), 'Pending account must not log in');
    let code = await capturedCode(email, 'VERIFY_EMAIL');
    const challenge = await db.authChallenge.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose: 'VERIFY_EMAIL' } } });
    assert.equal(challenge.expiresAt.getTime() - challenge.requestedAt.getTime(), 600_000);
    if (type === 'CPF') {
      await db.authChallenge.update({ where: { id: challenge.id }, data: { expiresAt: new Date(Date.now() - 1), requestedAt: new Date(Date.now() - 61_000) } });
      assert.equal((await post('/api/account/auth/verify-email', { email, code })).status, 400, 'Expired code must be rejected');
      await post('/api/account/auth/send-verification', { email });
      code = await capturedCode(email, 'VERIFY_EMAIL');
    }
    assert.equal((await post('/api/account/auth/verify-email', { email, code })).status, 200);
    assert.equal((await post('/api/account/auth/verify-email', { email, code })).status, 400);
    assert.equal((await db.routeCredit.aggregate({ where: { userId: user.id }, _sum: { delta: true } }))._sum.delta, quantity);
    const cookie = await login(email, password);
    assert.ok(cookie, 'Verified account should log in');
    assert.equal((await fetch(base + '/api/access/me', { headers: { cookie } })).status, 200);
    if (type === 'CPF') {
      assert.equal((await post('/api/account/auth/forgot-password', { email })).status, 200);
      const reset = await post('/api/account/auth/verify-reset', { email, code: await capturedCode(email, 'RESET_PASSWORD') });
      const result = await reset.json();
      assert.equal(reset.status, 200);
      assert.equal((await post('/api/account/auth/reset-password', { email, resetToken: result.resetToken, password: replacement, confirmPassword: replacement })).status, 200);
      assert.equal((await fetch(base + '/api/access/me', { headers: { cookie } })).status, 401);
      assert.ok(!await login(email, password), 'Old password must be rejected');
      assert.ok(await login(email, replacement));
      console.log('PASS: código com TTL de 10 minutos, expiração/reenvio, recuperação e revogação da sessão.');
    }
    console.log(`PASS: cadastro ${type}, captura de e-mail, confirmação, login e ${quantity} crédito(s), sem duplicação.`);
  }
  for (const provider of ['asaas', 'mercadopago']) {
    assert.equal((await post(`/api/payments/${provider}/checkout`, { productType: 'EXTRA_ROUTE' })).status, 503);
  }
  console.log('PASS: pagamentos reais bloqueados nos dois checkouts.');
} finally {
  // Remove only records created by this smoke run, never a reset or deletion of manual accounts.
  for (const record of records) {
    const fingerprint = createHmac('sha256', process.env.DOCUMENT_HMAC_SECRET).update(JSON.stringify(['signup-benefit-v1', record.type, record.document])).digest('hex');
    await db.$transaction(async tx => {
      await tx.user.delete({ where: { id: record.id } });
      if (record.companyId) await tx.company.delete({ where: { id: record.companyId } });
      await tx.signupBenefit.deleteMany({ where: { documentFingerprint: fingerprint } });
    });
  }
  await db.$disconnect();
}
