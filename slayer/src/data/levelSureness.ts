/* What every dealer level stands on: the assumption (customers sold calls and bought puts, dealers hold the other side),
   the freshness (OI daily, price live), and the other side (the levels with every strike's side flipped). Pure; house sign as core/walls.ts. */

import { bookCandles } from './uwBook';
import { sessionStarts } from './indicators';
import { nyDay } from '../core/nyTime';

/** The line every surface prints first */
export const ASSUMPTION_WORDS = 'Assumes customers sold the calls and bought the puts, so dealers hold the other side — open interest does not say who did.';

/** "Open interest as of Oct 8's close · priced at the live spot" — the date when the tape holds a closed session */
export function freshnessOf(ticker?: string): string {
  let when = 'the last close';
  if (ticker) {
    const bars = bookCandles(ticker);
    if (bars && bars.length > 2) {
      const starts = sessionStarts(bars, 1);
      if (starts.length >= 2) when = `${nyDay(bars[starts[starts.length - 1] - 1].time * 1000)}'s close`;
    }
  }
  return `Open interest as of ${when} — it is counted once a day · the hedging is priced at the live spot`;
}

