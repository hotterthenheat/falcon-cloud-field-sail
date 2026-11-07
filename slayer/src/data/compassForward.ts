/* The forward test, from the record's own fills (data/compassTwins.ts): every closed Model 1 and Model 3 call against
   its random-side twin (same instant, same contract rule, the other side) and against a coin flip between the two.
   The research protocol's live shadow (research/edge0dte/PROTOCOL.md §6 baselines, §7: 15 sessions) asks exactly this:
   does the side the model chose beat the side it did not, by more than chance, after the round trip.

   Inference clusters by session day (a day's calls move together): every interval is a day-clustered bootstrap, 2,000
   resamples of days, 95% percentile, with a fixed seed so the page and the export agree. Below SMALL_N closed calls a
   rate is shown as counts ("5 of 14"), never as a percentage. P&L is (exit − fill) × 100 a contract, no fees, as the
   record reads it. Nothing here is a model score. */

import type { Signal } from './compassLedger';
import type { Twin } from './compassTwins';
import { modelWordOf } from './compassParams';

/** Below this many closed calls a rate is shown as counts, not as a percentage. */
export const SMALL_N = 30;
/** Fewer sessions than this and no interval is drawn: resampling two or three days says almost nothing. */
export const MIN_SESSIONS = 5;
/** PROTOCOL §7: the live shadow runs 15 sessions. */
export const SHADOW_SESSIONS = 15;
export const RESAMPLES = 2000;

/** A seeded uniform draw (mulberry32): resampling only, never a market value. */
function draws(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The mean of `values` and its day-clustered bootstrap 95% interval (resampling whole days with replacement; the mean
    over every item of the drawn days). Null interval with fewer than MIN_SESSIONS days. */
export function clusteredMean(items: readonly { day: string; v: number }[], resamples = RESAMPLES, seed = 7): { mean: number | null; lo: number | null; hi: number | null } {
  if (!items.length) return { mean: null, lo: null, hi: null };
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const it of items) {
    const d = byDay.get(it.day) ?? { sum: 0, n: 0 };
    d.sum += it.v;
    d.n += 1;
    byDay.set(it.day, d);
  }
  const days = [...byDay.values()];
  const mean = items.reduce((s, it) => s + it.v, 0) / items.length;
  if (days.length < MIN_SESSIONS) return { mean, lo: null, hi: null };
  const rnd = draws(seed);
  const stats: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < days.length; i++) {
      const d = days[Math.floor(rnd() * days.length)];
      sum += d.sum;
      n += d.n;
    }
    stats.push(sum / n);
  }
  stats.sort((a, b) => a - b);
  const at = (q: number) => stats[Math.min(stats.length - 1, Math.max(0, Math.floor(q * stats.length)))];
  return { mean, lo: at(0.025), hi: at(0.975) };
}

export interface SideStat {
  /** Closed calls in the slice */
  n: number;
  /** Sessions they came from */
  days: number;
  won: number;
  lost: number;
  /** Net P&L, dollars a contract */
  net: number;
  /** Win rate (0–1) with its day-clustered interval */
  win: { mean: number | null; lo: number | null; hi: number | null };
  /** Net expectancy, dollars a contract a call, with its interval */
  perCall: { mean: number | null; lo: number | null; hi: number | null };
  /** Net expectancy, percent of the premium paid, with its interval */
  perPremium: { mean: number | null; lo: number | null; hi: number | null };
}

const closedPnl = (s: Signal | null | undefined) => (s?.outcome?.status === 'closed' && s.outcome.pnl != null && s.outcome.fill ? s.outcome : null);

/** `w`, when given, is the row's share of a win (a coin flip between a winner and a loser wins half a time). */
function sideStat(rows: readonly { day: string; pnl: number; ret: number; w?: number }[], seed: number): SideStat {
  const winOf = (r: { pnl: number; w?: number }) => r.w ?? (r.pnl > 0 ? 1 : 0);
  const won = rows.reduce((s, r) => s + winOf(r), 0);
  return {
    n: rows.length,
    days: new Set(rows.map(r => r.day)).size,
    won,
    lost: rows.length - won,
    net: Math.round(rows.reduce((s, r) => s + r.pnl, 0) * 100) / 100,
    win: clusteredMean(rows.map(r => ({ day: r.day, v: winOf(r) })), RESAMPLES, seed),
    perCall: clusteredMean(rows.map(r => ({ day: r.day, v: r.pnl })), RESAMPLES, seed + 1),
    perPremium: clusteredMean(rows.map(r => ({ day: r.day, v: r.ret })), RESAMPLES, seed + 2),
  };
}

