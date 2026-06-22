import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso - Rotta",
  description: "Termos de Uso da plataforma Rotta.",
};

const sections = [
  {
    title: "1. Sobre o Rotta",
    paragraphs: [
      "O Rotta é uma plataforma de roteirização e tratamento de endereços destinada a auxiliar usuários na importação, organização, validação e exportação de rotas para atividades logísticas e de entrega.",
    ],
  },
  {
    title: "2. Aceitação dos Termos",
    paragraphs: [
      "Ao criar uma conta, acessar ou utilizar o Rotta, o usuário declara ter lido, compreendido e aceitado estes Termos de Uso.",
      "Caso não concorde com qualquer disposição destes Termos, o usuário não deverá utilizar a plataforma.",
    ],
  },
  {
    title: "3. Cadastro e Conta",
    paragraphs: [
      "O usuário é responsável por fornecer informações verdadeiras e atualizadas, manter a confidencialidade de suas credenciais de acesso e responder pelas atividades realizadas em sua conta.",
      "O Rotta poderá suspender ou encerrar contas que violem estes Termos ou utilizem a plataforma de forma abusiva ou fraudulenta.",
    ],
  },
  {
    title: "4. Utilização da Plataforma",
    paragraphs: [
      "O usuário poderá utilizar o Rotta para importação de planilhas, processamento e tratamento de endereços, revisão manual de localizações, agrupamento de paradas e condomínios e exportação de rotas para plataformas compatíveis.",
      "O usuário é responsável pela conferência final das informações processadas antes de sua utilização operacional.",
    ],
  },
  {
    title: "5. Processamento de Endereços",
    paragraphs: [
      "O Rotta foi desenvolvido para auxiliar profissionais de logística e entregas na validação, organização e roteirização de endereços.",
      "A plataforma utiliza múltiplas fontes de dados e mecanismos de validação para fornecer resultados com alto nível de precisão, permitindo ainda revisão manual e confirmação pelo usuário quando necessário.",
      "O Rotta mantém processo contínuo de aprimoramento de suas bases e tecnologias com o objetivo de oferecer resultados cada vez mais confiáveis e eficientes.",
    ],
  },
  {
    title: "6. Serviços de Terceiros",
    paragraphs: [
      "A plataforma poderá utilizar serviços e APIs de terceiros para funcionamento, incluindo, mas não se limitando a HERE Technologies, Google Maps, serviços de hospedagem e infraestrutura, serviços de pagamento e serviços de autenticação.",
      "O uso desses serviços também poderá estar sujeito aos respectivos termos e políticas de privacidade dos fornecedores.",
    ],
  },
  {
    title: "7. Planos, Créditos e Pagamentos",
    paragraphs: [
      "O Rotta poderá disponibilizar planos por assinatura, créditos de utilização e serviços avulsos, conforme as condições comerciais vigentes no momento da contratação.",
      "Os créditos disponibilizados por meio de assinaturas poderão possuir prazo de utilização vinculado ao respectivo ciclo contratado.",
      "O acesso aos recursos contratados estará disponível conforme o plano ou créditos adquiridos pelo usuário, observadas eventuais manutenções, atualizações e indisponibilidades técnicas necessárias para o funcionamento da plataforma.",
      "Os valores, recursos incluídos, limites de utilização e condições comerciais poderão ser alterados pelo Rotta, respeitando os direitos dos usuários e as obrigações legais aplicáveis.",
      "Os créditos disponibilizados por meio de planos de assinatura acumulam durante o respectivo ciclo contratado. Salvo disposição em contrário, créditos não utilizados poderão expirar na renovação da assinatura, sendo substituídos pelo novo saldo disponibilizado para o ciclo seguinte.",
    ],
  },
  {
    title: "8. Uso Adequado da Plataforma",
    paragraphs: [
      "O usuário compromete-se a utilizar o Rotta de forma lícita e em conformidade com a legislação aplicável.",
      "Não é permitido utilizar a plataforma para atividades ilegais ou fraudulentas, tentar acessar áreas, dados ou funcionalidades sem autorização, interferir no funcionamento da plataforma ou prejudicar sua estabilidade, ou utilizar mecanismos automatizados que possam comprometer o desempenho do serviço.",
      "O Rotta poderá limitar, suspender ou encerrar acessos que apresentem uso abusivo ou que coloquem em risco a segurança e a disponibilidade da plataforma para outros usuários.",
    ],
  },
  {
    title: "9. Disponibilidade do Serviço",
    paragraphs: [
      "O Rotta busca manter alta disponibilidade, porém poderão ocorrer interrupções decorrentes de manutenção, atualizações, problemas técnicos ou falhas em serviços de terceiros.",
    ],
  },
  {
    title: "10. Suspensão e Encerramento",
    paragraphs: [
      "O Rotta poderá suspender ou encerrar contas em caso de violação destes Termos, uso fraudulento da plataforma, atividades que comprometam a segurança do sistema ou descumprimento da legislação aplicável.",
    ],
  },
  {
    title: "11. Alterações dos Termos",
    paragraphs: [
      "Estes Termos poderão ser alterados a qualquer momento.",
      "A versão mais recente permanecerá disponível em https://usarotta.com.br/terms.",
      "O uso continuado da plataforma após alterações representa concordância com os novos Termos.",
    ],
  },
  {
    title: "12. Contato",
    paragraphs: [
      "Em caso de dúvidas, solicitações ou suporte, entre em contato através do e-mail financeiro@usarotta.com.br.",
    ],
  },
  {
    title: "13. Limitação de Responsabilidade",
    paragraphs: [
      "O Rotta atua como ferramenta de apoio à validação, organização e roteirização de endereços.",
      "Embora sejam empregados esforços para fornecer resultados precisos, o usuário permanece responsável pela conferência final das informações, rotas e localizações antes de sua utilização operacional.",
      "O Rotta não garante precisão absoluta dos dados processados e não será responsável por prejuízos indiretos, lucros cessantes, perdas comerciais, atrasos em entregas ou danos decorrentes do uso das informações geradas pela plataforma.",
    ],
  },
  {
    title: "14. Legislação Aplicável",
    paragraphs: [
      "Estes Termos serão interpretados de acordo com a legislação brasileira.",
      "Quaisquer controvérsias relacionadas à utilização da plataforma deverão observar a legislação aplicável vigente no Brasil.",
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#f7faf9] px-5 py-10 text-slate-800 sm:px-6 lg:px-8">
      <article className="mx-auto max-w-3xl">
        <header className="border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
            Rotta
          </p>
          <h1 className="mt-3 text-3xl font-bold text-[#17313b] sm:text-4xl">
            Termos de Uso - Rotta
          </h1>
          <p className="mt-4 text-sm font-medium text-slate-500">
            Última atualização: 22 de junho de 2026
          </p>
          <p className="mt-6 text-base leading-7 text-slate-700">
            Bem-vindo ao Rotta. Ao acessar ou utilizar nossa plataforma, site
            ou aplicativo, você concorda com os presentes Termos de Uso.
          </p>
        </header>

        <div className="space-y-8 py-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold text-[#17313b]">
                {section.title}
              </h2>
              <div className="mt-3 space-y-4">
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="text-base leading-7 text-slate-700"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
