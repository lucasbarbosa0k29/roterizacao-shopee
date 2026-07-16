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
  idxsToApply: number[];
  coord: { lat: number; lng: number };
  manualEditPatch?: Partial<TEdit>;
}) {
  const manualEditPatch = { ...(args.manualEditPatch || {}) };
  delete manualEditPatch.address;
  const nextManualEdits: Record<number, TEdit> = { ...args.manualEdits };
  const nextRows = [...args.rows];

  for (const idx of args.idxsToApply) {
    const currentManual = nextManualEdits[idx] || ({} as TEdit);
    nextManualEdits[idx] = {
      ...currentManual,
      ...manualEditPatch,
      lat: args.coord.lat,
      lng: args.coord.lng,
      confirmed: true,
    } as TEdit;

    const currentRow = nextRows[idx];
    if (currentRow) {
      nextRows[idx] = {
        ...currentRow,
        lat: args.coord.lat,
        lng: args.coord.lng,
        status: "CONFIRMADO",
      } as TRow;
    }
  }

  return {
    rows: nextRows,
    manualEdits: nextManualEdits,
  };
}
