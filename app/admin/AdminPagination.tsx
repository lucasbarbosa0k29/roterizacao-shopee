import type { AdminPage } from "@/app/lib/admin-pagination";

export default function AdminPagination({ value, onChange }: { value: AdminPage; onChange: (page: number) => void }) {
  if (value.pages < 2) return null;
  return (
    <nav aria-label="Paginação" className="flex items-center justify-end gap-3 px-3 py-4 text-sm text-slate-700">
      <button type="button" className="rounded-xl border px-3 py-2 disabled:opacity-40"
        disabled={value.page === 1} onClick={() => onChange(value.page - 1)}>
        Anterior
      </button>
      <span>Página {value.page} de {value.pages}</span>
      <button type="button" className="rounded-xl border px-3 py-2 disabled:opacity-40"
        disabled={value.page === value.pages} onClick={() => onChange(value.page + 1)}>
        Próxima
      </button>
    </nav>
  );
}
