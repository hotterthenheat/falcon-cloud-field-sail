import type { MarketSnapshot, StrikeNode } from '../types/market';
import { bookToday, isoDate } from '../core/calendar';
import { registerChainDates } from './chainDates';

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
  const out = [...acc.values()].sort((a, b) => a.strike - b.strike);
  /* the flip re-prices each date at its own clock — it has to know which dates this sum is (data/chainDates.ts) */
  registerChainDates(out, dates.filter(d => by[d]?.length));
  return out;
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

/*
  THE LEVELS' BOOK — ONE PER SCOPE (the ship pass, 2026-10-22: the Board and the Agenda read SPY's supreme 764 off
  today's contracts while the Map's card read 760 off the eight dates its matrix showed; a retail reader saw two
  supremes). Every named level on Pinpoint — supreme, call wall, put wall, flip, pin, net GEX — is read off THIS book:
  the Levels card's scope, never the matrix's window. "Today" is today's own chain (the first live date when nothing
  expires today, as uwBook's chainsFor resolves it); "All expiries" is the whole book. The matrix may still draw more
  dates; anything it sums over its own window is labelled with that window.
*/
export function levelsBook(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): MarketSnapshot {
  const ch = snapshot.uwChains;
  if (!snapshot.liveBook || !ch) return snapshot;
  const pick = scope === 'ALL' ? ch.ALL : ch['0DTE']?.length ? ch['0DTE'] : ch.ALL;
  if (!pick?.length) return snapshot;
  if (snapshot.chain === pick && ch['0DTE'] === pick) return snapshot;
  return { ...snapshot, chain: pick, uwChains: { ...ch, '0DTE': pick } };
}

/** The date the "Today" scope reads (null for the whole book, or before the dates are in) */
export function levelsDate(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): string | null {
  if (scope === 'ALL') return null;
  const front = snapshot.uwChains?.['0DTE'];
  const by = snapshot.uwByDate;
  if (!front?.length || !by) return null;
  return Object.keys(by).find(d => by[d] === front) ?? null;
}

/** The scope in a reader's words, for a label: "Today · Oct 22", "Oct 23 · next expiry", "All expiries" */
export function levelsWords(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE', today: string = isoDate(bookToday())): string {
  if (scope === 'ALL') return 'All expiries';
  const d = levelsDate(snapshot, scope);
  /* today's own chain is not in yet: the levels are the whole book's until it lands — say so */
  if (!d) return 'All expiries · today loading';
  const span = expirySpan([d]) ?? d;
  return d === today ? `Today · ${span}` : `${span} · next expiry`;
}
