import fs from "fs";
import path from "path";

export type JardimCerradoRegionalCandidate = {
  bairro: string;
  etapa: string;
  quadra: string;
  lote: string | null;
  streetLabel: string | null;
  lat: number;
  lng: number;
  sourceKey: string | null;
};

export type JardimCerradoRegionalDebug = {
  attempted: boolean;
  applied: boolean;
  reason: string;
  etapa: string | null;
  quadra: string | null;
  lote: string | null;
  ruaJc: string | null;
  bloco: string | null;
  apartamento: string | null;
  condominio: string | null;
  anchorOnly: boolean;
  candidatesCount: number;
  streetCompatibility: "STREET_MATCH" | "STREET_PARTIAL_MATCH" | "STREET_MISMATCH" | "STREET_UNKNOWN" | null;
  sourceFields: string[];
  candidate: JardimCerradoRegionalCandidate | null;
  matchType: "exact_lot" | "quadra_anchor" | null;
  confidence: "HIGH" | "MEDIUM" | null;
};

export type JardimCerradoRegionalInput = {
  city?: string | null;
  address?: string | null;
  bairro?: string | null;
  complemento?: string | null;
  observacao?: string | null;
  referencia?: string | null;
  normalizedLine?: string | null;
  normalized?: {
    rua?: string | null;
    quadra?: string | null;
    lote?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    observacao?: string | null;
    addressContextName?: string | null;
    addressContextBlock?: string | null;
    addressContextApartment?: string | null;
    addressContextQuadra?: string | null;
    addressContextLot?: string | null;
  } | null;
};

type LocalFirstCandidate = {
  b?: string;
  q?: string;
  l?: string;
  r?: string;
  c?: "HIGH" | "MEDIUM";
  lat?: number;
  lng?: number;
};

type DataCache = {
  byEtapa: Map<string, LocalFirstCandidate[]>;
  byEtapaQuadra: Map<string, LocalFirstCandidate[]>;
  byEtapaQuadraLote: Map<string, LocalFirstCandidate[]>;
};

let cache: DataCache | null = null;

function normalizeText(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCity(value: unknown) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeNumeric(value: unknown) {
  const text = normalizeText(value);
  const digits = text.match(/\d+/)?.[0] || "";
  return digits ? String(Number(digits)) : "";
}

function key(etapa: string, quadra: string, lote?: string | null) {
  return lote ? `${etapa}|${quadra}|${lote}` : `${etapa}|${quadra}`;
}

function isGoianiaOnly(city: unknown) {
  const normalized = normalizeCity(city);
  return normalized.includes("GOIANIA") && !normalized.includes("APARECIDA") && !normalized.includes("TRINDADE");
}

function loadCache(): DataCache {
  if (cache) return cache;

  const byEtapa = new Map<string, LocalFirstCandidate[]>();
  const byEtapaQuadra = new Map<string, LocalFirstCandidate[]>();
  const byEtapaQuadraLote = new Map<string, LocalFirstCandidate[]>();
  const dataDir = path.join(process.cwd(), "app", "data", "goiania_local_first_by_bairro_v4");

  for (let etapa = 1; etapa <= 11; etapa += 1) {
    const file = path.join(dataDir, `JARDINS_DO_CERRADO_${etapa}.json`);
    if (!fs.existsSync(file)) continue;

    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      index?: Record<string, LocalFirstCandidate[]>;
    };

    const etapaKey = String(etapa);
    const etapaCandidates: LocalFirstCandidate[] = [];
    for (const entries of Object.values(parsed.index || {})) {
      for (const candidate of entries || []) {
        const q = normalizeNumeric(candidate.q);
        const l = normalizeNumeric(candidate.l);
        if (!q || typeof candidate.lat !== "number" || typeof candidate.lng !== "number") continue;

        etapaCandidates.push(candidate);
        const qKey = key(etapaKey, q);
        byEtapaQuadra.set(qKey, [...(byEtapaQuadra.get(qKey) || []), candidate]);
        if (l) {
          const qlKey = key(etapaKey, q, l);
          byEtapaQuadraLote.set(qlKey, [...(byEtapaQuadraLote.get(qlKey) || []), candidate]);
        }
      }
    }
    byEtapa.set(etapaKey, etapaCandidates);
  }

  cache = { byEtapa, byEtapaQuadra, byEtapaQuadraLote };
  return cache;
}

