/*
  PINPOINT'S CONTRACT GREEKS AGAINST AN INDEPENDENT RE-PRICING (audit 2026-11-06, items 1–4).
  Every figure Pinpoint prints off a contract — colour, zomma, speed, vomma, veta (data/liveHigher.ts contractHigher), and
  vanna, charm and dollar vega (data/book/scale.ts paintLegs, core/greeks.ts) — is recomputed here from nothing but a
  Black-Scholes price written in this file (its own normal CDF; no app code), by finite differences:
    Δ = ∂V/∂S and vega = ∂V/∂σ off the price; Γ = ∂Δ/∂S; then
    colour = ∂Γ/∂t, zomma = ∂Γ/∂σ, speed = ∂Γ/∂S, vomma = ∂vega/∂σ, veta = ∂vega/∂t, vanna = ∂Δ/∂σ, charm = ∂Δ/∂t,
  every clock partial "per passage of time" (t = time left shrinks), on the TRADING year the book prices on, with the
  dividend yield in the carry. Then the dollars, written out from the labels the pages print (exposureView.ts,
  exposureSurface.ts GREEK_UNIT, compare.ts GREEK_EXPLAIN) — one long contract × 100 × count, dealer side +1 calls, −1 puts:
    colour  $GEX per session      ∂Γ/∂t ÷ 252                  × S²·1%
    speed   $GEX per 1% move      ∂Γ/∂S × 1%·S                 × S²·1%   (S² held at today's price: see compare.ts)
    zomma   $GEX per vol point    ∂Γ/∂σ × 1% × volPt           × S²·1%
    vomma   $vega per vol point²  ∂vega/∂σ × 1% × 1% × volPt²
    veta    $vega per session     ∂vega/∂t ÷ 252 × 1% × volPt
    vanna   $Δ per vol point      ∂Δ/∂σ × 1% × S × volPt
    charm   $Δ per session        ∂Δ/∂t ÷ 252 × S
    vega    $ per vol point       ∂V/∂σ × 1% × volPt
  volPt is ∂σ_trading/∂σ_quoted = √(T_cal/T_trade): the vol a trader reads is the vendor's calendar vol.
  The grid runs S 100 and 7,335, strikes 0.9–1.1 of spot, 30 minutes to 60 sessions left (0DTE in its last half hour),
  vols 12%–120%, calls and puts, a yield of 0 and 1.3%.

  Then the book's own path (scale.ts expiryBookFromRows): vendor rows that carry no delta or charm, contracts laid on,
  and the node's vanna, charm and vega against the same hand figures on that date's own clock; and a spot-exposure row
  whose vanna_oi is absurd (×1,000) leaves every vanna on the node unchanged — the vendor's vanna unit is never read.

  Run: npx tsx scripts/greeks-fd-proof.ts
*/
import { contractHigher } from '../src/data/liveHigher';
import { blackScholesGreeks } from '../src/core/greeks';
import { dealerOf } from '../src/core/dealerSign';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/* ---- an independent Black-Scholes price ---- */
function erf(z: number): number {
  const a = Math.abs(z);
  let e: number;
  if (a < 3) {
    let term = a;
    let sum = a;
    for (let i = 1; i < 300; i++) {
      term *= (-a * a) / i;
      const add = term / (2 * i + 1);
      sum += add;
      if (Math.abs(add) < 1e-18) break;
    }
    e = (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    let cf = 0;
    for (let i = 80; i >= 1; i--) cf = i / 2 / (a + cf);
    e = 1 - Math.exp(-a * a) / Math.sqrt(Math.PI) / (a + cf);
  }
  return z < 0 ? -e : e;
}
const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const pdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
function price(right: 'C' | 'P', S: number, K: number, t: number, v: number, r: number, q: number): number {
  const d1 = (Math.log(S / K) + (r - q + 0.5 * v * v) * t) / (v * Math.sqrt(t));
  const d2 = d1 - v * Math.sqrt(t);
  return right === 'C' ? S * Math.exp(-q * t) * N(d1) - K * Math.exp(-r * t) * N(d2) : K * Math.exp(-r * t) * N(-d2) - S * Math.exp(-q * t) * N(-d1);
}
/* the first order by central differences of the price; the higher orders by central differences of those */
type P = { S: number; K: number; t: number; v: number; r: number; q: number; right: 'C' | 'P' };
const at = (p: P, d: Partial<P>): P => ({ ...p, ...d });
const delta = (p: P) => {
  const h = p.S * 1e-4;
  return (price(p.right, p.S + h, p.K, p.t, p.v, p.r, p.q) - price(p.right, p.S - h, p.K, p.t, p.v, p.r, p.q)) / (2 * h);
};
const vegaRaw = (p: P) => {
  const h = 1e-4;
  return (price(p.right, p.S, p.K, p.t, p.v + h, p.r, p.q) - price(p.right, p.S, p.K, p.t, p.v - h, p.r, p.q)) / (2 * h);
};
/* Γ off Δ: a second central difference of the price is too noisy for the third orders, so Γ is the textbook
   e^(−qt)·φ(d₁)/(Sσ√t), itself checked against ∂Δ/∂S below */
const gammaCf = (p: P) => {
  const d1 = (Math.log(p.S / p.K) + (p.r - p.q + 0.5 * p.v * p.v) * p.t) / (p.v * Math.sqrt(p.t));
  return (Math.exp(-p.q * p.t) * pdf(d1)) / (p.S * p.v * Math.sqrt(p.t));
};
const vegaCf = (p: P) => {
  const d1 = (Math.log(p.S / p.K) + (p.r - p.q + 0.5 * p.v * p.v) * p.t) / (p.v * Math.sqrt(p.t));
  return p.S * Math.exp(-p.q * p.t) * pdf(d1) * Math.sqrt(p.t);
};
const deltaCf = (p: P) => {
  const d1 = (Math.log(p.S / p.K) + (p.r - p.q + 0.5 * p.v * p.v) * p.t) / (p.v * Math.sqrt(p.t));
  return p.right === 'C' ? Math.exp(-p.q * p.t) * N(d1) : -Math.exp(-p.q * p.t) * N(-d1);
};
const dS = (f: (p: P) => number, p: P) => (f(at(p, { S: p.S * (1 + 1e-5) })) - f(at(p, { S: p.S * (1 - 1e-5) }))) / (2e-5 * p.S);
const dV = (f: (p: P) => number, p: P) => (f(at(p, { v: p.v + 1e-5 })) - f(at(p, { v: p.v - 1e-5 }))) / 2e-5;
/* per passage of time: t shrinks */
const dT = (f: (p: P) => number, p: P) => {
  const h = p.t * 1e-5;
  return (f(at(p, { t: p.t - h })) - f(at(p, { t: p.t + h }))) / (2 * h);
};

/* the textbook closed forms are the finite differences of the price (the base of everything below) */
const rel = (a: number, b: number, floor: number) => {
  const d = Math.abs(a - b);
  return d === 0 ? 0 : d / Math.max(Math.abs(b), floor, 1e-300);
};
{
  let worst = 0;
  for (const S of [100, 7335])
    for (const m of [0.9, 1, 1.1])
      for (const t of [30 / (390 * 252), 1 / 252, 20 / 252])
        for (const v of [0.15, 0.6])
          for (const right of ['C', 'P'] as const) {
            const p: P = { S, K: S * m, t, v, r: 0.042, q: 0.013, right };
            if (gammaCf(p) * S < 1e-6) continue;
            worst = Math.max(worst, rel(deltaCf(p), delta(p), 1e-3), rel(gammaCf(p), dS(deltaCf, p), 1e-9 / S), rel(vegaCf(p), vegaRaw(p), 1e-3 * S));
          }
  check(`the closed Δ, Γ and vega are ∂V/∂S, ∂Δ/∂S and ∂V/∂σ of the price (worst ${worst.toExponential(1)})`, worst < 2e-5);
}

/* ---- the grid against the app ---- */
const COUNT = 1234;
let n = 0;
const worst: Record<string, { err: number; at: string }> = {};
const note = (k: string, got: number, want: number, floor: number, where: string) => {
  const e = rel(got, want, floor);
  if (!worst[k] || e > worst[k].err) worst[k] = { err: e, at: `${where} got ${got.toPrecision(6)} want ${want.toPrecision(6)}` };
};
const signFlip: string[] = [];
for (const q of [0, 0.013]) {
  for (const S of [100, 7335])
    for (const m of [0.9, 0.97, 1, 1.03, 1.1])
      for (const t of [30 / (390 * 252), 1 / 252, 5 / 252, 60 / 252])
        for (const v of [0.12, 0.35, 1.2])
          for (const right of ['C', 'P'] as const)
            for (const volPt of [1, 1.31]) {
              const r = 0.042;
              const p: P = { S, K: Math.round(S * m * 100) / 100, t, v, r, q, right };
              const side = right === 'C' ? 1 : -1;
              const gex = S * S * 0.01;
              const want = {
                color: side * COUNT * 100 * (dT(gammaCf, p) / 252) * gex,
                speed: side * COUNT * 100 * dS(gammaCf, p) * 0.01 * S * gex,
                zomma: side * COUNT * 100 * dV(gammaCf, p) * 0.01 * volPt * gex,
                vomma: side * COUNT * 100 * dV(vegaCf, p) * 0.01 * 0.01 * volPt * volPt,
                veta: side * COUNT * 100 * (dT(vegaCf, p) / 252) * 0.01 * volPt,
              };
              /* the name's carry, as the book passes it (carryFor: the rate and yield its vols were solved at) */
              const got = contractHigher(S, p.K, t, v, COUNT, right, volPt, r, q);
              if (!got) {
                signFlip.push(`refused ${S} ${p.K} ${t} ${v}`);
                continue;
              }
              /* a figure is only as exact as its scale: the floor is 1e-6 of the most $GEX (or $vega) the leg reaches at
                 its strike — a far wing's 1e-35 is not compared digit by digit */
              const g$ = COUNT * 100 * (Math.exp(-q * t) / Math.sqrt(2 * Math.PI) / (S * v * Math.sqrt(t))) * gex;
              const v$ = COUNT * 100 * (S * Math.exp(-q * t) * Math.sqrt(t) / Math.sqrt(2 * Math.PI)) * 0.01;
              const where = `S ${S} K ${p.K} t ${(t * 252).toFixed(3)}s σ ${v} ${right} q ${q} volPt ${volPt}`;
              for (const k of ['color', 'speed', 'zomma'] as const) note(k, dealerOf(got[k]), want[k], 1e-6 * g$, where);
              for (const k of ['vomma', 'veta'] as const) note(k, dealerOf(got[k]), want[k], 1e-6 * v$, where);
              for (const k of Object.keys(want) as (keyof typeof want)[]) {
                const a = dealerOf(got[k]);
                if (Math.abs(want[k]) > 1e-3 * (k === 'vomma' || k === 'veta' ? v$ : g$) && Math.sign(a) !== Math.sign(want[k])) signFlip.push(`${k} ${where}`);
              }
              /* vanna, charm and vega as paintLegs states them off core/greeks.ts */
              const bs = blackScholesGreeks(S, p.K, t, v, r, q);
              const d$ = COUNT * 100 * S;
              note('vanna', side * COUNT * bs.vanna * S * volPt, side * COUNT * 100 * dV(deltaCf, p) * 0.01 * S * volPt, 1e-6 * d$ * 0.01, where);
              note('charm', side * COUNT * ((right === 'C' ? bs.charmCall : bs.charmPut) / 252) * 100 * S, side * COUNT * 100 * S * (dT(deltaCf, p) / 252), 1e-6 * d$ / 252, where);
              note('vega', side * COUNT * bs.vega * 100 * volPt, side * COUNT * 100 * vegaRaw(p) * 0.01 * volPt, 1e-6 * v$, where);
              n++;
            }
}
console.log(`     ${n} legs`);
for (const [k, w] of Object.entries(worst)) check(`${k.padEnd(6)} matches its independent re-pricing on every leg (worst ${w.err.toExponential(1)}: ${w.at})`, w.err < 2e-4);
check(`no sign differs from the re-pricing on any leg${signFlip.length ? `: ${signFlip.slice(0, 3).join('; ')}` : ''}`, signFlip.length === 0);

/* ---- the book's path: rows without delta and charm, contracts laid on ---- */
{
  const { expiryBookFromRows } = await import('../src/data/book/scale');
  const { tradingYears } = await import('../src/core/tradingYear');
  const { quotedVolPoint } = await import('../src/core/volClock');
  const { nyInstant } = await import('../src/core/session');
  const expiry = '2026-11-13';
  const S = 680;
  for (const [label, when] of [['five sessions out, Fri 2026-11-06 11:00', nyInstant('2026-11-06', 11 * 60)], ['0DTE, 2026-11-13 15:30 — half an hour left', nyInstant('2026-11-13', 15 * 60 + 30)]] as const) {
    const time = new Date(when).toISOString();
    const strikes = [650, 670, 680, 690, 710];
    const iv = (k: number) => 0.18 + 0.4 * Math.abs(Math.log(k / S));
    const t = tradingYears(expiry, when);
    const tSafe = t;
    /* the vendor's vol is a calendar-year vol: the same variance as the trading-clock vol the mids are priced at */
    const { calendarYears } = await import('../src/core/volClock');
    const toCal = Math.sqrt(t / calendarYears(expiry, when));
    const contracts = strikes.flatMap(k =>
      (['C', 'P'] as const).map(right => {
        const v = iv(k);
        const mid = price(right, S, k, tSafe, v, 0.042, 0);
        return { option_symbol: `SPY261113${right}${String(k * 1000).padStart(8, '0')}`, open_interest: 500 + k, volume: 0, implied_volatility: String(v * toCal), nbbo_bid: String(mid * 0.99), nbbo_ask: String(mid * 1.01), last_tape_time: time, gamma: 0.01, vega: 0.1 };
      }),
    );
    /* gamma rows as the vendor prints them, with an absurd vanna_oi and no delta or charm columns */
    const rows = strikes.map(k => ({ strike: String(k), expiry, time, price: String(S), call_gamma_oi: '1000', put_gamma_oi: '-1000', call_vanna_oi: '9e15', put_vanna_oi: '-9e15' }));
    const book = expiryBookFromRows(rows, contracts as never, S, expiry);
    const volPt = quotedVolPoint(expiry, when);
    let w = 0;
    let what = '';
    for (const k of strikes) {
      const node = book.find(x => x.strike === k)!;
      for (const right of ['C', 'P'] as const) {
        const v = right === 'C' ? node.callIv! : node.putIv!;
        const p: P = { S, K: k, t, v, r: 0.042, q: 0, right };
        const side = right === 'C' ? 1 : -1;
        const oi = 500 + k;
        const want = { vanna: side * oi * 100 * dV(deltaCf, p) * 0.01 * S * volPt, charm: side * oi * 100 * S * (dT(deltaCf, p) / 252), vega: side * oi * 100 * vegaRaw(p) * 0.01 * volPt };
        const got = { vanna: dealerOf(right === 'C' ? node.callVanna : node.putVanna), charm: dealerOf(right === 'C' ? node.callCharm : node.putCharm), vega: dealerOf(right === 'C' ? node.callVex : node.putVex) };
        for (const g of ['vanna', 'charm', 'vega'] as const) {
          const floor = g === 'charm' ? 1e-6 * oi * 100 * S / 252 : 1e-6 * oi * 100 * S * 0.01;
          const e = rel(got[g], want[g], floor);
          if (e > w) {
            w = e;
            what = `${k}${right} ${g} ${got[g].toPrecision(6)} vs ${want[g].toPrecision(6)}`;
          }
        }
        /* the vols the contracts were quoted at come back (the mids were priced at them on the book's own clock) */
        if (Math.abs(v - iv(k)) > 2e-3) {
          w = Infinity;
          what = `${k}${right} vol ${v} vs ${iv(k)}`;
        }
      }
    }
    check(`${label}: the book's vanna, charm and vega per contract = the re-pricing × OI on the date's clock (worst ${w.toExponential(1)}${what ? `: ${what}` : ''})`, w < 2e-4);
    const vannaNet = book.reduce((a, x) => a + Math.abs(x.callVanna) + Math.abs(x.putVanna), 0);
    check(`${label}: a vanna_oi of 9e15 on every row moves no vanna (the book's gross ${(vannaNet / 1e6).toFixed(2)}M is the contracts')`, vannaNet < 1e12 && vannaNet > 0);
  }
}

if (fail) {
  console.log(`\n${fail} FAILED`);
  process.exit(1);
}
console.log('\ngreeks-fd proof: all checks pass');
