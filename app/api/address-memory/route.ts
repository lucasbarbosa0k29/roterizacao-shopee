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
  let payload: unknown = null;
  let saveMode: "created" | "hit_only" | "updated" | null = null;
  let saveKey: string | null = null;
  let saveContext: {
    address: string | null;
    city: string | null;
    neighborhood: string | null;
    lat: number | null;
    lng: number | null;
    createdBy: string | null;
    label: string | null;
    distanceMeters: number | null;
    thresholdMeters: number | null;
  } = {
    address: null,
    city: null,
    neighborhood: null,
    lat: null,
    lng: null,
    createdBy: null,
    label: null,
    distanceMeters: null,
    thresholdMeters: null,
  };

  try {
    const body = (await req.json()) as {
      address?: unknown;
      city?: unknown;
      neighborhood?: unknown;
      district?: unknown;
      lat?: unknown;
      lng?: unknown;
      createdBy?: unknown;
    };
    payload = body;
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const createdBy = typeof body.createdBy === "string" ? body.createdBy : null;
    const { lat, lng } = body;

    if (!address || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "Dados invÃ¡lidos" }, { status: 400 });
    }

    const key = normalizeKey(`${address} ${city || ""}`);
    saveKey = key;
    saveContext = {
      address,
      city: city || null,
      neighborhood:
        typeof body.neighborhood === "string"
          ? body.neighborhood
          : typeof body.district === "string"
            ? body.district
            : null,
      lat,
      lng,
      createdBy,
      label: address,
      distanceMeters: null,
      thresholdMeters: null,
    };

    const existing = await prisma.addressMemory.findUnique({
      where: { key },
      select: { id: true, lat: true, lng: true, label: true },
    });

    const THRESHOLD_METERS = 3;
    saveContext.thresholdMeters = THRESHOLD_METERS;

    if (!existing) {
      saveMode = "created";
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
    saveContext.distanceMeters = dist;

    // âœ… Se mudou pouco, sÃ³ incrementa uso (nÃ£o altera lat/lng)
    if (dist < THRESHOLD_METERS) {
      saveMode = "hit_only";
      const saved = await prisma.addressMemory.update({
        where: { key },
        data: {
          hitCount: { increment: 1 },
        },
      });
      await incrementDailyMetric(METRIC_MEMORY_HIT_ONLY).catch(() => {});
      return NextResponse.json({ ok: true, mode: "hit_only", meters: dist, saved });
    }

    // âœ… Se mudou de verdade, atualiza coordenada + incrementa
    saveMode = "updated";
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
    const errorMessage = e instanceof Error ? e.message : String(e);
    const errorStack = e instanceof Error ? e.stack : null;

    console.error("🚨 ADDRESS_MEMORY_SAVE_ERROR");
    console.error("message:", errorMessage);
    console.error("stack:", errorStack);
    console.error("payload:", payload);
    console.error("normalizedDerived:", saveContext);
    console.error("mode:", saveMode);
    console.error("key:", saveKey);
    console.error("coordinates:", { lat: saveContext.lat, lng: saveContext.lng });
    console.error("location:", {
      neighborhood: saveContext.neighborhood,
      city: saveContext.city,
      address: saveContext.address,
    });
    return NextResponse.json({ error: "Erro ao salvar memÃ³ria" }, { status: 500 });
  }
}
