export type TrindadeCentroidRecord = {
  sourceIndex: number;
  lat: number;
  lng: number;
  cdloteamento: string;
  cdquadra: string;
  cdlote: string;
  quadraDisplay: string;
  loteDisplay: string;
  cdlogradouro: string;
  logradouroNome: string;
  cdbairro: string;
  bairroNome: string;
  loteamentoNome: string;
  streetFullName: string;
  nearDist: number | null;
};

export type TrindadeCentroidSearchResult = {
  record: TrindadeCentroidRecord;
  score: number;
  matchedTokens: string[];
  matchedText: string;
};

export type TrindadeCentroidPopupLine = {
  label: string;
  value: string;
};

export type TrindadeCentroidPopupFormat = {
  title: string;
  primaryLabel: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  lines: TrindadeCentroidPopupLine[];
  summary: string;
};

export type TrindadeCentroidClientStats = {
  ready: boolean;
  source: "primary" | "fallback" | null;
  fallbackUsed: boolean;
  totalRecords: number;
  recordsWithStreet: number;
  recordsWithBairro: number;
  recordsWithLoteamento: number;
  recordsWithLogradouro: number;
  uniqueTripleKeys: number;
  uniquePairKeys: number;
  uniqueStreetBairroKeys: number;
  ambiguousTripleKeys: number;
  ambiguousPairKeys: number;
  ambiguousStreetBairroKeys: number;
  searchTokenCount: number;
  searchDocumentCount: number;
  loadCount: number;
  cacheHits: number;
  loadMs: number | null;
  error: string | null;
};

type RawTrindadeCentroidRecord = {
  sourceIndex?: number;
  lat?: number | string;
  lng?: number | string;
  cdloteamento?: unknown;
  cdquadra?: unknown;
  cdlote?: unknown;
  quadraDisplay?: unknown;
  loteDisplay?: unknown;
  cdlogradouro?: unknown;
  logradouroNome?: unknown;
  cdbairro?: unknown;
  bairroNome?: unknown;
  loteamentoNome?: unknown;
  streetFullName?: unknown;
  nearDist?: unknown;
};

type TrindadeCentroidStore = {
  ready: boolean;
  source: "primary" | "fallback" | null;
  fallbackUsed: boolean;
  records: TrindadeCentroidRecord[];
  byTriple: Map<string, TrindadeCentroidRecord[]>;
  byPair: Map<string, TrindadeCentroidRecord[]>;
  byStreetBairro: Map<string, TrindadeCentroidRecord[]>;
  searchText: Map<string, number[]>;
  searchTexts: string[];
  stats: TrindadeCentroidClientStats;
};

const PRIMARY_URL = "/data/trindade-clean/trindade_lot_centroids_with_street.json";
const FALLBACK_URL = "/data/trindade-clean/trindade_lot_centroids.json";

let store: TrindadeCentroidStore | null = null;
let loadPromise: Promise<TrindadeCentroidStore> | null = null;
let loadCount = 0;
let cacheHits = 0;
let lastLoadMs: number | null = null;
let lastError: string | null = null;

function compact(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value: unknown) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCode(value: unknown) {
  const text = compact(value);
  if (!text) return "";

  let normalized = text.toUpperCase();
  while (normalized.length > 1 && normalized.startsWith("0")) {
    normalized = normalized.slice(1);
  }

  return normalized;
}

function normalizeSearchText(value: unknown) {
  return normalizeKey(value).replace(/\s+/g, " ");
}

function normalizeSearchTokens(value: unknown) {
  const text = normalizeSearchText(value);
  if (!text) return [];

  return text
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function isFiniteNumber(value: unknown) {
  return Number.isFinite(Number(value));
}

async function readJsonArray(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    return { ok: false as const, error: `HTTP_${response.status}` };
  }

  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return { ok: false as const, error: "INVALID_JSON_ARRAY" };
  }

  return { ok: true as const, records: payload as RawTrindadeCentroidRecord[] };
}

