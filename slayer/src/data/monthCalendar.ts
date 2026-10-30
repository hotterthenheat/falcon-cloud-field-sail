/* The day's calendar as a month, all off the vendor: the economic calendar, the catalysts, the earnings fortnight, the
   FDA calendar, the schedule and the posts; monthly expiration (third Friday) is the one date known by rule. */

import { createStore } from './feedStore';
import { type ReportSlot } from './earnings';
import { nyTodayIso } from './nyDate';
import { uwCall } from './whales';
import { econImpact } from './econImpact';

export type CalImpact = 'high' | 'medium' | 'low';
export type CalKind = 'macro' | 'earnings' | 'market' | 'fda' | 'schedule' | 'post';

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
  /** Earnings: false when the vendor has no time for the report ("time not set") */
  timeKnown?: boolean;
  /** Earnings: the print is out, and the move its reacting session made (or is making — moveLive) */
  reported?: boolean;
  movePct?: number | null;
  moveLive?: boolean;
  /** Earnings: the session that reacts to the print, YYYY-MM-DD */
  reactionIso?: string;
  /** Earnings: named only by the vendor's daily catalysts, not on its earnings lists */
  catalystOnly?: boolean;
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

interface MonthCalendar {
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

/** New York's wall clock for an instant: the calendar draws every date on New York's day */
const nyParts = (iso: string): { y: number; m: number; d: number; hh: number; mm: number } | null => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find(p => p.type === k)?.value);
  const hh = get('hour') % 24;
  return { y: get('year'), m: get('month') - 1, d: get('day'), hh, mm: get('minute') };
};

/** The vendor's economic calendar (/market/economic-calendar — the current week), read once a session */
let liveEcon: CalEvent[] = [];
let econStarted = false;

function ensureEcon(): void {
  if (econStarted || typeof window === 'undefined') return;
  econStarted = true;
  void uwCall('/market/economic-calendar').then(res => {
    const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    const out: CalEvent[] = [];
    /* one row per release: the vendor repeats each at the same minute; the copy with the forecast and prior is kept */
    const byKey = new Map<string, CalEvent>();
    rows.forEach(r => {
      const at = nyParts(String(r.time ?? ''));
      const title = String(r.event ?? '').trim();
      if (!at || !title) return;
      const period = String(r.reported_period ?? '').trim();
      const key = `${Date.parse(String(r.time))}|${title.toLowerCase()}|${period.toLowerCase()}`;
      const had = byKey.get(key);
      if (had) {
        if (!had.forecast && r.forecast != null && String(r.forecast) !== '') had.forecast = String(r.forecast);
        if (!had.previous && r.prev != null && String(r.prev) !== '') had.previous = String(r.prev);
        return;
      }
      const ev: CalEvent = {
        id: `macro-econ-${key}`,
        kind: 'macro',
        date: new Date(at.y, at.m, at.d, at.hh, at.mm),
        time: hhmm(at.hh, at.mm),
        title: period ? `${title} · ${period}` : title,
        impact: econImpact(title),
        region: 'USD',
        forecast: r.forecast != null && String(r.forecast) !== '' ? String(r.forecast) : undefined,
        previous: r.prev != null && String(r.prev) !== '' ? String(r.prev) : undefined,
      };
      byKey.set(key, ev);
      out.push(ev);
    });
    liveEcon = out;
    bumpCalendar();
  });
}

/** The market's own fixed date: monthly options expiration, the third Friday */
function marketEvents(year: number, month: number): CalEvent[] {
  const opex = nthWeekday(year, month, 5, 3);
  return [{ id: `market-opex-${year}-${month}`, kind: 'market', date: new Date(year, month, opex.getDate(), 16, 0), time: '16:00', title: 'Monthly options expiration', impact: 'medium', region: 'USD' }];
}

/** FDA dates, the public schedule, the posts, the economic calendar, the earnings and the day's catalysts all come
    from Unusual Whales. Until a feed answers, that kind is simply absent — nothing is seeded. */
let liveFda: CalEvent[] = [];
let liveSchedule: CalEvent[] = [];
let livePosts: CalEvent[] = [];
let liveCatalysts: CalEvent[] = [];
let liveEarnings: CalEvent[] = [];
const calendarStore = createStore(0);

function bumpCalendar(): void {
  calendarStore.set(n => n + 1);
}

export function setLiveFda(events: CalEvent[]): void {
  liveFda = events;
  bumpCalendar();
}

/** The economic calendar. High-impact releases block a new ticket. Loaded once a session. */
export function econReleases(): readonly CalEvent[] {
  ensureEcon();
  return liveEcon;
}

export function setLiveSchedule(events: CalEvent[]): void {
  liveSchedule = events;
  bumpCalendar();
}

export function setLivePosts(events: CalEvent[]): void {
  livePosts = events;
  bumpCalendar();
}

/** The day's own prints off the feed: econ on Data, earnings on Earnings */
export function setLiveCatalysts(events: CalEvent[]): void {
  liveCatalysts = events;
  bumpCalendar();
}

/** The earnings fortnight off the vendor's premarket and after-hours calendars (data/earningsFeed.ts) — the same
    reports the Earnings page lists, so a name carries one date everywhere */
export function setLiveEarnings(events: CalEvent[]): void {
  liveEarnings = events;
  bumpCalendar();
}

export function fdaStamp(): number {
  return calendarStore.get();
}

export function subscribeFda(fn: () => void): () => void {
  return calendarStore.subscribe(fn);
}

function fileEvents(year: number, month: number): CalEvent[] {
  return liveFda.filter(e => e.date.getFullYear() === year && e.date.getMonth() === month);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month as weeks of days, Sunday first, every event on its day */
export function buildMonthCalendar(year: number, month: number): MonthCalendar {
  const [ty, tm, td] = nyTodayIso().split('-').map(Number);
  const today = new Date(ty, tm - 1, td);
  const inMonth = (e: CalEvent) => e.date.getFullYear() === year && e.date.getMonth() === month;
  ensureEcon();
  const bare = (s: string) => s.split(' · ')[0].trim().toLowerCase();
  /* the day's catalysts and the week's calendar overlap — one release, once */
  const catalystMacro = liveCatalysts.filter(e => e.kind === 'macro' && inMonth(e));
  const seenMacro = new Set(catalystMacro.map(e => `${dayKeyOf(e.date)}|${bare(e.title)}`));
  const econ = liveEcon.filter(e => inMonth(e) && !seenMacro.has(`${dayKeyOf(e.date)}|${bare(e.title)}`));
  /* The earnings lists are the source of truth; a name only the daily catalysts carry is added after them, time not set
     unless the catalyst says it, never "confirmed". */
  const earn = liveEarnings.filter(inMonth);
  const seenEarn = new Set(earn.map(e => `${dayKeyOf(e.date)}|${e.ticker}`));
  const catalystEarn = liveCatalysts.filter(e => e.kind === 'earnings' && inMonth(e) && !seenEarn.has(`${dayKeyOf(e.date)}|${e.ticker}`));
  const others = liveCatalysts.filter(e => inMonth(e) && e.kind !== 'macro' && e.kind !== 'earnings');
  const events = [...marketEvents(year, month), ...econ, ...catalystMacro, ...earn, ...catalystEarn, ...others, ...fileEvents(year, month), ...liveSchedule.filter(inMonth), ...livePosts.filter(inMonth)].sort((a, b) => a.date.getTime() - b.date.getTime());
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
