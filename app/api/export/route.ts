export const runtime = "nodejs";

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildDefaultNotes(r: any) {
  // 1) sequenceText (ex: "12, 13") se existir
  // 2) senão sequence normal
  const seq = String(r?.sequenceText ?? r?.sequence ?? "").trim();

  // endereço ORIGINAL sempre
  const original = String(r?.original ?? "").trim();

  // Se já tiver notes (porque você editou na tela), respeita
  const edited = String(r?.notes ?? "").trim();
  if (edited) return edited;

  // Default igual Route Planner: "sequência - endereço original"
  if (seq && original) return `${seq} - ${original}`;
  return original || seq || "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    // Circuit: Name, Address, Latitude, Longitude, Notes
    const header = ["Name", "Address", "Latitude", "Longitude", "Notes"];
    const lines: string[] = [];
    lines.push(header.join(","));

    for (const r of rows) {
      const lat = r?.lat;
      const lng = r?.lng;

      // exporta só o que tiver coordenada
      if (typeof lat !== "number" || typeof lng !== "number") continue;

      // Name = sequência (ou sequenceText se você quiser, mas Name normalmente é um número só)
      const name = String(r?.sequence ?? "").trim();

      // Address = ORIGINAL (sem "arrumar pelo Gemini")
      const address = String(r?.original ?? "").trim();

      // Notes = editável (se você editou, vem r.notes; senão gera default)
      const notes = buildDefaultNotes(r);

      lines.push(
        [
          csvEscape(name),
          csvEscape(address),
          csvEscape(lat),
          csvEscape(lng),
          csvEscape(notes),
        ].join(","),
      );
    }

    const csv = lines.join("\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="circuit.csv"',
      },
    });
  } catch (err: any) {
    return Response.json({ error: "Falha ao exportar" }, { status: 500 });
  }
}