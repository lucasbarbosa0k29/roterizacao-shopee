import { getServerSession } from "next-auth";
import { requireSuperAdmin } from "@/app/lib/admin-roles";
import { authOptions } from "@/app/lib/auth";
import { isRecord, paymentReference } from "@/app/lib/infinitepay";
import { readPaymentJson } from "@/app/lib/payment-http";
import { resolvePaymentReview } from "@/app/lib/payment-review";
import { recordInfinitePayRefund } from "@/app/lib/infinitepay-refund";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!requireSuperAdmin((await getServerSession(authOptions))?.user)) return new Response(null, { status: 403 });
    const query = new URL(request.url).searchParams.get("order");
    const orderNsu = paymentReference(query);
    if (query !== null && !orderNsu) return new Response(null, { status: 400 });
    const orders = await prisma.paymentTransaction.findMany({
      where: { status: "APPROVED", fulfilledAt: null, fulfilledSourceId: null,
        ...(orderNsu ? { externalReference: orderNsu } : {}) },
      orderBy: { createdAt: "desc" }, take: 50,
      select: {
        externalReference: true, provider: true, productType: true, amountCents: true, approvedAt: true,
        fulfillmentReviewReason: true, infinitePayTransactionId: true, asaasPaymentId: true, mercadoPagoPaymentId: true,
      },
    });
    return Response.json({ orders }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const user = (await getServerSession(authOptions))?.user;
    const adminId = (user as { id?: unknown } | undefined)?.id;
    if (!requireSuperAdmin(user) || typeof adminId !== "string") return new Response(null, { status: 403 });
    const configUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (!configUrl || request.headers.get("origin") !== new URL(configUrl).origin) return new Response(null, { status: 403 });
    const body = await readPaymentJson(request);
    if (!isRecord(body)) return new Response(null, { status: 400 });
    const { action } = body;
    const orderNsu = paymentReference(body.orderNsu);
    const captureReference = paymentReference(body.captureReference);
    const evidence = paymentReference(body.evidence);
    const eventId = paymentReference(body.eventId);
    const { amountCents } = body;
    if (!orderNsu || !captureReference || !evidence || typeof amountCents !== "number" ||
        !Number.isSafeInteger(amountCents) || amountCents <= 0) return new Response(null, { status: 400 });
    if (action === "record-infinitepay-refund") {
      if (body.confirmed !== true) return Response.json({ error: "Confirme o estorno integral na InfinitePay." }, { status: 400 });
      const result = await recordInfinitePayRefund(adminId, { orderNsu, captureReference, evidence, amountCents });
      return result ? Response.json(result) : Response.json(
        { error: "Não foi possível vincular o estorno aos dados do pagamento e do benefício." }, { status: 409 },
      );
    }
    if ((action !== "retry-benefit" && action !== "record-refund" && action !== "record-duplicate-refund") ||
        (action === "record-duplicate-refund" && !eventId)) return new Response(null, { status: 400 });
    const result = await resolvePaymentReview(adminId, { action, orderNsu, captureReference, evidence, eventId, amountCents });
    return Response.json(result ?? { resolved: false }, { status: result?.resolved ? 200 : 409 });
  } catch {
    console.error("Payment review: operation failed");
    return new Response(null, { status: 503 });
  }
}
