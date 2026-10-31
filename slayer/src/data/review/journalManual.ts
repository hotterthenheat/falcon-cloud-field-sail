/* JOURNALS OF YOUR OWN — the reader's real trading, from their own broker, entered by hand or brought in from a CSV.
   The app measured none of it: every figure here is what the reader typed, and the page says so wherever it shows them.
   Never mixed with the paper or backtest journals.

   A journal holds DAYS (what the day made, before fees; the fees; how many trades, won and lost; notes and tags) and,
   if the reader wants, TRADES (date, ticker, contract, side, size, in, out, P&L). Each of a day's figures is the
   number the reader entered for the day; a figure left blank is added up from the day's trades. A day's NET is its
   P&L less its fees.

   Kept in this browser (localStorage), read back before every write so another tab's entries are not lost.

   THE CSV FORMAT (import, and what the export writes) — a header row, columns in any order, names in any case:
     A DAYS file has `date` and `pnl`:
       date      2026-10-28, 10/28/2026 or 10/28/26
       pnl       the day's P&L before fees — 1250.50, $1,250.50, -340, (340.00)   [also: p&l, p/l, profit, realized]
       fees      commissions and fees, a positive number                          [also: fee, commission, commissions]
       trades    how many trades                                                  [also: count, # trades]
       wins      how many made money                                              [also: winners, won]
       losses    how many lost                                                    [also: losers, lost]
       notes     words on the day                                                 [also: note]
       tags      separated by ; or |                                              [also: tag]
       A line with notes or tags and no figures at all is a day of words alone (a plan written ahead).
     A TRADES file has `date` and `ticker` (or `symbol`), and `pnl` or `entry` and `exit`:
       date, time (HH:MM, New York), ticker, contract (free words, "SPY 580C Oct 30"), side (long, short, buy or sell),
       qty, entry, exit, pnl, fees, multiplier, notes
       A trade's blank pnl is (exit − entry) × qty × multiplier, turned over for a short; the multiplier is 100 on an
       option row (a contract named, an option written in the ticker — "SPY241018C00500000", "SPY 580C" — or a quantity
       column headed "contracts") and 1 when not, unless the file says.
*/

import { useSyncExternalStore } from 'react';
import { EMBEDDED } from '../../embed';

export interface ManualDay {
  /** The day's P&L before fees */
  pnl?: number;
  fees?: number;
  trades?: number;
  wins?: number;
  losses?: number;
  notes?: string;
  tags?: string[];
}
export type ManualSide = 'long' | 'short';
export interface ManualTrade {
  id: string;
  day: string;
  /** "HH:MM", New York */
  time?: string;
  ticker: string;
  contract?: string;
  side: ManualSide;
  qty?: number;
  entry?: number;
  exit?: number;
  /** Before fees */
  pnl: number;
  fees?: number;
  notes?: string;
}
export interface ManualJournal {
  id: string;
  name: string;
  /** The broker or account it is from, the reader's words */
  broker?: string;
  createdAt: number;
  days: Record<string, ManualDay>;
  trades: ManualTrade[];
}

const cents = (v: number) => Math.round(v * 100) / 100;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ================================================================== */
/* The figures */
/* ================================================================== */

/** A day as the calendar and the charts read it — the shape of the app's own day totals (journalFigures DayTotal),
    with what only an entered day has */
export interface ManualDayFigure {
  day: string;
  /** P&L less fees */
  net: number;
  gross: number;
  fees: number;
  /** Trades, wins and losses — 0 when the reader gave neither the count nor any trades */
  n: number;
  wins: number;
  losses: number;
  /** The trades entered on the day, in the order of their time */
  trades: ManualTrade[];
  /** Where the P&L came from: the number entered for the day, or the day's trades added up */
  from: 'day' | 'trades';
  notes: string;
  tags: string[];
  /** The journal(s) it is from */
  journals: string[];
  /** DayTotal's list of app-measured trades — always empty here */
  rows: [];
}
const tradeNet = (t: ManualTrade) => cents(t.pnl - (t.fees ?? 0));

