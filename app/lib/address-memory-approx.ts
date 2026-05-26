import { prisma } from "@/app/lib/prisma";

type ApproxMemoryCandidate = {
  key: string;
  label: string | null;
  lat: number;
  lng: number;
  hitCount: number;
  updatedAt: Date;
};

type ScoredApproxMemoryCandidate = {
  candidate: ApproxMemoryCandidate;
  score: number;
  matchedBy: string[];
};

export type ApproxMemoryStrength = "STRONG" | "MEDIUM" | "WEAK";

export type ApproxMemoryShadow = {
  strength: ApproxMemoryStrength;
  score: number;
  reasons: string[];
  matchedBy: string[];
  candidateKey: string | null;
  candidateLabel: string | null;
};

export type ApproxMemorySearchHint = {
  suggestedAddressLine: string;
  reason: string;
  fieldsUsed: string[];
};

export type ApproxOperationalRisk = "SAFE" | "RISKY" | "BAD";

export type ApproxOperationalAudit = {
  risk: ApproxOperationalRisk;
  reasons: string[];
  wouldStillSkipHere: boolean;
  safeForAutoSave: boolean;
  recommendedAction: "KEEP_AS_IS" | "KEEP_BUT_REVIEW" | "DO_NOT_SKIP_HERE_FUTURE";
};

type ShadowScoredApproxMemoryCandidate = {
  candidate: ApproxMemoryCandidate;
  score: number;
  matchedBy: string[];
  reasons: string[];
  streetExact: boolean;
  streetPartial: boolean;
  bairroExact: boolean;
  quadraExact: boolean;
  loteExact: boolean;
  hasCoords: boolean;
};

