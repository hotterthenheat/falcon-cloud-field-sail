/*
==================================================
  SLAYER TERMINAL - TAPE ENRICHMENT (tape.ts)
  Expands the simulator's thin TapeOrder into a full
  FlowPrint deterministically. Placeholder — the real
  per-print feed fills the same contract later.
==================================================
*/

import Simulator from '../core/simulator';
import { now } from '../core/clock';
import { nyClock } from '../core/nyTime';
import type { TapeOrder } from '../types/market';
import type { BookContract, FlowPrint, PrintSentiment, StratTag, TapeSummary } from '../types/trace';
import { dayLean } from './traceLive';

// ---- deterministic RNG ------------------------------------------------------
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function h01(seed: string): number {
  return (hash(seed) % 1000) / 1000;
}

const DTE_POOL = [0, 1, 2, 5, 9, 16, 30, 44, 72, 102, 254];
const STRATS: StratTag[] = ['Vertical', 'Butterfly', 'Ratio', 'Custom'];

export function enrichPrint(order: TapeOrder, id: number): FlowPrint {
  const seed = `${order.ticker}-${order.strike}-${order.side}-${order.size}-${id}`;
  const h = (tag: string) => h01(`${seed}-${tag}`);

  const cfg = Simulator.TICKERS[order.ticker];
  const spot = cfg?.currentPrice ?? 100;
  const baseIv = cfg?.iv ?? 0.2;
  const strike = Number(order.strike);
  const right = order.type;

  // Short-dated skew on expiry selection
  const dte = DTE_POOL[Math.floor(Math.pow(h('dte'), 1.6) * DTE_POOL.length)];
  const expDate = new Date(Date.now() + dte * 86400000);
  const expiry = `${String(expDate.getMonth() + 1).padStart(2, '0')}/${String(expDate.getDate()).padStart(2, '0')}/${expDate.getFullYear()}`;

  // Premium estimate: intrinsic + gaussian time value scaled by DTE
  const intrinsic = right === 'C' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const money = (strike - spot) / spot;
  const timeValue =
    spot * baseIv * 0.08 * Math.exp(-Math.pow(money * 18, 2) / 2) * (0.5 + Math.sqrt((dte + 1) / 30));
  const fill = Number(Math.max(0.05, intrinsic * 0.98 + timeValue).toFixed(2));

  // Fill position within the spread follows the aggressor side
  const spreadW = Math.max(0.02, fill * 0.03 * (0.6 + h('spr')));
  const fillPos = order.side === 'ASK' ? 0.72 + h('pos') * 0.28 : h('pos') * 0.28;
  const mid = order.side === 'ASK' ? fill - spreadW * fillPos : fill + spreadW * (1 - fillPos);
  const bid = Number((mid - spreadW / 2).toFixed(2));
  const ask = Number((mid + spreadW / 2).toFixed(2));

  const isMid = h('mid') > 0.82;
  const side: FlowPrint['side'] = isMid ? 'MID' : order.side;
  const flowScore = isMid
    ? Math.round((h('fs') - 0.5) * 24)
    : Math.round((side === 'ASK' ? 1 : -1) * (48 + h('fs') * 52));

  const ratioBidPct = Math.round(side === 'BID' ? 45 + h('rb') * 50 : side === 'ASK' ? 5 + h('rb') * 50 : 35 + h('rb') * 30);
  const ratioLabel = isMid ? 'MID' : ratioBidPct >= 50 ? `BID ${ratioBidPct}%` : `ASK ${100 - ratioBidPct}%`;

  const volume = Math.round(order.size * (4 + h('vol') * 80));
  const oi = Math.max(1, Math.round(volume * (0.4 + h('oi') * 3.2)));
  const deltaOI = h('doi') > 0.35 ? Math.round((h('doi2') - 0.4) * oi * 0.25) : 0;

  const legs = h('legs') > 0.78 ? 2 + Math.floor(h('legs2') * 3) : 1;
  const strat: StratTag = legs > 1 ? STRATS[Math.floor(h('strat') * STRATS.length)] : h('strat') > 0.9 ? 'Custom' : '—';

  return {
    id,
    /* THE TAPE SPEAKS NEW YORK'S CLOCK (2026-10-13, with the Intervals strip): 24-hour with seconds, never the
       machine's 12-hour local — the card said "7:34:19 PM" under a strip that said "15:30–15:45 ET" */
    time: nyClock(now(), { seconds: true }),
    ticker: order.ticker,
    legs,
    strike,
    right,
    otmPct: Number((money * 100).toFixed(1)),
    expiry,
    dte,
    fill,
    bid,
    ask,
    fillPos: Number(fillPos.toFixed(2)),
    side,
    flowScore,
    ratioLabel,
    ratioBidPct,
    size: order.size,
    premium: Math.round(fill * order.size * 100),
    volume,
    oi,
    deltaOI,
    spot: Number(spot.toFixed(2)),
    iv: Number((baseIv * 100 * (0.8 + h('iv') * 0.6)).toFixed(2)),
    volOverOI: Number((volume / oi).toFixed(2)),
    strat,
    sweep: order.orderType === 'SWEEP',
  };
}

