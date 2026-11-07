/// <reference types="node" />
/*
  MODEL 2, THE FLOW BOOK, ON THE SERVER (docs/TWO_BOOK_SPEC_V2.md §4; what was built: docs/TWO_BOOK.md).

  The option tape (src/data/tapeServer.ts) classifies every print it reads per §4.1 into one signed inventory per
  (root, expiration, strike, right) — FlowInventory, prints only, never open interest. Here that inventory is revalued
  in SLAYER mode at the valuation instant:
    - quotes: the strip's NBBO (QUOTE_MAX_DTE days, QUOTE_STRIKES strikes either side), one snapshot read per root;
      the book is valued at now during the session, else at the quotes' newest stamp (after the close);
    - S* from the parity forwards of every expiry (§1.2), each expiry's carry b_T against S*;
    - r: SOFR (/interest_rate/history/eod, the fixing in force on the tape's day), flat across T (the terminal has no
      term SOFR), continuous ACT/365: r = 365·ln(1 + SOFR/360);
    - IV solved from each contract's mid under (S*, K, T, r, b_T); the flat wing where it cannot be (§1.5);
    - the ten exposures in the board's one time unit (§4.5), the §5 hedge.
  One board per name, kept BOARD_HOLD_MS and shared by every viewer; one build in flight per name. The browser asks
  /api/tape/flowbook only.
*/

import { contractKey, contractSpec, rootsOf, slayerBoard, yearsTo, type ChainExpiry, type FlowContract, type ParityQuote } from '../../engine/twobook';
import { nyInstant } from '../../../shared/marketSession.mjs';
import { eachCsvRow, stampParts } from '../printTags';

export const BOARD_HOLD_MS = 20_000;
/** Expiries and strikes the quote read covers: enough for a ≥ 7-day TL and the tape's strikes */
export const QUOTE_MAX_DTE = 45;
export const QUOTE_STRIKES = 30;
/** Reads of one root's quote snapshot before the board goes out without quotes, and the first pause (doubling) */
export const QUOTE_ATTEMPTS = 4;
export const QUOTE_RETRY_MS = 400;

/** What the tape hands over: its inventory and where it stands */
export interface FlowTapeView {
  name: string;
  day: string;
  open: number;
  close: number;
  through: number;
  live: boolean;
  complete: boolean;
  byExpiry: boolean;
  /** The expiries a current-day tape reads, per root (null: every expiry) */
  exps: Record<string, string[] | null>;
  inv: Map<string, number>;
  buckets: Map<string, number>;
  prints: number;
  linked: number;
  unlinked: number;
  /** The underlying's latest minute price in hand (strike selection only) */
  spotRef: number;
  fault: string | null;
}

export interface FlowBoardWire {
  model: 2;
  ticker: string;
  day: string;
  /** The instant the book is valued at, and the quotes' newest stamp */
  valuedAt: number;
  quotesAt: number | null;
  through: number;
  live: boolean;
  mode: 'SLAYER';
  units: 'SLAYER';
  spot: { S: number; prov: 'CALCULATED' | 'APPROX'; T1: number; TL: number | null } | null;
  rate: { r: number; sofr: number; day: string } | null;
  unit: 'day' | 'hour';
  rateNotForecast: boolean;
  totals: Record<string, number> | null;
  totalGexChange1pct: number;
  hedge: { dealer_delta_units: number; hedge_dollars: number; hedge_units_change_1pct: number; esEquivalent: number | null } | null;
  absC: number;
  modeledShare: number;
  counts: { contracts: number; priced: number; expired: number; unavailable: number; flatWing: number };
  byStrike: [number, number, number, number, number][];
  expiries: { id: string; T: number; F: number; b: number; source: string; absC: number }[];
  flow: { prints: number; buckets: Record<string, number>; linkedCancels: number; unlinkedCancels: number; contracts: number };
  population: string;
  fault: string | null;
}

