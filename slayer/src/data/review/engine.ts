/* The backtest's rules in code: pure functions over a session that is its orders and fills, with no clock, storage
   or React of its own; the desk, the report and the journal read everything off them. The market is the recorded one
   (history.ts): a fill is at the NBBO that stood at the end of its minute — a buy at the ask, a sell at the bid — and the
   days a move walks must be loaded first (store.ts does that). */

import { MAX_STOPS, MAX_TARGETS, giveUp, ladderShapeRefusal, nextRung, rungsOf, type LadderBracket } from './ladder';
import { contractKey, dteAt, fillableQty, legsOf, markAt, quoteAt, quoteWith, settlementAt, spotForBid, type ContractId, type Quote, type SettleStyle } from './quotes';
import { LAST_MIN, barTime, dayNumber, sessionAfter } from './history';
import { tradingMinutesBetween } from '../../core/tradingYear';
import type { DayNote, JournalEntry } from './journal';
import { usd2 as money } from '../../core/format';

/** A cursor: the END of minute `minute` (0…389) of a day */
export interface Moment {
  day: string;
  minute: number;
}
export type Side = 'buy' | 'sell';
export type OrderKind = 'market' | 'limit' | 'stop';
export type FillHow = OrderKind | 'expired';

export interface Order {
  id: string;
  placed: Moment;
  contract: ContractId;
  side: Side;
  qty: number;
  kind: OrderKind;
  /** The limit, or the stop's trigger — dollars a share of the CONTRACT; with `on: 'name'`, a price of the NAME */
  price?: number;
  /** 'name': a sell that waits for the NAME to reach `price`, then sells at the bid (see the head note). `kind` still says
      which it is — 'limit' a target, 'stop' a stop. */
  on?: 'name';
  tif: 'day' | 'gtc';
  status: 'working' | 'filled' | 'cancelled' | 'refused';
  /** Why it was refused or cancelled, in plain words */
  why?: string;
  done?: Moment;
  fillPrice?: number;
  /** A target and a stop that ride one buy share this: when one fills the other goes */
  oco?: string;
  /** What rides a buy once it fills — prices of the contract, or (`on: 'name'`) of the name */
  bracket?: Bracket;
  /** What the ticket was for — the trade's tag */
  tag?: string;
  /** A STOP of a ladder: the first target's fill moves it to what was paid (once) */
  breakeven?: boolean;
  /** A TRAILING stop: the distance it keeps from the best price since it was armed (`peak`) — the contract's bid, or the
      name's level where it is pinned to the name */
  trail?: number;
  peak?: number;
  /** When a switch last moved it (breakeven) — the book says so */
  moved?: Moment;
  /** Filled in pieces so far: a fill takes at most the size the quote shows (fillableQty); `qty` is what is left */
  filled?: number;
  /** …and how much of which quote it has taken (the same quote's size is not taken twice) */
  took?: { at: number; qty: number };
}
/** What rides a buy: a ladder's rungs (or the single target and stop), the two switches — and what they wait on */
export interface Bracket extends LadderBracket {
  on?: 'name';
}
export interface Fill {
  id: string;
  orderId: string | null;
  at: Moment;
  contract: ContractId;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  how: FillHow;
  /** The contract as it stood when it filled — what the report cuts by */
  spot: number;
  delta: number;
  iv: number;
  theta: number;
  tag?: string;
  /** The stop that rode the buy, if one did — the planned risk */
  plannedStop?: number;
  /** On the sell that closed a trade: the lowest open P&L it marked, at each minute's bid, fees in */
  lowOpen?: number;
  /** An expiry's fill: settled in cash on an index's close, or exercised at a stock's or a fund's close */
  settle?: SettleStyle;
}
/** The reader's own rules for a session — hard blocks on a way in, set at its start (see the head note) */
export interface SessionRules {
  /** Positions open at once, across every name */
  maxOpen?: number;
  /** The most one trade may cost (premium + fees, every buy of it), as a share of what the account is worth */
  maxRiskPct?: number;
  /** Down this share of the account since the day's open, the day is over: no new positions until the next one */
  dailyLossPct?: number;
}
/** Ours, not the reader's: past this many open positions a tape cannot be read */
export const OPEN_CEILING = 10;
/** Names a session may trade */
export const MAX_NAMES = 2;

/** The account at a day's bell, marked at that minute (the engine writes one each day it rings) — the report's curve */
export interface DayClose {
  equity: number;
  cash: number;
  /** Banked since the session began: closed trades and the pieces sold of open ones, fees in */
  realized: number;
  /** What the contracts still held were up or down, at the bell's marks */
  open: number;
  /** Positions carried over the night */
  held: number;
}

export interface Session {
  id: string;
  /** Played on ThetaData's recorded quotes. A session without it was played on the old synthetic tape and is not kept. */
  tape?: 'theta';
  name: string;
  /** The first name — kept so a session saved before `tickers` still opens */
  ticker: string;
  /** Every name the session trades: one or two */
  tickers?: string[];
  rules?: SessionRules;
  startCash: number;
  /** Dollars a contract, each way */
  fee: number;
  startDay: string;
  cursor: Moment;
  orders: Order[];
  fills: Fill[];
  /** The reader's words on a trade, by the trade's id */
  notes: Record<string, string>;
  /** The journal's (data/review/journal.ts): the reader's words and tags on a closed trade, and a note on a replayed day.
      The engine never reads them. */
  journal?: Record<string, JournalEntry>;
  days?: Record<string, DayNote>;
  /** The account at each bell that rang, by day */
  closes?: Record<string, DayClose>;
  /** What the account was worth at each open the clock walked through with something carried into it (`equityAtOpen`,
      kept so the report can say each day's day stop without that day's quotes loaded) */
  opens?: Record<string, number>;
  /** Copied from another session's book at its clock (store.duplicateSession) — its id */
  copiedFrom?: string;
  /** The reader's setting at the bell: the clock playing carries on into the next session by itself (default off). The
      engine never reads it — the desk's clock does (`playStep`). */
  rollOver?: boolean;
  createdAt: number;
  touchedAt: number;
  seq: number;
}

export const DEFAULT_FEE = 0.65;
export const MULT = 100;
/** A moment as one number, for order: the day's number (days since 1970) and its minute */
export const stampOf = (m: Moment): number => dayNumber(m.day) * 2000 + m.minute;
const cents = (v: number) => Math.round(v * 100) / 100;

/** The names a session trades, first one first */
export const namesOf = (s: Pick<Session, 'ticker' | 'tickers'>): string[] => (s.tickers?.length ? s.tickers : [s.ticker]);

export function newSession(o: { id: string; name: string; ticker: string; tickers?: string[]; rules?: SessionRules; startCash: number; fee?: number; startDay: string; now: number }): Session {
  const names = [...new Set((o.tickers?.length ? o.tickers : [o.ticker]).map(t => t.toUpperCase()))].slice(0, MAX_NAMES);
  return { id: o.id, tape: 'theta', name: o.name, ticker: names[0], tickers: names, rules: o.rules, startCash: o.startCash, fee: o.fee ?? DEFAULT_FEE, startDay: o.startDay, cursor: { day: o.startDay, minute: 0 }, orders: [], fills: [], notes: {}, createdAt: o.now, touchedAt: o.now, seq: 0 };
}

/* ---- what the fills add up to ---- */
export interface Position {
  key: string;
  contract: ContractId;
  qty: number;
  /** Running average cost a share of what is still held (each sale takes avg × qty out of the basis) */
  avg: number;
  /** Fees paid on the buys still held */
  fees: number;
  /** What the contracts still held cost, premium and fees, unrounded per share — the base open P&L is measured from */
  cost: number;
  opened: Moment;
  /** Where the name stood when it was entered — the chart draws the position there */
  spotIn: number;
  /** The id of the trade this position is — its first fill's */
  tradeId: string;
  tag?: string;
  /** What the pieces already sold have banked: their proceeds less their share of the cost, fees in (the chart's RP&L) */
  banked: number;
}
export interface Trade {
  id: string;
  contract: ContractId;
  /** Contracts bought over the trade's life */
  qty: number;
  avgIn: number;
  avgOut: number;
  /** What was paid for it, fees in — the trade's risk, so 1R */
  cost: number;
  pnl: number;
  r: number;
  opened: Moment;
  closed: Moment;
  /** How it ended — 'scaled': it left in more than one piece (`legs` has each) */
  how: 'sold' | 'target' | 'stopped' | 'expired' | 'scaled';
  /** Every fill of the trade, in order — the ways in, and each piece it left in */
  legs: TradeLeg[];
  dteIn: number;
  deltaIn: number;
  ivIn: number;
  thetaIn: number;
  spotIn: number;
  spotOut: number;
  /** Session minutes the trade was on */
  heldMin: number;
  plannedStop?: number;
  tag?: string;
  /** The lowest the trade marked while open, fees in, at the bid each minute (0 or below) */
  lowOpen?: number;
  /** Ended at the bell of its expiry: in cash (an index), or exercised at the close (a stock or a fund) */
  settle?: SettleStyle;
}

