// normaliza p/ auto agrupamento (remove CEP, pontuação, espaços)
export function normKey(s: string) {
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

export type AutoStopGroup = { key: string; idxs: number[] };

export function buildAutoStopGroups(rows: { original?: string; city?: unknown }[]): AutoStopGroup[] {
  const buckets = new Map<string, number[]>();
  rows.forEach((row, idx) => {
    const key = makeAutoGroupKey({ address: String(row?.original || ""), city: String(row?.city || "") });
    const idxs = buckets.get(key);
    if (idxs) idxs.push(idx);
    else buckets.set(key, [idx]);
  });

  return Array.from(buckets, ([key, idxs]) => ({ key, idxs })).filter((group) => group.idxs.length > 1);
}
