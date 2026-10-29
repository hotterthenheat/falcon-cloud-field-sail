/*
  The futures and indexes the paper desk knows, as data the engine can read without the feed. Futures are not traded:
  neither key carries a futures feed (FUTURES_LIVE in feed.ts); the contract specs stay for the engine's rules.
*/

export interface FutProduct {
  symbol: string;
  name: string;
  /** Dollars a whole point is worth, a contract */
  pointValue: number;
  tick: number;
  decimals: number;
  /** The day margin a contract */
  margin: number;
  /** Dollars a contract, each way */
  fee: number;
  /** The contract months it lists, as month codes */
  months: string;
  /** The day of the month BEFORE the contract month (0) or OF it (1) the front month rolls on */
  roll: { monthsBefore: 0 | 1; day: number };
}
export const FUT_PRODUCTS: FutProduct[] = [
  { symbol: 'ES', name: 'S&P 500 futures', pointValue: 50, tick: 0.25, decimals: 2, margin: 1500, fee: 2, months: 'HMUZ', roll: { monthsBefore: 0, day: 10 } },
  { symbol: 'MES', name: 'Micro S&P 500 futures', pointValue: 5, tick: 0.25, decimals: 2, margin: 150, fee: 0.5, months: 'HMUZ', roll: { monthsBefore: 0, day: 10 } },
  { symbol: 'NQ', name: 'Nasdaq 100 futures', pointValue: 20, tick: 0.25, decimals: 2, margin: 2200, fee: 2, months: 'HMUZ', roll: { monthsBefore: 0, day: 10 } },
  { symbol: 'MNQ', name: 'Micro Nasdaq 100 futures', pointValue: 2, tick: 0.25, decimals: 2, margin: 220, fee: 0.5, months: 'HMUZ', roll: { monthsBefore: 0, day: 10 } },
];
/** A price on the product's tick */
export const onTick = (p: FutProduct, v: number): number => +(Math.round(v / p.tick) * p.tick).toFixed(p.decimals);
const MONTH_CODES = 'FGHJKMNQUVXZ';
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** The front month on a day ("ESZ6"): the first listed month whose roll day is still ahead */
export function frontContractOf(p: FutProduct, day: string): string {
  const d = new Date(`${day}T12:00:00`);
  for (let i = 0; i < 26; i++) {
    const y = d.getFullYear() + Math.floor((d.getMonth() + i) / 12);
    const m = (d.getMonth() + i) % 12;
    if (!p.months.includes(MONTH_CODES[m])) continue;
    const rm = m - p.roll.monthsBefore;
    const rollDay = isoOf(rm < 0 ? y - 1 : y, (rm + 12) % 12, p.roll.day);
    if (rollDay > day) return `${p.symbol}${MONTH_CODES[m]}${String(y).slice(-1)}`;
  }
  return `${p.symbol}?`;
}

interface PaperFutProduct extends FutProduct {
  /** The fund it is priced off, the index's ratio to it, and the fixed carry in index points */
  fund: string;
  ratio: number;
  carry: number;
}
const of = (symbol: string): FutProduct => FUT_PRODUCTS.find(p => p.symbol === symbol)!;
export const PAPER_FUTURES: PaperFutProduct[] = [
  { ...of('ES'), fund: 'SPY', ratio: 10, carry: 12 },
  { ...of('MES'), fund: 'SPY', ratio: 10, carry: 12 },
  { ...of('NQ'), fund: 'QQQ', ratio: 41, carry: 45 },
  { ...of('MNQ'), fund: 'QQQ', ratio: 41, carry: 45 },
  { symbol: 'RTY', name: 'Russell 2000 futures', pointValue: 50, tick: 0.1, decimals: 2, margin: 1000, fee: 2, months: 'HMUZ', roll: { monthsBefore: 0, day: 10 }, fund: 'IWM', ratio: 10, carry: 6 },
  { symbol: 'M2K', name: 'Micro Russell 2000 futures', pointValue: 5, tick: 0.1, decimals: 2, margin: 100, fee: 0.5, months: 'HMUZ', roll: { monthsBefore: 0, day: 10 }, fund: 'IWM', ratio: 10, carry: 6 },
];
const BY_SYMBOL = new Map(PAPER_FUTURES.map(p => [p.symbol, p]));

/* THE INDEXES. Each is priced by ThetaData's index feed (thetaFeed.ts), its options read on their own root (SPXW,
   NDXP, RUTW), settled in cash on the index's close. `step` is the strike spacing a strike near a price is rounded to
   before the listing lands. */
export interface PaperIndex {
  symbol: string;
  name: string;
  /** The fund it is made from, and the index's ratio to it */
  fund: string;
  ratio: number;
  /** The distance between listed strikes near the money */
  step: number;
}
export const PAPER_INDEXES: PaperIndex[] = [
  { symbol: 'SPX', name: 'S&P 500 index', fund: 'SPY', ratio: 10, step: 5 },
  { symbol: 'NDX', name: 'Nasdaq-100 index', fund: 'QQQ', ratio: 41, step: 25 },
  { symbol: 'RUT', name: 'Russell 2000 index', fund: 'IWM', ratio: 10, step: 5 },
];
const INDEX_BY_SYMBOL = new Map(PAPER_INDEXES.map(x => [x.symbol, x]));
export const isPaperIndex = (symbol: string): boolean => INDEX_BY_SYMBOL.has(symbol.toUpperCase());
export const paperIndex = (symbol: string): PaperIndex | null => INDEX_BY_SYMBOL.get(symbol.toUpperCase()) ?? null;
export const isPaperFuture = (symbol: string): boolean => BY_SYMBOL.has(symbol.toUpperCase());
export const paperFut = (symbol: string): PaperFutProduct => BY_SYMBOL.get(symbol.toUpperCase()) ?? PAPER_FUTURES[0];
/** A micro is a tenth of its big contract — what an evaluation's contract count reads */
const isMicro = (symbol: string): boolean => /^M(ES|NQ|2K)$/.test(symbol.toUpperCase());
/** Big contracts a position of this many is, for an evaluation's cap: ten micros are one */
export const bigOf = (symbol: string, qty: number): number => (isMicro(symbol) ? qty / 10 : qty);
/** The front month on a trading day ("ESZ6") */
export const frontOn = (symbol: string, day: string): string => frontContractOf(paperFut(symbol), day);
/** What a price of the fund is as a price of the future */
export const futOfFund = (p: PaperFutProduct, v: number): number => onTick(p, v * p.ratio + p.carry);
/** A price in the product's own print: "5,262.25" */
export const futWords = (symbol: string, v: number): string => {
  const p = paperFut(symbol);
  return v.toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals });
};
