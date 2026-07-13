import fs from "fs";
import path from "path";
import type { GoianiaStreetComparison } from "@/app/lib/goiania-street-normalization";

export type ParqueAtheneuStreetLotBlockedReason =
  | "NOT_ATHENEU"
  | "MISSING_UNIT_STREET"
  | "MISSING_EXPLICIT_LOT"
  | "LOT_AMBIGUOUS"
  | "STREET_NOT_INDEXED"
  | "LOT_NOT_FOUND"
  | "STREET_MISMATCH"
  | "MULTIPLE_CANDIDATES"
  | "LOW_ASSOCIATION_CONFIDENCE"
  | "GENERIC_AREA_CANDIDATE"
  | "INVALID_QUADRA_FOR_RULE"
  | "CITY_NOT_GOIANIA";

export type ParqueAtheneuStreetLotCandidate = {
  street: string;
  streetKey: string;
  lot: string;
  lotKey: string;
  lat: number;
  lng: number;
  distanceToStreetM: number;
  confidence: "HIGH";
  sourceIndex: number;
};

export type ParqueAtheneuStreetLotResult = {
  attempted: boolean;
  found: boolean;
  usedAsFinal: boolean;
  key: string | null;
  candidatesCount: number;
  streetCompatibility: GoianiaStreetComparison | null;
  confidence: "HIGH" | null;
  blockedReason: ParqueAtheneuStreetLotBlockedReason | null;
  distanceToStreetM: number | null;
  candidate: ParqueAtheneuStreetLotCandidate | null;
};

type ParqueAtheneuStreetLotIndex = {
  metadata?: {
    maxDistanceM?: number;
  };
  keys?: Record<string, ParqueAtheneuStreetLotCandidate[]>;
};

const ATHENEU_STREET_LOT_PATH = path.join(
  process.cwd(),
  "app",
  "data",
  "goiania_local_first_special",
  "atheneu-street-lots.json",
);

let cache: ParqueAtheneuStreetLotIndex | null | undefined;

