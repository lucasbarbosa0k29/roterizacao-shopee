import { resolveMx } from "node:dns/promises";
import { isFakeDomain } from "fakefilter";

export const INVALID_EMAIL_MESSAGE = "Informe um e-mail válido.";
export const DISPOSABLE_EMAIL_MESSAGE = "E-mails temporários não são permitidos.";
export const EMAIL_DOMAIN_CANNOT_RECEIVE_MESSAGE = "Este domínio de e-mail não pode receber mensagens.";

const EMAIL_MAX_LENGTH = 254;
const EMAIL_LOCAL_PART_MAX_LENGTH = 64;
const DNS_TIMEOUT_MS = 3000;

const ADDITIONAL_DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "anonaddy.com",
  "burnermail.io",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "sharklasers.com",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmail.org",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
]);

export type EmailValidationResult =
  | { ok: true; email: string; domain: string }
  | { ok: false; message: string };

type MxLookupResult = "HAS_MX" | "NO_MX" | "UNKNOWN";

export function normalizeEmail(email: string) {
  return String(email ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

function hasValidEmailShape(email: string) {
  if (!email || email.length > EMAIL_MAX_LENGTH) return false;
  if (/[\u0000-\u001F\u007F]/.test(email)) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(email)) return false;
  if (email.includes("..")) return false;

  const parts = email.split("@");
  if (parts.length !== 2) return false;

  const [localPart, domain] = parts;
  if (!localPart || !domain) return false;
  if (localPart.length > EMAIL_LOCAL_PART_MAX_LENGTH) return false;
  if (localPart.startsWith(".") || localPart.endsWith(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.length > 253) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;

  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld)) return false;

  return labels.every((label) => {
    if (!label || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return /^[a-z0-9-]+$/.test(label);
  });
}

function isDisposableEmailDomain(domain: string) {
  const normalizedDomain = domain.trim().toLowerCase();
  if (Boolean(isFakeDomain(normalizedDomain))) return true;
  if (ADDITIONAL_DISPOSABLE_EMAIL_DOMAINS.has(normalizedDomain)) return true;
  if (normalizedDomain.startsWith("tempmail.")) return true;

  const labels = normalizedDomain.split(".");
  for (let index = 1; index < labels.length - 1; index += 1) {
    const parentDomain = labels.slice(index).join(".");
    if (Boolean(isFakeDomain(parentDomain))) return true;
    if (ADDITIONAL_DISPOSABLE_EMAIL_DOMAINS.has(parentDomain)) return true;
  }

  return false;
}

async function lookupMxRecords(domain: string): Promise<MxLookupResult> {
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("DNS_TIMEOUT")), DNS_TIMEOUT_MS);
      }),
    ]);

    return records.some((record) => Number.isFinite(record.priority) && record.exchange.trim().length > 0)
      ? "HAS_MX"
      : "NO_MX";
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ENODATA" || code === "ENOTFOUND") return "NO_MX";

    console.warn("Public signup email MX lookup skipped after resolver failure.", {
      reason: code || "UNKNOWN",
    });
    return "UNKNOWN";
  }
}

export async function validatePublicSignupEmail(input: string): Promise<EmailValidationResult> {
  const email = normalizeEmail(input);
  if (!hasValidEmailShape(email)) {
    return { ok: false, message: INVALID_EMAIL_MESSAGE };
  }

  const domain = email.split("@")[1];
  if (isDisposableEmailDomain(domain)) {
    return { ok: false, message: DISPOSABLE_EMAIL_MESSAGE };
  }

  const mxStatus = await lookupMxRecords(domain);
  if (mxStatus === "NO_MX") {
    return { ok: false, message: EMAIL_DOMAIN_CANNOT_RECEIVE_MESSAGE };
  }

  return { ok: true, email, domain };
}
