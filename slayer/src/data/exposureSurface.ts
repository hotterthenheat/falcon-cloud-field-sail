/* Strike × expiry × greek, the book across the calendar, from the vendor's per-date rows (liveSurface). */

import { buildExposureProfile, type StrikeWindow } from './exposure';
import { DESK_DTES } from './weigherDesk';
import { blackScholesGreeks } from '../core/greeks';
import { spotChangePct } from './gex';
import { bookToday, isoDate, isTradingDay, nextSession, MONTHS } from '../core/calendar';
import { nyIsoDate } from '../core/nyTime';
import { expiryOpen } from '../core/tradingYear';
import { expiryLabel } from './book/levels';
import { peekIv } from './book/move';
import { HIGHER_KEYS, addHigher, amStrikeHigher, chainClock, contractHigher, strikeHigher, type HigherKey } from './liveHigher';
import { pickLegWalls } from '../core/walls';
import { carryFor } from '../core/carry';
import type { MarketSnapshot, StrikeNode } from '../types/market';
import type { ExposureLevels, ExposureProfileData } from '../types/gex';

/** Gamma, delta, vega, vanna, charm, and the five higher greeks calculated off each contract's own vol. */
export type Greek = 'gex' | 'dex' | 'vex' | 'vanna' | 'charm' | 'color' | 'vomma' | 'speed' | 'veta' | 'zomma';
export type BookMode = 'oi' | 'flow';
export const GREEKS: Greek[] = ['gex', 'dex', 'vex', 'vanna', 'charm', 'color', 'vomma', 'speed', 'veta', 'zomma'];
/** Needs the option-contracts read. Spot GEX, DEX and charm do not (charm stands in off the vendor's rows until the
    contracts are read, then is priced off them); vanna does (book/scale.ts prices it off the contracts — the vendor's
    vanna unit is not one unit across names). */
const CONTRACT_GREEKS: ReadonlySet<Greek> = new Set<Greek>(['vex', 'vanna', 'color', 'vomma', 'speed', 'veta', 'zomma']);
export const isContractGreek = (g: Greek): boolean => CONTRACT_GREEKS.has(g);

/** True once a live book's contracts have been read, or immediately for a house chain that already carries vega. */
export function contractsReady(snapshot: MarketSnapshot | null | undefined): boolean {
  if (!snapshot?.liveBook) return true;
  if (snapshot.uwFacts && snapshot.uwFacts.size > 0) return true;
  const by = snapshot.uwByDate;
  if (!by) return false;
  for (const chain of Object.values(by)) {
    if (chain?.some(n => (n.callIv ?? 0) > 0 || (n.putIv ?? 0) > 0 || n.callVex !== 0 || n.putVex !== 0)) return true;
  }
  return false;
}

/** The unit each greek is stated in — the matrix's own headers. */
export const GREEK_UNIT: Record<Greek, string> = {
  gex: '1% move',
  dex: '$ of stock',
  vex: '1 vol pt',
  vanna: '1 vol pt',
  charm: 'per session',
  color: 'per session',
  vomma: 'per vol pt',
  speed: 'per 1%',
  veta: 'per session',
  zomma: 'per vol pt',
};

/** Today's column, or -1. The one-column 'Book' fallback (no per-expiry chains loaded) also reads dte 0 but is the
 *  whole book, not today's expiry — counting it made the Board read "100% expires today" on names with no 0DTE. */
export const todayColumn = (surface: { expiries: readonly SurfaceExpiry[] }): number =>
  surface.expiries.findIndex(e => e.dte === 0 && e.short !== 'Book');

/** The share of the drawn gamma that expires today, percent — gross, |call| + |put| a cell, the Board's own measure
    (book/levels.ts peekBellShare); null without a today column. A book with no live share (Practice, a replay) reads it
    off its surface. It once summed |net| a cell, so a strike whose calls and puts cancel counted as nothing expiring. */
export function surfaceBellShare(surface: Pick<ExposureSurface, 'expiries' | 'strikes' | 'call' | 'put'>): number | null {
  const today = todayColumn(surface);
  if (today < 0) return null;
  let dies = 0;
  let total = 0;
  for (let e = 0; e < surface.expiries.length; e++)
    for (let s = 0; s < surface.strikes.length; s++) {
      const v = Math.abs(surface.call.gex[e]?.[s] ?? 0) + Math.abs(surface.put.gex[e]?.[s] ?? 0);
      total += v;
      if (e === today) dies += v;
    }
  return total > 0 ? Math.round((100 * dies) / total) : null;
}

