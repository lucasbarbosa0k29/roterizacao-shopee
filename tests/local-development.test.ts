import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { localDevelopmentEnabled } from "../app/lib/local-development.js";
import { sendAuthEmail } from "../app/lib/auth-mail";
import { validateCnpjCompany } from "../app/lib/cnpj";
import { validatePublicSignupEmail } from "../app/lib/email-validation";

const keys = ["NODE_ENV", "ROTTA_LOCAL_DEV", "DATABASE_URL", "ROTTA_LOCAL_MAIL_TOKEN", "RESEND_API_KEY"];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => {
  for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  mock.restoreAll();
});
function configureLocal() {
  Object.assign(process.env, { NODE_ENV: "development", ROTTA_LOCAL_DEV: "1", DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/rotta_local_dev", ROTTA_LOCAL_MAIL_TOKEN: "synthetic-mail-test-token" });
}
test("local simulations require explicit opt-in, development mode and the exclusive loopback database", () => {
  delete process.env.ROTTA_LOCAL_DEV;
  assert.equal(localDevelopmentEnabled(), false);
  configureLocal();
  assert.equal(localDevelopmentEnabled(), true);
  for (const url of ["postgresql://synthetic@remote.example.test/rotta_local_dev", "postgresql://synthetic@127.0.0.1/neondb", "invalid"]) {
    process.env.DATABASE_URL = url;
    assert.throws(localDevelopmentEnabled, /modo local/);
  }
  configureLocal();
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.throws(localDevelopmentEnabled, /modo local/);
});
test("local auth email is captured on loopback even without a Resend key", async () => {
  configureLocal(); delete process.env.RESEND_API_KEY;
  const capture = mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://127.0.0.1:8025/capture");
    assert.equal(JSON.parse(String(options.body)).purpose, "VERIFY_EMAIL");
    return Response.json({});
  });
  assert.deepEqual(await sendAuthEmail("fixture@example.test", "000123", "VERIFY_EMAIL", "synthetic-id"), { ok: true });
  assert.equal(capture.mock.callCount(), 1);
});
test("capture failure never falls back to a real email provider", async () => {
  configureLocal();
  const capture = mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(url, "http://127.0.0.1:8025/capture");
    throw new Error("Synthetic local failure");
  });
  assert.deepEqual(await sendAuthEmail("fixture@example.test", "000123", "RESET_PASSWORD", "synthetic-id"), { ok: false, retryAfter: 60 });
  assert.equal(capture.mock.callCount(), 1);
});
test("local .test email and CNPJ fixtures need no real registry or email service", async () => {
  configureLocal();
  const network = mock.method(globalThis, "fetch", async () => { throw new Error("External calls forbidden"); });
  assert.equal((await validatePublicSignupEmail("fixture@exemplo.test")).ok, true);
  const company = await validateCnpjCompany("12.ABC.345/01DE-35");
  assert.equal(company.kind, "PENDING_VERIFICATION");
  assert.equal(network.mock.callCount(), 0);
});
