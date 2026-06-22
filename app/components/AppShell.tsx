"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { useStandaloneDisplayMode } from "../lib/useStandaloneDisplayMode";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname();
  const isAuthed = status === "authenticated";
  const isLoginPage = pathname === "/login";
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const isStandalone = useStandaloneDisplayMode();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("rotta-standalone-mobile", isStandalone);
    root.dataset.displayMode = isStandalone ? "standalone" : "browser";

    return () => {
      root.classList.remove("rotta-standalone-mobile");
      delete root.dataset.displayMode;
    };
  }, [isStandalone]);

  // Ã¢Å“â€¦ Deslogado: sem menu, tela inteira
  if (!isAuthed || isLoginPage) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
        {children}
      </div>
    );
  }

  // Ã¢Å“â€¦ Logado: layout flex (sidebar NÃƒÆ’O cobre conteÃƒÂºdo)
  return (
    <div
      className={`app-shell ${isStandalone ? "flex-col" : "flex-col md:flex-row"}`}
      data-display-mode={isStandalone ? "standalone" : "browser"}
    >
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      <main className="app-page px-0 py-0 md:p-6 w-full">
        <div className="md:hidden mb-2 px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-black/10"
          >
            <span>☰</span>
            <span>Menu</span>
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}
