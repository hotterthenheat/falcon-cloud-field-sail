/*
  FLIP VOL COVERAGE (audit 2026-11-06, finding 2). Live on 2026-11-06 only 12–24% of the book's legs carried a vol solved
  from their own quote, and the flip sat 0.09–0.34% of spot off an independent re-price at each contract's own live vol
  (SPX All at 10:30: 7577.13 against 7551.77). Two rules did it:
    - book/scale.ts quoteUsable aged a contract's NBBO by its last TRADE (last_tape_time): a two-sided quote on a strike
      that had not traded for 2 minutes (0DTE) or 15 (any other date) was thrown away and the vendor's calendar vol
      stood in. The vendor's NBBO is its live quote when it answered (UwContract.quoted_at), so that is its age now.
    - book/scale.ts ownIvDates re-priced only the front date and the dates holding 0.5% of the gross gamma at their own
      contracts' vols; every other date sat at its at-the-money vol, flat across strikes, its contracts never read.
  This proof builds a fixture chain (a name "SYNQ", 24 dates from 0DTE to 2027 on Fri 2026-11-06 10:30:07 ET, a skewed
  smile, every contract quoted two-sided at its Black-Scholes price at that smile, the vendor's vol a skewed stand-in, and
  most strikes last traded half an hour ago) and runs the page's own path on it — book/scale.ts expiryBookFromRows (the
  rows laid on, the contracts folded and painted), data/flipLevel.ts legsOfDate, core/gammaFlip.ts repricedFlip — under
  the old rules and the new, against an INDEPENDENT re-price written here (its own Black-Scholes, every leg at the vol
  solved here from its own mid, its own seconds-exact clock). Before: coverage well under full and the flip off by more
  than 0.05% of spot. After: every quoted leg on its own quote's vol and the flip within 0.05% of spot.
*/
import { expiryBookFromRows, bigIvDates, ownIvDates } from '../src/data/book/scale';
import { legsOfDate } from '../src/data/flipLevel';
import { netGammaAt, repricedFlip } from '../src/core/gammaFlip';
import { carryFor } from '../src/core/carry';
import { HOLIDAY_DATES, EARLY_CLOSE_DATES } from '../shared/marketCalendar.mjs';
import type { UwContract } from '../src/data/whales';
import type { StrikeNode } from '../src/types/market';

const T = 'SYNQ';
const S = 600;
const { r: R, q: Q } = carryFor(T);

/* ---- the independent clock and Black-Scholes ---- */
const HOL = new Set<string>(HOLIDAY_DATES as string[]);
const EARLY = new Set<string>(EARLY_CLOSE_DATES as string[]);
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const ny = (ms: number) => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60 + (ms % 1000) / 60_000 };
};
const isSession = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6 && !HOL.has(iso);
};
const closeOf = (iso: string) => (EARLY.has(iso) ? 780 : 960);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function tYears(ms: number, exp: string): number {
  const now = ny(ms);
  let total = 0;
  for (let d = now.iso; d <= exp; d = addDays(d, 1)) {
    if (!isSession(d)) continue;
    const to = closeOf(d);
    const from = d === now.iso ? Math.max(570, now.min) : 570;
    if (to > from) total += to - from;
  }
  return Math.max(5, total) / (390 * 252);
}
/** Φ to double precision (an in-the-money leg's vol hangs on its few cents of time value): erf's series inside |z| < 3,
    erfc's continued fraction outside */
