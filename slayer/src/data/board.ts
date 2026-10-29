/* The Board: one row per name with the Map's reads — regime and flip distance, the nearest wall, the supreme, net GEX
   on the Levels card's contracts, and the share that expires at the bell — off the same builders every page reads. */

import type { LevelRole } from '../core/walls';
import { buildAgenda, type Agenda, type AgendaOrder, type Target } from './agenda';
import { aheadClock, type AheadClock } from './ahead';
import { buildBuilding } from './building';
import { buildExposureProfile } from './exposure';
import { todayColumn, buildExposureSurface, CALENDAR_DTES, type ExposureSurface } from './exposureSurface';
import { buildFlipGauge, sessionFlipCrossings } from './flipGauge';
import { sessionLive } from './flipLevel';
import { nySessionPhase } from '../core/nyTime';
import { getBoardNames } from './boardNames';
import { peekDayMove, type DayMove, bookCandles, bookHistory, peekIv, snapshotOf, ensureOiChange, peekOiChange, peekBellShare, peekEntry, peekPriceAt, ensureScopeDates, scopeDatesPending, peekRecordAsked } from './uwBook';
import { levelsForName, type LevelsScope } from './levelsScope';
import { levelsBook, recordDay } from './bookWindow';
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
  /** When the price was printed (epoch ms) */
  priceAt: number | null;
  /** The regular session's change, percent — 0 while `day.dayPct` is not known */
  changePct: number;
  /** The day's move with the move outside the session kept apart (after hours / pre-market) */
  day: DayMove | null;
  /** Why "flip crossed today" has no count (today's book is no longer available), else null */
  crossWhy: string | null;
  /** This name's own levels. Not the desk's. */
  scope: LevelsScope;
  /** The book "flip crossed today" was counted against ("Today · Oct 22 · this morning's book") */
  crossLabel: string;
  /** The flip today's session ran against (may differ from `flip` after the close, which is the next session's) */
  crossFlip: number | null;
  /** The count's book is still loading — the cell says "…", not "not available" */
  crossPending: boolean;
  /** Under ten minutes of the session — the cell says the count starts at 9:40 */
  crossEarly: boolean;
  regime: 'LONG' | 'SHORT' | null;
  flip: number | null;
  /** Signed distance from spot to the flip, percent (+ = the flip is overhead) */
  flipDistPct: number | null;
  crossings: number | null;
  callWall: number;
  putWall: number;
  /** The wall nearer to spot, and how far it is */
  nearest: { kind: 'call' | 'put'; strike: number; distPct: number };
  /** The nearest wall's strike net, RETAIL sign — its words follow it (core/walls.ts) */
  nearestNet: number | null;
  supreme: number;
  /** Net GEX on the Levels card's contracts, in the RETAIL sign (the vendor's): positive = dealers long gamma, their
      hedging absorbs moves; negative = short gamma, it amplifies them. The house's internal sign is the opposite
      (core/walls.ts) — `retailNet` turns one into the other. */
  netGex: number;
  /** Share of the book's gamma that expires today, percent — null with `bellWhy` saying why */
  bellShare: number | null;
  /** Why there is no share: nothing on the name expires today, or the listing is not in yet */
  bellWhy: 'none' | 'wait' | null;
  /** The Levels card reads "Today" but this name's front-date strikes have not landed: shown as loading */
  pending: boolean;
  /** The session's closes, thinned for a sparkline */
  spark: number[];
  /** Your positions on the name: contracts owned or sold (0 = none) */
  yours: { positions: number; contracts: number };
  /** The agenda's first strike for this name — what to watch first, and why */
  watch: {
    strike: number;
    role: WallRole;
    /** every level the strike is, in the one order (core/walls.ts levelRoles) */
    roles: LevelRole[];
    isShelf: boolean;
    isWall: boolean;
    /** too thin to be a shelf or a trapdoor — the Agenda's own flag, so all three pages tag it alike (agenda.ts strikeKind) */
    flat: boolean;
    reach: number;
    /** today's session already traded through it — "reached today", never a chance (agenda.ts todayWords) */
    today: Target['today'];
    atPrice: boolean;
    hold: number;
    stake: number;
    horizon: string | null;
  } | null;
  /** The expiry the "Today" scope reads for this name (YYYY-MM-DD) — a later one when nothing expires that day */
  levelsDate: string | null;
}

