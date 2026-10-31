/*
  The hand checks behind pinpoint-golden.ts: every figure here is computed straight from the recorded vendor rows with
  its own arithmetic (no app code), so the golden values are checked against the raw answers, not against themselves.
*/
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

type Row = Record<string, string | number | null>;
const DIR = (set: string) => join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'golden', set);

/** Every recorded answer of a set, by request path */
export function rawAnswers(set: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const f of readdirSync(DIR(set))) {
    if (!f.endsWith('.json.gz')) continue;
    const saved = JSON.parse(gunzipSync(readFileSync(join(DIR(set), f))).toString('utf8')) as { path: string; body: string };
    const body = JSON.parse(saved.body) as unknown;
    out.set(saved.path, body && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? (body as { data: unknown }).data : body);
  }
  return out;
}

const n = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '')) || 0);

/** The vendor's per-strike, per-expiry open-interest gamma rows (spot-exposures/expiry-strike, every page) */
export function exposureRows(raw: Map<string, unknown>, t: string): Row[] {
  const rows: Row[] = [];
  for (const [p, d] of raw) if (p.startsWith(`/stock/${t}/spot-exposures/expiry-strike?limit=500&page=`)) rows.push(...(d as Row[]));
  return rows;
}

/** Net, call and put gamma per strike over the given expiries, the vendor's sign (calls +, puts −), $ per 1% */
export function byStrike(rows: readonly Row[], dates: ReadonlySet<string>): Map<number, { c: number; p: number }> {
  const m = new Map<number, { c: number; p: number }>();
  for (const r of rows) {
    if (!dates.has(String(r.expiry))) continue;
    const k = n(r.strike);
    const cur = m.get(k) ?? { c: 0, p: 0 };
    cur.c += n(r.call_gamma_oi);
    cur.p += n(r.put_gamma_oi);
    m.set(k, cur);
  }
  return m;
}

export function levelsOfRows(m: Map<number, { c: number; p: number }>): { net: number; callWall: number; putWall: number; supreme: number } {
  let net = 0;
  let cw = [0, 0];
  let pw = [0, 0];
  let sup = [0, 0];
  for (const [k, v] of m) {
    net += v.c + v.p;
    if (Math.abs(v.c) > cw[1]) cw = [k, Math.abs(v.c)];
    if (Math.abs(v.p) > pw[1]) pw = [k, Math.abs(v.p)];
    if (Math.abs(v.c + v.p) > sup[1]) sup = [k, Math.abs(v.c + v.p)];
  }
  return { net, callWall: cw[0], putWall: pw[0], supreme: sup[0] };
}

/* Market holidays through the fixtures' longest expiry (NYSE), for counting sessions */
const HOLIDAYS = new Set([
  '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05',
  '2027-09-06', '2027-11-25', '2027-12-24', '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19', '2028-07-04',
  '2028-09-04', '2028-11-23', '2028-12-25', '2029-01-01', '2029-01-15',
]);
/** Years on the 252-session clock from a row dated `rowDate` (priced after its close) to the expiry's close */
export function yearsTrading(rowDate: string, expiry: string): number {
  let sessions = 0;
  for (let t = Date.parse(`${rowDate}T00:00:00Z`) + 86_400_000; t <= Date.parse(`${expiry}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !HOLIDAYS.has(iso)) sessions++;
  }
  return sessions / 252;
}

const cdf = (x: number) => phiCdf(x);
function bsCall(S: number, K: number, t: number, v: number, r: number): number {
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * t) / (v * Math.sqrt(t));
  return S * cdf(d1) - K * Math.exp(-r * t) * cdf(d1 - v * Math.sqrt(t));
}
/** One long contract's vega per 1.00 of vol divided by 100 (per vol point), r = 4.2%, no dividend */
export function bsVega(S: number, K: number, t: number, v: number, r = 0.042): number {
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * t) / (v * Math.sqrt(t));
  return (S * Math.exp((-d1 * d1) / 2) * Math.sqrt(t)) / Math.sqrt(2 * Math.PI) / 100;
}

/** Implied vol off a quote mid by bisection (put through parity), null outside the model's range */
function solveVol(mid: number, S: number, K: number, t: number, right: string, r = 0.042): number | null {
  const call = right === 'C' ? mid : mid + S - K * Math.exp(-r * t);
  let lo = 1e-4;
  let hi = 5;
  if (call < bsCall(S, K, t, lo, r) || call > bsCall(S, K, t, hi, r)) return null;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (bsCall(S, K, t, m, r) < call) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Each contract's vol on the 252-session clock, keyed expiry|strike|C/P: solved off its quote mid at the price the rows
    were marked at (a spread over 40% of the mid is no quote), else the vendor's calendar vol moved onto that clock */
export function contractVols(raw: Map<string, unknown>, t: string, spot: number, rowDate: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const [p, d] of raw) {
    if (!p.startsWith(`/stock/${t}/option-contracts?`)) continue;
    for (const r of d as Row[]) {
      const tail = String(r.option_symbol).slice(-15);
      const exp = `20${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4, 6)}`;
      const K = Number(tail.slice(7)) / 1000;
      const tt = yearsTrading(rowDate, exp);
      if (!(tt > 0)) continue;
      const bid = n(r.nbbo_bid);
      const ask = n(r.nbbo_ask);
      const mid = (bid + ask) / 2;
      const solved = ask > 0 && bid >= 0 && mid > 0 && (ask - bid) / mid <= 0.4 ? solveVol(mid, spot, K, tt, tail[6]) : null;
      const vendor = n(r.implied_volatility);
      const tc = (Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${rowDate}T00:00:00Z`)) / (365 * 86_400_000);
      const iv = solved != null && solved > 0.01 && solved < 5 ? solved : vendor > 0 && vendor < 10 ? vendor * Math.sqrt(tc / tt) : 0;
      if (iv > 0) m.set(`${exp}|${K}|${tail[6]}`, iv);
    }
  }
  return m;
}

