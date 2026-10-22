/*
  The earnings calendar off Unusual Whales. A miss or an empty fortnight
  stays empty — never a sample of invented names.
*/

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Sector } from './universe';
import { lookup } from './universe';
import { decide, isKnownName, type ActiveContract, type EarningsDossier, type EarningsEvent, type EarningsQuarter, type NextReport, type ReportSlot } from './earnings';
import { tickerName } from './tickers';
import { MARKET_HOLIDAYS } from '../core/calendar';
import { uwCall, whalesEarnings, whalesEarningsSlot, whalesIvRank, whalesOptionContracts, whalesScreener } from './whales';

interface SlotRow {
  symbol?: string;
  full_name?: string;
  sector?: string;
  is_s_p_500?: boolean;
  marketcap?: string | number | null;
  report_date?: string;
  report_time?: string;
  source?: string;
  expected_move?: string | number | null;
  expected_move_perc?: string | number | null;
  pre_earnings_close?: string | number | null;
  post_earnings_close?: string | number | null;
  street_mean_est?: string | number | null;
  actual_eps?: string | number | null;
  post_earnings_move_1d?: string | number | null;
  ending_fiscal_quarter?: string | null;
  long_straddle_1d?: string | number | null;
  /** The 1-day move after the report, a fraction (the spec's `reaction`) */
  reaction?: string | number | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const nyToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const nyMinutesNow = (): number => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return Number(p.find(x => x.type === 'hour')?.value ?? 0) * 60 + Number(p.find(x => x.type === 'minute')?.value ?? 0);
};

const parseIso = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};

const isoOf = (d: Date): string => d.toISOString().slice(0, 10);

const addDays = (iso: string, n: number): string => {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
};

const mondayOf = (iso: string): string => {
  const d = parseIso(iso);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return isoOf(d);
};

const weekdayOf = (iso: string): number => parseIso(iso).getUTCDay();

/* NYSE SESSIONS BETWEEN TWO DAYS (the data audit, 2026-10-22): the count gave up after 40 calendar days, so TSLA's
   01/27 report read "in 28 trading days" for about 66 sessions, and it counted Thanksgiving and Christmas as sessions.
   It walks the whole span now, skipping weekends and the exchange holidays (core/calendar.ts). Bounded by the span. */
const tradingBetween = (from: string, to: string): number => {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  let n = 0;
  let cur = from;
  for (let i = 0; i < 4000 && cur !== to; i++) {
    cur = addDays(cur, sign);
    const day = weekdayOf(cur);
    if (day !== 0 && day !== 6 && !MARKET_HOLIDAYS.has(cur)) n += sign;
  }
  return n;
};

const fortnight = (): string[] => {
  const start = mondayOf(nyToday());
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    const iso = addDays(start, i);
    const day = weekdayOf(iso);
    if (day !== 0 && day !== 6) out.push(iso);
  }
  return out;
};

const SECTOR: Record<string, Sector> = {
  Technology: 'Technology',
  'Communication Services': 'Communication',
  Communication: 'Communication',
  'Consumer Discretionary': 'Consumer Discretionary',
  'Consumer Cyclical': 'Consumer Discretionary',
  Financials: 'Financials',
  'Financial Services': 'Financials',
  Energy: 'Energy',
  'Health Care': 'Health Care',
  Healthcare: 'Health Care',
  Industrials: 'Industrials',
  'Consumer Staples': 'Consumer Staples',
  'Consumer Defensive': 'Consumer Staples',
  Utilities: 'Utilities',
  Materials: 'Materials',
  'Basic Materials': 'Materials',
  'Real Estate': 'Financials',
};

const sectorOf = (raw: string | undefined, ticker: string): Sector =>
  (raw && SECTOR[raw]) || lookup(ticker)?.sector || 'Industrials';

const titleName = (s: string): string => s.toLowerCase().replace(/\b[a-z]/g, m => m.toUpperCase());

/* THE EXPECTED MOVE'S UNIT (the data audit, 2026-10-22): the spec types `expected_move_perc` as a fraction of the price
   ("0.08" is 8%), every row. The old "1.5 and over is already a percent" guess printed FSP's 4.08 (a 408% straddle on a
   $0.44 stock) as ±4.1%. It is read as the fraction it is, always. */
