import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

function normalizeKey(text: string) {
  return String(text || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { address, city, lat, lng, createdBy } = body;

    if (!address || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const key = normalizeKey(address + " " + city);

    const saved = await prisma.addressMemory.upsert({
      where: { key },
      update: {
        lat,
        lng,
        hitCount: { increment: 1 },
      },
      create: {
        key,
        label: address,
        lat,
        lng,
        createdBy,
      },
    });

    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao salvar memória" }, { status: 500 });
  }
}