/*
==================================================
  THE WALL BACK-TEST (scripts/wall-backtest.ts)

  Does a wall the Agenda calls strong actually hold more often than one it calls weak? This replays past sessions
  through the SHIPPED code — buildExposureProfile, buildAgenda, buildWallContext / oddsAt, testEvents, speedRatio —
  and counts what price did when it reached each wall.

  Unusual Whales only (docs/DATA_SOURCES.md), inside the plan's lookback:
    - the book AS OF THE OPEN of session D = the vendor's end-of-day greek exposure of the PREVIOUS session P
      (/stock/{t}/greek-exposure/strike?date=P for the whole book, /stock/{t}/greek-exposure/strike-expiry?date=P
      &expiry=E for the front expiry E — the nearest listed expiry on or after D, from /greek-exposure/expiry?date=P).
      Open interest settles overnight, so this is the book a reader saw at 09:30 — no look-ahead.
    - the day's 1-minute bars, regular session only (/stock/{t}/ohlc/1m?date=D, market_time "r")
    - the implied vol of P (/stock/{t}/iv-rank?date=…&timespan=1y, one call per year)

  DEFINITIONS (the same for every ticker; m is the margin, 0.15% of the strike unless --margin says otherwise)
    WALL     a strike the Agenda lists as a shelf (Target.isShelf: pushes back, and ≥ SHELF_SHARE of the heaviest
             strike or a named level) in the 20-each-side window — exactly what the Targets table shows.
    TOUCH    the first 1-minute bar whose range reaches the strike from the side price was on: a call-side wall
             (strike above the prior close) is touched when high ≥ K; a put-side wall when low ≤ K. A wall the open
             already crossed is not counted that day.
    HELD     after the touch (the touch bar included), price comes back AWAY from the wall by m — a bar's low ≤ K − m
             (call side) / high ≥ K + m (put side) — before any bar CLOSES beyond the wall by m.
    BROKE    a bar closes beyond the wall by m (≥ K + m call side / ≤ K − m put side) first. Within one bar a close
             beyond counts first (a bar that wicks back but closes through is a break).
    OPEN     neither by the close — counted, reported, left out of the rates.
    RE-TOUCH after a HELD, the next bar that reaches the strike again is a new touch, read with the day's tests so far
             (that is how the app reads it); after a BROKE the wall is done for the day.
    The model's reading at each touch is computed on the bars BEFORE the touch bar, with the clock at that minute and
    spot at the prior close — what a reader saw the minute before price got there.

  WHAT CANNOT BE REPLAYED: the intraday book (the live page re-reads gamma through the day; here the open's book stands
  all session), the day's build/drain (Building rows are empty → A_BUILD gets no signal), and the option prints
  (printsDemand needs the tape → A_PRINTS gets no signal). The vanna term reads the book's vanna as the app does
  without a surface.

  RUN   npx tsx scripts/wall-backtest.ts --from 2024-10-21 --to 2026-10-21 [--tickers SPY,QQQ,NVDA] [--margin 0.0015]
        UW_KEY=… must be in the environment (the key never lives in the repo). Raw responses are cached under
        --cache (default ../screenshots/audit/final/bt-cache), so a re-run is offline. Writes a JSON of every touch
        to --out (default the cache dir) and prints the tables docs/wall-backtest.md quotes.
==================================================
*/

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildExposureProfile } from '../src/data/exposure';
import { buildAgenda } from '../src/data/agenda';
import { buildWallContext, holdWord, oddsAt, speedRatio, testEvents, type WallSide } from '../src/data/wall';
import { chainFrom } from '../src/data/uwBook';
import type { Building } from '../src/data/building';
import type { AheadClock } from '../src/data/ahead';
import type { UwGreekStrike } from '../src/data/whales';
import type { Candle, MarketSnapshot } from '../src/types/market';
import type { ExposureExpiry } from '../src/types/gex';