const impliedPct = (raw: unknown): number => {
  const n = Math.abs(num(raw));
  if (!(n > 0)) return 0;
  return n * 100;
};

const priceOf = (r: SlotRow): number => {
  const pre = num(r.pre_earnings_close);
  if (pre > 0) return pre;
  const post = num(r.post_earnings_close);
  if (post > 0) return post;
  const move = num(r.expected_move);
  const pct = num(r.expected_move_perc);
  if (move > 0 && pct > 0) return move / Math.abs(pct);
  return 0;
};

const qLabel = (iso: string): string => {
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return iso;
  return `Q${Math.floor((m - 1) / 3) + 1}'${String(y).slice(2)}`;
};

const labelFor = (iso: string): string => {
  const d = parseIso(iso);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getUTCDay()]} ${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
};

const slotOf = (raw?: string): ReportSlot => (/pre/i.test(raw || '') ? 'BMO' : 'AMC');

function baseEvent(row: SlotRow, today: string): EarningsEvent | null {
  const ticker = (row.symbol || '').toUpperCase();
  const iso = (row.report_date || '').slice(0, 10);
  if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const day = weekdayOf(iso);
  if (day === 0 || day === 6) return null;
  const thisMonday = mondayOf(today);
  const nextMonday = addDays(thisMonday, 7);
  const week = mondayOf(iso);
  const weekIdx: 0 | 1 | null = week === thisMonday ? 0 : week === nextMonday ? 1 : null;
  if (weekIdx == null) return null;
  const implied = Number(impliedPct(row.expected_move_perc).toFixed(2));
  const price = Number(priceOf(row).toFixed(2));
  const reaction = row.reaction == null || row.reaction === '' ? null : Number(row.reaction);
  /* OUT ONCE IT IS OUT (the retail pass, 2026-10-22): Monday's to Wednesday's names, and this morning's before-open
     ones, still showed the "±" the options had priced instead of the move the stock made */
  const reported = iso < today || (iso === today && slotOf(row.report_time) === 'BMO' && nyMinutesNow() >= 9 * 60 + 30) || reaction != null;
  const known = isKnownName(ticker, { sp500: !!row.is_s_p_500, marketCap: num(row.marketcap) || null });
  const partial = {
    ticker,
    name: row.full_name ? titleName(row.full_name) : tickerName(ticker),
    sector: sectorOf(row.sector, ticker),
    price,
    daysOut: tradingBetween(today, iso),
    dateLabel: labelFor(iso),
    weekday: day,
    weekIdx,
    confirmed: (row.source || '').toLowerCase() === 'company',
    known,
    slot: slotOf(row.report_time),
    impliedMovePct: implied,
    marketCap: num(row.marketcap) || null,
    histAvgMovePct: implied,
    pastMoves: [] as { label: string; movePct: number }[],
    richness: 1,
    beatRate8q: 0,
    revisionTrend: 0,
    ivRank: 0,
    technicalScore: 50,
    flowLean: 0,
    iso,
    history: false as boolean,
    reported,
    actualMovePct: reaction != null && Number.isFinite(reaction) ? Number((reaction * 100).toFixed(2)) : null,
  };
  return {
    ...partial,
    verdict: 'SKIP',
    strategy: `Options price ±${implied.toFixed(1)}% into the print. The usual move is still being read.`,
    rationale: 'The date, the slot and the straddle are the vendor’s. The last eight prints have not landed yet, so nothing here calls the premium rich or cheap.',
  };
}

function withHistory(event: EarningsEvent, rows: SlotRow[]): EarningsEvent {
  const past = rows
    .filter(r => (r.report_date || '') < (event.iso || '9999') && r.post_earnings_move_1d != null && r.actual_eps != null && r.street_mean_est != null)
    .sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''))
    .slice(0, 8)
    .reverse();
  if (!past.length) return { ...event, history: true };
  const pastMoves = past.map(r => ({
    label: qLabel((r.ending_fiscal_quarter || r.report_date || '').slice(0, 10)),
    movePct: moveOf(r.post_earnings_move_1d) ?? 0,
  }));
  const hist = pastMoves.reduce((a, m) => a + Math.abs(m.movePct), 0) / pastMoves.length;
  const beats = past.filter(r => num(r.actual_eps) >= num(r.street_mean_est)).length;
  const next = {
    ...event,
    history: true,
    histAvgMovePct: Number(hist.toFixed(2)),
    richness: hist > 0.05 ? Number((event.impliedMovePct / hist).toFixed(2)) : 1,
    beatRate8q: Math.round((beats / past.length) * 100),
    pastMoves,
  };
  return { ...next, ...decide(next) };
}

