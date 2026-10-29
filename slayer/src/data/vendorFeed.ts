/* One shared book per name or page for the extra vendor routes; a failed route stays an error row. */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { nyClock, nyParts } from '../core/nyTime';
import { houseNameFromSlug } from './liveFiles';
import { setLiveCatalysts, setLiveFda, setLivePosts, setLiveSchedule, type CalEvent } from './monthCalendar';
import { setFlexBook } from './oiHeat';
import { uwCall } from './whales';
import { nyIsoDaysBack } from './nyDate';
import { SIM_DESK } from './deskMode';

export type VendorState = 'loading' | 'live' | 'empty' | 'error';

export interface VendorRow {
  id: string;
  label: string;
  path: string;
  state: VendorState;
  brief: string;
  n: number;
  data: unknown;
  /** Epoch ms of the last print that landed. Absent until the first success. */
  okAt?: number;
  /** The last ask failed. A print already on the row is kept. */
  fault?: 'down' | 'failed' | null;
}

export interface VendorBook {
  key: string;
  rows: VendorRow[];
}

interface Job {
  id: string;
  label: string;
  path: string;
  kind: 'uw';
}

const listeners = new Set<() => void>();
const books = new Map<string, VendorBook>();
const started = new Set<string>();
const EMPTY_BOOK: VendorBook = { key: '', rows: [] };

const emit = () => listeners.forEach(fn => fn());
const enc = (s: string) => encodeURIComponent(s);

function asRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** A row's date or time, from the first field that carries one — to tell which end of a list is newest */
const STAMP_KEYS = ['date', 'market_date', 'timestamp', 'executed_at', 'created_at', 'filing_date', 'transaction_date', 'time', 'start_time', 'report_date'];
function stampOf(row: unknown): number | null {
  if (!row || typeof row !== 'object') return null;
  for (const k of STAMP_KEYS) {
    const v = (row as Record<string, unknown>)[k];
    if (typeof v === 'string' || typeof v === 'number') {
      const t = typeof v === 'number' ? v : Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

/** Keep the newest `cap` rows. Some vendor routes answer oldest-first, others newest-first (shorts data, FTDs,
 *  short volume), so cutting from the tail kept the oldest rows on those. */
function keepNewest<T>(rows: T[], cap: number): T[] {
  if (rows.length <= cap) return rows;
  const a = stampOf(rows[0]);
  const b = stampOf(rows[rows.length - 1]);
  return a != null && b != null && a > b ? rows.slice(0, cap) : rows.slice(rows.length - cap);
}

function clip(data: unknown): unknown {
  const cap = 600;
  if (Array.isArray(data)) return keepNewest(data, cap);
  if (data && typeof data === 'object') {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      next[k] = Array.isArray(v) ? keepNewest(v, 24) : v;
    }
    return next;
  }
  return data;
}

function briefOf(data: unknown): { n: number; brief: string; empty: boolean } {
  const rows = asRows(data).filter(r => r != null && r !== '');
  if (rows.length === 0) return { n: 0, brief: 'empty', empty: true };
  const first = rows[0];
  if (first && typeof first === 'object') {
    const o = first as Record<string, unknown>;
    const contract = o.contract && typeof o.contract === 'object' ? (o.contract as Record<string, unknown>) : null;
    const ticks = Array.isArray(o.data) ? o.data : null;
    const tick = ticks && ticks[0] && typeof ticks[0] === 'object' ? (ticks[0] as Record<string, unknown>) : null;
    const source = contract && tick ? { ...contract, ...tick } : o;
    const parts = Object.entries(source)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .slice(0, 4)
      .map(([k, v]) => `${k} ${String(v).slice(0, 32)}`);
    return { n: Array.isArray(data) ? data.length : 1, brief: parts.join(' · ') || 'row', empty: false };
  }
  return { n: rows.length, brief: String(first).slice(0, 120), empty: false };
}

function paint(key: string, id: string, patch: Partial<VendorRow>) {
  const book = books.get(key);
  if (!book) return;
  const rows = book.rows.some(r => r.id === id)
    ? book.rows.map(r => (r.id === id ? { ...r, ...patch } : r))
    : [...book.rows, { id, label: id, path: '', state: 'loading' as const, brief: '', n: 0, data: null, ...patch }];
  books.set(key, { key, rows });
  emit();
}

function faultOf(error: string, status: number): 'down' | 'failed' {
  const s = error.toLowerCase();
  if (status === 503 || status === 0 || s.includes('terminal_down') || s.includes('not running') || s.includes('thetadata') || s.includes('theta terminal')) return 'down';
  return 'failed';
}

const FAULT_WORDS = { down: 'Quote desk is down', failed: 'This read did not land' } as const;

async function runJob(key: string, job: Job): Promise<unknown> {
  const res = await uwCall(job.path);
  if (res.error) {
    const fault = faultOf(res.error, res.status);
    const prior = books.get(key)?.rows.find(r => r.id === job.id);
    const keep = !!(prior && prior.data != null && (prior.state === 'live' || prior.okAt));
    paint(key, job.id, {
      state: keep ? 'live' : 'error',
      brief: FAULT_WORDS[fault],
      fault,
      n: keep ? prior!.n : 0,
      path: job.path,
      label: job.label,
      ...(keep ? {} : { data: null }),
    });
    return null;
  }
  const view = briefOf(res.data);
  paint(key, job.id, {
    state: view.empty ? 'empty' : 'live',
    brief: view.brief,
    n: view.n,
    data: clip(res.data),
    path: job.path,
    label: job.label,
    okAt: Date.now(),
    fault: null,
  });
  return res.data;
}

async function pool(key: string, jobs: Job[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      out.set(job.id, await runJob(key, job));
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  return out;
}

function sectorOf(data: unknown): string | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const s = (row as Record<string, unknown>).sector ?? (row as Record<string, unknown>).sector_name;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

function expiryOf(data: unknown): string | null {
  for (const r of asRows(data)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    for (const k of ['expiry', 'expiration', 'expiry_date']) {
      const v = o[k];
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    }
  }
  return null;
}

function osiStrike(sym: string): number | null {
  const m = sym.replace(/\s/g, '').match(/(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  return Number(m[3]) / 1000;
}

function chainOf(data: unknown): { id: string; strike: number | null } | null {
  for (const r of asRows(data)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = o.option_symbol ?? o.chain ?? o.symbol;
    if (typeof id === 'string' && id.length > 3) return { id, strike: num(o.strike) ?? osiStrike(id) };
  }
  return null;
}

function flexTransfers(data: unknown): Map<number, number> {
  const by = new Map<number, number>();
  for (const r of asRows(data)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const strike = num(o.strike) ?? (typeof o.option_symbol === 'string' ? osiStrike(o.option_symbol) : null);
    const oi = num(o.open_interest);
    const prev = num(o.prev_oi);
    if (strike == null || oi == null || prev == null) continue;
    by.set(strike, (by.get(strike) ?? 0) + (oi - prev));
  }
  return by;
}

function dayFrom(raw: unknown): Date | null {
  const iso = String(raw ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return null;
  return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 10, 0, 0);
}

function applyFda(data: unknown) {
  const events = [];
  for (const r of asRows(data)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const date = dayFrom(o.start_date) ?? dayFrom(o.end_date) ?? dayFrom(o.target_date) ?? dayFrom(o.date);
    if (!date) continue;
    const ticker = String(o.ticker ?? '').toUpperCase();
    const what = String(o.drug || o.catalyst || o.description || 'FDA');
    events.push({
      id: `fda-live-${ticker}-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${events.length}`,
      kind: 'fda' as const,
      date,
      time: '10:00',
      title: ticker ? `${ticker} · ${what}` : what,
      impact: 'high' as const,
      region: 'USD',
      ticker: ticker || undefined,
      note: String(o.notes || o.indication || what),
    });
  }
  setLiveFda(events);
}

function clockOf(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) return nyClock(raw > 1e12 ? raw : raw * 1000);
  const s = String(raw ?? '');
  const t = Date.parse(s);
  return Number.isFinite(t) ? nyClock(t) : '';
}

function applySchedule(data: unknown) {
  const events: CalEvent[] = [];
  for (const r of asRows(data)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const date = dayFrom(o.date) ?? dayFrom(o.time);
    if (!date) continue;
    const time = clockOf(o.time) || clockOf(o.date);
    events.push({
      id: `sched-${String(o.date ?? '')}-${events.length}`,
      kind: 'schedule',
      date,
      time: time || '—',
      title: String(o.details || o.type || 'On the schedule'),
      impact: 'low',
      note: o.location ? String(o.location) : undefined,
    });
  }
  setLiveSchedule(events);
}

function applyPosts(data: unknown) {
  const events: CalEvent[] = [];
  for (const r of asRows(data)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const ms = num(o.timestamp);
    if (ms == null) continue;
    const at = ms > 1e12 ? ms : ms * 1000;
    const p = nyParts(at);
    const text = String(o.post ?? '').trim();
    if (!text) continue;
    events.push({
      id: `post-${at}-${events.length}`,
      kind: 'post',
      date: new Date(p.year, p.month - 1, p.day, p.hour, p.minute),
      time: nyClock(at),
      title: text,
      impact: 'low',
    });
  }
  setLivePosts(events);
}

function figureOf(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const a = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(0)}k`;
  }
  return s;
}

const MONTH_NAME = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i;

function applyCatalysts(data: unknown) {
  const root = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const box = root && root.catalysts && typeof root.catalysts === 'object' ? (root.catalysts as Record<string, unknown>) : null;
  const rows = Array.isArray(box?.data) ? box.data : [];
  const events: CalEvent[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const date = dayFrom(o.date) ?? dayFrom(o.datetime);
    if (!date) continue;
    const meta = o.meta && typeof o.meta === 'object' ? (o.meta as Record<string, unknown>) : {};
    if (o.type === 'earnings') {
      const ticker = String(o.ticker ?? '').toUpperCase();
      if (!ticker) continue;
      /* the catalyst's own time, or none; the row carries no source, so it never claims the date is confirmed */
      const when = `${String(meta.report_time ?? '')} ${String(o.subtitle ?? '')}`.toLowerCase();
      const pre = /pre|before/.test(when);
      const post = /post|after/.test(when);
      const move = num(meta.expected_move_perc);
      events.push({
        id: `er-live-${ticker}-${String(o.date ?? '').slice(0, 10)}-${events.length}`,
        kind: 'earnings',
        date,
        time: pre ? 'before the open' : post ? 'after the close' : 'time not set',
        title: `${ticker} reports`,
        impact: move != null && Math.abs(move) * (Math.abs(move) <= 3 ? 100 : 1) >= 7 ? 'high' : 'medium',
        ticker,
        slot: pre ? 'BMO' : 'AMC',
        timeKnown: pre || post,
        catalystOnly: true,
        impliedMovePct: move == null ? undefined : Math.abs(move) <= 3 ? move * 100 : move,
      });
    } else if (o.type === 'econ') {
      const sub = String(o.subtitle ?? '').trim();
      const period = MONTH_NAME.test(sub) ? sub : '';
      const bank = meta.central_bank != null ? String(meta.central_bank) : '';
      const title = String(o.title || 'Data');
      events.push({
        id: `macro-live-${title}-${String(o.date ?? '')}-${events.length}`,
        kind: 'macro',
        date,
        time: clockOf(o.datetime) || '',
        title: period ? `${title} · ${period}` : title,
        impact: /rate|cpi|payroll|fomc/i.test(title) ? 'high' : 'medium',
        region: period ? 'USD' : sub || bank || 'USD',
        forecast: figureOf(meta.forecast),
        previous: figureOf(meta.prev),
      });
    }
  }
  setLiveCatalysts(events);
}

function politician(data: unknown, id: string): { id: string; name: string } | null {
  const want = decodeURIComponent(id).replace(/-/g, ' ').trim().toLowerCase();
  for (const r of asRows(data)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const pid = String(o.politician_id ?? '');
    const name = String(o.name ?? '');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (pid && pid === id) return { id: pid, name };
    if (name && (name.toLowerCase() === want || slug === id.toLowerCase())) return { id: pid || id, name };
  }
  return null;
}

function seed(key: string, jobs: Job[]) {
  books.set(key, {
    key,
    rows: jobs.map(j => ({ id: j.id, label: j.label, path: j.path, state: 'loading' as const, brief: '', n: 0, data: null })),
  });
}

function pinJobs(t: string): Job[] {
  const e = enc(t);
  /* Unusual Whales only: the carry rate and the holidays fall back to core/carry and core/calendar */
  return [
    { id: 'gex-levels', label: 'GEX levels', path: `/stock/${e}/gex-levels`, kind: 'uw' },
    { id: 'gex-minute', label: 'GEX each minute', path: `/stock/${e}/spot-exposures`, kind: 'uw' },
    { id: 'gex-strike', label: 'GEX by strike', path: `/stock/${e}/spot-exposures/strike`, kind: 'uw' },
    { id: 'gex-expiry-strike', label: 'GEX by strike and expiry', path: `/stock/${e}/spot-exposures/expiry-strike?limit=200`, kind: 'uw' },
    { id: 'greek-flow', label: 'Delta and vega flow each minute', path: `/stock/${e}/greek-flow`, kind: 'uw' },
    { id: 'greek-flow-expiry', label: 'Delta and vega flow by expiry', path: '', kind: 'uw' },
    { id: 'flow-expiry', label: 'Flow per expiry', path: `/stock/${e}/flow-per-expiry`, kind: 'uw' },
    { id: 'flow-strike-min', label: 'Flow per strike each minute', path: `/stock/${e}/flow-per-strike-intraday`, kind: 'uw' },
    { id: 'oi-change', label: "Day's open-interest change", path: `/stock/${e}/oi-change?limit=40`, kind: 'uw' },
    { id: 'oi-expiry', label: 'Open interest per expiry', path: `/stock/${e}/oi-per-expiry`, kind: 'uw' },
    { id: 'vol-oi-expiry', label: 'Volume and open interest per expiry', path: `/stock/${e}/option/volume-oi-expiry`, kind: 'uw' },
    { id: 'flex-list', label: 'FLEX contracts', path: `/flex-options?ticker_symbol=${e}`, kind: 'uw' },
    { id: 'flex-one', label: 'FLEX one contract', path: '', kind: 'uw' },
    { id: 'flex-ticker', label: "Ticker's FLEX history", path: `/flex-options/${e}`, kind: 'uw' },
    { id: 'flex-market', label: 'FLEX market overview', path: '/flex-options/market', kind: 'uw' },
    { id: 'skew', label: '25Δ and 10Δ risk-reversal skew', path: `/stock/${e}/historical-risk-reversal-skew`, kind: 'uw' },
    { id: 'max-pain', label: 'Max pain', path: `/stock/${e}/max-pain`, kind: 'uw' },
    { id: 'nope', label: 'NOPE', path: `/stock/${e}/nope`, kind: 'uw' },
    { id: 'prem', label: 'Net-premium ticks', path: `/stock/${e}/net-prem-ticks`, kind: 'uw' },
    { id: 'atm', label: 'At-the-money chains', path: '', kind: 'uw' },
    { id: 'rv', label: 'Realized volatility', path: `/stock/${e}/volatility/realized`, kind: 'uw' },
    { id: 'vstats', label: 'Volatility statistics', path: `/stock/${e}/volatility/stats`, kind: 'uw' },
    { id: 'iv', label: 'Interpolated IV', path: `/stock/${e}/interpolated-iv`, kind: 'uw' },
    { id: 'iv-dist', label: '1-year interpolated-IV range', path: `/stock/${e}/interpolated-iv/distribution`, kind: 'uw' },
    { id: 'term-dist', label: 'Term-structure distribution', path: `/stock/${e}/volatility/term-structure/distribution`, kind: 'uw' },
    { id: 'vanom', label: 'Volatility anomaly', path: `/stock/${e}/volatility/anomaly`, kind: 'uw' },
    { id: 'vchar', label: 'Volatility character', path: `/stock/${e}/volatility/character`, kind: 'uw' },
    { id: 'vctx', label: 'Volatility context', path: `/stock/${e}/volatility/context`, kind: 'uw' },
    { id: 'sent', label: 'Options positioning sentiment', path: `/stock/${e}/volatility/option-sentiment`, kind: 'uw' },
    { id: 'rv-win', label: 'Realized-volatility windows', path: `/stock/${e}/volatility/realized/windows`, kind: 'uw' },
    { id: 'vrp', label: 'Variance risk premium', path: `/stock/${e}/volatility/variance-risk-premium`, kind: 'uw' },
    { id: 'vrp-win', label: 'VRP windows', path: `/stock/${e}/volatility/variance-risk-premium/windows`, kind: 'uw' },
    { id: 'quote', label: 'Quote', path: `/stock/${e}/quote`, kind: 'uw' },
    { id: 'opt-vol', label: 'Option volume and premium', path: `/stock/${e}/options-volume`, kind: 'uw' },
    { id: 'opt-px', label: 'Option volume by price', path: `/stock/${e}/option/stock-price-levels`, kind: 'uw' },
    { id: 'lit-off', label: 'Lit versus off-lit volume by price', path: `/stock/${e}/stock-volume-price-levels`, kind: 'uw' },
    { id: 'unusual', label: 'Unusual volume vs ~90 sessions', path: `/stock/${e}/unusualness`, kind: 'uw' },
  ];
}

function stockJobs(t: string): Job[] {
  const e = enc(t);
  const month = new Date().getMonth() + 1;
  return [
    { id: 'info', label: 'Sector of the name', path: `/stock/${e}/info`, kind: 'uw' },
    { id: 'oi-expiry', label: 'Open interest per expiry', path: `/stock/${e}/oi-per-expiry`, kind: 'uw' },
    { id: 'sector-names', label: 'Companies in the same sector', path: '', kind: 'uw' },
    { id: 'bs', label: 'Balance sheet', path: `/stock/${e}/balance-sheets`, kind: 'uw' },
    { id: 'cf', label: 'Cash flow', path: `/stock/${e}/cash-flows`, kind: 'uw' },
    { id: 'is', label: 'Income statement', path: `/stock/${e}/income-statements`, kind: 'uw' },
    { id: 'fin', label: 'Full financials', path: `/stock/${e}/financials`, kind: 'uw' },
    { id: 'fund', label: 'Fundamental breakdown', path: `/stock/${e}/fundamental-breakdown`, kind: 'uw' },
    { id: 'analysts', label: 'Analyst ratings', path: `/screener/analysts?ticker=${e}&limit=20`, kind: 'uw' },
    { id: 'seas-m', label: 'Seasonality, average month', path: `/seasonality/${e}/monthly`, kind: 'uw' },
    { id: 'seas-y', label: 'Seasonality, month by year', path: `/seasonality/${e}/year-month`, kind: 'uw' },
    { id: 'seas-mkt', label: 'Seasonality, market average month', path: '/seasonality/market', kind: 'uw' },
    { id: 'seas-best', label: 'Best names in this month', path: `/seasonality/${month}/performers?limit=12`, kind: 'uw' },
    { id: 'opt-hold', label: 'Who holds the options', path: `/institution/${e}/option-holders`, kind: 'uw' },
    { id: 'inst-own', label: 'Institutional ownership', path: `/institution/${e}/ownership`, kind: 'uw' },
    { id: 'etf-exposure', label: 'Which ETFs hold the name', path: `/etfs/${e}/exposure`, kind: 'uw' },
    { id: 'lit', label: 'Lit prints', path: `/lit-flow/${e}?limit=40`, kind: 'uw' },
    { id: 'dp-px', label: 'Dark-pool volume by price', path: `/darkpool/${e}/price-levels`, kind: 'uw' },
    { id: 'lit-off', label: 'Lit versus off-lit by price', path: `/stock/${e}/stock-volume-price-levels`, kind: 'uw' },
    { id: 'ins-t', label: "The name's insiders", path: `/insider/${e}`, kind: 'uw' },
    { id: 'ins-flow', label: 'Insider flow for the name', path: `/insider/${e}/ticker-flow`, kind: 'uw' },
    { id: 'ins-filings', label: 'Insider filings for the name', path: `/insider/transactions?ticker_symbol=${e}`, kind: 'uw' },
    ...volJobs(t),
  ];
}

function volJobs(t: string): Job[] {
  const e = enc(t);
  return [
    { id: 'vstats', label: 'Volatility statistics', path: `/stock/${e}/volatility/stats`, kind: 'uw' },
    { id: 'iv', label: 'Interpolated IV', path: `/stock/${e}/interpolated-iv`, kind: 'uw' },
    { id: 'iv-dist', label: '1-year interpolated-IV range', path: `/stock/${e}/interpolated-iv/distribution`, kind: 'uw' },
    { id: 'term-dist', label: 'Term-structure distribution', path: `/stock/${e}/volatility/term-structure/distribution`, kind: 'uw' },
    { id: 'vanom', label: 'Volatility anomaly', path: `/stock/${e}/volatility/anomaly`, kind: 'uw' },
    { id: 'vchar', label: 'Volatility character', path: `/stock/${e}/volatility/character`, kind: 'uw' },
    { id: 'vctx', label: 'Volatility context', path: `/stock/${e}/volatility/context`, kind: 'uw' },
    { id: 'sent', label: 'Options positioning sentiment', path: `/stock/${e}/volatility/option-sentiment`, kind: 'uw' },
    { id: 'si', label: 'Short interest and float v2', path: `/shorts/${e}/interest-float/v2`, kind: 'uw' },
  ];
}

function routeTicker(pathname: string, deskTicker: string): string {
  const parts = pathname.split('?')[0].split('/').filter(Boolean);
  if (parts[0] === 'dossier' && parts[2] && (parts[1] === 'stocks' || parts[1] === 'shorts' || parts[1] === 'earnings' || parts[1] === 'etfs')) {
    return decodeURIComponent(parts[2]).toUpperCase();
  }
  return (deskTicker || '').toUpperCase();
}

function jobsFor(desk: 'pinpoint' | 'dossier', ticker: string, pathname: string): Job[] {
  const t = routeTicker(pathname, ticker);
  const e = t ? enc(t) : '';
  if (desk === 'pinpoint') return t ? pinJobs(t) : [];
  const path = pathname.split('?')[0];
  if (path.startsWith('/dossier/news')) {
    return [
      { id: 'fda', label: 'FDA calendar', path: '/market/fda-calendar?limit=80', kind: 'uw' },
      { id: 'daily', label: 'Daily market report', path: '/market/daily-report', kind: 'uw' },
      { id: 'potus-p', label: "President's posts", path: '/potus/posts', kind: 'uw' },
      { id: 'potus-s', label: 'Public schedule', path: '/potus/schedule', kind: 'uw' },
    ];
  }
  if (path.startsWith('/dossier/shorts')) return t ? [
    { id: 'si', label: 'Short interest and float v2', path: `/shorts/${e}/interest-float/v2`, kind: 'uw' },
    { id: 'rebate', label: 'Rebate and shares available', path: `/shorts/${e}/data`, kind: 'uw' },
    { id: 'ftd', label: 'Failures to deliver', path: `/shorts/${e}/ftds`, kind: 'uw' },
    { id: 'svr', label: 'Short volume and ratio', path: `/shorts/${e}/volume-and-ratio`, kind: 'uw' },
    { id: 'svx', label: 'Short volume by exchange', path: `/shorts/${e}/volumes-by-exchange`, kind: 'uw' },
  ] : [];
  if (path.startsWith('/dossier/insiders')) return t ? [
    { id: 'info', label: 'Sector of the name', path: `/stock/${e}/info`, kind: 'uw' },
    { id: 'ins-t', label: "The name's insiders", path: `/insider/${e}`, kind: 'uw' },
    { id: 'ins-flow', label: 'Insider flow by ticker', path: `/insider/${e}/ticker-flow`, kind: 'uw' },
    { id: 'ins-sec', label: 'Insider flow by sector', path: '', kind: 'uw' },
    { id: 'ins-mkt', label: 'Market insider buys and sells', path: '/market/insider-buy-sells', kind: 'uw' },
  ] : [{ id: 'ins-mkt', label: 'Market insider buys and sells', path: '/market/insider-buy-sells', kind: 'uw' }];
  if (path.startsWith('/dossier/congress')) {
    const member = path.split('/')[3] ?? '';
    const rows: Job[] = [
      { id: 'late', label: 'Late reports', path: '/congress/late-reports?limit=40', kind: 'uw' },
    ];
    if (member) {
      rows.unshift({ id: 'people', label: 'Politicians', path: '/congress/politicians?last_traded_within_months=24', kind: 'uw' });
      rows.push({ id: 'member-reports', label: "This member's reports", path: '', kind: 'uw' });
    } else {
      rows.unshift({ id: 'member-reports', label: 'Member reports', path: '/congress/congress-trader?limit=30', kind: 'uw' });
    }
    return rows;
  }
  if (path.startsWith('/dossier/institutions')) {
    const house = path.split('/')[3] ?? '';
    if (!house) return [];
    const name = houseNameFromSlug(house) || decodeURIComponent(house).replace(/-/g, ' ');
    return [{ id: 'sectors', label: 'Sector exposure', path: `/institution/${enc(name)}/sectors`, kind: 'uw' }];
  }
  if (path.startsWith('/dossier/etfs')) {
    const etf = (path.split('/')[3] || t || '').toUpperCase();
    const rows: Job[] = [];
    if (etf) rows.push({ id: 'weights', label: 'Sector and country weights', path: `/etfs/${enc(etf)}/weights`, kind: 'uw' });
    if (t) rows.push({ id: 'etf-exposure', label: 'Which ETFs hold the name', path: `/etfs/${e}/exposure`, kind: 'uw' });
    return rows;
  }
  if (path.startsWith('/dossier/earnings')) {
    if (!t) return [];
    const e = enc(t);
    return [
      { id: 'vstats', label: 'Volatility statistics', path: `/stock/${e}/volatility/stats`, kind: 'uw' },
      { id: 'term-dist', label: 'Term-structure distribution', path: `/stock/${e}/volatility/term-structure/distribution`, kind: 'uw' },
    ];
  }
  if (path.startsWith('/dossier/stocks')) return t ? stockJobs(t) : [];
  return [];
}

export function vendorKey(desk: 'pinpoint' | 'dossier', ticker: string, pathname: string): string {
  const path = pathname.split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const t = routeTicker(path, ticker);
  if (desk === 'pinpoint') return `pin:${t || 'none'}:2`;
  const page = parts[1] || 'index';
  const id = parts[2] || '';
  if (page === 'earnings') return `dos:earnings:${t || 'none'}:4`;
  if (page === 'stocks' || page === 'shorts' || page === 'etfs') return `dos:${page}:${t || 'none'}:2`;
  if (page === 'congress') return `dos:congress:${id || 'list'}:2`;
  if (page === 'news') return 'dos:news:2';
  if (page === 'institutions') return `dos:institutions:${id || 'list'}:${t || 'none'}:3`;
  if (page === 'insiders') return `dos:insiders:${id || 'list'}:${t || 'none'}:2`;
  return `dos:${page}:${t || 'none'}:2`;
}

export function stockBookKey(ticker: string): string {
  return vendorKey('dossier', ticker, `/dossier/stocks/${ticker}`);
}

async function after(key: string, ticker: string, pathname: string, got: Map<string, unknown>) {
  const t = routeTicker(pathname, ticker);
  if (got.has('fda')) applyFda(got.get('fda'));
  if (got.has('potus-s')) applySchedule(got.get('potus-s'));
  if (got.has('potus-p')) applyPosts(got.get('potus-p'));
  if (got.has('daily')) applyCatalysts(got.get('daily'));
  if (books.get(key)?.rows.some(r => r.id === 'flex-list')) setFlexBook(flexTransfers(got.get('flex-list')));

  if (books.get(key)?.rows.some(r => r.id === 'sector-names')) {
    const sector = sectorOf(got.get('info'));
    if (!sector) paint(key, 'sector-names', { state: 'error', brief: 'stock info has no sector', n: 0, data: null });
    else await runJob(key, { id: 'sector-names', label: 'Companies in the same sector', path: `/stock/${enc(sector)}/tickers`, kind: 'uw' });
  }
  if (books.get(key)?.rows.some(r => r.id === 'ins-sec')) {
    const sector = sectorOf(got.get('info'));
    if (!sector) paint(key, 'ins-sec', { state: 'error', brief: 'stock info has no sector', n: 0, data: null });
    else await runJob(key, { id: 'ins-sec', label: 'Insider flow by sector', path: `/insider/${enc(sector)}/sector-flow`, kind: 'uw' });
  }
  if (books.get(key)?.rows.some(r => r.id === 'atm')) {
    const expiry = expiryOf(got.get('oi-expiry'));
    if (!expiry) paint(key, 'atm', { state: 'empty', brief: 'no expiry to ask the at-the-money chain for', n: 0, data: null });
    else got.set('atm', await runJob(key, { id: 'atm', label: 'At-the-money chains', path: `/stock/${enc(t)}/atm-chains?expirations[]=${expiry}`, kind: 'uw' }));
  }
  if (books.get(key)?.rows.some(r => r.id === 'greek-flow-expiry')) {
    const expiry = expiryOf(got.get('atm')) ?? expiryOf(got.get('oi-expiry'));
    if (!expiry) paint(key, 'greek-flow-expiry', { state: 'empty', brief: 'no expiry on the chain yet', n: 0, data: null });
    else await runJob(key, { id: 'greek-flow-expiry', label: 'Delta and vega flow by expiry', path: `/stock/${enc(t)}/greek-flow/${enc(expiry)}`, kind: 'uw' });
  }
  if (books.get(key)?.rows.some(r => r.id === 'flex-one')) {
    const chain = chainOf(got.get('flex-list'));
    if (!chain) paint(key, 'flex-one', { state: 'empty', brief: 'no FLEX contract on this name', n: 0, data: null });
    else await runJob(key, { id: 'flex-one', label: 'FLEX one contract', path: `/flex-options/chain/${enc(chain.id)}`, kind: 'uw' });
  }
  if (pathname.includes('/dossier/congress/')) {
    const member = pathname.split('?')[0].split('/')[3] ?? '';
    const who = politician(got.get('people'), member);
    const name = who?.name || decodeURIComponent(member).replace(/-/g, ' ');
    if (books.get(key)?.rows.some(r => r.id === 'member-reports')) {
      /* the trades made in the last year, the first page of the member page's own read (data/liveRecord.ts
         memberReportsPath) — the same address, so the proxy answers both with one call */
      await runJob(key, { id: 'member-reports', label: "This member's reports", path: `/congress/congress-trader?name=${enc(name)}&date_from=${nyIsoDaysBack(365)}&limit=200`, kind: 'uw' });
    }
  }
}

function start(desk: 'pinpoint' | 'dossier', ticker: string, pathname: string) {
  const key = vendorKey(desk, ticker, pathname);
  if (started.has(key)) return;
  started.add(key);
  const jobs = jobsFor(desk, ticker, pathname);
  if (jobs.length === 0) {
    books.set(key, { key, rows: [{ id: 'none', label: 'Feed', path: '', state: 'empty', brief: 'No name on the desk', n: 0, data: null }] });
    return;
  }
  seed(key, jobs);
  const ready = jobs.filter(j => j.path);
  void (async () => {
    const got = await pool(key, ready);
    await after(key, ticker, pathname, got);
  })();
}

/** Pinpoint's book starts the same feed the ledger renders. */
export function startPinpoint(ticker: string) {
  if (SIM_DESK || !ticker) return;
  start('pinpoint', ticker, '/pinpoint/map');
}

export function useVendor(desk: 'pinpoint' | 'dossier', ticker: string, pathname: string): VendorBook {
  const key = vendorKey(desk, ticker, pathname);
  const ref = useRef({ desk, ticker, pathname });
  ref.current = { desk, ticker, pathname };
  const subscribe = useCallback((fn: () => void) => {
    listeners.add(fn);
    start(ref.current.desk, ref.current.ticker, ref.current.pathname);
    return () => listeners.delete(fn);
  }, [key]);
  return useSyncExternalStore(subscribe, () => books.get(key) ?? EMPTY_BOOK, () => books.get(key) ?? EMPTY_BOOK);
}

const rowCache = new Map<string, VendorRow | null>();

function rowOf(key: string, id: string): VendorRow | null {
  const row = books.get(key)?.rows.find(r => r.id === id) ?? null;
  const cacheKey = `${key}|${id}`;
  if (rowCache.get(cacheKey) === row) return rowCache.get(cacheKey) ?? null;
  rowCache.set(cacheKey, row);
  return row;
}

export function useVendorRow(key: string, id: string): VendorRow | null {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rowOf(key, id),
    () => rowOf(key, id),
  );
}
