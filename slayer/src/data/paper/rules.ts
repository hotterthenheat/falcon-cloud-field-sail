/* A paper account's rules, as data, and the pure functions that judge an account by them. Options only: a prop firm's
   evaluation on an options account (propFirms.ts holds each firm's plans, with the page they come from), or the
   reader's own. Every rule is a field that is either set or off (null / true), so a plan is a list of numbers, never
   code. The engine (engine.ts) asks:

   - `ruleRefusal`  before a buy is taken, and again when a resting buy would fill: the hard rule it would break, or null.
   - `judgeTick`    on every tick of the live market: a floor or a day's limit reached (fail, or the day is over).
   - `judgeRoll`    at the day's roll (17:00 ET): the day's close sets an end-of-day trailing floor; the target, the days,
                    the best-day rule and the time limit are judged — pass, the next phase, or fail.
   - `mustBeFlat`   on every tick: what has to be closed now (flat-by time, no overnight, no weekend, no earnings).
   - `readRules`    the live progress of every rule, with the room left, for the desk and the Accounts page.

   A sell (a way out) is never refused by a rule. */

import type { ContractId } from '../review/quotes';
import { contractKey, legsOf } from '../review/quotes';
import { MULT } from '../review/engine';
import { addDays, dateAt, dayEndsAt, nyAt, nyInstant, sessionFrom } from './clock';
import type { PaperAccount, PaperMarket, PaperView, OptDraft } from './engine';

/* ================================================================== */
/*  THE SHAPE OF A PLAN                                                */
/* ================================================================== */

export type DrawdownMode = 'static' | 'eod' | 'intraday';
/** When a name reports, as far as the market knows: null — it does not (a fund, an index, none on the calendar) */
export type EarningsWhen = { date: string; slot: 'BMO' | 'AMC' | null } | null;

export interface PropRules {
  /** One entry a phase, in order. `target`: the profit over the phase's start that passes it (null: no target). */
  phases: { name: string; target: number | null }[];
  /** The most a day may lose, measured on what the account is worth (open trades in) against the day's start:
      its balance (closed trades only), its worth, or the higher of the two. `breach`: the account fails, or the day is
      over (everything closed, no new positions until the next trading day). */
  dailyLoss: { amount: number; from: 'balance' | 'equity' | 'higher'; breach: 'fail' | 'pause' } | null;
  /** The most the account may lose in all, from a high mark: the start (static), the best day's close (eod), or the
      best moment, open trades in (intraday). `lockAt`: the floor stops trailing once it reaches the phase's start plus
      this many dollars (0: at the start) — null: it trails for good. */
  drawdown: { amount: number; mode: DrawdownMode; lockAt: number | null } | null;
  /** Trading days with at least one fill before the target counts */
  minDays: number | null;
  /** Calendar days a phase may run */
  timeLimitDays: number | null;
  /** The best day's profit at most this share of the phase's profit (0.3 = 30%) — the pass waits until it holds */
  consistency: number | null;
  /** Contracts open at once, every position and every resting buy together (a spread counts both legs) */
  maxContracts: number | null;
  /** The most one position may cost, premium and fees */
  maxPositionCost: number | null;
  /** Positions open at once */
  maxOpenPositions: number | null;
  /** The most that may be tied up in premium at once, every position and every resting buy together */
  buyingPower: number | null;
  /** The names that may be traded — null: any listed name */
  underlyings: string[] | null;
  /** Debit spreads allowed (the desk only ever buys: long calls, long puts, debit spreads) */
  spreads: boolean;
  /** A contract expiring today may be bought */
  zeroDte: boolean;
  /** "15:55" — flat by this New York time every trading day; null: no daily flat time */
  flatBy: string | null;
  /** May a position be held past the close into the next session */
  overnight: boolean;
  /** …and over a weekend or a market holiday */
  weekend: boolean;
  /** …and through the underlying's earnings report */
  earnings: boolean;
  /** Dollars a contract, each way — null: the house's $0.65 */
  fee: number | null;
}

