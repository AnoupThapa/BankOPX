/** Durations for people: "1 h 05 min". Inputs are milliseconds from the event history. */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 60_000) return ms < 1000 ? '< 1 s' : `${Math.round(ms / 1000)} s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
