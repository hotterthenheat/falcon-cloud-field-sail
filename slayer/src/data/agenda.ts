/*
==================================================
  SLAYER TERMINAL - TARGETS, THE AGENDA (data/agenda.ts)

  The Targets page rebuilt on the numbers the other
  pages now produce (2026-09-08). A target is a
  strike, and the question the page answers is the
  one a trader asks at the open: which levels do I
  watch today, in what order?

  THE ORDER IS ONE SENTENCE: how likely price gets
  there × how much happens if it does.

    reach   the odds price touches the strike by the
            close — the expected move for the minutes
            left, priced the way a barrier is (wall.ts)
    stake   the dollars that move when it does: the
            hedging sitting at the strike (pushing back
            or pushing along) plus what a move through
            it forces dealers to trade on the way to the
            next shelf (the hedge-flow ladder), against
            what it takes to move this name 1% today

    matters = reach × stake / what moves the name 1%

  A wall two expected moves away outranks nothing; a
  thin strike at spot outranks nothing; a wall at
  0.3σ holding a market's worth of hedging with a
  pocket behind it leads the day. Everything else on
  the row is the other pages' answers for that strike
  — holds or breaks (At the wall), built or drained
  today (Building), the odds the close lands there
  (Ahead) — so the reader never has to leave the
  list to know what a level is.

  The old five-factor composite (rankedtargets.ts —
  gamma, open interest, volume, neighbours, distance
  on uncalibrated weights) is gone: the Pulse Targets
  panel reads this too, so a strike is #1 on the desk
  for the same reason it is #1 on Pinpoint.
==================================================
*/

import { aheadWord, recordDay } from './bookWindow';
import { levelTicks } from './levelRecord';
import { nyIsoDate, nyMinutes } from '../core/nyTime';
import { buildCloseOdds, fmtDollars, fmtStrike, type AheadClock } from './ahead';
import { SHELF_SHARE } from './airPockets';
import { buildWallContext, pathFlowWords, chanceLabel, holdLabel, oddsAt, type WallContext, type WallOdds, type WallRole, type WallSide } from './wall';
import { bothWords, changeWhen, sizeWords, switchedWords, type Building, type BuildVerdict } from './building';
import { levelRoles, putWallWordsAt, wallPlace, type LevelRole } from '../core/walls';
import type { ExposureSurface } from './exposureSurface';
import type { ExposureProfileData } from '../types/gex';
import type { Candle, MarketSnapshot } from '../types/market';

/* ---- the orders --------------------------------------------------------------- */

export type AgendaOrder = 'matters' | 'nearest' | 'reached' | 'weakest' | 'biggest';

export const AGENDA_ORDERS: { value: AgendaOrder; label: string; hint: string }[] = [
  { value: 'matters', label: 'Matters most', hint: 'How likely price gets there × how much happens if it does' },
  { value: 'nearest', label: 'Nearest', hint: 'Closest to where price is now, first' },
  { value: 'reached', label: 'Most likely reached', hint: 'The odds price touches it by the close, highest first' },
  { value: 'weakest', label: 'Smallest wall', hint: 'The smallest wall on the chain first — the thinnest hedging in the way' },
  { value: 'biggest', label: 'Most at stake', hint: 'The most dollars moving if price gets there, first' },
];

/* ---- types ------------------------------------------------------------------------ */

