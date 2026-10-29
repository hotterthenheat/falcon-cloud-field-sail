/* One contract, one quote, read by the header, chart, checks, setup and nearby book. Nothing here is a fill. */

import type { OptionRight } from '../types/compass';

/** Equity and index options, per contract. Not a fee. */
export const OPTION_MULTIPLIER = 100;

/** A quote older than this is stale. The sim ticks about every 1.5s. */
const STALE_MS = 8_000;

/** The 0DTE premium stop: ask × (1 − 0.5322). An option price, not a stock price. */
export const STOP_KEEP = 1 - 0.5322;

export interface ContractQuote {
  ticker: string;
  contract: string;
  strike: number;
  right: OptionRight;
  spot: number;
  bid: number;
  ask: number;
  /** (bid + ask) / 2. The documented quote for value splits. */
  mid: number;
  /** Same number as mid. Named so the contract panel can say mark. */
  mark: number;
  /** Planned entry is the ask. It is not a fill. */
  entryPremium: number;
  /** Always null until a timestamped execution quote exists. This feed has none. */
  fill: null;
  intrinsic: number;
  /** mark − intrinsic. Not clamped. */
  extrinsic: number;
  /** Long put: strike − premium paid. Long call: strike + premium paid. Premium paid is the ask. */
  breakeven: number;
  /** Option-price stop. */
  stopPremium: number;
  /** (ask − stop) × multiplier. Fees are not in this number. */
  lossAtStop: number;
  /** ask × multiplier. The whole premium, if it goes to zero. Fees are not in this number. */
  maxPremiumLoss: number;
  /** No fee schedule on this feed. */
  fees: null;
  ivPct: number;
  source: string;
  quotedAt: number;
  spotAt: number;
}

export function intrinsicValue(spot: number, strike: number, right: OptionRight): number {
  if (!(spot > 0) || !(strike > 0)) return 0;
  return Math.max(0, right === 'C' ? spot - strike : strike - spot);
}

/** mark − intrinsic, unclamped, so a bad quote stays visible. */
export function extrinsicValue(mark: number, intrinsic: number): number {
  return mark - intrinsic;
}

/** Expiration breakeven before costs. Put: strike − premium. Call: strike + premium. */
export function expirationBreakeven(strike: number, premiumPaid: number, right: OptionRight): number {
  return right === 'P' ? strike - premiumPaid : strike + premiumPaid;
}

export function lossAtStop(entryAsk: number, stopPremium: number, multiplier = OPTION_MULTIPLIER): number {
  return (entryAsk - stopPremium) * multiplier;
}

export function maxPremiumLoss(entryAsk: number, multiplier = OPTION_MULTIPLIER): number {
  return entryAsk * multiplier;
}

export function quoteContract(input: {
  ticker: string;
  contract: string;
  strike: number;
  right: OptionRight;
  spot: number;
  bid: number;
  ask: number;
  ivPct: number;
  quotedAt: number;
  spotAt?: number;
  source?: string;
}): ContractQuote {
  const bid = input.bid;
  const ask = input.ask > 0 ? input.ask : input.bid;
  const mark = (bid + ask) / 2;
  const intrinsic = intrinsicValue(input.spot, input.strike, input.right);
  const entryPremium = ask;
  const stopPremium = entryPremium * STOP_KEEP;
  return {
    ticker: input.ticker,
    contract: input.contract,
    strike: input.strike,
    right: input.right,
    spot: input.spot,
    bid,
    ask,
    mid: mark,
    mark,
    entryPremium,
    fill: null,
    intrinsic,
    extrinsic: extrinsicValue(mark, intrinsic),
    breakeven: expirationBreakeven(input.strike, entryPremium, input.right),
    stopPremium,
    lossAtStop: lossAtStop(entryPremium, stopPremium),
    maxPremiumLoss: maxPremiumLoss(entryPremium),
    fees: null,
    ivPct: input.ivPct,
    source: input.source ?? 'theta',
    quotedAt: input.quotedAt,
    spotAt: input.spotAt ?? input.quotedAt,
  };
}

export function quoteMissing(q: Pick<ContractQuote, 'bid' | 'ask' | 'spot'>): boolean {
  return !(q.spot > 0) || !(q.bid > 0) || !(q.ask > 0) || q.ask < q.bid;
}

export function quoteStale(quotedAt: number, now: number, missing: boolean): boolean {
  if (missing || !(quotedAt > 0)) return true;
  return now - quotedAt > STALE_MS;
}

/** Entry is live only with the session open, the contract unexpired, a fresh quote and an execution quote;
    this feed has none, so a passing candidate is still not entry-eligible. */
export function entryGate(input: {
  sessionOpen: boolean;
  expired: boolean;
  quoteOk: boolean;
  executionQuote: boolean;
}): { eligible: boolean; reason: string } {
  if (input.expired) return { eligible: false, reason: 'Expired — entry unavailable' };
  if (!input.sessionOpen) return { eligible: false, reason: 'Session closed — entry unavailable' };
  if (!input.quoteOk) return { eligible: false, reason: 'Quote missing or stale' };
  if (!input.executionQuote) return { eligible: false, reason: 'No execution quote' };
  return { eligible: true, reason: 'Execution quote passed' };
}
