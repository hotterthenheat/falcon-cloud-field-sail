/* The standard normal for the two-book engine (TWO_BOOK_SPEC_V2 §1.3): N(x) = ½·erfc(−x/√2) with W. J. Cody's rational
   Chebyshev erfc (Math. Comp. 23, 1969; netlib specfun CALERF), full double precision in both tails. Never
   ½·(1 + erf(x/√2)): it returns 0 in the lower tail. Pure. */

const A = [3.1611237438705655, 113.86415415105016, 377.485237685302, 3209.3775891384694, 0.18577770618460315];
const B = [23.601290952344122, 244.02463793444417, 1282.6165260773723, 2844.2368334391704];
const C = [
  0.5641884969886701, 8.883149794388377, 66.11919063714163, 298.6351381974001, 881.952221241769, 1712.0476126340707, 2051.0783778260716, 1230.3393547979972,
  2.1531153547440383e-08,
];
const D = [15.744926110709835, 117.6939508913125, 537.1811018620099, 1621.3895745666903, 3290.7992357334597, 4362.619090143247, 3439.3676741437216, 1230.3393548037495];
const P = [0.30532663496123236, 0.36034489994980445, 0.12578172611122926, 0.016083785148742275, 0.0006587491615298378, 0.016315387137302097];
const Q = [2.568520192289822, 1.8729528499234604, 0.5279051029514285, 0.06051834131244132, 0.0023352049762686918];
const SQRPI = 0.5641895835477563; // 1/√π
const THRESH = 0.46875;
const XSMALL = 1.11e-16;
const XBIG = 26.543;

/** e^{−y²} for y > 0 without losing the low bits: y² is split at 1/16 (Cody) */
function expNegSq(y: number): number {
  const ysq = Math.trunc(y * 16) / 16;
  const del = (y - ysq) * (y + ysq);
  return Math.exp(-ysq * ysq) * Math.exp(-del);
}

/** erfc(x), relative error below 1e-15 across the line (0 past x = 26.543, where it underflows) */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  let result: number;
  if (y <= THRESH) {
    const ysq = y > XSMALL ? y * y : 0;
    let xnum = A[4] * ysq;
    let xden = ysq;
    for (let i = 0; i < 3; i++) {
      xnum = (xnum + A[i]) * ysq;
      xden = (xden + B[i]) * ysq;
    }
    return 1 - (x * (xnum + A[3])) / (xden + B[3]);
  }
  if (y <= 4) {
    let xnum = C[8] * y;
    let xden = y;
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + C[i]) * y;
      xden = (xden + D[i]) * y;
    }
    result = expNegSq(y) * ((xnum + C[7]) / (xden + D[7]));
  } else if (y >= XBIG) {
    result = 0;
  } else {
    const ysq = 1 / (y * y);
    let xnum = P[5] * ysq;
    let xden = ysq;
    for (let i = 0; i < 4; i++) {
      xnum = (xnum + P[i]) * ysq;
      xden = (xden + Q[i]) * ysq;
    }
    const r = (ysq * (xnum + P[4])) / (xden + Q[4]);
    result = expNegSq(y) * ((SQRPI - r) / y);
  }
  return x < 0 ? 2 - result : result;
}

/** N(x) = ½·erfc(−x/√2) */
export const normCdf = (x: number): number => 0.5 * erfc(-x / Math.SQRT2);

const INV_SQRT_2PI = 0.3989422804014327;
/** φ(x) */
export const normPdf = (x: number): number => INV_SQRT_2PI * Math.exp(-0.5 * x * x);
