import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { sendAuthEmail } from "../app/lib/auth-mail";
import { readSessionHint, removeSessionHint, writeSessionHint } from "../app/lib/browser-session";

const originalKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.RESEND_FROM_EMAIL;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  mock.restoreAll();
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
  if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalFrom;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function configureSyntheticMail() {
  process.env.RESEND_API_KEY = "synthetic-key-no-real-delivery";
  process.env.RESEND_FROM_EMAIL = "Rotta <naoresponda@usarotta.com.br>";
}

test("mail fails closed without required configuration and never calls the provider", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => { throw new Error("Network forbidden"); });
  configureSyntheticMail();
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(await sendAuthEmail("fixture@example.test", "000123", "VERIFY_EMAIL", "test"), { ok: false, retryAfter: 60 });
  configureSyntheticMail();
  delete process.env.RESEND_FROM_EMAIL;
  assert.deepEqual(await sendAuthEmail("fixture@example.test", "000123", "VERIFY_EMAIL", "test"), { ok: false, retryAfter: 60 });
  assert.equal(fetch.mock.callCount(), 0);
});

test("mail adapter uses configured sender, six-digit code, TTL and idempotency for both purposes", async () => {
  configureSyntheticMail();
  const requests: RequestInit[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.resend.com/emails");
    requests.push(init);
    return Response.json({ id: "synthetic-message" });
  });
  for (const purpose of ["VERIFY_EMAIL", "RESET_PASSWORD"] as const) {
    assert.deepEqual(await sendAuthEmail("fixture@example.test", "000123", purpose, `test-${purpose}`), { ok: true });
    const request = requests.at(-1)!;
    const body = JSON.parse(String(request.body));
    assert.equal(body.from, process.env.RESEND_FROM_EMAIL);
    assert.deepEqual(body.to, ["fixture@example.test"]);
    assert.match(body.text, /000123/);
    assert.match(body.text, /10 minutos/);
    assert.match(body.text, /única vez/);
    assert.equal(new Headers(request.headers).get("Idempotency-Key"), `test-${purpose}`);
    assert.ok(request.signal instanceof AbortSignal);
  }
});

test("Resend rejects credentials, domain, rate and availability failures without logging payloads", async () => {
  configureSyntheticMail();
  const errors = mock.method(console, "error", () => {});
  let status = 401;
  mock.method(globalThis, "fetch", async () => new Response("sensitive provider payload must stay unread", { status, headers: { "Retry-After": "120" } }));
  for (status of [401, 403, 429, 500, 503]) {
    assert.deepEqual(await sendAuthEmail("fixture@example.test", "000123", "VERIFY_EMAIL", "test"), { ok: false, retryAfter: 120 });
  }
  assert.equal(errors.mock.callCount(), 0);
});

test("mail transport timeout is recoverable and never exposes the exception", async () => {
  configureSyntheticMail();
  const errors = mock.method(console, "error", () => {});
  mock.method(globalThis, "fetch", async () => { throw new DOMException("Synthetic transport failure", "TimeoutError"); });
  assert.deepEqual(await sendAuthEmail("fixture@example.test", "000123", "RESET_PASSWORD", "test"), { ok: false, retryAfter: 60 });
  assert.equal(errors.mock.callCount(), 0);
});

test("optional account hints do not throw when sessionStorage is blocked", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get sessionStorage() { throw new DOMException("Blocked", "SecurityError"); } } });
  assert.equal(readSessionHint("rotta-confirm-email"), null);
  assert.doesNotThrow(() => writeSessionHint("rotta-confirm-email", "fixture@example.test"));
  assert.doesNotThrow(() => removeSessionHint("rotta-confirm-email"));
});

test("optional account hints still round-trip with working storage", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } } });
  writeSessionHint("rotta-confirm-email", "fixture@example.test");
  assert.equal(readSessionHint("rotta-confirm-email"), "fixture@example.test");
  removeSessionHint("rotta-confirm-email");
  assert.equal(readSessionHint("rotta-confirm-email"), null);
});
