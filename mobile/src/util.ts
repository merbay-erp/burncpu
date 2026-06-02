// Compact relative time, Turkish-style abbreviations (matches the web:
// şimdi / dk / sa / g / h / ay / y).
export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'şimdi';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}dk`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}sa`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}g`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}h`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}ay`;
  return `${Math.floor(d / 365)}y`;
}
