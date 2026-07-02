import { normalizeStreetNameWithoutType, normalizeStreetText } from "@/app/lib/street-normalization";

export type GoianiaStreetComparison =
  | "STREET_MATCH"
  | "STREET_PARTIAL_MATCH"
  | "STREET_MISMATCH"
  | "STREET_UNKNOWN";

const WEAK_TOKENS = new Set([
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
  "SETOR",
  "JARDIM",
  "RESIDENCIAL",
  "CONDOMINIO",
  "QD",
  "QUADRA",
  "LT",
  "LOTE",
  "GOIANIA",
  "GO",
  "BRASIL",
]);

function tokensFor(input: string) {
  return normalizeGoianiaStreetName(input).split(/\s+/).filter(Boolean);
}

function meaningfulTokens(input: string) {
  return tokensFor(input).filter((token) => {
    if (WEAK_TOKENS.has(token)) return false;
    if (/^[A-Z]$/.test(token)) return false;
    return token.length > 1 || /[A-Z]+[0-9]+|[0-9]+[A-Z]+/.test(token);
  });
}

function isUnknownStreet(input: string) {
  const normalized = normalizeStreetText(input);
  if (!normalized) return true;
  if (/^\d{5}\s?\d{3}$/.test(normalized)) return true;
  if (/^\d{5}\s?\d{3}\b/.test(normalized) && !/\b(RUA|R|AVENIDA|AV|ALAMEDA|AL|TRAVESSA|TV|VIELA|PRACA)\b/.test(normalized)) {
    return true;
  }
  return false;
}

function hasStrongCodeMatch(input: string, candidate: string) {
  const inputCodes = meaningfulTokens(input).filter((token) => /^[A-Z]{1,4}[0-9]+[A-Z]?$/.test(token));
  const candidateCodes = new Set(
    meaningfulTokens(candidate).filter((token) => /^[A-Z]{1,4}[0-9]+[A-Z]?$/.test(token)),
  );

  return inputCodes.some((token) => candidateCodes.has(token));
}

function hasPartialNameMatch(input: string, candidate: string) {
  const inputTokens = meaningfulTokens(input);
  const candidateTokens = new Set(meaningfulTokens(candidate));

  if (inputTokens.length < 2 || candidateTokens.size < 2) return false;

  let matched = 0;
  for (const token of inputTokens) {
    if (candidateTokens.has(token)) {
      matched += 1;
      continue;
    }

    if (token.length === 1) {
      for (const candidateToken of candidateTokens) {
        if (candidateToken.startsWith(token) && candidateToken.length > 2) {
          matched += 1;
          break;
        }
      }
    }
  }

  return matched >= 2 && matched / inputTokens.length >= 0.6;
}

export function normalizeGoianiaStreetName(input: string) {
  return normalizeStreetNameWithoutType(input);
}

export function compareGoianiaStreet(inputStreet: string, candidateStreet: string): GoianiaStreetComparison {
  if (isUnknownStreet(inputStreet) || isUnknownStreet(candidateStreet)) return "STREET_UNKNOWN";

  const input = normalizeGoianiaStreetName(inputStreet);
  const candidate = normalizeGoianiaStreetName(candidateStreet);

  if (!input || !candidate) return "STREET_UNKNOWN";
  if (input === candidate) return "STREET_MATCH";
  if (hasStrongCodeMatch(input, candidate)) return "STREET_MATCH";
  if (hasPartialNameMatch(input, candidate)) return "STREET_PARTIAL_MATCH";

  return "STREET_MISMATCH";
}
