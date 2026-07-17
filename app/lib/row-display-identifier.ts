export function isImileRow(row: any) {
  return String(row?.sourceType || "").trim().toUpperCase() === "IMILE";
}

export function getRowDisplayIdentifier(row: any) {
  const sequence = String(row?.sequence ?? "").trim();

  if (isImileRow(row)) {
    const cliente = String(row?.cliente ?? "").trim();
    if (cliente) return cliente;
    return sequence ? `Pacote ${sequence}` : "Pacote";
  }

  return sequence;
}
