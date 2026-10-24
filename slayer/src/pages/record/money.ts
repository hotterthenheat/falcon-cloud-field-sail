/* Money on the Dossier, said one way (the Dossier sweep, 2026-10-22): "$2096.11B", "+4,875M" and "$0M" read as raw
   counts. Every figure is in dollars at its own scale — $2.10T, $45.1B, $649M — signed with a true minus. */

/** Millions of dollars at their own scale */
export const moneyM = (absM: number): string =>
  absM <= 0
    ? '$0'
    : absM >= 1_000_000
      ? `$${(absM / 1_000_000).toFixed(2)}T`
      : absM >= 1000
        ? `$${(absM / 1000).toFixed(absM >= 100_000 ? 0 : absM >= 10_000 ? 1 : 2)}B`
        : absM >= 1
          ? `$${absM.toFixed(0)}M`
          : `$${(absM * 1000).toFixed(0)}K`;

/** Whole dollars to two or three significant figures: $1.43M, $23.4M, $857M, $1.13B, $4.20K (the re-audit, 2026-10-22:
    "$1M" for $1.43M rounded away a third of the figure) */
export const dollars3 = (v: number): string => {
  const a = Math.abs(v);
  const sig = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
  const s = a >= 1e12 ? `${sig(a / 1e12)}T` : a >= 1e9 ? `${sig(a / 1e9)}B` : a >= 1e6 ? `${sig(a / 1e6)}M` : a >= 1e3 ? `${sig(a / 1e3)}K` : a.toFixed(0);
  return `${v < 0 ? '−' : ''}$${s}`;
};

/** Signed millions: +$4.9B, −$649M */
export const signedM = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${moneyM(Math.abs(n))}`;

/** Billions of dollars at their own scale */
export const moneyB = (b: number): string => moneyM(b * 1000);

/** Shares left to borrow, millions. The borrow feed caps the count at 10,000,000 — a row at the cap reads "10M+", not an
    exact 10.00M (the Dossier ship pass, 2026-10-22: half the short book printed "10.00M"). */
export const borrowM = (m: number | null): string => (m == null ? '—' : m >= 10 - 1e-9 ? '10M+' : m >= 1 ? `${m.toFixed(2)}M` : `${Math.round(m * 1000)}K`);

/** A vendor date (YYYY-MM-DD) as "Oct 20" — every as-of stamp on the Dossier */
export const asOfDay = (iso: string | null | undefined): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** "Jan 22, 1993" for a "1993-01-22" — a date a year or more back carries its year (round 11: raw ISO dates on the
    ETF's "since", the 13F's first buy); anything unreadable as it came */
export const longDay = (iso: string | null | undefined): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