/** A plan an account is started on: a firm's (propFirms.ts), the reader's own, or one kept from an older version */
export interface PaperPlan {
  id: string;
  /** The plan's size, as the firm names it ("50K") */
  label: string;
  /** The firm — null for the reader's own rules */
  firm: string | null;
  /** The firm's name for the program ("Options evaluation") */
  program?: string;
  size: number;
  rules: PropRules;
  /** Where the numbers come from, and the date they were read — every firm plan carries it */
  source: { url: string; asOf: string } | null;
  /** A plan from before options-only (a futures evaluation): kept so its account loads, never traded */
  legacy?: 'futures';
  /** Rules the firm states that this engine does not check — said beside the plan, never silently dropped */
  notModelled?: string[];
}

/** No rule at all: the plain practice account (cash is the only limit) */
export const NO_RULES: PropRules = {
  phases: [],
  dailyLoss: null,
  drawdown: null,
  minDays: null,
  timeLimitDays: null,
  consistency: null,
  maxContracts: null,
  maxPositionCost: null,
  maxOpenPositions: null,
  buyingPower: null,
  underlyings: null,
  spreads: true,
  zeroDte: true,
  flatBy: null,
  overnight: true,
  weekend: true,
  earnings: true,
  fee: null,
};

/* ================================================================== */
/*  SMALL THINGS                                                       */
/* ================================================================== */

const cents = (v: number) => Math.round(v * 100) / 100;
const money = (v: number, dp = 0) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const EPS = 1e-9;
/** "15:55" → minutes after New York's midnight */
const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
/** The minute a position is closed when it may not be held past the close and no flat-by time is set: a minute before
    the 16:00 bell, so the close fills on the session's own quotes */
export const BEFORE_BELL = '15:59';

export const rulesOf = (a: PaperAccount): PropRules | null => (a.kind === 'evaluation' && a.plan && !a.plan.legacy ? a.plan.rules : null);

/** The phase the account is in: its name, its target, and what it started from */
export function phaseOf(a: PaperAccount): { index: number; count: number; name: string; target: number | null; base: number; day: string; at: number } {
  const r = rulesOf(a);
  const index = a.phase ?? 0;
  const p = r?.phases[index];
  return {
    index,
    count: r?.phases.length ?? 0,
    name: p?.name ?? '',
    target: p?.target ?? null,
    base: a.phaseStart?.equity ?? a.startCash,
    day: a.phaseStart?.day ?? Object.keys(a.ledger).sort()[0] ?? a.day,
    at: a.phaseStart?.at ?? a.createdAt,
  };
}

/** The floor the drawdown rule puts under the account now — or null where it has none */
export function floorOf(a: PaperAccount): number | null {
  const d = rulesOf(a)?.drawdown;
  if (!d) return null;
  const base = phaseOf(a).base;
  if (d.mode === 'static') return cents(base - d.amount);
  const trailed = a.peak - d.amount;
  return cents(d.lockAt == null ? trailed : Math.min(trailed, base + d.lockAt));
}
/** Has the trailing floor stopped where it locks */
export function floorLocked(a: PaperAccount): boolean {
  const d = rulesOf(a)?.drawdown;
  if (!d || d.mode === 'static' || d.lockAt == null) return false;
  return a.peak - d.amount >= phaseOf(a).base + d.lockAt - EPS;
}
/** What the day's loss is measured from, and the day's floor */
export function dayFloorOf(a: PaperAccount): { from: number; floor: number } | null {
  const d = rulesOf(a)?.dailyLoss;
  if (!d) return null;
  const day = a.ledger[a.day];
  const eq = day?.open ?? a.startCash;
  const bal = day?.bal ?? eq;
  const from = d.from === 'balance' ? bal : d.from === 'equity' ? eq : Math.max(bal, eq);
  return { from, floor: cents(from - d.amount) };
}
/** Trading days with a fill, since the phase began */
export function daysTraded(a: PaperAccount): string[] {
  const from = phaseOf(a).at;
  const days = new Set<string>();
  for (const f of a.opt.fills) if (f.at.at >= from && f.how !== 'expired') days.add(f.at.day);
  return [...days].sort();
}
/** Each closed day's result since the phase began, and today's as it stands */
function dayResults(a: PaperAccount, v: PaperView): { best: number; profit: number } {
  const ph = phaseOf(a);
  let best = 0;
  for (const [day, d] of Object.entries(a.ledger)) if (day >= ph.day && d.close != null) best = Math.max(best, d.close - d.open);
  best = Math.max(best, v.equity - (a.ledger[a.day]?.open ?? ph.base));
  return { best: cents(best), profit: cents(v.equity - ph.base) };
}
/** The calendar days a phase has run, counting its first */
const daysRun = (a: PaperAccount, now: number): number => Math.max(1, Math.round((dateAt(nyAt(now).date).getTime() - dateAt(nyAt(phaseOf(a).at).date).getTime()) / 86_400_000) + 1);

