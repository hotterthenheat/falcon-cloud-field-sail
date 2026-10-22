/*
  TRACE — live Unusual Whales rows, mapped onto the grids the desks already draw.
  The browser calls /api/uw. This file does not invent a layout and does not
  talk to the simulator.
*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { uwCall } from './whales';
import { vendorFault, type FeedFault } from '../components/ui/liveRead';
import type { BookContract, FlowPrint } from '../types/trace';
import type { DarkPoolIntent, DarkPoolLevel, DarkPoolPrint, DarkPoolView, LevelRole, Posture } from '../types/darkpool';
import type { SpreadKind, SpreadLeg, SpreadTrade } from './flowBook';

const POLL_MS = 4_000;

export interface LivePack<T> {
  rows: T;
  at: number | null;
  fault: FeedFault | null;
  waiting: boolean;
}

interface CacheBox<T> {
  rows: T;
  at: number | null;
  fault: FeedFault | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return rowsOf((data as { data: unknown }).data);
  }
  return [];
}

export function nyIsoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function clock(iso: unknown): { time: string; minute: number; epoch: number } {
  const raw = typeof iso === 'number' ? iso : typeof iso === 'string' ? Date.parse(iso) : NaN;
  const d = Number.isFinite(raw) ? new Date(raw > 1e12 ? raw : raw * 1000) : null;
  if (!d || Number.isNaN(d.getTime())) return { time: '—', minute: 0, epoch: 0 };
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const pick = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  const time = `${pick('hour')}:${pick('minute')}:${pick('second')}`;
  const minute = Number(pick('hour')) * 60 + Number(pick('minute'));
  return { time, minute, epoch: Math.floor(d.getTime() / 1000) };
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function expiryLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function dteOf(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.parse(`${nyIsoToday()}T00:00:00Z`);
  return Math.max(0, Math.round((day - today) / 86_400_000));
}

export function useLive<T>(key: string, load: () => Promise<T>, empty: T, enabled = true): LivePack<T> {
  const [box, setBox] = useState<CacheBox<T> | null>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    if (!enabled) {
      setWaiting(false);
      return;
    }
    let stop = false;
    const run = async () => {
      try {
        const rows = await load();
        if (stop) return;
        setBox({ rows, at: Date.now(), fault: null });
        setWaiting(false);
      } catch (e) {
        if (stop) return;
        const fault = vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed';
        setBox(prev => ({ rows: prev ? prev.rows : empty, at: prev ? prev.at : null, fault }));
        setWaiting(false);
      }
    };
    void run();
    const id = window.setInterval(run, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
    // `key` is the request. `load` closes over the same key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { rows: box?.rows ?? empty, at: box?.at ?? null, fault: box?.fault ?? null, waiting: enabled && waiting && !box };
}

async function getRows(path: string): Promise<Record<string, unknown>[]> {
  const got = await uwCall(path, true);
  if (got.error) {
    if (got.status === 422 || got.status === 403 || got.status === 404) return [];
    throw new Error(got.error);
  }
  return rowsOf(got.data);
}

function tradeToPrint(row: Record<string, unknown>, i = 0): FlowPrint {
  const ticker = String(row.underlying_symbol || row.ticker || row.ticker_symbol || '').toUpperCase();
  const expiryIso = String(row.expiry || row.expiration || '').slice(0, 10);
  const when = clock(row.executed_at || row.created_at);
  const fill = num(row.price);
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  const spot = num(row.underlying_price || row.stock_price);
  const strike = num(row.strike);
  const right: 'C' | 'P' = String(row.option_type || row.type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
  const side = execOf(fill, bid, ask) ?? 'MID';
  const spread = ask > bid ? ask - bid : 0;
  const fillPos = spread > 0 ? Math.min(1, Math.max(0, (fill - bid) / spread)) : side === 'ASK' ? 1 : side === 'BID' ? 0 : 0.5;
  const size = num(row.size);
  const premium = num(row.premium) || fill * size * 100;
  const volume = num(row.volume);
  const oi = num(row.open_interest);
  const askVol = num(row.ask_vol);
  const bidVol = num(row.bid_vol);
  const volSum = askVol + bidVol;
  const flags = `${row.report_flags || ''} ${Array.isArray(row.tags) ? row.tags.join(' ') : ''}`;
  const multi = num(row.stock_multi_vol) > 0 || /multi/i.test(flags);
  const sweep = /sweep/i.test(flags);
  const idRaw = String(row.id || `${ticker}-${when.epoch}-${i}`);
  return {
    id: hashId(idRaw),
    time: when.time,
    ticker,
    legs: multi ? Math.max(2, num(row.leg_count)) : 1,
    strike,
    right,
    otmPct: spot > 0 && strike > 0 ? ((right === 'C' ? strike - spot : spot - strike) / spot) * 100 : 0,
    expiry: expiryLabel(expiryIso),
    dte: dteOf(expiryIso),
    fill,
    bid,
    ask,
    fillPos,
    side,
    flowScore: side === 'ASK' ? 60 : side === 'BID' ? -60 : 0,
    ratioLabel: volSum > 0 ? (askVol >= bidVol ? `ASK ${Math.round((askVol / volSum) * 100)}%` : `BID ${Math.round((bidVol / volSum) * 100)}%`) : side,
    ratioBidPct: volSum > 0 ? Math.round((bidVol / volSum) * 100) : side === 'BID' ? 100 : 0,
    size,
    premium,
    volume,
    oi,
    deltaOI: 0,
    spot,
    iv: num(row.implied_volatility) * (num(row.implied_volatility) <= 3 ? 100 : 1),
    volOverOI: oi > 0 ? volume / oi : 0,
    strat: multi ? 'Custom' : '—',
    sweep,
    alertId: typeof row.flow_alert_id === 'string' ? row.flow_alert_id : null,
    epoch: when.epoch,
    vendorId: idRaw,
  };
}

function alertToPrint(row: Record<string, unknown>, i = 0): FlowPrint {
  const base = tradeToPrint(
    {
      ...row,
      price: row.price ?? row.ask,
      premium: row.total_premium ?? row.premium,
      size: row.total_size ?? row.size,
      executed_at: row.created_at ?? row.end_time,
      underlying_price: row.underlying_price,
      option_type: row.type ?? row.option_type,
      implied_volatility: row.iv,
      flow_alert_id: row.id,
    },
    i
  );
  return { ...base, alertId: String(row.id || base.alertId || ''), sweep: row.has_sweep === true || base.sweep, legs: row.has_multileg ? 2 : base.legs };
}

export function useOptionTape(limit = 200): LivePack<FlowPrint[]> {
  return useLive(`tape:${limit}`, async () => (await getRows(`/option-trades?limit=${limit}`)).map(tradeToPrint), []);
}

const TAPE_CAP = 2000;
const TAPE_PAGE = 300;
export { TAPE_CAP };

export interface TapeQuery {
  ticker?: string;
  right?: 'C' | 'P' | null;
  side?: 'ASK' | 'BID' | 'MID' | null;
  multi?: boolean;
  minPremium?: number;
  minDte?: number | null;
  maxDte?: number | null;
  otm?: boolean;
}

/** Query string the option tape actually accepts. Sweep, block and floor stay client-side — those flags 400 this route. */
export function tapeQueryString(q: TapeQuery, extra?: { newerThan?: number; olderThan?: number; limit?: number }): string {
  const p = new URLSearchParams();
  p.set('limit', String(extra?.limit ?? TAPE_PAGE));
  if (q.ticker) p.set('ticker_symbol', q.ticker.toUpperCase());
  if (q.right === 'C') p.set('type', 'call');
  else if (q.right === 'P') p.set('type', 'put');
  if (q.side === 'ASK') p.set('tags[]', 'ask_side');
  else if (q.side === 'BID') p.set('tags[]', 'bid_side');
  else if (q.side === 'MID') p.set('tags[]', 'mid_side');
  if (q.multi) p.set('is_multi_leg', 'true');
  if (q.minPremium && q.minPremium > 0) p.set('min_premium', String(Math.round(q.minPremium)));
  if (q.minDte != null) p.set('min_dte', String(q.minDte));
  if (q.maxDte != null) p.set('max_dte', String(q.maxDte));
  if (q.otm) p.set('is_otm', 'true');
  if (extra?.newerThan) p.set('newer_than', String(extra.newerThan));
  if (extra?.olderThan) p.set('older_than', String(extra.olderThan));
  return p.toString();
}

