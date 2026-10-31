/* The paper account in code: pure functions over an account that is its orders and fills, so everything the desk
   shows is read off them. The market comes in through PaperMarket (feed.ts). Options only — a prop firm's plan is
   judged by rules.ts on every order and every tick. Options are bought and sold: a sell with nothing held opens a
   short (sold at the bid, bought back at the ask), a spread sold is a credit spread, two spreads sold as one order an
   iron condor; what the shorts hold is margin.ts's, re-marked every tick. Futures were taken out of the product: an account from before
   keeps its closed futures trades (futBookOf reads them for the journal), and nothing new is traded on them. */

import { MULT, nameGoesUp, type Bracket, type OrderKind, type Side } from '../review/engine';
import { isBroadIndex, marginLineOf, marginOf, type MarginLine } from './margin';
import type { DayNote, JournalEntry } from '../review/journal';
import { MAX_STOPS, MAX_TARGETS, giveUp, ladderShapeRefusal, nextRung, rungsOf, type LadderBracket } from '../review/ladder';
import { contractKey, contractWords, dteAt, fillableQty, legsOf, type ContractId, type Quote } from '../review/quotes';
import { closeBasisOf } from '../review/history';
import { tradingMinutesBetween } from '../../core/tradingYear';
import type { Candle } from '../../types/market';
import { dayBeginsAt, dayEndsAt, isVixRoot, nyAt, tradingDayOf, tradingEndsAt, vixSchedule } from './clock';
import { paperFut } from './products';
import { closeMeasure, judgePass, judgeRoll, judgeTick, lateCloseOf, mustBeFlat, nakedCallsBarred, peakAfterRoll, peakAfterTick, putsSecured, ruleRefusal, type EarningsWhen, type PaperPlan, type RuleId } from './rules';

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

/** An instant, and the trading day it belongs to (clock.ts: 17:00 to 17:00 New York) */
export interface PaperMoment {
  at: number;
  day: string;
}

/** The market as it stands — all the engine knows of it (feed.ts builds the live one) */
export interface PaperMarket {
  now: number;
  /** This page load's name (feed.ts LIFE) — written on every fill */
  life: string;
  optQuote: (c: ContractId) => Quote;
  /** The same contract with the name at `spot`, now */
  optQuoteAt: (c: ContractId, spot: number) => Quote;
  /** The chart's moment (seconds) for what a chart of the name draws */
  bar: (ticker: string) => number;
  /** The candles a closed trade's chart is written down from */
  candles: (ticker: string) => Candle[];
  /** Does the options market take an order now (09:30–16:00 ET on a session) */
  open: () => boolean;
  /** Is the contract's quote a fresh live read — the rules judge an account only on fresh quotes (none: always) */
  fresh?: (c: ContractId) => boolean;
  /** When a name next reports — undefined while it is not known yet (none: no earnings calendar is read) */
  earnings?: (ticker: string) => EarningsWhen | undefined;
  /** The name's close on a past or today's date (what an expiring contract settles on): the 16:00 closing print when
      one was recorded, else the last real print — NaN until it is known. Never a flat zero-volume candle. */
  closeOf?: (ticker: string, day: string) => number;
  /** The name's opening print on a date (the first real bar's open) — what a VIX option settles on, the SOQ's stand-in.
      NaN until it is known. */
  openOf?: (ticker: string, day: string) => number;
  /** A replayed minute of the history (store.ts catch-up), not the live market */
  replay?: boolean;
}
/** What a contract is worth in the money with the name at `close` — a spread's two legs, kept inside its width */
export function settleValue(c: ContractId, close: number): number {
  const leg = (k: number) => Math.max(0, c.right === 'C' ? close - k : k - close);
  if (c.short == null) return cents(leg(c.strike));
  return cents(Math.max(0, Math.min(Math.abs(c.short - c.strike), leg(c.strike) - leg(c.short))));
}

/* ---- options ---- */
export interface OptOrder {
  id: string;
  placed: PaperMoment;
  contract: ContractId;
  side: Side;
  qty: number;
  kind: OrderKind;
  price?: number;
  on?: 'name';
  tif: 'day' | 'gtc';
  status: 'working' | 'filled' | 'cancelled' | 'refused';
  why?: string;
  done?: PaperMoment;
  fillPrice?: number;
  oco?: string;
  bracket?: Bracket;
  tag?: string;
  breakeven?: boolean;
  trail?: number;
  peak?: number;
  moved?: PaperMoment;
  /** The page load it was placed in — a later one cancels what an earlier one left working (the simulated feed) */
  life: string;
  /** Up to when it has been judged against a quote (ms): live, or replayed from the minute history (gapOf) */
  judgedTo?: number;
  /** Minutes that could not be judged — no history for them — said beside the order */
  unjudged?: { from: number; to: number; why: string };
  /** A way in (a buy, or a sell to open) or a way out (a sell of what is held, a buy back of what is short) — as it
      stood when it was placed. Orders from before selling carry nothing: a buy opened, a sell closed. */
  opens?: boolean;
  /** A put sold cash-secured: its strike × 100 is held (margin.ts) */
  secured?: 'cash';
  /** One leg of an order of several (an iron condor): the legs fill together or not at all */
  combo?: string;
  /** …its name ("Iron condor") */
  comboName?: string;
  /** …and, waiting, the least net it takes a set: what the legs sold bring in less what the legs bought cost, a share
      (a credit: above 0; a debit: below) */
  net?: number;
  /** Filled in pieces so far: a fill takes at most the size the quote shows (fillableQty); `qty` is what is left */
  filled?: number;
  /** …and how much of which quote it has taken (the same quote's size is not taken twice) */
  took?: { at: number; qty: number };
}
/** How a fill came: an order's kind — or the market's (the bell), the rules' (an evaluation), the page's (it closed) */
type OptFillHow = OrderKind | 'expired' | 'rule' | 'page';
export interface OptFill {
  id: string;
  orderId: string | null;
  at: PaperMoment;
  contract: ContractId;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  how: OptFillHow;
  spot: number;
  delta: number;
  iv: number;
  theta: number;
  tag?: string;
  plannedStop?: number;
  /** The chart's moment it happened at (feed.ts barNowOf) — where its arrow is drawn */
  bar: number;
  /** The page load it happened in */
  life: string;
  /** Why, where it was not the reader's doing ("the floor", "16:59", "the page closed") */
  note?: string;
  /** A way in, a sell to open among them (orders from before selling carry nothing) */
  opens?: boolean;
  secured?: 'cash';
  combo?: string;
  comboName?: string;
  /** What a way in sold short held when it opened (margin.ts, on its own) — what its R is measured against */
  held?: number;
}

/* ---- futures ---- */
export interface FutOrder {
  id: string;
  placed: PaperMoment;
  symbol: string;
  /** The contract month it was for — "ESZ6" */
  contract: string;
  side: Side;
  qty: number;
  kind: OrderKind;
  price?: number;
  /** A way OUT: it only ever reduces the position it was placed against */
  exit: boolean;
  tif: 'day' | 'gtc';
  status: 'working' | 'filled' | 'cancelled' | 'refused';
  why?: string;
  done?: PaperMoment;
  fillPrice?: number;
  oco?: string;
  bracket?: LadderBracket;
  tag?: string;
  breakeven?: boolean;
  trail?: number;
  peak?: number;
  moved?: PaperMoment;
  life: string;
}
type FutFillHow = OrderKind | 'rule' | 'page';
export interface FutFill {
  id: string;
  orderId: string | null;
  at: PaperMoment;
  symbol: string;
  contract: string;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  how: FutFillHow;
  exit: boolean;
  plannedStop?: number;
  tag?: string;
  bar: number;
  life: string;
  note?: string;
}

/* ---- the account ---- */
/** 'practice': plain, cash is the only limit · 'evaluation': a prop firm's plan (or the reader's own rules), judged by
    rules.ts. The word stays 'evaluation' so accounts saved before keep loading. */
export type AccountKind = 'practice' | 'evaluation';
export type { PaperPlan } from './rules';
export const PRACTICE_SIZES = [10_000, 25_000, 50_000, 100_000];

/** One trading day of the account: what it was worth when the day began, when it ended, and its high and low */
export interface PaperDay {
  open: number;
  /** The day's start balance — what it was worth less what was open (closed trades only) */
  bal?: number;
  close?: number;
  /** The balance at the roll (closed trades only): with `bal`, the day's closed P&L — what consistency and profitable
      days count */
  closeBal?: number;
  hi: number;
  lo: number;
}
/** While a trade was held: what it was worth on the ticks (at most HELD_POINTS points, thinned evenly), its best and worst */
export interface HeldRecord {
  /** [instant ms, what it was up or down (fees in), the contract's bid or the future's price, the name's price] */
  pts: [number, number, number, number][];
  best: number;
  bestAt: number;
  worst: number;
  worstAt: number;
}
/** The candles a closed trade was on, written down at its close — cents (a future: ticks) over a base, to keep them small */
export interface TradePath {
  /** The first candle's time (the chart's clock, seconds), and the seconds a candle */
  t0: number;
  step: number;
  base: number;
  /** A unit is this much of the price */
  unit: number;
  o: number[];
  h: number[];
  l: number[];
  c: number[];
}
export interface PaperLogLine {
  at: number;
  words: string;
  kind: 'rule' | 'pass' | 'fail' | 'day' | 'page' | 'info';
}
export interface PaperAccount {
  id: string;
  kind: AccountKind;
  name: string;
  startCash: number;
  createdAt: number;
  touchedAt: number;
  seq: number;
  /** The plan an evaluation runs on (rules.ts) — none on a practice account */
  plan?: PaperPlan;
  status: 'open' | 'passed' | 'failed' | 'ended';
  statusAt?: number;
  statusWhy?: string;
  /** The rule that passed or failed it */
  statusRule?: RuleId;
  /** Taken off the Accounts page's main list (kept, and still in the journal) */
  archived?: boolean;
  /** The plan's phase it is in (0: the first), and what that phase started from */
  phase?: number;
  phaseStart?: { at: number; day: string; equity: number };
  /** The trading day the account last rolled into, and every day it has been on */
  day: string;
  ledger: Record<string, PaperDay>;
  /** The high mark a trailing floor follows */
  peak: number;
  /** The account's equity, tick by tick, as one running figure: its highest, and its worst fall from a high — the report's
      drawdown (a list of trades cannot see two down at once). Kept from 2026-10-31; an older account starts it then. */
  curve?: { peak: number; maxDd: number };
  /** The day's loss limit was reached: no way in until the day rolls */
  dayOver?: { day: string; why: string };
  /** Options' fee, a contract each way */
  fee: number;
  /** Practice only: fees off (the rules page, "The sandbox") */
  sandbox?: boolean;
  /** 'live': opened on the live feed. Accounts from the old simulated feed carry nothing here and are ended on load. */
  feed?: 'live';
  opt: { orders: OptOrder[]; fills: OptFill[] };
  /** Futures, from before options-only: read for the history, never added to */
  fut: { orders: FutOrder[]; fills: FutFill[] };
  /** The last real bid (a long) or ask (a short) taken from a live quote — what a dead quote is closed at. Never the
      entry, never a dead quote's zero. */
  marks: Record<string, number>;
  /** By trade id: while it was held (open trades are kept up on every tick; closed ones stay) */
  held: Record<string, HeldRecord>;
  /** By trade id: the candles it was on */
  paths: Record<string, TradePath>;
  /** What the account did by itself, newest first */
  log: PaperLogLine[];
  /** The journal's (data/review/journal.ts): the reader's words and tags on a closed trade, and a note on a day */
  notes: Record<string, string>;
  journal?: Record<string, JournalEntry>;
  days?: Record<string, DayNote>;
}

/* ================================================================== */
/*  SMALL THINGS                                                       */
/* ================================================================== */

const cents = (v: number) => Math.round(v * 100) / 100;
const money = (v: number, dp = 2) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const momentAt = (ms: number): PaperMoment => ({ at: ms, day: tradingDayOf(ms) });
/** Ours, not the reader's: past this many positions a desk cannot be read */
const OPEN_CEILING = 10;
/** At most this many points of a held trade are kept */
const HELD_POINTS = 240;
/** A point is written at most this often */
const HELD_EVERY_MS = 5_000;
/** At most this many candles of a closed trade are kept, and at most this many trades' candles */
const PATH_BARS = 150;
export const PATHS_KEPT = 200;
/** A closed trade keeps at most this many of its held points — enough to draw it, small enough to keep hundreds */
const HELD_KEPT = 80;
/** What the account's own log keeps */
const LOG_KEPT = 60;

const nextId = (a: PaperAccount, p: string): [string, PaperAccount] => [`${p}${a.seq + 1}`, { ...a, seq: a.seq + 1 }];
const logged = (a: PaperAccount, at: number, words: string, kind: PaperLogLine['kind']): PaperAccount => ({ ...a, log: [{ at, words, kind }, ...a.log].slice(0, LOG_KEPT) });
const optFee = (a: PaperAccount, c: ContractId, qty: number) => (a.sandbox ? 0 : cents(a.fee * qty * legsOf(c)));
/** The house's fee, a contract each way, where a plan names none */
export const HOUSE_FEE = 0.65;

