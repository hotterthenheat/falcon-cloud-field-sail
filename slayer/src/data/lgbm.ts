/* LightGBM text model. Binary sigmoid. The walk is NumericalDecision from LightGBM's tree.h, not "NaN always takes
   the default side." decision_type bits: bit 1 (value 2) is default-left. bits 2–3 are the missing type: 0 none, 1
   zero, 2 NaN. A NaN is coerced to 0 unless the missing type is NaN. */

export interface Tree {
  s: number[];
  t: number[];
  d: number[];
  l: number[];
  r: number[];
  v: number[];
}

const NONE = 0;
const ZERO = 1;
const NAN_MISSING = 2;
/* LightGBM's kZeroThreshold: anything this close to 0 counts as zero for the Zero missing type. */
const ZERO_EPS = 1e-35;

/* LightGBM writes infinite thresholds as "inf"/"-inf", which Number reads as NaN. */
function num(token: string): number {
  if (token === 'inf' || token === '+inf') return Infinity;
  if (token === '-inf') return -Infinity;
  return Number(token);
}

function nums(line: string): number[] {
  const cut = line.indexOf('=');
  if (cut < 0) return [];
  const body = line.slice(cut + 1).trim();
  if (!body) return [];
  return body.split(/\s+/).map(num);
}

/** Parse a LightGBM v4 text dump. Returns null if it is not 300 numerical trees. */
export function parseBoosters(text: string, trees: number): Tree[] | null {
  if (!text.startsWith('tree\n') && !text.startsWith('tree\r\n')) return null;
  const blocks = text.split(/\nTree=/).slice(1);
  if (blocks.length !== trees) return null;
  const out: Tree[] = [];
  for (const block of blocks) {
    const lines = block.split(/\n/);
    let leaves = 0;
    let split: number[] = [];
    let threshold: number[] = [];
    let decision: number[] = [];
    let left: number[] = [];
    let right: number[] = [];
    let value: number[] = [];
    let shrinkage = NaN;
    for (const line of lines) {
      if (line.startsWith('num_leaves=')) leaves = Number(line.slice(11));
      else if (line.startsWith('num_cat=')) {
        if (Number(line.slice(8)) !== 0) return null;
      } else if (line.startsWith('split_feature=')) split = nums(line);
      else if (line.startsWith('threshold=')) threshold = nums(line);
      else if (line.startsWith('decision_type=')) decision = nums(line);
      else if (line.startsWith('left_child=')) left = nums(line);
      else if (line.startsWith('right_child=')) right = nums(line);
      else if (line.startsWith('leaf_value=')) value = nums(line);
      else if (line.startsWith('shrinkage=')) shrinkage = Number(line.slice(10));
    }
    const nodes = leaves - 1;
    if (!(leaves > 1) || split.length !== nodes || threshold.length !== nodes || decision.length !== nodes || left.length !== nodes || right.length !== nodes || value.length !== leaves || !(shrinkage > 0)) return null;
    for (const d of decision) {
      if ((d & 1) !== 0) return null;
      const missing = (d >> 2) & 3;
      if (missing !== NONE && missing !== ZERO && missing !== NAN_MISSING) return null;
    }
    if (threshold.some(Number.isNaN) || value.some(Number.isNaN)) return null;
    out.push({ s: split, t: threshold, d: decision, l: left, r: right, v: value });
  }
  return out;
}

export function goLeft(decision: number, raw: number, threshold: number): boolean {
  const missingType = (decision >> 2) & 3;
  const defaultLeft = (decision & 2) !== 0;
  let val = raw;
  if ((val == null || Number.isNaN(val)) && missingType !== NAN_MISSING) val = 0;
  const stillMissing = val == null || Number.isNaN(val);
  if ((missingType === ZERO && Math.abs(val) <= ZERO_EPS) || (missingType === NAN_MISSING && stillMissing)) return defaultLeft;
  return val <= threshold;
}

/** One pass. The 56 inputs are already float32. NaN stays NaN. */
export function predict(trees: readonly Tree[], x: readonly number[]): number {
  let sum = 0;
  for (const tree of trees) {
    let node = 0;
    const guard = tree.s.length + 2;
    for (let step = 0; step < guard; step++) {
      const child = goLeft(tree.d[node], x[tree.s[node]], tree.t[node]) ? tree.l[node] : tree.r[node];
      if (child < 0) {
        /* The text dump stores leaf values with the learning rate already applied. */
        sum += tree.v[~child];
        break;
      }
      node = child;
    }
  }
  return 1 / (1 + Math.exp(-sum));
}

/** Each column's training range, from the dump's feature_infos ([lo:hi]; null for an unused column). */
export function trainingRanges(text: string): ([number, number] | null)[] {
  const line = /^feature_infos=(.*)$/m.exec(text)?.[1] ?? '';
  return line.trim().split(/\s+/).filter(Boolean).map(tok => {
    const m = /^\[([^:]+):([^\]]+)\]$/.exec(tok);
    if (!m) return null;
    const lo = num(m[1]);
    const hi = num(m[2]);
    return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] as [number, number] : null;
  });
}

/** The missing-value rules each column's splits carry (0 none, 1 zero, 2 NaN), over every tree. */
export function missingTypes(text: string): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const block of text.split(/\nTree=/).slice(1)) {
    const feats = nums(/^split_feature=.*$/m.exec(block)?.[0] ?? '');
    const kinds = nums(/^decision_type=.*$/m.exec(block)?.[0] ?? '');
    feats.forEach((f, i) => {
      const set = out.get(f) ?? new Set<number>();
      set.add((kinds[i] >> 2) & 3);
      out.set(f, set);
    });
  }
  return out;
}

/** The columns where a NaN is not a missing value to the model: some split on it has missing type none (training
    never had a NaN there, so LightGBM reads a NaN as 0) and 0 lies outside its training range. A row with a NaN in one
    of these walks a branch no training row took, so the model's answer on it is undefined. */
export function nanUnsafeColumns(text: string): number[] {
  const ranges = trainingRanges(text);
  const out: number[] = [];
  for (const [col, kinds] of missingTypes(text)) {
    const r = ranges[col];
    if (kinds.has(NONE) && r && !(r[0] <= 0 && 0 <= r[1])) out.push(col);
  }
  return out.sort((a, b) => a - b);
}

/** The first of `cols` that is NaN in the row, or -1. */
export function firstNaN(x: readonly number[], cols: readonly number[]): number {
  for (const c of cols) if (x[c] == null || Number.isNaN(x[c])) return c;
  return -1;
}
