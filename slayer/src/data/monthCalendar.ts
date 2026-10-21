/*
==================================================
  SLAYER TERMINAL - THE MONTH ON THE RECORD
  (data/monthCalendar.ts)

  The Day's calendar as a MONTH (the partner's
  copy, ported 2026-09-13 — Noah: "i love it. i
  want that as well"): every day of a month with
  what prints on it — the macro releases on their
  usual schedule (CPI in the second week, the jobs
  report on the first Friday, FOMC on its
  Wednesday, the weekly claims every Thursday, the
  month-end GDP and PCE, monthly expiration on the
  third Friday) and the earnings reports the
  calendar names — the same reporters
  data/earnings.ts lists for the next two weeks,
  and a seeded pick of the rest of the universe
  across the month.

  Deterministic per month, so a day reads the same
  every time it is opened. Forecasts and previous
  readings are seeded the way the econ calendar's
  are. A SEAM: the feed's own calendar replaces the
  rules at launch, the shape stays.
==================================================
*/

import { h01 } from '../core/rng';
import { now } from '../core/clock';
import { UNIVERSE } from './universe';
import { buildEarningsCalendar, type ReportSlot } from './earnings';

export type CalImpact = 'high' | 'medium' | 'low';
export type CalKind = 'macro' | 'earnings' | 'market' | 'fda' | 'ipo' | 'schedule' | 'post';

export interface CalEvent {
  id: string;
  kind: CalKind;
  date: Date;
  /** "08:30" — New York; an earnings report says its slot in words */
  time: string;
  title: string;
  impact: CalImpact;
  region?: string;
  forecast?: string;
  previous?: string;
  /** Earnings: the name and its slot */
  ticker?: string;
  slot?: ReportSlot;
  confirmed?: boolean;
  impliedMovePct?: number;
  /** FDA and IPO: the one line under the title */
  note?: string;
}

export interface CalDay {
  date: Date;
  key: string;
  inMonth: boolean;
  today: boolean;
  weekend: boolean;
  events: CalEvent[];
}

export interface MonthCalendar {
  year: number;
  month: number;
  label: string;
  weeks: CalDay[][];
  events: CalEvent[];
}

export const dayKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (h: number, m = 0) => `${pad(h)}:${pad(m)}`;

