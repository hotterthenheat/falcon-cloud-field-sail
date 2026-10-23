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
import { FRESH_VOL_OI, moneynessFilter, type MoneynessKey, type SpreadTrade } from './flowBook';
import type { ExpiryFlow } from './traceLive';
import { usd as fmtUsd } from './traceLive';

export interface TraceSide {
  ticker: string;
  /** The name's contracts on the cut, the heaviest premium first */
  rows: BookContract[];
  /** Day-to-now net premium — net calls less net puts, signed dollars */
  net: number;
  netCall: number;
  netPut: number;
  /** Where net / netCall / netPut come from: the vendor's minute ticks (/stock/{t}/net-prem-ticks, the regular session —
      the source Net Flow's pane and Intervals read) when the card is uncut, or its flow by expiry (/stock/{t}/flow-per-expiry,
      the whole day) when a clock cuts it (audit round 5: the headline read QQQ +$24.1M by expiry beside −$53.6M on its own
      pane and −$54.9M on Net Flow) */
  netSource?: 'ticks' | 'expiry';
  /** The ticks' net is not in hand: 'loading' while they load, 'none' when they did not answer — the net shows "…" or
      "—", never another source's figure under the ticks' label (audit round 6) */
  netPending?: 'loading' | 'none';
  /** The by-expiry figures, always — shown beside the ticks when the card is uncut */
  byExpiry?: { net: number; calls: number; puts: number };
  /** The same-day money: every contract on the name expiring TODAY (the vendor's flow for today's expiry), whatever the
      clock — the 0DTE desk's definition */
  odte: { net: number; calls: number; puts: number; vol: number; trades: number; has: boolean };
  book: {
    count: number;
    volume: number;
    premium: number;
    /** Calls' share of the premium, 0–100 */
    callShare: number;
    /** Ask-side share of the sided volume, 0–100 */
    askPct: number;
    /** The book's contracts by side — at the ask, on the bid, at the mid or no side */
    side: { ask: number; bid: number; mid: number };
    /** Share of the volume that arrived in sweeps, 0–100 */
    sweptPct: number;
    /** Volume-weighted implied vol, % */
    iv: number;
    /** Contracts whose volume ran past their standing interest — the Screener's "new positioning" */
    builtToday: number;
  };
  /** What stood overnight: interest added and interest shed, contracts */
  interest: { added: number; shed: number };
  /** dollars: the structures' NET premium, signs dropped — what changed hands, not the gross of every leg */
  structures: { count: number; paid: number; collected: number; dollars: number; list: SpreadTrade[] };
  /** The name's REGULAR-SESSION prints in the window — each print by its own time and flag (an SPY print at 16:14:5x is
      regular, a stock's at 16:05 is not); `after` counts the extended-hours ones, left out of the comparison */
  tape: { prints: number; dollars: number; sweeps: number; after: number };
  /** Sessions until the name reports, null when the calendar has none */
  earnDays: number | null;
  /** The next report's date, YYYY-MM-DD */
  earnIso: string | null;
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
  /* a contract that expired at today's bell no longer stands — it is not on the side's book (the re-audit, 2026-10-22) */
  const own = book.filter(r => r.ticker === ticker && !r.expired);
  const rows = own.filter(r => onClock(r.dte, tenor) && moneynessFilter(r, mny)).sort((a, b) => b.premium - a.premium);
  /* THE NET IS THE VENDOR'S, BY EXPIRY (the audit, 2026-10-22): it was a hashed clip table over the book — SPY read
     −$29.2M · −$23.7M same-day where the vendor's own flow said +$11.9M and +$0.7M. Net calls are call premium at the ask
     less call premium on the bid, summed over the expiries on the clock; every strike (the route has no strike cut). */
  const onTenor = expiries.filter(e => onClock(e.dte, tenor));
  const netCall = onTenor.reduce((a, e) => a + e.callNet, 0);
  const netPut = onTenor.reduce((a, e) => a + e.putNet, 0);
  /* THE SESSION'S OWN EXPIRY (audit round 6: at 04:15 on Oct 23 "Expiring today" read the Oct 23 expiry — SPY +$728.1K,
     QQQ +$55.5M — while the data was Oct 22's, whose 0DTE was SPY +$8.91M, QQQ −$12.82M): the expiry that is the vendor
     rows' own session date, else the tape's session */
  const rowsDay = expiries.find(e => e.date)?.date ?? todayIso;
  const today = expiries.find(e => e.expiry === rowsDay) ?? null;
  const volume = rows.reduce((a, r) => a + r.volume, 0);
  const premium = rows.reduce((a, r) => a + r.premium, 0);
  const callPrem = rows.reduce((a, r) => a + (r.right === 'C' ? r.premium : 0), 0);
  /* compression packages and after-hours structures are no bet and no read — left out of the structure totals (audit
     round 6) */
  const list = spreads.filter(t => t.ticker === ticker && !t.compression && !t.extended && onClock(t.dte, tenor)).sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium));
  const mine = tape.filter(p => p.ticker === ticker && onClock(p.dte, tenor) && moneynessFilter(p, mny));
  /* PER PRINT, NOT BY THE WALL CLOCK (the third audit, 2026-10-22: after 16:00 the page called SPY's and QQQ's prints at
     16:14:5x after-hours ones — index and ETF options close at 16:15 — and still named a winner) */
  const prints = mine.filter(p => !p.extended);
  const earnDays = own.reduce<number | null>((m, r) => (r.earnDays == null ? m : m == null ? r.earnDays : Math.min(m, r.earnDays)), null);

  return {
    ticker,
    rows,
    net: netCall - netPut,
    netCall,
    netPut,
    netSource: 'expiry',
    byExpiry: { net: netCall - netPut, calls: netCall, puts: netPut },
    odte: today
      ? { net: today.callNet - today.putNet, calls: today.callNet, puts: today.putNet, vol: today.callVol + today.putVol, trades: today.trades, has: true }
      : { net: 0, calls: 0, puts: 0, vol: 0, trades: 0, has: false },
    book: {
      count: rows.length,
      volume,
      premium,
      callShare: premium > 0 ? Math.round((callPrem / premium) * 100) : 0,
      askPct: Math.round(weighted(rows, r => r.askPct, volume)),
      side: rows.reduce((a, r) => (r.sideVol ? { ask: a.ask + r.sideVol.ask, bid: a.bid + r.sideVol.bid, mid: a.mid + r.sideVol.mid } : a), { ask: 0, bid: 0, mid: 0 }),
      sweptPct: Math.round(weighted(rows, r => r.sweepPct, volume)),
      /* past today's expiry: a contract in its last hours prints vol in the hundreds (QQQ's read 139% after the bell), so
         the same-day ones would swamp the read — it falls back to them only when nothing else traded */
      iv: (() => {
        const later = rows.filter(r => r.dte >= 1 && r.iv > 0);
        const pool = later.length ? later : rows;
        return Math.round(weighted(pool, r => r.iv, pool.reduce((a, r) => a + r.volume, 0)));
      })(),
      builtToday: rows.filter(r => r.oi > 0 && r.volOverOI >= FRESH_VOL_OI).length,
    },
    interest: {
      added: rows.reduce((a, r) => a + (r.deltaOI > 0 ? r.deltaOI : 0), 0),
      shed: rows.reduce((a, r) => a + (r.deltaOI < 0 ? r.deltaOI : 0), 0),
    },
    structures: {
      count: list.length,
      paid: list.filter(t => t.netKnown !== false && t.netPremium > 0).length,
      collected: list.filter(t => t.netKnown !== false && t.netPremium < 0).length,
      dollars: list.reduce((a, t) => a + Math.abs(t.netPremium), 0),
      list,
    },
    tape: {
      prints: prints.length,
      dollars: prints.reduce((a, p) => a + p.premium, 0),
      sweeps: prints.filter(p => p.sweep).length,
      after: mine.length - prints.length,
    },
    earnDays,
    earnIso: own.filter(r => r.earnDays === earnDays && r.earnIso).map(r => r.earnIso!)[0] ?? null,
  };
}