const SPARK_POINTS = 48;

/** The house's net gamma (call-dominant NEGATIVE, core/walls.ts) in the sign a retail reader knows — the vendor's:
    positive = dealers long gamma = hedging absorbs moves; negative = short gamma = it amplifies them */
export const retailNet = (house: number): number => (house === 0 ? 0 : -house);

/** Net GEX, one number: every strike of the levels' contracts, retail sign (the profile's own net is its window). */
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

/** The desk's agenda for a name — one build for the Agenda page, the Board and Compare: the same window, open-interest
    change, vol and bars (the Agenda's Strikes card only trims what it lists). */
export function deskAgenda(snapshot: MarketSnapshot, expiry: ExposureExpiry, clock: AheadClock, order: AgendaOrder = 'matters', surface: ExposureSurface | null = null): Agenda | null {
  try {
    const t = snapshot.ticker;
    const iv = peekIv(t) ?? 0;
    ensureOiChange(t, 'top');
    const profile = buildExposureProfile(snapshot, expiry, LEVELS_WINDOW);
    /* nothing provisional: an agenda waits for its levels' contracts */
    if (snapshot.liveBook && profile.levels.complete === false) return null;
    const bars = bookCandles(t) ?? [];
    const building = buildBuilding(snapshot, bookHistory(t) ?? [], bars, profile, clock, peekOiChange(t));
    return buildAgenda(snapshot, profile, building, surface, bars, clock, iv, order);
  } catch {
    return null;
  }
}

/** The agenda's #1 for a name — what to watch first (the Board and Compare read it) — the Agenda page's own */
/* One watch-first: every page builds its agenda with the same 30-strike calendar surface. */
export const watchSurface = (snapshot: MarketSnapshot): ExposureSurface | null => {
  try {
    return buildExposureSurface(snapshot, 30, CALENDAR_DTES);
  } catch {
    return null;
  }
};

/** The watch-first, carried whole enough that every page classes and words it the Agenda's way (agenda.ts strikeKind) */
export const watchFrom = (lead: Target | null | undefined): BoardRow['watch'] =>
  lead ? { strike: lead.strike, role: lead.role, roles: lead.roles, isShelf: lead.isShelf, isWall: lead.isWall, flat: lead.flat, reach: lead.reach, today: lead.today, atPrice: !!lead.atPrice, hold: lead.hold, stake: lead.stake, horizon: lead.horizon } : null;

export function watchOf(snapshot: MarketSnapshot, expiry: ExposureExpiry, clock: AheadClock): BoardRow['watch'] {
  return watchFrom(deskAgenda(snapshot, expiry, clock, 'matters', watchSurface(snapshot))?.first[0]);
}

/** Thin a series to at most n points, keeping the ends */
const thin = (xs: number[], n: number): number[] => {
  if (xs.length <= n) return xs;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
  return out;
};

/* One row per state of the name's book: rebuilt when its own snapshot, scope, open-interest count or the session's
   minute moves — another name's book landing leaves it as it was. */
