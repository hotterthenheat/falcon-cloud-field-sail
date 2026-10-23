/*
  SIDES RULE, AS DATA — the pieces of Trace's one rule (components/trace/TraceGuide.tsx SidesRule) that a page needs
  without Trace's tape machinery. Dossier reads through these; they mirror data/traceLive.ts line for line:

  - darkPrintKey: the vendor's tracking_id is NOT unique (audit round 5, 2026-10-23: SPY's dark read deduped on it alone
    and lost 59 prints, the largest of the day among them — 39,013 shares at 762.46, $29.75M). A print is one print by
    its tracking id AND its time, size, price and cumulative volume — traceLive.ts darkPrint's id, unhashed.
  - alertSide: a flow alert's side is the side that carried 60% or more of its WHOLE premium, unsided money included
    (traceLive.ts alertToPrint) — never "ask over 1.15× the bid".
*/

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** One dark (or lit) print's identity — the fields traceLive.ts darkPrint folds into its id */
export function darkPrintKey(row: Record<string, unknown>): string {
  return `${row.tracking_id ?? ''}|${row.executed_at ?? ''}|${row.size ?? ''}|${row.price ?? ''}|${row.volume ?? ''}`;
}

export interface AlertSides {
  side: 'ASK' | 'BID' | 'MID';
  /** dollars filled on the ask, on the bid, and neither (mid / no side) */
  ask: number;
  bid: number;
  other: number;
  /** the alert's whole premium — the denominator of every share */
  whole: number;
}

/** A flow alert's side and its money by side (SidesRule: 60% of the whole premium, else mid) */
export function alertSides(row: Record<string, unknown>): AlertSides {
  const ask = num(row.total_ask_side_prem);
  const bid = num(row.total_bid_side_prem);
  const sided = ask + bid;
  const total = num(row.total_premium);
  const whole = Math.max(total, sided);
  const side: AlertSides['side'] = whole > 0 && ask >= 0.6 * whole ? 'ASK' : whole > 0 && bid >= 0.6 * whole ? 'BID' : 'MID';
  return { side, ask, bid, other: Math.max(0, whole - sided), whole };
}
