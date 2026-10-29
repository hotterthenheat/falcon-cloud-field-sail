/*
==================================================
  SLAYER TERMINAL - EXPOSURE SURFACE (exposureSurface.ts)
  Strike × EXPIRY × greek — the book across the whole
  calendar (Noah, 2026-09-03, holding Skylit's
  heatmap beside the Field: dates as columns, one
  greek at a time or all three, the king node, a
  strike range — "we are going nowhere until we come
  up with something generational").

  HONEST TERM STRUCTURE. The profile's expiry lens
  scales the whole book by one factor, which cannot
  draw a range — every expiry would be the same
  ridge at a different height. The Weigher's desk
  chains can: they price real per-expiry contracts
  (gamma, delta, vega, open interest per strike and
  side) through one estimator, so gamma decays into
  the future, vega grows, and open interest sits
  where each expiry's book actually is.

  ONE BOOK, STILL. The FRONT row is the ladder's own
  numbers, exactly — the 0DTE profile every other
  surface on the page reads — and each farther
  expiry is the desk's leg at that strike, carried
  in the front leg's sign and scaled by the front
  leg's own ratio to its desk twin. The ladder and
  the range can never disagree about today, and the
  calendar behind today is the estimator's, not a
  decay table's.
==================================================
*/

import { buildExposureProfile, type StrikeWindow } from './exposure';
import { buildDeskChain, DESK_DTES } from './weigherDesk';
import { blackScholesGreeks } from '../core/greeks';
import { spotChangePct } from './gex';
import { bookToday, isoDate, nextSession, MONTHS } from '../core/calendar';
import { expiryOpen } from '../core/tradingYear';
import { expiryLabel, peekIv } from './uwBook';
import { HIGHER_KEYS, contractHigher, strikeHigher, yearsLeft, type HigherKey } from './liveHigher';
import type { MarketSnapshot, StrikeNode } from '../types/market';
import type { ExposureLevels, ExposureProfileData } from '../types/gex';

/** Gamma, delta, vega, vanna, charm, and the five higher greeks calculated off each contract's own vol. */
export type Greek = 'gex' | 'dex' | 'vex' | 'vanna' | 'charm' | 'color' | 'vomma' | 'speed' | 'veta' | 'zomma';
export const GREEKS: Greek[] = ['gex', 'dex', 'vex', 'vanna', 'charm', 'color', 'vomma', 'speed', 'veta', 'zomma'];
/** Needs the option-contracts read. Spot GEX, DEX, vanna and charm do not. */
const CONTRACT_GREEKS: ReadonlySet<Greek> = new Set<Greek>(['vex', 'color', 'vomma', 'speed', 'veta', 'zomma']);
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
  dex: '1σ move',
  vex: '1 vol pt',
  vanna: '1 vol pt',
  charm: '1 day',
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
}

export interface KingNode {
  strike: number;
  /** Index into `expiries` */
  e: number;
  value: number;
}

/** THE SUPREME — the heaviest STRIKE of the whole book, the one the chart
    wears in magenta and every other page names; here with the date that
    carries most of it. Not the heaviest cell: that is `king`, the star.
    (Noah, 2026-09-08: the chart's magenta trail and the ledger's SUPREME chip
    named two different strikes — one was a strike, the other a cell.) */
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
}

/** The ledger's calendar (Noah, 2026-09-04: "increase the amount of dates you
    can see at a time"): this week's dailies, the Fridays out to seven weeks,
    then the monthlies to a quarter — each resolved to a real session and
    deduped below, so two horizons on one Friday are one column. */
export const CALENDAR_DTES = [0, 1, 2, 3, 4, 7, 14, 21, 28, 35, 42, 49, 63, 77, 91] as const;

const EPS = 1e-6;
/** The dealers' side of each leg — the simulator's own numbers (core/simulator.ts, the chain builder) */
const DEALER_CALL = -0.55;
const DEALER_PUT = -0.53;
/** The greeks whose legs come signed and ready from the desk chain, never anchored to the front */
const DIRECT: ReadonlySet<Greek> = new Set<Greek>(['vanna', 'charm', 'color', 'vomma', 'speed', 'veta', 'zomma']);