export function newAccount(o: { id: string; kind: AccountKind; name: string; startCash: number; plan?: PaperPlan; now: number; fee?: number; sandbox?: boolean }): PaperAccount {
  const day = tradingDayOf(o.now);
  const start = o.plan ? o.plan.size : o.startCash;
  const plan = o.plan;
  const phases = plan?.rules.phases ?? [];
  return {
    id: o.id,
    kind: o.kind,
    name: o.name,
    startCash: start,
    createdAt: o.now,
    touchedAt: o.now,
    seq: 0,
    plan,
    status: 'open',
    phase: plan ? 0 : undefined,
    phaseStart: plan ? { at: o.now, day, equity: start } : undefined,
    day,
    ledger: { [day]: { open: start, bal: start, hi: start, lo: start } },
    peak: start,
    /* a firm plan charges what the firm states, and nothing where it states nothing */
    fee: o.fee ?? (plan ? (plan.rules.fee ?? 0) : HOUSE_FEE),
    sandbox: o.kind === 'practice' ? o.sandbox || undefined : undefined,
    feed: 'live',
    opt: { orders: [], fills: [] },
    fut: { orders: [], fills: [] },
    marks: {},
    held: {},
    paths: {},
    log: [{ at: o.now, words: plan ? `${plan.firm ?? 'Your own rules'} ${plan.label}${phases.length > 1 ? ` · ${phases[0].name}` : ''} began at ${money(start, 0)}` : `The account began at ${money(start, 0)}`, kind: 'info' }],
    notes: {},
  };
}

/* ================================================================== */
/* The options book */
/* ================================================================== */

export interface OptLeg {
  /** The fill it was */
  id: string;
  at: PaperMoment;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  /** A piece going out: a target, a stop, the reader's hand, the bell, the rules, the page closing */
  out?: 'target' | 'stop' | 'hand' | 'bell' | 'rule' | 'page';
  bar: number;
}
export interface OptPosition {
  key: string;
  contract: ContractId;
  /** 1: held long (bought) · −1: held short (sold to open) */
  dir: 1 | -1;
  /** Contracts held, a count (a short of 2 is dir −1, qty 2) */
  qty: number;
  /** Running average cost a share of what is still held: each exit takes avg × qty out of the basis */
  avg: number;
  /** Premium of what is still held at that running average, dollars, unrounded (avg × 100 × qty) */
  basis: number;
  /** Entry fees still carried by what is held */
  fees: number;
  opened: PaperMoment;
  spotIn: number;
  tradeId: string;
  tag?: string;
  /** The page load it was opened in */
  life: string;
  /** What has come in and gone out on it so far, fees in — with `qty` at the bid, what the trade is up or down */
  flow: number;
  /** What the pieces already sold have banked: their proceeds less their share of the cost, fees in (the chart's RP&L) */
  banked: number;
  /** A put sold cash-secured */
  secured?: 'cash';
  /** The order of several it came in on, and its name */
  combo?: string;
  comboName?: string;
  /** A short's: what it held when it opened, for what is still open (its R's measure) */
  held: number;
}
/** How a trade ended — 'closed': a short bought back by the reader's hand */
export type OptTradeHow = 'sold' | 'closed' | 'target' | 'stopped' | 'expired' | 'scaled' | 'rule' | 'page';
export interface OptTrade {
  id: string;
  contract: ContractId;
  qty: number;
  avgIn: number;
  avgOut: number;
  cost: number;
  pnl: number;
  r: number;
  opened: PaperMoment;
  closed: PaperMoment;
  how: OptTradeHow;
  legs: OptLeg[];
  dteIn: number;
  deltaIn: number;
  ivIn: number;
  thetaIn: number;
  spotIn: number;
  spotOut: number;
  /** Session minutes it was on (the market's open minutes, as a backtest counts them) */
  heldMin: number;
  plannedStop?: number;
  tag?: string;
  /** Why the rules or the page closed it */
  note?: string;
  /** Sold to open and bought back: `avgIn` is what it was sold at, `avgOut` what it was bought back at, `cost` what it
      held (its R's measure) */
  short?: true;
  /** The order of several it was opened in ("Iron condor") */
  comboName?: string;
}
const outOf = (how: OptFillHow, target: boolean): OptLeg['out'] => (how === 'expired' ? 'bell' : how === 'rule' ? 'rule' : how === 'page' ? 'page' : how === 'stop' ? 'stop' : target ? 'target' : 'hand');

export function optBookOf(a: PaperAccount): { positions: OptPosition[]; trades: OptTrade[] } {
  interface Open {
    first: OptFill;
    /** 1 long, −1 short */
    dir: 1 | -1;
    qty: number;
    entered: number;
    inSum: number;
    feesIn: number;
    exited: number;
    outSum: number;
    feesOut: number;
    flow: number;
    held: number;
    legs: OptLeg[];
    /* the running average cost of what is still open: each exit takes its share (avg × qty) out, so a re-entry after a
       partial exit is averaged with what is left, not with what was sold — premium (a share), entry fees, a short's hold */
    basis: number;
    feeBasis: number;
    heldBasis: number;
    /** What the pieces taken off banked against that running average, fees in */
    banked: number;
  }
  const open = new Map<string, Open>();
  const trades: OptTrade[] = [];
  const targets = new Set(a.opt.orders.filter(o => o.oco && o.kind === 'limit').map(o => o.id));
  for (const f of a.opt.fills) {
    const key = contractKey(f.contract);
    let o = open.get(key);
    const way: 1 | -1 = f.side === 'buy' ? 1 : -1;
    if (!o) {
      /* a way in: a buy, or a sell written as one — a sell with nothing held and no such mark (from before selling) is
         passed over, as it always was */
      if (way < 0 && !f.opens) continue;
      open.set(key, (o = { first: f, dir: way, qty: 0, entered: 0, inSum: 0, feesIn: 0, exited: 0, outSum: 0, feesOut: 0, flow: 0, held: 0, legs: [], basis: 0, feeBasis: 0, heldBasis: 0, banked: 0 }));
    }
    if (way === o.dir) {
      o.legs.push({ id: f.id, at: f.at, side: f.side, qty: f.qty, price: f.price, fee: f.fee, bar: f.bar });
      o.qty += f.qty;
      o.entered += f.qty;
      o.inSum += f.price * f.qty;
      o.feesIn += f.fee;
      o.held += f.held ?? 0;
      o.basis += f.price * f.qty;
      o.feeBasis += f.fee;
      o.heldBasis += f.held ?? 0;
      o.flow -= o.dir * f.price * MULT * f.qty + f.fee;
      continue;
    }
    const q = Math.min(f.qty, o.qty);
    {
      const share = o.qty > 0 ? q / o.qty : 0;
      const avg = o.qty > 0 ? o.basis / o.qty : 0;
      const feeShare = o.feeBasis * share;
      o.banked += o.dir * (f.price - avg) * q * MULT - f.fee - feeShare;
      o.basis -= avg * q;
      o.feeBasis -= feeShare;
      o.heldBasis -= o.heldBasis * share;
    }
    o.qty -= q;
    o.exited += q;
    o.outSum += f.price * q;
    o.feesOut += f.fee;
    o.flow += o.dir * f.price * MULT * q - f.fee;
    o.legs.push({ id: f.id, at: f.at, side: f.side, qty: q, price: f.price, fee: f.fee, out: outOf(f.how, !!f.orderId && targets.has(f.orderId)), bar: f.bar });
    if (o.qty > 0) continue;
    const paid = o.inSum * MULT;
    const got = o.outSum * MULT;
    /* a long: what it sold for less what it cost · a short: what it was sold for less what buying it back cost */
    const pnl = o.dir * (got - paid) - o.feesIn - o.feesOut;
    const cost = o.dir > 0 ? paid + o.feesIn : o.held > 0 ? o.held : paid - o.feesIn;
    const outs = o.legs.filter(l => l.out);
    trades.push({
      id: o.first.id,
      contract: f.contract,
      qty: o.entered,
      avgIn: cents(o.inSum / o.entered),
      avgOut: cents(o.outSum / Math.max(1, o.exited)),
      cost: cents(cost),
      pnl: cents(pnl),
      r: cost > 0 ? pnl / cost : 0,
      opened: o.first.at,
      closed: f.at,
      how: outs.length > 1 ? 'scaled' : f.how === 'expired' ? 'expired' : f.how === 'rule' ? 'rule' : f.how === 'page' ? 'page' : f.how === 'stop' ? 'stopped' : f.orderId && targets.has(f.orderId) ? 'target' : o.dir > 0 ? 'sold' : 'closed',
      legs: o.legs,
      dteIn: dteAt(nyAt(o.first.at.at).date, f.contract.expiry),
      deltaIn: o.first.delta,
      ivIn: o.first.iv,
      thetaIn: o.first.theta,
      spotIn: o.first.spot,
      spotOut: f.spot,
      /* session minutes, as a backtest's: the minutes the market was open while it was held (core/tradingYear) */
      heldMin: tradingMinutesBetween(o.first.at.at, f.at.at),
      plannedStop: o.first.plannedStop,
      tag: o.first.tag,
      note: f.note,
      ...(o.dir < 0 ? { short: true as const } : {}),
      ...(o.first.comboName ? { comboName: o.first.comboName } : {}),
    });
    open.delete(key);
  }
  const positions: OptPosition[] = [...open.entries()].map(([key, o]) => ({
    key,
    contract: o.first.contract,
    dir: o.dir,
    qty: o.qty,
    avg: cents(o.basis / o.qty),
    basis: o.basis * MULT,
    fees: cents(o.feeBasis),
    opened: o.first.at,
    spotIn: o.first.spot,
    tradeId: o.first.id,
    tag: o.first.tag,
    life: o.first.life,
    flow: o.flow,
    banked: cents(o.banked),
    secured: o.first.secured,
    combo: o.first.combo,
    comboName: o.first.comboName,
    held: cents(o.heldBasis),
  }));
  return { positions, trades };
}

/* ================================================================== */
/* The futures book */
/* ================================================================== */

export interface FutLeg {
  id: string;
  at: PaperMoment;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  exit: boolean;
  out?: 'target' | 'stop' | 'hand' | 'rule' | 'page';
  bar: number;
}
export interface FutPosition {
  key: string;
  symbol: string;
  contract: string;
  long: boolean;
  qty: number;
  avg: number;
  fees: number;
  opened: PaperMoment;
  tradeId: string;
  plannedStop?: number;
  tag?: string;
  life: string;
  /** Signed cash so far — with `qty` at the price, what the trade is up or down */
  flow: number;
  /** What the pieces already closed have banked, fees in — their own, and the entry's share of them (the chart's RP&L) */
  banked: number;
}
export type FutTradeHow = 'closed' | 'target' | 'stopped' | 'scaled' | 'rule' | 'page';
export interface FutTrade {
  id: string;
  symbol: string;
  contract: string;
  long: boolean;
  qty: number;
  avgIn: number;
  avgOut: number;
  pnl: number;
  risk: number | null;
  r: number | null;
  opened: PaperMoment;
  closed: PaperMoment;
  how: FutTradeHow;
  legs: FutLeg[];
  heldMin: number;
  tag?: string;
  note?: string;
}
const futOut = (how: FutFillHow, target: boolean): FutLeg['out'] => (how === 'rule' ? 'rule' : how === 'page' ? 'page' : how === 'stop' ? 'stop' : target ? 'target' : 'hand');

