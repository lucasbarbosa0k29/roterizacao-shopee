export const SUPER_ADMIN_EMAIL = "lucasbarbosa0k29@gmail.com";

type AdminPrincipal = {
  role?: string | null;
  email?: string | null;
} | null | undefined;

function normalizeEmail(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

export function isAdminRole(user: AdminPrincipal) {
  return (user?.role ?? "").toUpperCase() === "ADMIN";
}

export function isSuperAdmin(user: AdminPrincipal) {
  return isAdminRole(user) && normalizeEmail(user?.email) === SUPER_ADMIN_EMAIL;
}

export function requireAdmin(user: AdminPrincipal) {
  return isAdminRole(user);
}

export function requireSuperAdmin(user: AdminPrincipal) {
  return isSuperAdmin(user);
}

export function isSuperAdminEmail(email?: string | null) {
  return normalizeEmail(email) === SUPER_ADMIN_EMAIL;
}
