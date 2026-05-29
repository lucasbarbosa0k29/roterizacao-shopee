"use client";

import { useEffect, useState } from "react";

const WHATSAPP_BUSINESS_URL =
  process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_URL || "https://wa.me/SEU_NUMERO_AQUI";

type AccessSnapshot = {
  userId: string;
  role: "ADMIN" | "USER";
  isAdmin: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  activeSubscription: null | {
    id: string;
    code: "FREE" | "BASIC" | "PRO";
    name: string;
    startsAt: string;
    expiresAt: string | null;
    dailyRouteLimit: number;
    isUnlimited: boolean;
    source: "ADMIN_GRANT" | "TRIAL" | "INFINITEPAY_LINK" | "MANUAL_PAYMENT";
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
  };
  todayRouteUsage: number;
  planRouteUsageToday: number;
  subscriptionCycleAllowance: number;
  subscriptionCycleUsed: number;
  subscriptionCycleRemaining: number;
  subscriptionCycleAccrued: number;
  routeCreditsBalance: number;
  canStartRoute: boolean;
  allowanceSource: "ADMIN" | "FREE" | "SUBSCRIPTION_DAILY" | "EXTRA_CREDIT" | "NONE";
  dailyRouteLimit: number | null;
  isUnlimited: boolean;
  message: string | null;
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
};

