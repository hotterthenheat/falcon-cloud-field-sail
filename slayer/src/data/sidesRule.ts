/* Trace's sides rule as data for pages without Trace's tape (Dossier), mirroring traceLive.ts: a dark print is keyed by tracking id plus
   time, size, price and cumulative volume (the id alone is not unique); a flow alert's side carries ≥60% of its whole premium. */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** One dark (or lit) print's identity — the fields traceLive.ts darkPrint folds into its id */
export function darkPrintKey(row: Record<string, unknown>): string {
  return `${row.tracking_id ?? ''}|${row.executed_at ?? ''}|${row.size ?? ''}|${row.price ?? ''}|${row.volume ?? ''}`;
}

interface AlertSides {
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
