import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import nextEnv from '@next/env';
import { startMailbox } from './local-mailbox.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const folder = join(root, '.local', 'rotta');
const data = join(folder, 'postgres');
const configFile = join(folder, 'config.json');
const database = 'rotta_local_dev';
const mode = process.argv[2] || 'start';
const require = createRequire(import.meta.url);
const databaseKey = name => /DATABASE_URL|DIRECT_URL|POSTGRES.*URL|PG(?:HOST|PORT|DATABASE|USER|PASSWORD)|SHADOW_DATABASE_URL/.test(name);
class LocalError extends Error {}
const exists = async path => { try { await access(path); return true; } catch { return false; } };
async function source(file) { try { return await readFile(join(root, file), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } }
function entries(content) { return [...content.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/gm)].map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]); }
function classify(value) {
  try { const url = new URL(value); return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? 'local' : url.hostname.endsWith('.neon.tech') ? 'Neon remoto' : 'remoto'; } catch { return value ? 'configurado (não é URL)' : 'vazio'; }
}

if (mode === 'inspect') {
  for (const file of ['.env', '.env.local', '.env.development.local']) {
    console.log(JSON.stringify({ file, databaseVariables: entries(await source(file)).filter(([name]) => databaseKey(name)).map(([name, value]) => ({ name, destination: classify(value) })) }));
  }
  nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
  console.log(JSON.stringify({ effectiveDatabase: classify(process.env.DATABASE_URL || ''), nextAuthLocal: process.env.NEXTAUTH_URL === 'http://localhost:3000' }));
  process.exit(0);
}

let child;
let pg;
let mailbox;
let stopping = false;
let cfg;
let pgCtl;
function ctl(args) { return execFileSync(pgCtl, ['-D', data, ...args], { windowsHide: true, stdio: 'ignore', timeout: 30_000 }); }
async function stop() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) {
    if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* Already stopped. */ } }
    else child.kill('SIGTERM');
  }
  if (mailbox) await new Promise(resolveClosed => mailbox.close(resolveClosed));
  if (pg) {
    if (process.platform === 'win32') { try { ctl(['-m', 'fast', '-w', 'stop']); } catch { console.error('Confira o encerramento do PostgreSQL local com npm run dev:stop.'); } }
    else await pg.stop();
  }
}
async function assertPortAvailable(port) {
  const probe = createServer();
  try { await new Promise((resolvePort, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolvePort); }); }
  catch { throw new LocalError(`A porta local ${port} já está em uso. Encerre o ambiente anterior antes de iniciar outro.`); }
  finally { if (probe.listening) await new Promise(resolveClosed => probe.close(resolveClosed)); }
}

