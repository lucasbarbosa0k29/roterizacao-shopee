export type GeocodeConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type GeocodeConfidenceSource =
  | "MEMORY_EXACT"
  | "MEMORY_BASE"
  | "MEMORY_APPROX"
  | "HERE_GEOCODE"
  | "HERE_DISCOVER"
  | "NONE";

export type GeocodeConfidenceInput = {
  source: GeocodeConfidenceSource;
  expected: {
    rua?: string;
    bairro?: string;
    cidade?: string;
    cep?: string;
    quadra?: string;
    lote?: string;
  };
  actual?: {
    rua?: string;
    bairro?: string;
    cidade?: string;
    cep?: string;
    resultType?: string;
  };
  hasCoords: boolean;
  hasQuadra: boolean;
  hasLote: boolean;
  hereSpreadMeters?: number;
  memoryStrength?: "STRONG" | "MEDIUM" | "WEAK" | "NONE";
  hardSignals?: readonly string[];
};

export type GeocodeConfidenceResult = {
  confidence: number;
  level: GeocodeConfidenceLevel;
  hardMismatch: boolean;
  flags: string[];
  reasons: string[];
};

function normalizeText(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCep(value: string) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 8) return digits;
  return String(value || "").trim();
}

function includesEither(a?: string, b?: string) {
  const left = normalizeText(a || "");
  const right = normalizeText(b || "");
  return !!left && !!right && (left.includes(right) || right.includes(left));
}

