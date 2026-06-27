export type AddressContextSource =
  | "address"
  | "complemento"
  | "observacao"
  | "bairro"
  | "referencia";

export type AddressContextType =
  | "CONDOMINIO_HORIZONTAL"
  | "CONDOMINIO_VERTICAL"
  | "RESIDENCIAL"
  | "CONJUNTO"
  | "LOTEAMENTO"
  | "EDIFICIO"
  | "APARTAMENTO"
  | "CHACARA"
  | "FAZENDA"
  | "COMERCIAL"
  | "GALPAO"
  | "DISTRITO_INDUSTRIAL"
  | "PARQUE_RESIDENCIAL"
  | "CONDOMINIO_EMPRESARIAL"
  | "VILLAGE"
  | "OUTRO";

export type AddressContextConfidence = "HIGH" | "MEDIUM" | "LOW";

export type AddressContextDetectionResult = {
  addressContextDetected: boolean;
  addressContextType: AddressContextType;
  addressContextConfidence: AddressContextConfidence;
  addressContextSource: AddressContextSource | null;
  addressContextText: string | null;
  addressContextName: string | null;
  addressContextNormalizedName: string | null;
  addressContextTokens: string[];
  addressContextBlock: string | null;
  addressContextTower: string | null;
  addressContextApartment: string | null;
  addressContextHouse: string | null;
  addressContextQuadra: string | null;
  addressContextLot: string | null;
  addressContextHasQdLt: boolean;
  addressContextQdLtSource: AddressContextSource | null;
};

type AddressContextCandidate = AddressContextDetectionResult & {
  score: number;
};

type AddressContextInput = {
  address?: string | null;
  complemento?: string | null;
  observacao?: string | null;
  bairro?: string | null;
  referencia?: string | null;
};

const SOURCE_ORDER: AddressContextSource[] = [
  "address",
  "complemento",
  "observacao",
  "bairro",
  "referencia",
];

const CONTEXT_PREFIX_RE =
  /^(?:(?:CONDOMINIO(?: HORIZONTAL| VERTICAL| EMPRESARIAL)?|COND|RESIDENCIAL|RES|CONJUNTO|CJ|LOTEAMENTO|EDIFICIO|EDIF|PREDIO|APTO|APT|APARTAMENTO|CHACARA|FAZENDA|COMERCIAL|GALPAO|DISTRITO INDUSTRIAL|PARQUE RESIDENCIAL|VILLAGE|VILLE|HORIZONTAL|VERTICAL|PARQUE|BOSQUE|RESERVA|MORADAS|PLAZA|PRIVE)\b[\s\-:,.\/]*)+/i;

const QD_RE = /\b(?:QD|QDR|QUADRA)\b[\s\-:]*([A-Z0-9][A-Z0-9\-]*)/i;
const LT_RE = /\b(?:LT|LOT|LOTE)\b[\s\-:]*([A-Z0-9][A-Z0-9\-]*)/i;
const BLOCK_RE = /\b(?:BLOCO|BL)\b[\s\-:]*([A-Z0-9][A-Z0-9\-]*)/i;
const TOWER_RE = /\bTORRE\b[\s\-:]*([A-Z0-9][A-Z0-9\-]*)/i;
const APARTMENT_RE = /\b(?:APTO|APT|APARTAMENTO)\b[\s\-:]*([A-Z0-9][A-Z0-9\-]*)/i;
const HOUSE_RE = /\b(?:CASA|CS)\b[\s\-:]*([A-Z0-9][A-Z0-9\-]*)/i;