export interface TradeLeg {
  at: Moment;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  /** A piece going out: by a target, a stop, the reader's hand, or the bell */
  out?: 'target' | 'stop' | 'hand' | 'bell';
}

export function cashOf(s: Session): number {
  let cash = s.startCash;
  for (const f of s.fills) cash += (f.side === 'buy' ? -1 : 1) * f.price * MULT * f.qty - f.fee;
  return cents(cash);
}

interface Book {
  positions: Position[];
  trades: Trade[];
}
/* The trade's open P&L at each minute's bid, from the first fill to the close; the lowest is kept for the drawdown. Read
   when the closing sell fills (the days it walked are loaded then) and kept on that fill. */
export function lowOpenOf(contract: ContractId, legs: Pick<TradeLeg, 'at' | 'side' | 'qty' | 'price' | 'fee'>[]): number {
  const first = legs[0];
  const last = legs[legs.length - 1];
  let low = 0;
  let held = 0;
  let cash = 0;
  let k = 0;
  for (let day: string | null = first.at.day, guard = 0; day && day <= last.at.day && guard < 400; day = sessionAfter(day), guard++) {
    const m0 = day === first.at.day ? first.at.minute : 0;
    const m1 = day === last.at.day ? last.at.minute : LAST_MIN;
    for (let m = m0; m <= m1; m++) {
      while (k < legs.length && legs[k].at.day === day && legs[k].at.minute <= m) {
        const l = legs[k++];
        held += l.side === 'buy' ? l.qty : -l.qty;
        cash += (l.side === 'buy' ? -1 : 1) * l.price * l.qty * MULT - l.fee;
      }
      if (held <= 0) continue;
      const q = quoteAt(contract, day, m);
      if (!q.dead && Number.isFinite(q.bid)) low = Math.min(low, cash + held * q.bid * MULT);
    }
  }
  return cents(low);
}
/** Session minutes between two moments, on the trading clock (core/tradingYear): only the minutes the market was open —
    an early close counts its 210 — the measure a paper trade's hold is read in too */
const heldMinutes = (a: Moment, b: Moment) => tradingMinutesBetween(barTime(a.day, a.minute) * 1000, barTime(b.day, b.minute) * 1000);
/** Every fill, in order, folded into the positions still open and the trades that closed */
export function bookOf(s: Session): Book {
  interface Open {
    first: Fill;
    qty: number;
    bought: number;
    paid: number;
    feesIn: number;
    got: number;
    feesOut: number;
    sold: number;
    lastHow: FillHow;
    lastOrder: string | null;
    legs: TradeLeg[];
    /* the running average cost of what is still held (a share, and the entry fees it carries): each sale takes avg × qty
       out, so a buy after a partial sale averages with what is left, not with what was sold */
    basis: number;
    feeBasis: number;
    banked: number;
  }
  const open = new Map<string, Open>();
  const trades: Trade[] = [];
  const targets = new Set(s.orders.filter(o => o.oco && o.kind === 'limit' && o.side === 'sell').map(o => o.id));
  for (const f of s.fills) {
    const key = contractKey(f.contract);
    let o = open.get(key);
    if (f.side === 'buy') {
      if (!o) open.set(key, (o = { first: f, qty: 0, bought: 0, paid: 0, feesIn: 0, got: 0, feesOut: 0, sold: 0, lastHow: f.how, lastOrder: f.orderId, legs: [], basis: 0, feeBasis: 0, banked: 0 }));
      o.legs.push({ at: f.at, side: 'buy', qty: f.qty, price: f.price, fee: f.fee });
      o.qty += f.qty;
      o.bought += f.qty;
      o.paid += f.price * f.qty;
      o.feesIn += f.fee;
      o.basis += f.price * f.qty;
      o.feeBasis += f.fee;
      continue;
    }
    if (!o) continue;
    const q = Math.min(f.qty, o.qty);
    if (o.qty > 0) {
      const avg = o.basis / o.qty;
      const feeShare = (o.feeBasis * q) / o.qty;
      o.banked += (f.price - avg) * q * MULT - f.fee - feeShare;
      o.basis -= avg * q;
      o.feeBasis -= feeShare;
    }
    o.qty -= q;
    o.sold += q;
    o.got += f.price * q;
    o.feesOut += f.fee;
    o.lastHow = f.how;
    o.lastOrder = f.orderId;
    o.legs.push({ at: f.at, side: 'sell', qty: q, price: f.price, fee: f.fee, out: f.how === 'expired' ? 'bell' : f.how === 'stop' ? 'stop' : f.orderId && targets.has(f.orderId) ? 'target' : 'hand' });
    if (o.qty > 0) continue;
    const cost = o.paid * MULT + o.feesIn;
    const pnl = o.got * MULT - o.feesOut - cost;
    trades.push({
      id: o.first.id,
      contract: f.contract,
      qty: o.bought,
      avgIn: cents(o.paid / o.bought),
      avgOut: cents(o.got / Math.max(1, o.sold)),
      cost: cents(cost),
      pnl: cents(pnl),
      r: cost > 0 ? pnl / cost : 0,
      opened: o.first.at,
      closed: f.at,
      how: o.legs.filter(l => l.side === 'sell').length > 1 ? 'scaled' : f.how === 'expired' ? 'expired' : f.how === 'stop' ? 'stopped' : f.orderId && targets.has(f.orderId) ? 'target' : 'sold',
      legs: o.legs,
      dteIn: dteAt(o.first.at.day, f.contract.expiry),
      deltaIn: o.first.delta,
      ivIn: o.first.iv,
      thetaIn: o.first.theta,
      spotIn: o.first.spot,
      spotOut: f.spot,
      heldMin: heldMinutes(o.first.at, f.at),
      plannedStop: o.first.plannedStop,
      tag: o.first.tag,
      lowOpen: Math.min(cents(pnl), f.lowOpen ?? 0),
      ...(f.how === 'expired' && f.settle ? { settle: f.settle } : {}),
    });
    open.delete(key);
  }
  const positions: Position[] = [...open.entries()].map(([key, o]) => ({
    key,
    contract: o.first.contract,
    qty: o.qty,
    avg: cents(o.basis / o.qty),
    fees: cents(o.feeBasis),
    cost: cents(o.basis * MULT + o.feeBasis),
    opened: o.first.at,
    spotIn: o.first.spot,
    tradeId: o.first.id,
    tag: o.first.tag,
    banked: cents(o.banked),
  }));
  return { positions, trades };
}

/** What a name has banked: its closed trades, and what its open ones have sold off in pieces, fees in — from the
    fills of the days before `beforeDay` (none: all of them). The day's share is the whole less that. */
export function bankedOf(s: Session, name: string, beforeDay?: string): number {
  const { positions, trades } = bookOf({ ...s, fills: s.fills.filter(f => f.contract.ticker === name && (beforeDay == null || f.at.day < beforeDay)) });
  return cents(trades.reduce((x, t) => x + t.pnl, 0) + positions.reduce((x, p) => x + p.banked, 0));
}

export interface Account {
  cash: number;
  /** Cash + what the open contracts are marked at */
  equity: number;
  openPnl: number;
  /** Closed trades, and the closed share of the open ones, fees in — known even while a mark is not */
  realized: number;
  /** `mark`: the mid a position is valued at; `staleFrom`: the earlier minute it is from, in a minute that is no market */
  positions: (Position & { quote: Quote; mark: number; staleFrom?: number; value: number; pnl: number; r: number })[];
  trades: Trade[];
}
export function accountOf(s: Session): Account {
  const { positions, trades } = bookOf(s);
  const cash = cashOf(s);
  const marked = positions.map(p => {
    const quote = quoteAt(p.contract, s.cursor.day, s.cursor.minute);
    const m = markAt(p.contract, s.cursor.day, s.cursor.minute);
    const value = m.mark * MULT * p.qty;
    return { ...p, quote, mark: m.mark, ...(m.staleFrom != null ? { staleFrom: m.staleFrom } : {}), value: cents(value), pnl: cents(value - p.cost), r: p.cost > 0 ? (value - p.cost) / p.cost : 0 };
  });
  const held = marked.reduce((a, p) => a + p.value, 0);
  const openPnl = marked.reduce((a, p) => a + p.pnl, 0);
  const equity = cents(cash + held);
  const realized = cents(trades.reduce((a, t) => a + t.pnl, 0) + positions.reduce((a, p) => a + p.banked, 0));
  return { cash, equity, openPnl: cents(openPnl), realized, positions: marked, trades };
}
/** Fees paid over the session, every fill's */
export const feesOf = (s: Pick<Session, 'fills'>): number => cents(s.fills.reduce((a, f) => a + f.fee, 0));