function moveOf(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = num(raw);
  if (!Number.isFinite(n)) return null;
  return Number((n * 100).toFixed(1));
}

function quartersFrom(rows: SlotRow[]): EarningsQuarter[] {
  return rows
    .filter(r => r.actual_eps != null && r.street_mean_est != null)
    .sort((a, b) => (a.report_date || '').localeCompare(b.report_date || ''))
    .slice(-8)
    .map(r => {
      const est = num(r.street_mean_est);
      const actual = num(r.actual_eps);
      const move = moveOf(r.post_earnings_move_1d);
      return {
        label: qLabel((r.ending_fiscal_quarter || r.report_date || '').slice(0, 10)),
        epsEst: Number(est.toFixed(2)),
        epsActual: Number(actual.toFixed(2)),
        epsBeat: actual >= est,
        revEstB: 0,
        revActualB: 0,
        revBeat: false,
        movePct: move ?? 0,
        moveKnown: move != null,
      };
    });
}

const ivRank = new Map<string, number>();
const contracts = new Map<string, { calls: ActiveContract[]; puts: ActiveContract[] }>();

function ivRankOf(ticker: string): number {
  return ivRank.get(ticker) ?? 0;
}

function contractsOf(ticker: string): { calls: ActiveContract[]; puts: ActiveContract[] } | undefined {
  return contracts.get(ticker);
}

/** Median premium a long straddle gave back, on prints the move did not pay for. Percent. */
function crushOf(rows: SlotRow[]): number | null {
  const quiet: number[] = [];
  const any: number[] = [];
  for (const r of rows) {
    if (r.long_straddle_1d == null || r.long_straddle_1d === '') continue;
    const ret = num(r.long_straddle_1d);
    if (ret < -1.5 || ret > 3) continue;
    const loss = Math.max(0, -ret);
    any.push(loss);
    const move = Math.abs(num(r.post_earnings_move_1d));
    /* a fraction of the price, per the spec */
    const expPct = Math.abs(num(r.expected_move_perc));
    if (expPct > 0 && move < expPct * 0.5) quiet.push(loss);
  }
  const bag = quiet.length >= 2 ? quiet : any.length >= 3 ? any : null;
  if (!bag) return null;
  const sorted = [...bag].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 100);
}

function occOf(symbol: string): { expiry: string; right: 'CALL' | 'PUT'; strike: number } | null {
  if (symbol.length < 16) return null;
  const m = /^(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol.slice(-15));
  if (!m) return null;
  const strike = Number(m[5]) / 1000;
  if (!(strike > 0)) return null;
  return { expiry: `20${m[1]}-${m[2]}-${m[3]}`, right: m[4] === 'C' ? 'CALL' : 'PUT', strike };
}

function contractsFrom(ticker: string, rows: Record<string, unknown>[], spot: number): { calls: ActiveContract[]; puts: ActiveContract[] } {
  const calls: ActiveContract[] = [];
  const puts: ActiveContract[] = [];
  const today = nyToday();
  for (const row of rows) {
    const parsed = occOf(String(row.option_symbol || ''));
    if (!parsed) continue;
    /* an expired contract is never one of the busiest (expiry before New York's today) */
    if (parsed.expiry < today) continue;
    const volume = num(row.volume);
    if (!(volume > 0)) continue;
    const bid = num(row.nbbo_bid);
    const ask = num(row.nbbo_ask);
    const last = num(row.last_price);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
    if (!(mid > 0)) continue;
    const oi = num(row.open_interest);
    const iv = num(row.implied_volatility);
    const fromSpot = spot > 0 ? ((parsed.strike - spot) / spot) * 100 : 0;
    const need = parsed.right === 'CALL'
      ? spot > 0 ? ((parsed.strike + mid - spot) / spot) * 100 : 0
      : spot > 0 ? ((spot - (parsed.strike - mid)) / spot) * 100 : 0;
    const [, mm, dd] = parsed.expiry.split('-');
    const made: ActiveContract = {
      id: String(row.option_symbol),
      right: parsed.right,
      strike: parsed.strike,
      label: `${ticker} $${Number.isInteger(parsed.strike) ? parsed.strike.toFixed(0) : parsed.strike} ${parsed.right === 'CALL' ? 'call' : 'put'} · exp ${mm}/${dd}`,
      mid: Number(mid.toFixed(2)),
      volume,
      oi,
      volOverOi: oi > 0 ? Number((volume / oi).toFixed(2)) : 0,
      ivPct: Math.round((iv > 3 ? iv : iv * 100)),
      fromSpotPct: Number(fromSpot.toFixed(1)),
      breakevenPct: Number(Math.max(0, need).toFixed(1)),
      expiry: parsed.expiry,
    };
    (parsed.right === 'CALL' ? calls : puts).push(made);
  }
  calls.sort((a, b) => b.volume - a.volume);
  puts.sort((a, b) => b.volume - a.volume);
  return { calls: calls.slice(0, 3), puts: puts.slice(0, 3) };
}

