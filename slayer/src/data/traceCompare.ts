/* One name's side of the Compare card, off the same day book, spreads and tape the other Trace pages read, on the
   same clock and money cut. Plain strings out; the page inks them. */

import type { SleeveKey } from '../types/compass';
import type { BookContract, FlowPrint } from '../types/trace';
import { sleeveForDte } from './compass';
import { floorPackaged, FRESH_VOL_OI, moneynessFilter, notABet, SPREAD_LEG_PCT, type MoneynessKey, type SpreadTrade } from './flowBook';
import type { ExpiryFlow } from './traceLive';
import { fmtCount as num, usd as fmtUsd } from './traceRows';
import { leanOfSides } from './traceLean';

export interface TraceSide {
  ticker: string;
  /** The name's contracts on the cut, the heaviest premium first */
  rows: BookContract[];
  /** Net call less net put premium on the clock's expiries, the whole day: the flow-by-expiry route, the only one a
      clock can cut, so the headline never changes source when the clock does */
  net: number;
  netCall: number;
  netPut: number;
  /** Set by the page while the expiry route has not answered: 'loading', or 'none' when it failed */
  netPending?: 'loading' | 'none';
  /** The same figures off the minute ticks (every expiry, regular session), the series the panes draw; a secondary line */
  ticks?: { net: number; calls: number; puts: number } | null;
  /** Every contract on the name expiring on the session's own date, whatever the clock */
  odte: { net: number; calls: number; puts: number; vol: number; trades: number; has: boolean };
  book: {
    count: number;
    volume: number;
    premium: number;
    /** Calls' share of the premium, 0–100 */
    callShare: number;
    /** Ask share of the summed sided volume, 0–100 */
    askPct: number;
    /** The book's contracts by side — at the ask, on the bid, at the mid or no side */
    side: { ask: number; bid: number; mid: number };
    /** Share of the volume that arrived in sweeps, 0–100 */
    sweptPct: number;
    /** Volume-weighted implied vol, % */
    iv: number;
    /** True when the IV is read past the session's own expiry; false when only same-day contracts were in it (Clock = 0DTE) */
    ivLater: boolean;
    /** Floor packages, spread legs and crosses, left out of every figure above */
    apart: { count: number; premium: number; floor: number; legs: number; crosses: number };
    /** Contracts whose volume ran past their standing interest — the Screener's "new positioning" */
    builtToday: number;
  };
  /** Open interest added and shed by one session's trading (`day`, the newest count on the rows); rows still on an
      older count (`lagging`) are left out */
  interest: { added: number; shed: number; day: string | null; lagging: number; pending: boolean; apartCount: number };
  /** dollars: the structures' NET premium, signs dropped — what changed hands, not the gross of every leg */
  structures: { count: number; paid: number; collected: number; dollars: number; list: SpreadTrade[] };
  /** Regular-session prints in the window, each by its own flag; `after` counts the extended-hours ones left out */
  tape: { prints: number; dollars: number; sweeps: number; after: number; firstMs: number | null; lastMs: number | null };
  /** Sessions until the name reports, null when the calendar has none */
  earnDays: number | null;
  /** The next report's date, YYYY-MM-DD */
  earnIso: string | null;
}

const onClock = (dte: number, tenor: SleeveKey | 'all') => tenor === 'all' || sleeveForDte(dte) === tenor;

/** Volume-weighted average of one per-contract share */
const weighted = (rows: BookContract[], pick: (r: BookContract) => number, volume: number) =>
  volume > 0 ? rows.reduce((a, r) => a + pick(r) * r.volume, 0) / volume : 0;