/** The day book's row, spoken as its LATEST print — so every flow surface
    opens THE tape's drilldown, not a lesser card (Noah, 2026-08-30: one card
    for a contract, everywhere). Day facts (volume, OI, ΔOI, IV) ride through
    unchanged so the card and the table can never disagree; the anchor print
    itself is the contract's most recent fill — or the exact clip a flow
    alert fired on, when the caller passes one. */
export function bookRowToPrint(
  row: BookContract,
  clip?: { size: number; fill: number; side: 'ASK' | 'BID' | 'MID'; time: string; bid?: number; ask?: number; premium?: number; multi?: boolean; sweep?: boolean; extended?: boolean; theta?: number }
): FlowPrint {
  /* NO INVENTED CLIP (the ship pass, 2026-10-22): this stood on hashes — a size drawn from the day's volume, a spread
     and a fill position — and the card said "$1.2M BOUGHT × 205" on a contract whose last print was 2 lots on the bid.
     The anchor is the clip the caller hands in (a flow alert's exact print, or the contract's real last trade via
     traceLive's useContractLast); without one the card speaks for the DAY — the day's volume and premium at the last
     price, the spread unknown — never a made-up print. */
  const fill = clip?.fill ?? row.last;
  /* without a clip the card stands for the DAY, and the day's side is the one lean rule (traceLive dayLean) — it was its
     own 55/45 of ask ÷ (ask + bid), blind to the mid (the third audit) */
  const lean = dayLean(row).lean;
  const side: FlowPrint['side'] = clip?.side ?? (lean === 'ASK' ? 'ASK' : lean === 'BID' ? 'BID' : 'MID');
  const bidQ = clip?.bid != null && clip.bid > 0 ? clip.bid : fill;
  const askQ = clip?.ask != null && clip.ask > 0 ? clip.ask : fill;
  const fillPos = askQ > bidQ ? Math.min(1, Math.max(0, (fill - bidQ) / (askQ - bidQ))) : 0.5;
  const size = clip?.size ?? row.volume;
  const dl = dayLean(row);
  const bidPct = Number.isFinite(dl.bid) && row.sideVol ? Math.round((row.sideVol.bid / Math.max(1, row.sideVol.ask + row.sideVol.bid)) * 100) : 100 - row.askPct;
  /* the anchor's own kind: a real clip says what IT was (its OPRA condition) — the day's multi-leg or sweep share only
     speaks when the card stands for the day, so a single 2-lot never wears "×2 legs · Custom" */
  const multi = clip ? !!clip.multi : row.multiPct >= 30;
  const sweep = clip ? !!clip.sweep : row.sweepPct >= 40;

  return {
    id: hash(`${row.key}-anchor`),
    time: clip?.time ?? row.lastAt,
    ticker: row.ticker,
    legs: multi ? 2 : 1,
    strike: row.strike,
    right: row.right,
    otmPct: row.otmPct,
    expiry: row.expiry,
    dte: row.dte,
    fill,
    bid: Number(bidQ.toFixed(2)),
    ask: Number(askQ.toFixed(2)),
    fillPos: Number(fillPos.toFixed(2)),
    side,
    /* where the fill sat in its quote, −100 at the bid to +100 at the ask; without a quote, the day's ask share */
    flowScore: askQ > bidQ ? Math.round((fillPos - 0.5) * 200) : Math.round((row.askPct - 50) * 2),
    ratioLabel: dl.lean === 'UNSIDED' || dl.lean === 'EVEN' ? (dl.lean === 'EVEN' ? 'EVEN' : 'MID') : dl.lean === 'BID' ? `BID ${Math.round(bidPct)}%` : `ASK ${100 - Math.round(bidPct)}%`,
    ratioBidPct: bidPct,
    size,
    premium: clip ? Math.round(clip.premium ?? fill * size * 100) : Math.round(row.premium),
    volume: row.volume,
    oi: row.oi,
    deltaOI: row.deltaOI,
    spot: row.spot,
    iv: row.iv,
    volOverOI: row.volOverOI,
    strat: multi ? 'Custom' : '—',
    sweep,
    extended: clip?.extended || undefined,
    theta: clip?.theta ?? row.theta,
  };
}

