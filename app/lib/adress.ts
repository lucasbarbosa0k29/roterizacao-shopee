// src/lib/address.ts
// (ou app/lib/address.ts – use o caminho que você já usa)

const SMALL_WORDS = new Set([
  "DE", "DA", "DO", "DAS", "DOS", "E",
]);

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cleanupSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

// ===============================
// CONVERSÃO NÚMEROS POR EXTENSO
// ===============================

// Converte "VINTE E CINCO" -> "25"
function wordsToNumberPT(words: string): number | null {
  const w = words
    .toUpperCase()
    .split(" ")
    .filter(Boolean);

  const units: Record<string, number> = {
    "ZERO": 0, "UM": 1, "UMA": 1, "DOIS": 2, "DUAS": 2,
    "TRES": 3, "QUATRO": 4, "CINCO": 5, "SEIS": 6,
    "SETE": 7, "OITO": 8, "NOVE": 9,
  };

  const teens: Record<string, number> = {
    "DEZ": 10, "ONZE": 11, "DOZE": 12, "TREZE": 13,
    "QUATORZE": 14, "CATORZE": 14, "QUINZE": 15,
    "DEZESSEIS": 16, "DEZESSETE": 17,
    "DEZOITO": 18, "DEZENOVE": 19,
  };

  const tens: Record<string, number> = {
    "VINTE": 20, "TRINTA": 30, "QUARENTA": 40,
    "CINQUENTA": 50, "SESSENTA": 60,
    "SETENTA": 70, "OITENTA": 80, "NOVENTA": 90,
  };

  if (w.length === 1) {
    if (w[0] in units) return units[w[0]];
    if (w[0] in teens) return teens[w[0]];
    if (w[0] in tens) return tens[w[0]];
    return null;
  }

  if (w.length === 2) {
    if (w[0] in tens && w[1] in units) {
      return tens[w[0]] + units[w[1]];
    }
    return null;
  }

  if (w.length === 3) {
    if (w[0] in tens && w[1] === "E" && w[2] in units) {
      return tens[w[0]] + units[w[2]];
    }
    return null;
  }

  return null;
}

// ===============================
// NORMALIZA LOGRADOURO
// ===============================

function normalizeRuaNumeroLetra(s: string) {
  let t = stripAccents(String(s).toUpperCase());

  t = t.replace(/[-_]/g, " ");
  t = t.replace(/[^\w\s]/g, " ");
  t = cleanupSpaces(t);

  const tokens = t.split(" ");

  for (let i = 0; i < tokens.length; i++) {
    const w3 = tokens.slice(i, i + 3).join(" ");
    const n3 = wordsToNumberPT(w3);
    if (n3 !== null) {
      tokens.splice(i, 3, String(n3));
      break;
    }

    const w2 = tokens.slice(i, i + 2).join(" ");
    const n2 = wordsToNumberPT(w2);
    if (n2 !== null) {
      tokens.splice(i, 2, String(n2));
      break;
    }

    const w1 = tokens[i];
    const n1 = wordsToNumberPT(w1);
    if (n1 !== null) {
      tokens.splice(i, 1, String(n1));
      break;
    }
  }

  const cleaned = tokens.filter(
    (tok) => !(SMALL_WORDS.has(tok) && tok.length <= 3)
  );

  return cleanupSpaces(cleaned.join(" "));
}

// ===============================
// EXTRAÇÃO QUADRA / LOTE
// ===============================

export function extractQuadraLote(raw: string): {
  quadra: string;
  lote: string;
  cleaned: string;
} {
  const text = String(raw || " ");

  const RE_QUADRA = /\b(?:Q|QD|QUADRA)\s*[:\-]?\s*0*([0-9]{1,4}[A-Z]?)\b/gi;
  const RE_LOTE = /\b(?:L|LT|LOTE)\s*[:\-]?\s*0*([0-9]{1,4}[A-Z]?)\b/gi;

  let quadra = "";
  let lote = "";

  let m: RegExpExecArray | null;

  while ((m = RE_QUADRA.exec(text)) !== null) {
    quadra = String(m[1] || "").trim();
  }

  while ((m = RE_LOTE.exec(text)) !== null) {
    lote = String(m[1] || "").trim();
  }

  const cleaned = text
    .replace(RE_QUADRA, " ")
    .replace(RE_LOTE, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { quadra, lote, cleaned };
}

// ===============================
// FUNÇÃO PRINCIPAL DE BUSCA
// ===============================

export function buildSearchAddress(original: string) {
  const { cleaned } = extractQuadraLote(original);
  return normalizeRuaNumeroLetra(cleaned);
}