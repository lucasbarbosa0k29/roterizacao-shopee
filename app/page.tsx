"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import bbox from "@turf/bbox";
import dynamic from "next/dynamic";
import { getHistory, saveHistory, updateHistory } from "./lib/history";
import { useSearchParams } from "next/navigation";

const AparecidaArcgisMap = dynamic(
  () => import("./components/AparecidaArcgisMap"),
  { ssr: false }
);

type Status = "OK" | "PARCIAL" | "NAO_ENCONTRADO" | "MANUAL" | "CONFIRMADO";

type RowItem = {
  sequence?: any;
  bairro?: any;
  city?: any;
  cep?: any;
  original?: string;
  normalizedLine?: string;
  status?: "OK" | "PARCIAL" | "NAO_ENCONTRADO";
  lat?: number | null;
  lng?: number | null;

  // vindo do /api/process
  notesAuto?: string; // ✅ complemento limpo
  quadraAuto?: string;
  loteAuto?: string;
  normalized?: any;
};

type ManualEdit = {
  address: string;
  lat?: number;
  lng?: number;
  quadra?: string;
  lote?: string;
  notes?: string;
  confirmed?: boolean;
};

type GroupedRow = {
  id: string;
  idxs: number[];
  sequenceText: string;
  status: Status;
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

function makeId(prefix = "grp") {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function HomeInner() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RowItem[]>([]);
  const [view, setView] = useState<"upload" | "results">("upload");
 const [historyId, setHistoryId] = useState<string | null>(null);
  const [manualEdits, setManualEdits] = useState<Record<number, ManualEdit>>({});
const searchParams = useSearchParams();
const hid = searchParams.get("history");
  // grupos manuais
  const [manualGroups, setManualGroups] = useState<Record<string, number[]>>({});

  // auto agrupar
  const [autoGrouped, setAutoGrouped] = useState(false);
  const [autoBreakIds, setAutoBreakIds] = useState<Set<string>>(new Set());

  // modo agrupar manual (selecionar)
  const [groupMode, setGroupMode] = useState(false);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());
useEffect(() => {
  if (!hid) return;

  const saved = getHistory(hid);
  if (!saved) return;

  setHistoryId(saved.id);
  setFile(null);
  setRows(saved.rows || []);
  setManualEdits(saved.manualEdits || {});
  setManualGroups(saved.manualGroups || {});
  setAutoGrouped(!!saved.autoGrouped);
  setAutoBreakIds(new Set((saved.autoBreakIds || []).map(String)));
  setGroupMode(!!saved.groupMode);
  setSelectedIdxs(new Set(saved.selectedIdxs || []));
  setView("results");

  // ✅ limpa a URL sem resetar o state
  window.history.replaceState({}, "", window.location.pathname);
}, [hid]);
useEffect(() => {
 if (!historyId || hid) return;

  const t = setTimeout(() => {
    updateHistory(historyId, {
      rows,
      manualEdits,
      manualGroups,
      autoGrouped,
      autoBreakIds: Array.from(autoBreakIds),
      groupMode,
      selectedIdxs: Array.from(selectedIdxs),
      view,
      name: file?.name || "Planilha",
    });
  }, 400);

  return () => clearTimeout(t);
}, [
  historyId,
  rows,
  manualEdits,
  manualGroups,
  autoGrouped,
  autoBreakIds,
  groupMode,
  selectedIdxs,
  view,
  file,
]);
  // menu do botão direito
  const [ctx, setCtx] = useState<{ open: boolean; x: number; y: number; groupId: string | null }>({
    open: false,
    x: 0,
    y: 0,
    groupId: null,
  });

  // export review modal
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportDraft, setExportDraft] = useState<ExportDraftRow[]>([]);

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

  const [pinLatLng, setPinLatLng] = useState<{ lat: number; lng: number } | null>(null);
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
        // opcional
        // setPickedLabel(`Quadra ${data.quadra} Lote ${data.lote}`);
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

  // ===== overlay quadra/lote (polígonos) =====


  // anti-duplo clique / aborts
  const clickGateRef = useRef({ t: 0, lat: 0, lng: 0 });
  const abortReverseRef = useRef<AbortController | null>(null);
  const abortLotRef = useRef<AbortController | null>(null);
  // ===== debounce overlay (ANTI-SPAM) =====
 
    // ===== anti-freeze (clique no mapa) =====
  
  const pinFromTapRef = useRef(false);
  const clickFetchDebounceRef = useRef<any>(null);

  function isAparecidaCity(v: any) {
    const s = String(v || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return s.includes("APARECIDA");
  }

  const useArcgisInModal =
    isModalOpen &&
    modalIdx !== null &&
    isAparecidaCity(rows?.[modalIdx]?.city);

  // ===== AUTOSUGGEST (dropdown estilo Waze) =====
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestItems, setSuggestItems] = useState<HereSuggestItem[]>([]);
  const [suggestActive, setSuggestActive] = useState(-1);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const suggestTimerRef = useRef<any>(null);
  const searchBoxWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown() {
      setCtx((c) => (c.open ? { ...c, open: false } : c));
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

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

    if (manual?.confirmed) return "CONFIRMADO"; // ✅ verde
    if (manual) return "MANUAL"; // manual não confirmado

    return (rows[i]?.status || "NAO_ENCONTRADO") as Status;
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

  // ✅ complemento default (Gemini -> notesAuto) sem Q/L
  function getRowComplement(i: number) {
    const manual = String(manualEdits[i]?.notes || "").trim();
    if (manual) return stripQuadraLoteFromNotes(manual);

    const auto = String((rows[i] as any)?.notesAuto || "").trim();
    if (auto) return stripQuadraLoteFromNotes(auto);

    return "";
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

    // ✅ AUTO GROUPING
    if (autoGrouped) {
      const autoBuckets = new Map<string, number[]>();

      for (const idx of notInManual) {
        const addr = getShownAddress(idx);
        const city = String(rows[idx]?.city || "");
        const key = makeAutoGroupKey({ address: addr, city });

        const arr = autoBuckets.get(key) || [];
        arr.push(idx);
        autoBuckets.set(key, arr);
      }

      for (const [k, idxs] of autoBuckets.entries()) {
        const id = `auto_${k}`;
        if (autoBreakIds.has(id) || idxs.length <= 1) singles.push(...idxs);
        else groupItems.push({ id, idxs: idxs.slice().sort((a, b) => a - b) });
      }
    } else {
      singles.push(...notInManual);
    }

    // manual groups entram
    for (const [gid, idxs] of manualGroupBuckets.entries()) {
      const s = idxs.slice().sort((a, b) => a - b);
      if (s.length >= 2) groupItems.push({ id: gid, idxs: s });
      else singles.push(...s);
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

      const baseIdx = idxs[0];

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

      return {
        id: g.id,
        idxs,
        sequenceText,
        status,
        addressDisplay,
        addressForExport,
        bairro,
        city,
        cep,
        lat,
        lng,
        notes: getRowComplement(baseIdx),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, manualEdits, manualGroups, autoGrouped, autoBreakIds]);

  // ===== Import =====
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return alert("Selecione uma planilha");

    setLoading(true);
    setManualEdits({});
    setManualGroups({});
    setAutoGrouped(false);
    setAutoBreakIds(new Set());
    setGroupMode(false);
    setSelectedIdxs(new Set());
    setIsExportOpen(false);
    setExportDraft([]);

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
        alert(dataImport?.error || "Erro no import");
        return;
      }
      // 🔒 garante que o import trouxe linhas válidas
      if (!Array.isArray(dataImport?.rows) || dataImport.rows.length === 0) {
        alert("Import veio vazio (rows). Verifique a planilha/colunas.");
        return;
      }
      // 2) PROCESSA (Gemini + HERE + ArcGIS)
      const resProcess = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: dataImport.rows,
        }),
      });
      const dataProcess = await resProcess.json();

      if (!resProcess.ok) {
        alert(dataProcess?.error || "Erro no processamento");
        return;
      }

      // ✅ AGORA rows vem completos (status, lat, lng, quadra, lote…)
      setRows(dataProcess.rows || []);
      setView("results");
      // ✅ salva no histórico (expira em 24h pelo history.ts)