/* ---- orders ---- */
export interface Draft {
  contract: ContractId;
  side: Side;
  qty: number;
  kind: OrderKind;
  price?: number;
  on?: 'name';
  tif?: 'day' | 'gtc';
  bracket?: Bracket;
  tag?: string;
}
/** A sell that waits on the NAME: which way the name has to go. A target waits on the contract's good side — a call's name
    up, a put's down — and a stop on the other. */
export const nameGoesUp = (kind: OrderKind, right: ContractId['right']): boolean => (kind === 'limit') === (right === 'C');
/** Has the name reached an order's level? The engine sees the name once a minute, at the minute's end. */
const nameHit = (o: { kind: OrderKind; contract: ContractId; price?: number }, spot: number): boolean => (nameGoesUp(o.kind, o.contract.right) ? spot >= o.price! : spot <= o.price!);
const nextId = (s: Session, p: string): [string, Session] => [`${p}${s.seq + 1}`, { ...s, seq: s.seq + 1 }];

/** The planned risk a buy carried: its stop as a price of the contract — for a stop on the name, what the contract would
    have bid with the name there, at the minute of the buy */
function plannedStopOf(o: Order, at: Moment): number | undefined {
  const { stops } = rungsOf(o.bracket, o.qty);
  if (!stops.length) return undefined;
  /* more than one: where they stand on average, by their contracts */
  const asContract = (level: number) => (o.bracket?.on === 'name' ? quoteWith(o.contract, at.day, at.minute, level).bid : level);
  const n = stops.reduce((a, r) => a + r.qty, 0);
  return cents(stops.reduce((a, r) => a + asContract(r.price) * r.qty, 0) / Math.max(1, n));
}

/** How far a working way out stands from the price, as a share of it — what "the furthest rung" is measured by. A rung on
    the contract's price is measured from its bid, one pinned to the name from where the name stands. */
const farness = (o: Order, q: Quote): number => (o.on === 'name' ? Math.abs((o.price ?? 0) - q.spot) / Math.max(0.01, q.spot) : Math.abs((o.price ?? 0) - q.bid) / Math.max(0.01, q.bid));
const workingSells = (s: Session, key: string) => s.orders.filter(o => o.status === 'working' && o.side === 'sell' && contractKey(o.contract) === key);
/** Set working orders' contracts; an order left with none goes, in those words */
const resize = (s: Session, left: Map<string, number>, at: Moment, why: string): Session => ({
  ...s,
  orders: s.orders.map(x => {
    const q = left.get(x.id);
    if (q == null || x.status !== 'working' || q === x.qty) return x;
    return q <= 0 ? { ...x, status: 'cancelled' as const, done: at, why } : { ...x, qty: q };
  }),
});

/** After a sell: the ladder is made to fit what is still held (the rules page, "A ladder of ways out") */
function afterSell(s: Session, sold: Order, q: Quote, at: Moment): Session {
  const key = contractKey(sold.contract);
  let next = s;
  /* a rung filled: the OTHER side of its group gives up that many contracts, the furthest first */
  if (sold.oco) {
    const other = workingSells(next, key).filter(o => o.oco === sold.oco && o.kind !== sold.kind);
    next = resize(next, giveUp(other, sold.qty, o => farness(o, q)), at, 'its pair filled');
    /* BREAKEVEN: the first target of the group to fill moves its stops to what was paid */
    const firstTarget = sold.kind === 'limit' && !s.orders.some(o => o.oco === sold.oco && o.kind === 'limit' && o.status === 'filled' && o.id !== sold.id);
    const pos = bookOf(next).positions.find(p => p.key === key);
    if (firstTarget && pos) {
      next = {
        ...next,
        orders: next.orders.map(o => {
          if (o.status !== 'working' || o.oco !== sold.oco || o.kind !== 'stop' || !o.breakeven) return o;
          const now = o.on === 'name' ? quoteWith(o.contract, at.day, at.minute, o.price ?? 0).bid : (o.price ?? 0);
          /* only where it would still wait, and never DOWN */
          if (!(q.bid > pos.avg) || pos.avg <= now) return { ...o, breakeven: false };
          return { ...o, on: undefined, price: pos.avg, breakeven: false, moved: at, ...(o.trail != null ? { trail: cents(Math.max(0.01, q.bid - pos.avg)), peak: q.bid } : {}) };
        }),
      };
    }
  }
  const held = bookOf(next).positions.find(p => p.key === key)?.qty ?? 0;
  const mine = workingSells(next, key);
  /* flat: whatever was still waiting to sell it has nothing to sell */
  if (held === 0) return resize(next, new Map(mine.map(o => [o.id, 0])), at, 'the position was closed');
  /* …and what is left never speaks for more than is held: a sell by hand takes its contracts from the furthest rungs */
  const loose = mine.filter(o => !o.oco).reduce((a, o) => a + o.qty, 0);
  const cover = Math.max(0, held - loose);
  for (const kind of ['limit', 'stop'] as const) {
    const side = workingSells(next, key).filter(o => o.oco && o.kind === kind);
    const over = side.reduce((a, o) => a + o.qty, 0) - cover;
    if (over > 0) next = resize(next, giveUp(side, over, o => farness(o, q)), at, 'its contracts were sold');
  }
  return next;
}

function fillNow(s: Session, o0: Order, price: number, how: FillHow, q: Quote, at: Moment, settle?: SettleStyle): Session {
  /* the reader's order takes at most the size the quote shows; the rest stays working for the next quote (a limit at its
     price, a market order at the next minute's) — a settlement or the engine's own close is not capped */
  const capped = !!o0.id && how !== 'expired' && !settle;
  const n = capped ? fillableQty(o0, q) : o0.qty;
  if (n < 1) return s;
  const rest = o0.qty - n;
  const total = (o0.filled ?? 0) + n;
  const o: Order = rest > 0 ? { ...o0, qty: n } : o0;
  let [id, next] = nextId(s, 'f');
  const fill: Fill = { id, orderId: o.id || null, at, contract: o.contract, side: o.side, qty: o.qty, price: cents(price), fee: how === 'expired' ? 0 : cents(s.fee * o.qty * legsOf(o.contract)), how, spot: q.spot, delta: q.delta, iv: q.iv, theta: q.theta, tag: o.tag, plannedStop: plannedStopOf(o, at), ...(settle ? { settle } : {}) };
  /* a sell that leaves the position flat closes the trade: its lowest mark is read now, while its days are loaded */
  if (o.side === 'sell') {
    const pos = bookOf(s).positions.find(p => p.key === contractKey(o.contract));
    if (pos && pos.qty <= o.qty) {
      const legs = [...s.fills.filter(f => contractKey(f.contract) === pos.key && stampOf(f.at) >= stampOf(pos.opened)), fill];
      fill.lowOpen = lowOpenOf(o.contract, legs);
    }
  }
  const used = o0.took && q.quotedAt != null && o0.took.at === q.quotedAt ? o0.took.qty : 0;
  next = {
    ...next,
    fills: [...next.fills, fill],
    orders: next.orders.map(x =>
      x.id !== o.id ? x : rest > 0 ? { ...x, qty: rest, filled: total, ...(q.quotedAt != null ? { took: { at: q.quotedAt, qty: used + n } } : {}) } : { ...x, qty: total, status: 'filled' as const, done: at, fillPrice: fill.price }
    ),
  };
  /* a sell: the ladder it belongs to — or stands beside — is made to fit what is still held */
  if (o.side === 'sell') next = afterSell(next, o, q, at);
  /* a buy that carried ways out leaves them working, as one group — once all of it has filled */
  const { targets, stops } = rungsOf(o.side === 'buy' && rest === 0 ? o.bracket : undefined, total);
  if (targets.length || stops.length) {
    const [oco, n2] = nextId(next, 'g');
    next = n2;
    const on = o.bracket?.on;
    for (const [kind, rungs] of [['limit', targets], ['stop', stops]] as const) {
      for (const r of rungs) {
        const [oid, n3] = nextId(next, 'o');
        const switches = kind === 'stop' ? { breakeven: o.bracket?.breakeven || undefined, ...(o.bracket?.trail ? (o.bracket.trailBy ? trailAt(o.bracket.trailBy, on, q) : trailFrom(r.price, on, q)) : {}) } : {};
        next = { ...n3, orders: [...n3.orders, { id: oid, placed: at, contract: o.contract, side: 'sell', qty: r.qty, kind, price: r.price, on, tif: 'gtc', status: 'working', oco, tag: o.tag, ...switches }] };
      }
    }
  }
  return next;
}
/** A stop armed to trail, as the quote stands: the distance it keeps, and the best price so far */
const trailFrom = (price: number, on: 'name' | undefined, q: Quote): { trail: number; peak: number } => (on === 'name' ? { trail: cents(Math.max(0.01, Math.abs(q.spot - price))), peak: q.spot } : { trail: cents(Math.max(0.01, q.bid - price)), peak: q.bid });
/** …or by a TYPED distance: the stop stays where it is until the price has run that far past it, then follows */
const trailAt = (by: number, on: 'name' | undefined, q: Quote): { trail: number; peak: number } => ({ trail: cents(Math.max(0.01, by)), peak: on === 'name' ? q.spot : q.bid });

