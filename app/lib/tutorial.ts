"use client";

import { driver } from "driver.js";

export const TUTORIAL_PENDING_AFTER_PROCESS_KEY =
  "rotta_tutorial_pending_after_process";
export const TUTORIAL_START_PREPROCESS_KEY =
  "rotta_tutorial_pending";
export const TUTORIAL_PENDING_MAP_REVIEW_KEY =
  "rotta_tutorial_pending_map_review";
export const TUTORIAL_MAP_CONFIRMED_KEY =
  "rotta_tutorial_map_confirmed";
export const TUTORIAL_PENDING_EXPORT_FINAL_KEY =
  "rotta_tutorial_pending_export_final";
export const TUTORIAL_EXPORT_FINAL_EVENT =
  "rottahub:tutorial-export-final-request";
export const TUTORIAL_ACTIVE_KEY = "rotta_tutorial_active";
export const TUTORIAL_COMPLETED_KEY = "rotta_tutorial_completed";

let activeTutorial: ReturnType<typeof driver> | null = null;

function createTutorial() {
  if (activeTutorial) {
    activeTutorial.destroy();
    activeTutorial = null;
  }

  const tutorial = driver({
    animate: true,
    allowClose: true,
    overlayClickBehavior: "close",
    showProgress: true,
    smoothScroll: true,
    stagePadding: 12,
    stageRadius: 20,
    nextBtnText: "Próximo",
    prevBtnText: "Voltar",
    doneBtnText: "Concluir",
    popoverClass: "rottahub-driver-popover",
    overlayColor: "rgba(15, 23, 42, 0.58)",
  });

  activeTutorial = tutorial;
  return tutorial;
}

export function destroyActiveTutorial() {
  if (!activeTutorial) return;
  activeTutorial.destroy();
  activeTutorial = null;
}

export function clearTutorialSessionFlags() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(TUTORIAL_PENDING_AFTER_PROCESS_KEY);
  window.localStorage.removeItem(TUTORIAL_START_PREPROCESS_KEY);
  window.localStorage.removeItem(TUTORIAL_PENDING_MAP_REVIEW_KEY);
  window.localStorage.removeItem(TUTORIAL_MAP_CONFIRMED_KEY);
  window.localStorage.removeItem(TUTORIAL_PENDING_EXPORT_FINAL_KEY);
  window.localStorage.removeItem(TUTORIAL_ACTIVE_KEY);
  window.localStorage.removeItem(TUTORIAL_COMPLETED_KEY);

  window.sessionStorage.removeItem(TUTORIAL_PENDING_AFTER_PROCESS_KEY);
  window.sessionStorage.removeItem(TUTORIAL_START_PREPROCESS_KEY);
  window.sessionStorage.removeItem(TUTORIAL_PENDING_MAP_REVIEW_KEY);
  window.sessionStorage.removeItem(TUTORIAL_MAP_CONFIRMED_KEY);
  window.sessionStorage.removeItem(TUTORIAL_PENDING_EXPORT_FINAL_KEY);
  window.sessionStorage.removeItem(TUTORIAL_ACTIVE_KEY);
  window.sessionStorage.removeItem(TUTORIAL_COMPLETED_KEY);
}

export function activateTutorialSession() {
  if (typeof window === "undefined") return;

  clearTutorialSessionFlags();
  window.localStorage.setItem(TUTORIAL_ACTIVE_KEY, "true");
}

export function finishTutorialSession() {
  if (typeof window === "undefined") return;

  clearTutorialSessionFlags();
  window.localStorage.setItem(TUTORIAL_COMPLETED_KEY, "true");
}

function createStep(
  selector: string,
  title: string,
  description: string,
  side: "bottom" | "top" | "left" | "right" = "bottom",
  align: "start" | "center" | "end" = "center",
  extra?: Record<string, unknown>
) {
  if (typeof document === "undefined") return null;
  if (!document.querySelector(selector)) return null;

  return {
    element: selector,
    popover: {
      title,
      description,
      side,
      align,
      ...(extra ?? {}),
    },
  };
}

export function startPreProcessTutorial() {
  const tutorial = createTutorial();

  const steps = [
    createStep(
      '[data-tour="upload-area"]',
      "Importe sua planilha",
      "Selecione a planilha operacional da Shopee neste campo.",
      "bottom",
      "start"
    ),
    createStep(
      '[data-tour="start-analysis-button"]',
      "Inicie a análise",
      "Depois de escolher o arquivo, clique aqui para processar os endereços."
    ),
  ].filter(Boolean);

  tutorial.setSteps(steps as any);
  tutorial.drive();
  return tutorial;
}