const HIGHER: ReadonlySet<Greek> = new Set<Greek>(HIGHER_KEYS);

function columnFacts(chain: readonly StrikeNode[], date: string, facts: ReadonlySet<string> | undefined): boolean {
  if (date && facts?.has(date)) return true;
  return chain.some(n => (n.callIv ?? 0) > 0 || (n.putIv ?? 0) > 0 || n.callVex !== 0 || n.putVex !== 0);
}

function legOf(n: StrikeNode | undefined, greek: Greek): { put: number; call: number } {
  if (!n) return { put: 0, call: 0 };
  if (greek === 'gex') return { put: n.putGex, call: n.callGex };
  if (greek === 'dex') return { put: n.putDex, call: n.callDex };
  if (greek === 'vex') return { put: n.putVex, call: n.callVex };
  if (greek === 'vanna') return { put: n.putVanna, call: n.callVanna };
  return { put: n.putCharm, call: n.callCharm };
}

/** The calendar from the vendor's own rows, one column a real expiry. No simulated term structure. */
function liveSurface(snapshot: MarketSnapshot, half: StrikeWindow): ExposureSurface {
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

  const iv = peekIv(snapshot.ticker) ?? 0.2;
  const expiries: SurfaceExpiry[] = cols.map(c => {
    if (!c.date) return { dte: 0, short: 'Book', date: 'All', iv, sessions: 0 };
    const parts = c.date.split('-').map(Number);
    return { dte: c.dte, short: c.dte === 0 ? '0DTE' : `${c.dte}d`, date: `${MONTHS[parts[1] - 1]} ${parts[2]}`, iv, sessions: c.dte };
  });

  const put = {} as ExposureSurface['put'];
  const call = {} as ExposureSurface['call'];
  const net = {} as ExposureSurface['net'];
  const maxAbs = {} as Record<Greek, number>;
  const king = {} as Record<Greek, KingNode>;
  const factCol = cols.map(c => columnFacts(c.chain, c.date, snapshot.uwFacts));
  const want = new Set(strikes);
  const yearCache = new Map<string, number | null>();
  const closed: boolean[] = [];
  const miss: boolean[][] = [];
  let skipped = 0;
  const higherCols: Array<Map<number, Record<HigherKey, { call: number; put: number }>> | null> = cols.map((col, i) => {
    const blankMiss = strikes.map(() => false);
    miss.push(blankMiss);
    if (!factCol[i] || !col.date) {
      closed.push(false);
      return null;
    }
    let t = yearCache.get(col.date);
    if (t === undefined) {
      t = yearsLeft(col.date);
      yearCache.set(col.date, t);
    }
    /* No time left is not a zero. The column is marked closed and the cells stay blank. */
    if (t == null) {
      closed.push(true);
      return null;
    }
    closed.push(false);
    const m = new Map<number, Record<HigherKey, { call: number; put: number }>>();
    const at = new Map(strikes.map((s, si) => [s, si]));
    for (const node of col.chain) {
      if (!want.has(node.strike)) continue;
      const callN = node.callBook ?? node.callOI;
      const putN = node.putBook ?? node.putOI;
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
      const h = strikeHigher(snapshot.spot, node.strike, t, node.callIv, node.putIv, callN, putN);
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
          const leg = legOf(byStrike.get(s), greek);
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
    levels: front.levels,
    front,
    skipped,
    closed,
    miss,
    waiting,
  };
}

/** `pricedOff`: whose spot and open interest the desk's expiries are priced from — the live simulator's (every surface
    on screen, the replay's columns included, as before) or the SNAPSHOT GIVEN (the book at the session's open, from
    levelview's `snapshotAtOpen`, for the calendar's "since the open" badges — 2026-10-12) */
export function buildExposureSurface(snapshot: MarketSnapshot, half: StrikeWindow, dtes: readonly number[] = DESK_DTES, pricedOff: 'live' | 'snapshot' = 'live'): ExposureSurface {
  if (snapshot.liveBook) return liveSurface(snapshot, half);
  const front = buildExposureProfile(snapshot, '0DTE', half);
  const rows = [...front.strikes].sort((a, b) => a.strike - b.strike);
  const strikes = rows.map(r => r.strike);
  const { ticker, spot } = snapshot;
  const sigma1 = (iv: number) => (iv / 100) * Math.sqrt(1 / 252);

  /* The desk's legs per expiry, as MAGNITUDES — the sign is the front leg's. */
  type Legs = { put: number; call: number };
  const deskLegs = {} as Record<Greek, Legs[][]>;
  for (const g of GREEKS) deskLegs[g] = [];
  const oi: number[][] = [];
  const expiries: SurfaceExpiry[] = [];
  const seen = new Set<string>();
  for (const dte of dtes) {
    const chain = buildDeskChain(ticker, dte, half, pricedOff === 'snapshot' ? snapshot : undefined);
    const key = chain.expiry.date.toISOString().slice(0, 10);
    if (seen.has(key)) continue; // two horizons on one Friday are one expiry
    seen.add(key);
    const d = chain.expiry.date;
    /* The expiry's own vol and time — what sets how far its gamma reaches
       along price (the Reach draws each expiry at that width). ATM iv is the
       nearest-to-spot row's two legs averaged, on the desk's own smile. */
    const atm = chain.rows.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best), chain.rows[0]);
    const iv = atm ? (atm.put.iv + atm.call.iv) / 200 : 0.2;
    expiries.push({ dte, short: dte === 0 ? '0DTE' : `${dte}d`, date: `${MONTHS[d.getMonth()]} ${d.getDate()}`, iv, sessions: chain.expiry.sessions });
    const byStrike = new Map(chain.rows.map(r => [r.strike, r]));
    const bag = {} as Record<Greek, Legs[]>;
    for (const g of GREEKS) bag[g] = [];
    const oiRow: number[] = [];
    /* Vanna, charm and the higher greeks come from this expiry's own time and vol.
       Higher greeks take −1 on both legs (dealers short the option), not the 0.55 participation. */
    const years = Math.max(0.5, chain.expiry.sessions) / 252;
    const blank = () => {
      for (const g of GREEKS) bag[g].push({ put: 0, call: 0 });
    };
    for (const s of strikes) {
      const r = byStrike.get(s);
      if (!r) {
        blank();
        oiRow.push(0);
        continue;
      }
      const gexOf = (c: typeof r.call) => c.gamma * c.oi * 100 * spot * spot * 0.01;
      const dx = (c: typeof r.call) => Math.abs(c.delta) * c.oi * 100 * spot * sigma1(c.iv);
      const vegaOf = (c: typeof r.call) => c.vega * c.oi * 100;
      const hp = blackScholesGreeks(spot, s, years, Math.max(0.01, r.put.iv / 100));
      const hc = blackScholesGreeks(spot, s, years, Math.max(0.01, r.call.iv / 100));
      bag.gex.push({ put: gexOf(r.put), call: gexOf(r.call) });
      bag.dex.push({ put: dx(r.put), call: dx(r.call) });
      bag.vex.push({ put: vegaOf(r.put), call: vegaOf(r.call) });
      bag.vanna.push({ put: hp.vanna * 0.01 * r.put.oi * 100 * spot * DEALER_PUT, call: hc.vanna * 0.01 * r.call.oi * 100 * spot * DEALER_CALL });
      bag.charm.push({ put: (hp.charmPut * r.put.oi * 100 * spot * DEALER_PUT) / 252, call: (hc.charmCall * r.call.oi * 100 * spot * DEALER_CALL) / 252 });
      const putH = contractHigher(spot, s, years, r.put.iv / 100, r.put.oi);
      const callH = contractHigher(spot, s, years, r.call.iv / 100, r.call.oi);
      for (const k of HIGHER_KEYS) bag[k].push({ put: putH?.[k] ?? 0, call: callH?.[k] ?? 0 });
      oiRow.push(r.put.oi + r.call.oi);
    }
    for (const g of GREEKS) deskLegs[g].push(bag[g]);
    oi.push(oiRow);
  }

  const put = {} as Record<Greek, number[][]>;
  const call = {} as Record<Greek, number[][]>;
  const net = {} as Record<Greek, number[][]>;
  const maxAbs = {} as Record<Greek, number>;
  const king = {} as Record<Greek, KingNode>;
  const priced = {} as Record<Greek, boolean[]>;
  for (const g of GREEKS) {
    put[g] = [];
    call[g] = [];
    net[g] = [];
    maxAbs[g] = 1;
    king[g] = { strike: strikes[0], e: 0, value: 0 };
    priced[g] = expiries.map(() => true);
  }

  for (const greek of GREEKS) {
    /* The anchor: the front leg over its desk twin, per strike and side. A
       desk twin near zero falls back to the greek's whole-book ratio. */
    const frontLegs = rows.map(r => r[greek]);
    const desk0 = deskLegs[greek][0] ?? frontLegs.map(() => ({ put: 0, call: 0 }));
    let sumF = 0;
    let sumD = 0;
    for (let s = 0; s < strikes.length; s++) {
      sumF += Math.abs(frontLegs[s].put) + Math.abs(frontLegs[s].call);
      sumD += desk0[s].put + desk0[s].call;
    }
    const globalK = sumD > EPS ? sumF / sumD : 1;
    const anchor = (s: number, side: 'put' | 'call') => {
      const f = frontLegs[s][side];
      const d = desk0[s][side];
      const k = d > EPS ? Math.abs(f) / d : globalK;
      const sign = f === 0 ? (side === 'put' ? 1 : -1) : Math.sign(f);
      return { k, sign };
    };
    for (let e = 0; e < expiries.length; e++) {
      const p: number[] = [];
      const c: number[] = [];
      const n: number[] = [];
      for (let s = 0; s < strikes.length; s++) {
        let pv: number;
        let cv: number;
        if (DIRECT.has(greek)) {
          pv = deskLegs[greek][e][s].put;
          cv = deskLegs[greek][e][s].call;
        } else if (e === 0) {
          pv = frontLegs[s].put;
          cv = frontLegs[s].call;
        } else {
          const ap = anchor(s, 'put');
          const ac = anchor(s, 'call');
          pv = ap.sign * ap.k * deskLegs[greek][e][s].put;
          cv = ac.sign * ac.k * deskLegs[greek][e][s].call;
        }
        const nv = pv + cv;
        p.push(pv);
        c.push(cv);
        n.push(nv);
        const a = Math.abs(nv);
        if (a > maxAbs[greek]) maxAbs[greek] = a;
        if (a > Math.abs(king[greek].value)) king[greek] = { strike: strikes[s], e, value: nv };
      }
      put[greek].push(p);
      call[greek].push(c);
      net[greek].push(n);
    }
  }

  /* THE SUPREME per greek: for gamma the profile's own pick (the full chain,
     not the window — the same strike the chart crowns); for the others the
     heaviest strike of the front book. Then the date carrying most of it. */
  const supreme = {} as Record<Greek, SupremeNode>;
  for (const greek of GREEKS) {
    let strike = front.levels.supreme;
    if (greek !== 'gex') {
      let best = 0;
      for (const r of rows) {
        const a = Math.abs(r[greek].net);
        if (a > best) {
          best = a;
          strike = r.strike;
        }
      }
    }
    const si = strikes.indexOf(strike);
    let e = 0;
    let value = 0;
    if (si >= 0) {
      for (let x = 0; x < expiries.length; x++) {
        const v = net[greek][x][si] ?? 0;
        if (Math.abs(v) > Math.abs(value)) {
          value = v;
          e = x;
        }
      }
    }
    supreme[greek] = { strike, e, value, total: si >= 0 ? rows[si][greek].net : 0 };
  }

  return {
    ticker,
    spot,
    changePct: spotChangePct(ticker),
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
    levels: front.levels,
    front,
  };
}
