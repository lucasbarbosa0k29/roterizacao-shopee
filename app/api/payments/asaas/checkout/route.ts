import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

const ASAAS_API_BASE_URL = process.env.ASAAS_API_BASE_URL || "https://api.asaas.com";
const ASAAS_CHECKOUT_BASE_URL = process.env.ASAAS_CHECKOUT_BASE_URL || "https://asaas.com";
const ASAAS_CHECKOUTS_URL = `${ASAAS_API_BASE_URL}/v3/checkouts`;

const PRODUCT_CONFIG = {
  BASIC_PLAN: {
    title: "Plano Basic",
    description: "Plano Basic do Rotta",
    unitAmountCents: 3999,
  },
  PRO_PLAN: {
    title: "Plano Pro",
    description: "Plano Pro do Rotta",
    unitAmountCents: 6999,
  },
  EXTRA_ROUTE: {
    title: "Rota avulsa",
    description: "Crédito avulso do Rotta",
    unitAmountCents: 199,
  },
} as const;

type ProductType = keyof typeof PRODUCT_CONFIG;

type CheckoutBody = {
  productType?: unknown;
  quantity?: unknown;
};

type AsaasCheckoutResponse = {
  id?: string;
  url?: string;
  checkoutUrl?: string;
  link?: string;
  customer?: {
    id?: string;
  };
  [key: string]: unknown;
};

function isProductType(value: unknown): value is ProductType {
  return typeof value === "string" && value in PRODUCT_CONFIG;
}

function resolveQuantity(productType: ProductType, value: unknown): number | null {
  if (value === undefined || value === null) {
    return 1;
  }

  if (!Number.isInteger(value)) {
    return null;
  }

  const quantity = value as number;

  if (productType === "EXTRA_ROUTE") {
    if (quantity < 1 || quantity > 100) {
      return null;
    }

    return quantity;
  }

  if (quantity !== 1) {
    return null;
  }

  return 1;
}

function toReais(amountCents: number): number {
  return amountCents / 100;
}

function generateExternalReference(): string {
  return `asaas_${randomUUID()}`;
}

function getSessionUserId(session: { user?: unknown } | null | undefined): string | undefined {
  const user = session?.user;
  if (!user || typeof user !== "object") return undefined;

  const id = (user as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function buildCheckoutUrl(checkoutId?: string | null, responseUrl?: string | null) {
  if (responseUrl && responseUrl.trim()) {
    return responseUrl.trim();
  }

  if (!checkoutId) {
    return null;
  }

  return `${ASAAS_CHECKOUT_BASE_URL.replace(/\/$/, "")}/checkoutSession/show?id=${encodeURIComponent(
    checkoutId
  )}`;
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
          provider: "ASAAS",
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
    const accessToken = process.env.ASAAS_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Asaas access token not configured." },
        { status: 500 }
      );
    }

    const session = (await getServerSession(authOptions)) as { user?: unknown } | null;
    const userId = getSessionUserId(session);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as CheckoutBody | null;

    if (!body || !isProductType(body.productType)) {
      return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
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
      select: { active: true },
    });

    if (!user?.active) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = PRODUCT_CONFIG[productType];
    const amountCents = config.unitAmountCents * quantity;
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.NEXTAUTH_URL?.trim() ||
      "https://usarotta.com.br";

    const transaction = await createPaymentTransaction({
      userId,
      productType,
      quantity,
      amountCents,
    });

    const checkoutPayload = {
      billingTypes: ["PIX", "CREDIT_CARD"],
      chargeTypes: ["DETACHED"],
      externalReference: transaction.externalReference,
      isAddressRequired: false,
      notificationEnabled: true,
      minutesToExpire: 60,
      callback: {
        successUrl: `${baseUrl}/planos?payment=success`,
        cancelUrl: `${baseUrl}/planos?payment=failure`,
        expiredUrl: `${baseUrl}/planos?payment=expired`,
      },
      items: [
        {
          name: config.title,
          description: config.description,
          quantity,
          value: toReais(config.unitAmountCents),
        },
      ],
    };

    let asaasResponse: Response;

    try {
      asaasResponse = await fetch(ASAAS_CHECKOUTS_URL, {
        method: "POST",
        headers: {
          access_token: accessToken,
          "Content-Type": "application/json",
          "User-Agent": "Rotta",
        },
        body: JSON.stringify(checkoutPayload),
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
                : "Erro de transporte ao criar checkout no Asaas.",
            timestamp: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      console.error("POST /api/payments/asaas/checkout transport error:", error);

      return NextResponse.json(
        { error: "Erro ao criar checkout no Asaas." },
        { status: 502 }
      );
    }

    const asaasResponseText = await asaasResponse.text().catch(() => "");
    const asaasPayload = (asaasResponseText
      ? (() => {
          try {
            return JSON.parse(asaasResponseText) as AsaasCheckoutResponse;
          } catch {
            return null;
          }
        })()
      : null) as AsaasCheckoutResponse | null;

    const checkoutId = asaasPayload?.id ?? null;
    const checkoutUrl = buildCheckoutUrl(
      checkoutId,
      asaasPayload?.url ??
        asaasPayload?.checkoutUrl ??
        asaasPayload?.link ??
        null
    );

    if (!asaasResponse.ok || !checkoutUrl) {
      await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "REJECTED",
          rawPayload: {
            ok: asaasResponse.ok,
            status: asaasResponse.status,
            statusText: asaasResponse.statusText,
            payload: asaasPayload,
          } as Prisma.InputJsonValue,
        },
      });

      console.error("Asaas checkout creation failed", {
        status: asaasResponse.status,
        statusText: asaasResponse.statusText,
        responseBody: asaasPayload ?? asaasResponseText,
        productType,
        quantity,
        amountCents,
        externalReference: transaction.externalReference,
        checkoutPayloadKeys: Object.keys(checkoutPayload),
      });

      return NextResponse.json(
        { error: "Erro ao criar checkout no Asaas." },
        { status: 502 }
      );
    }

    const updatedTransaction = await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        asaasCheckoutUrl: checkoutUrl,
        asaasCustomerId: asaasPayload?.customer?.id ?? null,
        rawPayload: asaasPayload as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      checkoutUrl: updatedTransaction.asaasCheckoutUrl ?? checkoutUrl,
      paymentTransactionId: updatedTransaction.id,
    });
  } catch (error) {
    console.error("POST /api/payments/asaas/checkout error:", error);
    return NextResponse.json(
      { error: "Erro ao iniciar checkout." },
      { status: 500 }
    );
  }
}