export interface ForwardLine {
  /** "Model 1", "Model 3", or "Model 1 and 3" */
  label: string;
  /** Every closed call in the slice */
  calls: SideStat;
  /** The closed calls whose twin also closed, and those twins */
  paired: SideStat;
  twins: SideStat;
  /** A coin flip between each paired call and its twin: the average of the two, a contract; its wins are the
      expected count (half of each pair's wins) */
  coin: SideStat;
  /** Call minus twin, dollars a contract a pair, with its interval: the side choice's own worth */
  edge: { mean: number | null; lo: number | null; hi: number | null };
  /** Of RESAMPLES coin-flip records over the same pairs (one flip a session), how many the calls' total beat
      (strictly); null under MIN_SESSIONS sessions */
  beatsCoin: number | null;
  /** Closed calls whose twin has no result yet, or none (no contract, no quote) */
  unpaired: number;
}

export interface ForwardTest {
  lines: ForwardLine[];
  /** Sessions with a closed call, against the shadow's 15 */
  sessions: number;
  target: number;
}

const retOf = (o: { ret: number | null; pnl: number | null; fill: { ask: number } | null }) =>
  o.ret != null ? o.ret : o.fill && o.fill.ask > 0 && o.pnl != null ? (o.pnl / (o.fill.ask * 100)) * 100 : 0;

function line(label: string, calls: readonly Signal[], twinOf: ReadonlyMap<string, Twin>, seed: number): ForwardLine {
  const closed = calls.filter(c => closedPnl(c));
  const pairs = closed.flatMap(c => {
    const t = twinOf.get(c.key);
    const co = closedPnl(c)!;
    const to = closedPnl(t);
    return to ? [{ day: c.day, c: { pnl: co.pnl!, ret: retOf(co) }, t: { pnl: to.pnl!, ret: retOf(to) } }] : [];
  });
  /* the coin is flipped once a session for all of that session's pairs (a day's calls move together: flipping each
     pair alone would read a single trending day as many independent wins) */
  const rnd = draws(seed + 99);
  const actual = pairs.reduce((s, p) => s + p.c.pnl, 0);
  const sessions = new Map<string, { c: number; t: number }>();
  for (const p of pairs) {
    const d = sessions.get(p.day) ?? { c: 0, t: 0 };
    d.c += p.c.pnl;
    d.t += p.t.pnl;
    sessions.set(p.day, d);
  }
  let beats = 0;
  for (let b = 0; b < RESAMPLES; b++) {
    let total = 0;
    for (const d of sessions.values()) total += rnd() < 0.5 ? d.c : d.t;
    if (actual > total + 1e-9) beats += 1;
  }
  return {
    label,
    calls: sideStat(closed.map(c => ({ day: c.day, pnl: closedPnl(c)!.pnl!, ret: retOf(closedPnl(c)!) })), seed),
    paired: sideStat(pairs.map(p => ({ day: p.day, ...p.c })), seed + 10),
    twins: sideStat(pairs.map(p => ({ day: p.day, ...p.t })), seed + 20),
    coin: sideStat(pairs.map(p => ({ day: p.day, pnl: (p.c.pnl + p.t.pnl) / 2, ret: (p.c.ret + p.t.ret) / 2, w: ((p.c.pnl > 0 ? 1 : 0) + (p.t.pnl > 0 ? 1 : 0)) / 2 })), seed + 30),
    edge: clusteredMean(pairs.map(p => ({ day: p.day, v: p.c.pnl - p.t.pnl })), RESAMPLES, seed + 40),
    beatsCoin: sessions.size >= MIN_SESSIONS ? beats : null,
    unpaired: closed.length - pairs.length,
  };
}

/** The forward test over the record: Model 1, Model 3 and both together. Model Risk is not in it (off by default; its
    own research closed it). */
