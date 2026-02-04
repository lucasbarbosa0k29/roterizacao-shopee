import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Roteirização Shopee",
  description: "Sistema de roteirização com HERE Maps",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        {/* CSS do HERE UI */}
        <link
          rel="stylesheet"
          href="https://js.api.here.com/v3/3.1/mapsjs-ui.css"
        />
      </head>

      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* HERE Maps (v3.1) - ordem recomendada */}
        <Script
          src="https://js.api.here.com/v3/3.1/mapsjs-core.js"
          strategy="beforeInteractive"
        />
        <Script
          src="https://js.api.here.com/v3/3.1/mapsjs-service.js"
          strategy="beforeInteractive"
        />
        <Script
          src="https://js.api.here.com/v3/3.1/mapsjs-data.js"
          strategy="beforeInteractive"
        />
        <Script
          src="https://js.api.here.com/v3/3.1/mapsjs-mapevents.js"
          strategy="beforeInteractive"
        />
        <Script
          src="https://js.api.here.com/v3/3.1/mapsjs-ui.js"
          strategy="beforeInteractive"
        />

        {children}
      </body>
    </html>
  );
}