function collectFields(input: JardimCerradoRegionalInput) {
  const normalized = input.normalized || {};
  const fields = [
    ["address", input.address],
    ["bairro", input.bairro],
    ["complemento", input.complemento],
    ["observacao", input.observacao],
    ["referencia", input.referencia],
    ["normalizedLine", input.normalizedLine],
    ["normalized.rua", normalized.rua],
    ["normalized.bairro", normalized.bairro],
    ["normalized.observacao", normalized.observacao],
    ["normalized.addressContextName", normalized.addressContextName],
    ["normalized.addressContextBlock", normalized.addressContextBlock],
    ["normalized.addressContextApartment", normalized.addressContextApartment],
    ["normalized.addressContextQuadra", normalized.addressContextQuadra],
    ["normalized.addressContextLot", normalized.addressContextLot],
  ] as const;

  return fields
    .map(([name, value]) => ({ name, value: String(value || "").trim(), normalized: normalizeText(value) }))
    .filter((field) => field.value);
}

function extractEtapa(fields: ReturnType<typeof collectFields>) {
  for (const field of fields) {
    const text = field.normalized;
    const match =
      text.match(/\b(?:RESID(?:ENCIAL)?|RES)?\s*JARDI(?:M|NS)\s+(?:DO\s+)?CERRADO\s+0?([1-9]|10|11)\b/) ||
      text.match(/\bJARDI(?:M|NS)\s+CERRADO\s+0?([1-9]|10|11)\b/);
    if (match?.[1]) return { value: String(Number(match[1])), field: field.name };
  }
  return { value: "", field: "" };
}

function extractQuadra(fields: ReturnType<typeof collectFields>, normalizedQuadra?: string | null) {
  const direct = normalizeNumeric(normalizedQuadra);
  if (direct) return { value: direct, field: "normalized.quadra" };

  for (const field of fields) {
    const match = field.normalized.match(/\b(?:QUADRA|QUAD|QDRA|QDR|QDA|QD|Q)\s*[-:]?\s*0*([0-9]{1,4}[A-Z]?)\b/);
    if (match?.[1]) return { value: normalizeNumeric(match[1]), field: field.name };
  }
  return { value: "", field: "" };
}

function extractLote(fields: ReturnType<typeof collectFields>, normalizedLote?: string | null) {
  const direct = normalizeNumeric(normalizedLote);
  if (direct) return { value: direct, field: "normalized.lote" };

  for (const field of fields) {
    const match = field.normalized.match(/\b(?:LOTE|LOT|LTS|LT|L)\s*[-:]?\s*0*([0-9]{1,4}[A-Z]?)\b/);
    if (match?.[1]) return { value: normalizeNumeric(match[1]), field: field.name };
  }
  return { value: "", field: "" };
}

function extractRuaJc(fields: ReturnType<typeof collectFields>, normalizedRua?: string | null) {
  const candidates = [String(normalizedRua || ""), ...fields.map((field) => field.value)];
  for (const value of candidates) {
    const match = normalizeText(value).match(/\b(?:RUA|R)?\s*JC\s*-?\s*0*([0-9]{1,4}[A-Z]?)\b/);
    if (match?.[1]) return `R JC-${String(Number(match[1].replace(/\D+/g, "")))}`;
  }
  return null;
}

