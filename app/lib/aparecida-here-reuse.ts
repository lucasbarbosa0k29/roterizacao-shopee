import { checkAparecidaStreetGeometry, checkAparecidaTerritory } from "@/app/lib/aparecida-territory";
import { compareAparecidaStreetForValidation, normalizeAparecidaTerritoryName } from "@/app/lib/aparecida-local-lots";
import { normalizeStreetText } from "@/app/lib/street-normalization";

type Position = { lat: number; lng: number };
type HereItem = { position?: Position; resultType?: string; address?: {
  street?: string; city?: string; district?: string; subdistrict?: string; postalCode?: string;
} };
type Expected = { rua: string; bairro: string; cidade: string; cep: string };
type Evidence = {
  territory: (bairro: string, position: Position) => boolean;
  street: (rua: string, position: Position) => boolean;
};
const localEvidence: Evidence = {
  territory: (bairro, position) => checkAparecidaTerritory(bairro, position, normalizeAparecidaTerritoryName).matched,
  street: (rua, position) => checkAparecidaStreetGeometry(rua, position,
    (left, right) => compareAparecidaStreetForValidation(left, right) === "STREET_MATCH").matched,
};

export function validateAparecidaHereContext(item: HereItem, expected: Expected, evidence: Evidence = localEvidence) {
  const position = item.position;
  const address = item.address || {};
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return false;
  if (normalizeStreetText(expected.cidade) !== "APARECIDA DE GOIANIA" ||
      normalizeStreetText(address.city || "") !== "APARECIDA DE GOIANIA") return false;
  if (!expected.bairro || compareAparecidaStreetForValidation(expected.rua, address.street || "") !== "STREET_MATCH") return false;
  const cep = (value: string) => value.replace(/\D/g, "");
  if (expected.cep && cep(expected.cep) !== cep(address.postalCode || "")) return false;
  // The provider's district label is never treated as geographic proof. Both
  // independent cadastral checks must confirm the spreadsheet's context.
  return evidence.territory(expected.bairro, position) && evidence.street(expected.rua, position);
}

export function selectAparecidaStreetCoordinate<T extends { it: HereItem; score: number }>(
  entries: T[], expected: Expected, evidence: Evidence = localEvidence,
) {
  const eligible = entries.filter(entry => entry.it.resultType === "street" &&
    validateAparecidaHereContext(entry.it, expected, evidence));
  // Preserve the existing 250 m ambiguity threshold. Check all eligible pairs,
  // not just the first two, and never average coordinates or pick arbitrarily.
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i].it.position!, b = eligible[j].it.position!;
    const rad = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
    if (2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, h))) > 250) return null;
  }
  const best = eligible.slice().sort((a, b) => b.score - a.score)[0];
  return best ? { item: best.it, score: best.score, reason: "PARTIAL_STREET_LEVEL_MATCH" as const } : null;
}
