/* Which strikes the exposure nodes draw on the chart. One rule for every look:

   - a strike is drawn when its size (the absolute dealer exposure at the newest column) is at least NODE_SHARE of the
     largest strike in view — or of a floor the host sets (half the book's largest strike, anywhere), so a view panned
     into a quiet stretch of the chain does not promote its noise to levels;
   - at most NODE_CAP of them, the largest first;
   - the call wall, the put wall, the flip and the pin are drawn whatever their size, on top of the cap, while they
     sit in view.

   Every other strike stays readable in the strike rail and on hover; it is just not drawn on the chart. Pure: no chart,
   no DOM, so scripts/node-strikes-proof.ts runs it on known books. */

/** A strike's share of the largest strike in view below which it is not drawn (unless it is an anchor) */
export const NODE_SHARE = 0.2;
/** The most strikes drawn for their size; the anchors ride on top of this */
export const NODE_CAP = 8;

/** One strike in view: its price and its exposure now (dealer sign; NaN or 0 for none) */
export interface StrikeRow {
  strike: number;
  value: number;
}

/** The book's named levels. The walls and the pin are strikes; the flip is a price, usually between two strikes. */
export interface NodeAnchors {
  callWall?: number | null;
  putWall?: number | null;
  flip?: number | null;
  pin?: number | null;
}

export type NodeRole = 'callWall' | 'putWall' | 'flip' | 'pin';

/** A level the chart draws */
export interface KeptLevel {
  /** the strike, or the flip's price */
  price: number;
  /** the exposure at that strike now, NaN where the book has none there (a flip between strikes) */
  value: number;
  /** its size against the largest strike in view (or the floor), 0..1 (0 where value is NaN) */
  share: number;
  /** the named levels it is */
  roles: NodeRole[];
  /** kept for its size (true) or only for a name (false) */
  big: boolean;
}

export interface SelectOptions {
  share?: number;
  cap?: number;
  /** the prices in view; an anchor outside them is not drawn */
  lo?: number;
  hi?: number;
  /** the least size the cut is measured against (the host's: half the book's largest strike) */
  floor?: number;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * The strikes to draw, lowest price first.
 */
export function selectNodeStrikes(rows: readonly StrikeRow[], anchors: NodeAnchors = {}, opts: SelectOptions = {}): KeptLevel[] {
  const cut = opts.share ?? NODE_SHARE;
  const cap = opts.cap ?? NODE_CAP;
  const lo = opts.lo ?? -Infinity;
  const hi = opts.hi ?? Infinity;
  let top = 0;
  for (const r of rows) {
    const a = Math.abs(r.value);
    if (Number.isFinite(a) && a > top) top = a;
  }
  /* no book in view, no floor to stand in for one: nothing is sized */
  if (top > 0 && opts.floor != null && Number.isFinite(opts.floor) && opts.floor > top) top = opts.floor;
  const out: KeptLevel[] = [];
  if (top > 0) {
    const big = rows.filter(r => Number.isFinite(r.value) && r.value !== 0 && Math.abs(r.value) >= cut * top);
    /* the largest first; equal sizes go to the lower strike, so the pick never depends on the input order */
    big.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.strike - b.strike);
    for (const r of big.slice(0, Math.max(0, cap))) out.push({ price: r.strike, value: r.value, share: Math.abs(r.value) / top, roles: [], big: true });
  }
  const named: [NodeRole, number | null | undefined][] = [
    ['callWall', anchors.callWall],
    ['putWall', anchors.putWall],
    ['flip', anchors.flip],
    ['pin', anchors.pin],
  ];
  for (const [role, price] of named) {
    if (price == null || !Number.isFinite(price) || price <= 0 || price < lo || price > hi) continue;
    const had = out.find(l => same(l.price, price));
    if (had) {
      if (!had.roles.includes(role)) had.roles.push(role);
      continue;
    }
    const row = rows.find(r => same(r.strike, price));
    const value = row && Number.isFinite(row.value) ? row.value : NaN;
    out.push({ price, value, share: top > 0 && value === value ? Math.abs(value) / top : 0, roles: [role], big: false });
  }
  return out.sort((a, b) => a.price - b.price);
}