/** The nth weekday of a month: nth 1.. of weekday 0..6 */
const nthWeekday = (year: number, month: number, weekday: number, nth: number): Date => {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (nth - 1) * 7);
};
/** The last weekday of a month */
const lastWeekday = (year: number, month: number, weekday: number): Date => {
  const last = new Date(year, month + 1, 0);
  const back = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - back);
};
/** The first business day on or after the date */
const businessOnOrAfter = (d: Date): Date => {
  const out = new Date(d);
  while (out.getDay() === 0 || out.getDay() === 6) out.setDate(out.getDate() + 1);
  return out;
};
/** The nth business day of a month */
const nthBusinessDay = (year: number, month: number, n: number): Date => {
  const d = new Date(year, month, 1);
  let count = 0;
  for (;;) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      count++;
      if (count === n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
};

/** FOMC decision months — eight a year, the Fed's own rhythm */
const FOMC_MONTHS = new Set([0, 2, 4, 5, 6, 8, 10, 11]);
/** ECB decision months — every six weeks or so */
const ECB_MONTHS = new Set([0, 2, 3, 5, 6, 8, 9, 11]);

interface MacroRule {
  title: string;
  region: string;
  impact: CalImpact;
  hour: number;
  minute?: number;
  unit?: '%' | 'K' | 'M' | '';
  base?: number;
  /** Where in the month it lands */
  when: (year: number, month: number) => Date | Date[] | null;
}

const RULES: MacroRule[] = [
  { title: 'ISM manufacturing PMI', region: 'USD', impact: 'high', hour: 10, unit: '', base: 48.9, when: (y, m) => nthBusinessDay(y, m, 1) },
  { title: 'JOLTS job openings', region: 'USD', impact: 'medium', hour: 10, unit: 'M', base: 7.7, when: (y, m) => nthBusinessDay(y, m, 2) },
  { title: 'ISM services PMI', region: 'USD', impact: 'high', hour: 10, unit: '', base: 52.1, when: (y, m) => nthBusinessDay(y, m, 3) },
  { title: 'Nonfarm payrolls', region: 'USD', impact: 'high', hour: 8, minute: 30, unit: 'K', base: 178, when: (y, m) => nthWeekday(y, m, 5, 1) },
  { title: 'Unemployment rate', region: 'USD', impact: 'high', hour: 8, minute: 30, unit: '%', base: 4.2, when: (y, m) => nthWeekday(y, m, 5, 1) },
  { title: 'Initial jobless claims', region: 'USD', impact: 'medium', hour: 8, minute: 30, unit: 'K', base: 232, when: (y, m) => [1, 2, 3, 4, 5].map(n => nthWeekday(y, m, 4, n)).filter(d => d.getMonth() === m) },
  { title: 'CPI y/y', region: 'USD', impact: 'high', hour: 8, minute: 30, unit: '%', base: 2.5, when: (y, m) => businessOnOrAfter(new Date(y, m, 11)) },
  { title: 'Core CPI m/m', region: 'USD', impact: 'high', hour: 8, minute: 30, unit: '%', base: 0.3, when: (y, m) => businessOnOrAfter(new Date(y, m, 11)) },
  { title: 'PPI m/m', region: 'USD', impact: 'medium', hour: 8, minute: 30, unit: '%', base: 0.2, when: (y, m) => businessOnOrAfter(new Date(y, m, 12)) },
  { title: 'Retail sales m/m', region: 'USD', impact: 'high', hour: 8, minute: 30, unit: '%', base: 0.4, when: (y, m) => businessOnOrAfter(new Date(y, m, 15)) },
  { title: 'Consumer sentiment (prelim)', region: 'USD', impact: 'medium', hour: 10, unit: '', base: 66.4, when: (y, m) => nthWeekday(y, m, 5, 2) },
  { title: 'Housing starts', region: 'USD', impact: 'low', hour: 8, minute: 30, unit: 'M', base: 1.36, when: (y, m) => businessOnOrAfter(new Date(y, m, 17)) },
  { title: 'FOMC rate decision', region: 'USD', impact: 'high', hour: 14, unit: '%', base: 4.5, when: (y, m) => (FOMC_MONTHS.has(m) ? nthWeekday(y, m, 3, 3) : null) },
  { title: 'Fed press conference', region: 'USD', impact: 'high', hour: 14, minute: 30, when: (y, m) => (FOMC_MONTHS.has(m) ? nthWeekday(y, m, 3, 3) : null) },
  { title: 'FOMC meeting minutes', region: 'USD', impact: 'medium', hour: 14, when: (y, m) => (FOMC_MONTHS.has(m) ? null : nthWeekday(y, m, 3, 2)) },
  { title: 'Treasury 10-yr auction', region: 'USD', impact: 'low', hour: 13, when: (y, m) => nthWeekday(y, m, 3, 2) },
  { title: 'Existing home sales', region: 'USD', impact: 'low', hour: 10, unit: 'M', base: 4.06, when: (y, m) => businessOnOrAfter(new Date(y, m, 22)) },
  { title: 'Durable goods m/m', region: 'USD', impact: 'medium', hour: 8, minute: 30, unit: '%', base: 0.5, when: (y, m) => businessOnOrAfter(new Date(y, m, 25)) },
  { title: 'GDP q/q (advance)', region: 'USD', impact: 'high', hour: 8, minute: 30, unit: '%', base: 2.4, when: (y, m) => lastWeekday(y, m, 4) },
  { title: 'Core PCE m/m', region: 'USD', impact: 'high', hour: 8, minute: 30, unit: '%', base: 0.2, when: (y, m) => lastWeekday(y, m, 5) },
  { title: 'Consumer sentiment (final)', region: 'USD', impact: 'low', hour: 10, unit: '', base: 66.9, when: (y, m) => lastWeekday(y, m, 5) },
  { title: 'ECB rate decision', region: 'EUR', impact: 'high', hour: 8, minute: 15, unit: '%', base: 2.0, when: (y, m) => (ECB_MONTHS.has(m) ? nthWeekday(y, m, 4, 2) : null) },
  { title: 'Eurozone CPI flash y/y', region: 'EUR', impact: 'medium', hour: 5, unit: '%', base: 2.1, when: (y, m) => lastWeekday(y, m, 2) },
  { title: 'German ifo business climate', region: 'EUR', impact: 'medium', hour: 4, unit: '', base: 87.1, when: (y, m) => businessOnOrAfter(new Date(y, m, 24)) },
  { title: 'UK CPI y/y', region: 'GBP', impact: 'medium', hour: 2, unit: '%', base: 3.4, when: (y, m) => nthWeekday(y, m, 3, 3) },
  { title: 'BOE rate decision', region: 'GBP', impact: 'medium', hour: 7, unit: '%', base: 4.0, when: (y, m) => (m % 3 === 1 || m % 3 === 2 ? nthWeekday(y, m, 4, 1) : null) },
  { title: 'BOJ rate decision', region: 'JPY', impact: 'high', hour: 23, unit: '%', base: 0.5, when: (y, m) => (m % 2 === 0 ? nthWeekday(y, m, 5, 3) : null) },
  { title: 'China Caixin PMI', region: 'CNY', impact: 'high', hour: 21, minute: 45, unit: '', base: 50.4, when: (y, m) => nthBusinessDay(y, m, 1) },
  { title: 'China CPI y/y', region: 'CNY', impact: 'medium', hour: 21, minute: 30, unit: '%', base: 0.1, when: (y, m) => businessOnOrAfter(new Date(y, m, 9)) },
  { title: 'RBA meeting minutes', region: 'AUD', impact: 'low', hour: 21, minute: 30, when: (y, m) => nthWeekday(y, m, 2, 3) },
];

const fmtUnit = (v: number, unit?: string) => (unit === 'K' ? `${Math.round(v)}K` : unit === 'M' ? `${v.toFixed(2)}M` : unit === '%' ? `${v.toFixed(1)}%` : v.toFixed(1));

/** Every macro print of the month, and the market's own dates */
function macroEvents(year: number, month: number): CalEvent[] {
  const out: CalEvent[] = [];
  RULES.forEach((r, i) => {
    const w = r.when(year, month);
    const dates = w == null ? [] : Array.isArray(w) ? w : [w];
    dates.forEach((d, k) => {
      if (d.getMonth() !== month) return;
      const seed = `${year}-${month}-${i}-${k}`;
      const h = h01(seed);
      const prev = r.base;
      const fcst = r.base != null ? r.base * (1 + (h - 0.5) * 0.06) : undefined;
      out.push({
        id: `macro-${seed}`,
        kind: 'macro',
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), r.hour, r.minute ?? 0),
        time: hhmm(r.hour, r.minute ?? 0),
        title: r.title,
        impact: r.impact,
        region: r.region,
        forecast: fcst != null ? fmtUnit(fcst, r.unit) : undefined,
        previous: prev != null ? fmtUnit(prev, r.unit) : undefined,
      });
    });
  });
  const opex = nthWeekday(year, month, 5, 3);
  out.push({ id: `market-opex-${year}-${month}`, kind: 'market', date: new Date(year, month, opex.getDate(), 16, 0), time: '16:00', title: 'Monthly options expiration', impact: 'medium', region: 'USD' });
  const lastDay = new Date(year, month + 1, 0);
  const eom = lastDay.getDay() === 0 ? new Date(year, month, lastDay.getDate() - 2) : lastDay.getDay() === 6 ? new Date(year, month, lastDay.getDate() - 1) : lastDay;
  out.push({ id: `market-eom-${year}-${month}`, kind: 'market', date: new Date(year, month, eom.getDate(), 16, 0), time: '16:00', title: 'Month-end rebalancing', impact: 'low', region: 'USD' });
  return out;
}

