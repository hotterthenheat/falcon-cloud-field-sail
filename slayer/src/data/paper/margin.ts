/* What a paper account's open shorts hold, re-marked on every tick — the buying power the practice desk gives and takes.
   Pure: the engine (engine.ts viewOf) hands it the positions as they stand, each with its live quote.

   - A long (a call, a put, a spread bought for a debit) is paid in full: it holds nothing more.
   - A spread sold for a credit holds its width × 100 (with the credit it took in, that is its whole loss: the width less
     the credit). A put spread and a call spread sold on the same name and expiry are one iron condor (or butterfly): they
     hold the most the pair can lose at expiry, once — at most one side of an uncrossed condor can be in the money.
   - A put sold cash-secured holds its strike × 100 (with the premium in, the strike less the premium: its whole loss).
   - A single sold against a long of the same kind on the same expiry (a spread put on in two orders) holds what the pair
     can lose: the distance between the strikes where the long is further out, nothing where it is nearer.
   - A single sold with nothing over it (naked) holds a broker-style Reg T ESTIMATE, re-marked on every tick: the greater
     of 20% of the name less what the contract is out of the money, plus its premium now, or 10% of the name (a call) or
     of the strike (a put), plus its premium now — 15% and 10% on a broad-based index. A broker's own figure can differ.

   `req` is the whole of what is held; `held` is that less the premium the position took in (what the reader's own money
   holds: a credit spread's or a cash-secured put's whole loss). Free = cash − req. Equity under what the open shorts
   still need (free + the longs at their bid below zero) is a margin call. */

import { MULT } from '../review/engine';
import type { ContractId, Quote } from '../review/quotes';

const cents = (v: number) => Math.round(v * 100) / 100;

/** Reg T's rates: the share of the name, and the floor, for a stock or fund and for a broad-based index */
export const REG_T = { name: { base: 0.2, floor: 0.1 }, index: { base: 0.15, floor: 0.1 } } as const;
/** Broad-based indexes, and their option roots */
const BROAD = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'XSP', 'VIX', 'VIXW', 'DJX', 'OEX', 'XEO', 'MRUT']);
export const isBroadIndex = (ticker: string): boolean => BROAD.has(ticker.toUpperCase());

/** A position as margin reads it */
export interface MarginPos {
  key: string;
  contract: ContractId;
  /** 1 long, −1 short */
  dir: 1 | -1;
  qty: number;
  /** What it opened at, a share */
  avg: number;
  quote: Quote;
  secured?: 'cash';
  /** Where the name stood at the way in — the name's price while no quote stands */
  spotIn: number;
  /** The last price seen for it — its premium while no quote stands */
  last?: number;
}
export type MarginKind = 'credit' | 'condor' | 'csp' | 'covered' | 'naked';
export interface MarginLine {
  /** The positions it is for (a condor: its two spreads; a covered single: the short and the long over it) */
  keys: string[];
  kind: MarginKind;
  qty: number;
  /** What it holds, in all */
  req: number;
  /** The premium the short side took in */
  credit: number;
  /** req less credit (never under 0): what the reader's own money holds */
  held: number;
  /** How it was worked out, in a line */
  words: string;
}
export interface Margin {
  lines: MarginLine[];
  req: number;
  held: number;
}

const money = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const k = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''));
/** What a leg is worth in the money with the name at `s` */
const legAt = (strike: number, right: 'C' | 'P', s: number) => Math.max(0, right === 'C' ? s - strike : strike - s);
/** What a spread (sold) owes at expiry with the name at `s`: its long strike less its short one, inside its width */
const spreadOwes = (c: ContractId, s: number) => Math.max(0, Math.min(Math.abs(c.short! - c.strike), legAt(c.strike, c.right, s) - legAt(c.short!, c.right, s)));

/** One naked short's Reg T estimate, a contract: the greater of base × name − out of the money + premium, or floor ×
    (a call: the name; a put: the strike) + premium */
export function regT(c: ContractId, spot: number, premium: number): { each: number; words: string } {
  const idx = isBroadIndex(c.ticker);
  const r = idx ? REG_T.index : REG_T.name;
  const otm = Math.max(0, c.right === 'C' ? c.strike - spot : spot - c.strike);
  const a = r.base * spot - otm + premium;
  const floorOn = c.right === 'C' ? spot : c.strike;
  const b = r.floor * floorOn + premium;
  const each = Math.max(a, b) * MULT;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const words =
    a >= b
      ? `Reg T estimate: ${pct(r.base)} of ${c.ticker} ${spot.toFixed(2)}${otm > 0 ? ` less ${otm.toFixed(2)} out of the money` : ''}, plus the ${premium.toFixed(2)} premium, × 100`
      : `Reg T estimate: ${pct(r.floor)} of the ${c.right === 'C' ? `name (${spot.toFixed(2)})` : `strike (${k(c.strike)})`} plus the ${premium.toFixed(2)} premium, × 100 — its floor`;
  return { each, words: `${words}${idx ? ' (an index: 15% / 10%)' : ''} — a broker’s own figure can differ` };
}

