/*
  After a session: the review of every trade Compass took (and every one a late mark would have taken), and the
  study of what it missed, both from ThetaData's recorded quotes and the rows the scan scored that day.

  The review (one per trade): the entry snapshot (the 56 inputs, Model 1 and Model 2, and the inputs that pushed the
  score most, by tree path attribution), what happened after (the underlying's path, the contract's implied vol at
  the fill and at the exit, the mid, the spread paid, the decay), and a verdict with its cause.

  The study (one per session): every contract in the scan's strike band, on both sleeves, that made a 50%+ move by the
  books' own definitions (the ask at a mark against a later bid, before the flat); for each, the row the scan scored at
  that mark and the gate that stopped it; the miss reasons and the inputs most often holding scores down; a label on
  every scored row with what actually happened; Model 1's calibration on those labels; and suggested changes with
  their evidence. Nothing is applied: the owner decides.

  Reads go through compassHost (the hub and its eight-request cap on the server; the dev proxy from the script).
*/

import { compassHost } from './compassHost';
import { bsStates, ivStates } from './compassFeatures';
import { FLAT_T, P1_MIN, SPAN_INDEX, STOP_KEEP, WEEKLY_STRIKES, spreadPass, strikeDistance, strikeSpan, thetaBurns, weekdayDte } from './compassParams';
import { grossPnl, settleSignal, type PathBar, type PathQuote } from './compassOutcome';
import { readQuotes, type Signal } from './compassLedger';
import { underCloses } from './compassModel';
import { explain, sigmoid, type ExplainTree } from './lgbmExplain';
import { nyParts, nyWallTime } from '../core/nyTime';
import type { MarkRow } from './compassScan';

/** One scored row as the server logged it (data/compassServer.ts). */
export interface ScoredLine {
  /** minute of the day, New York */
  t: number;
  d: string;
  /** contract, "SPY 770C" */
  k: string;
  /** expiry YYYY-MM-DD */
  e: string;
  b: number;
  a: number;
  q: number;
  s: number | null;
  late?: boolean;
  x: (number | null)[];
  p1: number;
  /** null when Model 2 was not scored (an input it never saw missing was missing) */
  p2: number | null;
}

/** The 56 inputs' names, in the trees' column order (compassFeatures.ts). */
import { INPUT_NAMES } from './compassFeatures';

export { INPUT_NAMES };

const FLAT_MIN = 15 * 60 + 55;
const two = (n: number) => String(n).padStart(2, '0');
const clockOf = (m: number) => `${two(Math.floor(m / 60))}:${two(m % 60)}`;
const minuteOf = (ms: number) => {
  const p = nyParts(ms);
  return p.hour * 60 + p.minute;
};
const ymd = (iso: string) => iso.replace(/-/g, '');
const markMs = (day: string, minute: number) => nyWallTime(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), Math.floor(minute / 60), minute % 60);
const r4 = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(4)) : null);
const r2 = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(2)) : null);
const xs = (row: ScoredLine) => row.x.map(v => (v == null ? NaN : v));
const tickerOf = (contract: string) => contract.split(' ')[0];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A read the terminal may not answer for a minute (its session drops): asked again every 5 seconds, a minute at
    most, until it gives an answer that `ok` accepts. */
async function steady<T>(read: () => Promise<T>, ok: (v: T) => boolean, tries = 12): Promise<T> {
  let v = await read();
  for (let i = 0; i < tries && !ok(v); i++) {
    await sleep(5_000);
    v = await read();
  }
  return v;
}

/** The underlying's one-minute closes, waited for through a dropped session. */
const closesOf = (ticker: string, day: string) => steady(() => underCloses(ticker, ymd(day)), b => b.length > 0);

/** One contract's quotes from a chain read, by "strike|C". */
type Chain = Map<string, PathQuote[]>;

/** One expiry's one-minute NBBO for every strike in the band, the whole session, in one read. */
export async function chainDay(ticker: string, expiry: string, day: string, range: number): Promise<Chain | null> {
  return steady(() => chainOnce(ticker, expiry, day, range), c => c !== null);
}

async function chainOnce(ticker: string, expiry: string, day: string, range: number): Promise<Chain | null> {
  const got = await compassHost().theta(`/option/history/quote?symbol=${encodeURIComponent(ticker)}&expiration=${ymd(expiry)}&start_date=${ymd(day)}&end_date=${ymd(day)}&strike_range=${range}&interval=1m&format=json`);
  if (got.error && got.error !== 'no_data') return null;
  const out: Chain = new Map();
  for (const item of Array.isArray(got.data) ? got.data : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { contract?: Record<string, unknown>; data?: unknown };
    const c = row.contract;
    if (!c || !Array.isArray(row.data)) continue;
    const strike = Number(c.strike);
    const side = String(c.right ?? '').toUpperCase().slice(0, 1);
    if (!(strike > 0) || (side !== 'C' && side !== 'P')) continue;
    out.set(`${strike}|${side}`, readQuotes(row.data));
  }
  return out;
}

const keyOf = (contract: string) => {
  const word = contract.split(' ')[1] ?? '';
  return `${Number(word.slice(0, -1))}|${word.slice(-1)}`;
};

/** The underlying at an instant: the close of the last minute that started before it. */
function underAtMs(bars: readonly PathBar[], at: number): number {
  let px = NaN;
  for (const b of bars) {
    if (b.t + 60_000 <= at) px = b.c;
    else break;
  }
  return px;
}

/** Years to the 16:00 close of the expiry, counting the trading minutes left (390 a session, 252 sessions). */
function yearsTo(at: number, day: string, expiry: string): number {
  const left = Math.max(1, 16 * 60 - minuteOf(at));
  const sessions = Math.max(0, weekdayDte(ymd(day), expiry));
  return (left + sessions * 390) / (390 * 252);
}

/* ---- the review ---- */

export type Cause =
  | 'direction wrong'
  | 'reversal right after entry'
  | 'IV crush'
  | 'decay'
  | 'spread or fill cost'
  | 'direction right'
  | 'IV expansion'
  | 'not filled'
  | 'still open';

export interface Driver {
  col: number;
  name: string;
  value: number | null;
  /** log-odds this input added to the score along the trees' paths */
  credit: number;
}

