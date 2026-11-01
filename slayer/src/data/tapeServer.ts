/// <reference types="node" />
/*
  THE SERVER'S TAPES (GET /api/tape/options and /api/tape/stock, server/tapeApi.mjs): one option tape and one stock
  tape per name, read on this server and shared by every pane and every viewer. Terrain's chart, its flow pane and its
  rail read them; nothing in a browser asks the terminal for a print.

  - The OPTION TAPE is the name's option prints for the session (the regular window of its options, per
    shared/marketSession.mjs), each with the quote in force just before it: /option/history/trade_quote, every expiry,
    OPTION_STRIKES strikes either side of the money, one root at a time (SPX reads SPXW and SPX). Read in windows of
    OPTION_WINDOW_MIN minutes from the open, then, while the options trade, the newest whole minutes as they close. Each
    print is tagged (data/printTags.ts: sweep, spread leg, floor, block, single), sided against the quote, and paired with
    the contract's running volume and the open interest it opened on (one /option/history/open_interest read a root and
    day) — the opening read the flow pane's net already makes (data/tape.ts printOpens). The minute's price for how far
    out of the money comes from the name's one-minute bars, read beside the windows.
    Kept: every print of OPTION_PRINT_FLOOR dollars or more as itself, and the smaller ones folded a minute at a time by
    what the pane filters on (type, side, right, in or out of the money, days to run) — only those that lean: a print
    with no side or that may be closing adds nothing to a net. A summary by type holds every print's money.
  - The STOCK TAPE is the name's stock prints in the regular session with the quote at each: /stock/history/trade_quote,
    STOCK_WINDOW_MIN minutes a read. Kept: the volume by venue (the mix), and the off-exchange prints of
    DARK_MARK_NOTIONAL and up and the blocks (data/printTags.ts stockPrintOf) as marks. Today the merged SIP is read
    (venue=utp_cta: every venue, fifteen minutes behind); the real-time feed carries one exchange family only, which
    would make a mix that is not the market's. An index has no stock prints.

  THE TERMINAL'S SLOTS: at most TAPE_READS reads at once across every tape, the second only while the terminal keeps
  room for the charts and quotes (vol outlook's rule, data/volOutlookServer.ts roomForRead); the newest window of a live
  tape goes ahead of a backfill. The research job and the exposure history read the same terminal.

  A FEED, NOT A POLL: `ingestOptions` / `ingestStock` take rows in the terminal's CSV shape whatever brought them; a
  window read is one feeder. A stream client (the realtime audit's design: one ThetaData connection beside the terminal)
  hands its trades to the same functions and moves `through` on; the readers stop for a tape a stream covers.

  KEPT ON DISK: a finished day's tapes, <dir>/<YYYY-MM-DD>/<TICKER>.<kind>.json.gz, so a restart reads only what it
  lacks. This module never runs in a browser bundle.
*/

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { INDEX_SYMBOLS, isSessionDay, nyInstant, nyWall, productOf, sessionAt, windowAt } from '../../shared/marketSession.mjs';
import {
  OFF_EXCHANGE,
  DARK_MARK_NOTIONAL,
  PRINT_TYPES,
  SIDE_CODE,
  eachCsvRow,
  optionTagsOf,
  primaryOf,
  sideAtQuote,
  stampParts,
  stockPrintOf,
  tagBits,
  type PrintType,
} from './printTags';
import { printSetsPrice } from './thetaEligible';

/** 2: a stock mark carries the quote it printed against */
export const TAPE_FORMAT = 2;
/** Reads in flight at once across every tape */
export const TAPE_READS = 2;
/** Terminal slots a second read leaves free, counting itself (data/volOutlookServer.ts KEEP_FREE) */
export const KEEP_FREE = 4;
export const OPTION_WINDOW_MIN = 15;
export const STOCK_WINDOW_MIN = 10;
export const OPTION_STRIKES = 30;
/** A print this size and up is kept whole; smaller ones are folded by the minute */
export const OPTION_PRINT_FLOOR = 50_000;
/** A whole minute is read once it has been closed this long */
const LAG_MS = 3_000;
/** Today's merged SIP runs this far behind */
export const SIP_DELAY_MS = 15 * 60_000;
/** The underlying's minute bars are read again this often on a live tape (a print takes the latest minute in hand) */
const SPOT_EVERY_MS = 5 * 60_000;
/** A tape nobody asked for in this long stops reading (it is kept until evicted) */
const IDLE_MS = 10 * 60_000;
/** Tapes kept in memory, each kind */
const MAX_TAPES = 8;
const TICK_MS = 5_000;
/** A failed read waits this long before the tape asks again */
const BACKOFF_MS = 30_000;