/** What every open short holds */
export function marginOf(ps: MarginPos[]): Margin {
  const lines: MarginLine[] = [];
  const shorts = ps.filter(p => p.dir < 0 && p.qty > 0);
  if (!shorts.length) return { lines, req: 0, held: 0 };
  const line = (l: Omit<MarginLine, 'held'>) => lines.push({ ...l, req: cents(l.req), credit: cents(l.credit), held: cents(Math.max(0, l.req - l.credit)) });

  /* ---- spreads sold: a put spread and a call spread on one name and expiry are a condor ---- */
  const groups = new Map<string, MarginPos[]>();
  for (const p of shorts) if (p.contract.short != null) groups.set(`${p.contract.ticker}|${p.contract.expiry}`, [...(groups.get(`${p.contract.ticker}|${p.contract.expiry}`) ?? []), p]);
  for (const g of groups.values()) {
    const left = new Map(g.map(p => [p.key, p.qty]));
    const puts = g.filter(p => p.contract.right === 'P');
    const calls = g.filter(p => p.contract.right === 'C');
    for (const pp of puts)
      for (const cp of calls) {
        const n = Math.min(left.get(pp.key)!, left.get(cp.key)!);
        if (n < 1) continue;
        /* the most the pair owes at expiry: at one of its strikes (the payoff is straight between them) */
        const at = [pp.contract.strike, pp.contract.short!, cp.contract.strike, cp.contract.short!];
        const worst = Math.max(...at.map(s => spreadOwes(pp.contract, s) + spreadOwes(cp.contract, s)));
        left.set(pp.key, left.get(pp.key)! - n);
        left.set(cp.key, left.get(cp.key)! - n);
        line({ keys: [pp.key, cp.key], kind: 'condor', qty: n, req: worst * MULT * n, credit: (pp.avg + cp.avg) * MULT * n, words: `One ${pp.contract.strike === cp.contract.strike ? 'iron butterfly' : 'iron condor'}: holds the most the two spreads can lose at expiry, ${worst.toFixed(2)} × 100${n > 1 ? ` × ${n}` : ''}, once — with the credit in, its whole loss` });
      }
    for (const p of g) {
      const n = left.get(p.key)!;
      if (n < 1) continue;
      const w = Math.abs(p.contract.short! - p.contract.strike);
      line({ keys: [p.key], kind: 'credit', qty: n, req: w * MULT * n, credit: p.avg * MULT * n, words: `A credit spread: holds its width, ${w.toFixed(2)} × 100${n > 1 ? ` × ${n}` : ''} — with the credit in, its whole loss` });
    }
  }

  /* ---- singles sold ---- */
  const longs = new Map(ps.filter(p => p.dir > 0 && p.contract.short == null).map(p => [p.key, p.qty]));
  for (const p of shorts) {
    if (p.contract.short != null) continue;
    const c = p.contract;
    let n = p.qty;
    if (c.right === 'P' && p.secured === 'cash') {
      line({ keys: [p.key], kind: 'csp', qty: n, req: c.strike * MULT * n, credit: p.avg * MULT * n, words: `Cash-secured: holds the strike, ${k(c.strike)} × 100${n > 1 ? ` × ${n}` : ''} — with the premium in, its whole loss` });
      continue;
    }
    /* a long of the same kind on the same expiry caps it: the one that caps it closest first */
    const covers = ps
      .filter(x => x.dir > 0 && x.contract.short == null && x.contract.ticker === c.ticker && x.contract.expiry === c.expiry && x.contract.right === c.right)
      .map(x => ({ x, gap: Math.max(0, c.right === 'C' ? x.contract.strike - c.strike : c.strike - x.contract.strike) }))
      .sort((u, w) => u.gap - w.gap);
    for (const { x, gap } of covers) {
      const free = longs.get(x.key) ?? 0;
      const q = Math.min(n, free);
      if (q < 1) continue;
      longs.set(x.key, free - q);
      n -= q;
      line({ keys: [p.key, x.key], kind: 'covered', qty: q, req: gap * MULT * q, credit: p.avg * MULT * q, words: `Covered by the ${k(x.contract.strike)}${c.right} held: holds ${gap > 0 ? `the ${gap.toFixed(2)} between the strikes × 100` : 'nothing — the long is nearer the money'}${q > 1 ? ` × ${q}` : ''}` });
      if (n < 1) break;
    }
    if (n < 1) continue;
    const spot = p.quote.spot > 0 ? p.quote.spot : p.spotIn;
    const premium = Number.isFinite(p.quote.mark) && p.quote.mark >= 0 ? p.quote.mark : Number.isFinite(p.last ?? NaN) ? p.last! : p.avg;
    const r = regT(c, spot, premium);
    line({ keys: [p.key], kind: 'naked', qty: n, req: r.each * n, credit: p.avg * MULT * n, words: `${r.words}${n > 1 ? `, × ${n}` : ''}` });
  }
  const req = cents(lines.reduce((x, l) => x + l.req, 0));
  return { lines, req, held: cents(lines.reduce((x, l) => x + l.held, 0)) };
}

/** The line a position's margin is on, if any */
export const marginLineOf = (m: Margin, key: string): MarginLine | undefined => m.lines.find(l => l.keys[0] === key) ?? m.lines.find(l => l.keys.includes(key));
/** "$1,240.00" — for the words the engine writes */
export const marginMoney = money;
