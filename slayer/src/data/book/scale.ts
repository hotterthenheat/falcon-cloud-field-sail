/* The vendor's rows as the house's strike nodes: gamma, delta, vanna and charm off greek-exposure and spot-exposures rows,
   each contract's facts (open interest, vol, Black-Scholes delta, vanna, charm, vega) off option-contracts — every greek kept in
   the house sign of core/dealerSign.ts. Pure: no fetch, no state. */

import { nyIsoDate } from '../../core/nyTime';
import { keptLeg, keptVendorLeg } from '../../core/dealerSign';
import { type StrikeNode } from '../../types/market';
import { blackScholesGreeks } from '../../core/greeks';
import { tradingYears } from '../../core/tradingYear';
import { carryFor } from '../../core/carry';
import { dealerInventory, flowFirm, flowImbalance, flowWindow, ivOnTradingClock, quotedVolPoint, quoteMaxAge, smoothSmile, unsignedShare } from '../../core/volClock';
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
  /** The vendor row included its vanna (charm, delta) fields, so a zero is a real zero */
  vanna: boolean;
  charm: boolean;
  delta: boolean;
};
export type LiveGamma = Map<number, LiveLeg>;

const blankLeg = (): LiveLeg => ({ c: 0, p: 0, cv: 0, pv: 0, cc: 0, pc: 0, cd: 0, pd: 0, vanna: false, charm: false, delta: false });

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
  const flowNets: { strike: number; value: number }[] = [];
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
      const scale = spot * spot * 0.01 * 100;
      flowNets.push({ strike: n.strike, value: (put ? keptLeg('P', put.gamma * scale, putInv) : 0) + (call ? keptLeg('C', call.gamma * scale, callInv) : 0) });
    }
    volSum += leg.callVol + leg.putVol;
    bareSum += leg.callMid + leg.callNone + leg.putMid + leg.putNone;
    /* Vega is repriced here, on this clock and this vol, not the vendor's calendar-time vega. */
    n.callBook = callN;
    n.putBook = putN;
    /* one long contract's $ figures: delta × 100 × S; vanna per quoted vol point (× 1% × 100 × S); charm per session; vega per quoted vol point */
    if (call && callN !== 0) {
      n.callDex = keptLeg('C', call.deltaCall * 100 * spot, callN);
      n.callVanna = keptLeg('C', call.vanna * spot * volPt, callN);
      n.callCharm = keptLeg('C', (call.charmCall / 252) * 100 * spot, callN);
      n.callVex = keptLeg('C', call.vega * 100 * volPt, callN);
    } else {
      n.callVex = 0;
    }
    if (put && putN !== 0) {
      n.putDex = keptLeg('P', put.deltaPut * 100 * spot, putN);
      n.putVanna = keptLeg('P', put.vanna * spot * volPt, putN);
      n.putCharm = keptLeg('P', (put.charmPut / 252) * 100 * spot, putN);
      n.putVex = keptLeg('P', put.vega * 100 * volPt, putN);
    } else {
      n.putVex = 0;
    }
    n.netVex = n.callVex + n.putVex;
    n.netDex = n.callDex + n.putDex;
    n.netVanna = n.callVanna + n.putVanna;
    n.netCharm = n.callCharm + n.putCharm;
  }
  if (ticker && spot > 0 && near) {
    const flow = peakStrikes(flowNets);
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
