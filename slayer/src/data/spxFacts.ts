/* The SPX book Terrain may draw, computed from theta/cache/spx-book.json (cash SPX bars, SPXW greeks and OI, a year of VIX closes, SPXW prints).
   House sign (call gamma negative, put gamma positive: core/dealerSign.ts). The old dealer-participation weights
   (−0.55 calls, −0.53 puts) were a model, not the book, and are gone. */

import type { Candle } from '../types/market';
import type { KeyLevels } from '../types/gex';
import { pickLegWalls } from '../core/walls';
import { repricedFlip, type GammaLeg } from '../core/gammaFlip';
import { getCarry } from '../core/carry';
import { aggregateCandles } from './timeframe';

const YEAR = 252;

interface RawLeg {
  gamma: number;
  iv: number;
  oi: number;
  bid?: number;
  ask?: number;
}
interface RawStrike {
  strike: number;
  call?: RawLeg;
  put?: RawLeg;
}
export interface RawChain {
  expiration: string;
  spot: number;
  quoteAt: string;
  oiAt: string;
  strikes: RawStrike[];
}
export interface RawScore {
  day: string;
  open: number;
  close: number;
  iv: number;
  at: string;
  strike: number;
  band: number;
  inside: boolean | null;
}
export interface RawBook {
  symbol: string;
  option: string;
  builtAt: string;
  minute: Candle[];
  sec15: Candle[];
  daily: Candle[];
  chains: RawChain[];
  ivRank: {
    source: string;
    sessions: number;
    last: number | null;
    low: number | null;
    high: number | null;
    rank: number | null;
    from: string | null;
    to: string | null;
  };
  sessionIv: { day: string; iv: number; at: string; strike: number } | null;
  scorecard: RawScore[];
  prevClose: number | null;
  tapeDay: string;
  asOf: string | null;
  flow: { day: string; minutes: { time: number; call: number; put: number; callSize?: number; putSize?: number }[] } | null;
}

export interface ConeFact {
  /** What the number is. */
  name: 'session' | 'week' | 'next';
  /** Annualized IV the band was priced with. */
  iv: number;
  /** Where that IV was read. */
  source: string;
  /** Trading minutes the forward cone still covers. 0 once that horizon has passed. */
  forwardMin: number;
  /** ±1σ in dollars at the end of the horizon. */
  move: number;
  low: number;
  high: number;
  /** The date this horizon runs to, as "Oct 27". Empty when the chain did not name one. */
  expires: string;
  /** Session only: did the close stay inside the open's ±1σ. */
  inside: boolean | null;
}

export interface SpxRail {
  /** 'all' or YYYY-MM-DD */
  key: string;
  scope: string;
  spot: number;
  rows: { strike: number; value: number; callOI: number }[];
  legs: Map<number, { put: number; call: number }>;
  levels: KeyLevels;
  maxAbs: number;
  step: number;
  /** Strike with the most open interest in this cut. Null when the chain had none. */
  pin: number | null;
}

interface FlowBucket {
  time: number;
  callPrem: number;
  putPrem: number;
  count: number;
}

export interface SpxRead {
  builtAt: string;
  spot: number;
  prevClose: number;
  changePct: number | null;
  tapeDay: string;
  tapeLabel: string;
  asOf: string | null;
  minute: Candle[];
  sec15: Candle[];
  daily: Candle[];
  weekly: Candle[];
  ivRank: number | null;
  ivLast: number | null;
  ivLow: number | null;
  ivHigh: number | null;
  ivSessions: number;
  ivFrom: string | null;
  ivTo: string | null;
  /** Session IV used by the cone and the vol pane. Null when the morning quote is missing. */
  sessionIv: number | null;
  cones: { session: ConeFact | null; week: ConeFact | null; next: ConeFact | null };
  /** How many of the stored sessions closed inside that morning's ±1σ. */
  scoreInside: number;
  scoreOf: number;
  regime: string;
  /** Front expiry 25-delta skew: put IV minus call IV, in vol points. Null when no listed strike sits near 25 delta. */
  skew: SkewFact | null;
  pin: number | null;
  flowLabel: string | null;
  flowMinutes: { time: number; call: number; put: number }[];
  /** Whole book, then one rail per expiration date. */
  bookRail: SpxRail;
  byExpiry: Map<string, SpxRail>;
  line: string;
}

