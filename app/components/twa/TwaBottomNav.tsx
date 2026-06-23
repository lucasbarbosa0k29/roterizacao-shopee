"use client";

import Link from "next/link";
import type { ReactNode } from "react";

function iconHome() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10.5V20h11V10.5" />
    </svg>
  );
}

function iconHistory() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8v5l3 2" />
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

function iconAnalyses() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5h16" />
      <path d="M7 9h10" />
      <path d="M10 13h4" />
      <path d="M6 17h12" />
    </svg>
  );
}

function iconMore() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

type TwaBottomNavProps = {
  pathname: string;
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

export function TwaBottomNav({ pathname }: TwaBottomNavProps) {
  const isHome = pathname === "/";
  const isHistorico = pathname === "/historico" || pathname.startsWith("/historico/");
  const isPlanos = pathname === "/planos";
  const isMais = pathname === "/mais";

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto grid w-full max-w-[480px] grid-cols-4 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2">
        <NavItem href="/" label="Início" icon={iconHome()} active={isHome} />
        <NavItem href="/planos" label="Planos" icon={iconAnalyses()} active={isPlanos} />
        <NavItem href="/historico" label="Histórico" icon={iconHistory()} active={isHistorico} />
        <NavItem href="/mais" label="Mais" icon={iconMore()} active={isMais} />
      </div>
    </nav>
  );
}
