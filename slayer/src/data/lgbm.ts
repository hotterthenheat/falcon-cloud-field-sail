/*
  LightGBM text model, binary sigmoid. Missing values follow the tree's
  default side. A missing feature stays NaN. It is never written as 0.
*/

export interface Tree {
  s: number[];
  t: number[];
  d: number[];
  l: number[];
  r: number[];
  v: number[];
  h: number;
}

export function predict(trees: readonly Tree[], x: readonly number[]): number {
  let sum = 0;
  for (const tree of trees) {
    let node = 0;
    for (let guard = 0; guard < 64; guard++) {
      const val = x[tree.s[node]];
      const missing = val == null || Number.isNaN(val);
      const goLeft = missing ? (tree.d[node] & 2) !== 0 : val <= tree.t[node];
      const child = goLeft ? tree.l[node] : tree.r[node];
      if (child < 0) {
        sum += tree.v[~child] * tree.h;
        break;
      }
      node = child;
    }
  }
  return 1 / (1 + Math.exp(-sum));
}
