
/*
==================================================
  SLAYER TERMINAL - ΔOI HEAT (data/oiHeat.ts)

  Which strikes are being BUILT and UNWOUND right
  now — P-8.
==================================================

  EVERY OTHER EXPOSURE SURFACE ON THIS DESK IS A SNAPSHOT OF A STOCK. This
  one is the flow. The map answers "where is the gamma"; it cannot answer
  "is that wall growing or dying", and those are different trades: a shelf
  being added to all morning is one a desk is committed to, and one bleeding
  since the open is one that will not be there this afternoon.

  CHANGE, NOT LEVEL. Cells carry the DIFFERENCE between consecutive
  snapshots, which is the whole point — a strike sitting at 40,000 contracts
  all day is invisible here, and should be. The heat scale is therefore
  symmetric around zero: building and unwinding are opposite readings of the
  same magnitude, not a big number and a small one.

  THE COLUMNS ARE THE SNAPSHOT GRID, SUBSAMPLED. Snapshots arrive per bar,
  which is far more columns than a reader can use or a table can show, so
  the session is divided into BUCKETS and each cell is the NET change across
  its bucket. Net, not sum-of-absolutes: a strike built and unwound inside
  one bucket did nothing, and should read as nothing.

  TODAY ONLY. The question is "right now", and a grid spanning the whole
  buffer would answer a different one while wearing the same label. The
  session cut is the bars' own — the same one every session feature uses —
  so this cannot disagree with the tape about where the day began.

  ── THE FLEX TRANSFER ────────────────────────────────────────────────

  A FLEX open-interest change is not a trade. `setFlexStrike` takes the
  day-over-day change from one FLEX contract's history and puts that
  number on the strike's last cell only. Repeating it on every bucket
  would multiply it by the column count when the panel sums the row.
  A strike with no FLEX history stays null — null is "not seen", not zero.
*/

const flexByStrike = new Map<number, number>();
let flexRev = 0;
const flexListeners = new Set<() => void>();

/** Replace the book's FLEX transfers. One number per strike, from that name's contracts. */
export function setFlexBook(entries: Iterable<[number, number]>): void {
  flexByStrike.clear();
  for (const [strike, delta] of entries) {
    if (Number.isFinite(strike) && Number.isFinite(delta)) flexByStrike.set(strike, delta);
  }
  flexRev += 1;
  flexListeners.forEach(fn => fn());
}