/** FDA dates, the public schedule, the posts, and the day's real
    catalysts come from the live calendar. IPOs stay seeded — that
    route is not in this batch. Until a feed answers, that kind is
    simply absent, rather than a made-up pair. */
let liveFda: CalEvent[] = [];
let liveSchedule: CalEvent[] = [];
let livePosts: CalEvent[] = [];
let liveCatalysts: CalEvent[] = [];
let fdaRev = 0;
const fdaListeners = new Set<() => void>();

function bumpCalendar(): void {
  fdaRev += 1;
  fdaListeners.forEach(fn => fn());
}

export function setLiveFda(events: CalEvent[]): void {
  liveFda = events;
  bumpCalendar();
}

export function setLiveSchedule(events: CalEvent[]): void {
  liveSchedule = events;
  bumpCalendar();
}

export function setLivePosts(events: CalEvent[]): void {
  livePosts = events;
  bumpCalendar();
}

/** Econ lands on Data, earnings on Earnings — the day's own prints,
    in place of the seeded ones on any day the feed actually names. */
export function setLiveCatalysts(events: CalEvent[]): void {
  liveCatalysts = events;
  bumpCalendar();
}

export function fdaStamp(): number {
  return fdaRev;
}

export function subscribeFda(fn: () => void): () => void {
  fdaListeners.add(fn);
  return () => fdaListeners.delete(fn);
}

const IPO_DATES: { name: string; detail: string }[] = [
  { name: 'Northline', detail: 'Priced range $18–21 · NYSE' },
  { name: 'Harbor Grid', detail: 'Expected to open · Nasdaq' },
  { name: 'Kindling Health', detail: 'Priced range $14–16 · Nasdaq' },
  { name: 'Lowcountry Freight', detail: 'Expected to open · NYSE' },
];

