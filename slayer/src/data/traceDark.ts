/* Dark-pool and lit prints: one vendor print as a cross with its read, a name's shelves, and its posture. */

import type { DarkPoolIntent, DarkPoolLevel, DarkPoolPrint, DarkPoolView, LevelRole, Posture } from '../types/darkpool';
import { postureOfNet } from './traceLean';
import { clock, execOf, hashId, num, nyDateOf } from './traceRows';


/* The dark-pool read, one rule across Trace: a sized regular-session print over the mid was paid up (accumulation),
   under it sold down (distribution), at the mid neither. Only sized prints at the quote carry a read. */
/** A sized cross is dollars, not shares: $250K and up carries a read, below it none. */
export const DARK_SIZED_USD = 250_000;
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
  /* after hours (the vendor's ext_hour_sold_codes "extended_hours_trade"): the quote it is set against is the thin
     post-market one, so the print is shown and labelled, never read */
  const extended = row.ext_hour_sold_codes != null && row.ext_hour_sold_codes !== '';
  const placeCents = quotePlace(vs, price).cents;
  const intent = special || extended ? 'ROTATION' : intentOf(placeCents, sized);
  /* an after-hours print's place in a thin quote is drawn neutral, never as a side; `exec` still says where it sat */
  const exec = special ? null : execOf(price, bid, ask);
  const when = clock(row.executed_at);
  /* the vendor's tracking_id is NOT unique — distinct prints (other sizes, other cumulative volumes) share one — so the
     id folds in the fields that tell them apart; stable across polls, so the accumulator still de-dupes repeats */
  const id = hashId(row.tracking_id != null ? `${row.tracking_id}-${row.executed_at}-${row.size}-${row.price}-${row.volume}` : `${row.ticker}-${row.executed_at}-${i}`);
  const place = quotePlace(vs, price);
  const where = place.cents === 0 ? 'at the mid' : place.cents > 0 ? `${place.text.slice(1)} over the mid` : `${place.text.slice(1)} under the mid`;
  const read = special
    ? auction
      ? `${/^[aeiou]/i.test(special) ? 'An' : 'A'} ${special} — priced in the auction, not against the quote; no read.`
      : `${/^[aeiou]/i.test(special) ? 'An' : 'A'} ${special} — priced by its terms, not the quote; no read.`
    : extended
      ? `After hours, ${where} of a post-market quote — no read.`
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

/** The posture of the sized, read prints — their dollars over the mid (bought up) against under it (sold down) */
export function postureOf(prints: DarkPoolPrint[]): { posture: Posture; net: number; note: string; read: number } {
  const read = prints.filter(p => p.sized && !p.extended && !p.special);
  const acc = read.reduce((a, p) => a + (p.intent === 'ACCUMULATION' ? p.notional : 0), 0);
  const dist = read.reduce((a, p) => a + (p.intent === 'DISTRIBUTION' ? p.notional : 0), 0);
  const all = read.reduce((a, p) => a + p.notional, 0);
  const net = all > 0 ? Math.round(((acc - dist) / all) * 100) : 0;
  const posture: Posture = postureOfNet(net);
  const after = prints.length > 0 && read.length === 0 && prints.some(p => p.extended);
  const note = after
    ? 'Every print in hand is after hours — set against a post-market quote, so none is read.'
    : posture === 'ACCUMULATING'
      ? 'Sized dollars lean over the mid — bought up, buyer-initiated.'
      : posture === 'DISTRIBUTING'
        ? 'Sized dollars lean under the mid — sold down, seller-initiated.'
        : read.length
          ? 'Sized dollars sit on both sides of the mid.'
          : 'No sized print in the regular session to read.';
  /* `read`: how many prints carried a read; none is "nothing to read", never Balanced */
  return { posture, net, note, read: read.length };
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

export function mergeDark(prev: DarkPoolPrint[], incoming: DarkPoolPrint[]): DarkPoolPrint[] {
  const seen = new Set(prev.map(r => r.id));
  const fresh = incoming.filter(r => !seen.has(r.id) && (seen.add(r.id), true));
  if (!fresh.length) return prev;
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
