import type {
  LocalFirstAliasCandidate,
  LocalFirstAliasCandidatePack,
  LocalFirstAliasCandidatePair,
} from "@/app/lib/local-first-alias-candidates";

export type LocalFirstAliasAiSuggestion = {
  bairroAlias: string | null;
  ruaAlias: string | null;
  confidence: number;
  reason: string;
  selectedCandidateIds: {
    bairro: string | null;
    rua: string | null;
    pair: string | null;
  };
};

export type LocalFirstAliasAiResult = {
  attempted: boolean;
  accepted: boolean;
  rejectedReason?: string | null;
  rawText?: string | null;
  model?: string | null;
  suggestion: LocalFirstAliasAiSuggestion | null;
};

export type LocalFirstAliasAiInput = {
  pack: LocalFirstAliasCandidatePack;
  timeoutMs?: number;
};

const MIN_CONFIDENCE = 0.75;
const DEFAULT_TIMEOUT_MS = 8000;

function normalizeText(value: string | null | undefined) {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactCandidate(candidate: LocalFirstAliasCandidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    normalizedName: candidate.normalizedName,
    signals: candidate.signals,
    riskFlags: candidate.riskFlags,
  };
}

function compactPair(pair: LocalFirstAliasCandidatePair) {
  return {
    id: pair.id,
    bairroCandidateId: pair.bairroCandidateId,
    ruaCandidateId: pair.ruaCandidateId,
    bairroName: pair.bairroName,
    ruaName: pair.ruaName,
    signals: pair.signals,
    riskFlags: pair.riskFlags,
  };
}

function buildPrompt(pack: LocalFirstAliasCandidatePack) {
  const payload = {
    city: pack.city,
    source: pack.source,
    bairroCandidates: pack.bairroCandidates.map(compactCandidate),
    ruaCandidates: pack.ruaCandidates.map(compactCandidate),
    candidatePairs: pack.candidatePairs.map(compactPair),
  };

  return [
    "Você é um comparador textual controlado para aliases LocalFirst.",
    "Você NÃO resolve endereço.",
    "Você NÃO escolhe coordenada.",
    "Você NÃO valida quadra/lote.",
    "Você NÃO consulta HERE, memória ou qualquer fonte externa.",
    "Você só pode escolher aliases textuais dentro do Candidate Pack enviado.",
    "Não invente bairro ou rua.",
    "Use apenas IDs enviados no Candidate Pack.",
    "Se não houver equivalência textual clara, retorne aliases e IDs como null.",
    "Responda somente JSON, sem markdown.",
    "Formato obrigatório:",
    JSON.stringify({
      bairroAlias: null,
      ruaAlias: null,
      confidence: 0,
      reason: "",
      selectedCandidateIds: {
        bairro: null,
        rua: null,
        pair: null,
      },
    }),
    "Candidate Pack:",
    JSON.stringify(payload),
  ].join("\n");
}

function stripJsonFence(value: string) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseGeminiJson(rawText: string) {
  const cleaned = stripJsonFence(rawText);
  return JSON.parse(cleaned);
}

function extractGeminiText(data: any) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function findById<T extends { id: string }>(items: T[], id: string | null) {
  if (!id) return null;
  return items.find((item) => item.id === id) || null;
}

function normalizeSuggestion(value: any): LocalFirstAliasAiSuggestion {
  const selected = value?.selectedCandidateIds || {};
  const confidence = Number(value?.confidence);

  return {
    bairroAlias:
      value?.bairroAlias == null ? null : String(value.bairroAlias).trim() || null,
    ruaAlias: value?.ruaAlias == null ? null : String(value.ruaAlias).trim() || null,
    confidence: Number.isFinite(confidence) ? confidence : Number.NaN,
    reason: String(value?.reason || "").trim(),
    selectedCandidateIds: {
      bairro: selected?.bairro == null ? null : String(selected.bairro).trim() || null,
      rua: selected?.rua == null ? null : String(selected.rua).trim() || null,
      pair: selected?.pair == null ? null : String(selected.pair).trim() || null,
    },
  };
}