/** The next session after a trading day */
const nextSession = (day: string): string => sessionFrom(addDays(day, 1));
/** Does a weekend or a market holiday fall between this session and the next */
export const breakFollows = (day: string): boolean => nextSession(day) !== addDays(day, 1);

/** When a position must be closed on a trading day — and why — or null where it may be held on. `name`: the
    position's underlying (for its earnings). */
export function flatTimeOf(a: PaperAccount, day: string, name: string | null, m: Pick<PaperMarket, 'earnings'>): { at: number; why: string; rule: RuleId } | null {
  const r = rulesOf(a);
  if (!r) return null;
  const out: { at: number; why: string; rule: RuleId }[] = [];
  const bell = (why: string, rule: RuleId) => out.push({ at: nyInstant(day, minutesOf(BEFORE_BELL)), why, rule });
  if (r.flatBy) out.push({ at: nyInstant(day, minutesOf(r.flatBy)), why: `flat by ${r.flatBy} ET`, rule: 'flat' });
  if (!r.overnight) bell('nothing is held past the close', 'overnight');
  else if (!r.weekend && breakFollows(day)) bell('nothing is held over the weekend or a market holiday', 'weekend');
  if (!r.earnings && name) {
    const e = m.earnings?.(name);
    /* the session a report lands before: the report day itself for one after the close (or with no time given), the
       session before it for one before the open */
    if (e && (e.slot === 'BMO' ? nextSession(day) === e.date || (e.date > day && e.date < nextSession(day)) : e.date === day)) bell(`${name} reports earnings ${e.slot === 'BMO' ? 'before the next open' : 'after today’s close'}`, 'earnings');
  }
  if (!out.length) return null;
  return out.sort((x, y) => x.at - y.at)[0];
}

/* ================================================================== */
/*  WHAT A BUY WOULD BREAK                                             */
/* ================================================================== */

export type RuleId = 'target' | 'daily' | 'drawdown' | 'days' | 'time' | 'consistency' | 'contracts' | 'cost' | 'open' | 'bp' | 'names' | 'spreads' | '0dte' | 'flat' | 'overnight' | 'weekend' | 'earnings' | 'fee';

/** Contracts a position or an order is, a leg each */
const legsQty = (c: ContractId, qty: number) => qty * legsOf(c);

