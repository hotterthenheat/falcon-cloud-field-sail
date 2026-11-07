/*
  MODEL 1, THE OPEN-INTEREST BOOK (docs/TWO_BOOK_SPEC_V2.md §3; what was built: docs/TWO_BOOK.md). Pure: the server
  keeper (model1Server.ts) hands it the vendor's pages, the validation run hands it recorded ones.

  - The four (GEX, DEX, VANNA, CHARM): the vendor's spot-exposures rows by expiry and strike, stored RAW (OBSERVED, unit
    tag UW), then converted by §3.4 exactly (CALCULATED, source the listed rows) — no other multiplier, sign or scale.
  - ONE timestamp per board: the rows' modal `time`; rows stamped otherwise are counted and left out of every sum.
  - Population (§3.4 step 2, the same for the six): an expiration before the snapshot's date, or today's from 16:00 ET,
    is dropped (kept raw); on an AM-settlement day from 09:30 ET the expiration is ONE flagged line outside the totals.
  - The six (VEGA, VOMMA, COLOR, SPEED, VETA, ZOMMA): UW_COMPAT — r = b = 0, D = 365, S = the row `price`, T to each
    root's settlement — on the contracts of the same population: C = +OI calls, −OI puts (`open_interest`, OCC's), M
    from the contract table, IV per §3.5: the vendor's IV (APPROX: solved at an unpublished spot and time) else the flat
    wing (MODELED). Step 1 (an IV solved from the NBBO at the row timestamp) is not run: the open-interest book reads the
    listed rows only and they carry no quote at that timestamp; the board says so.
  - One time unit (§4.5): per hour when any contract in the population has under a day left, for the four and the six.
*/

import { contractSpec, parseOccSymbol, rootsOf, sumBoard, uwRowAction, uwToSlayer, yearsTo, type BoardLine, type UwFour } from '../../engine/twobook';

export const UW_FIELDS = ['call_gamma_oi', 'put_gamma_oi', 'call_delta_oi', 'put_delta_oi', 'call_vanna_oi', 'put_vanna_oi', 'call_charm_oi', 'put_charm_oi'] as const;