const rowMemo = new Map<string, { snap: MarketSnapshot; key: string; oi: unknown; row: BoardRow | null }>();
export function buildBoardRow(ticker: string): BoardRow | null {
  const snapshot = snapshotOf(ticker, 'board');
  if (!snapshot || !snapshot.chain.length) return null;
  const t = ticker.toUpperCase();
  const scope = levelsForName(t);
  /* keyed by what the row is built from: the snapshot (content-memoised in uwBook), the open-interest count, and the
     session clock's minute while it runs (the reach odds run on the minutes left) — a shut market's row holds */
  const clock = sessionLive() ? `m${Math.floor(Date.now() / 60_000)}` : `${nySessionPhase()}|${recordDay().date}`;
  const key = `${scope}|${clock}|${getPositions(t).length}|${scopeDatesPending(t)}|${JSON.stringify(peekBellShare(t))}`;
  const oi = peekOiChange(t);
  const hit = rowMemo.get(t);
  if (hit && hit.snap === snapshot && hit.key === key && hit.oi === oi) return hit.row;
  const row = buildBoardRowNow(ticker, snapshot);
  rowMemo.set(t, { snap: snapshot, key, oi, row });
  return row;
}
function buildBoardRowNow(ticker: string, snapshot: MarketSnapshot): BoardRow | null {
  const scope = levelsForName(ticker);
  let today;
  try {
    today = buildExposureProfile(snapshot, scope, LEVELS_WINDOW);
  } catch {
    return null;
  }
  const gauge = buildFlipGauge(snapshot);
  const spot = snapshot.spot;
  /* the one source: the supreme, walls, flip and net GEX are levelsFor's, and the row waits ("…") until they are final */
  const lv = levelsFor(ticker, scope);
  const callWall = lv?.callWall ?? today.levels.callWall;
  const putWall = lv?.putWall ?? today.levels.putWall;
  const supreme = lv?.supreme ?? today.levels.supreme;
  const dCall = ((callWall - spot) / spot) * 100;
  const dPut = ((putWall - spot) / spot) * 100;
  const nearest = Math.abs(dCall) <= Math.abs(dPut) ? { kind: 'call' as const, strike: callWall, distPct: dCall } : { kind: 'put' as const, strike: putWall, distPct: dPut };

  /* The bell's share: the vendor's gamma per expiry, today's date against every live date — the same number Compare,
     the Agenda and the Trader's Clock print. */
  const bell = peekBellShare(ticker);
  let surface: ExposureSurface | null = null;
  try {
    surface = buildExposureSurface(snapshot, 20, CALENDAR_DTES);
  } catch {
    /* no surface for this name yet */
  }

  const bars = bookCandles(ticker) ?? [];
  const mine = getPositions(snapshot.ticker);

  /* what to watch first: the agenda's #1 for this name */
  const watch = watchOf(snapshot, scope, aheadClock(readSessionClock()));
  const cross = sessionFlipCrossings(snapshot, scope);
  /* "not available" only once the session's own book has been asked for and is not there; until then, and while the
     count's flip is still provisional, the cell waits */
  const crossPending = (!!cross.why && !peekRecordAsked(ticker, recordDay().date)) || (!cross.why && !cross.complete);

  /* PENDING UNTIL THE SCOPE'S CONTRACTS ARE IN: "Today" needs the front date's strikes and its contract rows (the flip
     re-prices each with its own vol); "All expiries" needs every live date's strikes */
  if (scope === 'ALL') ensureScopeDates(ticker);
  /* one readiness signal: a row is final exactly when levelsFor says its levels are */
  const pending = !!snapshot.liveBook && (!lv || !lv.complete);
  const flip = lv ? lv.flip : gauge.flip;

  return {
    pending,
    scope,
    watch,
    levelsDate: lv?.date ?? null,
    yours: { positions: mine.length, contracts: mine.reduce((s, p) => s + p.contracts, 0) },
    ticker: snapshot.ticker,
    spot,
    priceAt: peekPriceAt(snapshot.ticker),
    changePct: peekDayMove(snapshot.ticker)?.dayPct ?? 0,
    day: peekDayMove(snapshot.ticker),
    regime: pending ? null : lv ? lv.regime : gauge.regime,
    flip: pending ? null : flip,
    flipDistPct: pending || flip == null || !(spot > 0) ? null : ((flip - spot) / spot) * 100,
    crossings: pending || crossPending ? null : cross.crossings,
    crossWhy: crossPending ? null : cross.why,
    crossPending,
    crossEarly: !!cross.early,
    crossLabel: cross.label,
    crossFlip: cross.flip,
    callWall,
    putWall,
    nearest,
    nearestNet: lv ? lv.netAt(nearest.strike) : null,
    supreme,
    netGex: lv ? lv.netGex : snapshot.liveBook ? netGexOf(levelsBook(snapshot, scope).chain) : retailNet(today.netGex),
    bellShare: bell.share,
    bellWhy: bell.share == null ? bell.why : null,
    spark: thin(bars.map(b => b.close), SPARK_POINTS),
  };
}

/** The names on the board — the list the user keeps (data/boardNames.ts) */
export function boardTickers(): string[] {
  return getBoardNames();
}

export function buildBoard(tickers: string[] = boardTickers()): BoardRow[] {
  const out: BoardRow[] = [];
  for (const t of tickers) {
    const row = buildBoardRow(t);
    if (row) out.push(row);
  }
  return out;
}
