"use client";

import { useRouter } from "next/navigation";
import type { ChangeEvent, FormEvent } from "react";
import type { RouteImportAccess, RouteJobProgress } from "../../lib/useRouteImportFlow";

type RouteUploadBoxProps = {
  variant: "web" | "twa";
  file: File | null;
  loading: boolean;
  access: RouteImportAccess;
  jobProgress: RouteJobProgress;
  setFile: (file: File | null) => void;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (e: FormEvent<HTMLFormElement>) => void;
};

export function RouteUploadBox({
  variant,
  file,
  loading,
  access,
  jobProgress,
  setFile,
  handleFileChange,
  handleSubmit,
}: RouteUploadBoxProps) {
  const router = useRouter();

  if (variant === "web") {
    return (
      <form onSubmit={handleSubmit} className="w-full">
        <div
          data-tour="upload-area"
          data-rotta-home-upload-panel
          className="rounded-[28px] border border-slate-200/80 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] md:p-6"
        >
          <div
            className="flex flex-col gap-3 md:flex-row md:gap-4"
            data-rotta-home-upload-actions
          >
            {/* INPUT PLANILHA */}
            <label
              className="flex-1 cursor-pointer rounded-[24px] border border-dashed border-[#7bb7ab] bg-[linear-gradient(180deg,#f8fcfb_0%,#f1f7f6_100%)] transition p-4 hover:border-[#1f5a6b] hover:bg-white md:p-5"
              onClick={(e) => {
                if (access?.canStartRoute !== false) return;
                e.preventDefault();
                setFile(null);
                router.replace("/planos");
              }}
            >
              <input
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                disabled={access?.canStartRoute === false}
                onChange={handleFileChange}
              />

              <div className="flex items-center gap-3 md:gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#dff5ef] text-lg text-[#0f5f58] md:h-12 md:w-12 md:text-xl">
                  ⬆️
                </div>

                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 md:text-base">
                    Carregar Arquivo Operacional
                  </div>
                  <div className="truncate text-xs text-slate-600 md:text-sm">
                    {file ? file.name : "Nenhum arquivo escolhido"}
                  </div>
                </div>
              </div>
            </label>

            {/* BOTÃO BUSCAR */}
            <button
              type="submit"
              disabled={loading}
              data-tour="start-analysis-button"
              className="min-h-[52px] w-full rounded-[20px] bg-[#17313b] text-sm font-semibold text-white shadow-[0_16px_30px_rgba(23,49,59,0.24)] hover:bg-[#10242c] disabled:opacity-50 md:w-[220px] md:min-h-[56px] md:text-base"
            >
              {loading ? "Processando..." : "Iniciar Análise"}
            </button>
          </div>

          {loading && !jobProgress && (
            <p className="mt-4 text-sm text-slate-500">Processando...</p>
          )}

          {loading && jobProgress && (
            <div className="mt-4 rounded-[22px] border border-[#cde3dd] bg-[#f4fbf8] px-4 py-4 text-sm text-slate-800">
              <div className="font-semibold">
                {jobProgress.status === "PENDING" ? "Importação iniciada" : "Processando planilha"}
              </div>
              <div className="mt-1">
                Progresso: {jobProgress.processedStops}/{jobProgress.totalStops}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-[#0f766e] transition-all"
                  style={{
                    width: `${jobProgress.totalStops ? (jobProgress.processedStops / jobProgress.totalStops) * 100 : 0}%`,
                  }}
                />
              </div>
              {jobProgress.errorMessage && (
                <div className="mt-2 text-red-700">
                  Erro: {jobProgress.errorMessage}
                </div>
              )}
            </div>
          )}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#dff5ef] text-lg text-[#0f5f58]">
            ⬆️
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900">Carregar Arquivo Operacional</div>
            <div className="truncate text-xs text-slate-600">
              {file ? file.name : "Nenhum arquivo escolhido"}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <label
            className="block cursor-pointer rounded-[18px] border border-dashed border-[#7bb7ab] bg-[linear-gradient(180deg,#f8fcfb_0%,#f1f7f6_100%)] p-4"
            onClick={(e) => {
              if (access?.canStartRoute !== false) return;
              e.preventDefault();
              setFile(null);
              router.replace("/planos");
            }}
          >
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              disabled={access?.canStartRoute === false}
              onChange={handleFileChange}
            />
            <div className="text-sm text-slate-700">
              Toque para escolher uma planilha operacional
            </div>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-[#17313b] text-sm font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? "Processando..." : "Iniciar Análise"}
          </button>
        </div>

        {loading && !jobProgress && (
          <p className="mt-4 text-sm text-slate-500">Processando...</p>
        )}

        {loading && jobProgress && (
          <div className="mt-4 rounded-[18px] border border-[#cde3dd] bg-[#f4fbf8] px-4 py-4 text-sm text-slate-800">
            <div className="font-semibold">
              {jobProgress.status === "PENDING" ? "Importação iniciada" : "Processando planilha"}
            </div>
            <div className="mt-1">
              Progresso: {jobProgress.processedStops}/{jobProgress.totalStops}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-[#17313b] transition-all"
                style={{
                  width: `${jobProgress.totalStops ? (jobProgress.processedStops / jobProgress.totalStops) * 100 : 0}%`,
                }}
              />
            </div>
            {jobProgress.errorMessage && (
              <p className="mt-3 text-xs text-rose-600">
                Erro: {jobProgress.errorMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