async function pullIv(ticker: string, priority = false): Promise<void> {
  if (ivRank.has(ticker)) return;
  try {
    const rows = await whalesIvRank(ticker, priority);
    /* the LATEST day, by its date — the series comes oldest first, so rows[0] was six sessions old (NVDA 33 against
       today's 55.9, the data audit 2026-10-22) */
    const latest = (Array.isArray(rows) ? rows : []).filter(r => r?.date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const raw = num(latest?.iv_rank_1y);
    ivRank.set(ticker, raw > 0 ? Math.round(Math.min(100, raw)) : 0);
  } catch {
    ivRank.set(ticker, 0);
  }
}

async function pullContracts(ticker: string, spot: number, priority = false): Promise<void> {
  if (contracts.has(ticker)) return;
  try {
    const rows = await whalesOptionContracts(ticker, undefined, priority);
    contracts.set(ticker, contractsFrom(ticker, Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [], spot));
  } catch {
    contracts.set(ticker, { calls: [], puts: [] });
  }
}

/** THE ONE NEXT-EARNINGS RULE for the Dossier: the ticker's own Unusual Whales earnings rows (/earnings/{t}), the
    first report dated today or later on New York's calendar. The stock page, the earnings file, the calendar and the
    company card all read this, so a name carries one date everywhere. */
export function nextReportRow<R extends { report_date?: string | null }>(rows: readonly R[]): R | null {
  const today = nyToday();
  return (
    rows
      .filter(r => /^\d{4}-\d{2}-\d{2}/.test(r.report_date || '') && (r.report_date || '').slice(0, 10) >= today)
      .sort((a, b) => (a.report_date || '').localeCompare(b.report_date || ''))[0] ?? null
  );
}

/** Trading days (weekdays) from New York's today to the date — the count every "in N trading days" reads */
export function tradingDaysUntil(iso: string): number {
  return tradingBetween(nyToday(), iso.slice(0, 10));
}

/** "today" · "in 7 trading days" · "3 trading days ago" — one wording everywhere a report's distance is shown */
export function untilWords(days: number): string {
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const unit = n === 1 ? 'trading day' : 'trading days';
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/** The day the next report is due, "Mon 11/02", for a calendar date */
export const reportDayLabel = (iso: string): string => labelFor(iso.slice(0, 10));

/** A past report's day in the same style, with the year when it is not this one: "Thu 07/30", "Thu 10/30/25" */
export const reportDayLabelYear = (iso: string): string => {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return iso;
  return day.slice(0, 4) === nyToday().slice(0, 4) ? labelFor(day) : `${labelFor(day)}/${day.slice(2, 4)}`;
};

export function dossierFromRows(ticker: string, rows: SlotRow[]): EarningsDossier | null {
  const today = nyToday();
  const sym = ticker.toUpperCase();
  const stamped = rows.map(r => ({ ...r, symbol: r.symbol || sym }));
  const upcoming = nextReportRow(stamped);
  const latest = stamped.slice().sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''))[0];
  const row = upcoming ?? latest;
  if (!row) return null;
  const bare = baseEvent({ ...row, symbol: sym }, today);
  /* A print outside the fortnight still has a page. Park it on this week so the file can open. */
  const event = withHistory(
    bare ?? {
      ticker: sym,
      name: tickerName(sym),
      sector: sectorOf(row.sector, sym),
      price: Number(priceOf(row).toFixed(2)),
      daysOut: tradingBetween(today, (row.report_date || today).slice(0, 10)),
      dateLabel: labelFor((row.report_date || today).slice(0, 10)),
      weekday: Math.max(1, Math.min(5, weekdayOf((row.report_date || today).slice(0, 10)) || 1)),
      weekIdx: 0,
      confirmed: (row.source || '').toLowerCase() === 'company',
      known: isKnownName(sym),
      slot: slotOf(row.report_time),
      impliedMovePct: Number(impliedPct(row.expected_move_perc).toFixed(2)),
      marketCap: num(row.marketcap) || null,
      histAvgMovePct: 0,
      pastMoves: [],
      richness: 1,
      beatRate8q: 0,
      revisionTrend: 0,
      ivRank: 0,
      technicalScore: 50,
      flowLean: 0,
      iso: (row.report_date || '').slice(0, 10),
      history: false,
      verdict: 'SKIP',
      strategy: 'The print is on the file. The usual move is still being read.',
      rationale: 'The vendor returned the report. The comparison to the last prints is on its way.',
    },
    stamped
  );
  const quarters = quartersFrom(stamped);
  const knownMoves = quarters.filter(q => q.moveKnown !== false);
  if (knownMoves.length) {
    const hist = knownMoves.reduce((a, q) => a + Math.abs(q.movePct), 0) / knownMoves.length;
    event.histAvgMovePct = Number(hist.toFixed(2));
    event.richness = hist > 0.05 ? Number((event.impliedMovePct / hist).toFixed(2)) : 1;
    event.pastMoves = knownMoves.map(q => ({ label: q.label, movePct: q.movePct }));
    event.history = true;
    Object.assign(event, decide(event));
  }
  const rank = ivRankOf(sym);
  if (rank > 0) event.ivRank = rank;
  const band = knownMoves.length && event.impliedMovePct > 0
    ? knownMoves.filter(q => Math.abs(q.movePct) <= event.impliedMovePct).length / knownMoves.length
    : null;
  const up = knownMoves.length ? knownMoves.filter(q => q.movePct > 0).length / knownMoves.length : null;
  const crush = crushOf(stamped);
  const book = contractsOf(sym);
  return {
    event,
    quarters,
    probInsidePct: band == null ? 0 : Math.round(band * 100),
    probBeyondPct: band == null ? 0 : 100 - Math.round(band * 100),
    probUpPct: up == null ? 50 : Math.round(up * 100),
    ivCrushPct: crush ?? 0,
    premiumLostPct: crush ?? 0,
    activeCalls: book?.calls ?? [],
    activePuts: book?.puts ?? [],
    live: true,
    crushKnown: crush != null,
    contractsReady: contracts.has(sym),
  };
}

