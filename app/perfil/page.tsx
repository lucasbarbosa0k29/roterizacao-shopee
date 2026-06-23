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

  const valueOrFallback = (value: number | null | undefined) =>
    loading ? "Carregando..." : String(value ?? 0);

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

        <section className="grid gap-3">
          {[
            ["Plano atual", subscriptionLabel],
            ["Status", statusLabel],
            ["Renovação / vencimento", expiryLabel],
            ["Rotas disponíveis", valueOrFallback(access?.subscriptionCycleAllowance)],
            ["Rotas restantes", valueOrFallback(access?.subscriptionCycleRemaining)],
            ["Créditos avulsos", valueOrFallback(access?.routeCreditsBalance)],
            ["Uso do ciclo", valueOrFallback(access?.subscriptionCycleUsed)],
            ["Limite diário", loading ? "Carregando..." : String(access?.dailyRouteLimit ?? 0)],
          ].map(([label, value]) => (
            <article key={label} className="rounded-[22px] bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
            </article>
          ))}
        </section>

        {!loading && !access && (
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
