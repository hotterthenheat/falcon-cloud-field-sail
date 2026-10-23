/*
  The earnings calendar off Unusual Whales. A miss or an empty fortnight
  stays empty — never a sample of invented names.
*/

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Sector } from './universe';
import { lookup } from './universe';
import { decide, isKnownName, type ActiveContract, type EarningsDossier, type EarningsEvent, type EarningsQuarter, type NextReport, type ReportSlot } from './earnings';
import { companyName, rememberCompanyNames, tickerName, titleCompany } from './tickers';
import { MARKET_HOLIDAYS } from '../core/calendar';
import { boardMondayIso, shortDay } from './nyDate';
import { loadRegularCloses, peekRegularCloses, phaseOf } from './dayChange';
import { screenerNeedsCloses, screenerRead } from './liveQuote';
import { nyIsoDate } from '../core/nyTime';
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
  /* New York's board Monday — the week's on a weekday, the coming one on a weekend; the board's columns read the same */
  const start = boardMondayIso(nyToday());
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

const titleName = (s: string): string => titleCompany(s);

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
/* A TIME THE VENDOR DOES NOT HAVE (the re-audit, 2026-10-22): report_time "unknown" read as "after the close". The slot
   is kept for ordering, and the page says "time not set" */
const timeKnownOf = (raw?: string | null): boolean => /pre|post|after|before|amc|bmo/i.test(raw || '');
const estimatedOf = (source?: string | null): boolean => /estimat/i.test(source || '');

/** The minimum past reports before a name's premium is called rich, fair or cheap against its usual move */
export const MIN_PRICED_PRINTS = 4;

/** Beat, in line or miss: equal to the cent is in line, never a beat (the re-audit, 2026-10-22: BBD's six in-line prints
    were counted as beats) */
export const epsResultOf = (actual: number, est: number): 'beat' | 'inline' | 'miss' => {
  const a = Math.round(actual * 100);
  const e = Math.round(est * 100);
  return a > e ? 'beat' : a < e ? 'miss' : 'inline';
};

/** IS THE PRINT OUT — the one rule (the third audit, 2026-10-23: at 19:20 the board still counted WDC "still to report"
    and priced it "±6.5% · 0.87× fair" while its page said "Reported"). On New York's clock: a date before today is out;
    today's before-the-open report is out from 09:30, today's after-the-close one (or one with no time set) from 16:00;
    a report the vendor already gives a move for is out. */
export function reportedNow(e: { ticker?: string; iso?: string; slot: ReportSlot; timeKnown?: boolean; actualMovePct?: number | null }, today: string = nyToday(), minutes: number = nyMinutesNow()): boolean {
  const iso = (e.iso ?? '').slice(0, 10);
  if (!iso) return false;
  if (iso < today || e.actualMovePct != null) return true;
  if (iso > today) return false;
  /* the company's own results on the wire today (audit round 7: AXP and SLB counted "still to report" at 07:20 — both
     prints crossed at 07:04 and 06:53, the vendor's actual_eps still empty) */
  if (e.ticker && wireOut.has(`${e.ticker.toUpperCase()}|${iso}`)) return true;
  return minutes >= (e.slot === 'BMO' && e.timeKnown !== false ? 9 * 60 + 30 : 16 * 60);
}

/* THE RESULTS ON THE WIRE (audit round 7). Between the early morning and the open the slot rule cannot tell a print that
   is out from one still to come, and the vendor's actual_eps lags the wire. For today's before-the-open names the board
   or a name's page shows, the name's own latest headlines (/news/headlines?ticker=, one small read a name, on the
   background lane, again every five minutes until it is out) are read for the company's results crossed today. */