export function futBookOf(a: PaperAccount): { positions: FutPosition[]; trades: FutTrade[]; realized: number; feesPaid: number } {
  interface Open {
    first: FutFill;
    dir: 1 | -1;
    qty: number;
    basis: number;
    entered: number;
    inSum: number;
    exited: number;
    outSum: number;
    made: number;
    fees: number;
    feesIn: number;
    flow: number;
    legs: FutLeg[];
  }
  const open = new Map<string, Open>();
  const trades: FutTrade[] = [];
  const targets = new Set(a.fut.orders.filter(o => o.oco && o.kind === 'limit' && o.exit).map(o => o.id));
  let realized = 0;
  let feesPaid = 0;
  for (const f of a.fut.fills) {
    const pv = paperFut(f.symbol).pointValue;
    feesPaid += f.fee;
    let o = open.get(f.symbol);
    if (!f.exit) {
      if (!o) open.set(f.symbol, (o = { first: f, dir: f.side === 'buy' ? 1 : -1, qty: 0, basis: 0, entered: 0, inSum: 0, exited: 0, outSum: 0, made: 0, fees: 0, feesIn: 0, flow: 0, legs: [] }));
      o.legs.push({ id: f.id, at: f.at, side: f.side, qty: f.qty, price: f.price, fee: f.fee, exit: false, bar: f.bar });
      o.basis = (o.basis * o.qty + f.price * f.qty) / (o.qty + f.qty);
      o.qty += f.qty;
      o.entered += f.qty;
      o.inSum += f.price * f.qty;
      o.fees += f.fee;
      o.feesIn += f.fee;
      o.flow -= o.dir * f.price * pv * f.qty + f.fee;
      continue;
    }
    if (!o) continue;
    const q = Math.min(f.qty, o.qty);
    const made = (f.price - o.basis) * o.dir * pv * q;
    realized += made;
    o.made += made;
    o.qty -= q;
    o.exited += q;
    o.outSum += f.price * q;
    o.fees += f.fee;
    o.flow += o.dir * f.price * pv * q - f.fee;
    o.legs.push({ id: f.id, at: f.at, side: f.side, qty: q, price: f.price, fee: f.fee, exit: true, out: futOut(f.how, !!f.orderId && targets.has(f.orderId)), bar: f.bar });
    if (o.qty > 0) continue;
    const stop = o.first.plannedStop;
    const risk = stop != null ? cents(Math.abs(o.first.price - stop) * pv * o.first.qty) : null;
    const pnl = cents(o.made - o.fees);
    trades.push({
      id: o.first.id,
      symbol: f.symbol,
      contract: o.first.contract,
      long: o.dir === 1,
      qty: o.entered,
      avgIn: o.inSum / o.entered,
      avgOut: o.outSum / Math.max(1, o.exited),
      pnl,
      risk,
      r: risk && risk > 0 ? pnl / risk : null,
      opened: o.first.at,
      closed: f.at,
      how: o.legs.filter(l => l.exit).length > 1 ? 'scaled' : f.how === 'rule' ? 'rule' : f.how === 'page' ? 'page' : f.how === 'stop' ? 'stopped' : f.orderId && targets.has(f.orderId) ? 'target' : 'closed',
      legs: o.legs,
      heldMin: Math.max(0, Math.round((f.at.at - o.first.at.at) / 60_000)),
      tag: o.first.tag,
      note: f.note,
    });
    open.delete(f.symbol);
  }
  const positions: FutPosition[] = [...open.entries()].map(([symbol, o]) => ({
    key: symbol,
    symbol,
    contract: o.first.contract,
    long: o.dir === 1,
    qty: o.qty,
    avg: o.basis,
    fees: cents((o.feesIn * o.qty) / o.entered),
    opened: o.first.at,
    tradeId: o.first.id,
    plannedStop: o.first.plannedStop,
    tag: o.first.tag,
    life: o.first.life,
    flow: o.flow,
    banked: cents(o.made - o.fees + (o.feesIn * o.qty) / o.entered),
  }));
  return { positions, trades, realized: cents(realized), feesPaid: cents(feesPaid) };
}

/** What a name has banked: its closed trades, and what its open ones have taken off in pieces, fees in — from the
    fills before `before` (an instant; none: all of them). The day's share is now's, less the day's start's: a trade
    held over the roll counts its pieces on the day each was sold. */
export function bankedOf(a: PaperAccount, name: string, before = Infinity): number {
  const upTo: PaperAccount = {
    ...a,
    opt: { ...a.opt, fills: a.opt.fills.filter(f => f.contract.ticker === name && f.at.at < before) },
    fut: { ...a.fut, fills: a.fut.fills.filter(f => f.symbol === name && f.at.at < before) },
  };
  const ob = optBookOf(upTo);
  const fb = futBookOf(upTo);
  let x = 0;
  for (const t of ob.trades) x += t.pnl;
  for (const p of ob.positions) x += p.banked;
  for (const t of fb.trades) x += t.pnl;
  for (const p of fb.positions) x += p.banked;
  return cents(x);
}

/* ================================================================== */
/* What the account is worth */
/* ================================================================== */

/** A position on the live quote: `value` is signed (a short is what buying it back would cost, below 0); `margin` is the
    line of margin.ts it is held on (a short), if any */
export type MarkedOpt = OptPosition & { quote: Quote; value: number; pnl: number; r: number; margin?: MarginLine };
export interface PaperView {
  /** The start, plus everything closed, less every fee — with an option's price paid out of it */
  cash: number;
  /** Cash + the options at the mark */
  equity: number;
  /** Cash + the longs at their bid, less the shorts at their ask — what it would close for now (a plan that values open
      contracts so) */
  equityBid: number;
  /** What it is worth less what is open, up or down: the start and every closed trade (a firm's "balance") */
  balance: number;
  /** What is open, up or down */
  openPnl: number;
  optValue: number;
  /** What can pay for an option or hold a short: cash less what the open shorts hold (margin.ts) */
  free: number;
  /** What the open shorts hold of the reader's own money — a credit spread's or a cash-secured put's whole loss, a naked
      short's Reg T estimate less its premium — re-marked every tick */
  margin: number;
  /** …and all they hold, the premium in (free = cash − marginReq) */
  marginReq: number;
  marginLines: MarginLine[];
  /** What is free (cash − what the shorts hold): under 0 is a margin call. A long option has no loan value under Reg T,
      so the longs held are not counted toward it. */
  excess: number;
  /** Equity is under what the open shorts need: nothing new opens until it is cured */
  marginCall: boolean;
  /** What the trading day began at, and the account against it */
  dayOpen: number;
  today: number;
  allTime: number;
  opt: MarkedOpt[];
  optTrades: OptTrade[];
  /** Futures trades closed before options-only — history */
  futTrades: FutTrade[];
  /** Every closed trade's result, added up */
  closed: number;
}
export function viewOf(a: PaperAccount, m: PaperMarket): PaperView {
  const ob = optBookOf(a);
  const fb = futBookOf(a);
  let cash = a.startCash;
  for (const f of a.opt.fills) cash += (f.side === 'buy' ? -1 : 1) * f.price * MULT * f.qty - f.fee;
  cash = cents(cash + fb.realized - fb.feesPaid);
  const marked = ob.positions.map(p => {
    const quote = m.optQuote(p.contract);
    const value = cents(p.dir * quote.mark * MULT * p.qty);
    const pnl = cents(p.dir * (quote.mark * MULT * p.qty - p.basis) - p.fees);
    /* a long's R is on what it cost; a short's on what it held when it opened (or the premium, where nothing was held) */
    const base = p.dir > 0 ? p.basis + p.fees : p.held > 0 ? p.held : p.basis;
    return { ...p, quote, value, pnl, r: base > 0 ? pnl / base : 0 };
  });
  const mg = marginOf(marked.map(p => ({ key: p.key, contract: p.contract, dir: p.dir, qty: p.qty, avg: p.avg, quote: p.quote, secured: p.secured, spotIn: p.spotIn, last: a.marks[p.key] })));
  const opt: MarkedOpt[] = marked.map(p => (p.dir < 0 ? { ...p, margin: marginLineOf(mg, p.key) } : p));
  const optValue = cents(opt.reduce((x, p) => x + p.value, 0));
  const equity = cents(cash + optValue);
  const equityBid = cents(cash + opt.reduce((x, p) => x + (p.dir > 0 ? p.quote.bid : -(p.quote.ask > 0 ? p.quote.ask : p.quote.mark)) * MULT * p.qty, 0));
  const free = cents(cash - mg.req);
  /* Reg T gives a listed option no loan value: the longs held do not hold the shorts, so excess is what is free */
  const excess = free;
  const openPnl = cents(opt.reduce((x, p) => x + p.pnl, 0));
  const dayOpen = a.ledger[a.day]?.open ?? a.startCash;
  const closed = cents(ob.trades.reduce((x, t) => x + t.pnl, 0) + fb.trades.reduce((x, t) => x + t.pnl, 0));
  return {
    cash,
    equity,
    equityBid,
    balance: cents(equity - openPnl),
    openPnl,
    optValue,
    free,
    margin: mg.held,
    marginReq: mg.req,
    marginLines: mg.lines,
    excess,
    marginCall: mg.req > 0 && excess < -0.005,
    dayOpen,
    today: cents(equity - dayOpen),
    allTime: cents(equity - a.startCash),
    opt,
    optTrades: ob.trades,
    futTrades: fb.trades,
    closed,
  };
}

/* ================================================================== */
/*  OPTIONS: ORDERS                                                    */
/* ================================================================== */

export interface OptDraft {
  contract: ContractId;
  side: Side;
  qty: number;
  kind: OrderKind;
  price?: number;
  on?: 'name';
  tif?: 'day' | 'gtc';
  bracket?: Bracket;
  tag?: string;
  /** A put sold to open: cash-secured (its strike × 100 held) rather than on margin — a plan with no margin makes it so */
  secured?: 'cash';
}
const nameHit = (o: { kind: OrderKind; contract: ContractId; price?: number }, spot: number): boolean => (nameGoesUp(o.kind, o.contract.right) ? spot >= o.price! : spot <= o.price!);
/** The working sells that close a long (a sell to open is not one) */
const workingSells = (a: PaperAccount, key: string) => a.opt.orders.filter(o => o.status === 'working' && o.side === 'sell' && !o.opens && contractKey(o.contract) === key);
/** …and the working buys that close a short */
const workingCovers = (a: PaperAccount, key: string) => a.opt.orders.filter(o => o.status === 'working' && o.side === 'buy' && o.opens === false && contractKey(o.contract) === key);
const optReserved = (a: PaperAccount, key: string) => {
  const byGroup = new Map<string, { limit: number; stop: number }>();
  let loose = 0;
  for (const o of workingSells(a, key)) {
    if (!o.oco || o.kind === 'market') loose += o.qty;
    else {
      const g = byGroup.get(o.oco) ?? { limit: 0, stop: 0 };
      g[o.kind] += o.qty;
      byGroup.set(o.oco, g);
    }
  }
  return loose + [...byGroup.values()].reduce((x, g) => x + Math.max(g.limit, g.stop), 0);
};
const optFarness = (o: OptOrder, q: Quote): number => (o.on === 'name' ? Math.abs((o.price ?? 0) - q.spot) / Math.max(0.01, q.spot) : Math.abs((o.price ?? 0) - q.bid) / Math.max(0.01, q.bid));
const setOpt = (a: PaperAccount, orders: OptOrder[], fills = a.opt.fills): PaperAccount => ({ ...a, opt: { orders, fills } });
const optResize = (a: PaperAccount, left: Map<string, number>, at: PaperMoment, why: string): PaperAccount =>
  setOpt(
    a,
    a.opt.orders.map(x => {
      const q = left.get(x.id);
      if (q == null || x.status !== 'working' || q === x.qty) return x;
      return q <= 0 ? { ...x, status: 'cancelled' as const, done: at, why } : { ...x, qty: q };
    })
  );

/** The position held on a contract now, if any */
export const heldOn = (a: PaperAccount, key: string): OptPosition | null => optBookOf(a).positions.find(p => p.key === key) ?? null;
/** Does an order open (or add to) a position: a buy does unless the contract is held short, a sell unless it is held
    long. A way out never goes past flat: what is more than is held is refused, not turned the other way. */
export const opensOn = (pos: Pick<OptPosition, 'dir'> | null, side: Side): boolean => !pos || (side === 'buy') === (pos.dir > 0);
/** A put sold to open is cash-secured where the reader asks, or the plan holds every sold put so; nothing else is */
const secureOf = (a: PaperAccount, d: OptDraft): OptDraft => {
  const put = d.side === 'sell' && d.contract.short == null && d.contract.right === 'P';
  return { ...d, secured: put && (d.secured === 'cash' || putsSecured(a)) ? 'cash' : undefined };
};
/** What the draft is, as the engine takes it: a way in or out, a put cash-secured where it is */
export function draftOf(a: PaperAccount, d: OptDraft): OptDraft & { opens: boolean } {
  const opens = opensOn(heldOn(a, contractKey(d.contract)), d.side);
  return { ...(opens ? secureOf(a, d) : { ...d, secured: undefined }), opens };
}
/** An expiring SPY, QQQ, IWM or DIA contract on a plan that closes it at 16:10: from the bell to then it may still be closed */
export const lateWindow = (a: PaperAccount, c: ContractId, now: number): boolean => {
  const late = lateCloseOf(a, c);
  return late != null && now >= tradingEndsAt(c) && now < late;
};
/** What closing a way out leaves: what is held less what the working ways out already speak for */
const reservedOf = (a: PaperAccount, key: string, dir: 1 | -1) => (dir > 0 ? optReserved(a, key) : workingCovers(a, key).reduce((x, o) => x + o.qty, 0));
type Leg = { contract: ContractId; side: Side; qty: number; px: number; secured?: 'cash' };
/** The account as if these fills had happened — what a way in would leave free, before it is taken */
function withFills(a: PaperAccount, m: PaperMarket, legs: Leg[]): PaperAccount {
  const at = momentAt(m.now);
  const fills: OptFill[] = legs.map((d, i) => ({ id: `~${i}`, orderId: null, at, contract: d.contract, side: d.side, qty: d.qty, price: cents(d.px), fee: optFee(a, d.contract, d.qty), how: 'market', spot: 0, delta: 0, iv: 0, theta: 0, bar: 0, life: m.life, opens: true, secured: d.secured }));
  return { ...a, opt: { ...a.opt, fills: [...a.opt.fills, ...fills] } };
}
/** The margin call, in words */
export const marginCallWords = (v: Pick<PaperView, 'excess' | 'marginReq'>): string => `Margin call — equity is ${money(Math.max(0, -v.excess))} short of what the open shorts hold (${money(v.marginReq)}, re-marked every tick). Nothing new opens until it is cured: buy a short back, or close something`;
/** The buying power a way in needs: refused on a margin call, or where its fills would leave less than nothing free */
function powerRefusal(a: PaperAccount, m: PaperMarket, v: PaperView, legs: Leg[]): string | null {
  if (v.marginCall) return marginCallWords(v);
  const after = viewOf(withFills(a, m, legs), m);
  if (!(after.free < -1e-9)) return null;
  const need = cents(v.free - after.free);
  return legs.every(l => l.side === 'buy') ? `Not enough free money — this needs ${money(need)}, and ${money(Math.max(0, v.free))} is free` : `Not enough buying power — this holds ${money(need)}, and ${money(Math.max(0, v.free))} is free`;
}
/** What a way in would hold and leave free, before it is taken — the ticket's foot: each leg at its market (a sale at
    the bid, a buy at the ask). `held`: what it adds to the margin held; `need`: what it takes off free. */
