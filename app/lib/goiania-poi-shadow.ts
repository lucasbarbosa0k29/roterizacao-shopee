import fs from "fs";
import path from "path";

export type GoianiaPoiShadowConfidence = "POI_HIGH" | "POI_MEDIUM" | "POI_LOW" | "NO_POI";

type LocalFirstPoi = {
  id: string;
  city?: string;
  type: string;
  name: string;
  originalName?: string | null;
  normalizedName?: string | null;
  normalizedNameFull?: string | null;
  normalizedNameCore?: string | null;
  aliases?: string[];
  normalizedBairro?: string | null;
  normalizedRua?: string | null;
  lat: number;
  lng: number;
  source?: string | null;
  sources?: string[];
  origins?: string[];
  confirmedCount?: number;
  active?: boolean;
};

type IndexedPoi = LocalFirstPoi & {
  searchTexts: string[];
};

export type GoianiaPoiShadowMatch = {
  found: boolean;
  confidence: GoianiaPoiShadowConfidence;
  category: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
  sources: string[];
  reason: string;
  score: number;
  matchedTokens: string[];
  poiId: string | null;
};

const POIS_PATH = path.join(process.cwd(), "data", "localfirst", "goiania", "pois", "pois.json");

const STOPWORDS = new Set([
  "RUA",
  "AV",
  "AVENIDA",
  "ALAMEDA",
  "TRAVESSA",
  "GOIANIA",
  "GOIAS",
  "SETOR",
  "JARDIM",
  "VILA",
  "PARQUE",
  "RESIDENCIAL",
  "CONDOMINIO",
  "EDIFICIO",
  "APARTAMENTO",
  "APTO",
  "BLOCO",
  "TORRE",
  "SALA",
  "LOJA",
  "QUADRA",
  "LOTE",
]);

const CATEGORY_SIGNALS: Record<string, string[]> = {
  BANCO: ["BANCO", "BRADESCO", "ITAU", "SICOOB", "SANTANDER", "CAIXA"],
  CENTRO_EMPRESARIAL: ["EMPRESARIAL", "OFFICE", "BUSINESS", "CORPORATE"],
  COMERCIAL: ["LOJA", "COMERCIAL", "GALERIA", "RESTAURANTE"],
  CONDOMINIO: ["CONDOMINIO", "COND", "PRIVE"],
  EDIFICIO: ["EDIFICIO", "EDIF", "PREDIO", "TORRE"],
  EMPRESA: ["LTDA", "EIRELI", "EMPRESA", "DISTRIBUIDORA", "INDUSTRIA"],
  ESCOLA: ["ESCOLA", "COLEGIO", "CEPI", "CMEI"],
  FARMACIA: ["FARMACIA", "DROGARIA", "DROGASIL"],
  HOSPITAL: ["HOSPITAL", "CLINICA", "UPA", "UBS", "LABORATORIO"],
  HOTEL: ["HOTEL", "POUSADA"],
  IGREJA: ["IGREJA", "PAROQUIA", "TEMPLO", "CAPELA"],
  LOGISTICA_INDUSTRIAL: ["GALPAO", "LOGISTICA", "DISTRIBUICAO", "TRANSPORTADORA"],
  RESIDENCIAL: ["RESIDENCIAL", "RES", "VILLAGE", "VILLAGGIO", "CONDOMINIO", "COND"],
  SHOPPING: ["SHOPPING", "MALL"],
  SUPERMERCADO: ["SUPERMERCADO", "MERCADO", "BRETAS", "ASSAI", "ATACADAO"],
  TERMINAL: ["TERMINAL", "RODOVIARIA", "AEROPORTO", "ESTACAO"],
  UNIVERSIDADE: ["UNIVERSIDADE", "FACULDADE", "CAMPUS", "UFG", "PUC", "SENAI", "SENAC"],
};

let cache: { mtimeMs: number; pois: IndexedPoi[]; index: Map<string, IndexedPoi[]> } | null = null;

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function isGoianiaCity(value: string | null | undefined) {
  const normalized = normalize(value);
  return /\bGOIANIA\b/.test(normalized) && !/\bAPARECIDA\b/.test(normalized);
}

function hasCategorySignal(category: string, normalizedText: string) {
  return (CATEGORY_SIGNALS[category] || []).some((signal) =>
    new RegExp(`\\b${signal}\\b`).test(normalizedText),
  );
}

function buildSearchTexts(poi: LocalFirstPoi) {
  return unique([
    poi.name,
    poi.originalName || "",
    poi.normalizedName || "",
    poi.normalizedNameFull || "",
    poi.normalizedNameCore || "",
    ...(poi.aliases || []),
  ]).filter((text) => tokens(text).length > 0);
}

function loadPoiIndex() {
  const stat = fs.statSync(POIS_PATH);
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache;

  const payload = JSON.parse(fs.readFileSync(POIS_PATH, "utf8")) as { pois?: LocalFirstPoi[] };
  const pois = (payload.pois || [])
    .filter((poi) => poi && poi.city === "GOIANIA" && poi.active !== false)
    .map((poi) => ({ ...poi, searchTexts: buildSearchTexts(poi) }));
  const index = new Map<string, IndexedPoi[]>();

  for (const poi of pois) {
    for (const token of unique(poi.searchTexts.flatMap(tokens))) {
      const bucket = index.get(token) || [];
      bucket.push(poi);
      index.set(token, bucket);
    }
  }

  cache = { mtimeMs: stat.mtimeMs, pois, index };
  return cache;
}