/** The hard rule a buy would break, in words — null where it breaks none. `px`: what it would pay a contract. */
export function ruleRefusal(a: PaperAccount, m: PaperMarket, d: OptDraft, v: PaperView, px: number, except?: string): string | null {
  if (a.status !== 'open') return a.kind === 'evaluation' ? `This account is over — it ${a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'was ended'}` : 'This account is closed';
  const r = rulesOf(a);
  if (!r) return null;
  if (a.dayOver && a.dayOver.day === a.day) return `The day’s loss limit was reached (${a.dayOver.why}) — no new positions until the next trading day`;
  const name = d.contract.ticker.toUpperCase();
  if (r.underlyings && !r.underlyings.includes(name)) return `This plan trades ${r.underlyings.join(', ')} only`;
  if (d.contract.short != null && !r.spreads) return 'This plan does not allow spreads — single calls and puts only';
  if (!r.zeroDte && d.contract.expiry === nyAt(m.now).date) return 'This plan does not allow contracts that expire today (0DTE)';
  const flat = flatTimeOf(a, a.day, name, m);
  if (flat && m.now >= flat.at && m.now < dayEndsAt(a.day)) return `It is past the flat time — ${flat.why}. New positions open again in the next session`;
  if (!r.earnings && m.earnings && m.earnings(name) === undefined) return `${name}’s earnings date is not loaded yet — this plan does not allow holding through a report`;
  /* what is open and what is resting, with this buy */
  const pending = a.opt.orders.filter(o => o.status === 'working' && o.side === 'buy' && o.id !== except);
  const key = contractKey(d.contract);
  if (r.maxContracts != null) {
    const n = v.opt.reduce((x, p) => x + legsQty(p.contract, p.qty), 0) + pending.reduce((x, o) => x + legsQty(o.contract, o.qty), 0) + legsQty(d.contract, d.qty);
    if (n > r.maxContracts + EPS) return `No more than ${r.maxContracts} contracts open at once on this plan — this would be ${n}`;
  }
  if (r.maxOpenPositions != null) {
    const keys = new Set([...v.opt.map(p => p.key), ...pending.map(o => contractKey(o.contract)), key]);
    if (keys.size > r.maxOpenPositions) return `No more than ${r.maxOpenPositions} ${r.maxOpenPositions === 1 ? 'position' : 'positions'} open at once on this plan`;
  }
  const fee = (a.sandbox ? 0 : a.fee) * legsQty(d.contract, d.qty);
  const cost = px * MULT * d.qty + fee;
  if (r.maxPositionCost != null) {
    const held = v.opt.find(p => p.key === key);
    const same = (held ? held.avg * MULT * held.qty + held.fees : 0) + pending.filter(o => contractKey(o.contract) === key).reduce((x, o) => x + (o.price ?? 0) * MULT * o.qty, 0) + cost;
    if (same > r.maxPositionCost + EPS) return `One position may cost no more than ${money(r.maxPositionCost)} on this plan — this would be ${money(same, 2)}`;
  }
  if (r.buyingPower != null) {
    const tied = v.opt.reduce((x, p) => x + p.avg * MULT * p.qty + p.fees, 0) + pending.reduce((x, o) => x + (o.price ?? 0) * MULT * o.qty, 0) + cost;
    if (tied > r.buyingPower + EPS) return `No more than ${money(r.buyingPower)} tied up in premium at once on this plan — this would be ${money(tied, 2)}`;
  }
  /* the buy itself costs the spread to the mid and the fee at once: never let that alone put the account through a floor */
  const q = m.optQuote(d.contract);
  if (Number.isFinite(q.mark) && Number.isFinite(v.equity)) {
    const after = v.equity - Math.max(0, px - q.mark) * MULT * d.qty - fee;
    const floor = floorOf(a);
    if (floor != null && after <= floor + EPS) return `This buy alone would put the account at ${money(after, 2)}, through its floor at ${money(floor)}`;
    const df = dayFloorOf(a);
    if (df && after <= df.floor + EPS) return `This buy alone would put the day at ${money(after - df.from, 2)}, through its loss limit of ${money(r.dailyLoss!.amount)}`;
  }
  return null;
}

/* ================================================================== */
/*  ON EVERY TICK                                                      */
/* ================================================================== */

export interface Verdict {
  kind: 'fail' | 'pause';
  rule: RuleId;
  /** What happened, in a sentence that starts lower-case ("worth $47,950 reached the floor at $48,000") */
  why: string;
}

/** The floor or the day's limit reached by what the account is worth now — or null. Judged only on a live market
    (a fresh quote for everything held), or with nothing open. */
export function judgeTick(a: PaperAccount, v: PaperView): Verdict | null {
  const r = rulesOf(a);
  if (!r || a.status !== 'open' || !Number.isFinite(v.equity)) return null;
  const floor = floorOf(a);
  if (floor != null && v.equity <= floor + EPS) return { kind: 'fail', rule: 'drawdown', why: `worth ${money(v.equity, 2)} reached the floor at ${money(floor)} (the most it may lose is ${money(r.drawdown!.amount)})` };
  const df = dayFloorOf(a);
  if (df && !(a.dayOver && a.dayOver.day === a.day) && v.equity <= df.floor + EPS)
    return { kind: r.dailyLoss!.breach, rule: 'daily', why: `down ${money(df.from - v.equity, 2)} on the day, the limit is ${money(r.dailyLoss!.amount)}` };
  return null;
}
/** The high mark an intraday trailing floor follows, after this tick */
export const peakAfterTick = (a: PaperAccount, v: PaperView): number => (rulesOf(a)?.drawdown?.mode === 'intraday' && Number.isFinite(v.equity) && v.equity > a.peak ? v.equity : a.peak);

