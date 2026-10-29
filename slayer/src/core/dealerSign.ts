/* The one dealer-positioning model, for every greek: dealers are long the calls and short the puts. It is the vendor's own —
   its gamma rows (calls +, puts −) and its spot-exposure vanna and charm rows are signed this way; its delta rows and its
   greek-exposure vanna and charm are not (they are open interest × the holder's greek), so their put legs are turned on ingest.

   A leg's DEALER exposure is side × (one long contract's greek) × contracts, side +1 for calls and −1 for puts: positive
   gamma means dealers are long gamma there (their hedging absorbs moves), positive delta that they are long stock-equivalent
   (hedged by being short the stock), positive vanna that a vol drop makes them buy, positive charm that the clock makes them
   sell, positive vega that a vol rise pays them.

   Every exposure on a StrikeNode (callGex … netCharm, the higher greeks) is KEPT as the negative of the dealer exposure — the
   house sign, so call-heavy gamma is negative. Nothing reads a kept figure by hand: dealerOf() turns it into what a page
   prints, keptOf() turns a dealer figure into what is stored. */

/** +1 for a call leg, −1 for a put leg: the model's dealer position per contract of open interest */
export const DEALER_SIDE = { C: 1, P: -1 } as const;
export type Right = keyof typeof DEALER_SIDE;

/** A kept (house-sign) exposure as the dealer exposure the pages print */
export const dealerOf = (kept: number): number => (kept === 0 ? 0 : -kept);

/** A dealer exposure as it is kept on the book */
export const keptOf = (dealer: number): number => (dealer === 0 ? 0 : -dealer);

/** One leg as kept: `perLong` is one LONG contract's exposure (greek × units), `count` the contracts (open interest) */
export const keptLeg = (right: Right, perLong: number, count: number): number => keptOf(DEALER_SIDE[right] * perLong * count);

/** A vendor row's leg as kept: `vendor` is the vendor's figure, `dealerSigned` whether the vendor already signed it by this
    model (its gamma; its spot-exposure vanna and charm) or printed the holder's figure (delta; greek-exposure vanna, charm) */
export const keptVendorLeg = (right: Right, vendor: number, dealerSigned: boolean): number =>
  keptOf(dealerSigned ? vendor : DEALER_SIDE[right] * vendor);
