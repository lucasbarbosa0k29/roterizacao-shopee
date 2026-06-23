"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type AccessSnapshot = {
  activeSubscription: null | {
    code: "FREE" | "BASIC" | "PRO";
    name: string;
    startsAt: string;
    expiresAt: string | null;
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
  };
  routeCreditsBalance: number;
  todayRouteUsage: number;
  planRouteUsageToday: number;
  subscriptionCycleRemaining: number;
  subscriptionCycleAllowance: number;
  subscriptionCycleUsed: number;
  dailyRouteLimit: number | null;
  canStartRoute: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  message: string | null;
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[22px] bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </article>
  );
}

export default function PerfilPage() {
  const { data: session, status } = useSession();
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (status === "unauthenticated") {
      setAccess(null);
      setLoading(false);
      setLoadError("Sessão expirada ou usuário não autenticado");
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
        const errorBody =
          !res.ok && data && typeof data === "object"
            ? (data as { error?: string }).error ?? null
            : null;

        if (!alive) return;

        if (res.ok && data) {
          setAccess(data as AccessSnapshot);
          setLoadError(null);
          return;
        }

        setAccess(null);
        setLoadError(
          `Erro ao carregar plano: HTTP ${res.status} - ${errorBody || res.statusText || "Resposta inválida"}`
        );
      } catch {
        if (!alive) return;
        setAccess(null);
        setLoadError("Erro ao carregar plano: falha de rede ou resposta inválida");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [status]);

  const name = session?.user?.name?.trim() || "Usuário";
  const email = session?.user?.email?.trim() || "Sem e-mail";

  const statusLabel = useMemo(() => {
    if (access?.isBlocked) return "Bloqueado";
    if (access?.activeSubscription?.status === "ACTIVE") return "Ativo";
    if (access?.activeSubscription?.status === "EXPIRED") return "Expirado";
    if (access?.activeSubscription?.status === "REVOKED") return "Revogado";
    return "Indisponível";
  }, [access]);

  const subscriptionLabel =
    access?.activeSubscription?.name ||
    (access?.code === "NO_ACTIVE_SUBSCRIPTION" ? "Sem plano ativo" : "Dados indisponíveis");

  const expiryLabel = access?.activeSubscription?.expiresAt
    ? new Date(access.activeSubscription.expiresAt).toLocaleDateString("pt-BR")
    : "Sem vencimento";

  return (
    <main className="min-h-screen bg-[#f4f7f6] px-4 py-4 text-slate-900">
      <div className="mx-auto w-full max-w-[480px] space-y-4">
        {status === "loading" ? (
          <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            Carregando sessão...
          </section>
        ) : status === "unauthenticated" ? (
          <section className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Sessão expirada ou usuário não autenticado
          </section>
        ) : null}

        {loadError && (
          <section className="rounded-[22px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {loadError}
          </section>
        )}

        <section className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#17313b] text-sm font-semibold text-white">
              {(session?.user?.name?.trim()?.[0] || "R").toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-900">{name}</h1>
              <p className="truncate text-sm text-slate-500">{email}</p>
            </div>
          </div>
        </section>

        {loading ? (
          <section className="grid gap-3">
            {[
              "Plano atual",
              "Status",
              "Renovação / vencimento",
              "Rotas usadas hoje",
              "Rotas usadas no ciclo",
              "Rotas restantes",
              "Créditos avulsos",
              "Limite diário",
            ].map((label) => (
              <MetricCard key={label} label={label} value="Carregando..." />
            ))}
          </section>
        ) : access ? (
          <section className="grid gap-3">
            <MetricCard label="Plano atual" value={subscriptionLabel} />
            <MetricCard label="Status" value={statusLabel} />
            <MetricCard label="Renovação / vencimento" value={expiryLabel} />
            <MetricCard label="Rotas usadas hoje" value={String(access.todayRouteUsage)} />
            <MetricCard
              label="Rotas usadas no ciclo"
              value={String(access.planRouteUsageToday ?? access.subscriptionCycleUsed)}
            />
            <MetricCard label="Rotas restantes" value={String(access.subscriptionCycleRemaining)} />
            <MetricCard label="Créditos avulsos" value={String(access.routeCreditsBalance)} />
            <MetricCard label="Limite diário" value={String(access.dailyRouteLimit ?? 0)} />
          </section>
        ) : null}

        {!loading && !access && !loadError && (
          <section className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Não foi possível carregar os dados da conta. Os campos acima usam valores seguros.
          </section>
        )}

        {access?.blockReason && (
          <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            {access.blockReason}
          </section>
        )}
      </div>
    </main>
  );
}