function compact(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeText(value: unknown) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeParqueAtheneuStreetKey(value: unknown) {
  return normalizeText(value)
    .replace(/^(RUA|R)\s+/, "")
    .replace(/\b(UNID|UN|U)\b/g, "UNIDADE")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasParqueAtheneuUnitStreet(value: unknown) {
  return /\b(?:RUA|R)\s+[A-Z0-9]+\s+(?:UNIDADE|UNID\.?|UN\.?|U)\s*[-:]?\s*[A-Z0-9]+\b/i.test(
    compact(value),
  );
}

export function extractExplicitParqueAtheneuLot(value: unknown) {
  const text = compact(value);
  const match = text.match(/\b(?:LOTE|LT|L(?![A-Z]))\.?\s*[-:]?\s*([A-Z0-9]*\d[A-Z0-9]*(?:[/-][A-Z0-9]*\d[A-Z0-9]*)?)\b/i);
  if (!match) return { lot: "", explicit: false, ambiguous: false };

  const lot = normalizeParqueAtheneuLotKey(match[1]);
  return {
    lot,
    explicit: !!lot,
    ambiguous: !lot || isGenericAreaLot(lot),
  };
}

export function normalizeParqueAtheneuLotKey(value: unknown) {
  return normalizeText(value).replace(/^0+(\d+)$/, "$1");
}

function isGoianiaCity(value: unknown) {
  const key = normalizeText(value).replace(/\s+/g, "");
  return key.includes("GOIANIA") && !key.includes("APARECIDA");
}

function isAtheneuBairro(value: unknown) {
  const key = normalizeText(value);
  if (!key) return false;
  return key === "ATHENEU" || key === "PARQUE ATHENEU" || key === "PRQ ATHENEU" || key === "PQ ATHENEU";
}

function isQuadraUnavailableForAtheneuRule(value: unknown) {
  const key = normalizeText(value);
  return !key || key === "-" || key === "0" || key === "00" || key === "S N" || key === "SN";
}

function isGenericAreaLot(value: unknown) {
  const key = normalizeText(value);
  if (!key) return true;
  if (key === "-" || key === "S N" || key === "SN") return true;
  return key.includes("APM") || key.includes("AREA");
}

function loadIndex() {
  if (cache !== undefined) return cache;
  if (!fs.existsSync(ATHENEU_STREET_LOT_PATH)) {
    cache = null;
    return cache;
  }
  cache = JSON.parse(fs.readFileSync(ATHENEU_STREET_LOT_PATH, "utf8").replace(/^\uFEFF/, ""));
  return cache;
}

function blocked(
  attempted: boolean,
  blockedReason: ParqueAtheneuStreetLotBlockedReason,
  extras: Partial<ParqueAtheneuStreetLotResult> = {},
): ParqueAtheneuStreetLotResult {
  return {
    attempted,
    found: false,
    usedAsFinal: false,
    key: null,
    candidatesCount: 0,
    streetCompatibility: null,
    confidence: null,
    blockedReason,
    distanceToStreetM: null,
    candidate: null,
    ...extras,
  };
}

export function resolveParqueAtheneuStreetLotLocalFirst(args: {
  city: string;
  bairro: string;
  rua: string;
  lote: string;
  quadra?: string | null;
  originalAddress?: string | null;
}): ParqueAtheneuStreetLotResult {
  if (!isGoianiaCity(args.city)) return blocked(false, "CITY_NOT_GOIANIA");
  if (!isAtheneuBairro(args.bairro)) return blocked(false, "NOT_ATHENEU");
  if (!isQuadraUnavailableForAtheneuRule(args.quadra)) return blocked(false, "INVALID_QUADRA_FOR_RULE");

  const rua = compact(args.rua);
  if (!hasParqueAtheneuUnitStreet(rua)) return blocked(true, "MISSING_UNIT_STREET");

  const explicitFromAddress = extractExplicitParqueAtheneuLot(args.originalAddress || "");
  const lotKey = explicitFromAddress.explicit ? explicitFromAddress.lot : normalizeParqueAtheneuLotKey(args.lote);
  if (!explicitFromAddress.explicit) return blocked(true, "MISSING_EXPLICIT_LOT");
  if (!lotKey || explicitFromAddress.ambiguous || isGenericAreaLot(lotKey)) return blocked(true, "LOT_AMBIGUOUS");

  const streetKey = normalizeParqueAtheneuStreetKey(rua);
  if (!streetKey.includes("UNIDADE")) return blocked(true, "MISSING_UNIT_STREET");

  const index = loadIndex();
  if (!index?.keys) return blocked(true, "STREET_NOT_INDEXED");

  const key = `${streetKey}|${lotKey}`;
  const candidates = index.keys[key] || [];
  const streetHasAnyLot = Object.keys(index.keys).some((candidateKey) => candidateKey.startsWith(`${streetKey}|`));
  if (!streetHasAnyLot) return blocked(true, "STREET_NOT_INDEXED", { key });
  if (!candidates.length) return blocked(true, "LOT_NOT_FOUND", { key });
  if (candidates.length > 1) {
    return blocked(true, "MULTIPLE_CANDIDATES", {
      key,
      candidatesCount: candidates.length,
      streetCompatibility: "STREET_MATCH",
    });
  }

  const candidate = candidates[0];
  const candidateStreetKey = normalizeParqueAtheneuStreetKey(candidate.street);
  const streetCompatibility: GoianiaStreetComparison =
    candidateStreetKey === streetKey ? "STREET_MATCH" : "STREET_MISMATCH";
  if (streetCompatibility !== "STREET_MATCH") {
    return blocked(true, "STREET_MISMATCH", {
      key,
      candidatesCount: candidates.length,
      streetCompatibility,
      candidate,
    });
  }

  if (candidate.confidence !== "HIGH" || !Number.isFinite(candidate.distanceToStreetM)) {
    return blocked(true, "LOW_ASSOCIATION_CONFIDENCE", {
      key,
      candidatesCount: candidates.length,
      streetCompatibility,
      candidate,
    });
  }

  if (candidate.distanceToStreetM > (index.metadata?.maxDistanceM ?? 50)) {
    return blocked(true, "LOW_ASSOCIATION_CONFIDENCE", {
      key,
      candidatesCount: candidates.length,
      streetCompatibility,
      candidate,
      distanceToStreetM: candidate.distanceToStreetM,
    });
  }

  if (isGenericAreaLot(candidate.lot)) {
    return blocked(true, "GENERIC_AREA_CANDIDATE", {
      key,
      candidatesCount: candidates.length,
      streetCompatibility,
      candidate,
    });
  }

  return {
    attempted: true,
    found: true,
    usedAsFinal: false,
    key,
    candidatesCount: 1,
    streetCompatibility,
    confidence: "HIGH",
    blockedReason: null,
    distanceToStreetM: candidate.distanceToStreetM,
    candidate,
  };
}