const ymd = (d: string) => d.replace(/-/g, '');
const num = (s: string | undefined) => (s == null || s === '' ? NaN : Number(s));
const unq = (s: string | undefined) => (s ?? '').replace(/"/g, '');
export const sofrToContinuous = (pct: number): number => 365 * Math.log1p(pct / 100 / 360);

/** The SOFR fixing in force on `day` from the rate history's JSON */
export function sofrOn(body: string, day: string): { pct: number; day: string } | null {
  let rows: unknown;
  try {
    const j = JSON.parse(body);
    rows = Array.isArray(j) ? j : j?.response ?? j?.data;
  } catch {
    return null;
  }
  let best: { pct: number; day: string } | null = null;
  for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
    const d = String(r.created ?? r.date ?? '').slice(0, 10);
    const pct = Number(r.rate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(pct) || d > day) continue;
    if (!best || d > best.day) best = { pct, day: d };
  }
  return best;
}

interface QuoteRow {
  root: string;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  bid: number;
  ask: number;
  ms: number;
}
export function readQuotes(csv: string, root: string): QuoteRow[] {
  const out: QuoteRow[] = [];
  eachCsvRow(csv, (f, c) => {
    const exp = unq(f[c.get('expiration') ?? -1]).slice(0, 10);
    const strike = num(f[c.get('strike') ?? -1]);
    const right = unq(f[c.get('right') ?? -1]).startsWith('C') ? 'C' : 'P';
    /* the terminal stamps New York wall time */
    const p = stampParts(unq(f[c.get('timestamp') ?? -1]));
    out.push({ root, expiry: exp, strike, right, bid: num(f[c.get('bid') ?? -1]), ask: num(f[c.get('ask') ?? -1]), ms: p ? nyInstant(p.date, p.minute) + p.ms : NaN });
  });
  return out;
}