const NY = 'America/New_York';

function nyParts(sec: number): { y: number; m: number; d: number; hh: number; mm: number; wd: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(sec * 1000));
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return { y: Number(g('year')), m: Number(g('month')), d: Number(g('day')), hh: Number(g('hour')), mm: Number(g('minute')), wd: g('weekday') };
}

function ymdOf(sec: number): string {
  const p = nyParts(sec);
  return `${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}`;
}

function niceDay(ymd: string): string {
  if (ymd.length !== 8) return ymd;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(ymd.slice(4, 6)) - 1]} ${Number(ymd.slice(6, 8))}`;
}

function isoDay(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '');
}

/** Weekdays strictly after `fromYmd` and up through `toIso` (YYYY-MM-DD). */
function sessionsUntil(fromYmd: string, toIso: string): number {
  const to = toIso.slice(0, 10).replace(/-/g, '');
  if (to <= fromYmd) return 0;
  let n = 0;
  const d = new Date(Date.UTC(Number(fromYmd.slice(0, 4)), Number(fromYmd.slice(4, 6)) - 1, Number(fromYmd.slice(6, 8))));
  for (let i = 0; i < 30; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const key = `${y}${String(m).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
    if (key >= to) break;
  }
  return n;
}

function weekOf(sec: number): string {
  const p = nyParts(sec);
  const utc = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const wd = utc.getUTCDay();
  const back = wd === 0 ? 6 : wd - 1;
  utc.setUTCDate(utc.getUTCDate() - back);
  return utc.toISOString().slice(0, 10);
}

function weeklyOf(daily: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const b of daily) {
    const key = weekOf(b.time);
    const last = out[out.length - 1] as (Candle & { key?: string }) | undefined;
    if (!last || last.key !== key) {
      out.push({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, key } as Candle & { key: string });
    } else {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.time = b.time;
      last.volume += b.volume;
    }
  }
  return out.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }));
}

function dollar(oi: number, gamma: number, spot: number, side: 'call' | 'put'): number {
  const per = oi * 100 * gamma * spot * spot * 0.01;
  return side === 'call' ? -per : per;
}

export interface SkewFact {
  /** Front expiry, as "Oct 27". */
  expires: string;
  /** Put implied vol minus call implied vol, in vol points. Positive means the 25-delta put is richer. */
  points: number;
  callStrike: number;
  putStrike: number;
  callIv: number;
  putIv: number;
}

/** Abramowitz–Stegun. Close enough to tell a 0.24 delta from a 0.25. */
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
}

function bsDelta(spot: number, strike: number, t: number, iv: number, call: boolean): number | null {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(iv > 0) || iv > 3) return null;
  const sq = Math.sqrt(t);
  const carry = getCarry();
  const d1 = (Math.log(spot / strike) + (carry.r - carry.q + 0.5 * iv * iv) * t) / (iv * sq);
  const df = Math.exp(-carry.q * t);
  const n = normCdf(d1);
  return call ? df * n : df * (n - 1);
}

/** The listed call and put nearest a 25 delta, on this chain's own implied vols.
    A wing with no bid is skipped. Farther than 5 delta from the target, the number is not shown. */
