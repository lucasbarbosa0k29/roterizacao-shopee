// app/api/process/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Normalized = {
  rua: string;
  numero: string;
  quadra: string;
  lote: string;
  bairro: string; // setor
  cidade: string;
  estado: string;
  cep?: string;
  observacao: string;
};

type InputRow = {
  sequence?: any;
  original: string; // <-- TEM QUE SER O "Destination Address" cru
  bairro?: string;
  city?: string;
  cep?: string;
};

function onlyDigits(s: string) {
  return (s || "").replace(/\D+/g, "");
}

function normalizeCep(s: string) {
  const d = onlyDigits(s);
  if (d.length === 8) return d;
  return (s || "").trim();
}

function cleanAddressForHere(s: string) {
  let t = String(s || "").trim();
  t = t.replace(/\bQD\.?\s*/gi, "Quadra ");
  t = t.replace(/\bLT\.?\s*/gi, "Lote ");
  t = t.replace(/\s+,/g, ",").replace(/,+/g, ",").replace(/\s{2,}/g, " ").trim();
  return t;
}

// REMOVE QUADRA/LOTE DA QUERY (pra não atrapalhar o HERE)
function stripQuadraLoteFromQuery(q: string) {
  let t = String(q || "");
  t = t.replace(/\b(QUADRA|QD|Q\.)\s*[-:]?\s*[A-Z0-9\-]+\b/gi, " ");
  t = t.replace(/\b(LOTE|LT|L\.)\s*[-:]?\s*[A-Z0-9\-]+\b/gi, " ");
  t = t.replace(/\s+,/g, ",").replace(/,+/g, ",").replace(/\s{2,}/g, " ").trim();
  return t;
}

// ======= detectar "apartamento" (pra NÃO buscar) =======
function hasQuadraLoteText(s: string) {
  const up = String(s || "").toUpperCase();
  return /\b(QD|QUADRA|Q\.)\b/.test(up) || /\b(LT|LOTE|L\.)\b/.test(up);
}

function isApartmentLike(s: string) {
  const up = String(s || "").toUpperCase();
  return /\b(APT|APTO|APART|APARTAMENTO|BLOCO|TORRE|EDIF|EDIFICIO|ANDAR|SALA)\b/.test(up);
}

// Fallback regex (quando Gemini falha)
function extractByRegex(raw: string) {
  const up = String(raw || "").toUpperCase();

  let rua = "";
  const ruaMatch = up.match(
    /\b(RUA|AVENIDA|AV\.|AV|ALAMEDA|TRAVESSA|TV\.|TV|VIELA|VIA|R\.|R)\s+([A-Z0-9\-\s\.]+)/,
  );
  if (ruaMatch) {
    rua = `${ruaMatch[1]} ${ruaMatch[2]}`.replace(/\s{2,}/g, " ").trim();
    rua = rua
      .replace(/^AVENIDA\b/, "Avenida")
      .replace(/^AV\.?\b/, "Av.")
      .replace(/^AV\b/, "Av.")
      .replace(/^RUA\b/, "Rua")
      .replace(/^R\.?\b/, "R")
      .replace(/^ALAMEDA\b/, "Alameda")
      .replace(/^TRAVESSA\b/, "Travessa")
      .replace(/^TV\.?\b/, "Tv.")
      .replace(/^VIELA\b/, "Viela")
      .replace(/^VIA\b/, "Via");
  }

  let quadra = "";
  const qd = up.match(/\b(QD|QUADRA|Q\.)\s*([A-Z0-9\-]+)/);
  if (qd) quadra = String(qd[2] || "").trim();

  let lote = "";
  const lt = up.match(/\b(LT|LOTE|L\.)\s*([A-Z0-9\-]+)/);
  if (lt) lote = String(lt[2] || "").trim();

  return { rua, quadra, lote };
}

// ✅ SUA REGRA DE STATUS
function calcStatusLucas(n: { rua?: string; quadra?: string; lote?: string; bairro?: string }) {
  const rua = (n.rua || "").trim();
  const quadra = (n.quadra || "").trim();
  const lote = (n.lote || "").trim();
  const bairro = (n.bairro || "").trim(); // setor

  const hasRua = !!rua;
  const hasQ = !!quadra;
  const hasL = !!lote;
  const hasSetor = !!bairro;

  if (hasRua && hasQ && hasL) return "OK";

  const usefulCount = Number(hasRua) + Number(hasQ) + Number(hasL) + Number(hasSetor);
  if (usefulCount >= 2) return "PARCIAL";
  if (usefulCount === 0) return "NAO_ENCONTRADO";
  return "PARCIAL";
}

