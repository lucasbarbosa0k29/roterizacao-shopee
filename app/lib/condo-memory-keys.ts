export type CondoMemoryKeyKind = "condo_physical" | "condo_name";

export type CondoMemoryKey = {
  kind: CondoMemoryKeyKind;
  key: string;
};

export type CondoMemoryKeyPlan = {
  shouldAttempt: boolean;
  hasVerticalSignal: boolean;
  hasBlockedCadastralSignal: boolean;
  physicalKey: string | null;
  nameKey: string | null;
  keys: CondoMemoryKey[];
};

const STREET_PREFIX_RE = /^(RUA|AVENIDA|AV|ALAMEDA|TRAVESSA|TV|VIELA|VIA|R)\b/;
const STREET_PREFIX_CLEAN_RE = /^(RUA|AVENIDA|AV|ALAMEDA|TRAVESSA|TV|VIELA|VIA|R)\b\s*/;
const VERTICAL_SIGNAL_RE = /\b(APT|APTO|APART|APARTAMENTO|BLOCO|TORRE|ANDAR|SALA|EDIFICIO|EDIF|PREDIO|CONDOMINIO|COND)\b/;
const RESIDENTIAL_SIGNAL_RE = /\b(RESIDENCIAL|RES)\b/;
const BLOCKED_SIGNAL_RES: RegExp[] = [
  /\bQD\b/,
  /\bQUADRA\b/,
  /\bLT\b/,
  /\bLOTE\b/,
  /\bCASA\b/,
  /\bLOTEAMENTO\b/,
  /\bJARDINS\b/,
  /\bALPHAVILLE\b/,
];

const LEADING_DESCRIPTOR_RE = /^(?:EDIFICIO|EDIF|PREDIO|PRED|CONDOMINIO|COND|RESIDENCIAL|RES|APT|APTO|APARTAMENTO|APART|BLOCO|BL|TORRE|ANDAR|SALA)\b[\s\-:]*/;
const TRAILING_UNIT_RE = /\b(?:APT|APTO|APART|APARTAMENTO|BLOCO|TORRE|ANDAR|SALA)\b\s*[-:]?\s*[A-Z0-9\/\-]+(?:\s+[A-Z0-9\/\-]+)?$/;
const TRAILING_NUMBER_RE = /\b(?:N(?:[ºO])?|NUM(?:ERO)?|NO)\b\s*[-:]?\s*[A-Z0-9\/\-]+$/;

