"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

type MenuItem = {
  label: string;
  href: string;
  note?: string;
};

const baseItems: MenuItem[] = [
  { label: "Tutorial", href: "/tutorial" },
  { label: "Minha Assinatura", href: "/planos", note: "Renovar e comprar créditos" },
];

const adminItems: MenuItem[] = [
  { label: "Administração", href: "/admin", note: "Controles internos" },
  { label: "Usuários", href: "/admin/users", note: "Gestão de contas" },
  { label: "Assinaturas", href: "/admin/subscriptions", note: "Planos e créditos" },
  { label: "Administradores", href: "/admin/administrators", note: "Permissões e auditoria" },
];

export default function MaisPage() {
  const { data: session } = useSession();
  const isAdmin = String((session?.user as { role?: string } | undefined)?.role || "").toUpperCase() === "ADMIN";
  const items = isAdmin ? [...baseItems, ...adminItems] : baseItems;

  return (
    <main className="min-h-screen bg-[#f4f7f6] px-4 py-4 text-slate-900">
      <div className="mx-auto w-full max-w-[480px] space-y-4">
        <section className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#1f5a6b]">Menu</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Mais</h1>
          <p className="mt-1 text-sm text-slate-600">
            Acesso rápido aos atalhos antigos da conta e da administração.
          </p>
        </section>

        <section className="space-y-3">
          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-white px-4 py-4 text-slate-900 shadow-sm transition hover:bg-slate-50"
            >
              <div>
                <div className="text-sm font-semibold">{item.label}</div>
                {item.note ? <div className="mt-1 text-xs text-slate-500">{item.note}</div> : null}
              </div>
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                Abrir
              </span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
