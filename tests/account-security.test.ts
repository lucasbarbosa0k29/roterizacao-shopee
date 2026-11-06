import test from "node:test";
import assert from "node:assert/strict";
import { canUseAccount, checkoutCustomerData, documentFingerprint, equalDigest, generateCode, isValidCpf, normalizeCpf, passwordPolicyError, sessionIsCurrent } from "../app/lib/account-security";
import { cleanCnpj, isValidCnpj } from "../app/lib/cnpj";
import { authBody } from "../app/lib/auth-http";

test("CPF accepts valid check digits, normalizes punctuation and rejects invalid sequences", () => {
  assert.equal(normalizeCpf("529.982.247-25"), "52998224725");
  for (const valid of ["529.982.247-25", "11144477735"]) assert.equal(isValidCpf(valid), true);
  for (const invalid of ["", "123", "52998224724", "12345678900", ...Array.from({ length: 10 }, (_, n) => String(n).repeat(11))]) assert.equal(isValidCpf(invalid), false);
});
test("CNPJ math remains unchanged", () => {
  assert.equal(isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCnpj("00000000000000"), false);
});

test("alphanumeric CNPJ uses Receita Federal check digits without dropping letters", () => {
  assert.equal(cleanCnpj('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.equal(isValidCnpj('12.ABC.345/01DE-35'), true);
  for (const invalid of ['12ABC34501DE34', '12ABC34501DE3A', '12ÁBC34501DE35', '12ABC34501DE35!']) assert.equal(isValidCnpj(invalid), false);
});
test("password policy rejects seven characters and accepts eight without composition rules", () => {
  assert.match(passwordPolicyError("1234567")!, /8 caracteres/);
  for (const password of ["abcdefgh", "12345678", "!@#$%^&*", "aB3!xy_?"]) assert.equal(passwordPolicyError(password), null);
  assert.ok(passwordPolicyError(" ".repeat(8)));
  assert.equal(passwordPolicyError("uma frase longa e exclusiva"), null);
});
test("password policy preserves the maximum of 72 UTF-8 bytes", () => {
  assert.equal(passwordPolicyError("a".repeat(72)), null);
  assert.match(passwordPolicyError("a".repeat(73))!, /72 bytes/);
  assert.equal(passwordPolicyError("á".repeat(36)), null);
  assert.ok(passwordPolicyError("á".repeat(37)));
});
test("numeric codes contain exactly six digits and digest comparisons fail closed", () => {
  for (let i = 0; i < 100; i++) assert.match(generateCode(), /^\d{6}$/);
  assert.equal(equalDigest("", ""), false);
  assert.equal(equalDigest("a".repeat(64), "a".repeat(64)), true);
  assert.equal(equalDigest("a".repeat(64), "b".repeat(64)), false);
});
test("document fingerprint is stable, keyed, purpose/type separated, not the document", () => {
  process.env.DOCUMENT_HMAC_SECRET = "test-key-".repeat(8);
  const first = documentFingerprint("CPF", "52998224725");
  assert.equal(first, documentFingerprint("CPF", "52998224725"));
  assert.notEqual(first, documentFingerprint("CNPJ", "52998224725"));
  assert.equal(first.includes("52998224725"), false);
  process.env.DOCUMENT_HMAC_SECRET = "other-key-".repeat(8);
  assert.notEqual(first, documentFingerprint("CPF", "52998224725"));
});
test("legacy sessions work until revocation; pending users cannot access routes", () => {
  const legacy = { active: true, emailVerificationRequired: false, emailVerifiedAt: null, sessionVersion: 0 };
  assert.equal(sessionIsCurrent(undefined, legacy), true);
  assert.equal(sessionIsCurrent(undefined, { ...legacy, sessionVersion: 1 }), false);
  assert.equal(sessionIsCurrent(0, { ...legacy, sessionVersion: 1 }), false);
  assert.equal(sessionIsCurrent(1, { ...legacy, sessionVersion: 1 }), true);
  assert.equal(canUseAccount({ ...legacy, emailVerificationRequired: true }), false);
  assert.equal(canUseAccount({ ...legacy, emailVerificationRequired: true, emailVerifiedAt: new Date() }), true);
  assert.equal(canUseAccount({ ...legacy, active: false }), false);
});
test("checkout supports CPF, CNPJ and legacy users without document", () => {
  const base = { name: "Teste", email: "test@example.test", cpf: null, company: null };
  assert.equal(checkoutCustomerData({ ...base, cpf: "52998224725" })?.cpfCnpj, "52998224725");
  assert.equal(checkoutCustomerData({ ...base, company: { cnpj: "11222333000181" } })?.cpfCnpj, "11222333000181");
  assert.equal(checkoutCustomerData({ ...base, company: { cnpj: "12.abc.345/01de-35" } })?.cpfCnpj, "12ABC34501DE35");
  assert.equal(checkoutCustomerData(base), undefined);
});
test("custom account endpoints reject cross-origin and malformed requests", async () => {
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  await assert.rejects(authBody(new Request("http://localhost:3000/api/account/auth/change-password", { method: "POST", headers: { origin: "https://attacker.example" }, body: "{}" })), /não permitida/);
  await assert.rejects(authBody(new Request("http://localhost:3000/api/account/auth/change-password", { method: "POST", body: "[]" })), /inválida/);
});
