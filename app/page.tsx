"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getHistoryDb,
  getPendingRouteDb,
  listHistoryDb,
  updateHistoryDb,
} from "./lib/history-db";
import {
  TUTORIAL_ACTIVE_KEY,
  startFinalExportTutorial,
  startMapReviewTutorial,
  startPostProcessTutorial,
  startPreProcessTutorial,
  TUTORIAL_EXPORT_FINAL_EVENT,
  TUTORIAL_PENDING_AFTER_PROCESS_KEY,
  TUTORIAL_MAP_CONFIRMED_KEY,
  TUTORIAL_PENDING_EXPORT_FINAL_KEY,
  TUTORIAL_PENDING_MAP_REVIEW_KEY,
  TUTORIAL_START_PREPROCESS_KEY,
} from "./lib/tutorial";
import { buildCondoMemoryKeyPlan, type CondoMemoryKey } from "./lib/condo-memory-keys";

const AparecidaArcgisMap = dynamic(
  () => import("./components/AparecidaArcgisMap"),
  { ssr: false }
);

const GoianiaArcgisMap = dynamic(
  () => import("./components/GoianiaArcgisMap"),
  { ssr: false }
);

const GoogleValidationMap = dynamic(
  () => import("./components/GoogleValidationMap"),
  { ssr: false }
);

type ManualMapProvider = "here" | "arcgis" | "google";
type PrimaryManualMapProvider = "here" | "arcgis";
type ArcgisCityKey = "aparecida" | "goiania";

type Status = "OK" | "PARCIAL" | "NAO_ENCONTRADO" | "MANUAL" | "CONFIRMADO" | "REVISAO";

type RowItem = {
  sequence?: any;
  bairro?: any;
  city?: any;
  cep?: any;
  original?: string;
  normalizedLine?: string;
  status?: Status;
  lat?: number | null;
  lng?: number | null;

  // vindo do /api/process
  notesAuto?: string; // ✅ complemento limpo
  quadraAuto?: string;
  loteAuto?: string;
  normalized?: any;
};

type ManualEdit = {
  address?: string; // ✅ opcional (não vamos mais gravar endereço no manual)
  lat?: number;
  lng?: number;
  quadra?: string;
  lote?: string;
  notes?: string;
  confirmed?: boolean;
  review?: boolean;
};

type GroupedRow = {
  id: string;
  idxs: number[];
  sequenceText: string;
  status: Status;
  statusLabel: string;
  addressDisplay: React.ReactNode;
  addressForExport: string;
  bairro: string;
  city: string;
  cep: string;
  lat: number | null;
  lng: number | null;
  notes: string;
};

type ExportDraftRow = {
  groupId: string;
  baseIdx: number; // ✅ referência da linha real no rows/manualEdits

  sequence: string;
  addressRef: string; // coluna endereço (ref)
  addressOriginal: string;
  lat: number | null;
  lng: number | null;
  quadra: string;
  lote: string;
  complemento: string; // observação/editável
};

type HereSuggestItem = {
  id?: string;
  title?: string;
  resultType?: string;
  address?: {
    label?: string;
    street?: string;
    district?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    countryCode?: string;
  };
  position?: { lat: number; lng: number };
  distance?: number;
};

type GoogleSearchResult = {
  id: string;
  name: string;
  address: string;
  pos: { lat: number; lng: number };
};

type AccessSnapshot = {
  userId: string;
  role: "ADMIN" | "USER";
  isAdmin: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  activeSubscription: null | {
    id: string;
    code: "FREE" | "BASIC" | "PRO";
    name: string;
    startsAt: string;
    expiresAt: string | null;
    dailyRouteLimit: number;
    isUnlimited: boolean;
    source: "ADMIN_GRANT" | "TRIAL" | "INFINITEPAY_LINK" | "MANUAL_PAYMENT";
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
  };
  todayRouteUsage: number;
  planRouteUsageToday: number;
  subscriptionCycleAllowance: number;
  subscriptionCycleUsed: number;
  subscriptionCycleRemaining: number;
  subscriptionCycleAccrued: number;
  routeCreditsBalance: number;
  canStartRoute: boolean;
  allowanceSource: "ADMIN" | "FREE" | "SUBSCRIPTION_DAILY" | "EXTRA_CREDIT" | "NONE";
  dailyRouteLimit: number | null;
  isUnlimited: boolean;
  message: string | null;
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
};

type PendingRouteJob = {
  id: string;
  name: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  totalStops: number;
  processedStops: number;
  createdAt: string;
  updatedAt: string;
};

const PENDING_ROUTE_JOB_KEY = "rotta_pending_route_job_id";
const PENDING_ROUTE_DISMISSED_JOB_KEY = "pendingRouteDismissedJobId";

function readPendingRouteJobId() {
  if (typeof window === "undefined") return "";
  return String(window.localStorage.getItem(PENDING_ROUTE_JOB_KEY) || "").trim();
}

function writePendingRouteJobId(id: string) {
  if (typeof window === "undefined") return;
  const safeId = String(id || "").trim();
  if (!safeId) return;
  window.localStorage.setItem(PENDING_ROUTE_JOB_KEY, safeId);
}

function clearPendingRouteJobId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PENDING_ROUTE_JOB_KEY);
}

function readPendingRouteDismissedJobId() {
  if (typeof window === "undefined") return "";
  return String(window.sessionStorage.getItem(PENDING_ROUTE_DISMISSED_JOB_KEY) || "").trim();
}

function writePendingRouteDismissedJobId(id: string) {
  if (typeof window === "undefined") return;
  const safeId = String(id || "").trim();
  if (!safeId) return;
  window.sessionStorage.setItem(PENDING_ROUTE_DISMISSED_JOB_KEY, safeId);
}