export function openPreview(a: PaperAccount, m: PaperMarket, legs: { contract: ContractId; side: Side; qty: number; secured?: 'cash' }[]): { held: number; need: number; free: number } {
  const v = viewOf(a, m);
  const ls: Leg[] = legs.map(l => {
    const q = m.optQuote(l.contract);
    const d = draftOf(a, { ...l, kind: 'market' });
    const px = l.side === 'sell' ? q.bid : q.ask;
    return { contract: l.contract, side: l.side, qty: l.qty, px: px > 0 ? px : Number.isFinite(q.mark) ? q.mark : 0, secured: d.secured };
  });
  const after = viewOf(withFills(a, m, ls), m);
  return { held: cents(after.margin - v.margin), need: cents(v.free - after.free), free: after.free };
}
/** Calls sold on a name and expiry that a sale of `qty` of the long call `key` would leave with nothing over them */
function bareCallsAfter(a: PaperAccount, c: ContractId, key: string, qty: number): number {
  const same = optBookOf(a).positions.filter(p => p.contract.ticker === c.ticker && p.contract.expiry === c.expiry && p.contract.right === 'C' && p.contract.short == null);
  const shorts = same.filter(p => p.dir < 0).reduce((x, p) => x + p.qty, 0);
  const longs = same.filter(p => p.dir > 0).reduce((x, p) => x + p.qty - (p.key === key ? qty : 0), 0);
  return Math.max(0, shorts - longs);
}

/** Why an option draft cannot be taken, or null — the words the ticket shows before the press. `alone`: one leg of an
    order of several, asked of everything but the money (comboRefusal asks that of the legs together). */
export function optRefusal(a: PaperAccount, m: PaperMarket, d0: OptDraft, alone = true): string | null {
  if (!Number.isInteger(d0.qty) || d0.qty < 1) return 'Enter a whole number of contracts';
  const key = contractKey(d0.contract);
  const pos = heldOn(a, key);
  const d = draftOf(a, d0);
  const opening = d.opens;
  const late = !opening && lateWindow(a, d.contract, m.now);
  if (tradingEndsAt(d.contract) <= m.now && !late) return isVixRoot(d.contract.ticker) && d.contract.expiry >= nyAt(m.now).date ? 'VIX options stop trading at the close the day before they settle' : 'That contract has expired';
  if (d.contract.short != null) {
    const { strike, short, right } = d.contract;
    if (short === strike) return 'A spread needs two different strikes';
    if (right === 'C' ? short < strike : short > strike) return 'A spread is written here with its second strike further out than the first — bought, it is a debit spread; sold, a credit spread';
  }
  if (d.kind !== 'market' && !(d.price && d.price > 0)) return 'Enter a price';
  if (d.kind === 'stop' && opening) return d.side === 'buy' ? 'A stop is a way out — it sells' : 'A stop is a way out — it closes what is held';
  if (d.on === 'name' && (d.side === 'buy' || d.kind === 'market' || opening)) return 'Only a sell that waits can be set on the name’s price';
  if (d.kind === 'market' && !m.open() && !late) return 'The market is shut — options trade 09:30 to 16:00 New York. Leave a limit that waits for the open';
  const q = m.optQuote(d.contract);
  const name = d.contract.ticker;
  if (opening) {
    if (pos && (pos.secured ?? null) !== (d.secured ?? null)) return pos.secured ? 'You hold this put cash-secured — add to it the same way' : 'You hold this put sold on margin — add to it the same way';
    const px = d.side === 'buy' ? (d.kind === 'limit' ? Math.min(d.price!, q.ask) : q.ask) : d.kind === 'limit' ? Math.max(d.price!, q.bid) : q.bid;
    const v = viewOf(a, m);
    /* the account's own state and its plan's hard rules first (rules.ts) */
    const ruled = ruleRefusal(a, m, d, v, px);
    if (ruled) return ruled;
    if (alone) {
      const power = powerRefusal(a, m, v, [{ contract: d.contract, side: d.side, qty: d.qty, px, secured: d.secured }]);
      if (power) return power;
    } else if (v.marginCall) return marginCallWords(v);
    if (d.kind === 'market' && q.dead) return 'No market in that contract right now';
    /* our ceiling (a way in on a contract already held adds to it) */
    if (!pos) {
      const held = new Set(v.opt.map(p => p.key));
      const pending = new Set(a.opt.orders.filter(o => o.status === 'working' && (o.opens ?? o.side === 'buy') && !held.has(contractKey(o.contract))).map(o => contractKey(o.contract)));
      const open = held.size + pending.size - (pending.has(key) ? 1 : 0);
      if (open >= OPEN_CEILING) return `No more than ${OPEN_CEILING} positions open at once — close one first`;
    }
    /* a sell to open carries no bracket: its way out is a buy back */
    if (d.side === 'sell') return null;
    const shape = ladderShapeRefusal(d.bracket, d.qty);
    if (shape) return shape;
    const { targets, stops } = rungsOf(d.bracket, d.qty);
    const many = (n: number, word: string) => (n > 1 ? `Every ${word}` : `The ${word}`);
    if (d.bracket?.on === 'name') {
      const up = d.contract.right === 'C';
      if (targets.some(r => (up ? r.price <= q.spot : r.price >= q.spot))) return `${many(targets.length, 'target')} has to be ${up ? 'above' : 'below'} where ${name} stands`;
      if (stops.some(r => (up ? r.price >= q.spot : r.price <= q.spot))) return `${many(stops.length, 'stop')} has to be ${up ? 'below' : 'above'} where ${name} stands`;
      return null;
    }
    if (targets.some(r => r.price <= px)) return `${many(targets.length, 'target')} has to be above what you pay`;
    if (stops.some(r => r.price >= px)) return `${many(stops.length, 'stop')} has to be under what you pay`;
    return null;
  }
  /* a way out: never more than is held, nor what a working way out already speaks for */
  const held = pos!.qty;
  const short = pos!.dir < 0;
  if (d.kind === 'market' ? held < d.qty : held - reservedOf(a, key, pos!.dir) < d.qty) return d.kind === 'market' ? `You hold ${held}${short ? ' short' : ''} — ${short ? 'buy back' : 'sell'} no more than that (past flat would open the other way: close it first)` : 'Those contracts are already spoken for by a working order';
  if (d.kind === 'market' && q.dead) return short ? 'No offer to buy it back from right now' : 'No bid to sell into right now';
  if (d.on === 'name' && nameHit(d, q.spot)) return `${name} is already past that — it would sell on the next tick`;
  /* a long call over a call sold: on a plan that never holds a call sold bare, the short goes first */
  if (!short && d.contract.short == null && d.contract.right === 'C' && nakedCallsBarred(a) && bareCallsAfter(a, d.contract, key, d.qty) > 0) return 'That long call caps a call you sold on the same expiry — buy the short call back first: this plan never holds a call sold with nothing over it';
  return null;
}

/** The planned risk a buy carried: its stops as a price of the contract, on average by their contracts */
function plannedStopOf(o: OptOrder, m: PaperMarket): number | undefined {
  const { stops } = rungsOf(o.bracket, o.qty);
  if (!stops.length) return undefined;
  const asContract = (level: number) => (o.bracket?.on === 'name' ? m.optQuoteAt(o.contract, level).bid : level);
  const n = stops.reduce((x, r) => x + r.qty, 0);
  return cents(stops.reduce((x, r) => x + asContract(r.price) * r.qty, 0) / Math.max(1, n));
}
const trailFrom = (price: number, on: 'name' | undefined, q: Quote): { trail: number; peak: number } => (on === 'name' ? { trail: cents(Math.max(0.01, Math.abs(q.spot - price))), peak: q.spot } : { trail: cents(Math.max(0.01, q.bid - price)), peak: q.bid });
const trailAt = (by: number, on: 'name' | undefined, q: Quote): { trail: number; peak: number } => ({ trail: cents(Math.max(0.01, by)), peak: on === 'name' ? q.spot : q.bid });

/** After a sell: the ladder is made to fit what is still held (the backtest's rule, engine.ts afterSell) */
function afterSell(a: PaperAccount, sold: OptOrder, q: Quote, at: PaperMoment, m: PaperMarket): PaperAccount {
  const key = contractKey(sold.contract);
  let next = a;
  if (sold.oco) {
    const other = workingSells(next, key).filter(o => o.oco === sold.oco && o.kind !== sold.kind);
    next = optResize(next, giveUp(other, sold.qty, o => optFarness(o, q)), at, 'its pair filled');
    const firstTarget = sold.kind === 'limit' && !a.opt.orders.some(o => o.oco === sold.oco && o.kind === 'limit' && o.status === 'filled' && o.id !== sold.id);
    const pos = optBookOf(next).positions.find(p => p.key === key);
    if (firstTarget && pos) {
      next = setOpt(
        next,
        next.opt.orders.map(o => {
          if (o.status !== 'working' || o.oco !== sold.oco || o.kind !== 'stop' || !o.breakeven) return o;
          const now = o.on === 'name' ? m.optQuoteAt(o.contract, o.price ?? 0).bid : (o.price ?? 0);
          if (!(q.bid > pos.avg) || pos.avg <= now) return { ...o, breakeven: false };
          return { ...o, on: undefined, price: pos.avg, breakeven: false, moved: at, ...(o.trail != null ? { trail: cents(Math.max(0.01, q.bid - pos.avg)), peak: q.bid } : {}) };
        })
      );
    }
  }
  const held = optBookOf(next).positions.find(p => p.key === key)?.qty ?? 0;
  const mine = workingSells(next, key);
  if (held === 0) return optResize(next, new Map(mine.map(o => [o.id, 0])), at, 'the position was closed');
  const loose = mine.filter(o => !o.oco).reduce((x, o) => x + o.qty, 0);
  const cover = Math.max(0, held - loose);
  for (const kind of ['limit', 'stop'] as const) {
    const side = workingSells(next, key).filter(o => o.oco && o.kind === kind);
    const over = side.reduce((x, o) => x + o.qty, 0) - cover;
    if (over > 0) next = optResize(next, giveUp(side, over, o => optFarness(o, q)), at, 'its contracts were sold');
  }
  return next;
}

/** After a buy back: the working buys that close the short are made to fit what is still short */
function afterCover(a: PaperAccount, bought: OptOrder, at: PaperMoment): PaperAccount {
  const key = contractKey(bought.contract);
  const mine = workingCovers(a, key);
  if (!mine.length) return a;
  const pos = heldOn(a, key);
  if (!pos || pos.dir > 0) return optResize(a, new Map(mine.map(x => [x.id, 0])), at, 'the position was closed');
  let over = mine.reduce((x, y) => x + y.qty, 0) - pos.qty;
  if (over <= 0) return a;
  const left = new Map<string, number>();
  /* the newest give way first */
  for (const x of [...mine].reverse()) {
    if (over <= 0) break;
    const take = Math.min(x.qty, over);
    left.set(x.id, x.qty - take);
    over -= take;
  }
  return optResize(a, left, at, 'its contracts were bought back');
}
/** What a short holds on its own as it opens (margin.ts, less its premium) — its R's measure */
const heldAtOpen = (o: OptOrder, price: number, q: Quote): number => marginOf([{ key: 'x', contract: o.contract, dir: -1, qty: o.qty, avg: price, quote: q, secured: o.secured, spotIn: q.spot }]).held;