export interface Target {
  /** In the chosen order, from 1 */
  rank: number;
  strike: number;
  side: WallSide;
  role: WallRole;
  pin: boolean;
  /** Hedging here pushes back. Else a trapdoor: it pushes the move along */
  isWall: boolean;
  /** Net gamma at the strike on the scope's contracts, RETAIL sign (+ dealers long gamma, absorbs), dollars per 1% */
  net: number;
  /** So little net gamma here (under FLAT_SHARE — the shelf's own share — of the window's heaviest strike) it is neither a shelf nor a trapdoor */
  flat: boolean;
  /** Every level the strike is, in the one order (core/walls.ts levelRoles): supreme · call wall · put wall */
  roles: LevelRole[];
  /** Pushes back AND holds at least a third of the heaviest strike — a wall or a shelf,
      the wall board's own rule. A thinner absorbing strike is not a wall and gets no odds */
  isShelf: boolean;
  /** Signed, percent of spot */
  distancePct: number;
  distanceSigma: number;
  /** Odds price touches it by the close (or by `horizon`), 0..1 */
  reach: number;
  /** Within half a strike step of price — reached already: the rows say "at price", and "Most likely reached" skips it */
  atPrice?: boolean;
  /** TODAY'S SESSION HAS ALREADY TRADED THROUGH IT (the eighth audit: "Most likely reached · 760 · 82%" with the low at
      759.14 and 760 tested 5–7 times on the Map): the session's range covers the strike, so it is reached — not a chance.
      The tests are the Map's report's own count (data/levelRecord.ts levelTicks) on the same cash bars — null counts when
      the bars are coarser than a minute (a Board name's 5-minute bars), where only "reached" is said */
  today: { tests: number | null; held: number | null; broke: number | null } | null;
  /** "by Nov 20" when the odds run to a later expiry than the coming session — null for the close */
  horizon: string | null;
  /** Odds it holds when reached, 0..1 — the floor for a trapdoor */
  hold: number;
  /** Dollars per 1% move at the strike: positive pushes back, negative pushes along */
  weight: number;
  weightEff: number;
  breakTo: number | null;
  breakFlow: number;
  pocket: boolean;
  holdTo: number | null;
  /** The latest change in the hedging here, dollars, and Building's word for it */
  build: number;
  /** The strike's net before and after the change, RETAIL sign — a strike that changed sides prints both (the eighth
      audit: 767 −$147M → +$122M read "shrank $25M") */
  buildFrom: number;
  buildTo: number;
  /** What the change measures: a call wall by its calls, a put wall by its puts, everything else by its net (building.ts) */
  buildBasis: 'calls' | 'puts' | 'net' | 'both';
  /** Both walls on one strike: each leg's size change (building.ts bothWords) */
  buildLegs?: { call: number; put: number };
  /** The change is the vendor's overnight open-interest count — named by the session it counts, never "today" */
  buildOvernight: boolean;
  /** "in Oct 21's trading" — the session the change counts (data/building.ts changeWhen) */
  buildWhen: string;
  /** The overnight count has not landed yet — the change is not known */
  buildLoading?: boolean;
  verdict: BuildVerdict;
  /** Odds the close lands on this strike, percent — 0 outside the band the close can reach */
  closes: number;
  /** Dollars that move if price gets there */
  stake: number;
  /** reach × stake against what moves the name 1% — the rank */
  matters: number;
  /** One clause: why it sits where it does under the chosen order */
  why: string;
  /** One clause: what happens there */
  words: string;
  odds: WallOdds;
  /** THE ROW'S CARD (2026-09-09, the three facts worth taking from the partner's
      ranked page — the contracts behind the dollars, the neighbours, the driver):
      open interest at the strike, in contracts */
  oi: { calls: number; puts: number };
  /** The strike against the two beside it, in words: "stands 2.8× above 489 and 491" */
  beside: string;
  /** Which half of reach × stake carried the rank */
  driver: 'odds' | 'size' | 'both';
}

export const DRIVER_WORDS: Record<Target['driver'], string> = {
  odds: 'on odds more than size',
  size: 'on size more than odds',
  both: 'on odds and size alike',
};

