import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

const MERCADOPAGO_PREFERENCES_URL =
  "https://api.mercadopago.com/checkout/preferences";

const PRODUCT_CONFIG = {
  EXTRA_ROUTE: {
    title: "Rota avulsa",
    unitAmountCents: 199,
    minQuantity: 1,
    maxQuantity: 100,
  },
  BASIC_PLAN: {
    title: "Plano Basic",
    unitAmountCents: 3999,
    minQuantity: 1,
    maxQuantity: 1,
  },
  PRO_PLAN: {
    title: "Plano Pro",
    unitAmountCents: 6999,
    minQuantity: 1,
    maxQuantity: 1,
  },
} as const;

type ProductType = keyof typeof PRODUCT_CONFIG;

type CheckoutBody = {
  productType?: unknown;
  quantity?: unknown;
};

type MercadoPagoPreferenceResponse = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
  [key: string]: unknown;
};

function isProductType(value: unknown): value is ProductType {
  return typeof value === "string" && value in PRODUCT_CONFIG;
}

function resolveQuantity(productType: ProductType, value: unknown): number | null {
  const config = PRODUCT_CONFIG[productType];

  if (value === undefined || value === null) {
    return 1;
  }

  if (!Number.isInteger(value)) {
    return null;
  }

  const quantity = value as number;
  if (quantity < config.minQuantity || quantity > config.maxQuantity) {
    return null;
  }

  return quantity;
}

function toReais(amountCents: number): number {
  return amountCents / 100;
}

function generateExternalReference(): string {
  return `mp_${randomUUID()}`;
}

async function createPaymentTransaction(params: {
  userId: string;
  productType: ProductType;
  quantity: number;
  amountCents: number;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.paymentTransaction.create({
        data: {
          userId: params.userId,
          provider: "MERCADOPAGO",
          productType: params.productType,
          quantity: params.quantity,
          amountCents: params.amountCents,
          currency: "BRL",
          status: "PENDING",
          externalReference: generateExternalReference(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to generate unique externalReference");
}

export async function POST(request: Request) {
  try {
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const notificationUrl = process.env.MERCADOPAGO_NOTIFICATION_URL;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Mercado Pago access token not configured." },
        { status: 500 }
      );
    }

    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as CheckoutBody | null;

    if (!body || !isProductType(body.productType)) {
      return NextResponse.json(
        { error: "Produto inválido." },
        { status: 400 }
      );
    }

    const productType = body.productType;
    const quantity = resolveQuantity(productType, body.quantity);

    if (quantity === null) {
      return NextResponse.json(
        { error: "Quantidade inválida." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, active: true },
    });

    if (!user?.active) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = PRODUCT_CONFIG[productType];
    const amountCents = config.unitAmountCents * quantity;

    const transaction = await createPaymentTransaction({
      userId,
      productType,
      quantity,
      amountCents,
    });

    const preferencePayload = {
      items: [
        {
          title: config.title,
          quantity,
          unit_price: toReais(config.unitAmountCents),
          currency_id: "BRL",
        },
      ],
      payer: {
        email: user.email,
      },
      external_reference: transaction.externalReference,
      metadata: {
        userId,
        paymentTransactionId: transaction.id,
        productType,
        quantity,
      },
      ...(notificationUrl
        ? { notification_url: notificationUrl }
        : {}),
    };

    let mercadoPagoResponse: Response;

    try {
      mercadoPagoResponse = await fetch(MERCADOPAGO_PREFERENCES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preferencePayload),
      });
    } catch (error) {
      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "REJECTED",
          rawPayload: {
            transportError: true,
            message:
              error instanceof Error
                ? error.message
                : "Erro de transporte ao criar checkout no Mercado Pago.",
            timestamp: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      console.error(
        "POST /api/payments/mercadopago/checkout transport error:",
        error
      );

      return NextResponse.json(
        { error: "Erro ao criar checkout no Mercado Pago." },
        { status: 502 }
      );
    }

    const mercadoPagoPayload =
      (await mercadoPagoResponse.json().catch(() => null)) as
        | MercadoPagoPreferenceResponse
        | null;

    if (
      !mercadoPagoResponse.ok ||
      !mercadoPagoPayload?.id ||
      (!mercadoPagoPayload.init_point && !mercadoPagoPayload.sandbox_init_point)
    ) {
      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "REJECTED",
          rawPayload: {
            ok: mercadoPagoResponse.ok,
            status: mercadoPagoResponse.status,
            statusText: mercadoPagoResponse.statusText,
            payload: mercadoPagoPayload,
          } as Prisma.InputJsonValue,
        },
      });

      return NextResponse.json(
        { error: "Erro ao criar checkout no Mercado Pago." },
        { status: 502 }
      );
    }

    const updatedTransaction = await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        mercadoPagoPreferenceId: mercadoPagoPayload.id,
        initPoint: mercadoPagoPayload.init_point,
        sandboxInitPoint: mercadoPagoPayload.sandbox_init_point,
        rawPayload: mercadoPagoPayload as Prisma.InputJsonValue,
      },
    });

    const checkoutUrl =
      updatedTransaction.initPoint ?? updatedTransaction.sandboxInitPoint;

    return NextResponse.json({
      checkoutUrl,
      paymentTransactionId: updatedTransaction.id,
    });
  } catch (error) {
    console.error("POST /api/payments/mercadopago/checkout error:", error);
    return NextResponse.json(
      { error: "Erro ao iniciar checkout." },
      { status: 500 }
    );
  }
}
