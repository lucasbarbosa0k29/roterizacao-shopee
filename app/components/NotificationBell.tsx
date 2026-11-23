"use client";

import { Bell, Check, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Item = {
  messageId: string;
  createdAt: string;
  readAt: string | null;
  message: { title: string; body: string };
};
type Inbox = { items: Item[]; next: string | null; asOf: string; unread: number };
const dateLabel = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const actionStyle = "rounded-xl px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50";

async function inboxRequest<T>(query = "", body?: object): Promise<T> {
  const response = await fetch(`/api/notifications${query}`, {
    cache: "no-store",
    ...(body ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("Falha ao consultar notificações");
  return response.json();
}

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    if (open) return;
    let active = true;
    let loadingCount = false;
    async function refresh() {
      if (loadingCount || document.hidden || Date.now() - lastCount.current < 60_000) return;
      loadingCount = true;
      try {
        const result = await inboxRequest<{ unread: number }>("?mode=count");
        if (active) {
          lastCount.current = Date.now();
          setUnread(result.unread);
        }
      } catch { /* Opening the inbox allows an explicit retry. */ }
      finally { loadingCount = false; }
    }
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [open]);

  async function load(before?: string) {
    setBusy(true);
    setError(false);
    try {
      const page = await inboxRequest<Inbox>(before ? `?before=${encodeURIComponent(before)}` : "");
      setInbox((previous) => before && previous
        ? { ...previous, items: [...previous.items, ...page.items], next: page.next }
        : page);
      setUnread(page.unread);
      lastCount.current = Date.now();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function update(action: "read" | "delete", messageId?: string) {
    if (!inbox || busy) return;
    setBusy(true);
    setError(false);
    setConfirmDelete(false);
    try {
      const result = await inboxRequest<{ unread: number }>("", {
        action,
        ...(messageId ? { messageId } : { through: inbox.asOf }),
      });
      setUnread(result.unread);
      if (action === "delete") {
        await load();
      } else {
        const readAt = new Date().toISOString();
        setInbox({ ...inbox, items: inbox.items.map((item) =>
          !messageId || item.messageId === messageId ? { ...item, readAt: item.readAt ?? readAt } : item) });
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={unread ? `Notificações, ${unread} não lidas` : "Notificações"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#17313b] shadow-sm ring-1 ring-slate-200 hover:bg-emerald-50"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
          setInbox(null);
          void load();
        }}
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[#17634c] px-1 text-center text-[11px] font-bold leading-5 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="notification-inbox-title"
        onClose={() => { setOpen(false); setConfirmDelete(false); }}
        className="fixed inset-x-3 bottom-auto top-16 m-0 w-auto max-w-none rounded-[18px] border border-slate-200 bg-white p-0 text-slate-900 shadow-[0_10px_22px_rgba(15,23,42,0.10)] backdrop:bg-transparent sm:inset-x-auto sm:bottom-auto sm:left-auto sm:right-5 sm:top-16 sm:w-[420px] sm:rounded-[24px] sm:shadow-xl sm:backdrop:bg-slate-950/35"
      >
        <section className="flex max-h-[min(78dvh,650px)] flex-col pb-[env(safe-area-inset-bottom)]">
          <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 id="notification-inbox-title" className="text-lg font-bold text-[#17313b]">Notificações</h2>
            <button type="button" aria-label="Fechar notificações" className={actionStyle} onClick={() => dialog.current?.close()}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          {inbox && inbox.items.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 py-2">
              <button type="button" className={actionStyle} disabled={busy || unread === 0} onClick={() => void update("read")}>Marcar todas como lidas</button>
              <button type="button" className={`${actionStyle} text-rose-700`} disabled={busy} onClick={() => setConfirmDelete(true)}>Excluir todas</button>
            </div>
          )}
          {confirmDelete && (
            <div role="group" aria-label="Confirmar exclusão coletiva" className="mx-4 mb-2 rounded-xl bg-rose-50 p-3 text-sm">
              <p>Excluir todas as notificações atuais?</p>
              <button type="button" className={actionStyle} onClick={() => setConfirmDelete(false)}>Cancelar</button>
              <button type="button" className={`${actionStyle} text-rose-700`} onClick={() => void update("delete")}>Confirmar exclusão</button>
            </div>
          )}
          <div className="overflow-y-auto px-4 pb-4">
            {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">Não foi possível atualizar. <button type="button" className="underline" onClick={() => void load()}>Tentar novamente</button></p>}
            {busy && <p role="status" className="p-3 text-sm text-slate-500">Atualizando…</p>}
            {inbox?.items.length === 0 && !busy && <p className="py-6 text-center text-sm text-slate-500">Nenhuma notificação.</p>}
            <ul className="space-y-2">
              {inbox?.items.map((item) => (
                <li key={item.messageId} className={`rounded-2xl border p-3 ${item.readAt ? "border-slate-200 bg-white" : "border-emerald-200 bg-emerald-50"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words text-sm font-bold">{item.message.title}</h3>
                    {!item.readAt && <span className="shrink-0 text-xs font-semibold text-emerald-800">Não lida</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{item.message.body}</p>
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <time dateTime={item.createdAt} className="text-xs text-slate-500">{dateLabel.format(new Date(item.createdAt))}</time>
                    <div className="flex">
                      {!item.readAt && <button type="button" aria-label={`Marcar ${item.message.title} como lida`} className={actionStyle} disabled={busy} onClick={() => void update("read", item.messageId)}><Check size={16} aria-hidden="true" /></button>}
                      <button type="button" aria-label={`Excluir ${item.message.title}`} className={`${actionStyle} text-rose-700`} disabled={busy} onClick={() => void update("delete", item.messageId)}><Trash2 size={16} aria-hidden="true" /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {inbox?.next && <button type="button" className={actionStyle} disabled={busy} onClick={() => void load(inbox.next ?? undefined)}>Ver mais</button>}
          </div>
        </section>
      </dialog>
    </>
  );
}
