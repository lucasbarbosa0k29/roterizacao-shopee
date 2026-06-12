"use client";

import {
  Children,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type SubscriptionStatusLabel =
  | "ATIVO"
  | "PAUSADO"
  | "VENCIDO"
  | "PAGAMENTO PENDENTE"
  | "COM CRÉDITOS"
  | "SEM PLANO"
  | "BLOQUEADO";

type PlanOrigin = "manual" | "Mercado Pago" | "avulso" | "sem plano";

type SubscriptionUserRow = {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  access: {
    isBlocked: boolean;
    blockReason: string | null;
    activeSubscription: {
      id: string;
      code: "FREE" | "BASIC" | "PRO";
      name: string;
      startsAt: string;
      expiresAt: string | null;
      dailyRouteLimit: number;
      isUnlimited: boolean;
      source: "ADMIN_GRANT" | "TRIAL" | "INFINITEPAY_LINK" | "MANUAL_PAYMENT";
      status: "ACTIVE" | "EXPIRED" | "REVOKED";
    } | null;
    todayRouteUsage: number;
    planRouteUsageToday: number;
    subscriptionCycleAllowance: number;
    subscriptionCycleUsed: number;
    subscriptionCycleRemaining: number;
    subscriptionCycleAccrued: number;
    routeCreditsBalance: number;
    canStartRoute: boolean;
    allowanceSource: string;
    dailyRouteLimit: number | null;
    isUnlimited: boolean;
    message: string | null;
    code: string;
  };
  currentSubscription: {
    id: string;
    code: "FREE" | "BASIC" | "PRO";
    name: string;
    startsAt: string;
    expiresAt: string | null;
    dailyRouteLimit: number;
    isUnlimited: boolean;
    source: "ADMIN_GRANT" | "TRIAL" | "INFINITEPAY_LINK" | "MANUAL_PAYMENT";
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
  } | null;
  latestSubscription: {
    id: string;
    code: "FREE" | "BASIC" | "PRO";
    name: string;
    startsAt: string;
    expiresAt: string | null;
    dailyRouteLimit: number;
    isUnlimited: boolean;
    source: "ADMIN_GRANT" | "TRIAL" | "INFINITEPAY_LINK" | "MANUAL_PAYMENT";
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
  } | null;
  latestPayment: {
    id: string;
    productType: "EXTRA_ROUTE" | "BASIC_PLAN" | "PRO_PLAN";
    quantity: number;
    amountCents: number;
    currency: string;
    status: "PENDING" | "REQUIRES_ACTION" | "APPROVED" | "REJECTED" | "CANCELED" | "REFUNDED" | "EXPIRED" | "FULFILLED";
    createdAt: string;
    approvedAt: string | null;
    fulfilledAt: string | null;
    fulfilledSourceId: string | null;
    externalReference: string;
  } | null;
  recentPayments: Array<{
    id: string;
    productType: "EXTRA_ROUTE" | "BASIC_PLAN" | "PRO_PLAN";
    quantity: number;
    amountCents: number;
    currency: string;
    status: string;
    createdAt: string;
    approvedAt: string | null;
    fulfilledAt: string | null;
    fulfilledSourceId: string | null;
    externalReference: string;
  }>;
  recentRouteCredits: Array<{
    id: string;
    delta: number;
    reason: string;
    notes: string | null;
    createdAt: string;
  }>;
  recentAdminActions: Array<{
    id: string;
    action: string;
    metadata: unknown;
    createdAt: string;
    admin: {
      id: string;
      name: string | null;
      email: string;
    };
  }>;
  planOrigin: PlanOrigin;
  subscriptionStatusLabel: SubscriptionStatusLabel;
  creditsAvailable: number;
  creditsUsedInCycle: number;
  cycleStartAt: string | null;
  cycleExpiresAt: string | null;
};

type Summary = {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  activePlans: number;
  basicPlans: number;
  proPlans: number;
  freePlans: number;
  usersWithCredits: number;
  expiredPlans: number;
  pendingPayments: number;
};

type FinancialSummary = {
  revenueCommercialTotalCents: number;
  revenueCommercialMonthCents: number;
  revenueCommercial30dCents: number;
  revenueInternalTestTotalCents: number;
  revenueInternalTestMonthCents: number;
  mrrBasicCents: number;
  mrrProCents: number;
  mrrTotalCents: number;
  basicPlansSold: number;
  proPlansSold: number;
  plansSold: number;
  extraRouteTransactions: number;
  extraRouteUnits: number;
  extraRouteRevenueCents: number;
  ticketAverageCents: number;
};

type AdminSubscriptionsResponse = {
  ok: true;
  summary: Summary;
  financialSummary: FinancialSummary;
  users: SubscriptionUserRow[];
};

type FilterKey =
  | "ALL"
  | "ACTIVE"
  | "INACTIVE"
  | "BASIC"
  | "PRO"
  | "NO_PLAN"
  | "WITH_CREDITS"
  | "NO_CREDITS"
  | "EXPIRED"
  | "PENDING";

type MenuState = {
  userId: string;
  left: number;
  top: number;
  placement: "top" | "bottom";
};

type MenuPosition = Omit<MenuState, "userId">;

type ModalState =
  | { kind: "history"; user: SubscriptionUserRow }
  | {
      kind: "plan";
      user: SubscriptionUserRow;
      planCode: "NONE" | "FREE" | "BASIC" | "PRO";
      notes: string;
    }
  | {
      kind: "credits";
      user: SubscriptionUserRow;
      mode: "ADD" | "REMOVE";
      credits: string;
      notes: string;
    };

const ACTIONS_MENU_WIDTH = 300;
const ACTIONS_MENU_ESTIMATED_HEIGHT = 520;
const ACTIONS_MENU_GAP = 8;
const ACTIONS_MENU_MARGIN = 8;

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatDateOnly(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function formatMoney(value?: number | null) {
  if (typeof value !== "number") return "-";
  return currencyFormatter.format(value / 100);
}

function formatPlanName(code?: string | null) {
  switch (code) {
    case "BASIC":
      return "Basic";
    case "PRO":
      return "Pro";
    case "FREE":
      return "Free";
    case "NONE":
      return "Sem plano";
    default:
      return code || "Sem plano";
  }
}

function getAdminActionSummary(action: string, metadata: unknown) {
  const data = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;

  switch (action) {
    case "ADD_ROUTE_CREDITS": {
      const delta = Number(data.delta ?? 0);
      return `Adicionou ${Math.abs(delta)} crédito(s) avulso(s)`;
    }
    case "REMOVE_ROUTE_CREDITS": {
      const delta = Number(data.delta ?? 0);
      return `Removeu ${Math.abs(delta)} crédito(s) avulso(s)`;
    }
    case "SET_PLAN":
      return `Alterou o plano para ${formatPlanName(String(data.planCode ?? "NONE"))}`;
    case "RENEW_CYCLE":
      return "Renovou o ciclo do plano";
    case "PAUSE_SUBSCRIPTION":
      return "Pausou a assinatura";
    case "REACTIVATE_SUBSCRIPTION":
      return "Reativou a assinatura";
    case "CANCEL_SUBSCRIPTION":
      return "Cancelou a assinatura";
    default:
      return action;
  }
}

function getPlanColor(code?: string | null) {
  switch (code) {
    case "BASIC":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "PRO":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "FREE":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    default:
      return "bg-slate-100 text-slate-500 ring-slate-200";
  }
}

function getStatusColor(status: SubscriptionStatusLabel) {
  switch (status) {
    case "ATIVO":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "PAGAMENTO PENDENTE":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "VENCIDO":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    case "PAUSADO":
      return "bg-orange-50 text-orange-700 ring-orange-200";
    case "BLOQUEADO":
      return "bg-slate-900 text-white ring-slate-900";
    default:
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

export default function AdminSubscriptionsPage() {
  const [users, setUsers] = useState<SubscriptionUserRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/admin/subscriptions", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });

      const data = (await res.json().catch(() => ({}))) as Partial<AdminSubscriptionsResponse> & {
        error?: string;
      };

      if (!res.ok) {
        setUsers([]);
        setSummary(null);
        setFinancialSummary(null);
        setError(data.error || "Erro ao carregar assinaturas.");
        return;
      }

      setUsers(Array.isArray(data.users) ? data.users : []);
      setSummary(data.summary ?? null);
      setFinancialSummary((data as Partial<AdminSubscriptionsResponse>).financialSummary ?? null);
    } catch (loadError) {
      console.error("Erro ao carregar assinaturas:", loadError);
      setUsers([]);
      setSummary(null);
      setFinancialSummary(null);
      setError("Erro ao carregar assinaturas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (!menu) return;

    function onDocMouseDown(event: MouseEvent) {
      if ((event.target as Element | null)?.closest('[data-actions-menu-trigger="true"]')) {
        return;
      }

      if (!menuRef.current?.contains(event.target as Node)) {
        setMenu(null);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenu(null);
      }
    }

    function onViewportChange() {
      setMenu(null);
    }

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!modal) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModal(null);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modal]);

  function getMenuPosition(button: HTMLButtonElement): MenuPosition {
    const rect = button.getBoundingClientRect();
    const maxLeft = window.innerWidth - ACTIONS_MENU_WIDTH - ACTIONS_MENU_MARGIN;
    const left = Math.min(
      Math.max(ACTIONS_MENU_MARGIN, rect.right - ACTIONS_MENU_WIDTH),
      Math.max(ACTIONS_MENU_MARGIN, maxLeft)
    );

    const availableBelow = window.innerHeight - rect.bottom - ACTIONS_MENU_GAP - ACTIONS_MENU_MARGIN;
    const menuHeight = Math.min(
      ACTIONS_MENU_ESTIMATED_HEIGHT,
      window.innerHeight - ACTIONS_MENU_MARGIN * 2
    );
    const opensUp = availableBelow < menuHeight && rect.top > availableBelow;

    return {
      left,
      top: opensUp ? Math.max(ACTIONS_MENU_MARGIN, rect.top - ACTIONS_MENU_GAP) : rect.bottom + ACTIONS_MENU_GAP,
      placement: opensUp ? "top" : "bottom",
    };
  }

  function toggleMenu(userId: string, button: HTMLButtonElement) {
    setMenu((current) =>
      current?.userId === userId
        ? null
        : {
            userId,
            ...getMenuPosition(button),
          }
    );
  }

  function closeMenuAndRun(action: () => void | Promise<void>) {
    setMenu(null);
    void action();
  }

  async function runAction(user: SubscriptionUserRow, payload: Record<string, unknown>) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/subscriptions/${user.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((data as any)?.error || "Erro ao executar ação.");
        return;
      }

      setModal(null);
      await load();
    } catch (err) {
      console.error("Erro ao executar ação:", err);
      alert("Erro ao executar ação.");
    } finally {
      setBusyId(null);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((user) => {
        if (filter === "ACTIVE" && !user.active) return false;
        if (filter === "INACTIVE" && user.active) return false;
        if (filter === "BASIC" && user.currentSubscription?.code !== "BASIC") return false;
        if (filter === "PRO" && user.currentSubscription?.code !== "PRO") return false;
        if (filter === "NO_PLAN" && user.currentSubscription) return false;
        if (filter === "WITH_CREDITS" && user.creditsAvailable <= 0) return false;
        if (filter === "NO_CREDITS" && user.creditsAvailable > 0) return false;
        if (filter === "EXPIRED" && user.subscriptionStatusLabel !== "VENCIDO") return false;
        if (filter === "PENDING" && user.subscriptionStatusLabel !== "PAGAMENTO PENDENTE") return false;

        if (!q) return true;

        const hay = [user.id, user.name, user.email, user.currentSubscription?.code, user.planOrigin]
          .map((part) => String(part ?? "").toLowerCase())
          .join(" | ");

        return hay.includes(q);
      })
      .sort((a, b) => {
        const nameA = String(a.name || "").trim();
        const nameB = String(b.name || "").trim();

        if (!nameA && nameB) return 1;
        if (nameA && !nameB) return -1;

        return (
          nameA.localeCompare(nameB, "pt-BR", { sensitivity: "base" }) ||
          a.email.localeCompare(b.email, "pt-BR", { sensitivity: "base" })
        );
      });
  }, [users, filter, query]);

  const stats = useMemo(() => {
    const base = summary ?? {
      totalUsers: users.length,
      activeUsers: users.filter((row) => row.active).length,
      inactiveUsers: users.filter((row) => !row.active).length,
      activePlans: users.filter((row) => !!row.currentSubscription).length,
      basicPlans: users.filter((row) => row.currentSubscription?.code === "BASIC").length,
      proPlans: users.filter((row) => row.currentSubscription?.code === "PRO").length,
      freePlans: users.filter((row) => row.currentSubscription?.code === "FREE").length,
      usersWithCredits: users.filter((row) => row.access.routeCreditsBalance > 0).length,
      expiredPlans: users.filter((row) => row.subscriptionStatusLabel === "VENCIDO").length,
      pendingPayments: users.filter((row) => row.subscriptionStatusLabel === "PAGAMENTO PENDENTE").length,
    };

    return base;
  }, [summary, users]);

  const financial = financialSummary ?? {
    revenueCommercialTotalCents: 0,
    revenueCommercialMonthCents: 0,
    revenueCommercial30dCents: 0,
    revenueInternalTestTotalCents: 0,
    revenueInternalTestMonthCents: 0,
    mrrBasicCents: 0,
    mrrProCents: 0,
    mrrTotalCents: 0,
    basicPlansSold: 0,
    proPlansSold: 0,
    plansSold: 0,
    extraRouteTransactions: 0,
    extraRouteUnits: 0,
    extraRouteRevenueCents: 0,
    ticketAverageCents: 0,
  };

  const menuUser = menu ? users.find((user) => user.id === menu.userId) ?? null : null;

  async function submitPlanModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || modal.kind !== "plan") return;

    await runAction(modal.user, {
      action: "SET_PLAN",
      planCode: modal.planCode,
      notes: modal.notes.trim() || undefined,
    });
  }

  async function submitCreditsModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || modal.kind !== "credits") return;

    const credits = Number(modal.credits);
    if (!Number.isInteger(credits) || credits <= 0) {
      alert("Informe um número inteiro positivo.");
      return;
    }

    await runAction(modal.user, {
      action: modal.mode === "ADD" ? "ADD_ROUTE_CREDITS" : "REMOVE_ROUTE_CREDITS",
      credits,
      notes: modal.notes.trim() || undefined,
    });
  }

  function confirmSimpleAction(
    user: SubscriptionUserRow,
    action: "RENEW_CYCLE" | "PAUSE_SUBSCRIPTION" | "REACTIVATE_SUBSCRIPTION" | "CANCEL_SUBSCRIPTION"
  ) {
    const labels = {
      RENEW_CYCLE: "renovar o ciclo",
      PAUSE_SUBSCRIPTION: "pausar a assinatura",
      REACTIVATE_SUBSCRIPTION: "reativar a assinatura",
      CANCEL_SUBSCRIPTION: "cancelar a assinatura",
    } as const;

    const ok = confirm(`Tem certeza que deseja ${labels[action]} de ${user.email}?`);
    if (!ok) return;

    void runAction(user, { action });
  }

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "ALL", label: "Todos", count: stats.totalUsers },
    { key: "ACTIVE", label: "Ativos", count: stats.activeUsers },
    { key: "INACTIVE", label: "Inativos", count: stats.inactiveUsers },
    { key: "BASIC", label: "Basic", count: stats.basicPlans },
    { key: "PRO", label: "Pro", count: stats.proPlans },
    { key: "NO_PLAN", label: "Sem plano", count: stats.totalUsers - stats.activePlans },
    { key: "WITH_CREDITS", label: "Com créditos", count: stats.usersWithCredits },
    { key: "NO_CREDITS", label: "Sem créditos", count: stats.totalUsers - stats.usersWithCredits },
    { key: "EXPIRED", label: "Vencidos", count: stats.expiredPlans },
    { key: "PENDING", label: "Pagamento pendente", count: stats.pendingPayments },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.16),transparent_30%),linear-gradient(180deg,#eef6f6_0%,#f7fbfb_30%,#f5f7f8_100%)] p-6 md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">
                Admin
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
                Assinaturas
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
                Visão operacional de planos, créditos, ciclos e pagamentos para controle
                manual seguro. Nada aqui altera cobrança real automaticamente.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                Voltar ao Admin
              </Link>
              <button
                type="button"
                onClick={load}
                className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                Recarregar
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Usuários" value={stats.totalUsers} subtitle="contas cadastradas" />
          <StatCard title="Ativos" value={stats.activeUsers} subtitle="contas habilitadas" tone="emerald" />
          <StatCard title="Planos ativos" value={stats.activePlans} subtitle="assinaturas em vigor" tone="teal" />
          <StatCard title="Créditos em conta" value={stats.usersWithCredits} subtitle="usuários com saldo extra" tone="amber" />
          <StatCard title="Pendências" value={stats.pendingPayments} subtitle="pagamentos aguardando" tone="rose" />
        </div>

        <div className="rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-700">
                Receita Comercial Real
              </div>
              <div className="mt-1 text-sm text-slate-500">
                Exclusão de ADMIN e contas de teste: <span className="font-medium">teste123@gmail.com</span>,{" "}
                <span className="font-medium">123@gmail.com</span>
              </div>
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Pagamentos aprovados / fulfilled
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StatCard title="Receita Comercial Total" value={financial.revenueCommercialTotalCents} subtitle="acumulado" tone="teal" money />
            <StatCard title="Receita Comercial Mês Atual" value={financial.revenueCommercialMonthCents} subtitle="mês corrente" tone="emerald" money />
            <StatCard title="MRR" value={financial.mrrTotalCents} subtitle="recorrência ativa" tone="amber" money />
            <StatCard title="Planos Vendidos" value={financial.plansSold} subtitle={`${financial.basicPlansSold} Basic / ${financial.proPlansSold} Pro`} tone="slate" />
            <StatCard title="Rotas Avulsas" value={financial.extraRouteUnits} subtitle={`${financial.extraRouteTransactions} transações`} tone="rose" />
            <StatCard title="Ticket Médio" value={financial.ticketAverageCents} subtitle="por transação" tone="teal" money />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <StatCard title="Receita Interna/Testes" value={financial.revenueInternalTestTotalCents} subtitle="ADMIN + contas teste" tone="amber" money />
          </div>
        </div>

        <div className="rounded-[32px] border border-white/70 bg-white/82 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4 border-b border-slate-200/80 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {filters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={[
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    filter === item.key
                      ? "bg-slate-950 text-white shadow-sm"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  ].join(" ")}
                >
                  {item.label}
                  <span
                    className={[
                      "ml-2 rounded-full px-2 py-0.5 text-xs",
                      filter === item.key ? "bg-white/12 text-white" : "bg-white text-slate-500",
                    ].join(" ")}
                  >
                    {item.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="w-full max-w-xl">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Busca por nome, e-mail ou ID
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-teal-400"
                placeholder="Ex.: Maria, maria@email.com ou c123..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto lg:overflow-x-visible">
            {loading ? (
              <div className="p-8 text-slate-600">Carregando assinaturas...</div>
            ) : error ? (
              <div className="p-8 text-rose-700">{error}</div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-8 text-slate-600">Nenhum usuário encontrado.</div>
            ) : (
              <table className="w-full min-w-full table-fixed text-[13px]">
                <colgroup>
                  <col className="w-[27%]" />
                  <col className="w-[15%]" />
                  <col className="w-[13%]" />
                  <col className="w-[14%]" />
                  <col className="w-[16%]" />
                  <col className="w-[8%]" />
                  <col className="w-[7%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50/95 text-left text-slate-500 backdrop-blur">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 font-semibold">Usuário</th>
                    <th className="px-4 py-3 font-semibold">Plano</th>
                    <th className="px-4 py-3 font-semibold">Créditos</th>
                    <th className="px-4 py-3 font-semibold">Ciclo</th>
                    <th className="px-4 py-3 font-semibold">Pagamento</th>
                    <th className="px-4 py-3 font-semibold">Criação da conta</th>
                    <th className="px-6 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredUsers.map((user) => {
                    const isBusy = busyId === user.id;
                    const activePlan = user.currentSubscription?.code ?? null;
                    const lastPayment = user.latestPayment;
                    const creditsAvailable =
                      user.access.subscriptionCycleRemaining + user.access.routeCreditsBalance;

                    return (
                      <tr key={user.id} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                        <td className="px-4 py-4 align-top">
                          <div className="font-semibold text-slate-950">{user.name || "Sem nome"}</div>
                          <div className="mt-1 break-words text-xs text-slate-500">{user.email}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                            ID: <span className="font-mono normal-case tracking-normal">{user.id}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={[
                                "inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1",
                                getPlanColor(activePlan),
                              ].join(" ")}
                            >
                              {user.role === "ADMIN"
                                ? "ADMIN"
                                : activePlan
                                  ? `[${activePlan}]`
                                  : "SEM PLANO"}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                              {user.subscriptionStatusLabel}
                            </span>
                            {user.role === "ADMIN" && (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                ADMIN
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-[11px] text-slate-500">
                            {user.currentSubscription
                              ? user.currentSubscription.name
                              : user.latestSubscription?.name || "Sem assinatura ativa"}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="space-y-1 text-xs text-slate-700">
                            <div>
                              <span className="font-semibold text-slate-950">Disponível:</span>{" "}
                              {creditsAvailable}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-950">Usado:</span>{" "}
                              {user.creditsUsedInCycle}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Plano: {user.access.subscriptionCycleRemaining} | Avulsos:{" "}
                              {user.access.routeCreditsBalance}
                            </div>
                          </div>
                          {user.access.isBlocked && (
                            <div className="mt-2 text-xs text-rose-700">
                              {user.access.blockReason || "Bloqueado"}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4 align-top text-slate-700">
                          <div className="text-xs font-semibold text-slate-950">
                            {formatDateOnly(user.cycleStartAt)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">→</div>
                          <div className="mt-1 text-xs font-semibold text-slate-950">
                            {formatDateOnly(user.cycleExpiresAt)}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-slate-700">
                          {lastPayment ? (
                            <div className="space-y-1">
                              <div className="text-xs font-semibold text-slate-950">
                                {lastPayment.productType}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatDateOnly(lastPayment.createdAt)}
                              </div>
                              <div className="text-[11px] text-slate-500">{user.planOrigin}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-4 align-top text-slate-700">
                          {formatDateOnly(user.createdAt)}
                        </td>
                        <td className="px-6 py-4 text-right align-top">
                          <div className="inline-flex justify-end">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                              disabled={isBusy}
                              data-actions-menu-trigger="true"
                              aria-expanded={menu?.userId === user.id}
                              onClick={(event) => toggleMenu(user.id, event.currentTarget)}
                            >
                              Gerenciar <span className="text-xs">▾</span>
                            </button>

                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {portalRoot && menu && menuUser
        ? createPortal(
            <div
              ref={menuRef}
              className="z-[120] w-[300px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 text-left shadow-2xl ring-1 ring-black/5"
              style={{
                position: "fixed",
                left: menu.left,
                top: menu.top,
                maxHeight: "calc(100vh - 16px)",
                transform: menu.placement === "top" ? "translateY(-100%)" : undefined,
              }}
            >
              <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Controle manual
              </div>

              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
                disabled={busyId === menuUser.id}
                onClick={() =>
                  closeMenuAndRun(() =>
                    setModal({
                      kind: "plan",
                      user: menuUser,
                      planCode: menuUser.currentSubscription?.code ?? "BASIC",
                      notes: "",
                    })
                  )
                }
              >
                Alterar plano
              </button>

              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-emerald-700 hover:bg-slate-50 disabled:text-slate-400"
                disabled={busyId === menuUser.id}
                onClick={() =>
                  closeMenuAndRun(() =>
                    setModal({
                      kind: "credits",
                      user: menuUser,
                      mode: "ADD",
                      credits: "1",
                      notes: "",
                    })
                  )
                }
              >
                Adicionar créditos
              </button>

              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-amber-700 hover:bg-slate-50 disabled:text-slate-400"
                disabled={busyId === menuUser.id}
                onClick={() =>
                  closeMenuAndRun(() =>
                    setModal({
                      kind: "credits",
                      user: menuUser,
                      mode: "REMOVE",
                      credits: "1",
                      notes: "",
                    })
                  )
                }
              >
                Remover créditos
              </button>

              <div className="mt-2 border-t border-slate-100 px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Ciclo e status
              </div>

              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-teal-700 hover:bg-slate-50 disabled:text-slate-400"
                disabled={busyId === menuUser.id}
                onClick={() => closeMenuAndRun(() => confirmSimpleAction(menuUser, "RENEW_CYCLE"))}
              >
                Renovar ciclo
              </button>

              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-orange-700 hover:bg-slate-50 disabled:text-slate-400"
                disabled={busyId === menuUser.id}
                onClick={() =>
                  closeMenuAndRun(() => confirmSimpleAction(menuUser, "PAUSE_SUBSCRIPTION"))
                }
              >
                Pausar assinatura
              </button>

              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-emerald-700 hover:bg-slate-50 disabled:text-slate-400"
                disabled={busyId === menuUser.id}
                onClick={() =>
                  closeMenuAndRun(() => confirmSimpleAction(menuUser, "REACTIVATE_SUBSCRIPTION"))
                }
              >
                Reativar assinatura
              </button>

              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-rose-700 hover:bg-slate-50 disabled:text-slate-400"
                disabled={busyId === menuUser.id}
                onClick={() =>
                  closeMenuAndRun(() => confirmSimpleAction(menuUser, "CANCEL_SUBSCRIPTION"))
                }
              >
                Cancelar assinatura
              </button>

              <div className="mt-2 border-t border-slate-100 px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Auditoria
              </div>

              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
                disabled={busyId === menuUser.id}
                onClick={() =>
                  closeMenuAndRun(() =>
                    setModal({
                      kind: "history",
                      user: menuUser,
                    })
                  )
                }
              >
                Ver histórico
              </button>
            </div>,
            portalRoot
          )
        : null}

      {modal?.kind === "plan" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-2xl ring-1 ring-black/10">
            <div className="text-lg font-black tracking-tight text-slate-950">Alterar plano</div>
            <div className="mt-1 text-sm text-slate-500">{modal.user.email}</div>

            <form className="mt-5 space-y-4" onSubmit={submitPlanModal}>
              <div>
                <label className="text-sm font-semibold text-slate-700">Plano</label>
                <select
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal-400"
                  value={modal.planCode}
                  onChange={(event) =>
                    setModal((current) =>
                      current?.kind === "plan"
                        ? {
                            ...current,
                            planCode: event.target.value as "NONE" | "FREE" | "BASIC" | "PRO",
                          }
                        : current
                    )
                  }
                >
                  <option value="NONE">Sem plano</option>
                  <option value="FREE">FREE</option>
                  <option value="BASIC">BASIC</option>
                  <option value="PRO">PRO</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">Observação</label>
                <textarea
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal-400"
                  rows={4}
                  value={modal.notes}
                  onChange={(event) =>
                    setModal((current) =>
                      current?.kind === "plan"
                        ? { ...current, notes: event.target.value }
                        : current
                    )
                  }
                  placeholder="Opcional"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setModal(null)}
                  disabled={busyId === modal.user.id}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                  disabled={busyId === modal.user.id}
                >
                  {busyId === modal.user.id ? "Salvando..." : "Aplicar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal?.kind === "credits" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-2xl ring-1 ring-black/10">
            <div className="text-lg font-black tracking-tight text-slate-950">
              {modal.mode === "ADD" ? "Adicionar créditos" : "Remover créditos"}
            </div>
            <div className="mt-1 text-sm text-slate-500">{modal.user.email}</div>

            <form className="mt-5 space-y-4" onSubmit={submitCreditsModal}>
              <div>
                <label className="text-sm font-semibold text-slate-700">Quantidade</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal-400"
                  value={modal.credits}
                  onChange={(event) =>
                    setModal((current) =>
                      current?.kind === "credits"
                        ? { ...current, credits: event.target.value }
                        : current
                    )
                  }
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">Observação</label>
                <textarea
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-teal-400"
                  rows={4}
                  value={modal.notes}
                  onChange={(event) =>
                    setModal((current) =>
                      current?.kind === "credits"
                        ? { ...current, notes: event.target.value }
                        : current
                    )
                  }
                  placeholder="Opcional"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setModal(null)}
                  disabled={busyId === modal.user.id}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                  disabled={busyId === modal.user.id}
                >
                  {busyId === modal.user.id ? "Salvando..." : "Aplicar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal?.kind === "history" && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/55 p-4">
          <div className="mx-auto mt-8 w-full max-w-6xl rounded-[28px] bg-white p-6 shadow-2xl ring-1 ring-black/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-black tracking-tight text-slate-950">Histórico</div>
                <div className="mt-1 text-sm text-slate-500">{modal.user.email}</div>
              </div>
              <button
                type="button"
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setModal(null)}
              >
                Fechar
              </button>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <HistoryPanel title="Pagamentos" emptyLabel="Sem pagamentos recentes">
                {modal.user.recentPayments.map((payment) => (
                  <div key={payment.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{payment.productType}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(payment.createdAt)}
                        </div>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                        {payment.status}
                      </span>
                    </div>
                    <div className="mt-3 text-sm text-slate-600">
                      {payment.quantity}x • {formatMoney(payment.amountCents)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">
                      {payment.externalReference}
                    </div>
                  </div>
                ))}
              </HistoryPanel>

              <HistoryPanel title="Créditos" emptyLabel="Sem movimentações de crédito">
                {modal.user.recentRouteCredits.map((credit) => (
                  <div key={credit.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">
                          {credit.delta > 0 ? "+" : ""}
                          {credit.delta} crédito(s)
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(credit.createdAt)}
                        </div>
                      </div>
                      <span
                        className={[
                          "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          credit.delta > 0
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700",
                        ].join(" ")}
                      >
                        {credit.reason}
                      </span>
                    </div>
                    {credit.notes && <div className="mt-3 text-sm text-slate-600">{credit.notes}</div>}
                  </div>
                ))}
              </HistoryPanel>

              <HistoryPanel title="Ações administrativas" emptyLabel="Sem ações recentes">
                {modal.user.recentAdminActions.map((action) => (
                  <div key={action.id} className="max-w-full rounded-2xl border border-slate-200 p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="break-words font-semibold text-slate-950">
                          {getAdminActionSummary(action.action, action.metadata)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(action.createdAt)}
                        </div>
                      </div>
                      <div className="min-w-0 max-w-[45%]">
                        <span className="block truncate rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700">
                          Por: {action.admin.email}
                        </span>
                      </div>
                    </div>
                    {typeof action.metadata === "object" &&
                      action.metadata !== null &&
                      "notes" in action.metadata &&
                      String((action.metadata as Record<string, unknown>).notes ?? "").trim() && (
                        <div className="mt-3 break-words rounded-2xl bg-white px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
                          <span className="font-semibold text-slate-700">Observação:</span>{" "}
                          {String((action.metadata as Record<string, unknown>).notes)}
                        </div>
                      )}
                  </div>
                ))}
              </HistoryPanel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  tone = "slate",
  money = false,
}: {
  title: string;
  value: number;
  subtitle: string;
  tone?: "slate" | "emerald" | "teal" | "amber" | "rose";
  money?: boolean;
}) {
  const toneMap = {
    slate: "from-slate-950 to-slate-700",
    emerald: "from-emerald-600 to-emerald-500",
    teal: "from-teal-600 to-cyan-500",
    amber: "from-amber-600 to-orange-500",
    rose: "from-rose-600 to-pink-500",
  } as const;

  return (
    <div className="rounded-[28px] border border-white/70 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        {title}
      </div>
      <div className={`mt-3 bg-gradient-to-r ${toneMap[tone]} bg-clip-text text-4xl font-black tracking-tight text-transparent`}>
        {money ? currencyFormatter.format(value / 100) : value}
      </div>
      <div className="mt-2 text-sm text-slate-500">{subtitle}</div>
    </div>
  );
}

function HistoryPanel({
  title,
  emptyLabel,
  children,
}: {
  title: string;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 max-w-full rounded-[28px] border border-slate-200 bg-slate-50 p-4 overflow-hidden">
      <div className="text-sm font-black tracking-tight text-slate-950">{title}</div>
      <div className="mt-4 space-y-3">
        {Children.count(children) > 0 ? (
          children
        ) : (
          <div className="text-sm text-slate-500">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}
