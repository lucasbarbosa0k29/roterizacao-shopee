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

  const isActive = (href: string) => pathname === href;

  return (
    <aside className="w-[260px] min-h-screen text-white flex flex-col bg-gradient-to-b from-[#1239a7] to-[#153db0]">
      {/* TOPO */}
      <div className="px-6 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center font-extrabold">
            RP
          </div>

          <div className="leading-tight">
            <div className="font-extrabold text-[15px] tracking-wide">
              ROTEIRIZAÇÃO
            </div>
            <div className="font-semibold opacity-80 -mt-0.5 text-[13px]">
              SHOPEE
            </div>
          </div>
        </div>
      </div>

      {/* MENU PRINCIPAL */}
      <div className="px-6 text-[11px] font-semibold opacity-70">MENU PRINCIPAL</div>

      <nav className="px-4 pt-3 flex flex-col gap-2">
        <Link
          href="/"
          className={[
            "flex items-center gap-3 rounded-xl px-4 py-3 transition",
            isActive("/")
              ? "bg-white/15 ring-1 ring-white/10"
              : "hover:bg-white/10",
          ].join(" ")}
        >
          <span className="text-base">⬆️</span>
          <span className="font-semibold">Importar Planilha</span>
        </Link>

        <Link
          href="/historico"
          className={[
            "flex items-center justify-between rounded-xl px-4 py-3 transition",
            isActive("/historico")
              ? "bg-white/15 ring-1 ring-white/10"
              : "hover:bg-white/10",
          ].join(" ")}
        >
          <span className="flex items-center gap-3">
            <span className="text-base">🕘</span>
            <span className="font-semibold">Histórico de importação</span>
          </span>

          {historyCount > 0 && (
            <span className="min-w-[22px] h-[22px] px-2 text-[11px] flex items-center justify-center rounded-full bg-white/15 ring-1 ring-white/10">
              {historyCount}
            </span>
          )}
        </Link>
      </nav>

      {/* ESPAÇO */}
      <div className="flex-1" />

      {/* RODAPÉ */}
      <div className="px-4 pb-4">
        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-2">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 transition"
            onClick={() => alert("Modo escuro vamos fazer no próximo passo")}
          >
            <span>🌙</span>
            <span className="font-semibold">Escuro</span>
          </button>

          <button
            type="button"
            className="mt-2 w-full flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 transition"
            onClick={() => alert("Sair do sistema (opcional)")}
          >
            <span>↩️</span>
            <span className="font-semibold">Sair do Sistema</span>
          </button>
        </div>

        <div className="mt-3 text-[11px] opacity-70 px-2">
          v26.01 © 2026
        </div>
      </div>
    </aside>
  );
}