function normalizeCompareText(value: string) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStreetForMatch(value: string) {
  return normalizeCompareText(value)
    .replace(/\bRUA\b/g, "R")
    .replace(/\bR\b/g, "R")
    .replace(/\bAVENIDA\b/g, "AV")
    .replace(/\bAV\b/g, "AV")
    .replace(/\bTRAVESSA\b/g, "TV")
    .replace(/\bTV\b/g, "TV")
    .replace(/\bALAMEDA\b/g, "AL")
    .replace(/\bVIELA\b/g, "VL")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQuadraLoteValue(value: string) {
  const normalized = normalizeCompareText(value).replace(/\s+/g, "");
  if (/^\d+$/.test(normalized)) {
    return String(Number(normalized));
  }
  return normalized;
}

function includesEither(a: string, b: string) {
  const x = normalizeStreetForMatch(a);
  const y = normalizeStreetForMatch(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

function isAparecidaCity(value: string) {
  return normalizeCompareText(value).includes("APARECIDA");
}

function getStreetSearchTerm(rua: string) {
  const parts = normalizeStreetForMatch(rua)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

  const meaningfulParts = parts.filter(
    (part) => !["R", "AV", "TV", "AL", "VL"].includes(part),
  );

  return (meaningfulParts.length ? meaningfulParts : parts).slice(0, 2).join(" ").trim();
}

function isGenericAparecidaStreet(value: string) {
  const street = normalizeStreetForMatch(value);
  return /^(R|AV|TV|AL|VL)?\s*[HV]\s*\d+[A-Z]?$/.test(street);
}

function extractFromLabel(label: string) {
  const up = normalizeCompareText(label);

  const ruaMatch = up.match(
    /\b(RUA|AVENIDA|AV|ALAMEDA|TRAVESSA|TV|VIELA|VIA|R)\s+([A-Z0-9\s]+)/,
  );
  const quadraMatch = up.match(/\b(QD|QUADRA|Q)\s*([A-Z0-9\-]+)/);
  const loteMatch = up.match(/\b(LT|LOTE|L)\s*([A-Z0-9\-]+)/);

  return {
    rua: ruaMatch ? `${ruaMatch[1]} ${ruaMatch[2]}`.trim() : "",
    quadra: quadraMatch ? String(quadraMatch[2] || "").trim() : "",
    lote: loteMatch ? String(loteMatch[2] || "").trim() : "",
    raw: up,
  };
}

function scoreApproximateMemoryCandidate(params: {
  candidate: ApproxMemoryCandidate;
  rua: string;
  quadra: string;
  lote: string;
  bairro: string;
  city: string;
}) {
  const label = String(params.candidate.label || "");
  const labelRaw = normalizeCompareText(label);
  const parsed = extractFromLabel(label);

  const ruaTarget = normalizeStreetForMatch(params.rua);
  const ruaParsed = normalizeStreetForMatch(parsed.rua || labelRaw);
  const quadraParsed = normalizeQuadraLoteValue(parsed.quadra);
  const loteParsed = normalizeQuadraLoteValue(parsed.lote);

  const cityOk =
    !params.city || isAparecidaCity(params.city) === isAparecidaCity(labelRaw);
  if (!cityOk) return null;

  const ruaOk = includesEither(params.rua, parsed.rua || labelRaw);
  if (!ruaOk) return null;

  const quadraOk = !!parsed.quadra && quadraParsed === params.quadra;
  if (!quadraOk) return null;

  const bairroOk = !!params.bairro && !!labelRaw && labelRaw.includes(params.bairro);
  if (!bairroOk) return null;

  const loteDivergente =
    !!params.lote &&
    !!parsed.lote &&
    loteParsed !== params.lote;
  if (loteDivergente) return null;

  let score = 0;
  const matchedBy: string[] = [];

  if (ruaTarget && ruaParsed && ruaTarget === ruaParsed) {
    score += 40;
    matchedBy.push("street_exact");
  } else {
    score += 30;
    matchedBy.push("street_partial");
  }

  score += 30;
  matchedBy.push("quadra_exact");

  score += 20;
  matchedBy.push("bairro_exact");

  if (!!params.lote && !!parsed.lote && loteParsed === params.lote) {
    score += 10;
    matchedBy.push("lote_exact");
  }

  return {
    candidate: params.candidate,
    score,
    matchedBy,
  };
}

function scoreApproximateMemoryCandidateShadow(params: {
  candidate: ApproxMemoryCandidate;
  rua: string;
  quadra: string;
  lote: string;
  bairro: string;
  city: string;
}) {
  const label = String(params.candidate.label || "");
  const labelRaw = normalizeCompareText(label);
  const parsed = extractFromLabel(label);

  const streetExact =
    !!params.rua &&
    !!parsed.rua &&
    normalizeStreetForMatch(params.rua) === normalizeStreetForMatch(parsed.rua);
  const streetPartial = includesEither(params.rua, parsed.rua || labelRaw);
  const bairroExact = !!params.bairro && !!labelRaw && labelRaw.includes(params.bairro);
  const quadraExact =
    !!params.quadra &&
    !!parsed.quadra &&
    normalizeQuadraLoteValue(parsed.quadra) === params.quadra;
  const loteExact =
    !!params.lote &&
    !!parsed.lote &&
    normalizeQuadraLoteValue(parsed.lote) === params.lote;
  const loteDivergente =
    !!params.lote &&
    !!parsed.lote &&
    normalizeQuadraLoteValue(parsed.lote) !== params.lote;
  const cityOk =
    !params.city || isAparecidaCity(params.city) === isAparecidaCity(labelRaw);
  const hasCoords =
    typeof params.candidate.lat === "number" &&
    typeof params.candidate.lng === "number";

  let score = 0;
  const matchedBy: string[] = [];
  const reasons: string[] = [];

  if (!cityOk) {
    reasons.push("city_bucket_mismatch");
    return {
      candidate: params.candidate,
      score: 0,
      matchedBy,
      reasons,
      streetExact,
      streetPartial,
      bairroExact,
      quadraExact,
      loteExact,
      hasCoords,
    };
  }

  if (streetExact) {
    score += 35;
    matchedBy.push("street_exact");
  } else if (streetPartial) {
    score += 22;
    matchedBy.push("street_partial");
  } else {
    reasons.push("street_mismatch");
  }

  if (bairroExact) {
    score += 20;
    matchedBy.push("bairro_exact");
  } else {
    reasons.push("bairro_missing_or_mismatch");
  }

  if (quadraExact) {
    score += 25;
    matchedBy.push("quadra_exact");
  } else {
    reasons.push("quadra_missing_or_mismatch");
  }

  if (!!params.lote) {
    if (loteExact) {
      score += 15;
      matchedBy.push("lote_exact");
    } else if (loteDivergente) {
      score -= 25;
      reasons.push("lote_mismatch");
    } else {
      reasons.push("lote_missing");
    }
  }

  if (hasCoords) {
    score += 5;
    matchedBy.push("has_coords");
  }

  return {
    candidate: params.candidate,
    score,
    matchedBy,
    reasons,
    streetExact,
    streetPartial,
    bairroExact,
    quadraExact,
    loteExact,
    hasCoords,
  };
}

function classifyApproximateMemoryShadow(params: {
  scored: ShadowScoredApproxMemoryCandidate | null;
  rua: string;
  lote: string;
  city: string;
}) {
  if (!params.scored) {
    return {
      strength: "WEAK" as const,
      score: 0,
      reasons: ["no_shadow_candidate"],
      matchedBy: [],
      candidateKey: null,
      candidateLabel: null,
    };
  }

  const reasons = [...params.scored.reasons];
  const isAparecida = isAparecidaCity(params.city);
  const genericStreet = isGenericAparecidaStreet(params.rua);
  const loteRequired = !!params.lote;

  let strength: ApproxMemoryStrength = "WEAK";

  const baseStrong =
    params.scored.score >= 85 &&
    params.scored.streetExact &&
    params.scored.bairroExact &&
    params.scored.quadraExact &&
    (!loteRequired || params.scored.loteExact);

  const baseMedium =
    params.scored.score >= 65 &&
    (params.scored.streetExact || params.scored.streetPartial) &&
    params.scored.bairroExact &&
    (params.scored.quadraExact || params.scored.loteExact);

  if (baseStrong) {
    strength = "STRONG";
  } else if (baseMedium) {
    strength = "MEDIUM";
  }

  if (isAparecida && genericStreet && !params.scored.loteExact && strength === "STRONG") {
    strength = "MEDIUM";
    reasons.push("aparecida_generic_street_downgrade");
  }

  if (strength === "WEAK" && !reasons.length) {
    reasons.push("weak_structural_match");
  }

  return {
    strength,
    score: params.scored.score,
    reasons,
    matchedBy: params.scored.matchedBy,
    candidateKey: params.scored.candidate.key,
    candidateLabel: params.scored.candidate.label || null,
  };
}

export function buildApproximateMemoryShadowHint(params: {
  shadow: ApproxMemoryShadow | null;
  city: string;
  rua: string;
}) {
  const shadow = params.shadow;
  if (!shadow?.candidateLabel) return null;
  if (shadow.strength !== "MEDIUM") return null;
  if (shadow.score < 65) return null;

  const blockedReasons = new Set([
    "lote_mismatch",
    "city_bucket_mismatch",
    "street_mismatch",
  ]);

  if (shadow.reasons.some((reason) => blockedReasons.has(reason))) {
    return null;
  }

  const matched = new Set(shadow.matchedBy || []);
  const hasBairro = matched.has("bairro_exact");
  const hasQuadra = matched.has("quadra_exact");
  const hasLote = matched.has("lote_exact");

  if (!hasBairro || !hasQuadra) {
    return null;
  }

  const isAparecida = isAparecidaCity(params.city);
  const genericStreet = isGenericAparecidaStreet(params.rua);

  // Em Aparecida o hint precisa ser ainda mais forte.
  if (isAparecida) {
    if (!hasLote) return null;
    if (genericStreet && !hasLote) return null;
  }

  return {
    suggestedAddressLine: shadow.candidateLabel,
    reason: isAparecida
      ? "APPROX_SHADOW_MEDIUM_HINT_APARECIDA"
      : "APPROX_SHADOW_MEDIUM_HINT",
    fieldsUsed: shadow.matchedBy.filter((field) =>
      [
        "street_exact",
        "street_partial",
        "bairro_exact",
        "quadra_exact",
        "lote_exact",
      ].includes(field),
    ),
  } satisfies ApproxMemorySearchHint;
}

export function auditApproximateMemoryOperationalRisk(params: {
  shadow: ApproxMemoryShadow | null;
  city: string;
  rua: string;
  lote: string;
}) {
  const shadow = params.shadow;
  const reasons: string[] = [];

  if (!shadow) {
    return {
      risk: "BAD" as const,
      reasons: ["no_shadow_data"],
      wouldStillSkipHere: false,
      safeForAutoSave: false,
      recommendedAction: "DO_NOT_SKIP_HERE_FUTURE" as const,
    };
  }

  const matched = new Set(shadow.matchedBy || []);
  const shadowReasons = new Set(shadow.reasons || []);

  const hasStreetExact = matched.has("street_exact");
  const hasStreetPartial = matched.has("street_partial");
  const hasBairro = matched.has("bairro_exact");
  const hasQuadra = matched.has("quadra_exact");
  const hasLote = matched.has("lote_exact");
  const hasCoords = matched.has("has_coords");
  const isAparecida = isAparecidaCity(params.city);
  const genericStreet = isGenericAparecidaStreet(params.rua);
  const loteRequired = !!normalizeQuadraLoteValue(params.lote);
  const hasStreetStructure = hasStreetExact || hasStreetPartial;
  const hasStrongBlockStructure =
    hasStreetStructure &&
    hasBairro &&
    hasQuadra &&
    hasCoords;
  const hasLoteMismatch = shadowReasons.has("lote_mismatch");

  if (shadowReasons.has("street_mismatch")) reasons.push("street_mismatch");
  if (shadowReasons.has("quadra_missing_or_mismatch")) reasons.push("quadra_missing_or_mismatch");
  if (shadowReasons.has("city_bucket_mismatch")) reasons.push("city_bucket_mismatch");

  if (hasLoteMismatch) {
    if (hasStrongBlockStructure) {
      reasons.push("same_block_candidate");
      reasons.push("lote_mismatch_with_strong_structure");

      if (isAparecida && genericStreet && !hasStreetExact) {
        reasons.push("aparecida_generic_street_partial_only");
      }

      return {
        risk: "RISKY" as const,
        reasons,
        wouldStillSkipHere: true,
        safeForAutoSave: false,
        recommendedAction: "KEEP_BUT_REVIEW" as const,
      };
    }

    reasons.push("lote_mismatch_with_weak_structure");
  }

  if (
    shadowReasons.has("street_mismatch") ||
    shadowReasons.has("quadra_missing_or_mismatch") ||
    shadowReasons.has("city_bucket_mismatch")
  ) {
    return {
      risk: "BAD" as const,
      reasons,
      wouldStillSkipHere: false,
      safeForAutoSave: false,
      recommendedAction: "DO_NOT_SKIP_HERE_FUTURE" as const,
    };
  }

  if (!hasBairro) reasons.push("bairro_not_exact");
  if (!hasQuadra) reasons.push("quadra_not_exact");
  if (loteRequired && !hasLote) reasons.push("lote_not_exact");
  if (!hasStreetExact && hasStreetPartial) reasons.push("street_partial_only");
  if (!hasCoords) reasons.push("missing_coords");

  if (isAparecida && genericStreet && !hasLote) {
    reasons.push("aparecida_generic_street_without_lote");
    return {
      risk: "BAD" as const,
      reasons,
      wouldStillSkipHere: false,
      safeForAutoSave: false,
      recommendedAction: "DO_NOT_SKIP_HERE_FUTURE" as const,
    };
  }

  const safe =
    hasBairro &&
    hasQuadra &&
    hasCoords &&
    (hasStreetExact || hasStreetPartial) &&
    (!loteRequired || hasLote) &&
    (!isAparecida || hasLote);

  if (safe && (hasStreetExact || (hasStreetPartial && !isAparecida))) {
    return {
      risk: "SAFE" as const,
      reasons: reasons.length ? reasons : ["structurally_consistent"],
      wouldStillSkipHere: true,
      safeForAutoSave: true,
      recommendedAction: "KEEP_AS_IS" as const,
    };
  }

  return {
    risk: "RISKY" as const,
    reasons: reasons.length ? reasons : ["partial_structural_match"],
    wouldStillSkipHere: true,
    safeForAutoSave: false,
    recommendedAction: "KEEP_BUT_REVIEW" as const,
  };
}

function pickBestApproximateMemoryCandidate(
  candidates: ApproxMemoryCandidate[],
  params: {
    rua: string;
    quadra: string;
    lote: string;
    bairro: string;
    city: string;
  },
) {
  const scored = candidates
    .map((candidate) =>
      scoreApproximateMemoryCandidate({
        candidate,
        rua: params.rua,
        quadra: params.quadra,
        lote: params.lote,
        bairro: params.bairro,
        city: params.city,
      }),
    )
    .filter((item): item is ScoredApproxMemoryCandidate => item !== null);

  if (!scored.length) {
    return null;
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.candidate.hitCount !== a.candidate.hitCount) {
      return b.candidate.hitCount - a.candidate.hitCount;
    }
    return b.candidate.updatedAt.getTime() - a.candidate.updatedAt.getTime();
  });

  const best = scored[0];
  if (!best || best.score < 80) {
    return null;
  }

  return best;
}

function pickBestApproximateMemoryShadowCandidate(
  candidates: ApproxMemoryCandidate[],
  params: {
    rua: string;
    quadra: string;
    lote: string;
    bairro: string;
    city: string;
  },
) {
  const scored = candidates.map((candidate) =>
    scoreApproximateMemoryCandidateShadow({
      candidate,
      rua: params.rua,
      quadra: params.quadra,
      lote: params.lote,
      bairro: params.bairro,
      city: params.city,
    }),
  );

  if (!scored.length) return null;

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.candidate.hitCount !== a.candidate.hitCount) {
      return b.candidate.hitCount - a.candidate.hitCount;
    }
    return b.candidate.updatedAt.getTime() - a.candidate.updatedAt.getTime();
  });

  return scored[0] || null;
}

