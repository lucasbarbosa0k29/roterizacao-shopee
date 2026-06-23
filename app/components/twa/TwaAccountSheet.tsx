"use client";

import Link from "next/link";
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </article>
  );
}

function formatExpiration(value: string | null | undefined) {
  if (!value) return "Sem plano ativo";
  return new Date(value).toLocaleDateString("pt-BR");
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
    if (!open || status !== "authenticated") {
      return;
    }

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
          setLoadError(
            `Erro ao carregar plano: HTTP ${res.status} - ${
              (data && typeof data === "object" && (data as { error?: string }).error) ||
              res.statusText ||
              "Resposta inválida"
            }`
          );
          return;
        }

        setAccess(data as AccessSnapshot);
      } catch {
        if (alive) {
          setAccess(null);
          setLoadError("Erro ao carregar plano: falha de rede ou resposta inválida");
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

  const firstTwoNames = useMemo(() => {
    return displayName.trim() || "Usuário";
  }, [displayName]);

  const planLabel = access?.activeSubscription?.code
    ? `Plano ${access.activeSubscription.code}`
    : "Sem plano ativo";

  const statusLabel = access?.isBlocked
    ? "Bloqueado"
    : access?.activeSubscription?.status === "EXPIRED"
      ? "Expirado"
      : access?.activeSubscription?.status === "ACTIVE"
        ? "Ativo"
        : access?.code === "NO_ACTIVE_SUBSCRIPTION"
          ? "Sem plano ativo"
          : "Ativo";

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-950/12 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="relative mx-auto h-full w-full max-w-[480px] px-4 pt-4">
        <div className="absolute left-5 top-[72px] h-3 w-3 rotate-45 rounded-[2px] bg-white shadow-[0_6px_20px_rgba(15,23,42,0.14)]" />
        <div className="absolute left-4 top-[78px] w-[min(calc(100%-32px),380px)] rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
          <div className="max-h-[calc(100dvh-104px)] overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#1f5a6b]">Conta</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{firstTwoNames}</h2>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
              >
                X
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  Carregando...
                </div>
              ) : loadError ? (
                <div className="rounded-[22px] border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
                  {loadError}
                </div>
              ) : access ? (
                <>
                  <MetricCard label="Plano" value={planLabel} />
                  <MetricCard label="Status" value={statusLabel} />
                  <MetricCard label="Vencimento" value={formatExpiration(access.activeSubscription?.expiresAt)} />
                  <MetricCard label="Rotas usadas hoje" value={String(access.todayRouteUsage)} />
                  <MetricCard
                    label="Rotas usadas no ciclo"
                    value={String(access.planRouteUsageToday ?? access.subscriptionCycleUsed)}
                  />
                  <MetricCard label="Créditos acumulados" value={String(access.subscriptionCycleRemaining)} />
                  <MetricCard label="Créditos avulsos" value={String(access.routeCreditsBalance)} />

                  {!access.activeSubscription ? (
                    <section className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 shadow-sm">
                      <div className="text-sm font-semibold">Assinatura necessária</div>
                      <p className="mt-1 text-sm leading-5 text-amber-900">
                        Ative um plano para continuar processando planilhas.
                      </p>
                      <Link
                        href="/planos"
                        className="mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-[#17313b] px-4 text-sm font-semibold text-white shadow-sm"
                      >
                        Contratar assinatura
                      </Link>
                    </section>
                  ) : null}

                  <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Ações principais
                    </div>
                    <div className="mt-3 grid gap-2">
                      <Link
                        href="/planos"
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-[#17313b] px-4 text-sm font-semibold text-white shadow-sm"
                      >
                        Renovar Assinatura
                      </Link>
                      <Link
                        href="/planos"
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm"
                      >
                        Comprar Créditos
                      </Link>
                    </div>
                  </section>

                  <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Acesso rápido
                    </div>
                    <div className="mt-3 grid gap-2">
                      <Link
                        href="/tutorial"
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm"
                      >
                        Tutorial
                      </Link>
                    </div>
                  </section>

                  <button
                    type="button"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm"
                  >
                    Sair da conta
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