export interface TradeReview {
  key: string;
  contract: string;
  book: 'A' | 'B' | 'C';
  how: 'live' | 'late';
  /** a late mark's "would have called": never a call */
  would: boolean;
  mark: string;
  p1: number | null;
  p2: number | null;
  snapshot: {
    /** what Model 1 read on this contract at the mark, when the scan scored it (Book C calls carry no model) */
    modelRead: number | null;
    bid: number;
    ask: number;
    spot: number | null;
    /** the 56 inputs as the trees read them (null: missing) */
    x: (number | null)[] | null;
    up: Driver[];
    down: Driver[];
    runnerUp: Driver[];
    runnerDown: Driver[];
  };
  after: {
    fill: number | null;
    fillAt: string | null;
    exit: number | null;
    exitAt: string | null;
    why: string;
    heldMin: number | null;
    pnl: number | null;
    /** the underlying from the fill to the exit, signed for the side (+ is the call's or put's way), percent */
    underMove: number | null;
    /** best and worst of the underlying for the side while held, percent */
    underBest: number | null;
    underWorst: number | null;
    /** the underlying's first 10 minutes after the fill, signed for the side, percent */
    underFirst10: number | null;
    ivFill: number | null;
    ivExit: number | null;
    midFill: number | null;
    midExit: number | null;
    /** per contract, dollars: what each part of the mid's move came to (Black-Scholes, repriced step by step) */
    parts: { direction: number | null; decay: number | null; iv: number | null; spreadIn: number | null; spreadOut: number | null };
    /** the best bid between the fill and the flat, and whether the 1.5× target stood after the exit */
    bestBid: number | null;
    targetLater: boolean;
    /** the mid each minute from the fill to the exit */
    mids: number[];
  };
  verdict: { cause: Cause; flags: string[]; line: string };
}

function drivers(trees: readonly ExplainTree[] | null, x: number[] | null): { up: Driver[]; down: Driver[] } {
  if (!trees || !x) return { up: [], down: [] };
  const e = explain(trees, x);
  const all = e.credit.map((credit, col) => ({ col, name: INPUT_NAMES[col], value: Number.isFinite(x[col]) ? r4(x[col]) : null, credit: Number(credit.toFixed(4)) }));
  return {
    up: all.filter(d => d.credit > 0).sort((a, b) => b.credit - a.credit).slice(0, 5),
    down: all.filter(d => d.credit < 0).sort((a, b) => a.credit - b.credit).slice(0, 5),
  };
}

export interface ReviewDeps {
  day: string;
  rows: readonly ScoredLine[];
  entry: readonly ExplainTree[] | null;
  runner: readonly ExplainTree[] | null;
  /** chains already read, by "ticker|expiry" (the study shares them) */
  chains?: Map<string, Chain | null>;
}

/** One trade, reviewed. */
export async function reviewTrade(sig: Signal, deps: ReviewDeps): Promise<TradeReview> {
  const markMin = minuteOf(sig.mark ?? sig.firedAt);
  const row = deps.rows.find(r => r.t === markMin && r.k === sig.contract && r.e === sig.expiry && !!r.late === (sig.how === 'late'))
    ?? deps.rows.find(r => r.t === markMin && r.k === sig.contract && r.e === sig.expiry)
    ?? null;
  const x = row ? xs(row) : null;
  const ent = drivers(deps.entry ?? null, x);
  const run = drivers(deps.runner ?? null, x);
  const o = sig.outcome;
  const dir = sig.right === 'C' ? 1 : -1;
  const chainKey = `${sig.ticker}|${sig.expiry}`;
  let chain = deps.chains?.get(chainKey);
  if (chain === undefined) {
    chain = await chainDay(sig.ticker, sig.expiry, sig.day, sig.expiry === sig.day ? 16 : 4);
    deps.chains?.set(chainKey, chain);
  }
  const quotes = chain?.get(`${sig.strike}|${sig.right}`) ?? [];
  const bars = await closesOf(sig.ticker, sig.day);
  const base: TradeReview = {
    key: sig.key,
    contract: sig.contract,
    book: sig.book,
    how: sig.how ?? 'live',
    would: !!sig.would,
    mark: clockOf(markMin),
    p1: sig.p1,
    p2: sig.prun,
    snapshot: { modelRead: row ? Number(row.p1.toFixed(4)) : null, bid: sig.bid, ask: sig.ask, spot: sig.spot, x: row ? row.x : null, up: ent.up, down: ent.down, runnerUp: run.up, runnerDown: run.down },
    after: { fill: null, fillAt: null, exit: null, exitAt: null, why: '', heldMin: null, pnl: null, underMove: null, underBest: null, underWorst: null, underFirst10: null, ivFill: null, ivExit: null, midFill: null, midExit: null, parts: { direction: null, decay: null, iv: null, spreadIn: null, spreadOut: null }, bestBid: null, targetLater: false, mids: [] },
    verdict: { cause: 'still open', flags: [], line: '' },
  };
  if (!o || !o.fill) {
    base.verdict = { cause: 'not filled', flags: [], line: o?.status === 'unavailable' ? 'No valid quote stood a minute after the call: never filled.' : 'Not filled yet.' };
    return base;
  }
  if (o.status !== 'closed' || !o.exit) {
    base.verdict = { cause: 'still open', flags: [], line: 'Still open: reviewed after it closes.' };
    return base;
  }
  const fill = o.fill;
  const exit = o.exit;
  const K = sig.strike;
  const call = sig.right === 'C';
  const S0 = underAtMs(bars, fill.at);
  const S1 = underAtMs(bars, exit.at);
  const held = bars.filter(b => b.t >= fill.at - 60_000 && b.t < exit.at);
  const signed = (px: number) => (S0 > 0 && px > 0 ? (px / S0 - 1) * 100 * dir : NaN);
  const moves = held.map(b => signed(b.c)).filter(Number.isFinite);
  const first10 = bars.filter(b => b.t >= fill.at - 60_000 && b.t < fill.at + 10 * 60_000).map(b => signed(b.c)).filter(Number.isFinite);
  const exitQuote = quotes.find(q => q.t === exit.at) ?? o.last ?? null;
  const mid0 = (fill.bid + fill.ask) / 2;
  const mid1 = exitQuote ? (exitQuote.bid + exitQuote.ask) / 2 : NaN;
  const T0 = yearsTo(fill.at, sig.day, sig.expiry);
  const T1 = yearsTo(exit.at, sig.day, sig.expiry);
  const iv0 = ivStates(mid0, S0, K, T0, call);
  const iv1 = Number.isFinite(mid1) ? ivStates(mid1, S1, K, T1, call) : NaN;
  const px = (S: number, T: number, v: number) => bsStates(S, K, T, v, call).px;
  let direction = NaN;
  let decay = NaN;
  let iv = NaN;
  if (Number.isFinite(iv0) && Number.isFinite(iv1)) {
    direction = (px(S1, T0, iv0) - mid0) * 100;
    decay = (px(S1, T1, iv0) - px(S1, T0, iv0)) * 100;
    iv = (mid1 - px(S1, T1, iv0)) * 100;
  } else if (Number.isFinite(mid1)) {
    direction = (mid1 - mid0) * 100;
  }
  const spreadIn = (fill.ask - mid0) * 100;
  const spreadOut = Number.isFinite(mid1) ? (mid1 - exit.px) * 100 : NaN;
  const flatAt = markMs(sig.day, FLAT_MIN);
  const afterFill = quotes.filter(q => q.t > fill.at && q.t <= flatAt);
  const bestBid = afterFill.reduce((m, q) => Math.max(m, q.bid), 0);
  const target = sig.book === 'C' ? fill.ask * 2 : fill.ask * 1.5;
  const targetLater = quotes.some(q => q.t > exit.at && q.t <= flatAt && q.bid >= target);
  const mids = quotes.filter(q => q.t >= fill.at && q.t <= exit.at && q.t % 60_000 === 0).map(q => Number(((q.bid + q.ask) / 2).toFixed(3)));
  base.after = {
    fill: fill.ask,
    fillAt: clockOf(minuteOf(fill.at)),
    exit: exit.px,
    exitAt: clockOf(minuteOf(exit.at)),
    why: exit.why,
    heldMin: o.heldMin,
    /* (exit - fill) x 100, no fees (a record settled before the rule carried them in its pnl) */
    pnl: grossPnl(fill.ask, exit.px),
    underMove: r4(signed(S1)),
    underBest: moves.length ? r4(Math.max(...moves)) : null,
    underWorst: moves.length ? r4(Math.min(...moves)) : null,
    underFirst10: first10.length ? r4(first10.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)) : null,
    ivFill: r4(iv0),
    ivExit: r4(iv1),
    midFill: r4(mid0),
    midExit: r4(mid1),
    parts: { direction: r2(direction), decay: r2(decay), iv: r2(iv), spreadIn: r2(spreadIn), spreadOut: r2(spreadOut) },
    bestBid: bestBid > 0 ? bestBid : null,
    targetLater,
    mids,
  };
  base.verdict = verdictOf(sig, base.after, markMin);
  if (!bars.length) base.verdict.flags.push('the underlying’s minutes did not load: the direction, decay and IV split is not drawn');
  return base;
}

