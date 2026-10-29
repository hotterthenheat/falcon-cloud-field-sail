/*
  LightGBM text model. Binary sigmoid. The walk is NumericalDecision
  from LightGBM's tree.h, not "NaN always takes the default side."

  decision_type bits:
    bit 1 (value 2) is default-left.
    bits 2–3 are the missing type: 0 none, 1 zero, 2 NaN.
  A NaN is coerced to 0 unless the missing type is NaN. Only missing
  type NaN, or a real 0 when the missing type is Zero, takes the
  default side. Every other value, including a coerced 0, is
  compared with the threshold.
*/

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

/* LightGBM writes infinite thresholds as "inf"/"-inf", which Number() reads as NaN. */
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

function goLeft(decision: number, raw: number, threshold: number): boolean {
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
