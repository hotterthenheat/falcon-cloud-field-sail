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
import { floorPackaged, FRESH_VOL_OI, moneynessFilter, notABet, type MoneynessKey, type SpreadTrade } from './flowBook';
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
    /** True when the IV is read past the session's own expiry; false when only same-day contracts were in it (Clock = 0DTE) */
    ivLater: boolean;
    /** The contracts left out of every figure above (audit round 8, major 2): floor packages and days of spread legs — the
        Screener's exclusions — with their premium */
    apart: { count: number; premium: number; floor: number; legs: number; crosses: number };
    /** Contracts whose volume ran past their standing interest — the Screener's "new positioning" */
    builtToday: number;
  };
  /** Open interest added and shed by one session's trading (`day`, YYYY-MM-DD — the newest count on the side's rows);
      `lagging` rows still on the count before are left out (audit round 7) */
  interest: { added: number; shed: number; day: string | null; lagging: number; pending: boolean; apartCount: number };
  /** dollars: the structures' NET premium, signs dropped — what changed hands, not the gross of every leg */
  structures: { count: number; paid: number; collected: number; dollars: number; list: SpreadTrade[] };
  /** The name's REGULAR-SESSION prints in the window — each print by its own time and flag (an SPY print at 16:14:5x is
      regular, a stock's at 16:05 is not); `after` counts the extended-hours ones, left out of the comparison; `firstMs` /
      `lastMs` its first and last print (ms) */
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
  /* THE SCREENER'S EXCLUSIONS (audit round 8, major 2: SPY $225.8M / QQQ $267.7M were the plain sum of 80 rows, floor
     packages and spread legs in it — SPY Feb 26 '27 740P, QQQ Nov 2 720C / 730C, QQQ Dec 18 680P / 690P): every book
     figure — premium, volume, the call share, the lean, the sweep share, the IV, the count — is the contracts that are
     single bets; the floor packages and days of spread legs are counted apart and said */
  const bets = rows.filter(r => !notABet(r));
  const out = rows.filter(r => notABet(r));
  const volume = bets.reduce((a, r) => a + r.volume, 0);
  const premium = bets.reduce((a, r) => a + r.premium, 0);
  const callPrem = bets.reduce((a, r) => a + (r.right === 'C' ? r.premium : 0), 0);
  /* compression packages and after-hours structures are no bet and no read — left out of the structure totals (audit
     round 6) */
  const list = spreads.filter(t => t.ticker === ticker && !t.compression && !t.extended && onClock(t.dte, tenor)).sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium));
  const mine = tape.filter(p => p.ticker === ticker && onClock(p.dte, tenor) && moneynessFilter(p, mny));
  /* PER PRINT, NOT BY THE WALL CLOCK (the third audit, 2026-10-22: after 16:00 the page called SPY's and QQQ's prints at
     16:14:5x after-hours ones — index and ETF options close at 16:15 — and still named a winner) */
  const prints = mine.filter(p => !p.extended);
  const msOf = (p: FlowPrint) => p.epochMs ?? (p.epoch ?? 0) * 1000;
  const stamps = prints.map(msOf).filter(v => v > 0);
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
      count: bets.length,
      volume,
      premium,
      callShare: premium > 0 ? Math.round((callPrem / premium) * 100) : 0,
      askPct: Math.round(weighted(bets, r => r.askPct, volume)),
      side: bets.reduce((a, r) => (r.sideVol ? { ask: a.ask + r.sideVol.ask, bid: a.bid + r.sideVol.bid, mid: a.mid + r.sideVol.mid } : a), { ask: 0, bid: 0, mid: 0 }),
      sweptPct: Math.round(weighted(bets, r => r.sweepPct, volume)),
      /* past today's expiry: a contract in its last hours prints vol in the hundreds (QQQ's read 139% after the bell), so
         the same-day ones would swamp the read — it falls back to them only when nothing else traded */
      iv: (() => {
        const later = bets.filter(r => r.dte >= 1 && r.iv > 0);
        const pool = later.length ? later : bets;
        return Math.round(weighted(pool, r => r.iv, pool.reduce((a, r) => a + r.volume, 0)));
      })(),
      ivLater: bets.some(r => r.dte >= 1 && r.iv > 0),
      apart: { count: out.length, premium: out.reduce((a, r) => a + r.premium, 0), floor: out.filter(r => floorPackaged(r)).length, legs: out.filter(r => !floorPackaged(r) && r.multiPct >= 50).length, crosses: out.filter(r => !floorPackaged(r) && r.multiPct < 50).length },
      builtToday: bets.filter(r => r.oi > 0 && r.volOverOI >= FRESH_VOL_OI).length,
    },
    /* THE SAME CONTRACTS AS THE BOOK SECTION (audit round 9, minor 5: "+230,095 SPY" here counted the floor packages,
       spread legs and crosses the book above left out — its 68 bets added +201,962): the bets only, the rest said apart */
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
export type SentencePart = string | { name: string };

