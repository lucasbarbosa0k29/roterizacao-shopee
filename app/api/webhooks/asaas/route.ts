import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { fulfillApprovedPaymentTransaction } from "@/app/lib/payment-fulfillment";

export const runtime = "nodejs";

type AsaasWebhookBody = {
  event?: unknown;
  payment?: Record<string, unknown> | null;
  [key: string]: unknown;
};

function getString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function getPaymentPayload(body: AsaasWebhookBody | null) {
  if (!body || typeof body !== "object") {
    return null;
  }

  if (body.payment && typeof body.payment === "object") {
    return body.payment;
  }

  return body as Record<string, unknown>;
}

function isPaymentEvent(event: string | null) {
  if (!event) return true;
  return event.startsWith("PAYMENT_");
}

function isApprovedAsaasEvent(event: string | null, status: string | null) {
  return (
    event === "PAYMENT_RECEIVED" ||
    event === "PAYMENT_CONFIRMED" ||
    status === "RECEIVED" ||
    status === "CONFIRMED"
  );
}

function mapAsaasStatus(event: string | null, status: string | null) {
  if (isApprovedAsaasEvent(event, status)) {
    return "APPROVED" as const;
  }

  switch (status) {
    case "PENDING":
      return "PENDING" as const;
    case "OVERDUE":
      return "EXPIRED" as const;
    case "CANCELLED":
    case "CANCELED":
    case "DELETED":
      return "CANCELED" as const;
    case "REFUNDED":
      return "REFUNDED" as const;
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "REQUIRES_ACTION" as const;
    default:
      return "PENDING" as const;
  }
}

async function findPaymentTransaction(payment: Record<string, unknown>) {
  const asaasPaymentId = getString(payment.id);
  const externalReference =
    getString(payment.externalReference) || getString(payment.external_reference);
  const checkoutSession = getString(payment.checkoutSession);

  if (asaasPaymentId) {
    const byPaymentId = await prisma.paymentTransaction.findUnique({
      where: { asaasPaymentId },
    });
    if (byPaymentId) return byPaymentId;
  }

  if (externalReference) {
    const byExternalReference = await prisma.paymentTransaction.findUnique({
      where: { externalReference },
    });
    if (byExternalReference) return byExternalReference;
  }

  if (checkoutSession) {
    const byCheckoutSession = await prisma.paymentTransaction.findFirst({
      where: {
        asaasCheckoutUrl: {
          contains: checkoutSession,
        },
      },
    });

    if (byCheckoutSession) return byCheckoutSession;
  }

  return null;
}

function validateWebhookSecret(request: NextRequest) {
  const configuredSecret = process.env.ASAAS_WEBHOOK_SECRET?.trim();

  if (!configuredSecret) {
    const message =
      "Asaas webhook secret not configured. Set ASAAS_WEBHOOK_SECRET and use /api/webhooks/asaas?secret=... in production.";

    if (process.env.NODE_ENV === "production") {
      console.error(message);
      return NextResponse.json({ error: "Webhook secret not configured." }, { status: 500 });
    }

    console.warn(message);
    return null;
  }

  const providedSecret = request.nextUrl.searchParams.get("secret")?.trim();
  if (providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const secretResponse = validateWebhookSecret(request);
    if (secretResponse) {
      return secretResponse;
    }

    const body = (await request.json().catch(() => null)) as AsaasWebhookBody | null;
    const event = getString(body?.event);
    const payment = getPaymentPayload(body);

    if (!payment || !isPaymentEvent(event)) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const transaction = await findPaymentTransaction(payment);
    if (!transaction) {
      console.error("Asaas webhook: transaction not found", {
        event,
        paymentId: getString(payment.id),
        externalReference:
          getString(payment.externalReference) || getString(payment.external_reference),
      });

      return NextResponse.json({ ok: true, ignored: true });
    }

    const asaasPaymentId = getString(payment.id);
    const paymentStatus =
      getString(payment.status) || getString(payment.paymentStatus) || null;
    const nextStatus = mapAsaasStatus(event, paymentStatus);
    const approvedAt =
      nextStatus === "APPROVED" ? transaction.approvedAt ?? new Date() : transaction.approvedAt;

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        asaasPaymentId: asaasPaymentId ?? transaction.asaasPaymentId,
        status: nextStatus,
        approvedAt,
        rawPayload: body as Prisma.InputJsonValue,
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
      console.error("Asaas webhook: unique conflict", error);
      return NextResponse.json({ ok: true, duplicated: true });
    }

    console.error("POST /api/webhooks/asaas error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
