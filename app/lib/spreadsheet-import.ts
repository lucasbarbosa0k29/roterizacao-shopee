import * as XLSX from "xlsx";

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROUTE_STOPS = 200;

export class SpreadsheetImportError extends Error {}

// Only the first worksheet is used by Rotta. Avoid parsing unused worksheets and
// rich-text HTML. Keep the complete first sheet so sparse/blank rows are not lost.
export function readImportRows(buffer: Buffer, extension: string): Record<string, unknown>[] {
  if (!buffer.length) throw new SpreadsheetImportError("O arquivo está vazio.");
  if (buffer.length > MAX_IMPORT_FILE_BYTES) throw new SpreadsheetImportError("Arquivo acima do limite máximo de 5 MB.");
  let input: Buffer | string = buffer;
  if (extension === ".csv") {
    try { input = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch { /* Retain SheetJS's legacy codepage handling for non-UTF-8 CSV. */ }
  }
  let rows: Record<string, unknown>[];
  try {
    const workbook = XLSX.read(input, { type: typeof input === "string" ? "string" : "buffer", sheets: 0, cellHTML: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("Missing worksheet");
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  } catch {
    // Parser errors may contain spreadsheet contents. Never expose or log them.
    throw new SpreadsheetImportError("Arquivo inválido ou planilha não suportada.");
  }
  if (!rows.length) throw new SpreadsheetImportError("A planilha não contém paradas para importar.");
  if (rows.length > MAX_ROUTE_STOPS) throw new SpreadsheetImportError("A planilha excede o limite máximo de 200 paradas.");
  return rows;
}
