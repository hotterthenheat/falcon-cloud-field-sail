/* The vendor's rows as the house's strike nodes: gamma, delta, vanna and charm off greek-exposure and spot-exposures rows,
   each contract's facts (open interest, vol, Black-Scholes delta, vanna, charm, vega) off option-contracts — every greek kept in
   the house sign of core/dealerSign.ts. Pure: no fetch, no state. */

import { nyIsoDate } from '../../core/nyTime';
import { nyInstant, regularCloseMin } from '../../core/session';
import { keptLeg, keptVendorLeg, DEALER_SIDE, type Right } from '../../core/dealerSign';
import { type StrikeNode } from '../../types/market';
import { blackScholesGreeks } from '../../core/greeks';
import { tradingYears } from '../../core/tradingYear';
import { carryFor, DEFAULT_R } from '../../core/carry';
import { dealerInventory, flowFirm, flowImbalance, flowWindow, calendarYears, ivOnTradingClock, markGap, quotedVolPoint, quoteMaxAge, smoothSmile, unsignedShare } from '../../core/volClock';
import { impliedBookSpot, type ParityPair } from '../../core/parity';
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

/* greek-exposure rows are shares (greek × OI × 100); scaled to the house's dollars: GEX per 1% × S²·1%, DEX × S, charm
   per session × S/252 × sessionShare at the rows' own clock (rowsClock: the close of the session they were priced on —
   never the wall clock, or a shut market's charm drifts overnight with no new rows; one expiry's rows; the whole book's
   stay on the calendar year). Its gamma is dealer-signed; its delta and charm are the holder's. Vanna is NOT taken
   from these rows: the vendor's vanna unit is not one unit across names (vanna × S × 1% matches Black-Scholes
   vanna·S·OI on SPY and NVDA, reads ~11× on SPX and ~0.04× on F), so vanna waits for the date's contracts (paintLegs
   prices it off each contract, like vega) and is 0 until then (exposureSurface isContractGreek). */
function nodeFrom(row: UwGreekStrike, spot: number, oi?: { c: number; p: number }, expiry?: string, at = Date.now()): StrikeNode {
  const g = spot > 0 ? spot * spot * 0.01 : 1;
  const d = spot > 0 ? spot : 1;
  const c = (spot > 0 ? spot / 252 : 1) * (expiry ? sessionShare(expiry, at) : 1);
  const callGex = keptVendorLeg('C', num(row.call_gex) * g, true);
  const putGex = keptVendorLeg('P', num(row.put_gex) * g, true);
  const callDex = keptVendorLeg('C', num(row.call_delta) * d, false);
  const putDex = keptVendorLeg('P', num(row.put_delta) * d, false);
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
    callCharm,
    putCharm,
    netCharm: callCharm + putCharm,
  };
}

/** The instant greek-exposure rows were priced at: the close of the latest session they name (row.date) — or now,
    while that session is still trading (rows of today are today's, not tomorrow's) — else now */
export function rowsClock(rows: readonly UwGreekStrike[], now = Date.now()): number {
  let day = '';
  for (const r of rows) if (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date > day) day = r.date;
  return day ? Math.min(now, nyInstant(day, regularCloseMin(day))) : now;
}