/** THE ONE RULE (the Trace guide's "Bought, sold, bullish, bearish"): a print at the ask was BOUGHT, on the bid SOLD.
    Calls bought and puts sold read bullish; puts bought and calls sold read bearish; a mid print reads neither — and so
    does a print outside the regular session, set against a thin post-market quote. */
/** A LEG OF A MULTI-LEG ORDER IS NOT A BET OF ITS OWN (audit round 4, 2026-10-22: the default tape's "Top bear XSP 738C
    sold" and "Largest XSP 736C bought" were the two legs of one call vertical, both `mlet` in the same millisecond, and on
    the ≥$1M cut 1,176 of 1,401 directional prints were spread legs — META 750P sold beside 760P bought). A print whose OPRA
    condition marks it a leg (ML?T / TL?T, the ?ESL family — traceLive printCondition) is read only as part of its
    structure, on Multi-Leg. An alert counts only when every print in it was a leg. */
export const isSpreadLeg = (p: Pick<FlowPrint, 'legs'> & Partial<Pick<FlowPrint, 'compression'>>): boolean => p.legs > 1 && !p.compression;

export function sentimentOf(p: FlowPrint): PrintSentiment {
  /* a compression package (OPRA cbmo / mctp, or the vendor's arbitrage tag) nets open interest down between members — it
     is not a bet either way (traceLive printCondition); a spread leg is half of a structure */
  if (p.side === 'MID' || p.extended || p.compression || isSpreadLeg(p)) return 'NEUTRAL';
  return (p.right === 'C' && p.side === 'ASK') || (p.right === 'P' && p.side === 'BID') ? 'BULLISH' : 'BEARISH';
}

/**
 * Notable flow — conviction-ranked ordering for the tape's Notable view
 * (Noah, 2026-08-19: "premium, size, OTM %, and aggressiveness rather than
 * just premium"). The composite is ENGINE-INTERNAL per the scores rule: it
 * orders the list and is never displayed — the user sees ranks, and the
 * row's own columns are the why. Components normalize against the buffer
 * itself so the ranking adapts to the session's scale: premium leads,
 * aggression next (a sweep crossing the spread is the loudest thing on a
 * tape), then size, then how far out-of-the-money the bet was placed
 * (ITM prints earn nothing on that axis — conviction lives OTM).
 */
export function rankNotable(prints: FlowPrint[]): FlowPrint[] {
  let maxPrem = 1;
  let maxSize = 1;
  let maxOtm = 1;
  for (const p of prints) {
    maxPrem = Math.max(maxPrem, p.premium);
    maxSize = Math.max(maxSize, p.size);
    maxOtm = Math.max(maxOtm, Math.max(0, p.otmPct));
  }
  const score = (p: FlowPrint) => {
    const aggression = p.sweep ? 1 : p.side !== 'MID' ? 0.55 : 0.15;
    const otm = Math.max(0, p.otmPct) / maxOtm;
    return 0.35 * (p.premium / maxPrem) + 0.25 * aggression + 0.2 * (p.size / maxSize) + 0.2 * otm;
  };
  return prints
    .map(p => [score(p), p] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, p]) => p);
}