function riskReversal(chain: RawChain, sessions: number): SkewFact | null {
  const t = Math.max(sessions, 1) / YEAR;
  const spot = chain.spot;
  let call: { strike: number; iv: number; miss: number } | null = null;
  let put: { strike: number; iv: number; miss: number } | null = null;
  for (const s of chain.strikes) {
    const callLeg = s.call;
    if (callLeg && callLeg.bid != null && callLeg.bid > 0) {
      const delta = bsDelta(spot, s.strike, t, callLeg.iv, true);
      if (delta != null) {
        const miss = Math.abs(delta - 0.25);
        if (!call || miss < call.miss) call = { strike: s.strike, iv: callLeg.iv, miss };
      }
    }
    const putLeg = s.put;
    if (putLeg && putLeg.bid != null && putLeg.bid > 0) {
      const delta = bsDelta(spot, s.strike, t, putLeg.iv, false);
      if (delta != null) {
        const miss = Math.abs(delta + 0.25);
        if (!put || miss < put.miss) put = { strike: s.strike, iv: putLeg.iv, miss };
      }
    }
  }
  if (!call || !put || call.miss > 0.05 || put.miss > 0.05) return null;
  return {
    expires: niceDay(isoDay(chain.expiration)),
    points: Math.round((put.iv - call.iv) * 1000) / 10,
    callStrike: call.strike,
    putStrike: put.strike,
    callIv: call.iv,
    putIv: put.iv,
  };
}

function atmIv(chain: RawChain): { iv: number; strike: number } | null {
  let best: { iv: number; strike: number; dist: number } | null = null;
  for (const s of chain.strikes) {
    const iv = s.call?.iv ?? 0;
    if (!(iv > 0) || !(chain.spot > 0)) continue;
    const dist = Math.abs(s.strike - chain.spot);
    if (!best || dist < best.dist) best = { iv, strike: s.strike, dist };
  }
  return best ? { iv: best.iv, strike: best.strike } : null;
}

