/* VOLUME AT PRICE — the one helper behind every volume profile on the chart: the indicator versions here (visible range,
   session, periodic, auto anchored; components/gex/tvProfilesPrimitive.ts) and the drawing tools (anchored and fixed
   range), which import it.

   THE APPROXIMATION, said plainly: a bar carries one volume and a high and a low, not its trades. Each bar's volume is
   spread evenly over the price range it covers, by overlap with each row (a bar with no range puts it all in its one
   row), and counted UP when the bar closed at or above its open, DOWN when it closed below — the standard desks' rule
   for bar-built profiles. Fed one-minute bars that is close to the tape; fed day bars it is coarse, and the profile
   says which bars built it (`source` on the caller's side). Prints are never invented: no volume, no profile.

   Rows: a number of rows across the range (24 by default), or a fixed price step per row (ticks × the tick size).
   POC: the row with the most volume (ties: the lower row). Value area: from the POC, one row at a time, the heavier of
   the next row above and the next row below joins (a tie goes to the row nearer the POC, then to the row above) until
   the joined volume reaches the share asked (70% by default). VAH / VAL are the top and the bottom of the outermost
   rows joined. Hand-checked in scripts/volume-at-price-proof.ts. */

export interface VapBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VapRow {
  /** The row's floor and ceiling, in price */
  lo: number;
  hi: number;
  up: number;
  down: number;
  total: number;
}

export interface VapProfile {
  /** First and last bar times (seconds) the profile covers */
  from: number;
  to: number;
  rows: VapRow[];
  rowSize: number;
  total: number;
  up: number;
  down: number;
  /** Index of the point of control, and its row's middle */
  poc: number;
  pocPrice: number;
  /** Indexes of the value area's lowest and highest rows, and its edges in price */
  vaLo: number;
  vaHi: number;
  val: number;
  vah: number;
  /** Bars that built it */
  bars: number;
}

export type RowLayout = 'rows' | 'ticks';

export interface VapOptions {
  /** 'rows': `size` rows across the range; 'ticks': `size` ticks a row */
  layout?: RowLayout;
  size?: number;
  /** The tick for the ticks layout (0.01 for a stock) */
  tick?: number;
  /** Share of the volume the value area holds, 0–1 */
  valueArea?: number;
  /** A ceiling on rows however fine the step, so a tick layout over a wide range stays drawable */
  maxRows?: number;
}

/** The row height for a range */
export function rowSizeFor(lo: number, hi: number, layout: RowLayout, size: number, tick = 0.01): number {
  const n = Math.max(1, Math.round(size));
  if (layout === 'ticks') return Math.max(tick, n * tick);
  const span = hi - lo;
  return span > 0 ? span / n : Math.max(tick, Math.abs(hi) * 1e-4 || tick);
}

/** The value area over row totals: [lowest row, highest row] joined from the POC */
export function valueAreaOf(totals: readonly number[], poc: number, share: number): [number, number] {
  const sum = totals.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || poc < 0 || poc >= totals.length) return [poc, poc];
  const target = sum * Math.min(1, Math.max(0, share));
  let lo = poc;
  let hi = poc;
  let have = totals[poc];
  while (have < target && (lo > 0 || hi < totals.length - 1)) {
    const up = hi < totals.length - 1 ? totals[hi + 1] : -1;
    const dn = lo > 0 ? totals[lo - 1] : -1;
    let takeUp: boolean;
    if (up !== dn) takeUp = up > dn;
    else {
      /* equal volume: the row nearer the POC, then the row above */
      const dUp = hi + 1 - poc;
      const dDn = poc - (lo - 1);
      takeUp = dUp <= dDn;
    }
    if (takeUp) {
      hi++;
      have += totals[hi];
    } else {
      lo--;
      have += totals[lo];
    }
  }
  return [lo, hi];
}

/** One profile over the bars (any order); null with no bars, no range or no volume */
export function volumeAtPrice(bars: readonly VapBar[], o: VapOptions = {}): VapProfile | null {
  let lo = Infinity;
  let hi = -Infinity;
  let from = Infinity;
  let to = -Infinity;
  let n = 0;
  for (const b of bars) {
    if (!(b.volume > 0) || !Number.isFinite(b.high) || !Number.isFinite(b.low)) continue;
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
    if (b.time < from) from = b.time;
    if (b.time > to) to = b.time;
    n++;
  }
  if (!n || !(hi >= lo)) return null;
  const layout = o.layout ?? 'rows';
  const tick = o.tick ?? 0.01;
  let step = rowSizeFor(lo, hi, layout, o.size ?? 24, tick);
  const cap = o.maxRows ?? 400;
  /* the ticks layout: rows sit on the tick grid; the rows layout: the range itself is cut */
  const base = layout === 'ticks' ? Math.floor(lo / step + 1e-9) * step : lo;
  let count = layout === 'ticks' ? Math.max(1, Math.floor((hi - base) / step + 1e-9) + 1) : Math.max(1, Math.round(o.size ?? 24));
  if (count > cap) {
    step = (hi - base) / cap;
    count = cap;
  }
  if (!(step > 0)) step = tick;
  const rows: VapRow[] = Array.from({ length: count }, (_, i) => ({ lo: base + i * step, hi: base + (i + 1) * step, up: 0, down: 0, total: 0 }));
  const at = (p: number) => Math.min(count - 1, Math.max(0, Math.floor((p - base) / step + 1e-9)));
  let up = 0;
  let down = 0;
  for (const b of bars) {
    if (!(b.volume > 0) || !Number.isFinite(b.high) || !Number.isFinite(b.low)) continue;
    const isUp = b.close >= b.open;
    const add = (i: number, v: number) => {
      const r = rows[i];
      if (isUp) r.up += v;
      else r.down += v;
      r.total += v;
    };
    if (b.high <= b.low) add(at(b.high), b.volume);
    else {
      const first = at(b.low);
      const last = at(b.high);
      const span = b.high - b.low;
      for (let i = first; i <= last; i++) {
        const overlap = Math.min(b.high, rows[i].hi) - Math.max(b.low, rows[i].lo);
        if (overlap > 0) add(i, (b.volume * overlap) / span);
      }
    }
    if (isUp) up += b.volume;
    else down += b.volume;
  }
  let poc = 0;
  for (let i = 1; i < count; i++) if (rows[i].total > rows[poc].total) poc = i;
  const [vaLo, vaHi] = valueAreaOf(rows.map(r => r.total), poc, o.valueArea ?? 0.7);
  return {
    from,
    to,
    rows,
    rowSize: step,
    total: up + down,
    up,
    down,
    poc,
    pocPrice: (rows[poc].lo + rows[poc].hi) / 2,
    vaLo,
    vaHi,
    val: rows[vaLo].lo,
    vah: rows[vaHi].hi,
    bars: n,
  };
}

/** Bars split into runs by a key (a session day, a week, a month), in time order; a key of null drops the bar */
export function segmentBy<B extends { time: number }>(bars: readonly B[], keyOf: (b: B) => string | null): { key: string; bars: B[] }[] {
  const out: { key: string; bars: B[] }[] = [];
  let cur: { key: string; bars: B[] } | null = null;
  for (const b of bars) {
    const k = keyOf(b);
    if (k === null) continue;
    if (!cur || cur.key !== k) {
      cur = { key: k, bars: [] };
      out.push(cur);
    }
    cur.bars.push(b);
  }
  return out;
}