function PaymentButton({ href, label }: { href?: string; label: string }) {
  if (!href) {
    return (
      <button
        type="button"
        disabled
        className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-400"
      >
        Link não configurado
      </button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block w-full rounded-2xl bg-[#17313b] px-4 py-3 text-center text-sm font-semibold text-white hover:bg-[#10242c]"
    >
      {label}
    </a>
  );
}

function getAvailableRoutesLabel(access: AccessSnapshot | null) {
  if (!access) return "-";
  if (access.isBlocked) return "Bloqueado";
  if (access.isAdmin || access.isUnlimited || access.allowanceSource === "FREE") {
    return "Ilimitado";
  }
  if (access.activeSubscription) {
    const remaining = access.subscriptionCycleRemaining;
    return remaining > 0
      ? `${remaining} Rota${remaining === 1 ? "" : "s"} Disponível${remaining === 1 ? "" : "eis"}`
      : "0 Rotas Disponíveis";
  }
  if (access.routeCreditsBalance > 0) {
    return `Créditos: ${access.routeCreditsBalance}`;
  }
  return "-";
}

function getCycleResetLabel(access: AccessSnapshot | null) {
  const expiresAt = access?.activeSubscription?.expiresAt;
  if (!expiresAt) return "Sem data de expiração";

  const resetDate = new Date(expiresAt);
  return resetDate.toLocaleDateString("pt-BR");
}

export default function PlanosPage() {
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/access/me", {
          credentials: "include",
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        });

        const data = await res.json().catch(() => ({}));
        if (!alive) return;

        if (!res.ok) {
          setError(data?.error || "Erro ao carregar dados da conta.");
          setAccess(null);
          return;
        }

        setAccess(data as AccessSnapshot);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const basicUrl = process.env.NEXT_PUBLIC_PAYMENT_BASIC_URL;
  const proUrl = process.env.NEXT_PUBLIC_PAYMENT_PRO_URL;
  const extraUrl = process.env.NEXT_PUBLIC_PAYMENT_EXTRA_ROUTE_URL;

  return (
    <main className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.05)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#1f5a6b]">
            Conta e Assinatura
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">Minha assinatura</h1>
          <p className="mt-2 text-sm text-slate-600">
            Consulte seu status comercial e escolha a melhor forma de liberação.
          </p>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-600 shadow-sm">
            Carregando status da conta...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-700 shadow-sm">
            {error}
          </div>
        ) : (
          <>
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
              <div className="text-sm font-semibold text-slate-500">Status atual</div>
              <div className="mt-3 text-lg font-bold text-slate-900">
                {access?.isAdmin
                  ? "Administrador com acesso total"
                  : access?.activeSubscription
                    ? `Plano ${access.activeSubscription.code} ativo`
                    : access?.routeCreditsBalance
                      ? `Sem plano ativo, com ${access.routeCreditsBalance} crédito(s)`
                      : "Sem plano ativo"}
              </div>

              {access?.isBlocked ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <div className="font-semibold">Acesso comercial bloqueado</div>
                  <div className="mt-1">
                    {access.blockReason || "Entre em contato com o suporte para regularização."}
                  </div>
                </div>
              ) : access?.code === "NO_ACTIVE_SUBSCRIPTION" ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Nenhum plano ativo encontrado. Escolha uma opção abaixo e envie o comprovante ao administrador.
                </div>
              ) : access?.code === "NO_ROUTE_CREDITS" ? (
                <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  Seu saldo acumulado do ciclo foi utilizado. Adicione créditos avulsos ou aguarde a renovação do plano.
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Rota disponível hoje
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-tight text-slate-800">
                    {access?.activeSubscription
                      ? `${access.subscriptionCycleRemaining} Rota${access.subscriptionCycleRemaining === 1 ? "" : "s"} Disponível${access.subscriptionCycleRemaining === 1 ? "" : "eis"}`
                      : "0 Rotas Disponíveis"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Saldo do período
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-tight text-slate-800">
                    {access?.activeSubscription
                      ? `${access.subscriptionCycleAccrued} Rota${access.subscriptionCycleAccrued === 1 ? "" : "s"} Acumulada${access.subscriptionCycleAccrued === 1 ? "" : "s"}`
                      : "Sem saldo de plano"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Renovação
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-tight text-slate-800">{getCycleResetLabel(access)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Créditos
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-tight text-slate-800">{access?.routeCreditsBalance ?? 0}</div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Atenção: o saldo acumulado expira ao final do ciclo do plano. Na renovação, um novo saldo é iniciado.
              </div>
            </div>

            <div className="mt-8 grid items-stretch gap-6 lg:grid-cols-3">
              <section className="flex h-full flex-col rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                <div className="text-sm font-semibold uppercase tracking-wide text-blue-600">
                  BASIC
                </div>
                <div className="mt-3 text-3xl font-black tracking-tight text-slate-900">R$ 39,99</div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">30 dias</h2>
                <p className="mt-1 text-sm text-slate-600">1 rota por dia.</p>
                <ul className="mt-5 space-y-2 text-sm leading-6 text-slate-600">
                  <li>Rotas não usadas são acumuladas durante o período de 30 dias.</li>
                  <li>Após esse período, o saldo expira.</li>
                  <li>Ideal para operação de menor volume.</li>
                  <li>Liberação comercial manual pelo administrador.</li>
                </ul>
                <div className="mt-auto pt-8">
                  <PaymentButton href={basicUrl} label="Assinar BASIC" />
                </div>
              </section>

              <section className="flex h-full flex-col rounded-[28px] border border-emerald-300 bg-[linear-gradient(180deg,#ffffff_0%,#f4fbf8_100%)] p-6 shadow-[0_18px_40px_rgba(15,23,42,0.06)] ring-1 ring-emerald-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold uppercase tracking-wide text-emerald-600">
                    PRO
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                    Recomendado
                  </span>
                </div>
                <div className="mt-3 text-3xl font-black tracking-tight text-slate-900">R$ 69,99</div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">30 dias</h2>
                <p className="mt-1 text-sm text-slate-600">2 rotas por dia.</p>
                <ul className="mt-5 space-y-2 text-sm leading-6 text-slate-600">
                  <li>Rotas não usadas são acumuladas durante o período de 30 dias.</li>
                  <li>Após esse período, o saldo expira.</li>
                  <li>Melhor opção para uso recorrente.</li>
                  <li>Liberação comercial manual pelo administrador.</li>
                </ul>
                <div className="mt-auto pt-8">
                  <PaymentButton href={proUrl} label="Assinar PRO" />
                </div>
              </section>

              <section className="flex h-full flex-col rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                <div className="text-sm font-semibold uppercase tracking-wide text-amber-600">
                  ROTA AVULSA
                </div>
                <div className="mt-3 text-3xl font-black tracking-tight text-slate-900">R$ 1,99</div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">Uso extra</h2>
                <p className="mt-1 text-sm text-slate-600">1 crédito adicional</p>
                <ul className="mt-5 space-y-2 text-sm leading-6 text-slate-600">
                  <li>Crédito extra separado do plano.</li>
                  <li>Use quando o saldo do plano acabar.</li>
                  <li>Liberação manual pelo administrador após confirmação.</li>
                </ul>
                <div className="mt-auto pt-8">
                  <PaymentButton href={extraUrl} label="Comprar Rota Avulsa" />
                </div>
              </section>
            </div>

            <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
              Após o pagamento, a liberação é feita manualmente pelo administrador. Entre em contato para liberar seu acesso.
              <div className="mt-4">
                <a
                  href={WHATSAPP_BUSINESS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-2xl bg-[#17313b] px-4 py-3 text-sm font-semibold text-white hover:bg-[#10242c]"
                >
                  Entrar em contato pelo WhatsApp
                </a>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
