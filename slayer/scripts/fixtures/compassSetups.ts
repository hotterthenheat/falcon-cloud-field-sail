/* Compass cards for the rendered-words proof (scripts/compass-words-proof.ts): one of each band the scan shows, with
   the quotes Compass recorded on 2026-11-05/06 (the official record), and a model score on every scored one so a page
   that printed it would be caught. Not market data for any page: the proof only. */

import type { Setup } from '../../src/types/compass';

const DAY_0 = Date.parse('2026-11-06T15:20:00Z');

const base = (o: Partial<Setup> & Pick<Setup, 'ticker' | 'strike' | 'right' | 'bid' | 'ask'>): Setup => {
  const strikeWord = o.strike % 1 === 0 ? o.strike.toFixed(0) : o.strike.toFixed(2);
  const contract = `${o.ticker} ${strikeWord}${o.right}`;
  return {
    id: `${o.ticker}-${strikeWord}-${o.right}-top-setups-odte`,
    contract,
    expiry: '0DTE',
    expiryDate: '2026-11-06',
    sessionsLeft: 0,
    sigmaMovePct: 0.6,
    sleeve: 'odte',
    score: 0,
    verdict: 'ENTER',
    topRated: false,
    topOpportunity: false,
    expectedMovePct: 0,
    swingTarget: { price: 0, label: '' } as unknown as Setup['swingTarget'],
    scalpExit: { price: 0, label: '' } as unknown as Setup['scalpExit'],
    headline: '',
    whyChips: [],
    whyText: 'The math passes.',
    greeks: { delta: o.right === 'C' ? 0.45 : -0.45, gamma: 0.05, theta: -0.4, vega: 0.05, iv: 0.18 } as Setup['greeks'],
    mid: (o.bid + o.ask) / 2,
    liveMid: (o.bid + o.ask) / 2,
    highWater: 0,
    confidence: 0,
    health: 0,
    momentum: 'flat' as Setup['momentum'],
    takeProfits: [],
    priceTargets: [],
    liquidityLabel: 'Tight',
    liquiditySpread: '',
    invalidationPrice: 0,
    invalidationReason: '',
    quotedAt: DAY_0 - 1_000,
    seenAt: DAY_0,
    mark: DAY_0,
    flatAt: Date.parse('2026-11-06T20:55:00Z'),
    ...o,
  };
};

/** Model 1 (book A), a Model 1 call Model 2 rides (book B, the wing), Model 3 (book C, the late sweep), and a closest
    row that is not a call: each carries the score the engine read, which no page may print. */
export const FIXTURE_SETUPS: Setup[] = [
  base({ ticker: 'SPY', strike: 757, right: 'P', bid: 5.66, ask: 5.68, spot: 754.15, p1: 0.756, prun: 0.41, runner: false, band: 'top' }),
  base({ ticker: 'IWM', strike: 271, right: 'C', bid: 2.37, ask: 2.4, spot: 272.9, p1: 0.728, prun: 0.62, runner: true, band: 'wing' }),
  base({ ticker: 'SPXW', strike: 7420, right: 'C', bid: 1.35, ask: 1.4, spot: 7403.39, band: 'lottery', whyText: 'Model 3. No model score.' }),
  base({ ticker: 'GLD', strike: 373, right: 'P', bid: 0.42, ask: 0.53, spot: 373.4, p1: 0.802, prun: 0.3, band: 'closest', verdict: 'WATCH', whyText: 'Closest: did not clear.' }),
];
