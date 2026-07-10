export type CnpjProvider = "BRASILAPI" | "RECEITAWS";
export type CnpjVerificationStatus = "VERIFIED" | "PENDING_VERIFICATION";
export type CnpjVerificationReason = "API_UNAVAILABLE" | "NOT_FOUND" | "RATE_LIMIT";

export type NormalizedCnpjCompany = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacaoCadastral: string;
  cidade: string | null;
  uf: string | null;
  provider: CnpjProvider | null;
  cnpjVerificationStatus: CnpjVerificationStatus;
  cnpjVerificationReason: CnpjVerificationReason | null;
  cnpjVerifiedAt: Date | null;
  rawData: unknown;
};

export type CnpjProviderResult =
  | { kind: "FOUND"; company: NormalizedCnpjCompany }
  | { kind: "NOT_FOUND" }
  | { kind: "RATE_LIMIT" }
  | { kind: "UNAVAILABLE" };

export type CnpjVerificationOutcome =
  | { kind: "VERIFIED"; company: NormalizedCnpjCompany }
  | { kind: "PENDING_VERIFICATION"; company: NormalizedCnpjCompany; reason: CnpjVerificationReason }
  | { kind: "INACTIVE"; provider: CnpjProvider; company: NormalizedCnpjCompany }
  | { kind: "NOT_FOUND" };

type CnpjValidationCode = "INVALID";

export class CnpjValidationError extends Error {
  code: CnpjValidationCode;

  constructor(code: CnpjValidationCode, message: string) {
    super(message);
    this.name = "CnpjValidationError";
    this.code = code;
  }
}

const CNPJ_TIMEOUT_MS = 6000;
const CNPJ_NOT_FOUND_MESSAGE =
  "CNPJ não localizado nas bases consultadas. Se o seu MEI/CNPJ foi aberto recentemente, entre em contato com o suporte pelo WhatsApp.";

export function cleanCnpj(cnpj: string) {
  return String(cnpj ?? "").replace(/\D/g, "");
}

export function isValidCnpj(cnpj: string) {
  const digits = cleanCnpj(cnpj);
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;

  const calcDigit = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, weight, index) => acc + Number(base[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calcDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calcDigit(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return digits.endsWith(`${firstDigit}${secondDigit}`);
}

type JsonLookupResult =
  | { kind: "OK"; data: unknown }
  | { kind: "NOT_FOUND" }
  | { kind: "RATE_LIMIT" }
  | { kind: "UNAVAILABLE" };

async function fetchJsonWithTimeout(url: string): Promise<JsonLookupResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CNPJ_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (response.status === 404) return { kind: "NOT_FOUND" };
    if (response.status === 429) return { kind: "RATE_LIMIT" };
    if (response.status >= 500) return { kind: "UNAVAILABLE" };
    if (!response.ok) return { kind: "UNAVAILABLE" };

    const data = await response.json().catch(() => null);
    return { kind: "OK", data };
  } catch {
    return { kind: "UNAVAILABLE" };
  } finally {
    clearTimeout(timeout);
  }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStatus(value: unknown) {
  return hasText(value) ? value.trim().toUpperCase() : "";
}

function buildCompany(params: {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacaoCadastral: string;
  cidade: string | null;
  uf: string | null;
  provider: CnpjProvider;
  rawData: unknown;
}): NormalizedCnpjCompany {
  return {
    cnpj: params.cnpj,
    razaoSocial: params.razaoSocial,
    nomeFantasia: params.nomeFantasia,
    situacaoCadastral: params.situacaoCadastral,
    cidade: params.cidade,
    uf: params.uf,
    provider: params.provider,
    cnpjVerificationStatus: "VERIFIED",
    cnpjVerificationReason: null,
    cnpjVerifiedAt: new Date(),
    rawData: params.rawData,
  };
}

function buildPendingCompany(cnpj: string, reason: CnpjVerificationReason): NormalizedCnpjCompany {
  return {
    cnpj,
    razaoSocial: "Pendente de verificação",
    nomeFantasia: null,
    situacaoCadastral: "PENDING_VERIFICATION",
    cidade: null,
    uf: null,
    provider: null,
    cnpjVerificationStatus: "PENDING_VERIFICATION",
    cnpjVerificationReason: reason,
    cnpjVerifiedAt: null,
    rawData: { reason },
  };
}

function choosePendingReason(results: CnpjProviderResult[]): CnpjVerificationReason {
  if (results.some((result) => result.kind === "RATE_LIMIT")) return "RATE_LIMIT";
  return "API_UNAVAILABLE";
}

function isFoundResult(result: CnpjProviderResult): result is Extract<CnpjProviderResult, { kind: "FOUND" }> {
  return result.kind === "FOUND";
}

function isInactiveCompany(company: NormalizedCnpjCompany) {
  return company.situacaoCadastral !== "ATIVA";
}

async function lookupBrasilApi(cnpj: string): Promise<CnpjProviderResult> {
  const digits = cleanCnpj(cnpj);
  const result = await fetchJsonWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);

  if (result.kind !== "OK") return result;

  const data = result.data as Record<string, unknown> | null;
  const razaoSocial = data?.razao_social;
  const situacaoCadastral = data?.descricao_situacao_cadastral;

  if (!data || !hasText(razaoSocial) || !hasText(situacaoCadastral)) {
    return { kind: "UNAVAILABLE" };
  }

  return {
    kind: "FOUND",
    company: buildCompany({
      cnpj: digits,
      razaoSocial: razaoSocial.trim(),
      nomeFantasia: hasText(data.nome_fantasia) ? data.nome_fantasia.trim() : null,
      situacaoCadastral: normalizeStatus(situacaoCadastral),
      cidade: hasText(data.municipio) ? data.municipio.trim() : null,
      uf: hasText(data.uf) ? data.uf.trim().toUpperCase() : null,
      provider: "BRASILAPI",
      rawData: data,
    }),
  };
}

