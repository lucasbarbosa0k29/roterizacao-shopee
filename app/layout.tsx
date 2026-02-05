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
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://js.api.here.com/v3/3.1/mapsjs-ui.css"
        />
      </head>

      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
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

        {/* Sidebar fixo + main com scroll */}
        <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
          <aside className="fixed left-0 top-0 h-screen w-[260px] z-50">
            <Sidebar />
          </aside>

          <main className="ml-[260px] h-screen overflow-y-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}