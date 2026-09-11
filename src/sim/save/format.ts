// Date formatting for the load screen (plan §14.4): the player's locale and time zone by default.
export function formatSaveDate(isoUtc: string, locale?: string, timeZone?: string): string {
  const t = Date.parse(isoUtc);
  if (!Number.isFinite(t)) return 'Unknown date';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(t));
  } catch {
    return new Date(t).toLocaleString();
  }
}

export function formatPlayTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "4.2 lb" style weight. */
export function formatWeight(lb: number): string {
  return `${lb.toFixed(1)} lb`;
}
