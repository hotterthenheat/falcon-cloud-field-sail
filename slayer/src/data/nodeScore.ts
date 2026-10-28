/**
 * The scorecard.
 * A hold is ten minutes inside the wider of five cents and two basis points, not the next print.
 * Nearby strikes, one step off the nodes, are scored the same way.
 * Each morning, yesterday's closing flow inventory is set against the new open interest.
 */

export interface NodeScore {
  flowHeld: number;
  flowBroke: number;
  oiHeld: number;
  oiBroke: number;
  nearHeld: number;
  nearBroke: number;
  /** Share of near-dated volume with no side, 0–1. Null until a book with volume is in. */
  unsigned: number | null;
  /** |yesterday's flow − this morning's open interest| / this morning's open interest. */
  oiMiss: number | null;
  oiMissStrikes: number;
  oiMissBy: ExpiryMiss[] | null;
}

export interface CloseRow {
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  flow: number;
  oi: number;
}

export interface SideMiss {
  rate: number;
  strikes: number;
}

export interface ExpiryMiss {
  expiry: string;
  call: SideMiss | null;
  put: SideMiss | null;
}

export interface MorningMiss {
  rate: number;
  strikes: number;
  day: string;
  byExpiry: ExpiryMiss[];
}

const HOLD_MS = 10 * 60 * 1000;

/** The wider of five cents and two basis points. */
export function holdBand(spot: number): number {
  return Math.max(0.05, Math.abs(spot) * 0.0002);
}

interface Watch {
  strike: number;
  kind: 'flow' | 'oi' | 'near';
  start: number;
  left: boolean;
}

interface Memory {
  spot: number;
  watches: Watch[];
  score: NodeScore;
}

const books = new Map<string, Memory>();

function emptyScore(): NodeScore {
  return { flowHeld: 0, flowBroke: 0, oiHeld: 0, oiBroke: 0, nearHeld: 0, nearBroke: 0, unsigned: null, oiMiss: null, oiMissStrikes: 0, oiMissBy: null };
}

function controls(nodes: readonly number[], spot: number): number[] {
  const sorted = [...nodes].filter(k => k > 0).sort((a, b) => a - b);
  if (!sorted.length || !(spot > 0)) return [];
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) if (sorted[i] > sorted[i - 1]) gaps.push(sorted[i] - sorted[i - 1]);
  const step = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : Math.max(0.5, spot * 0.002);
  const used = new Set(sorted);
  const out: number[] = [];
  for (const k of sorted) {
    const up = Math.round((k + step) * 1000) / 1000;
    const dn = Math.round((k - step) * 1000) / 1000;
    const pick = !used.has(up) ? up : !used.has(dn) ? dn : 0;
    if (pick > 0 && Math.abs(pick - spot) / spot < 0.02) out.push(pick);
  }
  return out;
}

function finish(score: NodeScore, w: Watch) {
  const held = !w.left;
  if (w.kind === 'flow') held ? score.flowHeld++ : score.flowBroke++;
  else if (w.kind === 'oi') held ? score.oiHeld++ : score.oiBroke++;
  else held ? score.nearHeld++ : score.nearBroke++;
}

export function noteNodes(ticker: string, spot: number, flow: readonly number[], oi: readonly number[], unsigned: number | null, now = Date.now()): NodeScore {
  const key = ticker.trim().toUpperCase();
  const prev = books.get(key);
  const score: NodeScore = prev?.score ?? emptyScore();
  if (unsigned != null) score.unsigned = unsigned;
  const band = holdBand(spot);
  const watches = prev?.watches ?? [];
  const open: Watch[] = [];
  for (const w of watches) {
    if (spot > 0 && Math.abs(spot - w.strike) > band) w.left = true;
    if (now - w.start >= HOLD_MS) finish(score, w);
    else open.push(w);
  }
  const seen = new Set(open.map(w => `${w.kind}:${w.strike}`));
  const arm = (kind: Watch['kind'], strikes: readonly number[]) => {
    if (!(spot > 0)) return;
    for (const k of strikes) {
      const id = `${kind}:${k}`;
      if (seen.has(id) || Math.abs(spot - k) > band) continue;
      seen.add(id);
      open.push({ strike: k, kind, start: now, left: false });
    }
  };
  arm('flow', flow);
  arm('oi', oi);
  arm('near', controls([...flow, ...oi], spot));
  const next = { ...score };
  books.set(key, { spot, watches: open, score: next });
  return next;
}

