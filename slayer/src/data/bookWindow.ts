import type { MarketSnapshot, StrikeNode } from '../types/market';

/*
==================================================
  SLAYER TERMINAL - THE EXPIRIES IN HAND
  (data/bookWindow.ts)

  The book’s Expiries card is a window of real dates.
  The clock, the level report and the tape were still
  reading today, or every date, on their own. This
  folds the dates the reader actually picked into one
  chain, so those boxes read the same book the matrix
  is showing.
==================================================
*/

const listedDates = (snapshot: MarketSnapshot): string[] =>
  (snapshot.uwExpiries ?? [])
    .filter(e => snapshot.uwByDate?.[e.date]?.length)
    .sort((a, b) => a.date.localeCompare(b.date) || a.dte - b.dte)
    .map(e => e.date);

const add = (into: StrikeNode, n: StrikeNode): void => {
  const w0 = into.callOI + into.putOI;
  const w1 = n.callOI + n.putOI;
  const w = w0 + w1;
  if (w > 0) {
    into.gamma = (into.gamma * w0 + n.gamma * w1) / w;
    into.vanna = (into.vanna * w0 + n.vanna * w1) / w;
    into.charm = (into.charm * w0 + n.charm * w1) / w;
  }
  into.callOI += n.callOI;
  into.putOI += n.putOI;
  into.callGex += n.callGex;
  into.putGex += n.putGex;
  into.callDex += n.callDex;
  into.putDex += n.putDex;
  into.callVex += n.callVex;
  into.putVex += n.putVex;
  into.callVanna += n.callVanna;
  into.putVanna += n.putVanna;
  into.callCharm += n.callCharm;
  into.putCharm += n.putCharm;
  into.callVol = (into.callVol ?? 0) + (n.callVol ?? 0);
  into.putVol = (into.putVol ?? 0) + (n.putVol ?? 0);
  into.netGex = into.callGex + into.putGex;
  into.netDex = into.callDex + into.putDex;
  into.netVex = into.callVex + into.putVex;
  into.netVanna = into.callVanna + into.putVanna;
  into.netCharm = into.callCharm + into.putCharm;
};

/** The strikes of these expiry dates, summed. One date is that date’s own chain. */
export function chainForDates(snapshot: MarketSnapshot, dates: readonly string[]): StrikeNode[] | null {
  const by = snapshot.uwByDate;
  if (!by) return null;
  const chains = dates.map(d => by[d]).filter((c): c is StrikeNode[] => !!c?.length);
  if (!chains.length) return null;
  if (chains.length === 1) return chains[0];
  const acc = new Map<number, StrikeNode>();
  for (const chain of chains) {
    for (const n of chain) {
      const cur = acc.get(n.strike);
      if (!cur) acc.set(n.strike, { ...n, callVol: n.callVol ?? 0, putVol: n.putVol ?? 0 });
      else add(cur, n);
    }
  }
  return [...acc.values()].sort((a, b) => a.strike - b.strike);
}

/**
 * The same snapshot, with its chain set to the expiries in `dates`.
 * No dates, or a book that does not split by date, is returned unchanged.
 * The whole listed set uses the book’s own aggregate.
 */
export function bookForDates(snapshot: MarketSnapshot, dates: readonly string[] | null | undefined): MarketSnapshot {
  if (!dates?.length || !snapshot.uwByDate) return snapshot;
  const listed = listedDates(snapshot);
  const want = dates.filter(d => snapshot.uwByDate?.[d]?.length);
  if (!want.length) return snapshot;
  if (listed.length && want.length >= listed.length && snapshot.uwChains?.ALL?.length) {
    const all = snapshot.uwChains.ALL;
    return { ...snapshot, chain: all, uwChains: { ...snapshot.uwChains, '0DTE': all, ALL: all } };
  }
  const chain = chainForDates(snapshot, want);
  if (!chain?.length) return snapshot;
  return { ...snapshot, chain, uwChains: { ...snapshot.uwChains, '0DTE': chain, ALL: chain } };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The window in the book's own words: "Oct 21" or "Oct 21 → Oct 30". */
export function expirySpan(dates: readonly string[] | null | undefined): string | null {
  if (!dates?.length) return null;
  const fmt = (iso: string): string => {
    const parts = iso.slice(0, 10).split('-');
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!m || !d) return iso.slice(0, 10);
    return `${MONTHS[m - 1]} ${d}`;
  };
  if (dates.length === 1) return fmt(dates[0]);
  return `${fmt(dates[0])} → ${fmt(dates[dates.length - 1])}`;
}