const wireOut = new Set<string>();
const wireAt = new Map<string, number>();
const RESULTS = /\b(q[1-4]|quarter(ly)?|results|earnings|eps)\b/i;
const WIRE_EVERY = 5 * 60_000;
export function checkWire(tickers: readonly string[], iso: string): Promise<boolean> {
  const today = nyToday();
  const minutes = nyMinutesNow();
  /* only on the day, before the open, from 04:00 — outside that window the slot rule and the dates answer */
  if (iso !== today || minutes < 4 * 60 || minutes >= 9 * 60 + 30) return Promise.resolve(false);
  const want = tickers.map(t => t.toUpperCase()).filter(t => !wireOut.has(`${t}|${iso}`) && Date.now() - (wireAt.get(t) ?? 0) > WIRE_EVERY);
  if (!want.length) return Promise.resolve(false);
  const midnight = Date.parse(`${iso}T04:00:00Z`);
  return Promise.all(
    want.map(t => {
      wireAt.set(t, Date.now());
      return uwCall(`/news/headlines?ticker=${encodeURIComponent(t)}&limit=10`, false, true).then(res => {
        const rows = Array.isArray(res.data) ? (res.data as { created_at?: string; headline?: string; tickers?: string[] }[]) : [];
        const hit = rows.some(r => {
          const at = Date.parse(String(r.created_at ?? ''));
          return Number.isFinite(at) && at >= midnight && (r.tickers ?? []).map(x => x.toUpperCase()).includes(t) && RESULTS.test(String(r.headline ?? ''));
        });
        if (hit) wireOut.add(`${t}|${iso}`);
        return hit;
      });
    }),
  ).then(found => found.some(Boolean));
}
/** Re-reads which of the feed's prints are out, and tells the listeners when any changed */
function rereadOut(): void {
  let changed = false;
  for (const e of feed.events) {
    const out = reportedNow(e);
    if (out !== !!e.reported) {
      e.reported = out;
      changed = true;
    }
  }
  if (changed) emit();
}
function checkTodaysWire(): void {
  if (feed.status !== 'live') return;
  const today = nyToday();
  const names = feed.events.filter(e => e.iso === today && e.slot === 'BMO' && e.known && !e.reported).map(e => e.ticker);
  if (names.length) void checkWire(names, today).then(found => found && rereadOut());
}
/** A name's page: is today's print on the wire yet (re-reads every five minutes before the open) */
export function useWireCheck(ticker: string, iso: string | undefined, slot: ReportSlot | undefined): void {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!ticker || !iso || slot !== 'BMO') return;
    let dead = false;
    const run = () =>
      void checkWire([ticker], iso).then(found => {
        if (found && !dead) {
          rereadOut();
          bump(n => n + 1);
        }
      });
    run();
    const id = window.setInterval(run, WIRE_EVERY);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [ticker, iso, slot]);
}

/* ---- THE REACTION SESSION'S MOVE, LIVE (round 9) ---------------------------------------------------------------
   The calendar's `reaction` (and the board's "so far") equals the vendor's stock-state, which sat at its 10:35 print all
   day on 10/23 — WDC +0.3% shown against −1.9% traded, AXP −3.5% against −4.2%. While a report's reacting session
   trades, its move is read off /screener/stocks (a dozen names a call, the live close and prev_close — the close
   before the session, the base the reaction is measured from), every minute while a page shows them; after the bell
   the regular close (screenerRead on the name's daily rows, liveQuote's rule). */
