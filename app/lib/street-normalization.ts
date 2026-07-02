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
    .replace(/\b([A-Z]{1,4})([0-9]+)\s+([A-Z])\b/g, "$1$2$3");
}

export function normalizeStreetNameWithoutType(input: string) {
  const withoutStreetType = normalizeStreetText(input)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STREET_TYPE_WORDS.has(token))
    .join(" ");

  return normalizeStreetCodeSpacing(withoutStreetType);
}