export function startPostProcessTutorial() {
  const tutorial = createTutorial();

  const steps = [
    createStep(
      '[data-tour="results-panel"]',
      "Resultado Operacional",
      "Aqui ficam todos os endereços processados. Mesmo quando uma parada estiver OK, ela ainda deve ser conferida no mapa.",
      "bottom",
      "start"
    ),
    createStep(
      '[data-tour="auto-group-button"]',
      "Auto Agrupar",
      "Use para agrupar automaticamente paradas iguais."
    ),
    createStep(
      '[data-tour="manual-group-button"]',
      "Agrupamento manual",
      "Use este botão quando os endereços representam o mesmo local, mas não estão escritos exatamente iguais, ou em casos de condomínios e edifícios."
    ),
    createStep(
      '[data-tour="row-map-button"]',
      "Ações da parada",
      "Use este botão para abrir o mapa da parada e revisar manualmente o endereço."
    ),
    createStep(
      '[data-tour="open-map-button"]',
      "Ver no mapa",
      "Abre todas as paradas processadas no mapa para conferir visualmente e também fazer a roteirização por lá."
    ),
    createStep(
      '[data-tour="export-button"]',
      "Exportar",
      "Abre a Central de Exportação para revisar e baixar o CSV final para o Circuit."
    ),
    createStep(
      '[data-tour="new-import-button"]',
      "Importar outra planilha",
      "Use esta opção para limpar o fluxo atual e começar uma nova importação."
    ),
    createStep(
      '[data-tour="row-context-menu"]',
      "Menu operacional",
      "Clique com o botão direito sobre uma parada para abrir as ações operacionais rápidas. Depois que o menu aparecer, clique em Concluir para continuar o tutorial.",
      "bottom",
      "center",
      {
        showButtons: ["previous", "next", "close"],
        onNextClick: () => {
          if (typeof document === "undefined" || typeof window === "undefined") {
            return;
          }

          const menu = document.querySelector('[data-tour="context-menu"]');
          if (!menu) {
            window.alert(
              "Abra o menu com botão direito em uma parada antes de continuar."
            );
            return;
          }

          destroyActiveTutorial();
          window.setTimeout(() => {
            startContextMenuTutorial();
          }, 0);
        },
      }
    ),
  ].filter(Boolean);

  tutorial.setSteps(steps as any);
  tutorial.drive();
  return tutorial;
}

export function startContextMenuTutorial() {
  const tutorial = createTutorial();

  const steps = [
    createStep(
      '[data-tour="context-menu"]',
      "Menu de ações",
      "Este menu reúne ações rápidas para revisar a parada selecionada."
    ),
    createStep(
      '[data-tour="context-ungroup"]',
      "Desagrupar",
      "Use para separar uma parada que foi agrupada por engano.",
      "right",
      "start"
    ),
    createStep(
      '[data-tour="context-observation"]',
      "Observação",
      "Use para registrar uma observação operacional sobre esta parada.",
      "right",
      "start"
    ),
    createStep(
      '[data-tour="context-flag-review"]',
      "Sinalizar revisão",
      "Use para marcar a parada como pendente de conferência manual.",
      "right",
      "start"
    ),
    createStep(
      '[data-tour="context-clear-review"]',
      "Limpar revisão",
      "Use para remover a marcação de revisão quando a parada já estiver conferida.",
      "right",
      "start"
    ),
    createStep(
      '[data-tour="row-map-button"]',
      "Mapa e correção",
      "Agora clique neste botão para abrir o mapa da parada e iniciar a conferência visual do endereço.",
      "bottom",
      "center",
      {
        showButtons: ["previous", "close"],
      }
    ),
  ].filter(Boolean);

  tutorial.setSteps(steps as any);
  tutorial.drive();
  return tutorial;
}

export function startMapReviewTutorial() {
  const tutorial = createTutorial();

  const steps = [
    createStep(
      '[data-tour="map-modal"]',
      "Conferir ponto no mapa",
      "Confira visualmente se o ponto indicado corresponde ao local correto da entrega.",
      "top",
      "center"
    ),
    createStep(
      '[data-tour="map-search-input"]',
      "Conferir rua, quadra e lote",
      "Se a rua, a quadra ou o lote não estiverem compatíveis com a entrega, pesquise novamente o endereço ou ajuste a localização.",
      "top",
      "center"
    ),
    createStep(
      '[data-tour="map-confirm-button"]',
      "Confirmar somente após conferir",
      "Depois de conferir o endereço, confirme para salvar a localização revisada.",
      "top",
      "center",
      {
        showButtons: ["previous", "next", "close"],
        onNextClick: () => {
          if (typeof window === "undefined") return;

          const confirmed = window.sessionStorage.getItem(
            TUTORIAL_MAP_CONFIRMED_KEY
          );

          if (confirmed !== "true") {
            window.alert(
              "Confirme a parada no mapa antes de concluir esta etapa do tutorial."
            );
            return;
          }

          window.localStorage.setItem(
            TUTORIAL_PENDING_EXPORT_FINAL_KEY,
            "true"
          );
          window.dispatchEvent(new Event(TUTORIAL_EXPORT_FINAL_EVENT));
          destroyActiveTutorial();
        },
      }
    ),
  ].filter(Boolean);

  tutorial.setSteps(steps as any);
  tutorial.drive();
  return tutorial;
}

export function startFinalExportTutorial() {
  finishTutorialSession();

  const tutorial = createTutorial();

  const steps = [
    createStep(
      '[data-tour="export-button"]',
      "Exporte sua planilha",
      "Depois de revisar e confirmar os endereços, exporte a planilha final para importar no Circuit e iniciar sua rota.",
      "bottom",
      "center"
    ),
  ].filter(Boolean);

  tutorial.setSteps(steps as any);
  tutorial.drive();
  return tutorial;
}