/** What has to be closed now: each held contract whose flat time has come (the earliest rule that asks) */
export function mustBeFlat(a: PaperAccount, m: PaperMarket, v: PaperView): { keys: Set<string>; why: string; rule: RuleId } | null {
  if (!rulesOf(a) || a.status !== 'open') return null;
  const keys = new Set<string>();
  let first: { why: string; rule: RuleId } | null = null;
  for (const p of v.opt) {
    const f = flatTimeOf(a, a.day, p.contract.ticker.toUpperCase(), m);
    if (f && m.now >= f.at && m.now < dayEndsAt(a.day)) {
      keys.add(p.key);
      first ??= { why: f.why, rule: f.rule };
    }
  }
  return keys.size ? { keys, ...first! } : null;
}

/* ================================================================== */
/*  AT THE DAY'S ROLL                                                  */
/* ================================================================== */

export type RollVerdict = { kind: 'pass'; why: string } | { kind: 'next'; why: string } | { kind: 'fail'; rule: RuleId; why: string } | null;

/** The day that was, judged at its close (`close`: what the account was worth at the roll) */
export function judgeRoll(a: PaperAccount, close: number, now: number): RollVerdict {
  const r = rulesOf(a);
  if (!r || a.status !== 'open') return null;
  const ph = phaseOf(a);
  const profit = close - ph.base;
  const days = daysTraded(a).length;
  let best = 0;
  for (const [day, d] of Object.entries(a.ledger)) if (day >= ph.day && d.close != null) best = Math.max(best, d.close - d.open);
  const consistent = r.consistency == null || profit <= 0 || best <= r.consistency * profit + EPS;
  if (ph.target != null && profit >= ph.target - EPS && days >= (r.minDays ?? 0) && consistent) {
    const words = `closed the day at ${money(close, 2)}, ${money(profit, 2)} over ${money(ph.base)} — the target was ${money(ph.target)}, over ${days} trading ${days === 1 ? 'day' : 'days'}`;
    return ph.index + 1 < ph.count ? { kind: 'next', why: `${ph.name} passed — ${words}` } : { kind: 'pass', why: words };
  }
  if (r.timeLimitDays != null && daysRun(a, now) > r.timeLimitDays) return { kind: 'fail', rule: 'time', why: `${r.timeLimitDays} calendar days ran out without the target` };
  return null;
}
/** The high mark an end-of-day floor follows, after the close */
export const peakAfterRoll = (a: PaperAccount, close: number): number => (rulesOf(a)?.drawdown?.mode === 'eod' && close > a.peak ? close : a.peak);

/* ================================================================== */
/*  THE RULES AS THEY STAND — for the page                             */
/* ================================================================== */

