// Compact, human elapsed-time formatting shared by the terminal presenter and
// the web console's "elapsed" chips. Pure. Sub-minute → seconds; under an hour
// → "Nm Ss"; otherwise "Nh Mm". Never negative.
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
