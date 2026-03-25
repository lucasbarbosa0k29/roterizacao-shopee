import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  incrementDailyMetric,
  METRIC_MEMORY_CREATE_OK,
  METRIC_MEMORY_UPDATE_OK,
  METRIC_MEMORY_HIT_ONLY,
  METRIC_MEMORY_SAVE_ERROR,
} from "@/app/lib/admin-observability";

function normalizeKey(text: string) {
  return String(text || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { address, city, lat, lng, createdBy } = body;

    if (!address || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const key = normalizeKey(`${address} ${city || ""}`);

    const existing = await prisma.addressMemory.findUnique({
      where: { key },
      select: { id: true, lat: true, lng: true, label: true },
    });

    const THRESHOLD_METERS = 3;

    if (!existing) {
      const saved = await prisma.addressMemory.create({
        data: {
          key,
          label: address,
          lat,
          lng,
          createdBy: createdBy || null,
          hitCount: 1,
        },
      });
      await incrementDailyMetric(METRIC_MEMORY_CREATE_OK).catch(() => {});
      return NextResponse.json({ ok: true, mode: "created", saved });
    }

    const dist = haversineMeters(
      { lat: existing.lat, lng: existing.lng },
      { lat, lng }
    );

    // ✅ Se mudou pouco, só incrementa uso (não altera lat/lng)
    if (dist < THRESHOLD_METERS) {
      const saved = await prisma.addressMemory.update({
        where: { key },
        data: {
          hitCount: { increment: 1 },
        },
      });
      await incrementDailyMetric(METRIC_MEMORY_HIT_ONLY).catch(() => {});
      return NextResponse.json({ ok: true, mode: "hit_only", meters: dist, saved });
    }

    // ✅ Se mudou de verdade, atualiza coordenada + incrementa
    const saved = await prisma.addressMemory.update({
      where: { key },
      data: {
        lat,
        lng,
        hitCount: { increment: 1 },
        createdBy: createdBy || null,
      },
    });
    await incrementDailyMetric(METRIC_MEMORY_UPDATE_OK).catch(() => {});

    return NextResponse.json({ ok: true, mode: "updated", meters: dist, saved });
  } catch (e) {
    await incrementDailyMetric(METRIC_MEMORY_SAVE_ERROR).catch(() => {});
    console.error(e);
    return NextResponse.json({ error: "Erro ao salvar memória" }, { status: 500 });
  }
}
