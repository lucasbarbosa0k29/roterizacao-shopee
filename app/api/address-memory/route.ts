import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import {
  incrementDailyMetric,
  METRIC_MEMORY_CREATE_OK,
  METRIC_MEMORY_UPDATE_OK,
  METRIC_MEMORY_HIT_ONLY,
  METRIC_MEMORY_SAVE_ERROR,
} from "@/app/lib/admin-observability";
import {
  buildCondoMemoryKeyPlan,
  normalizeMemoryKey,
} from "@/app/lib/condo-memory-keys";

const MAX_ADDRESS_MEMORY_ADDRESS_CHARS = 500;
const MAX_ADDRESS_MEMORY_CITY_CHARS = 120;

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

function isValidLatLng(lat: unknown, lng: unknown) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
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
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const role = String((session?.user as any)?.role || "USER").toUpperCase();
    const isAdmin = role === "ADMIN";

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      address?: unknown;
      city?: unknown;
      neighborhood?: unknown;
      district?: unknown;
      lat?: unknown;
      lng?: unknown;
      jobId?: unknown;
    };
    payload = body;
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    const createdBy = userId;
    const { lat, lng } = body;

    if (!address || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "Dados invÃ¡lidos" }, { status: 400 });
    }

    if (!address || address.length > MAX_ADDRESS_MEMORY_ADDRESS_CHARS) {
      return NextResponse.json({ error: "Endereço inválido." }, { status: 400 });
    }

    if (city.length > MAX_ADDRESS_MEMORY_CITY_CHARS) {
      return NextResponse.json({ error: "Cidade inválida." }, { status: 400 });
    }

    if (!isValidLatLng(lat, lng)) {
      return NextResponse.json({ error: "Coordenadas inválidas." }, { status: 400 });
    }

    if (!isAdmin) {
      if (!jobId) {
        return NextResponse.json(
          { error: "jobId é obrigatório para salvar memória." },
          { status: 400 }
        );
      }

      const job = await prisma.importJob.findFirst({
        where: {
          id: jobId,
          userId,
        },
        select: { id: true },
      });

      if (!job) {
        return NextResponse.json(
          { error: "Você não tem permissão para salvar memória neste job." },
          { status: 403 }
        );
      }
    }

    const key = normalizeMemoryKey(`${address} ${city || ""}`);
    const condoMemoryPlan = buildCondoMemoryKeyPlan(address, city);
    const memoryKeyCandidates = [{ key, kind: "exact" as const }, ...condoMemoryPlan.keys].filter(
      (candidate, index, self) => self.findIndex((item) => item.key === candidate.key) === index,
    );
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

    const existingCandidates = memoryKeyCandidates.length
      ? await prisma.addressMemory.findMany({
          where: { key: { in: memoryKeyCandidates.map((candidate) => candidate.key) } },
          select: { key: true, lat: true, lng: true, label: true },
        })
      : [];
    const existing =
      existingCandidates.find((candidate) => candidate.key === key) ||
      existingCandidates[0] ||
      null;

    const THRESHOLD_METERS = 3;
    saveContext.thresholdMeters = THRESHOLD_METERS;

    if (!existing) {
      saveMode = "created";
      const saved = await prisma.$transaction(
        memoryKeyCandidates.map((candidate) =>
          prisma.addressMemory.create({
            data: {
              key: candidate.key,
              label: address,
              lat,
              lng,
              createdBy,
              hitCount: 1,
            },
          }),
        ),
      );
      await incrementDailyMetric(METRIC_MEMORY_CREATE_OK).catch(() => {});
      return NextResponse.json({ ok: true, mode: "created", saved: saved[0] });
    }

    const dist = haversineMeters(
      { lat: existing.lat, lng: existing.lng },
      { lat, lng }
    );
    saveContext.distanceMeters = dist;

    // âœ… Se mudou pouco, sÃ³ incrementa uso (nÃ£o altera lat/lng)
    // Manual confirmation always marks the record as manual, even when the
    // coordinates are very close to the previous point.
    if (dist < THRESHOLD_METERS) {
      saveMode = "hit_only";
      const saved = await prisma.$transaction(
        memoryKeyCandidates.map((candidate) =>
          prisma.addressMemory.upsert({
            where: { key: candidate.key },
            update: {
              hitCount: { increment: 1 },
              createdBy,
            },
            create: {
              key: candidate.key,
              label: address,
              lat,
              lng,
              createdBy,
              hitCount: 1,
            },
          }),
        ),
      );
      await incrementDailyMetric(METRIC_MEMORY_HIT_ONLY).catch(() => {});
      return NextResponse.json({ ok: true, mode: "hit_only", meters: dist, saved: saved[0] });
    }

    // âœ… Se mudou de verdade, atualiza coordenada + incrementa
    saveMode = "updated";
    const saved = await prisma.$transaction(
      memoryKeyCandidates.map((candidate) =>
        prisma.addressMemory.upsert({
          where: { key: candidate.key },
          update: {
            lat,
            lng,
            hitCount: { increment: 1 },
            createdBy,
          },
          create: {
            key: candidate.key,
            label: address,
            lat,
            lng,
            createdBy,
            hitCount: 1,
          },
        }),
      ),
    );
    await incrementDailyMetric(METRIC_MEMORY_UPDATE_OK).catch(() => {});

    return NextResponse.json({ ok: true, mode: "updated", meters: dist, saved: saved[0] });
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
