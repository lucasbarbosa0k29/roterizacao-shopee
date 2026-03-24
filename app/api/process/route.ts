// app/api/process/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";


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

function normalizeKey(text: string) {
  return String(text || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function makeBaseAddress(address: string) {
  return String(address || "")
    .replace(/\b(APTO|APT|APARTAMENTO)\b\s*[-:]?\s*[\w\/\-.]+/gi, " ")
    .replace(/\b(BLOCO|BL)\b\s*[-:]?\s*[\w\/\-.]+/gi, " ")
    .replace(/\b(TORRE)\b\s*[-:]?\s*[\w\/\-.]+/gi, " ")
    .replace(/\b(EDIFICIO|EDIF[IÍ]CIO|EDIF\.?)\b\s*[-:]?\s*[^,]+/gi, " ")
    .replace(/\b(CONDOMINIO|CONDOM[IÍ]NIO|COND\.?)\b\s*[-:]?\s*[^,]+/gi, " ")
    .replace(/\b(RESIDENCIAL|RES\.)\b\s*[-:]?\s*[^,]+/gi, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isApartmentLike(s: string) {
  const up = String(s || "").toUpperCase();
  return /\b(APT|APTO|APART|APARTAMENTO|BLOCO|TORRE|EDIF|EDIFICIO|EDIFÍCIO|CONDOMINIO|CONDOMÍNIO|RESIDENCIAL|ANDAR|SALA)\b/.test(up);
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
// ✅ Regex SMART: pega Q/L em vários formatos (Q40 L27, QD40LT27, QUADRA 40 LOTE 27, etc)
function normalizeQLValue(v: string) {
  let t = String(v || "").toUpperCase().trim();

  // remove espaços e símbolos no começo/fim
  t = t.replace(/^[\s\-:]+|[\s\-:]+$/g, "");

  // remove zeros à esquerda só quando for número puro (ex: 040 -> 40)
  if (/^\d+$/.test(t)) t = String(Number(t));

  // limita a caracteres seguros
  t = t.replace(/[^A-Z0-9\-]/g, "");
  return t;
}

function extractQuadraLoteSmart(raw: string) {
  const up = String(raw || "").toUpperCase();

  let quadra = "";
  let lote = "";

  // 1) formatos explícitos: QUADRA/QD/Q + valor
  // pega: "QUADRA 40", "QD40", "Q. 40", "Q40", "Q-40"
  const qMatch = up.match(/\b(?:QUADRA|QD|Q)\.?\s*[:\-]?\s*0*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,3})?)\b/);
  if (qMatch) quadra = normalizeQLValue(qMatch[1]);

  // 2) formatos explícitos: LOTE/LT/L + valor
  // pega: "LOTE 27", "LT27", "L. 27", "L27", "L-27"
  const lMatch = up.match(/\b(?:LOTE|LT|L)\.?\s*[:\-]?\s*0*([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,3})?)\b/);
  if (lMatch) lote = normalizeQLValue(lMatch[1]);

  // 3) grudado tipo "QD40LT27" ou "Q40L27"
  if (!quadra || !lote) {
    const glued = up.match(/\b(?:QUADRA|QD|Q)\.?\s*0*([A-Z0-9]{1,6})\s*(?:LOTE|LT|L)\.?\s*0*([A-Z0-9]{1,6})\b/);
    if (glued) {
      if (!quadra) quadra = normalizeQLValue(glued[1]);
      if (!lote) lote = normalizeQLValue(glued[2]);
    }
  }

  // 4) ordem invertida: "L27 Q40"
  if (!quadra || !lote) {
    const inv = up.match(/\b(?:LOTE|LT|L)\.?\s*0*([A-Z0-9]{1,6})\s*(?:QUADRA|QD|Q)\.?\s*0*([A-Z0-9]{1,6})\b/);
    if (inv) {
      if (!lote) lote = normalizeQLValue(inv[1]);
      if (!quadra) quadra = normalizeQLValue(inv[2]);
    }
  }

  // 5) fallback bem conservador para "40/27" ou "40-27"
  // Só aceita se existir alguma palavra de contexto QD/QUADRA/LT/LOTE no texto
  if ((!quadra || !lote) && /\b(QD|QUADRA|LT|LOTE)\b/.test(up)) {
    const pair = up.match(/\b(\d{1,3})\s*[\/\-]\s*(\d{1,3})\b/);
    if (pair) {
      if (!quadra) quadra = normalizeQLValue(pair[1]);
      if (!lote) lote = normalizeQLValue(pair[2]);
    }
  }

  return { quadra, lote };
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

// ====== NOVO SCORE MELHORADO (NÃO ACEITA O 1º) ======
function scoreHereItemSmart(
  it: any,
  want: { cep?: string; city?: string; bairro?: string; rua?: string; quadra?: string; lote?: string },
) {
  const a = it?.address || {};
  const label = String(a?.label || it?.title || "").toUpperCase();
  const resultType = String(it?.resultType || "").toLowerCase();

  const cepWant = normalizeCep(want.cep || "");
  const cepGot = normalizeCep(a?.postalCode || "");

  const cityWant = String(want.city || "").trim().toUpperCase();
  const cityGot = String(a?.city || "").trim().toUpperCase();

  const bairroWant = String(want.bairro || "").trim().toUpperCase();
  const bairroGot = String(a?.district || a?.subdistrict || "").trim().toUpperCase();

  const ruaWant = String(want.rua || "").trim().toUpperCase();
  const streetGot = String(a?.street || "").trim().toUpperCase();

  const qWant = String(want.quadra || "").trim().toUpperCase();
  const lWant = String(want.lote || "").trim().toUpperCase();

  let s = 0;

  // preferência do tipo
  if (resultType === "housenumber") s += 60;
  else if (resultType === "street") s += 40;
  else if (resultType === "place") s += 15;

  // rua / label
  if (ruaWant && streetGot && (streetGot.includes(ruaWant) || ruaWant.includes(streetGot))) s += 35;
  if (ruaWant && label.includes(ruaWant)) s += 15;

  // cep / city / bairro
  if (cepWant && cepGot && cepWant === cepGot) s += 90;
  if (cityWant && cityGot && (cityGot.includes(cityWant) || cityWant.includes(cityGot))) s += 35;
  if (bairroWant && bairroGot && (bairroGot.includes(bairroWant) || bairroWant.includes(bairroGot))) s += 18;

  // quadra/lote (quando o HERE devolve no label - acontece às vezes)
  if (qWant) {
    const okQ =
      label.includes(`QUADRA ${qWant}`) ||
      label.includes(`QD ${qWant}`) ||
      label.includes(`Q ${qWant}`) ||
      label.includes(`Q${qWant}`);
    if (okQ) s += 45;
  }
  if (lWant) {
    const okL =
      label.includes(`LOTE ${lWant}`) ||
      label.includes(`LT ${lWant}`) ||
      label.includes(`L ${lWant}`) ||
      label.includes(`L${lWant}`);
    if (okL) s += 45;
  }

  // penaliza itens sem position
  if (!it?.position?.lat || !it?.position?.lng) s -= 999;

  return s;
}

function dedupeKeyForHere(it: any) {
  const a = it?.address || {};
  const label = String(a?.label || it?.title || "").trim();
  const lat = it?.position?.lat ?? "";
  const lng = it?.position?.lng ?? "";
  return `${label}::${lat},${lng}`;
}

function clusterPoints(
  points: Array<{ lat: number; lng: number }>,
  maxDistanceMeters = 120,
) {
  if (points.length < 2) return { ok: false, center: null };

  // converte metros aproximados para graus
  const toDeg = (m: number) => m / 111_320;

  const center = {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };

  const maxDeg = toDeg(maxDistanceMeters);

  const allNear = points.every(
    p =>
      Math.abs(p.lat - center.lat) <= maxDeg &&
      Math.abs(p.lng - center.lng) <= maxDeg,
  );

  return {
    ok: allNear,
    center: allNear ? center : null,
  };
}
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function sameText(a: string, b: string) {
  const x = String(a || "").trim().toUpperCase();
  const y = String(b || "").trim().toUpperCase();
  return !!x && !!y && x === y;
}

function scoreArcgisLotMatch(
  arc: any,
  want: { quadra?: string; lote?: string; bairro?: string },
) {
  // arc = retorno do /api/aparecida/lot
  if (!arc || !arc.found) return -50;

  const aq = String(arc.quadra || "").trim();
  const al = String(arc.lote || "").trim();
  const ab = String(arc.bairro || "").trim();

  const wq = String(want.quadra || "").trim();
  const wl = String(want.lote || "").trim();
  const wb = String(want.bairro || "").trim();

  let s = 200; // achou um lote já é MUITO bom

  if (wq && aq) s += sameText(wq, aq) ? 250 : -120;
  if (wl && al) s += sameText(wl, al) ? 250 : -120;

  if (wb && ab) s += (ab.toUpperCase().includes(wb.toUpperCase()) || wb.toUpperCase().includes(ab.toUpperCase())) ? 30 : 0;

  return s;
}

function maxPairDistanceMeters(points: Array<{ lat: number; lng: number }>) {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = haversineMeters(points[i], points[j]);
      if (d > max) max = d;
    }
  }
  return max;
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
    fullNoQdLt,
    ruaCity,
    ruaVariantsCep[0] || "",
    ruaVariantsCity[0] || "",
    full,
    originalClean,
  ]
    .map((x) => x.trim())
    .filter(Boolean);

  return Array.from(new Set(variants)).slice(0, 3);
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

  // ✅ 0) MEMÓRIA GLOBAL: tenta reaproveitar coordenada já salva (ANTES do CONDOMINIO)
  const cityForKey = (cityIn || "").trim();
  const memoryKey = normalizeKey(`${addressRaw} ${cityForKey}`);
  const baseAddressRaw = makeBaseAddress(addressRaw);
  const memoryBaseKey =
    baseAddressRaw &&
    normalizeKey(baseAddressRaw) !== normalizeKey(addressRaw)
      ? normalizeKey(`${baseAddressRaw} ${cityForKey}`)
      : null;

  let memoryHit: null | { lat: number; lng: number; label?: string | null } = null;
  let memoryHitKind: null | "exact" | "base" = null;

  try {
    const candidates = [
      { key: memoryKey, kind: "exact" as const },
      ...(memoryBaseKey ? [{ key: memoryBaseKey, kind: "base" as const }] : []),
    ];

    for (const candidate of candidates) {
      const mem = await prisma.addressMemory.findUnique({
        where: { key: candidate.key },
        select: { lat: true, lng: true, label: true },
      });

      if (mem?.lat == null || mem?.lng == null) continue;

      memoryHit = mem;
      memoryHitKind = candidate.kind;

      // incrementa contador de uso
      await prisma.addressMemory.update({
        where: { key: candidate.key },
        data: { hitCount: { increment: 1 } },
      });

      break;
    }
  } catch (e) {
    console.warn("AddressMemory lookup failed:", e);
  }

  // ✅ regra: apartamento/edifício => NÃO BUSCAR no HERE
  // MAS: se já existir memória, usa memória e volta OK (porque já foi confirmado antes)
  const aptLike = isApartmentLike(addressRaw);
  const hasQL = hasQuadraLoteText(addressRaw);

  if (aptLike && !hasQL) {
    if (memoryHit) {
      return {
        sequence: row?.sequence ?? "",
        bairro: bairroIn,
        city: cityIn,
        cep: cepIn,
        original: addressRaw,
        normalized: null,
        normalizedLine: addressRaw,
        status: "OK",
        lat: memoryHit.lat,
        lng: memoryHit.lng,
        model: "",
        usedGemini: false,
        notesAuto:
          memoryHitKind === "base"
            ? "Condomínio/APTO (usando memória base)"
            : "Condomínio/APTO (usando memória salva)",
        quadraAuto: "",
        loteAuto: "",
        raw: null,
        hereBest: null,
        arcgisLotUsed: null,
        decisionReason:
          memoryHitKind === "base"
            ? "MEMORY_HIT_BASE_CONDOMINIO"
            : "MEMORY_HIT_CONDOMINIO",
      };
    }

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
      decisionReason: "CONDOMINIO_NO_SEARCH",
    };
  }

  // ✅ Se for apt/prédio e NÃO tiver quadra/lote, não chama HERE.
  //    - Se tiver memória, devolve OK com lat/lng
  //    - Se NÃO tiver memória, devolve CONDOMINIO (sem lat/lng)
  if (aptLike && !hasQL) {
    if (memoryHit) {
      return {
        sequence: row?.sequence ?? "",
        bairro: bairroIn,
        city: cityIn,
        cep: cepIn,
        original: addressRaw,
        normalized: null,
        normalizedLine: addressRaw,
        status: "OK",
        lat: memoryHit.lat,
        lng: memoryHit.lng,
        model: "",
        usedGemini: false,
        notesAuto: "Apartamento/Edifício (memória global)",
        quadraAuto: "",
        loteAuto: "",
        raw: null,
        hereBest: null,
        arcgisLotUsed: null,
        decisionReason: "MEMORY_HIT",
      };
    }

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
      decisionReason: "CONDOMINIO_NO_LOOKUP",
    };
  }

  // 1) Gemini
  const g = await geminiNormalize({ address: addressRaw, bairro: bairroIn, city: cityIn, cep: cepIn });

  // 1.1) fallback regex se Gemini falhar
  const rx = extractByRegex(addressRaw);

 const finalRua = (g.normalized.rua || rx.rua || "").trim();