const nextSession = (iso: string): string => {
  let d = addDays(iso, 1);
  for (let i = 0; i < 10 && (weekdayOf(d) === 0 || weekdayOf(d) === 6 || MARKET_HOLIDAYS.has(d)); i++) d = addDays(d, 1);
  return d;
};
const reactionIsoOf = (iso: string, slot: ReportSlot, timeKnown: boolean): string => (slot === 'BMO' && timeKnown ? iso : nextSession(iso));
/** The reacting session is today and has opened (from 09:30) — the vendor's frozen figure is not shown then */
const reactionSessionOn = (rIso: string, today: string = nyToday()): boolean => rIso === today && nyMinutesNow() >= 9 * 60 + 30;
const liveMoves = new Map<string, { pct: number; live: boolean; at: number }>();
const liveMoveAsked = new Map<string, number>();
const LIVE_MOVE_EVERY = 60_000;
/** Reads the move so far of reports whose reacting session is today (deduped, a minute apart a name) */
export async function refreshReactions(items: readonly { ticker: string; iso?: string; slot: ReportSlot; timeKnown?: boolean; reported?: boolean; known?: boolean }[]): Promise<boolean> {
  const today = nyToday();
  if (!reactionSessionOn(today, today)) return false;
  const now = Date.now();
  /* after the bell each name's regular close is a daily-row read — the known names only, at most thirty */
  const afterBell = nyMinutesNow() >= 16 * 60;
  /* a move read in the session is the day's move once the bell has rung */
  if (afterBell) for (const [k, v] of liveMoves) if (v.live) liveMoves.set(k, { ...v, live: false });
  const want = items
    .filter(e => e.iso && e.reported && reactionIsoOf(e.iso, e.slot, e.timeKnown !== false) === today && now - (liveMoveAsked.get(e.ticker) ?? 0) > LIVE_MOVE_EVERY - 2000)
    .filter(e => !afterBell || (e.known !== false && !liveMoves.has(`${e.ticker.toUpperCase()}|${e.iso}`)))
    .slice(0, afterBell ? 30 : Infinity);
  const byTicker = new Map<string, string>();
  for (const e of want) byTicker.set(e.ticker.toUpperCase(), e.iso!);
  const names = [...byTicker.keys()];
  if (!names.length) return false;
  for (const t of names) liveMoveAsked.set(t, now);
  let changed = false;
  for (let i = 0; i < names.length; i += 12) {
    const rows = await whalesScreener(names.slice(i, i + 12)).catch(() => null);
    for (const row of Array.isArray(rows) ? rows : []) {
      const t = String(row.ticker || '').toUpperCase();
      const iso = byTicker.get(t);
      if (!iso) continue;
      const inSession = !screenerNeedsCloses(row);
      const closes = inSession ? null : peekRegularCloses(t) ?? (await loadRegularCloses(t).catch(() => null));
      const r = screenerRead(row, closes);
      if (!r || r.pct == null || r.date !== today) continue;
      const pct = Number(r.pct.toFixed(2));
      const key = `${t}|${iso}`;
      const had = liveMoves.get(key);
      if (!had || had.pct !== pct || had.live !== inSession) changed = true;
      liveMoves.set(key, { pct, live: inSession, at: Date.now() });
    }
  }
  if (changed && feed.status === 'live') {
    feed = { status: 'live', events: feed.events.map(e => {
      const m = liveMoves.get(`${e.ticker}|${e.iso}`);
      return m && (m.pct !== e.actualMovePct || m.live !== e.moveLive) ? { ...e, actualMovePct: m.pct, moveLive: m.live, reported: true } : e;
    }) };
  }
  if (changed) emit();
  return changed;
}
/** A page showing reports keeps their reacting session's move fresh (a minute apart) */
export function useLiveReactions(items: readonly EarningsEvent[]): void {
  const key = items.filter(e => e.reported && e.iso && e.reactionIso === nyToday()).map(e => `${e.ticker}|${e.iso}|${e.slot}|${e.timeKnown !== false ? 1 : 0}|${e.known ? 1 : 0}`).sort().join(',');
  useEffect(() => {
    if (!key) return;
    const list = key.split(',').map(k => {
      const [ticker, iso, slot, tk, kn] = k.split('|');
      return { ticker, iso, slot: slot as ReportSlot, timeKnown: tk === '1', reported: true, known: kn === '1' };
    });
    void refreshReactions(list);
    const id = window.setInterval(() => void refreshReactions(list), LIVE_MOVE_EVERY);
    return () => window.clearInterval(id);
  }, [key]);
}

