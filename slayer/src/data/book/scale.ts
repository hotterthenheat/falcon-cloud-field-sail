/* The vendor's rows as the house's strike nodes: gamma, delta, vanna and charm off greek-exposure and spot-exposures rows,
   each contract's facts (open interest, vol, Black-Scholes delta, vanna, charm, vega) off option-contracts — every greek kept in
   the house sign of core/dealerSign.ts. Pure: no fetch, no state. */

import { nyIsoDate } from '../../core/nyTime';
import { keptLeg, keptVendorLeg, DEALER_SIDE, type Right } from '../../core/dealerSign';
import { type StrikeNode } from '../../types/market';
import { blackScholesGreeks } from '../../core/greeks';
import { tradingYears } from '../../core/tradingYear';
import { carryFor } from '../../core/carry';
import { dealerInventory, flowFirm, flowImbalance, flowWindow, ivOnTradingClock, markGap, quotedVolPoint, quoteMaxAge, smoothSmile, unsignedShare } from '../../core/volClock';
import { contractHigher } from '../liveHigher';
import { noteClose, noteNodes, peakStrikes, type CloseRow } from '../nodeScore';
import { type UwContract, type UwFlowStrike, type UwGreekStrike } from '../whales';


export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

export const emptyNode = (strike: number): StrikeNode => ({
  strike,
  callOI: 0,
  putOI: 0,
  gamma: 0,
  callGex: 0,
  putGex: 0,
  netGex: 0,
  callDex: 0,
  putDex: 0,
  netDex: 0,
  callVex: 0,
  putVex: 0,
  netVex: 0,
  vanna: 0,
  charm: 0,
  callVanna: 0,
  putVanna: 0,
  netVanna: 0,
  callCharm: 0,
  putCharm: 0,
  netCharm: 0,
});

/* greek-exposure rows are shares (greek × OI × 100); scaled to the house's dollars: GEX per 1% × S²·1%, DEX × S, vanna
   per vol point × S·1%, charm per session × S/252 × sessionShare (one expiry's rows; the whole book's stay on the calendar
   year). Its gamma is dealer-signed; its delta, vanna and charm are the holder's. */
function nodeFrom(row: UwGreekStrike, spot: number, oi?: { c: number; p: number }, expiry?: string): StrikeNode {
  const g = spot > 0 ? spot * spot * 0.01 : 1;
  const d = spot > 0 ? spot : 1;
  const v = spot > 0 ? spot * 0.01 : 1;
  const c = (spot > 0 ? spot / 252 : 1) * (expiry ? sessionShare(expiry, Date.now()) : 1);
  const callGex = keptVendorLeg('C', num(row.call_gex) * g, true);
  const putGex = keptVendorLeg('P', num(row.put_gex) * g, true);
  const callDex = keptVendorLeg('C', num(row.call_delta) * d, false);
  const putDex = keptVendorLeg('P', num(row.put_delta) * d, false);
  const callVanna = keptVendorLeg('C', num(row.call_vanna) * v, false);
  const putVanna = keptVendorLeg('P', num(row.put_vanna) * v, false);
  const callCharm = keptVendorLeg('C', num(row.call_charm) * c, false);
  const putCharm = keptVendorLeg('P', num(row.put_charm) * c, false);
  const strike = num(row.strike);
  return {
    ...emptyNode(strike),
    callOI: oi?.c ?? num(row.call_oi),
    putOI: oi?.p ?? num(row.put_oi),
    callGex,
    putGex,
    netGex: callGex + putGex,
    callDex,
    putDex,
    netDex: callDex + putDex,
    callVanna,
    putVanna,
    netVanna: callVanna + putVanna,
    callCharm,
    putCharm,
    netCharm: callCharm + putCharm,
  };
}