export interface RawLeg {
  k: number;
  g0: number;
  iv: number;
  t: number;
  /** Vendor sign of one contract on this leg (+1 calls, −1 puts) and its open interest, for a leg priced outright */
  side: 1 | -1;
  oi: number;
}
/** The vendor rows as legs: each row's dollar gamma at its own price, its contract's vol and time on the session clock */
export function rawLegs(rows: readonly Row[], dates: ReadonlySet<string>, vols: Map<string, number>, ois?: Map<string, number>): RawLeg[] {
  const out: RawLeg[] = [];
  for (const r of rows) {
    const e = String(r.expiry);
    if (!dates.has(e)) continue;
    const k = n(r.strike);
    const t = yearsTrading(String(r.date), e);
    for (const [side, g0] of [['C', n(r.call_gamma_oi)], ['P', n(r.put_gamma_oi)]] as const) {
      const oi = ois?.get(`${e}|${k}|${side}`) ?? 0;
      if (g0 || oi) out.push({ k, g0, iv: vols.get(`${e}|${k}|${side}`) ?? 0, t, side: side === 'C' ? 1 : -1, oi });
    }
  }
  return out;
}

/** Net gamma at S, re-priced from S0 sticky-strike: G0·(S/S0)·e^(d1(S0)²/2 − d1(S)²/2); a leg six deviations out is
    priced outright, OI·100·φ(d1)/(Sσ√t)·S²·1%, when its open interest is known, else dropped */
export function rawNetAt(legs: readonly RawLeg[], s0: number, s: number, r = 0.042): number {
  let sum = 0;
  for (const l of legs) {
    if (!(l.iv > 0) || !(l.t > 0)) {
      sum += l.g0;
      continue;
    }
    const v = l.iv * Math.sqrt(l.t);
    const a = (Math.log(s0 / l.k) + (r + (l.iv * l.iv) / 2) * l.t) / v;
    const b = (Math.log(s / l.k) + (r + (l.iv * l.iv) / 2) * l.t) / v;
    if (Math.abs(a) > 6) {
      if (l.oi > 0) sum += (l.side * l.oi * 100 * Math.exp((-b * b) / 2) * s * 0.01) / (Math.sqrt(2 * Math.PI) * v);
      continue;
    }
    sum += l.g0 * (s / s0) * Math.exp((a * a) / 2 - (b * b) / 2);
  }
  return sum;
}

/** The zero of the re-priced net nearest spot inside ±10% */
export function rawFlip(legs: readonly RawLeg[], spot: number): number | null {
  const N = 1600;
  let best: number | null = null;
  let prevX = spot * 0.9;
  let prevY = rawNetAt(legs, spot, prevX);
  for (let i = 1; i <= N; i++) {
    const x = spot * (0.9 + (0.2 * i) / N);
    const y = rawNetAt(legs, spot, x);
    if (prevY * y < 0) {
      let a = prevX;
      let b = x;
      let fa = prevY;
      for (let j = 0; j < 40; j++) {
        const m = (a + b) / 2;
        const fm = rawNetAt(legs, spot, m);
        if (fm * fa > 0) {
          a = m;
          fa = fm;
        } else b = m;
      }
      const z = (a + b) / 2;
      if (best == null || Math.abs(z - spot) < Math.abs(best - spot)) best = z;
    }
    prevX = x;
    prevY = y;
  }
  return best;
}