function validateSuggestionAgainstPack(
  suggestion: LocalFirstAliasAiSuggestion,
  pack: LocalFirstAliasCandidatePack,
): LocalFirstAliasAiResult {
  if (
    !Number.isFinite(suggestion.confidence) ||
    suggestion.confidence < 0 ||
    suggestion.confidence > 1
  ) {
    return {
      attempted: true,
      accepted: false,
      rejectedReason: "GEMINI_INVALID_CONFIDENCE",
      suggestion: null,
    };
  }

  if (suggestion.confidence < MIN_CONFIDENCE) {
    return {
      attempted: true,
      accepted: false,
      rejectedReason: "GEMINI_LOW_CONFIDENCE",
      suggestion,
    };
  }

  const pair = findById(pack.candidatePairs, suggestion.selectedCandidateIds.pair);
  const bairroCandidate = findById(
    pack.bairroCandidates,
    suggestion.selectedCandidateIds.bairro,
  );
  const ruaCandidate = findById(pack.ruaCandidates, suggestion.selectedCandidateIds.rua);

  if (
    (suggestion.selectedCandidateIds.pair && !pair) ||
    (suggestion.selectedCandidateIds.bairro && !bairroCandidate) ||
    (suggestion.selectedCandidateIds.rua && !ruaCandidate)
  ) {
    return {
      attempted: true,
      accepted: false,
      rejectedReason: "TARGET_OUT_OF_PACK",
      suggestion: null,
    };
  }

  if (!pair && !bairroCandidate && !ruaCandidate) {
    return {
      attempted: true,
      accepted: false,
      rejectedReason: "TARGET_OUT_OF_PACK",
      suggestion: null,
    };
  }

  if (pair) {
    const pairBairro = findById(pack.bairroCandidates, pair.bairroCandidateId);
    const pairRua = findById(pack.ruaCandidates, pair.ruaCandidateId);

    if (!pairBairro || !pairRua) {
      return {
        attempted: true,
        accepted: false,
        rejectedReason: "TARGET_OUT_OF_PACK",
        suggestion: null,
      };
    }

    if (
      bairroCandidate &&
      bairroCandidate.normalizedName !== pairBairro.normalizedName
    ) {
      return {
        attempted: true,
        accepted: false,
        rejectedReason: "TARGET_OUT_OF_PACK",
        suggestion: null,
      };
    }

    if (ruaCandidate && ruaCandidate.normalizedName !== pairRua.normalizedName) {
      return {
        attempted: true,
        accepted: false,
        rejectedReason: "TARGET_OUT_OF_PACK",
        suggestion: null,
      };
    }

    if (
      suggestion.bairroAlias &&
      normalizeText(suggestion.bairroAlias) !== pairBairro.normalizedName
    ) {
      return {
        attempted: true,
        accepted: false,
        rejectedReason: "TARGET_OUT_OF_PACK",
        suggestion: null,
      };
    }

    if (
      suggestion.ruaAlias &&
      normalizeText(suggestion.ruaAlias) !== pairRua.normalizedName
    ) {
      return {
        attempted: true,
        accepted: false,
        rejectedReason: "TARGET_OUT_OF_PACK",
        suggestion: null,
      };
    }

    return {
      attempted: true,
      accepted: true,
      rejectedReason: null,
      suggestion: {
        ...suggestion,
        bairroAlias: pairBairro.name,
        ruaAlias: pairRua.name,
        selectedCandidateIds: {
          bairro: pairBairro.id,
          rua: pairRua.id,
          pair: pair.id,
        },
      },
    };
  }

  if (
    suggestion.bairroAlias &&
    (!bairroCandidate ||
      normalizeText(suggestion.bairroAlias) !== bairroCandidate.normalizedName)
  ) {
    return {
      attempted: true,
      accepted: false,
      rejectedReason: "TARGET_OUT_OF_PACK",
      suggestion: null,
    };
  }

  if (
    suggestion.ruaAlias &&
    (!ruaCandidate || normalizeText(suggestion.ruaAlias) !== ruaCandidate.normalizedName)
  ) {
    return {
      attempted: true,
      accepted: false,
      rejectedReason: "TARGET_OUT_OF_PACK",
      suggestion: null,
    };
  }

  return {
    attempted: true,
    accepted: true,
    rejectedReason: null,
    suggestion: {
      ...suggestion,
      bairroAlias: bairroCandidate?.name ?? null,
      ruaAlias: ruaCandidate?.name ?? null,
    },
  };
}

export async function suggestLocalFirstAliasWithGemini(
  input: LocalFirstAliasAiInput,
): Promise<LocalFirstAliasAiResult> {
  const pack = input.pack;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (pack.eligibleForAi !== true) {
    return {
      attempted: false,
      accepted: false,
      rejectedReason: pack.skipReason || "PACK_NOT_ELIGIBLE",
      model,
      suggestion: null,
    };
  }

  if (pack.skipReason) {
    return {
      attempted: false,
      accepted: false,
      rejectedReason: pack.skipReason,
      model,
      suggestion: null,
    };
  }

  if (!pack.candidatePairs.length) {
    return {
      attempted: false,
      accepted: false,
      rejectedReason: "NO_CANDIDATE_PAIRS",
      model,
      suggestion: null,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      attempted: false,
      accepted: false,
      rejectedReason: "GEMINI_API_KEY_MISSING",
      model,
      suggestion: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(pack) }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      return {
        attempted: true,
        accepted: false,
        rejectedReason: "GEMINI_HTTP_ERROR",
        model,
        rawText: await response.text().catch(() => ""),
        suggestion: null,
      };
    }

    const data = await response.json().catch(() => null);
    const rawText = extractGeminiText(data);

    if (!rawText) {
      return {
        attempted: true,
        accepted: false,
        rejectedReason: "GEMINI_EMPTY_RESPONSE",
        model,
        rawText,
        suggestion: null,
      };
    }

    let parsed: any;
    try {
      parsed = parseGeminiJson(rawText);
    } catch {
      return {
        attempted: true,
        accepted: false,
        rejectedReason: "GEMINI_INVALID_JSON",
        model,
        rawText,
        suggestion: null,
      };
    }

    const validation = validateSuggestionAgainstPack(
      normalizeSuggestion(parsed),
      pack,
    );

    return {
      ...validation,
      model,
      rawText,
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      attempted: true,
      accepted: false,
      rejectedReason: isAbort ? "GEMINI_TIMEOUT" : "GEMINI_CALL_ERROR",
      model,
      suggestion: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