function NoAccessHomeState({ access }: { access: AccessSnapshot | null }) {
  const basicUrl = process.env.NEXT_PUBLIC_PAYMENT_BASIC_URL;
  const proUrl = process.env.NEXT_PUBLIC_PAYMENT_PRO_URL;
  const extraUrl = process.env.NEXT_PUBLIC_PAYMENT_EXTRA_ROUTE_URL;

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-extrabold text-slate-900">Conta e planos</h1>
          <p className="mt-2 text-sm text-slate-600">
            Seu acesso comercial não permite usar a ferramenta principal neste momento.
          </p>

          {access?.code === "ACCESS_BLOCKED" ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="font-semibold">Acesso bloqueado</div>
              <div className="mt-1">
                {access.blockReason || "Entre em contato com o suporte."}
              </div>
            </div>
          ) : access?.code === "NO_ROUTE_CREDITS" ? (
            <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Seu saldo acumulado do ciclo foi utilizado. Você pode comprar uma rota avulsa.
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Nenhum plano ativo encontrado.
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/planos"
              className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Ver planos
            </a>
            {access?.code === "ACCESS_BLOCKED" && (
              <a
                href="/planos"
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Ir para minha conta
              </a>
            )}
          </div>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-wide text-blue-600">BASIC</div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">30 dias</div>
            <div className="mt-2 text-sm text-slate-600">Acumula 1 rota por dia do ciclo</div>
            <div className="mt-6">
              {basicUrl ? (
                <a
                  href={basicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Assinar BASIC
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="block w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-400"
                >
                  Link não configurado
                </button>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-wide text-emerald-600">PRO</div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">30 dias</div>
            <div className="mt-2 text-sm text-slate-600">Acumula 2 rotas por dia do ciclo</div>
            <div className="mt-6">
              {proUrl ? (
                <a
                  href={proUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Assinar PRO
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="block w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-400"
                >
                  Link não configurado
                </button>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-wide text-amber-600">
              Rota avulsa
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">Uso extra</div>
            <div className="mt-2 text-sm text-slate-600">1 crédito adicional</div>
            <div className="mt-6">
              {extraUrl ? (
                <a
                  href={extraUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Comprar Rota Avulsa
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="block w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-400"
                >
                  Link não configurado
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Após o pagamento aprovado, a liberação é feita automaticamente.
        </div>
      </div>
    </main>
  );
}

function extractCepFromText(text: string) {
  const m = String(text || "").match(/\b(\d{5}-?\d{3})\b/);
  return m ? m[1] : "";
}

function stripQuadraLoteFromNotes(text: string) {
  let t = String(text || "").trim();

  t = t.replace(/\b(QD|QUADRA|Q\.)\s*[:\-]?\s*[A-Z0-9\-]+\b/gi, "");
  t = t.replace(/\b(LT|LOTE|L\.)\s*[:\-]?\s*[A-Z0-9\-]+\b/gi, "");
  t = t.replace(/\bQ\s*\d+\b/gi, "");
  t = t.replace(/\bL\s*\d+\b/gi, "");

  t = t.replace(/[-–—|]+/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();

  if (t.toLowerCase().includes("gemini erro")) t = t.replace(/gemini erro/gi, "").trim();

  return t;
}

function escapeHtml(text: string) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// normaliza p/ auto agrupamento (remove CEP, pontuação, espaços)
function normKey(s: string) {
  let t = String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\bCEP\b/g, "")
    .replace(/\bGO\b/g, "")
    .replace(/\d{5}-?\d{3}/g, "") // remove cep
    .replace(/[.,;#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // ✅ normaliza QD/QUADRA e LT/LOTE
  t = t.replace(/\bQUADRA\b/g, "QD");
  t = t.replace(/\bQ\.\b/g, "QD");
  t = t.replace(/\bLOTE\b/g, "LT");
  t = t.replace(/\bL\.\b/g, "LT");

  // ✅ remove zeros à esquerda em tokens numéricos
  t = t.replace(/\b0+(\d+)\b/g, "$1");

  return t;
}

// ✅ AUTO GROUP: endereço + city
function makeAutoGroupKey(args: { address: string; city: string }) {
  return [normKey(args.address), normKey(args.city)].join("|");
}

const CONDO_GROUP_VERTICAL_HINT_RE =
  /\b(?:AP|APT|APTO|APART|APARTAMENTO|BLOCO|TORRE|ANDAR|SALA|EDIF|EDIFICIO|PREDIO|COND|CONDOMINIO)\b|\b(?:APT|APTO|APART|APARTAMENTO|AP)\s*[-:]?\s*\d+[A-Z]?\b|\b[A-Z]\s*[-:]?\s*\d{3,4}[A-Z]?\b/i;
const CONDO_GROUP_STREET_PREFIX_RE =
  /^(RUA|AVENIDA|AV|ALAMEDA|TRAVESSA|TV|VIELA|VIA|R)\b/;
const CONDO_GROUP_STREET_PREFIX_CLEAN_RE =
  /^(RUA|AVENIDA|AV|ALAMEDA|TRAVESSA|TV|VIELA|VIA|R)\b\s*/;
const CONDO_GROUP_LEADING_DESCRIPTOR_RE =
  /^(?:EDIFICIO|EDIF|ED|PREDIO|PRED|CONDOMINIO|COND|RESIDENCIAL|RES|APT|APTO|APARTAMENTO|APART|BLOCO|BL|TORRE|ANDAR|SALA)\b[\s\-:]*/;
const CONDO_GROUP_TRAILING_UNIT_RE =
  /\b(?:APT|APTO|APART|APARTAMENTO|AP|BLOCO|TORRE|ANDAR|SALA)\s*[-:]?\s*[A-Z0-9\/\-]*\d+[A-Z]?(?:\s+[A-Z0-9\/\-]+)?$/i;
const CONDO_GROUP_COMPACT_UNIT_RE =
  /\b(?:APT|APTO|APART|APARTAMENTO|AP)\s*[-:]?\s*\d+[A-Z]?\b/i;
const CONDO_GROUP_NUMERIC_UNIT_RE =
  /\b(?:\d{3,4}\s*[-:]?\s*[A-Z]|[A-Z]\s*[-:]?\s*\d{3,4}|\d{3,4}\s+[A-Z])\b/i;
const CONDO_GROUP_UNIT_CODE_RE = /\b[A-Z]\s*[-]?\s*\d{3,4}[A-Z]?\b/;
const CONDO_GROUP_NAME_STOPWORDS_RE = /\b(DO|DA|DE|DAS|DOS|DEL|DI)\b/g;
const CONDO_GROUP_BLOCKED_HINT_RE =
  /\b(?:Q(?:D)?|QUADRA|LTS?|LT|LOTE)\w*\b|\b(?:CASA|LOTEAMENTO|JARDINS|ALPHAVILLE)\b/;

function escapeRegExp(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitCondoGroupSegments(address: string) {
  return String(address || "")
    .split(/[,;/|]+/g)
    .map((part) => normKey(part))
    .filter(Boolean);
}

function extractCondoGroupStreetName(segment: string) {
  const cleaned = normKey(segment).replace(CONDO_GROUP_STREET_PREFIX_CLEAN_RE, "").trim();
  if (!cleaned) return null;

  const withoutInlineNumber = cleaned
    .replace(
      /\b(?:RESIDENCIAL|CONDOMINIO|COND|EDIFICIO|EDIF|PREDIO|PRED|APT|APTO|APARTAMENTO|APART|BLOCO|BL|TORRE|ANDAR|SALA)\b.*$/i,
      "",
    )
    .replace(/\b(?:N(?:[ÂºO])?|NUM(?:ERO)?|NO)\b\s*[-:]?\s*(\d+[A-Z]?)$/i, "")
    .replace(/\b(\d+[A-Z]?)$/i, "")
    .replace(/\b(?:Q(?:D)?|QUADRA|LTS?|LT|LOTE)\w*(?:\s+[A-Z0-9\/\-]+)*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return withoutInlineNumber || cleaned;
}

function extractCondoGroupStreetNumberFromSegment(segment: string) {
  const cleaned = normKey(segment);
  const markerMatch = cleaned.match(/\b(?:N(?:[ÂºO])?|NUM(?:ERO)?|NO)\b\s*[-:]?\s*(\d+[A-Z]?)$/i);
  if (markerMatch) return markerMatch[1] || null;

  const tailMatch = cleaned.match(/\b(\d+[A-Z]?)$/i);
  if (tailMatch) return tailMatch[1] || null;

  return null;
}

function extractCondoGroupNearestStreetNumber(segments: string[], streetIndex: number) {
  const pureCandidates: Array<{
    number: string;
    distance: number;
    afterStreet: boolean;
    index: number;
  }> = [];
  const fallbackCandidates: Array<{
    number: string;
    distance: number;
    afterStreet: boolean;
    index: number;
  }> = [];

  for (let i = 0; i < segments.length; i += 1) {
    if (i === streetIndex) continue;

    const segment = segments[i];
    if (CONDO_GROUP_VERTICAL_HINT_RE.test(segment)) continue;
    if (CONDO_GROUP_BLOCKED_HINT_RE.test(segment)) continue;

    const number = extractCondoGroupStreetNumberFromSegment(segment);
    if (!number) continue;

    const distance = Math.abs(i - streetIndex);
    const afterStreet = i > streetIndex;
    const candidate = { number, distance, afterStreet, index: i };

    if (normKey(segment).match(/^\d+[A-Z]?$/)) {
      pureCandidates.push(candidate);
      continue;
    }

    fallbackCandidates.push(candidate);
  }

  const filteredPureCandidates = pureCandidates.filter((candidate, index) => {
    if (candidate.number.length > 2) return true;

    const prevSegment = candidate.index > 0 ? segments[candidate.index - 1] : null;
    if (!prevSegment || !CONDO_GROUP_BLOCKED_HINT_RE.test(prevSegment)) return true;

    const hasLaterPureCandidate = pureCandidates.slice(index + 1).length > 0;
    if (hasLaterPureCandidate) return false;

    return true;
  });

  let bestPureAfterStreet: { number: string; distance: number; afterStreet: boolean; index: number } | null = null;
  for (const candidate of filteredPureCandidates) {
    if (!bestPureAfterStreet) {
      bestPureAfterStreet = candidate;
      continue;
    }

    if (candidate.distance < bestPureAfterStreet.distance) {
      bestPureAfterStreet = candidate;
      continue;
    }

    if (
      candidate.distance === bestPureAfterStreet.distance &&
      candidate.afterStreet &&
      !bestPureAfterStreet.afterStreet
    ) {
      bestPureAfterStreet = candidate;
    }
  }

  let bestFallback: { number: string; distance: number; afterStreet: boolean; index: number } | null = null;
  for (const candidate of fallbackCandidates) {
    if (!bestFallback) {
      bestFallback = candidate;
      continue;
    }

    if (candidate.distance < bestFallback.distance) {
      bestFallback = candidate;
      continue;
    }

    if (candidate.distance === bestFallback.distance && candidate.afterStreet && !bestFallback.afterStreet) {
      bestFallback = candidate;
    }
  }

  return bestPureAfterStreet?.number || bestFallback?.number || null;
}

function extractCondoGroupBuildingName(segments: string[], streetIndex: number) {
  const streetSegment = streetIndex >= 0 ? segments[streetIndex] : null;
  const streetName =
    streetSegment !== null ? extractCondoGroupStreetName(streetSegment) : null;
  const streetNamePattern = streetName
    ? new RegExp(`^${escapeRegExp(normKey(streetName))}\\b\\s*`, "i")
    : null;

  const candidates = Array.from(
    new Set(
      segments
        .map((segment, idx) => {
          const cleaned = normKey(segment)
            .replace(CONDO_GROUP_STREET_PREFIX_CLEAN_RE, "")
            .trim();
          const withoutStreetName = streetNamePattern
            ? cleaned.replace(streetNamePattern, "").trim()
            : cleaned;
          return stripCondoGroupNoise(withoutStreetName, { preserveStopwords: true });
        })
        .filter(Boolean),
    ),
  );

  const strongCandidate = candidates.find((candidate) =>
    /(?:RESIDENCIAL|CONDOMINIO|COND|EDIFICIO|EDIF|PREDIO|PRED|TORRE|BLOCO|BL)/.test(
      normKey(candidate),
    ),
  );
  if (strongCandidate) return strongCandidate;

  const fallbackCandidate = candidates.find((candidate) => {
    const normalized = normKey(candidate);
    return !!normalized && !/^\d+$/.test(normalized) && normalized.split(" ").filter(Boolean).length >= 2;
  });

  return fallbackCandidate || null;
}

function stripCondoGroupNoise(
  value: string,
  options?: { preserveStopwords?: boolean },
) {
  let current = normKey(value);

  for (let i = 0; i < 6; i += 1) {
    const next = current
      .replace(CONDO_GROUP_TRAILING_UNIT_RE, " ")
      .replace(CONDO_GROUP_COMPACT_UNIT_RE, " ")
      .replace(CONDO_GROUP_NUMERIC_UNIT_RE, " ")
      .replace(CONDO_GROUP_UNIT_CODE_RE, " ")
      .replace(/\b(?:Q(?:D)?|QUADRA|LTS?|LT|LOTE)\w*(?:\s+[A-Z0-9\/\-]+)*/g, " ")
      .replace(/\b(?:N(?:[ÂºO])?|NUM(?:ERO)?|NO)\b\s*[-:]?\s*[A-Z0-9\/\-]+$/i, " ")
      .replace(/\s*-\s*[A-Z0-9]+$/i, " ")
      .replace(CONDO_GROUP_LEADING_DESCRIPTOR_RE, "")
      .replace(/^\d+[A-Z]?\s+/, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (next === current) break;
    current = next;
  }

  if (!options?.preserveStopwords) {
    current = current.replace(CONDO_GROUP_NAME_STOPWORDS_RE, " ").replace(/\s{2,}/g, " ").trim();
  }

  return current;
}

function normalizeCondoGroupNameKey(value: string) {
  return normKey(value)
    .replace(CONDO_GROUP_NAME_STOPWORDS_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getStrongCondoGroupNameKey(nameKey: string | null) {
  if (!nameKey) return null;
  const stripped = stripCondoGroupNoise(nameKey, { preserveStopwords: true });
  if (!stripped) return null;
  return normalizeCondoGroupNameKey(stripped);
}

function isStrongCondoBuildingName(name: string | null) {
  if (!name) return false;
  const normalized = stripCondoGroupNoise(name, { preserveStopwords: true });
  if (!normalized) return false;

  const tokenCount = normalized.split(" ").filter(Boolean).length;
  return tokenCount >= 1;
}

const PORTO_SONHO_CONTEXT_RE = /\b(?:PORTO\s+DOURADO|SONHO\s+DOURADO)\b/;
const PORTO_DOURADO_EXPLICIT_RE = /\bPORTO\s+DOURADO\s*(?:1|2|3)\b/;
const SONHO_DOURADO_EXPLICIT_RE = /\bSONHO\s+DOURADO\s*(?:1|2)\b/;
const PORTO_DOURADO_NAME_RE = /\bPORTO\s+DOURADO\b/;
const SONHO_DOURADO_NAME_RE = /\bSONHO\s+DOURADO\b/;

function getPortoSonhoFamilyFromStreet(address: string) {
  const segments = splitCondoGroupSegments(address);
  const streetIndex = segments.findIndex((segment) => CONDO_GROUP_STREET_PREFIX_RE.test(segment));
  const streetName =
    streetIndex >= 0 ? extractCondoGroupStreetName(segments[streetIndex]) : null;
  if (!streetName) return null;

  const normalizedStreet = normKey(streetName);
  if (/\bRUA\s+72\b/.test(normalizedStreet)) return "PORTO DOURADO 3";
  if (/\bRUA\s+76\b/.test(normalizedStreet)) return "PORTO DOURADO 2";
  if (/\bRUA\s+82\b/.test(normalizedStreet)) return "PORTO DOURADO 1";
  if (/\bAVENIDA\s+PORTO\s+DOURADO\b/.test(normalizedStreet)) return "PORTO DOURADO 1";

  return null;
}

function buildPortoSonhoSpecialPlan(address: string, bairro: string, city: string) {
  const normalizedCity = normKey(city);
  if (!normalizedCity) return null;

  const normalizedAddress = normKey(address);
  const normalizedBairro = normKey(bairro);
  const segments = splitCondoGroupSegments(address);
  const streetIndex = segments.findIndex((segment) => CONDO_GROUP_STREET_PREFIX_RE.test(segment));
  const streetName =
    streetIndex >= 0 ? extractCondoGroupStreetName(segments[streetIndex]) : null;
  const normalizedStreetName = streetName ? normKey(streetName) : "";
  const addressBody = normalizedStreetName
    ? normalizedAddress.replace(new RegExp(`\\b${escapeRegExp(normalizedStreetName)}\\b`, "i"), " ")
    : normalizedAddress;
  const combined = `${addressBody} ${normalizedBairro}`.replace(/\s{2,}/g, " ").trim();
  const hasPortoSonhoContext = PORTO_SONHO_CONTEXT_RE.test(combined);
  if (!hasPortoSonhoContext) return null;

  const explicitPorto = combined.match(PORTO_DOURADO_EXPLICIT_RE);
  if (explicitPorto) {
    const family = `PORTO DOURADO ${explicitPorto[0].match(/[123]$/)?.[0] || ""}`.trim();
    if (family) {
      const familyKey = normalizeCondoGroupNameKey(`${family} ${normalizedCity}`);
      return {
        shouldAttempt: true,
        hasVerticalSignal: true,
        hasBlockedCadastralSignal: false,
        physicalKey: null,
        nameKey: familyKey,
        keys: [{ kind: "condo_name" as const, key: familyKey }],
      };
    }
  }

  const explicitSonho = combined.match(SONHO_DOURADO_EXPLICIT_RE);
  if (explicitSonho) {
    const family = `SONHO DOURADO ${explicitSonho[0].match(/[12]$/)?.[0] || ""}`.trim();
    if (family) {
      const familyKey = normalizeCondoGroupNameKey(`${family} ${normalizedCity}`);
      return {
        shouldAttempt: true,
        hasVerticalSignal: true,
        hasBlockedCadastralSignal: false,
        physicalKey: null,
        nameKey: familyKey,
        keys: [{ kind: "condo_name" as const, key: familyKey }],
      };
    }
  }

  // Porto Dourado pode usar rua apenas quando há contexto textual explícito do condomínio.
  if (PORTO_DOURADO_NAME_RE.test(combined) && !SONHO_DOURADO_NAME_RE.test(combined)) {
    const streetFamily = getPortoSonhoFamilyFromStreet(address);
    if (streetFamily) {
      const familyKey = normalizeCondoGroupNameKey(`${streetFamily} ${normalizedCity}`);
      return {
        shouldAttempt: true,
        hasVerticalSignal: true,
        hasBlockedCadastralSignal: false,
        physicalKey: null,
        nameKey: familyKey,
        keys: [{ kind: "condo_name" as const, key: familyKey }],
      };
    }
  }

  return null;
}

function buildCondoGroupPlan(address: string, city: string) {
  const basePlan = buildCondoMemoryKeyPlan(address, city);
  const normalizedAddress = normKey(address);
  const segments = splitCondoGroupSegments(address);
  const streetIndex = segments.findIndex((segment) => CONDO_GROUP_STREET_PREFIX_RE.test(segment));
  const streetName =
    streetIndex >= 0 ? extractCondoGroupStreetName(segments[streetIndex]) : null;
  const hasStructuredAddress =
    String(address || "")
      .split(/[,;/|]+/g)
      .map((part) => normKey(part))
      .filter(Boolean).length >= 3;
  const hasVerticalHint =
    CONDO_GROUP_VERTICAL_HINT_RE.test(normalizedAddress) ||
    CONDO_GROUP_COMPACT_UNIT_RE.test(normalizedAddress) ||
    CONDO_GROUP_NUMERIC_UNIT_RE.test(normalizedAddress) ||
    (CONDO_GROUP_TRAILING_UNIT_RE.test(normalizedAddress) && hasStructuredAddress) ||
    (isStrongCondoBuildingName(extractCondoGroupBuildingName(segments, streetIndex)) &&
      CONDO_GROUP_UNIT_CODE_RE.test(normalizedAddress));

  const hasBlockedHorizontalHint = CONDO_GROUP_BLOCKED_HINT_RE.test(normalizedAddress);
  if (!normKey(city)) return null;
  if (hasBlockedHorizontalHint && !hasVerticalHint) return null;
  if (!basePlan.shouldAttempt && !hasVerticalHint) return null;

  const streetNumber =
    streetIndex >= 0 ? extractCondoGroupNearestStreetNumber(segments, streetIndex) : null;
  const buildingName = extractCondoGroupBuildingName(segments, streetIndex);
  const normalizedCity = normKey(city);

  const physicalKey =
    streetName && streetNumber
      ? normKey(`${streetName} ${streetNumber} ${normalizedCity}`)
      : basePlan.physicalKey || null;
  const displayNameKey = buildingName
    ? normKey(`${buildingName} ${normalizedCity}`)
    : basePlan.nameKey || null;

  const keys: CondoMemoryKey[] = [];
  if (physicalKey) {
    keys.push({ kind: "condo_physical" as const, key: physicalKey });
  }
  const normalizedDisplayNameKey = displayNameKey
    ? normalizeCondoGroupNameKey(displayNameKey)
    : null;
  if (normalizedDisplayNameKey && normalizedDisplayNameKey !== physicalKey) {
    keys.push({ kind: "condo_name" as const, key: normalizedDisplayNameKey });
  }

  if (keys.length === 0) {
    if (basePlan.shouldAttempt && basePlan.keys.length) {
      return {
        ...basePlan,
        physicalKey: basePlan.physicalKey,
        nameKey: basePlan.nameKey,
        keys: basePlan.keys.map((key) => ({
          ...key,
          key:
            key.kind === "condo_name"
              ? normalizeCondoGroupNameKey(key.key)
              : normKey(key.key),
          })),
      };
    }
    if (hasVerticalHint) {
      return {
        shouldAttempt: true,
        hasVerticalSignal: true,
        hasBlockedCadastralSignal: hasBlockedHorizontalHint,
        physicalKey: null,
        nameKey: null,
        keys: [],
      };
    }
    return null;
  }

  return {
    shouldAttempt: true,
    hasVerticalSignal: true,
    hasBlockedCadastralSignal: hasBlockedHorizontalHint,
    physicalKey,
    nameKey: displayNameKey,
    keys,
  };
}

function getCondoGroupStreetSignature(address: string, city: string) {
  const segments = splitCondoGroupSegments(address);
  const streetIndex = segments.findIndex((segment) => CONDO_GROUP_STREET_PREFIX_RE.test(segment));
  const streetName =
    streetIndex >= 0 ? extractCondoGroupStreetName(segments[streetIndex]) : null;
  const normalizedCity = normKey(city);

  if (!streetName || !normalizedCity) return null;

  return `${streetName}||${normalizedCity}`;
}

function makeId(prefix = "grp") {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function HomeInner() {
  const router = useRouter();
  const tutorialPostStartedRef = useRef(false);
  const tutorialMapStartedRef = useRef(false);
  const [tutorialExportFinalRequestedAt, setTutorialExportFinalRequestedAt] =
    useState(0);
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [hasHistoryJob, setHasHistoryJob] = useState<boolean | null>(null);
  const [hasPendingRoute, setHasPendingRoute] = useState<boolean | null>(null);
  const [pendingRouteJob, setPendingRouteJob] = useState<PendingRouteJob | null>(null);
  const [pendingRouteDismissedJobId, setPendingRouteDismissedJobId] = useState<string | null>(
    null
  );
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RowItem[]>([]);
  const [view, setView] = useState<"upload" | "results">("upload");
  const [jobProgress, setJobProgress] = useState<{
    status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
    processedStops: number;
    totalStops: number;
    errorMessage?: string | null;
  } | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyName, setHistoryName] = useState<string>("Planilha");
  const [duplicateImportModalOpen, setDuplicateImportModalOpen] = useState(false);
  const [manualEdits, setManualEdits] = useState<Record<number, ManualEdit>>({});
  const lastWorkspaceUpdatedAtRef = useRef(0);
  const isApplyingRemoteWorkspaceRef = useRef(false);
  const [notesEditorIdx, setNotesEditorIdx] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
const searchParams = useSearchParams();
const jobId = searchParams.get("job");
 const canUseExistingSystem =
   !!access &&
   access.code !== "ACCESS_BLOCKED" &&
   (access.isAdmin ||
     access.canStartRoute ||
     hasHistoryJob === true ||
    hasPendingRoute === true);
useEffect(() => {
  if (typeof window === "undefined") return;
  setPendingRouteDismissedJobId(readPendingRouteDismissedJobId());
}, []);
useEffect(() => {
  let alive = true;

  (async () => {
    try {
      setAccessLoading(true);
      setAccessError(null);

      const res = await fetch("/api/access/me", {
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });

      const data = await res.json().catch(() => ({}));
      if (!alive) return;

      if (!res.ok) {
        setAccess(null);
        setAccessError(data?.error || "Erro ao carregar acesso.");
        return;
      }

      setAccess(data as AccessSnapshot);
    } finally {
      if (alive) setAccessLoading(false);
    }
  })();

  return () => {
    alive = false;
  };
}, []);
useEffect(() => {
  if (access && !access.canStartRoute) {
    setFile(null);
  }
}, [access]);
useEffect(() => {
  if (accessLoading || accessError || !access) return;

  if (
    access.isAdmin ||
    access.canStartRoute ||
    access.code === "ACCESS_BLOCKED"
  ) {
    setHasHistoryJob(false);
    return;
  }

  let alive = true;
  setHasHistoryJob(null);

  (async () => {
    try {
      const items = await listHistoryDb();
      if (!alive) return;
      setHasHistoryJob(Array.isArray(items) && items.length > 0);
    } catch {
      if (!alive) return;
      setHasHistoryJob(false);
    }
  })();

  return () => {
    alive = false;
  };
}, [access, accessError, accessLoading]);
useEffect(() => {
  if (accessLoading || accessError || !access) return;

  if (jobId) {
    setPendingRouteJob(null);
    setHasPendingRoute(false);
    return;
  }

  if (access.code === "ACCESS_BLOCKED") {
    setPendingRouteJob(null);
    setHasPendingRoute(false);
    return;
  }

  let alive = true;
  setHasPendingRoute(null);

  (async () => {
    try {
      const pendingJob = await getPendingRouteDb();
      if (!alive) return;

      if (pendingJob?.id) {
        setPendingRouteJob(pendingJob);
        setHasPendingRoute(true);
        writePendingRouteJobId(pendingJob.id);
        return;
      }

      const resumeId = readPendingRouteJobId();
      if (resumeId) {
        try {
          const savedJob = await getHistoryDb(resumeId);
          if (!alive) return;

          if (savedJob?.id && savedJob.status && savedJob.status !== "FAILED") {
            setPendingRouteJob({
              id: savedJob.id,
              name: savedJob.originalName || "Planilha sem nome",
              status: savedJob.status,
              totalStops: Number(savedJob.totalStops || 0),
              processedStops: Number(savedJob.processedStops || 0),
              createdAt: savedJob.createdAt || new Date().toISOString(),
              updatedAt: savedJob.updatedAt || new Date().toISOString(),
            });
            setHasPendingRoute(true);
            return;
          }

          clearPendingRouteJobId();
        } catch {
          // se o job salvo não existir mais, limpa o apoio local
          clearPendingRouteJobId();
        }
      }

      setPendingRouteJob(null);
      setHasPendingRoute(false);
    } catch {
      if (!alive) return;
      setPendingRouteJob(null);
      setHasPendingRoute(false);
    }
  })();

  return () => {
    alive = false;
  };
  }, [access, accessError, accessLoading, jobId]);
  const isPendingRouteDismissed =
    !!pendingRouteJob?.id &&
    pendingRouteDismissedJobId !== null &&
    pendingRouteDismissedJobId === pendingRouteJob.id;
  const shouldShowPendingRouteBanner =
    !!pendingRouteJob && !jobId && canUseExistingSystem && !isPendingRouteDismissed;
useEffect(() => {
  /*

  (async () => {
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(jobId)}`, {
        credentials: "include",
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Erro ao abrir histórico.");
        return;
      }

      const job = data?.job;
      const resultPayload = job?.resultJson;
      const workspacePayload = job?.workspaceJson ?? resultPayload;

      // aceita: array direto OU objeto { rows, ... }
      const loadedRows = Array.isArray(resultPayload) ? resultPayload : resultPayload?.rows;

      if (!Array.isArray(loadedRows) || loadedRows.length === 0) {
        alert("Histórico sem rows salvos (resultJson vazio).");
        return;
      }

      setFile(null);
      setRows(loadedRows);

// ✅ restaura estados salvos do histórico (payload envelope)
      const p = workspacePayload && typeof workspacePayload === "object" ? workspacePayload : null;

      applyWorkspaceSnapshot(p, {
        preserveEphemeral: false,
        nextName: job?.originalName || "Planilha",
      });

// ✅ restaura view corretamente

// ✅ restaura nome salvo

setHistoryId(job.id);
    } catch (e) {
      console.error(e);
      alert("Erro ao abrir histórico.");
    }
  })();
  */
}, [jobId]);
  // grupos manuais
  const [manualGroups, setManualGroups] = useState<Record<string, number[]>>({});

  // auto agrupar
  const [autoGrouped, setAutoGrouped] = useState(false);
  const [autoBreakIds, setAutoBreakIds] = useState<Set<string>>(new Set());
  const [condoGrouped, setCondoGrouped] = useState(false);
  const [condoBreakIds, setCondoBreakIds] = useState<Set<string>>(new Set());

  // modo agrupar manual (selecionar)
  const [groupMode, setGroupMode] = useState(false);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());
  const [mergeTargetGroupId, setMergeTargetGroupId] = useState<string | null>(null);

  function applyWorkspaceSnapshot(
    snapshot: any,
    options?: { preserveEphemeral?: boolean; nextName?: string | null }
  ) {
    const p = snapshot && typeof snapshot === "object" ? snapshot : null;

    isApplyingRemoteWorkspaceRef.current = true;

    setManualEdits(p?.manualEdits ?? {});
    setManualGroups(p?.manualGroups ?? {});
    setAutoGrouped(!!p?.autoGrouped);
    setAutoBreakIds(new Set(p?.autoBreakIds ?? []));
    setCondoGrouped(!!p?.condoGrouped);
    setCondoBreakIds(new Set(p?.condoBreakIds ?? []));

    if (!options?.preserveEphemeral) {
      setGroupMode(false);
      setSelectedIdxs(new Set());
      setView("results");
    }

    setHistoryName(
      typeof p?.name === "string" && p.name.trim()
        ? p.name
        : (options?.nextName || "Planilha")
    );
    lastWorkspaceUpdatedAtRef.current = Number(p?.updatedAtMs || 0);
  }

  function applyJobProgress(job: any) {
    const status = String(job?.status || "PENDING") as "PENDING" | "PROCESSING" | "DONE" | "FAILED";

    setJobProgress({
      status,
      processedStops: Number(job?.processedStops || 0),
      totalStops: Number(job?.totalStops || 0),
      errorMessage: typeof job?.errorMessage === "string" ? job.errorMessage : null,
    });

    if (status === "PENDING" || status === "PROCESSING") {
      if (job?.id) {
        writePendingRouteJobId(job.id);
      }
      setLoading(true);
      setView("upload");
      setRows([]);
      return false;
    }

    if (status === "FAILED") {
      clearPendingRouteJobId();
      setLoading(false);
      setView("upload");
      setRows([]);
      return false;
    }

    setLoading(false);
    if (job?.id) {
      writePendingRouteJobId(job.id);
    }
    return true;
  }

  function hydrateDoneJob(job: any) {
    const resultPayload = job?.resultJson;
    const workspacePayload = job?.workspaceJson ?? resultPayload;
    const loadedRows = Array.isArray(resultPayload) ? resultPayload : resultPayload?.rows;

    if (!Array.isArray(loadedRows) || loadedRows.length === 0) {
      clearPendingRouteJobId();
      return false;
    }

    if (job?.id) {
      writePendingRouteJobId(job.id);
    }

    setRows(loadedRows);
    applyWorkspaceSnapshot(workspacePayload, {
      preserveEphemeral: false,
      nextName: job?.originalName || "Planilha",
    });
    setView("results");
    return true;
  }

  async function fetchHistoryJob(
    id: string,
    mode: "full" | "progress" = "full"
  ) {
    const qs = mode === "progress" ? "?mode=progress" : "";

    const res = await fetch(`/api/history/${encodeURIComponent(id)}${qs}`, {
      credentials: "include",
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Erro ao abrir histórico.");
    }

    return data?.job;
  }

  useEffect(() => {
    if (!jobId) return;

    (async () => {
      try {
        const job = await fetchHistoryJob(jobId, "full");
        setHistoryId(job.id);
        writePendingRouteJobId(job.id);
        setFile(null);
        setHistoryName(job?.originalName || "Planilha");

        if (!applyJobProgress(job)) {
          return;
        }

        if (!hydrateDoneJob(job)) {
          alert("Histórico sem rows salvos (resultJson vazio).");
        }
      } catch (e) {
        console.error(e);
        setLoading(false);
        setJobProgress(null);
      }
    })();
  }, [jobId, router]);


useEffect(() => {
if (!historyId) return;
if (isApplyingRemoteWorkspaceRef.current) {
  isApplyingRemoteWorkspaceRef.current = false;
  return;
}
// ✅ não salva histórico vazio
if (!rows || rows.length === 0) return;
  const t = setTimeout(() => {
  const updatedAtMs = Date.now();
  lastWorkspaceUpdatedAtRef.current = updatedAtMs;
  updateHistoryDb(historyId, {
   version: 1,
   manualEdits,
   manualGroups,
   autoGrouped,
   autoBreakIds: Array.from(autoBreakIds),
   condoGrouped,
   condoBreakIds: Array.from(condoBreakIds),
   name: historyName || file?.name || "Planilha",
   updatedAtMs,
 }).catch(() => {});
}, 1500);

  return () => clearTimeout(t);
}, [
  historyId,
  rows,
  manualEdits,
  manualGroups,
  autoGrouped,
  autoBreakIds,
  condoGrouped,
  condoBreakIds,
  file,
  historyName,
]);
useEffect(() => {
if (!historyId) return;
if (rows.length > 0 && jobProgress?.status === "DONE") return;

  const interval = setInterval(async () => {
    try {
      const job = await fetchHistoryJob(historyId, "progress");
      if (!job) return;

      if (!applyJobProgress(job)) {
        return;
      }

      if (job.status === "DONE" && rows.length === 0) {
        const fullJob = await fetchHistoryJob(historyId, "full");
        hydrateDoneJob(fullJob);
        return;
      }
    } catch {
      // polling silencioso
    }
  }, 10000);

  return () => clearInterval(interval);
}, [historyId, rows.length, jobProgress?.status]);
  // menu do botão direito
  const [ctx, setCtx] = useState<{ open: boolean; x: number; y: number; groupId: string | null }>({
    open: false,
    x: 0,
    y: 0,
    groupId: null,
  });
  const longPressTimerRef = useRef<any>(null);

  // export review modal
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportDraft, setExportDraft] = useState<ExportDraftRow[]>([]);
  const [isOverviewMapOpen, setIsOverviewMapOpen] = useState(false);
  const [overviewSelectedGroupId, setOverviewSelectedGroupId] = useState<string | null>(null);
  const [overviewCardPosition, setOverviewCardPosition] = useState<{ left: number; top: number } | null>(null);
  const [overviewMoveDraft, setOverviewMoveDraft] = useState<{
    groupId: string;
    baseIdx: number;
    coord: { lat: number; lng: number };
  } | null>(null);

  // modal mapa
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalIdx, setModalIdx] = useState<number | null>(null);
  const [modalOriginal, setModalOriginal] = useState("");
  const [modalValue, setModalValue] = useState("");
  const [modalCep, setModalCep] = useState("");

  const [pickedLabel, setPickedLabel] = useState("");
  const [pickedCep, setPickedCep] = useState("");
  const [pickedQuadra, setPickedQuadra] = useState("");
  const [pickedLote, setPickedLote] = useState("");
  const [googleSearchQuery, setGoogleSearchQuery] = useState("");
  const [googleSearchRequestId, setGoogleSearchRequestId] = useState(0);
  const [googleSearchLoading, setGoogleSearchLoading] = useState(false);
  const [googleSearchMessage, setGoogleSearchMessage] = useState("");
  const [googleSearchResults, setGoogleSearchResults] = useState<GoogleSearchResult[]>([]);

  const [pinLatLng, setPinLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [manualMapProvider, setManualMapProvider] = useState<ManualMapProvider>("here");
  const [lastPrimaryManualMapProvider, setLastPrimaryManualMapProvider] =
    useState<PrimaryManualMapProvider>("here");
// 🔒 evita hydration mismatch
const [mounted, setMounted] = useState(false);

useEffect(() => {
  setMounted(true);
}, []);

  async function buscarQuadraLote(lat: number, lng: number) {
    try {
      const res = await fetch(`/api/aparecida/lot?lat=${lat}&lng=${lng}`);
      const data = await res.json();

      if (data?.found) {
        setPickedQuadra(data.quadra ?? "");
        setPickedLote(data.lote ?? "");
      } else {
        setPickedQuadra("");
        setPickedLote("");
      }
    } catch (err) {
      console.error("Erro ao buscar quadra/lote", err);
    }
  }

  // HERE
  const mapRef = useRef<HTMLDivElement | null>(null);
  const hereMap = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const searchRef = useRef<any>(null);
  const overviewMapRef = useRef<HTMLDivElement | null>(null);
  const overviewHereMap = useRef<any>(null);
  const overviewMarkersGroupRef = useRef<any>(null);
  const overviewDidFitRef = useRef(false);
  const overviewSelectedPointRef = useRef<{ lat: number; lng: number } | null>(null);
  const overviewMoveDraftRef = useRef<{
    groupId: string;
    baseIdx: number;
    coord: { lat: number; lng: number };
  } | null>(null);
  const reverseCacheRef = useRef<Map<string, any>>(new Map());
  const quadraCacheRef = useRef<Map<string, any>>(new Map());

  // ===== overlay quadra/lote (polígonos) =====


  // anti-duplo clique / aborts
  const clickGateRef = useRef({ t: 0, lat: 0, lng: 0 });
  const abortReverseRef = useRef<AbortController | null>(null);
  const abortLotRef = useRef<AbortController | null>(null);
  // ===== debounce overlay (ANTI-SPAM) =====
 
    // ===== anti-freeze (clique no mapa) =====
  
  const pinFromTapRef = useRef(false);
  const clickFetchDebounceRef = useRef<any>(null);

  function normalizeCityName(v: any) {
    return String(v || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function isAparecidaCity(v: any) {
    return normalizeCityName(v).includes("APARECIDA");
  }

  function getArcgisCityKey(v: any): ArcgisCityKey | null {
    const s = normalizeCityName(v);
    if (s.includes("APARECIDA")) return "aparecida";
    if (s.includes("GOIANIA")) return "goiania";
    return null;
  }

  function getInitialManualMapProvider(city: any): ManualMapProvider {
    const cityKey = getArcgisCityKey(city);
    if (isAparecidaCity(city)) return "arcgis";
    if (lastPrimaryManualMapProvider === "arcgis" && cityKey) return "arcgis";
    return "here";
  }

  function buildHereSearchQuery(raw: string) {
    const idx = modalIdx ?? 0;
    const currentCity = String(modalCity || rows?.[idx]?.city || "").trim();
    const currentBairro = String(rows?.[idx]?.bairro || "").trim();

    let q = String(raw || "").trim();
    if (!q) return "";

    const normalizedQ = normalizeCityName(q);
    const normalizedCity = normalizeCityName(currentCity);
    const normalizedBairro = normalizeCityName(currentBairro);

    if (currentBairro && !normalizedQ.includes(normalizedBairro)) {
      q = `${q}, ${currentBairro}`;
    }

    if (currentCity && !normalizedQ.includes(normalizedCity)) {
      q = `${q}, ${currentCity}`;
    }

    if (!normalizedQ.includes("GO")) {
      q = `${q}, GO`;
    }

    if (!normalizedQ.includes("BRASIL")) {
      q = `${q}, Brasil`;
    }

    return q;
  }

  function hereSuggestMatchesCurrentCity(item: HereSuggestItem) {
    const idx = modalIdx ?? 0;
    const currentCity = String(modalCity || rows?.[idx]?.city || "").trim();
    if (!currentCity) return true;

    const itemCity = String((item as any)?.address?.city || (item as any)?.address?.district || "").trim();
    if (!itemCity) return true;

    const normalizedExpected = normalizeCityName(currentCity);
    const normalizedItem = normalizeCityName(itemCity);
    if (!normalizedExpected || !normalizedItem) return true;

    return normalizedItem.includes(normalizedExpected) || normalizedExpected.includes(normalizedItem);
  }

  const modalCity = modalIdx !== null ? rows?.[modalIdx]?.city : "";
  const arcgisCityKey = getArcgisCityKey(modalCity);
  const forceArcgisOnly = isModalOpen && isAparecidaCity(modalCity);
  const showProviderToggle = isModalOpen;
  const arcgisAvailable =
    isModalOpen &&
    !!arcgisCityKey &&
    (arcgisCityKey === "aparecida" || arcgisCityKey === "goiania");

  const activeMapProvider: ManualMapProvider =
    manualMapProvider === "google"
      ? "google"
      : manualMapProvider === "arcgis" && arcgisAvailable
        ? "arcgis"
        : forceArcgisOnly
          ? "arcgis"
          : "here";

  async function copyTextWithFallback(text: string) {
    if (!text || typeof document === "undefined") return false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (activeMapProvider === "google") return;
    setGoogleSearchResults([]);
    setGoogleSearchMessage("");
    setGoogleSearchLoading(false);
  }, [activeMapProvider]);

  // ===== AUTOSUGGEST (dropdown estilo Waze) =====
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestItems, setSuggestItems] = useState<HereSuggestItem[]>([]);
  const [suggestActive, setSuggestActive] = useState(-1);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const suggestTimerRef = useRef<any>(null);
  const searchBoxWrapRef = useRef<HTMLDivElement | null>(null);

  // ✅ cache local pra não repetir busca HERE do mesmo texto
  const geocodeCacheRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    function onDown() {
      setCtx((c) => (c.open ? { ...c, open: false } : c));
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // fechar dropdown ao clicar fora
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!suggestOpen) return;
      const el = searchBoxWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setSuggestOpen(false);
      setSuggestActive(-1);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [suggestOpen]);

  // ✅ Destination Address deve ser 100% fiel ao Excel
 function getShownAddress(i: number) {
  const manual = manualEdits[i];
  if (manual?.address && manual.address.trim()) return manual.address;
  return String(rows[i]?.original || "");
}

  // ✅ Para export: se tiver manual, usa manual; senão usa o original do Excel
  function getExportAddress(i: number) {
    const manual = manualEdits[i];
    if (manual?.address) return manual.address;
    return String(rows[i]?.original || "");
  }

 function getRowStatus(i: number): Status {
  const manual = manualEdits[i];

  // ✅ confirmado continua confirmado (mesmo com review)
  if (manual?.confirmed) return "CONFIRMADO";

  // ✅ "MANUAL" só quando tiver edição de verdade (review sozinho não conta)
  const hasManualData = !!(
    manual &&
    (
      (manual.address && manual.address.trim()) ||
      typeof manual.lat === "number" ||
      typeof manual.lng === "number" ||
      (manual.quadra && manual.quadra.trim()) ||
      (manual.lote && manual.lote.trim())
    )
  );

  if (hasManualData) return "MANUAL";

  // ✅ mantém o status original (OK / PARCIAL / NAO_ENCONTRADO)
  return (rows[i]?.status || "NAO_ENCONTRADO") as Status;
}

  function isRowMemoryHit(i: number) {
    const row = rows[i] as any;
    const decisionReason = String(
      row?.decisionReason || row?.memoryDebug?.decisionReason || ""
    ).toUpperCase();

    return !!row?.memoryDebug?.memoryHit || decisionReason.startsWith("MEMORY");
  }

  function getVisualStatusLabel(status: Status, idxs: number[]) {
    if (status === "OK" && idxs.some((idx) => isRowMemoryHit(idx))) {
      return "Memória";
    }
    if (status === "OK") return "Validado";
    if (status === "PARCIAL") return "Aproximado";
    if (status === "NAO_ENCONTRADO") return "Pendente";
    if (status === "CONFIRMADO") return "Confirmado";
    return status;
  }

  function getGroupBaseIdx(idxs: number[]) {
    for (const idx of idxs) {
      if (manualEdits[idx]?.confirmed || rows[idx]?.status === "CONFIRMADO") return idx;
    }
    return idxs[0];
  }

  function getStatusBadgeClass(status: Status) {
    if (status === "CONFIRMADO" || status === "OK") {
      return "border border-emerald-300 bg-emerald-100 text-emerald-950";
    }
    if (status === "PARCIAL") {
      return "border border-amber-200 bg-amber-50 text-amber-800";
    }
    if (status === "MANUAL") {
      return "border border-sky-200 bg-sky-50 text-sky-800";
    }
    return "border border-rose-200 bg-rose-50 text-rose-800";
  }

  function getRowQuadra(i: number) {
    const manual = String(manualEdits[i]?.quadra || "").trim();
    if (manual) return manual;
    return String((rows[i] as any)?.quadraAuto || "").trim();
  }
  function getRowLote(i: number) {
    const manual = String(manualEdits[i]?.lote || "").trim();
    if (manual) return manual;
    return String((rows[i] as any)?.loteAuto || "").trim();
  }

  function getManualObservation(i: number) {
    return String(manualEdits[i]?.notes || "").trim();
  }

  function getGroupObservation(baseIdx: number, idxs: number[]) {
    const manual = getManualObservation(baseIdx);
    if (manual) return manual;
    if (idxs.length >= 4) return `${idxs.length} PACOTES`;
    return "";
  }

  function openNotesEditor(idx: number) {
    setNotesEditorIdx(idx);
    setNotesDraft(String(manualEdits[idx]?.notes || "").trim());
  }

  function cancelNotesEditor() {
    setNotesEditorIdx(null);
    setNotesDraft("");
  }

  function saveNotesEditor(idx: number) {
    const nextValue = notesDraft.trim();

    setManualEdits((prev) => {
      const current = prev[idx] || {};

      if (!nextValue) {
        const { [idx]: _removed, ...rest } = prev;
        const cleanedCurrent = {
          ...current,
          notes: undefined,
        };

        const hasOtherManualData = !!(
          (cleanedCurrent.address && cleanedCurrent.address.trim()) ||
          typeof cleanedCurrent.lat === "number" ||
          typeof cleanedCurrent.lng === "number" ||
          (cleanedCurrent.quadra && cleanedCurrent.quadra.trim()) ||
          (cleanedCurrent.lote && cleanedCurrent.lote.trim()) ||
          cleanedCurrent.confirmed ||
          cleanedCurrent.review
        );

        if (!hasOtherManualData) {
          return rest;
        }

        return {
          ...rest,
          [idx]: cleanedCurrent,
        };
      }

      return {
        ...prev,
        [idx]: {
          ...current,
          notes: nextValue,
        },
      };
    });

    cancelNotesEditor();
  }

  // ===== groupedRows =====
  const groupedRows: GroupedRow[] = useMemo(() => {
    if (!rows.length) return [];

    const allIdxs = rows.map((_, i) => i);

    // manual groups
    const idxToManualGroup = new Map<number, string>();
    for (const [gid, idxs] of Object.entries(manualGroups)) {
      for (const idx of idxs) idxToManualGroup.set(idx, gid);
    }

    const manualGroupBuckets = new Map<string, number[]>();
    const notInManual: number[] = [];

    for (const idx of allIdxs) {
      const gid = idxToManualGroup.get(idx);
      if (gid) {
        const arr = manualGroupBuckets.get(gid) || [];
        arr.push(idx);
        manualGroupBuckets.set(gid, arr);
      } else {
        notInManual.push(idx);
      }
    }

    const groupItems: { id: string; idxs: number[] }[] = [];
    const singles: number[] = [];
    const singlesSet = new Set<number>();
    const pushSingle = (...idxs: number[]) => {
      for (const idx of idxs) {
        if (singlesSet.has(idx)) continue;
        singlesSet.add(idx);
        singles.push(idx);
      }
    };

    const remainingParent = new Map<number, number>();
    const remainingRank = new Map<number, number>();
    const autoKeyByIdx = new Map<number, string>();
    const condoPlansByIdx = new Map<number, ReturnType<typeof buildCondoGroupPlan>>();
    for (const idx of notInManual) {
      remainingParent.set(idx, idx);
      remainingRank.set(idx, 0);
    }

    const findRemaining = (x: number): number => {
      const parent = remainingParent.get(x);
      if (parent === undefined || parent === x) return x;
      const root = findRemaining(parent);
      remainingParent.set(x, root);
      return root;
    };

    const unionRemaining = (a: number, b: number) => {
      const ra = findRemaining(a);
      const rb = findRemaining(b);
      if (ra === rb) return;

      const rankA = remainingRank.get(ra) || 0;
      const rankB = remainingRank.get(rb) || 0;

      if (rankA < rankB) {
        remainingParent.set(ra, rb);
        return;
      }

      remainingParent.set(rb, ra);
      if (rankA === rankB) remainingRank.set(ra, rankA + 1);
    };

    // ✅ AUTO GROUPING
    if (autoGrouped) {
      const autoBuckets = new Map<string, number[]>();

      for (const idx of notInManual) {
        const addr = getShownAddress(idx);
        const city = String(rows[idx]?.city || "");
        const key = makeAutoGroupKey({ address: addr, city });
        autoKeyByIdx.set(idx, key);

        const arr = autoBuckets.get(key) || [];
        arr.push(idx);
        autoBuckets.set(key, arr);
      }

      for (const [k, idxs] of autoBuckets.entries()) {
        const id = `auto_${k}`;
        if (autoBreakIds.has(id) || idxs.length <= 1) continue;
        for (let i = 1; i < idxs.length; i += 1) {
          unionRemaining(idxs[0], idxs[i]);
        }
      }
    }

    // ✅ AGRUPAMENTO CONDOMÍNIOS / PRÉDIOS
    if (condoGrouped) {
    const condoPhysicalHintCounts = new Map<string, Map<string, number>>();
    const condoStreetHintCounts = new Map<string, Map<string, number>>();
    const condoBucketsByKey = new Map<string, number[]>();

      for (const idx of notInManual) {
        const addr = getShownAddress(idx);
        const city = String(rows[idx]?.city || "");
        const bairro = String(rows[idx]?.bairro || "");
        const specialPlan = buildPortoSonhoSpecialPlan(addr, bairro, city);
        const hasPortoSonhoContext = PORTO_SONHO_CONTEXT_RE.test(
          `${normKey(addr)} ${normKey(bairro)}`.replace(/\s{2,}/g, " ").trim(),
        );
        const plan = specialPlan || (!hasPortoSonhoContext ? buildCondoGroupPlan(addr, city) : null);
        if (!plan?.shouldAttempt) continue;

        condoPlansByIdx.set(idx, plan);

        const normalizedNameKey = getStrongCondoGroupNameKey(plan.nameKey || null);
        if (normalizedNameKey) {
          const physicalHintKey = plan.physicalKey ? normalizeCondoGroupNameKey(plan.physicalKey) : null;
          if (physicalHintKey) {
            const bucket = condoPhysicalHintCounts.get(physicalHintKey) || new Map<string, number>();
            bucket.set(normalizedNameKey, (bucket.get(normalizedNameKey) || 0) + 1);
            condoPhysicalHintCounts.set(physicalHintKey, bucket);
          } else {
            const streetSignature = getCondoGroupStreetSignature(addr, city);
            if (streetSignature) {
              const bucket = condoStreetHintCounts.get(streetSignature) || new Map<string, number>();
              bucket.set(normalizedNameKey, (bucket.get(normalizedNameKey) || 0) + 1);
              condoStreetHintCounts.set(streetSignature, bucket);
            }
          }
        }
      }

      const condoPhysicalHintByKey = new Map<string, string>();
      for (const [physicalHintKey, counts] of condoPhysicalHintCounts.entries()) {
        let bestKey: string | null = null;
        let bestCount = 0;
        for (const [candidateKey, count] of counts.entries()) {
          if (count > bestCount || (count === bestCount && candidateKey < (bestKey || ""))) {
            bestKey = candidateKey;
            bestCount = count;
          }
        }
        if (bestKey) condoPhysicalHintByKey.set(physicalHintKey, bestKey);
      }

      const condoStreetHintBySignature = new Map<string, string>();
      for (const [streetSignature, counts] of condoStreetHintCounts.entries()) {
        let bestKey: string | null = null;
        let bestCount = 0;
        for (const [candidateKey, count] of counts.entries()) {
          if (count > bestCount || (count === bestCount && candidateKey < (bestKey || ""))) {
            bestKey = candidateKey;
            bestCount = count;
          }
        }
        if (bestKey) condoStreetHintBySignature.set(streetSignature, bestKey);
      }

      for (const idx of notInManual) {
        const addr = getShownAddress(idx);
        const city = String(rows[idx]?.city || "");
        const bairro = String(rows[idx]?.bairro || "");
        let plan =
          condoPlansByIdx.get(idx) ||
          buildPortoSonhoSpecialPlan(addr, bairro, city) ||
          buildCondoGroupPlan(addr, city);
        if (!plan?.shouldAttempt || !plan.keys.length) continue;

        const planHasStrongName = !!plan.nameKey && isStrongCondoBuildingName(plan.nameKey);
        const hasVerticalLikeSignal =
          plan.hasVerticalSignal ||
          CONDO_GROUP_VERTICAL_HINT_RE.test(normKey(addr)) ||
          CONDO_GROUP_COMPACT_UNIT_RE.test(normKey(addr)) ||
          CONDO_GROUP_NUMERIC_UNIT_RE.test(normKey(addr));
        const exactPhysicalHintKey = plan.physicalKey
          ? normalizeCondoGroupNameKey(plan.physicalKey)
          : null;
        const streetSignature = getCondoGroupStreetSignature(addr, city);
        const hintNameKey = exactPhysicalHintKey
          ? condoPhysicalHintByKey.get(exactPhysicalHintKey) || null
          : streetSignature
            ? condoStreetHintBySignature.get(streetSignature) || null
            : null;

        if (hintNameKey && hasVerticalLikeSignal && !planHasStrongName) {
          const inferredPhysicalKey = plan.physicalKey ? normKey(plan.physicalKey) : null;
          const inferredNameKey = normKey(`${hintNameKey} ${normKey(city)}`);
          const inferredKeys: CondoMemoryKey[] = [];

          if (inferredPhysicalKey) {
            inferredKeys.push({ kind: "condo_physical", key: inferredPhysicalKey });
          }
          inferredKeys.push({
            kind: "condo_name",
            key: normalizeCondoGroupNameKey(inferredNameKey),
          });

          plan = {
            ...plan,
            nameKey: inferredNameKey,
            keys: inferredKeys,
          };
          condoPlansByIdx.set(idx, plan);
        }

        if (!plan.keys.length) continue;

        for (const key of plan.keys) {
          const bucket = condoBucketsByKey.get(key.key) || [];
          bucket.push(idx);
          condoBucketsByKey.set(key.key, bucket);
        }
      }

      const seenCondoBuckets = new Set<string>();
      for (const [k, idxs] of condoBucketsByKey.entries()) {
        const uniqueIdxs = Array.from(new Set(idxs)).sort((a, b) => a - b);
        if (uniqueIdxs.length <= 1) continue;

        const bucketId = `condo_${k}`;
        if (seenCondoBuckets.has(bucketId)) continue;
        seenCondoBuckets.add(bucketId);

        for (let i = 1; i < uniqueIdxs.length; i += 1) {
          unionRemaining(uniqueIdxs[0], uniqueIdxs[i]);
        }
      }
    }

    const remainingBuckets = new Map<number, number[]>();
    for (const idx of notInManual) {
      const root = findRemaining(idx);
      const arr = remainingBuckets.get(root) || [];
      arr.push(idx);
      remainingBuckets.set(root, arr);
    }

    for (const [root, idxs] of remainingBuckets.entries()) {
      const sorted = idxs.slice().sort((a, b) => a - b);
      if (sorted.length <= 1) {
        pushSingle(...sorted);
        continue;
      }

      const autoParts = new Set<string>();
      const condoParts = new Set<string>();

      for (const idx of sorted) {
        const autoKey = autoKeyByIdx.get(idx);
        if (autoKey) autoParts.add(autoKey);

        const condoPlan = condoPlansByIdx.get(idx);
        if (condoPlan) {
          for (const key of condoPlan.keys) {
            condoParts.add(`${key.kind}:${key.key}`);
          }
        }
      }

      let id = `single_${root}`;
      if (condoGrouped && condoParts.size) {
        id = `condo_component:${sorted[0]}:${sorted.join("_")}`;
      } else if (autoGrouped && autoParts.size) {
        id = `auto_${Array.from(autoParts).sort().join("__")}`;
      }

      if ((condoGrouped && id.startsWith("condo_") && condoBreakIds.has(id)) || (autoGrouped && id.startsWith("auto_") && autoBreakIds.has(id))) {
        pushSingle(...sorted);
        continue;
      }

      groupItems.push({ id, idxs: sorted });
    }

    // manual groups entram
    for (const [gid, idxs] of manualGroupBuckets.entries()) {
      const s = idxs.slice().sort((a, b) => a - b);
      if (s.length >= 2) groupItems.push({ id: gid, idxs: s });
      else pushSingle(...s);
    }

    // singles
    for (const idx of singles.sort((a, b) => a - b)) {
      groupItems.push({ id: `single_${idx}`, idxs: [idx] });
    }

    // ordenar por sequence num
    function seqNumOf(i: number) {
      const v = rows[i]?.sequence;
      const n = Number(String(v ?? "").replace(/[^\d]/g, ""));
      return Number.isFinite(n) ? n : i + 1;
    }
    groupItems.sort(
      (ga, gb) =>
        Math.min(...ga.idxs.map(seqNumOf)) -
        Math.min(...gb.idxs.map(seqNumOf))
    );

    return groupItems.map((g) => {
      const idxs = g.idxs;

      const seqs = idxs
        .map((i) => String(rows[i]?.sequence ?? "").trim())
        .filter(Boolean);
      const sequenceText = seqs.join(", ");

      const baseIdx = getGroupBaseIdx(idxs);

      // ✅ lista de endereços no grupo (se diferirem)
      const addrList = idxs
        .map((i) => getShownAddress(i).trim())
        .filter(Boolean);
      const distinct = Array.from(new Set(addrList));

      const addressDisplay =
        distinct.length <= 1 ? (
          <div className="font-medium">{distinct[0] || ""}</div>
        ) : (
          <div className="space-y-1">
            {distinct.slice(0, 3).map((a, k) => (
              <div key={k} className="text-sm">
                • {a}
              </div>
            ))}
            {distinct.length > 3 && (
              <div className="text-xs text-slate-600">
                + {distinct.length - 3} variações…
              </div>
            )}
          </div>
        );

      const addressForExport = getExportAddress(baseIdx);

      const bairro = String(rows[baseIdx]?.bairro || "");
      const city = String(rows[baseIdx]?.city || "");
      const cep =
        String(rows[baseIdx]?.cep || "") ||
        extractCepFromText(addressForExport) ||
        extractCepFromText(String(rows[baseIdx]?.original || ""));

      const m = manualEdits[baseIdx];
      const lat = typeof m?.lat === "number" ? m.lat : rows[baseIdx]?.lat ?? null;
      const lng = typeof m?.lng === "number" ? m.lng : rows[baseIdx]?.lng ?? null;

      const statuses = idxs.map(getRowStatus);

      const status: Status = statuses.includes("CONFIRMADO")
        ? "CONFIRMADO"
        : statuses.includes("MANUAL")
          ? "MANUAL"
          : statuses.includes("OK")
            ? "OK"
            : statuses.includes("PARCIAL")
              ? "PARCIAL"
              : "NAO_ENCONTRADO";

      const statusLabel = getVisualStatusLabel(status, idxs);

      return {
        id: g.id,
        idxs,
        sequenceText,
        status,
        statusLabel,
        addressDisplay,
        addressForExport,
        bairro,
        city,
        cep,
        lat,
        lng,
        notes: getGroupObservation(baseIdx, idxs),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, manualEdits, manualGroups, autoGrouped, autoBreakIds, condoGrouped, condoBreakIds]);

  const overviewMapPoints = useMemo(() => {
    return groupedRows
      .filter(
        (g) =>
          typeof g.lat === "number" &&
          Number.isFinite(g.lat) &&
          typeof g.lng === "number" &&
          Number.isFinite(g.lng),
      )
      .map((g) => ({
        id: g.id,
        baseIdx: getGroupBaseIdx(g.idxs),
        sequenceText: g.sequenceText,
        address: g.addressForExport,
        status: g.status,
        statusLabel: g.statusLabel,
        lat: g.lat as number,
        lng: g.lng as number,
      }));
  }, [groupedRows]);

  const exportSummary = useMemo(() => {
    const summary = {
      total: groupedRows.length,
      ok: 0,
      partial: 0,
      manual: 0,
      notFound: 0,
      grouped: 0,
    };

    for (const group of groupedRows) {
      if (group.idxs.length > 1) summary.grouped += 1;

      if (group.status === "CONFIRMADO" || group.status === "OK") summary.ok += 1;
      else if (group.status === "PARCIAL") summary.partial += 1;
      else if (group.status === "MANUAL") summary.manual += 1;
      else summary.notFound += 1;
    }

    return summary;
  }, [groupedRows]);

  const summaryPercent = (value: number) =>
    exportSummary.total ? (value / exportSummary.total) * 100 : 0;
  const summaryPercentText = (value: number) => {
    const percent = summaryPercent(value);
    const hasDecimal = Math.round(percent * 10) % 10 !== 0;
    const formatted = percent.toLocaleString("pt-BR", {
      minimumFractionDigits: hasDecimal ? 1 : 0,
      maximumFractionDigits: 1,
    });
    return `${formatted}% do total`;
  };

  const overviewSelectedPoint = useMemo(() => {
    if (!overviewSelectedGroupId) return null;
    return overviewMapPoints.find((point) => point.id === overviewSelectedGroupId) || null;
  }, [overviewMapPoints, overviewSelectedGroupId]);

  const overviewSelectedGroup = useMemo(() => {
    if (!overviewSelectedGroupId) return null;
    return groupedRows.find((group) => group.id === overviewSelectedGroupId) || null;
  }, [groupedRows, overviewSelectedGroupId]);
  const contextTargetGroup = useMemo(() => {
    if (!ctx.groupId) return null;
    return groupedRows.find((group) => group.id === ctx.groupId) || null;
  }, [ctx.groupId, groupedRows]);

  useEffect(() => {
    overviewSelectedPointRef.current = overviewSelectedPoint
      ? { lat: overviewSelectedPoint.lat, lng: overviewSelectedPoint.lng }
      : null;
  }, [overviewSelectedPoint]);

  useEffect(() => {
    overviewMoveDraftRef.current = overviewMoveDraft;
  }, [overviewMoveDraft]);

  function syncOverviewCardPosition(point?: { lat: number; lng: number } | null) {
    const map = overviewHereMap.current;
    if (!map || !point) {
      setOverviewCardPosition(null);
      return;
    }

    try {
      const screen = map.geoToScreen({ lat: point.lat, lng: point.lng });
      const viewport = map.getViewPort();
      const width = viewport?.element?.clientWidth || 0;
      const left = Math.max(12, Math.min((screen?.x ?? 0) - 180, Math.max(12, width - 372)));
      const top = Math.max(76, (screen?.y ?? 0) - 16);

      setOverviewCardPosition({ left, top });
    } catch {
      setOverviewCardPosition(null);
    }
  }

  function buildOverviewMarkerIcon(isConfirmed: boolean) {
    const fill = isConfirmed ? "#16a34a" : "#2563eb";
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
        <path d="M14 35s10-9.2 10-19A10 10 0 1 0 4 16c0 9.8 10 19 10 19Z" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
        <circle cx="14" cy="16" r="4" fill="#ffffff"/>
      </svg>
    `;
    const H = (window as any).H;
    return new H.map.Icon(
      `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      {
        size: { w: 28, h: 36 },
        anchor: { x: 14, y: 36 },
      }
    );
  }

  function openNotesEditorForGroup(groupId: string) {
    const group = groupedRows.find((g) => g.id === groupId);
    if (!group) return;

    openNotesEditor(group.idxs[0]);
    setCtx({ open: false, x: 0, y: 0, groupId: null });
  }

  // ===== Import =====
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return alert("Selecione uma planilha");
    if (access && !access.canStartRoute) {
      router.replace("/planos");
      return;
    }

    setLoading(true);
    setManualEdits({});
    setManualGroups({});
    setAutoGrouped(false);
    setAutoBreakIds(new Set());
    setCondoGrouped(false);
    setCondoBreakIds(new Set());
    setGroupMode(false);
    setSelectedIdxs(new Set());
    setIsExportOpen(false);
    setExportDraft([]);
    setJobProgress(null);
    setHistoryName(file.name);

    try {
      const formData = new FormData();
      formData.append("file", file);
      // 1) IMPORTA a planilha (só lê e padroniza)
      const resImport = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });
      const dataImport = await resImport.json();

      if (!resImport.ok) {
        if (dataImport?.code === "DUPLICATE_IMPORT_FILE") {
          setLoading(false);
          setJobProgress(null);
          setIsExportOpen(false);
          setDuplicateImportModalOpen(true);
          return;
        }

        alert(dataImport?.error || "Erro no import");
        return;
      }
      // 🔒 garante que o import trouxe linhas válidas
      if (!Array.isArray(dataImport?.rows) || dataImport.rows.length === 0) {
        alert("Import veio vazio (rows). Verifique a planilha/colunas.");
        return;
      }
     // 2) PROCESSA (Gemini + HERE + ArcGIS)
// ✅ pega o jobId que veio do /api/import (ajusta automático pra vários formatos)
const jobId =
  dataImport?.jobId ||
  dataImport?.job?.id ||
  dataImport?.importJobId ||
  dataImport?.importJob?.id ||
  "";
setHistoryId(jobId);
if (jobId) {
  writePendingRouteJobId(jobId);
}
if (jobId) {
  window.history.replaceState({}, "", `/?job=${encodeURIComponent(jobId)}`);
}
const resProcess = await fetch("/api/process", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rows: dataImport.rows,
    jobId, // ✅ ESSA É A PARTE QUE FAZ O ADMIN ATUALIZAR
  }),
});

const dataProcess = await resProcess.json();

if (!resProcess.ok) {
  alert(dataProcess?.error || "Erro no processamento");
  return;
}


      setRows(dataProcess.rows || []);
      setView("results");

if (jobId) {
  if (!Array.isArray(dataProcess?.rows) || dataProcess.rows.length === 0) {
  } else {
    const updatedAtMs = Date.now();
    lastWorkspaceUpdatedAtRef.current = updatedAtMs;
    updateHistoryDb(jobId, {
      version: 1,
      manualEdits,
      manualGroups,
      autoGrouped,
      autoBreakIds: Array.from(autoBreakIds),
      condoGrouped,
      condoBreakIds: Array.from(condoBreakIds),
      name: file?.name || "Planilha sem nome",
      updatedAtMs,
    }).catch(() => {});
  }
}
    } finally {
      setLoading(false);
    }
  }

  // ===== Export review =====
  function openExportReview() {
    const draft: ExportDraftRow[] = groupedRows.map((g) => {
      const baseIdx = getGroupBaseIdx(g.idxs);

      const obsBase = `${g.sequenceText} - ${getShownAddress(baseIdx)}`.trim();
      const obsGroup = String(g.notes || "").trim();
      const obsInicial = obsGroup ? `${obsBase} | ${obsGroup}`.trim() : obsBase;

      return {
        groupId: g.id,
        baseIdx,

        sequence: g.sequenceText,

        // endereço que vai no CSV (se tiver manual, usa manual; senão original)
        addressRef: g.addressForExport,
        addressOriginal: getShownAddress(baseIdx),

        lat: g.lat,
        lng: g.lng,

        // mantém (você ainda consegue editar na tela)
        quadra: getRowQuadra(baseIdx),
        lote: getRowLote(baseIdx),

        // ✅ mantém texto base e acrescenta observação automática/manual no final
        complemento: obsInicial,
      };
    });

    setExportDraft(draft);
    setIsExportOpen(true);
  }

  async function confirmExportCircuit() {
    const rowsToExport = exportDraft.map((r) => {
      // ✅ usa exatamente o que você editou na tela
      const obsFinal = String(r.complemento || "").trim();

      return {
        sequence: r.sequence,

        // Circuit → coluna Address
        // sempre endereço ORIGINAL do Excel
        address: r.addressOriginal ?? r.addressRef,

        // manter original fiel
        original: r.addressOriginal ?? r.addressRef,

        lat: r.lat,
        lng: r.lng,

        // Observações = exatamente o que foi editado
        notes: obsFinal,
      };
    });

    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rowsToExport }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      alert(`Falha ao exportar: ${res.status}\n${t}`);
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // pega nome original do arquivo (prioridade: arquivo atual -> histórico -> fallback)
const sourceName = (file?.name || historyName || "Planilha").trim();

// remove extensão
const baseName = sourceName.replace(/\.(xlsx|xls|csv)$/i, "").trim();

// extrai data dd-mm-aaaa em qualquer lugar do nome (não só no começo)
const dateMatch = baseName.match(/\b\d{2}-\d{2}-\d{4}\b/);
const extractedDate = dateMatch ? dateMatch[0] : "";

// remove a data do nome (onde estiver) pra sobrar só o nome da pessoa
const personName = baseName
  .replace(/\b\d{2}-\d{2}-\d{4}\b/g, "")
  .replace(/\s+/g, " ")
  .trim();

a.download = extractedDate
  ? `${extractedDate} PlanilhaConfirmada - ${personName || "Planilha"}.csv`
  : `PlanilhaConfirmada - ${personName || "Planilha"}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    setIsExportOpen(false);
    clearPendingRouteJobId();
  }

  // ===== agrupamento manual =====
 function enterGroupModeWithFirst(idx: number, targetGroupId?: string) {
  setGroupMode(true);

  // ✅ se você clicou em "Adicionar" num grupo manual, ele vira o alvo
  if (targetGroupId) {
    setMergeTargetGroupId(targetGroupId);
    setSelectedIdxs(new Set()); // começa vazio, você vai selecionar os itens a adicionar
    return;
  }

  // ✅ se for um item solto, o comportamento antigo continua
  setMergeTargetGroupId(null);
  setSelectedIdxs(new Set([idx]));
}
function toggleSelectMany(idxs: number[]) {
  setSelectedIdxs((prev) => {
    const next = new Set(prev);
    const allSelected = idxs.every((i) => next.has(i));

    if (allSelected) idxs.forEach((i) => next.delete(i));
    else idxs.forEach((i) => next.add(i));

    return next;
  });
}
  function toggleSelectIdx(idx: number) {
    setSelectedIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function cancelGroupMode() {
  setGroupMode(false);
  setSelectedIdxs(new Set());
  setMergeTargetGroupId(null);
}

  function unifySelected() {
  const idxs = Array.from(selectedIdxs).sort((a, b) => a - b);

  if (idxs.length < 1) {
    alert("Selecione pelo menos 1 linha.");
    return;
  }

  // garante objeto
  const currentManual = manualGroups || {};
  const nextGroups: Record<string, number[]> = JSON.parse(JSON.stringify(currentManual));

  // remove idx de todos os grupos manuais
  const removeFromAllGroups = (idxx: number) => {
    for (const gid of Object.keys(nextGroups)) {
      nextGroups[gid] = (nextGroups[gid] || []).filter((x) => x !== idxx);
      if (nextGroups[gid].length === 0) delete nextGroups[gid];
    }
  };

  // ✅ Se você clicou em "Adicionar mais linhas neste grupo"
  if (mergeTargetGroupId) {
    const target = mergeTargetGroupId;

    // se o grupo alvo veio do auto_ e ainda não existe nos manuais, materializa ele
    if (!nextGroups[target]) {
      const autoGroup = groupedRows.find((g) => g.id === target);
      nextGroups[target] = autoGroup ? autoGroup.idxs.slice() : [];
    }

    for (const idxx of idxs) {
      removeFromAllGroups(idxx);
      if (!nextGroups[target].includes(idxx)) nextGroups[target].push(idxx);
    }

    nextGroups[target].sort((a, b) => a - b);

    setManualGroups(nextGroups);
    setSelectedIdxs(new Set());
    setMergeTargetGroupId(null);
    setGroupMode(false);
    return;
  }

  // fluxo normal: criar um novo grupo manual juntando 2+ itens
  if (idxs.length < 2) {
    alert("Selecione pelo menos 2 linhas para unificar.");
    return;
  }

  // remove os selecionados de qualquer grupo anterior antes de criar o novo
  for (const idxx of idxs) removeFromAllGroups(idxx);

  const newId = "manual_" + Date.now();
  nextGroups[newId] = idxs.slice().sort((a, b) => a - b);

  setManualGroups(nextGroups);
  setSelectedIdxs(new Set());
  setGroupMode(false);
}

  // ===== desagrupar via botão direito =====
  function ungroup(groupId: string) {
    if (groupId.startsWith("auto_") && !manualGroups[groupId]) {
  setAutoBreakIds((prev) => new Set(prev).add(groupId));
  return;
}
    if (groupId.startsWith("condo_") && !manualGroups[groupId]) {
      setCondoBreakIds((prev) => new Set(prev).add(groupId));
      return;
    }
    if (manualGroups[groupId]) {
      const next = { ...manualGroups };
      delete next[groupId];
      setManualGroups(next);
    }
  }
function signalReview(groupId: string) {
  const g = groupedRows.find((x) => x.id === groupId)
  if (!g) return

  setManualEdits((prev) => {
    const next = { ...prev }
    for (const idx of g.idxs) {
      const cur = next[idx] || ({} as any)
      next[idx] = { ...cur, review: true }
    }
    return next
  })
}

function clearReview(groupId: string) {
  const g = groupedRows.find((x) => x.id === groupId)
  if (!g) return

  setManualEdits((prev) => {
    const next = { ...prev }
    for (const idx of g.idxs) {
      if (!next[idx]) continue
      next[idx] = { ...next[idx], review: false }
    }
    return next
  })
}
  // ===== modal mapa =====
  function openManualModalForIdx(idx: number) {
    const original = String(rows[idx]?.original || "");
    const current = getShownAddress(idx);

    setModalIdx(idx);
    setModalOriginal(original);
    setModalValue(current);

    const cepRow =
      String((rows[idx] as any)?.cep || "") ||
      extractCepFromText(current) ||
      extractCepFromText(original);
    setModalCep(cepRow);

    setPickedLabel("");
    setPickedCep("");
    setPickedQuadra(String(manualEdits[idx]?.quadra || getRowQuadra(idx) || ""));
    setPickedLote(String(manualEdits[idx]?.lote || getRowLote(idx) || ""));
    setManualMapProvider(getInitialManualMapProvider(rows[idx]?.city));
    const manual = manualEdits[idx];
    const baseLat = manual?.lat ?? rows[idx]?.lat ?? null;
    const baseLng = manual?.lng ?? rows[idx]?.lng ?? null;

    if (typeof baseLat === "number" && typeof baseLng === "number")
      setPinLatLng({ lat: baseLat, lng: baseLng });
    else setPinLatLng(null);

    // reset autosuggest
    setSuggestOpen(false);
    setSuggestItems([]);
    setSuggestActive(-1);
    setGoogleSearchMessage("");
    setGoogleSearchQuery("");
    setGoogleSearchResults([]);
    setGoogleSearchLoading(false);

    setIsModalOpen(true);
  }

  function closeManualModal() {
    setIsModalOpen(false);
    setModalIdx(null);
    setSuggestOpen(false);
    setSuggestItems([]);
    setSuggestActive(-1);
    setGoogleSearchMessage("");
    setGoogleSearchQuery("");
    setGoogleSearchResults([]);
    setGoogleSearchLoading(false);
  }

  async function applyConfirmedCoordToIdxs(args: {
    idxsToApply: number[];
    coord: { lat: number; lng: number };
    afterConfirm?: () => void;
  }) {
    setManualEdits((prev) => {
      const next = { ...prev };
      for (const idx of args.idxsToApply) {
        const current = prev[idx] || {};
        next[idx] = {
          ...current,
          lat: args.coord.lat,
          lng: args.coord.lng,
          confirmed: true,
        };
      }
      return next;
    });

    setRows((prev) => {
      const next = [...prev];
      for (const idx of args.idxsToApply) {
        const r = next[idx];
        if (!r) continue;
        next[idx] = { ...r, lat: args.coord.lat, lng: args.coord.lng, status: "CONFIRMADO" };
      }
      return next;
    });

    args.afterConfirm?.();

    try {
      const snapshot = args.idxsToApply
        .map((idx) => rows[idx])
        .filter(Boolean) as Array<{ original?: string; city?: string }>;

      const seen = new Set<string>();

      function makeBaseAddress(addr: string) {
        return addr
          .replace(/\b(APTO|APT|APARTAMENTO)\b\s*[-:]?\s*[\w\/\-\.]+/gi, " ")
          .replace(/\b(BLOCO|BL)\b\s*[-:]?\s*[\w\/\-\.]+/gi, " ")
          .replace(/\b(TORRE)\b\s*[-:]?\s*[\w\/\-\.]+/gi, " ")
          .replace(/\b(EDIFICIO|EDIF\.?)\b\s*[-:]?\s*[^,]+/gi, " ")
          .replace(/\b(CONDOMINIO|COND\.?)\b\s*[-:]?\s*[^,]+/gi, " ")
          .replace(/\b(RESIDENCIAL|RES\.)\b\s*[-:]?\s*[^,]+/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function save(address: string, city: string) {
        const key = `${address}||${city}`.toUpperCase();
        if (seen.has(key)) return;
        seen.add(key);

        return fetch("/api/address-memory", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            address,
            city,
            lat: args.coord.lat,
            lng: args.coord.lng,
            jobId: historyId || jobId || undefined,
            createdBy: null,
          }),
        })
          .then(async (response) => {
            if (!response.ok) {
              let errorText = "";
              try {
                const contentType = response.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                  const data = await response.json().catch(() => null);
                  errorText = data ? JSON.stringify(data) : "";
                } else {
                  errorText = await response.text();
                }
              } catch {}

              console.error("Falha ao salvar AddressMemory", {
                address,
                city,
                status: response.status,
                body: errorText,
              });
            }

            return response;
          })
          .catch((error) => {
            console.error("Falha ao salvar AddressMemory (rede)", {
              address,
              city,
              error,
            });
          });
      }

      const tasks: Array<Promise<any> | undefined> = [];
      for (const r of snapshot) {
        const full = String(r.original || "").trim();
        const city = String(r.city || "").trim();
        if (!full) continue;

        const primaryTask = save(full, city);
        tasks.push(primaryTask);

        const base = makeBaseAddress(full);
        if (base && base.length >= 6 && base.toUpperCase() !== full.toUpperCase()) {
          tasks.push(save(base, city));
        }
      }

      void Promise.allSettled(tasks.filter(Boolean) as Promise<any>[]);
    } catch {
      // silencioso para nao bloquear a UI
    }
  }

  async function applyConfirmedCoordToGroup(args: {
    baseIdx: number;
    coord: { lat: number; lng: number };
    groupId?: string | null;
    afterConfirm?: () => void;
  }) {
    const targetGroup =
      (args.groupId ? groupedRows.find((g) => g.id === args.groupId) : null) ||
      groupedRows.find((g) => Array.isArray(g.idxs) && g.idxs.includes(args.baseIdx)) ||
      null;

    const idxsToApply = targetGroup?.idxs?.length ? targetGroup.idxs : [args.baseIdx];

    await applyConfirmedCoordToIdxs({
      idxsToApply,
      coord: args.coord,
      afterConfirm: args.afterConfirm,
    });
  }

async function confirmManualModal() {
    if (modalIdx == null) return;

    // ✅ coord final: se não mexeu no pino, usa a coord atual da linha
    const row = rows[modalIdx];
    const coord =
      pinLatLng && typeof pinLatLng.lat === "number" && typeof pinLatLng.lng === "number"
        ? pinLatLng
        : row && typeof row.lat === "number" && typeof row.lng === "number"
          ? { lat: row.lat, lng: row.lng }
          : null;

    if (!coord) {
  alert("Selecione uma coordenada válida no mapa.");
  return;
}

const rowCity = String(row?.city || "").trim();
const sameCoordAsRow =
  typeof row?.lat === "number" &&
  typeof row?.lng === "number" &&
  Number(row.lat).toFixed(6) === Number(coord.lat).toFixed(6) &&
  Number(row.lng).toFixed(6) === Number(coord.lng).toFixed(6);
const hasPickedLabel = !!String(pickedLabel || "").trim();

// ✅ dispara em segundo plano, sem travar o confirmar
if (isAparecidaCity(rowCity)) {
  fetchQuadraLote(coord.lat, coord.lng).catch(() => {});
}

if (!hasPickedLabel && !sameCoordAsRow) {
  reverseGeocodeServer(coord.lat, coord.lng).catch(() => {});
}

    if (typeof window !== "undefined" && tutorialMapStartedRef.current) {
      window.localStorage.setItem(TUTORIAL_MAP_CONFIRMED_KEY, "true");
      setTutorialExportFinalRequestedAt(Date.now());
    }

     await applyConfirmedCoordToGroup({
       baseIdx: modalIdx,
       coord,
       afterConfirm: closeManualModal,
    });
  }

  function confirmOverviewSelectedPoint() {
    if (!overviewSelectedPoint) return;
    if (overviewSelectedPoint.status === "CONFIRMADO") return;

    void applyConfirmedCoordToGroup({
      baseIdx: overviewSelectedPoint.baseIdx,
      groupId: overviewSelectedPoint.id,
      coord: {
        lat: overviewSelectedPoint.lat,
        lng: overviewSelectedPoint.lng,
      },
      afterConfirm: () => setOverviewSelectedGroupId(null),
    });
  }

  function startOverviewMoveMode() {
    if (!overviewSelectedPoint || !overviewSelectedGroup) return;
    if (overviewSelectedGroup.idxs.length !== 1) return;

    setOverviewMoveDraft({
      groupId: overviewSelectedPoint.id,
      baseIdx: overviewSelectedPoint.baseIdx,
      coord: {
        lat: overviewSelectedPoint.lat,
        lng: overviewSelectedPoint.lng,
      },
    });
  }

  function cancelOverviewMoveMode() {
    setOverviewMoveDraft(null);
  }

  function saveOverviewMoveDraft() {
    if (!overviewMoveDraft) return;

    void applyConfirmedCoordToIdxs({
      idxsToApply: [overviewMoveDraft.baseIdx],
      coord: overviewMoveDraft.coord,
      afterConfirm: () => {
        setOverviewMoveDraft(null);
      },
    });
  }

  async function reverseGeocodeServer(lat: number, lng: number) {
  // ✅ arredonda pra evitar chamadas repetidas em pontos quase iguais
  const latKey = Number(lat).toFixed(6);
  const lngKey = Number(lng).toFixed(6);
  const cacheKey = `${latKey},${lngKey}`;

  // ✅ usa cache se já buscou esse ponto
  const cached = reverseCacheRef.current.get(cacheKey);
  if (cached) {
    const label = cached?.label || cached?.address?.label || "";
    const cepFound = cached?.address?.cep || cached?.address?.postalCode || "";

    setPickedLabel(label);
    setPickedCep(cepFound);
    if (!modalCep && cepFound) setModalCep(cepFound);
    return;
  }

  if (abortReverseRef.current) abortReverseRef.current.abort();
  const ac = new AbortController();
  abortReverseRef.current = ac;

  const res = await fetch(`/api/reverse?lat=${lat}&lng=${lng}`, {
    signal: ac.signal,
  }).catch(() => null);

  if (!res || !res.ok) return;

  const data = await res.json().catch(() => null);
  if (!data) return;

  // ✅ salva no cache
  reverseCacheRef.current.set(cacheKey, data);

  const label = data?.label || data?.address?.label || "";
  const cepFound = data?.address?.cep || data?.address?.postalCode || "";

  setPickedLabel(label);
  setPickedCep(cepFound);
  if (!modalCep && cepFound) setModalCep(cepFound);
}

  async function fetchQuadraLote(lat: number, lng: number) {
  try {
    // ✅ arredonda pra evitar chamadas repetidas
    const latKey = Number(lat).toFixed(5);
    const lngKey = Number(lng).toFixed(5);
    const cacheKey = `${latKey},${lngKey}`;

    // ✅ usa cache se já tiver
    const cached = quadraCacheRef.current.get(cacheKey);
    if (cached) {
      const q = String(cached?.quadra || "");
      const l = String(cached?.lote || "");

      setPickedQuadra(q);
      setPickedLote(l);

      if (modalIdx !== null) {
        setManualEdits((prev) => ({
          ...prev,
          [modalIdx]: {
            ...prev[modalIdx],
            lat: pinLatLng?.lat,
            lng: pinLatLng?.lng,
            quadra: q,
            lote: l,
          },
        }));
      }

      return;
    }

    if (abortLotRef.current) abortLotRef.current.abort();
    const ac = new AbortController();
    abortLotRef.current = ac;

    const res = await fetch(`/api/aparecida/lote?lat=${lat}&lng=${lng}`, {
      signal: ac.signal,
    });

    if (!res || !res.ok) return;

    const data = await res.json().catch(() => null);
    if (!data) return;

    // ✅ salva no cache
    quadraCacheRef.current.set(cacheKey, data);

    const q = String(data?.quadra || "");
    const l = String(data?.lote || "");

    setPickedQuadra(q);
    setPickedLote(l);

    if (modalIdx !== null) {
      setManualEdits((prev) => ({
        ...prev,
        [modalIdx]: {
          ...prev[modalIdx],
          lat: pinLatLng?.lat,
          lng: pinLatLng?.lng,
          quadra: q,
          lote: l,
        },
      }));
    }
  } catch (err) {
    console.error("Erro ao buscar quadra/lote", err);
  }
}

  // ===== overlay helpers =====
  function rectVal(r: any, fn: string, prop: string) {
    const v1 = typeof r?.[fn] === "function" ? r[fn]() : undefined;
    const v2 = r?.[prop];
    const v = v1 ?? v2;
    return typeof v === "number" ? v : Number(v);
  }

  function getMapBBox() {
    const map = hereMap.current;
    if (!map) return null;

    try {
      // usa o container real do React (mais confiável)
      const el = mapRef.current;
      const rect = el?.getBoundingClientRect?.();
      const w = Math.floor(rect?.width || 0);
      const h = Math.floor(rect?.height || 0);

      if (!w || !h) return null;

      const tl = map.screenToGeo(0, 0);
      const tr = map.screenToGeo(w, 0);
      const bl = map.screenToGeo(0, h);
      const br = map.screenToGeo(w, h);

      const lats = [tl.lat, tr.lat, bl.lat, br.lat];
      const lngs = [tl.lng, tr.lng, bl.lng, br.lng];

      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return null;

      return { minLat, maxLat, minLng, maxLng };
    } catch {
      return null;
    }
  }
  


    function runHereSearch(forceQ?: string) {
      const idx = modalIdx ?? 0;

      let q = buildHereSearchQuery(forceQ ?? modalValue);
      if (!q) return;

      const at = pinLatLng ? `${pinLatLng.lat},${pinLatLng.lng}` : "-16.8233,-49.2439";

      // ✅ chave do cache
      const cacheKey = `${q}__${at}`.toUpperCase();

      // ✅ usa cache se já buscou isso antes
      const cached = geocodeCacheRef.current.get(cacheKey);
      if (cached?.position) {
        const pos = cached.position;
        const label = cached?.address?.label || cached?.title || "";
        const cepFound = cached?.address?.postalCode || "";
        setPinLatLng({ lat: pos.lat, lng: pos.lng });
        if (hereMap.current) {
          hereMap.current.setCenter(pos);
          hereMap.current.setZoom(17);
        }
        if (markerRef.current) markerRef.current.setGeometry(pos);
        setPickedLabel(label);
        setPickedCep(cepFound);
        if (!modalCep && cepFound) setModalCep(cepFound);
        return;
      }

      const apiKey = (process.env.NEXT_PUBLIC_HERE_API_KEY || "").trim();
      if (!apiKey) return;

      const url = new URL("https://geocode.search.hereapi.com/v1/geocode");
      url.searchParams.set("q", q);
      url.searchParams.set("at", at);
      url.searchParams.set("lang", "pt-BR");
      url.searchParams.set("in", "countryCode:BRA");
      url.searchParams.set("apiKey", apiKey);

      fetch(url.toString())
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const item = Array.isArray(data?.items) ? data.items[0] : null;
          if (!item?.position) return;

          geocodeCacheRef.current.set(cacheKey, item);

          const pos = item.position;
          setPinLatLng({ lat: pos.lat, lng: pos.lng });
          if (hereMap.current) {
            hereMap.current.setCenter(pos);
            hereMap.current.setZoom(17);
          }
          if (markerRef.current) markerRef.current.setGeometry(pos);

          const label = item?.address?.label || item?.title || "";
          const cepFound = item?.address?.postalCode || "";
          setPickedLabel(label);
          setPickedCep(cepFound);
          if (!modalCep && cepFound) setModalCep(cepFound);
        })
        .catch(() => {});
    }

  async function fetchSuggest(qRaw: string) {
  const apiKey = (process.env.NEXT_PUBLIC_HERE_API_KEY || "").trim();
  if (!apiKey) return;

  const qTrim = qRaw.trim();

  // 🔒 bloqueia busca curta
  if (qTrim.length < 4) {
    setSuggestItems([]);
    setSuggestActive(-1);
    return;
  }

  if (suggestAbortRef.current) suggestAbortRef.current.abort();
  const ac = new AbortController();
  suggestAbortRef.current = ac;

  try {
    setSuggestLoading(true);

    const idx = modalIdx ?? 0;

    const at =
      pinLatLng
        ? `${pinLatLng.lat},${pinLatLng.lng}`
        : rows?.[idx]?.lat && rows?.[idx]?.lng
        ? `${rows[idx].lat},${rows[idx].lng}`
        : "-16.8233,-49.2439";

    const url = new URL("https://autosuggest.search.hereapi.com/v1/autosuggest");
    url.searchParams.set("q", qTrim);
    url.searchParams.set("at", at);
    url.searchParams.set("lang", "pt-BR");
    url.searchParams.set("limit", "6");
    url.searchParams.set("in", "countryCode:BRA");
    url.searchParams.set("apiKey", apiKey);

    const res = await fetch(url.toString(), { signal: ac.signal });

    if (!res.ok) {
      setSuggestItems([]);
      setSuggestActive(-1);
      return;
    }

    const data = await res.json().catch(() => null);

    const items: HereSuggestItem[] = Array.isArray(data?.items)
      ? data.items.filter((it: any) => {
          const rt = String(it?.resultType || "");
          if (rt === "categoryQuery" || rt === "chainQuery") return false;
          return Boolean(it?.address?.label || it?.title);
        })
      : [];

    setSuggestItems(items);
    setSuggestActive(items.length ? 0 : -1);
  } catch {
    setSuggestItems([]);
    setSuggestActive(-1);
  } finally {
    setSuggestLoading(false);
  }
}

   function scheduleSuggest(q: string) {
  if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);

  const qTrim = q.trim();

  // 🔒 NÃO chama API com texto pequeno
  if (qTrim.length < 4) {
    setSuggestItems([]);
    setSuggestActive(-1);
    return;
  }

  // ⏳ aumenta tempo pra reduzir chamadas
  suggestTimerRef.current = setTimeout(() => {
    fetchSuggest(qTrim);
  }, 700);
}

    function selectSuggestItem(item: HereSuggestItem) {
  const label = item?.address?.label || item?.title || "";
  if (!label) return;

  setModalValue(label);
  setSuggestOpen(false);
  setSuggestItems([]);
  setSuggestActive(-1);

  if (item.position?.lat && item.position?.lng) {
    if (!hereSuggestMatchesCurrentCity(item)) {
      runHereSearch(label);
      return;
    }

    const pos = { lat: item.position.lat, lng: item.position.lng };
    setPinLatLng(pos);

    if (hereMap.current) {
      hereMap.current.setCenter(pos);
      hereMap.current.setZoom(17);
    }
    if (markerRef.current) markerRef.current.setGeometry(pos);

    const cepFound = item?.address?.postalCode || "";
    setPickedLabel(label);
    if (cepFound) {
      setPickedCep(cepFound);
      if (!modalCep) setModalCep(cepFound);
    }

    // ❌ não chama mais automaticamente aqui
    return;
  }

  runHereSearch(label);
}
    // ===== cria mapa 1 vez =====
    function runGoogleManualSearch() {
      setSuggestOpen(false);
      setSuggestItems([]);
      setSuggestActive(-1);
      setGoogleSearchMessage("");
      setGoogleSearchResults([]);
      setGoogleSearchQuery(modalValue);
      setGoogleSearchRequestId((cur) => cur + 1);
    }

    function handleGoogleSearchResults(results: GoogleSearchResult[]) {
      setGoogleSearchResults(results);
    }

    function selectGoogleSearchResult(result: GoogleSearchResult) {
      setPinLatLng(result.pos);
      setPickedLabel("");
      setGoogleSearchResults([]);
      setGoogleSearchMessage("");
    }

    useEffect(() => {
      if (!isModalOpen || activeMapProvider !== "here" || !mapRef.current) return;

   const H = (window as any).H;
if (!H) return;


      if (hereMap.current) {
        try {
          hereMap.current.dispose();
        } catch { }
        hereMap.current = null;
        markerRef.current = null;
        searchRef.current = null;
      }

      const apiKey = (process.env.NEXT_PUBLIC_HERE_API_KEY || "").trim();
      if (!apiKey) return;

      const platform = new H.service.Platform({ apikey: apiKey });
      searchRef.current = platform.getSearchService();
      const layers = platform.createDefaultLayers();

      const initial = pinLatLng ? { lat: pinLatLng.lat, lng: pinLatLng.lng } : { lat: -16.8233, lng: -49.2439 };

     const map = new H.Map(mapRef.current, layers.vector.normal.map, {
  zoom: pinLatLng ? 17 : 16,
  center: initial,
  pixelRatio: 1,
});

      const behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map));

const ui = H.ui.UI.createDefault(map, layers);
ui.removeControl("mapsettings"); // <- remove o menu que costuma buggar
ui.getControl("mapsettings")?.setDisabled(true);

      hereMap.current = map;
map.getViewModel().addEventListener("sync", () => {
  map.getViewPort().resize();
});

      // ✅ força o HERE Map calcular tamanho real (ESSENCIAL em modal)
      setTimeout(() => map.getViewPort().resize(), 50);
setTimeout(() => map.getViewPort().resize(), 150);
setTimeout(() => map.getViewPort().resize(), 400);
setTimeout(() => map.getViewPort().resize(), 800);

  

      const marker = new H.map.Marker(initial);
      map.addObject(marker);
      markerRef.current = marker;

      const onTap = (evt: any) => {
  try {
    const now = Date.now();

    // 🔒 proteção contra evento incompleto
    const pointer = evt?.currentPointer || evt?.pointer;
    if (!pointer) return;

    const geo = map.screenToGeo(pointer.viewportX, pointer.viewportY);
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return;

    const last = clickGateRef.current;
    const dt = now - last.t;
    const dLat = Math.abs((last.lat || 0) - geo.lat);
    const dLng = Math.abs((last.lng || 0) - geo.lng);
    if (dt < 500 && dLat < 0.00001 && dLng < 0.00001) return;

    clickGateRef.current = { t: now, lat: geo.lat, lng: geo.lng };

    marker.setGeometry(geo);
    setPinLatLng({ lat: geo.lat, lng: geo.lng });

    setSuggestOpen(false);
    setSuggestItems([]);
    setSuggestActive(-1);

    // ✅ marca que o pin veio do clique (evita setCenter em cascata)
    pinFromTapRef.current = true;

    // ❌ não chama mais reverse/quadra-lote ao clicar no mapa
    } catch {
    }
  };

      map.addEventListener("tap", onTap);
      setTimeout(() => map.getViewPort().resize(), 80);

     return () => {
  // limpa listeners
  try {
    map.removeEventListener("tap", onTap);
  } catch {}

  // desativa comportamento
  try {
    behavior.disable();
  } catch {}

  // 🔥 LIMPA UI (ISSO ESTAVA FALTANDO)
  try {
    ui?.dispose?.();
  } catch {}


  // limpa mapa
  try {
    map.dispose();
  } catch {}

  // limpa refs
  hereMap.current = null;
  markerRef.current = null;
  searchRef.current = null;



};
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isModalOpen, activeMapProvider]);
    useEffect(() => {
      if (!isModalOpen) return;
      if (!pinLatLng) return;
      if (!hereMap.current) return;

      // move marcador (se existir)
      if (markerRef.current) {
        markerRef.current.setGeometry(pinLatLng);
      }

      // centraliza mapa
            // centraliza mapa (evita travar quando veio do clique)
      if (!pinFromTapRef.current) {
       
      } else {
        // reseta depois do clique
        pinFromTapRef.current = false;
      }


      // redesenha overlay com debounce

    }, [pinLatLng]);

    useEffect(() => {
      if (!isOverviewMapOpen || !overviewMapRef.current) return;

      const H = (window as any).H;
      if (!H) return;

      if (overviewHereMap.current) {
        try {
          overviewHereMap.current.dispose();
        } catch {}
        overviewHereMap.current = null;
      }

      const apiKey = (process.env.NEXT_PUBLIC_HERE_API_KEY || "").trim();
      if (!apiKey) return;

      const platform = new H.service.Platform({ apikey: apiKey });
      const layers = platform.createDefaultLayers();

      const initial = overviewMapPoints[0]
        ? { lat: overviewMapPoints[0].lat, lng: overviewMapPoints[0].lng }
        : { lat: -16.8233, lng: -49.2439 };

      const map = new H.Map(overviewMapRef.current, layers.vector.normal.map, {
        zoom: overviewMapPoints.length ? 13 : 11,
        center: initial,
        pixelRatio: 1,
      });

      const behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
      const ui = H.ui.UI.createDefault(map, layers);
      ui.removeControl("mapsettings");
      ui.getControl("mapsettings")?.setDisabled(true);

      overviewHereMap.current = map;
      overviewDidFitRef.current = false;

      map.getViewModel().addEventListener("sync", () => {
        map.getViewPort().resize();
      });

      const onMapViewChangeEnd = () => {
        syncOverviewCardPosition(overviewSelectedPointRef.current);
      };

      const onMapTapForMove = (evt: any) => {
        const draft = overviewMoveDraftRef.current;
        if (!draft) return;
        if (evt?.target instanceof H.map.Marker) return;

        const pointer = evt?.currentPointer || evt?.pointer;
        if (!pointer) return;

        const geo = map.screenToGeo(pointer.viewportX, pointer.viewportY);
        if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return;

        setOverviewMoveDraft({
          ...draft,
          coord: { lat: geo.lat, lng: geo.lng },
        });
      };

      map.addEventListener("mapviewchangeend", onMapViewChangeEnd);
      map.addEventListener("tap", onMapTapForMove);

      setTimeout(() => map.getViewPort().resize(), 50);
      setTimeout(() => map.getViewPort().resize(), 150);
      setTimeout(() => map.getViewPort().resize(), 400);

      return () => {
        if (overviewMarkersGroupRef.current) {
          try {
            map.removeObject(overviewMarkersGroupRef.current);
          } catch {}
          overviewMarkersGroupRef.current = null;
        }

        try {
          map.removeEventListener("mapviewchangeend", onMapViewChangeEnd);
        } catch {}

        try {
          map.removeEventListener("tap", onMapTapForMove);
        } catch {}

        try {
          behavior.disable();
        } catch {}

        try {
          ui?.dispose?.();
        } catch {}

        try {
          map.dispose();
        } catch {}

        overviewHereMap.current = null;
        overviewDidFitRef.current = false;
      };
    }, [isOverviewMapOpen]);

    useEffect(() => {
      if (!isOverviewMapOpen) return;

      const H = (window as any).H;
      const map = overviewHereMap.current;
      if (!H || !map) return;

      if (overviewMarkersGroupRef.current) {
        try {
          map.removeObject(overviewMarkersGroupRef.current);
        } catch {}
        overviewMarkersGroupRef.current = null;
      }

      const group = new H.map.Group();

      const onTap = (evt: any) => {
        const target = evt.target;
        const groupId = target?.getData?.();
        if (!groupId) return;
        const point = overviewMapPoints.find((item) => item.id === groupId) || null;
        setOverviewSelectedGroupId(groupId);
        syncOverviewCardPosition(point);
      };

      for (const point of overviewMapPoints) {
        const markerPosition =
          overviewMoveDraft?.groupId === point.id
            ? overviewMoveDraft.coord
            : { lat: point.lat, lng: point.lng };

        const marker = new H.map.Marker(
          markerPosition,
          { icon: buildOverviewMarkerIcon(point.status === "CONFIRMADO") }
        );
        marker.setData(point.id);
        group.addObject(marker);
      }

      group.addEventListener("tap", onTap);
      map.addObject(group);
      overviewMarkersGroupRef.current = group;

      const bounds = group.getBoundingBox?.();
      if (bounds && !overviewDidFitRef.current) {
        map.getViewModel().setLookAtData({ bounds });
        overviewDidFitRef.current = true;
      }

      return () => {
        try {
          group.removeEventListener("tap", onTap);
        } catch {}
      };
    }, [isOverviewMapOpen, overviewMapPoints, overviewMoveDraft]);

    useEffect(() => {
      if (!isOverviewMapOpen) {
        setOverviewSelectedGroupId(null);
        setOverviewCardPosition(null);
        setOverviewMoveDraft(null);
        overviewMarkersGroupRef.current = null;
      }
    }, [isOverviewMapOpen]);

    useEffect(() => {
      const pointForCard =
        overviewMoveDraft?.groupId === overviewSelectedPoint?.id
          ? overviewMoveDraft?.coord ?? null
          : overviewSelectedPoint;

      syncOverviewCardPosition(pointForCard);
    }, [overviewSelectedPoint, overviewMoveDraft]);

  useEffect(() => {
    if (view !== "results" || rows.length === 0) {
      tutorialPostStartedRef.current = false;
      return;
    }

    if (tutorialPostStartedRef.current) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(TUTORIAL_ACTIVE_KEY) !== "true") return;

    const pending = window.localStorage.getItem(
      TUTORIAL_PENDING_AFTER_PROCESS_KEY
    );

    if (pending !== "true") return;

    tutorialPostStartedRef.current = true;
    window.localStorage.removeItem(TUTORIAL_PENDING_AFTER_PROCESS_KEY);

    window.setTimeout(() => {
      startPostProcessTutorial();
    }, 250);
  }, [view, rows.length]);

  useEffect(() => {
    if (view !== "upload" || rows.length !== 0) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(TUTORIAL_ACTIVE_KEY) !== "true") return;

    const shouldStart = window.localStorage.getItem(
      TUTORIAL_START_PREPROCESS_KEY
    );

    if (shouldStart !== "true") return;

    const startedAt = Date.now();
    const tryStart = () => {
      const uploadArea = document.querySelector('[data-tour="upload-area"]');

      if (!uploadArea) {
        if (Date.now() - startedAt < 1500) {
          window.setTimeout(tryStart, 80);
        }
        return;
      }

      window.localStorage.removeItem(TUTORIAL_START_PREPROCESS_KEY);
      startPreProcessTutorial();
    };

    window.setTimeout(tryStart, 120);
  }, [view, rows.length]);

  useEffect(() => {
    if (!isModalOpen) {
      tutorialMapStartedRef.current = false;
      return;
    }

    if (tutorialMapStartedRef.current) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(TUTORIAL_ACTIVE_KEY) !== "true") return;

    const pending = window.localStorage.getItem(
      TUTORIAL_PENDING_MAP_REVIEW_KEY
    );

    if (pending !== "true") return;

    tutorialMapStartedRef.current = true;
    window.localStorage.removeItem(TUTORIAL_PENDING_MAP_REVIEW_KEY);
    window.localStorage.removeItem(TUTORIAL_MAP_CONFIRMED_KEY);
    window.localStorage.removeItem(TUTORIAL_PENDING_EXPORT_FINAL_KEY);

    window.setTimeout(() => {
      startMapReviewTutorial();
    }, 250);
  }, [isModalOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleTutorialExportFinalRequest = () => {
      setTutorialExportFinalRequestedAt(Date.now());
    };

    window.addEventListener(
      TUTORIAL_EXPORT_FINAL_EVENT,
      handleTutorialExportFinalRequest
    );

    return () => {
      window.removeEventListener(
        TUTORIAL_EXPORT_FINAL_EVENT,
        handleTutorialExportFinalRequest
      );
    };
  }, []);

  useEffect(() => {
    if (!tutorialExportFinalRequestedAt) return;
    if (isModalOpen) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(TUTORIAL_ACTIVE_KEY) !== "true") return;

    const pendingExport = window.localStorage.getItem(
      TUTORIAL_PENDING_EXPORT_FINAL_KEY
    );
    const confirmed = window.localStorage.getItem(
      TUTORIAL_MAP_CONFIRMED_KEY
    );

    if (pendingExport !== "true" || confirmed !== "true") return;

    const startedAt = Date.now();
    const tryStart = () => {
      const exportButton = document.querySelector('[data-tour="export-button"]');

      if (!exportButton) {
        if (Date.now() - startedAt < 1200) {
          window.setTimeout(tryStart, 80);
        }
        return;
      }

      window.localStorage.removeItem(TUTORIAL_PENDING_EXPORT_FINAL_KEY);
      window.localStorage.removeItem(TUTORIAL_MAP_CONFIRMED_KEY);
      setTutorialExportFinalRequestedAt(0);

      window.setTimeout(() => {
        startFinalExportTutorial();
      }, 120);
    };

    window.setTimeout(tryStart, 150);
}, [isModalOpen, tutorialExportFinalRequestedAt]);

useEffect(() => {
    if (!mounted || accessLoading || accessError || jobId) return;
    if (
      access?.code === "ACCESS_BLOCKED" ||
      (access &&
        !access.canStartRoute &&
        hasHistoryJob === false &&
        hasPendingRoute === false)
    ) {
      router.replace("/planos");
    }
  }, [
    access,
    accessError,
    accessLoading,
    hasHistoryJob,
    hasPendingRoute,
    jobId,
    mounted,
    router,
  ]);

    // ===== UI =====
    if (!mounted) return null;
    if (
      accessLoading ||
      (access &&
        !canUseExistingSystem &&
        (hasHistoryJob === null || hasPendingRoute === null) &&
        !jobId)
    ) {
      return (
        <main className="min-h-screen bg-slate-100">
          <div className="mx-auto max-w-5xl px-4 py-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-600 shadow-sm">
              Carregando acesso da conta...
            </div>
          </div>
        </main>
      );
    }

    if (accessError) {
      return (
        <main className="min-h-screen bg-slate-100">
          <div className="mx-auto max-w-5xl px-4 py-8">
            <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-700 shadow-sm">
              {accessError}
            </div>
          </div>
        </main>
      );
    }

    if (
      !jobId &&
      (access?.code === "ACCESS_BLOCKED" ||
        (access &&
          !access.canStartRoute &&
          hasHistoryJob === false &&
          hasPendingRoute === false))
    ) {
      return (
        <main className="min-h-screen bg-slate-100">
          <div className="mx-auto max-w-5xl px-4 py-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-600 shadow-sm">
              Redirecionando para Minha assinatura...
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="min-h-screen bg-transparent">
        {shouldShowPendingRouteBanner && pendingRouteJob && (
          <div className="mx-auto w-full max-w-5xl px-4 pt-4">
            <div className="flex flex-col gap-3 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-amber-900">
                  Olá, você ainda tem uma rota pendente de roteirização. Clique aqui para terminar.
                </div>
                <div className="mt-1 text-xs text-amber-800">
                  {pendingRouteJob.name}
                </div>
              </div>

              <button
                type="button"
                onClick={() => router.push(`/?job=${encodeURIComponent(pendingRouteJob.id)}`)}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-amber-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!pendingRouteJob?.id) return;
                  writePendingRouteDismissedJobId(pendingRouteJob.id);
                  setPendingRouteDismissedJobId(pendingRouteJob.id);
                }}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100"
              >
                Agora não
              </button>
            </div>
          </div>
        )}

        <div className="w-full px-0 sm:px-4 md:px-6 py-2 md:py-6">
      {view === "upload" && rows.length === 0 && (
  <form onSubmit={handleSubmit} className="w-full">
    <div className="max-w-5xl mx-auto px-2 sm:px-4 md:px-6 py-4 md:py-8">
      <div className="mb-6 rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.06)] backdrop-blur">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1f5a6b]">
          Painel de Roteirização
        </div>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
          Transforme planilhas em rotas revisáveis e prontas para exportação
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
          Envie a planilha operacional, acompanhe o processamento e revise os pontos em um fluxo visual único.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            Importação Assistida
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            Revisão Operacional
          </span>
          <span className="rounded-full bg-[#dff5ef] px-3 py-1 text-xs font-medium text-[#0f5f58]">
            Exportação para Circuit
          </span>
        </div>
      </div>

      <div
        data-tour="upload-area"
        className="rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]"
      >
        <div className="flex flex-col md:flex-row gap-4">
          {/* INPUT PLANILHA */}
          <label
            className="flex-1 cursor-pointer rounded-[24px] border border-dashed border-[#7bb7ab] bg-[linear-gradient(180deg,#f8fcfb_0%,#f1f7f6_100%)] transition p-5 hover:border-[#1f5a6b] hover:bg-white"
            onClick={(e) => {
              if (access?.canStartRoute === true) return;
              e.preventDefault();
              setFile(null);
              router.replace("/planos");
            }}
          >
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              disabled={access?.canStartRoute !== true}
              onChange={(e) => {
                if (access?.canStartRoute !== true) {
                  e.currentTarget.value = "";
                  setFile(null);
                  router.replace("/planos");
                  return;
                }
                setFile(e.target.files?.[0] || null);
              }}
            />

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#dff5ef] flex items-center justify-center text-xl text-[#0f5f58]">
                ⬆️
              </div>

              <div className="min-w-0">
                <div className="font-semibold text-slate-900">
                  Carregar Arquivo Operacional
                </div>
                <div className="text-sm text-slate-600 truncate">
                  {file ? file.name : "Nenhum arquivo escolhido"}
                </div>
              </div>
            </div>
          </label>

          {/* BOTÃO BUSCAR */}
          <button
            type="submit"
            disabled={loading}
            data-tour="start-analysis-button"
            className="min-h-[56px] w-full md:w-[220px] rounded-[20px] bg-[#17313b] text-white font-semibold text-base shadow-[0_16px_30px_rgba(23,49,59,0.24)] hover:bg-[#10242c] disabled:opacity-50"
          >
            {loading ? "Processando..." : "Iniciar Análise"}
          </button>
        </div>

        {loading && !jobProgress && (
          <p className="mt-4 text-sm text-slate-500">
            Processando...
          </p>
        )}

        {loading && jobProgress && (
          <div className="mt-4 rounded-[22px] border border-[#cde3dd] bg-[#f4fbf8] px-4 py-4 text-sm text-slate-800">
            <div className="font-semibold">
              {jobProgress.status === "PENDING" ? "Importação iniciada" : "Processando planilha"}
            </div>
            <div className="mt-1">
              Progresso: {jobProgress.processedStops}/{jobProgress.totalStops}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[#0f766e] transition-all"
                style={{
                  width: `${jobProgress.totalStops ? (jobProgress.processedStops / jobProgress.totalStops) * 100 : 0}%`,
                }}
              />
            </div>
            {jobProgress.errorMessage && (
              <div className="mt-2 text-red-700">
                Erro: {jobProgress.errorMessage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </form>
)}
          {view === "results" && rows.length > 0 && (
  <div className="w-full px-2 sm:px-0">
              <div
                data-tour="results-panel"
                className="mb-4 rounded-[32px] border border-slate-200/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
              >
  <div className="border-b border-slate-200/80 bg-[radial-gradient(circle_at_top,rgba(31,90,107,0.08),transparent_30%),linear-gradient(180deg,#fbfcfc_0%,#f5f8f8_100%)] p-4 md:p-6">
  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
    <div className="max-w-2xl">
      <h2 className="text-3xl font-black tracking-tight text-slate-950 md:text-[34px] lg:text-[38px]">
        Resultado operacional
      </h2>
      <div className="mt-2 text-sm leading-6 text-slate-600 md:text-[15px]">
        Revise, valide e organize as paradas processadas.
      </div>
    </div>

  <div className="flex flex-wrap items-center gap-2.5 xl:max-w-[640px] xl:justify-end">
    <button
      type="button"
      data-tour="auto-group-button"
      onClick={() => {
  setAutoBreakIds(new Set()); // limpa os desagrupamentos manuais
  setAutoGrouped((v) => !v);
}}
      className={`inline-flex min-h-[48px] items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition sm:flex-none ${
        autoGrouped
          ? "border border-[#17313b] bg-[#17313b] text-white shadow-[0_14px_28px_rgba(23,49,59,0.24)]"
          : "border border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      Agrupar Paradas
    </button>

    <button
      type="button"
      data-tour="condo-group-button"
      onClick={() => {
        setCondoBreakIds(new Set());
        setCondoGrouped((v) => !v);
      }}
      className={`inline-flex min-h-[48px] items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition sm:flex-none ${
        condoGrouped
          ? "border border-[#17313b] bg-[#17313b] text-white shadow-[0_14px_28px_rgba(23,49,59,0.24)]"
          : "border border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      Agrupar condomínios/prédios
    </button>

    <button
      type="button"
      data-tour="new-import-button"
      onClick={() => {
  setFile(null);
  setRows([]);
  setManualEdits({});
  setManualGroups({});
  setAutoGrouped(false);
  setAutoBreakIds(new Set());
  setGroupMode(false);
  setSelectedIdxs(new Set());
  setIsExportOpen(false);
  setExportDraft([]);
  setView("upload");

  setJobProgress(null);
  setHistoryName("Planilha");
  setHistoryId(null);
}}

      className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-200 sm:flex-none"
    >
      Importar outra planilha
    </button>

    <button
      type="button"
      onClick={openExportReview}
      data-tour="export-button"
      className="inline-flex min-h-[50px] items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f766e_0%,#14967f_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(15,118,110,0.28)] transition hover:-translate-y-0.5 hover:brightness-105 sm:flex-none"
    >
      Exportar Resultado
    </button>
  </div>
</div>
  <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm lg:min-h-[176px] lg:p-5">
      <div className="flex h-full flex-col">
        <div className="flex flex-col items-center gap-3 text-center xl:flex-row xl:items-start xl:text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 lg:h-12 lg:w-12">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="lg:h-5 lg:w-5">
              <path d="M8 6h11M8 12h11M8 18h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="text-[10px] font-semibold text-slate-600 md:text-[11px]">
              Total de paradas
            </div>
            <div className="mt-2 text-3xl font-black leading-none text-slate-900 lg:text-[42px]">{exportSummary.total}</div>
            <div className="mt-2 text-[11px] font-medium text-slate-500 lg:text-xs">Pontos consolidados</div>
          </div>
        </div>
      </div>
    </div>
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm lg:min-h-[176px] lg:p-5">
      <div className="flex h-full flex-col justify-between">
        <div className="flex flex-col items-center gap-3 text-center xl:flex-row xl:items-start xl:text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 lg:h-12 lg:w-12">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="lg:h-5 lg:w-5">
              <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="text-[10px] font-semibold text-slate-600 md:text-[11px]">
              Validados
            </div>
            <div className="mt-2 text-3xl font-black leading-none text-emerald-700 lg:text-[42px]">{exportSummary.ok}</div>
            <div className="mt-2 text-[11px] font-semibold text-emerald-600 lg:text-xs">{summaryPercentText(exportSummary.ok)}</div>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${summaryPercent(exportSummary.ok)}%` }}
          />
        </div>
      </div>
    </div>
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm lg:min-h-[176px] lg:p-5">
      <div className="flex h-full flex-col justify-between">
        <div className="flex flex-col items-center gap-3 text-center xl:flex-row xl:items-start xl:text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-500 lg:h-12 lg:w-12">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="lg:h-5 lg:w-5">
              <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
              <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="text-[10px] font-semibold text-slate-600 md:text-[11px]">
              Aproximados
            </div>
            <div className="mt-2 text-3xl font-black leading-none text-amber-600 lg:text-[42px]">{exportSummary.partial + exportSummary.manual}</div>
            <div className="mt-2 text-[11px] font-semibold text-amber-600 lg:text-xs">{summaryPercentText(exportSummary.partial + exportSummary.manual)}</div>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-amber-500"
            style={{ width: `${summaryPercent(exportSummary.partial + exportSummary.manual)}%` }}
          />
        </div>
      </div>
    </div>
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm lg:min-h-[176px] lg:p-5">
      <div className="flex h-full flex-col justify-between">
        <div className="flex flex-col items-center gap-3 text-center xl:flex-row xl:items-start xl:text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500 lg:h-12 lg:w-12">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="lg:h-5 lg:w-5">
              <path d="M12 8v5M12 17h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M10.3 4.1 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="text-[10px] font-semibold text-slate-600 md:text-[11px]">
              Pendentes
            </div>
            <div className="mt-2 text-3xl font-black leading-none text-rose-600 lg:text-[42px]">{exportSummary.notFound}</div>
            <div className="mt-2 text-[11px] font-semibold text-rose-600 lg:text-xs">{summaryPercentText(exportSummary.notFound)}</div>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-rose-500"
            style={{ width: `${summaryPercent(exportSummary.notFound)}%` }}
          />
        </div>
      </div>
    </div>
  </div>
  <div className="mt-4 rounded-[22px] border border-slate-200 bg-white shadow-sm">
    <div className="grid gap-0 divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
      <div className="flex min-w-0 items-center gap-3 px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M14 3.5V8h4M9 12h6M9 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-500">Fonte dos dados</div>
          <div className="mt-0.5 truncate text-sm font-bold text-slate-900">
            {historyName && historyName !== "Planilha" ? historyName : file?.name || "Planilha importada"}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3 px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M8 6h11M8 12h11M8 18h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-500">Pontos da importação</div>
          <div className="mt-0.5 text-sm font-bold text-slate-900">{rows.length} pontos</div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3 px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 18 3.5 20.5v-14L9 4m0 14 6 2.5m-6-2.5V4m6 16.5 5.5-2.5v-14L15 6.5m0 14V6.5M15 6.5 9 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-500">Ação no mapa</div>
          <button
            type="button"
            onClick={() => setIsOverviewMapOpen(true)}
            disabled={overviewMapPoints.length === 0}
            data-tour="open-map-button"
            className={`mt-1.5 inline-flex min-h-[34px] items-center justify-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-bold shadow-sm transition ${
              overviewMapPoints.length === 0
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                : "border-sky-200 bg-white text-sky-700 hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50"
            }`}
            title={
              overviewMapPoints.length === 0
                ? "Nenhuma parada com coordenadas para exibir"
                : "Abrir mapa com todas as paradas"
            }
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 18 3.5 20.5v-14L9 4m0 14 6 2.5m-6-2.5V4m6 16.5 5.5-2.5v-14L15 6.5m0 14V6.5M15 6.5 9 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 10.5c2.4 0 4.3 1.5 5.2 3.5-.9 2-2.8 3.5-5.2 3.5S7.7 16 6.8 14c.9-2 2.8-3.5 5.2-3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="12" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            Revisar no mapa
          </button>
        </div>
      </div>
    </div>
  </div>
            </div>
             <div className="md:hidden mt-3 space-y-3">
{groupedRows.map((g) => {
                        const isGrouped = g.idxs.length > 1;
                        const baseIdx = getGroupBaseIdx(g.idxs);
                        const idxsToToggle = isGrouped ? g.idxs : [baseIdx];
                        const hasReview = g.idxs.some((i) => !!manualEdits[i]?.review);

                        return (
                         <div
                            key={g.id}
                            data-tour="mobile-stop-card"
                            className={
                              `select-none rounded-[26px] border p-4 shadow-[0_14px_32px_rgba(15,23,42,0.06)] transition-all ${
                                hasReview ? "text-red-700" : ""
                              } ${
                                hasReview
                                  ? "border-red-200 bg-rose-50/90"
                                  : groupMode && idxsToToggle.every((i) => selectedIdxs.has(i))
                                  ? "border-slate-300 bg-slate-200/80 shadow-[0_14px_32px_rgba(15,23,42,0.08)]"
                                  : g.idxs.some((i) => manualEdits[i]?.confirmed)
                                  ? "border-emerald-200 bg-emerald-50/80"
                                  : "border-slate-200 bg-white/95"
                              }`
                            }
                            onClick={() => {
                              if (!groupMode) return;
                              toggleSelectMany(idxsToToggle);
                            }}
                            onTouchStart={(e) => {
                              if (groupMode) return;
                              clearLongPressTimer();
                              const touch = e.touches[0];
                              if (!touch) return;

                              longPressTimerRef.current = setTimeout(() => {
                                setCtx({
                                  open: true,
                                  x: touch.clientX,
                                  y: touch.clientY,
                                  groupId: g.id,
                                });
                              }, 500);
                            }}
                            onTouchEnd={() => {
                              clearLongPressTimer();
                            }}
                            onTouchMove={() => {
                              clearLongPressTimer();
                            }}
                            onTouchCancel={() => {
                              clearLongPressTimer();
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    className={`inline-flex rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-sm ${getStatusBadgeClass(g.status)}`}
                                  >
                                    {g.statusLabel}
                                  </span>

                                  <span className="text-sm font-semibold text-slate-900">
                                    Seq: {g.sequenceText}
                                  </span>
                                </div>

                                {isGrouped && (
                                  <div className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                    Agrupado ({g.idxs.length})
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {!groupMode && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openManualModalForIdx(baseIdx);
                                    }}
                                    data-tour="mobile-stop-map-button"
                                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:bg-white text-slate-700"
                                    title="Revisar no mapa"
                                  >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                  </button>
                                )}


                                {!groupMode && !isGrouped && (
                                  <button
                                    type="button"
                                    onClick={() => enterGroupModeWithFirst(baseIdx)}
                                    data-tour="mobile-stop-group-button"
                                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:bg-white text-slate-700"
                                    title="Agrupar paradas"
                                  >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path d="M4 7h8M16 7h4M4 17h4M12 17h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                      <circle cx="14" cy="7" r="2" stroke="currentColor" strokeWidth="2" />
                                      <circle cx="10" cy="17" r="2" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                  </button>
                                )}

                                {!groupMode && isGrouped && (g.id.startsWith("manual_") || g.id.startsWith("auto_") || g.id.startsWith("condo_")) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!groupMode) setGroupMode(true);
                                      setMergeTargetGroupId(g.id);
                                      setSelectedIdxs(new Set(g.idxs));
                                    }}
                                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:bg-white text-slate-700"
                                    title="Adicionar mais linhas neste grupo"
                                  >
                                    <span className="text-xl leading-none font-medium">+</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="mt-4 text-sm leading-6 text-slate-900 break-words">
                              {g.addressDisplay}
                            </div>

                               {!!String(g.notes || "").trim() && (
                                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-700 break-words">
                                  <span className="font-semibold">Observação:</span> {g.notes}
                                </div>
                              )}

                            {notesEditorIdx === baseIdx && (
                              <div
                                className="mt-3 space-y-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="text"
                                  value={notesDraft}
                                  onChange={(e) => setNotesDraft(e.target.value)}
                                  placeholder="Ex: QD 12 LT 03 / portão azul / fundos"
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                  autoFocus
                                />

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => saveNotesEditor(baseIdx)}
                                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
                                  >
                                    Salvar
                                  </button>

                                  <button
                                    type="button"
                                    onClick={cancelNotesEditor}
                                    className="px-3 py-2 rounded-lg text-xs font-semibold border bg-white hover:bg-slate-50"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            )}

                             {String(g.bairro || "").trim() && (
                              <div className="mt-1 text-xs text-slate-600 break-words">
                                {String(g.bairro || "").trim()}
                              </div>
                            )}

                            {groupMode && (
                              <label
                                className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs select-none cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={idxsToToggle.every((i) => selectedIdxs.has(i))}
                                  onChange={() => toggleSelectMany(idxsToToggle)}
                                  className="accent-red-600 cursor-pointer"
                                />
                                Selecionar
                              </label>
                            )}
                          </div>
                        );
                      })}
            </div>

             <div className="hidden md:block w-full overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_16px_44px_rgba(15,23,42,0.07)] mt-3 md:mt-4">
  <div className="flex items-center justify-between border-b border-slate-200/80 bg-slate-50/70 px-4 py-3">
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        Paradas processadas
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">
        Tabela consolidada para revisão operacional
      </div>
    </div>
    <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
      {groupedRows.length} linhas
    </div>
  </div>
  <div className="w-full overflow-x-auto">
   <table className="min-w-[600px] md:min-w-[1100px] w-full text-sm text-slate-900 table-fixed">
      <thead className="bg-[linear-gradient(180deg,#f9fbfb_0%,#f1f6f7_100%)] text-slate-600">
       <tr className="border-b border-slate-200/80">
         <th className="px-3 md:px-4 py-4 text-left text-[11px] md:text-xs font-semibold uppercase tracking-[0.18em] w-[88px] md:w-[140px]">
    Ação
  </th>
  <th className="px-3 md:px-4 py-4 text-left text-[11px] md:text-xs font-semibold uppercase tracking-[0.18em] w-[92px] md:w-[130px]">
    Status
  </th>

  <th className="px-3 md:px-4 py-4 text-left text-[11px] md:text-xs font-semibold uppercase tracking-[0.18em] w-[82px] md:w-[120px]">
    Sequência
  </th>

  <th className="px-3 md:px-4 py-4 text-left text-[11px] md:text-xs font-semibold uppercase tracking-[0.18em] min-w-[0] w-auto md:min-w-[360px]">
    Endereço
  </th>

  <th className="hidden md:table-cell px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] w-[200px]">
    Bairro
  </th>

  <th className="hidden md:table-cell px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] w-[160px]">
    Cidade
  </th>

 
</tr>
      </thead>

     

                    <tbody>
{groupedRows.map((g) => {
                        const isGrouped = g.idxs.length > 1;
                        const baseIdx = getGroupBaseIdx(g.idxs);
                        const idxsToToggle = isGrouped ? g.idxs : [baseIdx];

                        // ✅ se qualquer item do grupo estiver em revisão, destaca a linha inteira
                        const hasReview = g.idxs.some((i) => !!manualEdits[i]?.review);

                        return (
                         <tr
  key={g.id}
  data-tour="row-context-menu"
  className={
    
    `border-b border-slate-100 transition-all duration-150
     ${
        hasReview
          ? "bg-red-50/90 text-red-800 shadow-[inset_3px_0_0_rgba(220,38,38,0.75)] hover:bg-red-100/80"
          : groupMode && idxsToToggle.every((i) => selectedIdxs.has(i))
          ? "bg-slate-200/80 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.35)]"
          : g.idxs.some((i) => manualEdits[i]?.confirmed)
          ? "bg-emerald-100/90 shadow-[inset_3px_0_0_rgba(16,185,129,0.8)] hover:bg-emerald-200/70"
          : "odd:bg-white even:bg-slate-50/55 hover:bg-[#f2f7f7]"
     }`
  }
onClick={() => {
  if (!groupMode) return;
  toggleSelectMany(idxsToToggle);
}}
onContextMenu={(e) => {
  e.preventDefault();
  setCtx({ open: true, x: e.clientX, y: e.clientY, groupId: g.id });
  }}
  title={"Botão direito: Revisão / Limpar Revisão"}
>

<td className="px-3 md:px-4 py-4 align-top">
                              <div className="flex items-center gap-2">
{!groupMode && (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      if (typeof window !== "undefined") {
        if (window.localStorage.getItem(TUTORIAL_ACTIVE_KEY) === "true") {
          window.localStorage.setItem(
            TUTORIAL_PENDING_MAP_REVIEW_KEY,
            "true"
          );
        }
      }
      openManualModalForIdx(baseIdx);
    }}
    data-tour="row-map-button"
    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:bg-white text-slate-700"
    title="Revisar no mapa"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  </button>
)}


                               {!groupMode && !isGrouped && (
                                   <button
                                     type="button"
                                     onClick={() => enterGroupModeWithFirst(baseIdx)}
                                   data-tour="manual-group-button"
                                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:bg-white text-slate-700"
                                    title="Agrupar paradas"
                                  >
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                        <path d="M4 7h8M16 7h4M4 17h4M12 17h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                        <circle cx="14" cy="7" r="2" stroke="currentColor" strokeWidth="2" />
                                        <circle cx="10" cy="17" r="2" stroke="currentColor" strokeWidth="2" />
                                      </svg>
                                   </button>
                                )}

                             {groupMode && (
  <label className="text-xs flex items-center gap-2 select-none cursor-pointer">
<input
  type="checkbox"
  checked={idxsToToggle.every((i) => selectedIdxs.has(i))}
  onClick={(e) => e.stopPropagation()} // não dispara clique da linha
  onChange={() => toggleSelectMany(idxsToToggle)}
  className="accent-red-600 cursor-pointer"
/>
    Selecionar
  </label>
)}

  {!groupMode && isGrouped && (g.id.startsWith("manual_") || g.id.startsWith("auto_") || g.id.startsWith("condo_")) && (
  <button
    type="button"
    onClick={(e) => {
  e.stopPropagation();
  if (!groupMode) setGroupMode(true);

  // ✅ define qual grupo vai receber as linhas
  setMergeTargetGroupId(g.id);

  // ✅ deixa VISUALMENTE marcado que você está mexendo nesse grupo
  // (seleciona todos do grupo como base)
  setSelectedIdxs(new Set(g.idxs));
}}
    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:bg-white text-slate-700"
    title="Adicionar mais linhas neste grupo"
  >
 <span className="text-xl leading-none font-medium">+</span>
  </button>
)}
                              </div>
                            </td>
                            <td className="px-3 md:px-4 py-4 align-top">
                              <span
  className={`inline-flex rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-sm ${getStatusBadgeClass(g.status)}`}
>
  {g.statusLabel}
</span>
                            </td>

                            <td className="px-3 md:px-4 py-4 align-top font-semibold text-sm md:text-[15px] text-slate-900">{g.sequenceText}</td>

                           <td className="px-3 md:px-4 py-4 align-top whitespace-normal md:whitespace-nowrap overflow-hidden text-ellipsis max-w-none md:max-w-[520px] w-full">
                              <span
                                data-tour="mobile-stop-address"
                                className="block whitespace-normal md:whitespace-nowrap break-words overflow-hidden text-ellipsis leading-6"
                              >
  {g.addressDisplay}
</span>

                              {!!String(g.notes || "").trim() && (
                                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-700 break-words whitespace-normal">
                                  <span className="font-semibold">Observação:</span> {g.notes}
                                </div>
                              )}

                              {notesEditorIdx === baseIdx && (
                                <div
                                  className="mt-3 space-y-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="text"
                                    value={notesDraft}
                                    onChange={(e) => setNotesDraft(e.target.value)}
                                    placeholder="Ex: QD 12 LT 03 / portão azul / fundos"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    autoFocus
                                  />

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => saveNotesEditor(baseIdx)}
                                      className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
                                    >
                                      Salvar
                                    </button>

                                    <button
                                      type="button"
                                      onClick={cancelNotesEditor}
                                      className="px-3 py-2 rounded-lg text-xs font-semibold border bg-white hover:bg-slate-50"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              )}
                              {isGrouped && (
                                <div className="mt-3 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                  Agrupado ({g.idxs.length})
                                </div>
                              )}
                            </td>

                           <td className="hidden md:table-cell px-4 py-4 align-top">{g.bairro}</td>
                            <td className="hidden md:table-cell px-4 py-4 align-top">{g.city}</td>

                            
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                </div>
              </div>

              {groupMode && (
  <div className="fixed bottom-3 left-3 right-3 md:bottom-5 md:left-[260px] md:right-6 z-[9999]">
    <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white/90 backdrop-blur shadow-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="text-sm text-slate-700">
        <b>{selectedIdxs.size}</b> Selecionados
      </div>

      <div className="flex w-full sm:w-auto items-center justify-end gap-2">
        <button
          type="button"
          onClick={cancelGroupMode}
          className="px-3 py-2 rounded-lg text-sm font-semibold border bg-white hover:bg-slate-50"
        >
          Cancelar
        </button>

        <button
          type="button"
          onClick={unifySelected}
          className="px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
        >
          Unificar
        </button>
      </div>
    </div>
  </div>
          )} 

              {/* Context menu */}
{ctx.open && ctx.groupId && (
  <div
    style={{ position: "fixed", left: ctx.x, top: ctx.y, zIndex: 9999 }}
    data-tour="context-menu"
    className="bg-white border shadow-lg rounded-md overflow-hidden text-sm"
    onMouseDown={(e) => e.stopPropagation()}
  >
    <button
      data-tour="context-ungroup"
      className="px-4 py-2 hover:bg-slate-100 w-full text-left"
      onClick={() => {
        ungroup(ctx.groupId!);
        setCtx({ open: false, x: 0, y: 0, groupId: null });
      }}
    >
      Desagrupar
    </button>

    <button
      data-tour="context-observation"
      className="px-4 py-2 hover:bg-slate-100 w-full text-left"
      onClick={() => {
        openNotesEditorForGroup(ctx.groupId!);
      }}
    >
      Observação
    </button>

    <button
      data-tour="context-flag-review"
      className="px-4 py-2 hover:bg-slate-100 w-full text-left text-red-600"
      onClick={() => {
        signalReview(ctx.groupId!);
        setCtx({ open: false, x: 0, y: 0, groupId: null });
      }}
    >
      Sinalizar Revisão
    </button>

    <button
      data-tour="context-clear-review"
      className="px-4 py-2 hover:bg-slate-100 w-full text-left"
      onClick={() => {
        clearReview(ctx.groupId!);
        setCtx({ open: false, x: 0, y: 0, groupId: null });
      }}
    >
      Limpar Revisão
    </button>
  </div>
)}
              {/* Export review modal */}
              {isExportOpen && (
                <div className="fixed inset-0 z-[9998] flex items-stretch justify-center bg-[#0f172a]/55 p-2 backdrop-blur-sm md:items-center md:p-4">
                  <div className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)] md:h-auto md:max-h-[90vh] md:rounded-[34px]">
                    {/* Header */}
                    <div className="px-5 py-5 border-b border-white/10 bg-[radial-gradient(circle_at_top,rgba(78,201,176,0.18),transparent_28%),linear-gradient(135deg,#17313b_0%,#1f5a6b_100%)] text-white">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-white/15 backdrop-blur">
                            <span className="text-lg">↗</span>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/65">
                              Finalização da Rota
                            </div>
                            <div className="mt-1 text-xl font-bold tracking-tight text-white">
                              Central de Exportação
                            </div>
                            <div className="mt-1 text-sm text-white/75">
                              Revise observações, valide dados e gere o arquivo final da operação.
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsExportOpen(false)}
                          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-lg text-white/75 transition hover:bg-white/14 hover:text-white"
                          title="Fechar"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Step box (igual route planner) */}
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-4 md:px-6 md:pt-6">
                      <div className="rounded-[26px] bg-[linear-gradient(180deg,#f8fcfb_0%,#f1f7f6_100%)] border border-slate-200 p-5">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-[#0f766e] text-white flex items-center justify-center text-sm font-bold shadow-sm">
                            ✓
                          </div>
                          <div className="font-semibold text-slate-800">
                            Passo 1: Selecione o conteúdo da coluna "Observações"
                          </div>
                        </div>

                        <div className="mt-4 flex flex-col sm:flex-row gap-3">
                          <button
                            type="button"
                            className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left opacity-60 cursor-not-allowed"
                            disabled
                          >
                            <div className="text-sm font-semibold text-slate-700">
                              Resumo do Sistema
                            </div>
                            <div className="text-xs text-slate-500">
                              Sequência + Quadra/Lote + Complementos
                            </div>
                          </button>

                          <button
                            type="button"
                            className="flex-1 rounded-2xl border-2 border-[#8fd0bf] bg-white px-4 py-3 text-left shadow-sm"
                          >
                            <div className="text-sm font-semibold text-slate-800">
                              Endereço Completo
                            </div>
                            <div className="text-xs text-slate-500">
                              Sequência + Logradouro Original
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="hidden grid-cols-2 gap-3 px-4 pt-4 md:grid md:grid-cols-4 md:px-6">
                        <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Total</div>
                          <div className="mt-2 text-2xl font-black text-slate-900">{exportSummary.total}</div>
                          <div className="mt-1 text-xs text-slate-500">Pontos prontos</div>
                        </div>
                        <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Validado</div>
                          <div className="mt-2 text-2xl font-black text-emerald-900">{exportSummary.ok}</div>
                          <div className="mt-1 text-xs text-emerald-700/80">Confirmados e válidos</div>
                        </div>
                        <div className="rounded-[22px] border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Aproximado</div>
                          <div className="mt-2 text-2xl font-black text-amber-900">{exportSummary.partial}</div>
                          <div className="mt-1 text-xs text-amber-700/80">Localização aproximada</div>
                        </div>
                        <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Agrupados</div>
                          <div className="mt-2 text-2xl font-black text-slate-900">{exportSummary.grouped}</div>
                          <div className="mt-1 text-xs text-slate-500">Blocos consolidados</div>
                        </div>
                      </div>

                    {/* Table */}
                    <div className="px-3 md:px-6 pt-5 pb-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
                      <div className="md:hidden space-y-3 pb-4">
                        {exportDraft.map((r, idx) => {
                          return (
                            <div
                              key={r.groupId ?? idx}
                              className={
                                "rounded-[22px] border border-slate-200 p-4 bg-white shadow-sm " +
                                (manualEdits[r.baseIdx]?.review ? "text-red-600" : "")
                              }
                            >
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                  Observações
                                </div>
                                <textarea
                                  value={r.complemento || ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setExportDraft((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], complemento: v };
                                      return next;
                                    });
                                  }}
                                  rows={4}
                                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-3 text-sm outline-none transition focus:border-[#1f5a6b] focus:bg-white break-words"
                                  placeholder="Observações (endereço original, referência, casa/apto...)"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div
                        className="hidden md:block overflow-auto rounded-[24px] border border-slate-200 shadow-sm"
                        style={{ maxHeight: "60vh" }}
                      >
                        <table className="min-w-full text-sm">
                          <thead className="bg-[linear-gradient(180deg,#f8fafb_0%,#eff5f6_100%)] text-slate-600 sticky top-0">
                            <tr>
                              <th className="p-3 text-left border-b w-[140px]">Latitude</th>
                              <th className="p-3 text-left border-b w-[140px]">Longitude</th>
                              <th className="p-3 text-left border-b">Observações (editável)</th>
                            </tr>
                          </thead>

                          <tbody>
                            {exportDraft.map((r, idx) => {
                              const latStr = typeof r.lat === "number" ? r.lat.toFixed(6) : "--";
                              const lngStr = typeof r.lng === "number" ? r.lng.toFixed(6) : "--";

                              return (
                                <tr
  key={r.groupId ?? idx}
  className={
  "border-b border-slate-100 transition-colors " +
  (manualEdits[r.baseIdx]?.review
    ? "bg-red-50/50 text-red-600"
    : "odd:bg-white even:bg-slate-50/55 hover:bg-[#f3f8f8]")
}
>
                                  <td className="p-4 border-b border-slate-100 font-mono text-[13px] text-slate-700">{latStr}</td>
                                  <td className="p-4 border-b border-slate-100 font-mono text-[13px] text-slate-700">{lngStr}</td>

                                  <td className="p-4 border-b border-slate-100">
                                    <input
                                      value={r.complemento || ""}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setExportDraft((prev) => {
                                          const next = [...prev];
                                          next[idx] = { ...next[idx], complemento: v };
                                          return next;
                                        });
                                      }}
                                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm outline-none transition focus:border-[#1f5a6b] focus:bg-white"
                                      placeholder="Observações (endereço original, referência, casa/apto...)"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="sticky bottom-0 border-t border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,#f4f8f8_100%)] px-3 md:px-6 py-4 pb-[calc(env(safe-area-inset-bottom)+16px)] backdrop-blur">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="text-sm text-slate-600">
                          Total de <b>{exportDraft.length}</b> pontos agrupados prontos para exportação.
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setIsExportOpen(false)}
                            className="px-5 py-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700"
                          >
                            Cancelar
                          </button>

                          <button
                            type="button"
                            onClick={confirmExportCircuit}
                            className="px-6 py-3 rounded-2xl bg-[linear-gradient(135deg,#0f766e_0%,#14967f_100%)] hover:brightness-105 text-white text-sm font-semibold shadow-[0_18px_34px_rgba(15,118,110,0.28)] transition"
                          >
                            Confirmar e Exportar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {isOverviewMapOpen && (
                <div className="fixed inset-0 z-[9998] bg-black/30">
                  <div className="absolute inset-0 bg-white">
                    <div className="absolute left-0 right-0 top-0 z-20 h-[56px] md:h-[64px] border-b bg-white/95 backdrop-blur">
                      <div className="h-full px-3 md:px-4 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm md:text-base font-semibold text-slate-900">
                            Revisar no Mapa
                          </div>
                          <div className="text-xs text-slate-500">
                            Mostrando {overviewMapPoints.length} parada(s) com coordenadas
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsOverviewMapOpen(false)}
                          className="w-9 h-9 md:w-10 md:h-10 rounded-xl border bg-white hover:bg-slate-50"
                          title="Fechar"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="absolute inset-0 pt-[56px] md:pt-[64px] overflow-hidden">
                      <div ref={overviewMapRef} className="w-full h-full bg-white" />
                    </div>

                    {overviewSelectedPoint && overviewCardPosition && !overviewMoveDraft && (
                      <div
                        className="absolute z-20 w-[360px] max-w-[calc(100vw-24px)]"
                        style={{
                          left: overviewCardPosition.left,
                          top: overviewCardPosition.top,
                          transform: "translateY(-100%)",
                        }}
                      >
                        <div className="rounded-2xl border bg-white shadow-xl p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">
                                Sequência {overviewSelectedPoint.sequenceText}
                              </div>
                              <div className="mt-1 text-sm text-slate-600">
                                {overviewSelectedPoint.address}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => setOverviewSelectedGroupId(null)}
                              className="w-8 h-8 rounded-lg border bg-white hover:bg-slate-50 text-slate-500"
                              title="Fechar card"
                            >
                              ✕
                            </button>
                          </div>

                          <div className="mt-3 text-xs text-slate-500">
                            Status:{" "}
                            <span className="font-semibold text-slate-700">
                              {overviewSelectedPoint.statusLabel}
                            </span>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {overviewSelectedGroup?.idxs.length === 1 && (
                              <button
                                type="button"
                                onClick={startOverviewMoveMode}
                                className="px-3 py-2 rounded-lg text-sm font-semibold border bg-white hover:bg-slate-50"
                              >
                                Mover pino
                              </button>
                            )}

                            {overviewSelectedGroup?.idxs.length !== 1 && (
                              <div className="w-full text-xs text-amber-700">
                                Mover pino disponível apenas para parada individual.
                              </div>
                            )}

                            {overviewSelectedPoint.status !== "CONFIRMADO" && (
                              <button
                                type="button"
                                onClick={confirmOverviewSelectedPoint}
                                className="px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                              >
                                Confirmar
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setIsOverviewMapOpen(false);
                                openNotesEditorForGroup(overviewSelectedPoint.id);
                              }}
                              className="px-3 py-2 rounded-lg text-sm font-semibold border bg-white hover:bg-slate-50"
                            >
                              Ver observações
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setIsOverviewMapOpen(false);
                                openManualModalForIdx(overviewSelectedPoint.baseIdx);
                              }}
                              className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800"
                            >
                              Abrir parada
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {overviewMoveDraft && (
                      <div className="absolute left-2 right-2 bottom-14 md:left-1/2 md:right-auto md:bottom-4 md:-translate-x-1/2 z-30">
                        <div className="rounded-2xl border bg-white/95 backdrop-blur shadow-xl px-4 py-3">
                          <div className="text-xs text-amber-700 mb-3">
                            Clique no mapa para definir a nova posição desta parada.
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={saveOverviewMoveDraft}
                              className="px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              Salvar ajuste
                            </button>

                            <button
                              type="button"
                              onClick={cancelOverviewMoveMode}
                              className="px-3 py-2 rounded-lg text-sm font-semibold border bg-white hover:bg-slate-50"
                            >
                              Cancelar ajuste
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="absolute left-2 right-2 bottom-2 md:left-4 md:right-auto md:bottom-4 z-20">
                      <div className="rounded-xl border bg-white/95 backdrop-blur shadow-lg px-3 py-2 text-xs text-slate-700">
                        Visualização somente leitura. Clique em um marcador para ver sequência, endereço e status.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal mapa */}
<div
  className={`
    fixed inset-0 z-[9999] bg-black/30
    transition-opacity duration-200
    ${isModalOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
  `}
  data-tour="map-modal"
>
    <div className="absolute inset-0 bg-white">
      {/* TOP BAR (igual print) */}
      <div className="absolute left-0 right-0 top-0 z-20 h-[56px] md:h-[64px] border-b bg-white/95 backdrop-blur">
        <div className="h-full px-3 md:px-4 flex items-center justify-between gap-2 md:gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
              📍
            </div>

            <div className="min-w-0">
              <div className="text-[10px] md:text-[11px] font-semibold text-slate-500">ORIGINAL</div>
              <div className="text-xs md:text-sm font-semibold text-slate-900 truncate">
  {modalOriginal}
  {(pickedCep || modalCep) && ` - ${pickedCep || modalCep}`}
</div>
            </div>
          </div>

          <div className="hidden md:block text-right min-w-0">
            <div className="text-[11px] font-semibold text-emerald-600">NORMALIZADO</div>
            <div className="text-xs font-semibold text-slate-700 truncate">
              {modalValue || ""}
            </div>
          </div>

          <button
            type="button"
            onClick={closeManualModal}
            className="w-9 h-9 md:w-10 md:h-10 rounded-xl border bg-white hover:bg-slate-50"
            title="Fechar"
          >
            ✕
          </button>
        </div>
      </div>

      {/* MAPA FULLSCREEN (abaixo da topbar) */}
    <div className="absolute inset-0 pt-[56px] md:pt-[64px] overflow-hidden arcgis-modal">
        {activeMapProvider === "arcgis" && arcgisCityKey === "aparecida" ? (
          <AparecidaArcgisMap
            center={pinLatLng}
            onPick={({ lat, lng }) => {
              setPinLatLng({ lat, lng });
              setPickedLabel("");
            }}
          />
        ) : activeMapProvider === "arcgis" && arcgisCityKey === "goiania" ? (
          <GoianiaArcgisMap
            center={pinLatLng}
            onPick={({ lat, lng }) => {
              setPinLatLng({ lat, lng });
              setPickedLabel("");
            }}
          />
        ) : activeMapProvider === "google" ? (
          <GoogleValidationMap
            center={pinLatLng}
            searchText={googleSearchQuery}
            searchRequestId={googleSearchRequestId}
            queryContext={modalOriginal}
            city={String(modalCity || "")}
            district={modalIdx !== null ? String(rows?.[modalIdx]?.bairro || "") : ""}
            onSearchLoading={setGoogleSearchLoading}
            onSearchMessage={setGoogleSearchMessage}
            onSearchResults={handleGoogleSearchResults}
            onPick={({ lat, lng }) => {
              setPinLatLng({ lat, lng });
              setPickedLabel("");
            }}
          />
        ) : (
          <div ref={mapRef} className="w-full h-full bg-white" />
        )}
      </div>

      {/* CARD "BUSCA E CAPTURA" (desktop) */}
      <div className="absolute left-2 right-2 top-[60px] z-30 hidden w-auto md:left-4 md:right-auto md:top-[80px] md:block md:w-[420px] md:max-w-[calc(100vw-32px)]">
        <div className="rounded-xl border bg-white/95 p-2 shadow-lg backdrop-blur md:rounded-2xl md:p-3">
          <div className="mb-1.5 text-[10px] font-semibold text-emerald-700 md:mb-2 md:text-[11px]">
            BUSCA E CAPTURA
          </div>

          {showProviderToggle && (
            <div className="mb-2 flex items-center justify-between gap-2 md:mb-3">
              <div className="text-[10px] font-semibold text-slate-500 md:text-[11px]">
                MAPA
              </div>

              <div className="inline-flex rounded-lg border bg-slate-50 p-1">
                {!forceArcgisOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualMapProvider("here");
                      setLastPrimaryManualMapProvider("here");
                    }}
                    className={[
                      "rounded-md px-3 py-1 text-[11px] font-semibold transition-colors md:text-xs",
                      activeMapProvider === "here"
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    HERE
                  </button>
                )}

                {arcgisAvailable && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualMapProvider("arcgis");
                      setLastPrimaryManualMapProvider("arcgis");
                    }}
                    title="Usar mapa ArcGIS"
                    className={[
                      "rounded-md px-3 py-1 text-[11px] font-semibold transition-colors md:text-xs",
                      activeMapProvider === "arcgis"
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    ArcGIS
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setManualMapProvider("google")}
                  className={[
                    "rounded-md px-3 py-1 text-[11px] font-semibold transition-colors md:text-xs",
                    activeMapProvider === "google"
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  ].join(" ")}
                >
                  Google
                </button>
              </div>
            </div>
          )}

          <div ref={searchBoxWrapRef} className="relative">
            <input
              data-tour="map-search-input"
              value={modalValue}
              onChange={(e) => {
                const v = e.target.value;
                setModalValue(v);
                if (activeMapProvider === "google") {
                  setGoogleSearchMessage("");
                  setGoogleSearchResults([]);
                  return;
                }
                setSuggestOpen(true);
                setSuggestActive(-1);
                scheduleSuggest(v);
              }}
              onFocus={() => {
                if (activeMapProvider === "google") return;
                setSuggestOpen(true);
                scheduleSuggest(modalValue);
              }}
              onKeyDown={(e) => {
                if (activeMapProvider === "google" && e.key === "Enter") {
                  e.preventDefault();
                  runGoogleManualSearch();
                  return;
                }
                if (!suggestOpen) {
                  if (e.key === "ArrowDown" && suggestItems.length) {
                    setSuggestOpen(true);
                    setSuggestActive(0);
                  }
                  return;
                }

                if (e.key === "Escape") {
                  setSuggestOpen(false);
                  setSuggestActive(-1);
                  return;
                }

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSuggestActive((cur) =>
                    Math.min((cur < 0 ? 0 : cur + 1), suggestItems.length - 1)
                  );
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSuggestActive((cur) => Math.max((cur <= 0 ? 0 : cur - 1), 0));
                }

                if (e.key === "Enter") {
                  e.preventDefault();
                  if (suggestActive >= 0 && suggestItems[suggestActive]) {
                    selectSuggestItem(suggestItems[suggestActive]);
                  }
                }
              }}
              placeholder="Buscar ou Lat/Lng..."
              className="w-full rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-200 md:rounded-xl md:text-sm"
            />

            {activeMapProvider !== "google" && suggestOpen && suggestItems.length > 0 && (
              <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border bg-white shadow-lg md:mt-2 md:rounded-xl">
                {suggestItems.map((it, idx) => (
                  <button
                    key={`${it.id ?? idx}`}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      selectSuggestItem(it);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className={[
                      "w-full px-3 py-2 text-left text-xs hover:bg-slate-50 md:text-sm",
                      idx === suggestActive ? "bg-slate-50" : "",
                    ].join(" ")}
                  >
                    {it.address?.label || it.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeMapProvider === "google" && googleSearchMessage && (
            <div className="mt-2 text-xs font-medium text-slate-600">
              {googleSearchMessage}
            </div>
          )}

          <div className="mt-2 flex flex-col gap-2 md:mt-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => {
                if (activeMapProvider === "google") runGoogleManualSearch();
                else runHereSearch(modalValue);
              }}
              disabled={activeMapProvider === "google" && googleSearchLoading}
              className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 md:rounded-xl md:text-sm"
            >
              {activeMapProvider === "google" && googleSearchLoading ? "Buscando" : "Buscar"}
            </button>

            <button
              type="button"
              onClick={confirmManualModal}
              data-tour="map-confirm-button"
              className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 md:rounded-xl md:text-sm"
              title="Confirmar"
            >
              CONFIRMAR <span>✓</span>
            </button>
          </div>

          {activeMapProvider === "google" && googleSearchResults.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {googleSearchResults.map((result, idx) => (
                <button
                  key={`${result.id}-${idx}`}
                  type="button"
                  onClick={() => selectGoogleSearchResult(result)}
                  className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                >
                  <div className="text-xs font-semibold text-slate-900 md:text-sm">
                    {idx + 1}. {result.name}
                  </div>
                  {result.address && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] font-medium text-slate-500 md:text-xs">
                      {result.address}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-2 text-[10px] text-slate-700 md:mt-3 md:rounded-xl md:px-3 md:text-xs">
            <div className="truncate">
              <span className="font-semibold">GPS:</span>{" "}
              {pinLatLng ? `${pinLatLng.lat}, ${pinLatLng.lng}` : "-"}
              {pickedCep ? `  • CEP: ${pickedCep}` : ""}
              {pickedQuadra ? `  • Quadra: ${pickedQuadra}` : ""}
              {pickedLote ? `  • Lote: ${pickedLote}` : ""}
            </div>

            <button
              type="button"
              onClick={() => {
                const txt = pinLatLng ? `${pinLatLng.lat}, ${pinLatLng.lng}` : "";
                if (txt) navigator.clipboard?.writeText(txt);
              }}
              className="shrink-0 rounded-lg border bg-white px-2.5 py-1 text-[10px] hover:bg-slate-50 md:px-3 md:text-xs"
            >
              Copiar
            </button>
          </div>
        </div>
      </div>

      <div className="md:hidden absolute inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="flex gap-2 rounded-[22px] border border-slate-200 bg-white/95 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur">
          <button
            type="button"
            onClick={confirmManualModal}
            data-tour="map-confirm-button"
            className="flex-1 rounded-2xl bg-emerald-600 px-3 py-3 text-xs font-semibold text-white shadow-[0_12px_24px_rgba(15,118,110,0.22)] hover:bg-emerald-700"
            title="Confirmar"
          >
            Confirmar
          </button>
        </div>
      </div>

      <div className="md:hidden absolute left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-40 max-h-[36dvh] overflow-y-auto overscroll-contain rounded-[18px] border border-slate-200 bg-white/95 p-2 shadow-2xl backdrop-blur">
          <div className="mb-1 text-[10px] font-semibold text-emerald-700">
            BUSCA E CAPTURA
          </div>

          {showProviderToggle && (
            <div className="mb-1.5 flex items-center justify-between gap-1.5">
              <div className="text-[10px] font-semibold text-slate-500">MAPA</div>

              <div className="inline-flex rounded-lg border bg-slate-50 p-0.5">
                {!forceArcgisOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualMapProvider("here");
                      setLastPrimaryManualMapProvider("here");
                    }}
                    className={[
                      "rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                      activeMapProvider === "here"
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    HERE
                  </button>
                )}

                {arcgisAvailable && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualMapProvider("arcgis");
                      setLastPrimaryManualMapProvider("arcgis");
                    }}
                    title="Usar mapa ArcGIS"
                    className={[
                      "rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                      activeMapProvider === "arcgis"
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    ArcGIS
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setManualMapProvider("google")}
                  className={[
                    "rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                    activeMapProvider === "google"
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  ].join(" ")}
                >
                  Google
                </button>
              </div>
            </div>
          )}

          <div ref={searchBoxWrapRef} className="relative">
            <input
              data-tour="map-search-input"
              value={modalValue}
              onChange={(e) => {
                const v = e.target.value;
                setModalValue(v);
                if (activeMapProvider === "google") {
                  setGoogleSearchMessage("");
                  setGoogleSearchResults([]);
                  return;
                }
                setSuggestOpen(true);
                setSuggestActive(-1);
                scheduleSuggest(v);
              }}
              onFocus={() => {
                if (activeMapProvider === "google") return;
                setSuggestOpen(true);
                scheduleSuggest(modalValue);
              }}
              onKeyDown={(e) => {
                if (activeMapProvider === "google" && e.key === "Enter") {
                  e.preventDefault();
                  runGoogleManualSearch();
                  return;
                }
                if (!suggestOpen) {
                  if (e.key === "ArrowDown" && suggestItems.length) {
                    setSuggestOpen(true);
                    setSuggestActive(0);
                  }
                  return;
                }

                if (e.key === "Escape") {
                  setSuggestOpen(false);
                  setSuggestActive(-1);
                  return;
                }

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSuggestActive((cur) =>
                    Math.min((cur < 0 ? 0 : cur + 1), suggestItems.length - 1)
                  );
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSuggestActive((cur) => Math.max((cur <= 0 ? 0 : cur - 1), 0));
                }

                if (e.key === "Enter") {
                  e.preventDefault();
                  if (suggestActive >= 0 && suggestItems[suggestActive]) {
                    selectSuggestItem(suggestItems[suggestActive]);
                  }
                }
              }}
              placeholder="Buscar ou Lat/Lng..."
              className="w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-200"
            />

            {activeMapProvider !== "google" && suggestOpen && suggestItems.length > 0 && (
              <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
                {suggestItems.map((it, idx) => (
                  <button
                    key={`${it.id ?? idx}`}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      selectSuggestItem(it);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className={[
                      "w-full px-2.5 py-1.5 text-left text-xs hover:bg-slate-50",
                      idx === suggestActive ? "bg-slate-50" : "",
                    ].join(" ")}
                  >
                    {it.address?.label || it.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeMapProvider === "google" && googleSearchMessage && (
            <div className="mt-1.5 text-xs font-medium text-slate-600">
              {googleSearchMessage}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (activeMapProvider === "google") runGoogleManualSearch();
                else runHereSearch(modalValue);
              }}
              disabled={activeMapProvider === "google" && googleSearchLoading}
              className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeMapProvider === "google" && googleSearchLoading ? "Buscando" : "Buscar"}
            </button>
          </div>

          {activeMapProvider === "google" && googleSearchResults.length > 0 && (
            <div className="mt-1.5 max-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {googleSearchResults.map((result, idx) => (
                <button
                  key={`${result.id}-${idx}`}
                  type="button"
                  onClick={() => selectGoogleSearchResult(result)}
                  className="block w-full border-b px-2.5 py-1.5 text-left last:border-b-0 hover:bg-slate-50"
                >
                  <div className="text-xs font-semibold text-slate-900">
                    {idx + 1}. {result.name}
                  </div>
                  {result.address && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] font-medium text-slate-500">
                      {result.address}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="mt-1.5 rounded-lg border bg-white px-2 py-1.5 text-[10px] text-slate-700">
            <div className="flex items-start justify-between gap-1.5">
              <div className="min-w-0 flex-1 truncate">
                <span className="font-semibold">GPS:</span>{" "}
                {pinLatLng ? `${pinLatLng.lat}, ${pinLatLng.lng}` : "-"}
                {pickedCep ? `  • CEP: ${pickedCep}` : ""}
                {pickedQuadra ? `  • Quadra: ${pickedQuadra}` : ""}
                {pickedLote ? `  • Lote: ${pickedLote}` : ""}
              </div>

              <button
                type="button"
                onClick={async () => {
                  const txt = pinLatLng ? `${pinLatLng.lat}, ${pinLatLng.lng}` : "";
                  if (txt) await copyTextWithFallback(txt);
                }}
                className="min-h-[28px] shrink-0 rounded-lg border bg-white px-2 py-0.5 text-[10px] hover:bg-slate-50"
              >
                Copiar
              </button>
            </div>
          </div>
        </div>

      {/* BOTÕES inferiores (se quiser manter como estava) */}
      <div className="hidden md:flex absolute left-2 right-2 md:left-auto md:right-4 bottom-2 md:bottom-4 z-30 flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <button
          type="button"
          onClick={closeManualModal}
          className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm"
        >
          Cancelar
        </button>

        <button
          type="button"
          onClick={confirmManualModal}
          className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-semibold"
        >
          Confirmar
        </button>
      </div>
      </div>
    </div>
    </div>
    </div>
    )}
      {duplicateImportModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.24)]">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
                Planilha já enviada
              </h2>
            </div>

            <div className="px-6 py-5 text-sm leading-6 text-slate-600">
              <p>
                Você já enviou essa planilha anteriormente. Acesse o histórico para continuar
                essa rota.
              </p>
            </div>

            <div className="flex justify-end border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setDuplicateImportModalOpen(false)}
                className="inline-flex items-center justify-center rounded-2xl bg-[#17313b] px-4 py-3 text-sm font-semibold text-white hover:bg-[#10242c]"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
        </main>
    );
    }
export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}
