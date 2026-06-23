"use client";

export function HomeTwaMobile() {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="text-sm font-medium text-slate-600">Olá, João!</p>
        <p className="text-xs text-slate-500">
          Roteirização inteligente para sua operação.
        </p>
      </header>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-semibold text-slate-900">Pronto para começar</p>
        <p className="mt-1 text-sm text-slate-600">
          Envie sua planilha, revise os endereços e continue para o histórico quando necessário.
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Upload</p>
        <p className="mt-1 text-sm text-slate-600">
          Selecione sua planilha operacional para análise.
        </p>
      </div>

      <button className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
        Analisar planilha
      </button>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-semibold text-slate-900">Recente</p>
        <p className="mt-1 text-sm text-slate-600">
          Seus últimos processamentos aparecem aqui.
        </p>
      </div>
    </section>
  );
}
