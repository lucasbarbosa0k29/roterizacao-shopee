export type UrbanPatternType = "H" | "V" | "RC" | "CV" | "AC";

export type UrbanPatternBuildResult = {
  detected: boolean;
  type: UrbanPatternType | null;
  normalizedStreet: string | null;
  query: string | null;
};

type UrbanPatternInput = {
  original: string;
  rua: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  quadra: string;
  lote: string;
};

function stripDiacritics(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(value: string) {
  return stripDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigits(value: string) {
  return String(value || "")
    .replace(/\D+/g, "")
    .trim();
}

function padUrbanNumber(value: string) {
  const digits = normalizeDigits(value);
  if (!digits || digits.length > 3) return null;
  return String(Number(digits)).padStart(3, "0");
}

function buildCanonicalStreet(type: UrbanPatternType, number: string, suffix = "") {
  const prefix = type === "V" ? "Avenida" : "Rua";
  const n = padUrbanNumber(number);
  if (!n) return null;
  return `${prefix} ${type}-${n}${suffix}`.replace(/\s+/g, " ").trim();
}

function detectUrbanPattern(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const patterns: Array<{
    type: UrbanPatternType;
    regex: RegExp;
  }> = [
    {
      type: "V",
      regex: /^(?:AV|AVENIDA|A\s*V)\s*V\s*[- ]?\s*(\d{1,3})([A-Z]?)\b/,
    },
    {
      type: "H",
      regex: /^(?:RUA|R)\s*H\s*[- ]?\s*(\d{1,3})([A-Z]?)\b/,
    },
    {
      type: "RC",
      regex: /^(?:RUA|R)?\s*(?:RC|R\s*C)\s*[- ]?\s*(\d{1,3})([A-Z]?)\b/,
    },
    {
      type: "CV",
      regex: /^(?:RUA|R)?\s*(?:CV|C\s*V)\s*[- ]?\s*(\d{1,3})([A-Z]?)\b/,
    },
    {
      type: "AC",
      regex: /^(?:RUA|R)?\s*(?:AC|A\s*C)\s*[- ]?\s*(\d{1,3})([A-Z]?)\b/,
    },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;

    const normalizedStreet = buildCanonicalStreet(pattern.type, match[1], match[2] || "");
    if (!normalizedStreet) continue;

    return {
      detected: true,
      type: pattern.type,
      normalizedStreet,
    } as const;
  }

  return null;
}

export function normalizeUrbanStreet(value: string) {
  const detected = detectUrbanPattern(value);
  return detected?.normalizedStreet || null;
}

export function isUrbanPatternCandidate(value: string) {
  return !!detectUrbanPattern(value);
}

export function buildUrbanPatternQueries(input: UrbanPatternInput): UrbanPatternBuildResult {
  const streetSource = input.rua || input.original || "";
  const detected = detectUrbanPattern(streetSource);
  if (!detected) {
    return {
      detected: false,
      type: null,
      normalizedStreet: null,
      query: null,
    };
  }

  const city = stripDiacritics(input.cidade || "").toUpperCase().trim();
  const bairro = String(input.bairro || "").trim();
  const estado = String(input.estado || "GO").trim() || "GO";
  const cep = normalizeDigits(input.cep || "");
  const quadra = normalizeDigits(input.quadra || "");
  const lote = normalizeDigits(input.lote || "");

  const isAparecida = city.includes("APARECIDA");
  const isGoiania = city.includes("GOIANIA");
  const hasBlockSignal = !!quadra || !!lote;
  const hasContextForGoiania = !!bairro || !!cep;

  if (!hasBlockSignal) {
    return {
      detected: true,
      type: detected.type,
      normalizedStreet: detected.normalizedStreet,
      query: null,
    };
  }

  if (isGoiania && !hasContextForGoiania) {
    return {
      detected: true,
      type: detected.type,
      normalizedStreet: detected.normalizedStreet,
      query: null,
    };
  }

  if (!isAparecida && !isGoiania) {
    return {
      detected: true,
      type: detected.type,
      normalizedStreet: detected.normalizedStreet,
      query: null,
    };
  }

  const parts = [
    detected.normalizedStreet,
    quadra ? `Quadra ${quadra.padStart(2, "0")}` : "",
    lote ? `Lote ${lote.padStart(2, "0")}` : "",
    bairro,
    input.cidade || "",
    estado,
    cep,
  ].filter(Boolean);

  return {
    detected: true,
    type: detected.type,
    normalizedStreet: detected.normalizedStreet,
    query: parts.join(", "),
  };
}
export type UrbanPatternRealQueryApplication = {
  appliedToRealQueries: boolean;
  appliedReason: string | null;
  replacedQuery: string | null;
  realQueryIndex: number | null;
  updatedQueries: string[];
};

function normalizeCompareText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getUrbanPatternApplicationReason(type: UrbanPatternType, city: string) {
  const normalizedCity = normalizeCompareText(city);
  const isAparecida = normalizedCity.includes("aparecida");
  if (isAparecida) {
    return "APARECIDA_URBAN_PATTERN_REPLACE";
  }
  if (type === "RC" || type === "CV" || type === "AC") {
    return "GOIANIA_URBAN_PATTERN_STRICT_REPLACE";
  }
  return "GOIANIA_URBAN_PATTERN_CONTEXTUAL_REPLACE";
}

export function applyUrbanPatternToRealQueries(params: {
  queries: string[];
  urbanPattern: {
    detected: boolean;
    type: UrbanPatternType | null;
    query: string | null;
  } | null;
  city: string;
}): UrbanPatternRealQueryApplication {
  const queries = params.queries.slice(0, 3);
  const urbanPattern = params.urbanPattern;

  if (!urbanPattern?.detected || !urbanPattern.query || !urbanPattern.type) {
    return {
      appliedToRealQueries: false,
      appliedReason: null,
      replacedQuery: null,
      realQueryIndex: null,
      updatedQueries: queries,
    };
  }

  if (queries.length < 2) {
    return {
      appliedToRealQueries: false,
      appliedReason: "NO_WEAK_QUERY_SLOT",
      replacedQuery: null,
      realQueryIndex: null,
      updatedQueries: queries,
    };
  }

  const normalizedCity = normalizeCompareText(params.city);
  const isAparecida = normalizedCity.includes("aparecida");
  const queryText = urbanPattern.query;
  const hasQuadra = /quadra\s+\d+/i.test(queryText);
  const hasLote = /\blote\b/i.test(queryText);
  const hasContext = /bairro|cep/i.test(queryText);

  const allowForGoiania =
    urbanPattern.type === "RC" ||
    urbanPattern.type === "CV" ||
    urbanPattern.type === "AC" ||
    ((urbanPattern.type === "H" || urbanPattern.type === "V") && hasQuadra && (hasLote || hasContext));

  const allowForAparecida =
    hasQuadra &&
    (urbanPattern.type === "H" ||
      urbanPattern.type === "V" ||
      urbanPattern.type === "RC" ||
      urbanPattern.type === "CV" ||
      urbanPattern.type === "AC");

  const shouldApply = isAparecida ? allowForAparecida : allowForGoiania;
  if (!shouldApply) {
    return {
      appliedToRealQueries: false,
      appliedReason: "URBAN_PATTERN_NOT_STRONG_ENOUGH",
      replacedQuery: null,
      realQueryIndex: null,
      updatedQueries: queries,
    };
  }

  const targetIndex = queries.length >= 3 ? 2 : 1;
  const replacedQuery = queries[targetIndex] || null;
  const updatedQueries = queries.slice();

  if (!replacedQuery) {
    return {
      appliedToRealQueries: false,
      appliedReason: "NO_WEAK_QUERY_SLOT",
      replacedQuery: null,
      realQueryIndex: null,
      updatedQueries: queries,
    };
  }

  const urbanQueryNormalized = normalizeCompareText(urbanPattern.query);
  const duplicate = updatedQueries.some((query) => normalizeCompareText(query) === urbanQueryNormalized);
  if (duplicate) {
    return {
      appliedToRealQueries: false,
      appliedReason: "URBAN_PATTERN_DUPLICATE",
      replacedQuery: null,
      realQueryIndex: null,
      updatedQueries: queries,
    };
  }

  updatedQueries[targetIndex] = urbanPattern.query;
  return {
    appliedToRealQueries: true,
    appliedReason: getUrbanPatternApplicationReason(urbanPattern.type, params.city),
    replacedQuery,
    realQueryIndex: targetIndex,
    updatedQueries: updatedQueries.slice(0, 3),
  };
}
