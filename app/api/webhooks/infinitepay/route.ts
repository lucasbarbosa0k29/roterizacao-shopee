import { after } from "next/server";
import { processInfinitePayEvent, readInfinitePaySignal, recordInfinitePaySignal } from "@/app/lib/infinitepay-payments";
import { readPaymentJson } from "@/app/lib/payment-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signal = readInfinitePaySignal(await readPaymentJson(request), "webhook");
  if (!signal) return Response.json({ ok: false }, { status: 400 });
  try {
    const eventId = await recordInfinitePaySignal(signal);
    if (eventId && signal.kind === "confirm") {
      after(() => processInfinitePayEvent(eventId).catch(() => console.error("InfinitePay notification: retry required")));
    }
    return Response.json({ ok: true });
  } catch {
    console.error("InfinitePay notification: unable to store event");
    return Response.json({ ok: false }, { status: 503 });
  }
}