/** ∫ G(x)·dx/(0.01·x) from spot to K, G the re-priced vendor net (vendor sign), on a fine grid */
export function rawFlowTo(legs: readonly RawLeg[], spot: number, k: number): number {
  const N = 400;
  let f = 0;
  for (let i = 0; i < N; i++) {
    const x = spot + ((k - spot) * (i + 0.5)) / N;
    f += (rawNetAt(legs, spot, x) / x) * ((k - spot) / N) * 100;
  }
  return f;
}

/* The rows are marked at the vendor's own price (its 4:15 read of the close, a few rows earlier in the day), and the
   page's spot before the open is the pre-market print. Each group of rows is re-priced FROM its own price, and the
   search and the integral run from spot — the rows are never taken as priced at a spot they were not. */
export type Priced = { s0: number; legs: RawLeg[] }[];
export function pricedLegs(rows: readonly Row[], dates: ReadonlySet<string>, vols: Map<string, number>, ois: Map<string, number>, term?: Map<string, number>): Priced {
  const by = new Map<number, Row[]>();
  for (const r of rows) {
    const p = n(r.price);
    if (!(p > 0)) continue;
    by.set(p, [...(by.get(p) ?? []), r]);
  }
  /* a row marked before the close carries the rest of its own session too: its years are the sessions after its day
     plus its day's minutes left to 4:00 ET (20:00Z in October), on the 390-minute session */
  return [...by].map(([s0, rs]) => ({
    s0,
    legs: rs.flatMap(r => {
      const left = Math.max(0, Math.min(390, (Date.parse(`${String(r.date)}T20:00:00Z`) - Date.parse(String(r.time))) / 60_000));
      const t = (l: RawLeg) => l.t + left / (390 * 252);
      /* a contract with no vol of its own (a date whose contracts were not read) takes its expiry's term vol, a calendar-year
         vol moved onto the session clock by its variance, σ_cal·√(T_cal ÷ T_trade) — never carried flat */
      const tCal = (Date.parse(`${String(r.expiry)}T20:00:00Z`) - Date.parse(String(r.time))) / (365 * 86_400_000);
      const termIv = term?.get(String(r.expiry)) ?? 0;
      return rawLegs([r], dates, vols, ois).map(l => ({ ...l, t: t(l), iv: l.iv > 0 || !(termIv > 0) || !(tCal > 0) ? l.iv : termIv * Math.sqrt(tCal / t(l)) }));
    }),
  }));
}
/* No leg in its last session holds more Γ·S²·1% than its open interest can at its peak near the strike,
   OI·K/(√(2π)·σ·√t) (Black-Scholes: max over S of S·φ(d₁)/(σ√t) is K·φ(0)·e^(−rt)/(σ√t), bounded by K·φ(0)/(σ√t)).
   The rows' gamma was marked on the close's open interest and the contracts' open interest is the morning's, so a leg
   walked a few dollars toward its strike can pass that bound; it is held at it, here as in core/gammaFlip.ts. */
const LAST_SESSION = 1 / 252 + 1e-12;
const boundedNet = (legs: readonly RawLeg[], s0: number, x: number) =>
  legs.reduce((a, l) => {
    const g = rawNetAt([l], s0, x);
    if (!(l.oi > 0) || !(l.iv > 0) || !(l.t > 0) || l.t > LAST_SESSION) return a + g;
    const cap = Math.max(Math.abs(l.g0), (l.oi * l.k) / (Math.sqrt(2 * Math.PI) * l.iv * Math.sqrt(l.t)));
    return a + Math.sign(g) * Math.min(Math.abs(g), cap);
  }, 0);
/** The re-priced net at x, vendor sign (calls +): each group of rows from its own price */
export const pricedNet = (book: Priced, x: number) => book.reduce((a, g) => a + boundedNet(g.legs, g.s0, x), 0);
/** The zero of the re-priced net nearest spot inside ±10% (1,600 cells, bisected) */
export function pricedFlip(book: Priced, spot: number): number | null {
  const N = 1600;
  let best: number | null = null;
  let px = spot * 0.9;
  let py = pricedNet(book, px);
  for (let i = 1; i <= N; i++) {
    const x = spot * (0.9 + (0.2 * i) / N);
    const y = pricedNet(book, x);
    if (py * y < 0) {
      let a = px;
      let b = x;
      let fa = py;
      for (let j = 0; j < 40; j++) {
        const m = (a + b) / 2;
        const fm = pricedNet(book, m);
        if (fm * fa > 0) {
          a = m;
          fa = fm;
        } else b = m;
      }
      const z = (a + b) / 2;
      if (best == null || Math.abs(z - spot) < Math.abs(best - spot)) best = z;
    }
    px = x;
    py = y;
  }
  return best;
}
/** ∫ G(x)·dx/(0.01·x) from spot to K, G the re-priced vendor net, on a 400-cell midpoint grid */
export function pricedFlowTo(book: Priced, spot: number, k: number): number {
  const N = 400;
  let f = 0;
  for (let i = 0; i < N; i++) {
    const x = spot + ((k - spot) * (i + 0.5)) / N;
    f += (pricedNet(book, x) / x) * ((k - spot) / N) * 100;
  }
  return f;
}

