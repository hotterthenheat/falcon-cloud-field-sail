/* Everything behind one contract for one session, off the vendor's per-contract routes (intraday by side, its
   prints, its daily history) and the underlying's minute ticks. Nothing here is drawn from a hash. */

import { useEffect, useState } from 'react';
import { uwCall } from './whales';
import { isoDate, isTradingDay } from '../core/calendar';
import { minuteLabel, nyClock } from '../core/nyTime';
import { liveTrades, num, sideOfTags, printCondition, quoteNoReadOf, sessionEndMin, tapeSessionIso } from './traceLive';

type FlowSide = 'BID' | 'MID' | 'ASK';

/** 09:30 → 16:00 New York */
export const SESSION_MIN = 390;
const OPEN_MIN = 9 * 60 + 30;

/** Minutes since the 09:30 bell on New York's 24-hour clock: 0 → "09:30" */
export const flowClock = (min: number): string => minuteLabel(OPEN_MIN + Math.round(min));

const rows = (data: unknown, key = 'data'): Record<string, unknown>[] => {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const box = data as Record<string, unknown> | null;
  const inner = box && Array.isArray(box[key]) ? (box[key] as unknown[]) : box && Array.isArray(box.data) ? (box.data as unknown[]) : [];
  return inner.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
};

const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const NY_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
/** New York wall clock of an instant: "HH:MM:SS", minutes since the bell, and the New York day */
function nyOf(iso: unknown): { time: string; min: number; ms: number; day: string } | null {
  const ms = typeof iso === 'string' ? Date.parse(iso) : typeof iso === 'number' ? iso : NaN;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const parts = NY.formatToParts(d);
  const pick = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const h = pick('hour');
  const m = pick('minute');
  return { time: nyClock(ms, { seconds: true, zone: true }), min: h * 60 + m - OPEN_MIN, ms, day: NY_DAY.format(d) };
}

/* ---- the session the card shows ---------------------------------------------------------------------------- */

