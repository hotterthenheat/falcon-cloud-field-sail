/*
  WHEN THE WHOLE BOOK'S FLIP IS FINAL (audit 2026-11-06, item 5) — data/flipLevel.ts legSet.
  The book reads its first BOOK_LISTINGS (40) listings date by date; a name with more keeps the rest on the whole book's
  rows, carried flat in the flip. The All flip waited on EVERY listing: SPX lists 54 (the Nov 5 close: 2026-11-06 …
  2031-12-19), so its All flip never went final and every page printed "…" for it (the live check, run on that book,
  did not settle in 15 minutes). Now it is final once every listing the book reads is in — and never before: one of
  those still loading keeps it provisional (no early stop). A listed date whose strikes came back empty is in.

  A synthetic name with 45 listings, its first 40 loaded; one of them taken out; one of them listed empty.
  Run: npx tsx scripts/flip-complete-proof.ts
*/
import { cache, emptyDates, BOOK_LISTINGS } from '../src/data/book/store';
import { levelFlip } from '../src/data/flipLevel';
import { emptyNode } from '../src/data/book/scale';
import type { MarketSnapshot, StrikeNode } from '../src/types/market';
import { nyInstant } from '../src/core/session';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/* a fixed clock: Thursday 2026-11-05 11:00 ET, in the session */
const at = nyInstant('2026-11-05', 11 * 60);
const RealDate = Date;
class Pinned extends RealDate {
  constructor(...a: ConstructorParameters<typeof Date>) {
    if (a.length === 0) super(at);
    else super(...a);
  }
  static now() {
    return at;
  }
}
globalThis.Date = Pinned as DateConstructor;

const T = 'ZZZ';
const S = 100;
/* 45 listings: dailies, then fridays, then far monthlies */
const dates: string[] = [];
for (let d = new RealDate(Date.UTC(2026, 10, 5)); dates.length < 45; d = new RealDate(d.getTime() + 86_400_000)) {
  const iso = d.toISOString().slice(0, 10);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6 || iso === '2026-11-26') continue;
  if (dates.length > 25 && wd !== 5) continue;
  dates.push(iso);
}
const node = (k: number, call: number, put: number, iv: number): StrikeNode => ({ ...emptyNode(k), callGex: -call, putGex: put, netGex: -call + put, callIv: iv, putIv: iv, callOI: 1000, putOI: 1000, callBook: 1000, putBook: 1000, gexPx: S, gexAt: at });
const chainOf = (i: number): StrikeNode[] => [95, 100, 105].map((k, j) => node(k, (j + 1) * 1e6 / (i + 1), (3 - j) * 1.2e6 / (i + 1), 0.2 + 0.01 * j));

function book(loaded: (d: string, i: number) => boolean, empty: string[] = []) {
  const byDate: Record<string, StrikeNode[]> = {};
  dates.forEach((d, i) => {
    if (loaded(d, i)) byDate[d] = chainOf(i);
  });
  /* the whole book's rows: every listing, loaded or not */
  const all = [95, 100, 105].map(k => {
    const n = emptyNode(k);
    dates.forEach((_, i) => {
      const c = chainOf(i).find(x => x.strike === k)!;
      n.callGex += c.callGex;
      n.putGex += c.putGex;
      n.netGex += c.netGex;
    });
    return n;
  });
  emptyDates.set(T, new Set(empty));
  const entry = { ticker: T, status: 'live', at, full: true, wantFull: true, spot: S, prev: S, changePct: 0, iv: 0.2, impliedMove: 0, dayMoveFrac: 0, all, byDate, expiries: dates.map((d, i) => ({ date: d, dte: i })), flow: new Map(), candles: [], tape: [], history: [], factsDates: new Set(dates), termIv: Object.fromEntries(dates.map(d => [d, 0.2])), gammaLive: false, everFull: true };
  cache.set(T, entry as never);
  const snap = { ticker: T, spot: S, liveBook: true, chain: all, uwByDate: byDate, uwChains: { ALL: all }, uwExpiries: dates.map((d, i) => ({ date: d, dte: i })), flipAt: at } as unknown as MarketSnapshot;
  return levelFlip(snap, all, at);
}

check(`the book reads ${BOOK_LISTINGS} listings; this name lists ${dates.length}`, BOOK_LISTINGS === 40 && dates.length === 45);
const first40 = book((_, i) => i < 40);
check(`the first 40 listings in, the last 5 on the whole book's rows: the All flip is final (it waited on all 45 — never) — flip ${first40.flip?.toFixed(3) ?? 'none'}`, first40.complete === true);
const allIn = book(() => true);
check(`every listing in: final, and the flip within 0.1% of spot of the 40-listing one (${allIn.flip?.toFixed(3)}): the far listings carried flat move it little`, allIn.complete && first40.flip != null && allIn.flip != null && Math.abs(allIn.flip - first40.flip) < 0.001 * S);
const gap = book((_, i) => i < 40 && i !== 17);
check(`one of the first 40 still loading (${dates[17]}): provisional — no early stop`, gap.complete === false);
const front = book((_, i) => i > 0 && i < 40);
check(`the front date still loading: provisional`, front.complete === false);
const listedEmpty = book((_, i) => i < 40 && i !== 17, [dates[17]]);
check(`one of the first 40 listed but empty (its strikes came back none): final`, listedEmpty.complete === true);

globalThis.Date = RealDate;
if (fail) {
  console.log(`\n${fail} FAILED`);
  process.exit(1);
}
console.log('\nflip-complete proof: all checks pass');
