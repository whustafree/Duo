// Retención de mensajes: la pareja decide cuánto dura la copia local.
// Solo afecta a ESTE teléfono (el otro puede tener otra política).

export const TTL_OPTIONS = [
  { days: 0, label: "Nunca" },
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

export function parseTtlDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

// ¿Este mensaje ya venció? `ttlDays === 0` desactiva el borrado.
export function isExpired(row, ttlDays, now = Date.now()) {
  if (!ttlDays || !row) return false;
  const ts = Number(row.ts) || 0;
  if (!ts) return false;
  return now - ts > ttlDays * 24 * 60 * 60 * 1000;
}

export function filterExpired(rows, ttlDays, now = Date.now()) {
  const keep = [];
  const gone = [];
  for (const r of rows || []) {
    (isExpired(r, ttlDays, now) ? gone : keep).push(r);
  }
  return { keep, gone };
}