function scorePoi(args: {
  normalizedText: string;
  rowTokens: Set<string>;
  poi: IndexedPoi;
}) {
  const categorySignal = hasCategorySignal(args.poi.type, args.normalizedText);
  const bairroMatch =
    !!args.poi.normalizedBairro && args.normalizedText.includes(args.poi.normalizedBairro);
  const ruaMatch = !!args.poi.normalizedRua && args.normalizedText.includes(args.poi.normalizedRua);
  let best = { score: 0, coverage: 0, matchedTokens: [] as string[], searchText: "" };

  for (const searchText of args.poi.searchTexts) {
    const searchTokens = unique(tokens(searchText));
    if (!searchTokens.length) continue;
    const matchedTokens = searchTokens.filter((token) => args.rowTokens.has(token));
    const coverage = matchedTokens.length / searchTokens.length;
    const density = matchedTokens.length / Math.max(args.rowTokens.size, 1);
    let score = coverage * 70 + density * 20;

    if (categorySignal) score += 12;
    if (bairroMatch) score += 8;
    if (ruaMatch) score += 12;
    if (searchTokens.length <= 2 && !categorySignal && !bairroMatch && !ruaMatch) score -= 20;

    if (score > best.score) {
      best = { score, coverage, matchedTokens, searchText };
    }
  }

  const reasons: string[] = [];
  if (categorySignal) reasons.push("CATEGORY_SIGNAL");
  if (bairroMatch) reasons.push("BAIRRO_MATCH");
  if (ruaMatch) reasons.push("RUA_MATCH");
  if (best.coverage >= 0.9) reasons.push("NAME_COVERAGE_STRONG");
  else if (best.coverage >= 0.65) reasons.push("NAME_COVERAGE_MEDIUM");

  let confidence: GoianiaPoiShadowConfidence = "NO_POI";
  if (
    best.score >= 88 &&
    best.coverage >= 0.75 &&
    (categorySignal || bairroMatch || ruaMatch)
  ) {
    confidence = "POI_HIGH";
  } else if (
    best.score >= 68 &&
    best.coverage >= 0.55 &&
    (categorySignal || bairroMatch || ruaMatch)
  ) {
    confidence = "POI_MEDIUM";
  } else if (best.score >= 48 && best.coverage >= 0.4) {
    confidence = "POI_LOW";
  }

  return {
    confidence,
    score: Math.round(best.score),
    matchedTokens: best.matchedTokens,
    reasons,
  };
}

function empty(reason: string): GoianiaPoiShadowMatch {
  return {
    found: false,
    confidence: "NO_POI",
    category: null,
    name: null,
    lat: null,
    lng: null,
    sources: [],
    reason,
    score: 0,
    matchedTokens: [],
    poiId: null,
  };
}

export function lookupGoianiaPoiShadow(args: {
  city: string;
  address: string;
  bairro: string;
  normalizedLine: string;
  contextName?: string | null;
}): GoianiaPoiShadowMatch {
  if (!isGoianiaCity(args.city)) return empty("CITY_NOT_GOIANIA");

  try {
    const { index } = loadPoiIndex();
    const normalizedText = normalize(
      [args.address, args.bairro, args.normalizedLine, args.contextName || "", args.city]
        .filter(Boolean)
        .join(" "),
    );
    const rowTokens = new Set(tokens(normalizedText));
    const pool = new Map<string, IndexedPoi>();

    for (const token of rowTokens) {
      for (const poi of index.get(token) || []) pool.set(poi.id, poi);
    }

    let best:
      | (ReturnType<typeof scorePoi> & {
          poi: IndexedPoi;
        })
      | null = null;

    for (const poi of pool.values()) {
      const scored = scorePoi({ normalizedText, rowTokens, poi });
      if (scored.confidence === "NO_POI") continue;
      if (
        !best ||
        scored.score > best.score ||
        (scored.score === best.score && (poi.confirmedCount || 0) > (best.poi.confirmedCount || 0))
      ) {
        best = { ...scored, poi };
      }
    }

    if (!best) return empty("NO_POI_MATCH");

    return {
      found: best.confidence === "POI_HIGH",
      confidence: best.confidence,
      category: best.poi.type,
      name: best.poi.name,
      lat:
        best.confidence === "POI_HIGH" || best.confidence === "POI_MEDIUM"
          ? best.poi.lat
          : null,
      lng:
        best.confidence === "POI_HIGH" || best.confidence === "POI_MEDIUM"
          ? best.poi.lng
          : null,
      sources: unique([...(best.poi.sources || []), best.poi.source || ""]),
      reason: best.reasons.length ? best.reasons.join(",") : "TEXT_MATCH",
      score: best.score,
      matchedTokens: best.matchedTokens,
      poiId: best.poi.id,
    };
  } catch (error) {
    return empty(`LOOKUP_ERROR:${error instanceof Error ? error.message : String(error)}`);
  }
}
