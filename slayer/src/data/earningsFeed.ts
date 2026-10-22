/*
  The earnings calendar off Unusual Whales. A miss or an empty fortnight
  stays empty — never a sample of invented names.
*/

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Sector } from './universe';
import { lookup } from './universe';
import { decide, isKnownName, type ActiveContract, type EarningsDossier, type EarningsEvent, type EarningsQuarter, type NextReport, type ReportSlot } from './earnings';
import { tickerName } from './tickers';
import { whalesEarnings, whalesEarningsSlot, whalesIvRank, whalesOptionContracts, whalesScreener } from './whales';

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
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const nyToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

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

const tradingBetween = (from: string, to: string): number => {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  let n = 0;
  let cur = from;
  for (let i = 0; i < 40 && cur !== to; i++) {
    cur = addDays(cur, sign);
    const day = weekdayOf(cur);
    if (day !== 0 && day !== 6) n += sign;
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

const impliedPct = (raw: unknown): number => {
  const n = Math.abs(num(raw));
  if (!(n > 0)) return 0;
  return n < 1.5 ? n * 100 : n;
};

const priceOf = (r: SlotRow): number => {
  const pre = num(r.pre_earnings_close);
  if (pre > 0) return pre;
  const post = num(r.post_earnings_close);
  if (post > 0) return post;
  const move = num(r.expected_move);
  const pct = num(r.expected_move_perc);
  if (move > 0 && pct > 0) return move / (Math.abs(pct) < 1.5 ? Math.abs(pct) : Math.abs(pct) / 100);
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
    const exp = Math.abs(num(r.expected_move_perc));
    const expPct = exp > 0 && exp < 1.5 ? exp : exp / 100;
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
  for (const row of rows) {
    const parsed = occOf(String(row.option_symbol || ''));
    if (!parsed) continue;
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
    const raw = num(rows?.[0]?.iv_rank_1y);
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

export function dossierFromRows(ticker: string, rows: SlotRow[]): EarningsDossier | null {
  const today = nyToday();
  const sym = ticker.toUpperCase();
  const stamped = rows.map(r => ({ ...r, symbol: r.symbol || sym }));
  const upcoming = stamped
    .filter(r => (r.report_date || '') >= today)
    .sort((a, b) => (a.report_date || '').localeCompare(b.report_date || ''))[0];
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
    const rows = await whalesEarnings(sym, priority);
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
  const want = events.filter(e => e.known && e.history === false).map(e => e.ticker);
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
            try {
              const page0 = await whalesEarningsSlot(slot, date, 0);
              const first = Array.isArray(page0) ? (page0 as SlotRow[]) : [];
              if (first.length < 100) return first;
              const page1 = await whalesEarningsSlot(slot, date, 1).catch(() => [] as Record<string, unknown>[]);
              const more = Array.isArray(page1) ? (page1 as SlotRow[]) : [];
              return more.length ? first.concat(more) : first;
            } catch {
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

/** True only while the fortnight has not answered. An empty live list is not pending. */
export function useEarningsPending(): boolean {
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  return useMemo(() => feed.status === 'loading', [version]);
}

export function useNextReport(ticker: string | null): NextReport | null {
  const events = useEveryReport();
  const version = useSyncExternalStore(subscribe, () => rev, () => rev);
  const sym = ticker?.trim().toUpperCase() || '';
  useEffect(() => {
    if (!sym || events.some(e => e.ticker === sym)) return;
    let dead = false;
    void pullHistory(sym).then(() => {
      if (!dead) emit();
    });
    return () => {
      dead = true;
    };
  }, [sym, events]);
  return useMemo(() => {
    if (!sym) return null;
    const hit = events.find(e => e.ticker === sym);
    if (hit?.iso) {
      return { ticker: sym, name: hit.name, daysOut: hit.daysOut, dateLabel: hit.dateLabel, iso: hit.iso, slot: hit.slot, confirmed: hit.confirmed, event: hit };
    }
    const rows = history.get(sym);
    if (rows && rows !== 'miss') {
      const file = dossierFromRows(sym, rows);
      if (file?.event.iso) {
        const e = file.event;
        const iso = e.iso ?? file.event.iso;
        return { ticker: sym, name: e.name, daysOut: e.daysOut, dateLabel: e.dateLabel, iso, slot: e.slot, confirmed: e.confirmed, event: e };
      }
    }
    return null;
    // version bumps when a history file lands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, events, version]);
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
      const upcoming = rows?.find(r => (r.report_date || '') >= nyToday()) ?? rows?.[0];
      const spot = upcoming ? priceOf(upcoming) : 0;
      return pullContracts(sym, spot, true).then(() => {
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