interface Feed {
  status: 'loading' | 'live' | 'sim';
  events: EarningsEvent[];
}

let feed: Feed = { status: 'loading', events: [] };
/** Day-slots (a day's before-open or after-close list) that did not answer after a retry */
let missedSlots = 0;
const SLOTS_ASKED = () => fortnight().length * 2;
const history = new Map<string, SlotRow[] | 'miss'>();
const listeners = new Set<() => void>();
let rev = 0;
let started = false;

const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  ensureEarnings();
  return () => listeners.delete(fn);
};

async function pullHistory(ticker: string, priority = false): Promise<SlotRow[] | null> {
  const sym = ticker.toUpperCase();
  const had = history.get(sym);
  if (had && had !== 'miss') return had;
  if (had === 'miss') return null;
  try {
    /* a refused or failed read is asked once more before the name is counted as having no history — the priced counts
       moved between loads as the shared key's three slots turned names away */
    const rows = await whalesEarnings(sym, priority).catch(async () => {
      await new Promise(r => setTimeout(r, 1500));
      return whalesEarnings(sym, priority);
    });
    if (!Array.isArray(rows) || !rows.length) {
      history.set(sym, 'miss');
      return null;
    }
    const typed = rows as SlotRow[];
    history.set(sym, typed);
    return typed;
  } catch {
    history.set(sym, 'miss');
    return null;
  }
}

