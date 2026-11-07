/* Model 2's print classifier and signed inventory (TWO_BOOK_SPEC_V2 §4.1, §4.2). Pure.

   Evaluated top to bottom; the first matching row decides. A print's conditions are its OPRA `condition` and the
   extension slots (`ext_condition1`–`4`; 255 means none). The NBBO is the last quote at or before the trade
   (ThetaData trade_quote, exclusive = true); quote_age = trade_timestamp − quote_timestamp. Signs apply to calls and
   puts alike: a customer BUY leaves the modelled dealer short (C = −size), a customer SELL long (C = +size).

   Inventory is a MODELED dealer-side flow: volume is not inventory, prints cannot show opening or closing, and an
   ask-side print is not proof a market maker was the counterparty (§4.2, §6). */

export const BUCKETS = [
  'CANCEL',
  'EXCLUDED_EXT_HOURS',
  'EXCLUDED_COMPLEX',
  'EXCLUDED_CROSS',
  'EXCLUDED_INVALID',
  'BUY',
  'SELL',
  'EXCLUDED_LATE',
  'EXCLUDED_NO_QUOTE',
  'EXCLUDED_LOCKED_CROSSED',
  'EXCLUDED_STALE_QUOTE',
  'MID',
] as const;
export type Bucket = (typeof BUCKETS)[number];

const CANCEL = new Set([40, 41, 42, 43, 44]);
const EXT_HOURS = new Set([1, 65, 118, 148]);
const COMPLEX = new Set([35, 36, 37, 38, 124, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 147]);
const CROSS = new Set([45, 127, 128]);
const LATE = new Set([2, 5, 6, 13, 15]);
export const NO_CONDITION = 255;
export const STALE_QUOTE_MS = 1000;

const any = (cs: readonly number[], set: ReadonlySet<number>) => cs.some(c => set.has(c));
const fin = (x: number) => Number.isFinite(x);

/** §4.1: the bucket and the dealer C of one print */
export function classify(conditions: readonly number[], size: number, price: number, bid: number, ask: number, quoteAgeMs: number): { bucket: Bucket; C: number } {
  const cs = conditions.filter(c => fin(c) && c !== NO_CONDITION);
  if (any(cs, CANCEL)) return { bucket: 'CANCEL', C: 0 };
  if (any(cs, EXT_HOURS)) return { bucket: 'EXCLUDED_EXT_HOURS', C: 0 };
  if (any(cs, COMPLEX)) return { bucket: 'EXCLUDED_COMPLEX', C: 0 };
  if (any(cs, CROSS)) return { bucket: 'EXCLUDED_CROSS', C: 0 };
  if (!(size > 0) || !fin(price) || price <= 0) return { bucket: 'EXCLUDED_INVALID', C: 0 };
  const buyC = -size;
  if (cs.includes(145)) return { bucket: 'BUY', C: buyC };
  if (cs.includes(146)) return { bucket: 'SELL', C: size };
  if (any(cs, LATE)) return { bucket: 'EXCLUDED_LATE', C: 0 };
  if (!fin(bid) || !fin(ask) || ask <= 0 || bid < 0) return { bucket: 'EXCLUDED_NO_QUOTE', C: 0 };
  if (bid >= ask) return { bucket: 'EXCLUDED_LOCKED_CROSSED', C: 0 };
  if (!fin(quoteAgeMs) || quoteAgeMs < 0 || quoteAgeMs > STALE_QUOTE_MS) return { bucket: 'EXCLUDED_STALE_QUOTE', C: 0 };
  if (price >= ask) return { bucket: 'BUY', C: buyC };
  if (price <= bid) return { bucket: 'SELL', C: size };
  return { bucket: 'MID', C: 0 };
}

export interface FlowPrint {
  key: string;
  conditions: readonly number[];
  size: number;
  price: number;
  bid: number;
  ask: number;
  quoteAgeMs: number;
  /** The vendor's sequence number */
  seq?: number;
  /** The sequence a cancel names, when the vendor publishes it */
  ref?: number;
}

interface Kept {
  price: number;
  size: number;
  seq?: number;
  bucket: Bucket;
  C: number;
}

/** The running signed inventory (§4.2): fed one print at a time, in time order. */
export class FlowInventory {
  /** C by contract key */
  readonly inv = new Map<string, number>();
  /** contracts by bucket (a linked cancel moves its trade's size out of its bucket into CANCEL) */
  readonly buckets = new Map<Bucket, number>();
  prints = 0;
  unlinked = 0;
  linked = 0;
  /** Per contract, the latest kept prints a cancel can still name (newest last) */
  private readonly recent = new Map<string, Kept[]>();
  constructor(private readonly keepPerContract = 256) {}

  add(p: FlowPrint): Bucket {
    this.prints++;
    const { bucket, C } = classify(p.conditions, p.size, p.price, p.bid, p.ask, p.quoteAgeMs);
    const sz = Number.isFinite(p.size) ? p.size : 0;
    if (bucket === 'CANCEL') {
      this.buckets.set('CANCEL', (this.buckets.get('CANCEL') ?? 0) + sz);
      const list = this.recent.get(p.key);
      let idx = -1;
      if (list) {
        for (let i = list.length - 1; i >= 0; i--) {
          const k = list[i];
          if (p.ref != null ? k.seq === p.ref : k.price === p.price && k.size === p.size) {
            idx = i;
            break;
          }
        }
      }
      if (idx < 0 || !list) {
        this.unlinked++;
        return bucket;
      }
      const k = list.splice(idx, 1)[0];
      this.linked++;
      this.buckets.set(k.bucket, (this.buckets.get(k.bucket) ?? 0) - k.size);
      if (k.C !== 0) this.inv.set(p.key, (this.inv.get(p.key) ?? 0) - k.C);
      return bucket;
    }
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + sz);
    if (C !== 0) this.inv.set(p.key, (this.inv.get(p.key) ?? 0) + C);
    let list = this.recent.get(p.key);
    if (!list) this.recent.set(p.key, (list = []));
    list.push({ price: p.price, size: p.size, seq: p.seq, bucket, C });
    if (list.length > this.keepPerContract) list.shift();
    return bucket;
  }
}