/** Contracts of this one already spoken for by working sells: a loose sell's own, and — for a ladder — the bigger of what
    its targets and its stops speak for (they are the same contracts, waiting on two things) */
const reserved = (s: Session, key: string) => {
  const byGroup = new Map<string, { limit: number; stop: number }>();
  let loose = 0;
  for (const o of workingSells(s, key)) {
    if (!o.oco || o.kind === 'market') loose += o.qty;
    else {
      const g = byGroup.get(o.oco) ?? { limit: 0, stop: 0 };
      g[o.kind] += o.qty;
      byGroup.set(o.oco, g);
    }
  }
  return loose + [...byGroup.values()].reduce((a, g) => a + Math.max(g.limit, g.stop), 0);
};

/** What of a held contract a sell that WAITS can still have: the contracts held, those a bracket (a ladder's targets
    and stops) speaks for, those another working sell speaks for, and what is left — the ticket's "3 of 5 are working in
    your bracket; 2 can be sold here" */
export function spokenFor(s: Session, contract: ContractId): { held: number; bracket: number; other: number; free: number } {
  const key = contractKey(contract);
  const held = bookOf(s).positions.find(p => p.key === key)?.qty ?? 0;
  const all = reserved(s, key);
  const other = workingSells(s, key).filter(o => !o.oco || o.kind === 'market').reduce((a, o) => a + o.qty, 0);
  const bracket = Math.max(0, all - other);
  return { held, bracket: Math.min(held, bracket), other: Math.min(held, other), free: Math.max(0, held - all) };
}
const areWord = (n: number) => (n === 1 ? 'is' : 'are');
/** The words for a sell that waits and finds its contracts spoken for */
export function spokenWords(w: { held: number; bracket: number; other: number; free: number }): string {
  const can = w.free === 0 ? 'none can be sold here' : `${w.free} can be sold here`;
  if (w.bracket > 0 && w.other > 0) return `${w.bracket} of ${w.held} ${areWord(w.bracket)} working in your bracket and ${w.other} in another sell; ${can}`;
  if (w.bracket > 0) return `${w.bracket === w.held && w.held > 1 ? `All ${w.held}` : `${w.bracket} of ${w.held}`} ${areWord(w.bracket)} working in your bracket; ${can}`;
  return `${w.other === w.held && w.held > 1 ? `All ${w.held}` : `${w.other} of ${w.held}`} ${areWord(w.other)} working in another sell; ${can}`;
}

