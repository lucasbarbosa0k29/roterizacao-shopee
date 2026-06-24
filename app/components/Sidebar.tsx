"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { listHistoryDb } from "../lib/history-db";
import { isSuperAdmin } from "@/app/lib/admin-roles";

type SidebarProps = {
  isOpen?: boolean;
  onClose?: () => void;
};

type AccessSnapshot = {
  isAdmin?: boolean;
  activeSubscription?: unknown | null;
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

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M6 5.5A2.5 2.5 0 0 1 8.5 3H19v15.5H8.5A2.5 2.5 0 0 0 6 21V5.5Z" strokeLinejoin="round" />
      <path d="M6 5.5V21H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 6h1" strokeLinejoin="round" />
      <path d="M9 7.5h6.5" strokeLinecap="round" />
      <path d="M9 11h6.5" strokeLinecap="round" />
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

function SubscriptionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M6.5 4.5h11A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17V7a2.5 2.5 0 0 1 2.5-2.5Z" />
      <path d="M7.5 8h9" strokeLinecap="round" />
      <path d="M7.5 11.5h9" strokeLinecap="round" />
      <path d="M7.5 15h5" strokeLinecap="round" />
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
  const canSeeAdministrators = isSuperAdmin(session?.user as any);
  const canSeeSubscriptions = canSeeAdministrators;
  const canStartNewRoute = isAdmin || (!accessLoading && access?.canStartRoute === true);
  const hasActivePlan = !!access?.activeSubscription;
  const hasHistoryJob = historyCount > 0;
  const canUseExistingSystem =
    isAdmin ||
    (!accessLoading &&
      access?.code !== "ACCESS_BLOCKED" &&
      (hasActivePlan || access?.canStartRoute === true || hasHistoryJob));
  const handleSignOut = async () => {
    const loginUrl =
      typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

    try {
      await signOut({
        redirect: false,
        callbackUrl: loginUrl,
      });
    } finally {
      if (typeof window !== "undefined") {
        window.location.assign(loginUrl);
      }
    }
  };

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
    if (!isAuthed || accessLoading || access?.code === "ACCESS_BLOCKED") {
      setHistoryCount(0);
      return;
    }

    let alive = true;

    const refreshHistoryCount = async () => {
      try {
        const items = await listHistoryDb();
        if (!alive) return;
        setHistoryCount(Array.isArray(items) ? items.length : 0);
      } catch {
        if (!alive) return;
        setHistoryCount(0);
      }
    };

    refreshHistoryCount();
    window.addEventListener("history-db-changed", refreshHistoryCount);

    return () => {
      alive = false;
      window.removeEventListener("history-db-changed", refreshHistoryCount);
    };
  }, [pathname, isAuthed, accessLoading, access?.code]);

  if (!isAuthed) return null;

  const itemRowBase =
    "group flex items-center justify-between rounded-[22px] px-4 py-3.5 text-white/88 transition-all duration-200";
  const leftSide = "flex items-center gap-3.5";
  const iconBox =
    "flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200/10 bg-white/10 text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(0,0,0,0.14)] transition-all duration-200 group-hover:border-cyan-200/25 group-hover:bg-cyan-200/12 group-hover:text-white";
  const chevron = (
    <span className="text-sm text-white/38 transition group-hover:text-white/70">{">"}</span>
  );

  const activeRow =
    "bg-[linear-gradient(135deg,rgba(45,212,191,0.22),rgba(255,255,255,0.09))] ring-1 ring-cyan-200/24 shadow-[0_18px_34px_rgba(20,184,166,0.16)]";
  const idleRow = "hover:bg-white/[0.075] hover:shadow-[0_12px_26px_rgba(0,0,0,0.14)]";

  return (
    <>
      <div
        className={[
          "fixed inset-0 z-40 bg-slate-950/50 transition-opacity md:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        onClick={onClose}
      />

      <aside
        className={[
          "sidebar",
          "fixed inset-y-0 left-0 z-50 flex h-[100dvh] max-h-[100dvh] w-[min(86vw,360px)] flex-shrink-0 flex-col overflow-y-auto overscroll-contain text-white shadow-2xl transition-transform duration-200 md:relative md:sticky md:top-0 md:h-screen md:w-[320px] md:translate-x-0",
          "bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.24),transparent_26%),linear-gradient(180deg,#07161d_0%,#102a32_48%,#071217_100%)]",
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
        <div className="pointer-events-none absolute inset-0 bg-[url('/rotta-sidebar-bg.png')] bg-cover bg-[50%_4%] opacity-[0.06]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,10,14,0.84)_0%,rgba(7,22,29,0.9)_42%,rgba(3,10,14,0.96)_100%)]" />

        <div className="sticky top-0 z-20 bg-[linear-gradient(180deg,rgba(7,22,29,0.98)_0%,rgba(7,22,29,0.82)_100%)] px-5 pt-[calc(env(safe-area-inset-top)+16px)] pb-2 backdrop-blur md:hidden">
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

        <div className="relative z-10 px-5 pt-6 md:pt-6">
          <div className="rounded-[30px] border border-cyan-200/14 bg-white/[0.075] p-5 shadow-[0_22px_46px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <div className="flex items-center gap-3.5">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[24px] border border-cyan-100/40 bg-slate-950 shadow-[0_0_34px_rgba(45,212,191,0.28),0_18px_28px_rgba(0,0,0,0.24)]">
                <img
                  src="/rotta-logo.png"
                  alt="Rotta"
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="min-w-0 leading-tight">
                <div className="text-[20px] font-black tracking-tight text-white">Rotta</div>
                <div className="mt-1 text-[12px] font-medium text-cyan-100/72">
                  Roteirização Inteligente
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-5 px-5">
          <div className="rounded-[28px] border border-white/10 bg-black/15 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
            <div className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
              Operação
            </div>

            <nav className="flex flex-col gap-1.5">
              {canStartNewRoute && (
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

              {canUseExistingSystem && (
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

              {canUseExistingSystem && (
                <Link
                  href="/tutorial"
                  onClick={onClose}
                  className={[
                    itemRowBase,
                    isActive("/tutorial") ? activeRow : idleRow,
                  ].join(" ")}
                >
                  <div className={leftSide}>
                    <div className={iconBox}>
                      <BookIcon />
                    </div>
                    <div className="leading-tight">
                      <div className="text-[15px] font-semibold text-white">Tutorial</div>
                      <div className="mt-1 text-[12px] text-white/48">Guia de Uso</div>
                    </div>
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
                      {accessLoading ? "Conta" : canStartNewRoute ? "Minha Assinatura" : "Planos"}
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

                  {canSeeSubscriptions && (
                  <Link
                    href="/admin/subscriptions"
                    onClick={onClose}
                    className={[
                      itemRowBase,
                      isActive("/admin/subscriptions") ? activeRow : idleRow,
                    ].join(" ")}
                  >
                    <div className={leftSide}>
                      <div className={iconBox}>
                        <SubscriptionIcon />
                      </div>
                      <div className="leading-tight">
                        <div className="text-[15px] font-semibold text-white">Assinaturas</div>
                        <div className="mt-1 text-[12px] text-white/48">Planos e Créditos</div>
                      </div>
                    </div>
                    {chevron}
                  </Link>
                  )}

                  {canSeeAdministrators && (
                    <Link
                      href="/admin/administrators"
                      onClick={onClose}
                      className={[
                        itemRowBase,
                        isActive("/admin/administrators") ? activeRow : idleRow,
                      ].join(" ")}
                    >
                      <div className={leftSide}>
                        <div className={iconBox}>
                          <ShieldIcon />
                        </div>
                        <div className="leading-tight">
                          <div className="text-[15px] font-semibold text-white">Administradores</div>
                          <div className="mt-1 text-[12px] text-white/48">Permissões e auditoria</div>
                        </div>
                      </div>
                      {chevron}
                    </Link>
                  )}
                </>
              )}
            </nav>
          </div>
        </div>

        <div className="flex-1" />

        <div className="relative z-10 px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-5">
          <div className="rounded-[28px] border border-white/10 bg-black/15 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
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
              onClick={handleSignOut}
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

          <div className="mt-3 px-2 text-center text-[11px] font-medium text-white/42">
            <div>© 2026 Rotta</div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
              <Link
                href="/terms"
                onClick={onClose}
                className="rounded-lg px-1 py-0.5 transition hover:bg-white/[0.05] hover:text-white/70"
              >
                Termos de Uso
              </Link>
              <span aria-hidden="true">•</span>
              <Link
                href="/privacy"
                onClick={onClose}
                className="rounded-lg px-1 py-0.5 transition hover:bg-white/[0.05] hover:text-white/70"
              >
                Política de Privacidade
              </Link>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
