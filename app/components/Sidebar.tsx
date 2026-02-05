"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { listHistory } from "../lib/history";

export default function Sidebar() {
  const pathname = usePathname();
  const [historyCount, setHistoryCount] = useState(0);

  useEffect(() => {
    try {
      setHistoryCount(listHistory().length);
    } catch {
      setHistoryCount(0);
    }
  }, [pathname]);

  const active = (href: string) =>
    pathname === href ? "bg-white/15" : "hover:bg-white/10";

  return (
    <aside className="w-[280px] min-h-screen bg-[#1947B8] text-white flex flex-col">
      {/* topo */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center font-bold">
            RP
          </div>
          <div className="leading-tight">
            <div className="font-extrabold text-lg">ROUTE</div>
            <div className="font-semibold opacity-80 -mt-1">PLANNER</div>
          </div>
        </div>
      </div>

      {/* menu */}
      <div className="px-4 py-4 text-xs font-semibold opacity-70">MENU PRINCIPAL</div>

      <nav className="px-3 flex flex-col gap-2">
        <Link
          href="/"
          className={`flex items-center gap-3 rounded-xl px-4 py-3 ${active("/")}`}
        >
          <span className="text-lg">⬆️</span>
          <span className="font-semibold">Importar Planilha</span>
        </Link>

        <Link
          href="/historico"
          className={`flex items-center justify-between rounded-xl px-4 py-3 ${active(
            "/historico"
          )}`}
        >
          <span className="flex items-center gap-3">
            <span className="text-lg">🕘</span>
            <span className="font-semibold">Histórico de importação</span>
          </span>

          {historyCount > 0 && (
            <span className="text-xs bg-white/15 px-2 py-1 rounded-full">
              {historyCount}
            </span>
          )}
        </Link>
      </nav>

      {/* espaço */}
      <div className="flex-1" />

      {/* rodapé */}
      <div className="p-4 border-t border-white/10">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15"
          onClick={() => alert("Modo escuro vamos fazer no próximo passo")}
        >
          <span>🌙</span>
          <span className="font-semibold">Escuro</span>
        </button>

        <button
          type="button"
          className="mt-3 w-full flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15"
          onClick={() => alert("Sair do sistema (opcional)")}
        >
          <span>↩️</span>
          <span className="font-semibold">Sair do Sistema</span>
        </button>

        <div className="mt-4 text-xs opacity-70">v26.01 © 2026</div>
      </div>
    </aside>
  );
}