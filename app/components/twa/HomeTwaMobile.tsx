"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

const recentItems = [
  {
    title: "Planilha abril-roteiros.xlsx",
    status: "Análise concluída",
    meta: "Atualizado há 12 min",
  },
  {
    title: "Entrega centro norte",
    status: "Em revisão",
    meta: "Atualizado há 1 hora",
  },
  {
    title: "Coleta expressa zona sul",
    status: "Pronto para exportar",
    meta: "Atualizado ontem",
  },
];

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

type AccessSnapshot = {
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
  canStartRoute: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  message: string | null;
};

export function HomeTwaMobile() {
  const { data: session, status } = useSession();
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const fullName = session?.user?.name?.trim() ?? "";
  const firstName = fullName ? fullName.split(/\s+/)[0] : "";
  const greeting = firstName ? `Olá, ${firstName}!` : "Olá!";
  const avatarInitial = firstName ? firstName[0].toUpperCase() : "R";
  const avatarImage = session?.user?.image ?? null;
  const showSubscriptionAlert =
    access !== null &&
    (access.code === "NO_ACTIVE_SUBSCRIPTION" ||
      access.code === "ACCESS_BLOCKED" ||
      access.code === "NO_ROUTE_CREDITS" ||
      access.canStartRoute === false);

  useEffect(() => {
    if (status !== "authenticated") {
      setAccess(null);
      return;
    }

    let alive = true;

    (async () => {
      try {
        const res = await fetch("/api/access/me", {
          credentials: "include",
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        });

        const data = (await res.json().catch(() => null)) as Partial<AccessSnapshot> | null;
        if (!alive || !res.ok || !data) {
          setAccess(null);
          return;
        }

        setAccess({
          code: data.code ?? "OK",
          canStartRoute: Boolean(data.canStartRoute),
          isBlocked: Boolean(data.isBlocked),
          blockReason: data.blockReason ?? null,
          message: data.message ?? null,
        });
      } catch {
        if (alive) {
          setAccess(null);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [status]);

  return (
    <section className="min-h-[100dvh] bg-[#f4f7f6] pb-24 text-slate-900">
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4 px-4 pb-4 pt-4">
        <header className="flex items-start justify-between gap-4">
          <Link href="/perfil" className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 overflow-hidden rounded-full bg-[#17313b] text-sm font-semibold text-white shadow-sm ring-1 ring-slate-200">
              {avatarImage ? (
                <img
                  src={avatarImage}
                  alt={fullName || "Perfil"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  {avatarInitial}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{greeting}</p>
              <p className="text-xs text-slate-500">Roteirização inteligente para sua operação.</p>
            </div>
          </Link>
        </header>

        {showSubscriptionAlert ? (
          <section className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 shadow-sm">
            <h2 className="text-sm font-semibold">Assinatura necessária</h2>
            <p className="mt-1 text-sm leading-5 text-amber-900">
              Ative um plano para continuar processando planilhas.
            </p>
            {access.blockReason || access.message ? (
              <p className="mt-2 text-xs leading-5 text-amber-800">
                {access.blockReason || access.message}
              </p>
            ) : null}
            <Link
              href="/planos"
              className="mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-[#17313b] px-4 text-sm font-semibold text-white shadow-sm transition active:scale-[0.99]"
            >
              Ver planos
            </Link>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_14px_36px_rgba(15,23,42,0.08)] ring-1 ring-slate-200">
          <div className="bg-[linear-gradient(135deg,#17313b_0%,#1d4754_55%,#2a6c66_100%)] px-4 pb-6 pt-5 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
              Painel de Roteirização
            </p>
            <h1 className="mt-2 max-w-[14ch] text-[26px] font-semibold leading-[1.08] tracking-tight">
              Transforme planilhas em rotas revisáveis e prontas para exportação
            </h1>
            <p className="mt-3 max-w-[31ch] text-sm leading-5 text-white/82">
              Um fluxo direto para enviar a planilha, revisar os pontos e seguir para a operação.
            </p>
          </div>

          <div className="space-y-4 px-4 py-4">
            <label className="block cursor-not-allowed rounded-[22px] border border-dashed border-[#8cc7bc] bg-[linear-gradient(180deg,#f9fcfb_0%,#eef6f4_100%)] p-4 transition">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-lg text-[#17313b] ring-1 ring-slate-200">
                  +
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">Área de upload</p>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    Selecione uma planilha operacional para iniciar a análise.
                  </p>
                  <p className="mt-2 text-xs text-slate-500">Temporariamente visual nesta etapa.</p>
                </div>
              </div>
            </label>

            <button
              type="button"
              className="flex h-12 w-full items-center justify-center rounded-xl bg-[#17313b] text-sm font-semibold text-white shadow-sm transition active:scale-[0.99]"
            >
              Iniciar Análise
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Recente</h2>
            <span className="text-xs text-slate-500">3 itens</span>
          </div>

          <div className="space-y-3">
            {recentItems.map((item) => (
              <article
                key={item.title}
                className="rounded-[18px] bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eef4f2] text-[11px] font-semibold text-[#17313b] ring-1 ring-slate-200">
                      XLSX
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.meta}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                    {item.status}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded-full px-2 py-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Mais opções"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                      <circle cx="12" cy="5" r="1.7" />
                      <circle cx="12" cy="12" r="1.7" />
                      <circle cx="12" cy="19" r="1.7" />
                    </svg>
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto grid w-full max-w-[480px] grid-cols-4 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2">
          <Link
            href="/"
            aria-current="page"
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold text-[#17313b]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#17313b] text-white">
              {iconHome()}
            </span>
            Início
          </Link>

          <Link
            href="/"
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-slate-500"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              {iconAnalyses()}
            </span>
            Nova Análise
          </Link>

          <Link
            href="/historico"
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-slate-500"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              {iconHistory()}
            </span>
            Histórico
          </Link>

          <Link
            href="/mais"
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-slate-500"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              {iconMore()}
            </span>
            Mais
          </Link>
        </div>
      </nav>
    </section>
  );
}