const smartQL = extractQuadraLoteSmart(addressRaw);

const finalQuadra = (g.normalized.quadra || smartQL.quadra || rx.quadra || "").trim();
const finalLote = (g.normalized.lote || smartQL.lote || rx.lote || "").trim();

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

// 3) GEOLOCALIZAÇÃO: ✅ prioriza MEMÓRIA GLOBAL; se não tiver, usa HERE
  let lat: number | null = memoryHit?.lat ?? null;
  let lng: number | null = memoryHit?.lng ?? null;

  // 🔒 variáveis que vão ser usadas mais abaixo (mesmo se pular HERE)
  let decisionReason: string = memoryHit
    ? memoryHitKind === "base"
      ? "MEMORY_HIT_BASE"
      : "MEMORY_HIT"
    : "OK_CONFIDENT";
  let bestHereScore = memoryHit ? 999 : -999;

  let enriched: any[] = [];
  let bestArcgisFromTop: any = null;

  let hereUncertain = false;

  // ✅ Só roda HERE quando NÃO tiver memória
  const scored: Array<{ it: any; score: number; from: string; kind: "geocode" | "discover" }> = [];

  if (!memoryHit) {
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

    const want = {
      cep: normalized.cep || cepIn,
      city: normalized.cidade || cityIn,
      bairro: normalized.bairro || bairroIn,
      rua: normalized.rua,
      quadra: normalized.quadra,
      lote: normalized.lote,
    };

    const seen = new Map<string, any>();
    const EARLY_ACCEPT_SCORE = 105;
    const DISCOVER_FALLBACK_SCORE = 90;
    let bestGeocodeScoreOverall = -999;
    let bestGeocodeQuery = queries[0] || "";
    let acceptedEarly = false;

    // ✅ coleta candidatos de TODAS queries e escolhe o melhor no final
    for (const qTry of queries) {
      const g1 = await hereGeocode(qTry, at);
      let bestGeocodeScoreForQuery = -999;
      if (Array.isArray(g1.all) && g1.all.length) {
        for (const it of g1.all) {
          const key = dedupeKeyForHere(it);
          if (seen.has(key)) continue;
          seen.set(key, it);
          const sc = scoreHereItemSmart(it, want);
          if (sc > bestGeocodeScoreForQuery) bestGeocodeScoreForQuery = sc;
          if (sc > bestGeocodeScoreOverall) {
            bestGeocodeScoreOverall = sc;
            bestGeocodeQuery = qTry;
          }
          scored.push({ it, score: sc, from: qTry, kind: "geocode" });
        }
      }

      if (bestGeocodeScoreForQuery >= EARLY_ACCEPT_SCORE) {
        acceptedEarly = true;
        break;
      }
    }

    if (!acceptedEarly && bestGeocodeScoreOverall < DISCOVER_FALLBACK_SCORE) {
      const discoverQuery = bestGeocodeQuery || queries[0] || "";

      if (discoverQuery) {
        const d1 = await hereDiscover(discoverQuery, at);
        if (Array.isArray(d1.all) && d1.all.length) {
          for (const it of d1.all) {
            const key = dedupeKeyForHere(it);
            if (seen.has(key)) continue;
            seen.set(key, it);
            const sc = scoreHereItemSmart(it, want);
            scored.push({ it, score: sc, from: discoverQuery, kind: "discover" });
          }
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);

    // melhor candidato inicial (HERE puro)
    let bestItem = scored[0]?.it || null;
    bestHereScore = scored[0]?.score ?? -999;

    // ✅ Aparecida: re-rank TOP 3 do HERE usando ArcGIS
    if (isAparecida && scored.length) {
      const topK = 2;
      const top = scored.slice(0, topK);

      const wantArc = {
        quadra: normalized.quadra,
        lote: normalized.lote,
        bairro: normalized.bairro || bairroIn,
      };

      enriched = await Promise.all(
        top.map(async (x) => {
          const pos = x.it?.position;
          if (!pos?.lat || !pos?.lng) {
            return { ...x, arc: null, arcScore: -999, total: x.score - 999 };
          }

          const arc = await getAparecidaLotFromArcgis(baseOrigin, pos.lat, pos.lng);
          const arcScore = scoreArcgisLotMatch(arc, wantArc);

          return { ...x, arc, arcScore, total: x.score + arcScore };
        }),
      );

      enriched.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));

      if (enriched[0]?.it) {
        bestItem = enriched[0].it;
        bestArcgisFromTop = enriched[0].arc || null;
        bestHereScore = enriched[0].score ?? bestHereScore;
      }
    }

    // coordenada final SEMPRE do bestItem
    lat = bestItem?.position?.lat ?? null;
    lng = bestItem?.position?.lng ?? null;

    const MIN_SCORE = 90;
    if (bestHereScore < MIN_SCORE) {
      lat = null;
      lng = null;
      decisionReason = "LOW_SCORE";
    }

    // mede “espalhamento” dos melhores candidatos
    const topN = 2;

    const spreadSource =
      isAparecida && Array.isArray(enriched) && enriched.length ? enriched : scored;

    const pts = spreadSource
      .slice(0, topN)
      .map((x: any) => x?.it?.position)
      .filter(
        (p: any): p is { lat: number; lng: number } =>
          p && typeof p.lat === "number" && typeof p.lng === "number",
      );

    const hereSpreadMeters = pts.length >= 2 ? maxPairDistanceMeters(pts) : 0;
    hereUncertain = hereSpreadMeters > 250;
  }

  const bestScore = bestHereScore;

 // 4) Aparecida: usa seu mapa real (ArcGIS) pra quadra/lote/bairro (só se tiver lat/lng)
