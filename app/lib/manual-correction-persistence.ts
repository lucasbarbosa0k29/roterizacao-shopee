export type ManualCorrectionRow = {
  lat?: number | null;
  lng?: number | null;
  status?: string;
  [key: string]: unknown;
};

export type ManualCorrectionEdit = {
  address?: string;
  lat?: number;
  lng?: number;
  confirmed?: boolean;
  [key: string]: unknown;
};

export function applyManualCoordinateToState<
  TRow extends ManualCorrectionRow,
  TEdit extends ManualCorrectionEdit,
>(args: {
  rows: TRow[];
  manualEdits: Record<number, TEdit>;
  index: number;
  confirmedInJob: string | null;
  coord: { lat: number; lng: number };
  manualEditPatch?: Partial<TEdit>;
}) {
  const manualEditPatch = { ...(args.manualEditPatch || {}) };
  delete manualEditPatch.address;
  const nextManualEdits: Record<number, TEdit> = { ...args.manualEdits };
  const nextRows = [...args.rows];

  const idx = args.index;
  const currentRow = nextRows[idx];
  if (!currentRow) throw new Error("Entrega inexistente");
  nextManualEdits[idx] = {
    ...nextManualEdits[idx],
    ...manualEditPatch,
    lat: args.coord.lat,
    lng: args.coord.lng,
    confirmed: !!args.confirmedInJob,
    mapConfirmation: args.confirmedInJob
      ? { jobId: args.confirmedInJob, index: idx, sequence: String(currentRow.sequence ?? "") }
      : undefined,
  } as TEdit;
  nextRows[idx] = {
    ...currentRow,
    ...args.coord,
    status: args.confirmedInJob ? "CONFIRMADO" : "PARCIAL",
  };

  return {
    rows: nextRows,
    manualEdits: nextManualEdits,
  };
}
