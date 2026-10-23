/*
==================================================
  SLAYER TERMINAL - THE BOARD (data/board.ts)

  Every name the desk covers, one row each — the
  actual bird's-eye view (the Pinpoint roadmap,
  2026-09-05). Each row is the same four reads the
  Map makes for one name, made for all of them: the
  regime and how far the flip is, the nearest wall,
  the supreme, the net GEX on the Levels card's
  contracts, and how much of the book dies at the
  bell. Nothing is invented
  here: the profile builder, the flip gauge and the
  session tape are the ones every other surface
  reads, pointed at each name in turn.

  Built on the scan tier (the page re-runs it every
  ten seconds) — two profiles and a gauge per name,
  a few milliseconds each.
==================================================
*/

import Simulator from '../core/simulator';
import { buildAgenda, type Agenda, type AgendaOrder } from './agenda';
import { aheadClock, type AheadClock } from './ahead';
import { buildBuilding } from './building';
import { buildExposureProfile } from './exposure';
import { todayColumn, buildExposureSurface, CALENDAR_DTES, type ExposureSurface } from './exposureSurface';
import { buildFlipGauge, sessionFlipCrossings } from './flipGauge';
import { getBoardNames } from './boardNames';
import { peekDayMove, type DayMove, bookCandles, bookHistory, peekIv, snapshotOf, ensureOiChange, peekOiChange, peekBellShare, peekEntry, ensureScopeDates, scopeDatesPending } from './uwBook';
import { readLevelsScope } from './levelsScope';
import { levelsBook } from './bookWindow';
import { LEVELS_WINDOW } from './roomLevels';
import { levelsFor } from './levelsFor';
import { readSessionClock } from './moc';
import { getPositions } from './positions';
import type { WallRole } from './wall';
import type { ExposureExpiry } from '../types/gex';
import type { Candle, MarketSnapshot } from '../types/market';

export interface BoardRow {
  ticker: string;
  spot: number;
  /** The regular session's change, percent — 0 while `day.dayPct` is not known */
  changePct: number;
  /** The day's move with the move outside the session kept apart (after hours / pre-market) */
  day: DayMove | null;
  /** Why "flip crossed today" has no count (today's book is no longer available), else null */
  crossWhy: string | null;
  /** The book "flip crossed today" was counted against ("Today · Oct 22 · this morning's book") */
  crossLabel: string;
  /** The flip today's session ran against (may differ from `flip` after the close, which is the next session's) */
  crossFlip: number | null;
  regime: 'LONG' | 'SHORT' | null;
  flip: number | null;
  /** Signed distance from spot to the flip, percent (+ = the flip is overhead) */
  flipDistPct: number | null;
  crossings: number | null;
  callWall: number;
  putWall: number;
  /** The wall nearer to spot, and how far it is */
  nearest: { kind: 'call' | 'put'; strike: number; distPct: number };
  supreme: number;
  /** Net GEX on the Levels card's contracts, in the RETAIL sign (the vendor's): positive = dealers long gamma, their
      hedging absorbs moves; negative = short gamma, it amplifies them. The house's internal sign is the opposite
      (core/walls.ts) — `retailNet` turns one into the other. */
  netGex: number;
  /** Share of the book's gamma that expires today, percent — null with `bellWhy` saying why */
  bellShare: number | null;
  /** Why there is no share: nothing on the name expires today, or the listing is not in yet */
  bellWhy: 'none' | 'wait' | null;
  /** The Levels card reads "Today" but this name's front-date strikes have not landed: the levels above would be the
      whole book's, so the Board shows them as loading instead (the ship pass, 2026-10-22) */
  pending: boolean;
  /** The session's closes, thinned for a sparkline */
  spark: number[];
  /** Your positions on the name: contracts owned or sold (0 = none) */
  yours: { positions: number; contracts: number };
  /** The agenda's first strike for this name — what to watch first, and why (2026-09-08) */
  watch: { strike: number; role: WallRole; isShelf: boolean; isWall: boolean; reach: number; hold: number; stake: number } | null;
}

const SPARK_POINTS = 48;

/** The house's net gamma (call-dominant NEGATIVE, core/walls.ts) in the sign a retail reader knows — the vendor's:
    positive = dealers long gamma = hedging absorbs moves; negative = short gamma = it amplifies them */
export const retailNet = (house: number): number => (house === 0 ? 0 : -house);

