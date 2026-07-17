// app/api/import/route.ts
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { cleanupOldImportJobsIfNeeded } from "@/app/lib/import-job-cleanup";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getUserAccessSnapshot } from "@/app/lib/access-control";
import { parseWhatsAppTxtImport } from "@/app/lib/whatsapp-txt-import";
import { parseImileTxtImport } from "@/app/lib/imile-txt-import";

export const runtime = "nodejs";
const MAX_ROUTE_STOPS = 200;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMPORT_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".txt"]);

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return "";
  return fileName.slice(dotIndex).toLowerCase();
}

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

function hasDeliveryListCsvHeaders(rawRows: any[]) {
  const firstRow = rawRows[0];
  if (!firstRow || typeof firstRow !== "object") return false;

  const headers = Object.keys(firstRow)
    .map((key) => key.trim())
    .sort();

  return headers.join("|") === ["Address", "City", "Contact", "State"].sort().join("|");
}

function extractCepFromAddress(value: string) {
  const match = String(value || "").match(/\b(\d{5})-?(\d{3})\b/);
  if (!match) return "";
  return `${match[1]}-${match[2]}`;
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

    const fileName = String(file.name || "").trim();
    const extension = getFileExtension(fileName);

    if (!ALLOWED_IMPORT_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { error: "Extensão inválida. Envie um arquivo .xlsx, .xls ou .csv." },
        { status: 400 }
      );
    }

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: "Arquivo acima do limite máximo de 5 MB." },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const fileHash = createHash("sha256").update(buffer).digest("hex");

    if (currentUser.role !== "ADMIN") {
      const existingImportJob = await prisma.importJob.findFirst({
        where: {
          userId,
          fileHash,
        },
        select: {
          id: true,
          createdAt: true,
          userId: true,
          fileHash: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      console.info("[DUPLICATE_IMPORT_DEBUG]", {
        currentUserId: userId,
        fileName: file.name,
        fileHash,
        existingImportJobId: existingImportJob?.id,
        existingImportJobUserId: existingImportJob?.userId,
        existingImportJobHash: existingImportJob?.fileHash,
      });

      if (existingImportJob) {
        return NextResponse.json(
          {
            error:
              "Você já enviou essa planilha anteriormente. Acesse o histórico para continuar essa rota.",
            code: "DUPLICATE_IMPORT_FILE",
            existingImportJobId: existingImportJob.id,
            existingCreatedAt: existingImportJob.createdAt.toISOString(),
          },
          { status: 409 }
        );
      }
    }

    if (extension === ".txt") {
      const txtContent = buffer.toString("utf8");
      const parsedImile = parseImileTxtImport(txtContent);

      if (parsedImile.detected) {
        if (parsedImile.rejectedBlocks.length) {
          return NextResponse.json(
            {
              error:
                "Não foi possível reconhecer todos os blocos do TXT do iMile. Revise o arquivo e tente novamente.",
              code: "IMILE_TXT_REJECTED_BLOCKS",
              rejectedBlocks: parsedImile.rejectedBlocks,
              warnings: parsedImile.warnings,
              importMetadata: {
                source: "imile_txt",
                parsedCount: parsedImile.rows.length,
              },
            },
            { status: 400 }
          );
        }

        if (parsedImile.rows.length > MAX_ROUTE_STOPS) {
          return NextResponse.json(
            { error: "O TXT excede o limite máximo de 200 paradas." },
            { status: 400 }
          );
        }

        if (!parsedImile.rows.length) {
          return NextResponse.json(
            { error: "Nenhum pacote foi reconhecido no TXT do iMile." },
            { status: 400 }
          );
        }

        const job = await prisma.importJob.create({
          data: {
            userId,
            fileHash,
            originalName: file.name,
            storedName: null,
            status: "PENDING",
            totalStops: parsedImile.rows.length,
            processedStops: 0,
          },
          select: { id: true },
        });

        return NextResponse.json({
          jobId: job.id,
          total: parsedImile.rows.length,
          rows: parsedImile.rows,
          warnings: parsedImile.warnings,
          importMetadata: {
            source: "imile_txt",
            parsedCount: parsedImile.rows.length,
          },
        });
      }

      const parsedTxt = parseWhatsAppTxtImport(txtContent);

      if (parsedTxt.rejectedLines.length) {
        return NextResponse.json(
          {
            error:
              "Não foi possível reconhecer todas as linhas do TXT do WhatsApp. Revise o arquivo e tente novamente.",
            code: "WHATSAPP_TXT_REJECTED_LINES",
            rejectedLines: parsedTxt.rejectedLines,
            warnings: parsedTxt.warnings,
            importMetadata: {
              source: "whatsapp_txt",
              expectedCount: parsedTxt.expectedCount,
              parsedCount: parsedTxt.rows.length,
            },
          },
          { status: 400 }
        );
      }

      if (parsedTxt.rows.length > MAX_ROUTE_STOPS) {
        return NextResponse.json(
          { error: "O TXT excede o limite máximo de 200 paradas." },
          { status: 400 }
        );
      }

      if (!parsedTxt.rows.length) {
        return NextResponse.json(
          { error: "Nenhum pacote foi reconhecido no TXT do WhatsApp." },
          { status: 400 }
        );
      }

      const job = await prisma.importJob.create({
        data: {
          userId,
          fileHash,
          originalName: file.name,
          storedName: null,
          status: "PENDING",
          totalStops: parsedTxt.rows.length,
          processedStops: 0,
        },
        select: { id: true },
      });

      return NextResponse.json({
        jobId: job.id,
        total: parsedTxt.rows.length,
        rows: parsedTxt.rows,
        warnings: parsedTxt.warnings,
        importMetadata: {
          source: "whatsapp_txt",
          expectedCount: parsedTxt.expectedCount,
          parsedCount: parsedTxt.rows.length,
        },
      });
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rawRows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });

    if (rawRows.length > MAX_ROUTE_STOPS) {
      return NextResponse.json(
        { error: "A planilha excede o limite máximo de 200 paradas." },
        { status: 400 }
      );
    }

    const isDeliveryListCsv = extension === ".csv" && hasDeliveryListCsvHeaders(rawRows);

    const rows = isDeliveryListCsv
      ? XLSX.utils
          .sheet_to_json<any>(
            XLSX.read(buffer.toString("utf8"), { type: "string" }).Sheets[sheetName],
            { defval: "" }
          )
          .map((row: any, index: number) => {
            const original = String(row?.Address || "").trim();

            return {
              sequence: String(index + 1),
              bairro: "",
              city: normCity(String(row?.City || "").trim()),
              cep: extractCepFromAddress(original),
              original,
              latFromSheet: null,
              lngFromSheet: null,
            };
          })
      : rawRows.map((row: any) => {
          const sequence = String(
            pickFirst(row, ["Sequence", "SEQUENCE", "Sequência", "sequencia", "SEQ", "seq"])
          ).trim();

          const bairro = String(pickFirst(row, ["Bairro", "BAIRRO", "bairro"])).trim();

          const cityRaw = String(
            pickFirst(row, ["City", "CITY", "Cidade", "CIDADE", "city"])
          ).trim();
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
        fileHash,
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
