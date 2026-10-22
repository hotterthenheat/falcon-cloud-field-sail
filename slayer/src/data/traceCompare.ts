/*
==================================================
  SLAYER TERMINAL - TWO NAMES ON THE TRACE
  (data/traceCompare.ts)

  The Compare page's facts (2026-09-13; Noah, with
  his partner's "Two names, side by side" page:
  "take this information and recreate it with our
  own type design"): one name's side of the card —
  its net flow, its same-day money, its book, what
  stood overnight, its structures, its tape and its
  report — every figure off the SAME day book,
  spreads and tape the other Trace pages read, on
  the same clock and money cut, so the page can
  never quote a number the Screener would not.
  Plain strings out; the page lights them.
==================================================
*/

import type { SleeveKey } from '../types/compass';
import type { BookContract, FlowPrint } from '../types/trace';
import { sleeveForDte } from './compass';
import { moneynessFilter, type MoneynessKey, type SpreadTrade } from './flowBook';
import type { ExpiryFlow } from './traceLive';
import { fmtUsd } from './gex';

export interface TraceSide {
  ticker: string;
  /** The name's contracts on the cut, the heaviest premium first */
  rows: BookContract[];
  /** Day-to-now net premium — net calls less net puts, signed dollars */
  net: number;
  netCall: number;
  netPut: number;
  /** The same-day money: every contract on the name expiring TODAY (the vendor's flow for today's expiry), whatever the
      clock — the 0DTE desk's definition */
  odte: { net: number; calls: number; puts: number; vol: number; trades: number; has: boolean };
  book: {
    count: number;
    volume: number;
    premium: number;
    /** Calls' share of the premium, 0–100 */
    callShare: number;
    /** Ask-side share of the volume, 0–100 */
    askPct: number;
    /** Share of the volume that arrived in sweeps, 0–100 */
    sweptPct: number;
    /** Volume-weighted implied vol, % */
    iv: number;
    /** Contracts whose volume ran past their standing interest — the Screener's "new positioning" */
    builtToday: number;
  };
  /** What stood overnight: interest added and interest shed, contracts */
  interest: { added: number; shed: number };
  structures: { count: number; paid: number; collected: number; dollars: number; list: SpreadTrade[] };
  tape: { prints: number; dollars: number; sweeps: number };
  /** Sessions until the name reports, null when the calendar has none */
  earnDays: number | null;
}

const onClock = (dte: number, tenor: SleeveKey | 'all') => tenor === 'all' || sleeveForDte(dte) === tenor;

/** Volume-weighted average of one per-contract share */
const weighted = (rows: BookContract[], pick: (r: BookContract) => number, volume: number) =>
  volume > 0 ? rows.reduce((a, r) => a + pick(r) * r.volume, 0) / volume : 0;

/** One name's side of the card, on the page's cut. `sampleAt` is the tape's
    last bar — both names are read at the same instant (the leaders board's rule). */