function toRecord(value: RawTrindadeCentroidRecord, fallbackIndex: number): TrindadeCentroidRecord | null {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    sourceIndex: Number.isFinite(Number(value?.sourceIndex)) ? Number(value?.sourceIndex) : fallbackIndex,
    lat,
    lng,
    cdloteamento: compact(value?.cdloteamento),
    cdquadra: compact(value?.cdquadra),
    cdlote: compact(value?.cdlote),
    quadraDisplay: compact(value?.quadraDisplay),
    loteDisplay: compact(value?.loteDisplay),
    cdlogradouro: compact(value?.cdlogradouro),
    logradouroNome: compact(value?.logradouroNome),
    cdbairro: compact(value?.cdbairro),
    bairroNome: compact(value?.bairroNome),
    loteamentoNome: compact(value?.loteamentoNome),
    streetFullName: compact(value?.streetFullName),
    nearDist: isFiniteNumber(value?.nearDist) ? Number(value?.nearDist) : null,
  };
}

function buildTripleKey(record: TrindadeCentroidRecord) {
  return [
    normalizeCode(record.cdloteamento),
    normalizeCode(record.cdquadra),
    normalizeCode(record.cdlote),
  ].join("|");
}

function buildPairKey(record: TrindadeCentroidRecord) {
  return [normalizeCode(record.cdquadra), normalizeCode(record.cdlote)].join("|");
}

function buildStreetBairroKey(street: unknown, bairro: unknown) {
  const streetKey = normalizeSearchText(street);
  const bairroKey = normalizeSearchText(bairro);
  if (!streetKey || !bairroKey) return "";
  return `${streetKey}|${bairroKey}`;
}

function addPosting(map: Map<string, number[]>, token: string, index: number) {
  if (!token) return;

  const current = map.get(token);
  if (current) {
    const last = current[current.length - 1];
    if (last !== index) {
      current.push(index);
    }
    return;
  }

  map.set(token, [index]);
}

function buildStore(records: TrindadeCentroidRecord[], source: "primary" | "fallback", fallbackUsed: boolean): TrindadeCentroidStore {
  const byTriple = new Map<string, TrindadeCentroidRecord[]>();
  const byPair = new Map<string, TrindadeCentroidRecord[]>();
  const byStreetBairro = new Map<string, TrindadeCentroidRecord[]>();
  const searchText = new Map<string, number[]>();
  const searchTexts: string[] = [];

  let recordsWithStreet = 0;
  let recordsWithBairro = 0;
  let recordsWithLoteamento = 0;
  let recordsWithLogradouro = 0;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const tripleKey = buildTripleKey(record);
    const pairKey = buildPairKey(record);
    const streetKey = normalizeSearchText(record.streetFullName || record.logradouroNome);
    const bairroKey = normalizeSearchText(record.bairroNome);
    const streetBairroKey = buildStreetBairroKey(record.streetFullName || record.logradouroNome, record.bairroNome);

    if (record.streetFullName || record.logradouroNome) recordsWithStreet += 1;
    if (record.bairroNome) recordsWithBairro += 1;
    if (record.loteamentoNome) recordsWithLoteamento += 1;
    if (record.logradouroNome) recordsWithLogradouro += 1;

    if (tripleKey !== "||") {
      const current = byTriple.get(tripleKey) || [];
      current.push(record);
      byTriple.set(tripleKey, current);
    }

    if (pairKey !== "|") {
      const current = byPair.get(pairKey) || [];
      current.push(record);
      byPair.set(pairKey, current);
    }

    if (streetBairroKey) {
      const current = byStreetBairro.get(streetBairroKey) || [];
      current.push(record);
      byStreetBairro.set(streetBairroKey, current);
    }

    const parts = [
      record.cdloteamento,
      record.cdquadra,
      record.cdlote,
      record.quadraDisplay,
      record.loteDisplay,
      record.cdlogradouro,
      record.logradouroNome,
      record.cdbairro,
      record.bairroNome,
      record.loteamentoNome,
      record.streetFullName,
    ];
    const tokens = new Set<string>();
    for (const part of parts) {
      for (const token of normalizeSearchTokens(part)) {
        tokens.add(token);
      }
    }
    if (streetKey) tokens.add(streetKey);
    if (bairroKey) tokens.add(bairroKey);
    searchTexts[i] = normalizeSearchText(parts.join(" "));
    for (const token of tokens) {
      addPosting(searchText, token, i);
    }
  }

  const stats: TrindadeCentroidClientStats = {
    ready: true,
    source,
    fallbackUsed,
    totalRecords: records.length,
    recordsWithStreet,
    recordsWithBairro,
    recordsWithLoteamento,
    recordsWithLogradouro,
    uniqueTripleKeys: byTriple.size,
    uniquePairKeys: byPair.size,
    uniqueStreetBairroKeys: byStreetBairro.size,
    ambiguousTripleKeys: [...byTriple.values()].filter((items) => items.length > 1).length,
    ambiguousPairKeys: [...byPair.values()].filter((items) => items.length > 1).length,
    ambiguousStreetBairroKeys: [...byStreetBairro.values()].filter((items) => items.length > 1).length,
    searchTokenCount: searchText.size,
    searchDocumentCount: searchTexts.length,
    loadCount,
    cacheHits,
    loadMs: lastLoadMs,
    error: lastError,
  };

  return {
    ready: true,
    source,
    fallbackUsed,
    records,
    byTriple,
    byPair,
    byStreetBairro,
    searchText,
    searchTexts,
    stats,
  };
}

