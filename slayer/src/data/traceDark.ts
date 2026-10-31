/* Dark-pool and lit prints: one vendor print as a cross with its read, a name's shelves, and its posture. */

import type { DarkPoolIntent, DarkPoolLevel, DarkPoolPrint, DarkPoolView, LevelRole, Posture } from '../types/darkpool';
import { postureOfNet } from './traceLean';
import { advUsdOf, clock, execOf, hashId, num, nyDateOf, SESSION_OPEN } from './traceRows';


/* The dark-pool read, one rule across Trace: a sized regular-session print over the mid was paid up (accumulation),
   under it sold down (distribution), at the mid neither. Only sized prints at the quote carry a read. */
/** A sized cross is dollars, not shares: $250K and up carries a read, below it none. This is the floor for every name;
    a name whose average day is known needs a second of that day (darkSizedFloor). */
export const DARK_SIZED_USD = 250_000;
/** Seconds in the regular session (09:30–16:00) */
const SESSION_SECONDS = 23_400;
/** The sized line for a name: one second of its average day's dollar volume (avg30 shares × price over 23,400 s), never
    under DARK_SIZED_USD — $250K is a block on a $50M-a-day name and noise on NVDA's ~$36B day (its line is ~$1.5M) */
export function darkSizedFloor(advUsd: number | null | undefined): number {
  return advUsd != null && advUsd > 0 ? Math.max(DARK_SIZED_USD, advUsd / SESSION_SECONDS) : DARK_SIZED_USD;
}
/** Fewer read prints than this is too few to call buying or selling, on every page */
export const DARK_MIN_PRINTS = 12;
export function intentOf(cents: number, sized: boolean): DarkPoolIntent {
  if (!sized) return 'ROTATION';
  if (cents > 0) return 'ACCUMULATION';
  if (cents < 0) return 'DISTRIBUTION';
  return 'HEDGE FLOW';
}

/** Where a dark print sat against the quote. Two decimals of percent is 0.00%
    on a fill a few cents through a tight spread, which is most of this tape. */
