/* Pure identity builders for the decision journal (no state, no clock); the only place OCC symbols and decision ids are built. Types: types/journal.ts. */

import type { ContractId, DecisionSource } from '../types/journal';

/** Engine build stamp on every DecisionEvent: bump on any change to scoring maths, weights, thresholds or candidates. */
export const ENGINE_VERSION = 'compass@0.2.0-sim'; // 0.2.0: time-aware setup pricer (iv·√t width) — mids now differ by sleeve

/** OCC 21-character symbol: root padded to 6, YYMMDD, C/P, strike × 1000 padded to 8 ("SPY   260731C00500000"). */
export function occSymbol(ticker: string, expiry: string, right: 'C' | 'P', strike: number): string {
  const root = ticker.toUpperCase().padEnd(6, ' ');
  const [y, m, d] = expiry.split('-');
  const date = `${y.slice(2)}${m}${d}`;
  const strikeField = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${root}${date}${right}${strikeField}`;
}

/** Canonical identity for an option contract. */
export function optionContractId(ticker: string, expiry: string, right: 'C' | 'P', strike: number): ContractId {
  return {
    instrument: 'OPTION',
    ticker: ticker.toUpperCase(),
    right,
    strike,
    expiry,
    occ: occSymbol(ticker, expiry, right, strike),
  };
}

/** Canonical identity for the underlying itself. */
export function stockContractId(ticker: string): ContractId {
  return { instrument: 'STOCK', ticker: ticker.toUpperCase(), occ: ticker.toUpperCase() };
}

/** Canonical identity for a single-name future (CME SSFs etc). */
export function futureContractId(ticker: string, expiry: string): ContractId {
  return {
    instrument: 'SINGLE_NAME_FUTURE',
    ticker: ticker.toUpperCase(),
    expiry,
    occ: `FUT:${ticker.toUpperCase()}:${expiry}`,
  };
}

/** Stable text key for a decision source — half of every decision id. A
    sleeve, when present, is part of the identity: the same contract from the
    same scanner on two tenors is two decisions. */
export function sourceKey(source: DecisionSource): string {
  if (source.kind === 'weigher') return `weigher:${source.horizon}`;
  return source.sleeve ? `scanner:${source.scanner}@${source.sleeve}` : `scanner:${source.scanner}`;
}

/** Journal-unique decision id. Same contract, same source, same instant can
    only ever be one decision — re-emits on later scans are new decisions. */
export function decisionId(contract: ContractId, source: DecisionSource, decidedAtIso: string): string {
  return `${contract.occ}|${sourceKey(source)}|${decidedAtIso}`;
}

