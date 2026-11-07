// Run after the production build. ROTTA_TEST_TOOLS points to a directory
// containing node_modules/playwright, as in account-security-ui.mjs.
// All browser API calls are mocked; no database or mail provider is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const toolsRoot = process.env.ROTTA_TEST_TOOLS || join(tmpdir(), 'rotta-security-pg17-tools');
const { chromium } = await import(pathToFileURL(join(toolsRoot, 'node_modules/playwright/index.mjs')).href);
const artifacts = await mkdtemp(join(tmpdir(), 'rotta-auth-copy-ui-'));
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  windowsHide: true, stdio: 'ignore',
  env: {
    ...process.env, NODE_ENV: 'production', ROTTA_LOCAL_DEV: '0', NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/rotta_copy_ui_test',
    NEXTAUTH_URL: base, NEXTAUTH_SECRET: 'synthetic-ui-session-secret-not-a-real-credential',
    AUTH_CODE_SECRET: 'synthetic-ui-code-secret-not-a-real-credential',
    AUTH_RATE_LIMIT_SECRET: 'synthetic-ui-rate-secret-not-a-real-credential',
    DOCUMENT_HMAC_SECRET: 'synthetic-ui-document-secret-not-a-real-credential',
    RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', ASAAS_API_KEY: '', ASAAS_WEBHOOK_SECRET: '',
  },
});
const appExit = new Promise(resolve => app.once('exit', resolve));
let browser;
let checks = 0;

const cpfMessage = 'Ao se cadastrar com CPF, você receberá apenas 1 crédito gratuito para experimentar o Rotta, após confirmar seu e-mail.';
const cnpjMessage = 'Cadastre-se com CNPJ e receba 2 créditos gratuitos após confirmar seu e-mail.';
const cpfDeclaration = 'Declaro que sou titular do CPF informado e que os dados fornecidos são verdadeiros.';
const cnpjDeclaration = 'Declaro que sou representante legal da empresa ou possuo autorização para utilizar o CNPJ informado.';
const recoveryMessage = 'Se o endereço informado estiver cadastrado, enviaremos um código de 6 dígitos para redefinir sua senha.';
const recoveryHelp = 'O código é válido por 10 minutos. Não recebeu? Verifique a caixa de spam ou solicite um novo código.';