function optFillNow(a: PaperAccount, o0: OptOrder, price: number, how: OptFillHow, q: Quote, m: PaperMarket, note?: string): PaperAccount {
  const at = momentAt(m.now);
  /* the reader's order takes at most the size the quote shows (a leg of an order of several fills whole: its legs go
     together); the rest stays working for the next quote. The rules' and the page's closes, and a settlement, are not
     capped. */
  const capped = !!o0.id && !o0.combo && (how === 'market' || how === 'limit' || how === 'stop');
  const n = capped ? fillableQty(o0, q) : o0.qty;
  if (n < 1) return a;
  const rest = o0.qty - n;
  const total = (o0.filled ?? 0) + n;
  const used = o0.took && q.quotedAt != null && o0.took.at === q.quotedAt ? o0.took.qty : 0;
  const o: OptOrder = rest > 0 ? { ...o0, qty: n } : o0;
  const opens = o.opens ?? o.side === 'buy';
  let [id, next] = nextId(a, 'f');
  const fill: OptFill = {
    id,
    orderId: o.id || null,
    at,
    contract: o.contract,
    side: o.side,
    qty: o.qty,
    price: cents(price),
    fee: how === 'expired' ? 0 : optFee(a, o.contract, o.qty),
    how,
    spot: q.spot,
    delta: q.delta,
    iv: q.iv,
    theta: q.theta,
    tag: o.tag,
    plannedStop: o.side === 'buy' && opens ? plannedStopOf(o, m) : undefined,
    bar: m.bar(o.contract.ticker),
    life: m.life,
    note,
    opens,
    ...(o.secured ? { secured: o.secured } : {}),
    ...(o.combo ? { combo: o.combo, comboName: o.comboName } : {}),
    ...(opens && o.side === 'sell' ? { held: heldAtOpen(o, price, q) } : {}),
  };
  next = setOpt(
    next,
    next.opt.orders.map(x =>
      x.id !== o.id || !o.id ? x : rest > 0 ? { ...x, qty: rest, filled: total, ...(q.quotedAt != null ? { took: { at: q.quotedAt, qty: used + n } } : {}) } : { ...x, ...(x.filled ? { qty: total } : {}), status: 'filled' as const, done: at, fillPrice: fill.price }
    ),
    [...next.opt.fills, fill]
  );
  if (!opens && o.side === 'sell') next = afterSell(next, o, q, at, m);
  if (!opens && o.side === 'buy') next = afterCover(next, o, at);
  /* the ways out a buy carried go on once all of it has filled */
  const { targets, stops } = rungsOf(o.side === 'buy' && opens && rest === 0 ? o.bracket : undefined, total);
  if (targets.length || stops.length) {
    const [oco, n2] = nextId(next, 'g');
    next = n2;
    const on = o.bracket?.on;
    for (const [kind, rungs] of [['limit', targets], ['stop', stops]] as const) {
      for (const r of rungs) {
        const [oid, n3] = nextId(next, 'o');
        const switches = kind === 'stop' ? { breakeven: o.bracket?.breakeven || undefined, ...(o.bracket?.trail ? (o.bracket.trailBy ? trailAt(o.bracket.trailBy, on, q) : trailFrom(r.price, on, q)) : {}) } : {};
        next = setOpt(n3, [...n3.opt.orders, { id: oid, placed: at, contract: o.contract, side: 'sell', qty: r.qty, kind, price: r.price, on, tif: 'gtc', status: 'working', oco, tag: o.tag, life: m.life, ...switches }]);
      }
    }
  }
  return next;
}

/** Take an option order. A market order fills now; the rest wait for a later tick. */
export function optPlace(a: PaperAccount, m: PaperMarket, d0: OptDraft): PaperAccount {
  const at = momentAt(m.now);
  let [id, next] = nextId(a, 'o');
  const d = draftOf(a, d0);
  const base: OptOrder = { id, placed: at, contract: d.contract, side: d.side, qty: d.qty, kind: d.kind, price: d.kind === 'market' ? undefined : d.price, on: d.kind === 'market' ? undefined : d.on, tif: d.tif ?? (d.kind === 'market' ? 'day' : 'gtc'), status: 'working', bracket: d.side === 'buy' && d.opens ? d.bracket : undefined, tag: d.tag, life: m.life, opens: d.opens, ...(d.secured ? { secured: d.secured } : {}) };
  const why = optRefusal(a, m, d0);
  next = { ...setOpt(next, [...next.opt.orders, why ? { ...base, status: 'refused', why, done: at } : base]), touchedAt: m.now };
  if (why || d.kind !== 'market') return next;
  const q = m.optQuote(d.contract);
  return optFillNow(next, base, d.side === 'buy' ? q.ask : q.bid, 'market', q, m);
}

export function optCancel(a: PaperAccount, m: PaperMarket, orderId: string, why = 'cancelled by you'): PaperAccount {
  const at = momentAt(m.now);
  /* a leg of an order of several takes its other legs with it */
  const combo = a.opt.orders.find(o => o.id === orderId)?.combo;
  return { ...setOpt(a, a.opt.orders.map(o => ((o.id === orderId || (combo && o.combo === combo)) && o.status === 'working' ? { ...o, status: 'cancelled', done: at, why } : o))), touchedAt: m.now };
}
/** Move a working option order's price — not taken where it would not wait */
export function optAmend(a: PaperAccount, m: PaperMarket, orderId: string, price: number): PaperAccount {
  const o = a.opt.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'working' || !(price > 0) || o.combo) return a;
  const q = m.optQuote(o.contract);
  const trail = o.kind === 'stop' && o.trail != null ? trailFrom(cents(price), o.on, q) : {};
  if (o.on === 'name') {
    if (nameHit({ ...o, price }, q.spot)) return a;
  } else {
    if (o.side === 'sell' && o.kind === 'limit' && price <= q.bid) return a;
    if (o.side === 'sell' && o.kind === 'stop' && price >= q.bid) return a;
    if (o.side === 'buy' && o.kind === 'limit' && (o.opens ?? true) && price * MULT * o.qty + optFee(a, o.contract, o.qty) > viewOf(a, m).free) return a;
    /* a buy back that waits: under the ask (at it, it would fill now); a buy stop over it */
    if (o.side === 'buy' && o.opens === false && o.kind === 'limit' && price >= q.ask) return a;
    if (o.side === 'buy' && o.kind === 'stop' && price <= q.ask) return a;
  }
  return { ...setOpt(a, a.opt.orders.map(x => (x.id === orderId ? { ...x, price: cents(price), ...trail } : x))), touchedAt: m.now };
}
export function optLadderRoom(a: PaperAccount, m: PaperMarket, c: ContractId): Record<'target' | 'stop', 'first' | 'more' | null> {
  const key = contractKey(c);
  /* the ladder rides a long; a short's way out is a buy back */
  const pos = optBookOf(a).positions.find(p => p.key === key && p.dir > 0);
  const q = m.optQuote(c);
  const mine = workingSells(a, key);
  const cover = (pos?.qty ?? 0) - mine.filter(o => !o.oco).reduce((x, o) => x + o.qty, 0);
  const room = (kind: 'limit' | 'stop') => {
    const rungs = mine.filter(o => o.oco && o.kind === kind);
    if (!pos || cover < 1) return null;
    if (!rungs.length) return 'first' as const;
    return nextRung(rungs, cover, kind === 'limit' ? MAX_TARGETS : MAX_STOPS, o => optFarness(o, q)) ? ('more' as const) : null;
  };
  return { target: room('limit'), stop: room('stop') };
}
export function optLadderTake(a: PaperAccount, m: PaperMarket, c: ContractId): Record<'target' | 'stop', number> {
  const key = contractKey(c);
  const pos = optBookOf(a).positions.find(p => p.key === key && p.dir > 0);
  const q = m.optQuote(c);
  const mine = workingSells(a, key);
  const cover = (pos?.qty ?? 0) - mine.filter(o => !o.oco).reduce((x, o) => x + o.qty, 0);
  const take = (kind: 'limit' | 'stop') => {
    const rungs = mine.filter(o => o.oco && o.kind === kind);
    if (!pos || cover < 1) return 0;
    return rungs.length ? (nextRung(rungs, cover, kind === 'limit' ? MAX_TARGETS : MAX_STOPS, o => optFarness(o, q))?.qty ?? 0) : cover;
  };
  return { target: take('limit'), stop: take('stop') };
}
/** A target or a stop put on an open position (pulled off its chip) — the backtest's `attach` */
export function optAttach(a: PaperAccount, m: PaperMarket, c: ContractId, kind: 'target' | 'stop', price: number, on?: 'name'): PaperAccount {
  const key = contractKey(c);
  const pos = optBookOf(a).positions.find(p => p.key === key && p.dir > 0);
  if (!pos || !(price > 0)) return a;
  const q = m.optQuote(c);
  const orderKind: OrderKind = kind === 'target' ? 'limit' : 'stop';
  if (on === 'name' ? nameHit({ kind: orderKind, contract: c, price }, q.spot) : kind === 'target' ? price <= q.bid : price >= q.bid) return a;
  const mine = workingSells(a, key);
  const group = mine.find(o => o.oco)?.oco;
  const rungs = mine.filter(o => o.oco && o.kind === orderKind);
  const cover = pos.qty - mine.filter(o => !o.oco).reduce((x, o) => x + o.qty, 0);
  if (cover < 1) return a;
  const take = rungs.length ? nextRung(rungs, cover, kind === 'target' ? MAX_TARGETS : MAX_STOPS, o => optFarness(o, q)) : { qty: cover, from: null };
  if (!take || take.qty < 1) return a;
  let next = a;
  let oco = group;
  if (!oco) [oco, next] = nextId(next, 'g');
  const [oid, n2] = nextId(next, 'o');
  const sibling = mine.find(o => o.oco === oco && o.kind === 'stop');
  const switches = kind === 'stop' ? { breakeven: sibling?.breakeven || undefined, ...(sibling?.trail != null ? trailFrom(cents(price), on, q) : {}) } : {};
  const orders = n2.opt.orders.map(x => (take.from && x.id === take.from.id ? { ...x, qty: x.qty - take.qty } : x));
  return { ...setOpt(n2, [...orders, { id: oid, placed: momentAt(m.now), contract: c, side: 'sell', qty: take.qty, kind: orderKind, price: cents(price), on, tif: 'gtc', status: 'working', oco, tag: pos.tag, life: m.life, ...switches }]), touchedAt: m.now };
}
export function optSetTrail(a: PaperAccount, m: PaperMarket, orderId: string, on: boolean, by?: number): PaperAccount {
  const o = a.opt.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'working' || o.side !== 'sell' || o.kind !== 'stop' || o.price == null) return a;
  if (on && by != null && !(by > 0)) return a;
  const q = m.optQuote(o.contract);
  return { ...setOpt(a, a.opt.orders.map(x => (x.id !== orderId ? x : on ? { ...x, ...(by != null ? trailAt(by, o.on, q) : trailFrom(o.price!, o.on, q)) } : { ...x, trail: undefined, peak: undefined }))), touchedAt: m.now };
}
export function optSetBreakeven(a: PaperAccount, m: PaperMarket, orderId: string, on: boolean): PaperAccount {
  const o = a.opt.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'working' || o.kind !== 'stop') return a;
  return { ...setOpt(a, a.opt.orders.map(x => (x.status === 'working' && x.kind === 'stop' && (x.id === orderId || (o.oco && x.oco === o.oco)) ? { ...x, breakeven: on || undefined } : x))), touchedAt: m.now };
}
/** The same way out, waiting on the other thing — without moving its line (the backtest's `rebase`) */
export function optRebase(a: PaperAccount, m: PaperMarket, orderId: string, to: 'name' | 'contract', spotForBid: (c: ContractId, bid: number) => number | null): PaperAccount {
  const o = a.opt.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'working' || o.side !== 'sell' || o.kind === 'market' || o.price == null) return a;
  if ((o.on === 'name') === (to === 'name')) return a;
  const price = to === 'name' ? spotForBid(o.contract, o.price) : cents(m.optQuoteAt(o.contract, o.price).bid);
  if (price == null || !(price > 0)) return a;
  const basis = to === 'name' ? ('name' as const) : undefined;
  const trail = o.trail != null ? trailFrom(price, basis, m.optQuote(o.contract)) : {};
  return { ...setOpt(a, a.opt.orders.map(x => (x.id === orderId ? { ...x, on: basis, price, ...trail } : x))), touchedAt: m.now };
}
/** Out of a contract now: what is working on it goes first, then the lot is sold at the bid — or, short, bought back at
    the ask */
export function optClose(a: PaperAccount, m: PaperMarket, c: ContractId, qty: number): PaperAccount {
  const key = contractKey(c);
  const side: Side = heldOn(a, key)?.dir === -1 ? 'buy' : 'sell';
  let next = a;
  for (const o of a.opt.orders) if (o.status === 'working' && o.side === side && !o.opens && contractKey(o.contract) === key) next = optCancel(next, m, o.id);
  return optPlace(next, m, { contract: c, side, qty, kind: 'market' });
}

/* ================================================================== */
/*  ORDERS OF SEVERAL LEGS (an iron condor: two spreads sold as one)   */
/* ================================================================== */

export interface ComboLeg {
  contract: ContractId;
  side: Side;
}
export interface ComboDraft {
  /** "Iron condor" */
  name: string;
  legs: ComboLeg[];
  /** Sets: each leg trades this many */
  qty: number;
  kind: 'market' | 'limit';
  /** A limit: the least net a set takes — what the legs sold bring in less what the legs bought cost, a share (a
      credit above 0, a debit below) */
  net?: number;
  tif?: 'day' | 'gtc';
  tag?: string;
}
/** What a set brings in at the market now: the legs sold at their bid, less the legs bought at their ask, a share —
    NaN where a leg has no market */
