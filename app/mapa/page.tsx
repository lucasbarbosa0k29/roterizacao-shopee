export default function MapaArcGISPage() {
  const src =
    "https://www.arcgis.com/apps/instant/basic/index.html?appid=22794005cc144ca3af610cd452f3170c";

  return (
    <main style={{ height: "100vh", width: "100%" }}>
      <iframe
        src={src}
        style={{ border: 0, width: "100%", height: "100%" }}
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </main>
  );
}