/** Roots read for a name: SPX's weeklies trade as SPXW, NDX's as NDXP, RUT's as RUTW */
const WEEKLY: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };
export const optionRootsOf = (name: string): string[] => {
  const n = name.replace(/\./g, '');
  return WEEKLY[n] ? [WEEKLY[n], n] : [n];
};
export const isIndexName = (name: string): boolean => INDEX_SYMBOLS.has(name.toUpperCase());

export interface ThetaSlots {
  terminal: number;
  history: number;
  busy: number;
  busyHistory: number;
  waiting: number;
}
export const roomForRead = (s: ThetaSlots): boolean => s.waiting === 0 && s.terminal - s.busy - 1 >= KEEP_FREE && s.busyHistory + 1 <= s.history;

export interface TapeOptions {
  /** <dir>/<day>/<TICKER>.<kind>.json.gz */
  dir: string;
  /** One terminal answer outside the hub's cache (server/thetaProxy.mjs thetaUncached): a window is megabytes */
  theta: (path: string) => Promise<{ status: number; body: string }>;
  slots?: () => ThetaSlots;
  /** false: serve what is kept, read nothing */
  read?: boolean;
  now?: () => number;
  log?: (line: string) => void;
}

/* ---- the option tape ----------------------------------------------------------------------------------------- */

/** One kept print, as the wire carries it:
    [ms, expiry, strike, right(1 C / -1 P), size, price, bid, ask, side(1 ask / -1 bid / 0), tags, otm% (null unknown),
     dte, opening(1/0), contract volume through it, open interest at the open (-1 unknown), seq] */
export type OptionPrintRow = [number, string, number, 1 | -1, number, number, number, number, number, number, number | null, number, 0 | 1, number, number, number];
/** One folded minute: [minute ms, tags, side, right, otm (1 out, 0 in, -1 unknown), dte bucket (0: 0–14, 1: 15–60, 2: 61+),
    prints, contracts, premium] — leaning prints under OPTION_PRINT_FLOOR only */
export type OptionCellRow = [number, number, number, 1 | -1, number, number, number, number, number];
/** The session by type: [type, premium at the ask, at the bid, with no side, contracts, prints] — every print */
export type TypeMixRow = [PrintType, number, number, number, number, number];

export interface OptionTapeWire {
  format: typeof TAPE_FORMAT;
  kind: 'options';
  ticker: string;
  day: string;
  open: number;
  close: number;
  /** Everything before this instant is in; the rows sent are those in [since, through) */
  through: number;
  complete: boolean;
  /** The options trade now and the tape is following them */
  live: boolean;
  /** The open interest the session opened on was read (else no print can be told opening) */
  oi: boolean;
  fault: string | null;
  prints: OptionPrintRow[];
  cells: OptionCellRow[];
  mix: TypeMixRow[];
}

interface RootState {
  root: string;
  through: number;
  vol: Map<string, number>;
  oi: Map<string, number> | null;
  oiTried: boolean;
}

export interface OptionTape {
  kind: 'options';
  name: string;
  day: string;
  open: number;
  close: number;
  roots: RootState[];
  spot: Map<number, number>;
  spotThrough: number;
  spotReadAt: number;
  prints: OptionPrintRow[];
  cells: Map<string, OptionCellRow>;
  cellList: OptionCellRow[];
  mix: Map<PrintType, TypeMixRow>;
  seq: number;
  asked: number;
  running: boolean;
  fault: string | null;
  retryAt: number;
  saved: boolean;
}