function finalizeStore(next: TrindadeCentroidStore) {
  store = next;
  loadCount += 1;
  lastLoadMs = next.stats.loadMs;
  lastError = next.stats.error;
  return next;
}

async function loadFromNetwork(): Promise<TrindadeCentroidStore> {
  const startedAt = Date.now();
  const primary = await readJsonArray(PRIMARY_URL);

  let source: "primary" | "fallback" = "primary";
  let fallbackUsed = false;
  let rawRecords: RawTrindadeCentroidRecord[] = [];

  if (primary.ok) {
    rawRecords = primary.records;
  } else {
    const fallback = await readJsonArray(FALLBACK_URL);
    if (!fallback.ok) {
      lastError = `PRIMARY:${primary.error}; FALLBACK:${fallback.error}`;
      const next = buildStore([], "fallback", true);
      next.stats.loadMs = Date.now() - startedAt;
      next.stats.error = lastError;
      return finalizeStore(next);
    }

    rawRecords = fallback.records;
    source = "fallback";
    fallbackUsed = true;
  }

  const records: TrindadeCentroidRecord[] = [];
  for (let i = 0; i < rawRecords.length; i += 1) {
    const record = toRecord(rawRecords[i], i);
    if (record) records.push(record);
  }

  const next = buildStore(records, source, fallbackUsed);
  next.stats.loadMs = Date.now() - startedAt;
  next.stats.loadCount = loadCount + 1;
  next.stats.cacheHits = cacheHits;
  next.stats.error = null;
  return finalizeStore(next);
}

export async function loadTrindadeCentroidsClient() {
  if (store) {
    cacheHits += 1;
    store.stats.cacheHits = cacheHits;
    store.stats.loadCount = loadCount;
    store.stats.loadMs = lastLoadMs;
    store.stats.error = lastError;
    return store;
  }

  if (!loadPromise) {
    loadPromise = loadFromNetwork().finally(() => {
      loadPromise = null;
    });
  } else {
    cacheHits += 1;
  }

  return loadPromise;
}

export async function findTrindadeCentroidByTripleClient(cdloteamento: unknown, cdquadra: unknown, cdlote: unknown) {
  const current = await loadTrindadeCentroidsClient();
  const key = [normalizeCode(cdloteamento), normalizeCode(cdquadra), normalizeCode(cdlote)].join("|");
  return current.byTriple.get(key) || [];
}

export async function findTrindadeCentroidByQuadraLoteClient(cdquadra: unknown, cdlote: unknown) {
  const current = await loadTrindadeCentroidsClient();
  const key = [normalizeCode(cdquadra), normalizeCode(cdlote)].join("|");
  return current.byPair.get(key) || [];
}

export async function findTrindadeCentroidByStreetBairroClient(street: unknown, bairro: unknown) {
  const current = await loadTrindadeCentroidsClient();
  const key = buildStreetBairroKey(street, bairro);
  return key ? current.byStreetBairro.get(key) || [] : [];
}

