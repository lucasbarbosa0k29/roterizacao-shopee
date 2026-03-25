import { prisma } from "@/app/lib/prisma";

function normalizeCompareText(value: string) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesEither(a: string, b: string) {
  const x = normalizeCompareText(a);
  const y = normalizeCompareText(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

function isAparecidaCity(value: string) {
  return normalizeCompareText(value).includes("APARECIDA");
}

function getStreetSearchTerm(rua: string) {
  const parts = normalizeCompareText(rua)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

  return parts.slice(0, 2).join(" ").trim();
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

export async function tryApproximateMemoryMatch(params: {
  addressRaw: string;
  city: string;
  bairro: string;
  rua: string;
  quadra: string;
  lote: string;
}) {
  const rua = normalizeCompareText(params.rua);
  const quadra = normalizeCompareText(params.quadra);
  const lote = normalizeCompareText(params.lote);
  const bairro = normalizeCompareText(params.bairro);
  const city = normalizeCompareText(params.city);
  const streetSearchTerm = getStreetSearchTerm(params.rua);

  if (!rua || !quadra || !bairro || !streetSearchTerm) {
    return { matched: false as const, reason: "INSUFFICIENT_DATA" };
  }

  const candidates = await prisma.addressMemory.findMany({
    where: {
      AND: [
        {
          label: {
            contains: params.quadra,
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

  for (const candidate of candidates) {
    const label = String(candidate.label || "");
    const labelRaw = normalizeCompareText(label);
    const parsed = extractFromLabel(label);

    const ruaOk = includesEither(rua, parsed.rua || labelRaw);
    const quadraOk = !!parsed.quadra && normalizeCompareText(parsed.quadra) === quadra;
    const bairroOk = !!bairro && !!labelRaw && labelRaw.includes(bairro);
    const loteOk =
      !lote ||
      !parsed.lote ||
      normalizeCompareText(parsed.lote) === lote;
    const cityOk = !city || isAparecidaCity(city) === isAparecidaCity(labelRaw);

    if (ruaOk && quadraOk && bairroOk && loteOk && cityOk) {
      return {
        matched: true as const,
        lat: candidate.lat,
        lng: candidate.lng,
        label: candidate.label || "",
        key: candidate.key,
        reason: "APPROX_STRONG_MATCH",
      };
    }
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