export interface Agenda {
  ticker: string;
  spot: number;
  marketPer1Pct: number;
  sigmaLeft: number;
  inSession: boolean;
  /** "by Nov 20" when the reach odds run to a later expiry than the coming session (data/wall.ts scopeSigma) */
  horizon: string | null;
  order: AgendaOrder;
  /** Every strike in the window, in the chosen order */
  targets: Target[];
  /** The first three by what matters, whatever the order — the day's sentence */
  first: Target[];
  mostReached: Target | null;
  weakestWall: Target | null;
  /** How many walls are in reach — one is "the only wall in reach", not the smallest */
  wallsInReach: number;
  /** The nearest wall price can plausibly reach — a named call or put wall or an absorbing shelf, whichever side */
  nearestWall: Target | null;
  /** The nearest wall in reach on each side of price (the fifth audit: "Nearest wall in reach 769" hid the call wall at
      770 right beside it — each side is named) */
  wallAbove: Target | null;
  wallBelow: Target | null;
  /** The strike the close most likely lands on — null when no strike is likely enough to call it a lean (LEAN_MIN) */
  closesNear: { strike: number; odds: number } | null;
  /** The best single strike's odds even when it is no lean, for the words */
  closeTop: { strike: number; odds: number } | null;
  sentence: string;
}

/* ---- helpers --------------------------------------------------------------------- */

