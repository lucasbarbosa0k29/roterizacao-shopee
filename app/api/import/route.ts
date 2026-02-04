// app/api/import/route.ts
import * as XLSX from "xlsx";

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

  // padrões comuns
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
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "Arquivo não enviado" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rawRows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });

    if (rawRows.length > 0) {
      console.log("COLUNAS DETECTADAS:", Object.keys(rawRows[0]));
      console.log("TOTAL LINHAS:", rawRows.length);
    }

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

      const address = String(
        pickFirst(row, [
          "Destination Address",
          "DESTINATION ADDRESS",
          "Endereço",
          "Endereco",
          "ENDEREÇO",
          "ENDERECO",
          "Destination",
          "DESTINATION",
        ])
      ).trim();

      // opcional: se vier latitude/longitude na planilha (pra debug)
      const lat = parseMaybeNumber(pickFirst(row, ["Latitude", "LATITUDE", "lat", "LAT"]));
      const lng = parseMaybeNumber(pickFirst(row, ["Longitude", "LONGITUDE", "lng", "LNG", "Lon", "LON"]));

      return {
        sequence,
        bairro,
        city,
        cep,
        original: address || "",

        // debug opcional (não atrapalha nada)
        latFromSheet: lat,
        lngFromSheet: lng,
      };
    });

    return Response.json({ total: rows.length, rows });
  } catch (err: any) {
    console.error("Erro /api/import:", err);
    return Response.json({ error: "Erro ao importar planilha" }, { status: 500 });
  }
}