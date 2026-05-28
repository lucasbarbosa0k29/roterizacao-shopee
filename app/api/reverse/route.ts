import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");

    if (!lat || !lng) {
      return NextResponse.json({ error: "lat/lng não informados" }, { status: 400 });
    }

    const apiKey = process.env.HERE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Serviço de geocodificação indisponível." },
        { status: 500 }
      );
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
    console.error("Erro /api/reverse:", e);
    return NextResponse.json({ error: "Falha ao consultar endereço." }, { status: 500 });
  }
}
