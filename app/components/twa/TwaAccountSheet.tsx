"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";

type AccessSnapshot = {
  activeSubscription: null | {
    code: "FREE" | "BASIC" | "PRO";
    expiresAt: string | null;
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
  };
  routeCreditsBalance: number;
  todayRouteUsage: number;
  planRouteUsageToday: number;
  subscriptionCycleRemaining: number;
  subscriptionCycleUsed: number;
  canStartRoute: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  message: string | null;
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Sem data";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sem data";
  return parsed.toLocaleDateString("pt-BR");
}

function shortPlanLabel(code: NonNullable<AccessSnapshot["activeSubscription"]>["code"] | undefined) {
  switch (code) {
    case "BASIC":
      return "Basic";
    case "PRO":
      return "Pro";
    case "FREE":
      return "Free";
    default:
      return "Sem plano";
  }
}

function MetricIcon({ kind }: { kind: "trend" | "calendar" | "clock" | "database" }) {
  const common = "h-4 w-4";

  switch (kind) {
    case "trend":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 16l5-5 4 4 7-7" />
          <path d="M16 8h4v4" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <path d="M3 9h18" />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case "database":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="5" rx="7" ry="3" />
          <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
          <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </svg>
      );
  }
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: "trend" | "calendar" | "clock" | "database";
}) {
  return (
    <div className="flex items-center gap-3 py-[5px]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef4f2] text-[#17313b] shadow-[inset_0_0_0_1px_rgba(23,49,59,0.06)]">
        <MetricIcon kind={icon} />
      </div>
      <p className="min-w-0 flex-1 text-[14px] leading-5 text-slate-800">{label}</p>
      <p className="shrink-0 text-[14px] font-semibold leading-5 text-[#17313b]">{value}</p>
    </div>
  );
}

function ActionButton({
  href,
  children,
  tone = "primary",
}: {
  href: string;
  children: ReactNode;
  tone?: "primary" | "secondary";
}) {
  const base =
    "inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold shadow-sm transition active:scale-[0.99]";
  const styles =
    tone === "primary"
      ? "bg-[#17313b] text-white"
      : "border border-slate-200 bg-white text-slate-800";

  return (
    <Link href={href} className={`${base} ${styles}`}>
      {children}
    </Link>
  );
}

type TwaAccountSheetProps = {
  open: boolean;
  onClose: () => void;
  displayName: string;
};

