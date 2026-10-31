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

/* ---- thetaPerSession (core/greeks): the price change over one trading session, spot and vol held ---- */
{
  const { thetaPerSession, blackScholesPrice } = await import('../src/core/greeks');
  const { normCdf } = await import('../src/core/math');
  const pdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
  /* a year out it is the analytic θ per year ÷ 252 to first order: S 100, K 100, σ 20%, t 1, r 4.2%, q 1.3% */
  const rr = 0.042, qq = 0.013, T1 = 1;
  const d1 = (Math.log(S / K) + (rr - qq + (v * v) / 2) * T1) / (v * Math.sqrt(T1));
  const d2 = d1 - v * Math.sqrt(T1);
  const thetaYear = (-S * Math.exp(-qq * T1) * pdf(d1) * v) / (2 * Math.sqrt(T1)) - rr * K * Math.exp(-rr * T1) * normCdf(d2) + qq * S * Math.exp(-qq * T1) * normCdf(d1);
  const perSession = thetaPerSession(S, K, T1, v, 'C', rr, qq);
  if (rel(perSession, thetaYear / 252) > 0.005) throw new Error(`thetaPerSession a year out ${perSession} vs θ/252 ${thetaYear / 252}`);
  /* known number: 7 sessions out, ATM call, r 4.2%, q 0 — V(6/252) − V(7/252) */
  const seven = thetaPerSession(S, K, 7 / 252, v, 'C', 0.042, 0);
  const sevenHand = blackScholesPrice(S, K, 6 / 252, v, 'C', 0.042, 0) - blackScholesPrice(S, K, 7 / 252, v, 'C', 0.042, 0);
  if (Math.abs(seven - sevenHand) > 1e-12 || Math.abs(seven - -0.10696) > 5e-5) throw new Error(`thetaPerSession 7 sessions ${seven} vs ${sevenHand} (−0.10696)`);
  /* the last session: the whole extrinsic, not θ/252 (which would overstate it by √ of the clock) */
  const last = thetaPerSession(S, 102, 1 / 252, v, 'C', 0.042, 0);
  const lastPrice = blackScholesPrice(S, 102, 1 / 252, v, 'C', 0.042, 0);
  if (Math.abs(last + lastPrice) > 1e-12) throw new Error(`last-session theta ${last} vs −price ${-lastPrice}`);
  const itmPut = thetaPerSession(S, 103, 1 / 252, v, 'P', 0.042, 0);
  if (Math.abs(itmPut - (3 - blackScholesPrice(S, 103, 1 / 252, v, 'P', 0.042, 0))) > 1e-12) throw new Error(`ITM put last-session theta ${itmPut}`);
  console.log('thetaPerSession ok', { yearOut: perSession.toFixed(5), sevenSessions: seven.toFixed(4), lastSession: last.toFixed(4) });
}

console.log('higher greeks ok', {
  color: g.color.toExponential(3),
  vomma: g.vomma.toExponential(3),
  speed: g.speed.toExponential(3),
});