export function comboNatural(m: PaperMarket, legs: ComboLeg[]): number {
  let x = 0;
  for (const l of legs) {
    const q = m.optQuote(l.contract);
    if (q.dead) return NaN;
    x += l.side === 'sell' ? q.bid : -q.ask;
  }
  return cents(x);
}
/** Why an order of several cannot be taken, or null: each leg as an order of its own, and the money for all of them */
export function comboRefusal(a: PaperAccount, m: PaperMarket, cd: ComboDraft): string | null {
  if (!Number.isInteger(cd.qty) || cd.qty < 1) return 'Enter a whole number of sets';
  if (cd.legs.length < 2) return 'An order of several needs two legs or more';
  const t = cd.legs[0].contract;
  if (cd.legs.some(l => l.contract.ticker !== t.ticker || l.contract.expiry !== t.expiry)) return 'Its legs have to be on one name and one expiry';
  if (new Set(cd.legs.map(l => contractKey(l.contract))).size < cd.legs.length) return 'Two legs on the same contract — make them one';
  if (cd.kind === 'limit' && !Number.isFinite(cd.net ?? NaN)) return 'Enter a net price';
  const opening = cd.legs.map(l => opensOn(heldOn(a, contractKey(l.contract)), l.side));
  if (opening.some(x => x !== opening[0])) return 'An order of several either opens or closes — not some of each';
  const legPx = (l: ComboLeg) => {
    const q = m.optQuote(l.contract);
    const px = l.side === 'sell' ? q.bid : q.ask;
    return px > 0 ? px : Number.isFinite(q.mark) && q.mark > 0 ? q.mark : 0.01;
  };
  for (const l of cd.legs) {
    const why = optRefusal(a, m, { contract: l.contract, side: l.side, qty: cd.qty, kind: cd.kind, price: cd.kind === 'limit' ? legPx(l) : undefined }, false);
    if (why) return `${contractWords(l.contract)}: ${why}`;
  }
  if (cd.kind === 'market' && !Number.isFinite(comboNatural(m, cd.legs))) return 'No market in one of its legs right now';
  if (!opening[0]) return null;
  return powerRefusal(a, m, viewOf(a, m), cd.legs.map(l => ({ ...draftOf(a, { contract: l.contract, side: l.side, qty: cd.qty, kind: 'market' }), qty: cd.qty, px: legPx(l) })));
}
/** Take an order of several: at the market every leg fills now, at its own bid or ask; a limit waits for the legs' net */
export function optPlaceCombo(a: PaperAccount, m: PaperMarket, cd: ComboDraft): PaperAccount {
  const at = momentAt(m.now);
  const why = comboRefusal(a, m, cd);
  let [combo, next] = nextId(a, 'c');
  const orders: OptOrder[] = [];
  for (const l of cd.legs) {
    const [id, n2] = nextId(next, 'o');
    next = n2;
    const d = draftOf(a, { contract: l.contract, side: l.side, qty: cd.qty, kind: cd.kind });
    orders.push({ id, placed: at, contract: l.contract, side: l.side, qty: cd.qty, kind: cd.kind, tif: cd.tif ?? (cd.kind === 'market' ? 'day' : 'gtc'), status: why ? 'refused' : 'working', ...(why ? { why, done: at } : {}), tag: cd.tag, life: m.life, opens: d.opens, ...(d.secured ? { secured: d.secured } : {}), combo, comboName: cd.name, ...(cd.kind === 'limit' ? { net: cents(cd.net!) } : {}) });
  }
  next = { ...setOpt(next, [...next.opt.orders, ...orders]), touchedAt: m.now };
  if (why || cd.kind !== 'market') return next;
  for (const o of orders) {
    const q = m.optQuote(o.contract);
    next = optFillNow(next, o, o.side === 'buy' ? q.ask : q.bid, 'market', q, m);
  }
  return next;
}

/* ================================================================== */
/* Everything at once: The rules' hand and the page's */
/* ================================================================== */

/** A price a dead quote may be closed at: a caller's real price, else the last live bid (long) or ask (short). The
    average entry is not a price, and neither is zero. */
function flattenPx(p: { key: string; dir: number; avg: number }, live: Quote, given: number | undefined, marks: Record<string, number>): number | undefined {
  const stored = marks[p.key];
  const storedOk = stored > 0;
  if (given != null && given > 0 && ((storedOk && given === stored) || given !== p.avg)) return given;
  const mkt = !live.dead ? (p.dir > 0 ? live.bid : live.ask) : 0;
  if (mkt > 0) return mkt;
  if (storedOk) return stored;
  return undefined;
}

/** Close what is open at the market and cancel what is working — the rules' hand (`rule`) or the page's (`page`).
    `at`: a price to close each at in place of the market's (a page that did not get to close its own: its last marks).
    A dead quote closes at the last real bid (long) or ask (short) stored from a live quote. It does not fill at $0 and
    it does not fill at the average entry. With neither a live quote nor a stored one, the position is left open and
    the account says the quote is missing. `only`: just these positions (and the orders on them) — every one where it
    is not given. */
export function flattenAll(a: PaperAccount, m: PaperMarket, how: 'rule' | 'page', note: string, at?: (key: string) => number | undefined, only?: Set<string>): PaperAccount {
  let next = a;
  const when = momentAt(m.now);
  const mine = (key: string) => !only || only.has(key);
  const positions = optBookOf(a).positions.filter(p => mine(p.key));
  const priced: { p: (typeof positions)[number]; px: number; live: Quote }[] = [];
  const missing: string[] = [];
  for (const p of positions) {
    const live = m.optQuote(p.contract);
    const px = flattenPx(p, live, at?.(p.key), a.marks);
    if (px == null) missing.push(contractWords(p.contract));
    else priced.push({ p, px, live });
  }
  const leave = new Set(positions.filter(p => !priced.some(x => x.p.key === p.key)).map(p => p.key));
  next = setOpt(next, next.opt.orders.map(o => (o.status === 'working' && mine(contractKey(o.contract)) && !leave.has(contractKey(o.contract)) ? { ...o, status: 'cancelled' as const, done: when, why: note } : o)));
  for (const { p, px, live } of priced) {
    /* a long sold at the bid, a short bought back at the ask */
    next = optFillNow(next, { id: '', placed: when, contract: p.contract, side: p.dir > 0 ? 'sell' : 'buy', qty: p.qty, kind: 'market', tif: 'day', status: 'working', tag: p.tag, life: m.life, opens: false }, px, how, at ? { ...live, bid: px, ask: px, spot: p.spotIn } : live, m, note);
  }
  if (missing.length) {
    const words = missing.length === 1 ? `${missing[0]} left open — the quote is missing` : `${missing.length} positions left open — the quote is missing`;
    if (next.log[0]?.words !== words) next = logged(next, m.now, words, 'info');
  }
  return { ...next, touchedAt: m.now };
}

/** Flat by the reader's hand, at once: everything working cancelled, then every position out at the market — the
    reader's own closes (a trade ends "Sold by you"), never the rules' */
export function flattenByHand(a: PaperAccount, m: PaperMarket): PaperAccount {
  let next = a;
  for (const o of a.opt.orders) if (o.status === 'working') next = optCancel(next, m, o.id);
  for (const p of optBookOf(next).positions) next = optPlace(next, m, { contract: p.contract, side: p.dir > 0 ? 'sell' : 'buy', qty: p.qty, kind: 'market' });
  return next;
}

/** An account the reader ends: everything closed at the market (at the last live bid or ask, where the quote is dead).
    A position with neither is left open — the quote is missing. The account is written down as ended — not passed, not failed */
export function endAccount(a: PaperAccount, m: PaperMarket, why = 'Ended by you'): PaperAccount {
  if (a.status !== 'open') return a;
  const last = (key: string) => {
    const p = optBookOf(a).positions.find(x => x.key === key);
    if (!p || !m.optQuote(p.contract).dead) return undefined;
    const px = a.marks[key];
    return px > 0 ? px : undefined;
  };
  const next = flattenAll(a, m, 'rule', 'the account was ended', last);
  return logged({ ...next, status: 'ended', statusAt: m.now, statusWhy: why }, m.now, `${why} — the account was ended`, 'info');
}

/** What was left open by a page that did not get to close it (the simulated feed: a new market every load) — closed at the
    last price THAT page saw, in its words */
export function closeStale(a: PaperAccount, m: PaperMarket): PaperAccount {
  const stale = optBookOf(a).positions.filter(p => p.life !== m.life);
  const staleOrders = a.opt.orders.some(o => o.status === 'working' && o.life !== m.life);
  if (!stale.length && !staleOrders) return a;
  const keys = new Set(stale.map(p => p.key));
  let next = flattenAll(a, m, 'page', 'the page closed before it could close this — at the last price it saw', key => {
    if (!keys.has(key)) return undefined;
    const px = a.marks[key];
    return px > 0 ? px : undefined;
  });
  const left = optBookOf(next).positions.filter(p => keys.has(p.key)).length;
  const n = stale.length - left;
  if (n > 0) next = logged(next, m.now, `${n} ${n === 1 ? 'position' : 'positions'} left open by a closed page ${n === 1 ? 'was' : 'were'} closed at the last price it saw`, 'page');
  return next;
}

/** An account from before options-only, on a futures plan or holding futures: its futures are closed at the last
    price it saw (its entry, where it saw none), its working futures orders cancelled, and an evaluation on a futures
    plan is ended with a note. Its trades stay — for the journal. Nothing on it is invented: no new price is read. */
export function retireFutures(a: PaperAccount, now: number): PaperAccount {
  const futPlan = !!a.plan?.legacy;
  const open = futBookOf(a).positions;
  const working = a.fut.orders.some(o => o.status === 'working');
  if (!futPlan && !open.length && !working) return a;
  let next: PaperAccount = { ...a, fut: { ...a.fut, orders: a.fut.orders.map(o => (o.status === 'working' ? { ...o, status: 'cancelled' as const, done: momentAt(now), why: 'futures were taken out of the product' } : o)) } };
  for (const p of open) {
    const [id, n2] = nextId(next, 'f');
    const px = a.marks[p.key] ?? p.avg;
    const fill: FutFill = { id, orderId: null, at: momentAt(now), symbol: p.symbol, contract: p.contract, side: p.long ? 'sell' : 'buy', qty: p.qty, price: px, fee: 0, how: 'rule', exit: true, bar: Math.floor(now / 1000), life: 'retired', note: 'futures were taken out of the product — closed at the last price this account saw' };
    next = { ...n2, fut: { ...n2.fut, fills: [...n2.fut.fills, fill] } };
  }
  if (open.length) next = logged(next, now, `Futures were taken out of the product: ${open.length} futures ${open.length === 1 ? 'position was' : 'positions were'} closed at the last price this account saw`, 'rule');
  if (futPlan && next.status === 'open') next = logged({ ...next, status: 'ended', statusAt: now, statusWhy: 'A futures evaluation — futures were taken out of the product, so it was ended. Its trades stay in the journal.' }, now, 'Ended: futures evaluations were retired (options only now)', 'info');
  return next;
}

/* ================================================================== */
/*  THE HEARTBEAT                                                      */
/* ================================================================== */

export interface PaperEvent {
  kind: 'fill' | 'expired' | 'rule' | 'failed' | 'passed' | 'day-over' | 'flat' | 'roll';
  at: number;
  /** What happened, in the house's words */
  words: string;
  /** What it made or lost, where it closed something */
  pnl?: number;
  /** What it was about: a contract's key, or a future's symbol */
  key?: string;
}

/** Has an option stopped trading: the close of its expiry (13:00 on an early close) — Tuesday's close for VIX */
const expired = (c: ContractId, now: number) => tradingEndsAt(c) <= now;
const nyClockOf = (ms: number) => {
  const t = nyAt(ms);
  return `${String(Math.floor(t.minutes / 60)).padStart(2, '0')}:${String(t.minutes % 60).padStart(2, '0')} ET`;
};
/** How a short ends at its expiry, in words: settled in cash on an index; assigned, or expired worthless, on a stock or
    fund — this desk holds no stock, so an assignment is settled in cash at what it was in the money.
    `print` is "16:00" for the closing print, otherwise the last printed minute ("15:59"). */
export function settleWords(c: ContractId, close: number, value: number, print = '16:00'): string {
  const at = `${c.ticker} ${close.toFixed(2)}`;
  const official = print === '16:00';
  const onPrint = official ? 'the 16:00 print' : `the ${print} print`;
  const atClose = official ? 'the 16:00 close' : `the ${print} print`;
  if (isBroadIndex(c.ticker)) return value > 0 ? `cash-settled at ${value.toFixed(2)} on ${onPrint} (${at})` : `expired worthless on ${onPrint} (${at})`;
  if (!(value > 0)) return `expired worthless at ${atClose} (${at})`;
  return `assigned at ${atClose} (${at}) — settled in cash at ${value.toFixed(2)}, what it was in the money${c.short != null ? ' (the leg sold assigned, the leg bought exercised)' : ''}: this desk holds no stock, so no shares change hands`;
}
/** Which print `close` is, when the day's bars say so. An injected close (no bars, or a different price) stays "16:00". */
function printOf(ticker: string, day: string, close: number): string {
  const b = closeBasisOf(ticker, day);
  return b && Math.abs(b.price - close) < 0.005 ? b.print : '16:00';
}

const planName = (plan: PaperPlan) => `${plan.firm ?? 'Your own rules'} ${plan.label}`;
/** The target met with all it waits on (rules.ts judgePass): the account passes — or goes on to its next phase, which
    starts from the balance it is at */
function passIf(a: PaperAccount, v: PaperView, m: PaperMarket, events: PaperEvent[]): PaperAccount {
  const plan = a.plan;
  const verdict = plan ? judgePass(a, v) : null;
  if (!plan || !verdict) return a;
  if (verdict.kind === 'pass') {
    events.push({ kind: 'passed', at: m.now, words: `${planName(plan)} passed — ${verdict.why}` });
    return logged({ ...a, status: 'passed', statusAt: m.now, statusRule: 'target', statusWhy: `Passed — ${verdict.why}` }, m.now, `Passed — ${verdict.why}`, 'pass');
  }
  events.push({ kind: 'passed', at: m.now, words: `${planName(plan)} · ${verdict.why}` });
  const start = { at: m.now, day: a.day, equity: v.balance };
  /* a plan whose every phase carries its own drawdown starts the high mark again from where the phase begins */
  const restart = plan.rules.drawdown?.perPhase ? { peak: v.balance } : {};
  return logged({ ...a, phase: (a.phase ?? 0) + 1, phaseStart: start, ...restart }, m.now, verdict.why, 'pass');
}

