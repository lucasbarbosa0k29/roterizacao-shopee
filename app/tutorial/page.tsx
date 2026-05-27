"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  activateTutorialSession,
  TUTORIAL_PENDING_AFTER_PROCESS_KEY,
  TUTORIAL_START_PREPROCESS_KEY,
} from "../lib/tutorial";

const steps = [
  {
    number: "1",
    title: "Envie sua planilha",
    description:
      "Importe a planilha da Shopee para iniciar o fluxo. O Rotta processa os endereços, organiza os pontos e prepara a operação para revisão.",
  },
  {
    number: "2",
    title: "Revise o Resultado Operacional",
    description:
      "Analise os pontos processados e acompanhe os status: OK para itens confirmados, Parcial para conferência, Manual para ajustes feitos na operação e Não Encontrado para pendências críticas.",
  },
  {
    number: "3",
    title: "Use o mapa para conferir endereços",
    description:
      "Abra o mapa para validar localizações, buscar endereços e confirmar o ponto correto antes de seguir para a exportação.",
  },
  {
    number: "4",
    title: "Agrupe pontos quando necessário",
    description:
      "Use o Auto Agrupar para acelerar a consolidação ou faça agrupamentos manuais quando precisar controlar casos específicos da rota.",
  },
  {
    number: "5",
    title: "Exporte para o Circuit",
    description:
      "O botão Exportar abre a Central de Exportação. Nela, você revisa observações, confirma os dados operacionais e gera o CSV final.",
  },
  {
    number: "6",
    title: "Planos e limites",
    description:
      "BASIC libera 1 rota por dia, PRO libera 2 rotas por dia e créditos extras atendem demandas pontuais. Após o pagamento, a liberação é feita manualmente pelo administrador.",
  },
];

const checklist = [
  "Importar a planilha correta da operação",
  "Conferir status OK, Parcial, Manual e Não Encontrado",
  "Validar pontos sensíveis no mapa antes de exportar",
  "Agrupar paradas quando a operação exigir consolidação",
  "Revisar observações finais na Central de Exportação",
];

export default function TutorialPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <section className="rounded-[30px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.06)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1f5a6b]">
            Tutorial Rotta
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
            Como usar o Rotta
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
            Um guia simples para operar importação, revisão, agrupamento e exportação com segurança no fluxo diário.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Operação Guiada
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Revisão Operacional
            </span>
            <span className="rounded-full bg-[#dff5ef] px-3 py-1 text-xs font-medium text-[#0f5f58]">
              Exportação para Circuit
            </span>
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          {steps.map((step) => (
            <article
              key={step.number}
              className="rounded-[28px] border border-slate-200 bg-white/95 p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#17313b_0%,#1f5a6b_100%)] text-sm font-extrabold text-white shadow-[0_14px_28px_rgba(23,49,59,0.22)]">
                  {step.number}
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-slate-900">
                    {step.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {step.description}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f4fbf8_100%)] p-6 shadow-[0_20px_50px_rgba(15,23,42,0.05)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0f766e]">
            Checklist Final
          </div>
          <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">
            Antes de concluir uma rota
          </h2>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {checklist.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#dff5ef] text-xs font-bold text-[#0f5f58]">
                  ?
                </div>
                <div className="text-sm text-slate-700">{item}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                if (typeof window === "undefined") return;
                activateTutorialSession();
                window.localStorage.setItem(
                  TUTORIAL_START_PREPROCESS_KEY,
                  "true"
                );
                window.localStorage.setItem(
                  TUTORIAL_PENDING_AFTER_PROCESS_KEY,
                  "true"
                );
                router.push("/");
              }}
              className="inline-flex min-h-[50px] items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#17313b_0%,#1f5a6b_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(23,49,59,0.24)] transition hover:brightness-105"
            >
              Começar tutorial agora
            </button>
            <Link
              href="/planos"
              className="inline-flex min-h-[50px] items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Ver planos
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
