
/* ΔOI heat: which strikes are being built and unwound right now. Cells are the net change across a bucket of the session's snapshots,
   symmetric around zero, today only. A FLEX OI change goes on the strike's last cell only (`setFlexStrike`); no FLEX history stays null. */

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