function baseEvent(row: SlotRow, today: string): EarningsEvent | null {
  const ticker = (row.symbol || '').toUpperCase();
  const iso = (row.report_date || '').slice(0, 10);
  if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const day = weekdayOf(iso);
  if (day === 0 || day === 6) return null;
  const thisMonday = boardMondayIso(today);
  const nextMonday = addDays(thisMonday, 7);
  const week = mondayOf(iso);
  const weekIdx: 0 | 1 | null = week === thisMonday ? 0 : week === nextMonday ? 1 : null;
  if (weekIdx == null) return null;
  const implied = impliedPct(row.expected_move_perc);
  const price = Number(priceOf(row).toFixed(2));
  /* the move the stock made: the slot's `reaction`, else the report's own next-session move on the name's rows
     (post_earnings_move_1d) — PG reported before the open with both on file and its page said "the result lands once
     the vendor posts it" (the third audit, 2026-10-23) */
  const reactionRaw = row.reaction == null || row.reaction === '' ? null : Number(row.reaction);
  const postMove = row.post_earnings_move_1d == null || row.post_earnings_move_1d === '' ? null : Number(row.post_earnings_move_1d);
  const reaction = reactionRaw != null && Number.isFinite(reactionRaw) ? reactionRaw : postMove != null && Number.isFinite(postMove) ? postMove : null;
  /* OUT ONCE IT IS OUT — ONE RULE, reportedNow, for the board and the name's page */
  const reported = reportedNow({ ticker, iso, slot: slotOf(row.report_time), timeKnown: timeKnownOf(row.report_time), actualMovePct: reaction }, today);
  const rIso = reactionIsoOf(iso, slotOf(row.report_time), timeKnownOf(row.report_time));
  const live = liveMoves.get(`${ticker}|${iso}`);
  const known = isKnownName(ticker, { sp500: !!row.is_s_p_500, marketCap: num(row.marketcap) || null });
  const partial = {
    ticker,
    name: row.full_name ? titleName(row.full_name) : companyName(ticker),
    sector: sectorOf(row.sector, ticker),
    price,
    daysOut: tradingBetween(today, iso),
    dateLabel: labelFor(iso),
    weekday: day,
    weekIdx,
    confirmed: (row.source || '').toLowerCase() === 'company',
    known,
    slot: slotOf(row.report_time),
    timeKnown: timeKnownOf(row.report_time),
    estimated: estimatedOf(row.source),
    impliedMovePct: implied,
    marketCap: num(row.marketcap) || null,
    /* NO HISTORY, NO USUAL MOVE (the re-audit, 2026-10-22: the implied move stood in for the usual one, so CX and FDXF
       read "1.00× fair") — zero until the name's own past moves land, and nothing is priced against it */
    histAvgMovePct: 0,
    histCount: 0,
    pastMoves: [] as { label: string; movePct: number }[],
    richness: 0,
    beatRate8q: 0,
    revisionTrend: 0,
    ivRank: 0,
    technicalScore: 50,
    flowLean: 0,
    iso,
    history: false as boolean,
    reported,
    reactionIso: rIso,
    /* THE MOVE SO FAR OFF THE LIVE PRICE (round 9: the board said WDC +0.3% while it traded −1.9% — the calendar's
       `reaction` is the vendor's stock-state, frozen at 10:35 all day). In the reacting session the move is the
       screener's live close against the close before the report; the vendor's figure stands only outside it */
    actualMovePct: live ? live.pct : reactionSessionOn(rIso, today) ? null : reaction != null && Number.isFinite(reaction) ? Number((reaction * 100).toFixed(2)) : null,
    moveLive: live ? live.live : false,
  };
  return {
    ...partial,
    verdict: 'SKIP',
    strategy: `Options price ±${implied.toFixed(1)}% into the print. The usual move is still being read.`,
    rationale: 'The date, the slot and the straddle are the vendor’s. The last eight prints have not landed yet, so nothing here calls the premium rich or cheap.',
  };
}

/* THE LAST EIGHT MOVES AND THE BEATS, EACH ON ITS OWN ROWS (the re-audit, 2026-10-22). The history kept only reports
   that had an EPS estimate, so GME's four newest reports (no street_mean_est) were skipped and "usually moves ±13.1%" was
   Q4'23–Q3'25 (the real last eight average ~4.9%). The usual move is the latest eight reports with a next-session move,
   whatever their EPS rows say; beat / in line / miss is counted over the reports that carry both an actual and an
   estimate, with its own count. Rich, fair or cheap needs MIN_PRICED_PRINTS moves; a name with none has no usual move. */
function historyOf(rows: SlotRow[], before: string) {
  const dated = rows.filter(r => (r.report_date || '') < before).sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''));
  const moved = dated.filter(r => moveOf(r.post_earnings_move_1d) != null).slice(0, 8).reverse();
  const pastMoves = moved.map(r => ({ label: qLabel((r.ending_fiscal_quarter || r.report_date || '').slice(0, 10)), movePct: moveOf(r.post_earnings_move_1d) ?? 0 }));
  /* ONE BEAT RULE (audit round 10: WDC read 6·0·2 on the grid, 7·0·1 of 8 on its page) — the last eight reports with
     an actual and an estimate, the print itself included once its EPS is in, as the page's quarters are counted */
  const withOwn = rows.filter(r => (r.report_date || '').slice(0, 10) <= before.slice(0, 10)).sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''));
  const eps = withOwn.filter(r => r.actual_eps != null && r.actual_eps !== '' && r.street_mean_est != null && r.street_mean_est !== '').slice(0, 8);
  const results = eps.map(r => epsResultOf(num(r.actual_eps), num(r.street_mean_est)));
  /* THE UPCOMING REPORT'S STREET ESTIMATE, when the vendor's row for it carries one (audit round 5: "Estimates —" sat beside
     an 8-for-8 beat history) — the row on the report's own date, not yet reported */
  const upcoming = rows.find(r => (r.report_date || '') === before && (r.actual_eps == null || r.actual_eps === '') && r.street_mean_est != null && r.street_mean_est !== '');
  const nextEst = upcoming ? num(upcoming.street_mean_est) : null;
  return {
    nextEst: nextEst != null && Number.isFinite(nextEst) ? nextEst : null,
    pastMoves,
    hist: pastMoves.length ? pastMoves.reduce((a, m) => a + Math.abs(m.movePct), 0) / pastMoves.length : 0,
    beatCount: results.filter(x => x === 'beat').length,
    inlineCount: results.filter(x => x === 'inline').length,
    missCount: results.filter(x => x === 'miss').length,
    epsCount: results.length,
  };
}