/** One name's side of the card, on the page's cut */
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
  /* a contract that expired at today's bell no longer stands */
  const own = book.filter(r => r.ticker === ticker && !r.expired);
  const rows = own.filter(r => onClock(r.dte, tenor) && moneynessFilter(r, mny)).sort((a, b) => b.premium - a.premium);
  /* net calls: call premium at the ask less on the bid, summed over the clock's expiries, every strike */
  const onTenor = expiries.filter(e => onClock(e.dte, tenor));
  const netCall = onTenor.reduce((a, e) => a + e.callNet, 0);
  const netPut = onTenor.reduce((a, e) => a + e.putNet, 0);
  /* the rows' own session date, not the wall's: before the open the data is still the previous session's */
  const rowsDay = expiries.find(e => e.date)?.date ?? todayIso;
  const today = expiries.find(e => e.expiry === rowsDay) ?? null;
  /* the Screener's exclusions: every book figure is single bets; packages and legs are counted apart */
  const bets = rows.filter(r => !notABet(r));
  const out = rows.filter(r => notABet(r));
  const volume = bets.reduce((a, r) => a + r.volume, 0);
  const premium = bets.reduce((a, r) => a + r.premium, 0);
  const callPrem = bets.reduce((a, r) => a + (r.right === 'C' ? r.premium : 0), 0);
  /* compression packages and after-hours structures are no read */
  const list = spreads.filter(t => t.ticker === ticker && !t.compression && !t.extended && onClock(t.dte, tenor)).sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium));
  const mine = tape.filter(p => p.ticker === ticker && onClock(p.dte, tenor) && moneynessFilter(p, mny));
  /* each print by its own extended flag: index options print regular until 16:15 */
  const prints = mine.filter(p => !p.extended);
  const msOf = (p: FlowPrint) => p.epochMs ?? (p.epoch ?? 0) * 1000;
  const stamps = prints.map(msOf).filter(v => v > 0);
  const side = bets.reduce((a, r) => (r.sideVol ? { ask: a.ask + r.sideVol.ask, bid: a.bid + r.sideVol.bid, mid: a.mid + r.sideVol.mid } : a), { ask: 0, bid: 0, mid: 0 });
  const sided = leanOfSides(side);
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
      count: bets.length,
      volume,
      premium,
      callShare: premium > 0 ? Math.round((callPrem / premium) * 100) : 0,
      askPct: side.ask + side.bid > 0 ? Math.round(sided.askSided) : Math.round(weighted(bets, r => r.askPct, volume)),
      side,
      sweptPct: Math.round(weighted(bets, r => r.sweepPct, volume)),
      /* past today's expiry: a contract in its last hours prints IV in the hundreds and would swamp the read */
      iv: (() => {
        const later = bets.filter(r => r.dte >= 1 && r.iv > 0);
        const pool = later.length ? later : bets;
        return Math.round(weighted(pool, r => r.iv, pool.reduce((a, r) => a + r.volume, 0)));
      })(),
      ivLater: bets.some(r => r.dte >= 1 && r.iv > 0),
      apart: { count: out.length, premium: out.reduce((a, r) => a + r.premium, 0), floor: out.filter(r => floorPackaged(r)).length, legs: out.filter(r => !floorPackaged(r) && r.multiPct >= SPREAD_LEG_PCT).length, crosses: out.filter(r => !floorPackaged(r) && r.multiPct < SPREAD_LEG_PCT).length },
      builtToday: bets.filter(r => r.oi > 0 && r.volOverOI >= FRESH_VOL_OI).length,
    },
    /* the same contracts as the book figures: bets only */
    interest: (() => {
      const day = bets.reduce<string | null>((m, r) => (r.oiDay && (!m || r.oiDay > m) ? r.oiDay : m), null);
      const on = bets.filter(r => !day || !r.oiDay || r.oiDay === day);
      return {
        apartCount: out.length,
        added: on.reduce((a, r) => a + (r.deltaOI > 0 ? r.deltaOI : 0), 0),
        shed: on.reduce((a, r) => a + (r.deltaOI < 0 ? r.deltaOI : 0), 0),
        day,
        lagging: bets.length - on.length,
        pending: bets.length > 0 && bets.every(r => r.oiPending),
      };
    })(),
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
      firstMs: stamps.length ? Math.min(...stamps) : null,
      lastMs: stamps.length ? Math.max(...stamps) : null,
    },
    earnDays,
    earnIso: own.filter(r => r.earnDays === earnDays && r.earnIso).map(r => r.earnIso!)[0] ?? null,
  };
}

/** A name in the sentence — the page makes it a door */
type SentencePart = string | { name: string };

interface TraceCompare {
  a: TraceSide;
  b: TraceSide;
  /** The name whose money leans the more bullish */
  bullish: TraceSide;
  /** The heavier premium on the book; null when neither name has a contract on the cut */
  heavier: TraceSide | null;
  /** The busier tape over the same stretch; null on a tie */
  busier: TraceSide | null;
  /** The page's sentence, the names as parts of their own */
  parts: SentencePart[];
}

/* Signed on purpose — RichRead inks +$/-$ by direction */
export const signedUsd = (v: number) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;

/** `tapeWindow` names the stretch both tapes cover; with `regular` false (after the close, or a name with no
    regular-session print in it) the tape clause is left out */
export function buildTraceCompare(a: TraceSide, b: TraceSide, tapeWindow = 'over the same stretch', regular = true, sameDay = 'expiring today', cutWords = 'on this cut'): TraceCompare {
  const bullish = a.net >= b.net ? a : b;
  const heavier = a.book.premium <= 0 && b.book.premium <= 0 ? null : a.book.premium >= b.book.premium ? a : b;
  /* both tapes are cut at the same instant, so equal counts name nobody */
  const busier = a.tape.prints > b.tape.prints ? a : b.tape.prints > a.tape.prints ? b : null;
  const lean = (s: TraceSide) => (s.netPending ? (s.netPending === 'loading' ? ' — its net is loading' : ' — its net did not load') : ` leans ${s.net >= 0 ? 'bullish' : 'bearish'} at ${signedUsd(s.net)}${s === b ? ' (net by expiry, the whole day)' : ''}`);
  const showTape = regular && (busier ? busier.tape.prints > 0 : a.tape.prints > 0);
  const parts: SentencePart[] = [
    { name: a.ticker },
    `${lean(a)} while `,
    { name: b.ticker },
    `${lean(b)}. `,
    ...(heavier
      ? [{ name: heavier.ticker }, ` carries more premium — ${fmtUsd(heavier.book.premium)} across ${num(heavier.book.count)} contract${heavier.book.count === 1 ? '' : 's'} on ${num(heavier.book.volume)} volume${heavier.book.apart.count ? ` (${num(heavier.book.apart.count)} packages, legs and crosses left out)` : ''}${showTape ? ' — and ' : '. '}`]
      : [`Neither name has a contract standing ${cutWords}, so neither carries more premium${showTape ? '; ' : '. '}`]),
    ...(!showTape
      ? []
      : !busier
        ? [`the two tapes are level ${tapeWindow} — ${num(a.tape.prints)} prints each. `]
        : busier === heavier || !heavier
          ? [`the busier tape ${tapeWindow}, ${num(busier.tape.prints)} prints for ${fmtUsd(busier.tape.dollars)}. `]
          : [{ name: busier.ticker }, ` the busier tape ${tapeWindow}, ${num(busier.tape.prints)} prints for ${fmtUsd(busier.tape.dollars)}. `]),
    `Money on contracts ${sameDay}: `,
    { name: a.ticker },
    ` ${signedUsd(a.odte.net)}, `,
    { name: b.ticker },
    ` ${signedUsd(b.odte.net)}.`,
  ];
  return { a, b, bullish, heavier, busier, parts };
}