function buildNormalizedLine(n: Normalized, fallback: string) {
  const rua = (n.rua || "").trim();
  const numero = (n.numero || "").trim();
  const quadra = (n.quadra || "").trim();
  const lote = (n.lote || "").trim();
  const cep = normalizeCep(n.cep || "");

  const parts: string[] = [];

  const ruaNumero = [rua, numero].filter(Boolean).join(", ");
  if (ruaNumero) parts.push(ruaNumero);

  const qdlt = [quadra ? `Quadra ${quadra}` : "", lote ? `Lote ${lote}` : ""]
    .filter(Boolean)
    .join(" ");
  if (qdlt) parts.push(qdlt);

  const bairro = (n.bairro || "").trim();
  const cidade = (n.cidade || "").trim();
  const estado = ((n.estado || "GO").trim() || "GO");

  if (bairro) parts.push(bairro);
  if (cidade) parts.push(cidade);
  if (estado) parts.push(estado);
  if (cep) parts.push(cep);

  const line = parts.join(", ").trim();
  return line || fallback;
}

// ====== limpar Q/L de dentro do complemento ======
function cleanComplementRemoveQuadraLote(obs: string) {
  let t = String(obs || "").trim();
  t = t.replace(/gemini\s*erro/gi, "").trim();

  t = t.replace(/\b(QUADRA|QD|Q\.)\s*[:\-]?\s*0*([A-Z0-9\-]+)\b/gi, "");
  t = t.replace(/\b(LOTE|LT|L\.)\s*[:\-]?\s*0*([A-Z0-9\-]+)\b/gi, "");

  t = t.replace(/\bQ\s*0*(\d+)\b/gi, "");
  t = t.replace(/\bL\s*0*(\d+)\b/gi, "");

  t = t.replace(/\bQD\s*0*(\d+)\b/gi, "");
  t = t.replace(/\bLT\s*0*(\d+)\b/gi, "");

  t = t.replace(/[-–—|]+/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

// ===== cidade Aparecida? (só pra decidir se pega quadra/lote no seu mapa) =====
function isAparecidaCity(v: string) {
  const s = String(v || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return s.includes("APARECIDA");
}

// ===== normalização simples de "Rua 25-e" vs "Rua vinte e cinco - E" =====
function numToPt(n: number) {
  const u: Record<number, string> = {
    0: "zero",
    1: "um",
    2: "dois",
    3: "tres",
    4: "quatro",
    5: "cinco",
    6: "seis",
    7: "sete",
    8: "oito",
    9: "nove",
    10: "dez",
    11: "onze",
    12: "doze",
    13: "treze",
    14: "quatorze",
    15: "quinze",
    16: "dezesseis",
    17: "dezessete",
    18: "dezoito",
    19: "dezenove",
  };
  const d: Record<number, string> = {
    20: "vinte",
    30: "trinta",
    40: "quarenta",
    50: "cinquenta",
    60: "sessenta",
    70: "setenta",
    80: "oitenta",
    90: "noventa",
  };
  if (n <= 19) return u[n] || String(n);
  const tens = Math.floor(n / 10) * 10;
  const ones = n % 10;
  if (ones === 0) return d[tens] || String(n);
  return `${d[tens] || tens} e ${u[ones] || ones}`;
}

function streetVariants(rua: string) {
  const base = String(rua || "").trim();
  if (!base) return [];

  const variants = new Set<string>();
  variants.add(base);

  // exemplo: "Rua 25-e" / "Rua 25 - E" / "Rua 25E"
  const m = base.match(/\b(\d{1,3})\s*[-]?\s*([A-Za-z])\b/);
  if (m) {
    const num = Number(m[1]);
    const letter = String(m[2]).toUpperCase();
    const prefix = base.replace(m[0], "").trim() || "Rua";

    variants.add(`${prefix} ${num}-${letter}`.replace(/\s{2,}/g, " ").trim());
    variants.add(`${prefix} ${num} - ${letter}`.replace(/\s{2,}/g, " ").trim());
    variants.add(`${prefix} ${num} ${letter}`.replace(/\s{2,}/g, " ").trim());

    if (Number.isFinite(num) && num >= 0 && num <= 99) {
      const ext = numToPt(num);
      variants.add(`${prefix} ${ext} - ${letter}`.replace(/\s{2,}/g, " ").trim());
      variants.add(`${prefix} ${ext} ${letter}`.replace(/\s{2,}/g, " ").trim());
    }
  }

  return Array.from(variants);
}

// ===== GEMINI =====
async function geminiNormalize(params: { address: string; bairro?: string; city?: string; cep?: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    const normalized: Normalized = {
      rua: "",
      numero: "",
      quadra: "",
      lote: "",
      bairro: params.bairro || "",
      cidade: params.city || "",
      estado: "GO",
      cep: params.cep || "",
      observacao: "",
    };
    return { normalized, raw: "", model, usedGemini: false as const, geminiOk: false as const };
  }

  const prompt = `
Você é um sistema de normalização de endereços do Brasil (Goiânia/GO e Aparecida/GO) para logística.
Retorne SOMENTE um JSON válido. Se um campo não existir, use "".

Endereço bruto: "${params.address}"
Bairro/Setor: "${params.bairro || ""}"
Cidade: "${params.city || ""}"
CEP: "${params.cep || ""}"

Objetivo:
- rua: somente nome da via (ex: "Rua JCA1", "Avenida Central")
- numero: apenas número (se SN, deixe "" e descreva em observacao)
- quadra: apenas valor (ex: "3" e não "03")
- lote: apenas valor (ex: "27" e não "027")
- bairro, cidade, estado="GO", cep
- observacao: EXTRAIA e PADRONIZE complementos em uma linha curta.

JSON:
{
  "rua": "",
  "numero": "",
  "quadra": "",
  "lote": "",
  "bairro": "",
  "cidade": "",
  "estado": "GO",
  "cep": "",
  "observacao": ""
}
`.trim();

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const normalized: Normalized = {
      rua: "",
      numero: "",
      quadra: "",
      lote: "",
      bairro: params.bairro || "",
      cidade: params.city || "",
      estado: "GO",
      cep: params.cep || "",
      observacao: "",
    };
    return { normalized, raw: JSON.stringify(data || {}), model, usedGemini: false as const, geminiOk: false as const };
  }

  const rawText: string =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("")?.trim?.() || "";

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const rawJson = jsonMatch ? jsonMatch[0] : "{}";

  let parsed: any = null;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object") {
    const normalized: Normalized = {
      rua: "",
      numero: "",
      quadra: "",
      lote: "",
      bairro: params.bairro || "",
      cidade: params.city || "",
      estado: "GO",
      cep: params.cep || "",
      observacao: "",
    };
    return { normalized, raw: rawText, model, usedGemini: false as const, geminiOk: false as const };
  }

  const normalized: Normalized = {
    rua: typeof parsed?.rua === "string" ? parsed.rua : "",
    numero: typeof parsed?.numero === "string" ? parsed.numero : "",
    quadra: typeof parsed?.quadra === "string" ? parsed.quadra : "",
    lote: typeof parsed?.lote === "string" ? parsed.lote : "",
    bairro: typeof parsed?.bairro === "string" ? parsed.bairro : (params.bairro || ""),
    cidade: typeof parsed?.cidade === "string" ? parsed.cidade : (params.city || ""),
    estado: typeof parsed?.estado === "string" ? parsed.estado : "GO",
    cep: typeof parsed?.cep === "string" ? parsed.cep : (params.cep || ""),
    observacao: typeof parsed?.observacao === "string" ? parsed.observacao : "",
  };

  return { normalized, raw: rawText, model, usedGemini: true as const, geminiOk: true as const };
}

// ===== HERE =====
async function hereGet(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function scoreHereItem(it: any, want: { cep?: string; city?: string; bairro?: string; rua?: string }) {
  const a = it?.address || {};
  const label = String(a?.label || it?.title || "").toUpperCase();

  const cepWant = normalizeCep(want.cep || "");
  const cepGot = normalizeCep(a?.postalCode || "");

  const cityWant = String(want.city || "").trim().toUpperCase();
  const cityGot = String(a?.city || "").trim().toUpperCase();

  const bairroWant = String(want.bairro || "").trim().toUpperCase();
  const bairroGot = String(a?.district || a?.subdistrict || "").trim().toUpperCase();

  const ruaWant = String(want.rua || "").trim().toUpperCase();
  const streetGot = String(a?.street || "").trim().toUpperCase();

  let s = 0;
  if (cepWant && cepGot && cepWant === cepGot) s += 80;
  if (cityWant && cityGot && cityGot.includes(cityWant)) s += 30;
  if (bairroWant && bairroGot && (bairroGot.includes(bairroWant) || bairroWant.includes(bairroGot))) s += 15;
  if (ruaWant && streetGot && (streetGot.includes(ruaWant) || ruaWant.includes(streetGot))) s += 25;
  if (ruaWant && label.includes(ruaWant)) s += 10;

  return s;
}

function getHereKey() {
  return (process.env.HERE_API_KEY || process.env.NEXT_PUBLIC_HERE_API_KEY || "").trim();
}

async function getAtByCep(cep: string, city: string) {
  const hereKey = getHereKey();
  const c = normalizeCep(cep);
  if (!hereKey || !c) return null;

  const base = "https://geocode.search.hereapi.com/v1/geocode";
  const qs = new URLSearchParams({
    apiKey: hereKey,
    q: `${c}, ${city || "Goiânia"}, GO`,
    lang: "pt-BR",
    limit: "1",
    in: "countryCode:BRA",
  });

  const { ok, data } = await hereGet(`${base}?${qs.toString()}`);
  if (!ok) return null;

  const item = data?.items?.[0];
  const pos = item?.position;
  if (!pos?.lat || !pos?.lng) return null;

  return `${pos.lat},${pos.lng}`;
}

async function hereGeocode(q: string, at?: string) {
  const hereKey = getHereKey();
  if (!hereKey) return { found: false as const, best: null as any, all: [] as any[] };

  const base = "https://geocode.search.hereapi.com/v1/geocode";
  const qs = new URLSearchParams({
    q: cleanAddressForHere(q),
    apiKey: hereKey,
    lang: "pt-BR",
    limit: "10",
    in: "countryCode:BRA",
  });
  if (at) qs.set("at", at);

  const { ok, data } = await hereGet(`${base}?${qs.toString()}`);
  const items = data?.items || [];
  if (!ok || !items.length) return { found: false as const, best: null, all: items };
  return { found: true as const, best: items[0], all: items };
}

async function hereDiscover(q: string, at: string) {
  const hereKey = getHereKey();
  if (!hereKey) return { found: false as const, best: null as any, all: [] as any[] };

  const base = "https://discover.search.hereapi.com/v1/discover";
  const qs = new URLSearchParams({
    q: cleanAddressForHere(q),
    apiKey: hereKey,
    lang: "pt-BR",
    limit: "10",
    at,
    in: "countryCode:BRA",
  });

  const { ok, data } = await hereGet(`${base}?${qs.toString()}`);
  const items = data?.items || [];
  if (!ok || !items.length) return { found: false as const, best: null, all: items };
  return { found: true as const, best: items[0], all: items };
}

function buildHereQueryVariants(args: {
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  original: string;
  normalizedLine: string;
}) {
  const cep = normalizeCep(args.cep || "");
  const cidade = (args.cidade || "").trim();
  const bairro = (args.bairro || "").trim();
  const estado = (args.estado || "GO").trim() || "GO";

  const full = cleanAddressForHere(args.normalizedLine || "");
  const fullNoQdLt = cleanAddressForHere(stripQuadraLoteFromQuery(full));

  const ruaOnly = cleanAddressForHere([args.rua, args.numero].filter(Boolean).join(", "));

  const ruaCep = cleanAddressForHere([ruaOnly, cep, cidade, estado].filter(Boolean).join(", "));
  const ruaCity = cleanAddressForHere([ruaOnly, bairro, cidade, estado].filter(Boolean).join(", "));
  const originalClean = cleanAddressForHere(args.original || "");

  const ruaVariants = streetVariants(args.rua || "").map((rv) =>
    cleanAddressForHere([rv, args.numero].filter(Boolean).join(", ")),
  );

  const ruaVariantsCity = ruaVariants.map((rv) =>
    cleanAddressForHere([rv, bairro, cidade, estado].filter(Boolean).join(", ")),
  );

  const ruaVariantsCep = ruaVariants.map((rv) =>
    cleanAddressForHere([rv, cep, cidade, estado].filter(Boolean).join(", ")),
  );

  // ✅ limita (pra não ficar MUITO lento)
  const variants = [
    ruaCep,
    ...ruaVariantsCep,
    fullNoQdLt,
    ruaCity,
    ...ruaVariantsCity,
    full,
    originalClean,
  ]
    .map((x) => x.trim())
    .filter(Boolean);

  return Array.from(new Set(variants)).slice(0, 8);
}

// ===== chama seu /api/aparecida/lot (mapa real) =====
async function getAparecidaLotFromArcgis(baseOrigin: string, lat: number, lng: number) {
  try {
    const u = new URL("/api/aparecida/lot", baseOrigin);
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lng", String(lng));
    const r = await fetch(u.toString(), { method: "GET" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return null;
    if (!j.found) return { found: false };
    return j as { found: true; quadra?: string; lote?: string; bairro?: string };
  } catch {
    return null;
  }
}

// ===== processa 1 linha =====
async function processOne(row: InputRow, baseOrigin: string) {
  const addressRaw = String(row?.original || "").trim(); // <-- FIEL AO EXCEL
  const bairroIn = row?.bairro ? String(row.bairro) : "";
  const cityIn = row?.city ? String(row.city) : "";
  const cepIn = normalizeCep(String(row?.cep || ""));

  if (!addressRaw) {
    return {
      sequence: row?.sequence ?? "",
      bairro: bairroIn,
      city: cityIn,
      cep: cepIn,
      original: "",
      normalized: null,
      normalizedLine: "",
      status: "NAO_ENCONTRADO",
      lat: null,
      lng: null,
      model: "",
      usedGemini: false,
      notesAuto: "",
      quadraAuto: "",
      loteAuto: "",
      error: "Endereço vazio",
    };
  }

  // ✅ regra: apartamento/edifício => NÃO BUSCAR (status CONDOMINIO)
  // (mas se tiver quadra/lote, pode buscar normal)
  const aptLike = isApartmentLike(addressRaw);
  const hasQL = hasQuadraLoteText(addressRaw);
  if (aptLike && !hasQL) {
    return {
      sequence: row?.sequence ?? "",
      bairro: bairroIn,
      city: cityIn,
      cep: cepIn,
      original: addressRaw,
      normalized: null,
      normalizedLine: addressRaw,
      status: "CONDOMINIO",
      lat: null,
      lng: null,
      model: "",
      usedGemini: false,
      notesAuto: "Apartamento/Edifício (não buscar automático)",
      quadraAuto: "",
      loteAuto: "",
      raw: null,
      hereBest: null,
      arcgisLotUsed: null,
    };
  }

  // 1) Gemini
  const g = await geminiNormalize({ address: addressRaw, bairro: bairroIn, city: cityIn, cep: cepIn });

  // 1.1) fallback regex se Gemini falhar
  const rx = extractByRegex(addressRaw);

  const finalRua = (g.normalized.rua || rx.rua || "").trim();
  const finalQuadra = (g.normalized.quadra || rx.quadra || "").trim();
  const finalLote = (g.normalized.lote || rx.lote || "").trim();

  const obsCleanRaw = String(g.normalized.observacao || "")
    .trim()
    .replace(/\bQ\s*0+(\d+)/gi, "Q$1")
    .replace(/\bL\s*0+(\d+)/gi, "L$1")
    .replace(/\bQUADRA\s*0+(\d+)/gi, "Q$1")
    .replace(/\bLOTE\s*0+(\d+)/gi, "L$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  const notesAuto = cleanComplementRemoveQuadraLote(obsCleanRaw);

  const normalized: Normalized = {
    ...g.normalized,
    rua: finalRua,
    quadra: finalQuadra,
    lote: finalLote,
    bairro: (g.normalized.bairro || bairroIn || "").trim(),
    cidade: (g.normalized.cidade || cityIn || "").trim(),
    cep: normalizeCep((g.normalized.cep || cepIn || "").trim()),
    estado: (g.normalized.estado || "GO").trim() || "GO",
    numero: (g.normalized.numero || "").trim(),
    observacao: obsCleanRaw.replace(/gemini\s*erro/gi, "").trim(),
  };

  // 2) normalizedLine (só pra debug/visual — você não vai usar no export)
  const fallbackLine =
    `${addressRaw}${bairroIn ? `, ${bairroIn}` : ""}${cityIn ? `, ${cityIn}` : ""}, GO${cepIn ? `, ${cepIn}` : ""}`.trim();
  const normalizedLine = buildNormalizedLine(normalized, fallbackLine);

  const cityForDecision = normalized.cidade || cityIn || "";
  const isAparecida = isAparecidaCity(cityForDecision);

  // 3) GEOLOCALIZAÇÃO: ✅ SEMPRE HERE (inclusive Aparecida)
  let lat: number | null = null;
  let lng: number | null = null;

  let bestItem: any = null;

  // base "at": se for Aparecida, começa perto de Aparecida; senão Goiânia
  const atBase = isAparecida ? "-16.8230,-49.2470" : "-16.8233,-49.2439";

  const atByCep = normalized.cep ? await getAtByCep(normalized.cep, normalized.cidade || cityIn) : null;
  const at = atByCep || atBase;

  const queries = buildHereQueryVariants({
    rua: normalized.rua,
    numero: normalized.numero,
    bairro: normalized.bairro || bairroIn,
    cidade: normalized.cidade || cityIn,
    estado: normalized.estado || "GO",
    cep: normalized.cep || cepIn,
    original: addressRaw,
    normalizedLine,
  });

  for (const qTry of queries) {
    const g1 = await hereGeocode(qTry, at);
    if (g1.found && Array.isArray(g1.all) && g1.all.length) {
      const scored = g1.all
        .map((it: any) => ({
          it,
          score: scoreHereItem(it, {
            cep: normalized.cep || cepIn,
            city: normalized.cidade || cityIn,
            bairro: normalized.bairro || bairroIn,
            rua: normalized.rua,
          }),
        }))
        .sort((a: any, b: any) => b.score - a.score);

      bestItem = scored[0]?.it || g1.best;
      if (bestItem) break;
    }

    const d1 = await hereDiscover(qTry, at);
    if (d1.found && Array.isArray(d1.all) && d1.all.length) {
      const scored = d1.all
        .map((it: any) => ({
          it,
          score: scoreHereItem(it, {
            cep: normalized.cep || cepIn,
            city: normalized.cidade || cityIn,
            bairro: normalized.bairro || bairroIn,
            rua: normalized.rua,
          }),
        }))
        .sort((a: any, b: any) => b.score - a.score);

      bestItem = scored[0]?.it || d1.best;
      if (bestItem) break;
    }
  }

  lat = bestItem?.position?.lat ?? null;
  lng = bestItem?.position?.lng ?? null;

  // 4) Aparecida: usa seu mapa real (ArcGIS) pra quadra/lote/bairro (só se tiver lat/lng)
  let quadraAuto = normalized.quadra || "";
  let loteAuto = normalized.lote || "";
  let bairroAuto = normalized.bairro || bairroIn || "";

  let arcgisLot: any = null;
  if (isAparecida && lat != null && lng != null) {
    arcgisLot = await getAparecidaLotFromArcgis(baseOrigin, lat, lng);
    if (arcgisLot?.found) {
      if (String(arcgisLot.quadra || "").trim()) quadraAuto = String(arcgisLot.quadra).trim();
      if (String(arcgisLot.lote || "").trim()) loteAuto = String(arcgisLot.lote).trim();
      if (String(arcgisLot.bairro || "").trim()) bairroAuto = String(arcgisLot.bairro).trim();
    }
  }

  // 5) Status final (regra do Lucas)
  const status = calcStatusLucas({
    rua: normalized.rua,
    quadra: quadraAuto,
    lote: loteAuto,
    bairro: bairroAuto,
  });

  return {
    sequence: row?.sequence ?? "",
    bairro: bairroAuto,
    city: cityForDecision,
    cep: normalized.cep || cepIn,

    // ✅ ESTE É O CAMPO QUE TEM QUE IR PRA "Destination Address" NA TABELA
    original: addressRaw,

    normalized,
    normalizedLine,

    status,
    lat,
    lng,

    model: g.model,
    usedGemini: g.usedGemini,

    notesAuto,
    quadraAuto,
    loteAuto,

    // debug
    raw: g.raw,
    hereBest: bestItem,
    arcgisLotUsed: arcgisLot || null,
  };
}

// ===== HANDLER (BATCH) =====
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const rowsIn: InputRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (!rowsIn.length) {
      return NextResponse.json({ error: "Envie { rows: [...] }" }, { status: 400 });
    }

    const baseOrigin = new URL(req.url).origin;

    const concurrency = 5;
    const results: any[] = new Array(rowsIn.length);
    let index = 0;

    async function worker() {
      while (index < rowsIn.length) {
        const i = index++;
        results[i] = await processOne(rowsIn[i], baseOrigin);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return NextResponse.json({ total: results.length, rows: results });
  } catch (err: any) {
    console.error("Erro /api/process:", err);
    return NextResponse.json({ error: "Erro interno em /api/process" }, { status: 500 });
  }
}