export function chainFrom(rows: UwGreekStrike[], spot: number, oi: Map<number, { c: number; p: number }>, flow?: Map<number, { call: number; put: number }>, expiry?: string): StrikeNode[] {
  const out: StrikeNode[] = [];
  const at = expiry ? rowsClock(rows) : Date.now();
  for (const row of rows) {
    const strike = num(row.strike);
    if (!(strike > 0)) continue;
    const node = nodeFrom(row, spot, oi.get(strike), expiry, at);
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
    chain lacks are added, strikes it lacks carry no gamma. Delta and charm on those rows are the same minute's book:
    delta_oi ÷ (price × 1%) is $Δ, charm ÷ CHARM_SESSION is $Δ per session. Their vanna is not read (see below). */
/** charm_oi ÷ this = $Δ per 1/252 of a CALENDAR year: Black-Scholes calendar charm × OI × 100 × S ÷ 252 off the same
    contracts (SPY 10/30 780C: −1.92e11 ÷ 919.8 = −208.8M against −208.0M). sessionShare then puts it on the session clock. */
const CHARM_SESSION = 0.01 * 365 * 252;
/** Calendar time per unit of trading time at that minute, T_cal/T_trade (= σ_trading²/σ_calendar²): a calendar-year
    charm × this is the trading-clock charm the contracts' own greeks print (core/volClock.ts quotedVolPoint, squared) */
const sessionShare = (expiry: string, at: number): number => quotedVolPoint(expiry, at) ** 2;
/* `expiry`: one date's rows (charm goes on its session clock); without it the whole book's rows stay on the calendar
   year. A leg whose contracts were read (callBook/putBook) keeps their delta, vanna and charm; only its gamma is replaced. */
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
    if (!painted) {
      /* vanna is priced off the date's contracts only (paintLegs): the vendor's vanna_oi × price × 1% is $Δ per vol
         point on SPY and NVDA but ~11× that on SPX and ~0.04× on F (2026-11-04 rows against Black-Scholes vanna·S·OI off
         the same contracts), so until the contracts are read the leg has none */
      next.callVanna = 0;
      next.putVanna = 0;
      next.netVanna = 0;
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

/** The dealer's put count. The model holds dealers SHORT the puts (DEALER_SIDE.P = −1), so a count is contracts short:
    a customer buy at the ask makes it larger, a sale at the bid smaller — the vendor's own put_gamma_ask prints with
    put_gamma_oi's sign (more dealer-short gamma) and put_gamma_bid against it. core/volClock.ts dealerInventory counts
    the calls' way (contracts long: an ask buy makes it smaller), so the put side reads it with ask and bid swapped. */
export const dealerPuts = (oi: number, askVol: number, bidVol: number, multiVol: number, volume: number): number => dealerInventory(oi, bidVol, askVol, multiVol, volume);

function add3(right: Right, dealerSigned: boolean, scale: (v: number) => number, oi: number, ask: number, bid: number): number {
  return keptVendorLeg(right, scale(oi), dealerSigned) + keptVendorLeg(right, scale(ask), dealerSigned) + keptVendorLeg(right, scale(bid), dealerSigned);
}

/** The flow book beside the open-interest book. A failed gate, or a gap too small to mark, draws the open-interest figure. N still moves with the tape. */
function stampFlow(nodes: StrikeNode[], book: Map<number, LegBook>, expiry: string, spot: number, ticker: string, near: boolean, years: number, volPt: number, r?: number, q?: number, priceSpot = spot, pricedAt = Date.now()): void {
  if (!(spot > 0)) return;
  const ident = (v: number) => v;
  const blankH = () => ({ call: 0, put: 0 });
  const drafts: { n: StrikeNode; held: boolean; outside: boolean; gex: { call: number; put: number }; dex: { call: number; put: number }; vanna: { call: number; put: number }; charm: { call: number; put: number }; vex: { call: number; put: number }; pack: { color: { call: number; put: number }; vomma: { call: number; put: number }; speed: { call: number; put: number }; veta: { call: number; put: number }; zomma: { call: number; put: number } } }[] = [];
  for (const n of nodes) {
    const leg = book.get(n.strike);
    const v = n.vendor;
    const outside = !near;
    const thin = near && n.flowFirm === false;
    const heldGate = outside || thin || !v?.asks;
    /* the vendor's columns are scaled at the price and minute they were priced at (v.px, v.at), as the open-interest
       book's are (withLiveGamma) — never the live spot or the wall clock, or Live drifts from Settled with no new rows */
    const vPx = v?.px && v.px > 0 ? v.px : spot;
    const dexOf = (x: number) => x / (vPx * 0.01);
    const callCount = !leg || heldGate ? (leg?.callOI ?? n.callOI) : dealerInventory(leg.callOI, leg.callAsk, leg.callBid, leg.callMulti, leg.callVol);
    const putCount = !leg || heldGate ? (leg?.putOI ?? n.putOI) : dealerPuts(leg.putOI, leg.putAsk, leg.putBid, leg.putMulti, leg.putVol);
    const gex = v?.asks && !heldGate ? { call: add3('C', true, ident, v.g[0], v.g[1], v.g[2]), put: add3('P', true, ident, v.g[3], v.g[4], v.g[5]) } : { call: n.callGex, put: n.putGex };
    const dex = v?.asks && !heldGate ? { call: add3('C', false, dexOf, v.d[0], v.d[1], v.d[2]), put: add3('P', false, dexOf, v.d[3], v.d[4], v.d[5]) } : { call: n.callDex, put: n.putDex };
    const callBs = n.callIv && n.callIv > 0 && years > 0 ? blackScholesGreeks(priceSpot, n.strike, years, n.callIv, r, q) : null;
    const putBs = n.putIv && n.putIv > 0 && years > 0 ? blackScholesGreeks(priceSpot, n.strike, years, n.putIv, r, q) : null;
    /* charm off the contracts, like vanna: the flow count × Black-Scholes charm per session × S (see paintLegs) */
    const charm = v?.asks && !heldGate ? { call: callBs ? keptLeg('C', (callBs.charmCall / 252) * 100 * spot, callCount) : n.callCharm, put: putBs ? keptLeg('P', (putBs.charmPut / 252) * 100 * spot, putCount) : n.putCharm } : { call: n.callCharm, put: n.putCharm };
    if (ticker && v?.asks && callBs && callCount !== 0) {
      const key = `${ticker}|${nyIsoDate()}`;
      if (!loggedFlow.has(key)) {
        loggedFlow.add(key);
        const local = DEALER_SIDE.C * callBs.gamma * callCount * 100 * priceSpot * priceSpot * 0.01;
        const summed = v.g[0] + v.g[1] + v.g[2];
        const gap = summed !== 0 ? ((local - summed) / Math.abs(summed)) * 100 : 0;
        const sign = Math.sign(local) === Math.sign(summed) || local === 0 || summed === 0 ? 'same' : 'opposite';
        console.info(`[flow] ${ticker} ${n.strike}C ${sign} ${gap.toFixed(1)}%`);
      }
    }
    /* vanna off the contracts, like vega: the flow count × Black-Scholes vanna × S per quoted vol point (the vendor's
       vanna columns are not one unit across names) — the open-interest figure when the gate holds */
    const vanna = v?.asks && !heldGate ? { call: callBs ? keptLeg('C', callBs.vanna * spot * volPt, callCount) : n.callVanna, put: putBs ? keptLeg('P', putBs.vanna * spot * volPt, putCount) : n.putVanna } : { call: n.callVanna, put: n.putVanna };
    const hc = callBs ? contractHigher(priceSpot, n.strike, years, n.callIv ?? 0, callCount, 'C', volPt, r, q) : null;
    const hp = putBs ? contractHigher(priceSpot, n.strike, years, n.putIv ?? 0, putCount, 'P', volPt, r, q) : null;
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
      const hc = years > 0 && (d.n.callIv ?? 0) > 0 ? contractHigher(priceSpot, d.n.strike, years, d.n.callIv ?? 0, cN, 'C', volPt, r, q) : null;
      const hp = years > 0 && (d.n.putIv ?? 0) > 0 ? contractHigher(priceSpot, d.n.strike, years, d.n.putIv ?? 0, pN, 'P', volPt, r, q) : null;
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
  const pairs: ParityPair[] = [];
  for (const [strike, leg] of book) {
    if (leg.callBidPx > 0 && leg.callAskPx >= leg.callBidPx && leg.putBidPx > 0 && leg.putAskPx >= leg.putBidPx) {
      pairs.push({ strike, callBid: leg.callBidPx, callAsk: leg.callAskPx, putBid: leg.putBidPx, putAsk: leg.putAskPx });
    }
  }
  const rate = carry?.r ?? DEFAULT_R;
  const spotPx = expiry && spot > 0 ? impliedBookSpot(ticker, spot, pairs, rate, calendarYears(expiry, priced.at)) : spot;
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
  /* the quotes are solved at the price the vendor marked them at (priced.px), as before 7178da0; only a short-dated index
     book that moved to its parity spot solves there. The pre-market print is not the price the close quotes stood at. */
  const ivPx = spotPx !== spot ? spotPx : priced.px || spot;
  if (expiry && spot > 0) {
    for (const n of painted) {
      const leg = book.get(n.strike);
      if (!leg) continue;
      if (leg.callIv > 0 || (leg.callBidPx > 0 && leg.callAskPx > 0)) n.callIv = ivOnTradingClock(leg.callBidPx, leg.callAskPx, leg.callIv, ivPx, n.strike, expiry, 'C', priced.at, carry?.r, carry?.q);
      if (leg.putIv > 0 || (leg.putBidPx > 0 && leg.putAskPx > 0)) n.putIv = ivOnTradingClock(leg.putBidPx, leg.putAskPx, leg.putIv, ivPx, n.strike, expiry, 'P', priced.at, carry?.r, carry?.q);
    }
  }
  smoothSide(painted, 'callIv');
  smoothSide(painted, 'putIv');
  if (spotPx !== spot) {
    for (let i = 0; i < painted.length; i++) {
      const n = painted[i];
      if (n === nodes[i]) painted[i] = { ...n, bookPx: spotPx };
      else n.bookPx = spotPx;
    }
  }
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
    const call = n.callIv && n.callIv > 0 ? blackScholesGreeks(spotPx, n.strike, t, n.callIv, carry?.r, carry?.q) : null;
    const put = n.putIv && n.putIv > 0 ? blackScholesGreeks(spotPx, n.strike, t, n.putIv, carry?.r, carry?.q) : null;
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
    /* Vega and vanna are priced here, off the contracts. Delta and charm stay the vendor's open-interest rows
       (withLiveGamma) where the rows carried them; a row without them (both legs zero) is not a zero book — its
       contracts price them, one long contract's $ figures: delta × 100 × S; vanna per quoted vol point (× 1% × 100 × S);
       charm per session */
    if (call && callN !== 0) n.callVex = keptLeg('C', call.vega * 100 * volPt, callN);
    else n.callVex = 0;
    if (put && putN !== 0) n.putVex = keptLeg('P', put.vega * 100 * volPt, putN);
    else n.putVex = 0;
    const v = n.vendor;
    const carried = (xs: readonly number[] | undefined) => !!xs && (xs[0] !== 0 || xs[3] !== 0);
    if (!carried(v?.d)) {
      n.callDex = call && callN !== 0 ? keptLeg('C', call.deltaCall * 100 * spot, callN) : 0;
      n.putDex = put && putN !== 0 ? keptLeg('P', put.deltaPut * 100 * spot, putN) : 0;
    }
    /* vanna always off the contracts, whatever the rows carried: vanna × S × OI per quoted vol point */
    n.callVanna = call && callN !== 0 ? keptLeg('C', call.vanna * spot * volPt, callN) : 0;
    n.putVanna = put && putN !== 0 ? keptLeg('P', put.vanna * spot * volPt, putN) : 0;
    /* charm off the contracts too, at the same vol and clock as vanna and vega (audit 2026-11-06). The vendor's charm_oi
       is its own delta model's: its unit and clock are the house's (charm_oi ÷ CHARM_SESSION × T_cal/T_trade lands within
       0.3% of Black-Scholes at the vendor's own vol where its delta agrees — SPY 10/29 765P −28.25M against −28.30M,
       778C −8.128M against −8.128M), but near the money on an expiring date its delta is not Black-Scholes at any vol the
       contract quotes (SPY 764C Δ 0.858 against 0.911 at its own vol), and its charm ran 5–40% off the re-pricing at the
       contract's quote-implied vol, the 772C with the other sign (−0.53M against +0.54M). The rows' charm stands in only
       until the date's contracts are read, or where a leg has no vol to price. */
    if (call && callN !== 0) n.callCharm = keptLeg('C', (call.charmCall / 252) * 100 * spot, callN);
    else if (!carried(v?.c) || callN === 0) n.callCharm = 0;
    if (put && putN !== 0) n.putCharm = keptLeg('P', (put.charmPut / 252) * 100 * spot, putN);
    else if (!carried(v?.c) || putN === 0) n.putCharm = 0;
    n.netVex = n.callVex + n.putVex;
    n.netDex = n.callDex + n.putDex;
    n.netVanna = n.callVanna + n.putVanna;
    n.netCharm = n.callCharm + n.putCharm;
  }
  stampFlow(painted, book, expiry, spot, ticker, near, t, volPt, carry?.r, carry?.q, spotPx, priced.at);
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
      /* every leg, not only the nets: a merged node's call and put vanna and charm (and its traded volume) once kept
         only the first date's, beside nets that summed every date */
      prev.callVanna += n.callVanna;
      prev.putVanna += n.putVanna;
      prev.netVanna += n.netVanna;
      prev.callCharm += n.callCharm;
      prev.putCharm += n.putCharm;
      prev.netCharm += n.netCharm;
      if (n.callVol != null || n.putVol != null) {
        prev.callVol = (prev.callVol ?? 0) + (n.callVol ?? 0);
        prev.putVol = (prev.putVol ?? 0) + (n.putVol ?? 0);
      }
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