const pct = chanceLabel;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtDollars(v)}`;
/** A wall in reach is one the day can plausibly get to */
const IN_REACH = 0.15;
/* ONE THRESHOLD EACH SIDE (the sixth audit, 2026-10-23: −$27M at 766 was a TRAPDOOR while +$27M at 771 and +$68M at
   772 carried no tag — the trapdoor's bar was 3% of the heaviest strike, the shelf's 35%). A strike is a shelf or a
   trapdoor only with SHELF_SHARE of the heaviest strike's net gamma, whichever its sign; under that it is too thin to be
   either and carries no tag. */
export const FLAT_SHARE = SHELF_SHARE;
/* ---- ONE CLASSIFIER, ONE INPUT, EVERYWHERE (the eighth audit's M1: 759 was "TRAPDOOR" on the Board and Compare and "too
   thin to be a trapdoor" on the Agenda — the Board's and Compare's copy never saw `flat`). The Agenda's rows, the Board's
   watch-first and Compare's all read the kind here, off the same Target fields. ---- */
export type StrikeKind = 'named' | 'shelf' | 'trapdoor' | 'thin';
export type KindInput = Pick<Target, 'isShelf' | 'role' | 'isWall' | 'flat'>;
/** What a strike is: a named level, a shelf (a wall the Map does not name), a trapdoor (its hedging pushes the move
    along), or too thin to be any of them */
export const strikeKind = (t: KindInput): StrikeKind => (t.isShelf ? (t.role ? 'named' : 'shelf') : t.isWall || t.flat ? 'thin' : 'trapdoor');
/** The tag a strike wears: every level it is, in the one order; else shelf or trapdoor; a thin strike wears none */
export const strikeTag = (t: KindInput & { roles?: readonly string[] }): string | null => {
  if (t.roles?.length) return t.roles.join(' · ');
  if (t.role) return t.role;
  const k = strikeKind(t);
  return k === 'shelf' ? 'shelf' : k === 'trapdoor' ? 'trapdoor' : null;
};
/** The thin strike's words: absorbing but light is no wall, pushing along but light is no trapdoor */
export const thinWords = (t: Pick<Target, 'isWall'>): string => (t.isWall ? 'too thin to be a wall' : 'too thin to be a trapdoor');

/** "reached today · held 5, broke 2" — a level the session already traded through says so, never a chance */
export const todayWords = (d: NonNullable<Target['today']>, short = false): string =>
  short || d.tests == null ? 'reached today' : d.tests === 0 ? 'reached today' : `reached today · held ${d.held}, broke ${d.broke}`;
/** The reached cell: at price · reached today · the chance */
export const reachWords = (t: Pick<Target, 'atPrice' | 'today' | 'reach'>, short = false): string => (t.atPrice ? 'at price' : t.today ? todayWords(t.today, short) : chanceLabel(t.reach));

/** Today's cash bars of the session on record — empty before today's open (the session on record is then a past one) */
function todayCash(bars: readonly Candle[]): Candle[] {
  const rec = recordDay();
  if (!rec.isToday) return [];
  return bars.filter(b => nyIsoDate(b.time * 1000) === rec.date && nyMinutes(b.time * 1000) >= 570 && nyMinutes(b.time * 1000) < 960);
}

/* "THE CLOSE LEANS TO 766 · 6%" IS NOT A LEAN (the retail test, 2026-10-23): one strike's odds have to reach this
   before the page says the close leans anywhere */
export const LEAN_MIN = 15;
/** How far a challenger must out-score the last watch-first to replace it (a share of the leader's score) */
const HOLD_LEAD = 0.12;
const leaderOf = new Map<string, number>();

/* the path's flow said with the way it leans (data/wall.ts pathFlowWords) — "pushes the move along" only when it does */
const flowWords = (flow: number, side: WallSide) => (flow === 0 ? '' : `, ${pathFlowWords(side, flow)}`);

function whyOf(t: Target, order: AgendaOrder, marketPer1Pct: number): string {
  const ratio = t.stake / Math.max(1, marketPer1Pct);
  switch (order) {
    case 'matters':
      return t.today ? `${todayWords(t.today, true)} · ${pct(t.reach)} to touch again × ${fmtDollars(t.stake)} at stake` : `${pct(t.reach)} reached × ${fmtDollars(t.stake)} at stake`;
    case 'nearest':
      return `${Math.abs(t.distancePct).toFixed(2)}% ${t.side === 'call' ? 'above' : 'below'} · ${t.distanceSigma.toFixed(1)}× the expected move`;
    case 'reached':
      return t.today ? `${todayWords(t.today)} · ${t.distanceSigma.toFixed(1)}× the expected move away` : `${pct(t.reach)} reached · ${t.distanceSigma.toFixed(1)}× the expected move away`;
    case 'weakest':
      return t.isShelf ? `${holdLabel(t.hold)} · ${reachWords(t)}${t.today ? '' : ' reached'}` : strikeKind(t) === 'thin' && !t.role ? thinWords(t) : t.role === 'put wall' ? 'the put wall — short gamma, so a break can accelerate' : 'a trapdoor — pushes the move along';
    case 'biggest':
      return `${fmtDollars(Math.abs(t.weight))} here + ${fmtDollars(Math.abs(t.breakFlow))} on the way through · ${ratio.toFixed(1)}× the market`;
  }
}

/** A strike against the strikes beside it — a spike is a sharper level than a step in a shelf */
function besideOf(strikes: readonly { strike: number; gex: { net: number } }[], i: number): string {
  const me = Math.abs(strikes[i].gex.net);
  const below = strikes[i - 1];
  const above = strikes[i + 1];
  const near = [below, above].filter((s): s is (typeof strikes)[number] => !!s);
  if (!near.length) return '';
  const heaviest = near.reduce((a, b) => (Math.abs(b.gex.net) > Math.abs(a.gex.net) ? b : a));
  const ratio = me / Math.max(1, Math.abs(heaviest.gex.net));
  const names = near.map(s => fmtStrike(s.strike)).join(' and ');
  if (ratio >= 2) return `stands ${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}× above ${names}`;
  if (ratio <= 0.5) return `in the shadow of ${fmtStrike(heaviest.strike)}, ${(1 / Math.max(ratio, 0.01)) >= 10 ? (1 / Math.max(ratio, 0.01)).toFixed(0) : (1 / Math.max(ratio, 0.01)).toFixed(1)}× heavier`;
  return `part of a shelf with ${names}`;
}

function wordsOf(o: WallOdds, shelf: boolean, flat = false): string {
  const dir = o.side === 'call' ? 'above' : 'below';
  const to = o.breakPath.to;
  const run = to == null ? `has no shelf behind it on the strikes shown` : `runs to ${fmtStrike(to)}${o.breakPath.pocket ? ' with almost nothing in between' : ''}${flowWords(o.breakPath.flow, o.side)}`;
  return shelf
    ? `${holdLabel(o.hold)}; a break ${dir} ${run}`
    : o.weight > 0
      ? `too thin to be a wall; a move ${dir} ${run}`
      : flat && !o.role
        ? `too thin to be a trapdoor; a move ${dir} ${run}`
        : o.role === 'put wall'
        ? `put wall: ${putWallWordsAt(o.side === 'call' ? 'above' : 'below')}; a move ${dir} ${run}`
        : `a trapdoor (dealers short gamma) — a move ${dir} through it ${run}`;
}

/* ---- the build ----------------------------------------------------------------- */

/** The least reach a strike's "matters most" score counts (see buildAgenda) */
const REACH_FLOOR = 0.0005;

export function buildAgenda(
  snapshot: MarketSnapshot,
  profile: ExposureProfileData,
  building: Building,
  surface: ExposureSurface | null,
  bars: readonly Candle[],
  clock: AheadClock,
  iv: number,
  order: AgendaOrder = 'matters'
): Agenda {
  const { ticker, spot } = snapshot;
  const ctx: WallContext = buildWallContext(snapshot, profile, building, surface, bars, clock, iv);
  const { marketPer1Pct, sigmaLeft } = ctx;
  /* Where the close lands, on the same expected move the reach odds use — the
     two questions (touch vs close) never disagree on the ruler */
  const close = buildCloseOdds(profile, spot, sigmaLeft, clock);
  const closesAt = new Map(close.rows.map(r => [r.strike, r.odds]));
  const buildAt = new Map(building.rows.map(r => [r.strike, r]));
  const nodeAt = new Map(snapshot.chain.map(n => [n.strike, n]));
  const asc = [...profile.strikes].sort((a, b) => a.strike - b.strike);
  const heaviestNet = Math.max(1, ...asc.map(s => Math.abs(s.gex.net)));
  /* TODAY'S SESSION SO FAR — a strike inside its range is reached already (todayWords); the counts only off minute bars */
  const cash = todayCash(bars);
  const lo = cash.length ? Math.min(...cash.map(b => b.low)) : Infinity;
  const hi = cash.length ? Math.max(...cash.map(b => b.high)) : -Infinity;
  const minuteBars = cash.length >= 2 && cash[1].time - cash[0].time <= 60;
  const todayAt = (k: number): Target['today'] => {
    if (!(k >= lo && k <= hi)) return null;
    if (!minuteBars) return { tests: null, held: null, broke: null };
    /* the Map's report's side rule (WallReportCard sideOf): a level at or above price is tested from below */
    const ticks = levelTicks(cash, k, k >= spot ? 'call' : 'put');
    const broke = ticks.filter(x => x.kind === 'broke').length;
    return { tests: ticks.length, held: ticks.length - broke, broke };
  };

  const targets: Target[] = asc
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => Math.abs(s.strike - spot) > 1e-9)
    .map(({ s, i }) => {
      const o = oddsAt(s.strike, ctx);
      const stake = Math.abs(o.weight) + Math.abs(o.breakPath.flow);
      const brow = buildAt.get(s.strike);
      const node = nodeAt.get(s.strike);
      const isShelf = o.weight > 0 && (Math.abs(s.gex.net) >= SHELF_SHARE * ctx.heaviest || o.role != null);
      const t: Target = {
        rank: 0,
        strike: s.strike,
        side: o.side,
        role: o.role,
        pin: !!s.pin,
        isWall: o.weight > 0,
        net: s.gex.net === 0 ? 0 : -s.gex.net,
        flat: Math.abs(s.gex.net) < FLAT_SHARE * heaviestNet,
        roles: levelRoles(s.strike, profile.levels),
        isShelf,
        distancePct: ((s.strike - spot) / spot) * 100,
        distanceSigma: o.distanceSigma,
        reach: o.reach,
        today: todayAt(s.strike),
        horizon: ctx.horizon,
        hold: o.hold,
        weight: o.weight,
        weightEff: o.weightEff,
        breakTo: o.breakPath.to,
        breakFlow: o.breakPath.flow,
        pocket: !!o.breakPath.pocket,
        holdTo: o.holdPath.to,
        /* the strike's ONE overnight change — Building's CHANGE column: the wall's size change, + grew, − shrank */
        build: brow?.sizeChange ?? 0,
        buildFrom: brow ? (brow.open === 0 ? 0 : -brow.open) : 0,
        buildTo: brow ? (brow.now === 0 ? 0 : -brow.now) : 0,
        buildBasis: brow?.basis ?? 'net',
        buildLegs: brow?.basis === 'both' ? { call: brow.callSize ?? 0, put: brow.putSize ?? 0 } : undefined,
        buildOvernight: building.overnight,
        buildWhen: changeWhen(building).short,
        buildLoading: building.loading,
        verdict: brow?.verdict ?? 'steady',
        closes: closesAt.get(s.strike) ?? 0,
        stake,
        /* A FLOOR UNDER THE REACH (the ninth audit's M5: NVDA's #7–#16 were 135…180 at "<1% reached × $0 at stake" above 220
           — $19M, $8 away — because every far reach underflowed to 0 and tied): a strike's reach counts for at least
           REACH_FLOOR, so among the strikes price is unlikely to reach the bigger stake still ranks first */
        matters: (Math.max(o.reach, REACH_FLOOR) * stake) / Math.max(1, marketPer1Pct),
        why: '',
        words: wordsOf(o, isShelf, Math.abs(s.gex.net) < FLAT_SHARE * heaviestNet),
        odds: o,
        oi: { calls: node?.callOI ?? 0, puts: node?.putOI ?? 0 },
        beside: besideOf(asc, i),
        driver: 'both',
      };
      return t;
    });
  /* THE DRIVER: each half of reach × stake against the window's best of it */
  const maxReach = Math.max(1e-9, ...targets.map(t => t.reach));
  const maxStake = Math.max(1, ...targets.map(t => t.stake));
  for (const t of targets) {
    const r = t.reach / maxReach;
    const s = t.stake / maxStake;
    t.driver = r >= s * 1.3 ? 'odds' : s >= r * 1.3 ? 'size' : 'both';
  }

  /* …and ties broken by the stake, then the distance (the ninth audit's M5) — one order, every time */
  const byMattersSort = (a: Target, b: Target) => b.matters - a.matters || b.stake - a.stake || Math.abs(a.distancePct) - Math.abs(b.distancePct) || a.strike - b.strike;
  const byMatters = [...targets].sort(byMattersSort);
  /* A LEADER IS KEPT UNTIL ANOTHER CLEARLY BEATS IT (the third audit, 2026-10-23: "Watch first" flipped 765 ↔ 762 on
     after-hours ticks of ±$0.15). The last leader stays first while it scores within HOLD_LEAD of the top; a
     challenger has to pass it by more than that to take the spot. */
  const key = `${ticker}|${profile.expiry}`;
  const prevLead = leaderOf.get(key);
  if (byMatters.length > 1 && prevLead != null && byMatters[0].strike !== prevLead) {
    const i = byMatters.findIndex(t => t.strike === prevLead);
    if (i > 0 && byMatters[i].matters >= byMatters[0].matters * (1 - HOLD_LEAD)) byMatters.unshift(...byMatters.splice(i, 1));
  }
  if (byMatters[0]) leaderOf.set(key, byMatters[0].strike);
  const sorters: Record<AgendaOrder, (a: Target, b: Target) => number> = {
    matters: byMattersSort,
    nearest: (a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct),
    reached: (a, b) => b.reach - a.reach || b.matters - a.matters,
    weakest: (a, b) => Number(b.isShelf) - Number(a.isShelf) || a.hold - b.hold || b.reach - a.reach,
    biggest: (a, b) => b.stake - a.stake,
  };
  const ordered = (order === 'matters' ? [...byMatters] : [...targets].sort(sorters[order])).map((t, i) => ({ ...t, rank: i + 1, why: whyOf(t, order, marketPer1Pct) }));

  /* THE WATCH-FIRST THREE ARE ALWAYS "MATTERS MOST" — the day's sentence and the Board's watch-first; the podium on the
     page shows the chosen order's own first three (TargetsBoard) */
  const first = byMatters.slice(0, 3).map(t => ordered.find(x => x.strike === t.strike) ?? t);
  /* NOT A STRIKE PRICE IS ALREADY ON (the fifth audit, 2026-10-23: "Most likely reached 764 · 99%" with spot at 763.96):
     strikes within half a strike step of price are taken as reached already and left out */
  /* ONE "AT PRICE" (the seventh audit's m5: half a strike step called CROX's 120 "at price" 0.82% away): the Board's
     and the read's own tolerance, core/walls.ts wallPlace — within 0.05% of price */
  const onPrice = (t: Target) => wallPlace(t.strike, spot) === 'at';
  /* …and the rows say so, so the head's "most likely reached" and the table read off the same set (the sixth audit's
     retail test: "Most likely reached 763 · 84%" over a row of 764 at 99%) */
  for (const t of ordered) t.atPrice = onPrice(t);
  /* …and neither is a strike the session has already traded through: it is reached, not likely (the eighth audit) */
  const reachable = ordered.filter(t => !onPrice(t) && !t.today);
  const mostReached = reachable.length ? reachable.reduce((a, b) => (b.reach > a.reach ? b : a)) : null;
  /* THE WALLS IN REACH ARE EVERY WALL THE TABLE NAMES (the retail test, 2026-10-23: "Only wall in reach 770 · the only
     one" above a row tagging 769 PUT WALL, nearer): the absorbing shelves and the named call and put walls alike */
  const isWallRow = (t: Target) => t.isShelf || t.role === 'call wall' || t.role === 'put wall' || t.roles.includes('call wall') || t.roles.includes('put wall');
  const wallsInReach = ordered.filter(t => isWallRow(t) && t.reach >= IN_REACH);
  const shelvesInReach = wallsInReach.filter(t => t.isShelf);
  const weakestWall = shelvesInReach.length ? shelvesInReach.reduce((a, b) => (b.hold < a.hold ? b : a)) : null;
  const nearestWall = wallsInReach.length ? wallsInReach.reduce((a, b) => (Math.abs(b.distancePct) < Math.abs(a.distancePct) ? b : a)) : null;
  const nearestOf = (xs: Target[]) => (xs.length ? xs.reduce((a, b) => (Math.abs(b.distancePct) < Math.abs(a.distancePct) ? b : a)) : null);
  const wallAbove = nearestOf(wallsInReach.filter(t => t.strike > spot));
  const wallBelow = nearestOf(wallsInReach.filter(t => t.strike < spot));
  const closeTop = close.top[0] ? { strike: close.top[0].strike, odds: close.top[0].odds } : null;
  const closesNear = closeTop && closeTop.odds >= LEAN_MIN ? closeTop : null;

  const lead = first[0];
  const sentence = lead
    ? `Watch ${fmtStrike(lead.strike)} first${lead.roles.length ? `, the ${lead.roles.join(' and the ')}` : lead.role ? `, the ${lead.role}` : ''}: ${lead.atPrice ? 'price is on it now' : lead.today ? `${lead.today.tests ? `already ${todayWords(lead.today)}` : 'already reached today'}` : `reached ${pct(lead.reach)} of the time ${ctx.horizon ?? (clock.inSession ? 'by the close' : aheadWord() === 'today' ? "by today's close" : 'by the next close')}`}, ${lead.isShelf ? `${holdLabel(lead.hold)}` : strikeKind(lead) === 'thin' && !lead.role ? thinWords(lead) : lead.role === 'put wall' ? 'short gamma there, so a break can accelerate' : 'a trapdoor (dealers short gamma there)'}; a ${lead.isShelf ? 'break' : 'move'} ${lead.side === 'call' ? 'above' : 'below'} ${lead.breakTo != null ? `runs to ${fmtStrike(lead.breakTo)}${flowWords(lead.breakFlow, lead.side)}` : 'has no shelf behind it'}.${
        first.length > 1 ? ` Then ${first.slice(1).map(t => fmtStrike(t.strike)).join(' and ')}.` : ''
      }`
    : 'No strikes on the window.';

  return { ticker, spot, marketPer1Pct, sigmaLeft, inSession: clock.inSession, horizon: ctx.horizon, order, targets: ordered, first, mostReached, weakestWall, wallsInReach: wallsInReach.length, nearestWall, wallAbove, wallBelow, closesNear, closeTop, sentence };
}

/** The agenda as the page lists it: the strikes within `half` of spot either side, numbered in the chosen order. The
    watch-first three, the sentence and the head's facts stay the desk's own (board.ts deskAgenda), so the page and the
    Board name the same strike. */
export function trimAgenda(agenda: Agenda, half: number): Agenda {
  const asc = [...new Set(agenda.targets.map(t => t.strike))].sort((a, b) => a - b);
  const above = asc.filter(k => k > agenda.spot).slice(0, half);
  const below = asc.filter(k => k < agenda.spot).slice(-half);
  const keep = new Set([...above, ...below]);
  const targets = agenda.targets.filter(t => keep.has(t.strike)).map((t, i) => ({ ...t, rank: i + 1 }));
  return { ...agenda, targets };
}

/** "The smallest wall in reach" — or "the only wall in reach" when it is alone */
export const weakestLabel = (a: Pick<Agenda, 'wallsInReach'>): string => (a.wallsInReach === 1 ? 'Only wall in reach' : 'Smallest wall in reach');

/** The head's wall fact: the nearest wall in reach, with every level it is — "769 · supreme · put wall" */
export const nearestWallLabel = (a: Pick<Agenda, 'wallsInReach'>): string => (a.wallsInReach === 1 ? 'Only wall in reach' : a.wallsInReach > 1 ? 'Nearest wall in reach' : 'Walls in reach');
export const targetName = (t: Pick<Target, 'strike' | 'roles' | 'isShelf'>): string => `${fmtStrike(t.strike)}${t.roles.length ? ` · ${t.roles.join(' · ')}` : t.isShelf ? ' · shelf' : ''}`;
/** The close in words: a lean only past LEAN_MIN, else "no clear lean" */
export const closeLeanWords = (a: Pick<Agenda, 'closesNear' | 'closeTop'>): string =>
  a.closesNear ? `${fmtStrike(a.closesNear.strike)} · ${a.closesNear.odds.toFixed(0)}%` : a.closeTop ? 'no clear lean' : '—';

/** Building's word for today's change at a strike, for the row */
export const buildWords = (t: Target, inSession: boolean): string =>
  t.buildLoading
    ? '…'
    : t.verdict === 'steady'
      ? 'steady'
      : `${t.verdict === 'switched' ? switchedWords(t.buildFrom, t.buildTo) : t.buildBasis === 'both' && t.buildLegs ? bothWords({ callSize: t.buildLegs.call, putSize: t.buildLegs.put }) : `${t.verdict === 'new' ? 'new' : t.verdict} · ${t.buildBasis === 'net' ? '' : `${t.buildBasis === 'calls' ? 'call' : 'put'} wall `}${sizeWords(t.build)}`}${t.buildOvernight ? ` ${t.buildWhen}` : inSession ? '' : ' last session'}`;