export type Provenance = 'OBSERVED' | 'CALCULATED' | 'MODELED' | 'APPROX' | 'EXPIRED' | 'UNAVAILABLE';
export interface Model1Metric {
  value: number;
  provenance: Provenance;
  unitTag: 'SLAYER';
  mode: 'UW_CONVERTED' | 'UW_COMPAT';
  /** What the value is per: '1% spot', '$Δ', 'vol point', 'calendar day' / 'calendar hour' … */
  per: string;
}
export interface Model1Wire {
  model: 1;
  ticker: string;
  available: boolean;
  why: string | null;
  /** The board's one timestamp and the row price it is priced at (the vendor's coarse index price, used as the spec says) */
  at: number | null;
  price: number | null;
  iv30: number | null;
  iv30Date: string | null;
  unit: 'day' | 'hour';
  rateNotForecast: boolean;
  four: Record<'GEX' | 'DEX' | 'VANNA' | 'CHARM', Model1Metric> | null;
  six: Record<'VEGA' | 'VOMMA' | 'COLOR' | 'SPEED' | 'VETA' | 'ZOMMA', Model1Metric> | null;
  /** UW's own-sign DEX (OBSERVED secondary, never the board's) */
  dexVendorSign: number | null;
  /** The flagged AM-settlement line(s): converted like the four, outside the totals */
  flagged: { expiry: string; GEX: number; DEX: number; VANNA: number; CHARM: number }[];
  /** The rows the population dropped (expired), converted for reconciliation only */
  dropped: { rows: number; GEX: number; DEX: number; VANNA: number; CHARM: number };
  rows: { total: number; used: number; otherTimestamp: number; pages: number };
  oi: { contracts: number; share: { approx: number; modeled: number }; adjusted: number; unavailable: number; expired: number };
  byStrike: [number, number, number][];
  notes: string[];
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const sum4 = (rows: readonly Record<string, unknown>[]): UwFour => {
  const f = Object.fromEntries(UW_FIELDS.map(k => [k, 0])) as unknown as UwFour;
  for (const r of rows) for (const k of UW_FIELDS) f[k] += num(r[k]);
  return f;
};
/** The third Friday of the expiry's month: a standard monthly, the AM root's expiration */
const thirdFriday = (iso: string): boolean => {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
};

export function model1Board(o: {
  ticker: string;
  /** Every spot-exposures/expiry-strike row of the walk */
  rows: readonly Record<string, unknown>[];
  pages: number;
  /** volatility/stats `iv` and its date */
  iv30: number | null;
  iv30Date: string | null;
  /** Every option-contracts row of the walk */
  contracts: readonly Record<string, unknown>[];
}): Model1Wire {
  const ticker = o.ticker.toUpperCase();
  const empty = (why: string): Model1Wire => ({ model: 1, ticker, available: false, why, at: null, price: null, iv30: o.iv30, iv30Date: o.iv30Date, unit: 'day', rateNotForecast: false, four: null, six: null, dexVendorSign: null, flagged: [], dropped: { rows: 0, GEX: 0, DEX: 0, VANNA: 0, CHARM: 0 }, rows: { total: o.rows.length, used: 0, otherTimestamp: 0, pages: o.pages }, oi: { contracts: 0, share: { approx: 0, modeled: 0 }, adjusted: 0, unavailable: 0, expired: 0 }, byStrike: [], notes: [] });
  if (!o.rows.length) return empty('no listed open-interest rows for this name');
  /* one timestamp: the modal row time */
  const byTime = new Map<string, number>();
  for (const r of o.rows) byTime.set(String(r.time ?? ''), (byTime.get(String(r.time ?? '')) ?? 0) + 1);
  const time = [...byTime.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const at = Date.parse(time);
  const same = o.rows.filter(r => String(r.time ?? '') === time);
  const price = num(same[0]?.price);
  if (!(price > 0) || !Number.isFinite(at)) return empty('the listed rows carry no price or time');
  if (!(o.iv30 != null && o.iv30 > 0)) return empty('no ticker IV at the rows’ date for the vanna conversion');
  /* AM-settlement days: an expiry an AM root of this ticker settles on */
  const amRoots = rootsOf(ticker).filter(r => contractSpec(r, ticker)?.settlement === 'AM');
  const amListed = new Set<string>();
  for (const c of o.contracts) {
    const p = parseOccSymbol(String(c.option_symbol ?? ''));
    if (p && amRoots.includes(p.root)) amListed.add(p.expiry);
  }
  const amDay = (exp: string) => amRoots.length > 0 && (amListed.has(exp) || thirdFriday(exp));
  const keep: Record<string, unknown>[] = [];
  const drop: Record<string, unknown>[] = [];
  const flag = new Map<string, Record<string, unknown>[]>();
  for (const r of same) {
    const exp = String(r.expiry ?? '').slice(0, 10);
    const act = uwRowAction(at, exp, amDay(exp));
    if (act === 'DROP') drop.push(r);
    else if (act === 'FLAG_AM') flag.set(exp, [...(flag.get(exp) ?? []), r]);
    else keep.push(r);
  }
  /* the six: the same population of contracts */
  const lines: BoardLine[] = [];
  let adjusted = 0;
  let expired = 0;
  for (const c of o.contracts) {
    const p = parseOccSymbol(String(c.option_symbol ?? ''));
    if (!p) continue;
    const spec = contractSpec(p.root, ticker);
    if (!spec) {
      adjusted++;
      continue;
    }
    const act = uwRowAction(at, p.expiry, amDay(p.expiry));
    if (act !== 'INCLUDE') {
      if (act === 'DROP') expired++;
      continue;
    }
    const oi = num(c.open_interest);
    if (!(oi > 0)) continue;
    const iv = num(c.implied_volatility);
    lines.push({ root: p.root, expiry: p.expiry, strike: p.strike, right: p.right, C: p.right === 'C' ? oi : -oi, M: spec.multiplier, T: yearsTo(spec, p.expiry, at), S: price, r: 0, b: 0, iv: iv > 0 ? iv : null, ivProv: iv > 0 ? 'UW_APPROX' : 'UNAVAILABLE' });
  }
  const board = sumBoard(lines);
  const unit = board.unit;
  const conv = uwToSlayer(sum4(keep), price, o.iv30, unit);
  const per = unit === 'hour' ? 'calendar hour' : 'calendar day';
  const m4 = (value: number, p: string): Model1Metric => ({ value, provenance: 'CALCULATED', unitTag: 'SLAYER', mode: 'UW_CONVERTED', per: p });
  const m6 = (value: number, p: string): Model1Metric => ({ value, provenance: 'MODELED', unitTag: 'SLAYER', mode: 'UW_COMPAT', per: p });
  const dropped = uwToSlayer(sum4(drop), price, o.iv30, unit);
  /* per strike: the converted GEX and DEX of the population's rows */
  const strikes = new Map<number, Record<string, unknown>[]>();
  for (const r of keep) {
    const k = num(r.strike);
    strikes.set(k, [...(strikes.get(k) ?? []), r]);
  }
  const notes = [
    'Positioning assumption: dealers long the listed calls, short the listed puts (open interest convention), not observed positions.',
    'The vendor prices vanna and charm with a carry model; the four are its figures converted, the six are the house model on the same contracts.',
    `Priced at the listed row price ${price} (the vendor rounds index prices).`,
    'The six use the vendor’s implied vols (solved at an unpublished spot and time) and the nearest valid strike where it has none.',
  ];
  if (flag.size) notes.push('An AM-settlement expiration is shown on its own line: its rows may contain settled morning contracts.');
  if (byTime.size > 1) notes.push(`${o.rows.length - same.length} rows of another timestamp were left out.`);
  return {
    model: 1,
    ticker,
    available: true,
    why: null,
    at,
    price,
    iv30: o.iv30,
    iv30Date: o.iv30Date,
    unit,
    rateNotForecast: board.rate,
    four: { GEX: m4(conv.GEX, '1% move'), DEX: m4(conv.DEX, '$ delta'), VANNA: m4(conv.VANNA, 'vol point'), CHARM: m4(conv.CHARM, per) },
    six: {
      VEGA: m6(board.totals.VEGA, 'vol point'),
      VOMMA: m6(board.totals.VOMMA, 'vol point'),
      COLOR: m6(board.totals.COLOR, per),
      SPEED: m6(board.totals.SPEED, '1% move'),
      VETA: m6(board.totals.VETA, per),
      ZOMMA: m6(board.totals.ZOMMA, 'vol point'),
    },
    dexVendorSign: conv.DEX_UW_SIGN,
    flagged: [...flag.entries()].map(([expiry, rs]) => ({ expiry, ...(({ GEX, DEX, VANNA, CHARM }) => ({ GEX, DEX, VANNA, CHARM }))(uwToSlayer(sum4(rs), price, o.iv30 as number, unit)) })),
    dropped: { rows: drop.length, GEX: dropped.GEX, DEX: dropped.DEX, VANNA: dropped.VANNA, CHARM: dropped.CHARM },
    rows: { total: o.rows.length, used: keep.length, otherTimestamp: o.rows.length - same.length, pages: o.pages },
    oi: { contracts: board.counts.priced, share: { approx: board.approxShare, modeled: board.modeledShare }, adjusted, unavailable: board.counts.unavailable, expired },
    byStrike: [...strikes.entries()].map(([k, rs]) => {
      const c = uwToSlayer(sum4(rs), price, o.iv30 as number, unit);
      return [k, c.GEX, c.DEX] as [number, number, number];
    }).sort((a, b) => a[0] - b[0]),
    notes,
  };
}
