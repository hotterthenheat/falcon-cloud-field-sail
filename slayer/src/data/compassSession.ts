/* What each Compass name can actually trade, in New York time. The scan window is not this. A stock tape, an
   equity option, and an index option are three different clocks. Stocks and ETFs, the Theta stock tape: pre-market
   04:00–09:30, regular 09:30–16:00, after-hours 16:00–20:00. Every listed name. */

import { isTradingDay, MONTHS as OPEN_MONTH } from '../core/calendar';
import { now } from '../core/clock';
import { nyMinutes, nyParts, nyWallTime, type At } from '../core/nyTime';
import { GTH_ROOTS, LATE_ETFS, REGULAR_CLOSE_MIN, isSessionDay, nyWall, regularCloseMin, sessionAt, windowAt } from '../core/session';
import type { TapeClock } from './compassParams';
import type { DeskSession } from './deskSession';
import type { FlowPrint } from '../types/trace';

export type OptionPhase = 'overnight' | 'pre' | 'halt' | 'open' | 'curb' | 'closed';
type UnderPhase = 'pre' | 'open' | 'after' | 'closed';

interface NameTape {
  option: OptionPhase;
  under: UnderPhase;
  /** This 0DTE has no session left today. */
  done: boolean;
  /** Short word for the option, for the session fact. */
  word: string;
  /** Why a live option outside the scan is still a trade. */
  liveWhy: string;
  /** Why a contract that is not printing is not dead. */
  quietWhy: string;
  /** Why a finished 0DTE is finished. */
  doneWhy: string;
}

const INDEX = new Set(['SPX', 'SPXW', 'XSP', 'NDX', 'NDXP', 'VIX', 'RUT', 'RUTW']);

/** Single names whose options have the 07:30 pre-market and the 16:00 curb. */
const EXT_STOCK = new Set([
  'AAPL', 'AMD', 'AMZN', 'AVGO', 'BABA', 'BAC', 'F', 'GOOG', 'GOOGL', 'HOOD', 'INTC', 'META', 'MRVL', 'MSFT', 'MU', 'NFLX', 'NVDA', 'ORCL', 'PFE', 'PLTR', 'TSLA', 'TSM',
]);

/** ETFs on the same list. Regular session already runs to 16:15. Pre-market 07:30. No curb. */
const EXT_ETF = new Set(['GLD', 'IWM', 'QQQ', 'SPY']);

/** ETFs whose options trade to 16:15: the one list, shared/marketSession.mjs LATE_ETFS (it holds the EXT_ETF names
    too, which open earlier; the rest have no pre-market). This file kept its own list, which disagreed with it. */
const LATE_ETF: ReadonlySet<string> = LATE_ETFS;

/** Index roots with the overnight session (20:15-09:25 ET) and the curb to 17:00. RUT has the overnight session and
    closes at 16:15; NDX has neither (no overnight trade, its curb ends at 16:15). */
const GTH_INDEX = new Set(['SPX', 'SPXW', 'XSP', 'VIX']);
/** The index curb's end, 17:00 (SPX, XSP and VIX) */
const CURB_END = 17 * 60;
const OVERNIGHT_INDEX = new Set(['SPX', 'SPXW', 'XSP', 'VIX', 'RUT', 'RUTW']);

const WORD: Record<OptionPhase, string> = {
  overnight: 'Overnight',
  pre: 'Pre-market',
  halt: 'Halt',
  open: 'Open',
  curb: 'Curb',
  closed: 'Closed',
};

const UNDER_WORD: Record<UnderPhase, string> = {
  pre: 'Pre-market',
  open: 'Open',
  after: 'After hours',
  closed: 'Closed',
};

const dayOf = (p: { year: number; month: number; day: number }) => new Date(p.year, p.month - 1, p.day);

/** The underlying's tape (core/session): a stock's phase is the shared one (pre-market from 04:00, after hours to
    20:00, 17:00 after an early close; no overnight stock prints on either feed); a cash index prints 09:30 to its
    close (VIX from 03:15 to 16:15). Holidays and early closes come from the shared calendar. */
