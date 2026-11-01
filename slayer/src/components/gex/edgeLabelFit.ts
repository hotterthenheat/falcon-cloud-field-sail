/* The labels at a chart's right edge — the exposure nodes' tags, the key levels' names, the cone's 1σ/2σ ends — fitted
   to the pane in one pass, so none lands on another, on the price's own row at the axis, or under the pane's floating
   chrome. One rule for every look (gexNodesPrimitive's tags, nodeHeat's labels):

   - labels within MERGE_PX of one another are one label (the most important keeps the row; the others ride on it);
   - the pane holds at most one label per ROW_PX of its height, and never more than its free lanes: past that the least
     important go first — the walls, the flip and the top node ("keep") go last;
   - the rest are placed nearest their own level, pushed apart top to bottom and then bottom to top, around the reserved
     bands; a label that would stand more than MAX_SHIFT rows from its level is dropped rather than led across the pane.

   Pure: no chart, no DOM, so scripts/edge-label-fit-proof.ts runs it on known stacks. */

/** Two levels this close (CSS px) are one label */
export const MERGE_PX = 4;
/** At most one label per this much pane height (CSS px): a 300px pane carries seven, a phone's short pane four */
export const ROW_PX = 42;
/** A label is never led further than this many rows from its own level */
export const MAX_SHIFT = 2.5;

export interface EdgeItem {
  /** the caller's handle */
  id: string;
  /** the level's own y, CSS px */
  y: number;
  /** larger first when the pane is crowded */
  prio: number;
  /** a wall, the flip, the top node: dropped only when nothing else is left to drop */
  keep?: boolean;
}

export interface FitOptions {
  /** the label's height and the gap between two, CSS px */
  h: number;
  gap?: number;
  /** the usable band of the pane: below the floating chrome, above the foot */
  top: number;
  bottom: number;
  /** bands no label may cover (the price's row at the axis), CSS px */
  reserved?: readonly { lo: number; hi: number }[];
  /** override ROW_PX (a caller that wants fewer) */
  rowPx?: number;
  /** override MERGE_PX */
  mergePx?: number;
  /** override MAX_SHIFT (rows) */
  maxShift?: number;
}

export interface Placed {
  id: string;
  /** the level's y and the label's centre, CSS px */
  y: number;
  ty: number;
  /** the ids merged into this one (its own first) */
  ids: string[];
}

const byPrio = (a: EdgeItem, b: EdgeItem) => Number(!!b.keep) - Number(!!a.keep) || b.prio - a.prio || a.y - b.y;

/** The labels that fit, top to bottom, each with the centre it is drawn at */
export function fitEdgeLabels(items: readonly EdgeItem[], o: FitOptions): Placed[] {
  const h = o.h;
  const gap = o.gap ?? 2;
  const step = h + gap;
  const top = o.top + h / 2;
  const bottom = o.bottom - h / 2;
  if (!(bottom >= top)) return [];
  const mergePx = o.mergePx ?? MERGE_PX;
  const maxShift = (o.maxShift ?? MAX_SHIFT) * step;
  const reserved = (o.reserved ?? []).filter(r => r.hi > r.lo).map(r => ({ lo: r.lo - h / 2, hi: r.hi + h / 2 }));

  /* 1. merge: the most important of a cluster keeps the row */
  const live = items.filter(i => Number.isFinite(i.y) && i.y >= o.top - h && i.y <= o.bottom + h).sort(byPrio);
  const heads: { item: EdgeItem; ids: string[] }[] = [];
  for (const it of live) {
    const near = heads.find(g => Math.abs(g.item.y - it.y) <= mergePx);
    if (near) near.ids.push(it.id);
    else heads.push({ item: it, ids: [it.id] });
  }

  /* 2. capacity: the free lanes, and one label per rowPx of the pane */
  let free = bottom - top + step;
  for (const r of reserved) free -= Math.max(0, Math.min(r.hi, bottom + h / 2) - Math.max(r.lo, top - h / 2));
  const lanes = Math.max(0, Math.floor(free / step));
  const cap = Math.max(1, Math.min(lanes, Math.floor((o.bottom - o.top) / (o.rowPx ?? ROW_PX)) || 1));
  let kept = heads.slice(0, cap);

  /* a centre clear of every reserved band, nearest t in the asked direction */
  const clearOf = (t: number, down: boolean): number => {
    for (let k = 0; k < 4; k++) {
      const hit = reserved.find(r => t > r.lo && t < r.hi);
      if (!hit) return t;
      t = down ? hit.hi : hit.lo;
    }
    return t;
  };
  const place = (list: typeof kept): Placed[] | null => {
    const s = [...list].sort((a, b) => a.item.y - b.item.y);
    const ty = s.map(g => g.item.y);
    /* down: from the top, each at least a step under the one above */
    for (let i = 0; i < s.length; i++) {
      const floor = Math.max(top, i ? ty[i - 1] + step : -Infinity);
      let t = Math.max(ty[i], floor);
      const hit = reserved.find(r => t > r.lo && t < r.hi);
      /* a level over the band's upper half stands above it when there is room there, else below */
      if (hit) t = s[i].item.y < (hit.lo + hit.hi) / 2 && hit.lo >= floor ? hit.lo : clearOf(t, true);
      ty[i] = t;
    }
    /* up: from the floor, each at least a step over the one below */
    for (let i = s.length - 1; i >= 0; i--) {
      let t = Math.min(ty[i], bottom, i < s.length - 1 ? ty[i + 1] - step : Infinity);
      if (reserved.some(r => t > r.lo && t < r.hi)) t = clearOf(t, false);
      ty[i] = t;
    }
    for (let i = 0; i < s.length; i++) {
      if (ty[i] < top - 0.01 || ty[i] > bottom + 0.01) return null;
      if (i && ty[i] - ty[i - 1] < step - 0.01) return null;
      if (reserved.some(r => ty[i] > r.lo + 0.01 && ty[i] < r.hi - 0.01)) return null;
    }
    return s.map((g, i) => ({ id: g.item.id, y: g.item.y, ty: ty[i], ids: g.ids }));
  };

  /* 3. place; what cannot stand near its level, or at all, gives way — the least important first */
  for (let guard = 0; guard < 64; guard++) {
    const out = place(kept);
    if (out) {
      const far = out.filter(p => Math.abs(p.ty - p.y) > maxShift);
      if (!far.length) return out;
      /* drop the least important of the labels led too far (never one marked keep while another is droppable) */
      const farIds = new Set(far.map(p => p.id));
      const victim = [...kept].reverse().find(g => farIds.has(g.item.id) && !g.item.keep) ?? [...kept].reverse().find(g => !g.item.keep);
      if (!victim) return out;
      kept = kept.filter(g => g !== victim);
      continue;
    }
    if (kept.length <= 1) return [];
    kept = kept.slice(0, -1);
  }
  return [];
}

/** True when two placed labels of height h overlap — the proof's and the painters' check */
export const labelsOverlap = (a: Placed, b: Placed, h: number): boolean => Math.abs(a.ty - b.ty) < h - 0.01;
