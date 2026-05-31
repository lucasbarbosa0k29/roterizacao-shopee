import { NextResponse } from "next/server";
import { lookupAparecidaLotByCoordinates } from "@/app/lib/aparecida-local-lots";

export const runtime = "nodejs";

/* =====================
   GET /api/aparecida/lot
===================== */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ found: false });
    }

    const result = lookupAparecidaLotByCoordinates(lat, lng);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ found: false });
  }
}
