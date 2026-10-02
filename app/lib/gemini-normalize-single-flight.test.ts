import test from "node:test";
import assert from "node:assert/strict";

const {
  buildGeminiNormalizeRequestKey,
  getOrCreateJobSingleFlight,
} = await import(new URL("./gemini-normalize-single-flight.ts", import.meta.url).href);

type Result = { geminiOk: boolean; value: string };

const baseInput = {
  model: "gemini-2.5-flash",
  address: "Rua X, 100",
  bairro: "Setor Central",
  city: "Goiânia",
  cep: "74000-000",
};

function success(value = "ok"): Result {
  return { geminiOk: true, value };
}

function run(
  cache: Map<string, Promise<Result>>,
  input: typeof baseInput,
  create: () => Promise<Result>,
) {
  return getOrCreateJobSingleFlight({
    cache,
    key: buildGeminiNormalizeRequestKey(input),
    create,
    isReusable: (result: Result) => result.geminiOk,
  });
}

test("uma linha executa uma chamada Gemini", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;

  const result = await run(cache, baseInput, async () => {
    calls += 1;
    return success();
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, success());
});

test("duas linhas com os mesmos inputs compartilham uma chamada", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;
  const create = async () => {
    calls += 1;
    return success();
  };

  const results = await Promise.all([
    run(cache, baseInput, create),
    run(cache, { ...baseInput }, create),
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(results, [success(), success()]);
});

test("cinco workers simultâneos compartilham a Promise em andamento", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;
  let resolveRequest: ((result: Result) => void) | undefined;
  const pendingRequest = new Promise<Result>((resolve) => {
    resolveRequest = resolve;
  });
  const create = () => {
    calls += 1;
    return pendingRequest;
  };

  const workers = Array.from({ length: 5 }, () => run(cache, baseInput, create));

  assert.equal(calls, 1);
  assert.equal(cache.size, 1);
  resolveRequest?.(success("shared"));
  const results = await Promise.all(workers);
  assert.deepEqual(results, Array.from({ length: 5 }, () => success("shared")));
});

test("números diferentes no endereço geram chaves e chamadas diferentes", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;
  const create = async () => success(String(++calls));

  await Promise.all([
    run(cache, baseInput, create),
    run(cache, { ...baseInput, address: "Rua X, 200" }, create),
  ]);

  assert.equal(calls, 2);
});

test("bairros diferentes geram chaves e chamadas diferentes", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;
  const create = async () => success(String(++calls));

  await Promise.all([
    run(cache, baseInput, create),
    run(cache, { ...baseInput, bairro: "Setor Oeste" }, create),
  ]);

  assert.equal(calls, 2);
});

test("cidades diferentes geram chaves e chamadas diferentes", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;
  const create = async () => success(String(++calls));

  await Promise.all([
    run(cache, baseInput, create),
    run(cache, { ...baseInput, city: "Aparecida de Goiânia" }, create),
  ]);

  assert.equal(calls, 2);
});

test("CEPs diferentes geram chaves e chamadas diferentes", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;
  const create = async () => success(String(++calls));

  await Promise.all([
    run(cache, baseInput, create),
    run(cache, { ...baseInput, cep: "74900-000" }, create),
  ]);

  assert.equal(calls, 2);
});

test("complemento e referência fora do prompt não alteram a chave", () => {
  const withContext = {
    ...baseInput,
    complemento: "Fundos",
    referencia: "Próximo à praça",
  };

  assert.equal(
    buildGeminiNormalizeRequestKey(baseInput),
    buildGeminiNormalizeRequestKey(withContext),
  );
});

test("jobs diferentes não compartilham cache", async () => {
  const firstJobCache = new Map<string, Promise<Result>>();
  const secondJobCache = new Map<string, Promise<Result>>();
  let calls = 0;
  const create = async () => success(String(++calls));

  await Promise.all([
    run(firstJobCache, baseInput, create),
    run(secondJobCache, baseInput, create),
  ]);

  assert.equal(calls, 2);
});

test("falha de rede é compartilhada em andamento e removida do cache", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;
  const networkError = new Error("network failure");
  const failingCreate = async () => {
    calls += 1;
    throw networkError;
  };

  const simultaneous = await Promise.allSettled([
    run(cache, baseInput, failingCreate),
    run(cache, baseInput, failingCreate),
  ]);

  assert.equal(calls, 1);
  assert.equal(simultaneous[0].status, "rejected");
  assert.equal(simultaneous[1].status, "rejected");
  assert.equal(cache.size, 0);

  const recovered = await run(cache, baseInput, async () => {
    calls += 1;
    return success("recovered");
  });
  assert.equal(calls, 2);
  assert.deepEqual(recovered, success("recovered"));
});

test("fallback HTTP inválido é compartilhado em andamento mas não fica no cache", async () => {
  const cache = new Map<string, Promise<Result>>();
  let calls = 0;
  const invalidResponse = async () => {
    calls += 1;
    return { geminiOk: false, value: "fallback" };
  };

  const simultaneous = await Promise.all([
    run(cache, baseInput, invalidResponse),
    run(cache, baseInput, invalidResponse),
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(simultaneous, [
    { geminiOk: false, value: "fallback" },
    { geminiOk: false, value: "fallback" },
  ]);
  assert.equal(cache.size, 0);

  await run(cache, baseInput, invalidResponse);
  assert.equal(calls, 2);
});