function withHistory(event: EarningsEvent, rows: SlotRow[]): EarningsEvent {
  const h = historyOf(rows, event.iso || '9999');
  const priced = h.pastMoves.length >= MIN_PRICED_PRINTS && h.hist > 0.05;
  const next: EarningsEvent = {
    ...event,
    history: true,
    histCount: h.pastMoves.length,
    histAvgMovePct: h.pastMoves.length ? h.hist : 0,
    /* THE RATIO OF THE FIGURES SHOWN (audit round 5: "1.63× rich" beside ±4.0% and ±2.5%, which make 1.60 — the ratio was of
       the unrounded 4.04 / 2.48): the options' move over the usual move, each at the one decimal the page prints */
    richness: priced && Number(h.hist.toFixed(1)) > 0 ? Number(event.impliedMovePct.toFixed(1)) / Number(h.hist.toFixed(1)) : 0,
    beatRate8q: h.epsCount ? Math.round((h.beatCount / h.epsCount) * 100) : 0,
    beatCount: h.beatCount,
    inlineCount: h.inlineCount,
    missCount: h.missCount,
    pastMoves: h.pastMoves,
    nextEpsEst: h.nextEst,
  };
  if (!priced) {
    const n = h.pastMoves.length;
    return {
      ...next,
      verdict: 'SKIP',
      strategy: n === 0 ? `Options price ±${event.impliedMovePct.toFixed(1)}% into the print. The name has no past move on file to set it against.` : `Options price ±${event.impliedMovePct.toFixed(1)}% into the print, against ±${h.hist.toFixed(1)}% from ${n} past ${n === 1 ? 'print' : 'prints'} — too few to call it rich or cheap.`,
      rationale: `Rich, fair or cheap needs at least ${MIN_PRICED_PRINTS} past moves on file.`,
    };
  }
  return { ...next, ...decide(next) };
}