/** The board from a tape view, the roots' quote rows and the rate: pure (the proof and the validation run call it) */
export function flowBoardOf(view: FlowTapeView, quotes: QuoteRow[], valuedAt: number, rate: { r: number; sofr: number; day: string } | null, quotesAt: number | null): FlowBoardWire {
  const r = rate?.r ?? NaN;
  const spot0 = view.spotRef;
  /* the chain: every (root, expiry) the quotes carry, with its own T to its root's settlement */
  const byExp = new Map<string, { root: string; expiry: string; T: number; pairs: Map<number, ParityQuote> }>();
  const strip = new Map<string, QuoteRow>();
  for (const q of quotes) {
    const spec = contractSpec(q.root);
    if (!spec || !(q.strike > 0)) continue;
    const id = `${q.root}|${q.expiry}`;
    let e = byExp.get(id);
    if (!e) byExp.set(id, (e = { root: q.root, expiry: q.expiry, T: yearsTo(spec, q.expiry, valuedAt), pairs: new Map() }));
    const p = e.pairs.get(q.strike) ?? { strike: q.strike, callBid: NaN, callAsk: NaN, putBid: NaN, putAsk: NaN };
    if (q.right === 'C') [p.callBid, p.callAsk] = [q.bid, q.ask];
    else [p.putBid, p.putAsk] = [q.bid, q.ask];
    e.pairs.set(q.strike, p);
    strip.set(contractKey(q.root, q.expiry, q.strike, q.right), q);
  }
  /* strikes nearest spot: the underlying's latest minute, else the middle of the quoted strikes */
  const chain: ChainExpiry[] = [...byExp.entries()].map(([id, e]) => {
    const ks = [...e.pairs.keys()].sort((a, b) => a - b);
    return { id, T: e.T, r, Sref: spot0 > 0 ? spot0 : ks[ks.length >> 1] ?? NaN, quotes: [...e.pairs.values()] };
  });
  const contracts: FlowContract[] = [];
  const seen = new Set<string>();
  const add = (root: string, expiry: string, strike: number, right: 'C' | 'P', q: QuoteRow | undefined) => {
    const spec = contractSpec(root);
    if (!spec) return;
    const k = contractKey(root, expiry, strike, right);
    if (seen.has(k)) return;
    seen.add(k);
    const mid = q ? 0.5 * (q.bid + q.ask) : NaN;
    contracts.push({ root, expiry: `${root}|${expiry}`, strike, right, bid: q?.bid ?? NaN, ask: q?.ask ?? NaN, tick: spec.tick(Number.isFinite(mid) ? mid : 0), M: spec.multiplier, C: view.inv.get(k) ?? 0 });
  };
  for (const q of strip.values()) add(q.root, q.expiry, q.strike, q.right, q);
  /* inventory the quotes do not carry still enters (no quote: flat wing, else UNAVAILABLE) — never silently dropped */
  for (const [k, C] of view.inv) {
    if (C === 0 || seen.has(k)) continue;
    const [root, expiry, strike, right] = k.split('|');
    if (!byExp.has(`${root}|${expiry}`)) {
      const spec = contractSpec(root);
      if (spec) byExp.set(`${root}|${expiry}`, { root, expiry, T: yearsTo(spec, expiry, valuedAt), pairs: new Map() });
      chain.push({ id: `${root}|${expiry}`, T: byExp.get(`${root}|${expiry}`)?.T ?? NaN, r, Sref: spot0, quotes: [] });
    }
    add(root, expiry, Number(strike), right as 'C' | 'P', undefined);
  }
  const b = slayerBoard(chain, contracts);
  const t = b.board;
  const absByExp = new Map<string, number>();
  for (const c of contracts) if (c.C !== 0) absByExp.set(c.expiry, (absByExp.get(c.expiry) ?? 0) + Math.abs(c.C));
  const spot = b.spot ? { S: b.spot.S, prov: b.spot.prov, T1: b.spot.T1, TL: b.spot.TL } : null;
  const index = view.name === 'SPX' || view.name === 'XSP';
  return {
    model: 2,
    ticker: view.name,
    day: view.day,
    valuedAt,
    quotesAt,
    through: view.through,
    live: view.live,
    mode: 'SLAYER',
    units: 'SLAYER',
    spot,
    rate,
    unit: t?.unit ?? 'day',
    rateNotForecast: t?.rate ?? false,
    totals: t ? { ...t.totals } : null,
    totalGexChange1pct: t?.totalGexChange1pct ?? 0,
    hedge: t && spot ? { dealer_delta_units: t.hedge.dealer_delta_units, hedge_dollars: t.hedge.hedge_dollars, hedge_units_change_1pct: t.hedge.hedge_units_change_1pct, esEquivalent: index ? t.hedge.hedge_dollars / (spot.S * 50 * (view.name === 'XSP' ? 10 : 1)) : null } : null,
    absC: t?.absC ?? 0,
    modeledShare: t?.modeledShare ?? 0,
    counts: { contracts: contracts.filter(c => c.C !== 0).length, priced: t?.counts.priced ?? 0, expired: t?.counts.expired ?? 0, unavailable: t?.counts.unavailable ?? 0, flatWing: t?.counts.flatWing ?? 0 },
    byStrike: (t?.byStrike ?? []).filter(s => s.net.GEX !== 0 || s.net.DEX !== 0).map(s => [s.strike, s.net.GEX, s.net.DEX, s.call.GEX, s.put.GEX]),
    expiries: [...b.expiries.entries()].map(([id, x]) => ({ id, T: x.T, F: x.F, b: x.b, source: x.source, absC: absByExp.get(id) ?? 0 })).sort((a, c) => a.T - c.T),
    flow: { prints: view.prints, buckets: Object.fromEntries(view.buckets), linkedCancels: view.linked, unlinkedCancels: view.unlinked, contracts: [...view.inv.values()].filter(c => c !== 0).length },
    population: view.byExpiry
      ? `today's prints on the nearest listed expiries (${Object.entries(view.exps).map(([r, e]) => `${r}: ${(e ?? []).join(', ')}`).join('; ')}), ${QUOTE_STRIKES} strikes either side`
      : `the session's prints on every expiry, ${QUOTE_STRIKES} strikes either side`,
    fault: view.fault,
  };
}

