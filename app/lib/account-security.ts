import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
export { normalizeCpf, isValidCpf } from "./cpf";
export { passwordPolicyError } from "./password-policy.js";

export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_INTERVAL_MS = 60_000;
export const MAX_CODE_ATTEMPTS = 5;

export function requiredSecret(name: string) {
  const secret = process.env[name];
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error(`Configure ${name} com pelo menos 32 bytes.`);
  return secret;
}

export function secureDigest(secretName: string, ...parts: string[]) {
  return createHmac("sha256", requiredSecret(secretName)).update(JSON.stringify(parts)).digest("hex");
}

export function documentFingerprint(type: "CPF" | "CNPJ", document: string) {
  return secureDigest("DOCUMENT_HMAC_SECRET", "signup-benefit-v1", type, document);
}

export function generateCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function equalDigest(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

export function canUseAccount(user: { active: boolean; emailVerificationRequired: boolean; emailVerifiedAt: Date | null }) {
  return user.active && (!user.emailVerificationRequired || user.emailVerifiedAt !== null);
}

export function sessionIsCurrent(version: unknown, user: { sessionVersion: number; active: boolean; emailVerificationRequired: boolean; emailVerifiedAt: Date | null }) {
  // JWTs issued before this migration had no version and correspond to version zero.
  return canUseAccount(user) && (version === undefined ? 0 : version) === user.sessionVersion;
}

export function checkoutCustomerData(user: { name: string | null; email: string; cpf: string | null; company: { cnpj: string } | null }) {
  const document = user.cpf ?? user.company?.cnpj;
  return document ? { name: user.name || user.email, email: user.email, cpfCnpj: document.replace(/[.\/\s-]/g, "").toUpperCase() } : undefined;
}
