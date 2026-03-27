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
    return { matched: false as const, reason: "INSUFFICIENT_DATA" };
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
    };
  }

  return { matched: false as const, reason: "NO_APPROX_MATCH" };
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
