import { higherGreeksExact, perDay, perVolPoint } from '../src/core/higherGreeks';
import { getCarry } from '../src/core/carry';

/* Finite difference of the raw partials, then the dollar scale the map prints.
   A miss here is a wrong greek, not a rounding preference. */

const { r, q } = getCarry();
const S = 100;
const K = 100;
const v = 0.2;
const t = 7 / 252;
const oi = 10;

function gamma(tt: number, vv = v, ss = S): number {
  const sq = Math.sqrt(tt);
  const dfQ = Math.exp(-q * tt);
  const d1 = (Math.log(ss / K) + (r - q + (v * v) / 2) * tt) / (v * sq);
  const phi = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
  return (dfQ * phi) / (ss * vv * sq);
}
function vegaRaw(tt: number, vv = v): number {
  const sq = Math.sqrt(tt);
  const dfQ = Math.exp(-q * tt);
  const d1 = (Math.log(S / K) + (r - q + (vv * vv) / 2) * tt) / (vv * sq);
  const phi = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
  return S * dfQ * sq * phi;
}

const g = higherGreeksExact(S, K, t, v, r, q);
if (!g) throw new Error('exact greek refused a valid contract');

const dt = 1 / 252 / 200;
const colorFd = (gamma(t - dt) - gamma(t)) / dt;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
if (rel(g.color, colorFd) > 0.02) throw new Error(`color ${g.color} vs ${colorFd}`);

const dv = 0.0001;
const vommaFd = (vegaRaw(t, v + dv) - vegaRaw(t, v - dv)) / (2 * dv);
if (rel(g.vomma, vommaFd) > 0.02) throw new Error(`vomma ${g.vomma} vs ${vommaFd}`);

const dS = 0.05;
const speedFd = (gamma(t, v, S + dS) - gamma(t, v, S - dS)) / (2 * dS);
if (rel(g.speed, speedFd) > 0.02) throw new Error(`speed ${g.speed} vs ${speedFd}`);

const step = 1 / 252 / 80;
const gexScale = S * S * 0.01;
const sign = -1;
const colorDollars = perDay(g.color) * oi * 100 * gexScale * sign;
const gex = (tt: number) => gamma(tt) * oi * 100 * gexScale * sign;
const colorDollarsFd = (gex(t - step) - gex(t)) / (step * 252);
if (rel(colorDollars, colorDollarsFd) > 0.02) throw new Error(`color dollars ${colorDollars} vs ${colorDollarsFd}`);

const vommaDollars = perVolPoint(g.vomma) * oi * sign;
const point = 0.01;
const vegaDollars = (vv: number) => vegaRaw(t, vv) * oi * sign;
const vommaDollarsFd = (vegaDollars(v + point) - vegaDollars(v - point)) / 2;
if (rel(vommaDollars, vommaDollarsFd) > 0.03) throw new Error(`vomma dollars ${vommaDollars} vs ${vommaDollarsFd}`);

if (higherGreeksExact(S, K, 0, v)) throw new Error('expired contract was priced');
if (higherGreeksExact(S, K, t, 0)) throw new Error('missing vol was priced');

console.log('higher greeks ok', {
  color: g.color.toExponential(3),
  vomma: g.vomma.toExponential(3),
  speed: g.speed.toExponential(3),
});