/** The cause in one class, and the line that says it. */
export function verdictOf(sig: Pick<Signal, 'book' | 'right'>, a: TradeReview['after'], markMin: number): TradeReview['verdict'] {
  const flags: string[] = [];
  if (markMin > 15 * 60) flags.push('late in session');
  if (markMin - 570 < 15 || markMin - 570 > 330) flags.push('outside the minutes the model was trained on');
  if (a.targetLater) flags.push('stop too tight: the target stood later, before the flat');
  const pnl = a.pnl ?? 0;
  const p = a.parts;
  const cost = (p.spreadIn ?? 0) + (p.spreadOut ?? 0);
  const side = sig.right === 'C' ? 'up' : 'down';
  const pct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`);
  const usd = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}`);
  const parts = `Direction ${usd(p.direction)}, decay ${usd(p.decay)}, IV ${usd(p.iv)}, spread ${usd(-cost)}.`;
  if (pnl > 0) {
    const best = (p.iv ?? 0) > (p.direction ?? 0) ? 'IV expansion' : 'direction right';
    return { cause: best, flags, line: `Won ${usd(pnl)}. The underlying went ${pct(a.underMove)} its way while held (best ${pct(a.underBest)}). ${parts}` };
  }
  const neg: [Cause, number][] = [
    ['direction wrong', Math.min(0, p.direction ?? 0)],
    ['decay', Math.min(0, p.decay ?? 0)],
    ['IV crush', Math.min(0, p.iv ?? 0)],
    ['spread or fill cost', -Math.max(0, cost)],
  ];
  neg.sort((x, y) => x[1] - y[1]);
  let cause = neg[0][1] < 0 ? neg[0][0] : 'direction wrong';
  /* a move its way first and then against it inside ten minutes, or the reversal exit itself */
  if (cause === 'direction wrong' && (/reversed/i.test(a.why) || ((a.underFirst10 ?? 0) < 0 && (a.underBest ?? 0) > 0.05))) cause = 'reversal right after entry';
  const lines: Record<string, string> = {
    'direction wrong': `The underlying went ${pct(a.underMove)} against the ${sig.right === 'C' ? 'call' : 'put'} (it needed to go ${side}); best ${pct(a.underBest)} while held.`,
    'reversal right after entry': `The underlying turned against the ${sig.right === 'C' ? 'call' : 'put'} right after the entry (${pct(a.underFirst10)} in the first ten minutes); it left on “${a.why.replace(/\.$/, '')}”.`,
    'IV crush': `Implied vol fell from ${a.ivFill == null ? '—' : `${(a.ivFill * 100).toFixed(1)}%`} to ${a.ivExit == null ? '—' : `${(a.ivExit * 100).toFixed(1)}%`} while held; that took more than the move gave.`,
    decay: `Time decay took the most: the underlying barely moved (${pct(a.underMove)}) over ${a.heldMin ?? '—'} minutes.`,
    'spread or fill cost': `The spread paid in and out (${usd(-cost)}) was the biggest part of the loss: the fill was ${a.fill?.toFixed(2)} on a mid of ${a.midFill?.toFixed(2)}.`,
  };
  return { cause, flags, line: `Lost ${usd(pnl)}. ${lines[cause] ?? ''} ${parts}` };
}

/* ---- the study ---- */

export type Gate =
  | 'called'
  | 'would have called (late mark)'
  | 'Model 1 under the threshold'
  | 'outside the books’ strike band'
  | 'seats full'
  | 'theta burns the stop before the flat'
  | 'side or drive rule'
  | 'bid at or under $0.15'
  | 'spread over 8%'
  | 'not scored: no quote at the mark'
  | 'not scored: outside the scanned band'
  | 'not scored: the name was not read at the mark';

export interface Mover {
  sleeve: 'odte' | 'weekly';
  contract: string;
  expiry: string;
  /** the first mark it made the move from */
  mark: string;
  ask: number;
  /** the best bid later, before the flat */
  bestBid: number;
  bestAt: string;
  /** best bid against the ask */
  ratio: number;
  /** the book's stop (0.4678 × the ask) stood first */
  stopFirst: boolean;
  scored: boolean;
  p1: number | null;
  p2: number | null;
  gate: Gate;
  /** the inputs that held Model 1 down the most at that mark */
  heldDown: Driver[];
}

export interface Label {
  t: number;
  k: string;
  e: string;
  late?: boolean;
  p1: number;
  p2: number | null;
  /** the book the row's contract sat in at its mark: A (within the span), B (the wing band at an ask of 1.00 or less),
      or null (neither; labelled by Book A's non-runner rules) */
  book?: 'A' | 'B' | null;
  /** the exit rode the ratchet: Book B always, Book A when Model 2 cleared 0.50 */
  runner?: boolean;
  /** the books' fill (the ask a full minute after the mark) and the exit by the row's own book's rules */
  fill: number | null;
  exit: number | null;
  why: string | null;
  ret: number | null;
  /** the 1.50× target reached before the exit: a non-runner's take-profit; a runner's bid at 1.50× the fill at or
      before its ratchet exit */
  tp1: boolean | null;
  /** any bid at 1.50× the fill before the flat */
  hit50: boolean | null;
  /** best bid before the flat against the fill */
  best: number | null;
}

export interface StudyResult {
  day: string;
  builtAt: number;
  sleeves: Record<'odte' | 'weekly', { names: number; marks: number; contractMarks: number; movers: number; moverMarks: number; scored: number; aboveThreshold: number; called: number }>;
  movers: Mover[];
  missReasons: { gate: Gate; n: number }[];
  heldDownMost: { col: number; name: string; n: number }[];
  falsePositives: { contract: string; book: string; would: boolean; pnl: number | null; cause: string }[];
  calibration: { bucket: string; lo: number; hi: number; n: number; tp1: number; hit50: number; inWindowN: number; inWindowTp1: number }[];
  thresholds: { p1: number; n: number; tp1: number; meanRet: number | null }[];
  suggestions: { change: string; evidence: string; n: number; applied: false }[];
  labels: number;
  notes: string[];
}