/** The tape's session, and the sessions before it */
export function sessionIsoBack(fromIso: string, n: number): string {
  const d = new Date(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  let left = n;
  for (let guard = 0; left > 0 && guard < n + 30; guard++) {
    d.setDate(d.getDate() - 1);
    if (isTradingDay(d)) left--;
  }
  return isoDate(d);
}
/** The session on or before a calendar day, never past the tape's own session */
export function sessionOnOrBefore(day: Date): string {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  for (let i = 0; i < 30 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  const iso = isoDate(d);
  const tape = tapeSessionIso();
  return iso > tape ? tape : iso;
}
export const isoToDate = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/* ---- the shapes ---------------------------------------------------------------------------------------------- */

/** One real print on the contract */
export interface CardPrint {
  id: string;
  /** HH:MM:SS New York */
  time: string;
  /** Minutes since the bell (negative before it) */
  min: number;
  price: number;
  size: number;
  side: FlowSide;
  premium: number;
  bid: number;
  ask: number;
  sweep: boolean;
  multi: boolean;
  /** A compression package (OPRA cbmo / mctp) — not a bet */
  compression?: boolean;
  /** % */
  iv: number;
}

/** One minute of the contract, by side */
export interface CardMinute {
  /** Minutes since the bell */
  min: number;
  askPrem: number;
  bidPrem: number;
  /** mid and no-side premium together — the fence */
  midPrem: number;
  askVol: number;
  bidVol: number;
  midVol: number;
  vol: number;
  /** the minute's average fill */
  avg: number;
  /** % — the middle of the minute's IV range */
  iv: number;
}

/** One session of the contract's history (the vendor's /historic row) */
export interface CardDay {
  iso: string;
  /** "MM/DD" */
  date: string;
  vol: number;
  /** Open interest standing that session */
  oi: number;
  /** What this session's trading did to open interest — the next session's count less this one's (counted the morning
      after); null for the newest session, whose next count is not out */
  oiChange: number | null;
  /** The regular session's close when the session's prints are in hand (index and ETF options to 16:15, stock options to
      16:00); else the vendor's last_price, which can be an after-hours fill (closeBasis says which) */
  close: number;
  closeBasis?: 'regular' | 'vendor';
  /** The newest print after the regular close, when there is one — labelled apart, never the close */
  extLast?: { price: number; time: string };
  avg: number;
  askVol: number;
  bidVol: number;
  midVol: number;
  /** cross trades and late prints — the vendor's "neutral" */
  neutralVol: number;
  /** % */
  iv: number;
  sweepPct: number;
  multiPct: number;
  premium: number;
  trades: number;
  /** Contracts the vendor reports cancelled that session — already out of `vol`, but in its side buckets and its premium */
  canceledVol: number;
  /** How the row's side split and premium were set: off the session's own prints (exact, cancelled ones dropped), or the
      vendor's row with the cancelled share taken out of the premium at its average price (≈) and the sides as sent */
  basis: 'prints' | 'vendor' | 'vendor-less-canceled';
}

/** The underlying's minute: running net call / put premium and the minute's contracts by side */
export interface NetTick {
  min: number;
  netCall: number;
  netPut: number;
  callVol: number;
  putVol: number;
}

/** One window for the whole panel: every print of the day when the route sent them all, else the vendor's
    regular-session minutes, labelled so. */
export interface TapeWindow {
  from: number;
  to: number;
  label: string;
  source: 'prints' | 'minutes';
}

export interface ContractTape {
  dateIso: string;
  window: TapeWindow;
  prints: CardPrint[];
  /** The route hands the newest 500 — true when the session had more */
  printsCapped: boolean;
  minutes: CardMinute[];
  /** The selected session's history row, when the vendor has one */
  day: CardDay | null;
  /** Newest first */
  history: CardDay[];
  net: {
    series: NetTick[];
    netCall: number;
    netPut: number;
    callVol: number;
    putVol: number;
    callAsk: number;
    callBid: number;
    putAsk: number;
    putBid: number;
  } | null;
}

interface TapeLoad {
  tape: ContractTape | null;
  waiting: boolean;
  failed: boolean;
}

function dayRow(r: Record<string, unknown>): CardDay {
  const iso = String(r.date || '').slice(0, 10);
  const vol = num(r.volume);
  /* The vendor's volume is net of cancelled contracts but its premium is not, so the premium is taken down at the
     row's average price (≈) and the sides are marked. */
  const canceledVol = num(r.canceled_volume);
  const gross = num(r.total_premium);
  const premium = canceledVol > 0 && vol + canceledVol > 0 ? gross * (vol / (vol + canceledVol)) : gross;
  return {
    iso,
    date: iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : '—',
    vol,
    oi: num(r.open_interest),
    oiChange: null,
    close: num(r.last_price),
    avg: num(r.avg_price),
    askVol: num(r.ask_volume),
    bidVol: num(r.bid_volume),
    midVol: num(r.mid_volume),
    neutralVol: num(r.neutral_volume),
    iv: num(r.implied_volatility) * 100,
    sweepPct: vol > 0 ? (num(r.sweep_volume) / vol) * 100 : 0,
    multiPct: vol > 0 ? (num(r.multi_leg_volume) / vol) * 100 : 0,
    premium,
    trades: num(r.trades),
    canceledVol,
    basis: canceledVol > 0 ? 'vendor-less-canceled' : 'vendor',
  };
}

const PRINT_CAP = 500;

async function get(path: string): Promise<unknown> {
  const got = await uwCall(path, true);
  if (got.error) {
    if (got.status === 404 || got.status === 422 || got.status === 403) return null;
    throw new Error(got.error);
  }
  return got.data;
}

const clockOf = (min: number) => flowClock(min);

/** The session's minutes off the day's own prints — every hour they traded in */
function minutesFromPrints(prints: CardPrint[]): CardMinute[] {
  const by = new Map<number, CardMinute & { dollars: number }>();
  for (const p of prints) {
    const k = p.min;
    let m = by.get(k);
    if (!m) {
      m = { min: k, askPrem: 0, bidPrem: 0, midPrem: 0, askVol: 0, bidVol: 0, midVol: 0, vol: 0, avg: 0, iv: 0, dollars: 0 };
      by.set(k, m);
    }
    if (p.side === 'ASK') {
      m.askPrem += p.premium;
      m.askVol += p.size;
    } else if (p.side === 'BID') {
      m.bidPrem += p.premium;
      m.bidVol += p.size;
    } else {
      m.midPrem += p.premium;
      m.midVol += p.size;
    }
    m.vol += p.size;
    m.dollars += p.price * p.size;
    if (p.iv > 0) m.iv = p.iv;
  }
  return [...by.values()].map(({ dollars, ...m }) => ({ ...m, avg: m.vol > 0 ? dollars / m.vol : 0 })).sort((a, b) => a.min - b.min);
}

async function loadContractTape(occ: string, ticker: string, dateIso: string): Promise<ContractTape> {
  const sym = encodeURIComponent(occ.toUpperCase());
  const q = `date=${dateIso}`;
  const [flowRaw, minuteRaw, histRaw, ticksRaw] = await Promise.all([
    get(`/option-contract/${sym}/flow?limit=${PRINT_CAP}&${q}`),
    get(`/option-contract/${sym}/intraday?${q}`),
    get(`/option-contract/${sym}/historic?limit=30`),
    get(`/stock/${encodeURIComponent(ticker.toUpperCase())}/net-prem-ticks?${q}`).catch(() => null),
  ]);

  const prints: CardPrint[] = liveTrades(rows(flowRaw))
    .map((r, i) => {
      const at = nyOf(r.executed_at);
      const price = num(r.price);
      const bid = num(r.nbbo_bid);
      const ask = num(r.nbbo_ask);
      const cond = printCondition(r);
      return {
        id: String(r.id || i),
        time: at?.time ?? '—',
        min: at?.min ?? 0,
        price,
        size: num(r.size),
        /* a crossed quote, or a side quoted minutes before the fill, gives no read */
        side: quoteNoReadOf(r, price, bid, ask, Date.parse(String(r.executed_at ?? ''))) ? 'MID' : sideOfTags(r.tags, price, bid, ask),
        premium: num(r.premium) || price * num(r.size) * 100,
        bid,
        ask,
        sweep: cond.sweep,
        multi: cond.multi,
        compression: cond.compression || undefined,
        iv: num(r.implied_volatility) * 100,
      };
    })
    .sort((a, b) => b.min - a.min || b.time.localeCompare(a.time));

  const minutes: CardMinute[] = rows(minuteRaw)
    .map(r => {
      const at = nyOf(r.start_time);
      const askVol = num(r.volume_ask_side);
      const bidVol = num(r.volume_bid_side);
      const midVol = num(r.volume_mid_side) + num(r.volume_no_side);
      const hi = num(r.iv_high);
      const lo = num(r.iv_low);
      return {
        min: at?.min ?? -1,
        askPrem: num(r.premium_ask_side),
        bidPrem: num(r.premium_bid_side),
        midPrem: num(r.premium_mid_side) + num(r.premium_no_side),
        askVol,
        bidVol,
        midVol,
        vol: askVol + bidVol + midVol,
        avg: num(r.avg_price),
        iv: hi > 0 && lo > 0 ? ((hi + lo) / 2) * 100 : (hi || lo) * 100,
      };
    })
    .filter(m => m.min >= 0 && m.min < sessionEndMin(ticker) - OPEN_MIN)
    .sort((a, b) => a.min - b.min);

  /* the window: every print of the day when none was cut off (the route's 500), else the regular session's minutes */
  const end = sessionEndMin(ticker) - OPEN_MIN;
  const capped = prints.length >= PRINT_CAP;
  const fromPrints = !capped && prints.length > 0;
  const firstMin = fromPrints ? Math.min(...prints.map(p => p.min)) : 0;
  const lastMin = fromPrints ? Math.max(...prints.map(p => p.min)) : end;
  const window: TapeWindow = fromPrints
    ? {
        from: Math.min(0, firstMin),
        to: Math.max(end, lastMin + 1),
        label: firstMin < 0 || lastMin >= end ? `the whole day, ${clockOf(Math.min(0, firstMin))}–${clockOf(Math.max(end, lastMin + 1))} ET, every print` : `09:30–${clockOf(end)} ET, every print`,
        source: 'prints',
      }
    : { from: 0, to: end, label: `the regular session, 09:30–${clockOf(end)} ET, the vendor's minutes`, source: 'minutes' };
  const panelMinutes = fromPrints ? minutesFromPrints(prints) : minutes;

  const hist = rows(histRaw, 'chains').map(dayRow).filter(d => d.iso).sort((a, b) => b.iso.localeCompare(a.iso));
  /* A row's count is set the morning of it, so what its own volume did is the next row's count less its own; the
     newest session's is null until next morning. */
  for (let i = 0; i < hist.length; i++) hist[i].oiChange = i > 0 ? hist[i - 1].oi - hist[i].oi : null;
  /* the card's session, when every one of its prints is in hand: its side split and premium are its own prints' — the
     cancelled ones already dropped — so the history row, the session strip and the card's facts are one window */
  const own = hist.find(d => d.iso === dateIso);
  if (own && fromPrints) {
    let askVol = 0;
    let bidVol = 0;
    let midVol = 0;
    let prem = 0;
    let vol = 0;
    for (const p of prints) {
      if (p.side === 'ASK') askVol += p.size;
      else if (p.side === 'BID') bidVol += p.size;
      else midVol += p.size;
      prem += p.premium;
      vol += p.size;
    }
    Object.assign(own, { askVol, bidVol, midVol, neutralVol: 0, premium: prem, vol, basis: 'prints' as const });
  }
  /* The close is the regular session's newest print; a newer extended-hours print is the extended last, said apart. */
  if (own && prints.length) {
    const reg = prints.find(p => p.min >= 0 && p.min < end);
    const newest = prints[0];
    if (reg) {
      own.close = reg.price;
      own.closeBasis = 'regular';
    }
    if (newest && (newest.min >= end || newest.min < 0) && newest !== reg) own.extLast = { price: newest.price, time: newest.time };
  }
  const day = own ?? null;

  let net: ContractTape['net'] = null;
  const ticks = rows(ticksRaw)
    .map(r => ({ r, at: nyOf(r.tape_time) }))
    .filter(x => x.at && x.at.min >= window.from && x.at.min < window.to)
    .sort((a, b) => a.at!.min - b.at!.min);
  if (ticks.length) {
    let c = 0;
    let p = 0;
    let callVol = 0;
    let putVol = 0;
    let callAsk = 0;
    let callBid = 0;
    let putAsk = 0;
    let putBid = 0;
    const series: NetTick[] = [];
    for (const { r, at } of ticks) {
      c += num(r.net_call_premium);
      p += num(r.net_put_premium);
      callVol += num(r.call_volume);
      putVol += num(r.put_volume);
      callAsk += num(r.call_volume_ask_side);
      callBid += num(r.call_volume_bid_side);
      putAsk += num(r.put_volume_ask_side);
      putBid += num(r.put_volume_bid_side);
      series.push({ min: at!.min, netCall: c, netPut: p, callVol: num(r.call_volume), putVol: num(r.put_volume) });
    }
    net = { series, netCall: c, netPut: p, callVol, putVol, callAsk, callBid, putAsk, putBid };
  }

  return { dateIso, window, prints, printsCapped: capped, minutes: panelMinutes, day, history: hist, net };
}

/** The card's tape: loaded on open and on a session change; the live session refreshes every 20s */
export function useContractTape(occ: string | null | undefined, ticker: string | null | undefined, dateIso: string): TapeLoad {
  const [box, setBox] = useState<{ key: string; tape: ContractTape | null; failed: boolean } | null>(null);
  const key = occ && ticker ? `${occ}|${ticker}|${dateIso}` : '';
  useEffect(() => {
    if (!key || !occ || !ticker) return;
    let stop = false;
    const run = async () => {
      try {
        const tape = await loadContractTape(occ, ticker, dateIso);
        if (!stop) setBox({ key, tape, failed: false });
      } catch {
        if (!stop) setBox(prev => (prev && prev.key === key ? { ...prev, failed: !prev.tape } : { key, tape: null, failed: true }));
      }
    };
    void run();
    const live = dateIso === tapeSessionIso();
    const id = live ? window.setInterval(run, 20_000) : 0;
    return () => {
      stop = true;
      if (id) window.clearInterval(id);
    };
  }, [key, occ, ticker, dateIso]);
  const mine = box && box.key === key ? box : null;
  return { tape: mine?.tape ?? null, waiting: !!key && !mine, failed: !!mine?.failed };
}

/* ---- what the panels draw ---------------------------------------------------------------------------------- */

export interface LedgerBin {
  /** Minutes since the bell, the bucket's start */
  min: number;
  askPrem: number;
  bidPrem: number;
  midPrem: number;
  vol: number;
}

/** The session's minutes in buckets of `step` minutes */
export function bucketMinutes(minutes: CardMinute[], step: number): LedgerBin[] {
  const by = new Map<number, LedgerBin>();
  for (const m of minutes) {
    const k = Math.floor(m.min / step) * step;
    let b = by.get(k);
    if (!b) {
      b = { min: k, askPrem: 0, bidPrem: 0, midPrem: 0, vol: 0 };
      by.set(k, b);
    }
    b.askPrem += m.askPrem;
    b.bidPrem += m.bidPrem;
    b.midPrem += m.midPrem;
    b.vol += m.vol;
  }
  return [...by.values()].sort((a, b) => a.min - b.min);
}

/** The running volume-weighted fill and the minute's IV, for the overlays */
export function runningAvg(minutes: CardMinute[]): { min: number; price: number; iv: number }[] {
  let dollars = 0;
  let vol = 0;
  return minutes.map(m => {
    dollars += m.avg * m.vol;
    vol += m.vol;
    return { min: m.min, price: vol > 0 ? Number((dollars / vol).toFixed(2)) : m.avg, iv: Number(m.iv.toFixed(1)) };
  });
}

interface UnderBar {
  min: number;
  callVol: number;
  /** negative, so the puts stack below the axis */
  putVol: number;
}
export function bucketTicks(series: NetTick[], step: number): UnderBar[] {
  const by = new Map<number, UnderBar>();
  for (const t of series) {
    const k = Math.floor(t.min / step) * step;
    const b = by.get(k) ?? { min: k, callVol: 0, putVol: 0 };
    b.callVol += t.callVol;
    b.putVol -= t.putVol;
    by.set(k, b);
  }
  return [...by.values()].sort((a, b) => a.min - b.min);
}