function moveOf(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = num(raw);
  if (!Number.isFinite(n)) return null;
  /* UNROUNDED (the fourth audit, 2026-10-23): rounding each move to 0.1% before it was compared flipped PG's odds to 88/12
     and "covered 1 of 8" (raw 75/25, 2 of 8) — the moves are compared whole and rounded only where they are printed */
  return n * 100;
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
        epsBeat: epsResultOf(actual, est) === 'beat',
        epsResult: epsResultOf(actual, est),
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

function contractsFrom(ticker: string, rows: Record<string, unknown>[], spot: number, spotWord?: string): { calls: ActiveContract[]; puts: ActiveContract[] } {
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
      spotWord,
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

async function pullContracts(ticker: string, spot: number, priority = false, spotWord?: string): Promise<void> {
  if (contracts.has(ticker)) return;
  try {
    const rows = await whalesOptionContracts(ticker, undefined, priority);
    contracts.set(ticker, contractsFrom(ticker, Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [], spot, spotWord));
  } catch {
    contracts.set(ticker, { calls: [], puts: [] });
  }
}

/** THE ONE NEXT-EARNINGS RULE for the Dossier: the ticker's own Unusual Whales earnings rows (/earnings/{t}), the
    first report dated today or later on New York's calendar. The stock page, the earnings file, the calendar and the
    company card all read this, so a name carries one date everywhere. */
export function nextReportRow<R extends { report_date?: string | null }>(rows: readonly R[], opts: { skipOut?: boolean } = {}): R | null {
  const today = nyToday();
  /* with skipOut (the stock page's "reports …" line): today's report that is already out — its slot has passed, its
     results are on the wire or its EPS is in — is not the next one (audit round 7: AXP read "reports today" after its
     07:04 print). The earnings page keeps today's print, reported, as its own. */
  const outToday = (r: R): boolean => {
    const x = r as unknown as { symbol?: string; report_time?: string | null; actual_eps?: unknown; post_earnings_move_1d?: unknown };
    const actual = x.actual_eps != null && x.actual_eps !== '' ? 0 : x.post_earnings_move_1d != null && x.post_earnings_move_1d !== '' ? 0 : null;
    return reportedNow({ ticker: x.symbol, iso: today, slot: slotOf(x.report_time ?? undefined), timeKnown: timeKnownOf(x.report_time), actualMovePct: actual });
  };
  /* THE REPORT WHOSE REACTING SESSION IS TODAY (audit round 10: WDC reported 10/22 after the close and its page led with
     02/04 "time not set", nothing of last night's print or today's move). Without skipOut, yesterday's after-the-close
     print (or one with no time set) leads the page through the session that reacts to it, as today's before-the-open
     one does; the next report follows it. */
  const reactingToday = (r: R): boolean => {
    const iso = (r.report_date || '').slice(0, 10);
    if (opts.skipOut || iso >= today) return false;
    const x = r as unknown as { report_time?: string | null };
    return reactionIsoOf(iso, slotOf(x.report_time ?? undefined), timeKnownOf(x.report_time)) === today;
  };
  return (
    rows
      .filter(r => /^\d{4}-\d{2}-\d{2}/.test(r.report_date || '') && ((r.report_date || '').slice(0, 10) > today || ((r.report_date || '').slice(0, 10) === today && !(opts.skipOut && outToday(r))) || reactingToday(r)))
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
  /* the report after the one the page leads with — when that one is already out (last night's print), the next date */
  const upIso = (upcoming?.report_date || '').slice(0, 10);
  const afterRow = upcoming
    ? stamped.filter(r => /^\d{4}-\d{2}-\d{2}/.test(r.report_date || '') && (r.report_date || '').slice(0, 10) > upIso && (r.report_date || '').slice(0, 10) > today).sort((a, b) => (a.report_date || '').localeCompare(b.report_date || ''))[0] ?? null
    : null;
  const latest = stamped.slice().sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''))[0];
  const row = upcoming ?? latest;
  if (!row) return null;
  const bare = baseEvent({ ...row, symbol: sym }, today);
  /* A print outside the fortnight still has a page. Park it on this week so the file can open. */
  const event = withHistory(
    bare ?? {
      ticker: sym,
      name: companyName(sym),
      sector: sectorOf(row.sector, sym),
      price: Number(priceOf(row).toFixed(2)),
      daysOut: tradingBetween(today, (row.report_date || today).slice(0, 10)),
      dateLabel: labelFor((row.report_date || today).slice(0, 10)),
      weekday: Math.max(1, Math.min(5, weekdayOf((row.report_date || today).slice(0, 10)) || 1)),
      weekIdx: 0,
      confirmed: (row.source || '').toLowerCase() === 'company',
      known: isKnownName(sym),
      slot: slotOf(row.report_time),
      timeKnown: timeKnownOf(row.report_time),
      estimated: estimatedOf(row.source),
      impliedMovePct: impliedPct(row.expected_move_perc),
      marketCap: num(row.marketcap) || null,
      histAvgMovePct: 0,
      histCount: 0,
      pastMoves: [],
      richness: 0,
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
  /* the moves are the event's own last eight (withHistory) — never the EPS table's quarters, which skip a report
     without an estimate */
  const knownMoves = event.pastMoves;
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
    nextAfter: afterRow?.report_date
      ? {
          iso: afterRow.report_date.slice(0, 10),
          dateLabel: labelFor(afterRow.report_date.slice(0, 10)),
          slot: slotOf(afterRow.report_time),
          timeKnown: timeKnownOf(afterRow.report_time),
          estimated: estimatedOf(afterRow.source),
          confirmed: (afterRow.source || '').toLowerCase() === 'company',
          daysOut: tradingBetween(today, afterRow.report_date.slice(0, 10)),
        }
      : null,
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
/* A NAME'S PAGE READS ITS OWN ROWS ONLY (the re-audit, 2026-10-22: opening one name's earnings page read the whole
   fortnight and every name's history, ~300 calls). The name hooks listen without starting the fortnight */
const subscribeQuiet = (fn: () => void) => {
  listeners.add(fn);
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
  void pullIvBatch(unique).then(() => {
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
      if (!rows) {
        emit();
        return;
      }
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

/* THE HISTORIES ONLY WHERE THEY ARE SHOWN (the re-audit, 2026-10-22; audit round 7: the board still read every known
   name's past reports across the fortnight — 393 /earnings/{T} calls, about 42 seconds on the key's three slots). The
   board now names the histories it shows: the known names still to report in the weeks on view (the rich / fair /
   cheap counts and the Priced filter are over them), the names on the grid's page in view, and today's card. A name
   is read once; another week or page asks only for what it adds. */
const wanted = new Set<string>();
const asked = new Set<string>();
function startEnrich() {
  if (feed.status !== 'live') return;
  const todo = feed.events.filter(e => e.known && e.history === false && wanted.has(e.ticker) && !asked.has(e.ticker));
  if (!todo.length) return;
  for (const e of todo) asked.add(e.ticker);
  void enrich(todo);
}
/** The earnings board's own call: read the past reports of the names it shows */
export function useEarningsHistories(tickers: readonly string[]): void {
  const key = [...new Set(tickers.map(t => t.toUpperCase()))].sort().join(',');
  useEffect(() => {
    if (!key) return;
    for (const t of key.split(',')) wanted.add(t);
    startEnrich();
  }, [key]);
}
/** True when this name's past reports are not asked for on the board (read on its own page) */
export const historyUnasked = (ticker: string): boolean => !asked.has(ticker.toUpperCase()) && !history.has(ticker.toUpperCase());

/* ONE CALL A DAY'S SLOT (audit round 10: the index read 23 calendar pages at 100 rows — a heavy day's slot took two). The
   route answers up to 500 rows a page (10/29 premarket: 155 in one) */
const SLOT_PAGE = 500;
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
                const got = await whalesEarningsSlot(slot, date, page, SLOT_PAGE);
                return Array.isArray(got) ? (got as SlotRow[]) : [];
              } catch {
                await new Promise(r => setTimeout(r, 1200));
                const got = await whalesEarningsSlot(slot, date, page, SLOT_PAGE);
                return Array.isArray(got) ? (got as SlotRow[]) : [];
              }
            };
            try {
              let all = await read(0);
              for (let page = 1; page < 5 && all.length === page * SLOT_PAGE; page++) all = all.concat(await read(page));
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
      /* the calendar's names serve every name cell that would otherwise ask the stock's info (round 9) */
      rememberCompanyNames(batches.flat().map(r => [String(r.symbol || ''), r.full_name] as const));
      /* A SECOND SHARE CLASS (the re-audit, 2026-10-22: BBDO read "—" everywhere): a symbol that is another symbol on
         the same day with a class letter added is that company's other class; its history is filed under the first */
      const byDay = new Map<string, Set<string>>();
      for (const e of events) {
        const set = byDay.get(e.iso ?? '') ?? new Set<string>();
        set.add(e.ticker);
        byDay.set(e.iso ?? '', set);
      }
      for (const e of events) {
        const base = e.ticker.replace(/[.\-]?[A-Z]$/, '');
        if (base && base !== e.ticker && base.length >= 2 && byDay.get(e.iso ?? '')?.has(base)) e.classOf = base;
      }
      events.sort((a, b) => a.daysOut - b.daysOut || Number(b.known) - Number(a.known) || b.impliedMovePct - a.impliedMovePct);
      feed = { status: 'live', events };
      emit();
      startEnrich();
      /* the clock moves the rule: a minute's tick re-reads which prints are out (09:30, 16:00) */
      checkTodaysWire();
      window.setInterval(() => {
        rereadOut();
        checkTodaysWire();
      }, 60_000);
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
    () => ({ slots: SLOTS_ASKED(), missed: missedSlots, historiesPending: feed.events.filter(e => e.known && e.history === false && asked.has(e.ticker) && history.get(e.ticker) !== 'miss').length }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}

/** True when a name's past reports were asked for and did not come back — it is done, not still reading */
export const historyMissed = (ticker: string): boolean => history.get(ticker.toUpperCase()) === 'miss';

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
  const version = useSyncExternalStore(subscribeQuiet, () => rev, () => rev);
  /* the board's row when the fortnight is already read — this hook never starts that read */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => (feed.status === 'live' ? feed.events : []), [version]);
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
  const version = useSyncExternalStore(subscribeQuiet, () => rev, () => rev);
  const sym = ticker?.trim().toUpperCase() || '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => !!sym && !history.has(sym), [sym, version]);
}

export function useLiveDossier(ticker: string): { status: 'loading' | 'live' | 'sim'; dossier: EarningsDossier | null } {
  const sym = ticker.trim().toUpperCase();
  const version = useSyncExternalStore(subscribeQuiet, () => rev, () => rev);
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
         the print was priced against, stale once it is out (TSLA's cards measured from $386.55 after a $373.63 close).
         THE REFERENCE BY PHASE (audit round 7: PG's $160 call read "−2.4% from spot" off the 163.87 pre-market print;
         from the 165.59 regular close it is −3.4%): in the session, the last price; outside it — before the open, after
         the bell, a weekend, or a regular bar from an earlier New York day — the last regular close (the quote's
         prev_close), which is what the contracts' marks were struck against. The card says which it is. */
      return uwCall(`/stock/${encodeURIComponent(sym)}/stock-state`, true)
        .then(res => {
          const st = (res.data ?? null) as { close?: string; prev_close?: string; market_time?: string; tape_time?: string } | null;
          const last = Number(st?.close);
          const prev = Number(st?.prev_close);
          const tapeMs = Date.parse(String(st?.tape_time ?? ''));
          const inSession = phaseOf(st?.market_time) === 'regular' && (!Number.isFinite(tapeMs) || nyIsoDate(tapeMs) === nyIsoDate());
          if (inSession && last > 0) return { spot: last, word: 'the last price' };
          if (prev > 0) {
            const today = nyToday();
            const session = (iso: string) => weekdayOf(iso) !== 0 && weekdayOf(iso) !== 6 && !MARKET_HOLIDAYS.has(iso);
            let day = phaseOf(st?.market_time) === 'post' && session(today) && Number.isFinite(tapeMs) && nyIsoDate(tapeMs) === nyIsoDate() ? today : addDays(today, -1);
            for (let i = 0; i < 7 && !session(day); i++) day = addDays(day, -1);
            return { spot: prev, word: `the ${shortDay(day)} close` };
          }
          return { spot: last > 0 ? last : upcoming ? priceOf(upcoming) : 0, word: 'the last price' };
        })
        .catch(() => ({ spot: upcoming ? priceOf(upcoming) : 0, word: 'the calendar price' }))
        .then(ref => pullContracts(sym, ref.spot, true, ref.word)).then(() => {
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
    if (rows === 'miss') return { status: 'sim' as const, dossier: null };
    return { status: 'loading' as const, dossier: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, version]);
}

/** The fortnight's reports as far as they are read, WITHOUT starting the read (round 8: the News page's "Next print"
    looks at them once the calendar below the wire has asked for them — the headlines go first) */
export function useEveryReportQuiet(): { status: 'loading' | 'live' | 'sim'; events: EarningsEvent[] } {
  const version = useSyncExternalStore(subscribeQuiet, () => rev, () => rev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ status: feed.status as 'loading' | 'live' | 'sim', events: feed.status === 'live' ? feed.events : [] }), [version]);
}

/* THE NEXT PRINT, READ NARROW (round 9: the News page's "Next print" chip had the whole fortnight read — ~25 calendar
   pages — to name one report). Until the fortnight is read (the calendar below asks for it once it is on screen), the
   chip reads today's two lists and the next session's before-the-open list, the first page of each — three calls. */
let near: { status: 'loading' | 'live' | 'sim'; events: EarningsEvent[] } = { status: 'loading', events: [] };
let nearStarted = false;
function ensureNear(): void {
  if (nearStarted || typeof window === 'undefined') return;
  nearStarted = true;
  const today = nyToday();
  let next = addDays(today, 1);
  for (let i = 0; i < 10 && (weekdayOf(next) === 0 || weekdayOf(next) === 6 || MARKET_HOLIDAYS.has(next)); i++) next = addDays(next, 1);
  const asks: [('premarket' | 'afterhours'), string][] = [['premarket', today], ['afterhours', today], ['premarket', next]];
  const session = weekdayOf(today) !== 0 && weekdayOf(today) !== 6 && !MARKET_HOLIDAYS.has(today);
  void Promise.all((session ? asks : asks.slice(2)).map(([slot, date]) => whalesEarningsSlot(slot, date).catch(() => null)))
    .then(lists => {
      const seen = new Set<string>();
      const events: EarningsEvent[] = [];
      for (const rows of lists) {
        for (const row of Array.isArray(rows) ? (rows as SlotRow[]) : []) {
          const ev = baseEvent(row, today);
          if (!ev || seen.has(`${ev.ticker}-${ev.iso}`)) continue;
          seen.add(`${ev.ticker}-${ev.iso}`);
          events.push(ev);
        }
      }
      near = { status: lists.some(l => Array.isArray(l)) ? 'live' : 'sim', events };
      emit();
    });
}
/** The reports of today and the next session — the fortnight's when it is read, else three narrow reads */
export function useNearReports(): { status: 'loading' | 'live' | 'sim'; events: EarningsEvent[]; fortnight: boolean } {
  const version = useSyncExternalStore(subscribeQuiet, () => rev, () => rev);
  useEffect(() => {
    if (feed.status !== 'live') ensureNear();
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (feed.status === 'live' ? { status: 'live' as const, events: feed.events, fortnight: true } : { ...near, fortnight: false }), [version]);
}