/** Standard normal CDF by erf (W. J. Cody's rational form via Math), independent of the app's A–S polynomial */
export function phiCdf(x: number): number {
  /* erf by its Taylor series near 0 and the continued fraction outside: plenty for 1e-9 here */
  const z = Math.abs(x) / Math.SQRT2;
  let erf: number;
  if (z < 3) {
    let term = z;
    let sum = z;
    for (let i = 1; i < 200; i++) {
      term *= (-z * z) / i;
      sum += term / (2 * i + 1);
    }
    erf = (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    let cf = 0;
    for (let i = 60; i >= 1; i--) cf = i / 2 / (z + cf);
    erf = 1 - Math.exp(-z * z) / Math.sqrt(Math.PI) / (z + cf);
  }
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** The vendor's implied move (its ATM straddle) into an expiry, dollars */
export function impliedMove(raw: Map<string, unknown>, t: string, expiry: string): number {
  const rows = raw.get(`/stock/${t}/volatility/term-structure`) as Row[];
  return n(rows.find(r => r.expiry === expiry)?.implied_move);
}

/** The term structure's vol per expiry (calendar-year fraction), keyed YYYY-MM-DD */
export function termVols(raw: Map<string, unknown>, t: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of (raw.get(`/stock/${t}/volatility/term-structure`) as Row[]) ?? []) {
    let v = n(r.volatility);
    if (v > 3) v /= 100;
    if (v > 0 && v < 5) m.set(String(r.expiry), v);
  }
  return m;
}

/** The vendor's open-interest change rows read (both orders, first page each) */
export function oiChangeRows(raw: Map<string, unknown>, t: string): { expiry: string; strike: number; right: string; diff: number }[] {
  const seen = new Set<string>();
  const out: { expiry: string; strike: number; right: string; diff: number }[] = [];
  for (const [p, d] of raw) {
    if (!p.startsWith(`/stock/${t}/oi-change?`)) continue;
    for (const r of d as Row[]) {
      const sym = String(r.option_symbol);
      if (seen.has(sym) || !n(r.oi_diff_plain)) continue;
      seen.add(sym);
      const tail = sym.slice(-15);
      out.push({ expiry: `20${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4, 6)}`, strike: Number(tail.slice(7)) / 1000, right: tail[6], diff: n(r.oi_diff_plain) });
    }
  }
  return out;
}

/** Open interest per contract off option-contracts, keyed expiry|strike|C/P */
export function contractOi(raw: Map<string, unknown>, t: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const [p, d] of raw) {
    if (!p.startsWith(`/stock/${t}/option-contracts?`)) continue;
    for (const r of d as Row[]) {
      const tail = String(r.option_symbol).slice(-15);
      m.set(`20${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4, 6)}|${Number(tail.slice(7)) / 1000}|${tail[6]}`, n(r.open_interest));
    }
  }
  return m;
}

/** One contract's raw vendor row (option-contracts), keyed expiry|strike|C/P */
export function contractRow(raw: Map<string, unknown>, t: string, key: string): Row | null {
  for (const [p, d] of raw) {
    if (!p.startsWith(`/stock/${t}/option-contracts?`)) continue;
    for (const r of d as Row[]) {
      const tail = String(r.option_symbol).slice(-15);
      if (`20${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4, 6)}|${Number(tail.slice(7)) / 1000}|${tail[6]}` === key) return r;
    }
  }
  return null;
}

/** Keep only the answers a run asked for, and only the spot-exposure columns the book and these checks read */
export function pruneSet(set: string, asked: readonly string[]): void {
  const keyOf = (path: string) => createHash('sha1').update(path).digest('hex').slice(0, 16);
  const want = new Set(asked.map(p => `${keyOf(p)}.json.gz`));
  for (const f of readdirSync(DIR(set))) {
    if (!f.endsWith('.json.gz')) continue;
    const file = join(DIR(set), f);
    if (!want.has(f)) {
      unlinkSync(file);
      continue;
    }
    const saved = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as { path: string; status: number; body: string; type?: string };
    if (!saved.path.includes('/spot-exposures/')) continue;
    const body = JSON.parse(saved.body) as { data?: Row[] };
    if (!Array.isArray(body?.data)) continue;
    body.data = body.data.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !/_(vol|ask|bid)$/.test(k))) as Row);
    writeFileSync(file, gzipSync(JSON.stringify({ ...saved, body: JSON.stringify(body) })));
  }
}
