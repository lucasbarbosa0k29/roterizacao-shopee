import process from "node:process";
import type { PaymentProductType } from "@prisma/client";

const API = "https://api.checkout.infinitepay.io";
const CHECKOUT_HOSTS = new Set(["buy.infinitepay.io", "checkout.infinitepay.com.br"]);

export const INFINITEPAY_PRODUCTS = {
  EXTRA_ROUTE: { price: 199, description: "Rotta - Rota avulsa", maxQuantity: 100 },
  BASIC_PLAN: { price: 3999, description: "Rotta - Plano Basic, 30 dias", maxQuantity: 1 },
  PRO_PLAN: { price: 6999, description: "Rotta - Plano Pro, 30 dias", maxQuantity: 1 },
} satisfies Record<PaymentProductType, { price: number; description: string; maxQuantity: number }>;

export function infinitePayCheckoutEnabled() {
  return process.env.INFINITEPAY_CHECKOUT_ENABLED === "1";
}

export class InfinitePayError extends Error {}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function infinitePayAppOrigin() {
  const url = parseUrl(process.env.INFINITEPAY_APP_URL ?? "");
  if (!url || url.protocol !== "https:" || url.href !== `${url.origin}/`) {
    throw new InfinitePayError("APP_URL_INVALID");
  }
  return url.origin;
}

export function infinitePayCredentials() {
  const key = process.env.INFINITEPAY_API_KEY?.trim();
  const handle = process.env.INFINITEPAY_HANDLE?.trim();
  if (!key || !handle || handle.startsWith("$")) throw new InfinitePayError("CONFIG_MISSING");
  return { key, handle };
}

async function post(path: "/links" | "/payment_check", key: string, payload: unknown) {
  try {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify(payload),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new InfinitePayError(`HTTP_${response.status}`);
    const data: unknown = await response.json();
    if (!isRecord(data)) throw new InfinitePayError("INVALID_RESPONSE");
    return data;
  } catch (error) {
    if (error instanceof InfinitePayError) throw error;
    throw new InfinitePayError("COMMUNICATION_FAILURE");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function paymentReference(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

export async function createInfinitePayLink(key: string, payload: unknown) {
  const response = await post("/links", key, payload);
  const url = typeof response.url === "string" ? parseUrl(response.url) : null;
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port || !CHECKOUT_HOSTS.has(url.hostname)) {
    throw new InfinitePayError("INVALID_LINK");
  }
  return { url: url.href, slug: paymentReference(response.slug) };
}

export async function checkInfinitePayPayment(reference: { orderNsu: string; transactionNsu: string; slug: string }) {
  const { key, handle } = infinitePayCredentials();
  const response = await post("/payment_check", key, {
    handle,
    order_nsu: reference.orderNsu,
    transaction_nsu: reference.transactionNsu,
    slug: reference.slug,
  });
  if (typeof response.success !== "boolean" || typeof response.paid !== "boolean") {
    throw new InfinitePayError("INVALID_RESPONSE");
  }
  if (!response.success || !response.paid) return { paid: false } as const;
  if (typeof response.amount !== "number" || !Number.isSafeInteger(response.amount) || response.amount <= 0) {
    throw new InfinitePayError("INVALID_AMOUNT");
  }
  const paidAmount = response.paid_amount;
  if (typeof paidAmount !== "number" || !Number.isSafeInteger(paidAmount) ||
      paidAmount <= 0 || paidAmount > 2_147_483_647) {
    throw new InfinitePayError("INVALID_AMOUNT");
  }
  return { paid: true, amount: response.amount, paidAmount } as const;
}