export function chainFrom(rows: UwGreekStrike[], spot: number, oi: Map<number, { c: number; p: number }>, flow?: Map<number, { call: number; put: number }>, expiry?: string): StrikeNode[] {
  const out: StrikeNode[] = [];
  for (const row of rows) {
    const strike = num(row.strike);
    if (!(strike > 0)) continue;
    const node = nodeFrom(row, spot, oi.get(strike), expiry);
    const traded = flow?.get(strike);
    if (traded && (traded.call > 0 || traded.put > 0)) {
      node.callVol = traded.call;
      node.putVol = traded.put;
    }
    out.push(node);
  }
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

export function oiMap(rows: UwGreekStrike[]): Map<number, { c: number; p: number }> {
  const m = new Map<number, { c: number; p: number }>();
  for (const r of rows) {
    const k = num(r.strike);
    if (k > 0) m.set(k, { c: num(r.call_oi), p: num(r.put_oi) });
  }
  return m;
}

export function flowMap(rows: UwFlowStrike[]): Map<number, { call: number; put: number }> {
  /* This row is every expiry at the strike, calls and puts already split. It is not one expiry's volume,
     and it is not the flow inventory. The inventory reads option-contracts for that expiry only. */
  const m = new Map<number, { call: number; put: number }>();
  for (const r of rows) {
    const k = num(r.strike);
    if (k > 0) m.set(k, { call: num(r.call_volume), put: num(r.put_volume) });
  }
  return m;
}

/* The book's gamma is the vendor's spot-exposures rows: open interest priced at the current price each minute
   (call_gamma_oi / put_gamma_oi, $ per 1%; equal to OI × Γ × 100 × S² × 1% off option-contracts). Their gamma, vanna and
   charm are dealer-signed (core/dealerSign.ts); vanna and charm are scaled to the house's dollars below. */
type LiveLeg = {
  c: number;
  p: number;
  px?: number;
  at?: number;
  cv: number;
  pv: number;
  cc: number;
  pc: number;
  /** delta_oi: the holder's delta × OI × 100 × S × (S × 1%) */
  cd: number;
  pd: number;
  gA: number;
  gB: number;
  pA: number;
  pB: number;
  dA: number;
  dB: number;
  pdA: number;
  pdB: number;
  vA: number;
  vB: number;
  pvA: number;
  pvB: number;
  cA: number;
  cB: number;
  pcA: number;
  pcB: number;
  /** The vendor row included ask and bid, so a zero there is a real zero */
  asks: boolean;
  /** The vendor row included its vanna (charm, delta) fields, so a zero is a real zero */
  vanna: boolean;
  charm: boolean;
  delta: boolean;
};
export type LiveGamma = Map<number, LiveLeg>;

const blankLeg = (): LiveLeg => ({ c: 0, p: 0, cv: 0, pv: 0, cc: 0, pc: 0, cd: 0, pd: 0, gA: 0, gB: 0, pA: 0, pB: 0, dA: 0, dB: 0, pdA: 0, pdB: 0, vA: 0, vB: 0, pvA: 0, pvB: 0, cA: 0, cB: 0, pcA: 0, pcB: 0, asks: false, vanna: false, charm: false, delta: false });

export function liveGammaRows(rows: unknown, into: LiveGamma, stamp?: { price: number; at: number }): number {
  if (!Array.isArray(rows)) return 0;
  for (const r of rows as Record<string, unknown>[]) {
    const k = num(r.strike);
    if (!(k > 0)) continue;
    const at = Date.parse(String(r.time ?? ''));
    const px = num(r.price);
    /* each row's own pricing (after the vendor's overnight roll the rows of one date carry their own minutes and prices) */
    const own = Number.isFinite(at) && px > 0;
    if (stamp && own && at >= stamp.at) {
      stamp.at = at;
      stamp.price = px;
    }
    const cur = into.get(k) ?? blankLeg();
    cur.c += num(r.call_gamma_oi);
    cur.p += num(r.put_gamma_oi);
    if ('call_vanna_oi' in r || 'put_vanna_oi' in r) {
      cur.cv += num(r.call_vanna_oi);
      cur.pv += num(r.put_vanna_oi);
      cur.vanna = true;
    }
    if ('call_charm_oi' in r || 'put_charm_oi' in r) {
      cur.cc += num(r.call_charm_oi);
      cur.pc += num(r.put_charm_oi);
      cur.charm = true;
    }
    if ('call_delta_oi' in r || 'put_delta_oi' in r) {
      cur.cd += num(r.call_delta_oi);
      cur.pd += num(r.put_delta_oi);
      cur.delta = true;
    }
    if ('call_gamma_ask' in r || 'call_gamma_bid' in r || 'put_gamma_ask' in r || 'put_gamma_bid' in r) {
      cur.gA += num(r.call_gamma_ask);
      cur.gB += num(r.call_gamma_bid);
      cur.pA += num(r.put_gamma_ask);
      cur.pB += num(r.put_gamma_bid);
      cur.asks = true;
    }
    if ('call_delta_ask' in r || 'call_delta_bid' in r || 'put_delta_ask' in r || 'put_delta_bid' in r) {
      cur.dA += num(r.call_delta_ask);
      cur.dB += num(r.call_delta_bid);
      cur.pdA += num(r.put_delta_ask);
      cur.pdB += num(r.put_delta_bid);
      cur.asks = true;
    }
    if ('call_vanna_ask' in r || 'call_vanna_bid' in r || 'put_vanna_ask' in r || 'put_vanna_bid' in r) {
      cur.vA += num(r.call_vanna_ask);
      cur.vB += num(r.call_vanna_bid);
      cur.pvA += num(r.put_vanna_ask);
      cur.pvB += num(r.put_vanna_bid);
      cur.asks = true;
    }
    if ('call_charm_ask' in r || 'call_charm_bid' in r || 'put_charm_ask' in r || 'put_charm_bid' in r) {
      cur.cA += num(r.call_charm_ask);
      cur.cB += num(r.call_charm_bid);
      cur.pcA += num(r.put_charm_ask);
      cur.pcB += num(r.put_charm_bid);
      cur.asks = true;
    }
    if (own && (cur.at == null || at >= cur.at)) {
      cur.at = at;
      cur.px = px;
    }
    into.set(k, cur);
  }
  return rows.length;
}

/** A chain with its gamma replaced by the live open-interest book (house sign) — strikes the live book holds that the
    chain lacks are added, strikes it lacks carry no gamma. Vanna and charm on those rows are the same minute's book:
    vanna × price × 1% is $Δ per vol point, charm ÷ CHARM_SESSION is $Δ per session. */
/** charm_oi ÷ this = $Δ per 1/252 of a CALENDAR year: Black-Scholes calendar charm × OI × 100 × S ÷ 252 off the same
    contracts (SPY 10/30 780C: −1.92e11 ÷ 919.8 = −208.8M against −208.0M). sessionShare then puts it on the session clock. */
const CHARM_SESSION = 0.01 * 365 * 252;
/** Calendar time per unit of trading time at that minute, T_cal/T_trade (= σ_trading²/σ_calendar²): a calendar-year
    charm × this is the trading-clock charm the contracts' own greeks print (core/volClock.ts quotedVolPoint, squared) */
const sessionShare = (expiry: string, at: number): number => quotedVolPoint(expiry, at) ** 2;
/* `expiry`: one date's rows (charm goes on its session clock); without it the whole book's rows stay on the calendar
   year. A leg whose contracts were read (callBook/putBook) keeps their vanna and charm; only its gamma is replaced. */
export function withLiveGamma(chain: readonly StrikeNode[], live: LiveGamma, expiry?: string): StrikeNode[] {
  const seen = new Set<number>();
  const paint = (n: StrikeNode, l: LiveLeg | undefined): StrikeNode => {
    const callGex = l ? keptVendorLeg('C', l.c, true) : 0;
    const putGex = l ? keptVendorLeg('P', l.p, true) : 0;
    const next: StrikeNode = { ...n, callGex, putGex, netGex: callGex + putGex, gexPx: l?.px, gexAt: l?.at };
    if (l) {
      next.vendor = {
        px: l.px ?? 0,
        at: l.at,
        g: [l.c, l.gA, l.gB, l.p, l.pA, l.pB],
        d: [l.cd, l.dA, l.dB, l.pd, l.pdA, l.pdB],
        v: [l.cv, l.vA, l.vB, l.pv, l.pvA, l.pvB],
        c: [l.cc, l.cA, l.cB, l.pc, l.pcA, l.pcB],
        asks: l.asks,
      };
    }
    const painted = n.callBook != null || n.putBook != null;
    if (!painted && l?.vanna && l.px != null && l.px > 0) {
      const callVanna = keptVendorLeg('C', l.cv * l.px * 0.01, true);
      const putVanna = keptVendorLeg('P', l.pv * l.px * 0.01, true);
      next.callVanna = callVanna;
      next.putVanna = putVanna;
      next.netVanna = callVanna + putVanna;
    }
    if (!painted && l?.delta && l.px != null && l.px > 0) {
      /* $Δ = delta_oi ÷ (price × 1%) (SPY 10/29 772C: 387.9M ÷ 7.72 = 50.2M against Δ·OI·100·S = 50.8M) */
      const callDex = keptVendorLeg('C', l.cd / (l.px * 0.01), false);
      const putDex = keptVendorLeg('P', l.pd / (l.px * 0.01), false);
      next.callDex = callDex;
      next.putDex = putDex;
      next.netDex = callDex + putDex;
    }
    if (!painted && l?.charm) {
      const share = expiry ? sessionShare(expiry, l.at ?? Date.now()) : 1;
      const callCharm = keptVendorLeg('C', (l.cc / CHARM_SESSION) * share, true);
      const putCharm = keptVendorLeg('P', (l.pc / CHARM_SESSION) * share, true);
      next.callCharm = callCharm;
      next.putCharm = putCharm;
      next.netCharm = callCharm + putCharm;
    }
    return next;
  };
  const out: StrikeNode[] = chain.map(n => {
    seen.add(n.strike);
    return paint(n, live.get(n.strike));
  });
  for (const [k, l] of live) {
    /* zero-gamma strikes are kept too: a new listing with no open interest yet is a date that IS in, not one missing */
    if (seen.has(k)) continue;
    out.push(paint(emptyNode(k), l));
  }
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

/** OCC tail is YYMMDD + C/P + strike×1000. The root is whatever sits in front. */
export function parseOcc(symbol: string): { expiry: string; right: 'CALL' | 'PUT'; strike: number } | null {
  if (symbol.length < 16) return null;
  const tail = symbol.slice(-15);
  const m = /^(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(tail);
  if (!m) return null;
  const strike = Number(m[5]) / 1000;
  if (!(strike > 0)) return null;
  return { expiry: `20${m[1]}-${m[2]}-${m[3]}`, right: m[4] === 'C' ? 'CALL' : 'PUT', strike };
}

/* The vendor's vega stays on the leg until paintLegs replaces it with Black-Scholes vega at the live spot, on the
   trading clock, times open interest, signed by the one model (core/dealerSign.ts). */
const LONG_QUOTE_MS = 15 * 60_000;

function quoteUsable(row: UwContract, expiry: string, now = Date.now()): boolean {
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  if (bid > 0 && ask > 0 && bid > ask + 1e-6) return false;
  if (bid === 0 && ask === 0 && (row.nbbo_bid != null || row.nbbo_ask != null)) return false;
  const stamp = Date.parse(String(row.last_tape_time || row.updated_at || ''));
  const limit = expiry ? quoteMaxAge(expiry, now) : LONG_QUOTE_MS;
  if (Number.isFinite(stamp) && now - stamp > limit) return false;
  return true;
}

/** The vendor's implied vol. A stale quote after the close is not a reason to throw it away: the mid is not solved, and this number is the fallback the higher greeks use. */
function contractIv(row: UwContract, _expiry: string, _now = Date.now()): number {
  const iv = num(row.implied_volatility);
  if (!(iv > 0) || iv >= 10) return 0;
  return iv;
}

interface LegBook {
  callOI: number;
  putOI: number;
  callVex: number;
  putVex: number;
  callVol: number;
  putVol: number;
  /** The contract's own implied vol and gamma, per contract (0 = not printed) */
  callIv: number;
  putIv: number;
  callGamma: number;
  putGamma: number;
  callAsk: number;
  callBid: number;
  putAsk: number;
  putBid: number;
  callMulti: number;
  putMulti: number;
  callMid: number;
  putMid: number;
  callNone: number;
  putNone: number;
  callBidPx: number;
  callAskPx: number;
  putBidPx: number;
  putAskPx: number;
}

function emptyLeg(): LegBook {
  return { callOI: 0, putOI: 0, callVex: 0, putVex: 0, callVol: 0, putVol: 0, callIv: 0, putIv: 0, callGamma: 0, putGamma: 0, callAsk: 0, callBid: 0, putAsk: 0, putBid: 0, callMulti: 0, putMulti: 0, callMid: 0, putMid: 0, callNone: 0, putNone: 0, callBidPx: 0, callAskPx: 0, putBidPx: 0, putAskPx: 0 };
}

export function foldContracts(rows: UwContract[], expiry: string, now = Date.now()): Map<number, LegBook> {
  const by = new Map<number, LegBook>();
  for (const row of rows) {
    const parsed = parseOcc(String(row.option_symbol || ''));
    if (!parsed || parsed.expiry !== expiry) continue;
    const oi = num(row.open_interest);
    const vol = num(row.volume);
    const vega = num(row.vega);
    const leg = by.get(parsed.strike) ?? emptyLeg();
    const dollar = 100 * vega;
    const quoteOk = quoteUsable(row, expiry, now);
    const iv = contractIv(row, expiry);
    const gamma = num(row.gamma);
    const askVol = num(row.ask_volume);
    const bidVol = num(row.bid_volume);
    const multi = num(row.multi_leg_volume);
    const midVol = num(row.mid_volume);
    const none = num(row.no_side_volume);
    const bidPx = num(row.nbbo_bid);
    const askPx = num(row.nbbo_ask);
    if (parsed.right === 'CALL') {
      leg.callOI += oi;
      leg.callVol += vol;
      leg.callAsk += askVol;
      leg.callBid += bidVol;
      leg.callMulti += multi;
      leg.callMid += midVol;
      leg.callNone += none;
      if (quoteOk && bidPx > 0) leg.callBidPx = bidPx;
      if (quoteOk && askPx > 0) leg.callAskPx = askPx;
      leg.callVex += keptLeg('C', dollar, oi);
      if (iv > 0) leg.callIv = iv;
      if (gamma > 0) leg.callGamma = gamma;
    } else {
      leg.putOI += oi;
      leg.putVol += vol;
      leg.putAsk += askVol;
      leg.putBid += bidVol;
      leg.putMulti += multi;
      leg.putMid += midVol;
      leg.putNone += none;
      if (quoteOk && bidPx > 0) leg.putBidPx = bidPx;
      if (quoteOk && askPx > 0) leg.putAskPx = askPx;
      leg.putVex += keptLeg('P', dollar, oi);
      if (iv > 0) leg.putIv = iv;
      if (gamma > 0) leg.putGamma = gamma;
    }
    by.set(parsed.strike, leg);
  }
  return by;
}

/** A date's chain with its contracts' facts (vols, OI, delta, vanna, charm, vega) laid on — new nodes, never the old
    ones edited, so whatever is keyed on the old chain recomputes. Gamma stays the vendor's open-interest rows. */
const loggedFlow = new Set<string>();

function add3(right: Right, dealerSigned: boolean, scale: (v: number) => number, oi: number, ask: number, bid: number): number {
  return keptVendorLeg(right, scale(oi), dealerSigned) + keptVendorLeg(right, scale(ask), dealerSigned) + keptVendorLeg(right, scale(bid), dealerSigned);
}

/** The flow book beside the open-interest book. A failed gate, or a gap too small to mark, draws the open-interest figure. N still moves with the tape. */
function stampFlow(nodes: StrikeNode[], book: Map<number, LegBook>, expiry: string, spot: number, ticker: string, near: boolean, years: number, volPt: number, r?: number, q?: number): void {
  if (!(spot > 0)) return;
  const share = expiry ? quotedVolPoint(expiry, Date.now()) ** 2 : 1;
  const ident = (v: number) => v;
  const dexOf = (v: number) => v / (spot * 0.01);
  const vanOf = (v: number) => v * spot * 0.01;
  const chmOf = (v: number) => (v / CHARM_SESSION) * share;
  const blankH = () => ({ call: 0, put: 0 });
  const drafts: { n: StrikeNode; held: boolean; outside: boolean; gex: { call: number; put: number }; dex: { call: number; put: number }; vanna: { call: number; put: number }; charm: { call: number; put: number }; vex: { call: number; put: number }; pack: { color: { call: number; put: number }; vomma: { call: number; put: number }; speed: { call: number; put: number }; veta: { call: number; put: number }; zomma: { call: number; put: number } } }[] = [];
  for (const n of nodes) {
    const leg = book.get(n.strike);
    const v = n.vendor;
    const outside = !near;
    const thin = near && n.flowFirm === false;
    const heldGate = outside || thin || !v?.asks;
    const callCount = !leg || heldGate ? (leg?.callOI ?? n.callOI) : dealerInventory(leg.callOI, leg.callAsk, leg.callBid, leg.callMulti, leg.callVol);
    const putCount = !leg || heldGate ? (leg?.putOI ?? n.putOI) : dealerInventory(leg.putOI, leg.putAsk, leg.putBid, leg.putMulti, leg.putVol);
    const gex = v?.asks && !heldGate ? { call: add3('C', true, ident, v.g[0], v.g[1], v.g[2]), put: add3('P', true, ident, v.g[3], v.g[4], v.g[5]) } : { call: n.callGex, put: n.putGex };
    const dex = v?.asks && !heldGate ? { call: add3('C', false, dexOf, v.d[0], v.d[1], v.d[2]), put: add3('P', false, dexOf, v.d[3], v.d[4], v.d[5]) } : { call: n.callDex, put: n.putDex };
    const vanna = v?.asks && !heldGate ? { call: add3('C', true, vanOf, v.v[0], v.v[1], v.v[2]), put: add3('P', true, vanOf, v.v[3], v.v[4], v.v[5]) } : { call: n.callVanna, put: n.putVanna };
    const charm = v?.asks && !heldGate ? { call: add3('C', true, chmOf, v.c[0], v.c[1], v.c[2]), put: add3('P', true, chmOf, v.c[3], v.c[4], v.c[5]) } : { call: n.callCharm, put: n.putCharm };
    const callBs = n.callIv && n.callIv > 0 && years > 0 ? blackScholesGreeks(spot, n.strike, years, n.callIv, r, q) : null;
    const putBs = n.putIv && n.putIv > 0 && years > 0 ? blackScholesGreeks(spot, n.strike, years, n.putIv, r, q) : null;
    if (ticker && v?.asks && callBs && callCount !== 0) {
      const key = `${ticker}|${nyIsoDate()}`;
      if (!loggedFlow.has(key)) {
        loggedFlow.add(key);
        const local = DEALER_SIDE.C * callBs.gamma * callCount * 100 * spot * spot * 0.01;
        const summed = v.g[0] + v.g[1] + v.g[2];
        const gap = summed !== 0 ? ((local - summed) / Math.abs(summed)) * 100 : 0;
        const sign = Math.sign(local) === Math.sign(summed) || local === 0 || summed === 0 ? 'same' : 'opposite';
        console.info(`[flow] ${ticker} ${n.strike}C ${sign} ${gap.toFixed(1)}%`);
      }
    }
    const hc = callBs ? contractHigher(spot, n.strike, years, n.callIv ?? 0, callCount, 'C', volPt) : null;
    const hp = putBs ? contractHigher(spot, n.strike, years, n.putIv ?? 0, putCount, 'P', volPt) : null;
    const higher = { color: { call: hc?.color ?? 0, put: hp?.color ?? 0 }, vomma: { call: hc?.vomma ?? 0, put: hp?.vomma ?? 0 }, speed: { call: hc?.speed ?? 0, put: hp?.speed ?? 0 }, veta: { call: hc?.veta ?? 0, put: hp?.veta ?? 0 }, zomma: { call: hc?.zomma ?? 0, put: hp?.zomma ?? 0 } };
    drafts.push({ n, held: heldGate, outside, gex, dex, vanna, charm, vex: { call: callBs ? keptLeg('C', callBs.vega * 100 * volPt, callCount) : n.callVex, put: putBs ? keptLeg('P', putBs.vega * 100 * volPt, putCount) : n.putVex }, pack: higher });
  }
  let biggest = 0;
  for (const d of drafts) biggest = Math.max(biggest, Math.abs(d.n.netGex), Math.abs(d.gex.call + d.gex.put));
  for (const d of drafts) {
    const flowNet = d.gex.call + d.gex.put;
    const show = !d.held && markGap(flowNet, d.n.netGex, biggest);
    const pack = d.pack;
    let gex = d.gex;
    let dex = d.dex;
    let vanna = d.vanna;
    let charm = d.charm;
    let vex = d.vex;
    let higher = pack ?? { color: blankH(), vomma: blankH(), speed: blankH(), veta: blankH(), zomma: blankH() };
    if (!show) {
      gex = { call: d.n.callGex, put: d.n.putGex };
      dex = { call: d.n.callDex, put: d.n.putDex };
      vanna = { call: d.n.callVanna, put: d.n.putVanna };
      charm = { call: d.n.callCharm, put: d.n.putCharm };
      vex = { call: d.n.callVex, put: d.n.putVex };
      const cN = d.n.callBook ?? d.n.callOI;
      const pN = d.n.putBook ?? d.n.putOI;
      const hc = years > 0 && (d.n.callIv ?? 0) > 0 ? contractHigher(spot, d.n.strike, years, d.n.callIv ?? 0, cN, 'C', volPt) : null;
      const hp = years > 0 && (d.n.putIv ?? 0) > 0 ? contractHigher(spot, d.n.strike, years, d.n.putIv ?? 0, pN, 'P', volPt) : null;
      higher = { color: { call: hc?.color ?? 0, put: hp?.color ?? 0 }, vomma: { call: hc?.vomma ?? 0, put: hp?.vomma ?? 0 }, speed: { call: hc?.speed ?? 0, put: hp?.speed ?? 0 }, veta: { call: hc?.veta ?? 0, put: hp?.veta ?? 0 }, zomma: { call: hc?.zomma ?? 0, put: hp?.zomma ?? 0 } };
    }
    d.n.flow = { gex, dex, vex, vanna, charm, ...higher, disagree: show && flowNet !== 0 && d.n.netGex !== 0 && Math.sign(flowNet) !== Math.sign(d.n.netGex), held: !show, outside: d.outside };
  }
}

export function paintLegs(nodes: readonly StrikeNode[], book: Map<number, LegBook>, oi: boolean, spot = 0, expiry = '', ticker = ''): StrikeNode[] {
  /* vols are put on the trading clock at the minute (and price) the vendor priced the date's gamma, the clock the flip
     re-prices at — never the wall clock, or a shut market's book would drift overnight with no new rows */
  const priced = pricedClockOf(nodes);
  const t = expiry ? tradingYears(expiry, priced.at) : 0;
  /* vega and vanna per point of the vol the vendor quotes, not per trading-clock point */
  const volPt = expiry ? quotedVolPoint(expiry, priced.at) : 1;
  const near = !!expiry && flowWindow(expiry);
  const carry = ticker ? carryFor(ticker) : null;
  const painted = nodes.map(n0 => {
    const leg = book.get(n0.strike);
    if (!leg) return n0;
    const n: StrikeNode = { ...n0 };
    if (oi) {
      n.callOI = leg.callOI;
      n.putOI = leg.putOI;
    }
    if (leg.callIv > 0) n.callIv = leg.callIv;
    if (leg.putIv > 0) n.putIv = leg.putIv;
    if (leg.callGamma > 0) n.callGamma = leg.callGamma;
    if (leg.putGamma > 0) n.putGamma = leg.putGamma;
    if (leg.callVol > 0 || leg.putVol > 0) {
      n.callVol = leg.callVol;
      n.putVol = leg.putVol;
    }
    return n;
  });
  if (expiry && spot > 0) {
    for (const n of painted) {
      const leg = book.get(n.strike);
      if (!leg) continue;
      if (leg.callIv > 0 || (leg.callBidPx > 0 && leg.callAskPx > 0)) n.callIv = ivOnTradingClock(leg.callBidPx, leg.callAskPx, leg.callIv, priced.px || spot, n.strike, expiry, 'C', priced.at, carry?.r, carry?.q);
      if (leg.putIv > 0 || (leg.putBidPx > 0 && leg.putAskPx > 0)) n.putIv = ivOnTradingClock(leg.putBidPx, leg.putAskPx, leg.putIv, priced.px || spot, n.strike, expiry, 'P', priced.at, carry?.r, carry?.q);
    }
  }
  smoothSide(painted, 'callIv');
  smoothSide(painted, 'putIv');
  if (!(spot > 0) || !(t > 0)) return painted;
  let volSum = 0;
  let bareSum = 0;
  const closes: CloseRow[] = [];
  for (const n of painted) {
    const leg = book.get(n.strike);
    if (!leg) continue;
    /* Every greek counts open interest, like the vendor's gamma rows. The ask-minus-bid inventory is only a
       side estimate (the morning-miss score and the flow peaks); it never reaches the book's gamma, walls or flip. */
    const callN = leg.callOI;
    const putN = leg.putOI;
    const callNet = flowImbalance(leg.callAsk, leg.callBid, leg.callMulti, leg.callVol);
    const putNet = flowImbalance(leg.putAsk, leg.putBid, leg.putMulti, leg.putVol);
    const gross = leg.callVol + leg.putVol;
    const bare = leg.callMid + leg.callNone + leg.putMid + leg.putNone;
    const firm = !near || flowFirm(Math.abs(callNet) + Math.abs(putNet), gross, unsignedShare(bare, 0, gross));
    n.flowFirm = firm;
    const call = n.callIv && n.callIv > 0 ? blackScholesGreeks(spot, n.strike, t, n.callIv, carry?.r, carry?.q) : null;
    const put = n.putIv && n.putIv > 0 ? blackScholesGreeks(spot, n.strike, t, n.putIv, carry?.r, carry?.q) : null;
    if (near) {
      const callInv = dealerInventory(leg.callOI, leg.callAsk, leg.callBid, leg.callMulti, leg.callVol);
      const putInv = dealerInventory(leg.putOI, leg.putAsk, leg.putBid, leg.putMulti, leg.putVol);
      closes.push({ expiry, strike: n.strike, right: 'C', flow: callInv, oi: leg.callOI });
      closes.push({ expiry, strike: n.strike, right: 'P', flow: putInv, oi: leg.putOI });
    }
    volSum += leg.callVol + leg.putVol;
    bareSum += leg.callMid + leg.callNone + leg.putMid + leg.putNone;
    /* Vega is repriced here, on this clock and this vol, not the vendor's calendar-time vega. */
    n.callBook = callN;
    n.putBook = putN;
    /* Vega is repriced here. Delta, vanna and charm stay the vendor's open-interest rows (withLiveGamma). */
    if (call && callN !== 0) n.callVex = keptLeg('C', call.vega * 100 * volPt, callN);
    else n.callVex = 0;
    if (put && putN !== 0) n.putVex = keptLeg('P', put.vega * 100 * volPt, putN);
    else n.putVex = 0;
    n.netVex = n.callVex + n.putVex;
    n.netDex = n.callDex + n.putDex;
    n.netVanna = n.callVanna + n.putVanna;
    n.netCharm = n.callCharm + n.putCharm;
  }
  stampFlow(painted, book, expiry, spot, ticker, near, t, volPt, carry?.r, carry?.q);
  if (ticker && spot > 0 && near) {
    const flow = peakStrikes(painted.map(n => ({ strike: n.strike, value: (n.flow?.gex.call ?? 0) + (n.flow?.gex.put ?? 0) })));
    const oi = peakStrikes(painted.map(n => ({ strike: n.strike, value: n.netGex })));
    noteNodes(ticker, spot, flow, oi, volSum > 0 ? unsignedShare(bareSum, 0, volSum) : null);
  }
  if (ticker && near && closes.length) noteClose(ticker, nyIsoDate(), closes);
  return painted;
}

/** The minute and price the vendor priced a date's gamma rows at (the latest row's), else the wall clock */
export function pricedClockOf(nodes: readonly StrikeNode[]): { at: number; px: number } {
  let at = 0;
  let px = 0;
  for (const n of nodes)
    if (n.gexAt != null && n.gexAt >= at) {
      at = n.gexAt;
      px = n.gexPx ?? 0;
    }
  return at > 0 ? { at, px } : { at: Date.now(), px: 0 };
}

/** One expiry's book off the vendor's raw rows, the path a live date takes (spot-exposures/expiry-strike gamma, then
    the date's option-contracts laid on). For the proofs (scripts/gamma-sign-proof.ts). */
export function expiryBookFromRows(spotRows: unknown, contracts: UwContract[], spot: number, expiry: string): StrikeNode[] {
  const live: LiveGamma = new Map();
  liveGammaRows(spotRows, live);
  const chain = withLiveGamma([], live, expiry);
  return contracts.length ? paintLegs(chain, foldContracts(contracts, expiry, pricedClockOf(chain).at), true, spot, expiry) : chain;
}

function smoothSide(nodes: StrikeNode[], key: 'callIv' | 'putIv'): void {
  const next = smoothSmile(nodes.map(n => ({ strike: n.strike, iv: n[key] ?? 0 })));
  const by = new Map(next.map(p => [p.strike, p.iv]));
  for (const n of nodes) {
    const iv = by.get(n.strike);
    if (iv != null && iv !== n[key]) n[key] = iv;
  }
}

/** A date's chain read again keeps the contract facts its last read was painted with (vols, per-contract gamma, open
    interest, vega) until its contracts are read again — a refresh never drops the flip back to the at-the-money vol */
export function carryFacts(next: StrikeNode[], prev: readonly StrikeNode[] | undefined): StrikeNode[] {
  if (!prev?.length) return next;
  const at = new Map(prev.map(n => [n.strike, n]));
  return next.map(n => {
    const o = at.get(n.strike);
    if (!o || !(o.callIv || o.putIv || o.callGamma || o.putGamma)) return n;
    return {
      ...n,
      callIv: n.callIv || o.callIv,
      putIv: n.putIv || o.putIv,
      callGamma: n.callGamma || o.callGamma,
      putGamma: n.putGamma || o.putGamma,
      /* the contracts' own open interest, as painted, until they are read again (Building values each contract against it) */
      callOI: o.callOI || n.callOI,
      putOI: o.putOI || n.putOI,
      callBook: n.callBook ?? o.callBook,
      putBook: n.putBook ?? o.putBook,
      callVex: n.callBook != null || n.putBook != null ? n.callVex : o.callVex || n.callVex,
      putVex: n.callBook != null || n.putBook != null ? n.putVex : o.putVex || n.putVex,
      netVex: n.callBook != null || n.putBook != null ? n.callVex + n.putVex : (o.callVex || n.callVex) + (o.putVex || n.putVex),
    };
  });
}

export function mergeChains(parts: StrikeNode[][]): StrikeNode[] {
  const by = new Map<number, StrikeNode>();
  for (const chain of parts) {
    for (const n of chain) {
      const prev = by.get(n.strike);
      if (!prev) {
        by.set(n.strike, { ...n });
        continue;
      }
      prev.callOI += n.callOI;
      prev.putOI += n.putOI;
      prev.callGex += n.callGex;
      prev.putGex += n.putGex;
      prev.netGex += n.netGex;
      prev.callDex += n.callDex;
      prev.putDex += n.putDex;
      prev.netDex += n.netDex;
      prev.callVex += n.callVex;
      prev.putVex += n.putVex;
      prev.netVex += n.netVex;
      prev.netVanna += n.netVanna;
      prev.netCharm += n.netCharm;
    }
  }
  return [...by.values()];
}

/* The dates that re-price with their contracts' own vols: the front date and every live date holding at least
   OWN_IV_SHARE of the dates' gross gamma — the Map and a Board-only name pick them by the same rule off the same chains. */
const OWN_IV_SHARE = 0.005;
export function ownIvDates(byDate: Readonly<Record<string, readonly StrikeNode[] | undefined>>, dates: readonly string[], front: string | undefined): Set<string> {
  const gross = (d: string) => (byDate[d] ?? []).reduce((a, n) => a + Math.abs(n.callGex) + Math.abs(n.putGex), 0);
  const g = dates.map(d => [d, gross(d)] as const);
  const total = g.reduce((a, [, v]) => a + v, 0);
  return new Set(g.filter(([d, v]) => d === front || (total > 0 && v >= OWN_IV_SHARE * total)).map(([d]) => d));
}
