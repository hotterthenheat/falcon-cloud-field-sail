/* What a print was, read off its trade conditions, and which side of the quote it took. Pure — no fetch, no clock, no
   React — so the server's tapes (data/tapeServer.ts), the browser's stores and the proofs share one rule.

   OPTION PRINTS (OPRA conditions; ThetaData's Trade Conditions table, every code checked against it on 2026-10-31):
   - sweep:      95 INTERMARKET_SWEEP, 126 SINGLE_LEG_AUCTION_ISO, 128 SINGLE_LEG_CROSS_ISO
   - spread leg: 130–144, every multi-leg family (130 MULTI_LEG_AUTOELEC_TRADE … 144 ML_FLOOR_TRADE_OF_PP; 135 and
                 138–143 are stock-option orders, the option leg of a package). A leg is half of a structure, not a bet.
   - floor:      129 SINGLE_LEG_FLOOR_TRADE, 133 MULTI_LEG_FLOOR_TRADE, and the table's other floor executions 137
                 ML_FLOOR_TRADE_AGSL, 140 STOCK_OPTIONS_FLOOR_TRADE, 143 STK_OPT_FLOOR_TRADE_AGSL, 144 ML_FLOOR_TRADE_OF_PP
                 ("non-electronic … executed on a trading floor"). On SPX's own root 137 and 144 carry most of the floor.
   - block:      OPRA has no block condition: a block is size in one print, the tape's own line (data/tape.ts
                 isBlockSized: 100 contracts and $50K, both)
   - single:     none of the above
   - 40–44 cancel a print that was reported: never counted.
   A print can be more than one (a floor package's leg is a leg and a floor print); `primaryOf` names it once, legs first.

   STOCK PRINTS (UTP and CTA):
   - off-exchange: the trade-reporting facilities (57 FINRA/Nasdaq TRF, 58 the BSE TRF, 59 FINRA/NYSE TRF) and 2 the
     FINRA ADF — where dark pools and internalisers report
   - block: the block conditions 14 RULE_127, 29 RULE_155, 75 BLOCK_TRADE, or size (STOCK_BLOCK_SHARES, or
     STOCK_BLOCK_NOTIONAL)
   - volume: every print but the cancels and the codes the table marks as adding no volume

   THE SIDE is the print against the quote in force just before it (the read asks for the strictly earlier quote): at
   or above the ask a buyer, at or below the bid a seller, and inside the spread within a fifth of either side that
   side — the tape's own rule (data/traceRows.ts execOf, NEAR_SIDE 0.8). A crossed or locked quote, a missing one, or one
   older than five minutes gives no read. */

export type PrintType = 'sweep' | 'leg' | 'floor' | 'block' | 'single';
export const PRINT_TYPES: readonly PrintType[] = ['sweep', 'leg', 'floor', 'block', 'single'];
export type Side = 'ASK' | 'BID' | 'MID';

export const CANCEL_CODES: ReadonlySet<number> = new Set([40, 41, 42, 43, 44]);
export const SWEEP_CODES: ReadonlySet<number> = new Set([95, 126, 128]);
export const LEG_CODES: ReadonlySet<number> = new Set([130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144]);
export const FLOOR_CODES: ReadonlySet<number> = new Set([129, 133, 137, 140, 143, 144]);

/** The tape's block line (data/tape.ts BLOCK_MIN_SIZE / BLOCK_MIN_PREMIUM), restated so the server needs no browser module */
export const OPTION_BLOCK_SIZE = 100;
export const OPTION_BLOCK_PREMIUM = 50_000;

/** Tag bits, as the wire carries them */
export const TAG_SWEEP = 1;
export const TAG_LEG = 2;
export const TAG_FLOOR = 4;
export const TAG_BLOCK = 8;

export interface OptionTags {
  sweep: boolean;
  leg: boolean;
  floor: boolean;
  block: boolean;
}

/** The tags of one option print from its condition slots (255 is an empty slot); null for a cancel */
export function optionTagsOf(conds: readonly number[], size: number, premium: number): OptionTags | null {
  let sweep = false;
  let leg = false;
  let floor = false;
  for (const c of conds) {
    if (CANCEL_CODES.has(c)) return null;
    if (SWEEP_CODES.has(c)) sweep = true;
    if (LEG_CODES.has(c)) leg = true;
    if (FLOOR_CODES.has(c)) floor = true;
  }
  /* a leg's size is one side of a package: never a block on its own */
  const block = !leg && size >= OPTION_BLOCK_SIZE && premium >= OPTION_BLOCK_PREMIUM;
  return { sweep, leg, floor, block };
}

