/* Later turn. A log, not a model. orders is false. It does not take a seat, it does not read a score,
   and it is not on the board. One open contract. The next name waits. */

import fs from 'node:fs';
import path from 'node:path';
import { bsStates, ivStates } from './compassFeatures';
import { SESSION_MIN, YEAR_SESSIONS, weekdayDte } from './compassParams';
import { fillableQuote } from './reviewLive';
import { nyParts } from '../core/nyTime';
import { REGULAR_OPEN_MIN } from '../core/session';

export const LATER_ORDERS = false as const;
const NAMES = new Set(['SPY', 'QQQ', 'IWM', 'SPXW', 'XSP']);
const ASK_CAP = 8;
const DELTA_LO = 0.08;
const DELTA_HI = 0.35;
const TP = 2;
const STOP = 0.4678;

export interface LaterRow {
  id: string;
  root: string;
  contract: string;
  right: 'C' | 'P';
  strike: number;
  expiry: string;
  minute: number;
  entryAsk: number;
  entryAt: number;
  delta: number;
  aligned: number;
  exitBid: number | null;
  exitAt: number | null;
  why: 'target' | 'stop' | null;
  pnl: number | null;
}

interface LaterDoc {
  version: 1;
  day: string;
  orders: false;
  open: LaterRow | null;
  /** Last exit. A turn at or before this was not a free contract. */
  flatAt: number | null;
  rows: LaterRow[];
}

interface MinuteQ {
  minute: number;
  bid: number;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  under: number | null;
  at: number;
}

interface Seen {
  prev: MinuteQ | null;
  last: MinuteQ | null;
  forming: MinuteQ | null;
  /** Session minute of the first fillable quote. That minute is not an entry. */
  firstFillable: number | null;
}

export interface LaterPrint {
  root: string;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  session: string;
  sessionDay: string;
  at: number;
  bid: number;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  under: number | null;
}

const docs = new Map<string, LaterDoc>();
const seen = new Map<string, Seen>();
const closes = new Map<string, Map<number, number>>();

const underOf = (root: string) => (root === 'SPXW' || root === 'XSP' ? 'SPX' : root);
const contractKey = (p: LaterPrint) => `${p.sessionDay}|${p.root}|${p.expiry}|${p.strike}|${p.right}`;
const word = (root: string, strike: number, right: 'C' | 'P') =>
  `${root} ${Number.isInteger(strike) ? strike.toFixed(0) : strike}${right}`;

export function sessionMinute(at: number): number | null {
  const p = nyParts(at);
  const m = p.hour * 60 + p.minute - REGULAR_OPEN_MIN;
  return m >= 0 && m <= 389 ? m : null;
}

/** Black–Scholes delta. r = 0.042, q = 0. T is the same-day fraction. Null when IV will not solve. */
export function laterDelta(spot: number, strike: number, minute: number, mid: number, call: boolean): number | null {
  const T = (SESSION_MIN - minute) / (SESSION_MIN * YEAR_SESSIONS);
  if (!(T > 0)) return null;
  const iv = ivStates(mid, spot, strike, T, call);
  if (!(iv > 0)) return null;
  const de = bsStates(spot, strike, T, iv, call).de;
  return Number.isFinite(de) ? de : null;
}

const empty = (day: string): LaterDoc => ({ version: 1, day, orders: false, open: null, flatAt: null, rows: [] });

function fileOf(dir: string, day: string): string {
  return path.join(dir, 'later', `${day}.json`);
}

function load(dir: string, day: string): LaterDoc {
  const key = `${dir}|${day}`;
  const held = docs.get(key);
  if (held) return held;
  let doc = empty(day);
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(dir, day), 'utf8')) as LaterDoc;
    if (raw && raw.version === 1 && raw.orders === false && Array.isArray(raw.rows)) {
      doc = { ...empty(day), ...raw, orders: false, flatAt: raw.flatAt ?? null };
    }
  } catch {
    /* a new session starts empty */
  }
  docs.set(key, doc);
  return doc;
}

function save(dir: string, doc: LaterDoc): void {
  const file = fileOf(dir, doc.day);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, file);
}