function dailyAtr(daily: readonly Candle[], period = 14): number | null {
  if (daily.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < daily.length; i++) {
    const c = daily[i];
    const prev = daily[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
  }
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

interface Fold {
  byStrike: Map<number, { call: number; put: number; callOI: number; putOI: number }>;
  legs: GammaLeg[];
  pin: number | null;
  pinOi: number;
}

function foldChains(chains: readonly RawChain[], spot: number, fromYmd: string): Fold {
  const byStrike = new Map<number, { call: number; put: number; callOI: number; putOI: number }>();
  const legs: GammaLeg[] = [];
  let pin: number | null = null;
  let pinOi = 0;
  for (const chain of chains) {
    const sessions = Math.max(sessionsUntil(fromYmd, chain.expiration), 1);
    const t = sessions / YEAR;
    for (const s of chain.strikes) {
      const row = byStrike.get(s.strike) ?? { call: 0, put: 0, callOI: 0, putOI: 0 };
      const callOi = s.call?.oi ?? 0;
      const putOi = s.put?.oi ?? 0;
      const callG = s.call && s.call.gamma > 0 ? dollar(callOi, s.call.gamma, chain.spot || spot, 'call') : 0;
      const putG = s.put && s.put.gamma > 0 ? dollar(putOi, s.put.gamma, chain.spot || spot, 'put') : 0;
      row.call += callG;
      row.put += putG;
      row.callOI += callOi;
      row.putOI += putOi;
      byStrike.set(s.strike, row);
      if (callG !== 0 && (s.call?.iv ?? 0) > 0) {
        legs.push({ strike: s.strike, g0: callG, iv: s.call!.iv, t, oi: callOi, ownIv: true, s0: chain.spot || spot });
      }
      if (putG !== 0 && (s.put?.iv ?? 0) > 0) {
        legs.push({ strike: s.strike, g0: putG, iv: s.put!.iv, t, oi: putOi, ownIv: true, s0: chain.spot || spot });
      }
    }
  }
  for (const [strike, row] of byStrike) {
    const oi = row.callOI + row.putOI;
    if (oi > pinOi) {
      pinOi = oi;
      pin = strike;
    }
  }
  return { byStrike, legs, pin, pinOi };
}

function railFrom(key: string, scope: string, spot: number, fold: Fold): SpxRail {
  const rows = [...fold.byStrike.entries()]
    .map(([strike, v]) => ({ strike, value: v.call + v.put, callOI: v.callOI + v.putOI }))
    .sort((a, b) => b.strike - a.strike);
  const points = rows.map(r => {
    const v = fold.byStrike.get(r.strike)!;
    return { strike: r.strike, callGex: v.call, putGex: v.put, netGex: v.call + v.put };
  });
  const walls = pickLegWalls(points, n => n.callGex, n => n.putGex);
  let supreme = 0;
  let best = 0;
  for (const n of points) {
    const a = Math.abs(n.netGex);
    if (a > best) {
      best = a;
      supreme = n.strike;
    }
  }
  const flip = fold.legs.length ? repricedFlip(fold.legs, spot).flip : null;
  let maxPain: number | null = null;
  const oiRows = [...fold.byStrike.entries()].filter(([, v]) => v.callOI > 0 || v.putOI > 0);
  if (oiRows.length) {
    let best = Infinity;
    let bestDist = Infinity;
    for (const [S] of oiRows) {
      let pain = 0;
      for (const [K, v] of oiRows) {
        if (S > K) pain += v.callOI * (S - K);
        if (K > S) pain += v.putOI * (K - S);
      }
      const dist = Math.abs(S - spot);
      if (pain < best || (pain === best && dist < bestDist)) {
        best = pain;
        bestDist = dist;
        maxPain = S;
      }
    }
  }
  const legs = new Map<number, { put: number; call: number }>();
  for (const [strike, v] of fold.byStrike) legs.set(strike, { put: v.put, call: v.call });
  let maxAbs = 1;
  for (const r of rows) maxAbs = Math.max(maxAbs, Math.abs(r.value));
  const asc = [...rows].sort((a, b) => a.strike - b.strike);
  let step = Infinity;
  for (let i = 1; i < asc.length; i++) {
    const d = asc[i].strike - asc[i - 1].strike;
    if (d > 1e-9) step = Math.min(step, d);
  }
  if (!Number.isFinite(step) || step <= 0) step = 5;
  return {
    key,
    scope,
    spot,
    rows,
    legs,
    levels: {
      spot,
      callWall: walls.callWall != null && walls.callWall > 0 ? walls.callWall : NaN,
      putWall: walls.putWall != null && walls.putWall > 0 ? walls.putWall : NaN,
      flip: flip != null && flip > 0 ? flip : NaN,
      supreme: supreme > 0 ? supreme : NaN,
      pin: fold.pin != null && fold.pin > 0 ? fold.pin : undefined,
      maxPain: maxPain != null && maxPain > 0 ? maxPain : undefined,
    },
    maxAbs,
    step,
    pin: fold.pin,
  };
}

function move(spot: number, iv: number, sessions: number): number {
  if (!(spot > 0) || !(iv > 0) || !(sessions > 0)) return 0;
  return spot * iv * Math.sqrt(sessions / YEAR);
}

function cone(name: ConeFact['name'], spot: number, iv: number, source: string, sessions: number, forwardMin: number, inside: boolean | null, expires: string): ConeFact {
  const m = move(spot, iv, sessions);
  return { name, iv, source, forwardMin, move: m, low: spot - m, high: spot + m, inside, expires };
}

export function buildRead(raw: RawBook): SpxRead {
  const minute = raw.minute ?? [];
  const daily = raw.daily ?? [];
  const last = minute.length ? minute[minute.length - 1].close : daily.length ? daily[daily.length - 1].close : 0;
  const spot = last;
  const prev = raw.prevClose ?? 0;
  const changePct = prev > 0 && spot > 0 ? ((spot - prev) / prev) * 100 : null;
  const tapeDay = raw.tapeDay || (minute.length ? ymdOf(minute[minute.length - 1].time) : '');
  const p = minute.length ? nyParts(minute[minute.length - 1].time) : null;
  const tapeLabel = p ? `${p.wd} ${niceDay(tapeDay)} close` : tapeDay;
  const weekly = weeklyOf(daily);
  const iv = raw.ivRank ?? { rank: null, last: null, low: null, high: null, sessions: 0, from: null, to: null, source: '' };
  const ivRank = iv.rank == null ? null : Math.round(iv.rank * 1000) / 10;

  const sessionOpen = minute.length ? minute[0].open : 0;
  const sessionIv = raw.sessionIv && raw.sessionIv.iv > 0 ? raw.sessionIv.iv : null;
  const sessionMove = sessionOpen > 0 && sessionIv ? sessionOpen * sessionIv * Math.sqrt(1 / YEAR) : 0;
  const sessionInside = sessionMove > 0 && minute.length ? Math.abs(minute[minute.length - 1].close - sessionOpen) <= sessionMove : null;
  const sessionCone: ConeFact | null = sessionIv
    ? {
        name: 'session',
        iv: sessionIv,
        source: raw.sessionIv ? `0DTE ${raw.sessionIv.strike} at ${raw.sessionIv.at?.slice(11, 16) ?? ''} ET` : 'session',
        forwardMin: 0,
        move: sessionMove,
        low: sessionOpen - sessionMove,
        high: sessionOpen + sessionMove,
        expires: tapeDay.length === 8 ? niceDay(tapeDay) : '',
        inside: sessionInside,
      }
    : null;

  const chains = raw.chains ?? [];
  const after = chains
    .filter(c => isoDay(c.expiration) > tapeDay)
    .sort((a, b) => a.expiration.localeCompare(b.expiration));
  const nextChain = after[0] ?? null;
  const weekChain = [...after].reverse().find(c => {
    const dt = new Date(`${c.expiration}T12:00:00Z`);
    return dt.getUTCDay() === 5;
  }) ?? after[after.length - 1] ?? null;

  const nextAtm = nextChain ? atmIv(nextChain) : null;
  const weekAtm = weekChain ? atmIv(weekChain) : null;
  const nextSessions = nextChain ? sessionsUntil(tapeDay, nextChain.expiration) : 0;
  const weekSessions = weekChain ? sessionsUntil(tapeDay, weekChain.expiration) : 0;
  const nextCone = nextChain && nextAtm && nextSessions > 0
    ? cone('next', spot, nextAtm.iv, `${nextChain.expiration} ATM ${nextAtm.strike}`, nextSessions, nextSessions * 390, null, niceDay(isoDay(nextChain.expiration)))
    : null;
  const skew = nextChain && nextSessions > 0 ? riskReversal(nextChain, nextSessions) : null;
  const weekCone = weekChain && weekAtm && weekSessions > 0
    ? cone('week', spot, weekAtm.iv, `${weekChain.expiration} ATM ${weekAtm.strike}`, weekSessions, weekSessions * 390, null, niceDay(isoDay(weekChain.expiration)))
    : null;

  const quoteYmd = raw.asOf ? isoDay(raw.asOf) : tapeDay;
  const whole = foldChains(chains, spot, quoteYmd);
  const bookRail = railFrom('all', chains.length ? `SPXW ${chains.map(c => niceDay(isoDay(c.expiration))).join(' · ')}` : 'SPXW', spot, whole);
  const byExpiry = new Map<string, SpxRail>();
  for (const chain of chains) {
    const one = foldChains([chain], spot, quoteYmd);
    byExpiry.set(chain.expiration, railFrom(chain.expiration, `SPXW ${niceDay(isoDay(chain.expiration))}`, spot, one));
  }

  const net = [...whole.byStrike.values()].reduce((a, v) => a + v.call + v.put, 0);
  const atr = dailyAtr(daily);
  const flip = bookRail.levels.flip > 0 ? bookRail.levels.flip : null;
  const side = net < 0 ? 'Long gamma (moves tend to be damped)' : net > 0 ? 'Short gamma (moves tend to extend)' : 'Flat gamma';
  let regime = side;
  if (flip == null) regime += ' · no flip within 10%';
  else if (atr && atr > 0) {
    const d = spot - flip;
    regime += ` · ${Math.abs(d / atr).toFixed(1)} ATR ${d >= 0 ? 'above' : 'under'} the flip`;
  } else regime += ` · ${spot >= flip ? 'above' : 'under'} the flip`;

  const score = raw.scorecard ?? [];
  const scoreInside = score.filter(s => s.inside === true).length;

  const flowMinutes = raw.flow?.minutes?.map(m => ({ time: m.time, call: m.call, put: m.put })) ?? [];
  const flowLabel = raw.flow ? `SPXW prints · ${niceDay(raw.flow.day)}` : null;

  const usd = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
  const ivBit = ivRank == null || iv.last == null
    ? 'IV rank —'
    : `IV rank ${ivRank} · VIX ${iv.last.toFixed(2)} · ${iv.low?.toFixed(2)}–${iv.high?.toFixed(2)} · ${iv.sessions} sessions`;
  const sessBit = sessionCone
    ? `session ±${usd(sessionCone.move)} (${usd(sessionCone.low)}–${usd(sessionCone.high)}) ${sessionCone.inside ? 'inside' : 'outside'}`
    : 'session —';
  const weekBit = weekCone ? `week ±${usd(weekCone.move)} to ${niceDay(isoDay(weekChain!.expiration))}` : 'week —';
  const nextBit = nextCone ? `next ±${usd(nextCone.move)} to ${niceDay(isoDay(nextChain!.expiration))}` : 'next —';
  const scoreBit = score.length ? `closed inside on ${scoreInside} of the last ${score.length}` : 'no scorecard';
  const skewBit = skew ? `25Δ skew ${skew.points > 0 ? '+' : ''}${skew.points.toFixed(1)} ${skew.expires}` : '25Δ skew —';
  const line = `${tapeLabel} · ${ivBit} · ${sessBit} · ${weekBit} · ${nextBit} · ${scoreBit} · ${skewBit} · ${regime} · ${bookRail.scope}`;

  return {
    builtAt: raw.builtAt,
    spot,
    prevClose: prev,
    changePct,
    tapeDay,
    tapeLabel,
    asOf: raw.asOf,
    minute,
    sec15: raw.sec15 ?? [],
    daily,
    weekly,
    ivRank,
    ivLast: iv.last,
    ivLow: iv.low,
    ivHigh: iv.high,
    ivSessions: iv.sessions,
    ivFrom: iv.from,
    ivTo: iv.to,
    sessionIv,
    cones: { session: sessionCone, week: weekCone, next: nextCone },
    scoreInside,
    scoreOf: score.length,
    regime,
    skew,
    pin: whole.pin,
    flowLabel,
    flowMinutes,
    bookRail,
    byExpiry,
    line,
  };
}

/** Bars for one timeframe. Sub-minute is the 15-second tape, never a resampled minute. */
export function barsForRead(read: SpxRead, mins: number): Candle[] {
  if (mins < 1) return read.sec15;
  if (mins >= 10080) return read.weekly;
  if (mins >= 1440) return read.daily;
  if (mins <= 1) return read.minute;
  return aggregateCandles(read.minute, mins);
}

/** SPXW premium already summed by minute, folded onto this chart's bar size. */
export function flowBuckets(read: SpxRead, barSec: number): FlowBucket[] {
  const width = Math.max(1, Math.floor(barSec));
  const by = new Map<number, FlowBucket>();
  for (const m of read.flowMinutes) {
    if (!(m.call > 0) && !(m.put > 0)) continue;
    const time = Math.floor(m.time / width) * width;
    let bar = by.get(time);
    if (!bar) {
      bar = { time, callPrem: 0, putPrem: 0, count: 0 };
      by.set(time, bar);
    }
    bar.callPrem += m.call;
    bar.putPrem += m.put;
    bar.count += 1;
  }
  return [...by.values()].sort((a, b) => a.time - b.time);
}

