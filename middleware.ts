import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { SUPER_ADMIN_EMAIL } from "@/app/lib/admin-roles";

const PUBLIC_PATHS = ["/login"];
const ADMIN_PATHS = ["/admin"];
const ADMIN_API_PREFIX = "/api/admin";
const PUBLIC_FILE = /\.(png|jpg|jpeg|webp|svg|ico)$/i;

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/auth") || // só NextAuth público
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE.test(pathname) ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/public")
  );
}

function isAdminPath(pathname: string) {
  return ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAdminApi(pathname: string) {
  return pathname === ADMIN_API_PREFIX || pathname.startsWith(ADMIN_API_PREFIX + "/");
}

function isSuperAdminToken(token: unknown) {
  const role = String((token as any)?.role ?? "").trim().toUpperCase();
  const email = String((token as any)?.email ?? "").trim().toLowerCase();
  return role === "ADMIN" && email === SUPER_ADMIN_EMAIL;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ NÃO deixa o middleware mexer em APIs (exceto /api/admin)
  if (pathname.startsWith("/api/") && !isAdminApi(pathname)) {
    return NextResponse.next();
  }

  // ✅ libera rotas públicas e assets
  if (isPublicPath(pathname)) return NextResponse.next();

  // ✅ exige login para páginas protegidas + /api/admin
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    // ✅ NÃO carregar lat/lng pro /login (zera query)
    const url = new URL("/login", req.url);
    const callbackUrl = req.nextUrl.pathname + req.nextUrl.search;
url.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(url);
  }

  // ✅ protege ADMIN (páginas)
  if (isAdminPath(pathname)) {
    const role = (token as any)?.role;
    if (role !== "ADMIN") {
      const url = new URL("/", req.url);
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/admin/administrators") && !isSuperAdminToken(token)) {
      const url = new URL("/admin", req.url);
      return NextResponse.redirect(url);
    }
  }

  // ✅ protege ADMIN (APIs)
  if (isAdminApi(pathname)) {
    const role = (token as any)?.role;
    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (pathname.startsWith("/api/admin/administrators") && !isSuperAdminToken(token)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

// ✅ IMPORTANTÍSSIMO: não rodar em /api/*
export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)", "/api/admin/:path*"],
};