const underOf = (ticker: string, ms: number): UnderPhase => {
  const s = sessionAt(ms);
  const day = s.date;
  if (!isSessionDay(day)) return 'closed';
  const close = regularCloseMin(day);
  if (ticker === 'VIX') return s.minute >= 3 * 60 + 15 && s.minute < close + 15 ? 'open' : 'closed';
  if (INDEX.has(ticker) || ticker === 'NDX' || ticker === 'NDXP') return s.minute >= 570 && s.minute < close ? 'open' : 'closed';
  return s.phase === 'regular' ? 'open' : s.phase === 'pre' ? 'pre' : s.phase === 'post' ? 'after' : 'closed';
};

/** An index root's option tape (core/session windowAt, 'indexOption' for the GTH roots, 'etfOption' for NDX/NDXP):
    Global Trading Hours 20:15 to 09:25 (to 11:30 on a holiday morning that has them; none before Good Friday,
    Christmas or New Year's), the regular session to 15 minutes after the close, the curb to 17:00 (none after an early
    close). A PM-settled same-day contract stops at the close itself; VIX's same-day contract at the open. */
const indexOption = (ms: number, expiry: boolean, root: string): OptionPhase => {
  const gthRoot = GTH_ROOTS.has(root);
  const w = windowAt(ms, gthRoot ? 'indexOption' : 'etfOption');
  const wall = nyParts(ms);
  const mins = wall.hour * 60 + wall.minute;
  const iso = `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  if (!w) return gthRoot && isSessionDay(iso) && mins >= 9 * 60 + 25 && mins < 9 * 60 + 30 ? 'halt' : 'closed';
  if (w.kind === 'gth') return 'overnight';
  /* RUT's curb ends at 16:15 (its trades, scripts/compass-hours-check.ts): the shared 16:15–17:00 curb is SPX, XSP and VIX */
  if (w.kind === 'curb') return expiry || root === 'RUT' || root === 'RUTW' ? 'closed' : 'curb';
  const close = regularCloseMin(iso);
  if (expiry && root === 'VIX') return 'closed';
  if (expiry && mins >= close) return 'closed';
  return mins < close ? 'open' : 'curb';
};

const equityOption = (mins: number, trading: boolean, ticker: string, close = 16 * 60): OptionPhase => {
  if (!trading) return 'closed';
  const etf = EXT_ETF.has(ticker);
  const ext = etf || EXT_STOCK.has(ticker);
  if (ext && mins >= 7 * 60 + 30 && mins < 9 * 60 + 25) return 'pre';
  if (ext && mins >= 9 * 60 + 25 && mins < 9 * 60 + 30) return 'halt';
  if (mins >= 9 * 60 + 30 && mins < close) return 'open';
  if ((etf || LATE_ETF.has(ticker)) && mins >= close && mins < close + 15) return 'open';
  if (EXT_STOCK.has(ticker) && mins >= close && mins < close + 15) return 'curb';
  return 'closed';
};

/** The root's options are open for this sleeve. A shut name is not a blank book. It is not on the scan.
    0 DTE runs until the minute before its own stop. 1–7 DTE runs through the session's own close. The halt sends nothing, except VIX 0 DTE's last look at 09:29. */
export function optionScanOpen(ticker: string, dte: number, at: At = now()): boolean {
  if (!Number.isFinite(dte) || dte < 0 || dte > 7) return false;
  if (!sessionDayOpen(at)) return false;
  const root = ticker.toUpperCase();
  const p = nyParts(at);
  const mins = p.hour * 60 + p.minute;
  const tape = nameTape(ticker, dte === 0, at);
  if (tape.option === 'halt') return dte === 0 && root === 'VIX' && mins === 9 * 60 + 29;
  if (tape.option === 'closed') return false;
  /* "done" is the calendar day's own same-day contract after its stop. From 20:15 the session is the next day's, and
     its same-day contract (tomorrow's expiry) trades the overnight session: it is not done. The 0DTE sleeve of the
     index roots used to be skipped from 20:15 to midnight every night. */
  if (dte === 0 && tape.done && sessionYmd(at) === `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`) return false;
  return true;
}

/** Why this name is off the scan. The morning grid is not a reason. */
export function scanShutWhy(ticker: string, dte: number, at: At = now()): string {
  if (optionScanOpen(ticker, dte, at)) return 'This name is on this scan.';
  const tape = nameTape(ticker, dte === 0, at);
  if (tape.option === 'halt') return 'Halted, 09:25 to 09:30 ET. No new ticket.';
  if (dte === 0 && tape.done) return tape.doneWhy;
  if (tape.option === 'closed') return 'This name’s options are shut. A stock print is not a ticket.';
  return 'This name is not on this scan.';
}
export const odteDoneMin = (ticker: string): number => {
  if (ticker === 'VIX') return 9 * 60 + 30;
  if (INDEX.has(ticker) || (!EXT_STOCK.has(ticker) && !EXT_ETF.has(ticker) && !LATE_ETF.has(ticker))) return 16 * 60;
  return 16 * 60 + 15;
};

/** Where this root's option tape ends, for the entry gate and the call's flat (compassParams TapeClock), at the mark
    `at`: the curb ends at the root's own options close after a full day (17:00 for SPX, SPXW, XSP and VIX; 16:15 for
    RUT, RUTW, NDX, NDXP and the 16:15 names; 16:00 for every other name, which has no curb), and an index root's
    overnight session ends where the session module's Global Trading Hours window holding the mark ends (09:25, or
    11:30 on a holiday morning). On a regular full day every gate answer is what it was, except a 16:00 or 16:15 root
    after its own close (scripts/compass-gate-proof.ts). */
export function tapeClockOf(ticker: string, at: At): TapeClock {
  const root = ticker.toUpperCase();
  const curbEnd = GTH_INDEX.has(root) ? CURB_END : INDEX.has(root) || EXT_STOCK.has(root) || EXT_ETF.has(root) || LATE_ETF.has(root) ? REGULAR_CLOSE_MIN + 15 : REGULAR_CLOSE_MIN;
  const ms = msOf(at);
  const w = OVERNIGHT_INDEX.has(root) ? windowAt(ms, 'indexOption') : null;
  if (w?.kind === 'gth') return { curbEnd, gthEnd: nyWall(w.to).min };
  /* a holiday or a weekend outside Global Trading Hours: no tape (the holiday afternoon was the regular session) */
  return isSessionDay(nyWall(ms).iso) ? { curbEnd } : { curbEnd, shut: true };
}

const doneWhy = (ticker: string): string => {
  if (ticker === 'VIX') return 'No more 0DTE. VIX stops at the 09:30 open.';
  const m = odteDoneMin(ticker);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `No more 0DTE. This contract stopped at ${hh}:${mm} ET.`;
};

export function nameTape(ticker: string, expiryToday: boolean, at: At = now()): NameTape {
  const root = ticker.toUpperCase();
  const p = nyParts(at);
  const mins = p.hour * 60 + p.minute;
  const ms = typeof at === 'number' ? at : at.getTime();
  const trading = isSessionDay(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`);
  const option = INDEX.has(root) ? indexOption(ms, expiryToday, root) : equityOption(mins, trading, root, trading ? regularCloseMin(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`) : 16 * 60);
  const under = underOf(root, ms);
  /* a same-day contract stops at its own close: 16:00 or 16:15 on a full day, 13:00 or 13:15 on an early close */
  const closeShift = trading ? regularCloseMin(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`) - 16 * 60 : 0;
  const doneMin = root === 'VIX' ? odteDoneMin(root) : odteDoneMin(root) + closeShift;
  const done = expiryToday && (INDEX.has(root)
    ? p.weekday === 6 || (p.weekday >= 1 && p.weekday <= 5 && mins >= doneMin)
    : trading && mins >= doneMin);
  const underWord = UNDER_WORD[under];
  const spotName = root === 'SPXW' || root === 'XSP' ? 'SPX' : root === 'RUTW' ? 'RUT' : root;
  return {
    option,
    under,
    done,
    word: WORD[option],
    liveWhy: option === 'overnight'
      ? 'Overnight session. The cash index is not this tape.'
      : option === 'pre'
        ? `Pre-market. The option is open. ${spotName} is ${underWord.toLowerCase()}.`
        : option === 'curb'
          ? `Curb, until 16:15 ET. ${spotName} is ${underWord.toLowerCase()}.`
          : option === 'halt'
            ? 'Halted, 09:25 to 09:30 ET.'
            : `${spotName} is ${underWord.toLowerCase()}.`,
    quietWhy: under === 'pre' || under === 'after'
      ? `The option is closed. ${spotName} is ${underWord.toLowerCase()}.`
      : 'The option is closed. This contract is still alive.',
    doneWhy: doneWhy(root),
  };
}

