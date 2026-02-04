import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");

    if (!lat || !lng) {
      return NextResponse.json({ error: "lat/lng não informados" }, { status: 400 });
    }

    const apiKey = process.env.HERE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "HERE_API_KEY não configurada no .env.local" }, { status: 500 });
    }

    const url =
      `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lng}&lang=pt-BR&apikey=${apiKey}`;

    const res = await fetch(url);
    const data = await res.json();

    const item = data?.items?.[0];
    const addr = item?.address;

    return NextResponse.json({
      lat,
      lng,
      label: item?.title || item?.address?.label || "",
      address: {
        rua: addr?.street || "",
        numero: addr?.houseNumber || "",
        bairro: addr?.district || addr?.subdistrict || "",
        cidade: addr?.city || "",
        estado: addr?.stateCode || addr?.state || "",
        cep: addr?.postalCode || "",
        pais: addr?.countryName || "",
      },
      position: item?.position || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Falha no reverse", details: String(e) }, { status: 500 });
  }
}