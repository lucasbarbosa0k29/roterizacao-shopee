const VALID_BRAZILIAN_DDDS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

const OBVIOUS_FAKE_NUMBERS = new Set([
  "12345678900",
  "12345678901",
  "98765432100",
]);

const OBVIOUS_FAKE_LOCAL_NUMBERS = new Set([
  "12345678",
  "123456789",
  "98765432",
  "987654321",
]);

export const INVALID_WHATSAPP_MESSAGE = "Informe um WhatsApp válido com DDD.";
export const DUPLICATE_WHATSAPP_MESSAGE = "Este WhatsApp já está cadastrado no Rotta.";

export function cleanWhatsapp(whatsapp: string) {
  return String(whatsapp ?? "").replace(/\D/g, "");
}

export function isValidBrazilianWhatsapp(whatsapp: string) {
  const digits = cleanWhatsapp(whatsapp);

  if (!/^\d{10,11}$/.test(digits)) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  if (OBVIOUS_FAKE_NUMBERS.has(digits)) return false;

  const ddd = digits.slice(0, 2);
  const localNumber = digits.slice(2);

  if (!VALID_BRAZILIAN_DDDS.has(ddd)) return false;
  if (/^0+$/.test(localNumber)) return false;
  if (OBVIOUS_FAKE_LOCAL_NUMBERS.has(localNumber)) return false;
  if (digits.length === 11 && digits[2] !== "9") return false;

  return true;
}

export function normalizeBrazilianWhatsapp(whatsapp: string) {
  const digits = cleanWhatsapp(whatsapp);
  return isValidBrazilianWhatsapp(digits) ? digits : null;
}