/* ---- arguments ------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const FROM = arg('from', '2025-10-21');
const TO = arg('to', '2026-10-21');
const TICKERS = arg('tickers', 'SPY,QQQ,NVDA').split(',').map(s => s.trim().toUpperCase());
const MARGIN = Number(arg('margin', '0.0015'));
const CACHE = arg('cache', join(process.cwd(), '..', 'screenshots', 'audit', 'final', 'bt-cache'));
const OUT = arg('out', join(CACHE, 'touches.json'));
const WINDOW = 20;
const KEY = process.env.UW_KEY ?? '';
const API = 'https://api.unusualwhales.com/api';

/* ---- the vendor, cached ---------------------------------------------------------- */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function uw<T>(path: string, cacheName: string, compact: (raw: unknown) => T): Promise<T> {
  const file = join(CACHE, cacheName);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  if (!KEY) throw new Error(`no cache for ${cacheName} and no UW_KEY`);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const body = (await res.json()) as { data?: unknown };
      const out = compact(res.ok ? (body.data ?? []) : []);
      mkdirSync(join(CACHE, cacheName, '..'), { recursive: true });
      writeFileSync(file, JSON.stringify(out));
      return out;
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return compact([]);
}

const rows = (raw: unknown) => (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []);

const KEEP = ['strike', 'call_gex', 'put_gex', 'call_delta', 'put_delta', 'call_vanna', 'put_vanna', 'call_charm', 'put_charm'] as const;
const compactGreeks = (raw: unknown) =>
  rows(raw)
    .map(r => Object.fromEntries(KEEP.map(k => [k, String(r[k] ?? '0')])) as unknown as UwGreekStrike)
    .filter(r => num(r.strike) > 0);

const compactBars = (raw: unknown): Candle[] =>
  rows(raw)
    .filter(r => r.market_time === 'r')
    .map(r => ({
      time: Math.floor(Date.parse(String(r.start_time)) / 1000),
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      close: num(r.close),
      volume: num(r.volume),
    }))
    .filter(b => b.time > 0 && b.close > 0)
    .sort((a, b) => a.time - b.time);

const compactExpiries = (raw: unknown) =>
  rows(raw)
    .map(r => String(r.expiry ?? ''))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

const compactIv = (raw: unknown) => rows(raw).map(r => ({ date: String(r.date ?? ''), iv: num(r.volatility) }));

/* ---- the calendar ---------------------------------------------------------------- */

function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** New York minutes from midnight for a bar */
const nyMin = (t: number) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t * 1000));
  const h = Number(p.find(x => x.type === 'hour')?.value ?? 0) % 24;
  const m = Number(p.find(x => x.type === 'minute')?.value ?? 0);
  return h * 60 + m;
};

/* ---- one session ----------------------------------------------------------------- */

export interface Touch {
  ticker: string;
  date: string;
  scope: ExposureExpiry;
  strike: number;
  side: WallSide;
  role: string | null;
  minute: number;
  /** 1 for the day's first touch of this wall, 2+ for re-touches after a hold */
  nth: number;
  hold: number;
  word: string;
  /** weightEff / the typical wall on the book */
  ratio: number;
  testsScore: number;
  speedExcess: number;
  /** HELD / BROKE / OPEN at each margin */
  out: Record<string, 'held' | 'broke' | 'open'>;
}

const MARGINS = [0.001, MARGIN, 0.0025];

const EMPTY_BUILDING = (ticker: string, spot: number): Building =>
  ({ ticker, spot, rows: [], maxAbs: 0, maxChange: 0, built: 0, drained: 0, fastestUp: null, fastestDown: null }) as unknown as Building;

function snapshotOf(ticker: string, spot: number, all: UwGreekStrike[], front: UwGreekStrike[]): MarketSnapshot {
  const allChain = chainFrom(all, spot, new Map());
  const frontChain = front.length ? chainFrom(front, spot, new Map()) : allChain;
  return {
    ticker,
    spot,
    changePercent: 0,
    priceHistory: [],
    chain: frontChain,
    indicators: {} as MarketSnapshot['indicators'],
    plan: {} as MarketSnapshot['plan'],
    tape: [],
    liveBook: true,
    uwChains: { ALL: allChain, '0DTE': frontChain },
  } as MarketSnapshot;
}

