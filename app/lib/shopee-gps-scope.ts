import { normalizeStreetText } from "@/app/lib/street-normalization";

const cities = new Set(["APARECIDA DE GOIANIA", "GOIANIA", "TRINDADE", "HIDROLANDIA"]);

export function isShopeeGpsCity(city: string) {
  return cities.has(normalizeStreetText(city).replace(/ (?:GO|GOIAS)$/, ""));
}
