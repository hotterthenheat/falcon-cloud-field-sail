/* Why a LightGBM tree ensemble scored a row as it did: the tree path attribution (Saabas). Along the path each tree
   takes for the row, every split moves the node's mean output (internal_value, weighted by the training rows that
   reached it) to the child's; that move is credited to the split's feature. Per tree the credits sum to the leaf
   minus the root, so over the ensemble: raw score = sum of roots + sum of credits, in log-odds. */

import { goLeft } from './lgbm';

export interface ExplainTree {
  s: number[];
  t: number[];
  d: number[];
  l: number[];
  r: number[];
  leaf: number[];
  node: number[];
}

const nums = (line: string) => line.slice(line.indexOf('=') + 1).trim().split(/\s+/).map(v => (v === 'inf' || v === '+inf' ? Infinity : v === '-inf' ? -Infinity : Number(v)));

/** The trees with each node's mean output. Null when the file is not numerical trees with internal values. */
export function parseExplainTrees(text: string): ExplainTree[] | null {
  const out: ExplainTree[] = [];
  for (const block of text.split(/\nTree=/).slice(1)) {
    const f: Record<string, number[]> = {};
    for (const line of block.split('\n')) {
      const k = line.slice(0, line.indexOf('='));
      if (['split_feature', 'threshold', 'decision_type', 'left_child', 'right_child', 'leaf_value', 'internal_value'].includes(k)) f[k] = nums(line);
    }
    if (!f.leaf_value || !f.internal_value || (f.split_feature?.length ?? 0) !== f.internal_value.length) return null;
    out.push({ s: f.split_feature, t: f.threshold, d: f.decision_type, l: f.left_child, r: f.right_child, leaf: f.leaf_value, node: f.internal_value });
  }
  return out.length ? out : null;
}

/** Per-feature credit (log-odds) for one row, and the base (the sum of the roots). raw = base + sum(credit). */
export function explain(trees: readonly ExplainTree[], x: readonly number[], width = 56): { base: number; credit: number[]; raw: number } {
  const credit = Array<number>(width).fill(0);
  let base = 0;
  let raw = 0;
  for (const tree of trees) {
    if (!tree.s.length) {
      base += tree.leaf[0] ?? 0;
      raw += tree.leaf[0] ?? 0;
      continue;
    }
    base += tree.node[0];
    let node = 0;
    for (let step = 0; step < tree.s.length + 2; step++) {
      const child = goLeft(tree.d[node], x[tree.s[node]], tree.t[node]) ? tree.l[node] : tree.r[node];
      const value = child < 0 ? tree.leaf[~child] : tree.node[child];
      credit[tree.s[node]] += value - tree.node[node];
      if (child < 0) {
        raw += value;
        break;
      }
      node = child;
    }
  }
  return { base, credit, raw };
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
