// Fresh local database only. Never uses the application's DATABASE_URL.
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const root = resolve(import.meta.dirname, '..');
const folder = await mkdtemp(join(tmpdir(), 'rotta-asaas-test-'));
const port = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolvePort(port));
  });
});
const runId = randomBytes(8).toString('hex');
const database = `rotta_asaas_test_${runId}`;
const password = randomBytes(24).toString('hex');
const url = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
const env = {
  ...process.env, NODE_ENV: 'test', ROTTA_LOCAL_DEV: '0',
  DATABASE_URL: url, TEST_DATABASE_URL: url, TEST_DB_RUN_ID: runId,
  ASAAS_WEBHOOK_SECRET: 'synthetic-webhook-secret-for-offline-tests',
  ASAAS_ACCESS_TOKEN: 'synthetic-unused', MERCADOPAGO_ACCESS_TOKEN: 'synthetic-unused',
};
const pg = new EmbeddedPostgres({
  databaseDir: join(folder, 'data'), user: 'postgres', password, port,
  persistent: true, initdbFlags: ['--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}, onError: () => console.error('Isolated test PostgreSQL error'),
});
const pgCtl = join(root, 'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe');
let started = false;
let stage = 'initialise local cluster';
try {
  console.log('Initializing isolated Asaas test PostgreSQL...');
  await pg.initialise();
  stage = 'start local cluster';
  if (process.platform === 'win32') {
    // pg_ctl uses a restricted Windows token, including in elevated terminals.
    execFileSync(pgCtl, ['-D', join(folder, 'data'), '-l', join(folder, 'postgres.log'),
      '-o', `-h 127.0.0.1 -p ${port} -c shared_buffers=32MB`, '-w', 'start'],
    { windowsHide: true, stdio: 'ignore', timeout: 30_000 });
  } else await pg.start();
  started = true;
  stage = 'create isolated database';
  const admin = pg.getPgClient('postgres', '127.0.0.1');
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally { await admin.end(); }
  stage = 'prepare isolated schema';
  execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--skip-generate'], { cwd: root, env, stdio: 'pipe', timeout: 60_000 });
  console.log('Asaas tests: fresh loopback-only PostgreSQL; synthetic webhooks; providers blocked.');
  process.exitCode = await new Promise((resolveStatus, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--test',
      'tests/asaas-webhook.integration.test.ts'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => resolveStatus(code ?? 1));
  });
} catch (error) {
  const diagnostic = String(error.message).replaceAll(url, '[isolated database]').replaceAll(password, '[test password]');
  console.error(`Isolated Asaas test runner failed at ${stage}: ${diagnostic}`);
  process.exitCode = 1;
} finally {
  if (process.platform === 'win32' && (started || existsSync(join(folder, 'data', 'postmaster.pid')))) {
    execFileSync(pgCtl, ['-D', join(folder, 'data'), '-m', 'fast', '-w', 'stop'],
      { windowsHide: true, stdio: 'pipe', timeout: 30_000 });
  } else if (started) await pg.stop();
  console.log(`Local test PostgreSQL stopped. Test artifacts: ${folder}`);
}
// embedded-postgres can otherwise replace the test failure status in its exit hook.
process.exit(process.exitCode ?? 0);