const dteBucket = (dte: number) => (dte <= 14 ? 0 : dte <= 60 ? 1 : 2);
const dayDiff = (a: string, b: string) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000);
const num = (s: string | undefined) => (s == null || s === '' ? NaN : Number(s));
const unq = (s: string | undefined) => (s ?? '').replace(/"/g, '');
const stampMs = (s: string): number => {
  const p = stampParts(s);
  return p ? nyInstant(p.date, p.minute) + p.ms : NaN;
};

/** An empty option tape for a name's session (a reader or a proof feeds it) */
export function newOptionTape(name: string, day: string, open: number, close: number): OptionTape {
  return {
    kind: 'options', name, day, open, close,
    roots: optionRootsOf(name).map(root => ({ root, through: open, vol: new Map(), oi: null, oiTried: false })),
    spot: new Map(), spotThrough: open, spotReadAt: 0,
    prints: [], cells: new Map(), cellList: [], mix: new Map(), seq: 0,
    asked: 0, running: false, fault: null, retryAt: 0, saved: false,
  };
}

const optionThrough = (t: OptionTape) => Math.min(...t.roots.map(r => r.through));

/** The minute's price for a print: the newest minute in hand at or before it */
function spotAt(t: OptionTape, minute: number): number {
  for (let m = minute, i = 0; i < 30; i++, m -= 60_000) {
    const v = t.spot.get(m);
    if (v != null) return v;
  }
  return NaN;
}

/** The underlying's one-minute closes (CSV), into the tape */
export function ingestSpot(t: { spot: Map<number, number> }, csv: string): number {
  return eachCsvRow(csv, (f, c) => {
    const ms = stampMs(f[c.get('timestamp') ?? -1] ?? '');
    const close = num(f[c.get('close') ?? -1]);
    if (Number.isFinite(ms) && close > 0) t.spot.set(Math.floor(ms / 60_000) * 60_000, close);
  });
}

/** The open interest each contract of a root opened the day on (CSV) */
export function readOi(csv: string): Map<string, number> {
  const m = new Map<string, number>();
  eachCsvRow(csv, (f, c) => {
    const key = `${unq(f[c.get('expiration') ?? -1]).slice(0, 10)}|${num(f[c.get('strike') ?? -1])}|${unq(f[c.get('right') ?? -1]).startsWith('C') ? 'C' : 'P'}`;
    const oi = num(f[c.get('open_interest') ?? -1]);
    if (Number.isFinite(oi)) m.set(key, oi);
  });
  return m;
}

/**
 * Option prints with the quote at each (the /option/history/trade_quote CSV shape), for one root, into the tape —
 * whatever brought them (a window read, or a stream later). Rows must come in time order for a root. Returns the
 * prints taken (cancels and empty prints are not).
 */
export function ingestOptions(t: OptionTape, rootIdx: number, csv: string): number {
  const r = t.roots[rootIdx];
  let taken = 0;
  eachCsvRow(csv, (f, c) => {
    const conds = ['condition', 'ext_condition1', 'ext_condition2', 'ext_condition3', 'ext_condition4'].map(k => num(f[c.get(k) ?? -1])).filter(Number.isFinite);
    const size = num(f[c.get('size') ?? -1]);
    const price = num(f[c.get('price') ?? -1]);
    if (!(size > 0) || !(price > 0)) return;
    const premium = price * size * 100;
    const tags = optionTagsOf(conds, size, premium);
    if (!tags) return;
    const ms = stampMs(f[c.get('trade_timestamp') ?? -1] ?? '');
    if (!Number.isFinite(ms)) return;
    const qms = stampMs(f[c.get('quote_timestamp') ?? -1] ?? '');
    const exp = unq(f[c.get('expiration') ?? -1]).slice(0, 10);
    const strike = num(f[c.get('strike') ?? -1]);
    const right: 1 | -1 = unq(f[c.get('right') ?? -1]).startsWith('C') ? 1 : -1;
    const bid = num(f[c.get('bid') ?? -1]);
    const ask = num(f[c.get('ask') ?? -1]);
    const side = SIDE_CODE[sideAtQuote(price, bid, ask, Number.isFinite(qms) ? ms - qms : 0)];
    const key = `${exp}|${strike}|${right > 0 ? 'C' : 'P'}`;
    const vol = (r.vol.get(key) ?? 0) + size;
    r.vol.set(key, vol);
    /* the contract's interest at the open: a contract the morning's count does not list opened at none */
    const oi = r.oi ? (r.oi.get(key) ?? 0) : -1;
    const opening: 0 | 1 = oi >= 0 && vol > oi ? 1 : 0;
    const minute = Math.floor(ms / 60_000) * 60_000;
    const spot = spotAt(t, minute);
    const otm = spot > 0 ? Math.round(((right > 0 ? strike - spot : spot - strike) / spot) * 10_000) / 100 : null;
    const dte = Math.max(0, dayDiff(exp, t.day));
    const bits = tagBits(tags);
    const type = primaryOf(tags);
    let mix = t.mix.get(type);
    if (!mix) t.mix.set(type, (mix = [type, 0, 0, 0, 0, 0]));
    mix[side > 0 ? 1 : side < 0 ? 2 : 3] += premium;
    mix[4] += size;
    mix[5] += 1;
    if (premium >= OPTION_PRINT_FLOOR) {
      t.prints.push([ms, exp, strike, right, size, price, Number.isFinite(bid) ? bid : 0, Number.isFinite(ask) ? ask : 0, side, bits, otm, dte, opening, vol, oi, t.seq++]);
    } else if (side !== 0 && opening) {
      const otmBit = otm == null ? -1 : otm > 0 ? 1 : 0;
      const db = dteBucket(dte);
      const ck = `${minute}|${bits}|${side}|${right}|${otmBit}|${db}`;
      let cell = t.cells.get(ck);
      if (!cell) {
        cell = [minute, bits, side, right, otmBit, db, 0, 0, 0];
        t.cells.set(ck, cell);
        t.cellList.push(cell);
      }
      cell[6] += 1;
      cell[7] += size;
      cell[8] += premium;
    }
    taken++;
  });
  return taken;
}

/* ---- the stock tape ------------------------------------------------------------------------------------------ */

/** One mark: [ms, price, size, venue, kind (0 off-exchange, 1 a block on an exchange, 2 an off-exchange block), side,
    the bid and the ask in force (0 when none)] */
export type StockMarkRow = [number, number, number, number, 0 | 1 | 2, number, number, number];
/** The session's volume at a venue: [venue, shares, prints] */
export type VenueRow = [number, number, number];

export interface StockTapeWire {
  format: typeof TAPE_FORMAT;
  kind: 'stock';
  ticker: string;
  day: string;
  open: number;
  close: number;
  through: number;
  complete: boolean;
  live: boolean;
  /** Today's prints run fifteen minutes behind the market */
  delayed: boolean;
  /** An index: there are no stock prints */
  index: boolean;
  fault: string | null;
  venues: VenueRow[];
  shares: number;
  offShares: number;
  marks: StockMarkRow[];
}

export interface StockTape {
  kind: 'stock';
  name: string;
  day: string;
  open: number;
  close: number;
  through: number;
  venues: Map<number, VenueRow>;
  shares: number;
  offShares: number;
  marks: StockMarkRow[];
  asked: number;
  running: boolean;
  fault: string | null;
  retryAt: number;
  saved: boolean;
}

const CONDITION_KEYS = ['condition', 'ext_condition1', 'ext_condition2', 'ext_condition3', 'ext_condition4', 'size', 'price'] as const;
const rowOf = (f: string[], c: Map<string, number>): Record<string, unknown> => Object.fromEntries(CONDITION_KEYS.map(k => [k, f[c.get(k) ?? -1] ?? '']));

/** An empty stock tape for a name's session */
export function newStockTape(name: string, day: string, open: number, close: number): StockTape {
  return { kind: 'stock', name, day, open, close, through: open, venues: new Map(), shares: 0, offShares: 0, marks: [], asked: 0, running: false, fault: null, retryAt: 0, saved: false };
}

/** Stock prints with the quote at each (the /stock/history/trade_quote CSV shape), into the tape */
export function ingestStock(t: StockTape, csv: string): number {
  let taken = 0;
  eachCsvRow(csv, (f, c) => {
    const conds = ['condition', 'ext_condition1', 'ext_condition2', 'ext_condition3', 'ext_condition4'].map(k => num(f[c.get(k) ?? -1])).filter(Number.isFinite);
    const size = num(f[c.get('size') ?? -1]);
    const price = num(f[c.get('price') ?? -1]);
    const venue = num(f[c.get('exchange') ?? -1]);
    const read = stockPrintOf(conds, venue, size, price);
    if (!read || !read.counts) return;
    const ms = stampMs(f[c.get('trade_timestamp') ?? -1] ?? '');
    if (!Number.isFinite(ms)) return;
    let v = t.venues.get(venue);
    if (!v) t.venues.set(venue, (v = [venue, 0, 0]));
    v[1] += size;
    v[2] += 1;
    t.shares += size;
    if (read.off) t.offShares += size;
    const notional = size * price;
    /* a mark sits at its price on the chart: only a print that may set the price (not an average-price, prior-reference
       or late report, whose price is not the market's at that minute — data/thetaEligible.ts) */
    if ((read.block || (read.off && notional >= DARK_MARK_NOTIONAL)) && printSetsPrice(rowOf(f, c))) {
      const qms = stampMs(f[c.get('quote_timestamp') ?? -1] ?? '');
      const bid = num(f[c.get('bid') ?? -1]);
      const ask = num(f[c.get('ask') ?? -1]);
      const side = SIDE_CODE[sideAtQuote(price, bid, ask, Number.isFinite(qms) ? ms - qms : 0)];
      t.marks.push([ms, price, size, venue, read.off ? (read.block ? 2 : 0) : 1, side, bid > 0 ? bid : 0, ask > 0 ? ask : 0]);
    }
    taken++;
  });
  return taken;
}

/* ---- the reader ---------------------------------------------------------------------------------------------- */

export interface Tapes {
  options: (ticker: string, since: number) => OptionTapeWire | null;
  stock: (ticker: string, since: number) => StockTapeWire | null;
  stats: () => { reads: number; readsLastMinute: number; byKind: Record<string, number>; tapes: string[]; inFlight: number };
  stop: () => void;
}

const hhmm = (ms: number, end = false) => {
  const w = nyWall(ms);
  const sec = Math.floor((ms % 60_000) / 1000);
  const base = `${String(Math.floor(w.min / 60)).padStart(2, '0')}:${String(w.min % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return end ? `${base}.999` : base;
};
const ymd = (day: string) => day.replace(/-/g, '');
/** A window's request bounds: [from, to) as the terminal's inclusive start and end times */
const span = (from: number, to: number) => `start_time=${hhmm(from)}&end_time=${hhmm(to - 1000, true)}`;

/** The session a tape covers: the last regular session that has opened by now */
export function tapeDay(now: number): string {
  return sessionAt(now, 'equity').lastRegular;
}

/** A product's regular window on a day: [from, to] */
export function regularWindow(day: string, product: Parameters<typeof windowAt>[1]): { from: number; to: number } | null {
  const w = windowAt(nyInstant(day, 600), product);
  return w && w.kind === 'regular' ? { from: w.from, to: w.to } : null;
}

export function startTapes(o: TapeOptions): Tapes {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => undefined);
  const reading = o.read !== false;
  const opts = new Map<string, OptionTape>();
  const stocks = new Map<string, StockTape>();
  const readTimes: number[] = [];
  const byKind: Record<string, number> = {};
  let total = 0;

  /* the gate: TAPE_READS at once, live windows first, the second read only with room on the terminal */
  let inFlight = 0;
  const waiting: { live: boolean; go: () => void }[] = [];
  const pump = () => {
    while (waiting.length && inFlight < TAPE_READS) {
      if (inFlight >= 1 && o.slots && !roomForRead(o.slots())) return;
      const i = waiting.findIndex(w => w.live);
      const next = waiting.splice(i >= 0 ? i : 0, 1)[0];
      inFlight++;
      next.go();
    }
  };
  const roomTimer = setInterval(pump, 250);
  const read = async (p: string, kind: string, live: boolean): Promise<string | null> => {
    await new Promise<void>(go => {
      waiting.push({ live, go });
      pump();
    });
    try {
      total++;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      readTimes.push(now());
      while (readTimes.length && readTimes[0] < now() - 60_000) readTimes.shift();
      const got = await o.theta(p);
      if (got.status === 472) return '';
      if (got.status !== 200) {
        const code = /"code":"([a-z_]+)"/.exec(String(got.body).slice(0, 300))?.[1];
        throw new Error(code ?? `status ${got.status}`);
      }
      return String(got.body);
    } finally {
      inFlight--;
      pump();
    }
  };

  const fileOf = (day: string, name: string, kind: string) => path.join(o.dir, day, `${name.replace(/[^A-Z0-9.]/g, '')}.${kind}.json.gz`);
  const save = (day: string, name: string, kind: string, body: unknown) => {
    try {
      const f = fileOf(day, name, kind);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(`${f}.tmp`, gzipSync(JSON.stringify(body)));
      fs.renameSync(`${f}.tmp`, f);
    } catch (e) {
      log(`[tape] ${name} ${day} ${kind}: not kept (${e instanceof Error ? e.message : e})`);
    }
  };
  const load = <T>(day: string, name: string, kind: string): T | null => {
    try {
      const body = JSON.parse(gunzipSync(fs.readFileSync(fileOf(day, name, kind))).toString('utf8')) as { format?: number };
      return body.format === TAPE_FORMAT ? (body as T) : null;
    } catch {
      return null;
    }
  };

  const evict = <T extends { asked: number; running: boolean }>(m: Map<string, T>) => {
    while (m.size > MAX_TAPES) {
      let oldest: string | null = null;
      let at = Infinity;
      for (const [k, t] of m) if (!t.running && t.asked < at) [oldest, at] = [k, t.asked];
      if (!oldest) return;
      m.delete(oldest);
    }
  };

  /* ---- the option tape's next step ---- */
  const lastWhole = (close: number, delay = 0) => Math.min(close, Math.floor((now() - delay - LAG_MS) / 60_000) * 60_000);
  const optionLive = (t: OptionTape) => now() < t.close + 60_000 && now() >= t.open;
  const stepOptions = async (t: OptionTape) => {
    const sym = (s: string) => encodeURIComponent(s);
    const d = ymd(t.day);
    /* the open interest each root opened on, first: a print's opening read needs it */
    for (const r of t.roots) {
      if (r.oiTried) continue;
      const csv = await read(`/option/history/open_interest?symbol=${sym(r.root)}&expiration=*&date=${d}&format=csv`, 'oi', false);
      r.oiTried = true;
      r.oi = csv ? readOi(csv) : null;
    }
    const through = optionThrough(t);
    const end = lastWhole(t.close);
    if (end <= through) return;
    /* the newest whole minutes of a session still trading go ahead of any backfill */
    const live = optionLive(t) && end - through <= 2 * 60_000;
    const to = Math.min(end, through + OPTION_WINDOW_MIN * 60_000);
    /* the minute's price: one read of every minute not in hand yet, out to the newest whole minute — so a backfill reads
       it once — and on a live tape again every few minutes (a print takes the newest minute in hand meanwhile) */
    if (t.spotThrough < to && (to - through > 2 * 60_000 || now() - t.spotReadAt >= SPOT_EVERY_MS)) {
      const from = Math.min(t.spotThrough, through);
      const idx = isIndexName(t.name);
      const csv = await read(`/${idx ? 'index' : 'stock'}/history/ohlc?symbol=${sym(t.name)}&start_date=${d}&end_date=${d}&interval=1m&${span(from, end)}&format=csv`, 'spot', live);
      if (csv) ingestSpot(t, csv);
      t.spotThrough = end;
      t.spotReadAt = now();
    }
    /* each root's window (roots behind first); the rows of a root land in time order */
    await Promise.all(
      t.roots.map(async (r, i) => {
        if (r.through >= to) return;
        const from = r.through;
        const csv = await read(`/option/history/trade_quote?symbol=${sym(r.root)}&expiration=*&date=${d}&${span(from, to)}&strike_range=${OPTION_STRIKES}&exclusive=true&format=csv`, 'options', live);
        if (csv) ingestOptions(t, i, csv);
        r.through = to;
      }),
    );
  };

  /* ---- the stock tape's next step ---- */
  const stockToday = (t: StockTape) => t.day === nyWall(now()).iso;
  const stepStock = async (t: StockTape) => {
    const today = stockToday(t);
    const end = lastWhole(t.close, today ? SIP_DELAY_MS : 0);
    if (end <= t.through) return;
    const live = today && end - t.through <= 2 * 60_000;
    const to = Math.min(end, t.through + STOCK_WINDOW_MIN * 60_000);
    const csv = await read(`/stock/history/trade_quote?symbol=${encodeURIComponent(t.name)}&date=${ymd(t.day)}&${span(t.through, to)}&exclusive=true${today ? '&venue=utp_cta' : ''}&format=csv`, 'stock', live);
    if (csv) ingestStock(t, csv);
    t.through = to;
  };

  const optionWire = (t: OptionTape, since: number): OptionTapeWire => {
    const through = optionThrough(t);
    const from = Math.max(since, 0);
    return {
      format: TAPE_FORMAT,
      kind: 'options',
      ticker: t.name,
      day: t.day,
      open: t.open,
      close: t.close,
      through,
      complete: through >= t.close,
      live: optionLive(t) && through < t.close,
      oi: t.roots.every(r => !!r.oi),
      fault: t.fault,
      prints: t.prints.filter(p => p[0] >= from && p[0] < through),
      cells: t.cellList.filter(c => c[0] >= from && c[0] < through),
      mix: PRINT_TYPES.map(k => t.mix.get(k) ?? [k, 0, 0, 0, 0, 0]),
    };
  };
  const stockWire = (t: StockTape, since: number): StockTapeWire => ({
    format: TAPE_FORMAT,
    kind: 'stock',
    ticker: t.name,
    day: t.day,
    open: t.open,
    close: t.close,
    through: t.through,
    complete: t.through >= t.close,
    live: stockToday(t) && t.through < t.close,
    delayed: stockToday(t),
    index: false,
    fault: t.fault,
    venues: [...t.venues.values()].sort((a, b) => b[1] - a[1]),
    shares: t.shares,
    offShares: t.offShares,
    marks: t.marks.filter(m => m[0] >= since && m[0] < t.through),
  });

  /* a step at a time per tape, back to back while each moves the tape on (a backfill runs through, a live tape stops at
     the newest whole minute); failures backed off; a finished past day is kept on disk */
  const run = async <T extends OptionTape | StockTape>(t: T, step: (t: T) => Promise<void>, done: () => boolean, wire: () => unknown, reach: () => number) => {
    if (t.running || now() < t.retryAt) return;
    t.running = true;
    try {
      for (;;) {
        const before = reach();
        await step(t);
        if (done() || reach() === before || now() - t.asked >= IDLE_MS) break;
      }
      t.fault = null;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      t.fault = /terminal_down|terminal_unavailable|terminal_login|session_lost/.test(why) ? 'the market data terminal is not answering' : 'the read did not land';
      t.retryAt = now() + BACKOFF_MS;
      log(`[tape] ${t.name} ${t.day} ${t.kind}: ${why}`);
    } finally {
      t.running = false;
    }
    if (done() && !t.saved && t.day < nyWall(now()).iso) {
      t.saved = true;
      save(t.day, t.name, t.kind, wire());
      log(`[tape] ${t.name} ${t.day} ${t.kind}: kept`);
    }
  };

  const tick = () => {
    if (!reading) return;
    const at = now();
    for (const t of opts.values()) if (at - t.asked < IDLE_MS && optionThrough(t) < t.close) void run(t, stepOptions, () => optionThrough(t) >= t.close, () => optionWire(t, 0), () => optionThrough(t));
    for (const t of stocks.values()) if (at - t.asked < IDLE_MS && t.through < t.close) void run(t, stepStock, () => t.through >= t.close, () => stockWire(t, 0), () => t.through);
  };
  const timer = setInterval(tick, TICK_MS);

  /* a kept day comes back as a frozen tape: the rows as the wire had them */
  const restoreOptions = (w: OptionTapeWire): OptionTape => {
    const t = newOptionTape(w.ticker, w.day, w.open, w.close);
    for (const r of t.roots) {
      r.through = w.through;
      r.oiTried = true;
      r.oi = w.oi ? new Map() : null;
    }
    t.prints = w.prints;
    t.cellList = w.cells;
    t.mix = new Map(w.mix.map(m => [m[0], m]));
    t.saved = true;
    return t;
  };
  const restoreStock = (w: StockTapeWire, t: StockTape): StockTape => {
    t.through = w.through;
    t.venues = new Map(w.venues.map(v => [v[0], v]));
    t.shares = w.shares;
    t.offShares = w.offShares;
    t.marks = w.marks;
    t.saved = true;
    return t;
  };

  return {
    options(ticker, since) {
      const name = ticker.toUpperCase();
      const day = tapeDay(now());
      if (!isSessionDay(day)) return null;
      const win = regularWindow(day, productOf(name, true));
      if (!win) return null;
      const key = `${name}|${day}`;
      let t = opts.get(key);
      if (!t) {
        const kept = load<OptionTapeWire>(day, name, 'options');
        t = kept ? restoreOptions(kept) : newOptionTape(name, day, win.from, win.to);
        opts.set(key, t);
        evict(opts);
      }
      const first = t.asked === 0;
      t.asked = now();
      if (first) tick();
      return optionWire(t, since);
    },
    stock(ticker, since) {
      const name = ticker.toUpperCase();
      const day = tapeDay(now());
      if (!isSessionDay(day)) return null;
      const win = regularWindow(day, 'equity');
      if (!win) return null;
      if (isIndexName(name)) {
        return { format: TAPE_FORMAT, kind: 'stock', ticker: name, day, open: win.from, close: win.to, through: win.to, complete: true, live: false, delayed: false, index: true, fault: null, venues: [], shares: 0, offShares: 0, marks: [] };
      }
      const key = `${name}|${day}`;
      let t = stocks.get(key);
      if (!t) {
        t = newStockTape(name, day, win.from, win.to);
        const kept = load<StockTapeWire>(day, name, 'stock');
        if (kept) restoreStock(kept, t);
        stocks.set(key, t);
        evict(stocks);
      }
      const first = t.asked === 0;
      t.asked = now();
      if (first) tick();
      return stockWire(t, since);
    },
    stats: () => ({
      reads: total,
      readsLastMinute: readTimes.filter(x => x >= now() - 60_000).length,
      byKind: { ...byKind },
      tapes: [...[...opts.values()].map(t => `options ${t.name} ${t.day} through ${hhmm(optionThrough(t))}`), ...[...stocks.values()].map(t => `stock ${t.name} ${t.day} through ${hhmm(t.through)}`)],
      inFlight,
    }),
    stop() {
      clearInterval(timer);
      clearInterval(roomTimer);
    },
  };
}

/* ---- the route ----------------------------------------------------------------------------------------------- */

type Req = { url?: string; method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string | Buffer) => void };
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

/** GET /api/tape/options?ticker=SPY&since=<ms> · /api/tape/stock?ticker=SPY&since=<ms> · /api/tape/__stats */
export function tapeRoute(tapes: Tapes, req: Req, res: Res): void {
  const url = new URL(req.url || '/', 'http://local');
  const leaf = url.pathname.replace(/^\/api\/tape/, '').replace(/^\/+/, '');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'application/json');
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    const text = JSON.stringify(body);
    if (text.length > 4096 && String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
      res.setHeader('content-encoding', 'gzip');
      res.end(gzipSync(text));
    } else res.end(text);
  };
  if (leaf === '__stats') {
    if (process.env.VERCEL_ENV === 'production') return send(404, { error: 'not found' });
    return send(200, tapes.stats());
  }
  const t = String(url.searchParams.get('ticker') ?? '').trim().toUpperCase();
  const since = Number(url.searchParams.get('since') ?? 0);
  if (!TICKER.test(t) || (leaf !== 'options' && leaf !== 'stock')) return send(400, { error: 'ask /api/tape/options or /api/tape/stock with a ticker' });
  const wire = leaf === 'options' ? tapes.options(t, Number.isFinite(since) ? since : 0) : tapes.stock(t, Number.isFinite(since) ? since : 0);
  if (!wire) return send(404, { error: 'no session to read', code: 'no_session' });
  send(200, wire);
}
