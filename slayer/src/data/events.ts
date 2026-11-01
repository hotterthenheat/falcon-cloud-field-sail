import { RTH_MINUTES, isTradingDay } from '../core/calendar';
import { sessionStarts } from './indicators';
import type { EarningsEvent } from './earnings';
import type { Candle } from '../types/market';
import type { FlowPrint } from '../types/trace';
import { primaryOf, TYPE_WORDS, type OptionTags } from './printTags';

/* Markers along the tape's bottom edge: this name's next earnings (BMO at the open, AMC at the close), FOMC/CPI/NFP, and the session's
   largest prints. Past events carry a bar time, future ones trading minutes ahead (the cone's arithmetic). FOMC is the Fed's 2026 calendar; NFP first Friday; CPI approximated (second Wednesday, said so). */

export type MarketEventKind = 'earnings' | 'macro' | 'print';

export interface MarketEvent {
  kind: MarketEventKind;
  /** The card's first line. */
  label: string;
  /** The card's second line — basis, sizes, caveats. */
  detail: string;
  /** Bar-anchored time — events already on the tape. */
  time?: number;
  /** Trading minutes past the last bar — events still ahead. */
  minutesAhead?: number;
  /** Prints only: which right, for the glyph's SHAPE (never its colour). */
  side?: 'C' | 'P';
  /** Prints only: a leg of a spread — half of a structure, not a bet — drawn hollow */
  hollow?: boolean;
}

/** Below this premium a print is tape texture, not an event. */
const PRINT_PREMIUM_FLOOR = 1_000_000;
/** The largest N prints get marks — a busy session over the floor is still
    a readable tape, not a picket fence. */
const PRINT_CAP = 12;

export interface MacroDate {
  iso: string; // YYYY-MM-DD, real calendar
  label: string;
  detail: string;
}

/* The Fed's published 2026 meeting calendar — decision days. */
const FOMC_2026 = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'];

const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** First Friday of a month — the NFP rule. */
function firstFriday(year: number, month0: number): string {
  const d = new Date(year, month0, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return isoOf(d);
}

/** Second Wednesday — the CPI approximation (see the header). */
function secondWednesday(year: number, month0: number): string {
  const d = new Date(year, month0, 1);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7);
  return isoOf(d);
}

/** The macro calendar inside a ± window around `today`, real dates. */
export function macroWindow(today: Date, daysBack = 45, daysAhead = 45): MacroDate[] {
  const lo = new Date(today);
  lo.setDate(lo.getDate() - daysBack);
  const hi = new Date(today);
  hi.setDate(hi.getDate() + daysAhead);
  const inWindow = (iso: string) => iso >= isoOf(lo) && iso <= isoOf(hi);

  const out: MacroDate[] = [];
  for (const iso of FOMC_2026) {
    if (inWindow(iso)) out.push({ iso, label: 'FOMC decision', detail: `${iso} · rate decision & presser` });
  }
  for (let m = -2; m <= 2; m++) {
    const d = new Date(today.getFullYear(), today.getMonth() + m, 1);
    const nfp = firstFriday(d.getFullYear(), d.getMonth());
    if (inWindow(nfp)) out.push({ iso: nfp, label: 'NFP release', detail: `${nfp} · payrolls, first Friday` });
    const cpi = secondWednesday(d.getFullYear(), d.getMonth());
    if (inWindow(cpi)) out.push({ iso: cpi, label: 'CPI release', detail: `${cpi} · approximated — exact BLS date arrives with the calendar feed` });
  }
  return out.sort((a, b) => (a.iso < b.iso ? -1 : 1));
}

/** Signed trading-day distance from `fromIso` to `toIso` (negative = past). */
function tradingDaysSigned(fromIso: string, toIso: string): number {
  const parse = (iso: string) => new Date(`${iso}T12:00:00`);
  const a = parse(fromIso < toIso ? fromIso : toIso);
  const b = parse(fromIso < toIso ? toIso : fromIso);
  let n = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setDate(cur.getDate() + 1);
    if (isTradingDay(cur)) n++;
  }
  return fromIso <= toIso ? n : -n;
}