function extractSimpleContext(fields: ReturnType<typeof collectFields>) {
  const joined = fields.map((field) => field.normalized).join(" ");
  const bloco = joined.match(/\b(?:BLOCO|BL|BLC)\s*[-:]?\s*([A-Z0-9]{1,4})\b/)?.[1] || null;
  const apartamento = joined.match(/\b(?:APARTAMENTO|APTO|APT|AP)\s*[-:]?\s*([A-Z0-9]{1,6})\b/)?.[1] || null;
  const condominio =
    joined.match(/\b(?:CONDOMINIO|COND)\s+([A-Z0-9 ]{3,40}?)(?:\s+QD|\s+QUADRA|\s+BLOCO|\s+BL|\s+AP|\s+APT|$)/)?.[1]?.trim() ||
    null;

  return { bloco, apartamento, condominio };
}

function normalizeStreetForComparison(value: string) {
  return normalizeText(value)
    .replace(/\bRUA\b/g, "R")
    .replace(/\bR\s+JC\s*-?\s*0*([0-9]+[A-Z]?)\b/g, "R JC-$1")
    .replace(/\s+/g, " ")
    .trim();
}

function compareStreet(inputStreet: string | null, candidateStreet: string | null) {
  if (!inputStreet || !candidateStreet) return "STREET_UNKNOWN" as const;
  const input = normalizeStreetForComparison(inputStreet);
  const candidate = normalizeStreetForComparison(candidateStreet);
  if (!input || !candidate) return "STREET_UNKNOWN" as const;
  if (input === candidate) return "STREET_MATCH" as const;
  const inputJc = input.match(/\bJC-?([0-9]+[A-Z]?)\b/)?.[1];
  const candidateJc = candidate.match(/\bJC-?([0-9]+[A-Z]?)\b/)?.[1];
  if (inputJc && candidateJc && inputJc === candidateJc) return "STREET_MATCH" as const;
  if (input.includes(candidate) || candidate.includes(input)) return "STREET_PARTIAL_MATCH" as const;
  return "STREET_MISMATCH" as const;
}

function streetScore(compatibility: ReturnType<typeof compareStreet>) {
  if (compatibility === "STREET_MATCH") return 25;
  if (compatibility === "STREET_PARTIAL_MATCH") return 10;
  if (compatibility === "STREET_MISMATCH") return -20;
  return 0;
}

function toRegionalCandidate(
  etapa: string,
  quadra: string,
  candidate: LocalFirstCandidate,
  sourceKey: string | null,
): JardimCerradoRegionalCandidate | null {
  if (typeof candidate.lat !== "number" || typeof candidate.lng !== "number") return null;
  return {
    bairro: candidate.b || `JARDINS DO CERRADO ${etapa}`,
    etapa,
    quadra: normalizeNumeric(candidate.q) || quadra,
    lote: normalizeNumeric(candidate.l) || null,
    streetLabel: candidate.r || null,
    lat: candidate.lat,
    lng: candidate.lng,
    sourceKey,
  };
}

function buildAnchorCandidate(etapa: string, quadra: string, candidates: LocalFirstCandidate[], ruaJc: string | null) {
  const valid = candidates.filter((candidate) => typeof candidate.lat === "number" && typeof candidate.lng === "number");
  if (!valid.length) return null;

  const ranked = [...valid].sort((a, b) => {
    const byStreet = streetScore(compareStreet(ruaJc, b.r || null)) - streetScore(compareStreet(ruaJc, a.r || null));
    if (byStreet !== 0) return byStreet;
    return (b.c === "HIGH" ? 1 : 0) - (a.c === "HIGH" ? 1 : 0);
  });
  const lat = valid.reduce((sum, candidate) => sum + (candidate.lat as number), 0) / valid.length;
  const lng = valid.reduce((sum, candidate) => sum + (candidate.lng as number), 0) / valid.length;
  const streetLabel = ranked[0]?.r || null;

  return {
    bairro: ranked[0]?.b || `JARDINS DO CERRADO ${etapa}`,
    etapa,
    quadra,
    lote: null,
    streetLabel,
    lat,
    lng,
    sourceKey: key(etapa, quadra),
  };
}

