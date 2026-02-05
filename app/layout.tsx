import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

import Sidebar from "./components/Sidebar";

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
    <html
      lang="pt-BR"
      className="dark"
      suppressHydrationWarning
    >
      <head>
        {/* CSS do HERE UI */}
        <link
          rel="stylesheet"
          href="https://js.api.here.com/v3/3.1/mapsjs-ui.css"
        />
      </head>

      <body
        className={`
          ${geistSans.variable}
          ${geistMono.variable}
          antialiased
          bg-slate-100 text-slate-900
          dark:bg-slate-900 dark:text-slate-100
        `}
      >
        {/* HERE Maps (v3.1) */}
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

        {/* LAYOUT PRINCIPAL */}
        <div className="flex min-h-screen bg-slate-100 dark:bg-slate-900">
          {/* SIDEBAR */}
          <Sidebar />

          {/* CONTEÚDO */}
          <main className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-900">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}