export interface RuleRead {
  id: RuleId;
  label: string;
  /** A goal fills toward its end; a limit fills as it is used; a fact only says */
  kind: 'goal' | 'limit' | 'fact';
  /** 0 to 1: how far toward the goal, or how much of the limit is used */
  fill: number;
  /** ok · near (a limit three-quarters used) · met (a goal reached) · hit (a limit reached) */
  state: 'ok' | 'near' | 'met' | 'hit';
  /** The figure, in a few words: "$1,240 of $3,000" */
  value: string;
  /** The room left: "$760 to go" · "$1,250 left today" */
  room: string;
  /** The rule in one sentence, for the hover */
  says: string;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const limitState = (fill: number): RuleRead['state'] => (fill >= 1 - EPS ? 'hit' : fill >= 0.75 ? 'near' : 'ok');
const untilWords = (ms: number): string => {
  const mins = Math.max(0, Math.round(ms / 60_000));
  return mins < 60 ? `in ${mins}m` : `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
};

/** Every rule of the account's plan, as it stands now */
export function readRules(a: PaperAccount, v: PaperView, m: Pick<PaperMarket, 'now' | 'earnings'>): RuleRead[] {
  const r = rulesOf(a);
  if (!r) return [];
  const out: RuleRead[] = [];
  const ph = phaseOf(a);
  const eq = v.equity;
  const live = Number.isFinite(eq);
  const { best, profit } = live ? dayResults(a, v) : { best: 0, profit: 0 };
  if (ph.target != null) {
    const need = r.consistency != null && best > 0 ? Math.max(ph.target, cents(best / r.consistency)) : ph.target;
    const fill = clamp01(profit / need);
    out.push({
      id: 'target',
      label: ph.count > 1 ? `${ph.name} target` : 'Profit target',
      kind: 'goal',
      fill,
      state: profit >= need - EPS ? 'met' : 'ok',
      value: `${money(Math.max(0, profit))} of ${money(need)}`,
      room: profit >= need - EPS ? 'reached — passes at the close if it holds' : `${money(need - profit)} to go`,
      says: `Make ${money(ph.target)} over the start of ${ph.count > 1 ? ph.name : 'the evaluation'} (${money(ph.base)}); judged at the day’s close${need > ph.target + 0.5 ? ` — raised to ${money(need)} by the best-day rule` : ''}`,
    });
  }
  const df = dayFloorOf(a);
  if (df && r.dailyLoss) {
    const used = live ? Math.max(0, df.from - eq) : 0;
    const paused = a.dayOver && a.dayOver.day === a.day;
    const fill = paused ? 1 : clamp01(used / r.dailyLoss.amount);
    out.push({
      id: 'daily',
      label: 'Daily loss',
      kind: 'limit',
      fill,
      state: paused ? 'hit' : limitState(fill),
      value: `${money(used)} of ${money(r.dailyLoss.amount)}`,
      room: paused ? 'the day is over' : `${money(Math.max(0, eq - df.floor))} left today`,
      says: `Worth may not fall ${money(r.dailyLoss.amount)} under the day’s start ${r.dailyLoss.from === 'balance' ? 'balance' : r.dailyLoss.from === 'equity' ? 'worth' : '(the higher of its balance and its worth)'} — ${money(df.from)} today, so the day’s floor is ${money(df.floor)}. Reached: ${r.dailyLoss.breach === 'fail' ? 'the account fails' : 'everything is closed and the day is over'}. Resets at 17:00 ET.`,
    });
  }
  const floor = floorOf(a);
  if (floor != null && r.drawdown) {
    const room = live ? eq - floor : r.drawdown.amount;
    const fill = clamp01(1 - room / r.drawdown.amount);
    const locked = floorLocked(a);
    out.push({
      id: 'drawdown',
      label: r.drawdown.mode === 'static' ? 'Max loss' : 'Trailing drawdown',
      kind: 'limit',
      fill,
      state: limitState(fill),
      value: `floor ${money(floor)}`,
      room: `${money(Math.max(0, room))} above the floor`,
      says: `${r.drawdown.mode === 'static' ? `A fixed floor ${money(r.drawdown.amount)} under the start` : `A floor ${money(r.drawdown.amount)} under the ${r.drawdown.mode === 'eod' ? 'best day’s close' : 'best moment, open trades in'}`}${r.drawdown.mode !== 'static' && r.drawdown.lockAt != null ? `; it stops trailing at ${money(ph.base + r.drawdown.lockAt)}${locked ? ' — and has' : ''}` : ''}. Reached: the account fails.`,
    });
  }
  if (r.minDays != null) {
    const n = daysTraded(a).length;
    out.push({ id: 'days', label: 'Trading days', kind: 'goal', fill: clamp01(n / r.minDays), state: n >= r.minDays ? 'met' : 'ok', value: `${n} of ${r.minDays}`, room: n >= r.minDays ? 'enough' : `${r.minDays - n} more`, says: `At least ${r.minDays} trading days with a fill before the target counts` });
  }
  if (r.timeLimitDays != null) {
    const run = daysRun(a, m.now);
    const fill = clamp01(run / r.timeLimitDays);
    out.push({ id: 'time', label: 'Time limit', kind: 'limit', fill, state: limitState(fill), value: `day ${run} of ${r.timeLimitDays}`, room: `${Math.max(0, r.timeLimitDays - run)} calendar days left`, says: `The target within ${r.timeLimitDays} calendar days of the start${ph.count > 1 ? ' of the phase' : ''}` });
  }
  if (r.consistency != null) {
    const share = profit > 0 ? best / profit : 0;
    const ok = profit <= 0 || best <= r.consistency * profit + EPS;
    out.push({ id: 'consistency', label: 'Best day', kind: 'limit', fill: clamp01(share / r.consistency), state: ok ? (share >= r.consistency * 0.75 ? 'near' : 'ok') : 'hit', value: profit > 0 ? `${Math.round(share * 100)}% of the profit` : `${money(best)}`, room: `at most ${Math.round(r.consistency * 100)}%`, says: `No single day more than ${Math.round(r.consistency * 100)}% of the profit — until it holds, the pass waits` });
  }
  const pending = a.opt.orders.filter(o => o.status === 'working' && o.side === 'buy');
  if (r.maxContracts != null) {
    const n = v.opt.reduce((x, p) => x + legsQty(p.contract, p.qty), 0) + pending.reduce((x, o) => x + legsQty(o.contract, o.qty), 0);
    const fill = clamp01(n / r.maxContracts);
    out.push({ id: 'contracts', label: 'Contracts', kind: 'limit', fill, state: limitState(fill), value: `${n} of ${r.maxContracts}`, room: `${Math.max(0, r.maxContracts - n)} more`, says: `No more than ${r.maxContracts} contracts open at once, resting buys in (a spread counts both legs)` });
  }
  if (r.maxOpenPositions != null) {
    const n = new Set([...v.opt.map(p => p.key), ...pending.map(o => contractKey(o.contract))]).size;
    const fill = clamp01(n / r.maxOpenPositions);
    out.push({ id: 'open', label: 'Positions', kind: 'limit', fill, state: limitState(fill), value: `${n} of ${r.maxOpenPositions}`, room: `${Math.max(0, r.maxOpenPositions - n)} more`, says: `No more than ${r.maxOpenPositions} positions open at once` });
  }
  if (r.maxPositionCost != null) {
    const big = Math.max(0, ...v.opt.map(p => p.avg * MULT * p.qty + p.fees));
    const fill = clamp01(big / r.maxPositionCost);
    out.push({ id: 'cost', label: 'One position', kind: 'limit', fill, state: limitState(fill), value: `${money(big)} of ${money(r.maxPositionCost)}`, room: 'the largest open', says: `One position may cost no more than ${money(r.maxPositionCost)}, premium and fees` });
  }
  if (r.buyingPower != null) {
    const tied = v.opt.reduce((x, p) => x + p.avg * MULT * p.qty + p.fees, 0) + pending.reduce((x, o) => x + (o.price ?? 0) * MULT * o.qty, 0);
    const fill = clamp01(tied / r.buyingPower);
    out.push({ id: 'bp', label: 'Buying power', kind: 'limit', fill, state: limitState(fill), value: `${money(tied)} of ${money(r.buyingPower)}`, room: `${money(Math.max(0, r.buyingPower - tied))} free`, says: `No more than ${money(r.buyingPower)} tied up in premium at once, resting buys in` });
  }
  /* the holding rules: when the account has to be flat today */
  const flat = flatTimeOf(a, a.day, null, m);
  if (flat) {
    const left = flat.at - m.now;
    const past = left <= 0 && m.now < dayEndsAt(a.day);
    out.push({ id: flat.rule, label: flat.rule === 'flat' ? `Flat by ${r.flatBy} ET` : flat.rule === 'weekend' ? 'No weekend holds' : 'Flat by the close', kind: 'fact', fill: 0, state: past ? 'hit' : left < 15 * 60_000 ? 'near' : 'ok', value: past ? 'flat until the next session' : nyAt(flat.at).date === nyAt(m.now).date ? untilWords(left) : `${BEFORE_BELL} ET`, room: '', says: `Everything open is closed by the rules at ${nyAt(flat.at).minutes === minutesOf(BEFORE_BELL) ? `${BEFORE_BELL} ET, a minute before the bell` : `${r.flatBy} ET`} — ${flat.why}` });
  }
  if (!r.earnings) out.push({ id: 'earnings', label: 'Earnings', kind: 'fact', fill: 0, state: 'ok', value: 'not through a report', room: '', says: 'A position on a name that reports before the next session is closed at 15:59 ET; a buy waits until the report date is known' });
  const allowed: string[] = [];
  if (r.underlyings) allowed.push(r.underlyings.join(' · '));
  if (!r.zeroDte) allowed.push('no 0DTE');
  if (!r.spreads) allowed.push('no spreads');
  if (allowed.length) out.push({ id: r.underlyings ? 'names' : !r.zeroDte ? '0dte' : 'spreads', label: 'Allowed', kind: 'fact', fill: 0, state: 'ok', value: allowed.join(' · '), room: '', says: `Buys only — long calls, long puts${r.spreads ? ', debit spreads' : ''}${r.underlyings ? `, on ${r.underlyings.join(', ')}` : ''}${r.zeroDte ? '' : ', nothing that expires today'}` });
  return out;
}
