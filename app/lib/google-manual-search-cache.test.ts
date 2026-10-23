import test from "node:test";
import assert from "node:assert/strict";

const cacheModule: typeof import("./google-manual-search-cache") = await import(
  new URL("./google-manual-search-cache.ts", import.meta.url).href
);
const { SingleFlightCache, buildGoogleManualSearchCacheKey } = cacheModule;

const baseRequest = {
  provider: "new" as const,
  query: "Rua das Flores, 100",
  city: "Goiânia",
  district: "Setor Central",
  center: { lat: -16.6869, lng: -49.2643 },
  radius: 12000,
  language: "pt-BR",
  region: "BR",
};

test("single-flight compartilha consultas idênticas simultâneas", async () => {
  const cache = new SingleFlightCache<string[]>();
  let calls = 0;
  let resolveRequest: ((value: string[]) => void) | undefined;
  const pending = new Promise<string[]>((resolve) => {
    resolveRequest = resolve;
  });

  const factory = async () => {
    calls += 1;
    return pending;
  };
  const requests = [
    cache.getOrCreate("same", factory),
    cache.getOrCreate("same", factory),
    cache.getOrCreate("same", factory),
  ];

  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(cache.size(), 1);
  resolveRequest?.(["result"]);
  assert.deepEqual(await Promise.all(requests), [["result"], ["result"], ["result"]]);
  assert.equal(cache.size(), 0);
});

test("resultado não fica armazenado depois que a consulta termina", async () => {
  const cache = new SingleFlightCache<string>();
  let calls = 0;
  const factory = async () => `result-${++calls}`;

  assert.equal(await cache.getOrCreate("key", factory), "result-1");
  assert.equal(await cache.getOrCreate("key", factory), "result-2");
  assert.equal(calls, 2);
});

test("limita o número de consultas simultâneas retidas", async () => {
  const cache = new SingleFlightCache<string>(2);
  const pending = new Promise<string>(() => undefined);

  cache.getOrCreate("one", async () => pending);
  cache.getOrCreate("two", async () => pending);
  cache.getOrCreate("three", async () => pending);
  assert.equal(cache.size(), 2);
});

test("a chave separa região, cidade, bairro, coordenadas, raio, idioma e provedor", () => {
  const baseKey = buildGoogleManualSearchCacheKey(baseRequest);
  const variants = [
    { region: "US" },
    { city: "Aparecida de Goiânia" },
    { district: "Setor Oeste" },
    { center: { lat: -16.687, lng: -49.2643 } },
    { radius: 5000 },
    { language: "en-US" },
    { provider: "legacy" as const },
  ];

  for (const variant of variants) {
    assert.notEqual(
      buildGoogleManualSearchCacheKey({ ...baseRequest, ...variant }),
      baseKey,
    );
  }
});

test("falha não fica armazenada e permite nova tentativa", async () => {
  const cache = new SingleFlightCache<string>();
  let calls = 0;
  await assert.rejects(
    cache.getOrCreate("error", async () => {
      calls += 1;
      throw new Error("network");
    }),
  );
  assert.equal(cache.size(), 0);

  assert.equal(
    await cache.getOrCreate("error", async () => `recovered-${++calls}`),
    "recovered-2",
  );
});