async function pullIvBatch(tickers: string[]): Promise<void> {
  const need = [...new Set(tickers.map(t => t.toUpperCase()))].filter(t => !ivRank.has(t));
  for (let i = 0; i < need.length; i += 25) {
    const slice = need.slice(i, i + 25);
    try {
      const rows = await whalesScreener(slice);
      const got = new Set<string>();
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const sym = String(row.ticker || row.symbol || '').toUpperCase();
          if (!sym) continue;
          got.add(sym);
          const raw = num(row.iv_rank);
          ivRank.set(sym, raw > 0 ? Math.round(Math.min(100, raw)) : 0);
        }
      }
      for (const t of slice) if (!got.has(t)) ivRank.set(t, 0);
    } catch {
      for (const t of slice) if (!ivRank.has(t)) ivRank.set(t, 0);
    }
  }
}

async function enrich(events: EarningsEvent[]) {
  /* today's reports first, then the days ahead, then the days behind — the vendor's slots are taken in order, and the
     board read Thursday's names "—" while Monday's histories queued ahead of them (the ship pass, 2026-10-22) */
  const urgency = (e: EarningsEvent) => (e.daysOut >= 0 ? e.daysOut : 100 - e.daysOut);
  const want = events.filter(e => e.known && e.history === false).sort((a, b) => urgency(a) - urgency(b)).map(e => e.ticker);
  const unique = [...new Set(want)];
  void pullIvBatch(events.filter(e => e.known).map(e => e.ticker)).then(() => {
    feed = {
      status: 'live',
      events: feed.events.map(e => {
        const rank = ivRankOf(e.ticker);
        return rank > 0 && e.ivRank !== rank ? { ...e, ivRank: rank } : e;
      }),
    };
    emit();
  });
  await Promise.all(
    unique.map(async ticker => {
      const rows = await pullHistory(ticker);
      if (!rows) return;
      const rank = ivRankOf(ticker);
      feed = {
        status: 'live',
        events: feed.events.map(e => {
          if (e.ticker !== ticker || e.history !== false) return e;
          const next = withHistory(e, rows.map(r => ({ ...r, symbol: r.symbol || ticker })));
          return rank > 0 ? { ...next, ivRank: rank } : next;
        }),
      };
      emit();
    })
  );
}

export function ensureEarnings(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void (async () => {
    try {
      const today = nyToday();
      const days = fortnight();
      const batches = await Promise.all(
        days.flatMap(date =>
          (['premarket', 'afterhours'] as const).map(async slot => {
            /* STABLE COUNTS (the retail pass, 2026-10-22: 966 reports, then 983, ten minutes apart): a slot that fails
               is asked again before it is counted missing, a full page is followed until it runs out, and the
               slots that still did not answer are counted and said on the page — never a quiet hole in the total */
            const read = async (page: number): Promise<SlotRow[]> => {
              try {
                const got = await whalesEarningsSlot(slot, date, page);
                return Array.isArray(got) ? (got as SlotRow[]) : [];
              } catch {
                await new Promise(r => setTimeout(r, 1200));
                const got = await whalesEarningsSlot(slot, date, page);
                return Array.isArray(got) ? (got as SlotRow[]) : [];
              }
            };
            try {
              let all = await read(0);
              for (let page = 1; page < 5 && all.length === page * 100; page++) all = all.concat(await read(page));
              return all;
            } catch {
              missedSlots += 1;
              return [] as SlotRow[];
            }
          })
        )
      );
      const seen = new Set<string>();
      const events: EarningsEvent[] = [];
      for (const rows of batches) {
        for (const row of rows) {
          const ev = baseEvent(row, today);
          if (!ev) continue;
          const key = `${ev.ticker}-${ev.iso}`;
          if (seen.has(key)) continue;
          seen.add(key);
          events.push(ev);
        }
      }
      if (!events.length) throw new Error('empty');
      events.sort((a, b) => a.daysOut - b.daysOut || Number(b.known) - Number(a.known) || b.impliedMovePct - a.impliedMovePct);
      feed = { status: 'live', events };
      emit();
      void enrich(events);
    } catch {
      if (feed.status !== 'live') {
        feed = { status: 'sim', events: [] };
        emit();
      }
    }
  })();
}

export function useEveryReport(): EarningsEvent[] {
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  return useMemo(() => (feed.status === 'live' ? feed.events : []), [version]);
}