export function buildTraceSide(
  book: BookContract[],
  spreads: SpreadTrade[],
  tape: FlowPrint[],
  ticker: string,
  tenor: SleeveKey | 'all',
  mny: MoneynessKey,
  expiries: ExpiryFlow[],
  todayIso: string
): TraceSide {
  const own = book.filter(r => r.ticker === ticker);
  const rows = own.filter(r => onClock(r.dte, tenor) && moneynessFilter(r, mny)).sort((a, b) => b.premium - a.premium);
  /* THE NET IS THE VENDOR'S, BY EXPIRY (the audit, 2026-10-22): it was a hashed clip table over the book — SPY read
     −$29.2M · −$23.7M same-day where the vendor's own flow said +$11.9M and +$0.7M. Net calls are call premium at the ask
     less call premium on the bid, summed over the expiries on the clock; every strike (the route has no strike cut). */
  const onTenor = expiries.filter(e => onClock(e.dte, tenor));
  const netCall = onTenor.reduce((a, e) => a + e.callNet, 0);
  const netPut = onTenor.reduce((a, e) => a + e.putNet, 0);
  const today = expiries.find(e => e.expiry === todayIso) ?? null;
  const volume = rows.reduce((a, r) => a + r.volume, 0);
  const premium = rows.reduce((a, r) => a + r.premium, 0);
  const callPrem = rows.reduce((a, r) => a + (r.right === 'C' ? r.premium : 0), 0);
  const list = spreads.filter(t => t.ticker === ticker && onClock(t.dte, tenor)).sort((a, b) => b.premium - a.premium);
  const prints = tape.filter(p => p.ticker === ticker && onClock(p.dte, tenor) && moneynessFilter(p, mny));
  const earnDays = own.reduce<number | null>((m, r) => (r.earnDays == null ? m : m == null ? r.earnDays : Math.min(m, r.earnDays)), null);

  return {
    ticker,
    rows,
    net: netCall - netPut,
    netCall,
    netPut,
    odte: today
      ? { net: today.callNet - today.putNet, calls: today.callNet, puts: today.putNet, vol: today.callVol + today.putVol, trades: today.trades, has: true }
      : { net: 0, calls: 0, puts: 0, vol: 0, trades: 0, has: false },
    book: {
      count: rows.length,
      volume,
      premium,
      callShare: premium > 0 ? Math.round((callPrem / premium) * 100) : 0,
      askPct: Math.round(weighted(rows, r => r.askPct, volume)),
      sweptPct: Math.round(weighted(rows, r => r.sweepPct, volume)),
      /* past today's expiry: a contract in its last hours prints vol in the hundreds (QQQ's read 139% after the bell), so
         the same-day ones would swamp the read — it falls back to them only when nothing else traded */
      iv: (() => {
        const later = rows.filter(r => r.dte >= 1 && r.iv > 0);
        const pool = later.length ? later : rows;
        return Math.round(weighted(pool, r => r.iv, pool.reduce((a, r) => a + r.volume, 0)));
      })(),
      builtToday: rows.filter(r => r.volOverOI >= 1.5).length,
    },
    interest: {
      added: rows.reduce((a, r) => a + (r.deltaOI > 0 ? r.deltaOI : 0), 0),
      shed: rows.reduce((a, r) => a + (r.deltaOI < 0 ? r.deltaOI : 0), 0),
    },
    structures: {
      count: list.length,
      paid: list.filter(t => t.net > 0).length,
      collected: list.filter(t => t.net < 0).length,
      dollars: list.reduce((a, t) => a + t.premium, 0),
      list,
    },
    tape: {
      prints: prints.length,
      dollars: prints.reduce((a, p) => a + p.premium, 0),
      sweeps: prints.filter(p => p.sweep).length,
    },
    earnDays,
  };
}

/** A name in the sentence — the page makes it a door */
export type SentencePart = string | { name: string };

export interface TraceCompare {
  a: TraceSide;
  b: TraceSide;
  /** The name whose money leans the more bullish */
  bullish: TraceSide;
  /** The heavier book, by premium */
  heavier: TraceSide;
  /** The busier tape, by prints */
  busier: TraceSide;
  /** The page's sentence, the names as parts of their own */
  parts: SentencePart[];
}

const num = (v: number) => v.toLocaleString('en-US');
/* Signed on purpose — RichRead inks +$/-$ by direction */
export const signedUsd = (v: number) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;

export function buildTraceCompare(a: TraceSide, b: TraceSide): TraceCompare {
  const bullish = a.net >= b.net ? a : b;
  const heavier = a.book.premium >= b.book.premium ? a : b;
  const busier = a.tape.prints >= b.tape.prints ? a : b;
  const lean = (s: TraceSide) => ` leans ${s.net >= 0 ? 'bullish' : 'bearish'} at ${signedUsd(s.net)}`;
  const parts: SentencePart[] = [
    { name: a.ticker },
    `${lean(a)} while `,
    { name: b.ticker },
    `${lean(b)}. `,
    { name: heavier.ticker },
    ` carries the heavier book — ${fmtUsd(heavier.book.premium)} across its ${num(heavier.book.count)} contracts with the most premium, on ${num(heavier.book.volume)} volume${busier.tape.prints === 0 ? '. ' : ' — and '}`,
    ...(busier.tape.prints === 0
      ? []
      : busier === heavier
        ? [`the busier tape over the same stretch, ${num(busier.tape.prints)} prints for ${fmtUsd(busier.tape.dollars)}. `]
        : [{ name: busier.ticker }, ` the busier tape over the same stretch, ${num(busier.tape.prints)} prints for ${fmtUsd(busier.tape.dollars)}. `]),
    `Money on contracts expiring today: `,
    { name: a.ticker },
    ` ${signedUsd(a.odte.net)}, `,
    { name: b.ticker },
    ` ${signedUsd(b.odte.net)}.`,
  ];
  return { a, b, bullish, heavier, busier, parts };
}