let quadraAuto = normalized.quadra || "";
let loteAuto = normalized.lote || "";
let bairroAuto = normalized.bairro || bairroIn || "";

// ✅ usa o ArcGIS do PASSO 3 (top3) quando tiver.
// se não tiver, faz 1 chamada usando o lat/lng final.
let arcgisLot: any = null;

if (isAparecida && lat != null && lng != null && !memoryHit) {
  // bestArcgisFromTop vem do PASSO 3 (top 3 do HERE)
  arcgisLot =
    (typeof bestArcgisFromTop !== "undefined" && bestArcgisFromTop) ? bestArcgisFromTop : null;

  // fallback: se o PASSO 3 não trouxe ArcGIS, busca 1x no ponto final
  if (!arcgisLot) {
    arcgisLot = await getAparecidaLotFromArcgis(baseOrigin, lat, lng);
  }

  if (arcgisLot?.found) {
    if (String(arcgisLot.quadra || "").trim()) quadraAuto = String(arcgisLot.quadra).trim();
    if (String(arcgisLot.lote || "").trim()) loteAuto = String(arcgisLot.lote).trim();
    if (String(arcgisLot.bairro || "").trim()) bairroAuto = String(arcgisLot.bairro).trim();
  }
}

  // 5) Status final (regra do Lucas)
  let status = calcStatusLucas({
    rua: normalized.rua,
    quadra: quadraAuto,
    lote: loteAuto,
    bairro: bairroAuto,
  });

  // ✅ Se for apt/prédio e já tiver coordenada, considera OK
  if (aptLike && lat != null && lng != null) {
    status = "OK";
  }