/** This root's contracts are live at `at`. `book` means any listed expiry of the root; one date is live only on its own clock, and a same-day expiry is done at its own stop. Halt and closed are not a book. */
export function contractsLive(ticker: string, expiry: string | 'book', at: At = now()): boolean {
  const p = nyParts(at);
  const ymd = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const expiryToday = expiry !== 'book' && expiry === ymd;
  const tape = nameTape(ticker, expiryToday, at);
  if (tape.option === 'closed' || tape.option === 'halt') return false;
  if (expiryToday && tape.done) return false;
  return true;
}

/** Whether this root trades in the desk session at all. Overnight is OVERNIGHT_INDEX only — NDX and NDXP are not on it. A name that is not on the list does not borrow another session's book. */
export function rootTradesSession(ticker: string, session: DeskSession): boolean {
  const root = ticker.toUpperCase();
  if (session === 'rth') return true;
  if (session === 'overnight') return OVERNIGHT_INDEX.has(root);
  if (session === 'pre') return OVERNIGHT_INDEX.has(root) || EXT_STOCK.has(root) || EXT_ETF.has(root);
  return INDEX.has(root) || EXT_STOCK.has(root) || EXT_ETF.has(root) || LATE_ETF.has(root);
}

/** The clock the board speaks. Overnight and pre-market are open tapes, not a closed desk. */
export function deskPhase(at: At = now()): OptionPhase {
  const ms = msOf(at);
  const p = nyParts(ms);
  const mins = p.hour * 60 + p.minute;
  const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  /* the index roots' option windows (core/session): Global Trading Hours (holiday mornings that have them too), the
     regular session, the curb (none after an early close); the equity pre-market from 07:30 on a session day */
  const w = windowAt(ms, 'indexOption');
  const session = isSessionDay(iso);
  if (w?.kind === 'gth') return session && mins >= 7 * 60 + 30 ? 'pre' : 'overnight';
  if (session && mins >= 9 * 60 + 25 && mins < 9 * 60 + 30) return 'halt';
  if (!w) return 'closed';
  if (w.kind === 'curb') return 'curb';
  return mins < regularCloseMin(iso) ? 'open' : 'curb';
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymdOf = (p: { year: number; month: number; day: number }) => `${p.year}${pad2(p.month)}${pad2(p.day)}`;

function shiftDay(year: number, month: number, day: number, add: number) {
  return nyParts(nyWallTime(year, month, day, 12, 0) + add * 86_400_000);
}

function nextWeekday(year: number, month: number, day: number) {
  let q = shiftDay(year, month, day, 1);
  for (let i = 0; i < 6 && (q.weekday === 0 || q.weekday === 6); i++) q = shiftDay(q.year, q.month, q.day, 1);
  return q;
}

const msOf = (at: At) => (typeof at === 'number' ? at : at.getTime());

/** The session this clock belongs to (core/session tradingDay): the session day it is in or leads into. From the
    overnight tape's 20:00 the session is the next trading day; Wednesday night is Thursday's book; a market holiday
    and the night before it belong to the next trading day, and Friday after 20:00 to the weekend is Monday's. */
export function sessionYmd(at: At = now()): string {
  return sessionAt(msOf(at)).tradingDay.replace(/-/g, '');
}

/** Some Compass tape can trade on this clock: the stock tape has a session (pre, regular, after hours, overnight), or
    an index root's Global Trading Hours run (the evening before a holiday that has them, to 11:30 on the holiday).
    False on a holiday's afternoon, a weekend, and the evening before a holiday without GTH. The minute grid is not
    this. */
export function sessionDayOpen(at: At = now()): boolean {
  const ms = msOf(at);
  const s = sessionAt(ms);
  if (!isSessionDay(s.tradingDay)) return false;
  return s.phase !== 'closed' || windowAt(ms, 'indexOption') != null;
}

export function sessionIso(at: At = now()): string {
  const y = sessionYmd(at);
  return `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}`;
}

/** No 0DTE tape is open. Today's contracts have stopped and the next session has not started. */
export function odteAsleep(at: At = now()): boolean {
  const p = nyParts(at);
  const mins = p.hour * 60 + p.minute;
  if (p.weekday === 6) return true;
  if (p.weekday === 0 && mins < 20 * 60 + 15) return true;
  if (p.weekday === 5 && mins >= 16 * 60 + 15) return true;
  if (p.weekday >= 1 && p.weekday <= 4 && mins >= 16 * 60 + 15 && mins < 20 * 60 + 15) return true;
  return false;
}

const OPEN_WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** When the next 0DTE tape opens. That contract expires the next session, not the day that just stopped. */
export function nextOdteOpen(at: At = now()): { atMs: number; line: string } {
  const nowMs = typeof at === 'number' ? at : Date.now();
  const p = nyParts(at);
  let year = p.year;
  let month = p.month;
  let day = p.day;
  for (let i = 0; i < 6; i++) {
    const q = i === 0 ? p : shiftDay(year, month, day, 0);
    year = q.year;
    month = q.month;
    day = q.day;
    const open = nyWallTime(year, month, day, 20, 15);
    if (open > nowMs && q.weekday <= 4) {
      const trade = nextWeekday(year, month, day);
      const when = `${OPEN_WEEKDAY[trade.weekday]} ${OPEN_MONTH[trade.month - 1]} ${trade.day}`;
      return {
        atMs: open,
        line: `0DTE is over. The next one expires ${when}. Index options open at 8:15 PM ET. A contract bought then expires ${when}, not today. Extended names open at 7:30 AM ET. Every other name opens at 9:30 AM ET.`,
      };
    }
    const n = shiftDay(year, month, day, 1);
    year = n.year;
    month = n.month;
    day = n.day;
  }
  return { atMs: nowMs, line: '0DTE is over.' };
}

/** True once every 0DTE class has stopped: 15 minutes after the regular close. */
export function odteBoardDone(expiryIsToday: boolean, at: At = now()): boolean {
  if (!expiryIsToday) return false;
  const p = nyParts(at);
  const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if (!isSessionDay(iso)) return false;
  /* the last same-day class stops 15 minutes after the close (16:15, or 13:15 on an early close) */
  return p.hour * 60 + p.minute >= regularCloseMin(iso) + 15;
}

export function underWord(ticker: string, at: At = now()): string {
  return UNDER_WORD[nameTape(ticker, false, at).under];
}

/** This name's options print in that session. The stock tape is a different question. */
function optionTapeIn(ticker: string, session: DeskSession): boolean {
  const raw = ticker.toUpperCase();
  const root = raw === 'VIXW' ? 'VIX' : raw;
  if (session === 'rth') return true;
  if (session === 'overnight') return OVERNIGHT_INDEX.has(root);
  if (session === 'pre') return INDEX.has(root) || EXT_STOCK.has(root) || EXT_ETF.has(root);
  return INDEX.has(root) || EXT_STOCK.has(root) || EXT_ETF.has(root);
}

function minuteOf(p: FlowPrint): number {
  if (p.epochMs && p.epochMs > 0) return nyMinutes(p.epochMs);
  const m = /^(\d{1,2}):(\d{2})/.exec(p.time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/** The print belongs on the session the desk is reading. Regular is the cash print. The flag is Trace's. */
export function printInSession(p: FlowPrint, ticker: string, session: DeskSession): boolean {
  const root = ticker.toUpperCase();
  if (session === 'rth') return !p.extended;
  if (!optionTapeIn(root, session)) return false;
  const m = minuteOf(p);
  if (m < 0 || !p.extended) return false;
  if (session === 'pre') return m < 9 * 60 + 30;
  if (session === 'post') return m >= 16 * 60;
  return m >= 20 * 60 || m < 4 * 60;
}

export function sessionEmpty(ticker: string, session: DeskSession): string {
  if (!optionTapeIn(ticker, session)) {
    if (session === 'overnight') return 'No overnight tape. Overnight is SPX, XSP, RUT, and VIX (NDX has none).';
    if (session === 'pre') return 'No pre-market option tape on this name.';
    return 'No after-hours option tape on this name.';
  }
  if (session === 'pre') return 'No print in the pre-market.';
  if (session === 'post') return 'No print after the cash close.';
  if (session === 'overnight') return 'No print in the overnight session.';
  return 'No print in the regular session.';
}

export interface SessionRead {
  /** The session the charts should draw. */
  session: DeskSession;
  /** What the clock or the pin asked for. */
  asked: DeskSession;
  /** The asked session is not on this name, so the chart stayed on cash. */
  held: boolean;
  note: string | null;
}

/** Follow the clock only into a session this name's options actually trade. Otherwise the cash session, and a sentence. */
export function resolveDeskSession(ticker: string, minutes: readonly number[] | null, asked: DeskSession): SessionRead {
  const root = ticker.toUpperCase();
  if (asked === 'rth' || minutes == null) return { session: asked, asked, held: false, note: null };
  const cashIndex = INDEX.has(root) || root === 'NDX' || root === 'NDXP' || root === 'VIXW';
  /* A cash index's 16:00–16:15 print is the close, not after hours. SPX's last print was 16:04. */
  const has = minutes.some(m => {
    if (asked === 'overnight') return m >= 20 * 60 || m < 4 * 60;
    if (asked === 'pre') return m >= 4 * 60 && m < 9 * 60 + 30;
    if (asked === 'post') return m >= 16 * 60 && m < 20 * 60 && !(cashIndex && m < 16 * 60 + 15);
    return m >= 9 * 60 + 30 && m < 16 * 60;
  });
  if (!optionTapeIn(root, asked)) {
    const note = asked === 'overnight'
      ? `${root} does not trade overnight. Overnight options are SPX, SPXW, XSP, RUT, RUTW, and VIX.`
      : asked === 'pre'
        ? `${root} has no pre-market options.`
        : `${root} has no after-hours options.`;
    return { session: asked, asked, held: true, note };
  }
  if (has) return { session: asked, asked, held: false, note: null };
  const pastCurb = nyParts().hour * 60 + nyParts().minute >= 17 * 60;
  const note = asked === 'overnight' && cashIndex
    ? `${root} options trade overnight. The cash index does not print then.`
    : asked === 'post' && cashIndex
      ? (pastCurb
        ? `${root} does not print after the close. The curb ended at 5:00 PM ET.`
        : `${root} options trade the curb until 5:00 PM ET. The cash index does not print then.`)
      : asked === 'pre' && cashIndex
        ? `${root} options trade before the open. The cash index does not print then.`
        : `No ${asked === 'pre' ? 'pre-market' : asked === 'post' ? 'after-hours' : 'overnight'} prints for ${root} yet.`;
  return { session: asked, asked, held: true, note };
}