/** The day rolls at 17:00 New York: day orders go, the day that was is written down, an evaluation's high mark and
    its pass are judged on its close, and the new day begins from what the account is worth */
function roll(a: PaperAccount, m: PaperMarket, events: PaperEvent[]): PaperAccount {
  const day = tradingDayOf(m.now);
  if (day === a.day) return a;
  const v = viewOf(a, m);
  /* a held contract with no quote yet cannot be valued: the day is written down once it can */
  if (!Number.isFinite(v.equity)) return a;
  const was = a.day;
  const ledger = { ...a.ledger };
  if (ledger[was]) ledger[was] = { ...ledger[was], close: v.equity, ...(Number.isFinite(v.balance) ? { closeBal: v.balance } : {}) };
  let next: PaperAccount = { ...a, ledger };
  const when = momentAt(m.now);
  /* a day order with minutes still to replay waits for them: the replay ends it at its own day's bell */
  next = setOpt(next, next.opt.orders.map(o => (o.status === 'working' && o.tif === 'day' && gapOf(o, m.now) == null ? { ...o, status: 'cancelled' as const, done: when, why: 'the day ended' } : o)));
  /* the plan's day-end rules (rules.ts): an end-of-day floor follows the close up; the target with what it waits on,
     and the time limit, are judged on it */
  const plan = next.plan;
  if (plan && !plan.legacy && next.status === 'open' && ledger[was]) {
    next = { ...next, peak: peakAfterRoll(next, closeMeasure(next, v)) };
    next = passIf(next, v, m, events);
    const verdict = next.status === 'open' ? judgeRoll(next, m.now) : null;
    if (verdict) {
      const seen = next.marks;
      next = flattenAll(next, m, 'rule', verdict.why, key => (m.open() ? undefined : seen[key]));
      next = logged({ ...next, status: 'failed', statusAt: m.now, statusRule: verdict.rule, statusWhy: `Failed — ${verdict.why}` }, m.now, `Failed — ${verdict.why}`, 'fail');
      events.push({ kind: 'failed', at: m.now, words: `${planName(plan)} failed — ${verdict.why}` });
    }
  }
  const bal = Number.isFinite(v.balance) ? v.balance : v.equity;
  next = { ...next, day, dayOver: undefined, ...(next.phaseStart && next.phaseStart.day === was && next.phaseStart.at >= dayBeginsAt(was) && next.phase ? { phaseStart: { ...next.phaseStart, day } } : {}), ledger: { ...next.ledger, [day]: next.ledger[day] ?? { open: v.equity, bal, hi: v.equity, lo: v.equity } } };
  events.push({ kind: 'roll', at: m.now, words: `A new trading day began at ${money(v.equity, 0)}` });
  return next;
}

/** A working order's moment to be looked at: never the tick it was placed on */
const lookable = (placed: PaperMoment, now: number) => placed.at < now;
/** Longer than this unjudged (the page in view could not read option quotes, or the terminal was away) is a GAP */
export const GAP_MS = 90_000;
/** Since when a working order has not been judged, where that is a gap the minute history has to replay first — or null.
    While it has one, the live tick leaves it alone, and it is not cancelled at the day's end or settled at its expiry. */
export function gapOf(o: OptOrder, now: number): number | null {
  if (o.status !== 'working' || o.kind === 'market') return null;
  const from = Math.max(o.placed.at, o.judgedTo ?? o.placed.at);
  return now - from > GAP_MS ? from : null;
}
/** Judge the working orders against one market: the live tick's step, and each replayed minute's (store.ts catch-up) */
export const judgeOrders = (a: PaperAccount, m: PaperMarket): PaperAccount => optTickOrders(a, m);

/** A way in that waits, asked again on the tick it would fill: the plan's rules, the margin call, the buying power — the
    words it is cancelled with, or null */
function reaskOpen(a: PaperAccount, m: PaperMarket, legs: OptOrder[], pxOf: (o: OptOrder) => number): string | null {
  const v = viewOf(a, m);
  for (const o of legs) {
    const blocked = ruleRefusal(a, m, { contract: o.contract, side: o.side, qty: o.qty, kind: 'limit', price: o.price ?? pxOf(o), secured: o.secured }, v, pxOf(o), o.id);
    if (blocked) return blocked.charAt(0).toLowerCase() + blocked.slice(1);
  }
  if (v.marginCall) return 'the account was on a margin call by then';
  const after = viewOf(withFills(a, m, legs.map(o => ({ contract: o.contract, side: o.side, qty: o.qty, px: pxOf(o), secured: o.secured }))), m);
  if (after.free < -1e-9) return legs.every(o => o.side === 'buy') ? 'the free money was gone by then' : 'the buying power was gone by then';
  return null;
}

function optTickOrders(a: PaperAccount, m: PaperMarket): PaperAccount {
  let next = a;
  const judged = new Set<string>();
  /* fills only in the options session: after the bell the feed's last quotes still read as new, but nothing trades on
     them — but for a way out of an expiring SPY, QQQ, IWM or DIA contract in a plan's late window (to 16:10) */
  const shut = !m.replay && !m.open();
  const mayFill = (o: OptOrder) => !shut || ((o.opens ?? o.side === 'buy') === false && lateWindow(next, o.contract, m.now));
  for (const o of a.opt.orders) {
    if (o.status !== 'working' || !lookable(o.placed, m.now) || o.combo || !mayFill(o)) continue;
    /* minutes it missed are replayed first, in order (store.ts): judging it on today's quote now would skip them */
    if (!m.replay && gapOf(o, m.now) != null) continue;
    const live = next.opt.orders.find(x => x.id === o.id);
    if (!live || live.status !== 'working') continue;
    const q = m.optQuote(live.contract);
    if (q.dead) continue;
    judged.add(o.id);
    if (live.on === 'name') {
      if (live.side === 'sell' && nameHit(live, q.spot)) next = optFillNow(next, live, q.bid, live.kind, q, m);
      continue;
    }
    const opens = live.opens ?? live.side === 'buy';
    /* a market order left working is the rest of one that took all a quote showed: it fills on the next quotes */
    const hits = live.kind === 'market' ? true : live.kind === 'limit' ? (live.side === 'buy' ? q.ask <= live.price! : q.bid >= live.price!) : live.side === 'sell' ? q.bid <= live.price! : q.ask >= live.price!;
    if (!hits) continue;
    /* the position it was placed against may have turned since: a way in the other way, or a way out with nothing left */
    const pos = heldOn(next, contractKey(live.contract));
    if (opens && !opensOn(pos, live.side)) {
      next = optCancel(next, m, live.id, 'the position on it turned the other way');
      continue;
    }
    if (!opens && (!pos || opensOn(pos, live.side))) {
      next = optCancel(next, m, live.id, 'nothing was held to close by then');
      continue;
    }
    const px = live.kind === 'limit' ? (live.side === 'buy' ? Math.min(live.price!, q.ask) : Math.max(live.price!, q.bid)) : live.side === 'buy' ? q.ask : q.bid;
    if (opens) {
      /* a resting way in is asked the plan's rules again on the tick it would fill */
      const why = reaskOpen(next, m, [live], () => px);
      if (why) {
        next = optCancel(next, m, live.id, why);
        continue;
      }
    }
    next = optFillNow(next, live, px, live.kind, q, m);
  }
  /* orders of several: judged as one, on the net of their legs, and filled leg by leg at each one's own bid or ask */
  const combos = new Map<string, OptOrder[]>();
  for (const o of next.opt.orders) if (o.status === 'working' && o.combo && lookable(o.placed, m.now) && mayFill(o) && (m.replay || gapOf(o, m.now) == null)) combos.set(o.combo, [...(combos.get(o.combo) ?? []), o]);
  for (const legs of combos.values()) {
    const natural = comboNatural(m, legs);
    if (!Number.isFinite(natural)) continue;
    legs.forEach(o => judged.add(o.id));
    if (natural < (legs[0].net ?? -Infinity) - 1e-9) continue;
    const pxOf = (o: OptOrder) => (o.side === 'buy' ? m.optQuote(o.contract).ask : m.optQuote(o.contract).bid);
    if (legs[0].opens) {
      const why = reaskOpen(next, m, legs, pxOf);
      if (why) {
        next = optCancel(next, m, legs[0].id, why);
        continue;
      }
    } else if (legs.some(o => !heldOn(next, contractKey(o.contract)) || opensOn(heldOn(next, contractKey(o.contract)), o.side))) {
      next = optCancel(next, m, legs[0].id, 'nothing was held to close by then');
      continue;
    }
    for (const o of legs) next = optFillNow(next, o, pxOf(o), 'limit', m.optQuote(o.contract), m);
  }
  /* what was looked at on a quote is judged up to now (a minute at a time: the account is not rewritten every tick) */
  if (judged.size && next.opt.orders.some(o => judged.has(o.id) && o.status === 'working' && Math.floor((o.judgedTo ?? 0) / 60_000) < Math.floor(m.now / 60_000)))
    next = setOpt(next, next.opt.orders.map(o => (judged.has(o.id) && o.status === 'working' ? { ...o, judgedTo: m.now } : o)));
  /* Trailing stops, after the check: each was tried where it stood; only now is it moved by this tick's price */
  if (next.opt.orders.some(o => o.status === 'working' && o.trail != null)) {
    next = setOpt(
      next,
      next.opt.orders.map(o => {
        if (o.status !== 'working' || o.kind !== 'stop' || o.trail == null || o.price == null || !lookable(o.placed, m.now)) return o;
        const q = m.optQuote(o.contract);
        if (q.dead) return o;
        if (o.on === 'name') {
          const up = o.contract.right === 'C';
          const peak = up ? Math.max(o.peak ?? q.spot, q.spot) : Math.min(o.peak ?? q.spot, q.spot);
          const level = cents(up ? peak - o.trail : peak + o.trail);
          return { ...o, peak, price: up ? Math.max(o.price, level) : Math.min(o.price, level) };
        }
        const peak = Math.max(o.peak ?? q.bid, q.bid);
        return { ...o, peak, price: Math.max(o.price, cents(peak - o.trail)) };
      })
    );
  }
  return next;
}

/** While it is held: what each open trade is worth on this tick — its best and worst every tick, a point every few
    seconds */
function keepHeld(a: PaperAccount, m: PaperMarket): PaperAccount {
  const ob = optBookOf(a).positions;
  if (!ob.length) return a;
  const held = { ...a.held };
  const marks = { ...a.marks };
  const note = (tradeId: string, pnl: number, value: number, name: number) => {
    const h = held[tradeId] ?? { pts: [], best: pnl, bestAt: m.now, worst: pnl, worstAt: m.now };
    const last = h.pts[h.pts.length - 1];
    let pts = h.pts;
    if (!last || m.now - last[0] >= HELD_EVERY_MS) {
      pts = [...pts, [m.now, cents(pnl), value, name]];
      /* full: every other point goes, so the whole of it is still drawn, a coarser grain */
      if (pts.length > HELD_POINTS) pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
    }
    held[tradeId] = { pts, best: pnl > h.best ? pnl : h.best, bestAt: pnl > h.best ? m.now : h.bestAt, worst: pnl < h.worst ? pnl : h.worst, worstAt: pnl < h.worst ? m.now : h.worstAt };
  };
  for (const p of ob) {
    const q = m.optQuote(p.contract);
    /* at the bid it could be sold into (a short: the ask it could be bought back at), less the fee to close it — "fees
       in", the backtest's walk */
    const px = p.dir > 0 ? q.bid : q.ask;
    /* only a live quote is stored — a dead one is not a fill at zero, and it does not wipe the last real bid or ask */
    if (q.dead || !(px > 0)) continue;
    note(p.tradeId, p.flow + p.dir * px * MULT * p.qty - optFee(a, p.contract, p.qty), px, q.spot);
    marks[p.key] = px;
  }
  return { ...a, held, marks };
}

/** The candles a trade was on, written down as it closes: an hour before the way in to the way out, at a coarser
    candle when that is more than PATH_BARS of them — in whole units over a base, to keep a journal of hundreds
    small */
function pathOf(bars: Candle[], fromSec: number, toSec: number, unit: number): TradePath | null {
  const inside = bars.filter(b => b.time >= fromSec && b.time <= toSec);
  if (!inside.length) return null;
  const minutes = Math.max(1, Math.ceil(inside.length / PATH_BARS));
  const step = 60 * minutes;
  const out: Candle[] = [];
  for (const b of inside) {
    const t = b.time - (b.time % step);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
    } else out.push({ ...b, time: t });
  }
  const base = out[0].open;
  const u = (v: number) => Math.round((v - base) / unit);
  return { t0: out[0].time, step, base, unit, o: out.map(b => u(b.open)), h: out.map(b => u(b.high)), l: out.map(b => u(b.low)), c: out.map(b => u(b.close)) };
}
/** …and back into candles, for the chart */
export const candlesOfPath = (p: TradePath): Candle[] => p.o.map((_, i) => ({ time: p.t0 + i * p.step, open: p.base + p.o[i] * p.unit, high: p.base + p.h[i] * p.unit, low: p.base + p.l[i] * p.unit, close: p.base + p.c[i] * p.unit, volume: 0 }));