export interface TraceCompare {
  a: TraceSide;
  b: TraceSide;
  /** The name whose money leans the more bullish */
  bullish: TraceSide;
  /** The heavier premium on the book — null when neither name has a contract standing on the cut (audit round 7: Clock =
      0DTE before the open crowned "QQQ · $0" across "its 0 standing contracts") */
  heavier: TraceSide | null;
  /** The busier tape, by prints over the same stretch — null on a tie (audit round 8: equal counts named A) */
  busier: TraceSide | null;
  /** The page's sentence, the names as parts of their own */
  parts: SentencePart[];
}

const num = (v: number) => v.toLocaleString('en-US');
/* Signed on purpose — RichRead inks +$/-$ by direction */
export const signedUsd = (v: number) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;

/** `tapeWindow` names the stretch both tapes cover ("from 15:58 to 16:14 ET"); `regular` is false when either name has
    no regular-session print in that stretch — a count of after-hours prints says nothing about which name is busier, so
    the tape clause is then left out */
export function buildTraceCompare(a: TraceSide, b: TraceSide, tapeWindow = 'over the same stretch', regular = true, sameDay = 'expiring today', cutWords = 'on this cut'): TraceCompare {
  const bullish = a.net >= b.net ? a : b;
  const heavier = a.book.premium <= 0 && b.book.premium <= 0 ? null : a.book.premium >= b.book.premium ? a : b;
  /* A TIE IS A TIE (audit round 8, major 3: `>=` named A on equal counts) — both names are cut at the same instant, so
     the same stretch: more prints is the higher rate, and equal counts name nobody */
  const busier = a.tape.prints > b.tape.prints ? a : b.tape.prints > a.tape.prints ? b : null;
  /* the net says its source and window — the ticks' regular session, or the clock's expiries for the whole day */
  const lean = (s: TraceSide) => s.netPending ? (s.netPending === 'loading' ? ' — its net is loading (the vendor\'s minute ticks…)' : ' — the vendor\'s minute ticks did not answer, so its net is not stated') : ` leans ${s.net >= 0 ? 'bullish' : 'bearish'} at ${signedUsd(s.net)}${s === b ? (s.netSource === 'ticks' ? " (net premium over the regular session, the vendor's minute ticks — the figure on Net Flow and Intervals)" : " (the clock's expiries, the vendor's expiry route)") : ''}`;
  const showTape = regular && (busier ? busier.tape.prints > 0 : a.tape.prints > 0);
  const parts: SentencePart[] = [
    { name: a.ticker },
    `${lean(a)} while `,
    { name: b.ticker },
    `${lean(b)}. `,
    ...(heavier
      ? [{ name: heavier.ticker }, ` carries more premium — ${fmtUsd(heavier.book.premium)} across its ${num(heavier.book.count)} standing contract${heavier.book.count === 1 ? '' : 's'} with the most premium, on ${num(heavier.book.volume)} volume${heavier.book.apart.count ? ` (${num(heavier.book.apart.count)} more — floor packages, spread legs and crosses, ${fmtUsd(heavier.book.apart.premium)} — left out: packages, legs and crosses, not bets)` : ''}${showTape ? ' — and ' : '. '}`]
      : [`Neither name has a contract standing ${cutWords}, so neither carries more premium${showTape ? '; ' : '. '}`]),
    ...(!showTape
      ? []
      : !busier
        ? [`the two tapes are level ${tapeWindow} — ${num(a.tape.prints)} prints each. `]
        : busier === heavier || !heavier
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
