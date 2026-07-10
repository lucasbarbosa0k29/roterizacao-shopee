import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade - Rotta",
  description: "Política de Privacidade da plataforma Rotta.",
};

const sections = [
  {
    title: "1. Informações que coletamos",
    paragraphs: [
      "Podemos coletar informações fornecidas diretamente pelo usuário, como nome, e-mail, dados de conta, informações de assinatura, dados de pagamento processados por provedores externos e arquivos ou planilhas enviados para processamento.",
      "Também podemos processar informações operacionais contidas nas planilhas enviadas, incluindo endereços, bairros, ruas, quadras, lotes, coordenadas, observações de entrega e demais dados necessários para a geração, revisão e exportação de rotas.",
    ],
  },
  {
    title: "2. Informações técnicas",
    paragraphs: [
      "Podemos coletar dados técnicos básicos, como endereço IP, tipo de navegador, dispositivo utilizado, registros de acesso, data e hora de uso, identificadores de sessão e informações necessárias para segurança, autenticação e funcionamento da plataforma.",
    ],
  },
  {
    title: "3. Como usamos as informações",
    paragraphs: [
      "As informações são utilizadas para permitir o funcionamento do Rotta, processar planilhas, validar e organizar endereços, gerar rotas, permitir revisão em mapa, salvar correções confirmadas pelo usuário, gerenciar contas, planos e créditos, fornecer suporte, melhorar a precisão do sistema e manter a segurança da plataforma.",
    ],
  },
  {
    title: "4. Planilhas e dados operacionais",
    paragraphs: [
      "As planilhas enviadas pelos usuários são utilizadas para processamento das rotas solicitadas.",
      "O Rotta poderá armazenar informações necessárias para melhorar a experiência do usuário, como correções confirmadas manualmente, dados de memória operacional e registros de processamento, sempre com o objetivo de aprimorar a precisão e a eficiência da plataforma.",
    ],
  },
  {
    title: "5. Compartilhamento com terceiros",
    paragraphs: [
      "O Rotta poderá utilizar serviços de terceiros necessários para seu funcionamento, incluindo provedores de mapas, geolocalização, hospedagem, pagamentos, autenticação, análise técnica e infraestrutura.",
      "Esses serviços podem incluir HERE Technologies, Google Maps, Asaas, Render e outros fornecedores necessários à operação da plataforma.",
      "O Rotta não vende dados pessoais dos usuários.",
    ],
  },
  {
    title: "6. Pagamentos",
    paragraphs: [
      "Os pagamentos podem ser processados por provedores externos, como Asaas ou outros meios de pagamento integrados.",
      "O Rotta não armazena dados completos de cartão de crédito. Informações financeiras são tratadas pelos respectivos provedores de pagamento, conforme suas próprias políticas de privacidade e segurança.",
    ],
  },
  {
    title: "7. Segurança",
    paragraphs: [
      "Adotamos medidas técnicas e organizacionais razoáveis para proteger as informações contra acesso não autorizado, perda, uso indevido, alteração ou divulgação indevida.",
      "Apesar dos esforços de segurança, nenhum sistema é completamente imune a riscos. O usuário também deve manter suas credenciais protegidas e utilizar senhas seguras.",
    ],
  },
  {
    title: "8. Retenção de dados",
    paragraphs: [
      "As informações poderão ser mantidas enquanto forem necessárias para prestação dos serviços, cumprimento de obrigações legais, segurança da plataforma, prevenção a fraudes, suporte ao usuário e melhoria do sistema.",
    ],
  },
  {
    title: "9. Direitos do usuário",
    paragraphs: [
      "O usuário poderá solicitar acesso, correção ou exclusão de seus dados pessoais, conforme aplicável, entrando em contato pelo e-mail suporte.usarotta@gmail.com.",
      "Alguns dados poderão ser mantidos quando necessário para cumprimento de obrigações legais, prevenção a fraudes, resolução de disputas ou segurança da plataforma.",
      "O tratamento de dados pessoais será realizado em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD), observadas as bases legais aplicáveis.",
    ],
  },
  {
    title: "10. Crianças e adolescentes",
    paragraphs: [
      "O Rotta não é direcionado a crianças. A plataforma é destinada ao uso por profissionais e usuários envolvidos em atividades operacionais, logísticas ou comerciais.",
    ],
  },
  {
    title: "11. Alterações nesta Política",
    paragraphs: [
      "Esta Política de Privacidade poderá ser atualizada periodicamente.",
      "A versão mais recente estará sempre disponível em https://usarotta.com.br/privacy.",
    ],
  },
  {
    title: "12. Contato",
    paragraphs: [
      "Em caso de dúvidas sobre esta Política de Privacidade ou sobre o tratamento de dados, entre em contato pelo e-mail suporte.usarotta@gmail.com.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f7faf9] px-5 py-10 text-slate-800 sm:px-6 lg:px-8">
      <article className="mx-auto max-w-3xl">
        <header className="border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
            Rotta
          </p>
          <h1 className="mt-3 text-3xl font-bold text-[#17313b] sm:text-4xl">
            Política de Privacidade - Rotta
          </h1>
          <p className="mt-4 text-sm font-medium text-slate-500">
            Última atualização: 22 de junho de 2026
          </p>
          <p className="mt-6 text-base leading-7 text-slate-700">
            Esta Política de Privacidade explica como o Rotta coleta, utiliza,
            armazena e protege informações dos usuários que acessam nossa
            plataforma, site ou aplicativo.
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
