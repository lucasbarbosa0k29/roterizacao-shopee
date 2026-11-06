// Creates a fresh, loopback-only PostgreSQL cluster. Never consumes DATABASE_URL.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const toolsRoot = process.env.ROTTA_TEST_TOOLS || join(tmpdir(), 'rotta-security-pg17-tools');
const { default: EmbeddedPostgres } = await import(pathToFileURL(join(toolsRoot, 'node_modules/embedded-postgres/dist/index.js')).href);
const folder = await mkdtemp(join(tmpdir(), 'rotta-auth-test-'));
const port = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolvePort(port)); });
});
const runId = randomBytes(8).toString('hex');
const database = `rotta_auth_test_${runId}`;
const password = randomBytes(24).toString('hex');
const url = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, TEST_DB_RUN_ID: runId,
  AUTH_CODE_SECRET: randomBytes(32).toString('hex'), DOCUMENT_HMAC_SECRET: randomBytes(32).toString('hex'),
  AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString('hex'), NEXTAUTH_SECRET: randomBytes(32).toString('hex'),
  NEXTAUTH_URL: 'http://localhost:3000', RESEND_API_KEY: 'test-only', RESEND_FROM_EMAIL: 'test@example.test' };
const pg = new EmbeddedPostgres({ databaseDir: join(folder, 'data'), user: 'postgres', password, port,
  persistent: true, initdbFlags: ['--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: error => console.error(error) });
const pgCtl = join(toolsRoot, 'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe');
let started = false;
try {
  console.log('Inicializando PostgreSQL de teste local...');
  await pg.initialise();
  if (process.platform === 'win32') {
    // pg_ctl starts PostgreSQL with a restricted Windows token, even in an elevated terminal.
    execFileSync(pgCtl, ['-D', join(folder, 'data'), '-l', join(folder, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c shared_buffers=32MB`, '-w', 'start'], { windowsHide: true, stdio: 'ignore', timeout: 30_000 });
  } else await pg.start();
  started = true;
  console.log('PostgreSQL isolado iniciado; preparando esquema anterior à migração.');
  const admin = pg.getPgClient('postgres', '127.0.0.1');
  await admin.connect();
  const version = await admin.query('SHOW server_version_num');
  if (Number(version.rows[0].server_version_num) < 170000 || Number(version.rows[0].server_version_num) >= 180000) {
    await admin.end();
    throw new Error('Tests require isolated PostgreSQL 17');
  }
  console.log(`PostgreSQL ${version.rows[0].server_version_num}: loopback-only test cluster.`);
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.query(`CREATE DATABASE "${database}_history"`);
  await admin.end();
  // Exercise the real production migration command only against the fresh local database.
  execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: root, env: { ...env, DATABASE_URL: `${url}_history` }, stdio: 'pipe', timeout: 60_000,
  });
  console.log('PASS: full migration history applied to a second fresh PostgreSQL 17 database.');
  try {
    execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-schema-datasource', join(root, 'prisma/schema.prisma'), '--to-schema-datamodel', join(root, 'prisma/schema.prisma'), '--exit-code', '--script'], {
      cwd: root, env: { ...env, DATABASE_URL: `${url}_history` }, stdio: 'pipe', timeout: 60_000,
    });
  } catch (error) {
    if (error.status === 2) console.error(String(error.stdout));
    throw new Error('Isolated migration history/schema comparison failed');
  }
  console.log('PASS: full migration history matches the current Prisma schema (no drift).');
  // Pin the pre-feature schema so this migration test also works after committing the feature.
  const oldSchema = execFileSync('git', ['show', '4c8e71caf86be9a927f508d2e0081caba077cfdc:prisma/schema.prisma'], { cwd: root, encoding: 'utf8' });
  const schemaPath = join(folder, 'legacy.prisma');
  await writeFile(schemaPath, oldSchema);
  const baselineSql = execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const client = pg.getPgClient(database, '127.0.0.1');
  await client.connect();
  // Some embedded-postgres versions expect the database in client options; verify before writing.
  const connected = await client.query('SELECT current_database() AS name');
  if (connected.rows[0].name !== database) throw new Error('Isolated database selection failed');
  await client.query(baselineSql);
  const bcrypt = (await import('bcrypt')).default;
  const legacyHash = await bcrypt.hash('legacy123456', 10);
  await client.query(`INSERT INTO "Company" (id, cnpj, "razaoSocial", "situacaoCadastral", "updatedAt") VALUES ('legacy-company', '11222333000181', 'Legacy fixture', 'ATIVA', NOW());
    INSERT INTO "SubscriptionPlan" (id, code, name, "durationDays", "dailyRouteLimit", "updatedAt") VALUES ('legacy-plan','BASIC','Basic',30,1,NOW());`);
  await client.query(`INSERT INTO "User" (id,email,password,"companyId","updatedAt") VALUES ('legacy-user','legacy@example.test',$1,'legacy-company',NOW())`, [legacyHash]);
  await client.query(`INSERT INTO "RouteCredit" (id,"userId",delta,reason) VALUES ('legacy-credit','legacy-user',7,'ADJUSTMENT');
    INSERT INTO "UserSubscription" (id,"userId","planId",source,"startsAt","expiresAt","updatedAt") VALUES ('legacy-sub','legacy-user','legacy-plan','MANUAL_PAYMENT',NOW(),NOW()+interval '30 days',NOW());
    INSERT INTO "PaymentTransaction" (id,"userId",provider,"productType","amountCents",status,"externalReference","updatedAt") VALUES ('legacy-payment','legacy-user','ASAAS','BASIC_PLAN',3999,'FULFILLED','legacy-payment-reference',NOW());`);
  await client.query(`INSERT INTO "ImportJob" (id,"userId",status,"resultJson","workspaceJson","updatedAt") VALUES ('legacy-job','legacy-user','DONE','{"stops":[]}','{"saved":true}',NOW());
    INSERT INTO "RouteUsage" (id,"userId","importJobId","subscriptionId",source,"usageDayKey") VALUES ('legacy-route','legacy-user','legacy-job','legacy-sub','SUBSCRIPTION_DAILY','2026-11-04');`);
  const legacyData = `SELECT
    (SELECT to_jsonb(u) - ARRAY['documentType','cpf','emailVerifiedAt','emailVerificationRequired','sessionVersion'] FROM "User" u WHERE id='legacy-user') AS account,
    (SELECT row_to_json(j) FROM "ImportJob" j WHERE id='legacy-job') AS job,
    (SELECT row_to_json(r) FROM "RouteUsage" r WHERE id='legacy-route') AS route`;
  const legacySnapshot = await client.query(legacyData);
  const snapshot = await client.query(`SELECT (SELECT row_to_json(c) FROM "Company" c WHERE id='legacy-company') AS company,
    (SELECT row_to_json(c) FROM "RouteCredit" c WHERE id='legacy-credit') AS credit,
    (SELECT row_to_json(s) FROM "UserSubscription" s WHERE id='legacy-sub') AS subscription,
    (SELECT row_to_json(p) FROM "PaymentTransaction" p WHERE id='legacy-payment') AS payment`);
  const migration = await readFile(join(root, 'prisma/migrations/20261023120000_account_security/migration.sql'), 'utf8');
  assert.match(migration, /BEGIN;/);
  await assert.rejects(client.query(migration.replace(/COMMIT;\s*$/, 'SELECT 1 / 0;\nCOMMIT;')), /division by zero/);
  await client.query('ROLLBACK');
  const rolledBack = await client.query(`SELECT to_regtype('"DocumentType"') AS document_type, to_regclass('"AuthChallenge"') AS challenge,
    (SELECT count(*) FROM information_schema.columns WHERE table_name='User' AND column_name='sessionVersion') AS added_columns,
    (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='RouteCreditReason' AND e.enumlabel='PROMOTIONAL') AS added_enum`);
  assert.deepEqual(rolledBack.rows[0], { document_type: null, challenge: null, added_columns: '0', added_enum: '0' });
  console.log('PASS: induced failure rolls back all DDL, enum changes and columns.');
  const migrationStarted = performance.now();
  await client.query(migration);
  console.log(`PASS: feature migration completed locally in ${Math.round(performance.now() - migrationStarted)} ms (synthetic data, no production timing guarantee).`);
  const after = await client.query(`SELECT (SELECT row_to_json(c) FROM "Company" c WHERE id='legacy-company') AS company,
    (SELECT row_to_json(c) FROM "RouteCredit" c WHERE id='legacy-credit') AS credit,
    (SELECT row_to_json(s) FROM "UserSubscription" s WHERE id='legacy-sub') AS subscription,
    (SELECT row_to_json(p) FROM "PaymentTransaction" p WHERE id='legacy-payment') AS payment`);
  if (JSON.stringify(snapshot.rows) !== JSON.stringify(after.rows)) throw new Error('Migration changed legacy data');
  assert.deepEqual((await client.query(legacyData)).rows, legacySnapshot.rows);
  console.log('PASS: additive migration preserved legacy company, credits, subscription and payment.');
  await client.end();
  const status = await new Promise((resolveStatus, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', 'tests/account-security.integration.test.ts'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => resolveStatus(code ?? 1));
  });
  process.exitCode = status;
  if (status === 0 && process.env.ROTTA_AUTH_UI_TEST === '1') {
    process.exitCode = await new Promise((resolveStatus, reject) => {
      const child = spawn(process.execPath, ['scripts/account-security-ui.mjs'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
      child.on('error', reject); child.on('exit', code => resolveStatus(code ?? 1));
    });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (started && process.platform === 'win32') execFileSync(pgCtl, ['-D', join(folder, 'data'), '-m', 'fast', '-w', 'stop'], { windowsHide: true, stdio: 'pipe' });
  else if (started) await pg.stop();
  console.log(`PostgreSQL local encerrado. Artefatos de teste preservados em ${folder}`);
}
// Preserve failures even when embedded-postgres's beforeExit hook invokes process.exit.
process.exit(process.exitCode ?? 0);