export function forwardTest(calls: readonly Signal[], twins: readonly Twin[]): ForwardTest {
  const official = calls.filter(c => (c.book === 'A' || c.book === 'B' || c.book === 'C') && !c.would);
  const twinOf = new Map(twins.map(t => [t.twinOf, t]));
  const one = official.filter(c => c.book !== 'C');
  const three = official.filter(c => c.book === 'C');
  return {
    lines: [line('Model 1', one, twinOf, 11), line('Model 3', three, twinOf, 21), line('Model 1 and 3', official, twinOf, 31)],
    sessions: new Set(official.filter(c => closedPnl(c)).map(c => c.day)).size,
    target: SHADOW_SESSIONS,
  };
}

/** A rate as a reader sees it: counts below SMALL_N closed calls or MIN_SESSIONS sessions ("5 of 14 (interval
    2–9)"), a percentage at or above both. */
export function rateWords(s: SideStat): string {
  if (!s.n) return '—';
  const { lo, hi } = s.win;
  if (s.n < SMALL_N || s.days < MIN_SESSIONS) {
    const band = lo != null && hi != null ? ` (interval ${Math.round(lo * s.n)}–${Math.round(hi * s.n)})` : '';
    return `${Number.isInteger(s.won) ? s.won : s.won.toFixed(1)} of ${s.n}${band}`;
  }
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  return `${pct(s.won / s.n)}${lo != null && hi != null ? ` (95%: ${pct(lo)}–${pct(hi)})` : ''}`;
}

const csvCell = (v: unknown): string => {
  const t = v == null ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const clock = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : '');

/** The forward test as rows, one per official call with its twin: the export. Fees are not in it (the record has none);
    every price is a recorded quote. */
export function forwardCsv(calls: readonly Signal[], twins: readonly Twin[]): string {
  const twinOf = new Map(twins.map(t => [t.twinOf, t]));
  const head = [
    'day', 'called_utc', 'model', 'ticker', 'contract', 'expiry', 'quote_bid', 'quote_ask', 'fill_utc', 'fill_ask', 'exit_utc', 'exit_px', 'exit_why',
    'pnl_per_contract', 'return_pct', 'result',
    'twin_contract', 'twin_fill_ask', 'twin_exit_px', 'twin_exit_why', 'twin_pnl_per_contract', 'twin_return_pct', 'twin_result',
    'coin_flip_pnl_per_contract', 'call_minus_twin',
    'needs_level', 'needs_by_utc', 'needs_priced_moves', 'mean_move_needed', 'round_trip', 'chosen_by', 'score_rule_pick',
  ];
  const result = (s: Signal | undefined) => {
    const o = s?.outcome;
    if (!o) return 'waiting';
    if (o.status !== 'closed') return o.status;
    return (o.pnl ?? 0) > 0 ? 'won' : 'lost';
  };
  const lines = calls
    .filter(c => (c.book === 'A' || c.book === 'B' || c.book === 'C') && !c.would)
    .sort((a, b) => a.firedAt - b.firedAt)
    .map(c => {
      const o = c.outcome;
      const t = twinOf.get(c.key);
      const to = t?.outcome;
      const both = closedPnl(c) && closedPnl(t);
      const cp = o?.pnl ?? null;
      const tp = to?.pnl ?? null;
      return [
        c.day, clock(c.firedAt), modelWordOf(c), c.ticker, c.contract, c.expiry, c.bid, c.ask, clock(o?.fill?.at), o?.fill?.ask ?? '', clock(o?.exit?.at), o?.exit?.px ?? '', o?.exit?.why ?? '',
        cp ?? '', o?.ret ?? '', result(c),
        t ? (t.none ? `none: ${t.none}` : t.contract) : '', to?.fill?.ask ?? '', to?.exit?.px ?? '', to?.exit?.why ?? '', tp ?? '', to?.ret ?? '', t ? result(t) : 'not made yet',
        both && cp != null && tp != null ? Math.round(((cp + tp) / 2) * 100) / 100 : '', both && cp != null && tp != null ? Math.round((cp - tp) * 100) / 100 : '',
        c.cost ? c.cost.level.toFixed(4) : '', clock(c.cost?.by), c.cost ? c.cost.z.toFixed(4) : '', c.cost ? c.cost.mu.toFixed(4) : '', c.cost?.roundTrip ?? '', c.cost?.rule ?? '', c.cost?.scorePick ?? '',
      ].map(csvCell).join(',');
    });
  return [head.join(','), ...lines].join('\n') + '\n';
}