export function nodeScore(ticker: string): NodeScore | null {
  return books.get(ticker.trim().toUpperCase())?.score ?? null;
}

/** Local peaks. Same-sign neighbours only. At least 20% of the strongest. An equal neighbour is a tie, and both stay. */
export function peakStrikes(rows: readonly { strike: number; value: number }[]): number[] {
  const sorted = rows.filter(r => r.value !== 0).slice().sort((a, b) => a.strike - b.strike);
  const max = sorted.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0);
  if (!(max > 0)) return [];
  const floor = max * 0.2;
  let step = Infinity;
  for (let k = 1; k < sorted.length; k++) {
    const d = sorted[k].strike - sorted[k - 1].strike;
    if (d > 0 && d < step) step = d;
  }
  if (!Number.isFinite(step)) step = 1;
  const out: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = Math.abs(sorted[i].value);
    if (a < floor) continue;
    const near = (o?: { strike: number; value: number }) => !!o && Math.abs(o.strike - sorted[i].strike) <= step * 1.01 && Math.sign(o.value) === Math.sign(sorted[i].value);
    const L = near(sorted[i - 1]) ? Math.abs(sorted[i - 1].value) : -Infinity;
    const R = near(sorted[i + 1]) ? Math.abs(sorted[i + 1].value) : -Infinity;
    if (a >= L && a >= R) out.push(sorted[i].strike);
  }
  return out;
}

export type NodeMark = 'born' | 'grew' | 'flipped' | 'died';

/** The mark on the latest bucket. Born and died wait for a second bucket. Grew is the first bucket that is 30% above three buckets ago. */
export function nodeMark(series: readonly { v: number; peak: boolean }[], floor: number): NodeMark | null {
  const i = series.length - 1;
  if (i < 1) return null;
  const cur = series[i];
  const p1 = series[i - 1];
  const p2 = i >= 2 ? series[i - 2] : undefined;
  const p3 = i >= 3 ? series[i - 3] : undefined;
  const p4 = i >= 4 ? series[i - 4] : undefined;
  const below = (v: number) => Math.abs(v) < floor;
  if (p1 && cur.v !== 0 && p1.v !== 0 && Math.sign(cur.v) !== Math.sign(p1.v) && Math.abs(cur.v) >= floor) return 'flipped';
  if (below(cur.v) && below(p1.v) && p2 && !below(p2.v)) return 'died';
  if (cur.peak && p1.peak && !(p2?.peak)) return 'born';
  const grew = !!p3 && Math.abs(p3.v) > 0 && Math.abs(cur.v) >= Math.abs(p3.v) * 1.3;
  const grewBefore = !!p4 && Math.abs(p4.v) > 0 && Math.abs(p1.v) >= Math.abs(p4.v) * 1.3;
  if (grew && !grewBefore) return 'grew';
  return null;
}

export type PriceTag = 'rejected' | 'absorbed' | 'broke';

/** What price did in the ten-minute window after it touched the strike. */
export function priceTag(strike: number, path: readonly number[]): PriceTag | null {
  if (path.length < 2 || !(strike > 0)) return null;
  const band = holdBand(strike);
  let touched = -1;
  for (let i = 0; i < path.length; i++) {
    if (Math.abs(path[i] - strike) <= band) {
      touched = i;
      break;
    }
  }
  if (touched < 0) return null;
  const before = path[Math.max(0, touched - 1)];
  const side = before - strike;
  const window = path.slice(touched);
  const last = window[window.length - 1];
  const past = Math.abs(last - strike) > band && (side === 0 || Math.sign(last - strike) !== Math.sign(side));
  if (past) return 'broke';
  if (window.every(p => Math.abs(p - strike) <= band)) return 'absorbed';
  return 'rejected';
}