function exactMatch(a?: string, b?: string) {
  const left = normalizeText(a || "");
  const right = normalizeText(b || "");
  return !!left && !!right && left === right;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getLevel(confidence: number): GeocodeConfidenceLevel {
  if (confidence >= 85) return "HIGH";
  if (confidence >= 70) return "MEDIUM";
  return "LOW";
}

export function computeGeocodeConfidence(
  input: GeocodeConfidenceInput,
): GeocodeConfidenceResult {
  const flags = new Set<string>();
  const reasons: string[] = [];
  let score = 0;

  switch (input.source) {
    case "MEMORY_EXACT":
      flags.add("SOURCE_MEMORY_EXACT");
      reasons.push("Origem principal: memória exata.");
      score += 12;
      break;
    case "MEMORY_BASE":
      flags.add("SOURCE_MEMORY_BASE");
      reasons.push("Origem principal: memória base.");
      score += 8;
      break;
    case "MEMORY_APPROX":
      flags.add("SOURCE_MEMORY_APPROX");
      reasons.push("Origem principal: memória aproximada.");
      score += 4;
      break;
    case "HERE_DISCOVER":
      flags.add("SOURCE_HERE_DISCOVER");
      reasons.push("Origem principal: HERE Discover.");
      break;
    case "HERE_GEOCODE":
      flags.add("SOURCE_HERE_GEOCODE");
      reasons.push("Origem principal: HERE Geocode.");
      break;
    default:
      flags.add("SOURCE_NONE");
      reasons.push("Sem origem principal confirmada.");
      break;
  }

  const expectedRua = input.expected.rua || "";
  const expectedBairro = input.expected.bairro || "";
  const expectedCidade = input.expected.cidade || "";
  const expectedCep = normalizeCep(input.expected.cep || "");

  const actualRua = input.actual?.rua || "";
  const actualBairro = input.actual?.bairro || "";
  const actualCidade = input.actual?.cidade || "";
  const actualCep = normalizeCep(input.actual?.cep || "");
  const resultType = String(input.actual?.resultType || "").trim().toLowerCase();

  if (input.hasCoords) {
    score += 15;
    flags.add("HAS_COORDS");
    reasons.push("Coordenadas presentes.");
  } else {
    score -= 20;
    flags.add("NO_COORDS");
    reasons.push("Coordenadas ausentes.");
  }

  if (expectedRua && actualRua) {
    if (exactMatch(expectedRua, actualRua)) {
      score += 25;
      flags.add("RUA_EXACT");
      reasons.push("Rua bate exatamente.");
    } else if (includesEither(expectedRua, actualRua)) {
      score += 14;
      flags.add("RUA_PARTIAL");
      reasons.push("Rua bate parcialmente.");
    } else {
      score -= 18;
      flags.add("RUA_MISMATCH");
      reasons.push("Rua divergente.");
    }
  }

  if (expectedCidade && actualCidade) {
    if (exactMatch(expectedCidade, actualCidade) || includesEither(expectedCidade, actualCidade)) {
      score += 15;
      flags.add("CIDADE_MATCH");
      reasons.push("Cidade coerente.");
    } else {
      score -= 25;
      flags.add("CIDADE_MISMATCH");
      reasons.push("Cidade divergente.");
    }
  }

  if (expectedBairro && actualBairro) {
    if (exactMatch(expectedBairro, actualBairro) || includesEither(expectedBairro, actualBairro)) {
      score += 12;
      flags.add("BAIRRO_MATCH");
      reasons.push("Bairro/setor coerente.");
    } else {
      score -= 15;
      flags.add("BAIRRO_MISMATCH");
      reasons.push("Bairro/setor divergente.");
    }
  }

  if (expectedCep && actualCep) {
    if (expectedCep === actualCep) {
      score += 8;
      flags.add("CEP_MATCH");
      reasons.push("CEP coerente.");
    } else {
      score -= 8;
      flags.add("CEP_MISMATCH");
      reasons.push("CEP divergente.");
    }
  }

  if (input.hasQuadra) {
    score += 6;
    flags.add("HAS_QUADRA");
    reasons.push("Quadra presente.");
  } else {
    flags.add("NO_QUADRA");
  }

  if (input.hasLote) {
    score += 6;
    flags.add("HAS_LOTE");
    reasons.push("Lote presente.");
  } else {
    flags.add("NO_LOTE");
  }

  if (resultType === "housenumber") {
    score += 8;
    flags.add("RESULT_HOUSENUMBER");
    reasons.push("Resultado HERE do tipo housenumber.");
  } else if (resultType === "street") {
    score += 4;
    flags.add("RESULT_STREET");
    reasons.push("Resultado HERE do tipo street.");
  } else if (resultType) {
    flags.add(`RESULT_${resultType.toUpperCase()}`);
  }

  if (input.memoryStrength === "STRONG") {
    score += 10;
    flags.add("MEMORY_STRONG");
    reasons.push("Hit forte de memória.");
  } else if (input.memoryStrength === "MEDIUM") {
    score += 4;
    flags.add("MEMORY_MEDIUM");
    reasons.push("Hit médio de memória.");
  } else if (input.memoryStrength === "WEAK") {
    flags.add("MEMORY_WEAK");
  }

  if (typeof input.hereSpreadMeters === "number") {
    if (input.hereSpreadMeters > 250) {
      score -= 20;
      flags.add("HERE_SPREAD_HIGH");
      reasons.push(`Espalhamento alto do HERE (${Math.round(input.hereSpreadMeters)}m).`);
    } else if (input.hereSpreadMeters > 120) {
      score -= 8;
      flags.add("HERE_SPREAD_MEDIUM");
      reasons.push(`Espalhamento moderado do HERE (${Math.round(input.hereSpreadMeters)}m).`);
    }
  }

  for (const signal of input.hardSignals || []) {
    flags.add(signal);
  }

  const hardMismatch =
    flags.has("RUA_MISMATCH") ||
    flags.has("CIDADE_MISMATCH") ||
    flags.has("BAIRRO_MISMATCH") ||
    flags.has("CEP_MISMATCH") ||
    flags.has("HERE_SPREAD_HIGH") ||
    (input.hardSignals || []).length > 0;

  if (hardMismatch) {
    reasons.push("Existe pelo menos um sinal forte de inconsistência.");
  }

  const confidence = clamp(score, 0, 100);

  return {
    confidence,
    level: getLevel(confidence),
    hardMismatch,
    flags: Array.from(flags),
    reasons,
  };
}
