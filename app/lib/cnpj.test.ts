import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCnpjVerificationOutcome,
  type CnpjProviderResult,
  type NormalizedCnpjCompany,
} from "@/app/lib/cnpj";

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

test("BrasilAPI NOT_FOUND + ReceitaWS FOUND => VERIFIED", () => {
  const brasilApi: CnpjProviderResult = { kind: "NOT_FOUND" };
  const receitaWs: CnpjProviderResult = { kind: "FOUND", company: makeCompany("RECEITAWS", "ATIVA") };

  const outcome = resolveCnpjVerificationOutcome("12345678000195", brasilApi, receitaWs);

  assert.equal(outcome.kind, "VERIFIED");
  assert.equal(outcome.company.provider, "RECEITAWS");
});

test("BrasilAPI FOUND INATIVA => bloqueia", () => {
  const brasilApi: CnpjProviderResult = { kind: "FOUND", company: makeCompany("BRASILAPI", "BAIXADA") };
  const receitaWs: CnpjProviderResult = { kind: "UNAVAILABLE" };

  const outcome = resolveCnpjVerificationOutcome("12345678000195", brasilApi, receitaWs);

  assert.equal(outcome.kind, "INACTIVE");
  assert.equal(outcome.provider, "BRASILAPI");
});

test("BrasilAPI NOT_FOUND + ReceitaWS NOT_FOUND => bloqueia", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "NOT_FOUND" },
    { kind: "NOT_FOUND" }
  );

  assert.equal(outcome.kind, "NOT_FOUND");
});

test("BrasilAPI NOT_FOUND + ReceitaWS UNAVAILABLE => PENDING", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "NOT_FOUND" },
    { kind: "UNAVAILABLE" }
  );

  assert.equal(outcome.kind, "PENDING_VERIFICATION");
  assert.equal(outcome.reason, "API_UNAVAILABLE");
});

test("BrasilAPI UNAVAILABLE + ReceitaWS NOT_FOUND => PENDING", () => {
  const outcome = resolveCnpjVerificationOutcome(
    "12345678000195",
    { kind: "UNAVAILABLE" },
    { kind: "NOT_FOUND" }
  );

  assert.equal(outcome.kind, "PENDING_VERIFICATION");
  assert.equal(outcome.reason, "API_UNAVAILABLE");
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
