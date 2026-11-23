"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

type Campaign = {
  id: string;
  title: string;
  body: string;
  audience: "user" | "all" | "plan" | "no-subscription";
  target: string | null;
  recipientCount: number;
  createdAt: string;
};

const control = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2";
const dateLabel = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const audienceLabels = {
  user: "Usuário específico",
  all: "Todos os usuários cadastrados",
  BASIC: "Assinantes Basic",
  PRO: "Assinantes Pro",
  "no-subscription": "Usuários sem assinatura ativa",
};
type AudienceChoice = keyof typeof audienceLabels;

export default function NotificationCampaigns({ canBroadcast }: { canBroadcast: boolean }) {
  const [choice, setChoice] = useState<AudienceChoice>("user");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const retry = useRef<{ draft: string; requestId: string } | null>(null);

  async function load(before?: string) {
    setLoading(true);
    setHistoryError(false);
    try {
      const response = await fetch(`/api/admin/notifications${before ? `?before=${encodeURIComponent(before)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const page: { campaigns: Campaign[]; next: string | null } = await response.json();
      setCampaigns((previous) => before ? [...previous, ...page.campaigns] : page.campaigns);
      setNext(page.next);
    } catch {
      setHistoryError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const plan = choice === "BASIC" || choice === "PRO";
    const kind = plan ? "plan" : choice;
    const target = plan ? choice : fields.get("target");
    const draft = { kind, target, title: fields.get("title"), body: fields.get("body") };
    const serialized = JSON.stringify(draft);
    if (retry.current?.draft !== serialized) retry.current = { draft: serialized, requestId: crypto.randomUUID() };
    setNotice(null);
    setSending(true);
    try {
      let expectedRecipientCount: number | undefined;
      if (choice !== "user") {
        const params = new URLSearchParams({ mode: "preview", kind, target: String(target ?? "") });
        const preview = await fetch(`/api/admin/notifications?${params}`, { cache: "no-store" });
        const data = await preview.json().catch(() => null);
        if (!preview.ok) throw new Error(data?.error || "Falha ao consultar os destinatários.");
        const count: number = data.recipientCount;
        if (!count) {
          setNotice({ text: "Nenhum usuário corresponde ao público escolhido.", error: true });
          return;
        }
        if (!window.confirm(`${audienceLabels[choice]}\nDestinatários: ${count.toLocaleString("pt-BR")}\n\nConfirmar envio?`)) return;
        expectedRecipientCount = count;
      }
      const response = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, requestId: retry.current.requestId, expectedRecipientCount }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Falha ao enviar a notificação.");
      const count = data.campaign.recipientCount;
      setNotice({ text: count ? `Notificação enviada. Destinatários: ${count}.` : "Nenhum usuário ativo corresponde ao público escolhido.", error: !count });
      retry.current = null;
      form.reset();
      setChoice("user");
      await load();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Falha ao enviar a notificação.", error: true });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-3 py-4 md:px-6">
      <h1 className="text-2xl font-extrabold text-[#17313b]">Notificações administrativas</h1>
      <form className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm" onSubmit={send}>
        <fieldset disabled={sending} className="space-y-4">
          <label className="block space-y-1 text-sm font-semibold">Destinatários
            <select className={control} value={choice} onChange={(event) => setChoice(event.target.value as AudienceChoice)}>
              <option value="user">{audienceLabels.user}</option>
              {canBroadcast && (["all", "BASIC", "PRO", "no-subscription"] as const).map((option) =>
                <option key={option} value={option}>{audienceLabels[option]}</option>
              )}
            </select>
          </label>
          {choice === "user" && <label className="block space-y-1 text-sm font-semibold">E-mail do destinatário
            <input className={control} name="target" type="email" maxLength={254} required />
          </label>}
          <label className="block space-y-1 text-sm font-semibold">Título
            <input className={control} name="title" required maxLength={120} />
          </label>
          <label className="block space-y-1 text-sm font-semibold">Mensagem
            <textarea className={control} name="body" rows={4} required maxLength={2000} />
          </label>
          <button className="rounded-xl bg-[#17313b] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {sending ? "Enviando…" : "Enviar notificação"}
          </button>
        </fieldset>
        {notice && <p role={notice.error ? "alert" : "status"} className={`mt-3 text-sm ${notice.error ? "text-rose-700" : "text-emerald-800"}`}>{notice.text}</p>}
      </form>
      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-[#17313b]">Histórico de envios</h2>
        {historyError && <p role="alert" className="my-3 text-sm text-rose-700">Falha ao carregar o histórico. <button type="button" className="underline" onClick={() => void load()}>Tentar novamente</button></p>}
        {loading && <p role="status" className="my-3 text-sm text-slate-600">Carregando…</p>}
        {!loading && !historyError && campaigns.length === 0 && <p className="my-3 text-sm text-slate-600">Nenhum envio registrado.</p>}
        <ul className="divide-y divide-slate-100">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="space-y-1 py-3">
              <h3 className="break-words font-semibold">{campaign.title}</h3>
              <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{campaign.body}</p>
              <p className="break-words text-xs text-slate-500">
                {campaign.audience === "all" || campaign.audience === "no-subscription" ? audienceLabels[campaign.audience] : campaign.target} · {campaign.recipientCount} destinatário(s) ·{" "}
                <time dateTime={campaign.createdAt}>{dateLabel.format(new Date(campaign.createdAt))}</time>
              </p>
            </li>
          ))}
        </ul>
        {next && <button type="button" className="mt-3 text-sm font-semibold text-emerald-800" disabled={loading} onClick={() => void load(next)}>Ver mais</button>}
      </section>
    </div>
  );
}