try {
  const dependency = dirname(dirname(require.resolve('embedded-postgres')));
  pgCtl = join(dependency, '..', '@embedded-postgres', 'windows-x64', 'native', 'bin', 'pg_ctl.exe');
  if (mode === 'stop') {
    if (await exists(configFile)) {
      const saved = JSON.parse(await readFile(configFile, 'utf8'));
      try {
        const response = await fetch('http://127.0.0.1:8025/shutdown', { method: 'POST', headers: { 'X-Rotta-Mail-Token': saved.secrets.ROTTA_LOCAL_MAIL_TOKEN }, signal: AbortSignal.timeout(3000) });
        if (response.ok) { console.log('Encerramento do Rotta local solicitado. Contas, créditos e e-mails serão preservados.'); process.exit(0); }
      } catch { /* Local launcher not running; stop only this project's persistent cluster below. */ }
    }
    if (process.platform !== 'win32') throw new LocalError('Encerre o terminal de npm run dev com Ctrl+C.');
    if (await exists(join(data, 'PG_VERSION'))) { try { ctl(['-m', 'fast', '-w', 'stop']); } catch { /* Already stopped. */ } }
    console.log('PostgreSQL local encerrado ou já estava parado. Dados preservados.');
    process.exit(0);
  }
  if (!['start', 'setup'].includes(mode)) throw new LocalError('Comando local desconhecido.');
  if (mode === 'start') { await assertPortAvailable(3000); await assertPortAvailable(8025); }
  await mkdir(folder, { recursive: true });
  if (await exists(configFile)) cfg = JSON.parse(await readFile(configFile, 'utf8'));
  else {
    if (await exists(join(data, 'PG_VERSION'))) throw new LocalError('Cluster local encontrado sem configuração. Nenhum dado foi recriado.');
    const secret = () => randomBytes(32).toString('hex');
    cfg = { database, port: 54329, adminPassword: secret(), appPassword: secret(), secrets: {
      NEXTAUTH_SECRET: secret(), AUTH_CODE_SECRET: secret(), DOCUMENT_HMAC_SECRET: secret(), AUTH_RATE_LIMIT_SECRET: secret(), ROTTA_LOCAL_MAIL_TOKEN: secret(),
    } };
    await writeFile(configFile, JSON.stringify(cfg, null, 2), { mode: 0o600, flag: 'wx' });
  }
  if (cfg.database !== database || cfg.port !== 54329 || !/^[a-f0-9]{64}$/.test(cfg.appPassword) || !/^[a-f0-9]{64}$/.test(cfg.adminPassword)) throw new LocalError('Configuração local inválida. Nenhum banco foi alterado.');
  if (['NEXTAUTH_SECRET', 'AUTH_CODE_SECRET', 'DOCUMENT_HMAC_SECRET', 'AUTH_RATE_LIMIT_SECRET', 'ROTTA_LOCAL_MAIL_TOKEN'].some(key => !/^[a-f0-9]{64}$/.test(cfg.secrets?.[key] || ''))) throw new LocalError('Segredos locais ausentes ou inválidos. Nenhum valor foi recriado.');
  await assertPortAvailable(cfg.port);
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  pg = new EmbeddedPostgres({ databaseDir: data, port: cfg.port, user: 'postgres', password: cfg.adminPassword, authMethod: 'scram-sha-256', persistent: true,
    initdbFlags: ['--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  if (!await exists(join(data, 'PG_VERSION'))) { console.log('Preparando PostgreSQL 17 local persistente...'); await pg.initialise(); }
  if (process.platform === 'win32') ctl(['-l', join(folder, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${cfg.port} -c shared_buffers=64MB`, '-w', 'start']);
  else await pg.start();
  const admin = pg.getPgClient('postgres', '127.0.0.1');
  await admin.connect();
  try {
    const result = await admin.query("SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS directory");
    const actual = result.rows[0];
    if (actual.host !== '127.0.0.1' || actual.port !== cfg.port || resolve(actual.directory).toLowerCase() !== resolve(data).toLowerCase()) throw new LocalError('O servidor não corresponde ao cluster local esperado. Operação interrompida.');
    const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname='rotta_app'");
    if (!role.rowCount) await admin.query(`CREATE ROLE rotta_app LOGIN PASSWORD '${cfg.appPassword}'`);
    const db = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
    if (!db.rowCount) await admin.query('CREATE DATABASE rotta_local_dev OWNER rotta_app');
  } finally { await admin.end(); }
  const url = `postgresql://rotta_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/${database}?schema=public`;
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== String(cfg.port) || parsed.pathname !== `/${database}`) throw new LocalError('Destino Prisma não é exclusivamente local.');
  const environment = { ...process.env, NODE_ENV: 'development' };
  // Load existing mapping settings, then override database, authentication and all payment credentials.
  nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
  Object.assign(environment, process.env);
  const overrides = { DATABASE_URL: url, DIRECT_URL: url, NEXTAUTH_URL: 'http://localhost:3000', NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    ROTTA_LOCAL_DEV: '1', ...cfg.secrets, RESEND_API_KEY: '', RESEND_FROM_EMAIL: 'Rotta <naoresponda@usarotta.com.br>',
    GOOGLE_MAPS_API_KEY: '', GOOGLE_PLACES_API_KEY: '', GEMINI_API_KEY: '', HERE_API_KEY: '',
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: '', NEXT_PUBLIC_HERE_API_KEY: '', NEXT_PUBLIC_ARCGIS_API_KEY: '',
    ASAAS_ACCESS_TOKEN: '', ASAAS_WEBHOOK_SECRET: '', MERCADOPAGO_ACCESS_TOKEN: '', MERCADO_PAGO_ACCESS_TOKEN: '', AUTH_TRUST_PROXY: '0', NEXT_TELEMETRY_DISABLED: '1' };
  const localFiles = ['.env', '.env.local', '.env.development.local'];
  for (const file of localFiles) {
    let content = await source(file);
    if (!content && file !== '.env.local') continue;
    for (const [key] of entries(content)) if (databaseKey(key)) {
      overrides[key] = key === 'PGHOST' ? '127.0.0.1' : key === 'PGPORT' ? String(cfg.port) : key === 'PGDATABASE' ? database : key === 'PGUSER' ? 'rotta_app' : key === 'PGPASSWORD' ? cfg.appPassword : /SHADOW|TEST_DATABASE_URL/.test(key) ? '' : url;
    }
    const additions = file === '.env.local' ? overrides : Object.fromEntries(entries(content).filter(([key]) => databaseKey(key)).map(([key]) => [key, overrides[key]]));
    for (const [key, value] of Object.entries(additions)) {
      const line = `${key}=${JSON.stringify(value)}`;
      const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'gm');
      content = pattern.test(content) ? content.replace(pattern, () => line) : content.trimEnd() + '\n' + line + '\n';
    }
    await writeFile(join(root, file), content, { mode: 0o600 });
  }
  for (const key of Object.keys(environment)) {
    if (databaseKey(key)) environment[key] = overrides[key] || url;
    if (/ASAAS|MERCADO.*(?:TOKEN|SECRET)|RESEND_API_KEY/.test(key)) environment[key] = '';
  }
  Object.assign(environment, overrides, { NODE_ENV: 'development' });
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    const [identity] = await client.$queryRawUnsafe('SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port');
    if (identity.database !== database || identity.host !== '127.0.0.1' || identity.port !== cfg.port) throw new LocalError('Identidade do PostgreSQL não é a esperada. Migração bloqueada.');
    console.log(`Destino comprovado antes da migração: PostgreSQL local, 127.0.0.1:${cfg.port}, banco ${database}.`);
    console.log('Nenhuma conexão Neon será utilizada.');
    try { execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: environment, stdio: 'pipe', windowsHide: true, timeout: 60_000 }); }
    catch { throw new LocalError('A migração local falhou. Nenhum comando remoto foi executado; não foi realizado reset.'); }
    for (const [code, name, durationDays, dailyRouteLimit, isUnlimited] of [['FREE', 'Teste gratuito', null, 0, false], ['BASIC', 'Plano Básico (teste)', 30, 1, false], ['PRO', 'Plano Pro (teste)', 30, 2, false]]) {
      await client.subscriptionPlan.upsert({ where: { code }, update: {}, create: { code, name, durationDays, dailyRouteLimit, isUnlimited, isActive: true } });
    }
    const migrations = await client.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    console.log(`Banco local pronto: ${migrations[0].count} migrações concluídas e planos fictícios disponíveis. Contas e créditos existentes preservados.`);
  } finally { await client.$disconnect(); }
  if (mode === 'setup') { await stop(); console.log('Preparação concluída. Execute npm run dev para iniciar.'); }
  else {
    mailbox = await startMailbox(folder, cfg.secrets.ROTTA_LOCAL_MAIL_TOKEN, () => { void stop(); });
    console.log('Caixa de e-mails simulados: http://127.0.0.1:8025');
    console.log('Rotta: http://localhost:3000 — banco local, CNPJ simulado e pagamentos reais bloqueados.');
    child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3000'], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await stop(); process.exit(0); });
    const status = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', code => resolveExit(code ?? 0)); });
    await stop(); process.exitCode = status;
  }
} catch (error) {
  console.error(error instanceof LocalError ? error.message : 'Não foi possível preparar o ambiente local. Nenhum segredo foi registrado.');
  await stop(); process.exitCode = 1;
}