// ✅ Para endereços normais: se faltar algo, rebaixa para PARCIAL
if (!aptLike && status === "OK" && (!normalized.rua || !quadraAuto || !loteAuto || lat == null || lng == null)) {
  status = "PARCIAL";
}

// ✅ se não tem lat/lng, NÃO deixa como OK (vira PARCIAL)
// (mas para apt/prédio a gente aceita OK só se tiver coord)
if (!aptLike && status === "OK" && (lat == null || lng == null)) {
  status = "PARCIAL";
  decisionReason = "NO_COORD";
}
// ✅ conflito entre Q/L do texto vs ArcGIS => vira PARCIAL (sem status novo)
const wantQ = String(normalized.quadra || "").trim();
const wantL = String(normalized.lote || "").trim();

const conflictQL =
  (wantQ && quadraAuto && wantQ !== quadraAuto) ||
  (wantL && loteAuto && wantL !== loteAuto);

if (conflictQL) {
  status = "PARCIAL";
  lat = null;
  lng = null;
  decisionReason = "QL_CONFLICT";
}
// ✅ se HERE está “espalhado”, não deixa virar OK automático
if (hereUncertain) {
  status = "PARCIAL";
  decisionReason = "HERE_SPREAD";
}
// 🔒 PARTE 4.5 — TRAVA FINAL DE CONFIANÇA
if (status === "OK") {
  const missingCore =
    !normalized.rua ||
    !quadraAuto ||
    !loteAuto ||
    lat == null ||
    lng == null;

  if (missingCore) {
    status = "PARCIAL";
    decisionReason = "MISSING_CORE";
  }
}
// ✅ SALVAR NA MEMÓRIA GLOBAL (se válido)
if (!memoryHit && lat != null && lng != null && status === "OK") {
  try {
    await prisma.addressMemory.upsert({
      where: { key: memoryKey },
      update: {
        lat,
        lng,
        label: normalizedLine || addressRaw,
        updatedAt: new Date(),
      },
      create: {
        key: memoryKey,
        lat,
        lng,
        label: normalizedLine || addressRaw,
        createdBy: null,
      },
    });
  } catch (e) {
    console.warn("AddressMemory save failed:", e);
  }
}
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
 
      decisionReason,

    model: g.model,
    usedGemini: g.usedGemini,

    notesAuto,
    quadraAuto,
    loteAuto,

    // debug
    raw: g.raw,
    hereBest: scored[0]?.it || null,
    arcgisLotUsed: arcgisLot || null,
   hereRankTop5: scored.slice(0, 5).map((x: any) => ({
      score: x.score,
      label: x.it?.address?.label || x.it?.title || "",
      resultType: x.it?.resultType || "",
      from: x.from,
      kind: x.kind,
      pos: x.it?.position || null,
    })),
  };
}

