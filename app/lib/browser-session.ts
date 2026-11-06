// Optional UI hints only. Authentication must not depend on browser storage.
export function readSessionHint(key: string): string | null {
  try { return window.sessionStorage.getItem(key); }
  catch { return null; }
}

export function writeSessionHint(key: string, value: string): void {
  try { window.sessionStorage.setItem(key, value); }
  catch { /* The user can still enter their email on the confirmation page. */ }
}

export function removeSessionHint(key: string): void {
  try { window.sessionStorage.removeItem(key); }
  catch { /* Storage can be unavailable in restricted browser contexts. */ }
}
