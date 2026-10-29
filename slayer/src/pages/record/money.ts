/* The Dossier's one set of number formatters: dollars at their own scale, signed with a true minus. */

const UNITS = ['', 'K', 'M', 'B', 'T'];
const sig = (x: number) => (x >= 99.95 ? x.toFixed(0) : x >= 9.995 ? x.toFixed(1) : x.toFixed(2));

/** Whole dollars to two or three significant figures: $1.43M, $23.4M, $857M, $1.13B */
export const dollars3 = (v: number): string => {
  const a = Math.abs(v);
  let i = 0;
  let s = a.toFixed(0);
  /* the unit is chosen on the rounded figure, so 999.6K reads $1.00M */
  while (i < UNITS.length - 1 && Number(s) >= 1000) {
    i++;
    s = sig(a / 10 ** (3 * i));
  }
  return `${v < 0 ? '−' : ''}$${s}${UNITS[i]}`;
};

/** Millions of dollars at their own scale */
export const moneyM = (absM: number): string => (absM <= 0 ? '$0' : dollars3(absM * 1e6));

/** Signed millions: +$4.9B, −$649M */
export const signedM = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${moneyM(Math.abs(n))}`;

/** Billions of dollars at their own scale */
export const moneyB = (b: number): string => moneyM(b * 1000);

/** Shares left to borrow, millions; the feed caps the count at 10M, so a capped row reads "10M+" */
export const borrowM = (m: number | null): string => (m == null ? '—' : m >= 10 - 1e-9 ? '10M+' : m >= 1 ? `${m.toFixed(2)}M` : `${Math.round(m * 1000)}K`);

/** "+1.2%", "−0.4%", and "0.0%" when it rounds to nothing */
export const signedPct = (v: number, d = 1): string => {
  const s = Math.abs(v).toFixed(d);
  if (Number(s) === 0) return `${(0).toFixed(d)}%`;
  return `${v > 0 ? '+' : '−'}${s}%`;
};

/** A vendor number field: a number, a numeric string, or null */
export const numOr = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** A vendor date (YYYY-MM-DD) as "Oct 20" */
export const asOfDay = (iso: string | null | undefined): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** "Jan 22, 1993" for "1993-01-22"; anything unreadable as it came */
export const longDay = (iso: string | null | undefined): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