/** True when the fortnight's read failed — an empty board then is a failure, not a quiet fortnight */
export function useEarningsFailed(): boolean {
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  return useMemo(() => feed.status === 'sim', [version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** How much of the fortnight answered: the day-slots asked, the ones that did not answer, and the histories still out */
export function useEarningsCoverage(): { slots: number; missed: number; historiesPending: number } {
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  return useMemo(
    () => ({ slots: SLOTS_ASKED(), missed: missedSlots, historiesPending: feed.events.filter(e => e.known && e.history === false && history.get(e.ticker) !== 'miss').length }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}

/** True only while the fortnight has not answered. An empty live list is not pending. */
export function useEarningsPending(): boolean {
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  return useMemo(() => feed.status === 'loading', [version]);
}

/* THE NAME'S NEXT REPORT (the data audit, 2026-10-22): the board's own fortnight row came first, and the fortnight runs
   from Monday — so TSLA, which reported Wednesday, read "reports Wed 10/21 · 1 trading day ago" while its own pages
   said 01/27. The answer is the ONE rule every page uses: the name's own earnings rows, the first report dated today
   or later (nextReportRow). The board's row is used only when it is that same report. */
export function useNextReport(ticker: string | null): NextReport | null {
  const events = useEveryReport();
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  const sym = ticker?.trim().toUpperCase() || '';
  useEffect(() => {
    if (!sym || history.has(sym)) return;
    let dead = false;
    void pullHistory(sym, true).then(() => {
      if (!dead) emit();
    });
    return () => {
      dead = true;
    };
  }, [sym]);
  return useMemo(() => {
    if (!sym) return null;
    const rows = history.get(sym);
    if (!rows || rows === 'miss') return null;
    const next = nextReportRow(rows.map(r => ({ ...r, symbol: r.symbol || sym })));
    if (!next?.report_date) return null;
    const iso = next.report_date.slice(0, 10);
    const hit = events.find(e => e.ticker === sym && e.iso === iso);
    if (hit) return { ticker: sym, name: hit.name, daysOut: hit.daysOut, dateLabel: hit.dateLabel, iso, slot: hit.slot, confirmed: hit.confirmed, event: hit };
    const file = dossierFromRows(sym, rows);
    if (!file) return null;
    const e = file.event;
    return { ticker: sym, name: e.name, daysOut: tradingBetween(nyToday(), iso), dateLabel: labelFor(iso), iso, slot: slotOf(next.report_time), confirmed: (next.source || '').toLowerCase() === 'company', event: e };
    // version bumps when a history file lands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, events, version]);
}

/** True while a name's own earnings rows are still being read */
export function useNextReportPending(ticker: string | null): boolean {
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  const sym = ticker?.trim().toUpperCase() || '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => !!sym && !history.has(sym), [sym, version]);
}

export function useLiveDossier(ticker: string): { status: 'loading' | 'live' | 'sim'; dossier: EarningsDossier | null } {
  const sym = ticker.trim().toUpperCase();
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  useEffect(() => {
    if (!sym) return;
    let dead = false;
    void pullIv(sym, true).then(() => {
      if (!dead) emit();
    });
    void pullHistory(sym, true).then(rows => {
      if (dead) return;
      emit();
      const upcoming = (rows ? nextReportRow(rows) : null) ?? rows?.slice().sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''))[0];
      /* the contracts' "from spot" and breakevens read the stock's LAST price — the calendar row's price is the one
         the print was priced against, stale once it is out (TSLA's cards measured from $386.55 after a $373.63 close) */
      return uwCall(`/stock/${encodeURIComponent(sym)}/stock-state`, true)
        .then(res => {
          const last = Number((res.data as { close?: string } | null)?.close);
          return last > 0 ? last : upcoming ? priceOf(upcoming) : 0;
        })
        .catch(() => (upcoming ? priceOf(upcoming) : 0))
        .then(spot => pullContracts(sym, spot, true)).then(() => {
        if (!dead) emit();
      });
    });
    return () => {
      dead = true;
    };
  }, [sym]);
  return useMemo(() => {
    const rows = history.get(sym);
    if (rows && rows !== 'miss') {
      const dossier = dossierFromRows(sym, rows);
      return { status: 'live' as const, dossier };
    }
    if (rows === 'miss' || feed.status === 'sim') return { status: 'sim' as const, dossier: null };
    return { status: 'loading' as const, dossier: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, version]);
}
