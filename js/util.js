const DIACRITICS_RE = /[̀-ͯ]/g;

/** Strips accents so "kos" matches "Košice", "cesko" matches "Česko", etc. */
export function foldDiacritics(str) {
  return str.normalize("NFD").replace(DIACRITICS_RE, "");
}

/** Reformats an ISO "YYYY-MM-DD" string to "DD.MM.YYYY"; anything else passes through unchanged. */
export function formatDateDMY(str) {
  if (!str) return str;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return str;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}