const id =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());
setHistoryId(id);
saveHistory({
  id,
  name: file?.name || "Planilha sem nome",
  savedAt: Date.now(),

  rows: dataProcess.rows || [],
  manualEdits,
  manualGroups,
  autoGrouped,
  autoBreakIds: Array.from(autoBreakIds),
  groupMode,
selectedIdxs: Array.from(selectedIdxs),
view: "results",
});
    } finally {
      setLoading(false);
    }
  }

  // ===== Export review =====
  function openExportReview() {
    const draft: ExportDraftRow[] = groupedRows.map((g) => {
      const baseIdx = g.idxs[0];

      // ✅ Observações começam como: "Sequência - Endereço ORIGINAL (Excel)"
      const obsInicial = `${g.sequenceText} - ${getShownAddress(baseIdx)}`.trim();

      return {
        groupId: g.id,
        sequence: g.sequenceText,

        // endereço que vai no CSV (se tiver manual, usa manual; senão original)
        addressRef: g.addressForExport,
        addressOriginal: getShownAddress(baseIdx),

        lat: g.lat,
        lng: g.lng,

        // mantém (você ainda consegue editar na tela)
        quadra: getRowQuadra(baseIdx),
        lote: getRowLote(baseIdx),

        // ✅ vai aparecer na coluna "OBSERVAÇÕES (EDITÁVEL)"
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
    a.download = "circuit.csv";
    a.click();
    URL.revokeObjectURL(url);

    setIsExportOpen(false);
  }

  // ===== agrupamento manual =====
  function enterGroupModeWithFirst(idx: number) {
    setGroupMode(true);
    setSelectedIdxs(new Set([idx]));
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
  }

  function unifySelected() {
    const idxs = Array.from(selectedIdxs).sort((a, b) => a - b);
    if (idxs.length < 2) return alert("Selecione pelo menos 2 linhas.");

    const nextGroups: Record<string, number[]> = {};
    for (const [gid, gIdxs] of Object.entries(manualGroups)) {
      const filtered = gIdxs.filter((x) => !idxs.includes(x));
      if (filtered.length >= 2) nextGroups[gid] = filtered;
    }

    const newId = makeId("manual");
    nextGroups[newId] = idxs;
    setManualGroups(nextGroups);

    setGroupMode(false);
    setSelectedIdxs(new Set());
  }

  // ===== desagrupar via botão direito =====
  function ungroup(groupId: string) {
    if (groupId.startsWith("auto_")) {
      setAutoBreakIds((prev) => new Set(prev).add(groupId));
      return;
    }
    if (manualGroups[groupId]) {
      const next = { ...manualGroups };
      delete next[groupId];
      setManualGroups(next);
    }
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

    setIsModalOpen(true);
  }

  function closeManualModal() {
    setIsModalOpen(false);
    setModalIdx(null);
    setSuggestOpen(false);
    setSuggestItems([]);
    setSuggestActive(-1);
  }

  function confirmManualModal() {
    if (modalIdx === null) return;

    setManualEdits((prev) => ({
      ...prev,
      [modalIdx]: {
        ...prev[modalIdx],
        address: modalValue,
        lat: pinLatLng?.lat,
        lng: pinLatLng?.lng,
        quadra: pickedQuadra || prev[modalIdx]?.quadra || "",
        lote: pickedLote || prev[modalIdx]?.lote || "",
        confirmed: true, // ✅ AQUI
      },
    }));

    setIsModalOpen(false);
    setModalIdx(null);
    setSuggestOpen(false);
    setSuggestItems([]);
    setSuggestActive(-1);
  }

  async function reverseGeocodeServer(lat: number, lng: number) {
    if (abortReverseRef.current) abortReverseRef.current.abort();
    const ac = new AbortController();
    abortReverseRef.current = ac;

    const res = await fetch(`/api/reverse?lat=${lat}&lng=${lng}`, { signal: ac.signal }).catch(() => null);
    if (!res || !res.ok) return;
    const data = await res.json().catch(() => null);
    if (!data) return;

    const label = data?.label || data?.address?.label || "";
    const cepFound = data?.address?.cep || data?.address?.postalCode || "";

    setPickedLabel(label);
    setPickedCep(cepFound);
    if (!modalCep && cepFound) setModalCep(cepFound);
  }

  async function fetchQuadraLote(lat: number, lng: number) {
    if (abortLotRef.current) abortLotRef.current.abort();
    const ac = new AbortController();
    abortLotRef.current = ac;

    const res = await fetch(`/api/aparecida/lot?lat=${lat}&lng=${lng}`, { signal: ac.signal }).catch(() => null);
    if (!res || !res.ok) return;
    const data = await res.json().catch(() => null);
    if (!data) return;

    const q = String(data?.quadra || "");
    const l = String(data?.lote || "");

    setPickedQuadra(q);
    setPickedLote(l);

    if (modalIdx !== null) {
      setManualEdits((prev) => ({
        ...prev,
        [modalIdx]: {
          ...prev[modalIdx],
          address: prev[modalIdx]?.address || getShownAddress(modalIdx),
          lat: pinLatLng?.lat,
          lng: pinLatLng?.lng,
          quadra: q,
          lote: l,
        },
      }));
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

      if (!w || !h) {
        console.log("[overlay] bbox: sem tamanho", { w, h, rect });
        return null;
      }

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

      if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) {
        console.log("[overlay] bbox: coords invalidas", { tl, tr, bl, br });
        return null;
      }

      return { minLat, maxLat, minLng, maxLng };
    } catch (e) {
      console.log("[overlay] bbox: erro", e);
      return null;
    }
  }
  


    function runHereSearch(forceQ?: string) {
     const H = typeof window !== "undefined" ? (window as any).H : null;
if (!H) return;
      if (!H || !searchRef.current || !hereMap.current) return;

      const idx = modalIdx ?? 0;
      const city = String(rows?.[idx]?.city || "Goiânia");
      const bairro = String(rows?.[idx]?.bairro || "");
      const cep = String(modalCep || "").trim();

      let q = (forceQ ?? modalValue).trim();
      if (cep && !q.includes(cep)) q = `${q}, ${cep}`;
      if (bairro && !q.toLowerCase().includes(bairro.toLowerCase())) q = `${q}, ${bairro}`;
      if (city && !q.toLowerCase().includes(city.toLowerCase())) q = `${q}, ${city}, GO`;

      const at = pinLatLng ? `${pinLatLng.lat},${pinLatLng.lng}` : "-16.8233,-49.2439";
      searchRef.current.geocode(
        { q, at, lang: "pt-BR" },
        async (res: any) => {
          const item = res?.items?.[0];
          if (!item?.position) return;

          const pos = item.position;

          setPinLatLng({ lat: pos.lat, lng: pos.lng });
          hereMap.current.setCenter(pos);
          hereMap.current.setZoom(17);
          if (markerRef.current) markerRef.current.setGeometry(pos);
          const label = item?.address?.label || item?.title || "";
          const cepFound = item?.address?.postalCode || "";
          setPickedLabel(label);
          setPickedCep(cepFound);
          if (!modalCep && cepFound) setModalCep(cepFound);

          fetchQuadraLote(pos.lat, pos.lng);
        },
        () => { }
      );
    }

    async function fetchSuggest(qRaw: string) {
      const apiKey = (process.env.NEXT_PUBLIC_HERE_API_KEY || "").trim();
      if (!apiKey) return;

      if (qRaw.trim().length < 2) {
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
        const city = String(rows?.[idx]?.city || "Goiânia");
        const bairro = String(rows?.[idx]?.bairro || "");

        let q = qRaw.trim();

        const at =
          pinLatLng
            ? `${pinLatLng.lat},${pinLatLng.lng}`
            : rows?.[idx]?.lat && rows?.[idx]?.lng
              ? `${rows[idx].lat},${rows[idx].lng}`
              : "-16.8233,-49.2439";

        const url = new URL("https://autosuggest.search.hereapi.com/v1/autosuggest");
        url.searchParams.set("q", q);
        url.searchParams.set("at", at);
        url.searchParams.set("lang", "pt-BR");
        url.searchParams.set("limit", "6");
        url.searchParams.set("in", "countryCode:BRA");
        url.searchParams.set("apiKey", apiKey);

        const res = await fetch(url.toString(), { signal: ac.signal });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
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
      suggestTimerRef.current = setTimeout(() => fetchSuggest(q), 250);
    }

    function selectSuggestItem(item: HereSuggestItem) {
      const label = item?.address?.label || item?.title || "";
      if (!label) return;

      setModalValue(label);
      setSuggestOpen(false);
      setSuggestItems([]);
      setSuggestActive(-1);

      if (item.position?.lat && item.position?.lng) {
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

        reverseGeocodeServer(pos.lat, pos.lng);
        fetchQuadraLote(pos.lat, pos.lng);
        return;
      }

      runHereSearch(label);
    }

    // ===== cria mapa 1 vez =====
    useEffect(() => {
      if (!isModalOpen || !mapRef.current) return;

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
      });

      const behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map));

const ui = H.ui.UI.createDefault(map, layers);
ui.removeControl("mapsettings"); // <- remove o menu que costuma buggar
ui.getControl("mapsettings")?.setDisabled(true); // opcional: desliga menu mapa

      hereMap.current = map;


      // ✅ força o HERE Map calcular tamanho real (ESSENCIAL em modal)
      setTimeout(() => map.getViewPort().resize(), 50);
      setTimeout(() => map.getViewPort().resize(), 150);

  

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



          // ✅ debounce dos fetch (reverse + quadra/lote) para evitar “telar”
          if (clickFetchDebounceRef.current) clearTimeout(clickFetchDebounceRef.current);
          clickFetchDebounceRef.current = setTimeout(() => {
            reverseGeocodeServer(geo.lat, geo.lng);
            fetchQuadraLote(geo.lat, geo.lng);
          }, 220);

        } catch (err) {
          console.log("[HERE TAP] erro ignorado:", err);
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
    }, [isModalOpen]);
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
    // ===== UI =====
    if (!mounted) return null;
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="w-full px-6 py-6">
     {view === "upload" && rows.length === 0 && (
  <form onSubmit={handleSubmit} className="w-full">
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">
        Importação de Dados
      </h1>
      <p className="text-sm text-slate-600 mb-6">
        Selecione a planilha da Shopee para iniciar o processamento.
      </p>

      <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* INPUT PLANILHA */}
          <label className="flex-1 cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 transition p-5">
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-600/10 flex items-center justify-center text-xl">
                ⬆️
              </div>

              <div className="min-w-0">
                <div className="font-semibold text-slate-900">
                  Selecionar Planilha
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
            className="h-[84px] md:w-[180px] rounded-2xl bg-blue-600 text-white font-semibold text-lg shadow-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Processando..." : "Buscar"}
          </button>
        </div>

        {loading && (
          <p className="mt-4 text-sm text-slate-500">
            Processando...
          </p>
        )}
      </div>
    </div>
  </form>
)}
          {view === "results" && rows.length > 0 && (
  <div className="w-full">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
  <div className="text-sm text-slate-600">
    Total: <b className="text-slate-900">{rows.length}</b> • Exibindo:{" "}
    <b className="text-slate-900">{groupedRows.length}</b>
  </div>

  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={() => setAutoGrouped((v) => !v)}
      className={`px-3 py-2 rounded-lg text-sm font-semibold border transition ${
        autoGrouped
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
      }`}
    >
      Auto Agrupar
    </button>

    <button
      type="button"
      onClick={openExportReview}
      className="px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
    >
      Exportar
    </button>

    <button
      type="button"
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
      }}
      className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-200 hover:bg-slate-300 text-slate-800 transition"
    >
      Importar outra planilha
    </button>
  </div>
