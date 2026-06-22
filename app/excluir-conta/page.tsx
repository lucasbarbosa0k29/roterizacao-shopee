import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exclusão de Conta - Rotta",
  description: "Solicitação de exclusão de conta e dados associados ao Rotta.",
};

export default function ExcluirContaPage() {
  return (
    <main className="min-h-screen bg-[#f7faf9] px-5 py-10 text-slate-800 sm:px-6 lg:px-8">
      <article className="mx-auto max-w-3xl">
        <header className="border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
            Rotta
          </p>
          <h1 className="mt-3 text-3xl font-bold text-[#17313b] sm:text-4xl">
            Exclusão de Conta - Rotta
          </h1>
        </header>

        <div className="space-y-6 py-8 text-base leading-7 text-slate-700">
          <p>
            O usuário pode solicitar a exclusão de sua conta e dos dados
            associados ao serviço Rotta.
          </p>

          <div>
            <p>
              Para solicitar a exclusão, envie um e-mail para
              suporte.usarotta@gmail.com informando:
            </p>

            <ul className="mt-4 list-disc space-y-2 pl-6">
              <li>Nome completo</li>
              <li>E-mail cadastrado</li>
              <li>Solicitação de exclusão da conta</li>
            </ul>
          </div>

          <p>
            Após a validação da solicitação, a conta será removida juntamente
            com os dados vinculados, respeitando obrigações legais e fiscais
            aplicáveis.
          </p>

          <p className="font-medium text-[#17313b]">
            Prazo estimado para processamento: até 30 dias.
          </p>
        </div>
      </article>
    </main>
  );
}