/** A name in the sentence — the page makes it a door */
export type SentencePart = string | { name: string };

export interface TraceCompare {
  a: TraceSide;
  b: TraceSide;
  /** The name whose money leans the more bullish */
  bullish: TraceSide;
  /** The heavier premium on the book */
  heavier: TraceSide;
  /** The busier tape, by prints */
  busier: TraceSide;
  /** The page's sentence, the names as parts of their own */
  parts: SentencePart[];
}

const num = (v: number) => v.toLocaleString('en-US');
/* Signed on purpose — RichRead inks +$/-$ by direction */
export const signedUsd = (v: number) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;

/** `tapeWindow` names the stretch both tapes cover ("from 15:58 to 16:14 ET"); `regular` is false when either name has
    no regular-session print in that stretch — a count of after-hours prints says nothing about which name is busier, so
    the tape clause is then left out */
export function buildTraceCompare(a: TraceSide, b: TraceSide, tapeWindow = 'over the same stretch', regular = true, sameDay = 'expiring today'): TraceCompare {
  const bullish = a.net >= b.net ? a : b;
  const heavier = a.book.premium >= b.book.premium ? a : b;
  const busier = a.tape.prints >= b.tape.prints ? a : b;
  /* the net says its source and window — the ticks' regular session, or the clock's expiries for the whole day */
  const lean = (s: TraceSide) => s.netPending ? (s.netPending === 'loading' ? ' — its net is loading (the vendor\'s minute ticks…)' : ' — the vendor\'s minute ticks did not answer, so its net is not stated') : ` leans ${s.net >= 0 ? 'bullish' : 'bearish'} at ${signedUsd(s.net)}${s === b ? (s.netSource === 'ticks' ? " (net premium over the regular session, the vendor's minute ticks — the figure on Net Flow and Intervals)" : " (the clock's expiries, the vendor's expiry route)") : ''}`;
  const showTape = busier.tape.prints > 0 && regular;
  const parts: SentencePart[] = [
    { name: a.ticker },
    `${lean(a)} while `,
    { name: b.ticker },
    `${lean(b)}. `,
    { name: heavier.ticker },
    ` carries more premium — ${fmtUsd(heavier.book.premium)} across its ${num(heavier.book.count)} standing contracts with the most premium, on ${num(heavier.book.volume)} volume${showTape ? ' — and ' : '. '}`,
    ...(!showTape
      ? []
      : busier === heavier
        ? [`the busier tape ${tapeWindow}, ${num(busier.tape.prints)} prints for ${fmtUsd(busier.tape.dollars)}. `]
        : [{ name: busier.ticker }, ` the busier tape ${tapeWindow}, ${num(busier.tape.prints)} prints for ${fmtUsd(busier.tape.dollars)}. `]),
    `Money on contracts ${sameDay} (by expiry, the vendor's expiry route): `,
    { name: a.ticker },
    ` ${signedUsd(a.odte.net)}, `,
    { name: b.ticker },
    ` ${signedUsd(b.odte.net)}.`,
  ];
  return { a, b, bullish, heavier, busier, parts };
}
