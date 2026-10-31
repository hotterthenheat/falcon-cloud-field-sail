/* What each Compass name can actually trade, in New York time. The scan window is not this. A stock tape, an
   equity option, and an index option are three different clocks. Stocks and ETFs, the Theta stock tape: pre-market
   04:00–09:30, regular 09:30–16:00, after-hours 16:00–20:00. Every listed name. */

import { isTradingDay, MONTHS as OPEN_MONTH } from '../core/calendar';
import { now } from '../core/clock';
import { nyMinutes, nyParts, nyWallTime, type At } from '../core/nyTime';
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

/** ETFs whose options trade to 16:15 with no pre-market (each traded 16:00-16:15 and never 07:30-09:25 in the
    sessions scripts/compass-hours-check.ts read). */
const LATE_ETF = new Set(['DIA', 'EWZ', 'KWEB', 'SLV', 'SMH', 'SOXL', 'SOXX', 'TLT', 'UNG', 'UVIX', 'UVXY', 'VOO', 'VXX', 'XLE', 'XLF']);

/** Index roots with the overnight session (20:15-09:25 ET) and the curb to 17:00. RUT has the overnight session and
    closes at 16:15; NDX has neither (no overnight trade, its curb ends at 16:15). */
const GTH_INDEX = new Set(['SPX', 'SPXW', 'XSP', 'VIX']);
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

const underOf = (ticker: string, mins: number, trading: boolean): UnderPhase => {
  if (!trading) return 'closed';
  if (ticker === 'VIX') return mins >= 3 * 60 + 15 && mins < 16 * 60 + 15 ? 'open' : 'closed';
  if (ticker === 'SPX' || ticker === 'SPXW' || ticker === 'XSP' || ticker === 'NDX' || ticker === 'NDXP' || ticker === 'RUT' || ticker === 'RUTW') {
    return mins >= 9 * 60 + 30 && mins < 16 * 60 ? 'open' : 'closed';
  }
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'open';
  if (mins >= 16 * 60 && mins < 20 * 60) return 'after';
  return 'closed';
};

const indexOption = (mins: number, weekday: number, expiry: boolean, root: string): OptionPhase => {
  const vixExpiry = expiry && root === 'VIX';
  const pmExpiry = expiry && root !== 'VIX';
  const overnight = OVERNIGHT_INDEX.has(root);
  if (weekday === 6) return 'closed';
  if (weekday === 0) return overnight && mins >= 20 * 60 + 15 ? 'overnight' : 'closed';
  if (weekday === 5 && mins >= 17 * 60) return 'closed';
  if (mins >= 20 * 60 + 15) return overnight ? 'overnight' : 'closed';
  if (mins < 9 * 60 + 25) return overnight ? 'overnight' : 'closed';
  if (mins < 9 * 60 + 30) return overnight ? 'halt' : 'closed';
  if (vixExpiry) return 'closed';
  if (pmExpiry && mins >= 16 * 60) return 'closed';
  if (mins < 16 * 60) return 'open';
  /* Not expiring today: the curb runs to 17:00 on the GTH roots and to 16:15 on RUT and NDX. An expiring index is
     already closed. */
  if (mins < (GTH_INDEX.has(root) ? 17 * 60 : 16 * 60 + 15)) return 'curb';
  return 'closed';
};

const equityOption = (mins: number, trading: boolean, ticker: string): OptionPhase => {
  if (!trading) return 'closed';
  const etf = EXT_ETF.has(ticker);
  const ext = etf || EXT_STOCK.has(ticker);
  if (ext && mins >= 7 * 60 + 30 && mins < 9 * 60 + 25) return 'pre';
  if (ext && mins >= 9 * 60 + 25 && mins < 9 * 60 + 30) return 'halt';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'open';
  if ((etf || LATE_ETF.has(ticker)) && mins >= 16 * 60 && mins < 16 * 60 + 15) return 'open';
  if (EXT_STOCK.has(ticker) && mins >= 16 * 60 && mins < 16 * 60 + 15) return 'curb';
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
  if (dte === 0 && tape.done) return false;
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
  const trading = isTradingDay(dayOf(p));
  const option = INDEX.has(root) ? indexOption(mins, p.weekday, expiryToday, root) : equityOption(mins, trading, root);
  const under = underOf(root, mins, trading);
  const done = expiryToday && (INDEX.has(root)
    ? p.weekday === 6 || (p.weekday >= 1 && p.weekday <= 5 && mins >= odteDoneMin(root))
    : trading && mins >= odteDoneMin(root));
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
  const p = nyParts(at);
  const mins = p.hour * 60 + p.minute;
  if (p.weekday === 6) return 'closed';
  if (p.weekday === 0 && mins < 20 * 60 + 15) return 'closed';
  if (p.weekday === 5 && mins >= 17 * 60) return 'closed';
  if (mins >= 9 * 60 + 25 && mins < 9 * 60 + 30) return 'halt';
  if (mins >= 20 * 60 + 15 || mins < 7 * 60 + 30) return 'overnight';
  if (mins < 9 * 60 + 25) return 'pre';
  if (mins < 16 * 60) return 'open';
  if (mins < 17 * 60) return 'curb';
  return 'closed';
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

/** The weekday this clock would belong to if every weekday traded: after 8:15 PM ET (and from Friday 17:00) the next
    weekday. */
function nominalSession(at: At) {
  const p = nyParts(at);
  const mins = p.hour * 60 + p.minute;
  if (p.weekday === 6 || p.weekday === 0) return nextWeekday(p.year, p.month, p.day);
  if (p.weekday === 5 && mins >= 17 * 60) return nextWeekday(p.year, p.month, p.day);
  if (mins >= 20 * 60 + 15) return nextWeekday(p.year, p.month, p.day);
  return p;
}

/** The session this clock belongs to. After 8:15 PM ET the session is the next trading day. Wednesday night is
    Thursday's book. A market holiday is not a session: its day and the night before it belong to the next trading
    day (core/calendar MARKET_HOLIDAYS). */
export function sessionYmd(at: At = now()): string {
  let q = nominalSession(at);
  for (let i = 0; i < 10 && !isTradingDay(dayOf(q)); i++) q = nextWeekday(q.year, q.month, q.day);
  return ymdOf(q);
}

/** This clock's session trades at all: false on a market holiday and through the overnight before it (Wednesday
    20:15 ET before Thanksgiving belongs to the holiday, and no tape runs). The scan's minute grid is not this. */
export function sessionDayOpen(at: At = now()): boolean {
  return isTradingDay(dayOf(nominalSession(at)));
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

/** True once every 0DTE class has stopped. The last of them is 16:15 ET. */
export function odteBoardDone(expiryIsToday: boolean, at: At = now()): boolean {
  if (!expiryIsToday) return false;
  const p = nyParts(at);
  if (!isTradingDay(dayOf(p))) return false;
  return p.hour * 60 + p.minute >= 16 * 60 + 15;
}

export function underWord(ticker: string, at: At = now()): string {
  return UNDER_WORD[nameTape(ticker, false, at).under];
}

/** This name's options print in that session. The stock tape is a different question. */
function optionTapeIn(ticker: string, session: DeskSession): boolean {
  const raw = ticker.toUpperCase();
  const root = raw === 'VIXW' ? 'VIX' : raw;
  if (session === 'rth') return true;
  if (session === 'overnight') return INDEX.has(root);
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
    if (session === 'overnight') return 'No overnight tape. Overnight is SPX, NDX, RUT, and VIX.';
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