function outcome(bars: Candle[], from: number, K: number, side: WallSide, m: number): { res: 'held' | 'broke' | 'open'; at: number } {
  const away = side === 'call' ? K * (1 - m) : K * (1 + m);
  const thru = side === 'call' ? K * (1 + m) : K * (1 - m);
  for (let i = from; i < bars.length; i++) {
    const b = bars[i];
    if (side === 'call' ? b.close >= thru : b.close <= thru) return { res: 'broke', at: i };
    if (side === 'call' ? b.low <= away : b.high >= away) return { res: 'held', at: i };
  }
  return { res: 'open', at: bars.length };
}

function replay(ticker: string, date: string, scope: ExposureExpiry, bars: Candle[], all: UwGreekStrike[], front: UwGreekStrike[], iv: number): Touch[] {
  const out: Touch[] = [];
  if (bars.length < 60 || !all.length) return out;
  const open = bars[0].open;
  const SESSION_END = 16 * 60;
  const clockAt = (i: number): AheadClock => {
    const now = nyMin(bars[i].time);
    return { nowMin: now, inSession: true, minutesLeft: Math.max(1, SESSION_END - now), label: '' };
  };
  const readAt = (i: number, K: number) => {
    const spot = i > 0 ? bars[i - 1].close : open;
    const snap = snapshotOf(ticker, spot, all, front);
    const profile = buildExposureProfile(snap, scope, WINDOW);
    const so = bars.slice(0, i);
    const clock = clockAt(i);
    const agenda = buildAgenda(snap, profile, EMPTY_BUILDING(ticker, spot), null, so, clock, iv);
    const target = agenda.targets.find(t => t.strike === K) ?? null;
    const ctx = buildWallContext(snap, profile, EMPTY_BUILDING(ticker, spot), null, so, clock, iv);
    const odds = oddsAt(K, ctx);
    const side: WallSide = K >= spot ? 'call' : 'put';
    const t = testEvents(so, K, side);
    const testsScore = t.tests === 0 ? 0 : Math.max(-1, Math.min(1, (t.held - 2 * t.broke) / (t.tests + 2)));
    const sp = speedRatio(so, iv) ?? 1;
    const speedExcess = Math.max(-0.6, Math.min(1.5, sp - 1));
    return { target, odds, ratio: odds.weightEff > 0 ? odds.weightEff / Math.max(1, ctx.typicalWall) : 0, testsScore, speedExcess };
  };

  /* the walls at the open — the strikes the Targets table lists as shelves */
  const snap0 = snapshotOf(ticker, open, all, front);
  const profile0 = buildExposureProfile(snap0, scope, WINDOW);
  const agenda0 = buildAgenda(snap0, profile0, EMPTY_BUILDING(ticker, open), null, [], clockAt(0), iv);
  const walls = agenda0.targets.filter(t => t.isShelf);

  for (const w of walls) {
    const K = w.strike;
    const side: WallSide = K > open ? 'call' : 'put';
    let i = 0;
    let nth = 0;
    while (i < bars.length) {
      /* the next bar that reaches the wall from its side */
      let hit = -1;
      for (let j = i; j < bars.length; j++) {
        if (side === 'call' ? bars[j].high >= K : bars[j].low <= K) {
          hit = j;
          break;
        }
      }
      if (hit < 0) break;
      nth += 1;
      const read = readAt(hit, K);
      const outs: Touch['out'] = {};
      let mainAt = bars.length;
      let mainRes: 'held' | 'broke' | 'open' = 'open';
      for (const m of MARGINS) {
        const o = outcome(bars, hit, K, side, m);
        outs[m.toFixed(4)] = o.res;
        if (m === MARGIN) {
          mainAt = o.at;
          mainRes = o.res;
        }
      }
      /* a wall the reader would no longer see listed at the touch still counts — it was listed at the open — but
         its reading is the model's reading at the touch */
      out.push({
        ticker,
        date,
        scope,
        strike: K,
        side,
        role: read.target?.role ?? w.role,
        minute: nyMin(bars[hit].time),
        nth,
        hold: read.odds.hold,
        word: holdWord(read.odds.hold),
        ratio: read.ratio,
        testsScore: read.testsScore,
        speedExcess: read.speedExcess,
        out: outs,
      });
      if (mainRes !== 'held') break;
      /* after a hold, look for the next visit once price has left the strike */
      let j = mainAt + 1;
      while (j < bars.length && (side === 'call' ? bars[j].high >= K : bars[j].low <= K)) j++;
      i = j;
    }
  }
  return out;
}