const tokenMatchers: Array<{ token: string; regex: RegExp }> = [
  { token: "CONDOMINIO EMPRESARIAL", regex: /\bCONDOMINIO\s+EMPRESARIAL\b/i },
  { token: "DISTRITO INDUSTRIAL", regex: /\bDISTRITO\s+INDUSTRIAL\b/i },
  { token: "PARQUE RESIDENCIAL", regex: /\bPARQUE\s+RESIDENCIAL\b/i },
  { token: "CONDOMINIO", regex: /\bCONDOMINIO\b/i },
  { token: "COND", regex: /\bCOND\b/i },
  { token: "CONJUNTO", regex: /\bCONJUNTO\b/i },
  { token: "CJ", regex: /\bCJ\b/i },
  { token: "RESIDENCIAL", regex: /\bRESIDENCIAL\b/i },
  { token: "RES", regex: /\bRES\b/i },
  { token: "LOTEAMENTO", regex: /\bLOTEAMENTO\b/i },
  { token: "EDIFICIO", regex: /\bEDIFICIO\b/i },
  { token: "EDIF", regex: /\bEDIF\b/i },
  { token: "PREDIO", regex: /\bPREDIO\b/i },
  { token: "APARTAMENTO", regex: /\bAPARTAMENTO\b/i },
  { token: "APTO", regex: /\bAPTO\b/i },
  { token: "APT", regex: /\bAPT\b/i },
  { token: "CHACARA", regex: /\bCHACARA\b/i },
  { token: "FAZENDA", regex: /\bFAZENDA\b/i },
  { token: "COMERCIAL", regex: /\bCOMERCIAL\b/i },
  { token: "GALPAO", regex: /\bGALPAO\b/i },
  { token: "VILLAGE", regex: /\bVILLAGE\b/i },
  { token: "VILLE", regex: /\bVILLE\b/i },
  { token: "HORIZONTAL", regex: /\bHORIZONTAL\b/i },
  { token: "VERTICAL", regex: /\bVERTICAL\b/i },
  { token: "PARQUE", regex: /\bPARQUE\b/i },
  { token: "BOSQUE", regex: /\bBOSQUE\b/i },
  { token: "RESERVA", regex: /\bRESERVA\b/i },
  { token: "MORADAS", regex: /\bMORADAS\b/i },
  { token: "PLAZA", regex: /\bPLAZA\b/i },
  { token: "PRIVE", regex: /\bPRIVE\b/i },
  { token: "BLOCO", regex: /\bBLOCO\b/i },
  { token: "TORRE", regex: /\bTORRE\b/i },
  { token: "QD", regex: /\bQD\b/i },
  { token: "QUADRA", regex: /\bQUADRA\b/i },
  { token: "LT", regex: /\bLT\b/i },
  { token: "LOTE", regex: /\bLOTE\b/i },
  { token: "LOT", regex: /\bLOT\b/i },
];