/** One board per name, held BOARD_HOLD_MS, one build in flight: `read` is the tapes' own terminal gate */
export function flowBooks(o: { read: (path: string, kind: string) => Promise<string | null>; now: () => number; log?: (s: string) => void }) {
  const boards = new Map<string, { at: number; wire: FlowBoardWire }>();
  const building = new Map<string, Promise<FlowBoardWire>>();
  const rates = new Map<string, { r: number; sofr: number; day: string } | null>();
  const rateFor = async (day: string) => {
    if (rates.has(day)) return rates.get(day) ?? null;
    const start = new Date(Date.parse(`${day}T12:00:00Z`) - 12 * 86_400_000).toISOString().slice(0, 10);
    const body = await o.read(`/interest_rate/history/eod?symbol=SOFR&start_date=${ymd(start)}&end_date=${ymd(day)}&format=json`, 'rate').catch(() => null);
    const got = body ? sofrOn(body, day) : null;
    const out = got ? { r: sofrToContinuous(got.pct), sofr: got.pct, day: got.day } : null;
    if (out) rates.set(day, out);
    return out;
  };
  const build = async (view: FlowTapeView): Promise<FlowBoardWire> => {
    /* the tape is always the latest session's (tapeServer tapeDay), so the terminal's snapshot holds its current quotes
       (after the close: the last quotes of the day; a whole-chain quote-at-time read takes minutes). The book is valued
       at the instant the quotes stand for — now during the session, else the quotes' newest stamp — so T and the IVs
       are solved under the same clock (Rule 0); today's expiries are EXPIRED once that is past their settlement. */
    const rate = await rateFor(view.day);
    const quotes: QuoteRow[] = [];
    /* the quotes reach every expiry the inventory holds, so no held contract is priced off an extrapolated carry (the
       audit's A7: past the last valid forward the last segment's slope is held, which two close expiries make unstable) */
    let maxDte = QUOTE_MAX_DTE;
    for (const [k, C] of view.inv) {
      if (C === 0) continue;
      const exp = k.split('|')[1];
      const d = Math.ceil((Date.parse(`${exp}T21:00:00Z`) - Date.parse(`${view.day}T12:00:00Z`)) / 86_400_000) + 1;
      if (Number.isFinite(d) && d > maxDte) maxDte = Math.min(d, 1200);
    }
    for (const root of rootsOf(view.name)) {
      const path = `/option/snapshot/quote?symbol=${encodeURIComponent(root)}&expiration=*&max_dte=${maxDte}&strike_range=${QUOTE_STRIKES}&format=csv`;
      /* the terminal's snapshot answers 500 intermittently (measured 2026-11-07: 2–4 of 6 reads of one path refused,
         each within 0.1 s), so a refused read is asked again before the board is built without quotes */
      let csv: string | null = null;
      for (let attempt = 0; attempt < QUOTE_ATTEMPTS && csv == null; attempt++) {
        if (attempt > 0) await new Promise(res => setTimeout(res, QUOTE_RETRY_MS * 2 ** (attempt - 1)));
        csv = await o.read(path, 'quote').catch(e => {
          o.log?.(`[flowbook] ${view.name} ${root} quotes (try ${attempt + 1} of ${QUOTE_ATTEMPTS}): ${e instanceof Error ? e.message : e}`);
          return null;
        });
      }
      if (csv) quotes.push(...readQuotes(csv, root));
    }
    let quotesAt: number | null = null;
    for (const q of quotes) if (Number.isFinite(q.ms) && (quotesAt == null || q.ms > quotesAt)) quotesAt = q.ms;
    const valuedAt = view.live ? o.now() : (quotesAt ?? view.close);
    return flowBoardOf(view, quotes, valuedAt, rate, quotesAt);
  };
  return {
    async board(view: FlowTapeView): Promise<FlowBoardWire> {
      const hit = boards.get(view.name);
      if (hit && hit.wire.day === view.day && o.now() - hit.at < BOARD_HOLD_MS) return hit.wire;
      const running = building.get(view.name);
      if (running) return running;
      const job = build(view)
        .then(wire => {
          boards.set(view.name, { at: o.now(), wire });
          return wire;
        })
        .finally(() => building.delete(view.name));
      building.set(view.name, job);
      return job;
    },
  };
}