const BUCKETS: [number, number][] = [[0, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.65], [0.65, P1_MIN], [P1_MIN, 0.75], [0.75, 0.8], [0.8, 1.01]];
const bucketName = (lo: number, hi: number) => `${(lo * 100).toFixed(lo === P1_MIN ? 2 : 0)}–${hi > 1 ? '100' : (hi * 100).toFixed(hi === P1_MIN ? 2 : 0)}%`;
/** The cuts the threshold sweep tries */
const CUTS = [0.6, 0.65, 0.7, P1_MIN, 0.75, 0.8, 0.85];
/** Inside the minutes the trees were trained on (15 to 330 after 09:30) */
const inWin = (l: Pick<Label, 't'>) => l.t - 570 >= 15 && l.t - 570 <= 330;

export interface StudyDeps extends ReviewDeps {
  marks: readonly MarkRow[];
  calls: readonly Signal[];
  would: readonly Signal[];
  reviews: readonly TradeReview[];
  /** called with each label as it is made (the server writes them out) */
  onLabel?: (label: Label) => void;
}

/** The book a scored row's contract sat in at its mark, from the strikes scored with it: A within the span, B in the
    wing band at an ask of 1.00 or less, else null. */
export function bookOfRow(r: Pick<ScoredLine, 'k' | 's' | 'a'>, mates: readonly Pick<ScoredLine, 'k'>[], name: string): 'A' | 'B' | null {
  const strikeOf = (k: string) => Number(k.split(' ')[1]?.slice(0, -1));
  const strikes = mates.map(m => strikeOf(m.k)).filter(Number.isFinite);
  const spot = r.s ?? NaN;
  if (!(spot > 0) || !strikes.length) return null;
  const dist = strikeDistance(strikes, spot, strikeOf(r.k));
  const span = strikeSpan(spot, strikes, SPAN_INDEX.includes(name as (typeof SPAN_INDEX)[number]));
  if (dist <= span) return 'A';
  const inner = Math.max(8, span + 1);
  if (dist >= inner && dist <= inner + 4 && r.a <= 1) return 'B';
  return null;
}

