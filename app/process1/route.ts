export const runtime = "nodejs";

type Normalized = {
  addressLine: string; // texto final “limpo”
  street?: string;
  number?: string;
  quadra?: string;
  lote?: string;
  bairro?: string;
  city?: string;
  uf?: string;
  cep?: string;
  complemento?: string;
};

function calcStatusFromText(addrRaw: string) {
  const addr = (addrRaw || "").toUpperCase();

  const hasStreet =
    /\b(RUA|AV|AV\.|AVENIDA|ALAMEDA|TRAVESSA|TV\.|VIELA|RODOVIA|ESTRADA)\b/.test(addr);
  const hasQuadra = /\b(QD|QUADRA|Q\.)\b/.test(addr);
  const hasLote = /\b(LT|LOTE|L\.)\b/.test(addr);

  if (hasStreet && hasQuadra && hasLote) return "OK";
  if (hasStreet && (hasQuadra || hasLote)) return "PARCIAL";
  if (hasStreet) return "PARCIAL";
  return "NAO_ENCONTRADO";
}

async function geminiNormalize(params: {
  address: string;
  bairro?: string;
  city?: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    return {
      normalized: {
        addressLine: params.address,
        bairro: params.bairro,
        city: params.city,
      } satisfies Normalized,
      raw: "",
      model,
      usedGemini: false,
    };
  }

  // Chamando Gemini via REST (sem instalar biblioteca)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `
Você é um normalizador de endereços do Brasil (GO/Goiânia/Aparecida).
Receba um endereço bruto e devolva APENAS um JSON VÁLIDO (sem texto extra) neste formato:

{
  "street": "",
  "number": "",
  "quadra": "",
  "lote": "",
  "bairro": "",
  "city": "",
  "uf": "GO",
  "cep": "",
  "complemento": "",
  "addressLine": "texto final completo e bem formatado"
}

Regras:
- Se não souber um campo, use string vazia.
- Preserve quadra/lote quando existir.
- Se bairro/cidade vierem separados, use para completar.
- addressLine deve ser o melhor endereço final para geocodificar.

DADOS:
address="${params.address}"
bairro="${params.bairro || ""}"
city="${params.city || ""}"
  `.trim();

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 350,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return {
      normalized: {
        addressLine: `${params.address}${params.bairro ? `, ${params.bairro}` : ""}${
          params.city ? `, ${params.city}` : ""
        }`,
        bairro: params.bairro,
        city: params.city,
      } satisfies Normalized,
      raw: txt,
      model,
      usedGemini: false,
    };
  }

  const data = await res.json();
  const rawText: string =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || "";

  // Tenta extrair JSON do retorno
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}");
  const jsonSlice = jsonStart >= 0 && jsonEnd >= 0 ? rawText.slice(jsonStart, jsonEnd + 1) : "";

  let parsed: Normalized | null = null;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    parsed = null;
  }

  const fallbackLine = `${params.address}${params.bairro ? `, ${params.bairro}` : ""}${
    params.city ? `, ${params.city}` : ""
  }`;

  const normalized: Normalized = parsed
    ? {
        ...parsed,
        addressLine: (parsed.addressLine || "").trim() || fallbackLine,
        bairro: (parsed.bairro || "").trim() || params.bairro || "",
        city: (parsed.city || "").trim() || params.city || "",
        uf: (parsed.uf || "GO").trim() || "GO",
      }
    : {
        addressLine: fallbackLine,
        bairro: params.bairro,
        city: params.city,
        uf: "GO",
      };

  return { normalized, raw: rawText, model, usedGemini: true };
}

async function hereGeocode(addressLine: string) {
  const hereKey = process.env.HERE_API_KEY;
  if (!hereKey) {
    return { found: false as const, lat: null, lng: null, hereRaw: null as any };
  }

  const base = "https://geocode.search.hereapi.com/v1/geocode";
  const qs = new URLSearchParams({
    q: addressLine,
    apiKey: hereKey,
    lang: "pt-BR",
    limit: "1",
    // “at” ajuda Goiânia/Aparecida
    at: "-16.8233,-49.2439",
  });

  const res = await fetch(`${base}?${qs.toString()}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { found: false as const, lat: null, lng: null, hereRaw: txt };
  }

  const data = await res.json();
  const item = data?.items?.[0];
  if (!item?.position) {
    return { found: false as const, lat: null, lng: null, hereRaw: data };
  }

  return {
    found: true as const,
    lat: item.position.lat,
    lng: item.position.lng,
    hereRaw: item,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const address = String(body?.address || "").trim();
    const bairro = body?.bairro ? String(body.bairro) : "";
    const city = body?.city ? String(body.city) : "";

    if (!address) {
      return Response.json({ error: "Endereço vazio" }, { status: 400 });
    }

    // 1) Gemini normaliza
    const g = await geminiNormalize({ address, bairro, city });
    const normalizedLine = (g.normalized?.addressLine || address).trim();

    // 2) HERE geocode
    const h = await hereGeocode(normalizedLine);

    // 3) status
    const textStatus = calcStatusFromText(normalizedLine);
    const status = h.found ? textStatus : "NAO_ENCONTRADO";

    return Response.json({
      original: address,
      normalized: g.normalized,
      normalizedLine,
      status,
      lat: h.found ? h.lat : null,
      lng: h.found ? h.lng : null,
      model: g.model,
      raw: g.raw, // útil pra debug
      hereRaw: h.hereRaw, // útil pra debug
      usedGemini: g.usedGemini,
    });
  } catch (err: any) {
    console.error("Erro /api/process:", err);
    return Response.json({ error: "Erro ao processar endereço" }, { status: 500 });
  }
}