/* THE KINDS SAY WHAT THEY COUNT (the partner's tape, at Noah's word 2026-10-13 — every non-sweep was a "block" before):
   a block is SIZE in one print — one leg, at least BLOCK_MIN_SIZE contracts or BLOCK_MIN_PREMIUM dollars. A print with
   legs is a multi-leg print, whatever its size; the rest are single prints. */
/* A COMPRESSION print is its own kind (not a bet — the package nets interest down); a FLOW ALERT of several prints is a
   BURST unless its LARGEST SINGLE trade is known and clears the block line (the third audit, 2026-10-22: alerts were
   counted as blocks on their total_size — "one leg, ≥100 contracts or $250K in one print" — though no one print was) */
export type PrintKind = 'SWEEP' | 'BLOCK' | 'MULTI' | 'SINGLE' | 'COMPRESSION' | 'BURST';
export const BLOCK_MIN_SIZE = 100;
export const BLOCK_MIN_PREMIUM = 250_000;
export function printKind(p: Pick<FlowPrint, 'sweep' | 'legs' | 'strat' | 'size' | 'premium'> & Partial<Pick<FlowPrint, 'compression' | 'trades' | 'largestTrade'>>): PrintKind {
  if (p.compression) return 'COMPRESSION';
  if (p.sweep) return 'SWEEP';
  if (p.legs > 1 || p.strat !== '—') return 'MULTI';
  if (p.trades != null && p.trades > 1) {
    const L = p.largestTrade;
    return L && (L.size >= BLOCK_MIN_SIZE || L.premium >= BLOCK_MIN_PREMIUM) ? 'BLOCK' : 'BURST';
  }
  if (p.size >= BLOCK_MIN_SIZE || p.premium >= BLOCK_MIN_PREMIUM) return 'BLOCK';
  return 'SINGLE';
}

export function summarizeTape(prints: FlowPrint[]): TapeSummary {
  let bull = 0;
  let bear = 0;
  let callCount = 0;
  let callPremium = 0;
  let putCount = 0;
  let putPremium = 0;
  let sweeps = 0;
  let blocks = 0;
  let multi = 0;
  let compCount = 0;
  let compPremium = 0;
  let legCount = 0;
  let legPremium = 0;
  let largest: FlowPrint | null = null;

  for (const p of prints) {
    /* compression is shown on its own and kept out of every directional total, the call/put money and the largest */
    if (p.compression) {
      compCount++;
      compPremium += p.premium;
      continue;
    }
    if (p.right === 'C') {
      callCount++;
      callPremium += p.premium;
    } else {
      putCount++;
      putPremium += p.premium;
    }
    const kind = printKind(p);
    if (kind === 'SWEEP') sweeps++;
    else if (kind === 'BLOCK') blocks++;
    else if (kind === 'MULTI') multi++;
    /* a spread leg is in the call/put money but never the largest bet or a side's total */
    if (isSpreadLeg(p)) {
      legCount++;
      legPremium += p.premium;
      continue;
    }
    if (!largest || p.premium > largest.premium) largest = p;
    const s = sentimentOf(p);
    if (s === 'BULLISH') bull += p.premium;
    else if (s === 'BEARISH') bear += p.premium;
  }

  const netPremium = bull - bear;
  return {
    totalPremium: callPremium + putPremium,
    netPremium,
    bullish: netPremium >= 0,
    bullPremium: bull,
    bearPremium: bear,
    callCount,
    callPremium,
    putCount,
    putPremium,
    /* PUT PREMIUM AGAINST CALL PREMIUM, as its label says (it divided the COUNTS, so "4C $169.3K / 4P $464.5K" read P/C 1.00) */
    pcRatio: callPremium > 0 ? Number((putPremium / callPremium).toFixed(2)) : 0,
    sweeps,
    blocks,
    multi,
    other: prints.length - compCount - sweeps - blocks - multi,
    compression: { count: compCount, premium: compPremium },
    spreadLegs: { count: legCount, premium: legPremium },
    largest: largest
      ? { ticker: largest.ticker, strike: largest.strike, right: largest.right, premium: largest.premium }
      : null,
  };
}