function fileEvents(year: number, month: number): CalEvent[] {
  const out: CalEvent[] = liveFda.filter(e => e.date.getFullYear() === year && e.date.getMonth() === month);
  const ipos = [...IPO_DATES].sort((a, b) => h01(`${year}-${month}-ipo-${a.name}`) - h01(`${year}-${month}-ipo-${b.name}`));
  const count = h01(`${year}-${month}-ipo-n`) > 0.45 ? 2 : 1;
  ipos.slice(0, count).forEach((d, i) => {
    const day = businessOnOrAfter(new Date(year, month, 16 + i * 7));
    out.push({
      id: `ipo-${d.name}-${year}-${month}`,
      kind: 'ipo',
      date: new Date(year, month, day.getDate(), 9, 30),
      time: '09:30',
      title: d.name,
      impact: 'medium',
      region: 'USD',
      note: d.detail,
    });
  });
  return out;
}

/** The earnings of the month: the calendar's own reporters for the next two
    weeks (with their dates), and a seeded pick of the rest of the universe
    on the month's weekdays — a name reports once a quarter, so a third of
    the universe lands in any given month */
function earningsEvents(year: number, month: number): CalEvent[] {
  const out: CalEvent[] = [];
  const taken = new Set<string>();
  const t0 = now();
  for (const e of buildEarningsCalendar()) {
    const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
    let sessions = e.daysOut;
    while (sessions > 0) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) sessions--;
    }
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    taken.add(e.ticker);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    out.push({
      id: `er-${e.ticker}-${dayKeyOf(d)}`,
      kind: 'earnings',
      date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), e.slot === 'BMO' ? 7 : 16, e.slot === 'BMO' ? 0 : 5),
      time: e.slot === 'BMO' ? 'before the open' : 'after the close',
      title: `${e.ticker} reports`,
      impact: e.impliedMovePct >= 7 ? 'high' : e.impliedMovePct >= 4 ? 'medium' : 'low',
      ticker: e.ticker,
      slot: e.slot,
      confirmed: e.confirmed,
      impliedMovePct: e.impliedMovePct,
    });
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (const u of UNIVERSE) {
    if (taken.has(u.ticker)) continue;
    const seed = `${u.ticker}-${year}-${month}-er-month`;
    if (h01(seed) > 0.34) continue;
    let day = 1 + Math.floor(h01(`${seed}-day`) * daysInMonth);
    let d = new Date(year, month, day);
    while (d.getDay() === 0 || d.getDay() === 6) {
      day = day >= daysInMonth ? 1 : day + 1;
      d = new Date(year, month, day);
    }
    const slot: ReportSlot = h01(`${seed}-slot`) > 0.45 ? 'AMC' : 'BMO';
    const implied = 2.5 + h01(`${seed}-move`) * 8;
    out.push({
      id: `er-${u.ticker}-${dayKeyOf(d)}`,
      kind: 'earnings',
      date: new Date(year, month, day, slot === 'BMO' ? 7 : 16, slot === 'BMO' ? 0 : 5),
      time: slot === 'BMO' ? 'before the open' : 'after the close',
      title: `${u.ticker} reports`,
      impact: implied >= 7 ? 'high' : implied >= 4 ? 'medium' : 'low',
      ticker: u.ticker,
      slot,
      confirmed: h01(`${seed}-confirm`) < 0.6,
      impliedMovePct: implied,
    });
  }
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month as weeks of days, Sunday first, every event on its day */
export function buildMonthCalendar(year: number, month: number): MonthCalendar {
  const today = now();
  const inMonth = (e: CalEvent) => e.date.getFullYear() === year && e.date.getMonth() === month;
  const bare = (s: string) => s.split(' · ')[0].trim().toLowerCase();
  const liveMacroTitles = new Set(liveCatalysts.filter(e => e.kind === 'macro' && inMonth(e)).map(e => bare(e.title)));
  const macros = macroEvents(year, month).filter(e => !liveMacroTitles.has(bare(e.title)));
  const liveEarnDays = new Set(liveCatalysts.filter(e => e.kind === 'earnings' && inMonth(e)).map(e => dayKeyOf(e.date)));
  const earn = earningsEvents(year, month).filter(e => !liveEarnDays.has(dayKeyOf(e.date)));
  const events = [...macros, ...earn, ...liveCatalysts.filter(inMonth), ...fileEvents(year, month), ...liveSchedule.filter(inMonth), ...livePosts.filter(inMonth)].sort((a, b) => a.date.getTime() - b.date.getTime());
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    const k = dayKeyOf(e.date);
    const list = byDay.get(k);
    if (list) list.push(e);
    else byDay.set(k, [e]);
  }
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks: CalDay[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: CalDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor);
      week.push({ date: d, key: dayKeyOf(d), inMonth: d.getMonth() === month, today: sameDay(d, today), weekend: d.getDay() === 0 || d.getDay() === 6, events: byDay.get(dayKeyOf(d)) ?? [] });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    /* five weeks when the sixth would be all next month */
    if (w >= 4 && cursor.getMonth() !== month && cursor.getDate() > 7) break;
  }
  return { year, month, label: `${MONTHS[month]} ${year}`, weeks, events };
}
