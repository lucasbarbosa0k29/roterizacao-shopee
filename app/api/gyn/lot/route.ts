import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy do ArcGIS da Prefeitura de Goiânia para pegar QUADRA/LOTE por ponto (lat/lng)
 * - Evita CORS
 * - Usa Layer 0 por padrão (Divisas de Lote)
 *
 * Teste:
 * /api/gyn/lot?lat=-16.8233&lng=-49.2439
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "lat/lng inválidos" }, { status: 400 });
    }

    // ✅ Layer default: 0 (Divisas de Lote)
    // Se você quiser testar outra layer (ex 4), coloque ?layer=4 na URL
    const layer = searchParams.get("layer") || "0";

    const base =
      "https://portalmapa.goiania.go.gov.br/servicogyn/rest/services/MapaServer/Feature_BaseTeste/MapServer";
    const url = `${base}/${encodeURIComponent(layer)}/query`;

    // ArcGIS espera geometry = "x,y" => (lng,lat)
    const qs = new URLSearchParams({
      where: "1=1",
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "false",
      f: "pjson",
    });

    const res = await fetch(`${url}?${qs.toString()}`);
    const data = await res.json().catch(() => null);

    if (!res.ok || !data) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "Falha no ArcGIS", status: res.status, details: txt || data },
        { status: 500 }
      );
    }

    const feat = data?.features?.[0];
    const a = feat?.attributes || {};

    // Campos mais comuns nesse tipo de base:
    const quadra =
      a.ci_qdr ??
      a.CI_QDR ??
      a.quadra ??
      a.QUADRA ??
      a.qd ??
      a.QD ??
      "";

    const lote =
      a.ci_lot ??
      a.CI_LOT ??
      a.lote ??
      a.LOTE ??
      a.lt ??
      a.LT ??
      "";

    // Pode ser que retorne vazio se cair fora de cobertura / layer errada
    return NextResponse.json({
      ok: true,
      layer,
      lat,
      lng,
      quadra: String(quadra || ""),
      lote: String(lote || ""),
      raw: { hasFeature: !!feat },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Erro no proxy Goiânia", details: String(e) },
      { status: 500 }
    );
  }
}