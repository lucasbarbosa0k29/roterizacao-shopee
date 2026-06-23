"use client";

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

export function HomeTwaMobile() {
  const { data: session } = useSession();
  const fullName = session?.user?.name?.trim() ?? "";
  const firstName = fullName ? fullName.split(/\s+/)[0] : "";
  const greeting = firstName ? `Olá, ${firstName}!` : "Olá!";
  const avatarInitial = firstName ? firstName[0].toUpperCase() : "R";
  const avatarImage = session?.user?.image ?? null;

  return (
    <section className="min-h-[100dvh] bg-[#f5f8f7] pb-24 text-slate-900">
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4 px-4 pb-4 pt-4">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
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
              <p className="text-xs text-slate-500">
                Roteirização inteligente para sua operação.
              </p>
            </div>
          </div>
        </header>

        <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_30px_rgba(15,23,42,0.08)] ring-1 ring-slate-200">
          <div className="bg-gradient-to-br from-[#17313b] to-[#1f4d5a] px-4 pb-5 pt-5 text-white">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/70">
              Home mobile
            </p>
            <h1 className="mt-2 text-xl font-semibold leading-tight">
              Envie sua planilha e comece a análise.
            </h1>
            <p className="mt-2 max-w-[28ch] text-sm leading-5 text-white/80">
              Um fluxo direto para upload, revisão e acompanhamento das últimas operações.
            </p>
          </div>

          <div className="space-y-4 px-4 py-4">
            <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-semibold text-[#17313b] ring-1 ring-slate-200">
                  +
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">Área de upload</p>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    Selecione uma planilha operacional para iniciar o processamento.
                  </p>
                </div>
              </div>
            </div>

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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{item.meta}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                    {item.status}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto grid w-full max-w-[480px] grid-cols-4 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2">
          <Link
            href="/perfil"
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-slate-500"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
              P
            </span>
            Perfil
          </Link>

          <Link
            href="/"
            aria-current="page"
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold text-[#17313b]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#17313b] text-[10px] font-semibold text-white">
              I
            </span>
            Início
          </Link>

          <button
            type="button"
            disabled
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-slate-500 opacity-60"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
              A
            </span>
            Análises
          </button>

          <Link
            href="/historico"
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-slate-500"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
              H
            </span>
            Histórico
          </Link>
        </div>
      </nav>
    </section>
  );
}