/** NET GEX, ONE NUMBER (the ship pass, 2026-10-22): every strike of the contracts the levels are read from, in the
    retail sign — the Board's column, Compare's book line and the Map's "Net now · every strike" are this one sum
    (the profile's own net is its ±30-strike window, which on the whole book left the Board $1B short of the Map) */
export function netGexOf(chain: readonly { netGex: number }[]): number {
  let n = 0;
  for (const s of chain) n += s.netGex;
  return retailNet(n);
}

/** The net GEX hover, in words — and, where the book's net and the side of the flip disagree, why both are true */
export const netGexTitle = (net: number, regime: 'LONG' | 'SHORT' | null): string => {
  const base = net > 0 ? 'Net positive: dealers are long gamma overall, so their hedging tends to absorb moves' : net < 0 ? 'Net negative: dealers are short gamma overall, so their hedging tends to amplify moves' : 'Balanced';
  /* the regime IS this sign (data/flipLevel.ts), so the two can no longer disagree */
  void regime;
  return `${base}.`;
};

/** Share of the surface's gamma that expires today, percent — null without a today column */
export function bellShareOf(surface: ExposureSurface): number | null {
  const todayIdx = todayColumn(surface);
  if (todayIdx < 0) return null;
  let dies = 0;
  let total = 0;
  for (let e = 0; e < surface.expiries.length; e++)
    for (let s = 0; s < surface.strikes.length; s++) {
      const v = Math.abs(surface.net.gex[e][s] ?? 0);
      total += v;
      if (e === todayIdx) dies += v;
    }
  return total > 0 ? Math.round((100 * dies) / total) : null;
}

/**
 * THE DESK'S AGENDA FOR A NAME — ONE BUILD FOR EVERY PAGE (the retail test, 2026-10-22: "Watch first" read 765 on the
 * Agenda and 764 on the Board within 25s — the Agenda ranked its Strikes window, the Board thirty strikes, off two
 * different reads). The Agenda page, the Board and Compare all call this, with the same window, the same open-interest
 * change, the same vol and the same bars; the Agenda's Strikes card only trims what it lists (data/agenda.ts trimAgenda).
 */
export function deskAgenda(snapshot: MarketSnapshot, expiry: ExposureExpiry, clock: AheadClock, order: AgendaOrder = 'matters', surface: ExposureSurface | null = null): Agenda | null {
  try {
    const t = snapshot.ticker;
    const iv = peekIv(t) ?? 0;
    ensureOiChange(t);
    const profile = buildExposureProfile(snapshot, expiry, LEVELS_WINDOW);
    /* nothing provisional (the fourth audit's M1): an agenda waits for its levels' contracts */
    if (snapshot.liveBook && profile.levels.complete === false) return null;
    const bars = bookCandles(t) ?? [];
    const building = buildBuilding(snapshot, bookHistory(t) ?? [], bars, profile, clock, peekOiChange(t));
    return buildAgenda(snapshot, profile, building, surface, bars, clock, iv, order);
  } catch {
    return null;
  }
}

/** The agenda's #1 for a name — what to watch first (the Board and Compare read it) — the Agenda page's own */
/* ONE WATCH-FIRST (the second re-audit, 2026-10-22: "Watch first 765" read 86% on the Agenda and the Board and 89% on
   Compare): the Agenda page built its agenda with the 30-strike calendar surface, the Board and Compare with none, so the
   wall context (what expires today, the whole book's vanna) differed. Every page now builds the same surface. */
export const watchSurface = (snapshot: MarketSnapshot): ExposureSurface | null => {
  try {
    return buildExposureSurface(snapshot, 30, CALENDAR_DTES);
  } catch {
    return null;
  }
};

export function watchOf(snapshot: MarketSnapshot, expiry: ExposureExpiry, clock: AheadClock): BoardRow['watch'] {
  const lead = deskAgenda(snapshot, expiry, clock, 'matters', watchSurface(snapshot))?.first[0];
  return lead ? { strike: lead.strike, role: lead.role, isShelf: lead.isShelf, isWall: lead.isWall, reach: lead.reach, hold: lead.hold, stake: lead.stake } : null;
}

/** Thin a series to at most n points, keeping the ends */
const thin = (xs: number[], n: number): number[] => {
  if (xs.length <= n) return xs;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
  return out;
};

