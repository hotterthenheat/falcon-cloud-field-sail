/*
  Feature version 2's trees in the shadow (Group B, docs/compass-group-b.md). Off unless the server turns it on
  (COMPASS_V2_SHADOW=1) and the version 2 files are in public/models with the hashes in compassParams. When on, every
  row the scan scores is also scored by the version 2 Hit and Runner trees on the version 2 row (compassModel builds it
  beside the live one), run through the same books (Book A's or Book B's gates, the version 2 theta burn, the drive
  rule, one call a root and sleeve and one a contract a session, on the shadow's own seats) and kept as a shadow call.
  A shadow call is never a call: it takes no seat, makes no card, is in no record or track record, and is never shown;
  the server writes it to .cache/compass/shadow/ for the research to settle. Nothing here changes a live answer.
*/
import { compassHost } from './compassHost';
import { firstNaN, nanUnsafeColumns, parseBoosters, predict, type Tree } from './lgbm';
import { DRIVE, P1_MIN_V2, PRUN_MIN_V2, TREE_N, V2_ENTRY_FILE, V2_ENTRY_SHA, V2_RUNNER_FILE, V2_RUNNER_SHA } from './compassParams';
import type { Setup } from '../types/compass';

let on = false;
let trees: { entry: Tree[]; runner: Tree[]; entryUnsafe: number[]; runnerUnsafe: number[] } | null = null;
let loading: Promise<boolean> | null = null;
let day = '';
const seats = new Set<string>();
const ids = new Set<string>();

export interface ShadowCall {
  day: string;
  id: string;
  contract: string;
  ticker: string;
  sleeve: string;
  expiry: string;
  right: string;
  strike: number;
  book: 'A' | 'B';
  mark: number;
  flatAt: number;
  bid: number;
  ask: number;
  ride: boolean;
  session: string;
}
const calls: ShadowCall[] = [];
const fns = new Set<(c: ShadowCall) => void>();

/** The server turns the shadow on (COMPASS_V2_SHADOW=1). With no version 2 hashes in compassParams it stays empty. */
export function setShadow(enabled: boolean): void {
  on = enabled && !!V2_ENTRY_SHA && !!V2_RUNNER_SHA;
}

export function shadowOn(): boolean {
  return on;
}

export function onShadowCall(fn: (c: ShadowCall) => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

export function shadowCalls(): readonly ShadowCall[] {
  return calls;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The version 2 trees, verified by hash (a miss leaves the shadow empty). */
export async function shadowTrees(): Promise<boolean> {
  if (!on) return false;
  if (trees) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      const read = async (url: string, sha: string) => {
        const bytes = await compassHost().asset(url);
        if (!bytes || (await sha256Hex(bytes)) !== sha) return null;
        const text = new TextDecoder().decode(bytes);
        const t = parseBoosters(text, TREE_N);
        return t ? { t, unsafe: nanUnsafeColumns(text) } : null;
      };
      const e = await read(V2_ENTRY_FILE, V2_ENTRY_SHA);
      const r = await read(V2_RUNNER_FILE, V2_RUNNER_SHA);
      if (!e || !r) {
        on = false;
        return false;
      }
      trees = { entry: e.t, runner: r.t, entryUnsafe: e.unsafe, runnerUnsafe: r.unsafe };
      return true;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Version 2's Hit and Runner scores on a version 2 row (null where a NaN-unsafe column is missing). */
export function shadowScore(x2: readonly number[]): { p1: number | null; prun: number | null } {
  if (!trees) return { p1: null, prun: null };
  if (firstNaN(x2, trees.entryUnsafe) >= 0) return { p1: null, prun: null };
  const p1 = predict(trees.entry, x2);
  return { p1, prun: firstNaN(x2, trees.runnerUnsafe) >= 0 ? null : predict(trees.runner, x2) };
}

export interface ShadowRow { setup: Setup; p1: number; prun: number | null; retOpen: number; book: 'A' | 'B'; flatAt: number; session: string }

/** Version 2's line on a row that passed Book A's or Book B's gates (without the line) and no version 2 theta burn. */
export function shadowClears(p1: number | null): p1 is number {
  return p1 != null && p1 >= P1_MIN_V2;
}

/** One scoring pass's shadow calls: the books' choice (compassModel scoreRows) on the shadow's own seats. */
export function shadowPick(rows: ShadowRow[], sessionDay: string): void {
  if (sessionDay !== day) {
    day = sessionDay;
    seats.clear();
    ids.clear();
  }
  const chosen: ShadowRow[] = [];
  for (const book of ['A', 'B'] as const) {
    const byRoot = new Map<string, ShadowRow[]>();
    for (const r of rows.filter(x => x.book === book)) {
      const list = byRoot.get(r.setup.ticker) ?? [];
      list.push(r);
      byRoot.set(r.setup.ticker, list);
    }
    for (const list of byRoot.values()) {
      const ret = list.find(r => Number.isFinite(r.retOpen))?.retOpen ?? NaN;
      const drive = Number.isFinite(ret) && Math.abs(ret) >= DRIVE;
      const best = (xs: ShadowRow[]) => xs.reduce((a, b) => (b.p1 > a.p1 ? b : a));
      const callsOf = list.filter(r => r.setup.right === 'C');
      const puts = list.filter(r => r.setup.right === 'P');
      if (drive) {
        const side = ret > 0 ? callsOf : puts;
        if (side.length) chosen.push(best(side));
        continue;
      }
      if (callsOf.length && puts.length) continue;
      chosen.push(best(list));
    }
  }
  const isDrive = (r: ShadowRow) => Number.isFinite(r.retOpen) && Math.abs(r.retOpen) >= DRIVE;
  chosen.sort((a, b) => Number(isDrive(b)) - Number(isDrive(a)) || b.p1 - a.p1);
  const anyDrive = chosen.some(isDrive);
  for (const r of chosen) {
    if (anyDrive && !isDrive(r)) continue;
    const key = `${r.setup.sleeve}|${r.setup.ticker}`;
    if (seats.has(key) || ids.has(r.setup.id)) continue;
    seats.add(key);
    ids.add(r.setup.id);
    const c: ShadowCall = {
      day: sessionDay, id: r.setup.id, contract: r.setup.contract, ticker: r.setup.ticker, sleeve: r.setup.sleeve, expiry: r.setup.expiryDate,
      right: r.setup.right, strike: r.setup.strike, book: r.book, mark: r.setup.mark ?? 0, flatAt: r.flatAt, bid: r.setup.bid, ask: r.setup.ask,
      ride: r.book === 'B' || (r.prun != null && r.prun >= PRUN_MIN_V2), session: r.session,
    };
    calls.push(c);
    if (calls.length > 500) calls.splice(0, calls.length - 500);
    for (const fn of fns) fn(c);
  }
}
