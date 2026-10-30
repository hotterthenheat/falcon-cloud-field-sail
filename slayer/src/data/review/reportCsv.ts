/* THE REPORT, AS FILES — a backtest session's closed trades and its By day table, as CSV a spreadsheet opens. The same
   conventions as the journal's export (data/review/journalManual.ts): a header row of lower-case names, one line a row,
   lines ended \r\n, a cell with a comma, a quote or a line break in quotes (quotes doubled), dates ISO, times New York
   ("2026-10-28 10:01", the clock the desk shows: a minute's END), money in dollars to the cent with no sign but "-",
   a blank where there is nothing. The page hands the text to `saveFile`, which writes the byte-order mark.

   THE TRADES FILE — one line a closed trade, oldest close first (the report's order):
     trade        the trade's id in the session
     opened_et    the first buy, New York
     closed_et    the fill (or the bell) that left it flat
     contract     "SPY Oct 30 771C" — a spread "SPY Oct 30 771/775C"
     ticker, expiry, right (C or P), strike, short_strike (the strike sold, for a spread)
     side         long — every trade here is bought to open (a spread for a debit)
     qty          contracts bought over its life
     entry, exit  the average paid and received, a share
     fills        every fill, in order: "10:01 buy 2 @ 4.10; 14:16 sell 2 @ 3.59 stop" — one on a later day
                  leads with its date ("2026-10-29 11:31 sell 2 @ 2.59")
     fees         every fee of its fills, in and out
     pnl          what it made or lost, fees in — the report's "Made or lost"
     r            pnl over what it cost
     held_min     session minutes it was on
     ended        sold, target, stopped, scaled, expired
     settle       for one that ended at the bell: cash, exercised or worthless
   THE DAYS FILE — the report's By day, one line a day:
     date, closed (trades closed that day), pnl (what they made), account_move (from the bell before, open contracts
     marked), equity_at_bell, held_overnight (positions carried), and — with the reader's day stop — day_stop (the
     dollars it stood at: the account at 09:30 times the rule) */

import { clockWords } from './history';
import { contractWords } from './quotes';
import { dayStopOf, type Moment, type Session, type Trade } from './engine';

const cents = (v: number) => Math.round(v * 100) / 100;
const cell = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '' : cents(v).toFixed(2));
/** "2026-10-28 10:01" — the desk's clock, New York */
export const etWords = (m: Moment): string => `${m.day} ${clockWords(m.minute)}`;

/** A day of the session: what closed on it, and the account as the bell left it (where the bell has rung) */
export interface DayRow {
  day: string;
  n: number;
  net: number;
  /** The account at the bell, marked — null on a day the bell has not rung on */
  equity: number | null;
  /** The account's move that day, open contracts marked — null without both bells */
  move: number | null;
  held: number | null;
  /** The reader's day stop that day, in dollars (the account at 09:30 times the rule) — null without the rule */
  stop: number | null;
}
/** By day: the trades that closed on it, and the account at its bell (the engine keeps one a day it rings) */
export function dayRowsOf(s: Session, trades: Trade[]): DayRow[] {
  const closes = s.closes ?? {};
  const all = [...new Set([...Object.keys(closes), ...trades.map(t => t.closed.day)])].sort();
  let prev: number | null = s.startCash;
  return all.map(day => {
    const mine = trades.filter(t => t.closed.day === day);
    const c = closes[day];
    const stop = dayStopOf(s, day);
    const row: DayRow = { day, n: mine.length, net: cents(mine.reduce((a, t) => a + t.pnl, 0)), equity: c ? c.equity : null, move: c && prev != null ? cents(c.equity - prev) : null, held: c ? c.held : null, stop: stop ? stop.loss : null };
    prev = c ? c.equity : null;
    return row;
  });
}

/** Every fee a trade's fills paid, in and out */
export const tradeFees = (t: Trade): number => cents(t.legs.reduce((a, l) => a + l.fee, 0));
const settleWord = (t: Trade): string => (t.how !== 'expired' ? '' : t.avgOut <= 0 ? 'worthless' : t.settle === 'cash' ? 'cash' : 'exercised');

export const TRADE_COLUMNS = ['trade', 'opened_et', 'closed_et', 'contract', 'ticker', 'expiry', 'right', 'strike', 'short_strike', 'side', 'qty', 'entry', 'exit', 'fills', 'fees', 'pnl', 'r', 'held_min', 'ended', 'settle'] as const;
/** The closed trades as a file, in the order given (the report's: oldest close first) */
export function reportTradesCsv(trades: Trade[]): string {
  const lines = trades.map(t =>
    [
      t.id,
      etWords(t.opened),
      etWords(t.closed),
      contractWords(t.contract),
      t.contract.ticker,
      t.contract.expiry,
      t.contract.right,
      t.contract.strike,
      t.contract.short ?? '',
      'long',
      t.qty,
      t.avgIn.toFixed(2),
      t.avgOut.toFixed(2),
      t.legs.map(l => `${l.at.day !== t.opened.day ? `${l.at.day} ` : ''}${clockWords(l.at.minute)} ${l.side} ${l.qty} @ ${l.price.toFixed(2)}${l.out && l.out !== 'hand' ? ` ${l.out}` : ''}`).join('; '),
      money(tradeFees(t)),
      money(t.pnl),
      t.r.toFixed(4),
      t.heldMin,
      t.how,
      settleWord(t),
    ]
      .map(cell)
      .join(',')
  );
  return [TRADE_COLUMNS.join(','), ...lines].join('\r\n');
}

/** The By day table as a file; `withStop` adds the reader's day stop */
export function reportDaysCsv(days: DayRow[], withStop: boolean): string {
  const head = ['date', 'closed', 'pnl', 'account_move', 'equity_at_bell', 'held_overnight', ...(withStop ? ['day_stop'] : [])];
  const lines = days.map(d => [d.day, d.n, money(d.net), money(d.move), money(d.equity), d.held ?? '', ...(withStop ? [d.stop != null ? money(-d.stop) : ''] : [])].map(cell).join(','));
  return [head.join(','), ...lines].join('\r\n');
}
