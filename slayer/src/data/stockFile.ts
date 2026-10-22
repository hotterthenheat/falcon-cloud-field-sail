/*
  One name's file: daily sessions, the last prints, the flow alerts, the
  off-exchange tape. The stock page reads this. Nothing here is invented.
*/

import { useEffect, useSyncExternalStore } from 'react';
import type { Candle } from '../types/market';
import type { DarkPoolPrint } from '../types/darkpool';
import type { FlowPrint } from '../types/trace';
import { whalesDaily, whalesDarkTicker, whalesEarnings, whalesFlowTicker, whalesScreener, type UwDaily } from './whales';

export interface EarnRow {
  report_date?: string;
  actual_eps?: string | number | null;
  street_mean_est?: string | number | null;
  post_earnings_move_1d?: string | number | null;
  expected_move_perc?: string | number | null;
  /** 'company' when the company set the date; 'estimation' while it is the vendor's estimate */
  source?: string | null;
  report_time?: string | null;
}

export interface StockFile {
  status: 'loading' | 'live' | 'error';
  screen: Record<string, unknown> | null;
  earnings: EarnRow[];
  days: Candle[];
  flow: FlowPrint[];
  dark: DarkPoolPrint[];
  /** Epoch ms of the last print that landed. */
  at?: number;
}

const EMPTY_EARN: EarnRow[] = [];
const EMPTY_DAYS: Candle[] = [];
const EMPTY_FLOW: FlowPrint[] = [];
const EMPTY_DARK: DarkPoolPrint[] = [];
/** One object per status. A fresh object on every read makes useSyncExternalStore
    treat the file as changed and warn that getSnapshot is not cached. */
const LOADING: StockFile = { status: 'loading', screen: null, earnings: EMPTY_EARN, days: EMPTY_DAYS, flow: EMPTY_FLOW, dark: EMPTY_DARK };
const FAILED: StockFile = { status: 'error', screen: null, earnings: EMPTY_EARN, days: EMPTY_DAYS, flow: EMPTY_FLOW, dark: EMPTY_DARK };

const blank = (status: StockFile['status']): StockFile => (status === 'error' ? FAILED : LOADING);

const files = new Map<string, StockFile>();
const listeners = new Set<() => void>();
const started = new Set<string>();

const emit = () => listeners.forEach(fn => fn());

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const clock = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
};

