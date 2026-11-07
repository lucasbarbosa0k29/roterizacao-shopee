// Invoked by the isolated integration runner with ROTTA_AUTH_UI_TEST=1, after npm run build.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import bcrypt from 'bcrypt';

const url = new URL(process.env.TEST_DATABASE_URL || 'http://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== `/rotta_auth_test_${process.env.TEST_DB_RUN_ID}` || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error('Isolated database required');
const toolsRoot = process.env.ROTTA_TEST_TOOLS || join(tmpdir(), 'rotta-security-pg17-tools');
const { chromium } = await import(pathToFileURL(join(toolsRoot, 'node_modules/playwright/index.mjs')).href);
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const artifacts = await mkdtemp(join(tmpdir(), 'rotta-auth-ui-'));
const checkoutDocuments = [];
const asaas = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const data = JSON.parse(body);
  checkoutDocuments.push(data.customerData?.cpfCnpj);
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ id: `local-${checkoutDocuments.length}`, url: 'https://checkout.example.test/local-only' }));
});
await new Promise(resolve => asaas.listen(0, '127.0.0.1', resolve));
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--max-old-space-size=384', 'node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
  windowsHide: true, stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production', NEXTAUTH_URL: base, NEXT_PUBLIC_APP_URL: base,
    ASAAS_API_BASE_URL: `http://127.0.0.1:${asaas.address().port}`, ASAAS_ACCESS_TOKEN: 'test-only-no-real-charge' },
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/login`)).ok) { ready = true; break; } } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'Local Next server should start');
  for (const path of ['/configuracoes', '/configuracoes.rsc', '/admin', '/admin.rsc', '/api/admin/observability', '/api/admin/import-jobs', '/api/access/me']) {
    for (const headers of [
      { authorization: 'Bearer %E0%A4%A' },
      { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware', rsc: '1', 'next-router-prefetch': '1' },
    ]) {
      const response = await fetch(`${base}${path}`, { headers, redirect: 'manual' });
      assert.ok([301, 302, 303, 307, 308, 401, 403, 404].includes(response.status), `${path}: anonymous malformed/prefetch request must be denied, got ${response.status}`);
    }
  }
  console.log('PASS: real HTTP Bearer, middleware-spoof and RSC-prefetch checks reject anonymous access without 500.');
  browser = await chromium.launch({ executablePath: process.env.AUTH_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  for (const path of ['/login', '/login?source=twa']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    try {
      await page.goto(`${base}${path}`);
      await page.locator('input[type=email]').waitFor();
      assert.equal(await page.locator('a[href="/confirmar-email"]').count(), 0, 'No permanent confirmation link');
      for (const email of ['signup-one@gmail.com', 'missing-login@example.test']) {
        await page.locator('input[type=email]').fill(email);
        await page.locator('input[type=password]').fill('wrong-password-123');
        await page.locator('button[type=submit]').click();
        await page.getByText('Usuário ou senha inválidos.', { exact: true }).waitFor();
        assert.equal(await page.locator('a[href="/confirmar-email"]').count(), 0, 'Invalid credentials must not reveal pending status');
      }
      await page.locator('input[type=email]').fill('signup-one@gmail.com');
      await page.locator('input[type=password]').fill('signup-password-123');
      await page.locator('button[type=submit]').click();
      await page.getByText('Seu e-mail ainda não foi confirmado. Conclua a confirmação para entrar.', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/login');
      await page.getByRole('link', { name: 'Concluir confirmação de e-mail' }).click();
      await page.waitForURL('**/confirmar-email');
      assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), 'signup-one@gmail.com');
      await page.goto(`${base}${path}`);
      assert.equal(await page.locator('a[href="/confirmar-email"]').count(), 0, 'Reloading login must not leave a permanent confirmation option');
    } finally { await page.close(); }
  }
  console.log('PASS: standard/TWA login hides permanent confirmation links and reveals the option only after valid pending credentials.');
  for (const path of ['/login', '/login?source=twa']) {
    for (const type of ['CPF', 'CNPJ']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
      try {
        await page.route('**/api/register', route => route.fulfill({ status: 201, json: { ok: true, requiresEmailVerification: true, emailSent: true, message: 'Conta criada. Confirme seu e-mail com o código enviado.' } }));
        await page.goto(`${base}${path}`);
        await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
        await page.getByPlaceholder('Seu nome').fill('Pessoa fictícia');
        await page.locator('input[type=email]').fill('signup-ui@example.test');
        await page.getByPlaceholder('(62) 99999-9999').fill('62912345889');
        await page.getByLabel('Tipo de cadastro').selectOption(type);
        await page.getByPlaceholder(type === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00').fill(type === 'CPF' ? '52998224725' : '11222333000181');
        const signupPassword = page.getByPlaceholder('Digite sua senha');
        assert.equal(await signupPassword.getAttribute('minlength'), '8');
        await signupPassword.fill('abcdefg');
        assert.equal(await signupPassword.evaluate(input => input.validity.tooShort), true);
        await signupPassword.fill('abcdefgh');
        await page.getByPlaceholder('Confirme sua senha').fill('abcdefgh');
        assert.equal(await signupPassword.evaluate(input => input.checkValidity()), true);
        for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
        await page.locator('button[type=submit]').click();
        await page.waitForURL('**/confirmar-email');
        assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), 'signup-ui@example.test');
      } finally { await page.close(); }
    }
  }
  console.log('PASS: CPF/CNPJ signup still redirects automatically to confirmation in standard and TWA layouts (signup response mocked).');
  const verifiedUser = await db.user.findUniqueOrThrow({ where: { cpf: '52998224725' } });
  for (const [email, password] of [[verifiedUser.email, 'test-password-123'], ['legacy@example.test', 'next-password-123'], ['short-legacy@example.test', 'old123']]) {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/login?callbackUrl=/perfil`);
      assert.equal(await page.locator('input[type=password]').getAttribute('minlength'), null, 'Login must not impose the new-password minimum on legacy accounts');
      await page.locator('input[type=email]').fill(email);
      await page.locator('input[type=password]').fill(password);
      await page.locator('button[type=submit]').click();
      await page.waitForURL('**/perfil');
    } finally { await page.close(); }
  }
  console.log('PASS: verified and exempt legacy users enter normally without confirmation.');
  for (const path of ['/login', '/confirmar-email', '/esqueci-senha']) {
    const page = await browser.newPage();
    let releaseScripts;
    const scriptsAllowed = new Promise(resolve => { releaseScripts = resolve; });
    await page.route('**/_next/static/**/*.js', async route => {
      await scriptsAllowed;
      await route.continue();
    });
    try {
      await page.goto(`${base}${path}`, { waitUntil: 'commit' });
      await page.getByRole('status').filter({ hasText: 'Carregando formulário seguro' }).waitFor();
      assert.equal(await page.locator('input').count(), 0, 'SSR must not expose editable fields before hydration');
      releaseScripts();
      await page.locator('input[type=email]').fill('hydration@example.test');
      assert.equal(await page.locator('input[type=email]').inputValue(), 'hydration@example.test');
    } finally {
      releaseScripts();
      await page.close();
    }
  }
  console.log('PASS: delayed JavaScript cannot erase early input; login, verification and recovery wait for hydration.');
  const restrictedPage = await browser.newPage();
  const restrictedErrors = [];
  restrictedPage.on('pageerror', error => restrictedErrors.push(error.name));
  await restrictedPage.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('Storage blocked by test', 'SecurityError'); } });
  });
  await restrictedPage.goto(`${base}/login`);
  await restrictedPage.locator('input[type=email]').fill('signup-one@gmail.com');
  await restrictedPage.locator('input[type=password]').fill('signup-password-123');
  await restrictedPage.locator('button[type=submit]').click();
  await restrictedPage.getByRole('link', { name: 'Concluir confirmação de e-mail' }).click();
  await restrictedPage.waitForURL('**/confirmar-email');
  await restrictedPage.getByLabel('E-mail', { exact: true }).fill('signup-one@gmail.com');
  await restrictedPage.route('**/api/account/auth/verify-email', route => route.fulfill({ json: { ok: true } }));
  await restrictedPage.getByLabel('Código de 6 dígitos').fill('123456');
  await restrictedPage.getByRole('button', { name: 'Confirmar código' }).click();
  await restrictedPage.getByRole('link', { name: 'Entrar com e-mail e senha' }).waitFor();
  // Next's route announcer also has role=alert; only the form contains errors.
  assert.equal(await restrictedPage.locator('main').getByRole('alert').count(), 0);
  assert.deepEqual(restrictedErrors, [], 'Blocked sessionStorage must not break auth pages');
  await restrictedPage.close();
  console.log('PASS: pending login and confirmation UI work when sessionStorage is blocked (confirmation response mocked).');
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await page.getByLabel('Tipo de cadastro').selectOption('CPF');
    await page.getByPlaceholder('000.000.000-00').fill('52998224725');
    assert.ok(await page.getByText('Ao se cadastrar com CPF, você receberá apenas 1 crédito gratuito para experimentar o Rotta, após confirmar seu e-mail.', { exact: true }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    await page.screenshot({ path: join(artifacts, `signup-${width}.png`), fullPage: true });
    await page.getByLabel('Tipo de cadastro').selectOption('CNPJ');
    assert.ok(await page.getByPlaceholder('00.000.000/0000-00').isVisible());
    const cnpjInput = page.getByPlaceholder('00.000.000/0000-00');
    await cnpjInput.fill('12abc34501de35');
    assert.equal(await cnpjInput.inputValue(), '12.ABC.345/01DE-35');
    await cnpjInput.fill('11222333000181');
    assert.equal(await cnpjInput.inputValue(), '11.222.333/0001-81');
    await page.goto(`${base}/confirmar-email`);
    await page.getByLabel('E-mail', { exact: true }).fill('ui@example.test');
    assert.ok(await page.getByRole('button', { name: 'Enviar / reenviar código' }).isVisible());
    await page.screenshot({ path: join(artifacts, `verify-${width}.png`), fullPage: true });
    await page.route('**/api/account/auth/**', async route => {
      const action = new URL(route.request().url()).pathname.split('/').at(-1);
      await route.fulfill({ json: action === 'verify-reset' ? { ok: true, resetToken: 'a'.repeat(64) } : { ok: true, message: 'Solicitação recebida.', retryAfter: 60 } });
    });
    await page.goto(`${base}/esqueci-senha`);
    await page.getByLabel('E-mail', { exact: true }).fill('ui@example.test');
    await page.getByRole('button', { name: 'Enviar código', exact: true }).click();
    await page.getByLabel('Código de 6 dígitos').fill('123456');
    await page.getByRole('button', { name: 'Confirmar código' }).click();
    const resetPassword = page.getByLabel('Nova senha', { exact: true });
    assert.equal(await resetPassword.getAttribute('minlength'), '8');
    await resetPassword.fill('abcdefg');
    assert.equal(await resetPassword.evaluate(input => input.validity.tooShort), true);
    await resetPassword.fill('abcdefgh');
    await page.getByLabel('Confirmar nova senha').fill('abcdefgh');
    assert.equal(await resetPassword.evaluate(input => input.checkValidity()), true);
    await page.screenshot({ path: join(artifacts, `reset-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    await page.getByRole('link', { name: 'Entrar com e-mail e senha' }).waitFor();
    await page.close();
    console.log(`PASS: responsive signup CPF/CNPJ, verification and reset UI at ${width}px.`);
  }
  const twaPage = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await twaPage.goto(`${base}/login?source=twa`);
  await twaPage.getByText('Acesse sua conta para continuar a operação.').waitFor();
  await twaPage.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await twaPage.getByLabel('Tipo de cadastro').selectOption('CPF');
  await twaPage.getByPlaceholder('000.000.000-00').fill('52998224725');
  assert.ok(await twaPage.getByText('Ao se cadastrar com CPF, você receberá apenas 1 crédito gratuito para experimentar o Rotta, após confirmar seu e-mail.', { exact: true }).isVisible());
  assert.ok(await twaPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await twaPage.screenshot({ path: join(artifacts, 'signup-twa-390.png'), fullPage: true });
  await twaPage.close();
  console.log('PASS: installed-app layout (local TWA mode) retains CPF signup at 390px.');
  async function cookieFor(user) {
    const token = await encode({ token: { id: user.id, email: user.email, role: user.role, sessionVersion: user.sessionVersion }, secret: process.env.NEXTAUTH_SECRET });
    return `next-auth.session-token=${token}`;
  }
  for (const where of [{ cpf: '52998224725' }, { email: 'pj@example.test' }, { email: 'alpha-cnpj@gmail.com' }]) {
    const user = await db.user.findUniqueOrThrow({ where });
    const response = await fetch(`${base}/api/payments/asaas/checkout`, { method: 'POST', headers: { cookie: await cookieFor(user), 'Content-Type': 'application/json' }, body: JSON.stringify({ productType: 'BASIC_PLAN' }) });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(checkoutDocuments, ['52998224725', '11444777000161', '12ABC34501DE35']);
  console.log('PASS: real checkout API sends CPF and CNPJ to isolated Asaas mock.');
  const cacheUsers = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: 'legacy-user' } }),
    db.user.findUniqueOrThrow({ where: { email: 'pj@example.test' } }),
  ]);
  for (const user of [cacheUsers[0], cacheUsers[1], cacheUsers[0]]) {
    const response = await fetch(`${base}/api/access/me`, { headers: { cookie: await cookieFor(user) } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).userId, user.id, 'Access responses must not be shared across sessions');
  }
  assert.equal((await fetch(`${base}/api/access/me`)).status, 401);
  console.log('PASS: authenticated access responses remain isolated across users and anonymous requests.');
  const legacyForImport = await db.user.findUniqueOrThrow({ where: { id: 'legacy-user' } });
  const importCookie = await cookieFor(legacyForImport);
  async function upload(name, bytes, expectedStatus) {
    const data = new FormData();
    data.set('file', new File([bytes], name));
    const response = await fetch(`${base}/api/import`, { method: 'POST', headers: { cookie: importCookie }, body: data });
    assert.equal(response.status, expectedStatus, `${name}: ${await response.clone().text()}`);
    return response.json();
  }
  for (const format of ['xlsx', 'xls', 'csv']) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ Sequence: 1, 'Endereço': 'Rua São João, 42', Cidade: 'Goiânia', CEP: '74000-001' }]), 'Entregas');
    const result = await upload(`teste.${format}`, XLSX.write(book, { type: 'buffer', bookType: format }), 200);
    assert.equal(result.total, 1);
    assert.equal(result.rows[0].original, 'Rua São João, 42');
    assert.equal(result.rows[0].city, 'Goiânia');
  }
  const txt = await upload('imile.txt', 'PACOTE 1\nNome: João da Conceição\nEndereço: Rua São João, Goiânia, Goiás', 200);
  assert.equal(txt.total, 1);
  assert.equal(txt.rows[0].cliente, 'João da Conceição');
  await upload('invalid.xlsx', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 400);
  await upload('empty.xlsx', '', 400);
  await upload('oversize.xlsx', new Uint8Array(5 * 1024 * 1024 + 1), 413);
  await upload('many.csv', 'Sequence,Endereço\n' + Array.from({ length: 201 }, (_, i) => `${i + 1},Rua ${i}`).join('\n'), 400);
  console.log('PASS: real import API accepts XLSX/XLS/CSV/TXT with accents and rejects invalid, empty, oversized and >200-stop files.');
  const pending = await db.user.findUniqueOrThrow({ where: { email: 'signup-one@gmail.com' } });
  for (const path of ['/api/import', '/api/process', '/api/payments/asaas/checkout']) {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie: await cookieFor(pending), 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
  }
  console.log('PASS: real import/process APIs reject unverified accounts.');
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill('legacy@example.test');
  await page.locator('input[type=password]').fill('next-password-123');
  assert.equal(await page.locator('input[type=email]').inputValue(), 'legacy@example.test', 'Email must survive initial hydration');
  assert.equal(await page.locator('input[type=password]').inputValue(), 'next-password-123', 'Password must survive initial hydration');
  const loginResponse = page.waitForResponse(response => response.url().includes('/api/auth/callback/credentials'));
  await page.locator('button[type=submit]').click();
  assert.equal((await loginResponse).status(), 200, 'Legacy credentials should be accepted');
  await page.waitForURL('**/importar-planilha');
  const oldCookie = (await page.context().cookies()).filter(c => c.name.includes('session-token')).map(c => `${c.name}=${c.value}`).join('; ');
  assert.ok(oldCookie);
  await page.goto(`${base}/configuracoes`);
  await page.getByLabel('Senha atual').fill('next-password-123');
  const changedPassword = page.getByLabel('Nova senha', { exact: true });
  assert.equal(await changedPassword.getAttribute('minlength'), '8');
  await changedPassword.fill('aB3!xy_?');
  await page.getByLabel('Confirmar nova senha').fill('aB3!xy_?');
  assert.equal(await page.getByLabel('Senha atual').inputValue(), 'next-password-123', 'Current password must survive hydration');
  await page.screenshot({ path: join(artifacts, 'security-390.png'), fullPage: true });
  const changed = page.waitForResponse(response => response.url().endsWith('/api/account/auth/change-password'));
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  const changeResponse = await changed;
  assert.equal(changeResponse.status(), 200, await changeResponse.text());
  await page.waitForURL('**/login?passwordChanged=1');
  // Navigation completes before the client form is hydrated. Await the actual
  // success message with Playwright's existing default deadline, not a sleep.
  await page.getByText('Senha alterada com sucesso. Entre novamente com a nova senha.').waitFor({ state: 'visible' });
  for (const path of ['/api/access/me', '/api/payments/asaas/checkout', '/api/import', '/api/process']) {
    const response = await fetch(`${base}${path}`, { method: path === '/api/access/me' ? 'GET' : 'POST', headers: { cookie: oldCookie } });
    assert.equal(response.status, 401, `${path} should reject old cookie`);
  }
  console.log('PASS: legacy login, password change UI and real protected APIs reject old session.');
  const admin = await db.user.create({ data: { email: 'password-policy-admin@example.test', password: legacyForImport.password, role: 'ADMIN', emailVerificationRequired: false } });
  const adminHeaders = { cookie: await cookieFor(admin), 'Content-Type': 'application/json' };
  const createUser = password => fetch(`${base}/api/admin/users`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email: 'admin-created-password@example.test', name: 'Password fixture', password }) });
  assert.equal((await createUser('1234567')).status, 400);
  assert.equal((await createUser('a'.repeat(73))).status, 400);
  assert.equal((await createUser('abcdefgh')).status, 200);
  const adminCreated = await db.user.findUniqueOrThrow({ where: { email: 'admin-created-password@example.test' } });
  assert.ok(await bcrypt.compare('abcdefgh', adminCreated.password));
  const resetAdminUser = password => fetch(`${base}/api/admin/users/${adminCreated.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ action: 'RESET_PASSWORD', password }) });
  assert.equal((await resetAdminUser('1234567')).status, 400);
  assert.equal((await resetAdminUser('a'.repeat(73))).status, 400);
  assert.equal((await resetAdminUser('12345678')).status, 200);
  const adminReset = await db.user.findUniqueOrThrow({ where: { id: adminCreated.id } });
  assert.ok(await bcrypt.compare('12345678', adminReset.password));
  assert.equal(adminReset.sessionVersion, adminCreated.sessionVersion + 1);
  console.log('PASS: administrative creation/reset reject seven characters and >72 bytes, accept eight and preserve bcrypt/session revocation.');
  if (process.platform === 'win32') {
    const usage = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${server.pid} | Select-Object WorkingSet64,PeakWorkingSet64 | ConvertTo-Json -Compress`], { windowsHide: true, encoding: 'utf8' }).trim();
    console.log(`Local Windows Next production server memory (384 MiB V8 heap cap): ${usage}`);
  }
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  // Synthetic fixtures only. Do not record cookies, tokens, passwords or response bodies.
  for (const [index, context] of (browser?.contexts() || []).entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      console.error(`Failed UI context ${index}/${pageIndex}: ${new URL(page.url()).pathname}`);
      await page.screenshot({ path: join(artifacts, `failure-${index}-${pageIndex}.png`), fullPage: true }).catch(() => {});
    }
  }
  console.error(`Failure screenshots: ${artifacts}`);
  throw error;
} finally {
  await browser?.close();
  await db.$disconnect();
  server.kill();
  await new Promise(resolve => asaas.close(resolve));
}
