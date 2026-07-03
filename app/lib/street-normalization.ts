export const STREET_TYPE_WORDS = new Set([
  "RUA",
  "R",
  "AVENIDA",
  "AV",
  "ALAMEDA",
  "AL",
  "TRAVESSA",
  "TV",
  "VIELA",
  "PRACA",
]);

export function normalizeStreetText(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeStreetCodeSpacing(input: string) {
  return input
    .replace(/\b([A-Z]{1,4})\s+0*([0-9]+)([A-Z]?)\b/g, "$1$2$3")
    .replace(/\b([A-Z]{1,4})0+([0-9]+)([A-Z]?)\b/g, "$1$2$3")
    .replace(/\b([A-Z]{1,4})([0-9]+)\s+([A-Z])\b/g, "$1$2$3")
    .replace(/\b([0-9]+)\s+([A-Z])\b/g, "$1$2");
}

export function normalizeStreetNameWithoutType(input: string) {
  const withoutStreetType = normalizeStreetText(input)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STREET_TYPE_WORDS.has(token))
    .join(" ");

  return normalizeStreetCodeSpacing(withoutStreetType);
}

const STREET_NUMBER_UNITS: Record<string, number> = {
  ZERO: 0,
  UM: 1,
  UMA: 1,
  DOIS: 2,
  DUAS: 2,
  TRES: 3,
  QUATRO: 4,
  CINCO: 5,
  SEIS: 6,
  SETE: 7,
  OITO: 8,
  NOVE: 9,
};

const STREET_NUMBER_TEENS: Record<string, number> = {
  DEZ: 10,
  ONZE: 11,
  DOZE: 12,
  TREZE: 13,
  QUATORZE: 14,
  CATORZE: 14,
  QUINZE: 15,
  DEZESSEIS: 16,
  DEZESSETE: 17,
  DEZOITO: 18,
  DEZENOVE: 19,
};

const STREET_NUMBER_TENS: Record<string, number> = {
  VINTE: 20,
  TRINTA: 30,
  QUARENTA: 40,
  CINQUENTA: 50,
  SESSENTA: 60,
  SETENTA: 70,
  OITENTA: 80,
  NOVENTA: 90,
};

function parseStreetNumberWords(tokens: string[], index: number) {
  const token = tokens[index];

  if (STREET_NUMBER_UNITS[token] != null) return { value: STREET_NUMBER_UNITS[token], length: 1 };
  if (STREET_NUMBER_TEENS[token] != null) return { value: STREET_NUMBER_TEENS[token], length: 1 };

  const ten = STREET_NUMBER_TENS[token];
  if (ten == null) return null;

  if (tokens[index + 1] === "E" && STREET_NUMBER_UNITS[tokens[index + 2]] != null) {
    return { value: ten + STREET_NUMBER_UNITS[tokens[index + 2]], length: 3 };
  }

  return { value: ten, length: 1 };
}

export function normalizeCanonicalNumericStreetName(input: string) {
  const tokens = normalizeStreetNameWithoutType(input).split(/\s+/).filter(Boolean);
  const normalizedTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const parsed = parseStreetNumberWords(tokens, index);
    if (parsed && parsed.value >= 0 && parsed.value <= 99) {
      normalizedTokens.push(String(parsed.value));
      index += parsed.length - 1;
      continue;
    }

    normalizedTokens.push(tokens[index]);
  }

  return normalizeStreetCodeSpacing(normalizedTokens.join(" "));
}