const mmddyyyy = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${m}/${d}/${y}` : iso;
};

const dteOf = (iso: string): number => {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((t - Date.now()) / 86_400_000));
};

function daysFrom(rows: UwDaily[]): Candle[] {
  const byDate = new Map<string, UwDaily>();
  for (const row of rows) {
    const date = row.date?.slice(0, 10);
    if (!date || !(num(row.close) > 0)) continue;
    const prev = byDate.get(date);
    if (!prev || row.market_time === 'r') byDate.set(date, row);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, row]) => {
      const close = num(row.close);
      const time = Math.floor(Date.parse(`${date}T20:00:00Z`) / 1000);
      return {
        time,
        open: num(row.open) || close,
        high: num(row.high) || close,
        low: num(row.low) || close,
        close,
        volume: Math.max(num(row.total_volume), num(row.volume)),
      };
    })
    .filter(c => c.time > 0);
}

/** New York's calendar day — a contract expiring before it is dead and is never listed as busy */
const nyToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function flowsFrom(rows: Record<string, unknown>[], spot: number): FlowPrint[] {
  const today = nyToday();
  /* the flow alerts reach back over days; an alert on a contract that has since expired is not "busy" any more */
  const live = rows.filter(row => {
    const exp = String(row.expiry || '').slice(0, 10);
    return !/^\d{4}-\d{2}-\d{2}$/.test(exp) || exp >= today;
  });
  return live.slice(0, 40).map((row, i) => {
    const prem = num(row.total_premium);
    const ask = num(row.total_ask_side_prem);
    const bid = num(row.total_bid_side_prem);
    const side: FlowPrint['side'] = ask > bid * 1.15 ? 'ASK' : bid > ask * 1.15 ? 'BID' : 'MID';
    const right: FlowPrint['right'] = String(row.type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
    const strike = num(row.strike);
    const expiry = String(row.expiry || '');
    const under = num(row.underlying_price) || spot;
    return {
      id: i + 1,
      time: clock(String(row.created_at || '')),
      ticker: String(row.ticker || '').toUpperCase(),
      legs: row.has_multileg ? 2 : 1,
      strike,
      right,
      otmPct: under > 0 ? ((strike - under) / under) * 100 : 0,
      expiry: expiry.includes('-') ? mmddyyyy(expiry) : expiry,
      dte: dteOf(expiry),
      fill: num(row.price),
      bid: num(row.bid),
      ask: num(row.ask),
      fillPos: side === 'ASK' ? 1 : side === 'BID' ? 0 : 0.5,
      side,
      flowScore: side === 'ASK' ? 60 : side === 'BID' ? -60 : 0,
      ratioLabel: side,
      ratioBidPct: prem > 0 ? (100 * bid) / prem : 0,
      size: num(row.total_size),
      premium: prem,
      volume: num(row.volume),
      oi: num(row.open_interest),
      deltaOI: 0,
      spot: under,
      iv: num(row.iv) * (num(row.iv) < 3 ? 100 : 1),
      volOverOI: num(row.volume_oi_ratio),
      strat: '—',
      sweep: !!row.has_sweep,
    };
  });
}

function darksFrom(rows: Record<string, unknown>[], spot: number): DarkPoolPrint[] {
  const prints = rows
    .filter(r => !r.canceled)
    .slice(0, 80)
    .map((row, i) => {
      const price = num(row.price);
      const size = num(row.size);
      const notional = num(row.premium) || price * size;
      return {
        id: i + 1,
        time: clock(String(row.executed_at || '')),
        ticker: String(row.ticker || '').toUpperCase(),
        price,
        size,
        notional,
        venue: String(row.market_center || 'off-exchange'),
        vsSpotPct: spot > 0 ? ((price - spot) / spot) * 100 : 0,
        atLevel: false,
        sized: false,
        intent: price >= spot ? ('DISTRIBUTION' as const) : ('ACCUMULATION' as const),
        conviction: 40,
        read: `${size.toLocaleString('en-US')} shares at ${price.toFixed(2)}`,
      };
    });
  const cut = [...prints].sort((a, b) => b.size - a.size)[Math.floor(prints.length / 4)]?.size ?? 0;
  return prints.map(p => ({ ...p, sized: cut > 0 && p.size >= cut }));
}

async function load(ticker: string): Promise<void> {
  const [screenR, earnR, dayR, flowR, darkR] = await Promise.all([
    whalesScreener([ticker]).catch(() => [] as Record<string, unknown>[]),
    whalesEarnings(ticker, true).catch(() => [] as EarnRow[]),
    whalesDaily(ticker).catch(() => [] as UwDaily[]),
    whalesFlowTicker(ticker).catch(() => [] as Record<string, unknown>[]),
    whalesDarkTicker(ticker).catch(() => [] as Record<string, unknown>[]),
  ]);
  const screen = Array.isArray(screenR) ? (screenR.find(r => String(r.ticker || '').toUpperCase() === ticker) ?? screenR[0] ?? null) : null;
  const days = daysFrom(Array.isArray(dayR) ? dayR : []);
  const spot = num(screen && typeof screen === 'object' ? (screen as Record<string, unknown>).close : 0) || days[days.length - 1]?.close || 0;
  const got = (Array.isArray(screenR) && screenR.length > 0) || days.length > 0 || (Array.isArray(earnR) && earnR.length > 0);
  files.set(ticker, {
    status: got ? 'live' : 'error',
    screen: screen && typeof screen === 'object' ? (screen as Record<string, unknown>) : null,
    earnings: Array.isArray(earnR) ? earnR : [],
    days,
    flow: flowsFrom(Array.isArray(flowR) ? flowR : [], spot),
    dark: darksFrom(Array.isArray(darkR) ? darkR : [], spot),
    at: got ? Date.now() : undefined,
  });
  emit();
}

export function peekStockFile(ticker: string): StockFile {
  return files.get(ticker.toUpperCase()) ?? blank('loading');
}

export function ensureStockFile(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || started.has(t)) return;
  started.add(t);
  files.set(t, blank('loading'));
  emit();
  void load(t).catch(() => {
    if (files.get(t)?.status === 'loading') files.set(t, blank('error'));
    emit();
  });
}

export function useStockFile(ticker: string): StockFile {
  const t = ticker.toUpperCase();
  useEffect(() => {
    ensureStockFile(t);
  }, [t]);
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => peekStockFile(t),
    () => LOADING,
  );
}