export function quotePlace(pct: number, price: number): { text: string; cents: number } {
  const cents = (pct / 100) * price * 100;
  /* a quarter cent, not a half: on a one-cent spread the bid is half a cent under the mid */
  if (!Number.isFinite(cents) || Math.abs(cents) < 0.25) return { text: 'at the mid', cents: 0 };
  /* one unit, cents */
  const abs = Math.abs(cents);
  const n = abs >= 10 ? Math.round(abs).toLocaleString('en-US') : (Math.round(abs * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return { text: `${cents > 0 ? '+' : '−'}${n}¢`, cents };
}

/** Where a cross printed in the read's own terms: at the ask, on the bid, or inside as MID (within ¼¢) / UNDER MID /
    OVER MID. */
export function execWord(p: { exec?: 'ASK' | 'BID' | 'MID' | null; vsSpotPct: number; price: number }): string | null {
  if (!p.exec) return null;
  if (p.exec !== 'MID') return p.exec;
  const c = quotePlace(p.vsSpotPct, p.price).cents;
  return c === 0 ? 'MID' : c > 0 ? 'OVER MID' : 'UNDER MID';
}

/* The vendor's market_center is the FINRA facility the print was reported to; the dark venue itself is not
   disclosed. */
export const FACILITY: Record<string, string> = { L: 'FINRA/Nasdaq TRF Carteret', '2': 'FINRA/Nasdaq TRF Chicago', N: 'FINRA/NYSE TRF', D: 'FINRA ADF', B: 'FINRA/Nasdaq TRF' };
export const SPECIAL_WORD: Record<string, string> = {
  average_price_trade: 'average-price trade',
  contingent_trade: 'contingent trade',
  qualified_contingent_trade: 'qualified contingent trade',
  derivative_priced: 'derivative-priced trade',
  prior_reference_price: 'prior-reference-price trade',
  stopped_stock: 'stopped-stock trade',
  /* Auction prints (opening and closing crosses, official open and close) carry no side and no read. */
  cross_trade: 'auction cross',
  opening_print: 'opening-auction print',
  closing_print: 'closing-auction print',
  reopening_print: 'reopening-auction print',
  nasdaq_official_close_price: 'official closing price',
  nasdaq_official_opening_price: 'official opening price',
  official_close_price: 'official closing price',
  official_open_price: 'official opening price',
};
/** The auction codes among SPECIAL_WORD — read as "priced in the auction", not "by its terms" */
export const AUCTION_CODES = new Set(['cross_trade', 'opening_print', 'closing_print', 'reopening_print', 'nasdaq_official_close_price', 'nasdaq_official_opening_price', 'official_close_price', 'official_open_price']);

/** The vendor's ext_hour_sold_codes names an extended-hours sale — any other non-empty code is not one */
function extHour(raw: unknown): boolean {
  const codes = Array.isArray(raw) ? raw.map(String) : raw != null && raw !== '' ? [String(raw)] : [];
  return codes.some(c => /extended/i.test(c));
}

export function darkPrint(row: Record<string, unknown>, i: number, spot = 0, kind: 'dark' | 'lit' = 'dark'): DarkPoolPrint {
  const price = num(row.price);
  const size = num(row.size);
  const notional = num(row.premium) || price * size;
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : spot;
  const vs = mid > 0 ? ((price - mid) / mid) * 100 : 0;
  /* A print priced by its own terms (contingent, average-price, derivative-priced, any sale condition) is shown,
     never read for intent or posture */
  const codes = [row.sale_cond_codes, row.trade_code].flatMap(c => (Array.isArray(c) ? c : [c])).filter(c => c != null && c !== '').map(String);
  /* only the codes that price a trade by its own terms — an intermarket sweep or an odd lot is priced at the quote */
  const own = codes.filter(c => c in SPECIAL_WORD);
  /* an auction print names its auction ("closing-auction print"), not the generic cross word beside it */
  const ownWords = [...new Set((own.some(c => AUCTION_CODES.has(c) && c !== 'cross_trade') ? own.filter(c => c !== 'cross_trade') : own).map(c => SPECIAL_WORD[c]))];
  const special = ownWords.length ? ownWords.join(', ') : null;
  const auction = own.some(c => AUCTION_CODES.has(c));
  const sized = notional >= DARK_SIZED_USD;
  /* Stocks: regular is 09:30–16:00. A print in that window is regular even when the vendor sets an extended-hours
     code on a late regular print — it is not after hours. Before the open and from 16:00 it is extended, flag or not. */
  const when = clock(row.executed_at);
  const m = when.minute;
  const flaggedExt = extHour(row.ext_hour_sold_codes);
  /* a missing clock is minute 0 with no epoch — that is not midnight, so only then does the vendor flag decide */
  const extended = when.ms > 0 ? m < SESSION_OPEN || m >= 960 : flaggedExt;
  const premarket = when.ms > 0 && m < SESSION_OPEN;
  const placeCents = quotePlace(vs, price).cents;
  const intent = special || extended ? 'ROTATION' : intentOf(placeCents, sized);
  /* an after-hours print's place in a thin quote is drawn neutral, never as a side; `exec` still says where it sat */
  const exec = special ? null : execOf(price, bid, ask);
  /* the vendor's tracking_id is NOT unique — distinct prints (other sizes, other cumulative volumes) share one — so the
     id folds in the fields that tell them apart; stable across polls, so the accumulator still de-dupes repeats */
  /* with no tracking id, the print's content — never its place on the page, which repeats it under two ids across pages */
  void i;
  const id = hashId(row.tracking_id != null ? `${row.tracking_id}-${row.executed_at}-${row.size}-${row.price}-${row.volume}` : `${row.ticker}-${row.executed_at}-${row.size}-${row.price}-${row.volume}-${row.premium}`);
  const place = quotePlace(vs, price);
  const where = place.cents === 0 ? 'at the mid' : place.cents > 0 ? `${place.text.slice(1)} over the mid` : `${place.text.slice(1)} under the mid`;
  const read = special
    ? auction
      ? `${/^[aeiou]/i.test(special) ? 'An' : 'A'} ${special} — priced in the auction, not against the quote; no read.`
      : `${/^[aeiou]/i.test(special) ? 'An' : 'A'} ${special} — priced by its terms, not the quote; no read.`
    : extended
      ? premarket
        ? `Before the open, ${where} of a premarket quote — no read.`
        : `After hours, ${where} of a post-market quote — no read.`
      : sized
        ? place.cents > 0
          ? `Size paid ${where} — buyer-initiated.`
          : place.cents < 0
            ? `Size sold ${where} — seller-initiated.`
            : 'Size crossed at the mid — neither side pressed.'
        : `Printed ${where} — too small to read.`;
  const center = String(row.market_center || '');
  return {
    id,
    time: when.time,
    epochMs: when.ms || undefined,
    dateIso: when.ms ? nyDateOf(when.ms) : undefined,
    auction: auction || undefined,
    ticker: String(row.ticker || '').toUpperCase(),
    price,
    size,
    notional,
    /* a lit print is an exchange's, never a FINRA facility's */
    venue: kind === 'lit' ? (center ? `exchange ${center}` : 'an exchange') : FACILITY[center] ?? (center ? `FINRA facility ${center}` : 'off-exchange'),
    vsSpotPct: vs,
    atLevel: false,
    sized: sized && !special,
    extended: extended || undefined,
    intent,
    conviction: 0,
    read,
    exec,
    bid: bid > 0 ? bid : null,
    ask: ask > 0 ? ask : null,
    special,
    facility: kind === 'lit' ? undefined : FACILITY[center] ?? undefined,
    lit: kind === 'lit' || undefined,
  };
}

/* A price the lit tape never traded is not a shelf: such a bucket holds only own-terms prints, so it is counted
   apart, out of the shelves and the day's dark dollars. */
export const offMarketBucket = (r: Record<string, unknown>) => num(r.dark_pool_volume) > 0 && r.regular_volume != null && num(r.regular_volume) === 0;

export function darkLevels(allRows: Record<string, unknown>[], spot: number, allPrints: DarkPoolPrint[] = []): DarkPoolLevel[] {
  const rows = allRows.filter(r => !offMarketBucket(r));
  /* own-terms prints are priced by their terms, not the market — they never count toward a shelf */
  const prints = allPrints.filter(p => !p.special);
  const buckets = rows.map(r => num(r.price)).filter(p => p > 0);
  /* The route sends shares by price, not a count, so a shelf's count is the dark prints in hand nearest it */
  const count = new Map<number, number>();
  for (const p of prints) {
    let best = NaN;
    for (const b of buckets) if (!Number.isFinite(best) || Math.abs(b - p.price) < Math.abs(best - p.price)) best = b;
    if (Number.isFinite(best) && Math.abs(best - p.price) <= 1) count.set(best, (count.get(best) ?? 0) + 1);
  }
  const raw = rows
    .map(r => ({ price: num(r.price), notional: num(r.dark_pool_volume) * num(r.price) || num(r.dark_pool_volume), prints: count.get(num(r.price)) ?? 0 }))
    .filter(l => l.price > 0 && l.notional > 0)
    .sort((a, b) => b.notional - a.notional);
  const sum = raw.reduce((a, l) => a + l.notional, 0) || 1;
  /* Within a third of a percent of the market is the pivot, beyond it support or resistance. A shelf holds at least
     SHELF_MIN_SHARE of the day's dark dollars within SHELF_MAX_DIST, the heaviest two of each role. */
  const SHELF_MIN_SHARE = 3;
  const SHELF_MAX_DIST = 5;
  const leveled = raw.map(l => {
    const dist = spot > 0 ? ((l.price - spot) / spot) * 100 : 0;
    const role: LevelRole = Math.abs(dist) <= 0.35 ? 'PIVOT' : dist < 0 ? 'SUPPORT' : 'RESISTANCE';
    return {
      price: l.price,
      notional: l.notional,
      prints: l.prints,
      sharePct: (l.notional / sum) * 100,
      role,
      distPct: dist,
      usage: role === 'SUPPORT' ? 'Rested under the market.' : role === 'RESISTANCE' ? 'Rested over the market.' : 'Rested at the market.',
    };
  });
  const take = (role: LevelRole) => leveled.filter(l => l.role === role && l.sharePct >= SHELF_MIN_SHARE && (!(spot > 0) || Math.abs(l.distPct) <= SHELF_MAX_DIST)).slice(0, 2);
  return [...take('SUPPORT'), ...take('RESISTANCE'), ...take('PIVOT')];
}

/** The one dark-pool posture, Trace's and Dossier's alike, over whatever print set the caller holds: the regular-session
    prints priced at the quote and sized for their own name (darkSizedFloor), their dollars over the mid (bought up)
    against under it (sold down). The net is unrounded — 17.6% is Balanced everywhere — and under DARK_MIN_PRINTS read
    prints there is no posture (Balanced, `enough` false). */
export interface DarkPostureRead {
  posture: Posture;
  /** Net of the read dollars over the mid less under it, %, unrounded */
  net: number;
  /** The prints read, and their dollars */
  read: DarkPoolPrint[];
  notional: number;
  bought: number;
  sold: number;
  /** At least DARK_MIN_PRINTS prints were read */
  enough: boolean;
}
export function darkPosture(prints: readonly DarkPoolPrint[], opts: { advUsd?: (ticker: string) => number | null; minPrints?: number } = {}): DarkPostureRead {
  const adv = opts.advUsd ?? advUsdOf;
  const minPrints = opts.minPrints ?? DARK_MIN_PRINTS;
  const read = prints.filter(p => p.intent !== 'ROTATION' && p.sized && !p.extended && !p.special && p.notional >= darkSizedFloor(adv(p.ticker)));
  const bought = read.reduce((a, p) => a + (p.intent === 'ACCUMULATION' ? p.notional : 0), 0);
  const sold = read.reduce((a, p) => a + (p.intent === 'DISTRIBUTION' ? p.notional : 0), 0);
  const notional = read.reduce((a, p) => a + p.notional, 0);
  const net = notional > 0 ? ((bought - sold) / notional) * 100 : 0;
  const enough = read.length >= minPrints;
  return { posture: enough ? postureOfNet(net) : 'BALANCED', net, read, notional, bought, sold, enough };
}

/** The posture of the sized, read prints (darkPosture) with its note */
export function postureOf(prints: DarkPoolPrint[], opts: { advUsd?: (ticker: string) => number | null; minPrints?: number } = {}): { posture: Posture; net: number; note: string; read: number; enough: boolean } {
  const pv = darkPosture(prints, opts);
  const { posture, net, enough } = pv;
  const read = pv.read;
  const after = prints.length > 0 && read.length === 0 && prints.some(p => p.extended);
  const note = after
    ? 'Every print in hand is after hours — set against a post-market quote, so none is read.'
    : read.length && !enough
      ? `Only ${read.length} sized ${read.length === 1 ? 'print' : 'prints'} in the regular session — too few to read.`
    : posture === 'ACCUMULATING'
      ? 'Sized dollars lean over the mid — bought up, buyer-initiated.'
      : posture === 'DISTRIBUTING'
        ? 'Sized dollars lean under the mid — sold down, seller-initiated.'
        : read.length
          ? 'Sized dollars sit on both sides of the mid.'
          : 'No sized print in the regular session to read.';
  /* `read`: how many prints carried a read; none is "nothing to read", never Balanced */
  return { posture, net, note, read: read.length, enough };
}

export function darkView(ticker: string, prints: DarkPoolPrint[], levels: DarkPoolLevel[], spot: number, dpSharePct = 0): DarkPoolView {
  const marked = prints.map(p => ({
    ...p,
    atLevel: levels.some(l => l.price > 0 && Math.abs(l.price - p.price) / l.price < 0.0015),
  }));
  const { posture, net, note } = postureOf(marked);
  const total = marked.reduce((a, p) => a + p.notional, 0);
  const largest = marked.reduce<DarkPoolPrint | null>((a, p) => (!a || p.notional > a.notional ? p : a), null);
  return {
    ticker,
    spot,
    dpSharePct,
    netPosturePct: net,
    posture,
    postureNote: note,
    totalNotional: total,
    levels,
    prints: marked,
    largest,
  };
}

export const DARK_CAP = 2000;

/** Merge a poll into the accumulated prints, newest first, no print twice; `gone` (ids the vendor has since cancelled)
    are taken back out of what was merged */
export function mergeDark(prev0: DarkPoolPrint[], incoming: DarkPoolPrint[], gone?: ReadonlySet<number>): DarkPoolPrint[] {
  const prev = gone?.size ? prev0.filter(r => !gone.has(r.id)) : prev0;
  const seen = new Set(prev.map(r => r.id));
  const fresh = incoming.filter(r => !gone?.has(r.id) && !seen.has(r.id) && (seen.add(r.id), true));
  if (!fresh.length) return prev.length === prev0.length ? prev0 : prev;
  const next = fresh.concat(prev);
  return next.length > DARK_CAP ? next.slice(0, DARK_CAP) : next;
}

/** A name's whole day off-exchange (/darkpool/{t}/price-levels): dark dollars are each bucket's shares at its price
    (≈); the share is dark shares over the day's whole volume from the quote. */
export interface DarkDay {
  /** The session the figures are for, YYYY-MM-DD, when asked by date */
  iso?: string;
  /** Dark shares at prices the lit tape also traded */
  darkShares: number;
  litShares: number;
  /** ≈, priced at each $1 bucket — at-market buckets only */
  darkDollars: number;
  /** Dark shares and ≈dollars at prices the lit tape never traded that day — own-terms prints (offMarketBucket), set apart */
  offShares: number;
  offDollars: number;
  /** Dark shares over the day's whole volume, 0–100; NaN when the day's volume is not to hand */
  sharePct: number;
}
export function darkDayOf(levels: Record<string, unknown>[], dayVolume: number): DarkDay | null {
  let dark = 0;
  let lit = 0;
  let dollars = 0;
  let off = 0;
  let offDollars = 0;
  for (const r of levels) {
    const d = num(r.dark_pool_volume);
    lit += num(r.regular_volume);
    if (offMarketBucket(r)) {
      off += d;
      offDollars += d * num(r.price);
      continue;
    }
    dark += d;
    dollars += d * num(r.price);
  }
  return dark + off > 0 ? { darkShares: dark, litShares: lit, darkDollars: dollars, offShares: off, offDollars, sharePct: dayVolume >= dark ? (dark / dayVolume) * 100 : NaN } : null;
}