/* ---- statistics ------------------------------------------------------------------ */

export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Logistic regression by IRLS — y in {0,1}, X with a leading 1 column */
export function logistic(X: number[][], y: number[], iters = 50, ridge = 1e-6): number[] {
  const p = X[0].length;
  let b = new Array(p).fill(0);
  for (let it = 0; it < iters; it++) {
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    const g = new Array(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((a, x, k) => a + x * b[k], 0);
      const mu = 1 / (1 + Math.exp(-z));
      const w = mu * (1 - mu);
      for (let a = 0; a < p; a++) {
        g[a] += (y[i] - mu) * X[i][a];
        for (let c = 0; c < p; c++) H[a][c] += w * X[i][a] * X[i][c];
      }
    }
    for (let a = 0; a < p; a++) H[a][a] += ridge;
    const step = solve(H, g);
    b = b.map((v, k) => v + step[k]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return b;
}

function solve(A: number[][], bvec: number[]): number[] {
  const n = bvec.length;
  const M = A.map((r, i) => [...r, bvec[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

/* ---- main ------------------------------------------------------------------------ */

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const days = weekdays(FROM, TO);
  const touches: Touch[] = [];
  for (const ticker of TICKERS) {
    /* the year of implied vol, one call per year back */
    const ivs = new Map<string, number>();
    for (let y = Number(TO.slice(0, 4)); y >= Number(FROM.slice(0, 4)) - 1; y--) {
      const at = y === Number(TO.slice(0, 4)) ? TO : `${y}-12-31`;
      for (const r of await uw(`/stock/${ticker}/iv-rank?date=${at}&timespan=1y`, `${ticker}/iv-${at}.json`, compactIv)) if (r.iv > 0) ivs.set(r.date, r.iv > 3 ? r.iv / 100 : r.iv);
    }
    const bars = await mapLimit(days, 6, d => uw(`/stock/${ticker}/ohlc/1m?date=${d}`, `${ticker}/bars-${d}.json`, compactBars));
    const sessions = days.filter((_, i) => bars[i].length >= 300);
    const barsOf = new Map(days.map((d, i) => [d, bars[i]]));
    const pairs = sessions.slice(1).map((d, i) => ({ d, p: sessions[i] }));
    const books = await mapLimit(pairs, 6, async ({ d, p }) => {
      const all = await uw(`/stock/${ticker}/greek-exposure/strike?date=${p}`, `${ticker}/all-${p}.json`, compactGreeks);
      const exps = await uw(`/stock/${ticker}/greek-exposure/expiry?date=${p}`, `${ticker}/exp-${p}.json`, compactExpiries);
      const e = exps.find(x => x >= d) ?? '';
      const front = e ? await uw(`/stock/${ticker}/greek-exposure/strike-expiry?date=${p}&expiry=${e}`, `${ticker}/front-${p}-${e}.json`, compactGreeks) : [];
      return { all, front, e };
    });
    let n = 0;
    for (let i = 0; i < pairs.length; i++) {
      const { d, p } = pairs[i];
      const iv = ivs.get(p) ?? ivs.get(d) ?? 0.2;
      const { all, front } = books[i];
      for (const scope of ['0DTE', 'ALL'] as ExposureExpiry[]) {
        const got = replay(ticker, d, scope, barsOf.get(d) ?? [], all, scope === '0DTE' ? front : all, iv);
        touches.push(...got);
        n += got.length;
      }
    }
    console.error(`${ticker}: ${sessions.length} sessions, ${pairs.length} replayed, ${n} touches`);
  }
  writeFileSync(OUT, JSON.stringify(touches));
  report(touches);
  calibrate(touches);
}

/* ---- the tables ------------------------------------------------------------------ */

const fmtP = (v: number) => `${(v * 100).toFixed(0)}%`;

export function report(touches: Touch[]) {
  const m = MARGIN.toFixed(4);
  const line = (label: string, ts: Touch[]) => {
    const res = ts.filter(t => t.out[m] !== 'open');
    const k = res.filter(t => t.out[m] === 'held').length;
    const [lo, hi] = wilson(k, res.length);
    return `| ${label} | ${res.length} | ${ts.length - res.length} | ${res.length ? fmtP(k / res.length) : '—'} | ${res.length ? `${fmtP(lo)}–${fmtP(hi)}` : '—'} |`;
  };
  const head = '| bucket | resolved touches | still open at the close | held | 95% CI |\n|---|---|---|---|---|';
  for (const scope of ['0DTE', 'ALL']) {
    const ts = touches.filter(t => t.scope === scope);
    console.log(`\n### scope ${scope} — margin ${(MARGIN * 100).toFixed(2)}%\n`);
    console.log('By the model word at the touch\n' + head);
    for (const w of ['strong', 'medium', 'weak']) console.log(line(w, ts.filter(t => t.word === w)));
    console.log(line('all walls', ts));
    console.log('\nBy weight against the typical wall on the book\n' + head);
    const rb: [string, (r: number) => boolean][] = [
      ['< 0.5×', r => r < 0.5],
      ['0.5–1×', r => r >= 0.5 && r < 1],
      ['1–2×', r => r >= 1 && r < 2],
      ['≥ 2×', r => r >= 2],
    ];
    for (const [l, f] of rb) console.log(line(l, ts.filter(t => f(t.ratio))));
    console.log('\nBy ticker (all walls) and first touch vs re-touch\n' + head);
    for (const tk of TICKERS) console.log(line(tk, ts.filter(t => t.ticker === tk)));
    console.log(line('first touch', ts.filter(t => t.nth === 1)));
    console.log(line('re-touch', ts.filter(t => t.nth > 1)));
    console.log('\nBy the model hold (deciles of the current reading)\n' + head);
    const cuts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01];
    for (let c = 0; c < cuts.length - 1; c++) console.log(line(`${fmtP(cuts[c])}–${fmtP(Math.min(1, cuts[c + 1]))}`, ts.filter(t => t.hold >= cuts[c] && t.hold < cuts[c + 1])));
    /* the fit: held ~ 1 + log2(ratio) + tests + speed, on resolved touches with a positive weight */
    const fit = ts.filter(t => t.out[m] !== 'open' && t.ratio > 0);
    if (fit.length > 30) {
      const X = fit.map(t => [1, Math.log2(t.ratio), t.testsScore, t.speedExcess]);
      const y = fit.map(t => (t.out[m] === 'held' ? 1 : 0));
      const b = logistic(X, y);
      const base = y.reduce((a, v) => a + v, 0) / y.length;
      console.log(`\nFit (n=${fit.length}, base hold rate ${fmtP(base)}): z = ${b[0].toFixed(3)} + ${b[1].toFixed(3)}·log2(ratio) + ${b[2].toFixed(3)}·tests + ${b[3].toFixed(3)}·speedExcess`);
      console.log(`  → A_WEIGHT = ${b[1].toFixed(3)}, PAR_RATIO = ${b[1] !== 0 ? Math.pow(2, -b[0] / b[1]).toFixed(3) : '∞'}, A_TESTS = ${b[2].toFixed(3)}, A_SPEED = ${(-b[3]).toFixed(3)}`);
      for (const mm of MARGINS) {
        const key = mm.toFixed(4);
        const r = ts.filter(t => t.out[key] !== 'open');
        const k = r.filter(t => t.out[key] === 'held').length;
        console.log(`  margin ${(mm * 100).toFixed(2)}%: ${r.length} resolved, held ${r.length ? fmtP(k / r.length) : '—'}`);
      }
    }
  }
}

/* ---- the calibration the app ships ----------------------------------------------- */

/** The fit the app's constants come from: the default scope (0DTE, the Agenda's Today), held ~ log2(ratio) + tests +
    speed + a per-name intercept for SPY, QQQ and NVDA (the back-tested names). Fitted on the FIRST year, checked on the
    SECOND, then refitted on both for the shipped constants. */
export function calibrate(touches: Touch[]) {
  const m = MARGIN.toFixed(4);
  const names = ['SPY', 'QQQ', 'NVDA'];
  const feats = (t: Touch) => [1, Math.log2(Math.max(1e-3, t.ratio)), t.testsScore, t.speedExcess, ...names.slice(1).map(n => (t.ticker === n ? 1 : 0))];
  const use = touches.filter(t => t.scope === '0DTE' && t.out[m] !== 'open' && t.ratio > 0);
  const dates = [...new Set(use.map(t => t.date))].sort();
  const cut = dates[Math.floor(dates.length / 2)];
  const train = use.filter(t => t.date < cut);
  const test = use.filter(t => t.date >= cut);
  const yOf = (t: Touch) => (t.out[m] === 'held' ? 1 : 0);
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const bTrain = logistic(train.map(feats), train.map(yOf));
  const pred = (b: number[], t: Touch) => sig(feats(t).reduce((a, x, k) => a + x * b[k], 0));
  console.log(`\n### Calibration (0DTE scope, margin ${(MARGIN * 100).toFixed(2)}%) — train ${train.length} touches before ${cut}, test ${test.length} on/after`);
  const brier = (b: number[], ts: Touch[]) => ts.reduce((a, t) => a + (pred(b, t) - yOf(t)) ** 2, 0) / ts.length;
  const baseRate = train.reduce((a, t) => a + yOf(t), 0) / train.length;
  const brierBase = test.reduce((a, t) => a + (baseRate - yOf(t)) ** 2, 0) / test.length;
  console.log(`Out-of-sample Brier: model ${brier(bTrain, test).toFixed(4)} vs one pooled base rate ${brierBase.toFixed(4)}`);
  const perName = new Map(names.map(n => [n, train.filter(t => t.ticker === n)]));
  const brierName = test.reduce((a, t) => {
    const ts = perName.get(t.ticker) ?? [];
    const r = ts.reduce((x, u) => x + yOf(u), 0) / Math.max(1, ts.length);
    return a + (r - yOf(t)) ** 2;
  }, 0) / test.length;
  console.log(`Out-of-sample Brier: each name's own base rate ${brierName.toFixed(4)}`);
  console.log('Test-year calibration (predicted bucket → observed)\n| predicted | touches | observed held | 95% CI |\n|---|---|---|---|');
  for (const [lo, hi] of [[0, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.75], [0.75, 1]] as const) {
    const ts = test.filter(t => pred(bTrain, t) >= lo && pred(bTrain, t) < hi);
    const k = ts.reduce((a, t) => a + yOf(t), 0);
    const [l, h] = wilson(k, ts.length);
    console.log(`| ${fmtP(lo)}–${fmtP(hi)} | ${ts.length} | ${ts.length ? fmtP(k / ts.length) : '—'} | ${ts.length ? `${fmtP(l)}–${fmtP(h)}` : '—'} |`);
  }
  const b = logistic(use.map(feats), use.map(yOf));
  console.log(`\nShipped fit (n=${use.length}): z = ${b[0].toFixed(3)} + ${b[1].toFixed(3)}·log2(ratio) + ${b[2].toFixed(3)}·tests + ${b[3].toFixed(3)}·speedExcess + ${b[4].toFixed(3)}·QQQ + ${b[5].toFixed(3)}·NVDA`);
  console.log(`  A_WEIGHT=${b[1].toFixed(3)}  PAR_RATIO(SPY)=${Math.pow(2, -b[0] / b[1]).toFixed(3)}  A_TESTS=${b[2].toFixed(3)}  A_SPEED=${(-b[3]).toFixed(3)}  BASE_LOGIT SPY=${b[0].toFixed(3)} QQQ=${(b[0] + b[4]).toFixed(3)} NVDA=${(b[0] + b[5]).toFixed(3)}`);
  return b;
}

const isMain = process.argv[1] && process.argv[1].endsWith('wall-backtest.ts');
if (isMain) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
