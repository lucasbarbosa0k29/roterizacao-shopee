import assert from "node:assert/strict";
import { test } from "node:test";
import { createInfinitePayLink, InfinitePayError } from "../app/lib/infinitepay";

const key = "synthetic-test-key";
const payload = {
  handle: "synthetic-merchant",
  order_nsu: "rotta_synthetic_order",
  items: [{ quantity: 10, price: 199, description: "Rota avulsa" }],
  redirect_url: "https://rotta.example.test/api/payments/infinitepay/return",
  webhook_url: "https://rotta.example.test/api/webhooks/infinitepay",
  options: {
    single_payment: true,
    valid_until: new Date(Date.now() + 60 * 60_000).toISOString(),
    require_delivery_address: false,
    payment_methods_enabled: ["credit_card", "pix"],
  },
};

for (const host of ["checkout.infinitepay.io", "checkout.infinitepay.com.br", "buy.infinitepay.io"]) {
  test(`aceita o host exato ${host} mesmo sem slug na resposta de criação`, async (t) => {
    const url = `https://${host}/synthetic-checkout/path?source=contract-test`;
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
      assert.equal(input, "https://api.checkout.infinitepay.io/links");
      assert.equal(options?.method, "POST");
      assert.equal(options?.redirect, "error");
      assert.equal(new Headers(options?.headers).get("X-Api-Key"), key);
      assert.equal(new Headers(options?.headers).get("Content-Type"), "application/json");
      assert.deepEqual(JSON.parse(String(options?.body)), payload);
      return Response.json({ url }, { status: 201 });
    });
    assert.deepEqual(await createInfinitePayLink(key, payload), { url, slug: null });
  });
}

test("preserva o slug válido se o provedor o devolver", async (t) => {
  const url = "https://checkout.infinitepay.io/synthetic-checkout";
  t.mock.method(globalThis, "fetch", async () => Response.json({ url, slug: "synthetic_invoice" }));
  assert.deepEqual(await createInfinitePayLink(key, payload), { url, slug: "synthetic_invoice" });
});

for (const [description, response] of [
  ["campo url ausente", { success: true }],
  ["campo url com outro tipo", { url: 123 }],
  ["URL relativa", { url: "/synthetic-checkout" }],
  ["HTTP sem TLS", { url: "http://checkout.infinitepay.io/synthetic-checkout" }],
  ["porta alternativa", { url: "https://checkout.infinitepay.io:8443/synthetic-checkout" }],
  ["credenciais na URL", { url: "https://synthetic:synthetic@checkout.infinitepay.io/synthetic-checkout" }],
  ["host que imita o domínio", { url: "https://checkout.infinitepay.io.example.test/synthetic-checkout" }],
  ["subdomínio não aprovado", { url: "https://other.infinitepay.io/synthetic-checkout" }],
  ["URL aninhada em campo não documentado", { data: { url: "https://checkout.infinitepay.io/synthetic-checkout" } }],
] as const) {
  test(`gera INVALID_LINK localmente com HTTP 200 e ${description}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json(response));
    await assert.rejects(createInfinitePayLink(key, payload), (error: unknown) =>
      error instanceof InfinitePayError && error.message === "INVALID_LINK");
  });
}

test("HTTP 403 continua HTTP_403 mesmo se o corpo contiver o texto INVALID_LINK", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "INVALID_LINK" }, { status: 403 }));
  await assert.rejects(createInfinitePayLink(key, payload), { message: "HTTP_403" });
});

test("HTTP 200 com JSON não objeto gera INVALID_RESPONSE", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(["https://checkout.infinitepay.io/synthetic-checkout"]));
  await assert.rejects(createInfinitePayLink(key, payload), { message: "INVALID_RESPONSE" });
});
