export type ImileTxtImportRow = {
  sequence: string;
  bairro: string;
  city: string;
  cep: string;
  original: string;
  observacao: string;
  cliente: string;
  sourceType: "IMILE";
  pacoteNumero: number;
  quantidadePacotes: number | null;
  estado?: string;
};

export type ImileTxtRejectedBlock = {
  line: number;
  pacoteNumero: number | null;
  reason: string;
};

export type ImileTxtParseResult = {
  detected: boolean;
  rows: ImileTxtImportRow[];
  rejectedBlocks: ImileTxtRejectedBlock[];
  warnings: string[];
};

type SourceLine = {
  line: number;
  text: string;
};

const INVISIBLE_ANDROID_CHARS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const PACKAGE_MARKER = /^PACOTE\s+(\d+)\s*$/i;

export function cleanImileTxtValue(value: string) {
  return String(value || "")
    .replace(INVISIBLE_ANDROID_CHARS, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .trim();
}

function stripDiacritics(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function labelAndValue(line: string) {
  const colonIndex = line.indexOf(":");
  if (colonIndex < 0) return null;

  const label = stripDiacritics(cleanImileTxtValue(line.slice(0, colonIndex))).toUpperCase();
  const value = cleanImileTxtValue(line.slice(colonIndex + 1));

  return { label, value };
}

function normalizeState(value: string) {
  const key = stripDiacritics(value).toUpperCase().trim();
  if (key === "GOIAS" || key === "GO") return "GO";
  return cleanImileTxtValue(value);
}

function parseAddressContext(address: string) {
  const parts = address
    .split(",")
    .map((part) => cleanImileTxtValue(part))
    .filter(Boolean);

  if (parts.length < 3) {
    return { bairro: "", city: "", estado: "" };
  }

  const estado = normalizeState(parts[parts.length - 1] || "");
  const city = cleanImileTxtValue(parts[parts.length - 2] || "");
  const bairro = cleanImileTxtValue(parts[parts.length - 3] || "");

  return { bairro, city, estado };
}

function extractQuantity(cliente: string) {
  const match = cleanImileTxtValue(cliente).match(/\((\d+)\)\s*$/);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function hasCompleteImileStructure(lines: SourceLine[]) {
  for (let i = 0; i < lines.length; i += 1) {
    if (!PACKAGE_MARKER.test(lines[i].text)) continue;

    let hasName = false;
    let hasAddress = false;

    for (let j = i + 1; j < lines.length; j += 1) {
      if (PACKAGE_MARKER.test(lines[j].text)) break;

      const pair = labelAndValue(lines[j].text);
      if (!pair) continue;
      if (pair.label === "NOME" && pair.value) hasName = true;
      if (pair.label === "ENDERECO" && pair.value) hasAddress = true;
    }

    if (hasName && hasAddress) return true;
  }

  return false;
}

export function parseImileTxtImport(text: string): ImileTxtParseResult {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line, index) => ({
      line: index + 1,
      text: cleanImileTxtValue(line),
    }));

  const detected = hasCompleteImileStructure(lines);
  const rows: ImileTxtImportRow[] = [];
  const rejectedBlocks: ImileTxtRejectedBlock[] = [];

  if (!detected) {
    return {
      detected: false,
      rows,
      rejectedBlocks,
      warnings: [],
    };
  }

  for (let i = 0; i < lines.length; i += 1) {
    const markerMatch = lines[i].text.match(PACKAGE_MARKER);
    if (!markerMatch) continue;

    const pacoteNumero = Number(markerMatch[1]);
    const blockStartLine = lines[i].line;
    let nome = "";
    let endereco = "";

    for (let j = i + 1; j < lines.length; j += 1) {
      if (PACKAGE_MARKER.test(lines[j].text)) {
        i = j - 1;
        break;
      }

      const pair = labelAndValue(lines[j].text);
      if (!pair) {
        if (j === lines.length - 1) i = j;
        continue;
      }

      if (pair.label === "NOME") nome = pair.value;
      if (pair.label === "ENDERECO") endereco = pair.value;

      if (j === lines.length - 1) i = j;
    }

    if (!Number.isFinite(pacoteNumero) || !nome || !endereco) {
      rejectedBlocks.push({
        line: blockStartLine,
        pacoteNumero: Number.isFinite(pacoteNumero) ? pacoteNumero : null,
        reason: "Bloco iMile sem PACOTE, Nome ou Endereco completo.",
      });
      continue;
    }

    const context = parseAddressContext(endereco);

    rows.push({
      sequence: String(pacoteNumero),
      bairro: context.bairro,
      city: context.city,
      estado: context.estado,
      cep: "",
      original: endereco,
      observacao: "",
      cliente: nome,
      sourceType: "IMILE",
      pacoteNumero,
      quantidadePacotes: extractQuantity(nome),
    });
  }

  return {
    detected: true,
    rows,
    rejectedBlocks,
    warnings: [],
  };
}