function closeOpen(doc: LaterDoc, bid: number, at: number): void {
  const row = doc.open;
  if (!row) return;
  const why = bid >= row.entryAsk * TP ? 'target' : 'stop';
  row.exitBid = bid;
  row.exitAt = at;
  row.why = why;
  row.pnl = (bid - row.entryAsk) * 100;
  doc.flatAt = at;
  doc.rows = [row, ...doc.rows];
  doc.open = null;
}

/**
 * One print. A fillable minute is remembered. A later fillable turn, not the first, can open the one ticket.
 * A later print of that contract closes it at 2× or at 0.4678×. Nothing is sent.
 */
export function noteLaterPrint(dir: string, p: LaterPrint): void {
  if (!NAMES.has(p.root) || p.session !== 'regular' || weekdayDte(p.sessionDay, p.expiry) !== 0) return;
  const minute = sessionMinute(p.at);
  if (minute == null || !(p.bid > 0)) return;
  const doc = load(dir, p.sessionDay);
  const open = doc.open;
  if (open && open.root === p.root && open.expiry === p.expiry && open.strike === p.strike && open.right === p.right && p.at > open.entryAt) {
    if (p.bid >= open.entryAsk * TP || p.bid <= open.entryAsk * STOP) {
      closeOpen(doc, p.bid, p.at);
      save(dir, doc);
    }
  }
  const key = contractKey(p);
  let row = seen.get(key);
  if (!row) {
    row = { prev: null, last: null, forming: null, firstFillable: null };
    seen.set(key, row);
  }
  const stamp: MinuteQ = { minute, bid: p.bid, ask: p.ask, bidSize: p.bidSize, askSize: p.askSize, under: p.under, at: p.at };
  if (row.forming && minute < row.forming.minute) return;
  if (!row.forming || row.forming.minute === minute) {
    row.forming = stamp;
    return;
  }
  const closed = row.forming;
  row.forming = stamp;
  if (closed.under != null && closed.under > 0) {
    const book = underOf(p.root);
    const map = closes.get(`${p.sessionDay}|${book}`) ?? new Map<number, number>();
    map.set(closed.minute, closed.under);
    closes.set(`${p.sessionDay}|${book}`, map);
  }
  /* Every closed minute counts, including the first two, which cannot be a turn yet. */
  if (row.firstFillable == null && fillableQuote(closed.bid, closed.ask, closed.bidSize, closed.askSize)) {
    row.firstFillable = closed.minute;
  }
  const a = row.prev;
  const b = row.last;
  row.prev = b;
  row.last = closed;
  if (!b || !a) return;
  const turn = b.bid <= a.bid && closed.bid > b.bid;
  const fillable = fillableQuote(b.bid, b.ask, b.bidSize, b.askSize);
  const earlier = row.firstFillable != null && row.firstFillable < b.minute;
  if (!turn || !fillable || !earlier || doc.open) return;
  if (doc.flatAt != null && !(b.at > doc.flatAt)) return;
  if (b.ask == null || !(b.ask < ASK_CAP) || !(b.ask > 0)) return;
  const spot = closes.get(`${p.sessionDay}|${underOf(p.root)}`)?.get(b.minute) ?? null;
  const prior = closes.get(`${p.sessionDay}|${underOf(p.root)}`)?.get(b.minute - 5) ?? null;
  if (spot == null || prior == null || !(prior > 0)) return;
  const aligned = spot / prior - 1;
  if (aligned === 0) return;
  if (p.right === 'C' ? !(aligned > 0) : !(aligned < 0)) return;
  const mid = (b.bid + b.ask) / 2;
  const delta = laterDelta(spot, p.strike, b.minute, mid, p.right === 'C');
  if (delta == null || Math.abs(delta) < DELTA_LO || Math.abs(delta) > DELTA_HI) return;
  doc.open = {
    id: `${key}|${b.at}`,
    root: p.root,
    contract: word(p.root, p.strike, p.right),
    right: p.right,
    strike: p.strike,
    expiry: p.expiry,
    minute: b.minute,
    entryAsk: b.ask,
    entryAt: b.at,
    delta,
    aligned,
    exitBid: null,
    exitAt: null,
    why: null,
    pnl: null,
  };
  save(dir, doc);
}
