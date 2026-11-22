import { paymentReference } from "@/app/lib/infinitepay";
import { getInfinitePayOrderStatus } from "@/app/lib/infinitepay-payments";
import { paymentSessionUserId } from "@/app/lib/payment-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await paymentSessionUserId();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const orderNsu = paymentReference(new URL(request.url).searchParams.get("order"));
    const state = orderNsu && await getInfinitePayOrderStatus(userId, orderNsu);
    if (!state) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    return Response.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Consulta indisponível." }, { status: 503 });
  }
}