export async function tryApproximateMemoryMatch(params: {
  addressRaw: string;
  city: string;
  bairro: string;
  rua: string;
  quadra: string;
  lote: string;
}) {
  const rua = normalizeCompareText(params.rua);
  const quadra = normalizeQuadraLoteValue(params.quadra);
  const lote = normalizeQuadraLoteValue(params.lote);
  const bairro = normalizeCompareText(params.bairro);
  const city = normalizeCompareText(params.city);
  const streetSearchTerm = getStreetSearchTerm(params.rua);
  const quadraSearchTerm = normalizeQuadraLoteValue(params.quadra);

  if (!rua || !quadra || !bairro || !streetSearchTerm) {
    return {
      matched: false as const,
      reason: "INSUFFICIENT_DATA",
      shadow: null,
    };
  }

  const candidates = await prisma.addressMemory.findMany({
    where: {
      AND: [
        {
          label: {
            contains: quadraSearchTerm,
            mode: "insensitive",
          },
        },
        {
          label: {
            contains: streetSearchTerm,
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      key: true,
      label: true,
      lat: true,
      lng: true,
      hitCount: true,
      updatedAt: true,
    },
    take: 25,
    orderBy: [{ hitCount: "desc" }, { updatedAt: "desc" }],
  });

  const shadowBest = pickBestApproximateMemoryShadowCandidate(candidates, {
    rua,
    quadra,
    lote,
    bairro,
    city,
  });

  const shadow = classifyApproximateMemoryShadow({
    scored: shadowBest,
    rua,
    lote,
    city,
  });

  const best = pickBestApproximateMemoryCandidate(candidates, {
    rua,
    quadra,
    lote,
    bairro,
    city,
  });

  if (best) {
    return {
      matched: true as const,
      lat: best.candidate.lat,
      lng: best.candidate.lng,
      label: best.candidate.label || "",
      key: best.candidate.key,
      reason: "APPROX_STRONG_MATCH",
      score: best.score,
      matchedBy: best.matchedBy,
      shadow,
    };
  }

  return {
    matched: false as const,
    reason: "NO_APPROX_MATCH",
    shadow,
  };
}

export async function tryApproximateMemoryTextHint(params: {
  city: string;
  bairro: string;
  rua: string;
}) {
  const rua = normalizeCompareText(params.rua);
  const bairro = normalizeCompareText(params.bairro);
  const city = normalizeCompareText(params.city);
  const streetSearchTerm = getStreetSearchTerm(params.rua);

  if (!rua || !bairro || !streetSearchTerm) {
    return { matched: false as const, reason: "INSUFFICIENT_HINT_DATA" };
  }

  const candidates = await prisma.addressMemory.findMany({
    where: {
      AND: [
        {
          label: {
            contains: streetSearchTerm,
            mode: "insensitive",
          },
        },
        {
          label: {
            contains: params.bairro,
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      key: true,
      label: true,
      hitCount: true,
      updatedAt: true,
    },
    take: 10,
    orderBy: [{ hitCount: "desc" }, { updatedAt: "desc" }],
  });

  for (const candidate of candidates) {
    const label = String(candidate.label || "");
    const labelRaw = normalizeCompareText(label);
    const parsed = extractFromLabel(label);

    const ruaOk = includesEither(rua, parsed.rua || labelRaw);
    const bairroOk = !!bairro && !!labelRaw && labelRaw.includes(bairro);
    const cityOk = !city || isAparecidaCity(city) === isAparecidaCity(labelRaw);

    if (ruaOk && bairroOk && cityOk) {
      return {
        matched: true as const,
        suggestedAddressLine: label,
        label,
        key: candidate.key,
        reason: "MEMORY_TEXT_HINT",
      };
    }
  }

  return { matched: false as const, reason: "NO_MEMORY_TEXT_HINT" };
}