function erfc(z: number): number {
  if (z < 0) return 2 - erfc(-z);
  if (z < 3) {
    let sum = 0;
    let term = z;
    for (let n = 0; n < 200; n++) {
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
      term *= (-z * z) / (n + 1);
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  /* Lentz's continued fraction: erfc(z) = e^(−z²)/√π · 1/(z + 1/2/(z + 1/(z + 3/2/(z + …)))) */
  let f = z;
  let c = z;
  let d = 0;
  for (let n = 1; n < 300; n++) {
    const an = n / 2;
    d = z + an * d;
    d = d === 0 ? 1e-300 : 1 / d;
    c = z + an / c;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-z * z) / Math.sqrt(Math.PI) / f;
}
const cdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);
function bs(right: 'C' | 'P', s: number, k: number, t: number, v: number): number {
  const d1 = (Math.log(s / k) + (R - Q + (v * v) / 2) * t) / (v * Math.sqrt(t));
  const d2 = d1 - v * Math.sqrt(t);
  return right === 'C' ? s * Math.exp(-Q * t) * cdf(d1) - k * Math.exp(-R * t) * cdf(d2) : k * Math.exp(-R * t) * cdf(-d2) - s * Math.exp(-Q * t) * cdf(-d1);
}
function solve(mid: number, right: 'C' | 'P', s: number, k: number, t: number): number | null {
  let lo = 1e-3;
  let hi = 5;
  if (!(mid > bs(right, s, k, t, lo)) || !(mid < bs(right, s, k, t, hi))) return null;
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (bs(right, s, k, t, m) < mid) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
/** $ gamma per 1% of one contract */
const gam = (s: number, k: number, t: number, v: number) => {
  const d1 = (Math.log(s / k) + (R - Q + (v * v) / 2) * t) / (v * Math.sqrt(t));
  return (Math.exp(-Q * t) * Math.exp((-d1 * d1) / 2)) / Math.sqrt(2 * Math.PI) / (s * v * Math.sqrt(t)) * s * s * 0.01 * 100;
};

/* ---- the fixture chain ---- */
const NOW = Date.parse('2026-11-06T15:30:07Z'); /* 10:30:07 ET */
const BIG = new Set(['2026-11-06', '2026-11-13', '2026-11-20', '2026-12-18', '2027-03-19']);
const DATES = ['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-31', '2027-01-15', '2027-01-29', '2027-02-19', '2027-03-19', '2027-04-16', '2027-06-17', '2027-09-17', '2027-12-17'];
const STRIKES = Array.from({ length: 49 }, (_, i) => 480 + i * 5);
/** The true smile on the trading clock: skewed, steeper near the date */
const smile = (k: number, t: number) => {
  const m = Math.log(k / S) / Math.sqrt(Math.max(t, 1 / 252));
  return Math.min(0.9, Math.max(0.06, 0.17 - 0.22 * m + 0.35 * m * m));
};
/* a deterministic scatter */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const occ = (exp: string, right: 'C' | 'P', k: number) => `${T}${exp.slice(2, 4)}${exp.slice(5, 7)}${exp.slice(8, 10)}${right}${String(Math.round(k * 1000)).padStart(8, '0')}`;
const tCal = (exp: string) => Math.max(5 * 60_000, Date.parse(`${exp}T21:00:00Z`) - NOW) / (365 * 86_400_000);

interface Fix {
  rows: Record<string, unknown>[];
  contracts: UwContract[];
  legs: { exp: string; k: number; right: 'C' | 'P'; oi: number; t: number; mid: number; quoted: boolean; pins: boolean; vendorTrading: number; g0: number }[];
  atmCal: number;
}
const fixture = new Map<string, Fix>();
const stamp = new Date(NOW - 7_000).toISOString(); /* the rows priced at 10:30:00 */
for (const exp of DATES) {
  const t = tYears(NOW, exp);
  const scale = BIG.has(exp) ? 1 : 0.06;
  const f: Fix = { rows: [], contracts: [], legs: [], atmCal: smile(S, t) * Math.sqrt(t / tCal(exp)) };
  for (const k of STRIKES) {
    const row: Record<string, unknown> = { expiry: exp, strike: String(k), price: String(S), time: stamp, call_gamma_oi: '0', put_gamma_oi: '0' };
    for (const right of ['C', 'P'] as const) {
      const v = smile(k, t);
      const oi = Math.round(scale * (right === 'P' ? (k < S ? 9000 : 1500) : k > S ? 8000 : 1200) * (0.4 + rnd()) * Math.exp(-(((k - S) / 60) ** 2)) + 50);
      const px = bs(right, S, k, t, v);
      const half = Math.max(0.005, px * 0.03);
      const bid = Math.max(0, px - half);
      const ask = px + half;
      /* a two-sided quote, its spread within 40% of the mid — the legs the flip must price at their own vol */
      const quoted = bid > 0 && (ask - bid) / ((bid + ask) / 2) <= 0.4;
      const g = oi * gam(S, k, t, v) * (right === 'C' ? 1 : -1);
      row[right === 'C' ? 'call_gamma_oi' : 'put_gamma_oi'] = String(g);
      /* the vendor's calendar vol: a stand-in off the quotes (what the page fell back to) — its smile as it stood when the
         price was 1.5% lower, so each strike's stand-in is the skew's slope × that move away from its own quote's vol */
      const vendorTrading = smile(k * 1.015, t);
      const vendor = vendorTrading * Math.sqrt(t / tCal(exp));
      const traded = rnd() < 0.3;
      f.contracts.push({
        option_symbol: occ(exp, right, k),
        open_interest: oi,
        volume: traded ? 10 : 0,
        implied_volatility: String(vendor),
        gamma: gam(S, k, t, vendorTrading) / (S * S * 0.01 * 100),
        nbbo_bid: bid.toFixed(4),
        nbbo_ask: ask.toFixed(4),
        /* most strikes last TRADED half an hour ago; their quote is this minute's */
        last_tape_time: new Date(traded ? NOW - 30_000 : NOW - 30 * 60_000).toISOString(),
        quoted_at: NOW - 3_000,
      });
      /* …and its quote pins a vol: a cent of time value at least (a deep in-the-money same-day leg's few hundredths of a
         cent move its vol by percents with the discounting of one second — and its gamma is nil) */
      const pins = quoted && (bid + ask) / 2 - Math.max(0, right === 'C' ? S - k : k - S) >= 0.01;
      f.legs.push({ exp, k, right, oi, t, mid: (bid + ask) / 2, quoted, pins, vendorTrading, g0: g });
    }
    f.rows.push(row);
  }
  fixture.set(exp, f);
}

/* ---- the independent re-price: every leg at the vol solved here from its own mid ---- */
/* a leg with a valid two-sided quote at the vol solved from its mid; one without (a far wing bid at 0) at the vendor's vol
   moved onto the trading clock, as the live check prices it */
const handLegs = [...fixture.values()].flatMap(f => f.legs.map(l => ({ ...l, iv: (l.quoted ? solve(l.mid, l.right, S, l.k, l.t) : null) ?? l.vendorTrading })));
/* sticky strike, as the live check re-prices: each leg's row gamma g0 (at the price the rows were marked at) moved to x at
   the leg's own vol, Γ·S² ∝ S·φ(d₁); a leg six deviations from its strike priced outright from its open interest */
const d1 = (s: number, k: number, t: number, v: number) => (Math.log(s / k) + (R - Q + (v * v) / 2) * t) / (v * Math.sqrt(t));
const legAt = (l: (typeof handLegs)[number], x: number) => {
  if (!(l.iv > 0)) return l.g0;
  const a = d1(S, l.k, l.t, l.iv);
  if (Math.abs(a) > 6) return (l.right === 'C' ? 1 : -1) * l.oi * gam(x, l.k, l.t, l.iv);
  const b = d1(x, l.k, l.t, l.iv);
  return l.g0 * (x / S) * Math.exp((a * a) / 2 - (b * b) / 2);
};
const handNet = (x: number) => handLegs.reduce((a, l) => a + legAt(l, x), 0);
function handFlip(): number | null {
  const lo = S * 0.9;
  const hi = S * 1.1;
  const N = 1200;
  let best: number | null = null;
  let px = lo;
  let py = handNet(px);
  for (let i = 1; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N;
    const y = handNet(x);
    if (py * y < 0) {
      let a = px;
      let b = x;
      let fa = py;
      for (let j = 0; j < 60; j++) {
        const m = (a + b) / 2;
        const fm = handNet(m);
        if (fm * fa > 0) {
          a = m;
          fa = fm;
        } else b = m;
      }
      const z = (a + b) / 2;
      if (best == null || Math.abs(z - S) < Math.abs(best - S)) best = z;
    }
    px = x;
    py = y;
  }
  return best;
}
const hand = handFlip();
if (hand == null) throw new Error('flip-coverage proof: the fixture has no flip by hand');

/* ---- the page's path, old rules and new ---- */
function pageRun(mode: 'before' | 'after') {
  const byDate: Record<string, StrikeNode[]> = {};
  const front = DATES[0];
  /* the old rule read only the big dates' contracts; their rows had no answer stamp, so the last trade aged the quote */
  const chainsOnly: Record<string, StrikeNode[]> = {};
  for (const exp of DATES) chainsOnly[exp] = expiryBookFromRows(fixture.get(exp)!.rows, [], S, exp, T);
  const read = mode === 'after' ? ownIvDates(chainsOnly, DATES, front) : new Set(bigIvDates(chainsOnly, DATES, front));
  for (const exp of DATES) {
    const f = fixture.get(exp)!;
    const contracts = !read.has(exp) ? [] : mode === 'after' ? f.contracts : f.contracts.map(c => ({ ...c, quoted_at: undefined }));
    byDate[exp] = expiryBookFromRows(f.rows, contracts, S, exp, T);
  }
  const legs = DATES.flatMap(exp => legsOfDate(byDate[exp], exp, fixture.get(exp)!.atmCal, NOW - 7_000, read.has(exp), S, true, S));
  const flip = repricedFlip(legs, S, R, undefined, Q).flip;
  if (process.env.FLIP_COVERAGE_DEBUG && mode === 'after') {
    {
      for (const exp of DATES) {
        const ls = legsOfDate(byDate[exp], exp, fixture.get(exp)!.atmCal, NOW - 7_000, true, S, true, S);
        const at = (x: number) => [-netGammaAt(ls, S, x, R, Q), handLegs.filter(l => l.exp === exp).reduce((a, l) => a + legAt(l, x), 0)];
        const [p1, h1] = at(hand!);
        const [p0, h0] = at(S);
        console.log(`  ${exp} at the hand flip page ${p1.toFixed(0)} hand ${h1.toFixed(0)} | at spot ${p0.toFixed(0)} ${h0.toFixed(0)}`);
      }
    }
  }
  /* coverage: the quoted legs the page prices at their own quote's vol (within 1% of the vol solved here) */
  let quoted = 0;
  let onQuote = 0;
  for (const l of handLegs) {
    if (!l.pins || !(l.iv > 0)) continue;
    quoted++;
    const n = byDate[l.exp].find(x => x.strike === l.k);
    const iv = read.has(l.exp) ? (l.right === 'C' ? n?.callIv : n?.putIv) ?? 0 : 0;
    if (iv > 0 && Math.abs(iv / l.iv - 1) <= 0.01) onQuote++;
    else if (mode === 'after' && process.env.FLIP_COVERAGE_DEBUG) console.log(`  off its quote: ${l.exp} ${l.k}${l.right} page ${iv} solved ${l.iv}`);
  }
  return { flip, quoted, onQuote, legs: handLegs.length };
}
const before = pageRun('before');
const after = pageRun('after');
const off = (f: number | null) => (f == null ? Infinity : (Math.abs(f - hand!) / S) * 100);
console.log(`hand flip (every leg at its own quote's vol, solved here): ${hand.toFixed(3)}`);
console.log(`before: coverage ${before.onQuote} of ${before.quoted} quoted legs (${((before.onQuote / before.quoted) * 100).toFixed(1)}%), flip ${before.flip?.toFixed(3)} — ${off(before.flip).toFixed(3)}% of spot off`);
console.log(`after:  coverage ${after.onQuote} of ${after.quoted} quoted legs (${((after.onQuote / after.quoted) * 100).toFixed(1)}%), flip ${after.flip?.toFixed(3)} — ${off(after.flip).toFixed(3)}% of spot off`);
const fails: string[] = [];
if (!(before.onQuote / before.quoted < 0.5)) fails.push(`the old rules covered ${before.onQuote} of ${before.quoted}: the fixture does not show the bug`);
if (!(off(before.flip) > 0.05)) fails.push(`the old rules' flip is within 0.05% (${off(before.flip).toFixed(3)}%): the fixture does not show the bug`);
if (after.onQuote !== after.quoted) fails.push(`after: ${after.quoted - after.onQuote} quoted legs not on their own quote's vol`);
if (!(off(after.flip) <= 0.05)) fails.push(`after: the flip ${after.flip} is ${off(after.flip).toFixed(3)}% of spot off the independent re-price ${hand.toFixed(3)} (want ≤ 0.05%)`);
if (fails.length) {
  for (const f of fails) console.log(`FAIL ${f}`);
  process.exit(1);
}
console.log('flip coverage proof ok: at full quote coverage the flip is within 0.05% of spot of the independent re-price');
