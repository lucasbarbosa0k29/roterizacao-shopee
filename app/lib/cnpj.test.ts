import test from "node:test";
import assert from "node:assert/strict";
import type { CnpjProviderResult, NormalizedCnpjCompany } from "./cnpj";

const { resolveCnpjVerificationOutcome } = await import(new URL("./cnpj.ts", import.meta.url).href);

function makeCompany(provider: "BRASILAPI" | "RECEITAWS", situacaoCadastral: string): NormalizedCnpjCompany {
  return {
    cnpj: "12345678000195",
    razaoSocial: "Empresa Teste LTDA",
    nomeFantasia: null,
    situacaoCadastral,
    cidade: "Goiânia",
    uf: "GO",
    provider,
    cnpjVerificationStatus: "VERIFIED",
    cnpjVerificationReason: null,
    cnpjVerifiedAt: new Date("2026-07-09T00:00:00.000Z"),
    rawData: { provider, situacaoCadastral },
  };
}

test("BrasilAPI FOUND ATIVA => VERIFIED", () => {
  const brasilApi: CnpjProviderResult = { kind: "FOUND", company: makeCompany("BRASILAPI", "ATIVA") };
  const receitaWs: CnpjProviderResult = { kind: "UNAVAILABLE" };

  const outcome = resolveCnpjVerificationOutcome("12345678000195", brasilApi, receitaWs);

  assert.equal(outcome.kind, "VERIFIED");
  assert.equal(outcome.company.provider, "BRASILAPI");
});

test("BrasilAPI FOUND INATIVA => bloqueia", () => {
  const brasilApi: CnpjProviderResult = { kind: "FOUND", company: makeCompany("BRASILAPI", "BAIXADA") };
  const receitaWs: CnpjProviderResult = { kind: "UNAVAILABLE" };

  const outcome = resolveCnpjVerificationOutcome("12345678000195", brasilApi, receitaWs);

  assert.equal(outcome.kind, "INACTIVE");
  assert.equal(outcome.provider, "BRASILAPI");
});

test("FOUND ATIVA + NOT_FOUND => VERIFIED", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "FOUND", company: makeCompany("BRASILAPI", "ATIVA") },
    { kind: "NOT_FOUND" }
  );

  assert.equal(outcome.kind, "VERIFIED");
  assert.equal(outcome.company.provider, "BRASILAPI");
});

test("NOT_FOUND + FOUND ATIVA => VERIFIED", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "NOT_FOUND" },
    { kind: "FOUND", company: makeCompany("RECEITAWS", "ATIVA") }
  );

  assert.equal(outcome.kind, "VERIFIED");
  assert.equal(outcome.company.provider, "RECEITAWS");
});

test("BrasilAPI NOT_FOUND + ReceitaWS NOT_FOUND => bloqueia", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "NOT_FOUND" },
    { kind: "NOT_FOUND" }
  );

  assert.equal(outcome.kind, "NOT_FOUND");
});

test("BrasilAPI NOT_FOUND + ReceitaWS UNAVAILABLE => bloqueia", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "NOT_FOUND" },
    { kind: "UNAVAILABLE" }
  );

  assert.equal(outcome.kind, "NOT_FOUND");
});

test("BrasilAPI UNAVAILABLE + ReceitaWS NOT_FOUND => bloqueia", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "UNAVAILABLE" },
    { kind: "NOT_FOUND" }
  );

  assert.equal(outcome.kind, "NOT_FOUND");
});

test("BrasilAPI UNAVAILABLE + ReceitaWS UNAVAILABLE => PENDING", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "UNAVAILABLE" },
    { kind: "UNAVAILABLE" }
  );

  assert.equal(outcome.kind, "PENDING_VERIFICATION");
  assert.equal(outcome.reason, "API_UNAVAILABLE");
});

test("BrasilAPI RATE_LIMIT + ReceitaWS UNAVAILABLE => PENDING", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "RATE_LIMIT" },
    { kind: "UNAVAILABLE" }
  );

  assert.equal(outcome.kind, "PENDING_VERIFICATION");
  assert.equal(outcome.reason, "RATE_LIMIT");
});

test("RATE_LIMIT + NOT_FOUND => bloqueia", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "RATE_LIMIT" },
    { kind: "NOT_FOUND" }
  );

  assert.equal(outcome.kind, "NOT_FOUND");
});
