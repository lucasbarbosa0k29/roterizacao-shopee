import { after } from "next/server";
import { infinitePayAppOrigin, paymentReference } from "@/app/lib/infinitepay";
import { processInfinitePayEvent, readInfinitePaySignal, recordInfinitePaySignal } from "@/app/lib/infinitepay-payments";
import { paymentSessionUserId } from "@/app/lib/payment-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const orderNsu = paymentReference(params.get("order_nsu"));
    const destination = new URL("/planos", infinitePayAppOrigin());
    if (orderNsu) destination.searchParams.set("paymentOrder", orderNsu);
    const signal = readInfinitePaySignal(Object.fromEntries(params), "return");
    const userId = await paymentSessionUserId();
    if (signal && userId) {
      const eventId = await recordInfinitePaySignal(signal, userId);
      if (eventId) {
        after(() => processInfinitePayEvent(eventId).catch(() => console.error("InfinitePay return: retry required")));
      }
    }
    return new Response(null, {
      status: 303, headers: { Location: destination.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch {
    console.error("InfinitePay return: unable to store event");
    return new Response("Não foi possível consultar o pagamento. Tente novamente.", { status: 503 });
  }
}