async function lookupReceitaWs(cnpj: string): Promise<CnpjProviderResult> {
  const digits = cleanCnpj(cnpj);
  const result = await fetchJsonWithTimeout(`https://www.receitaws.com.br/v1/cnpj/${digits}`);

  if (result.kind !== "OK") return result;

  const data = result.data as Record<string, unknown> | null;
  const razaoSocial = data?.nome;
  const situacaoCadastral = data?.situacao;

  if (!data) return { kind: "UNAVAILABLE" };
  if (data.status === "ERROR") return { kind: "NOT_FOUND" };
  if (!hasText(razaoSocial) || !hasText(situacaoCadastral)) return { kind: "UNAVAILABLE" };

  return {
    kind: "FOUND",
    company: buildCompany({
      cnpj: digits,
      razaoSocial: razaoSocial.trim(),
      nomeFantasia: hasText(data.fantasia) ? data.fantasia.trim() : null,
      situacaoCadastral: normalizeStatus(situacaoCadastral),
      cidade: hasText(data.municipio) ? data.municipio.trim() : null,
      uf: hasText(data.uf) ? data.uf.trim().toUpperCase() : null,
      provider: "RECEITAWS",
      rawData: data,
    }),
  };
}

export function resolveCnpjVerificationOutcome(
  cnpj: string,
  brasilApiResult: CnpjProviderResult,
  receitaWsResult: CnpjProviderResult
): CnpjVerificationOutcome {
  if (isFoundResult(brasilApiResult)) {
    if (isInactiveCompany(brasilApiResult.company)) {
      return { kind: "INACTIVE", provider: brasilApiResult.company.provider ?? "BRASILAPI", company: brasilApiResult.company };
    }
    return { kind: "VERIFIED", company: brasilApiResult.company };
  }

  if (isFoundResult(receitaWsResult)) {
    if (isInactiveCompany(receitaWsResult.company)) {
      return { kind: "INACTIVE", provider: receitaWsResult.company.provider ?? "RECEITAWS", company: receitaWsResult.company };
    }
    return { kind: "VERIFIED", company: receitaWsResult.company };
  }

  if (brasilApiResult.kind === "NOT_FOUND" || receitaWsResult.kind === "NOT_FOUND") {
    return { kind: "NOT_FOUND" };
  }

  return {
    kind: "PENDING_VERIFICATION",
    company: buildPendingCompany(cnpj, choosePendingReason([brasilApiResult, receitaWsResult])),
    reason: choosePendingReason([brasilApiResult, receitaWsResult]),
  };
}

export async function validateCnpjCompany(cnpj: string): Promise<CnpjVerificationOutcome> {
  const digits = cleanCnpj(cnpj);
  if (!isValidCnpj(digits)) {
    throw new CnpjValidationError("INVALID", "CNPJ inválido. Verifique os números informados.");
  }

  const brasilApiResult = await lookupBrasilApi(digits);
  if (isFoundResult(brasilApiResult)) {
    if (isInactiveCompany(brasilApiResult.company)) {
      return { kind: "INACTIVE", provider: brasilApiResult.company.provider ?? "BRASILAPI", company: brasilApiResult.company };
    }
    return { kind: "VERIFIED", company: brasilApiResult.company };
  }

  const receitaWsResult = await lookupReceitaWs(digits);
  if (isFoundResult(receitaWsResult)) {
    if (isInactiveCompany(receitaWsResult.company)) {
      return { kind: "INACTIVE", provider: receitaWsResult.company.provider ?? "RECEITAWS", company: receitaWsResult.company };
    }
    return { kind: "VERIFIED", company: receitaWsResult.company };
  }

  return resolveCnpjVerificationOutcome(digits, brasilApiResult, receitaWsResult);
}

export function getCnpjNotFoundMessage() {
  return CNPJ_NOT_FOUND_MESSAGE;
}