interface TapeEventsInput {
  /** 1-minute base bars, oldest first. */
  bars: readonly Candle[];
  /** The session's option prints, stamped with their bar time. */
  prints: readonly (FlowPrint & { at: number })[];
  /** This name's next report, or null. */
  earnings: EarningsEvent | null;
  macro: readonly MacroDate[];
  /** Real calendar "today", ISO — injected, so the engine reads no clock. */
  todayIso: string;
}

/** Every marker, past ones first by time, then future ones by minutes ahead. */
export function buildTapeEvents(input: TapeEventsInput): MarketEvent[] {
  const { bars, prints, earnings, macro, todayIso } = input;
  if (bars.length === 0) return [];
  const starts = sessionStarts(bars, 1);
  const todayStart = bars[starts[starts.length - 1]].time;
  const last = bars[bars.length - 1];
  /* Through the last bar — a bar covers its interval (the cone's rule). */
  const elapsed = (last.time - todayStart) / 60 + 1;

  /* Minute m of the session k sessions ahead, as trading minutes past the
     last bar. k = 0 is today. */
  const aheadAt = (k: number, m: number): number => (k === 0 ? m - elapsed : RTH_MINUTES - elapsed + (k - 1) * RTH_MINUTES + m);

  const past: MarketEvent[] = [];
  const future: MarketEvent[] = [];
  const place = (e: Omit<MarketEvent, 'time' | 'minutesAhead'>, k: number, m: number) => {
    const ahead = aheadAt(k, m);
    if (ahead > 0) {
      future.push({ ...e, minutesAhead: ahead });
      return;
    }
    /* Already on the tape: k sessions back, m minutes in; dropped if it predates the buffer. */
    const t = todayStart + k * 86400 + m * 60;
    if (t >= bars[0].time && t <= last.time) past.push({ ...e, time: t });
  };

  if (earnings) {
    const m = earnings.slot === 'AMC' ? RTH_MINUTES : 0;
    place(
      {
        kind: 'earnings',
        label: `${earnings.ticker} earnings · ${earnings.slot}`,
        detail: `${earnings.confirmed ? 'confirmed' : 'estimated'} · options price ±${earnings.impliedMovePct.toFixed(1)}% vs ±${earnings.histAvgMovePct.toFixed(1)}% typical`,
      },
      earnings.daysOut,
      m
    );
  }

  for (const ev of macro) {
    const k = tradingDaysSigned(todayIso, ev.iso);
    place({ kind: 'macro', label: ev.label, detail: ev.detail }, k, 0);
  }

  const big = prints
    .filter(p => p.premium >= PRINT_PREMIUM_FLOOR && p.at >= bars[0].time && p.at <= last.time)
    .sort((a, b) => b.premium - a.premium)
    .slice(0, PRINT_CAP);
  for (const p of big) {
    /* a print off the server's tape names its type and the side it took */
    const tags = (p as FlowPrint & { tapeTags?: OptionTags }).tapeTags;
    const type = tags ? primaryOf(tags) : null;
    const took = p.side === 'ASK' ? 'bought' : p.side === 'BID' ? 'sold' : 'no side';
    past.push({
      kind: 'print',
      side: p.right,
      time: p.at,
      hollow: type === 'leg',
      label: `$${(p.premium / 1e6).toFixed(1)}M ${p.right === 'C' ? 'call' : 'put'} ${type ? TYPE_WORDS[type].one : 'print'}`,
      detail: tags
        ? `${p.size.toLocaleString()}× ${p.strike} ${p.right} · ${p.dte}dte · ${took}${tags.floor && type !== 'floor' ? ' · floor' : ''}${tags.sweep && type !== 'sweep' ? ' · swept' : ''}`
        : `${p.size.toLocaleString()}× ${p.strike} ${p.right} · ${p.dte}dte · ${p.side} side`,
    });
  }

  past.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  future.sort((a, b) => (a.minutesAhead ?? 0) - (b.minutesAhead ?? 0));
  return [...past, ...future];
}