export async function runStudy(deps: StudyDeps): Promise<StudyResult> {
  const { day } = deps;
  const chains = deps.chains ?? new Map<string, Chain | null>();
  const notes: string[] = [];
  const rowsAt = new Map<string, ScoredLine[]>();
  for (const r of deps.rows) {
    if (r.d !== day) continue;
    const key = `${r.t}|${tickerOf(r.k)}|${r.e}`;
    const list = rowsAt.get(key) ?? [];
    list.push(r);
    rowsAt.set(key, list);
  }
  const rowOf = (t: number, contract: string, expiry: string) => {
    const list = rowsAt.get(`${t}|${tickerOf(contract)}|${expiry}`) ?? [];
    return list.find(r => r.k === contract && !r.late) ?? list.find(r => r.k === contract) ?? null;
  };
  /* which expiry each name's weekly scan read: the most common non-same-day expiry among its rows */
  const weeklyExp = new Map<string, Map<string, number>>();
  for (const r of deps.rows) {
    if (r.d !== day || r.e === day) continue;
    const t = tickerOf(r.k);
    const m = weeklyExp.get(t) ?? new Map<string, number>();
    m.set(r.e, (m.get(r.e) ?? 0) + 1);
    weeklyExp.set(t, m);
  }
  const callAt = (list: readonly Signal[], ticker: string, minute: number) => list.find(s => s.ticker === ticker && minuteOf(s.mark ?? s.firedAt) === minute);
  /* the roots the official book held before each minute */
  const heldBefore = (minute: number) => new Set(deps.calls.filter(s => s.book !== 'C' && minuteOf(s.firedAt) < minute).map(s => s.ticker));
  const entryTrees = deps.entry ?? null;
  const sleeves: StudyResult['sleeves'] = { odte: { names: 0, marks: 0, contractMarks: 0, movers: 0, moverMarks: 0, scored: 0, aboveThreshold: 0, called: 0 }, weekly: { names: 0, marks: 0, contractMarks: 0, movers: 0, moverMarks: 0, scored: 0, aboveThreshold: 0, called: 0 } };
  const movers: Mover[] = [];
  for (const sleeve of ['odte', 'weekly'] as const) {
    const sleeveMarks = deps.marks.filter(m => m.sleeve === sleeve && m.at > 0).sort((a, b) => a.at - b.at);
    const names = [...new Set(sleeveMarks.flatMap(m => Object.keys(m.names)))];
    sleeves[sleeve].names = names.length;
    sleeves[sleeve].marks = sleeveMarks.length;
    for (const name of names) {
      const expiry = sleeve === 'odte' ? day : [...(weeklyExp.get(name) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!expiry) continue;
      const ck = `${name}|${expiry}`;
      if (!chains.has(ck)) chains.set(ck, await chainDay(name, expiry, day, sleeve === 'odte' ? 16 : WEEKLY_STRIKES));
      const chain = chains.get(ck);
      if (!chain) {
        notes.push(`${name} ${sleeve === 'odte' ? '0DTE' : expiry}: ThetaData did not answer the session's quotes; not studied.`);
        continue;
      }
      const seen = new Set<string>();
      for (const m of sleeveMarks) {
        const state = m.names[name];
        if (!state) continue;
        const minute = minuteOf(m.at);
        if (minute >= FLAT_MIN) continue;
        const at = markMs(day, minute);
        const flatAt = markMs(day, FLAT_MIN);
        for (const [ckey, quotes] of chain) {
          const i0 = quotes.findIndex(q => q.t === at);
          const entry = i0 >= 0 ? quotes[i0] : null;
          if (!entry || !(entry.ask > 0) || !(entry.bid >= 0)) continue;
          sleeves[sleeve].contractMarks += 1;
          let best = 0;
          let bestT = 0;
          let stopFirst = false;
          let moved = false;
          for (let i = i0 + 1; i < quotes.length; i++) {
            const q = quotes[i];
            if (q.t > flatAt) break;
            if (!moved && q.bid <= entry.ask * STOP_KEEP) stopFirst = true;
            if (q.bid > best) {
              best = q.bid;
              bestT = q.t;
            }
            if (q.bid >= entry.ask * 1.5) moved = true;
          }
          if (!moved) continue;
          sleeves[sleeve].moverMarks += 1;
          if (seen.has(ckey)) continue;
          seen.add(ckey);
          const [k, side] = ckey.split('|');
          const contract = `${name} ${Number(k) % 1 === 0 ? Number(k).toFixed(0) : Number(k).toFixed(2)}${side}`;
          const row = rowOf(minute, contract, expiry);
          let gate: Gate;
          if (row) {
            const called = callAt(deps.calls, name, minute);
            const would = callAt(deps.would, name, minute);
            if (called?.contract === contract) gate = 'called';
            else if (would?.contract === contract) gate = 'would have called (late mark)';
            else if (row.p1 + 1e-12 < P1_MIN) gate = 'Model 1 under the threshold';
            else {
              const mates = rowsAt.get(`${minute}|${name}|${expiry}`) ?? [];
              const strikes = mates.map(r => Number(r.k.split(' ')[1].slice(0, -1)));
              const spot = row.s ?? NaN;
              const dist = strikeDistance(strikes, spot, Number(k));
              const span = strikeSpan(spot, strikes, SPAN_INDEX.includes(name as (typeof SPAN_INDEX)[number]));
              const held = heldBefore(minute);
              if (!(dist <= span) && !(dist >= Math.max(8, span + 1) && dist <= Math.max(8, span + 1) + 4 && entry.ask <= 1)) gate = 'outside the books’ strike band';
              else if (held.size >= 5 || held.has(name)) gate = 'seats full';
              else if (thetaBurns(row.x[39] ?? NaN, row.x[38] ?? NaN, row.a, Math.max(0, FLAT_T - (minute - 570 + 1)) / (390 * 252))) gate = 'theta burns the stop before the flat';
              else gate = 'side or drive rule';
            }
          } else if (state === 'none' || state === 'pending') gate = 'not scored: the name was not read at the mark';
          else if (!(entry.bid > 0.15)) gate = 'bid at or under $0.15';
          else if (!spreadPass(entry.bid, entry.ask)) gate = 'spread over 8%';
          else if ((rowsAt.get(`${minute}|${name}|${expiry}`) ?? []).length) gate = 'not scored: outside the scanned band';
          else gate = 'not scored: no quote at the mark';
          const held = row && gate === 'Model 1 under the threshold' ? drivers(entryTrees, xs(row)).down.slice(0, 3) : [];
          if (row) sleeves[sleeve].scored += 1;
          if (row && row.p1 + 1e-12 >= P1_MIN) sleeves[sleeve].aboveThreshold += 1;
          if (gate === 'called') sleeves[sleeve].called += 1;
          sleeves[sleeve].movers += 1;
          movers.push({
            sleeve,
            contract,
            expiry,
            mark: clockOf(minute),
            ask: entry.ask,
            bestBid: best,
            bestAt: clockOf(minuteOf(bestT)),
            ratio: Number((best / entry.ask).toFixed(2)),
            stopFirst,
            scored: !!row,
            p1: row ? Number(row.p1.toFixed(4)) : null,
            p2: row && row.p2 != null ? Number(row.p2.toFixed(4)) : null,
            gate,
            heldDown: held,
          });
        }
      }
    }
  }
  const reasons = new Map<Gate, number>();
  for (const m of movers) reasons.set(m.gate, (reasons.get(m.gate) ?? 0) + 1);
  const heldCount = new Map<number, number>();
  for (const m of movers) for (const d of m.heldDown) heldCount.set(d.col, (heldCount.get(d.col) ?? 0) + 1);

  /* every scored row, labelled with what the books would have done from its mark */
  const labels: Label[] = [];
  const barsOf = new Map<string, PathBar[]>();
  for (const r of deps.rows) {
    if (r.d !== day) continue;
    const name = tickerOf(r.k);
    const ck = `${name}|${r.e}`;
    if (!chains.has(ck)) chains.set(ck, await chainDay(name, r.e, day, r.e === day ? 16 : WEEKLY_STRIKES));
    const quotes = chains.get(ck)?.get(keyOf(r.k)) ?? null;
    if (!barsOf.has(name)) barsOf.set(name, await closesOf(name, day));
    const right = r.k.trim().slice(-1) === 'C' ? 'C' : 'P';
    const firedAt = markMs(day, r.t);
    const book = bookOfRow(r, rowsAt.get(`${r.t}|${name}|${r.e}`) ?? [r], name);
    const runner = book === 'B' || (book === 'A' && r.p2 != null && r.p2 >= 0.5);
    let label: Label = { t: r.t, k: r.k, e: r.e, ...(r.late ? { late: true } : {}), p1: r.p1, p2: r.p2, book, runner, fill: null, exit: null, why: null, ret: null, tp1: null, hit50: null, best: null };
    if (quotes?.length) {
      /* each row by its own book's exit rules (was: Book A's non-runner rules for every row) */
      const out = settleSignal({ book: book ?? 'A', right, runner, firedAt }, quotes, barsOf.get(name) ?? [], firedAt + 86_400_000);
      if (out.fill) {
        const flatAt = markMs(day, FLAT_MIN);
        const best = quotes.filter(q => q.t > out.fill!.at && q.t <= flatAt).reduce((mx, q) => Math.max(mx, q.bid), 0);
        const exitAt = out.exit?.at ?? flatAt;
        const tp1 = runner
          ? quotes.some(q => q.t > out.fill!.at && q.t <= exitAt && q.bid >= out.fill!.ask * 1.5)
          : out.exit?.why === 'Take profit 1.50×';
        label = { ...label, fill: out.fill.ask, exit: out.exit?.px ?? null, why: out.exit?.why ?? null, ret: out.ret, tp1, hit50: best >= out.fill.ask * 1.5, best: best > 0 ? Number((best / out.fill.ask).toFixed(3)) : null };
      }
    }
    labels.push(label);
    deps.onLabel?.(label);
  }
  const done = labels.filter(l => l.tp1 != null);
  const calibration = BUCKETS.map(([lo, hi]) => {
    const inB = done.filter(l => l.p1 >= lo && l.p1 < hi);
    const w = inB.filter(inWin);
    return {
      bucket: bucketName(lo, hi),
      lo,
      hi,
      n: inB.length,
      tp1: inB.length ? Number((inB.filter(l => l.tp1).length / inB.length).toFixed(3)) : 0,
      hit50: inB.length ? Number((inB.filter(l => l.hit50).length / inB.length).toFixed(3)) : 0,
      inWindowN: w.length,
      inWindowTp1: w.length ? Number((w.filter(l => l.tp1).length / w.length).toFixed(3)) : 0,
    };
  });
  /* the same labels cut at other thresholds (inside the trained minutes, one row per contract per mark) */
  const thresholds = CUTS.map(th => {
    const pass = done.filter(l => inWin(l) && l.p1 >= th);
    const rets = pass.map(l => l.ret ?? 0);
    return { p1: th, n: pass.length, tp1: pass.length ? Number((pass.filter(l => l.tp1).length / pass.length).toFixed(3)) : 0, meanRet: rets.length ? Number((rets.reduce((a, b) => a + b, 0) / rets.length).toFixed(2)) : null };
  });
  const falsePositives = deps.reviews.filter(r => (r.after.pnl ?? 0) < 0).map(r => ({ contract: r.contract, book: r.book, would: r.would, pnl: r.after.pnl, cause: r.verdict.cause }));
  return {
    day,
    builtAt: Date.now(),
    sleeves,
    movers,
    missReasons: [...reasons].map(([gate, n]) => ({ gate, n })).sort((a, b) => b.n - a.n),
    heldDownMost: [...heldCount].map(([col, n]) => ({ col, name: INPUT_NAMES[col], n })).sort((a, b) => b.n - a.n).slice(0, 10),
    falsePositives,
    calibration,
    thresholds,
    suggestions: suggest(calibration, thresholds, movers, deps.reviews, labels),
    labels: labels.length,
    notes,
  };
}

/** Changes the day's numbers point at, each with its evidence and sample size. None is applied. */
function suggest(cal: StudyResult['calibration'], th: StudyResult['thresholds'], movers: readonly Mover[], reviews: readonly TradeReview[], labels: readonly Label[]): StudyResult['suggestions'] {
  const out: StudyResult['suggestions'] = [];
  const MIN_N = 200;
  const cur = th.find(t => Math.abs(t.p1 - P1_MIN) < 1e-9);
  const best = th.filter(t => t.n >= MIN_N && t.meanRet != null).sort((a, b) => (b.meanRet ?? 0) - (a.meanRet ?? 0))[0];
  if (best && cur && (best.meanRet ?? 0) <= 0) {
    out.push({ change: 'No threshold change: no Model 1 cut made money on this session', evidence: `Inside the trained minutes, every cut with ${MIN_N}+ rows had a negative mean Book A return (best ${(best.p1 * 100).toFixed(2)}%: ${best.meanRet}% on ${best.n} rows; at ${(P1_MIN * 100).toFixed(2)}%: ${cur.meanRet ?? '—'}% on ${cur.n}). Raising or lowering the bar does not fix that; the review's causes do.`, n: cur.n, applied: false });
  } else if (best && cur && Math.abs(best.p1 - P1_MIN) > 1e-9 && (best.meanRet ?? 0) > (cur.meanRet ?? 0)) {
    out.push({ change: `Model 1 threshold ${(P1_MIN * 100).toFixed(2)}% → ${(best.p1 * 100).toFixed(2)}%`, evidence: `Rows at or over ${(best.p1 * 100).toFixed(2)}% inside the trained minutes: ${best.n}, take-profit rate ${(best.tp1 * 100).toFixed(1)}%, mean Book A return ${best.meanRet}%. At ${(P1_MIN * 100).toFixed(2)}%: ${cur.n} rows, ${(cur.tp1 * 100).toFixed(1)}%, ${cur.meanRet}%. One session: weigh it with more. ${CUTS.length} cuts were tried on the same rows, so the best of them is biased up (multiple comparisons); advisory only.`, n: best.n, applied: false });
  } else if (cur) {
    out.push({ change: 'Keep the Model 1 threshold', evidence: `No other cut with ${MIN_N}+ rows beat ${(P1_MIN * 100).toFixed(2)}% on mean Book A return (${cur.n} rows, take-profit ${(cur.tp1 * 100).toFixed(1)}%, mean ${cur.meanRet ?? '—'}%).`, n: cur.n, applied: false });
  }
  const top = cal.filter(c => c.lo >= P1_MIN);
  const topN = top.reduce((a, c) => a + c.n, 0);
  const topRate = topN ? top.reduce((a, c) => a + c.tp1 * c.n, 0) / topN : 0;
  const lower = cal.filter(c => c.hi <= P1_MIN && c.n >= 100).sort((x, y) => y.tp1 - x.tp1)[0];
  if (topN) out.push({ change: 'Do not read Model 1 as a probability yet', evidence: `Rows scored at or over ${(P1_MIN * 100).toFixed(2)}% reached the 1.50× take-profit ${(topRate * 100).toFixed(1)}% of the time (${topN} rows)${lower ? `; the ${lower.bucket} bucket reached it ${(lower.tp1 * 100).toFixed(1)}% (${lower.n} rows)` : ''}. A higher score did not mean a likelier target on this session; the training rows are needed to say whether that is this day or the model.`, n: topN, applied: false });
  const spreadMiss = movers.filter(m => m.gate === 'spread over 8%' || m.gate === 'bid at or under $0.15').length;
  if (movers.length) out.push({ change: 'Spread and minimum-bid gates: review, do not loosen on one day', evidence: `${spreadMiss} of ${movers.length} contracts that made a 50%+ move were stopped by the spread or $0.15 bid gate before the model read them; most cheap wings that double also fail the spread.`, n: movers.length, applied: false });
  const early = labels.filter(l => l.t - 570 < 60 && l.t - 570 >= 15 && l.p1 >= P1_MIN && l.tp1 != null);
  const later = labels.filter(l => l.t - 570 >= 60 && l.t - 570 <= 330 && l.p1 >= P1_MIN && l.tp1 != null);
  if (early.length && later.length) {
    const rate = (xs2: readonly Label[]) => (xs2.filter(l => l.tp1).length / xs2.length) * 100;
    out.push({ change: 'Hold Book A/B before 10:30 ET until the range-compression input is defined there', evidence: `Before 10:30 the compression input is missing: Model 1 reads it as missing, and Model 2, which never saw it missing, is not scored then. Over the threshold, before 10:30: ${early.length} rows, take-profit ${rate(early).toFixed(1)}%; 10:30 to 15:00: ${later.length} rows, ${rate(later).toFixed(1)}%.`, n: early.length, applied: false });
  }
  const lost = reviews.filter(r => (r.after.pnl ?? 0) < 0 && r.book !== 'C');
  const byCause = new Map<string, number>();
  for (const r of lost) byCause.set(r.verdict.cause, (byCause.get(r.verdict.cause) ?? 0) + 1);
  if (lost.length) out.push({ change: 'Look at the losing Book A/B calls by cause before changing the exits', evidence: [...byCause].map(([c, n]) => `${c}: ${n}`).join(', '), n: lost.length, applied: false });
  return out;
}

/* ---- every session pooled ---- */

/** One labelled session as the pool reads it: its labels file, and its study when one was built. */
export interface StudyDay {
  day: string;
  labels: readonly Label[];
  study: Pick<StudyResult, 'missReasons' | 'movers'> | null;
}

/** A rate with its 95% interval (k of n). From the pool the interval is cluster-robust: see clusterRate. */
export interface Rate {
  n: number;
  k: number;
  rate: number;
  lo95: number;
  hi95: number;
  /** what the rows were clustered by ('session', or 'name-session' when the pool holds one session) */
  by?: 'session' | 'name-session';
  /** clusters in the rate */
  clusters?: number;
  /** effective independent rows: n over the design effect the clusters show (never above n) */
  nEff?: number;
}

/** The 95% Wilson score interval for k successes in n: honest at small n and at rates near 0 or 1. */
export function wilson(k: number, n: number, z = 1.959964): Rate {
  if (!(n > 0)) return { n: 0, k: 0, rate: 0, lo95: 0, hi95: 0 };
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  const r3 = (v: number) => Number(v.toFixed(4));
  return { n, k, rate: r3(p), lo95: r3(Math.max(0, mid - half)), hi95: r3(Math.min(1, mid + half)) };
}

/**
 * A rate over overlapping rows, with a cluster-robust Wilson interval. Five-minute rows are not independent: one
 * contract scored at ten marks of a session is one path, and every name of a session shares the tape. The variance
 * of k/n is estimated from the clusters (the ratio estimator's, with the C/(C-1) small-sample factor):
 *   V = C/(C-1) · Σ_c (k_c - p·n_c)² / n²
 * the effective row count is nEff = p(1-p)/V (at most n; when p is 0 or 1, the cluster count), and the interval is
 * Wilson's at nEff. Rows cluster by session; a pool of one session clusters by name and session (the overlap of one
 * name's rows is the bulk of the dependence there, but the day's shared tape is not covered: one session cannot
 * bound a rate). With fewer than two clusters the interval is 0 to 1.
 */
export function clusterRate(rows: readonly { won: boolean; cluster: string }[], by: 'session' | 'name-session', z = 1.959964): Rate {
  const n = rows.length;
  const k = rows.filter(r => r.won).length;
  if (!n) return { n: 0, k: 0, rate: 0, lo95: 0, hi95: 0, by, clusters: 0, nEff: 0 };
  const groups = new Map<string, { n: number; k: number }>();
  for (const r of rows) {
    const g = groups.get(r.cluster) ?? { n: 0, k: 0 };
    g.n += 1;
    if (r.won) g.k += 1;
    groups.set(r.cluster, g);
  }
  const C = groups.size;
  const p = k / n;
  const r4 = (v: number) => Number(v.toFixed(4));
  if (C < 2) return { n, k, rate: r4(p), lo95: 0, hi95: 1, by, clusters: C, nEff: 1 };
  let ss = 0;
  for (const g of groups.values()) ss += (g.k - p * g.n) ** 2;
  const V = (C / (C - 1)) * ss / (n * n);
  const nEff = p > 0 && p < 1 ? Math.min(n, V > 0 ? (p * (1 - p)) / V : n) : C;
  const w = wilson(p * nEff, nEff, z);
  return { n, k, rate: r4(p), lo95: w.lo95, hi95: w.hi95, by, clusters: C, nEff: Number(nEff.toFixed(1)) };
}

/** What reading Model 1 as a probability would need, from the pooled labels. Each bar is fixed here; meeting them
    all is evidence, not a switch: the "Unvalidated" label is the owner's to lift, after the input check. */
export const POOL_BAR = {
  /** labelled sessions: about a month of trading, so one regime or one news day cannot carry the table */
  sessions: 20,
  /** effective rows inside the trained minutes, in every Model 1 bucket (Rate.nEff, after the session clustering).
      400 independent rows would put a 20% rate's 95% interval at about ±3.9 points (1.96·√(0.2·0.8/400)), under the
      gap allowed; 400 overlapping 5-minute rows do not: a session's rows of one name move together, and their
      effective count is a fraction of the row count. */
  rowsPerBucket: 400,
  /** the most a bucket's take-profit rate may sit from its mean Model 1, in points */
  gapPoints: 5,
} as const;

export interface PooledStudy {
  day: 'all';
  builtAt: number;
  /** the labelled sessions pooled, oldest first */
  days: string[];
  labels: number;
  settled: number;
  movers: number;
  /** each session's line: its rows, the rows at or over the bar and how they did, its movers */
  sessions: {
    day: string;
    labels: number;
    settled: number;
    over: Rate;
    overMeanP1: number | null;
    overMeanRet: number | null;
    movers: number | null;
  }[];
  /** Model 1 bucket against the realised take-profit rate, every session's settled rows together */
  calibration: {
    bucket: string;
    lo: number;
    hi: number;
    all: Rate;
    hit50: number;
    /** inside the trained minutes: the rows the verdict reads */
    win: Rate;
    /** mean Model 1 of the in-window rows */
    meanP1: number | null;
    /** win.rate − meanP1, points (negative: the score promised more than happened) */
    gapPoints: number | null;
    /** sessions with an in-window row in the bucket */
    sessions: number;
  }[];
  thresholds: { p1: number; win: Rate; meanRet: number | null; sessions: number; upSessions: number }[];
  missReasons: { gate: Gate; n: number; sessions: number }[];
  heldDownMost: { col: number; name: string; n: number; sessions: number }[];
  /** the inputs most often holding movers down, session by session (movers held down by each, of those scored under the bar) */
  inputsOverTime: { cols: { col: number; name: string }[]; rows: { day: string; under: number; n: number[] }[] };
  verdict: {
    ready: boolean;
    line: string;
    needs: { what: string; have: string; need: string; met: boolean }[];
  };
  notes: string[];
}

const meanOf = (xs2: readonly number[]) => (xs2.length ? xs2.reduce((a, b) => a + b, 0) / xs2.length : null);

/** Every labelled session pooled: the calibration with 95% intervals, the threshold sweep, the miss reasons, the
    inputs over time, and a plain verdict on reading Model 1 as a probability. */
export function poolStudies(input: readonly StudyDay[], builtAt = Date.now()): PooledStudy {
  const days = [...input].filter(d => d.labels.length > 0).sort((a, b) => a.day.localeCompare(b.day));
  const notes: string[] = [];
  const done: (Label & { day: string })[] = [];
  for (const d of days) for (const l of d.labels) if (l.tp1 != null) done.push({ ...l, day: d.day });
  /* the rows cluster by session; one session's rows cluster by name and session */
  const by: 'session' | 'name-session' = days.length >= 2 ? 'session' : 'name-session';
  const rateOf = (ls: readonly (Label & { day: string })[]) => clusterRate(ls.map(l => ({ won: !!l.tp1, cluster: by === 'session' ? l.day : `${l.day}|${tickerOf(l.k)}` })), by);

  const calibration = BUCKETS.map(([lo, hi]) => {
    const inB = done.filter(l => l.p1 >= lo && l.p1 < hi);
    const w = inB.filter(inWin);
    const win = rateOf(w);
    const m = meanOf(w.map(l => l.p1));
    return {
      bucket: bucketName(lo, hi),
      lo,
      hi,
      all: rateOf(inB),
      hit50: inB.length ? Number((inB.filter(l => l.hit50).length / inB.length).toFixed(4)) : 0,
      win,
      meanP1: m == null ? null : Number(m.toFixed(4)),
      gapPoints: m == null ? null : Number(((win.k / win.n - m) * 100).toFixed(2)),
      sessions: new Set(w.map(l => l.day)).size,
    };
  });

  const thresholds = CUTS.map(th => {
    const pass = done.filter(l => inWin(l) && l.p1 >= th);
    const byDay = new Map<string, number[]>();
    for (const l of pass) byDay.set(l.day, [...(byDay.get(l.day) ?? []), l.ret ?? 0]);
    const m = meanOf(pass.map(l => l.ret ?? 0));
    return {
      p1: th,
      win: rateOf(pass),
      meanRet: m == null ? null : Number(m.toFixed(2)),
      sessions: byDay.size,
      upSessions: [...byDay.values()].filter(r => (meanOf(r) ?? 0) > 0).length,
    };
  });

  const sessions = days.map(d => {
    const settled = d.labels.filter(l => l.tp1 != null);
    const over = settled.filter(l => inWin(l) && l.p1 + 1e-12 >= P1_MIN);
    const mp = meanOf(over.map(l => l.p1));
    const mr = meanOf(over.map(l => l.ret ?? 0));
    return {
      day: d.day,
      labels: d.labels.length,
      settled: settled.length,
      over: clusterRate(over.map(l => ({ won: !!l.tp1, cluster: `${d.day}|${tickerOf(l.k)}` })), 'name-session'),
      overMeanP1: mp == null ? null : Number(mp.toFixed(4)),
      overMeanRet: mr == null ? null : Number(mr.toFixed(2)),
      movers: d.study ? d.study.movers.length : null,
    };
  });

  const reasons = new Map<Gate, { n: number; days: Set<string> }>();
  const held = new Map<number, { n: number; days: Set<string> }>();
  const heldByDay = new Map<string, Map<number, number>>();
  const underByDay = new Map<string, number>();
  for (const d of days) {
    if (!d.study) {
      notes.push(`${d.day}: labels without a study; its movers are not counted.`);
      continue;
    }
    for (const r of d.study.missReasons) {
      const e = reasons.get(r.gate) ?? { n: 0, days: new Set<string>() };
      e.n += r.n;
      e.days.add(d.day);
      reasons.set(r.gate, e);
    }
    const mine = new Map<number, number>();
    for (const m of d.study.movers) {
      for (const h of m.heldDown) {
        mine.set(h.col, (mine.get(h.col) ?? 0) + 1);
        const e = held.get(h.col) ?? { n: 0, days: new Set<string>() };
        e.n += 1;
        e.days.add(d.day);
        held.set(h.col, e);
      }
    }
    heldByDay.set(d.day, mine);
    underByDay.set(d.day, d.study.movers.filter(m => m.gate === 'Model 1 under the threshold').length);
  }
  const heldDownMost = [...held].map(([col, e]) => ({ col, name: INPUT_NAMES[col], n: e.n, sessions: e.days.size })).sort((a, b) => b.n - a.n || a.col - b.col).slice(0, 10);
  const top = heldDownMost.slice(0, 6).map(h => ({ col: h.col, name: h.name }));
  const inputsOverTime = {
    cols: top,
    rows: days.filter(d => heldByDay.has(d.day)).map(d => ({ day: d.day, under: underByDay.get(d.day) ?? 0, n: top.map(c => heldByDay.get(d.day)?.get(c.col) ?? 0) })),
  };

  /* the verdict: every bar, what the pool has against it */
  const effOf = (r: Rate) => r.nEff ?? r.n;
  const full = calibration.filter(c => effOf(c.win) >= POOL_BAR.rowsPerBucket);
  const thin = calibration.filter(c => effOf(c.win) < POOL_BAR.rowsPerBucket);
  const minRows = calibration.reduce((a, c) => Math.min(a, effOf(c.win)), Infinity);
  const worst = full.filter(c => c.gapPoints != null).sort((a, b) => Math.abs(b.gapPoints!) - Math.abs(a.gapPoints!))[0] ?? null;
  const reversals: string[] = [];
  for (let i = 1; i < full.length; i++) {
    const a = full[i - 1];
    const b = full[i];
    if (b.win.hi95 < a.win.lo95) reversals.push(`${b.bucket} below ${a.bucket}`);
  }
  const needs = [
    { what: 'Labelled sessions', have: String(days.length), need: `${POOL_BAR.sessions} or more`, met: days.length >= POOL_BAR.sessions },
    {
      what: 'Effective settled rows in every Model 1 bucket, 09:45–15:00 ET (clustered by session)',
      have: Number.isFinite(minRows) ? `fewest ${Math.floor(minRows).toLocaleString('en-US')}${thin.length ? ` (${thin.map(c => c.bucket).join(', ')} short)` : ''}` : 'none',
      need: `${POOL_BAR.rowsPerBucket} or more each`,
      met: thin.length === 0,
    },
    {
      what: 'Take-profit rate within a few points of the mean score, in every full bucket',
      have: worst ? `worst ${worst.bucket}: ${(worst.win.rate * 100).toFixed(1)}% took vs ${(worst.meanP1! * 100).toFixed(1)}% scored (${worst.gapPoints! > 0 ? '+' : worst.gapPoints! < 0 ? '−' : ''}${Math.abs(worst.gapPoints!).toFixed(1)} pts)` : 'no full bucket',
      need: `within ±${POOL_BAR.gapPoints} pts`,
      met: !!worst && full.length === calibration.length && Math.abs(worst.gapPoints!) <= POOL_BAR.gapPoints,
    },
    {
      what: 'A higher bucket never takes profit clearly less often than the one below',
      have: full.length < 2 ? 'too few full buckets to tell' : reversals.length ? `${reversals.length}: ${reversals.slice(0, 3).join('; ')}` : 'none',
      need: 'no reversal outside the 95% intervals',
      met: full.length >= 2 && reversals.length === 0,
    },
  ];
  const ready = needs.every(n => n.met);
  const over = calibration.filter(c => c.lo >= P1_MIN);
  const overWin = rateOf(done.filter(l => inWin(l) && l.p1 >= P1_MIN));
  const overMean = meanOf(done.filter(l => inWin(l) && l.p1 >= P1_MIN).map(l => l.p1));
  const evidence = overWin.n
    ? ` Rows scored at or over ${(P1_MIN * 100).toFixed(2)}% (mean ${((overMean ?? 0) * 100).toFixed(1)}%) took the 1.50× profit ${(overWin.rate * 100).toFixed(1)}% of the time (95%: ${(overWin.lo95 * 100).toFixed(1)}–${(overWin.hi95 * 100).toFixed(1)}%, clustered by ${by}; ${overWin.n.toLocaleString('en-US')} rows, about ${Math.floor(overWin.nEff ?? overWin.n).toLocaleString('en-US')} effective, ${days.length} session${days.length === 1 ? '' : 's'}).`
    : '';
  const line = !days.length
    ? 'No: no session has been labelled yet.'
    : ready
      ? `The pooled labels meet every bar below.${evidence} That supports reading Model 1 as a take-profit probability on these rules; the “Unvalidated” label stays until the owner lifts it after the input check.`
      : `No: the evidence does not support reading Model 1 as a probability yet (${needs.filter(n => !n.met).length} of ${needs.length} bars unmet).${evidence}`;
  if (days.length) notes.push(`The threshold sweep tries ${CUTS.length} cuts on the same rows: the best of them is biased up by the choice (multiple comparisons). It is advisory; a new threshold needs sessions it was not chosen on.`);
  return {
    day: 'all',
    builtAt,
    days: days.map(d => d.day),
    labels: days.reduce((a, d) => a + d.labels.length, 0),
    settled: done.length,
    movers: days.reduce((a, d) => a + (d.study?.movers.length ?? 0), 0),
    sessions,
    calibration,
    thresholds,
    missReasons: [...reasons].map(([gate, e]) => ({ gate, n: e.n, sessions: e.days.size })).sort((a, b) => b.n - a.n),
    heldDownMost,
    inputsOverTime,
    verdict: { ready, line, needs },
    notes,
  };
}

export { sigmoid };