function compactText(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeForMatch(value: string) {
  return compactText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sourcePriority(source: AddressContextSource) {
  return SOURCE_ORDER.indexOf(source);
}

function extractTokens(normalizedText: string) {
  const tokens: string[] = [];
  for (const matcher of tokenMatchers) {
    if (matcher.regex.test(normalizedText)) tokens.push(matcher.token);
  }
  return tokens;
}

function stripLeadingContextMarkers(rawText: string) {
  const stripped = String(rawText ?? "").replace(CONTEXT_PREFIX_RE, "").trim();
  return stripped.replace(/^[\s\-:,.\/]+|[\s\-:,.\/]+$/g, "").trim();
}

function extractContextName(rawText: string) {
  const stripped = stripLeadingContextMarkers(rawText);
  if (!stripped) return null;

  const beforeUnit = stripped.replace(
    /\b(?:BLOCO|BL|TORRE|APT|APTO|APARTAMENTO|QD|QUADRA|QDR|Q|LT|L|LOTE|LOT)\b.*$/i,
    "",
  );
  const cleaned = beforeUnit.replace(/^[\s\-:,.\/]+|[\s\-:,.\/]+$/g, "").trim();
  return cleaned || null;
}

function extractScalar(normalizedText: string, regex: RegExp) {
  const match = normalizedText.match(regex);
  if (!match) return null;
  return compactText(match[1] || "").toUpperCase() || null;
}

function getConfidence(args: {
  type: AddressContextType;
  tokens: string[];
  name: string | null;
  hasQdLt: boolean;
}) {
  const tokenSet = new Set(args.tokens);
  const hasStrongStructure =
    tokenSet.has("APTO") ||
    tokenSet.has("APT") ||
    tokenSet.has("APARTAMENTO") ||
    tokenSet.has("EDIFICIO") ||
    tokenSet.has("EDIF") ||
    tokenSet.has("PREDIO") ||
    tokenSet.has("CONDOMINIO EMPRESARIAL") ||
    tokenSet.has("DISTRITO INDUSTRIAL") ||
    tokenSet.has("PARQUE RESIDENCIAL") ||
    tokenSet.has("CONDOMINIO") ||
    tokenSet.has("CONJUNTO") ||
    tokenSet.has("LOTEAMENTO") ||
    tokenSet.has("CHACARA") ||
    tokenSet.has("FAZENDA") ||
    tokenSet.has("GALPAO");

  if (args.type === "VILLAGE") return "MEDIUM";
  if (args.type === "OUTRO") return tokenSet.has("PARQUE") || tokenSet.has("BOSQUE") || tokenSet.has("RESERVA") || tokenSet.has("MORADAS") || tokenSet.has("PLAZA") || tokenSet.has("PRIVE") ? "LOW" : "LOW";
  if (args.type === "CONDOMINIO_HORIZONTAL" || args.type === "CONDOMINIO_VERTICAL") {
    return hasStrongStructure || args.name ? "HIGH" : "MEDIUM";
  }
  if (args.type === "RESIDENCIAL") {
    return args.name || args.hasQdLt ? "HIGH" : "MEDIUM";
  }
  if (args.type === "APARTAMENTO" || args.type === "EDIFICIO") return "HIGH";
  if (args.type === "CONDOMINIO_EMPRESARIAL" || args.type === "PARQUE_RESIDENCIAL") return "HIGH";
  if (args.type === "COMERCIAL" || args.type === "DISTRITO_INDUSTRIAL") {
    return tokenSet.has("COMERCIAL") || tokenSet.has("DISTRITO INDUSTRIAL") ? "HIGH" : "MEDIUM";
  }
  if (args.type === "CONJUNTO" || args.type === "LOTEAMENTO" || args.type === "CHACARA" || args.type === "FAZENDA" || args.type === "GALPAO") {
    return "HIGH";
  }
  return "LOW";
}

function classifyContext(normalizedText: string): AddressContextType {
  const tokenSet = new Set(extractTokens(normalizedText));

  if (tokenSet.has("CONDOMINIO EMPRESARIAL")) return "CONDOMINIO_EMPRESARIAL";
  if (tokenSet.has("PARQUE RESIDENCIAL")) return "PARQUE_RESIDENCIAL";
  if (tokenSet.has("DISTRITO INDUSTRIAL")) return "DISTRITO_INDUSTRIAL";

  if (tokenSet.has("CONDOMINIO") || tokenSet.has("COND")) {
    if (
      tokenSet.has("VERTICAL") ||
      tokenSet.has("EDIFICIO") ||
      tokenSet.has("EDIF") ||
      tokenSet.has("PREDIO") ||
      tokenSet.has("APTO") ||
      tokenSet.has("APT") ||
      tokenSet.has("APARTAMENTO")
    ) {
      return "CONDOMINIO_VERTICAL";
    }

    if (
      tokenSet.has("HORIZONTAL") ||
      tokenSet.has("CS") ||
      tokenSet.has("QD") ||
      tokenSet.has("QUADRA") ||
      tokenSet.has("LT") ||
      tokenSet.has("LOTE") ||
      tokenSet.has("LOT")
    ) {
      return "CONDOMINIO_HORIZONTAL";
    }

    return "CONDOMINIO_HORIZONTAL";
  }

  if (tokenSet.has("APTO") || tokenSet.has("APT") || tokenSet.has("APARTAMENTO")) return "APARTAMENTO";
  if (tokenSet.has("EDIFICIO") || tokenSet.has("EDIF") || tokenSet.has("PREDIO")) return "EDIFICIO";
  if (tokenSet.has("CONJUNTO") || tokenSet.has("CJ")) return "CONJUNTO";
  if (tokenSet.has("LOTEAMENTO")) return "LOTEAMENTO";
  if (tokenSet.has("RESIDENCIAL") || tokenSet.has("RES")) return "RESIDENCIAL";
  if (tokenSet.has("CHACARA")) return "CHACARA";
  if (tokenSet.has("FAZENDA")) return "FAZENDA";
  if (tokenSet.has("COMERCIAL")) return "COMERCIAL";
  if (tokenSet.has("GALPAO")) return "GALPAO";
  if (tokenSet.has("VILLAGE") || tokenSet.has("VILLE")) return "VILLAGE";

  return "OUTRO";
}

function analyzeSource(source: AddressContextSource, rawText: string | null | undefined): AddressContextCandidate | null {
  const compact = compactText(rawText);
  if (!compact) return null;

  const normalizedText = normalizeForMatch(compact);
  if (!normalizedText) return null;

  const tokens = extractTokens(normalizedText);
  const type = classifyContext(normalizedText);
  const name = extractContextName(compact);
  const normalizedName = name ? normalizeForMatch(name) : null;

  const block = extractScalar(normalizedText, BLOCK_RE);
  const tower = extractScalar(normalizedText, TOWER_RE);
  const apartment = extractScalar(normalizedText, APARTMENT_RE);
  const house = extractScalar(normalizedText, HOUSE_RE);
  const quadra = extractScalar(normalizedText, QD_RE);
  const lot = extractScalar(normalizedText, LT_RE);
  const hasQdLt = !!(quadra || lot);
  const qdLtSource = hasQdLt ? source : null;
  const hasContextCue = tokens.some(
    (token) => !["QD", "QUADRA", "LT", "LOTE", "LOT"].includes(token),
  ) || !!block || !!tower || !!apartment;

  const confidence = getConfidence({
    type,
    tokens,
    name,
    hasQdLt,
  });

  const scoreBase = confidence === "HIGH" ? 300 : confidence === "MEDIUM" ? 200 : 100;
  const score =
    scoreBase +
    (name ? 20 : 0) +
    (hasQdLt ? 15 : 0) +
    (block ? 8 : 0) +
    (tower ? 8 : 0) +
    (apartment ? 12 : 0) +
    (house ? 6 : 0);

  return {
    score,
    addressContextDetected: type !== "OUTRO" || hasContextCue,
    addressContextType: type,
    addressContextConfidence: confidence,
    addressContextSource: source,
    addressContextText: compact,
    addressContextName: name,
    addressContextNormalizedName: normalizedName,
    addressContextTokens: tokens,
    addressContextBlock: block,
    addressContextTower: tower,
    addressContextApartment: apartment,
    addressContextHouse: house,
    addressContextQuadra: quadra,
    addressContextLot: lot,
    addressContextHasQdLt: hasQdLt,
    addressContextQdLtSource: qdLtSource,
  };
}

export function detectAddressContext(input: AddressContextInput): AddressContextDetectionResult {
  let bestContext: AddressContextCandidate | null = null;
  let bestQdLt: AddressContextCandidate | null = null;

  for (const source of SOURCE_ORDER) {
    const candidate = analyzeSource(source, input[source]);
    if (!candidate) continue;

    if (candidate.addressContextDetected) {
      if (
        !bestContext ||
        candidate.score > bestContext.score ||
        (candidate.score === bestContext.score &&
          sourcePriority(candidate.addressContextSource as AddressContextSource) <
            sourcePriority(bestContext.addressContextSource as AddressContextSource))
      ) {
        bestContext = candidate;
      }
    }

    if (
      candidate.addressContextHasQdLt &&
      (!bestQdLt ||
        candidate.score > bestQdLt.score ||
        (candidate.score === bestQdLt.score &&
          sourcePriority(candidate.addressContextSource as AddressContextSource) <
            sourcePriority(bestQdLt.addressContextSource as AddressContextSource)))
    ) {
      bestQdLt = candidate;
    }
  }

  if (!bestContext) {
    return {
      addressContextDetected: false,
      addressContextType: "OUTRO",
      addressContextConfidence: "LOW",
      addressContextSource: null,
      addressContextText: null,
      addressContextName: null,
      addressContextNormalizedName: null,
      addressContextTokens: [],
      addressContextBlock: null,
      addressContextTower: null,
      addressContextApartment: null,
      addressContextHouse: null,
      addressContextQuadra: null,
      addressContextLot: null,
      addressContextHasQdLt: !!bestQdLt,
      addressContextQdLtSource: bestQdLt?.addressContextSource ?? null,
    };
  }

  return {
    addressContextDetected: true,
    addressContextType: bestContext.addressContextType,
    addressContextConfidence: bestContext.addressContextConfidence,
    addressContextSource: bestContext.addressContextSource,
    addressContextText: bestContext.addressContextText,
    addressContextName: bestContext.addressContextName,
    addressContextNormalizedName: bestContext.addressContextNormalizedName,
    addressContextTokens: bestContext.addressContextTokens,
    addressContextBlock: bestContext.addressContextBlock,
    addressContextTower: bestContext.addressContextTower,
    addressContextApartment: bestContext.addressContextApartment,
    addressContextHouse: bestContext.addressContextHouse,
    addressContextQuadra: bestContext.addressContextQuadra,
    addressContextLot: bestContext.addressContextLot,
    addressContextHasQdLt: !!bestQdLt,
    addressContextQdLtSource: bestQdLt?.addressContextSource ?? null,
  };
}
