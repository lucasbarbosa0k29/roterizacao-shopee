export type WhatsAppTxtImportRow = {
  sequence: string;
  bairro: string;
  city: string;
  cep: string;
  original: string;
  observacao: string;
  cliente: string;
  remetente: string;
  codigoPacote: string;
};

export type WhatsAppTxtRejectedLine = {
  line: number;
  text: string;
  reason: string;
};

export type WhatsAppTxtParseResult = {
  rows: WhatsAppTxtImportRow[];
  expectedCount: number | null;
  warnings: string[];
  rejectedLines: WhatsAppTxtRejectedLine[];
};

type ParsedLine = {
  line: number;
  text: string;
};

const WHATSAPP_MESSAGE_PREFIX =
  /^\u200e?\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*-\s*(?:(.*?):\s*)?(.*)$/;

const PACKAGE_MARKER = /^pacote\s+de\s+(.+)$/i;
const EXPECTED_COUNT = /sua\s+lista\s+tem\s+(\d+)\s+pacotes?/i;

function stripDiacritics(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeSpaces(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCity(value: string) {
  const cleaned = normalizeSpaces(value);
  const key = stripDiacritics(cleaned).toUpperCase();

  if (key === "GOIANIA" || key === "GO" || key === "GOIAS") return "Goiânia";
  return cleaned;
}

function normalizeUf(value: string) {
  const key = stripDiacritics(value).toUpperCase().trim();
  if (key === "GO" || key === "GOIAS") return "GO";
  return value.trim().toUpperCase();
}

function cleanWhatsAppLine(rawLine: string): ParsedLine["text"] {
  const line = rawLine.replace(/^\uFEFF/, "").trim();
  const messageMatch = line.match(WHATSAPP_MESSAGE_PREFIX);
  if (!messageMatch) return line;
  return String(messageMatch[2] || "").trim();
}

function isIgnorableLine(text: string) {
  const key = stripDiacritics(text).toUpperCase();
  return (
    !key ||
    key.includes("MENSAGENS QUE VOCE ENVIA NESTA CONVERSA SAO PROTEGIDAS") ||
    key.includes("CRIPTOGRAFIA DE PONTA A PONTA") ||
    key.includes("SAIBA MAIS") ||
    EXPECTED_COUNT.test(text) ||
    key.startsWith("CONFIRA OS PACOTES") ||
    key.startsWith("COMECE A FAZER AS ENTREGAS")
  );
}

function extractCep(address: string) {
  const match = address.match(/(?:^|\D)(\d{5}-?\d{3})(?!\d)\s*$/);
  if (!match) return { cep: "", withoutCep: address };

  const cep = match[1].replace(/\D/g, "");
  return {
    cep,
    withoutCep: address.slice(0, match.index).trim(),
  };
}

function extractCityState(addressWithoutCep: string) {
  const value = normalizeSpaces(addressWithoutCep);
  const explicitGoianiaMatch = value.match(/(.+)\s+(Goi[âa]nia|Goiania)\s*-\s*(GO|Goi[aá]s)\s*$/i);

  if (explicitGoianiaMatch) {
    return {
      addressCore: normalizeSpaces(explicitGoianiaMatch[1]),
      city: "Goiânia",
      uf: normalizeUf(explicitGoianiaMatch[3]),
    };
  }

  const cityUfNoDashMatch = value.match(/(.+?)\s+(Goi[âa]nia|Goiania)\s+(GO|Goi[aá]s)\s*$/i);
  if (cityUfNoDashMatch) {
    return {
      addressCore: normalizeSpaces(cityUfNoDashMatch[1]),
      city: normalizeCity(cityUfNoDashMatch[2]),
      uf: normalizeUf(cityUfNoDashMatch[3]),
    };
  }

  const goianiaOnlyMatch = value.match(/(.+?)\s+(Goi[âa]nia|Goiania)\s*$/i);
  if (goianiaOnlyMatch) {
    return {
      addressCore: normalizeSpaces(goianiaOnlyMatch[1]),
      city: "Goiânia",
      uf: "GO",
    };
  }

  const cityStateMatch = value.match(
    /(.+?)\s+([A-Za-zÀ-ÿ ]{2,40}?)\s*-\s*(GO|Goi[aá]s)\s*$/i,
  );

  if (cityStateMatch) {
    return {
      addressCore: normalizeSpaces(cityStateMatch[1]),
      city: normalizeCity(cityStateMatch[2]),
      uf: normalizeUf(cityStateMatch[3]),
    };
  }

  const stateOnlyMatch = value.match(/(.+?)\s+(GO|Goi[aá]s)\s*$/i);
  if (stateOnlyMatch) {
    return {
      addressCore: normalizeSpaces(stateOnlyMatch[1]),
      city: "Goiânia",
      uf: normalizeUf(stateOnlyMatch[2]),
    };
  }

  return {
    addressCore: value,
    city: "",
    uf: "",
  };
}

function extractObservation(addressCore: string) {
  const patterns = [
    /\b(End(?:ere[cç]o)?\s+Comercial\b.*)$/i,
    /\b(Hor[aá]rio\s+Comercial\b.*)$/i,
    /\b(\d{1,2}h\s*(?:a|as|às|-)\s*\d{1,2}h\b.*)$/i,
  ];

  for (const pattern of patterns) {
    const match = addressCore.match(pattern);
    if (match?.[1]) return normalizeSpaces(match[1]);
  }

  return "";
}

function buildOriginalAddress(address: string, city: string, uf: string, cep: string) {
  const parts = [normalizeSpaces(address)];
  if (city && uf) parts.push(`${city} - ${uf}`);
  else if (city) parts.push(city);
  if (cep) parts.push(cep);
  return parts.filter(Boolean).join(" ");
}

function parseAddress(rawAddress: string) {
  const address = normalizeSpaces(rawAddress);
  const { cep, withoutCep } = extractCep(address);
  const { addressCore, city, uf } = extractCityState(withoutCep);
  const observacao = extractObservation(addressCore);

  return {
    city,
    uf,
    cep,
    observacao,
    original: buildOriginalAddress(addressCore, city, uf, cep),
  };
}

function toRejected(lines: ParsedLine[], reason: string): WhatsAppTxtRejectedLine[] {
  return lines.map((line) => ({
    line: line.line,
    text: line.text,
    reason,
  }));
}

export function parseWhatsAppTxtImport(text: string): WhatsAppTxtParseResult {
  const sourceLines = String(text || "").split(/\r?\n/);
  const lines = sourceLines.map((line, index) => ({
    line: index + 1,
    text: cleanWhatsAppLine(line),
  }));

  const expectedCount =
    lines
      .map((line) => line.text.match(EXPECTED_COUNT)?.[1])
      .find((value): value is string => !!value) ?? null;

  const rows: WhatsAppTxtImportRow[] = [];
  const warnings: string[] = [];
  const rejectedLines: WhatsAppTxtRejectedLine[] = [];

  let cursor = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const markerMatch = lines[i].text.match(PACKAGE_MARKER);
    if (!markerMatch) continue;

    const packageLines = lines
      .slice(cursor, i)
      .filter((line) => !isIgnorableLine(line.text));

    const sender = normalizeSpaces(markerMatch[1]);
    const codeLineIndex = lines.findIndex(
      (line, index) => index > i && !isIgnorableLine(line.text),
    );

    if (packageLines.length < 2) {
      rejectedLines.push(
        ...toRejected([lines[i], ...packageLines], "Pacote sem nome e endereço antes de 'Pacote de'."),
      );
      cursor = i + 1;
      continue;
    }

    if (codeLineIndex < 0) {
      rejectedLines.push({
        line: lines[i].line,
        text: lines[i].text,
        reason: "Pacote sem código/rastreio depois de 'Pacote de'.",
      });
      cursor = i + 1;
      continue;
    }

    const customerName = normalizeSpaces(packageLines[0].text);
    const rawAddress = normalizeSpaces(packageLines.slice(1).map((line) => line.text).join(" "));
    const trackingCode = normalizeSpaces(lines[codeLineIndex].text);
    const parsedAddress = parseAddress(rawAddress);

    if (!customerName || !rawAddress || !sender || !trackingCode) {
      rejectedLines.push(
        ...toRejected([lines[i], ...packageLines, lines[codeLineIndex]], "Pacote incompleto."),
      );
      cursor = codeLineIndex + 1;
      i = codeLineIndex;
      continue;
    }

    rows.push({
      sequence: String(rows.length + 1),
      bairro: "",
      city: parsedAddress.city,
      cep: parsedAddress.cep,
      original: parsedAddress.original,
      observacao: parsedAddress.observacao,
      cliente: customerName,
      remetente: sender,
      codigoPacote: trackingCode,
    });

    cursor = codeLineIndex + 1;
    i = codeLineIndex;
  }

  const leftovers = lines.slice(cursor).filter((line) => !isIgnorableLine(line.text));
  if (leftovers.length) {
    rejectedLines.push(...toRejected(leftovers, "Linha fora de um pacote reconhecido."));
  }

  const expected = expectedCount ? Number(expectedCount) : null;
  if (expected !== null && expected !== rows.length) {
    warnings.push(
      `O TXT informa ${expected} pacotes, mas foram reconhecidos ${rows.length}. Revise as linhas rejeitadas antes de continuar.`,
    );
  }

  return {
    rows,
    expectedCount: expected,
    warnings,
    rejectedLines,
  };
}