/* ---- the reader's own rules ---- */
/** What the account was worth at today's open: the book as the fills BEFORE today left it, marked at the open's first minute */
export function equityAtOpen(s: Session): number {
  const before = s.fills.filter(f => f.at.day < s.cursor.day);
  if (!before.length) return s.startCash;
  return accountOf({ ...s, fills: before, cursor: { day: s.cursor.day, minute: 0 } }).equity;
}
interface DayState {
  /** Today's result so far, as a share of what the account was worth at the open */
  pct: number;
  /** The reader's daily stop has been reached: no new positions until the next open */
  stopped: boolean;
}
export function dayStateOf(s: Session): DayState {
  const open = equityAtOpen(s);
  const pct = open > 0 ? (accountOf(s).equity - open) / open : 0;
  const limit = s.rules?.dailyLossPct;
  return { pct, stopped: limit != null && limit > 0 && pct <= -limit + 1e-9 };
}
/** "−$750" · "−$749.95": whole dollars where the cents are none */
const lossWords = (v: number): string => {
  const c = Math.round(Math.abs(v) * 100) / 100;
  return `−$${c.toLocaleString('en-US', Number.isInteger(c) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
/** The reader's day stop, said plainly: the share, the account it is measured from (its value at the day's open,
    `equityAtOpen`) and the dollars that makes — "Day stop: −3% of the account at 09:30 = −$750". `open` defaults to
    the clock's day; null without the rule, or while the open cannot be valued (a held contract with no quote). */
export function dayStopOf(s: Session, day = s.cursor.day): { pct: number; open: number; loss: number; words: string } | null {
  const pct = s.rules?.dailyLossPct;
  if (!(pct != null && pct > 0)) return null;
  const open = s.opens?.[day] ?? equityAtOpen(day === s.cursor.day ? s : { ...s, cursor: { day, minute: 0 } });
  if (!Number.isFinite(open)) return null;
  const loss = cents(open * pct);
  return { pct, open, loss, words: `Day stop: −${pctWords(pct)} of the account at 09:30 = ${lossWords(loss)}` };
}
/** Contracts a working BUY would open that are not held yet — counted with the open positions, so a resting order can
    never carry the book past the reader's limit on the minute it fills */
const pendingNew = (s: Session, held: Set<string>): Set<string> => {
  const out = new Set<string>();
  for (const o of s.orders) if (o.status === 'working' && o.side === 'buy' && !held.has(contractKey(o.contract))) out.add(contractKey(o.contract));
  return out;
};
const pctWords = (v: number) => `${+(v * 100).toFixed(1)}%`;
/** Why the reader's rules (or our ceiling) stop this BUY, or null */
function ruleRefusal(s: Session, d: Draft, cost: number): string | null {
  const positions = bookOf(s).positions;
  const held = new Set(positions.map(p => p.key));
  const key = contractKey(d.contract);
  if (!held.has(key)) {
    const pending = pendingNew(s, held);
    const open = held.size + pending.size - (pending.has(key) ? 1 : 0);
    const cap = s.rules?.maxOpen;
    if (cap != null && cap > 0 && open >= cap) return `Your session’s rule: no more than ${cap} ${cap === 1 ? 'position' : 'positions'} open at once`;
    if (open >= OPEN_CEILING) return `No more than ${OPEN_CEILING} positions open at once — close one first`;
  }
  const risk = s.rules?.maxRiskPct;
  if (risk != null && risk > 0) {
    const worth = accountOf(s).equity;
    if (!Number.isFinite(worth)) return 'A held contract has no quote this minute, so the account cannot be valued against your rule — wait a minute';
    const mine = positions.find(p => p.key === key);
    const inIt = (mine ? mine.cost : 0) + cost;
    if (inIt > worth * risk + 1e-9) return `Your session’s rule: no more than ${pctWords(risk)} of the account on one trade — this would be ${money(inIt)} of ${money(worth * risk)}`;
  }
  const limit = s.rules?.dailyLossPct;
  if (limit != null && limit > 0) {
    const day = dayStateOf(s);
    if (day.stopped) return `Your session’s rule: down ${pctWords(-day.pct)} on the day (the stop is ${pctWords(limit)}) — no new positions until the next open`;
  }
  return null;
}

/** Why a draft cannot be taken, or null. The same words the ticket shows before the press. */
export function refusal(s: Session, d: Draft): string | null {
  if (!Number.isInteger(d.qty) || d.qty < 1) return 'Enter a whole number of contracts';
  if (!namesOf(s).includes(d.contract.ticker.toUpperCase())) return `This session trades ${namesOf(s).join(' and ')}`;
  if (d.contract.expiry < s.cursor.day) return 'That contract has expired';
  if (d.contract.short != null) {
    /* a spread is BOUGHT here: the strike sold is the one further out — a call's above, a put's below */
    const { strike, short, right } = d.contract;
    if (short === strike) return 'A spread needs two different strikes';
    if (right === 'C' ? short < strike : short > strike) return 'A spread here is bought for a debit — the strike you sell has to be further out than the one you buy';
  }
  if (d.kind !== 'market' && !(d.price && d.price > 0)) return 'Enter a price';
  if (d.on === 'name' && (d.side === 'buy' || d.kind === 'market')) return 'Only a sell that waits can be set on the name’s price';
  /* 16:00 HAS RUNG: contracts have no overnight session. Nothing fills at the market until the next open; an order that
     waits (a limit, a stop) is taken and waits for it. */
  if (d.kind === 'market' && s.cursor.minute >= LAST_MIN) return 'The market is shut — 16:00 has rung. Open the next day, or leave a limit that waits for it';
  const q = quoteAt(d.contract, s.cursor.day, s.cursor.minute);
  const name = d.contract.ticker;
  /* A STOP waits on the far side of the market: a buy stop over the ask (it buys the minute the ask comes up to it — a
     breakout), a sell stop under the bid. One already through the market would only fill on the next minute. */
  if (d.kind === 'stop' && !d.on && !q.dead) {
    if (d.side === 'buy' && d.price! <= q.ask) return `A buy stop waits over the ask (${q.ask.toFixed(2)}) — at or under it, buy at the market or leave a limit`;
    if (d.side === 'sell' && d.price! >= q.bid) return `A stop waits under the bid (${q.bid.toFixed(2)}) — at or over it, sell at the market`;
  }
  if (d.side === 'buy') {
    /* what it would pay: a limit no more than its price, a stop at least its, a market the ask (a dead quote: the price typed) */
    const ask = q.ask > 0 ? q.ask : (d.price ?? 0);
    const px = d.kind === 'limit' ? Math.min(d.price!, ask) : d.kind === 'stop' ? Math.max(d.price!, ask) : ask;
    const need = px * MULT * d.qty + s.fee * d.qty * legsOf(d.contract);
    if (need > cashOf(s) + 1e-9) return `Not enough cash — this needs $${need.toFixed(2)}`;
    if (d.kind === 'market' && q.dead) return 'No market in that contract right now';
    const ruled = ruleRefusal(s, d, need);
    if (ruled) return ruled;
    const shape = ladderShapeRefusal(d.bracket, d.qty);
    if (shape) return shape;
    const { targets, stops } = rungsOf(d.bracket, d.qty);
    const many = (n: number, word: string) => (n > 1 ? `Every ${word}` : `The ${word}`);
    if (d.bracket?.on === 'name') {
      /* on the name: the target on the contract's good side of where the name stands, the stop on the other */
      const up = d.contract.right === 'C';
      if (targets.some(r => (up ? r.price <= q.spot : r.price >= q.spot))) return `${many(targets.length, 'target')} has to be ${up ? 'above' : 'below'} where ${name} stands`;
      if (stops.some(r => (up ? r.price >= q.spot : r.price <= q.spot))) return `${many(stops.length, 'stop')} has to be ${up ? 'below' : 'above'} where ${name} stands`;
      return null;
    }
    if (targets.some(r => r.price <= px)) return `${many(targets.length, 'target')} has to be above what you pay`;
    if (stops.some(r => r.price >= px)) return `${many(stops.length, 'stop')} has to be under what you pay`;
    return null;
  }
  const held = bookOf(s).positions.find(p => p.key === contractKey(d.contract))?.qty ?? 0;
  /* A market sell by hand is never "SPOKEN FOR": the ladder gives way (afterSell). A sell that WAITS has to find
     contracts nothing else speaks for. */
  if (d.kind === 'market' ? held < d.qty : held - reserved(s, contractKey(d.contract)) < d.qty) return held ? (d.kind === 'market' ? `You hold ${held}` : spokenWords(spokenFor(s, d.contract))) : 'You do not hold that contract';
  if (d.kind === 'market' && q.dead) return 'No bid to sell into right now';
  if (d.on === 'name' && nameHit(d, q.spot)) return `${name} is already past that — it would sell on the next minute`;
  return null;
}

/** Take an order. A market order fills on the minute the clock stands on; the rest wait for a later one. */
export function place(s: Session, d: Draft, now: number): Session {
  let [id, next] = nextId(s, 'o');
  const base: Order = { id, placed: s.cursor, contract: d.contract, side: d.side, qty: d.qty, kind: d.kind, price: d.kind === 'market' ? undefined : d.price, on: d.kind === 'market' ? undefined : d.on, tif: d.tif ?? (d.kind === 'market' ? 'day' : 'gtc'), status: 'working', bracket: d.side === 'buy' ? d.bracket : undefined, tag: d.tag };
  const why = refusal(s, d);
  next = { ...next, touchedAt: now, orders: [...next.orders, why ? { ...base, status: 'refused', why, done: s.cursor } : base] };
  if (why || d.kind === 'stop') return next;
  const q = quoteAt(d.contract, s.cursor.day, s.cursor.minute);
  if (d.kind === 'market') return fillNow(next, base, d.side === 'buy' ? q.ask : q.bid, 'market', q, s.cursor);
  /* A MARKETABLE LIMIT — a buy at or over the ask, a sell at or under the bid — is the market at this minute, capped at
     its price: it fills now, at the recorded ask or bid, like a market order would. Not at the bell (the market is shut),
     not in a minute that is no market, and not one that waits on the name. */
  if (d.on || q.dead || s.cursor.minute >= LAST_MIN) return next;
  if (d.side === 'buy' && q.ask <= d.price!) return fillNow(next, base, q.ask, 'limit', q, s.cursor);
  if (d.side === 'sell' && q.bid >= d.price!) return fillNow(next, base, q.bid, 'limit', q, s.cursor);
  return next;
}

export function cancel(s: Session, orderId: string, now: number): Session {
  return { ...s, touchedAt: now, orders: s.orders.map(o => (o.id === orderId && o.status === 'working' ? { ...o, status: 'cancelled', done: s.cursor, why: 'cancelled by you' } : o)) };
}

/** Move a working order's price — the same order, a new line on the chart. Not taken when the new price would not
    wait: a target at or under the bid, a stop at or over it, would simply fill on the next minute. */
export function amend(s: Session, orderId: string, price: number, now: number): Session {
  const o = s.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'working' || !(price > 0)) return s;
  const q = quoteAt(o.contract, s.cursor.day, s.cursor.minute);
  /* a trailing stop dragged: it keeps its NEW distance from here on (the rules page) */
  const trail = o.kind === 'stop' && o.trail != null ? trailFrom(cents(price), o.on, q) : {};
  if (o.on === 'name') {
    /* a level of the name: not taken where the name already stands past it */
    if (nameHit({ ...o, price }, q.spot)) return s;
    return { ...s, touchedAt: now, orders: s.orders.map(x => (x.id === orderId ? { ...x, price: cents(price), ...trail } : x)) };
  }
  if (o.side === 'sell' && o.kind === 'limit' && price <= q.bid) return s;
  if (o.side === 'sell' && o.kind === 'stop' && price >= q.bid) return s;
  if (o.side === 'buy' && o.kind === 'stop' && !q.dead && price <= q.ask) return s;
  if (o.side === 'buy' && price * MULT * o.qty + s.fee * o.qty * legsOf(o.contract) > cashOf(s)) return s;
  return { ...s, touchedAt: now, orders: s.orders.map(x => (x.id === orderId ? { ...x, price: cents(price), ...trail } : x)) };
}

/** What a further pull off a position's chip would do, per kind: 'first' (it speaks for every contract the ladder may),
    'more' (it adds a level), or null — the ladder is full, or no level has two contracts to give */
export function ladderRoom(s: Session, contract: ContractId): Record<'target' | 'stop', 'first' | 'more' | null> {
  const key = contractKey(contract);
  const pos = bookOf(s).positions.find(p => p.key === key);
  const q = quoteAt(contract, s.cursor.day, s.cursor.minute);
  const mine = workingSells(s, key);
  const cover = (pos?.qty ?? 0) - mine.filter(o => !o.oco).reduce((a, o) => a + o.qty, 0);
  const room = (kind: 'limit' | 'stop') => {
    const rungs = mine.filter(o => o.oco && o.kind === kind);
    if (!pos || cover < 1) return null;
    if (!rungs.length) return 'first' as const;
    return nextRung(rungs, cover, kind === 'limit' ? MAX_TARGETS : MAX_STOPS, o => farness(o, q)) ? ('more' as const) : null;
  };
  return { target: room('limit'), stop: room('stop') };
}
/** …and how many contracts that pull would speak for (nothing where it cannot be taken) — what the chart's preview prices */
export function ladderTake(s: Session, contract: ContractId): Record<'target' | 'stop', number> {
  const key = contractKey(contract);
  const pos = bookOf(s).positions.find(p => p.key === key);
  const q = quoteAt(contract, s.cursor.day, s.cursor.minute);
  const mine = workingSells(s, key);
  const cover = (pos?.qty ?? 0) - mine.filter(o => !o.oco).reduce((a, o) => a + o.qty, 0);
  const take = (kind: 'limit' | 'stop') => {
    const rungs = mine.filter(o => o.oco && o.kind === kind);
    if (!pos || cover < 1) return 0;
    return rungs.length ? (nextRung(rungs, cover, kind === 'limit' ? MAX_TARGETS : MAX_STOPS, o => farness(o, q))?.qty ?? 0) : cover;
  };
  return { target: take('limit'), stop: take('stop') };
}

/** A target or a stop put on a position ALREADY OPEN (on the chart: pulled off the position's own chip). */
export function attach(s: Session, contract: ContractId, kind: 'target' | 'stop', price: number, now: number, on?: 'name'): Session {
  const key = contractKey(contract);
  const pos = bookOf(s).positions.find(p => p.key === key);
  if (!pos || !(price > 0)) return s;
  const q = quoteAt(contract, s.cursor.day, s.cursor.minute);
  const orderKind: OrderKind = kind === 'target' ? 'limit' : 'stop';
  if (on === 'name' ? nameHit({ kind: orderKind, contract, price }, q.spot) : kind === 'target' ? price <= q.bid : price >= q.bid) return s;
  const mine = workingSells(s, key);
  const group = mine.find(o => o.oco)?.oco;
  const rungs = mine.filter(o => o.oco && o.kind === orderKind);
  const cover = pos.qty - mine.filter(o => !o.oco).reduce((a, o) => a + o.qty, 0);
  if (cover < 1) return s;
  const take = rungs.length ? nextRung(rungs, cover, kind === 'target' ? MAX_TARGETS : MAX_STOPS, o => farness(o, q)) : { qty: cover, from: null };
  if (!take || take.qty < 1) return s;
  let next = s;
  let oco = group;
  if (!oco) [oco, next] = nextId(next, 'g');
  const [oid, n2] = nextId(next, 'o');
  const sibling = mine.find(o => o.oco === oco && o.kind === 'stop');
  const switches = kind === 'stop' ? { breakeven: sibling?.breakeven || undefined, ...(sibling?.trail != null ? trailFrom(cents(price), on, q) : {}) } : {};
  const orders = n2.orders.map(x => (take.from && x.id === take.from.id ? { ...x, qty: x.qty - take.qty } : x));
  return { ...n2, touchedAt: now, orders: [...orders, { id: oid, placed: s.cursor, contract, side: 'sell', qty: take.qty, kind: orderKind, price: cents(price), on, tif: 'gtc', status: 'working', oco, tag: pos.tag, ...switches }] };
}

/** A stop's TRAILING switch: on, it keeps a distance — `by`, where one is typed, else the distance it stands at NOW from
    the contract's bid (or, pinned to the name, from where the name stands) — measured from the best price since; off, it
    stays where it is */
export function setTrail(s: Session, orderId: string, on: boolean, now: number, by?: number): Session {
  const o = s.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'working' || o.side !== 'sell' || o.kind !== 'stop' || o.price == null) return s;
  const q = quoteAt(o.contract, s.cursor.day, s.cursor.minute);
  if (on && by != null && !(by > 0)) return s;
  return { ...s, touchedAt: now, orders: s.orders.map(x => (x.id !== orderId ? x : on ? { ...x, ...(by != null ? trailAt(by, o.on, q) : trailFrom(o.price!, o.on, q)) } : { ...x, trail: undefined, peak: undefined })) };
}
/** BREAKEVEN is the ladder's: every working stop of the order's group is armed, or let go */
export function setBreakeven(s: Session, orderId: string, on: boolean, now: number): Session {
  const o = s.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'working' || o.kind !== 'stop') return s;
  return { ...s, touchedAt: now, orders: s.orders.map(x => (x.status === 'working' && x.kind === 'stop' && (x.id === orderId || (o.oco && x.oco === o.oco)) ? { ...x, breakeven: on || undefined } : x)) };
}

/** The same way out, waiting on the other thing — without moving its line. To the name: the level the name would
    have to stand at, this minute, for the contract to bid the order's price (from here on the LEVEL holds and the
    dollars drift). */
export function rebase(s: Session, orderId: string, to: 'name' | 'contract', now: number): Session {
  const o = s.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'working' || o.side !== 'sell' || o.kind === 'market' || o.price == null) return s;
  if ((o.on === 'name') === (to === 'name')) return s;
  const { day, minute } = s.cursor;
  const price = to === 'name' ? spotForBid(o.contract, day, minute, o.price) : cents(quoteWith(o.contract, day, minute, o.price).bid);
  if (price == null || !(price > 0)) return s;
  const basis = to === 'name' ? ('name' as const) : undefined;
  /* a trailing stop keeps trailing — by the distance it stands at now, in what it now waits on */
  const trail = o.trail != null ? trailFrom(price, basis, quoteAt(o.contract, day, minute)) : {};
  return { ...s, touchedAt: now, orders: s.orders.map(x => (x.id === orderId ? { ...x, on: basis, price, ...trail } : x)) };
}

/* ---- the clock ---- */
/** The earliest the clock may be pulled back to: the reader's last order or fill */
export function floorOf(s: Session): Moment {
  let at: Moment = { day: s.startDay, minute: 0 };
  for (const o of s.orders) if (stampOf(o.placed) > stampOf(at)) at = o.placed;
  for (const f of s.fills) if (stampOf(f.at) > stampOf(at)) at = f.at;
  return at;
}

const heldOf = (s: Session, c: ContractId): number => bookOf(s).positions.find(p => p.key === contractKey(c))?.qty ?? 0;
const cancelled = (s: Session, id: string, at: Moment, why: string): Session => ({ ...s, orders: s.orders.map(x => (x.id === id ? { ...x, status: 'cancelled' as const, done: at, why } : x)) });

function minuteOrders(s: Session, at: Moment): Session {
  let next = s;
  for (const first of s.orders) {
    if (first.status !== 'working' || stampOf(first.placed) >= stampOf(at)) continue;
    /* the order as it stands NOW: an earlier fill this minute may have resized it, or taken it away */
    const o = next.orders.find(x => x.id === first.id);
    if (!o || o.status !== 'working') continue;
    const q = quoteAt(o.contract, at.day, at.minute);
    if (q.dead) continue;
    if (o.side === 'sell') {
      /* waits on the NAME: the minute it is there, the contracts are sold at that minute's bid — whatever it is */
      const hit = o.kind === 'market' ? true : o.on === 'name' ? nameHit(o, q.spot) : o.kind === 'limit' ? q.bid >= o.price! : o.kind === 'stop' ? q.bid <= o.price! : false;
      if (!hit) continue;
      /* never more than is held: what is left of the position is what it sells */
      const held = heldOf(next, o.contract);
      if (held <= 0) {
        next = cancelled(next, o.id, at, 'nothing was held by then');
        continue;
      }
      next = fillNow(next, held < o.qty ? { ...o, qty: held } : o, o.kind === 'market' || o.on === 'name' || o.kind === 'stop' ? q.bid : Math.max(o.price!, q.bid), o.kind, q, at);
      continue;
    }
    /* a buy that waits: a limit when the ask comes down to it, a stop when the ask comes up to it — at that ask */
    const hit = o.kind === 'market' ? true : o.kind === 'limit' ? q.ask <= o.price! : o.kind === 'stop' ? q.ask >= o.price! : false;
    if (!hit) continue;
    const px = o.kind === 'limit' ? Math.min(o.price!, q.ask) : q.ask;
    /* the reader's daily stop was reached while this order rested: it does not open a position on a day that is over */
    if (dayStateOf({ ...next, cursor: at }).stopped) next = cancelled(next, o.id, at, 'your session’s rule: the day’s stop had been reached');
    else if (px * MULT * o.qty + next.fee * o.qty * legsOf(o.contract) > cashOf(next) + 1e-9) next = cancelled(next, o.id, at, 'the cash was gone by then');
    else next = fillNow(next, o, px, o.kind, q, at);
  }
  /* Trailing stops, after the check: each was tried where it stood; only now is it moved by this minute's price —
     the good part of a minute is never assumed to have come before the bad part */
  if (next.orders.some(o => o.status === 'working' && o.trail != null)) {
    next = {
      ...next,
      orders: next.orders.map(o => {
        if (o.status !== 'working' || o.kind !== 'stop' || o.trail == null || o.price == null || stampOf(o.placed) >= stampOf(at)) return o;
        const q = quoteAt(o.contract, at.day, at.minute);
        if (q.dead) return o;
        if (o.on === 'name') {
          /* a call's stop sits under the name and follows its highs; a put's sits over it and follows its lows */
          const up = o.contract.right === 'C';
          const peak = up ? Math.max(o.peak ?? q.spot, q.spot) : Math.min(o.peak ?? q.spot, q.spot);
          const level = cents(up ? peak - o.trail : peak + o.trail);
          return { ...o, peak, price: up ? Math.max(o.price, level) : Math.min(o.price, level) };
        }
        const peak = Math.max(o.peak ?? q.bid, q.bid);
        return { ...o, peak, price: Math.max(o.price, cents(peak - o.trail)) };
      }),
    };
  }
  return next;
}

/** 16:00: what expires today settles at what it is worth in the money; day orders go */
function bell(s: Session, day: string): Session {
  const at: Moment = { day, minute: LAST_MIN };
  let next: Session = { ...s, orders: s.orders.map(o => (o.status === 'working' && (o.tif === 'day' || o.contract.expiry <= day) ? { ...o, status: 'cancelled' as const, done: at, why: o.contract.expiry <= day ? 'the contract expired' : 'the day ended' } : o)) };
  for (const p of bookOf(next).positions) {
    if (p.contract.expiry > day) continue;
    /* settled on the name's close of its expiry day; while that close is not known the contract is not settled at a
       guess — it waits, held, and the next bell tries again (pendingSettlement says so) */
    const st = settlementAt(p.contract, p.contract.expiry);
    if (!st) continue;
    const q = quoteAt(p.contract, day, LAST_MIN);
    next = fillNow(next, { id: '', placed: at, contract: p.contract, side: 'sell', qty: p.qty, kind: 'market', tif: 'day', status: 'working', tag: p.tag }, st.price, 'expired', { ...q, spot: st.spot }, at, st.style);
  }
  /* the account as the bell left it — the report's curve and its days */
  const a = accountOf({ ...next, cursor: at });
  if (Number.isFinite(a.equity)) next = { ...next, closes: { ...next.closes, [day]: { equity: a.equity, cash: a.cash, realized: a.realized, open: a.openPnl, held: a.positions.length } } };
  return next;
}
/** Held contracts past their expiry that the bell could not settle yet — the name's close that day is not loaded */
export const pendingSettlement = (s: Session): Position[] => bookOf(s).positions.filter(p => p.contract.expiry < s.cursor.day || (p.contract.expiry === s.cursor.day && s.cursor.minute >= LAST_MIN));

/** Move the clock forward to a moment, running every minute between. Backward moves never touch the book. */
export function advance(s: Session, to: Moment, now: number): Session {
  const from = s.cursor;
  if (stampOf(to) <= stampOf(from)) {
    const floor = floorOf(s);
    return { ...s, touchedAt: now, cursor: stampOf(to) < stampOf(floor) ? floor : to };
  }
  let next = s;
  for (let day: string | null = from.day, guard = 0; day && day <= to.day && guard < 400; day = sessionAfter(day), guard++) {
    const first = day === from.day ? from.minute + 1 : 0;
    const last = day === to.day ? to.minute : LAST_MIN;
    /* the open walked through with a book carried into it: what the account was worth there is kept (the day stop's base) */
    if (first === 0 && next.opens?.[day] == null && next.fills.some(f => f.at.day < day)) {
      const eq = equityAtOpen({ ...next, cursor: { day, minute: 0 } });
      if (Number.isFinite(eq)) next = { ...next, opens: { ...next.opens, [day]: eq } };
    }
    const busy = next.orders.some(o => o.status === 'working');
    if (busy) for (let m = first; m <= last; m++) next = minuteOrders(next, { day, minute: m });
    if (last === LAST_MIN) next = bell(next, day);
  }
  return { ...next, cursor: to, touchedAt: now };
}

/** OPEN THE NEXT DAY: the bell rung on the clock's day (what expires settles, day orders go) and the clock at the next
    session's open — positions and good-till-cancelled orders carried. The bell's door, and the roll-over's step. */
export const nextOpen = (s: Session, now: number): Session => advance(s, { day: sessionAfter(s.cursor.day), minute: 0 }, now);
/** THE CLOCK PLAYING: where one tick of `mins` session minutes takes it from `at`, or null where it stops. It always
    stands on the bell first (16:00 rings, and is seen); from the bell, with the reader's roll-over on and a next day
    on the tape, it goes on to that day's open — what "Open the next day" does — and keeps playing. */
export function playStep(at: Moment, mins: number, roll: boolean, tomorrow: string | null): Moment | null {
  if (at.minute >= LAST_MIN) return roll && tomorrow ? { day: tomorrow, minute: 0 } : null;
  return { day: at.day, minute: Math.min(LAST_MIN, at.minute + Math.max(1, Math.floor(mins))) };
}

/* ---- the report ---- */
interface Stats {
  n: number;
  wins: number;
  winRate: number;
  net: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  expectancy: number;
  expectancyR: number;
  maxDrawdown: number;
  /** Where the drawdown was read from: the account's equity curve, or (none given) the closed trades and each one's own low */
  drawdownFrom: 'curve' | 'trades';
  losingRun: number;
  avgHeldMin: number;
  best: number;
  worst: number;
  /** Trades that closed at exactly $0 — neither a win nor a loss */
  scratches: number;
  /** Annualised (√252) Sharpe and Sortino of the daily equity returns, where a daily curve of 3 points or more is given:
      mean ÷ sample standard deviation; mean ÷ downside deviation (√ of the mean squared negative return, over every day).
      Null where it cannot be said (too few days, or no spread). No risk-free rate is taken off. */
  sharpe: number | null;
  sortino: number | null;
}
/** The account's own curve, for the figures a list of trades cannot give */
export interface StatsCurve {
  /** The account's equity in time order (a backtest's every minute, from the start) — the drawdown is its worst fall
      from a high */
  equity?: number[];
  /** …or the drawdown, already read off a curve kept elsewhere (a paper account's ticks) */
  maxDrawdown?: number;
  /** The account's equity at the start and at each day's close, in order — Sharpe and Sortino are on its returns */
  daily?: number[];
}
/** The worst fall from a high of a curve, in dollars */
export function drawdownOfCurve(curve: number[]): number {
  let peak = -Infinity;
  let dd = 0;
  for (const v of curve) {
    if (!Number.isFinite(v)) continue;
    peak = Math.max(peak, v);
    dd = Math.max(dd, peak - v);
  }
  return cents(dd);
}
/** Annualised Sharpe and Sortino of the returns of a daily equity curve (start, then each close) — see Stats */
export function ratiosOfDaily(daily: number[]): { sharpe: number | null; sortino: number | null } {
  const eq = daily.filter(v => Number.isFinite(v) && v > 0);
  const r: number[] = [];
  for (let i = 1; i < eq.length; i++) r.push(eq[i] / eq[i - 1] - 1);
  if (r.length < 2) return { sharpe: null, sortino: null };
  const mean = r.reduce((x, v) => x + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((x, v) => x + (v - mean) ** 2, 0) / (r.length - 1));
  const down = Math.sqrt(r.reduce((x, v) => x + Math.min(0, v) ** 2, 0) / r.length);
  const k = Math.sqrt(252);
  return { sharpe: sd > 1e-12 ? (mean / sd) * k : null, sortino: down > 1e-12 ? (mean / down) * k : null };
}
/** What the report's figures need of a closed trade — a backtest's or a paper account's. A trade with no R (a paper future
    entered without a stop) is left out of the R figures. */
interface Scored {
  pnl: number;
  r: number | null;
  /** A replayed moment — or a paper trade's real instant (data/paper/engine.ts), which carries `at` */
  closed: Moment | { at: number };
  heldMin: number;
  /** The lowest open P&L while the trade was on, where the marks are known; the drawdown counts it */
  lowOpen?: number;
}
/** A close, as one number for order: the instant where there is one, the replayed stamp where not (a journal is one kind or
    the other, so the two are never compared) */
const closedStamp = (m: Scored['closed']): number => ('at' in m ? m.at : stampOf(m));
/** The report's figures. `curve`: the account's own equity — the drawdown is read off it (a list of trades alone cannot
    see two trades down at once), and Sharpe / Sortino off its daily closes. A trade that closed at exactly $0 is a
    scratch: not a win, not a loss, and it neither starts nor breaks a losing run. */
export function statsOf(trades: Scored[], curve?: StatsCurve): Stats {
  const n = trades.length;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const scratches = trades.filter(t => t.pnl === 0).length;
  const sum = (a: Scored[]) => a.reduce((x, t) => x + t.pnl, 0);
  const withR = trades.filter(t => t.r != null);
  let peak = 0;
  let run = 0;
  let dd = 0;
  let lr = 0;
  let cur = 0;
  for (const t of [...trades].sort((a, b) => closedStamp(a.closed) - closedStamp(b.closed))) {
    if (t.lowOpen != null && t.lowOpen < 0) dd = Math.max(dd, peak - (run + t.lowOpen));
    run += t.pnl;
    peak = Math.max(peak, run);
    dd = Math.max(dd, peak - run);
    if (t.pnl < 0) cur++;
    else if (t.pnl > 0) cur = 0;
    lr = Math.max(lr, cur);
  }
  const fromCurve = curve?.maxDrawdown != null && Number.isFinite(curve.maxDrawdown) ? curve.maxDrawdown : curve?.equity?.length ? drawdownOfCurve(curve.equity) : null;
  if (fromCurve != null) dd = fromCurve;
  const ratios = curve?.daily ? ratiosOfDaily(curve.daily) : { sharpe: null, sortino: null };
  const gw = sum(wins);
  const gl = Math.abs(sum(losses));
  return {
    n,
    wins: wins.length,
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : 0,
    net: cents(sum(trades)),
    avgWin: wins.length ? cents(gw / wins.length) : 0,
    avgLoss: losses.length ? cents(-gl / losses.length) : 0,
    profitFactor: gl > 0 ? gw / gl : null,
    expectancy: n ? cents(sum(trades) / n) : 0,
    expectancyR: withR.length ? withR.reduce((x, t) => x + (t.r ?? 0), 0) / withR.length : 0,
    maxDrawdown: cents(dd),
    drawdownFrom: fromCurve != null ? 'curve' : 'trades',
    losingRun: lr,
    avgHeldMin: n ? trades.reduce((x, t) => x + t.heldMin, 0) / n : 0,
    best: n ? Math.max(...trades.map(t => t.pnl)) : 0,
    worst: n ? Math.min(...trades.map(t => t.pnl)) : 0,
    scratches,
    ...ratios,
  };
}

/** A backtest's equity at the end of every minute from its start to its clock: cash, and every contract held at its mark
    (the account's own mid — a minute that is no market keeps the last mid it had). The report's drawdown is read off it. */
export function equityCurveOf(s: Session): number[] {
  const fills = [...s.fills].sort((a, b) => stampOf(a.at) - stampOf(b.at));
  const out: number[] = [s.startCash];
  if (!fills.length) return out;
  const held = new Map<string, { c: ContractId; qty: number; last: number }>();
  let cash = s.startCash;
  let k = 0;
  const end = s.cursor;
  for (let day: string | null = fills[0].at.day, guard = 0; day && day <= end.day && guard < 2000; day = sessionAfter(day), guard++) {
    const m0 = day === fills[0].at.day ? fills[0].at.minute : 0;
    const m1 = day === end.day ? Math.min(LAST_MIN, end.minute) : LAST_MIN;
    for (let m = m0; m <= m1; m++) {
      while (k < fills.length && (fills[k].at.day < day || (fills[k].at.day === day && fills[k].at.minute <= m))) {
        const f = fills[k++];
        const key = contractKey(f.contract);
        const h = held.get(key) ?? { c: f.contract, qty: 0, last: f.price };
        const way = f.side === 'buy' ? 1 : -1;
        h.qty += way * f.qty;
        h.last = f.price;
        cash += -way * f.price * MULT * f.qty - f.fee;
        if (h.qty === 0) held.delete(key);
        else held.set(key, h);
      }
      let v = cash;
      for (const h of held.values()) {
        const mk = markAt(h.c, day, m).mark;
        if (Number.isFinite(mk)) h.last = mk;
        v += h.qty * h.last * MULT;
      }
      out.push(cents(v));
    }
  }
  return out;
}
/** The report's figures for a backtest, read off its own equity: the drawdown off its minute curve, Sharpe and Sortino
    off its bells (`closes`) */
export function sessionStatsOf(s: Session): Stats {
  const { trades } = bookOf(s);
  const days = Object.keys(s.closes ?? {}).sort();
  return statsOf(trades, { equity: equityCurveOf(s), daily: [s.startCash, ...days.map(d => s.closes![d].equity)] });
}

interface Cut {
  label: string;
  n: number;
  winRate: number;
  net: number;
  avgR: number;
}
const cutBy = (trades: Trade[], groups: [string, (t: Trade) => boolean][]): Cut[] =>
  groups
    .map(([label, pick]) => {
      const g = trades.filter(pick);
      return { label, n: g.length, winRate: g.length ? g.filter(t => t.pnl > 0).length / g.length : 0, net: cents(g.reduce((a, t) => a + t.pnl, 0)), avgR: g.length ? g.reduce((a, t) => a + t.r, 0) / g.length : 0 };
    })
    .filter(c => c.n > 0);
/** The cuts only options have */
export function cutsOf(trades: Trade[]): { title: string; rows: Cut[] }[] {
  const ad = (t: Trade) => Math.abs(t.deltaIn);
  const names = [...new Set(trades.map(t => t.contract.ticker))];
  return [
    /* a session of two names: which one the edge lives in (a single name would be one row saying what the head already does) */
    { title: 'By name', rows: names.length > 1 ? cutBy(trades, names.map(n => [n, (t: Trade) => t.contract.ticker === n] as [string, (t: Trade) => boolean])) : [] },
    { title: 'Single contracts against spreads', rows: trades.some(t => t.contract.short != null) ? cutBy(trades, [['Single contracts', t => t.contract.short == null], ['Spreads', t => t.contract.short != null]]) : [] },
    { title: 'Calls against puts', rows: cutBy(trades, [['Calls', t => t.contract.right === 'C'], ['Puts', t => t.contract.right === 'P']]) },
    { title: 'By days to expiry at entry', rows: cutBy(trades, [['Same day', t => t.dteIn === 0], ['1 to 7 days', t => t.dteIn >= 1 && t.dteIn <= 7], ['8 to 30 days', t => t.dteIn >= 8 && t.dteIn <= 30], ['Over 30 days', t => t.dteIn > 30]]) },
    { title: 'By delta at entry', rows: cutBy(trades, [['Far out · under 0.25', t => ad(t) < 0.25], ['Out · 0.25 to 0.45', t => ad(t) >= 0.25 && ad(t) < 0.45], ['At the money · 0.45 to 0.60', t => ad(t) >= 0.45 && ad(t) <= 0.6], ['In the money · over 0.60', t => ad(t) > 0.6]]) },
    { title: 'How it ended', rows: cutBy(trades, [['Sold by you', t => t.how === 'sold'], ['Target hit', t => t.how === 'target'], ['Stopped out', t => t.how === 'stopped'], ['Held to the bell', t => t.how === 'expired'], ['Scaled out · in pieces', t => t.how === 'scaled']]) },
    { title: 'By the hour it was entered', rows: cutBy(trades, [['09:30 to 10:30', t => t.opened.minute < 60], ['10:30 to 12:00', t => t.opened.minute >= 60 && t.opened.minute < 150], ['12:00 to 14:00', t => t.opened.minute >= 150 && t.opened.minute < 270], ['14:00 to the bell', t => t.opened.minute >= 270]]) },
  ].filter(c => c.rows.length > 0);
}
/** Dollars of decay the trade was charged a day it was held, by the theta it was entered on */
export const decayPerDay = (t: Pick<Trade, 'thetaIn' | 'qty'>) => cents(Math.abs(t.thetaIn) * MULT * t.qty);