export function buildBoardRow(ticker: string): BoardRow | null {
  const snapshot = snapshotOf(ticker, 'board');
  if (!snapshot || !snapshot.chain.length) return null;
  let today;
  try {
    today = buildExposureProfile(snapshot, readLevelsScope(), LEVELS_WINDOW);
  } catch {
    return null;
  }
  const gauge = buildFlipGauge(snapshot);
  const spot = snapshot.spot;
  /* THE ONE SOURCE (data/levelsFor.ts — the Dossier's too, the fourth audit's m10): the supreme, the walls, the flip and
     net GEX the Board prints are levelsFor's, and the row waits ("…") until it says they are final */
  const lv = levelsFor(ticker, readLevelsScope());
  const callWall = lv?.callWall ?? today.levels.callWall;
  const putWall = lv?.putWall ?? today.levels.putWall;
  const supreme = lv?.supreme ?? today.levels.supreme;
  const dCall = ((callWall - spot) / spot) * 100;
  const dPut = ((putWall - spot) / spot) * 100;
  const nearest = Math.abs(dCall) <= Math.abs(dPut) ? { kind: 'call' as const, strike: callWall, distPct: dCall } : { kind: 'put' as const, strike: putWall, distPct: dPut };

  /* The bell's share: the vendor's own gamma per expiry (greek-exposure/expiry, kept on the book — data/uwBook.ts
     peekBellShare): today's date against every live date. The SAME number Compare, the Agenda and the Trader's Clock
     print, and it needs no per-expiry chains, so a name read for the Board alone has it too. The surface is still
     built for the watch-first read. */
  const bell = peekBellShare(ticker);
  let surface: ExposureSurface | null = null;
  try {
    surface = buildExposureSurface(snapshot, 20, CALENDAR_DTES);
  } catch {
    /* no surface for this name yet */
  }

  const bars = bookCandles(ticker) ?? [];
  const mine = getPositions(snapshot.ticker);

  /* WHAT TO WATCH FIRST — the agenda's #1 for this name, so the board is the
     morning list across every name (2026-09-08). ~2ms a name. */
  const watch = watchOf(snapshot, readLevelsScope(), aheadClock(readSessionClock()));
  const cross = sessionFlipCrossings(snapshot, readLevelsScope());

  /* PENDING UNTIL THE SCOPE'S CONTRACTS ARE IN: "Today" needs the front date's strikes and its contract rows (the flip
     re-prices each with its own vol); "All expiries" needs every live date's strikes */
  const scope = readLevelsScope();
  if (scope === 'ALL') ensureScopeDates(ticker);
  const entry = peekEntry(ticker);
  const pending =
    !!snapshot.liveBook &&
    (!lv || !lv.complete || (scope === '0DTE' ? !snapshot.uwChains?.['0DTE']?.length || (!entry?.full && !entry?.frontFacts) : scopeDatesPending(ticker)));
  const flip = lv ? lv.flip : gauge.flip;

  return {
    pending,
    watch,
    yours: { positions: mine.length, contracts: mine.reduce((s, p) => s + p.contracts, 0) },
    ticker: snapshot.ticker,
    spot,
    changePct: peekDayMove(snapshot.ticker)?.dayPct ?? 0,
    day: peekDayMove(snapshot.ticker),
    regime: pending ? null : lv ? lv.regime : gauge.regime,
    flip: pending ? null : flip,
    flipDistPct: pending || flip == null || !(spot > 0) ? null : ((flip - spot) / spot) * 100,
    crossings: pending ? null : cross.crossings,
    crossWhy: cross.why,
    crossLabel: cross.label,
    crossFlip: cross.flip,
    callWall,
    putWall,
    nearest,
    supreme,
    netGex: lv ? lv.netGex : snapshot.liveBook ? netGexOf(levelsBook(snapshot, readLevelsScope()).chain) : retailNet(today.netGex),
    bellShare: bell.share,
    bellWhy: bell.share == null ? bell.why : null,
    spark: thin(bars.map(b => b.close), SPARK_POINTS),
  };
}

/** The names on the board — the list the user keeps (data/boardNames.ts), not
    whatever the simulator happens to run (2026-09-09) */
export function boardTickers(): string[] {
  return getBoardNames();
}

/** Whether the simulator already carries a name — an unseeded one takes ~0.6s
    to walk its history in, so the Board seeds those one at a time */
export function boardNameSeeded(ticker: string): boolean {
  return !!Simulator.TICKERS[ticker.toUpperCase()];
}

export function buildBoard(tickers: string[] = boardTickers()): BoardRow[] {
  const out: BoardRow[] = [];
  for (const t of tickers) {
    const row = buildBoardRow(t);
    if (row) out.push(row);
  }
  return out;
}
