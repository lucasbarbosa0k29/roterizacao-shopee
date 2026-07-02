"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { TwaAccountSheet } from "./TwaAccountSheet";
import { RouteUploadBox } from "../upload/RouteUploadBox";
import { useRouteImportFlow } from "../../lib/useRouteImportFlow";
import { listHistoryDb, type DbHistoryListItem } from "../../lib/history-db";

type AccessSnapshot = {
  code: "OK" | "ACCESS_BLOCKED" | "NO_ACTIVE_SUBSCRIPTION" | "NO_ROUTE_CREDITS";
  canStartRoute: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  message: string | null;
  activeSubscription: null | {
    code: "FREE" | "BASIC" | "PRO";
    expiresAt: string | null;
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
  };
};

type RecentJob = DbHistoryListItem & {
  status?: "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "REVIEW";
};

function statusLabel(status: RecentJob["status"]) {
  if (status === "PROCESSING") return "Processando";
  if (status === "REVIEW") return "Em revisão";
  if (status === "PENDING") return "Em revisão";
  if (status === "DONE") return "Concluída";
  return "Pronto para exportar";
}

function relativeLabel(savedAt: number) {
  const diffMs = Date.now() - savedAt;
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) return "Agora mesmo";
  if (diffMin < 60) return `Há ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `Há ${diffHours} h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "Ontem";
  return `Há ${diffDays} dias`;
}

async function loadRecentJobs(): Promise<RecentJob[]> {
  const items = await listHistoryDb();
  const enriched = await Promise.all(
    items.slice(0, 3).map(async (item) => {
      try {
        const res = await fetch(`/api/history/${encodeURIComponent(item.id)}?mode=progress`, {
          credentials: "include",
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
        });
        if (!res.ok) return item;
        const body = await res.json().catch(() => null);
        const job = body?.job;
        return {
          ...item,
          status: job?.displayStatus ?? job?.status,
        };
      } catch {
        return item;
      }
    })
  );

  return enriched;
}

export function HomeTwaMobile() {
  const router = useRouter();
  const uploadRef = useRef<HTMLDivElement | null>(null);
  const { data: session, status } = useSession();
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const fullName = session?.user?.name?.trim() ?? "";
  const firstName = fullName ? fullName.split(/\s+/)[0] : "";
  const secondName = fullName.split(/\s+/)[1] ?? "";
  const displayName = [firstName, secondName].filter(Boolean).join(" ");
  const greeting = firstName ? `Olá, ${firstName}!` : "Olá!";
  const avatarInitial = firstName ? firstName[0].toUpperCase() : "R";
  const avatarImage = session?.user?.image ?? null;
  const {
    file,
    setFile,
    loading,
    jobProgress,
    handleFileChange,
    handleSubmit,
  } = useRouteImportFlow({
    access,
    deferJobUrlUpdate: true,
    onImportSuccess: ({ jobId }) => {
      if (jobId) {
        router.push(`/?job=${encodeURIComponent(jobId)}`);
      }
    },
  });
  const showSubscriptionAlert =
    access !== null &&
    (access.code === "NO_ACTIVE_SUBSCRIPTION" ||
      access.code === "ACCESS_BLOCKED" ||
      access.code === "NO_ROUTE_CREDITS" ||
      access.canStartRoute === false);
  const hasActiveSubscription = Boolean(
    access?.activeSubscription && access.activeSubscription.code !== "FREE"
  );
  const dailyLimitReached =
    hasActiveSubscription && access?.code === "NO_ROUTE_CREDITS" && access?.canStartRoute === false;

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
          activeSubscription: data.activeSubscription ?? null,
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

  useEffect(() => {
    let alive = true;

    const refreshRecent = async () => {
      try {
        setRecentLoading(true);
        const items = await loadRecentJobs();
        if (alive) setRecentJobs(items);
      } catch {
        if (alive) setRecentJobs([]);
      } finally {
        if (alive) setRecentLoading(false);
      }
    };

    void refreshRecent();

    const onHistoryChange = () => {
      void refreshRecent();
    };

    window.addEventListener("history-db-changed", onHistoryChange);
    return () => {
      alive = false;
      window.removeEventListener("history-db-changed", onHistoryChange);
    };
  }, []);

  const recentEmpty = useMemo(() => !recentLoading && recentJobs.length === 0, [recentLoading, recentJobs.length]);

  function openFromHistory(id: string) {
    router.push(`/?job=${encodeURIComponent(id)}`);
  }

  return (
    <section className="min-h-[100dvh] bg-[#f4f7f6] pb-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4 px-4 pb-4 pt-4">
        <header className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <div className="flex h-11 w-11 overflow-hidden rounded-full bg-[#17313b] text-sm font-semibold text-white shadow-sm ring-1 ring-slate-200">
              {avatarImage ? (
                <img
                  src={avatarImage}
                  alt={fullName || "Perfil"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">{avatarInitial}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{greeting}</p>
              <p className="text-xs text-slate-500">Roteirização inteligente para sua operação.</p>
            </div>
          </button>
        </header>

        {showSubscriptionAlert ? (
          <section className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 shadow-sm">
            <h2 className="text-sm font-semibold">
              {dailyLimitReached ? "Limite diário atingido" : "Assinatura necessária"}
            </h2>
            <p className="mt-1 text-sm leading-5 text-amber-900">
              {dailyLimitReached
                ? "Você utilizou todas as rotas disponíveis do seu plano hoje. Adquira uma rota avulsa para continuar processando planilhas imediatamente ou aguarde a renovação da sua cota diária."
                : "Ative um plano para continuar processando planilhas."}
            </p>
            {!dailyLimitReached && (access.blockReason || access.message) ? (
              <p className="mt-2 text-xs leading-5 text-amber-800">
                {access.blockReason || access.message}
              </p>
            ) : null}
            <Link
              href="/planos"
              className="mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-[#17313b] px-4 text-sm font-semibold text-white shadow-sm transition active:scale-[0.99]"
            >
              {dailyLimitReached ? "Comprar rota avulsa" : "Ver planos"}
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

          <div ref={uploadRef} className="space-y-4 px-4 py-4">
            <RouteUploadBox
              variant="twa"
              file={file}
              loading={loading}
              access={access}
              jobProgress={jobProgress}
              setFile={setFile}
              handleFileChange={handleFileChange}
              handleSubmit={handleSubmit}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Recente</h2>
            <Link href="/historico" className="text-xs text-slate-500">
              Ver todas
            </Link>
          </div>

          {recentLoading ? (
            <div className="rounded-[18px] bg-white px-4 py-4 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
              Carregando recentes...
            </div>
          ) : recentEmpty ? (
            <div className="rounded-[18px] bg-white px-4 py-4 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
              Nenhum histórico encontrado ainda.
            </div>
          ) : (
            <div className="space-y-3">
              {recentJobs.map((item) => {
                const savedAtDate = new Date(item.savedAt);

                return (
                  <article
                    key={item.id}
                    className="rounded-[18px] bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
                  >
                    <button
                      type="button"
                      onClick={() => openFromHistory(item.id)}
                      className="flex w-full items-start justify-between gap-3 text-left"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eef4f2] text-[11px] font-semibold text-[#17313b] ring-1 ring-slate-200">
                          XLSX
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {savedAtDate.toLocaleDateString("pt-BR")} · {relativeLabel(item.savedAt)}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                        {statusLabel(item.status)}
                      </span>
                    </button>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openFromHistory(item.id)}
                        className="text-xs font-semibold text-[#0f4f64]"
                      >
                        Abrir
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <TwaAccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        displayName={displayName || fullName || "Usuário"}
      />
    </section>
  );
}