// ===== HANDLER (BATCH) =====
export async function POST(req: Request) {
  let jobId = "";

  try {
    const body = await req.json().catch(() => ({} as any));

    const rowsIn: InputRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (!rowsIn.length) {
      return NextResponse.json({ error: "Envie { rows: [...] }" }, { status: 400 });
    }

    jobId = String(body?.jobId || "").trim();

    // ✅ Se não vier jobId, avisa no console (isso explica admin não atualizar)
    if (!jobId) {
      console.warn("⚠️ /api/process chamado SEM jobId — progresso não será salvo no banco.");
    }

    // ✅ Se veio jobId, marca PROCESSING e zera progresso
    if (jobId) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: "PROCESSING",
          startedAt: new Date(),
          finishedAt: null,
          totalStops: rowsIn.length,
          processedStops: 0,
          errorMessage: null,
          errorStack: null,
        },
      });
    }

    const baseOrigin = new URL(req.url).origin;

    const concurrency = 5;
    const results: any[] = new Array(rowsIn.length);
    let index = 0;

    async function worker() {
      while (index < rowsIn.length) {
        const i = index++;
        try {
          results[i] = await processOne(rowsIn[i], baseOrigin);
        } catch (e: any) {
          results[i] = {
            sequence: rowsIn[i]?.sequence ?? "",
            bairro: rowsIn[i]?.bairro ?? "",
            city: rowsIn[i]?.city ?? "",
            cep: rowsIn[i]?.cep ?? "",
            original: String(rowsIn[i]?.original || ""),
            normalized: null,
            normalizedLine: "",
            status: "FAILED",
            lat: null,
            lng: null,
            model: "",
            usedGemini: false,
            notesAuto: "",
            quadraAuto: "",
            loteAuto: "",
            error: e?.message || "Erro ao processar linha",
          };
        } finally {
          // ✅ SÓ AQUI incrementa (uma vez por linha)
          if (jobId) {
            await prisma.importJob.update({
              where: { id: jobId },
              data: {
                processedStops: { increment: 1 },
                status: "PROCESSING",
              },
            });
          }
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

   // ✅ no final, marca DONE e salva resultado completo
if (jobId) {
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "DONE",
      finishedAt: new Date(),
      processedStops: rowsIn.length,

      // 🔥 SALVA O RESULTADO FINAL NO BANCO
   resultJson: {
  version: 1,
  rows: results,
  manualEdits: {},
  manualGroups: {},
  autoGrouped: false,
  autoBreakIds: [],
  groupMode: false,
  selectedIdxs: [],
  view: "results",
  name: null,
  updatedAtMs: Date.now(),
},
      resultSavedAt: new Date(),
    },
  });
}


    return NextResponse.json({ total: results.length, rows: results });
  } catch (err: any) {
    console.error("Erro /api/process:", err);

    if (jobId) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: err?.message || "Erro desconhecido",
          errorStack: String(err?.stack || ""),
          finishedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ error: "Erro interno em /api/process" }, { status: 500 });
  }
}