function mergePrints(prev: FlowPrint[], incoming: FlowPrint[], where: 'front' | 'back'): FlowPrint[] {
  const seen = new Set(prev.map(r => r.vendorId || String(r.id)));
  const fresh = incoming.filter(r => {
    const k = r.vendorId || String(r.id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!fresh.length) return prev;
  const next = where === 'front' ? fresh.concat(prev) : prev.concat(fresh);
  return next.length > TAPE_CAP ? (where === 'front' ? next.slice(0, TAPE_CAP) : next.slice(next.length - TAPE_CAP)) : next;
}

function oldestEpoch(batch: FlowPrint[]): number {
  let cursor = 0;
  for (const row of batch) {
    const epoch = row.epoch ?? 0;
    if (epoch > 0 && (cursor === 0 || epoch < cursor)) cursor = epoch;
  }
  return cursor;
}

export interface PrintStream extends LivePack<FlowPrint[]> {
  pending: number;
  loadingOlder: boolean;
  hasOlder: boolean;
  flush: () => void;
  loadOlder: () => void;
}

/**
 * The market tape as one growing list. New prints prepend. Older prints append
 * until the cap (fifty pages of forty). The vendor has no page number on this route.
 */
export function usePrintStream(query: TapeQuery, hold: boolean): PrintStream {
  const key = tapeQueryString(query);
  const [rows, setRows] = useState<FlowPrint[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [fault, setFault] = useState<FeedFault | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [pending, setPending] = useState<FlowPrint[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const newest = useRef(0);
  const oldest = useRef(0);
  const filling = useRef(false);
  const holdRef = useRef(hold);
  holdRef.current = hold;

  const take = useCallback((batch: FlowPrint[], where: 'front' | 'back') => {
    if (!batch.length) return;
    const epochs = batch.map(r => r.epoch || 0).filter(n => n > 0);
    if (epochs.length) {
      newest.current = Math.max(newest.current, ...epochs);
      oldest.current = oldest.current ? Math.min(oldest.current, ...epochs) : Math.min(...epochs);
    }
    if (where === 'front' && holdRef.current) {
      setPending(prev => mergePrints(prev, batch, 'front'));
      return;
    }
    setRows(prev => mergePrints(prev, batch, where));
  }, []);

  useEffect(() => {
    let stop = false;
    newest.current = 0;
    oldest.current = 0;
    setRows([]);
    setPending([]);
    setHasOlder(true);
    setWaiting(true);
    setFault(null);
    const pull = async (cursor: { newerThan?: number; olderThan?: number }) => {
      const got = await getRows(`/option-trades?${tapeQueryString(query, { ...cursor, limit: TAPE_PAGE })}`);
      if (stop) return [];
      return got.map(tradeToPrint);
    };
    const boot = async () => {
      filling.current = true;
      try {
        const batch = await pull({});
        if (stop) return;
        take(batch, 'front');
        setAt(Date.now());
        setFault(null);
        setWaiting(false);
        let held = batch.length;
        let cursor = oldestEpoch(batch);
        let more = batch.length >= TAPE_PAGE && cursor > 0;
        setHasOlder(more && held < TAPE_CAP);
        while (more && held < TAPE_CAP && !stop) {
          setLoadingOlder(true);
          const older = await pull({ olderThan: cursor });
          if (stop) return;
          take(older, 'back');
          const next = oldestEpoch(older);
          held += older.length;
          if (older.length < TAPE_PAGE || !next || next >= cursor) {
            more = false;
            setHasOlder(false);
          } else {
            cursor = next;
            setHasOlder(held < TAPE_CAP);
          }
        }
        if (held >= TAPE_CAP) setHasOlder(false);
      } catch (e) {
        if (stop) return;
        setFault(vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed');
        setWaiting(false);
      } finally {
        filling.current = false;
        if (!stop) setLoadingOlder(false);
      }
    };
    void boot();
    const id = window.setInterval(async () => {
      if (!newest.current) return;
      try {
        const batch = await pull({ newerThan: newest.current });
        if (stop || !batch.length) return;
        take(batch, 'front');
        setAt(Date.now());
        setFault(null);
      } catch {
        /* a missed poll keeps the prints already in hand */
      }
    }, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
    // `key` is the query. `query` closes over the same fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const flush = useCallback(() => {
    setPending(held => {
      if (held.length) setRows(prev => mergePrints(prev, held, 'front'));
      return [];
    });
  }, []);

  const loadOlder = useCallback(() => {
    if (filling.current || !oldest.current || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    void getRows(`/option-trades?${tapeQueryString(query, { olderThan: oldest.current, limit: TAPE_PAGE })}`)
      .then(got => {
        const batch = got.map(tradeToPrint);
        take(batch, 'back');
        if (batch.length < TAPE_PAGE) setHasOlder(false);
        setAt(Date.now());
      })
      .catch(() => setHasOlder(false))
      .finally(() => setLoadingOlder(false));
  }, [hasOlder, loadingOlder, query, take]);

  return {
    rows,
    at,
    fault,
    waiting: waiting && rows.length === 0,
    pending: pending.length,
    loadingOlder,
    hasOlder,
    flush,
    loadOlder,
  };
}

/** Print versus the quote. At or above the ask is a lift; at or below the bid is a hit. Null when NBBO is missing. */
function execOf(price: number, bid: number, ask: number): 'ASK' | 'BID' | 'MID' | null {
  if (!(price > 0) || !(bid > 0) || !(ask > 0) || ask < bid) return null;
  if (price >= ask - 1e-6) return 'ASK';
  if (price <= bid + 1e-6) return 'BID';
  return 'MID';
}

function intentOf(vs: number, sized: boolean): DarkPoolIntent {
  if (!sized) return 'ROTATION';
  if (vs <= -0.15) return 'ACCUMULATION';
  if (vs >= 0.15) return 'DISTRIBUTION';
  return 'HEDGE FLOW';
}

/** Where a dark print sat against the quote. Two decimals of percent is 0.00%
    on a fill a few cents through a tight spread, which is most of this tape. */
export function quotePlace(pct: number, price: number): { text: string; cents: number } {
  const cents = (pct / 100) * price * 100;
  if (!Number.isFinite(cents) || Math.abs(cents) < 0.5) return { text: 'at the mid', cents: 0 };
  if (Math.abs(pct) < 0.1) {
    const abs = Math.abs(cents);
    const n = abs >= 10 ? String(Math.round(abs)) : (Math.round(abs * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return { text: `${cents > 0 ? '+' : '−'}${n}¢`, cents };
  }
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`, cents };
}

export function darkPrint(row: Record<string, unknown>, i: number, spot = 0): DarkPoolPrint {
  const price = num(row.price);
  const size = num(row.size);
  const notional = num(row.premium) || price * size;
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : spot;
  const vs = mid > 0 ? ((price - mid) / mid) * 100 : 0;
  const sized = size >= 10_000 || notional >= 500_000;
  const intent = intentOf(vs, sized);
  const exec = execOf(price, bid, ask);
  const when = clock(row.executed_at);
  const id = hashId(String(row.tracking_id || `${row.ticker}-${row.executed_at}-${i}`));
  const place = quotePlace(vs, price);
  const where = place.cents === 0 ? 'at the mid' : place.cents > 0 ? `${place.text.slice(1)} over the mid` : `${place.text.slice(1)} under the mid`;
  const read = sized ? `Size printed ${where}.` : `Printed ${where}.`;
  return {
    id,
    time: when.time.slice(0, 5),
    ticker: String(row.ticker || '').toUpperCase(),
    price,
    size,
    notional,
    venue: String(row.market_center || row.trade_code || 'off-exchange'),
    vsSpotPct: vs,
    atLevel: false,
    sized,
    intent,
    conviction: sized ? 70 : 40,
    read,
    exec,
    bid: bid > 0 ? bid : null,
    ask: ask > 0 ? ask : null,
  };
}

export function darkLevels(rows: Record<string, unknown>[], spot: number): DarkPoolLevel[] {
  const raw = rows
    .map(r => ({ price: num(r.price), notional: num(r.dark_pool_volume) * num(r.price) || num(r.dark_pool_volume), prints: 1 }))
    .filter(l => l.price > 0 && l.notional > 0)
    .sort((a, b) => b.notional - a.notional);
  const sum = raw.reduce((a, l) => a + l.notional, 0) || 1;
  /* A dollar bucket within a third of a percent of the market is the pivot.
     Anything further is support or resistance. The feed hands back every
     dollar that printed (META is ~30). Two of each role is the shelf — the
     heaviest — not a fence of the same word. */
  const leveled = raw.map(l => {
    const dist = spot > 0 ? ((l.price - spot) / spot) * 100 : 0;
    const role: LevelRole = Math.abs(dist) <= 0.35 ? 'PIVOT' : dist < 0 ? 'SUPPORT' : 'RESISTANCE';
    return {
      price: l.price,
      notional: l.notional,
      prints: l.prints,
      sharePct: (l.notional / sum) * 100,
      role,
      defended: 0,
      distPct: dist,
      usage: role === 'SUPPORT' ? 'Rested under the market.' : role === 'RESISTANCE' ? 'Rested over the market.' : 'Rested at the market.',
    };
  });
  const take = (role: LevelRole) => leveled.filter(l => l.role === role).slice(0, 2);
  return [...take('SUPPORT'), ...take('RESISTANCE'), ...take('PIVOT')];
}

function postureOf(prints: DarkPoolPrint[]): { posture: Posture; net: number; note: string } {
  const sized = prints.filter(p => p.sized);
  const acc = sized.filter(p => p.intent === 'ACCUMULATION').length;
  const dist = sized.filter(p => p.intent === 'DISTRIBUTION').length;
  const net = sized.length ? Math.round(((acc - dist) / sized.length) * 100) : 0;
  const posture: Posture = net > 15 ? 'ACCUMULATING' : net < -15 ? 'DISTRIBUTING' : 'BALANCED';
  const note =
    posture === 'ACCUMULATING'
      ? 'Sized prints lean under the market.'
      : posture === 'DISTRIBUTING'
        ? 'Sized prints lean over the market.'
        : 'Sized prints sit on both sides of the market.';
  return { posture, net, note };
}

export function darkView(ticker: string, prints: DarkPoolPrint[], levels: DarkPoolLevel[], spot: number): DarkPoolView {
  const marked = prints.map(p => ({
    ...p,
    atLevel: levels.some(l => l.price > 0 && Math.abs(l.price - p.price) / l.price < 0.0015),
  }));
  const { posture, net, note } = postureOf(marked);
  const total = marked.reduce((a, p) => a + p.notional, 0);
  const largest = marked.reduce<DarkPoolPrint | null>((a, p) => (!a || p.notional > a.notional ? p : a), null);
  return {
    ticker,
    spot,
    dpSharePct: 0,
    netPosturePct: net,
    posture,
    postureNote: note,
    totalNotional: total,
    levels,
    prints: marked,
    largest,
  };
}

const DARK_CAP = 2000;

function mergeDark(prev: DarkPoolPrint[], incoming: DarkPoolPrint[]): DarkPoolPrint[] {
  const seen = new Set(prev.map(r => r.id));
  const fresh = incoming.filter(r => !seen.has(r.id));
  if (!fresh.length) return prev;
  const next = fresh.concat(prev);
  return next.length > DARK_CAP ? next.slice(0, DARK_CAP) : next;
}

/** Dark or lit prints, accumulating across polls. The recent route caps at 200 and has no older cursor. */
export function useAccumTape(kind: 'dark' | 'lit', limit: number): LivePack<DarkPoolPrint[]> {
  const path = kind === 'dark' ? `/darkpool/recent?limit=${Math.min(200, limit)}` : `/lit-flow/recent?limit=${Math.min(200, limit)}`;
  const [rows, setRows] = useState<DarkPoolPrint[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [fault, setFault] = useState<FeedFault | null>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    let stop = false;
    setRows([]);
    setWaiting(true);
    const run = async () => {
      try {
        const batch = (await getRows(path)).map((r, i) => darkPrint(r, i));
        if (stop) return;
        setRows(prev => mergeDark(prev, batch));
        setAt(Date.now());
        setFault(null);
        setWaiting(false);
      } catch (e) {
        if (stop) return;
        setFault(vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed');
        setWaiting(false);
      }
    };
    void run();
    const id = window.setInterval(run, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [path]);
  return { rows, at, fault, waiting: waiting && rows.length === 0 };
}

export function useNameDark(ticker: string | null): LivePack<{ view: DarkPoolView | null; lit: DarkPoolPrint[] }> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `name-dark:${name}` : 'name-dark:off',
    async () => {
      if (!name) return { view: null, lit: [] as DarkPoolPrint[] };
      const [prints, levels, lit] = await Promise.all([
        getRows(`/darkpool/${encodeURIComponent(name)}?limit=80`),
        getRows(`/darkpool/${encodeURIComponent(name)}/price-levels`).catch(() => [] as Record<string, unknown>[]),
        getRows(`/lit-flow/${encodeURIComponent(name)}?limit=80`).catch(() => [] as Record<string, unknown>[]),
      ]);
      const mapped = prints.map((r, i) => darkPrint(r, i));
      const spot = mapped[0]?.price || 0;
      return { view: darkView(name, mapped, darkLevels(levels, spot), spot), lit: lit.map((r, i) => darkPrint(r, i)) };
    },
    { view: null, lit: [] },
    !!name
  );
}

function contractRow(row: Record<string, unknown>, i: number): BookContract {
  const ticker = String(row.ticker_symbol || row.underlying_symbol || row.ticker || '').toUpperCase();
  const expiryIso = String(row.expiry || '').slice(0, 10);
  const strike = num(row.strike);
  const right: 'C' | 'P' = String(row.option_type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
  const spot = num(row.stock_price);
  const volume = num(row.volume);
  const oi = num(row.open_interest);
  const premium = num(row.premium);
  const ask = num(row.ask_side_volume);
  const bid = num(row.bid_side_volume);
  const when = clock(row.last_fill);
  const dte = dteOf(expiryIso);
  return {
    key: `${ticker}-${strike}-${right}-${dte}-${i}`,
    ticker,
    sector: row.sector ? String(row.sector) : null,
    sectorColor: null,
    strike,
    right,
    expiry: expiryLabel(expiryIso),
    dte,
    spot,
    otmPct: spot > 0 && strike > 0 ? ((right === 'C' ? strike - spot : spot - strike) / spot) * 100 : 0,
    last: num(row.close || row.avg_price),
    chgPct: num(row.roc),
    lastAt: when.time.slice(0, 5),
    lastAtMin: when.minute,
    volume,
    oi,
    deltaOI: num(row.open_interest) - num(row.prev_oi),
    deltaOIPct: num(row.prev_oi) > 0 ? ((oi - num(row.prev_oi)) / num(row.prev_oi)) * 100 : 0,
    premium,
    /* the screener sends no `iv` — only yesterday's and the change since (prev_iv + iv_change); reading `iv` alone put 0% on
       every row of the Screener */
    iv: (() => {
      const v = num(row.iv) || (row.prev_iv != null ? num(row.prev_iv) + num(row.iv_change) : 0);
      return v * (v <= 3 ? 100 : 1);
    })(),
    ivChg: num(row.iv_change) * (Math.abs(num(row.iv_change)) <= 3 ? 100 : 1),
    volOverOI: oi > 0 ? volume / oi : 0,
    sweepPct: volume > 0 ? (num(row.sweep_volume) / volume) * 100 : 0,
    multiPct: volume > 0 ? (num(row.multileg_volume) / volume) * 100 : 0,
    floorPct: volume > 0 ? (num(row.floor_volume) / volume) * 100 : 0,
    askPct: ask + bid > 0 ? (ask / (ask + bid)) * 100 : 0,
    prevOI: num(row.prev_oi),
    prevVolume: 0,
    prevAvgFill: num(row.chain_prev_close),
    prevPremium: 0,
    prevAskPct: 0,
    oiStreak: num(row.days_of_oi_increases),
    volGtOiStreak: num(row.days_of_vol_greater_than_oi),
    earnDays: null,
    prevSpark: [],
  };
}

/** Hottest chains, plus the name on the desk so a one-name page is not an empty SPX book. */
export function useLiveBook(ticker?: string | null): LivePack<BookContract[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    `book:${name || 'mkt'}`,
    async () => {
      const market = getRows('/screener/option-contracts?limit=200&order=premium&order_direction=desc');
      const named = name
        ? getRows(`/screener/option-contracts?ticker_symbol=${encodeURIComponent(name)}&limit=80&order=premium&order_direction=desc`).catch(() => [] as Record<string, unknown>[])
        : Promise.resolve([] as Record<string, unknown>[]);
      const [a, b] = await Promise.all([market, named]);
      const seen = new Set<string>();
      const out: BookContract[] = [];
      for (const row of b.concat(a)) {
        const mapped = contractRow(row, out.length);
        /* one contract once: the name's page and the market's page overlap, and the key carries the row's index, so it
           never caught the repeat — the same SPY 773 call sat on Footprints twice */
        const id = String(row.option_symbol || `${mapped.ticker}-${mapped.strike}-${mapped.right}-${mapped.expiry}`);
        if (!mapped.ticker || seen.has(id)) continue;
        seen.add(id);
        out.push(mapped);
      }
      return out;
    },
    []
  );
}

export function useContracts(unusual: boolean, issue?: 'stock' | 'etf' | null): LivePack<BookContract[]> {
  const parts = ['limit=200', 'order=premium', 'order_direction=desc'];
  if (unusual) parts.push('unusual=true');
  if (issue === 'stock') parts.push('issue_types[]=Common Stock');
  else if (issue === 'etf') parts.push('issue_types[]=ETF');
  const q = parts.join('&');
  return useLive(`contracts:${unusual ? 'u' : 'h'}:${issue ?? 'any'}`, async () => (await getRows(`/screener/option-contracts?${q}`)).map(contractRow), []);
}

export function useFlowAlerts(limit = 50): LivePack<FlowPrint[]> {
  return useLive(`alerts:${limit}`, async () => (await getRows(`/option-trades/flow-alerts?limit=${limit}`)).map(alertToPrint), []);
}

export function useAlertTrades(id: string | null): LivePack<FlowPrint[]> {
  return useLive(id ? `alert-trades:${id}` : 'alert-trades:off', async () => (await getRows(`/option-trades/flow-alerts/${encodeURIComponent(id!)}`)).map(tradeToPrint), [], !!id);
}

export interface ExchangeBreak {
  key: string;
  symbol: string;
  exchange: string;
  code: string;
  trades: number;
  calls: number;
  puts: number;
  contracts: number;
  premium: number;
}

export function useExchangeBreak(day: string): LivePack<ExchangeBreak[]> {
  return useLive(`exch:${day}`, async () => {
    const rows = await getRows(`/option-trades/exchange-breakdown/${encodeURIComponent(day)}`);
    return rows.map((row, i) => {
      const symbol = String(row.underlying_symbol || row.symbol || row.ticker || '—');
      const exchange = String(row.exchange || row.market_center || '—');
      const code = String(row.trade_code || row.code || '—');
      return {
        key: `${symbol}-${exchange}-${code}-${i}`,
        symbol,
        exchange,
        code,
        trades: num(row.trade_count || row.trades),
        calls: num(row.call_trades || row.calls),
        puts: num(row.put_trades || row.puts),
        contracts: num(row.contracts || row.size),
        premium: num(row.premium),
      };
    });
  }, []);
}

function spreadKind(strategy: string): SpreadKind {
  const s = strategy.toLowerCase();
  if (s.includes('butterfly')) return 'butterfly';
  if (s.includes('condor')) return 'condor';
  if (s.includes('calendar')) return 'calendar';
  if (s.includes('straddle')) return 'straddle';
  if (s.includes('strangle')) return 'strangle';
  if (s.includes('ratio')) return 'ratio';
  return 'vertical';
}

function spreadLeg(leg: Record<string, unknown>, fallbackExpiry: string): SpreadLeg {
  const expiryIso = String(leg.expiry || leg.expiration || fallbackExpiry || '').slice(0, 10);
  const sideRaw = String(leg.side || leg.direction || leg.txn || '');
  return {
    side: /sell|short|sto|stc/i.test(sideRaw) ? 'SELL' : 'BUY',
    ratio: num(leg.ratio) || 1,
    strike: num(leg.strike),
    right: String(leg.type || leg.option_type || '').toLowerCase().startsWith('p') ? 'P' : 'C',
    expiry: expiryLabel(expiryIso),
    dte: dteOf(expiryIso) || num(leg.dte),
    fill: num(leg.price || leg.fill || leg.avg_price),
  };
}

/* When the vendor leaves the loss out, the structures whose risk is defined by their own strikes still say it: a debit
   is the most a long structure can lose; a credit vertical loses its width less the credit. Only a credit straddle or
   strangle (or a shape we cannot read) is truly uncapped. */
function definedLoss(kind: SpreadKind, net: number, size: number, strikes: number[], side: string, netPremium: number): number | null {
  const paid = Math.abs(net) * 100 * size;
  const credit = /bid/i.test(side) || netPremium < 0;
  const width = strikes.length >= 2 ? Math.max(...strikes) - Math.min(...strikes) : 0;
  if (kind === 'vertical' || kind === 'butterfly' || kind === 'condor') {
    if (!credit) return paid > 0 ? paid : null;
    const span = kind === 'vertical' ? width : width / 2;
    return span > 0 ? Math.max(0, (span - Math.abs(net)) * 100 * size) : null;
  }
  if ((kind === 'straddle' || kind === 'strangle' || kind === 'calendar') && !credit) return paid > 0 ? paid : null;
  return null;
}

function spreadOf(row: Record<string, unknown>): SpreadTrade {
  const ticker = String(row.ticker || '').toUpperCase();
  const when = clock(row.executed_at);
  const txns = Array.isArray(row.txns) ? (row.txns as Record<string, unknown>[]) : [];
  const strikes = Array.isArray(row.strikes) ? row.strikes.map(s => num(s)).filter(n => n > 0) : [];
  const legs = txns.length ? txns.map(leg => spreadLeg(leg, '')) : strikes.map(strike => spreadLeg({ strike, type: /put/i.test(String(row.strategy || '')) && !/call/i.test(String(row.strategy || '')) ? 'put' : 'call' }, ''));
  const net = num(row.net_price);
  const size = num(row.size) || 1;
  /* the vendor signs the loss (max_loss "-11.20") — a defined-risk spread read as "uncapped" on every row because only a
     positive figure counted. Uncapped is an ABSENT figure, never a negative one. */
  const loss = Math.abs(num(row.max_loss));
  const lossKnown = row.max_loss != null && row.max_loss !== '';
  const profit = Math.abs(num(row.max_profit));
  /* no legs on the row (txns is a count), so the expiry is the trade's own New York day plus its days to run */
  const dteAtTrade = num(row.min_dte);
  const tradeDay = when.epoch > 0 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(when.epoch * 1000)) : '';
  const expiryIso = tradeDay ? new Date(Date.parse(`${tradeDay}T00:00:00Z`) + dteAtTrade * 86_400_000).toISOString().slice(0, 10) : '';
  return {
    id: String(row.id || `${ticker}-${when.epoch}-${strikes.join('-')}`),
    minute: when.minute,
    time: when.time.slice(0, 5),
    ticker,
    kind: spreadKind(String(row.strategy || '')),
    strikesLabel: (strikes.length ? strikes : legs.map(l => l.strike)).filter(n => n > 0).join(' / ') || '—',
    expiry: (legs[0]?.expiry && legs[0].expiry !== '—' ? legs[0].expiry : '') || (expiryIso ? expiryLabel(expiryIso) : '—'),
    dte: expiryIso ? dteOf(expiryIso) : dteAtTrade || legs[0]?.dte || 0,
    size,
    net,
    premium: num(row.total_premium) || Math.abs(net) * size * 100,
    maxLoss: lossKnown ? loss : definedLoss(spreadKind(String(row.strategy || '')), net, size, strikes, String(row.net_side || ''), num(row.net_premium)) ?? 'uncapped',
    maxProfit: row.max_profit != null && row.max_profit !== '' ? profit : null,
    iv: num(row.avg_iv) * (num(row.avg_iv) <= 3 ? 100 : 1),
    delta: num(row.net_delta),
    theta: num(row.net_theta),
    spot: num(row.underlying_price),
    legs,
  };
}

export function useSpreads(limit = 80): LivePack<SpreadTrade[]> {
  return useLive(`spreads:${limit}`, async () => (await getRows(`/option-trades/multi-leg?limit=${limit}`)).map(spreadOf), []);
}

export function useSpreadLegs(id: string | null): LivePack<SpreadLeg[]> {
  return useLive(
    id ? `spread-legs:${id}` : 'spread-legs:off',
    async () => {
      const rows = await getRows(`/option-trades/multi-leg/${encodeURIComponent(id!)}/legs`);
      return rows.map(leg => spreadLeg(leg, ''));
    },
    [],
    !!id
  );
}

export type TideKind = 'market' | 'sector' | 'etf';

export interface TidePoint {
  /** Unix seconds — the pane's chart stamps the point. */
  time: number;
  callPrem: number;
  putPrem: number;
  volume: number;
  price: number;
}

export function useTide(kind: TideKind, name: string): LivePack<TidePoint[]> {
  const path =
    kind === 'sector'
      ? `/market/${encodeURIComponent(name || 'Technology')}/sector-tide?interval_5m=false`
      : kind === 'etf'
        ? `/market/${encodeURIComponent(name || 'SPY')}/etf-tide?interval_5m=false`
        : '/market/market-tide?interval_5m=false';
  return useLive(`tide:${kind}:${name}`, async () => {
    return (await getRows(path)).map(r => ({
      time: clock(r.timestamp || r.date).epoch,
      callPrem: num(r.net_call_premium),
      putPrem: num(r.net_put_premium),
      volume: Math.abs(num(r.net_volume)),
      price: num(r.close || r.price),
    })).filter(p => p.time > 0);
  }, []);
}

export interface TopNet {
  ticker: string;
  net: number;
  volume: number;
  count: number;
}

export function useTopNet(limit = 40): LivePack<TopNet[]> {
  return useLive(`top-net:${limit}`, async () => {
    return (await getRows(`/market/top-net-impact?limit=${limit}`)).map(r => ({
      ticker: String(r.ticker || '').toUpperCase(),
      net: num(r.net_premium),
      volume: num(r.volume),
      count: num(r.count) || 1,
    }));
  }, []);
}

export function useNetExpiry(moneyness: string, tenor: string): LivePack<TidePoint[]> {
  return useLive(`net-exp:${moneyness}:${tenor}`, async () => {
    const rows = await getRows(`/net-flow/expiry?moneyness=${encodeURIComponent(moneyness)}&tide_type=${encodeURIComponent(tenor)}`);
    return rows.map(r => ({
      time: clock(r.timestamp || r.expiry || r.date).epoch,
      callPrem: num(r.net_call_premium || r.call_premium),
      putPrem: num(r.net_put_premium || r.put_premium),
      volume: num(r.net_volume || r.volume),
      price: num(r.price),
    })).filter(p => p.time > 0);
  }, []);
}