export function TwaAccountSheet({ open, onClose, displayName }: TwaAccountSheetProps) {
  const { data: session, status } = useSession();
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || status !== "authenticated") return;

    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);

        const res = await fetch("/api/access/me", {
          credentials: "include",
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        });

        const data = await res.json().catch(() => null);
        if (!alive) return;

        if (!res.ok || !data) {
          setAccess(null);
          setLoadError("Não foi possível carregar os dados da conta.");
          return;
        }

        setAccess(data as AccessSnapshot);
      } catch {
        if (alive) {
          setAccess(null);
          setLoadError("Não foi possível carregar os dados da conta.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, status]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const { firstName, secondName, initials } = useMemo(() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    const first = parts[0] || "Usuário";
    const second = parts[1] || "";
    const firstInitial = first[0] ?? "U";
    const secondInitial = second[0] ?? "";
    return {
      firstName: first,
      secondName: second,
      initials: `${firstInitial}${secondInitial}`.toUpperCase(),
    };
  }, [displayName]);

  const planCode = access?.activeSubscription?.code;
  const planLabel = shortPlanLabel(planCode);
  const expiresLabel = formatDate(access?.activeSubscription?.expiresAt);
  const cycleUsed = access?.subscriptionCycleUsed ?? access?.planRouteUsageToday ?? 0;
  const cycleRemaining = access?.subscriptionCycleRemaining ?? 0;
  const dailyUsage = access?.todayRouteUsage ?? 0;
  const creditsBalance = access?.routeCreditsBalance ?? 0;
  const isAdmin = String((session?.user as { role?: string } | undefined)?.role || "").toUpperCase() === "ADMIN";
  const planBadge = isAdmin
    ? "ADMIN"
    : planCode === "PRO"
      ? "PRO"
      : planCode === "BASIC"
        ? "BASIC"
        : null;

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
      aria-modal="true"
      aria-label="Perfil"
    >
      <div className="relative h-full w-full">
        <div className="absolute left-3 top-[72px] z-[10000] w-[min(calc(100%-24px),286px)] rounded-[18px] border border-slate-200 bg-white shadow-[0_10px_22px_rgba(15,23,42,0.10)]">
          <div
            className="max-h-[calc(100dvh-96px)] overflow-y-auto px-2.5 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0f4b54] text-[15px] font-semibold text-white shadow-sm">
                  {initials}
                </div>
                <div className="min-w-0 pt-0">
                  <h2 className="text-[14px] font-semibold leading-4 text-slate-900">
                    {firstName}
                    {secondName ? ` ${secondName}` : ""}
                  </h2>
                  {planBadge ? (
                    <div className="mt-1 inline-flex rounded-[7px] bg-[#0f6b66] px-2.5 py-[3px] text-[10px] font-semibold leading-none text-white shadow-sm">
                      {planBadge}
                    </div>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm"
                aria-label="Fechar"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-[16px] border border-slate-200 bg-white px-2.5 py-2.5 text-[12px] text-slate-600 shadow-sm">
                  Carregando perfil...
                </div>
              ) : loadError ? (
                <div className="rounded-[16px] border border-red-200 bg-red-50 px-2.5 py-2.5 text-[12px] text-red-800">
                  {loadError}
                </div>
              ) : (
                <>
                  <section className="border-b border-slate-200 pb-1.5">
                    <p className="text-[12px] leading-4 text-slate-700">
                      {access?.activeSubscription ? (
                        <>
                          Plano ativo até{" "}
                          <span className="font-semibold text-[#0f6b66]">{expiresLabel}</span>
                        </>
                      ) : (
                        <>
                          Plano ativo: <span className="font-semibold text-[#0f6b66]">Sem plano</span>
                        </>
                      )}
                    </p>
                  </section>

                  <section className="border-b border-slate-200 py-0.5">
                    <div className="space-y-0">
                      <MetricCard icon="trend" label="Rotas usadas hoje" value={String(dailyUsage)} />
                      <MetricCard icon="calendar" label="Rotas usadas no ciclo" value={String(cycleUsed)} />
                      <MetricCard icon="clock" label="Créditos acumulados" value={String(cycleRemaining)} />
                      <MetricCard icon="database" label="Créditos avulsos" value={String(creditsBalance)} />
                    </div>
                  </section>

                  <section className="py-1.5">
                    <ActionButton href="/planos" tone="primary">
                      <span className="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M12 3l3 5 6 .9-4.3 4.1 1 6L12 16.9 6.3 19l1-6L3 8.9 9 8l3-5z" />
                        </svg>
                      </span>
                      Minha Assinatura
                    </ActionButton>
                  </section>

                  <section className="border-t border-slate-200 pt-0.5">
                    <Link
                      href="/tutorial"
                      className="flex items-center justify-between px-0.5 py-1 text-[12px] text-slate-800"
                    >
                      <span className="flex items-center gap-3">
                        <span className="text-[#17313b]">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M4 6l8-3 8 3-8 3-8-3z" />
                            <path d="M4 6v8l8 3 8-3V6" />
                            <path d="M12 9v9" />
                          </svg>
                        </span>
                        <span className="font-medium">Tutorial</span>
                      </span>
                      <span className="text-slate-400">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="flex w-full items-center gap-3 px-0.5 py-1 text-[12px] font-medium text-[#c33b3b]"
                    >
                      <span className="text-[#c33b3b]">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M10 17l1.5 1.5L17 13" />
                          <path d="M20 12V6a2 2 0 0 0-2-2h-7" />
                          <path d="M12 12H4" />
                          <path d="M7 9l-3 3 3 3" />
                        </svg>
                      </span>
                      <span>Sair da conta</span>
                    </button>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