/** One journal's day, worked out: null when the day has neither a P&L nor trades (a day of notes alone) */
export function dayFigureOf(day: string, d: ManualDay | undefined, trades: ManualTrade[], journal: string): ManualDayFigure | null {
  const list = [...trades].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const hasPnl = d?.pnl != null && Number.isFinite(d.pnl);
  if (!hasPnl && !list.length) return null;
  const gross = hasPnl ? cents(d!.pnl!) : cents(list.reduce((x, t) => x + t.pnl, 0));
  const fees = d?.fees != null ? cents(d.fees) : cents(list.reduce((x, t) => x + (t.fees ?? 0), 0));
  return {
    day,
    net: cents(gross - fees),
    gross,
    fees,
    n: d?.trades ?? list.length,
    wins: d?.wins ?? list.filter(t => tradeNet(t) > 0).length,
    losses: d?.losses ?? list.filter(t => tradeNet(t) < 0).length,
    trades: list,
    from: hasPnl ? 'day' : 'trades',
    notes: d?.notes ?? '',
    tags: d?.tags ?? [],
    journals: [journal],
    rows: [],
  };
}
/** Every day of one or more journals that made or lost something, by date — journals added up day by day */
export function manualDaysOf(journals: ManualJournal[]): Map<string, ManualDayFigure> {
  const out = new Map<string, ManualDayFigure>();
  for (const j of journals) {
    const byDay = new Map<string, ManualTrade[]>();
    for (const t of j.trades) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t]);
    for (const day of new Set([...Object.keys(j.days), ...byDay.keys()])) {
      const f = dayFigureOf(day, j.days[day], byDay.get(day) ?? [], j.id);
      if (!f) continue;
      const was = out.get(day);
      out.set(
        day,
        was
          ? {
              ...was,
              net: cents(was.net + f.net),
              gross: cents(was.gross + f.gross),
              fees: cents(was.fees + f.fees),
              n: was.n + f.n,
              wins: was.wins + f.wins,
              losses: was.losses + f.losses,
              trades: [...was.trades, ...f.trades],
              from: was.from === 'day' || f.from === 'day' ? 'day' : 'trades',
              notes: [was.notes, f.notes].filter(Boolean).join(' · '),
              tags: [...new Set([...was.tags, ...f.tags])],
              journals: [...was.journals, j.id],
            }
          : f
      );
    }
  }
  return new Map([...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

export interface ManualStats {
  /** Days that made or lost something */
  days: number;
  net: number;
  gross: number;
  fees: number;
  greenDays: number;
  redDays: number;
  /** Green days over green and red days; null with neither */
  dayWinRate: number | null;
  trades: number;
  wins: number;
  losses: number;
  /** Wins over wins and losses, as entered; null with neither */
  winRate: number | null;
  /** What the green days made over what the red days lost; null with no red day */
  dayProfitFactor: number | null;
  /** The same over the entered trades (net of their fees); null with no losing trade, n 0 with no trades entered */
  tradeProfitFactor: number | null;
  tradesEntered: number;
  avgGreenDay: number | null;
  avgRedDay: number | null;
  bestDay: ManualDayFigure | null;
  worstDay: ManualDayFigure | null;
  /** The longest run of green days, and of red days (a flat day breaks both) */
  greenRun: number;
  redRun: number;
  /** The most the day-by-day running total fell from its best */
  maxDrawdown: number;
}
export function manualStatsOf(days: ManualDayFigure[]): ManualStats {
  const list = [...days].sort((a, b) => (a.day < b.day ? -1 : 1));
  const green = list.filter(d => d.net > 0);
  const red = list.filter(d => d.net < 0);
  const made = green.reduce((x, d) => x + d.net, 0);
  const lost = red.reduce((x, d) => x + d.net, 0);
  const wins = list.reduce((x, d) => x + d.wins, 0);
  const losses = list.reduce((x, d) => x + d.losses, 0);
  const trades = list.flatMap(d => d.trades);
  const tWon = trades.filter(t => tradeNet(t) > 0).reduce((x, t) => x + tradeNet(t), 0);
  const tLost = trades.filter(t => tradeNet(t) < 0).reduce((x, t) => x + tradeNet(t), 0);
  let total = 0;
  let best = 0;
  let maxDrawdown = 0;
  let greenRun = 0;
  let redRun = 0;
  let run = 0;
  let runInk: 'g' | 'r' | null = null;
  for (const d of list) {
    total = cents(total + d.net);
    best = Math.max(best, total);
    maxDrawdown = Math.max(maxDrawdown, cents(best - total));
    const ink = d.net > 0 ? 'g' : d.net < 0 ? 'r' : null;
    run = ink && ink === runInk ? run + 1 : ink ? 1 : 0;
    runInk = ink;
    if (ink === 'g') greenRun = Math.max(greenRun, run);
    if (ink === 'r') redRun = Math.max(redRun, run);
  }
  const ranked = [...list].sort((a, b) => b.net - a.net);
  return {
    days: list.length,
    net: cents(list.reduce((x, d) => x + d.net, 0)),
    gross: cents(list.reduce((x, d) => x + d.gross, 0)),
    fees: cents(list.reduce((x, d) => x + d.fees, 0)),
    greenDays: green.length,
    redDays: red.length,
    dayWinRate: green.length + red.length ? green.length / (green.length + red.length) : null,
    trades: list.reduce((x, d) => x + d.n, 0),
    wins,
    losses,
    winRate: wins + losses ? wins / (wins + losses) : null,
    dayProfitFactor: lost < 0 ? cents(made / -lost) : null,
    tradeProfitFactor: tLost < 0 ? cents(tWon / -tLost) : null,
    tradesEntered: trades.length,
    avgGreenDay: green.length ? cents(made / green.length) : null,
    avgRedDay: red.length ? cents(lost / red.length) : null,
    bestDay: ranked[0] ?? null,
    worstDay: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    greenRun,
    redRun,
    maxDrawdown,
  };
}
/** The running total a day at a time, oldest first */
export const manualRunningOf = (days: ManualDayFigure[]): { day: string; value: number; drop: number; d: ManualDayFigure }[] => {
  let total = 0;
  let best = 0;
  return [...days]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map(d => {
      total = cents(total + d.net);
      best = Math.max(best, total);
      return { day: d.day, value: total, drop: cents(total - best), d };
    });
};

/* ================================================================== */
/* The CSV */
/* ================================================================== */

/** "1,250.50" · "$1,250.50" · "-340" · "(340.00)" · "−12" — null for blank, NaN for words that are not a number */
export function numberOf(raw: string | undefined): number | null {
  const s0 = (raw ?? '').trim();
  if (!s0) return null;
  let s = s0.replace(/[\s$,]/g, '').replace(/[−–]/g, '-');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('$')) s = s.slice(1);
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
  const v = Number(s);
  return neg ? -v : v;
}
/** "2026-10-28" · "10/28/2026" · "10/28/26" → "2026-10-28"; null when it is not a real date */
export function dateOf(raw: string | undefined): string | null {
  const s = (raw ?? '').trim().slice(0, 10).trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else {
    hit = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
    if (!hit) return null;
    [m, d, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
    if (y < 100) y += 2000;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** A CSV's lines as cells: quotes, doubled quotes and commas or line breaks inside quotes */
export function csvCells(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter(r => r.some(c => c.trim() !== ''));
}

const ALIASES: Record<string, string[]> = {
  date: ['date', 'day', 'trade date'],
  pnl: ['pnl', 'p&l', 'p/l', 'profit', 'realized', 'realized pnl', 'realized p&l', 'gross pnl'],
  fees: ['fees', 'fee', 'commission', 'commissions'],
  trades: ['trades', 'count', '# trades', 'number of trades'],
  wins: ['wins', 'winners', 'won'],
  losses: ['losses', 'losers', 'lost'],
  notes: ['notes', 'note'],
  tags: ['tags', 'tag'],
  time: ['time'],
  ticker: ['ticker', 'symbol', 'underlying'],
  contract: ['contract', 'option', 'instrument'],
  side: ['side', 'direction', 'action'],
  qty: ['qty', 'quantity', 'size', 'contracts', 'shares'],
  entry: ['entry', 'entry price', 'in', 'open price', 'avg entry'],
  exit: ['exit', 'exit price', 'out', 'close price', 'avg exit'],
  multiplier: ['multiplier', 'mult'],
};
const columnsOf = (head: string[]): Partial<Record<keyof typeof ALIASES, number>> => {
  const out: Partial<Record<string, number>> = {};
  head.forEach((h, i) => {
    const k = h.trim().toLowerCase();
    for (const [name, words] of Object.entries(ALIASES)) if (out[name] == null && words.includes(k)) out[name] = i;
  });
  return out;
};

export interface CsvMiss {
  /** The file's line, counting the header as 1 */
  line: number;
  why: string;
}
export type ManualTradeIn = Omit<ManualTrade, 'id'>;
export interface CsvRead {
  kind: 'days' | 'trades' | null;
  days: { day: string; entry: ManualDay }[];
  trades: ManualTradeIn[];
  misses: CsvMiss[];
}
const tagsOf = (s: string | undefined): string[] => [...new Set((s ?? '').split(/[;|]/).map(x => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
const sideOf = (s: string | undefined): ManualSide | null => {
  const w = (s ?? '').trim().toLowerCase();
  if (!w || ['long', 'buy', 'bought', 'b', 'l', 'btc', 'bto'].includes(w)) return 'long';
  if (['short', 'sell', 'sold', 's', 'sto', 'stc'].includes(w)) return 'short';
  return null;
};
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
/** An option written in the ticker cell: an OCC symbol ("SPY241018C00500000", "SPY   241018C00500000"), a strike and a
    right ("SPY 580C", "SPY 580 PUT"), or the words call / put */
const OPTION_WORDS = /^[A-Z.]{1,6}\s*\d{6}[CP]\d{8}$|\b\d+(\.\d+)?\s*(C|P|CALLS?|PUTS?)\b|\b(CALLS?|PUTS?)\b/i;
/** Is a trades-file row an option (100 to the point): a contract named, an option written in its ticker, or a quantity
    the file calls "contracts" */
export const isOptionRow = (rawTicker: string, contract: string, qtyHeader?: string): boolean => !!contract.trim() || OPTION_WORDS.test(rawTicker.trim()) || (qtyHeader ?? '').trim().toLowerCase() === 'contracts';

/** A CSV in the format at the head of this file, read: a days file or a trades file, and every line it could not read
    with the reason */
export function readJournalCsv(text: string): CsvRead {
  const lines = csvCells(text);
  const none: CsvRead = { kind: null, days: [], trades: [], misses: [] };
  if (!lines.length) return { ...none, misses: [{ line: 1, why: 'The file is empty' }] };
  const col = columnsOf(lines[0]);
  if (col.date == null) return { ...none, misses: [{ line: 1, why: 'No "date" column in the header row' }] };
  const isTrades = col.ticker != null && (col.pnl != null || (col.entry != null && col.exit != null));
  if (!isTrades && col.pnl == null) return { ...none, misses: [{ line: 1, why: 'A days file needs a "pnl" column; a trades file needs "ticker" and "pnl" (or "entry" and "exit")' }] };
  const at = (cells: string[], k: keyof typeof ALIASES): string | undefined => (col[k] == null ? undefined : cells[col[k]!]);
  const out: CsvRead = { kind: isTrades ? 'trades' : 'days', days: [], trades: [], misses: [] };
  const seenDays = new Map<string, number>();
  lines.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const day = dateOf(at(cells, 'date'));
    if (!day) return out.misses.push({ line, why: `"${(at(cells, 'date') ?? '').trim()}" is not a date (2026-10-28 or 10/28/2026)` });
    const nums: Record<string, number | null> = {};
    for (const k of ['pnl', 'fees', 'trades', 'wins', 'losses', 'qty', 'entry', 'exit', 'multiplier'] as const) {
      const v = numberOf(at(cells, k));
      if (v != null && Number.isNaN(v)) {
        out.misses.push({ line, why: `${k} "${(at(cells, k) ?? '').trim()}" is not a number` });
        return;
      }
      nums[k] = v;
    }
    for (const k of ['trades', 'wins', 'losses'] as const) if (nums[k] != null && (nums[k]! < 0 || !Number.isInteger(nums[k]))) return out.misses.push({ line, why: `${k} must be a whole number, 0 or more` });
    if (nums.fees != null && nums.fees < 0) nums.fees = -nums.fees;
    const notes = (at(cells, 'notes') ?? '').trim().slice(0, 2000);
    if (!isTrades) {
      const tags = tagsOf(at(cells, 'tags'));
      /* a day of words alone (a plan written ahead) is kept as words; a day with figures needs its P&L */
      if (nums.pnl == null && (!(notes || tags.length) || nums.trades != null || nums.fees != null || nums.wins != null || nums.losses != null)) return out.misses.push({ line, why: 'No P&L on this line' });
      if (nums.trades != null && (nums.wins ?? 0) + (nums.losses ?? 0) > nums.trades) return out.misses.push({ line, why: 'More wins and losses than trades' });
      if (seenDays.has(day)) out.misses.push({ line, why: `${day} is in the file twice — line ${seenDays.get(day)} is the one kept` });
      else {
        seenDays.set(day, line);
        const entry: ManualDay = nums.pnl != null ? { pnl: cents(nums.pnl) } : {};
        if (nums.fees != null) entry.fees = cents(nums.fees);
        if (nums.trades != null) entry.trades = nums.trades;
        if (nums.wins != null) entry.wins = nums.wins;
        if (nums.losses != null) entry.losses = nums.losses;
        if (notes) entry.notes = notes;
        if (tags.length) entry.tags = tags;
        out.days.push({ day, entry });
      }
      return;
    }
    const rawTicker = (at(cells, 'ticker') ?? '').trim().toUpperCase();
    const ticker = rawTicker.slice(0, 12);
    if (!ticker) return out.misses.push({ line, why: 'No ticker on this line' });
    const side = sideOf(at(cells, 'side'));
    if (!side) return out.misses.push({ line, why: `side "${(at(cells, 'side') ?? '').trim()}" is not long, short, buy or sell` });
    const contract = (at(cells, 'contract') ?? '').trim().slice(0, 60);
    let pnl = nums.pnl;
    if (pnl == null) {
      if (nums.entry == null || nums.exit == null || nums.qty == null) return out.misses.push({ line, why: 'No P&L, and no entry, exit and qty to work it out from' });
      /* 100 for an option row — a contract named, an option in the ticker, or a "contracts" column — else 1 (shares) */
      const mult = nums.multiplier ?? (isOptionRow(rawTicker, contract, col.qty != null ? lines[0][col.qty] : undefined) ? 100 : 1);
      pnl = (nums.exit - nums.entry) * nums.qty * mult * (side === 'short' ? -1 : 1);
    }
    const time = (at(cells, 'time') ?? '').trim();
    const t: ManualTradeIn = { day, ticker, side, pnl: cents(pnl) };
    if (TIME.test(time)) t.time = time.slice(0, 5).padStart(5, '0');
    if (contract) t.contract = contract;
    if (nums.qty != null) t.qty = Math.abs(nums.qty);
    if (nums.entry != null) t.entry = nums.entry;
    if (nums.exit != null) t.exit = nums.exit;
    if (nums.fees != null) t.fees = cents(nums.fees);
    if (notes) t.notes = notes;
    out.trades.push(t);
  });
  return out;
}

const cell = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** A journal's days as a days file in the format above — what the import reads back */
export function manualDaysCsv(j: ManualJournal): string {
  const head = ['date', 'pnl', 'fees', 'trades', 'wins', 'losses', 'notes', 'tags'];
  const days = Object.keys(j.days).sort();
  const lines = days.map(day => {
    const d = j.days[day];
    return [day, d.pnl, d.fees, d.trades, d.wins, d.losses, d.notes, (d.tags ?? []).join('; ')].map(cell).join(',');
  });
  return [head.join(','), ...lines].join('\r\n');
}
/** A journal's trades as a trades file in the format above */
export function manualTradesCsv(j: ManualJournal): string {
  const head = ['date', 'time', 'ticker', 'contract', 'side', 'qty', 'entry', 'exit', 'pnl', 'fees', 'notes'];
  const lines = [...j.trades].sort((a, b) => `${a.day} ${a.time ?? ''}`.localeCompare(`${b.day} ${b.time ?? ''}`)).map(t => [t.day, t.time, t.ticker, t.contract, t.side, t.qty, t.entry, t.exit, t.pnl, t.fees, t.notes].map(cell).join(','));
  return [head.join(','), ...lines].join('\r\n');
}
export const CSV_DAYS_EXAMPLE = 'date,pnl,fees,trades,wins,losses,notes,tags\n2026-10-27,412.50,8.40,6,4,2,Waited for the open range,ORB; Patience\n2026-10-28,-180,5.60,4,1,3,"Chased the first move, then sized up",Chased it';
export const CSV_TRADES_EXAMPLE = 'date,time,ticker,contract,side,qty,entry,exit,pnl,fees\n2026-10-28,09:52,SPY,SPY 580C Oct 30,long,2,1.85,2.40,110,2.60\n2026-10-28,11:20,QQQ,,short,50,512.40,513.10,,1.00';

/* ================================================================== */
/* The store */
/* ================================================================== */

const KEY = 'slayer_journal_manual_v1';
const isTrade = (v: unknown): v is ManualTrade => {
  const t = v as Partial<ManualTrade> | null;
  return !!t && typeof t.id === 'string' && typeof t.day === 'string' && ISO_DAY.test(t.day) && typeof t.ticker === 'string' && (t.side === 'long' || t.side === 'short') && typeof t.pnl === 'number';
};
const isJournal = (v: unknown): v is ManualJournal => {
  const j = v as Partial<ManualJournal> | null;
  return !!j && typeof j.id === 'string' && typeof j.name === 'string' && typeof j.days === 'object' && j.days !== null && Array.isArray(j.trades);
};
function load(): ManualJournal[] {
  if (typeof localStorage === 'undefined' || EMBEDDED) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return Array.isArray(raw) ? raw.filter(isJournal).map(j => ({ ...j, days: Object.fromEntries(Object.entries(j.days).filter(([d]) => ISO_DAY.test(d))), trades: j.trades.filter(isTrade) })) : [];
  } catch {
    return [];
  }
}
let journals: ManualJournal[] = load();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
/** Written at once, after reading back what another tab may have written */
const write = (fn: (list: ManualJournal[]) => ManualJournal[]) => {
  if (EMBEDDED) return;
  journals = fn(load());
  try {
    localStorage.setItem(KEY, JSON.stringify(journals));
  } catch {
    /* full: the entries last as long as the page */
  }
  notify();
};
if (typeof window !== 'undefined')
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    journals = load();
    notify();
  });
export const useManualJournals = (): ManualJournal[] =>
  useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => journals,
    () => journals
  );
export const readManualJournals = (): ManualJournal[] => journals;

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
const on = (id: string, fn: (j: ManualJournal) => ManualJournal) => write(list => list.map(j => (j.id === id ? fn(j) : j)));

export function createManualJournal(name: string, broker?: string): string {
  const id = newId('m');
  write(list => [...list, { id, name: name.trim().slice(0, 60) || 'My journal', broker: broker?.trim().slice(0, 60) || undefined, createdAt: Date.now(), days: {}, trades: [] }]);
  return id;
}
export const renameManualJournal = (id: string, name: string, broker?: string) => on(id, j => ({ ...j, name: name.trim().slice(0, 60) || j.name, broker: broker?.trim().slice(0, 60) || undefined }));
export const deleteManualJournal = (id: string) => write(list => list.filter(j => j.id !== id));

/** Drop the fields left blank, so a figure left blank is added up from the trades */
const tidyDay = (d: ManualDay): ManualDay => {
  const out: ManualDay = {};
  for (const k of ['pnl', 'fees'] as const) if (d[k] != null && Number.isFinite(d[k])) out[k] = cents(d[k]!);
  for (const k of ['trades', 'wins', 'losses'] as const) if (d[k] != null && Number.isFinite(d[k])) out[k] = Math.max(0, Math.round(d[k]!));
  if (d.notes?.trim()) out.notes = d.notes.trim().slice(0, 2000);
  const tags = (d.tags ?? []).map(t => t.trim()).filter(Boolean);
  if (tags.length) out.tags = [...new Set(tags)].slice(0, 12);
  return out;
};
/** A day's entry, replaced whole; an empty one is taken out */
export const setManualDay = (id: string, day: string, d: ManualDay) =>
  ISO_DAY.test(day) &&
  on(id, j => {
    const t = tidyDay(d);
    const days = { ...j.days };
    if (Object.keys(t).length) days[day] = t;
    else delete days[day];
    return { ...j, days };
  });
export const deleteManualDay = (id: string, day: string) =>
  on(id, j => {
    const days = { ...j.days };
    delete days[day];
    return { ...j, days, trades: j.trades.filter(t => t.day !== day) };
  });
export const addManualTrade = (id: string, t: ManualTradeIn) => ISO_DAY.test(t.day) && on(id, j => ({ ...j, trades: [...j.trades, { ...t, id: newId('t') }] }));
export const deleteManualTrade = (id: string, tradeId: string) => on(id, j => ({ ...j, trades: j.trades.filter(t => t.id !== tradeId) }));

const tradeKey = (t: ManualTradeIn) => [t.day, t.time ?? '', t.ticker, t.contract ?? '', t.side, t.qty ?? '', t.entry ?? '', t.exit ?? '', t.pnl].join('|');
/** What an import would do to a journal: days replaced (the day's notes and tags kept where the file has none), trades
    added — a trade already in the journal, field for field, is not added twice */
export function importInto(j: ManualJournal, read: CsvRead): { journal: ManualJournal; daysNew: number; daysReplaced: number; tradesAdded: number; tradesSkipped: number } {
  const days = { ...j.days };
  let daysNew = 0;
  let daysReplaced = 0;
  for (const { day, entry } of read.days) {
    const was = days[day];
    if (was) daysReplaced++;
    else daysNew++;
    days[day] = tidyDay({ ...entry, notes: entry.notes ?? was?.notes, tags: entry.tags ?? was?.tags });
  }
  const have = new Set(j.trades.map(tradeKey));
  const trades = [...j.trades];
  let tradesAdded = 0;
  let tradesSkipped = 0;
  read.trades.forEach((t, i) => {
    const k = tradeKey(t);
    if (have.has(k)) {
      tradesSkipped++;
      return;
    }
    have.add(k);
    trades.push({ ...t, id: `${newId('t')}${i}` });
    tradesAdded++;
  });
  return { journal: { ...j, days, trades }, daysNew, daysReplaced, tradesAdded, tradesSkipped };
}
export function importManual(id: string, read: CsvRead): ReturnType<typeof importInto> | null {
  const j = load().find(x => x.id === id);
  if (!j) return null;
  const res = importInto(j, read);
  write(list => list.map(x => (x.id === id ? res.journal : x)));
  return res;
}
/** A journal put back whole, where it stood (or at the end) — what an Undo hands back */
export const putManualJournal = (j: ManualJournal, at?: number) =>
  write(list => {
    const rest = list.filter(x => x.id !== j.id);
    const i = at == null ? rest.length : Math.max(0, Math.min(at, rest.length));
    return [...rest.slice(0, i), j, ...rest.slice(i)];
  });
/** A trade's P&L before fees from its prices: (exit − entry) × qty × multiplier, turned over for a short — the
    multiplier 100 for a named contract, 1 for shares, unless given */
export const tradePnlOf = (side: ManualSide, qty: number, entry: number, exit: number, contract?: string, multiplier?: number): number => cents((exit - entry) * qty * (multiplier ?? (contract?.trim() ? 100 : 1)) * (side === 'short' ? -1 : 1));
