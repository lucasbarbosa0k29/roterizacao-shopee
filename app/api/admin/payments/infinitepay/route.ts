import { getServerSession } from "next-auth";
import { requireSuperAdmin } from "@/app/lib/admin-roles";
import { authOptions } from "@/app/lib/auth";
import { infinitePayAppOrigin, isRecord, paymentReference } from "@/app/lib/infinitepay";
import { processInfinitePayEvent, readInfinitePaySignal, reconcileInfinitePayEvents, recordInfinitePaySignal, retryInfinitePayEvent } from "@/app/lib/infinitepay-payments";
import { readPaymentJson } from "@/app/lib/payment-http";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!requireSuperAdmin((await getServerSession(authOptions))?.user)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const [events, orders] = await Promise.all([
      prisma.paymentEvent.findMany({
        where: { status: { in: ["PENDING", "REVIEW"] }, paymentTransaction: { provider: "INFINITEPAY" } },
        orderBy: { createdAt: "desc" }, take: 50,
        select: {
          id: true, kind: true, status: true, lastError: true, attempts: true, nextAttemptAt: true,
          slug: true, transactionNsu: true,
          paymentTransaction: { select: { externalReference: true, productType: true, status: true, fulfilledAt: true } },
        },
      }),
      prisma.paymentTransaction.findMany({
        where: { provider: "INFINITEPAY", status: "PENDING", checkoutAttempts: { gt: 0 }, events: { none: {} } },
        orderBy: { createdAt: "desc" }, take: 50,
        select: { externalReference: true, productType: true, checkoutExpiresAt: true, checkoutAttempts: true },
      }),
    ]);
    return Response.json({ events, orders }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Conciliação indisponível." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!requireSuperAdmin((await getServerSession(authOptions))?.user) ||
        request.headers.get("origin") !== infinitePayAppOrigin()) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await readPaymentJson(request);
    if (!isRecord(body)) return Response.json({ error: "Dados inválidos." }, { status: 400 });
    if (body.action === "reconcile") {
      return Response.json({ attempted: await reconcileInfinitePayEvents() });
    }
    if (body.action === "retry") {
      const eventId = paymentReference(body.eventId);
      if (!eventId || !(await retryInfinitePayEvent(eventId))) {
        return Response.json({ error: "Evento indisponível para nova tentativa." }, { status: 409 });
      }
      return Response.json({ eventId });
    }
    const signal = readInfinitePaySignal(body, "admin");
    if (!signal) return Response.json({ error: "Referências inválidas." }, { status: 400 });
    const eventId = await recordInfinitePaySignal(signal);
    if (!eventId) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    if (signal.kind === "confirm") await processInfinitePayEvent(eventId);
    return Response.json({ eventId });
  } catch {
    console.error("InfinitePay reconciliation: operation failed");
    return Response.json({ error: "Conciliação indisponível." }, { status: 503 });
  }
}