/** |yesterday's closing flow − this morning's open interest| / this morning's open interest, also split by expiry and by side. */
export function morningMiss(prior: readonly CloseRow[], today: string, fresh: readonly CloseRow[]): MorningMiss | null {
  const oi = new Map<string, number>();
  for (const r of fresh) {
    if (r.expiry < today) continue;
    oi.set(`${r.expiry}|${r.strike}|${r.right}`, r.oi);
  }
  const buckets = new Map<string, { diff: number; base: number; n: number }>();
  const add = (key: string, flow: number, nextOi: number) => {
    const b = buckets.get(key) ?? { diff: 0, base: 0, n: 0 };
    b.diff += Math.abs(flow - nextOi);
    b.base += Math.max(Math.abs(nextOi), 1);
    b.n += 1;
    buckets.set(key, b);
  };
  const seen = new Set<string>();
  for (const r of prior) {
    if (r.expiry < today) continue;
    const k = `${r.expiry}|${r.strike}|${r.right}`;
    if (seen.has(k) || !oi.has(k)) continue;
    seen.add(k);
    const nextOi = oi.get(k) ?? 0;
    add(`${r.expiry}|${r.right}`, r.flow, nextOi);
    add('all', r.flow, nextOi);
  }
  const all = buckets.get('all');
  if (!all || !all.n || !(all.base > 0)) return null;
  const expiries = [...new Set([...buckets.keys()].filter(k => k !== 'all').map(k => k.split('|')[0]))].sort();
  const side = (expiry: string, right: 'C' | 'P'): SideMiss | null => {
    const b = buckets.get(`${expiry}|${right}`);
    if (!b || !b.n || !(b.base > 0)) return null;
    return { rate: b.diff / b.base, strikes: b.n };
  };
  return {
    rate: all.diff / all.base,
    strikes: all.n,
    day: today,
    byExpiry: expiries.map(expiry => ({ expiry, call: side(expiry, 'C'), put: side(expiry, 'P') })),
  };
}

interface SavedBook {
  day: string;
  rows: CloseRow[];
  priorRows?: CloseRow[];
}

interface Saved {
  books: Record<string, SavedBook>;
  scored: Record<string, MorningMiss>;
}

const KEY = 'slayer-flow-close-v1';
let memory: Saved = { books: {}, scored: {} };

function readStore(): Saved {
  try {
    if (typeof localStorage === 'undefined') return memory;
    const raw = localStorage.getItem(KEY);
    if (!raw) return memory;
    const parsed = JSON.parse(raw) as Saved;
    if (!parsed || typeof parsed !== 'object' || !parsed.books) return memory;
    memory = parsed;
    return memory;
  } catch {
    return memory;
  }
}

function writeStore(next: Saved) {
  memory = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* a full store keeps the in-memory copy */
  }
}

function mergeRows(base: readonly CloseRow[], next: readonly CloseRow[]): CloseRow[] {
  const by = new Map<string, CloseRow>();
  for (const r of base) by.set(`${r.expiry}|${r.strike}|${r.right}`, r);
  for (const r of next) by.set(`${r.expiry}|${r.strike}|${r.right}`, r);
  return [...by.values()];
}

/** Save today's flow inventory. Each new morning is scored against yesterday's close, and the rate updates as more expiries arrive. */
export function noteClose(ticker: string, day: string, rows: readonly CloseRow[]): MorningMiss | null {
  const key = ticker.trim().toUpperCase();
  const saved = readStore();
  const prev = saved.books[key];
  let priorRows = prev?.priorRows;
  let merged: CloseRow[];
  if (prev && prev.day < day) {
    priorRows = prev.rows;
    merged = rows.slice();
  } else if (prev && prev.day === day) {
    merged = mergeRows(prev.rows, rows);
  } else {
    merged = rows.slice();
  }
  if (priorRows) {
    const miss = morningMiss(priorRows, day, merged);
    if (miss) saved.scored[key] = miss;
  }
  saved.books[key] = { day, rows: merged, priorRows };
  writeStore(saved);
  const got = saved.scored[key];
  if (got && got.day === day) {
    const live = books.get(key);
    if (live) {
      live.score.oiMiss = got.rate;
      live.score.oiMissStrikes = got.strikes;
      live.score.oiMissBy = got.byExpiry;
    }
    return got;
  }
  return null;
}