function emptyDebug(reason: string, extras?: Partial<JardimCerradoRegionalDebug>): JardimCerradoRegionalDebug {
  return {
    attempted: false,
    applied: false,
    reason,
    etapa: null,
    quadra: null,
    lote: null,
    ruaJc: null,
    bloco: null,
    apartamento: null,
    condominio: null,
    anchorOnly: false,
    candidatesCount: 0,
    streetCompatibility: null,
    sourceFields: [],
    candidate: null,
    matchType: null,
    confidence: null,
    ...extras,
  };
}

export function resolveGoianiaJardimCerradoRegional(
  input: JardimCerradoRegionalInput,
): JardimCerradoRegionalDebug {
  const city = input.normalized?.cidade || input.city || "";
  if (!isGoianiaOnly(city)) return emptyDebug("CITY_NOT_GOIANIA");

  const fields = collectFields(input);
  const etapa = extractEtapa(fields);
  const quadra = extractQuadra(fields, input.normalized?.quadra || input.normalized?.addressContextQuadra);
  const lote = extractLote(fields, input.normalized?.lote || input.normalized?.addressContextLot);
  const ruaJc = extractRuaJc(fields, input.normalized?.rua || null);
  const context = extractSimpleContext(fields);
  const baseDebug = {
    attempted: true,
    etapa: etapa.value || null,
    quadra: quadra.value || null,
    lote: lote.value || null,
    ruaJc,
    bloco: context.bloco,
    apartamento: context.apartamento,
    condominio: context.condominio,
    sourceFields: [etapa.field, quadra.field, lote.field].filter(Boolean),
  };

  if (!etapa.value) return emptyDebug("MISSING_ETAPA", baseDebug);
  if (!quadra.value) return emptyDebug("MISSING_QUADRA", baseDebug);

  const data = loadCache();

  if (lote.value) {
    const exactCandidates = data.byEtapaQuadraLote.get(key(etapa.value, quadra.value, lote.value)) || [];
    if (!exactCandidates.length) {
      return emptyDebug("NO_EXACT_LOTE_IN_LOCALFIRST", {
        ...baseDebug,
        candidatesCount: 0,
      });
    }

    const ranked = [...exactCandidates].sort((a, b) => {
      const byStreet = streetScore(compareStreet(ruaJc, b.r || null)) - streetScore(compareStreet(ruaJc, a.r || null));
      if (byStreet !== 0) return byStreet;
      return (b.c === "HIGH" ? 1 : 0) - (a.c === "HIGH" ? 1 : 0);
    });
    const winner = toRegionalCandidate(etapa.value, quadra.value, ranked[0], key(etapa.value, quadra.value, lote.value));
    if (!winner) return emptyDebug("EXACT_LOTE_WITHOUT_COORDS", { ...baseDebug, candidatesCount: exactCandidates.length });
    const compatibility = compareStreet(ruaJc, winner.streetLabel);

    return {
      ...emptyDebug("APPLIED_EXACT_LOTE", baseDebug),
      applied: true,
      candidate: winner,
      candidatesCount: exactCandidates.length,
      streetCompatibility: compatibility,
      matchType: "exact_lot",
      confidence: "HIGH",
      anchorOnly: false,
    };
  }

  const quadraCandidates = data.byEtapaQuadra.get(key(etapa.value, quadra.value)) || [];
  if (!quadraCandidates.length) {
    return emptyDebug("NO_QUADRA_IN_LOCALFIRST", {
      ...baseDebug,
      candidatesCount: 0,
    });
  }

  const anchor = buildAnchorCandidate(etapa.value, quadra.value, quadraCandidates, ruaJc);
  if (!anchor) return emptyDebug("QUADRA_WITHOUT_COORDS", { ...baseDebug, candidatesCount: quadraCandidates.length });
  const compatibility = compareStreet(ruaJc, anchor.streetLabel);

  return {
    ...emptyDebug("APPLIED_QUADRA_ANCHOR", baseDebug),
    applied: true,
    candidate: anchor,
    candidatesCount: quadraCandidates.length,
    streetCompatibility: compatibility,
    matchType: "quadra_anchor",
    confidence: "MEDIUM",
    anchorOnly: true,
  };
}
