// Shared implementation extracted unchanged from the process parser.
// Identity comparisons deliberately preserve compound/separated parcel values.
export function normalizeQLValue(v: string, suffix = "") {
  let t = String(v || "")
    .toUpperCase()
    .trim()
    .replace(/^[\s\-:]+|[\s\-:]+$/g, "")
    .replace(/[^A-Z0-9\-]/g, "");

  const extra = String(suffix || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");

  if (/^[A-Z]/.test(t)) {
    const compact = t.replace(/-/g, "");
    if (/^[A-Z]$/.test(compact)) return compact;
    const m = compact.match(/^([A-Z])(\d+[A-Z0-9]*)?$/);
    if (m) return `${m[1]}${m[2] || extra}`;
    return compact;
  }

  if (/^\d/.test(t)) {
    const compact = t.replace(/-/g, "");
    const m = compact.match(/^0*(\d+)([A-Z][A-Z0-9]*)?$/);
    if (m) return `${String(Number(m[1]))}${m[2] || extra}`;
    if (/^\d+$/.test(compact)) return String(Number(compact));
    return compact;
  }

  const m = t.match(/^0*(\d+)([A-Z][A-Z0-9\-]*)?$/);
  if (m) return `${String(Number(m[1]))}${m[2] || extra}`;

  if (/^\d+$/.test(t)) return String(Number(t));
  return "";
}

export function normalizeQLIdentity(value: string) {
  const token = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  // Never merge 20/21, 24 25 or 12-23 into another parcel identifier.
  return /^(?:[A-Z0-9]+|\d+\s*[- ]\s*[A-Z][A-Z0-9]*|[A-Z]\s*-\s*\d+[A-Z0-9]*)$/.test(token) ? normalizeQLValue(token) : token;
}

export function sameQLValue(left: string, right: string) {
  const a = normalizeQLIdentity(left);
  const b = normalizeQLIdentity(right);
  return !!a && !!b && a === b;
}
