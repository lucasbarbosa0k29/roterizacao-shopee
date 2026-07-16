import assert from "node:assert/strict";

const { applyManualCoordinateToState } = (await import(
  new URL("../app/lib/manual-correction-persistence.ts", import.meta.url).href
)) as typeof import("../app/lib/manual-correction-persistence");

type Row = {
  original: string;
  city: string;
  source: string;
  lat: number;
  lng: number;
  status: string;
};

type ManualEdit = {
  lat?: number;
  lng?: number;
  confirmed?: boolean;
};

const manualCoord = { lat: -16.700123, lng: -49.301234 };
const cases: Row[] = [
  { original: "Aparecida HERE", city: "Aparecida de Goiania", source: "HERE_GEOCODE", lat: -16.81, lng: -49.24, status: "OK" },
  { original: "Goiania ArcGIS", city: "Goiania", source: "HERE_GEOCODE", lat: -16.68, lng: -49.26, status: "OK" },
  { original: "Trindade ArcGIS", city: "Trindade", source: "LOCALFIRST_TRINDADE", lat: -16.65, lng: -49.49, status: "PARCIAL" },
  { original: "Hidrolandia ArcGIS", city: "Hidrolandia", source: "ARCGIS_MANUAL", lat: -16.96, lng: -49.22, status: "PARCIAL" },
  { original: "Cidade comum", city: "Rio Verde", source: "HERE_GEOCODE", lat: -17.79, lng: -50.92, status: "OK" },
  { original: "Memory", city: "Goiania", source: "MEMORY", lat: -16.69, lng: -49.28, status: "OK" },
];

function modalOpenCoord(row: Row, manualEdit?: ManualEdit) {
  return {
    lat: typeof manualEdit?.lat === "number" ? manualEdit.lat : row.lat,
    lng: typeof manualEdit?.lng === "number" ? manualEdit.lng : row.lng,
  };
}

function exportCoord(row: Row, manualEdit?: ManualEdit) {
  return {
    lat: typeof manualEdit?.lat === "number" ? manualEdit.lat : row.lat,
    lng: typeof manualEdit?.lng === "number" ? manualEdit.lng : row.lng,
  };
}

for (const [idx, row] of cases.entries()) {
  const before = modalOpenCoord(row, undefined);
  assert.notDeepEqual(before, manualCoord, `${row.city}/${row.source}: setup must start at old coordinate`);

  const next = applyManualCoordinateToState({
    rows: cases,
    manualEdits: {},
    idxsToApply: [idx],
    coord: manualCoord,
  });

  assert.deepEqual(
    { lat: next.rows[idx].lat, lng: next.rows[idx].lng },
    manualCoord,
    `${row.city}/${row.source}: row coordinate must become manual`,
  );
  assert.deepEqual(
    { lat: next.manualEdits[idx].lat, lng: next.manualEdits[idx].lng },
    manualCoord,
    `${row.city}/${row.source}: manual edit coordinate must become manual`,
  );
  assert.equal(next.rows[idx].status, "CONFIRMADO", `${row.city}/${row.source}: row must be confirmed`);
  assert.equal(next.manualEdits[idx].confirmed, true, `${row.city}/${row.source}: manual edit must be confirmed`);

  const reopened = modalOpenCoord(next.rows[idx], next.manualEdits[idx]);
  const reloaded = modalOpenCoord(
    JSON.parse(JSON.stringify(next.rows[idx])),
    JSON.parse(JSON.stringify(next.manualEdits[idx])),
  );
  const exported = exportCoord(next.rows[idx], next.manualEdits[idx]);

  assert.deepEqual(reopened, manualCoord, `${row.city}/${row.source}: reopened modal must use manual`);
  assert.deepEqual(reloaded, manualCoord, `${row.city}/${row.source}: reloaded route must use manual`);
  assert.deepEqual(exported, manualCoord, `${row.city}/${row.source}: export must use manual`);
}

console.log("manual-correction-persistence: ok");