export interface SurfaceExpiry {
  dte: number;
  /** "0DTE", "2d", "45d" */
  short: string;
  /** "Sep 3" */
  date: string;
  /** At-the-money implied vol for this expiry, as a fraction (0.18 = 18%) */
  iv: number;
  /** Trading sessions until it expires — 0 on the day itself */
  sessions: number;
  /** The expiry, YYYY-MM-DD, on a live book */
  iso?: string;
}

export interface KingNode {
  strike: number;
  /** Index into `expiries` */
  e: number;
  value: number;
}

/** The supreme: the heaviest strike of the whole book (magenta everywhere), with the date carrying most of it; the heaviest cell is `king`. */
export interface SupremeNode {
  strike: number;
  /** Index into `expiries` — the date holding most of this strike's hedging */
  e: number;
  /** That date's cell, signed dollars */
  value: number;
  /** The strike's whole-book net — the number the chart and the ladder carry */
  total: number;
}

export interface ExposureSurface {
  ticker: string;
  spot: number;
  changePct: number;
  /** Ascending */
  strikes: number[];
  /** Nearest first */
  expiries: SurfaceExpiry[];
  /** [greek][expiry][strike], signed dollars — the put and call legs and their net */
  put: Record<Greek, number[][]>;
  call: Record<Greek, number[][]>;
  net: Record<Greek, number[][]>;
  /** [expiry][strike] */
  oi: number[][];
  /** Per greek, the largest |net| anywhere on the surface */
  maxAbs: Record<Greek, number>;
  /** Per greek, the heaviest single cell on the calendar — the star, never the supreme */
  king: Record<Greek, KingNode>;
  /** Per greek, the heaviest strike of the whole book — the supreme, magenta everywhere */
  supreme: Record<Greek, SupremeNode>;
  /** Per greek, per expiry: false means the contracts are not in yet, or the expiry has no time left. A cell there is not zero. */
  priced: Record<Greek, boolean[]>;
  levels: ExposureLevels;
  /** The front book — the ladder's own profile */
  front: ExposureProfileData;
  /** Legs on the drawn strikes that had a contract count and no usable vol. */
  skipped?: number;
  /** Per expiry: the cash close on that date has passed. Higher greeks there are a dash, not a zero. */
  closed?: boolean[];
  /** Per expiry, per strike: at least one leg was left out because it had no vol. */
  miss?: boolean[][];
  /** The next chain is not in yet. The rail says so instead of going blank. */
  waiting?: string | null;
  /** Which book the cells were read from. */
  mode?: BookMode;
  /** Flow sign disagrees with the open-interest cell, per expiry then strike. */
  disagree?: boolean[][];
  /** The live snapshot the surface was read off (the profile re-prices its dates with the flip's own legs) */
  book?: MarketSnapshot;
}

/** The ledger's calendar: this week's dailies, Fridays out to seven weeks, monthlies to a quarter, each resolved to a real session and deduped. */
export const CALENDAR_DTES = [0, 1, 2, 3, 4, 7, 14, 21, 28, 35, 42, 49, 63, 77, 91] as const;

const EPS = 1e-6;

const HIGHER: ReadonlySet<Greek> = new Set<Greek>(HIGHER_KEYS);

/** Trading sessions after New York's today up to and including the expiry's (0 on the day itself; the day before, 1;
    a Friday's for Monday, 1 — not the calendar days, which count the weekend). */
export function sessionsTo(expiry: string, nowMs = Date.now()): number {
  const [y, m, d] = nyIsoDate(nowMs).split('-').map(Number);
  let n = 0;
  for (let k = 1; k < 800; k++) {
    const day = new Date(y, m - 1, d + k);
    if (isoDate(day) > expiry) break;
    if (isTradingDay(day)) n++;
  }
  return n;
}

/** At-the-money implied vol on this column's own contracts. 0 when none is printed — never a stand-in vol. */
function atmIvOf(chain: readonly StrikeNode[], spot: number): number {
  if (!(spot > 0)) return 0;
  let best = 0;
  let dist = Infinity;
  for (const n of chain) {
    const c = n.callIv ?? 0;
    const p = n.putIv ?? 0;
    const iv = c > 0 && p > 0 ? (c + p) / 2 : c > 0 ? c : p;
    if (!(iv > 0) || iv > 3) continue;
    const d = Math.abs(n.strike - spot);
    if (d < dist) {
      dist = d;
      best = iv;
    }
  }
  return best;
}

