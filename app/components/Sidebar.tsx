"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { listHistoryDb } from "../lib/history-db";

type SidebarProps = {
  isOpen?: boolean;
  onClose?: () => void;
};

type AccessSnapshot = {
  canStartRoute: boolean;
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
};

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M12 16V6" strokeLinecap="round" />
      <path d="m8.5 9.5 3.5-3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 18.5h14" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.4-5.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 4.5v3.8h3.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7.8v4.6l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      <path d="M3.5 10h17" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M12 3.5 5.5 6v5.6c0 4.1 2.5 7.8 6.5 8.9 4-1.1 6.5-4.8 6.5-8.9V6L12 3.5Z" strokeLinejoin="round" />
      <path d="m9.5 12 1.7 1.7 3.5-3.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M15.5 18.5v-1c0-1.9-1.7-3.5-3.8-3.5S8 15.6 8 17.5v1" strokeLinecap="round" />
      <circle cx="11.8" cy="9.2" r="2.7" />
      <path d="M18.5 18v-.8c0-1.4-.9-2.6-2.2-3.1" strokeLinecap="round" />
      <path d="M15.8 6.8a2.5 2.5 0 0 1 0 4.8" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M18.5 14.8A7.5 7.5 0 0 1 9.2 5.5a7.7 7.7 0 1 0 9.3 9.3Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M10 7V5.8A2.3 2.3 0 0 1 12.3 3.5h4.2a2.3 2.3 0 0 1 2.3 2.3v12.4a2.3 2.3 0 0 1-2.3 2.3h-4.2A2.3 2.3 0 0 1 10 18.2V17" strokeLinecap="round" />
      <path d="M14.5 12H5.5" strokeLinecap="round" />
      <path d="m8.5 9-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [historyCount, setHistoryCount] = useState(0);
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const isActive = (href: string) => pathname === href;

  const isAuthed = status === "authenticated";
  const isAdmin = useMemo(
    () => (session?.user as any)?.role === "ADMIN",
    [session]
  );
  const canUseTool = isAdmin || (!accessLoading && access?.canStartRoute === true);

  useEffect(() => {
    if (!isAuthed) {
      setAccess(null);
      setAccessLoading(false);
      return;
    }

    let alive = true;

    (async () => {
      try {
        setAccessLoading(true);

        const res = await fetch("/api/access/me", {
          credentials: "include",
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        });
        const data = await res.json().catch(() => ({}));

        if (!alive) return;

        if (!res.ok) {
          setAccess(null);
          return;
        }

        setAccess(data as AccessSnapshot);
      } finally {
        if (alive) setAccessLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) {
      setHistoryCount(0);
      return;
    }

    if (!canUseTool) {
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
  }, [pathname, isAuthed, canUseTool]);

  if (!isAuthed) return null;

  const itemRowBase =
    "group flex items-center justify-between rounded-[22px] px-4 py-3.5 text-white/88 transition-all duration-200";
  const leftSide = "flex items-center gap-3.5";
  const iconBox =
    "flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-200 group-hover:border-white/18 group-hover:bg-white/12 group-hover:text-white";
  const chevron = (
    <span className="text-sm text-white/38 transition group-hover:text-white/70">{">"}</span>
  );

  const activeRow =
    "bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.08))] ring-1 ring-white/14 shadow-[0_12px_30px_rgba(0,0,0,0.18)]";
  const idleRow = "hover:bg-white/[0.06]";

  return (
    <>
      <div
        className={[
          "fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        onClick={onClose}
      />

      <aside
        className={[
          "sidebar",
          "fixed inset-y-0 left-0 z-50 flex min-h-screen w-[288px] flex-shrink-0 flex-col text-white shadow-2xl transition-transform duration-200 md:relative md:sticky md:top-0 md:translate-x-0",
          "bg-[radial-gradient(circle_at_top,rgba(73,164,161,0.16),transparent_24%),linear-gradient(180deg,#17313b_0%,#132932_52%,#0d1d24_100%)]",
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
        <div className="px-5 pt-4 md:hidden">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-white/88"
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="px-5 pt-6">
          <div className="rounded-[30px] border border-white/10 bg-white/[0.07] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex items-center gap-3.5">
              <div className="flex h-13 w-13 items-center justify-center rounded-[22px] bg-[linear-gradient(145deg,#f7fffd_0%,#dff5ef_65%,#bfe6da_100%)] shadow-[0_16px_24px_rgba(9,26,31,0.18)]">
                <span className="bg-[linear-gradient(180deg,#17313b_0%,#1f5a6b_100%)] bg-clip-text text-2xl font-black leading-none text-transparent">
                  RH
                </span>
              </div>

              <div className="min-w-0 leading-tight">
                <div className="text-[20px] font-black tracking-tight text-white">RottaHub</div>
                <div className="mt-1 text-[12px] font-medium text-white/62">
                  Console Operacional
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 px-5">
          <div className="rounded-[28px] border border-white/8 bg-white/[0.05] p-4 backdrop-blur">
            <div className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
              Operação
            </div>

            <nav className="flex flex-col gap-1.5">
              {canUseTool && (
                <Link
                  href="/"
                  onClick={onClose}
                  className={[
                    itemRowBase,
                    isActive("/") ? activeRow : idleRow,
                  ].join(" ")}
                >
                  <div className={leftSide}>
                    <div className={iconBox}>
                      <UploadIcon />
                    </div>
                    <div className="leading-tight">
                      <div className="text-[15px] font-semibold text-white">Importar Planilha</div>
                      <div className="mt-1 text-[12px] text-white/48">Entrada Operacional</div>
                    </div>
                  </div>
                  {chevron}
                </Link>
              )}

              {canUseTool && (
                <Link
                  href="/historico"
                  onClick={onClose}
                  className={[
                    itemRowBase,
                    isActive("/historico") ? activeRow : idleRow,
                  ].join(" ")}
                >
                  <div className={leftSide}>
                    <div className={iconBox}>
                      <HistoryIcon />
                    </div>
                    <div className="leading-tight">
                      <div className="text-[15px] font-semibold text-white">Histórico</div>
                      <div className="mt-1 text-[12px] text-white/48">Execuções Recentes</div>
                    </div>

                    {historyCount > 0 && (
                      <span className="ml-1 flex h-[30px] min-w-[30px] items-center justify-center rounded-full border border-[#8fd0bf]/45 bg-[#dff5ef] px-2 text-[12px] font-extrabold text-[#0f5f58] shadow-sm">
                        {historyCount}
                      </span>
                    )}
                  </div>
                  {chevron}
                </Link>
              )}

              <Link
                href="/planos"
                onClick={onClose}
                className={[
                  itemRowBase,
                  isActive("/planos") ? activeRow : idleRow,
                ].join(" ")}
              >
                <div className={leftSide}>
                  <div className={iconBox}>
                    <CardIcon />
                  </div>
                  <div className="leading-tight">
                    <div className="text-[15px] font-semibold text-white">
                      {accessLoading ? "Conta" : canUseTool ? "Minha Assinatura" : "Planos"}
                    </div>
                    <div className="mt-1 text-[12px] text-white/48">Conta e Acesso Comercial</div>
                  </div>
                </div>
                {chevron}
              </Link>

              {isAdmin && (
                <>
                  <Link
                    href="/admin"
                    onClick={onClose}
                    className={[
                      itemRowBase,
                      isActive("/admin") ? activeRow : idleRow,
                    ].join(" ")}
                  >
                    <div className={leftSide}>
                      <div className={iconBox}>
                        <ShieldIcon />
                      </div>
                      <div className="leading-tight">
                        <div className="text-[15px] font-semibold text-white">Administração</div>
                        <div className="mt-1 text-[12px] text-white/48">Controles Internos</div>
                      </div>
                    </div>
                    {chevron}
                  </Link>

                  <Link
                    href="/admin/users"
                    onClick={onClose}
                    className={[
                      itemRowBase,
                      isActive("/admin/users") ? activeRow : idleRow,
                    ].join(" ")}
                  >
                    <div className={leftSide}>
                      <div className={iconBox}>
                        <UsersIcon />
                      </div>
                      <div className="leading-tight">
                        <div className="text-[15px] font-semibold text-white">Usuários</div>
                        <div className="mt-1 text-[12px] text-white/48">Gestão de Contas</div>
                      </div>
                    </div>
                    {chevron}
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>

        <div className="flex-1" />

        <div className="px-5 pb-5 pt-5">
          <div className="rounded-[28px] border border-white/8 bg-white/[0.05] p-4 backdrop-blur">
            <button
              type="button"
              className="group flex w-full items-center justify-between rounded-[20px] px-4 py-3 text-white/86 transition hover:bg-white/[0.06]"
              onClick={() => alert("Modo escuro vamos fazer depois")}
            >
              <span className="flex items-center gap-3.5">
                <span className={iconBox}>
                  <MoonIcon />
                </span>
                <span className="text-[15px] font-semibold">Escuro</span>
              </span>
              <span className="text-sm text-white/38 transition group-hover:text-white/70">{">"}</span>
            </button>

            <button
              type="button"
              className="group mt-1.5 flex w-full items-center justify-between rounded-[20px] px-4 py-3 text-white/86 transition hover:bg-white/[0.06]"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <span className="flex items-center gap-3.5">
                <span className={iconBox}>
                  <LogoutIcon />
                </span>
                <span className="text-[15px] font-semibold">Sair</span>
              </span>
              <span className="text-sm text-white/38 transition group-hover:text-white/70">{">"}</span>
            </button>
          </div>

          <div className="mt-3 px-2 text-[11px] text-white/42">
            RottaHub Console (c) 2026
          </div>
        </div>
      </aside>
    </>
  );
}
