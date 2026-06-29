import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import {
  HERE_METRIC_ORIGINS,
  HERE_METRIC_SERVICES,
  incrementHereMetric,
  type HereMetricOrigin,
  type HereMetricService,
} from "@/app/lib/admin-observability";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string } | undefined;
    const userId = user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as {
      service?: unknown;
      origin?: unknown;
    } | null;
    const service = typeof body?.service === "string" ? body.service : "";
    const origin = typeof body?.origin === "string" ? body.origin : "";

    if (
      !HERE_METRIC_SERVICES.includes(service as HereMetricService) ||
      !HERE_METRIC_ORIGINS.includes(origin as HereMetricOrigin)
    ) {
      return NextResponse.json({ error: "Invalid HERE metric payload." }, { status: 400 });
    }

    await incrementHereMetric(service as HereMetricService, origin as HereMetricOrigin);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/observability/here error:", error);
    return NextResponse.json({ error: "Erro ao registrar observabilidade HERE." }, { status: 500 });
  }
}
