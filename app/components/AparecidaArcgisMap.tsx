"use client";

import React, { useEffect, useRef } from "react";

type Props = {
  center?: { lat: number; lng: number } | null;
  onPick: (pos: { lat: number; lng: number }) => void;
};

// ✅ seu WebMap (Mapa Aparecida 100%)
const WEBMAP_ID = "9c9045a200f94fb78ef9b67811c8ca87";

export default function AparecidaArcgisMap({ center, onPick }: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);

  // guardamos referências pra poder atualizar no 2º useEffect
  const viewRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const PointRef = useRef<any>(null);
  const GraphicRef = useRef<any>(null);

  useEffect(() => {
    let view: any = null;

    (async () => {
      const [
        { default: esriConfig },
        { default: WebMap },
        { default: MapView },
        { default: Graphic },
        { default: Point },
        { default: Search },
      ] = await Promise.all([
        import("@arcgis/core/config"),
        import("@arcgis/core/WebMap"),
        import("@arcgis/core/views/MapView"),
        import("@arcgis/core/Graphic"),
        import("@arcgis/core/geometry/Point"),
        import("@arcgis/core/widgets/Search"),
      ]);

      // ✅ seta API Key (coloca no .env.local)
      // NEXT_PUBLIC_ARCGIS_API_KEY=xxxxx
      const apiKey = process.env.NEXT_PUBLIC_ARCGIS_API_KEY;
      if (apiKey) esriConfig.apiKey = apiKey;

      if (!divRef.current) return;

      // ✅ carrega o seu WebMap (com quadra/lote)
      const webmap = new WebMap({
        portalItem: { id: WEBMAP_ID },
      });

      view = new MapView({
        container: divRef.current,
        map: webmap,
        center: center ? [center.lng, center.lat] : [-49.2439, -16.8233],
        zoom: center ? 18 : 16,
      });

      // guarda refs
      viewRef.current = view;
      GraphicRef.current = Graphic;
      PointRef.current = Point;

      // ✅ Search (rua/CEP) no canto direito
      const search = new Search({
        view,
        includeDefaultSources: true, // usa o geocoder padrão do ArcGIS
      });
      view.ui.add(search, "top-right");

      // ✅ função marcador
      function setMarker(lat: number, lng: number) {
        const Pt = PointRef.current;
        const G = GraphicRef.current;
        if (!Pt || !G) return;

        const pt = new Pt({ latitude: lat, longitude: lng });

        // remove o antigo
        if (markerRef.current) view.graphics.remove(markerRef.current);

        const marker = new G({
          geometry: pt,
          symbol: {
            type: "simple-marker",
            style: "circle",
            color: [255, 0, 0, 0.85],
            size: 10,
            outline: { color: [255, 255, 255, 1], width: 2 },
          },
        });

        view.graphics.add(marker);
        markerRef.current = marker;
      }

      // ✅ clique no mapa -> lat/lng
      view.on("click", (event: any) => {
        const p = view.toMap({ x: event.x, y: event.y });
        if (!p) return;

        const lat = Number(p.latitude);
        const lng = Number(p.longitude);

        setMarker(lat, lng);
        onPick({ lat, lng });
      });

      // ✅ se abriu já com center
      if (center) setMarker(center.lat, center.lng);
    })();

    return () => {
      try {
        view?.destroy?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ quando o center mudar, recentra e move o marker
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !center) return;

    const Pt = PointRef.current;
    const G = GraphicRef.current;
    if (!Pt || !G) return;

    const lat = center.lat;
    const lng = center.lng;

    // recenter
    view.goTo({ center: [lng, lat], zoom: 18 }).catch(() => {});

    // marker
    const pt = new Pt({ latitude: lat, longitude: lng });
    if (markerRef.current) view.graphics.remove(markerRef.current);

    const marker = new G({
      geometry: pt,
      symbol: {
        type: "simple-marker",
        style: "circle",
        color: [255, 0, 0, 0.85],
        size: 10,
        outline: { color: [255, 255, 255, 1], width: 2 },
      },
    });

    view.graphics.add(marker);
    markerRef.current = marker;
  }, [center]);

 return <div ref={divRef} className="w-full h-[70vh] bg-white" />;
}