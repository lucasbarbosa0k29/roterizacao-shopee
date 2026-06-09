import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { fulfillApprovedPaymentTransaction } from "@/app/lib/payment-fulfillment";

export const runtime = "nodejs";

const MERCADOPAGO_PAYMENTS_URL = "https://api.mercadopago.com/v1/payments";

type MercadoPagoWebhookBody = {
  type?: unknown;
  topic?: unknown;
  action?: unknown;
  data?: {
    id?: unknown;
  };
  id?: unknown;
};

type MercadoPagoPayment = {
  id?: number | string;
  status?: string;
  external_reference?: string | null;
  metadata?: {
    paymentTransactionId?: unknown;
    payment_transaction_id?: unknown;
    [key: string]: unknown;
  } | null;
  date_approved?: string | null;
  [key: string]: unknown;
};

function getString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function getPaymentId(request: Request, body: MercadoPagoWebhookBody | null) {
  const url = new URL(request.url);

  return (
    getString(body?.data?.id) ||
    getString(url.searchParams.get("data.id")) ||
    getString(url.searchParams.get("id")) ||
    getString(body?.id)
  );
}

function isPaymentNotification(request: Request, body: MercadoPagoWebhookBody | null) {
  const url = new URL(request.url);
  const type = getString(body?.type) || getString(url.searchParams.get("type"));
  const topic = getString(body?.topic) || getString(url.searchParams.get("topic"));

  return type === "payment" || topic === "payment";
}

function mapPaymentStatus(status: string | undefined) {
  switch (status) {
    case "approved":
      return "APPROVED";
    case "rejected":
      return "REJECTED";
    case "cancelled":
    case "canceled":
      return "CANCELED";
    case "refunded":
    case "charged_back":
      return "REFUNDED";
    case "expired":
      return "EXPIRED";
    case "in_process":
    case "in_mediation":
    case "authorized":
      return "REQUIRES_ACTION";
    case "pending":
    default:
      return "PENDING";
  }
}

function getPaymentTransactionId(payment: MercadoPagoPayment) {
  return (
    getString(payment.metadata?.paymentTransactionId) ||
    getString(payment.metadata?.payment_transaction_id)
  );
}

async function fetchMercadoPagoPayment(paymentId: string, accessToken: string) {
  const response = await fetch(
    `${MERCADOPAGO_PAYMENTS_URL}/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    }
  );

  const payload = (await response.json().catch(() => null)) as
    | MercadoPagoPayment
    | null;

  return { response, payload };
}

async function findPaymentTransaction(payment: MercadoPagoPayment) {
  const mercadoPagoPaymentId = getString(payment.id);
  const externalReference = getString(payment.external_reference);
  const paymentTransactionId = getPaymentTransactionId(payment);

  if (mercadoPagoPaymentId) {
    const byPaymentId = await prisma.paymentTransaction.findUnique({
      where: { mercadoPagoPaymentId },
    });
    if (byPaymentId) return byPaymentId;
  }

  if (paymentTransactionId) {
    const byMetadataId = await prisma.paymentTransaction.findUnique({
      where: { id: paymentTransactionId },
    });
    if (byMetadataId) return byMetadataId;
  }

  if (externalReference) {
    const byExternalReference = await prisma.paymentTransaction.findUnique({
      where: { externalReference },
    });
    if (byExternalReference) return byExternalReference;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      console.error("Mercado Pago webhook: missing access token");
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as
      | MercadoPagoWebhookBody
      | null;

    if (!isPaymentNotification(request, body)) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const paymentId = getPaymentId(request, body);
    if (!paymentId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const { response, payload } = await fetchMercadoPagoPayment(
      paymentId,
      accessToken
    );

    if (!response.ok || !payload?.id) {
      console.error("Mercado Pago webhook: failed to fetch payment", {
        paymentId,
        status: response.status,
        payload,
      });

      return NextResponse.json({ ok: false }, { status: 502 });
    }

    const transaction = await findPaymentTransaction(payload);
    if (!transaction) {
      console.error("Mercado Pago webhook: transaction not found", {
        paymentId,
        externalReference: payload.external_reference,
        paymentTransactionId: getPaymentTransactionId(payload),
      });

      return NextResponse.json({ ok: true, ignored: true });
    }

    const mercadoPagoPaymentId = getString(payload.id);
    const nextStatus = mapPaymentStatus(payload.status);
    const approvedAt =
      nextStatus === "APPROVED"
        ? transaction.approvedAt ?? new Date(payload.date_approved || Date.now())
        : transaction.approvedAt;

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        mercadoPagoPaymentId,
        status: nextStatus,
        approvedAt,
        rawPayload: payload as Prisma.InputJsonValue,
      },
    });

    if (nextStatus === "APPROVED") {
      await fulfillApprovedPaymentTransaction(transaction.id);
    }

    return NextResponse.json({
      ok: true,
      paymentTransactionId: transaction.id,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      console.error("Mercado Pago webhook: unique conflict", error);
      return NextResponse.json({ ok: true, duplicated: true });
    }

    console.error("POST /api/webhooks/mercadopago error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
