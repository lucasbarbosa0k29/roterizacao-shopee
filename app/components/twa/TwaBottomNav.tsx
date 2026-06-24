"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

type AccessSnapshot = {
  activeSubscription: null | {
    code: "FREE" | "BASIC" | "PRO";
  };
  canStartRoute: boolean;
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
};

function iconHome() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10.5V20h11V10.5" />
    </svg>
  );
}

function iconHistory() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v5l3 2" />
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

function iconAnalyses() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16" />
      <path d="M7 9h10" />
      <path d="M10 13h4" />
      <path d="M6 17h12" />
    </svg>
  );
}

function iconExport() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 14v5h14v-5" />
    </svg>
  );
}

function iconMore() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

type TwaBottomNavProps = {
  pathname: string;
  isJobRoute: boolean;
};

function NavItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors",
        active ? "text-[#17313b]" : "text-slate-500",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-6 w-6 items-center justify-center rounded-full",
          active ? "bg-[#17313b] text-white" : "bg-slate-100 text-slate-600",
        ].join(" ")}
      >
        {icon}
      </span>
      {label}
    </Link>
  );
}

function DisabledNavItem({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-slate-300">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-300">
        {icon}
      </span>
      {label}
    </div>
  );
}

export function TwaBottomNav({ pathname, isJobRoute }: TwaBottomNavProps) {
  const router = useRouter();
  const { status } = useSession();
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const isHome = pathname === "/";
  const isHistorico = pathname === "/historico" || pathname.startsWith("/historico/");
  const isMais = pathname === "/mais";
  const isAuthed = status === "authenticated";

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
        if (res.status === 401) {
          if (alive) {
            setAccess(null);
            setAccessLoading(false);
          }
          return;
        }

        const data = await res.json().catch(() => null);
        if (!alive) return;
        setAccess(res.ok && data ? (data as AccessSnapshot) : null);
      } catch {
        if (alive) setAccess(null);
      } finally {
        if (alive) setAccessLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isAuthed]);

  const canUseExistingSystem = useMemo(
    () => access?.canStartRoute === true || access?.activeSubscription != null,
    [access]
  );
  const disableNonPlanTabs = isAuthed && !canUseExistingSystem;

  useEffect(() => {
    if (!isAuthed || accessLoading) return;
    if (canUseExistingSystem) return;
    if (pathname !== "/planos") {
      router.replace("/planos");
    }
  }, [accessLoading, canUseExistingSystem, isAuthed, pathname, router]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto grid w-full max-w-[480px] grid-cols-4 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2">
        {disableNonPlanTabs ? (
          <DisabledNavItem label="Início" icon={iconHome()} />
        ) : (
          <NavItem href="/" label="Início" icon={iconHome()} active={isHome} />
        )}
        {isJobRoute ? (
          disableNonPlanTabs ? (
            <DisabledNavItem label="Exportar" icon={iconExport()} />
          ) : (
            <button
              type="button"
              onClick={() => {
                const exportButton = document.querySelector<HTMLElement>('[data-tour="export-button"]');
                exportButton?.click();
              }}
              className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:text-[#17313b]"
              aria-label="Exportar resultado"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                {iconExport()}
              </span>
              Exportar
            </button>
          )
        ) : (
          <NavItem href="/planos" label="Planos" icon={iconAnalyses()} active={pathname === "/planos"} />
        )}
        {disableNonPlanTabs ? (
          <DisabledNavItem label="Histórico" icon={iconHistory()} />
        ) : (
          <NavItem href="/historico" label="Histórico" icon={iconHistory()} active={isHistorico} />
        )}
        {disableNonPlanTabs ? (
          <DisabledNavItem label="Mais" icon={iconMore()} />
        ) : (
          <NavItem href="/mais" label="Mais" icon={iconMore()} active={isMais} />
        )}
      </div>
    </nav>
  );
}
