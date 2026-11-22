import { isShopeeGpsCity } from "./shopee-gps-scope";

export type DeliveryStatus = "OK" | "PARCIAL" | "NAO_ENCONTRADO" | "CONFIRMADO";

type Delivery = {
  status?: unknown;
  sequence?: unknown;
  city?: unknown;
  source?: unknown;
  lat?: unknown;
  lng?: unknown;
  latFromSheet?: unknown;
  lngFromSheet?: unknown;
  geocodeConfidenceHardMismatch?: unknown;
  shopeeGpsValidation?: unknown;
  shopeeGpsRecoveryRejectedReason?: unknown;
  decisionReason?: unknown;
  shopeeGpsValidationRejectedReason?: unknown;
  localFirstInspectApplied?: boolean;
  localFirstTrindadeUsedAsFinal?: boolean;
  matchType?: unknown;
  trindadeShadow?: { matchedLayer?: string; localFirstAppliedAsFinal?: boolean };
  trindadeShadowAudit?: Delivery["trindadeShadow"];
};

type ManualEvidence = {
  lat?: number;
  lng?: number;
  confirmed?: boolean;
  mapConfirmation?: { jobId: string; index: number; sequence: string };
};

function validPoint(lat: unknown, lng: unknown) {
  return typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    lat !== 0 && lng !== 0;
}

export function deliveryStatus(row: Delivery, edit: ManualEvidence | undefined, jobId: string | null, index: number): DeliveryStatus {
  const proof = edit?.mapConfirmation;
  if (jobId && proof?.jobId === jobId && proof.index === index &&
      proof.sequence === String(row.sequence ?? "") && edit?.confirmed &&
      validPoint(edit.lat, edit.lng) && edit.lat === row.lat && edit.lng === row.lng) return "CONFIRMADO";
  if (edit?.lat != null && edit.lng != null && (edit.lat !== row.lat || edit.lng !== row.lng)) {
    return validPoint(edit.lat, edit.lng) ? "PARCIAL" : "NAO_ENCONTRADO";
  }
  if (!validPoint(row.lat, row.lng)) return "NAO_ENCONTRADO";
  if (row.source === "SHOPEE_GPS" && isShopeeGpsCity(String(row.city ?? ""))) {
    const accepted = row.shopeeGpsValidation === "ACCEPTED" || row.decisionReason === "SHOPEE_GPS_RECOVERED_NO_COORDS";
    const veto = ["INVALID_COORDINATES", "CITY_UNVERIFIED", "CITY_CONFLICT", "BAIRRO_CONFLICT", "PARCEL_CONFLICT"]
      .includes(String(row.shopeeGpsValidationRejectedReason));
    return accepted && !veto && row.lat === row.latFromSheet && row.lng === row.lngFromSheet &&
      !row.shopeeGpsRecoveryRejectedReason && !row.geocodeConfidenceHardMismatch ? "OK" : "PARCIAL";
  }
  if (typeof edit?.lat === "number" && typeof edit.lng === "number") return "PARCIAL";
  const shadow = row.trindadeShadow || row.trindadeShadowAudit;
  if (row.status === "PARCIAL" && !row.localFirstInspectApplied && shadow?.matchedLayer !== "logradouros" &&
      (row.localFirstTrindadeUsedAsFinal || row.source === "LOCALFIRST_TRINDADE" ||
       row.matchType === "LOCALFIRST_TRINDADE" || shadow?.localFirstAppliedAsFinal)) return "OK";
  if (row.status === "CONFIRMADO") return row.source === "MEMORY" ? "OK" : "PARCIAL";
  return row.status === "OK" ? "OK" : "PARCIAL";
}

export function normalizeDeliveryRows<T extends Delivery>(rows: T[], edits: Record<number, ManualEvidence>, jobId: string) {
  return rows.map((row, index) => {
    const status = deliveryStatus(row, edits[index], jobId, index);
    return row.status === status ? row : { ...row, status };
  });
}

export function groupDeliveryStatus(statuses: DeliveryStatus[]): DeliveryStatus {
  if (!statuses.length || statuses.includes("NAO_ENCONTRADO")) return "NAO_ENCONTRADO";
  if (statuses.includes("PARCIAL")) return "PARCIAL";
  return statuses.every(status => status === "CONFIRMADO") ? "CONFIRMADO" : "OK";
}

// Only a single-row map action can introduce a confirmation. Regular workspace
// saves may retain an existing confirmation for the same coordinate.
export function reconcileConfirmationEdits(
  previous: Record<number, ManualEvidence>,
  incoming: Record<number, ManualEvidence>,
  jobId: string,
  rows: Delivery[] | null,
  confirmationIndex: unknown,
) {
  const merged = { ...previous };
  for (const [key, edit] of Object.entries(incoming)) {
    if (!edit || typeof edit !== "object") continue;
    const index = Number(key);
    const prior = previous[index];
    const row = rows?.[index];
    const isMapClick = index === confirmationIndex && !!row &&
      deliveryStatus(row, edit, jobId, index) === "CONFIRMADO";
    const proof = isMapClick ? edit.mapConfirmation :
      prior?.lat === edit.lat && prior?.lng === edit.lng && edit.confirmed ? prior?.mapConfirmation : undefined;
    if (edit.confirmed || edit.mapConfirmation || proof) {
      const { mapConfirmation: _incomingProof, ...rest } = edit;
      merged[index] = proof ? { ...rest, confirmed: true, mapConfirmation: proof } : { ...rest, confirmed: false };
    } else {
      merged[index] = edit;
    }
  }
  return merged;
}