export const tagBits = (t: OptionTags): number => (t.sweep ? TAG_SWEEP : 0) | (t.leg ? TAG_LEG : 0) | (t.floor ? TAG_FLOOR : 0) | (t.block ? TAG_BLOCK : 0);
export const tagsOfBits = (b: number): OptionTags => ({ sweep: !!(b & TAG_SWEEP), leg: !!(b & TAG_LEG), floor: !!(b & TAG_FLOOR), block: !!(b & TAG_BLOCK) });

/** One name for a print: a leg first (it is not a bet whatever else it is), then the floor, a sweep, a block */
export function primaryOf(t: OptionTags): PrintType {
  if (t.leg) return 'leg';
  if (t.floor) return 'floor';
  if (t.sweep) return 'sweep';
  if (t.block) return 'block';
  return 'single';
}

/** Does a print belong to a type — by any of its tags, so a floor package's leg is in both Floor and Spread legs */
export function hasType(t: OptionTags, type: PrintType): boolean {
  if (type === 'single') return !t.sweep && !t.leg && !t.floor && !t.block;
  return t[type];
}

export const TYPE_WORDS: Record<PrintType, { label: string; short: string; one: string }> = {
  sweep: { label: 'Sweep', short: 'swp', one: 'sweep' },
  leg: { label: 'Spread legs', short: 'legs', one: 'spread leg' },
  floor: { label: 'Floor', short: 'flr', one: 'floor print' },
  block: { label: 'Block', short: 'blk', one: 'block' },
  single: { label: 'Single', short: '1-leg', one: 'single' },
};

/** A quote older than this at the print gives no read (data/traceRows.ts STALE_QUOTE_MS) */
export const STALE_QUOTE_MS = 5 * 60_000;
/** Inside the spread, this far toward a side counts to it (data/traceRows.ts NEAR_SIDE) */
export const NEAR_SIDE = 0.8;

/** The side a print took against the quote before it; `quoteAgeMs` is the trade's stamp less the quote's */
export function sideAtQuote(price: number, bid: number, ask: number, quoteAgeMs = 0): Side {
  if (!(price > 0) || !(bid > 0) || !(ask > 0)) return 'MID';
  if (bid >= ask) return 'MID';
  if (quoteAgeMs > STALE_QUOTE_MS) return 'MID';
  if (price >= ask - 1e-6) return 'ASK';
  if (price <= bid + 1e-6) return 'BID';
  const pos = (price - bid) / (ask - bid);
  return pos >= NEAR_SIDE - 1e-9 ? 'ASK' : pos <= 1 - NEAR_SIDE + 1e-9 ? 'BID' : 'MID';
}
export const SIDE_CODE: Record<Side, number> = { ASK: 1, BID: -1, MID: 0 };
export const sideOfCode = (n: number): Side => (n > 0 ? 'ASK' : n < 0 ? 'BID' : 'MID');

/* ---- stock prints ---------------------------------------------------------------------------------------------- */

export const OFF_EXCHANGE: ReadonlySet<number> = new Set([2, 57, 58, 59]);
export const STOCK_BLOCK_CODES: ReadonlySet<number> = new Set([14, 29, 75]);
/** Codes the table marks as adding no volume, beside the cancels: halts, detail of an earlier report, official
    open/close and settlement values, corrections, ranges and nominal prices. The markers that ride regular prints in
    the extra slots (107, 108, 50, 90–94 …) are not reasons and do not count here. */
export const NO_VOLUME_CODES: ReadonlySet<number> = new Set([19, 26, 27, 48, 49, 51, 56, 57, 61, 64, 66, 68, 69, 70, 72, 73, 74, 84, 85, 117]);
/** A block by size: ten thousand shares, the classic line */
export const STOCK_BLOCK_SHARES = 10_000;
/** …or by money, for a name whose ten thousand shares are small change */
export const STOCK_BLOCK_NOTIONAL = 5_000_000;
/** An off-exchange print is marked from this much money */
export const DARK_MARK_NOTIONAL = 1_000_000;

export interface StockPrintRead {
  /** adds to the session's volume */
  counts: boolean;
  off: boolean;
  block: boolean;
}