function columnFacts(chain: readonly StrikeNode[], date: string, facts: ReadonlySet<string> | undefined): boolean {
  if (date && facts?.has(date)) return true;
  return chain.some(n => (n.callIv ?? 0) > 0 || (n.putIv ?? 0) > 0 || n.callVex !== 0 || n.putVex !== 0);
}

function legOf(n: StrikeNode | undefined, greek: Greek, mode: BookMode = 'oi'): { put: number; call: number } {
  if (!n) return { put: 0, call: 0 };
  const f = mode === 'flow' ? n.flow : undefined;
  if (f) {
    if (greek === 'gex') return f.gex;
    if (greek === 'dex') return f.dex;
    if (greek === 'vex') return f.vex;
    if (greek === 'vanna') return f.vanna;
    return f.charm;
  }
  if (greek === 'gex') return { put: n.putGex, call: n.callGex };
  if (greek === 'dex') return { put: n.putDex, call: n.callDex };
  if (greek === 'vex') return { put: n.putVex, call: n.callVex };
  if (greek === 'vanna') return { put: n.putVanna, call: n.callVanna };
  return { put: n.putCharm, call: n.callCharm };
}

/** The calendar from the vendor's own rows, one column a real expiry. No simulated term structure. */
function liveSurface(snapshot: MarketSnapshot, half: StrikeWindow, mode: BookMode = 'oi'): ExposureSurface {
  const front = buildExposureProfile(snapshot, snapshot.uwChains?.['0DTE']?.length ? '0DTE' : 'ALL', half);
  const rows = [...front.strikes].sort((a, b) => a.strike - b.strike);
  const strikes = rows.map(r => r.strike);
  const byDate = snapshot.uwByDate ?? {};
  const listedAll = (snapshot.uwExpiries ?? [])
    .filter(e => byDate[e.date]?.length)
    .sort((a, b) => a.date.localeCompare(b.date) || a.dte - b.dte);
  /* A settled expiry keeps a five-minute gamma floor so a re-price does not explode. That number must not be a column.
     From 16:00 the chart is already on the next expiry; the rail drops the one that just died. */
  const listed = listedAll.filter(e => expiryOpen(e.date));
  const cols: { date: string; dte: number; chain: StrikeNode[] }[] = listed.map(e => ({ date: e.date, dte: e.dte, chain: byDate[e.date] }));
  const settledHadChain = Object.keys(byDate).some(d => (byDate[d]?.length ?? 0) > 0 && !expiryOpen(d));
  let waiting: string | null = null;
  if (!cols.length && settledHadChain) {
    const next = (snapshot.uwExpiries ?? []).find(e => expiryOpen(e.date))?.date ?? isoDate(nextSession(bookToday()));
    waiting = `waiting for ${expiryLabel(next)} chain`;
  }
  if (!cols.length && !listedAll.length && !waiting) cols.push({ date: '', dte: 0, chain: snapshot.chain });

  const nameIv = peekIv(snapshot.ticker) ?? 0;
  const expiries: SurfaceExpiry[] = cols.map(c => {
    /* A dated column takes that expiry's own at-the-money vol. The undated whole-book column takes the name's
       printed vol. Neither is filled with a sample. */
    const iv = c.date ? atmIvOf(c.chain, snapshot.spot) : nameIv;
    if (!c.date) return { dte: 0, short: 'Book', date: 'All', iv, sessions: 0 };
    const parts = c.date.split('-').map(Number);
    return { dte: c.dte, short: c.dte === 0 ? '0DTE' : `${c.dte}d`, date: `${MONTHS[parts[1] - 1]} ${parts[2]}`, iv, sessions: sessionsTo(c.date), iso: c.date };
  });

  const put = {} as ExposureSurface['put'];
  const call = {} as ExposureSurface['call'];
  const net = {} as ExposureSurface['net'];
  const maxAbs = {} as Record<Greek, number>;
  const king = {} as Record<Greek, KingNode>;
  const factCol = cols.map(c => columnFacts(c.chain, c.date, snapshot.uwFacts));
  const want = new Set(strikes);
  const closed: boolean[] = [];
  const miss: boolean[][] = [];
  let skipped = 0;
  const carry = carryFor(snapshot.ticker);
  const higherCols: Array<Map<number, Record<HigherKey, { call: number; put: number }>> | null> = cols.map((col, i) => {
    const blankMiss = strikes.map(() => false);
    miss.push(blankMiss);
    if (!factCol[i] || !col.date) {
      closed.push(false);
      return null;
    }
    const { years: t, volPt, at: clockAt } = chainClock(col.chain, col.date);
    /* No time left is not a zero. The column is marked closed and the cells stay blank. */
    if (t == null) {
      closed.push(true);
      return null;
    }
    closed.push(false);
    const pricedSpot = col.chain.find(n => (n.bookPx ?? 0) > 0)?.bookPx ?? snapshot.spot;
    const m = new Map<number, Record<HigherKey, { call: number; put: number }>>();
    const at = new Map(strikes.map((s, si) => [s, si]));
    for (const node of col.chain) {
      if (!want.has(node.strike)) continue;
      /* the PM contracts on the date's clock; the live AM contracts (node.am) on theirs, added below */
      const callN = node.callBook ?? node.callOI - (node.am?.callOI ?? 0);
      const putN = node.putBook ?? node.putOI - (node.am?.putOI ?? 0);
      const callOk = (node.callIv ?? 0) > 0 && (node.callIv ?? 0) <= 3;
      const putOk = (node.putIv ?? 0) > 0 && (node.putIv ?? 0) <= 3;
      let dropped = false;
      if (callN !== 0 && !callOk) {
        skipped += 1;
        dropped = true;
      }
      if (putN !== 0 && !putOk) {
        skipped += 1;
        dropped = true;
      }
      const si = at.get(node.strike);
      if (si != null && dropped) blankMiss[si] = true;
      const h = mode === 'flow' && node.flow
        ? { color: node.flow.color, vomma: node.flow.vomma, speed: node.flow.speed, veta: node.flow.veta, zomma: node.flow.zomma }
        : addHigher(strikeHigher(pricedSpot, node.strike, t, node.callIv, node.putIv, callN, putN, volPt, carry.r, carry.q), amStrikeHigher(pricedSpot, node, col.date, clockAt, carry.r, carry.q));
      if (h) m.set(node.strike, h);
    }
    return m;
  });
  const priced = {} as Record<Greek, boolean[]>;
  for (const greek of GREEKS) {
    maxAbs[greek] = 1;
    king[greek] = { strike: strikes[0] ?? snapshot.spot, e: 0, value: 0 };
    priced[greek] = isContractGreek(greek) ? factCol.slice() : cols.map(() => true);
    if (HIGHER.has(greek)) priced[greek] = priced[greek].map((ok, e) => ok && !closed[e]);
    const p: number[][] = [];
    const c: number[][] = [];
    const n: number[][] = [];
    cols.forEach((col, e) => {
      const byStrike = new Map(col.chain.map(node => [node.strike, node]));
      const higher = higherCols[e];
      const pr: number[] = [];
      const cr: number[] = [];
      const nr: number[] = [];
      for (const s of strikes) {
        let pv: number;
        let cv: number;
        if (HIGHER.has(greek)) {
          const h = higher?.get(s);
          pv = h ? h[greek as HigherKey].put : 0;
          cv = h ? h[greek as HigherKey].call : 0;
        } else {
          const leg = legOf(byStrike.get(s), greek, mode);
          pv = leg.put;
          cv = leg.call;
        }
        pr.push(pv);
        cr.push(cv);
        const nv = pv + cv;
        nr.push(nv);
        if (priced[greek][e] === false) continue;
        const a = Math.abs(nv);
        if (a > maxAbs[greek]) maxAbs[greek] = a;
        if (a > Math.abs(king[greek].value)) king[greek] = { strike: s, e, value: nv };
      }
      p.push(pr);
      c.push(cr);
      n.push(nr);
    });
    put[greek] = p;
    call[greek] = c;
    net[greek] = n;
  }

  const oi = cols.map(col => {
    const byStrike = new Map(col.chain.map(node => [node.strike, node]));
    return strikes.map(s => {
      const node = byStrike.get(s);
      return node ? node.callOI + node.putOI : 0;
    });
  });

  const supreme = {} as Record<Greek, SupremeNode>;
  for (const greek of GREEKS) {
    let strike = front.levels.supreme;
    if (greek !== 'gex') {
      let best = 0;
      if (isContractGreek(greek)) {
        for (let si = 0; si < strikes.length; si++) {
          let summed = 0;
          for (let x = 0; x < expiries.length; x++) {
            if (priced[greek][x] === false) continue;
            summed += net[greek][x][si] ?? 0;
          }
          if (Math.abs(summed) > Math.abs(best)) {
            best = summed;
            strike = strikes[si];
          }
        }
      } else {
        for (const r of rows) {
          const a = Math.abs(r[greek].net);
          if (a > best) {
            best = a;
            strike = r.strike;
          }
        }
      }
    }
    const si = strikes.indexOf(strike);
    let e = 0;
    let value = 0;
    if (si >= 0) {
      for (let x = 0; x < expiries.length; x++) {
        if (priced[greek][x] === false) continue;
        const v = net[greek][x][si] ?? 0;
        if (Math.abs(v) > Math.abs(value)) {
          value = v;
          e = x;
        }
      }
    }
    let total = si >= 0 ? rows[si][greek].net : 0;
    if (isContractGreek(greek) && si >= 0) {
      total = 0;
      for (let x = 0; x < expiries.length; x++) {
        if (priced[greek][x] === false) continue;
        total += net[greek][x][si] ?? 0;
      }
    }
    supreme[greek] = { strike, e, value, total };
  }

  const levels = { ...front.levels };
  if (mode === 'flow') {
    const pts = strikes.map((strike, si) => {
      let callSum = 0;
      let putSum = 0;
      for (let e = 0; e < cols.length; e++) {
        callSum += call.gex[e][si] ?? 0;
        putSum += put.gex[e][si] ?? 0;
      }
      return { strike, callSum, putSum, net: callSum + putSum };
    });
    const walls = pickLegWalls(pts, p => p.callSum, p => p.putSum);
    let supremeStrike = Number.NaN;
    let best = 0;
    for (const p of pts) {
      const a = Math.abs(p.net);
      if (a > best) {
        best = a;
        supremeStrike = p.strike;
      }
    }
    const ordered = [...pts].sort((a, b) => a.strike - b.strike);
    let prev = 0;
    let flip = front.levels.flip;
    let flipFound = false;
    let flipDist = Infinity;
    for (const p of ordered) {
      if (prev !== 0 && p.net !== 0 && Math.sign(prev) !== Math.sign(p.net)) {
        const dist = Math.abs(p.strike - snapshot.spot);
        if (dist < flipDist && dist <= snapshot.spot * 0.1) {
          flipDist = dist;
          flip = p.strike;
          flipFound = true;
        }
      }
      if (p.net !== 0) prev = p.net;
    }
    levels.callWall = walls.callWall ?? Number.NaN;
    levels.putWall = walls.putWall ?? Number.NaN;
    levels.callWallFound = walls.callWall != null;
    levels.putWallFound = walls.putWall != null;
    levels.supreme = supremeStrike;
    levels.flip = flip;
    levels.flipFound = flipFound;
  }
  const disagree = mode === 'flow'
    ? cols.map(col => {
        const by = new Map(col.chain.map(node => [node.strike, node]));
        return strikes.map(s => !!by.get(s)?.flow?.disagree);
      })
    : undefined;

  return {
    ticker: snapshot.ticker,
    spot: snapshot.spot,
    changePct: snapshot.changePercent,
    strikes,
    expiries,
    put,
    call,
    net,
    oi,
    maxAbs,
    king,
    supreme,
    priced,
    levels,
    front,
    skipped,
    closed,
    miss,
    waiting,
    mode,
    disagree,
    book: snapshot,
  };
}

/** `pricedOff`: whose spot and OI the desk's expiries are priced from, the live book or the snapshot given (levelview snapshotAtOpen). */
export function buildExposureSurface(snapshot: MarketSnapshot, half: StrikeWindow, _dtes: readonly number[] = DESK_DTES, _pricedOff: 'live' | 'snapshot' = 'live', mode: BookMode = 'oi'): ExposureSurface {
  /* Every book is the vendor's per-date rows: there is no modelled chain to stand in for an expiry */
  return liveSurface(snapshot, half, mode);
}
