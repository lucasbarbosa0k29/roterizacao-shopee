// app/api/import/route.ts
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { cleanupOldImportJobsIfNeeded } from "@/app/lib/import-job-cleanup";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getUserAccessSnapshot } from "@/app/lib/access-control";

export const runtime = "nodejs";

function pickFirst(row: any, keys: string[]) {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

function onlyDigits(s: string) {
  return (s || "").replace(/\D+/g, "");
}

function normCity(v: string) {
  const s = String(v || "").trim();
  if (!s) return "";

  const up = s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (up.includes("APARECIDA") && up.includes("GOIANIA")) return "Aparecida de Goiânia";
  if (up === "GOIANIA") return "Goiânia";

  return s;
}

function parseMaybeNumber(v: any) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    void cleanupOldImportJobsIfNeeded();

    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        accessBlockedAt: true,
        accessBlockReason: true,
      },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (currentUser.role !== "ADMIN" && currentUser.accessBlockedAt) {
      return NextResponse.json(
        {
          error: currentUser.accessBlockReason ?? "Seu acesso está bloqueado.",
          code: "ACCESS_BLOCKED",
        },
        { status: 403 }
      );
    }

    const access = await getUserAccessSnapshot(userId);
    if (!access.canStartRoute) {
      return NextResponse.json(
        {
          error: access.message ?? "Seu acesso não permite iniciar uma nova rota.",
          code: access.code,
          upgradeUrl: "/planos",
          access,
        },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rawRows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });

    const rows = rawRows.map((row: any) => {
      const sequence = String(
        pickFirst(row, ["Sequence", "SEQUENCE", "Sequência", "sequencia", "SEQ", "seq"])
      ).trim();

      const bairro = String(pickFirst(row, ["Bairro", "BAIRRO", "bairro"])).trim();

      const cityRaw = String(pickFirst(row, ["City", "CITY", "Cidade", "CIDADE", "city"])).trim();
      const city = normCity(cityRaw);

      const cepRaw = pickFirst(row, [
        "Zipcode/Postal code",
        "ZIPCODE/POSTAL CODE",
        "CEP",
        "cep",
        "Postal code",
        "POSTAL CODE",
      ]);

      const cepDigits = onlyDigits(String(cepRaw || ""));
      const cep = cepDigits.length >= 8 ? cepDigits : String(cepRaw || "").trim();

      const addressCell = pickFirst(row, [
        "Destination Address",
        "DESTINATION ADDRESS",
        "Endereço",
        "Endereco",
        "ENDEREÇO",
        "ENDERECO",
        "Destination",
        "DESTINATION",
      ]);

      const original = String(addressCell ?? "");

      const lat = parseMaybeNumber(pickFirst(row, ["Latitude", "LATITUDE", "lat", "LAT"]));
      const lng = parseMaybeNumber(
        pickFirst(row, ["Longitude", "LONGITUDE", "lng", "LNG", "Lon", "LON"])
      );

      return {
        sequence,
        bairro,
        city,
        cep,
        original,
        latFromSheet: lat,
        lngFromSheet: lng,
      };
    });

    const job = await prisma.importJob.create({
      data: {
        userId,
        originalName: file.name,
        storedName: null,
        status: "PENDING",
        totalStops: rows.length,
        processedStops: 0,

        // ✅ já salva o “estado inicial” no banco (pra abrir depois)
      },
      select: { id: true },
    });

    return NextResponse.json({ jobId: job.id, total: rows.length, rows });
  } catch (err: any) {
    console.error("Erro /api/import:", err);
    return NextResponse.json({ error: "Erro ao importar planilha" }, { status: 500 });
  }
}