function scoreSearchResult(
  record: TrindadeCentroidRecord,
  queryText: string,
  queryTokens: string[],
  matchedText: string,
) {
  let score = 0;
  const matchedTokens = new Set<string>();

  for (const token of queryTokens) {
    if (!token) continue;
    if (matchedText.includes(token)) {
      matchedTokens.add(token);
      score += Math.max(4, token.length);
    }
  }

  if (queryText && matchedText.includes(queryText)) {
    score += 30;
  }

  const directParts = [
    normalizeSearchText(record.streetFullName || record.logradouroNome),
    normalizeSearchText(record.bairroNome),
    normalizeSearchText(record.loteamentoNome),
    normalizeSearchText(record.quadraDisplay),
    normalizeSearchText(record.loteDisplay),
  ];

  for (const part of directParts) {
    if (part && queryText && part.includes(queryText)) {
      score += 6;
    }
  }

  return {
    score,
    matchedTokens: [...matchedTokens].sort((a, b) => a.localeCompare(b)),
  };
}

export async function searchTrindadeCentroidsClient(query: unknown) {
  const current = await loadTrindadeCentroidsClient();
  const queryText = normalizeSearchText(query);
  const queryTokens = normalizeSearchTokens(query);

  if (!queryText || !queryTokens.length) return [];

  const candidateIndexes = new Set<number>();
  for (const token of queryTokens) {
    const hits = current.searchText.get(token) || [];
    for (const index of hits) {
      candidateIndexes.add(index);
    }
  }

  if (!candidateIndexes.size) {
    return [];
  }

  const results: TrindadeCentroidSearchResult[] = [];
  for (const index of candidateIndexes) {
    const record = current.records[index];
    if (!record) continue;
    const matchedText = current.searchTexts[index] || "";
    const scored = scoreSearchResult(record, queryText, queryTokens, matchedText);
    if (scored.score <= 0) continue;
    results.push({
      record,
      score: scored.score,
      matchedTokens: scored.matchedTokens,
      matchedText,
    });
  }

  results.sort((a, b) => b.score - a.score || a.record.sourceIndex - b.record.sourceIndex);
  return results.slice(0, 20);
}

export function formatTrindadeCentroidForPopupClient(record: TrindadeCentroidRecord): TrindadeCentroidPopupFormat {
  const safe = (value: unknown) => {
    const text = compact(value);
    return text || "Nao identificado";
  };

  const lines: TrindadeCentroidPopupLine[] = [
    { label: "Logradouro", value: safe(record.streetFullName || record.logradouroNome) },
    { label: "Bairro", value: safe(record.bairroNome) },
    { label: "Quadra", value: safe(record.quadraDisplay || record.cdquadra) },
    { label: "Lote", value: safe(record.loteDisplay || record.cdlote) },
    { label: "Loteamento", value: safe(record.loteamentoNome || record.cdloteamento) },
    { label: "Coordenadas", value: `${Number(record.lat).toFixed(6)}, ${Number(record.lng).toFixed(6)}` },
  ];

  const primaryLabel = [record.streetFullName || record.logradouroNome, record.bairroNome]
    .map((value) => compact(value))
    .filter(Boolean)
    .join(" - ");

  return {
    title: "Trindade local - revisao manual",
    primaryLabel: primaryLabel || "Trindade local - revisao manual",
    coordinates: {
      lat: record.lat,
      lng: record.lng,
    },
    lines,
    summary: `${safe(record.streetFullName || record.logradouroNome)} / ${safe(record.bairroNome)} / Qd ${safe(
      record.quadraDisplay || record.cdquadra,
    )} Lt ${safe(record.loteDisplay || record.cdlote)}`,
  };
}

export async function getTrindadeCentroidClientStats() {
  const current = await loadTrindadeCentroidsClient();
  current.stats.loadCount = loadCount;
  current.stats.cacheHits = cacheHits;
  current.stats.loadMs = lastLoadMs;
  current.stats.error = lastError;
  return current.stats;
}