</div>
             <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm mt-4">
  <div className="w-full overflow-x-auto">
   <table className="w-full text-sm text-slate-900 table-fixed">
      <thead className="bg-slate-100 text-slate-700">
       <tr className="border-b border-slate-200">
  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[120px]">
    Status
  </th>

  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[120px]">
    Sequence
  </th>

  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide min-w-[360px]">
    Destination Address
  </th>

  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[200px]">
    Bairro
  </th>

  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[160px]">
    City
  </th>

  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[140px]">
    Ação
  </th>
</tr>
      </thead>

      <tbody className="[&>tr:nth-child(even)]:bg-slate-50"></tbody>

                    <tbody>
                      {groupedRows.map((g) => {
                        const isGrouped = g.idxs.length > 1;
                        const baseIdx = g.idxs[0];

                        return (
                          <tr
  key={g.id}
  className={
  "border-b border-slate-200 hover:bg-slate-50 transition-colors " +
  (g.idxs.some((i) => manualEdits[i]?.confirmed)
    ? "bg-green-100"
    : "odd:bg-white even:bg-slate-50")
}
                            onContextMenu={(e) => {
                              if (!isGrouped) return;
                              e.preventDefault();
                              setCtx({ open: true, x: e.clientX, y: e.clientY, groupId: g.id });
                            }}
                            title={isGrouped ? "Botão direito para desagrupar" : ""}
                          >
                            <td className="px-4 py-4 align-top">
                              <span
                                className={
                                  "px-2 py-1 rounded text-xs " +
                                  (g.status === "CONFIRMADO" || g.status === "OK"
  ? "bg-green-100 text-green-900"
                                    : g.status === "PARCIAL"
                                      ? "bg-yellow-100 text-yellow-800"
                                      : g.status === "MANUAL"
                                        ? "bg-blue-100 text-blue-800"
                                        : "bg-red-100 text-red-800")
                                }
                              >
                                {g.status}
                              </span>
                            </td>

                            <td className="px-4 py-4 align-top font-medium">{g.sequenceText}</td>

                           <td className="px-4 py-4 align-top whitespace-nowrap overflow-hidden text-ellipsis max-w-[520px]">
                              <span className="block whitespace-nowrap overflow-hidden text-ellipsis">
  {g.addressDisplay}
</span>
                              {isGrouped && (
                                <div className="text-xs text-slate-600 mt-1">
                                  Agrupado ({g.idxs.length})
                                </div>
                              )}
                            </td>

                           <td className="px-4 py-4 align-top">{g.bairro}</td>
                            <td className="px-4 py-4 align-top">{g.city}</td>

                            <td className="px-4 py-4 align-top">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openManualModalForIdx(baseIdx)}
                                  className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
                                  title="Mapa / Correção"
                                >
                                  📍
                                </button>

                                {!groupMode && !isGrouped && (
                                  <button
                                    type="button"
                                    onClick={() => enterGroupModeWithFirst(baseIdx)}
                                    className="px-2 py-1 rounded bg-white border hover:bg-slate-50 text-xs"
                                    title="Agrupar manualmente"
                                  >
                                    +
                                  </button>
                                )}

                                {groupMode && !isGrouped && (
                                  <label className="text-xs flex items-center gap-2 select-none">
                                    <input
                                      type="checkbox"
                                      checked={selectedIdxs.has(baseIdx)}
                                      onChange={() => toggleSelectIdx(baseIdx)}
                                    />
                                    Selecionar
                                  </label>
                                )}

                                {isGrouped && (
                                  <span className="text-xs text-slate-500">Botão direito</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                 {groupMode && (
  <div className="fixed bottom-5 left-[260px] right-6 z-[9999]">
    <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white/90 backdrop-blur shadow-lg px-4 py-3 flex items-center justify-between gap-3">
      <div className="text-sm text-slate-700">
        <b>{selectedIdxs.size}</b> Selecionados
      </div>

      <div className="flex items-center gap-2">
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
                </div>
              </div>

              {/* Context menu */}
              {ctx.open && ctx.groupId && (
                <div
                  style={{ position: "fixed", left: ctx.x, top: ctx.y, zIndex: 9999 }}
                  className="bg-white border shadow-lg rounded-md overflow-hidden text-sm"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    className="px-4 py-2 hover:bg-slate-100 w-full text-left"
                    onClick={() => {
                      ungroup(ctx.groupId!);
                      setCtx({ open: false, x: 0, y: 0, groupId: null });
                    }}
                  >
                    Desagrupar
                  </button>
                </div>
              )}

              {/* Export review modal */}
              {isExportOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                  <div className="w-full max-w-6xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
                    {/* Header */}
                    <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="text-xl">📄</div>
                        <div>
                          <div className="text-base font-semibold text-slate-800">
                            Exportação Circuit
                          </div>
                          <div className="text-sm text-slate-500">
                            Configure o formato das observações antes de gerar o CSV.
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setIsExportOpen(false)}
                        className="text-slate-500 hover:text-slate-800 text-xl px-2"
                        title="Fechar"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Step box (igual route planner) */}
                    <div className="px-6 pt-6">
                      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5">
                        <div className="flex items-center gap-3">
                          <div className="h-7 w-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold">
                            ✓
                          </div>
                          <div className="font-semibold text-slate-800">
                            Passo 1: Selecione o conteúdo da coluna "Observações"
                          </div>
                        </div>

                        <div className="mt-4 flex gap-3">
                          <button
                            type="button"
                            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left opacity-60 cursor-not-allowed"
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
                            className="flex-1 rounded-xl border-2 border-indigo-300 bg-white px-4 py-3 text-left"
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

                    {/* Table */}
                    <div className="px-6 pt-4 pb-2">
                      <div
                        className="overflow-auto rounded-xl border border-slate-200"
                        style={{ maxHeight: "60vh" }}
                      >
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-100 text-slate-700 sticky top-0">
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
                                <tr key={r.groupId ?? idx} className="odd:bg-white even:bg-slate-50">
                                  <td className="p-3 border-b text-slate-700">{latStr}</td>
                                  <td className="p-3 border-b text-slate-700">{lngStr}</td>

                                  <td className="p-3 border-b">
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
                                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-300"
                                      placeholder="Observações (endereço original, referência, casa/apto...)"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between mt-4">
                        <div className="text-sm text-slate-600">
                          Total de <b>{exportDraft.length}</b> pontos agrupados
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setIsExportOpen(false)}
                            className="px-5 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-sm"
                          >
                            Cancelar
                          </button>

                          <button
                            type="button"
                            onClick={confirmExportCircuit}
                            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
                          >
                            Confirmar e Exportar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal mapa */}
              {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl overflow-hidden border border-slate-200">
                    <div className="p-4 border-b flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm text-slate-700 font-medium">Correção Manual</div>
                        <div className="text-sm text-gray-500">Busque, clique no mapa e confirme.</div>
                      </div>

                      <div className="text-sm">
                        <span className="text-gray-500 mr-2">CEP:</span>
                        <input
                          value={modalCep}
                          onChange={(e) => setModalCep(e.target.value)}
                          className="border rounded px-2 py-1 text-sm w-[130px]"
                          placeholder="00000-000"
                        />
                      </div>
                    </div>

                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div className="rounded border p-3">
                          <div className="text-xs text-gray-500 mb-1">ORIGINAL</div>
                          <div className="text-sm">{modalOriginal}</div>
                        </div>

                        <div className="rounded border p-3 bg-green-50">
                          <div className="text-xs text-gray-500 mb-1">BUSCA</div>

                          <div ref={searchBoxWrapRef} className="relative">
                            <input
                              value={modalValue}
                              onChange={(e) => {
                                const v = e.target.value;
                                setModalValue(v);
                                setSuggestOpen(true);
                                setSuggestActive(-1);
                                scheduleSuggest(v);
                              }}
                              onFocus={() => {
                                setSuggestOpen(true);
                                scheduleSuggest(modalValue);
                              }}
                              onKeyDown={(e) => {
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
                                  return;
                                }

                                if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  setSuggestActive((cur) =>
                                    Math.max((cur < 0 ? 0 : cur - 1), 0)
                                  );
                                  return;
                                }

                                if (e.key === "Enter") {
                                  if (suggestItems.length && suggestActive >= 0 && suggestItems[suggestActive]) {
                                    e.preventDefault();
                                    selectSuggestItem(suggestItems[suggestActive]);
                                    return;
                                  }
                                  setSuggestOpen(false);
                                  setSuggestActive(-1);
                                  runHereSearch();
                                }
                              }}
                              className="w-full border rounded px-3 py-2 text-sm bg-white"
                              placeholder="Digite rua..."
                            />

                            {suggestOpen && (suggestLoading || suggestItems.length > 0 || modalValue.trim().length >= 2) && (
                              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[9999]">
                                <div className="bg-white border rounded-lg shadow-lg overflow-hidden">
                                  {suggestLoading && (
                                    <div className="px-3 py-2 text-xs text-slate-600 border-b">Buscando sugestões…</div>
                                  )}

                                  {suggestItems.length === 0 && !suggestLoading && modalValue.trim().length >= 2 && (
                                    <div className="px-3 py-2 text-xs text-slate-600">Nenhuma sugestão</div>
                                  )}

                                  {suggestItems.length > 0 && (
                                    <ul className="max-h-56 overflow-auto">
                                      {suggestItems.map((it, i) => {
                                        const label = it?.address?.label || it?.title || "";
                                        const sub =
                                          [
                                            it?.address?.district || "",
                                            it?.address?.city || "",
                                            it?.address?.state || "",
                                            it?.address?.postalCode || "",
                                          ]
                                            .filter(Boolean)
                                            .join(" • ") || "";

                                        const active = i === suggestActive;

                                        return (
                                          <li key={(it.id || "") + "_" + i}>
                                            <button
                                              type="button"
                                              className={
                                                "w-full text-left px-3 py-2 hover:bg-slate-100 " +
                                                (active ? "bg-slate-100" : "")
                                              }
                                              onMouseEnter={() => setSuggestActive(i)}
                                              onMouseDown={(e) => e.preventDefault()}
                                              onClick={() => selectSuggestItem(it)}
                                            >
                                              <div className="text-sm text-slate-900 truncate">{label}</div>
                                              {sub && <div className="text-xs text-slate-600 truncate">{sub}</div>}
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSuggestOpen(false);
                                setSuggestActive(-1);
                                runHereSearch();
                              }}
                              className="flex-1 rounded bg-green-600 text-white py-2 text-sm hover:bg-green-700"
                            >
                              Buscar
                            </button>

                            <button
                              type="button"
                              onClick={confirmManualModal}
                              className="flex-1 rounded bg-blue-600 text-white py-2 text-sm hover:bg-blue-700"
                            >
                              Confirmar
                            </button>
                          </div>

                          <div className="mt-2 text-xs text-slate-700 bg-white border rounded p-2 flex items-center justify-between gap-2">
                            <div className="truncate">
                              <b>Coords:</b>{" "}
                              {pinLatLng ? `${pinLatLng.lat.toFixed(6)}, ${pinLatLng.lng.toFixed(6)}` : "-"}
                              {"  "}•{"  "}
                              <b>CEP:</b> {pickedCep || modalCep || "-"}
                              {"  "}•{"  "}
                              <b>Quadra:</b> {pickedQuadra || "-"}
                              {"  "}•{"  "}
                              <b>Lote:</b> {pickedLote || "-"}
                            </div>

                            <button
                              type="button"
                              className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                              onClick={() => {
                                if (!pinLatLng) return;
                                const txt = `${pinLatLng.lat.toFixed(6)}, ${pinLatLng.lng.toFixed(6)}`;
                                navigator.clipboard.writeText(txt);
                              }}
                            >
                              Copiar
                            </button>
                          </div>

                          {pickedLabel && (
                            <div className="text-xs text-slate-600 mt-2">
                              <b>Endereço encontrado:</b> {pickedLabel}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* MAPA */}
                      <div className="rounded border overflow-hidden">
                        <div className="px-3 py-2 text-xs text-gray-500 border-b">
                          Mapa ({useArcgisInModal ? "ArcGIS" : "HERE"})
                        </div>

                        {useArcgisInModal ? (
                          <AparecidaArcgisMap
                            center={pinLatLng}
                            onPick={({ lat, lng }) => {
                              // 1) move o pin
                              setPinLatLng({ lat, lng });

                              // 2) limpa label (ArcGIS não retorna label)
                              setPickedLabel("");

                              // 3) busca quadra/lote pelo seu backend
                              buscarQuadraLote(lat, lng);
                            }}
                          />
                        ) : (
                          <div ref={mapRef} className="w-full h-[420px] bg-white" />
                        )}
                      </div>
                    </div>

                    {/* BOTÕES */}
                    <div className="p-4 border-t flex items-center justify-end gap-2">
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
                        className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm"
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>   {/* fecha mx-auto max-w-6xl px-4 py-6 */}
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