/*
==================================================
  SLAYER TERMINAL - HOW SURE IS THIS
  (data/levelSureness.ts)

  The ideas' rank 3, 2026-10-09: every dealer level
  says what it stands on. Three things, each a
  disclosure of method — never a disclaimer:

    the assumption  which side dealers are on. Open
                    interest says how many contracts
                    are open at a strike, not who
                    bought them; every exposure model
                    assumes it. This one assumes the
                    street's usual: customers sold
                    the calls and bought the puts,
                    dealers hold the other side.
    the freshness   open interest is counted once a
                    day, after the close; the price
                    the hedging is read at is live.
    the other side  where the level would sit if that
                    assumption were wrong — the book
                    read with every strike's side
                    turned over. The walls move to the
                    strikes that are heaviest the
                    other way; the flip keeps its
                    price and swaps its meaning; the
                    supreme keeps its strike and
                    pushes the other way.

  Pure: a chain and a spot in, the words out, so any
  room reads it (Terrain next). The house sign is
  core/walls.ts's — negative call-dominant,
  positive put-dominant.
==================================================
*/

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