async function pageWithMocks(width, sendMessage = 'Solicitação recebida.') {
  const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  const registrations = [];
  const unexpected = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: {} });
    if (url.pathname === '/api/register') {
      registrations.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { ok: true, requiresEmailVerification: true, emailSent: false, message: 'Conta criada e pendente de confirmação.' } });
    }
    if (url.pathname === '/api/account/auth/forgot-password') {
      return route.fulfill({ json: { ok: true, message: sendMessage, retryAfter: 60 } });
    }
    if (url.pathname === '/api/account/auth/verify-reset') {
      const { code } = route.request().postDataJSON();
      return code === '123456'
        ? route.fulfill({ json: { ok: true, resetToken: 'a'.repeat(64) } })
        : route.fulfill({ status: 400, json: { error: 'Código inválido, expirado ou bloqueado por tentativas. Solicite outro código quando permitido.' } });
    }
    if (url.pathname === '/api/account/auth/reset-password') {
      return route.fulfill({ json: { ok: true, message: 'Senha redefinida. Entre com a nova senha.' } });
    }
    unexpected.push(url.pathname);
    return route.abort();
  });
  return { page, registrations, unexpected, errors };
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode !== null) throw new Error('Local Next server exited before becoming ready');
    try { ready = (await fetch(`${base}/login`)).ok; } catch { /* Local startup only. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Local Next server must become ready');
  browser = await chromium.launch({ executablePath: process.env.AUTH_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  for (const width of [360, 1440]) {
    for (const layout of ['standard', 'twa']) {
      const { page, registrations, unexpected, errors } = await pageWithMocks(width);
      try {
        await page.goto(`${base}/login${layout === 'twa' ? '?source=twa' : ''}`);
        await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
        const type = page.getByLabel('Tipo de cadastro');
        assert.equal(await type.inputValue(), 'CNPJ');
        await page.getByText('2 ROTAS GRÁTIS!', { exact: true }).waitFor();
        assert.ok(await page.getByText(cnpjMessage, { exact: true }).isVisible());
        assert.equal(await page.getByText(cpfMessage, { exact: true }).count(), 0);
        assert.ok(await page.getByRole('checkbox', { name: cnpjDeclaration, exact: true }).isVisible());
        await noOverflow(page);
        await page.screenshot({ path: join(artifacts, `cnpj-${layout}-${width}.png`), fullPage: true });

        await type.selectOption('CPF');
        assert.ok(await page.getByText('Atenção!', { exact: true }).isVisible());
        assert.ok(await page.getByText(cpfMessage, { exact: true }).isVisible());
        assert.equal(await page.getByText(cnpjMessage, { exact: true }).count(), 0);
        assert.equal(await page.getByText('2 ROTAS GRÁTIS!', { exact: true }).count(), 0);
        assert.equal(await page.getByRole('checkbox', { name: cnpjDeclaration, exact: true }).count(), 0);
        await page.getByRole('checkbox', { name: cpfDeclaration, exact: true }).check();
        await type.selectOption('CNPJ');
        assert.equal(await page.getByRole('checkbox', { name: cnpjDeclaration, exact: true }).isChecked(), true);
        assert.equal(await page.getByText('Atenção!', { exact: true }).count(), 0);
        assert.equal(await page.getByText(cpfMessage, { exact: true }).count(), 0);
        await type.selectOption('CPF');
        const declaration = page.getByRole('checkbox', { name: cpfDeclaration, exact: true });
        await declaration.uncheck();
        await page.getByPlaceholder('Seu nome').fill('Pessoa fictícia');
        await page.locator('input[type=email]').fill('signup-copy@example.test');
        await page.getByPlaceholder('(62) 99999-9999').fill('62912345889');
        await page.getByPlaceholder('000.000.000-00').fill('52998224725');
        await page.getByPlaceholder('Digite sua senha').fill('synthetic-password-123');
        await page.getByPlaceholder('Confirme sua senha').fill('synthetic-password-123');
        await page.getByRole('checkbox').last().check();
        await page.locator('button[type=submit]').click();
        await page.getByText('Você precisa confirmar que está autorizado a utilizar este documento.', { exact: true }).waitFor();
        assert.equal(registrations.length, 0, 'Declaration remains mandatory');
        await noOverflow(page);
        await page.screenshot({ path: join(artifacts, `cpf-${layout}-${width}.png`), fullPage: true });
        await declaration.check();
        await page.locator('button[type=submit]').click();
        await page.waitForURL('**/confirmar-email');
        await page.getByRole('heading', { name: 'Confirme seu e-mail', exact: true }).waitFor();
        assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), 'signup-copy@example.test');
        assert.equal(registrations.length, 1);
        assert.equal(registrations[0].documentType, 'CPF');
        assert.equal(registrations[0].documentResponsibilityAccepted, true);
        assert.equal(registrations[0].termsAccepted, true);
        assert.deepEqual(unexpected, []);
        assert.deepEqual(errors, []);
        checks++;
        console.log(`PASS: exclusive CPF/CNPJ notices, declarations and required checkbox (${layout}, ${width}px).`);
      } finally { await page.close(); }
    }
    // Different simulated server messages must never reveal account existence
    // or claim successful delivery in the recovery code stage.
    for (const scenario of ['eligible', 'missing', 'delivery-unavailable']) {
      const serverMessage = `Simulated private result: ${scenario}`;
      const { page, unexpected, errors } = await pageWithMocks(width, serverMessage);
      try {
        await page.goto(`${base}/esqueci-senha`);
        await page.getByLabel('E-mail', { exact: true }).fill('recover-copy@example.test');
        await page.getByRole('button', { name: 'Enviar código', exact: true }).click();
        await page.getByRole('heading', { name: 'Confira seu e-mail', exact: true }).waitFor();
        assert.ok(await page.getByText(recoveryMessage, { exact: true }).isVisible());
        assert.ok(await page.getByText(recoveryHelp, { exact: true }).isVisible());
        assert.equal(await page.getByText(serverMessage, { exact: true }).count(), 0);
        assert.equal(await page.getByText(/código (foi )?enviado com sucesso/i).count(), 0);
        const code = page.getByLabel('Código de 6 dígitos', { exact: true });
        assert.equal(await code.getAttribute('maxlength'), '6');
        assert.equal(await code.getAttribute('pattern'), '[0-9]{6}');
        assert.equal(await code.getAttribute('required'), '');
        const resend = page.getByRole('button', { name: /Solicitar novo código em \d+s/ });
        assert.equal(await resend.isDisabled(), true);
        await noOverflow(page);
        if (scenario === 'eligible') {
          const previousSeconds = Number((await resend.innerText()).match(/\d+/)[0]);
          await page.waitForFunction(previous => [...document.querySelectorAll('button')].some(button => {
            const match = button.textContent.match(/Solicitar novo código em (\d+)s/);
            return match && Number(match[1]) < previous;
          }), previousSeconds);
          assert.equal(await resend.isDisabled(), true);
          await page.screenshot({ path: join(artifacts, `recover-${width}.png`), fullPage: true });
          await code.fill('000000');
          await page.getByRole('button', { name: 'Confirmar código', exact: true }).click();
          await page.getByText('Código inválido, expirado ou bloqueado por tentativas. Solicite outro código quando permitido.', { exact: true }).waitFor();
          assert.ok(await page.getByText(recoveryHelp, { exact: true }).isVisible());
          await code.fill('123456');
          await page.getByRole('button', { name: 'Confirmar código', exact: true }).click();
          await page.getByLabel('Nova senha', { exact: true }).fill('replacement-password-123');
          await page.getByLabel('Confirmar nova senha', { exact: true }).fill('replacement-password-123');
          await page.getByRole('button', { name: 'Salvar nova senha', exact: true }).click();
          await page.getByText('Senha redefinida. Entre com a nova senha.', { exact: true }).waitFor();
          assert.ok(await page.getByRole('link', { name: 'Entrar com e-mail e senha' }).isVisible());
        }
        assert.deepEqual(unexpected, []);
        assert.deepEqual(errors, []);
        checks++;
        console.log(`PASS: generic recovery copy and preserved code form (${scenario}, ${width}px).`);
      } finally { await page.close(); }
    }
  }
  console.log(`PASS: ${checks} browser scenarios. Screenshots: ${artifacts}`);
} finally {
  if (browser) await browser.close();
  app.kill();
  await appExit;
}
