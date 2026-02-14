"use client";

import { useSession } from "next-auth/react";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isAuthed = status === "authenticated";

  // ✅ Deslogado: sem menu, tela inteira
  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
        {children}
      </div>
    );
  }

  // ✅ Logado: layout flex (sidebar NÃO cobre conteúdo)
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-page">{children}</main>
    </div>
  );
}