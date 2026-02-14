// app/api/import/route.ts
import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/app/lib/prisma";

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
    const token = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        userId: token.sub,
        originalName: file.name,
        storedName: null,
        status: "PENDING",
        totalStops: rows.length,
        processedStops: 0,

        // ✅ já salva o “estado inicial” no banco (pra abrir depois)
        resultJson: rows as any,
        resultSavedAt: new Date(),
      },
      select: { id: true },
    });

    return NextResponse.json({ jobId: job.id, total: rows.length, rows });
  } catch (err: any) {
    console.error("Erro /api/import:", err);
    return NextResponse.json({ error: "Erro ao importar planilha" }, { status: 500 });
  }
}