/** Every trade that closed between two states of the account: its candles written down, its last point added */
function keepClosed(before: PaperAccount, after: PaperAccount, m: PaperMarket): PaperAccount {
  const had = new Set(optBookOf(before).trades.map(t => t.id));
  const ot = optBookOf(after).trades.filter(t => !had.has(t.id));
  if (!ot.length) return after;
  const paths = { ...after.paths };
  const held = { ...after.held };
  const write = (id: string, ticker: string, unit: number, barIn: number, barOut: number, pnl: number, value: number, name: number) => {
    const p = pathOf(m.candles(ticker), barIn - 3600, barOut, unit);
    if (p) paths[id] = p;
    const h = held[id] ?? { pts: [], best: pnl, bestAt: m.now, worst: pnl, worstAt: m.now };
    /* what was taken is part of the trade: its last point is the result, to the cent — and a closed trade keeps HELD_KEPT
       points, evenly, its first and its last among them */
    const all = [...h.pts, [m.now, pnl, value, name] as [number, number, number, number]];
    const every = Math.max(1, Math.ceil(all.length / HELD_KEPT));
    const pts = all.filter((_, i) => i % every === 0 || i === all.length - 1);
    held[id] = { ...h, pts, best: Math.max(h.best, pnl), bestAt: pnl > h.best ? m.now : h.bestAt, worst: Math.min(h.worst, pnl), worstAt: pnl < h.worst ? m.now : h.worstAt };
  };
  for (const t of ot) write(t.id, t.contract.ticker, 0.01, t.legs[0].bar, t.legs[t.legs.length - 1].bar, t.pnl, t.avgOut, t.spotOut);
  /* at most PATHS_KEPT trades' candles: the oldest go first */
  const ids = Object.keys(paths);
  if (ids.length > PATHS_KEPT) {
    const order = optBookOf(after).trades.sort((x, y) => x.closed.at - y.closed.at).map(t => t.id);
    for (const id of order.slice(0, ids.length - PATHS_KEPT)) {
      delete paths[id];
      delete held[id];
    }
  }
  return { ...after, paths, held };
}

/** Say each new fill, in the house's words */
function fillEvents(before: PaperAccount, after: PaperAccount, events: PaperEvent[]): void {
  const hadO = new Set(before.opt.fills.map(f => f.id));
  /* the trade a fill closed: the one whose last leg it is */
  const closedBy = new Map<string, number>(optBookOf(after).trades.map(t => [t.legs[t.legs.length - 1].id, t.pnl]));
  const targetIds = new Set(after.opt.orders.filter(o => o.oco && o.kind === 'limit').map(o => o.id));
  for (const f of after.opt.fills) {
    if (hadO.has(f.id)) continue;
    const what = f.how === 'expired' ? 'Expired' : f.how === 'stop' ? 'Stop filled' : f.orderId && targetIds.has(f.orderId) ? 'Target filled' : f.how === 'limit' ? 'Limit filled' : f.how === 'rule' ? 'Closed by the rules' : f.how === 'page' ? 'Closed' : 'Filled';
    const did = f.side === 'buy' ? (f.opens === false ? 'bought back' : 'bought') : f.opens ? 'sold to open' : 'sold';
    events.push({ kind: f.how === 'expired' ? 'expired' : f.how === 'rule' ? 'rule' : 'fill', at: f.at.at, words: `${what} · ${did} ${f.qty} ${contractWords(f.contract)}${f.comboName ? ` (${f.comboName.toLowerCase()})` : ''} at ${f.price.toFixed(2)}${f.how === 'expired' && f.note ? ` — ${f.note}` : ''}`, pnl: closedBy.get(f.id), key: contractKey(f.contract) });
  }
}

/** One tick of the feed: the day rolls, what expired settles, what the plan says must be flat is closed, working
    orders meet the price, trailing stops follow it, the plan's floor and day's limit are judged, and every open trade
    is written down as it stands. */
export function tick(a: PaperAccount, m: PaperMarket): { account: PaperAccount; events: PaperEvent[] } {
  const events: PaperEvent[] = [];
  const before = a;
  /* nothing open, nothing working, the same day, and no plan whose rules a close by hand may have just met: nothing to
     do — the same account back */
  if (a.day === tradingDayOf(m.now) && !optBookOf(a).positions.length && !a.opt.orders.some(o => o.status === 'working') && !(a.plan && !a.plan.legacy && a.status === 'open')) return { account: a, events };
  let next = roll(a, m, events);
  if (next.status === 'open') {
    /* 16:00 on its date: an expiring contract settles at what it is worth in the money — a long as if exercised, a short
       as if assigned, both in cash: this desk holds no stock */
    for (const p of optBookOf(next).positions) {
      if (!expired(p.contract, m.now)) continue;
      /* an expiring SPY, QQQ, IWM or DIA contract on a plan that closes it at 16:10 trades on until then: the plan's close
         takes it at the live quote (mustBeFlat, below); with no quote standing then, it settles here at the 16:00 close */
      const late = lateCloseOf(next, p.contract);
      if (late != null && m.now < dayEndsAt(p.contract.expiry) && (m.now < late || !m.optQuote(p.contract).dead)) continue;
      /* a way out of it with minutes still to replay may have sold it before the bell: the settlement waits for them */
      if (next.opt.orders.some(o => contractKey(o.contract) === p.key && gapOf(o, m.now) != null)) continue;
      const when = momentAt(m.now);
      next = setOpt(next, next.opt.orders.map(o => (o.status === 'working' && contractKey(o.contract) === p.key ? { ...o, status: 'cancelled' as const, done: when, why: 'the contract expired' } : o)));
      /* on the name's 16:00 close that day, not wherever it stands when the page next ticks; it waits until that is known.
         VIX settles the morning after its last trade, on the VIX index's opening print — the stand-in for the SOQ */
      const vix = isVixRoot(p.contract.ticker) ? vixSchedule(p.contract.expiry) : null;
      const close = vix ? (m.openOf ? m.openOf('VIX', vix.settleDay) : NaN) : m.closeOf ? m.closeOf(p.contract.ticker, p.contract.expiry) : NaN;
      if (!(close > 0)) continue;
      const q = { ...m.optQuote(p.contract), spot: close };
      const value = settleValue(p.contract, close);
      const print = vix ? 'open' : printOf(p.contract.ticker, p.contract.expiry, close);
      const on = print === '16:00' ? 'the 16:00 close' : `the ${print} print`;
      const vixWords = vix ? `settled at ${value.toFixed(2)} on the VIX opening print of ${vix.settleDay} (${close.toFixed(2)}) — the stand-in for the special opening quotation, which the feed does not carry` : undefined;
      const note = vixWords ?? (p.dir < 0 ? settleWords(p.contract, close, value, print) : late != null ? `no live quote at its ${nyClockOf(late)} close — settled at ${on}` : undefined);
      next = optFillNow(next, { id: '', placed: when, contract: p.contract, side: p.dir > 0 ? 'sell' : 'buy', qty: p.qty, kind: 'market', tif: 'day', status: 'working', tag: p.tag, life: m.life, opens: false }, value, 'expired', q, m, note);
    }
    /* the plan's holding rules (rules.ts): flat by its time, nothing past the close, over a weekend, or through a
       report — closed at the bid (a short: the ask). A dead quote keeps the last live one; with none stored the
       position stays and the account says the quote is missing */
    const flat = mustBeFlat(next, m, viewOf(next, m));
    if (flat) {
      const seen = next.marks;
      const held = optBookOf(next).positions;
      const before = held.filter(p => flat.keys.has(p.key)).length;
      next = flattenAll(
        next,
        m,
        'rule',
        flat.why,
        key => {
          const p = held.find(x => x.key === key);
          if (!p || !m.optQuote(p.contract).dead) return undefined;
          const px = seen[key];
          return px > 0 ? px : undefined;
        },
        flat.keys
      );
      const left = optBookOf(next).positions.filter(p => flat.keys.has(p.key)).length;
      const n = before - left;
      if (n > 0) {
        next = logged(next, m.now, `${n} ${n === 1 ? 'position' : 'positions'} closed by the rules — ${flat.why}`, 'rule');
        events.push({ kind: 'flat', at: m.now, words: `${n} ${n === 1 ? 'position' : 'positions'} closed — ${flat.why}` });
      }
    }
    next = optTickOrders(next, m);
    next = judgeRulesNow(next, m, events);
  }
  next = keepHeld(next, m);
  next = keepClosed(before, next, m);
  /* the day's high and low of what the account is worth, and its running drawdown */
  const d = next.ledger[next.day];
  const holding = optBookOf(next).positions.length > 0;
  const eq = holding || !next.curve || next.opt.fills.length !== before.opt.fills.length ? viewOf(next, m).equity : NaN;
  if (d && holding && Number.isFinite(eq) && (eq > d.hi || eq < d.lo)) next = { ...next, ledger: { ...next.ledger, [next.day]: { ...d, hi: Math.max(d.hi, eq), lo: Math.min(d.lo, eq) } } };
  if (Number.isFinite(eq)) next = keepCurve(next, eq);
  fillEvents(before, next, events);
  return { account: next, events };
}

/** The plan's floor and its day's limit, as it happens — judged only on fresh quotes in the session, or with nothing
    open — and the target. The live tick asks it every tick; the catch-up asks it on every replayed minute whose quotes
    mark everything held (catchUp.ts). */
export function judgeRulesNow(a: PaperAccount, m: PaperMarket, events: PaperEvent[]): PaperAccount {
  let next = a;
  /* the plan's floor and its day's limit, as it happens — judged only on fresh quotes in the session, or with nothing open */
  const plan = next.plan;
  if (plan && !plan.legacy && next.status === 'open') {
    const v = viewOf(next, m);
    const fresh = v.opt.every(p => m.fresh?.(p.contract) ?? true);
    if (!v.opt.length || (fresh && m.open())) {
      next = { ...next, peak: peakAfterTick(next, v) };
      const verdict = judgeTick(next, v);
      const label = planName(plan);
      if (verdict?.kind === 'fail') {
        next = flattenAll(next, m, 'rule', verdict.why);
        next = logged({ ...next, status: 'failed', statusAt: m.now, statusRule: verdict.rule, statusWhy: `Failed — ${verdict.why}` }, m.now, `Failed — ${verdict.why}`, 'fail');
        events.push({ kind: 'failed', at: m.now, words: `${label} failed — ${verdict.why}` });
      } else if (verdict?.kind === 'pause') {
        next = flattenAll(next, m, 'rule', 'the day’s loss limit was reached');
        next = logged({ ...next, dayOver: { day: next.day, why: verdict.why } }, m.now, `The day is over — ${verdict.why}`, 'rule');
        events.push({ kind: 'day-over', at: m.now, words: `The day is over — ${verdict.why}. No new positions until the next trading day` });
      }
    }
    /* the target, met with all it waits on (it reads the balance, which no quote moves) */
    if (next.status === 'open') next = passIf(next, viewOf(next, m), m, events);
  }
  return next;
}

/** The running drawdown, moved by one reading of equity */
function keepCurve(a: PaperAccount, eq: number): PaperAccount {
  const c = a.curve ?? { peak: Math.max(a.startCash, eq), maxDd: 0 };
  const peak = Math.max(c.peak, eq);
  const maxDd = Math.max(c.maxDd, cents(peak - eq));
  return a.curve && peak === c.peak && maxDd === c.maxDd ? a : { ...a, curve: { peak, maxDd } };
}
/** The report's figures for a paper account, off its own equity: the drawdown off its ticks (`curve`; the days' highs and
    lows, worst order first, for an account from before it was kept), Sharpe and Sortino off its days' closes */
export function paperCurveOf(a: PaperAccount): { maxDrawdown: number; daily: number[] } {
  const days = Object.keys(a.ledger).sort();
  let peak = a.startCash;
  let dd = 0;
  for (const day of days) {
    const x = a.ledger[day];
    peak = Math.max(peak, x.open, x.hi);
    dd = Math.max(dd, peak - x.lo);
    if (x.close != null) {
      peak = Math.max(peak, x.close);
      dd = Math.max(dd, peak - x.close);
    }
  }
  const maxDrawdown = a.curve ? Math.max(a.curve.maxDd, 0) : cents(dd);
  return { maxDrawdown, daily: [a.startCash, ...days.filter(d => a.ledger[d].close != null).map(d => a.ledger[d].close!)] };
}

/** A change the reader made (an order, a close): the trades it closed are written down the way a tick's are */
export function afterHand(before: PaperAccount, after: PaperAccount, m: PaperMarket): PaperAccount {
  const next = keepClosed(before, keepHeld(after, m), m);
  if (next.opt.fills.length === before.opt.fills.length) return next;
  const eq = viewOf(next, m).equity;
  return Number.isFinite(eq) ? keepCurve(next, eq) : next;
}