/** One stock print: does it count, was it off-exchange, was it a block; null for a cancel */
export function stockPrintOf(conds: readonly number[], exchange: number, size: number, price: number): StockPrintRead | null {
  let counts = size > 0 && price > 0;
  let blockCode = false;
  for (const c of conds) {
    if (CANCEL_CODES.has(c)) return null;
    if (NO_VOLUME_CODES.has(c)) counts = false;
    if (STOCK_BLOCK_CODES.has(c)) blockCode = true;
  }
  const notional = size * price;
  return { counts, off: OFF_EXCHANGE.has(exchange), block: counts && (blockCode || size >= STOCK_BLOCK_SHARES || notional >= STOCK_BLOCK_NOTIONAL) };
}

/** The venues by their code (ThetaData's Exchanges table; the stock venues and the reporting facilities), named the way
    a desk names them. An unknown code is shown as its number. */
export const VENUES: Record<number, { short: string; name: string; off?: boolean }> = {
  1: { short: 'NSDQ', name: 'Nasdaq' },
  2: { short: 'ADF', name: 'FINRA ADF', off: true },
  3: { short: 'NYSE', name: 'NYSE' },
  4: { short: 'AMEX', name: 'NYSE American' },
  7: { short: 'ARCA', name: 'NYSE Arca' },
  8: { short: 'NSX', name: 'NYSE National' },
  9: { short: 'PSX', name: 'Nasdaq PSX' },
  11: { short: 'BX', name: 'Nasdaq BX' },
  17: { short: 'CHX', name: 'NYSE Chicago' },
  43: { short: 'MIAX', name: 'MIAX Pearl' },
  47: { short: 'NQBX', name: 'Nasdaq Boston' },
  57: { short: 'TRF·Q', name: 'Nasdaq TRF', off: true },
  58: { short: 'TRF·B', name: 'BSE TRF', off: true },
  59: { short: 'TRF·N', name: 'NYSE TRF', off: true },
  60: { short: 'BZX', name: 'Cboe BZX' },
  63: { short: 'BYX', name: 'Cboe BYX' },
  64: { short: 'EDGA', name: 'Cboe EDGA' },
  65: { short: 'EDGX', name: 'Cboe EDGX' },
  68: { short: 'IEX', name: 'IEX' },
  73: { short: 'MEMX', name: 'MEMX' },
  75: { short: 'LTSE', name: 'LTSE' },
  77: { short: '24X', name: '24X' },
  78: { short: 'TXSE', name: 'Texas SE' },
};
export const venueOf = (code: number): { short: string; name: string; off: boolean } => {
  const v = VENUES[code];
  return v ? { short: v.short, name: v.name, off: !!v.off || OFF_EXCHANGE.has(code) } : { short: `#${code}`, name: `Venue ${code}`, off: OFF_EXCHANGE.has(code) };
};

/* ---- the CSV the reads answer ------------------------------------------------------------------------------------ */

/** Column indexes of a CSV head, by name */
export function csvColumns(head: string): Map<string, number> {
  const m = new Map<string, number>();
  head.split(',').forEach((h, i) => m.set(h.trim().replace(/"/g, ''), i));
  return m;
}

/** Walk a CSV answer's rows without holding a split copy of the whole body: `each` gets the fields of one row */
export function eachCsvRow(csv: string, each: (f: string[], cols: Map<string, number>) => void): number {
  const first = csv.indexOf('\n');
  if (first < 0) return 0;
  const cols = csvColumns(csv.slice(0, first).replace(/\r$/, ''));
  let at = first;
  let n = 0;
  while (at < csv.length) {
    const end = csv.indexOf('\n', at + 1);
    let line = csv.slice(at + 1, end < 0 ? csv.length : end);
    at = end < 0 ? csv.length : end;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) continue;
    each(line.split(','), cols);
    n++;
  }
  return n;
}

/** "2026-10-30T15:00:02.507" as New York wall-clock parts (the terminal stamps in New York time) */
export function stampParts(s: string): { date: string; minute: number; ms: number } | null {
  const m = /^"?(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s);
  if (!m) return null;
  const minute = Number(m[2]) * 60 + Number(m[3]);
  const ms = Number(m[4]) * 1000 + (m[5] ? Number(m[5].padEnd(3, '0')) : 0);
  return { date: m[1], minute, ms };
}
