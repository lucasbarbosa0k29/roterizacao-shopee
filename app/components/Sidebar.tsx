"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { listHistoryDb } from "../lib/history-db";
import { signOut, useSession } from "next-auth/react";

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [historyCount, setHistoryCount] = useState(0);

  const isActive = (href: string) => pathname === href;

  const isAuthed = status === "authenticated";
  const isAdmin = useMemo(
    () => (session?.user as any)?.role === "ADMIN",
    [session]
  );

  useEffect(() => {
    if (!isAuthed) {
      setHistoryCount(0);
      return;
    }

    let alive = true;

    (async () => {
      try {
        const items = await listHistoryDb();
        if (!alive) return;
        setHistoryCount(Array.isArray(items) ? items.length : 0);
      } catch {
        if (!alive) return;
        setHistoryCount(0);
      }
    })();

    return () => {
      alive = false;
    };
  }, [pathname, isAuthed]);

  if (!isAuthed) return null;

  const itemRowBase =
    "group flex items-center justify-between w-full px-4 py-3 rounded-2xl transition-all";
  const leftSide = "flex items-center gap-3";
  const iconBox =
    "w-9 h-9 rounded-xl bg-white/15 ring-1 ring-white/15 flex items-center justify-center";
  const chevron = (
    <span className="text-white/70 group-hover:text-white/90 transition">›</span>
  );

  const activeRow = "bg-white/16 ring-1 ring-white/20 shadow-sm";
  const idleRow = "hover:bg-white/10";

  return (
    <aside
      className={[
        "sidebar",
        "w-[280px] min-h-screen text-white flex flex-col flex-shrink-0",
        "bg-gradient-to-b from-[#D86A1F] via-[#C85A15] to-[#B44B10]",
        "shadow-2xl",
        "sticky top-0",
      ].join(" ")}
    >
      {/* TOPO / BRAND (igual referência) */}
      <div className="px-5 pt-6">
        <div className="rounded-3xl bg-white/10 ring-1 ring-white/15 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/95 flex items-center justify-center shadow-sm">
              <span className="text-[#D86A1F] font-extrabold text-2xl leading-none">
                RT
              </span>
            </div>

            <div className="leading-tight">
              <div className="font-extrabold text-[18px]">RT Shopee</div>
              <div className="text-white/90 text-[12px] font-medium">
                Gerencie suas rotas
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MENU CARD */}
      <div className="px-5 mt-4">
        <div className="rounded-3xl bg-white/10 ring-1 ring-white/15 p-4">
          <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-white/85">
            Menu Principal
          </div>

          <nav className="flex flex-col gap-2">
            {/* Importar Planilha (card maior igual referência) */}
            <Link
              href="/"
              className={[
                "block rounded-3xl bg-white/12 ring-1 ring-white/15 hover:bg-white/16 transition",
                isActive("/") ? "bg-white/18 ring-white/25 shadow-sm" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className={iconBox}>
                    <span className="text-lg">⬆️</span>
                  </div>
                  <div className="font-extrabold text-[20px] leading-tight">
                    Importar
                    <br />
                    Planilha
                  </div>
                </div>
                <span className="text-white/70 text-xl">›</span>
              </div>
            </Link>

            {/* Histórico */}
            <Link
              href="/historico"
              className={[
                itemRowBase,
                isActive("/historico") ? activeRow : idleRow,
              ].join(" ")}
            >
              <div className={leftSide}>
                <div className={iconBox}>
                  <span className="text-lg">🕘</span>
                </div>
                <div className="font-extrabold text-[18px]">Histórico</div>

                {historyCount > 0 && (
                  <span className="ml-2 min-w-[34px] h-[34px] px-3 text-[13px] flex items-center justify-center rounded-full bg-white/90 text-[#8B3C12] font-extrabold ring-1 ring-black/10 shadow-sm">
                    {historyCount}
                  </span>
                )}
              </div>
              {chevron}
            </Link>

            {/* ADMIN */}
            {isAdmin && (
              <>
                <Link
                  href="/admin"
                  className={[
                    itemRowBase,
                    isActive("/admin") ? activeRow : idleRow,
                  ].join(" ")}
                >
                  <div className={leftSide}>
                    <div className={iconBox}>
                      <span className="text-lg">🛠️</span>
                    </div>
                    <div className="font-extrabold text-[18px]">
                      Administração
                    </div>
                  </div>
                  {chevron}
                </Link>

                <Link
                  href="/admin/users"
                  className={[
                    itemRowBase,
                    isActive("/admin/users") ? activeRow : idleRow,
                  ].join(" ")}
                >
                  <div className={leftSide}>
                    <div className={iconBox}>
                      <span className="text-lg">👤</span>
                    </div>
                    <div className="font-extrabold text-[18px]">Usuários</div>
                  </div>
                  {chevron}
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>

      <div className="flex-1" />

      {/* BOTÕES (separados do menu, lá embaixo) */}
      <div className="px-5 pb-5">
        <div className="rounded-3xl bg-white/10 ring-1 ring-white/15 p-4">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/14 transition"
            onClick={() => alert("Modo escuro vamos fazer depois")}
          >
            <span className="flex items-center gap-3">
              <span className="text-lg">🌙</span>
              <span className="font-extrabold text-[18px]">Escuro</span>
            </span>
            <span className="text-white/70 text-xl">›</span>
          </button>

          <button
            type="button"
            className="mt-3 w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/14 transition"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <span className="flex items-center gap-3">
              <span className="text-lg">↩️</span>
              <span className="font-extrabold text-[18px]">Sair</span>
            </span>
            <span className="text-white/70 text-xl">›</span>
          </button>
        </div>

        <div className="mt-3 text-[11px] text-white/85 px-2">
          @ RT Shopee © 2026
        </div>
      </div>
    </aside>
  );
}