/*
  What each Compass name can actually trade, in New York time.
  The scan window is not this. A stock tape, an equity option, and an
  index option are three different clocks.

  Stocks and ETFs, the Theta stock tape: pre-market 04:00–09:30,
  regular 09:30–16:00, after-hours 16:00–20:00. Every listed name.

  Equity options, everyone else: 09:30–16:00 only. The stock can be
  printing on either side of that and the option is shut.

  Equity options Cboe extended on 2026-10-19 (the published list):
  pre-market 07:30–09:25, then a halt, then the regular session.
  Single names curb 16:00–16:15. The ETFs on that list already run
  their regular session to 16:15, so they have no second curb.

  Index options SPX, SPXW, XSP, VIX, RUT, RUTW: overnight
  20:15–09:25, halt to 09:30, regular to 16:15, curb to 17:00,
  Sunday night through Friday afternoon. The cash index is not
  that tape. SPX and RUT print 09:30–16:00. VIX prints 03:15–16:15.

  A 0DTE is done when THAT contract stops, not when the scan does.
  Expiring SPX, SPXW, XSP, RUT, RUTW stop at 16:00. Expiring VIX
  stops at the 09:30 open. An expiring equity stops at its own
  option close, 16:00 or 16:15.
*/

import { isTradingDay } from '../core/calendar';
import { now } from '../core/clock';
import { nyMinutes, nyParts, type At } from '../core/nyTime';
import type { DeskSession } from './deskSession';
import type { FlowPrint } from '../types/trace';

export type OptionPhase = 'overnight' | 'pre' | 'halt' | 'open' | 'curb' | 'closed';
export type UnderPhase = 'pre' | 'open' | 'after' | 'closed';

export interface NameTape {
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

const INDEX = new Set(['SPX', 'SPXW', 'XSP', 'VIX', 'RUT', 'RUTW']);

/** Single names whose options have the 07:30 pre-market and the 16:00 curb. */
const EXT_STOCK = new Set([
  'AAPL', 'AMD', 'AMZN', 'AVGO', 'BABA', 'BAC', 'F', 'GOOG', 'GOOGL', 'HOOD', 'INTC', 'META', 'MRVL', 'MSFT', 'MU', 'NFLX', 'NVDA', 'ORCL', 'PFE', 'PLTR', 'TSLA', 'TSM',
]);

/** ETFs on the same list. Regular session already runs to 16:15. Pre-market 07:30. No curb. */
const EXT_ETF = new Set(['GLD', 'IWM', 'QQQ', 'SPY', 'XLF']);

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
  if (ticker === 'SPX' || ticker === 'SPXW' || ticker === 'XSP' || ticker === 'RUT' || ticker === 'RUTW') {
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
  if (weekday === 6) return 'closed';
  if (weekday === 0) return mins >= 20 * 60 + 15 ? 'overnight' : 'closed';
  if (weekday === 5 && mins >= 17 * 60) return 'closed';
  if (mins >= 20 * 60 + 15) return 'overnight';
  if (mins < 9 * 60 + 25) return 'overnight';
  if (mins < 9 * 60 + 30) return 'halt';
  if (vixExpiry) return 'closed';
  if (pmExpiry && mins >= 16 * 60) return 'closed';
  if (mins < 16 * 60 + 15) return 'open';
  if (mins < 17 * 60) return 'curb';
  return 'closed';
};

const equityOption = (mins: number, trading: boolean, ticker: string): OptionPhase => {
  if (!trading) return 'closed';
  const etf = EXT_ETF.has(ticker);
  const ext = etf || EXT_STOCK.has(ticker);
  if (ext && mins >= 7 * 60 + 30 && mins < 9 * 60 + 25) return 'pre';
  if (ext && mins >= 9 * 60 + 25 && mins < 9 * 60 + 30) return 'halt';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'open';
  if (etf && mins >= 16 * 60 && mins < 16 * 60 + 15) return 'open';
  if (EXT_STOCK.has(ticker) && mins >= 16 * 60 && mins < 16 * 60 + 15) return 'curb';
  return 'closed';
};

/** Last minute an expiring contract trades. The board waits for the latest of these. */
export const odteDoneMin = (ticker: string): number => {
  if (ticker === 'VIX') return 9 * 60 + 30;
  if (INDEX.has(ticker) || (!EXT_STOCK.has(ticker) && !EXT_ETF.has(ticker))) return 16 * 60;
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
export function optionTapeIn(ticker: string, session: DeskSession): boolean {
  const raw = ticker.toUpperCase();
  const root = raw === 'VIXW' ? 'VIX' : raw;
  if (session === 'rth') return true;
  if (session === 'overnight') return INDEX.has(root);
  if (session === 'pre') return INDEX.has(root) || EXT_STOCK.has(root) || EXT_ETF.has(root);
  return INDEX.has(root) || EXT_STOCK.has(root);
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
    if (session === 'overnight') return 'No overnight tape. Overnight is SPX, VIX, and RUT.';
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
  /* A cash index's 16:00–16:15 print is the close, not after hours. SPX's last print on 2026-10-27 was 16:04. */
  const has = minutes.some(m => {
    if (asked === 'overnight') return m >= 20 * 60 || m < 4 * 60;
    if (asked === 'pre') return m >= 4 * 60 && m < 9 * 60 + 30;
    if (asked === 'post') return m >= 16 * 60 && m < 20 * 60 && !(cashIndex && m < 16 * 60 + 15);
    return m >= 9 * 60 + 30 && m < 16 * 60;
  });
  if (!optionTapeIn(root, asked)) {
    const note = asked === 'overnight'
      ? `${root} does not trade overnight. Overnight options are SPX, VIX, and RUT. Showing the cash session.`
      : asked === 'pre'
        ? `${root} has no pre-market options. Showing the cash session.`
        : `${root} has no after-hours options. Showing the cash session.`;
    return { session: 'rth', asked, held: true, note };
  }
  if (has) return { session: asked, asked, held: false, note: null };
  const pastCurb = nyParts().hour * 60 + nyParts().minute >= 17 * 60;
  const note = asked === 'overnight' && cashIndex
    ? `${root} options trade overnight. The cash index does not print then. Showing the cash session.`
    : asked === 'post' && cashIndex
      ? (pastCurb
        ? `${root} does not print after the close. The curb ended at 5:00 PM ET. Showing the cash session.`
        : `${root} options trade the curb until 5:00 PM ET. The cash index does not print then. Showing the cash session.`)
      : asked === 'pre' && cashIndex
        ? `${root} options trade before the open. The cash index does not print then. Showing the cash session.`
        : `No ${asked === 'pre' ? 'pre-market' : asked === 'post' ? 'after-hours' : 'overnight'} prints for ${root} yet. Showing the cash session.`;
  return { session: 'rth', asked, held: true, note };
}