export function normalizeMemoryKey(text: string) {
  return String(text || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAddressSegments(address: string) {
  return String(address || "")
    .split(/[,;/|]+/g)
    .map((part) => normalizeMemoryKey(part))
    .filter(Boolean);
}

function stripTrailingNoise(value: string) {
  let current = normalizeMemoryKey(value);

  for (let i = 0; i < 6; i += 1) {
    const next = current
      .replace(TRAILING_NUMBER_RE, " ")
      .replace(TRAILING_UNIT_RE, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (next === current) break;
    current = next;
  }

  return current;
}

function stripLeadingDescriptors(value: string) {
  let current = normalizeMemoryKey(value);

  for (let i = 0; i < 6; i += 1) {
    const next = current.replace(LEADING_DESCRIPTOR_RE, "").trim();
    if (next === current) break;
    current = next;
  }

  return current;
}

function findStreetSegmentIndex(segments: string[]) {
  return segments.findIndex((segment) => STREET_PREFIX_RE.test(segment));
}

function extractStreetName(segment: string) {
  const cleaned = normalizeMemoryKey(segment).replace(STREET_PREFIX_CLEAN_RE, "").trim();
  if (!cleaned) return null;

  const withoutInlineNumber = cleaned
    .replace(/\b(?:N(?:[ºO])?|NUM(?:ERO)?|NO)\b\s*[-:]?\s*(\d+[A-Z]?)$/i, "")
    .replace(/\b(\d+[A-Z]?)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return withoutInlineNumber || cleaned;
}

function extractStreetNumberFromSegment(segment: string) {
  const cleaned = normalizeMemoryKey(segment);
  const markerMatch = cleaned.match(/\b(?:N(?:[ºO])?|NUM(?:ERO)?|NO)\b\s*[-:]?\s*(\d+[A-Z]?)$/i);
  if (markerMatch) return markerMatch[1] || null;

  const tailMatch = cleaned.match(/\b(\d+[A-Z]?)$/i);
  if (tailMatch) return tailMatch[1] || null;

  return null;
}

function extractNearestStreetNumber(segments: string[], streetIndex: number) {
  let best: { number: string; distance: number; afterStreet: boolean } | null = null;

  for (let i = 0; i < segments.length; i += 1) {
    if (i === streetIndex) continue;

    const segment = segments[i];
    if (VERTICAL_SIGNAL_RE.test(segment)) continue;
    if (BLOCKED_SIGNAL_RES.some((rx) => rx.test(segment))) continue;

    const number = extractStreetNumberFromSegment(segment);
    if (!number) continue;

    const distance = Math.abs(i - streetIndex);
    const afterStreet = i > streetIndex;
    const candidate = { number, distance, afterStreet };

    if (!best) {
      best = candidate;
      continue;
    }

    if (candidate.distance < best.distance) {
      best = candidate;
      continue;
    }

    if (candidate.distance === best.distance && candidate.afterStreet && !best.afterStreet) {
      best = candidate;
    }
  }

  return best?.number || null;
}

function extractBuildingName(segments: string[], streetIndex: number) {
  const source = streetIndex > 0 ? segments.slice(0, streetIndex).join(" ") : segments.join(" ");
  const cleaned = stripLeadingDescriptors(stripTrailingNoise(source));

  if (!cleaned || !/[A-Z]/.test(cleaned) || /^\d+$/.test(cleaned)) return null;

  return cleaned;
}

function hasBlockedCadastralSignal(address: string) {
  return BLOCKED_SIGNAL_RES.some((rx) => rx.test(normalizeMemoryKey(address)));
}

function hasVerticalSignal(address: string) {
  const normalized = normalizeMemoryKey(address);
  return (
    VERTICAL_SIGNAL_RE.test(normalized) ||
    (RESIDENTIAL_SIGNAL_RE.test(normalized) &&
      /\b(APT|APTO|APART|APARTAMENTO|BLOCO|TORRE|ANDAR|SALA)\b/.test(normalized))
  );
}

export function buildCondoMemoryKeyPlan(address: string, city: string): CondoMemoryKeyPlan {
  const normalizedAddress = normalizeMemoryKey(address);
  const normalizedCity = normalizeMemoryKey(city);
  const segments = splitAddressSegments(address);
  const vertical = hasVerticalSignal(normalizedAddress);
  const blocked = hasBlockedCadastralSignal(normalizedAddress);
  const shouldAttempt = vertical && !blocked;

  if (!shouldAttempt) {
    return {
      shouldAttempt: false,
      hasVerticalSignal: vertical,
      hasBlockedCadastralSignal: blocked,
      physicalKey: null,
      nameKey: null,
      keys: [],
    };
  }

  const streetIndex = findStreetSegmentIndex(segments);
  const streetName =
    streetIndex >= 0 ? extractStreetName(segments[streetIndex]) : null;
  const streetNumber =
    streetIndex >= 0 ? extractNearestStreetNumber(segments, streetIndex) : null;
  const buildingName = extractBuildingName(segments, streetIndex);

  const physicalKey =
    streetName && streetNumber
      ? normalizeMemoryKey(`${streetName} ${streetNumber} ${normalizedCity}`)
      : null;
  const nameKey = buildingName
    ? normalizeMemoryKey(`${buildingName} ${normalizedCity}`)
    : null;

  const keys: CondoMemoryKey[] = [];
  if (physicalKey) {
    keys.push({ kind: "condo_physical", key: physicalKey });
  }
  if (nameKey && nameKey !== physicalKey) {
    keys.push({ kind: "condo_name", key: nameKey });
  }

  return {
    shouldAttempt: keys.length > 0,
    hasVerticalSignal: vertical,
    hasBlockedCadastralSignal: blocked,
    physicalKey,
    nameKey,
    keys,
  };
}
