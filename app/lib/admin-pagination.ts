export type AdminPage = { page: number; pageSize: number; total: number; pages: number };

function positiveInteger(value: string | null, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function readAdminPagination(params: URLSearchParams) {
  return {
    requestedPage: positiveInteger(params.get("page"), 1),
    pageSize: Math.min(positiveInteger(params.get("pageSize"), 25), 50),
    query: params.get("q")?.trim().slice(0, 200) ?? "",
  };
}

export function adminPage(requestedPage: number, pageSize: number, total: number): AdminPage {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(requestedPage, pages), pageSize, total, pages };
}
