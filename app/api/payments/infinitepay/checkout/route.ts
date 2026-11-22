import { readCheckoutRequest, startInfinitePayCheckout } from "@/app/lib/infinitepay-checkout";
import { infinitePayAppOrigin, infinitePayCheckoutEnabled } from "@/app/lib/infinitepay";
import { paymentSessionUserId, readPaymentJson } from "@/app/lib/payment-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!infinitePayCheckoutEnabled()) return Response.json({ state: "DISABLED" }, { status: 503 });
  try {
    if (request.headers.get("origin") !== infinitePayAppOrigin()) {
      return Response.json({ state: "FORBIDDEN" }, { status: 403 });
    }
    const userId = await paymentSessionUserId();
    if (!userId) return Response.json({ state: "UNAUTHORIZED" }, { status: 401 });
    const input = readCheckoutRequest(await readPaymentJson(request), request.headers.get("Idempotency-Key"));
    if (!input) return Response.json({ state: "BAD_REQUEST" }, { status: 400 });
    const result = await startInfinitePayCheckout(userId, input);
    const status = result.state === "READY" ? 200 : result.state === "CHECKOUT_PENDING" ? 202 :
      result.state === "UNAUTHORIZED" ? 401 : 409;
    return Response.json(result, { status });
  } catch {
    console.error("InfinitePay checkout: unable to initialise order");
    return Response.json({ state: "UNAVAILABLE" }, { status: 503 });
  }
}
