const latitudeHeaders = ["latitude", "lat", "gpslatitude", "latitudegps", "destinationlatitude", "deliverylatitude"];
const longitudeHeaders = ["longitude", "lng", "lon", "long", "gpslongitude", "longitudegps", "destinationlongitude", "deliverylongitude"];

function parseCoordinate(cell: unknown) {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== "string") return null;
  const text = cell.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function readShopeeSheetCoordinates(row: Record<string, unknown>) {
  const cells = new Map<string, unknown>();
  for (const [header, value] of Object.entries(row)) {
    if (value == null || String(value).trim() === "") continue;
    const key = header.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!cells.has(key)) cells.set(key, value);
  }
  const read = (keys: string[]) => {
    const header = keys.find(key => cells.has(key));
    return header ? parseCoordinate(cells.get(header)) : null;
  };
  // Preserve the original axis order. Geocoding rejects swapped pairs.
  return { latFromSheet: read(latitudeHeaders), lngFromSheet: read(longitudeHeaders) };
}
