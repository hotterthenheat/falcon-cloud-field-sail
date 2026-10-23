/*
==================================================
  SLAYER TERMINAL - WHAT'S BEING BUILT
  (data/building.ts)

  The fifth page of Pinpoint (2026-09-07). The Map
  says where the hedging sits. This says which of
  it arrived TODAY — strike by strike, the hedging
  added or taken off since the open, so a wall can
  be seen forming before it is the wall and
  draining before it breaks.

  THE ARITHMETIC. Every snapshot of the day carries
  open interest at each strike (calls and puts).
  The change since the first snapshot, valued at
  today's per-contract hedging (the chain's own
  units at the live spot), is the hedging that
  trading added:

      added(K) = Δcalls(K) · unitCall(K)
               + Δputs(K)  · unitPut(K)

  in the house sign (negative = call-dominant =
  dealers absorb, positive = put-dominant = they
  amplify). What was there at the open is what sits
  there now minus that. The wall's SIZE change —
  |now| − |open| — is the read: built or drained.
  Valuing both ends at today's spot keeps the price
  move out of it: a wall does not "build" because
  price walked toward it.

  THE PACE. Today's change over the minutes run
  gives dollars per minute; the same pace over the
  minutes left projects each strike to the close,
  and the walls re-picked on that projected book
  say where the levels are heading. A straight
  line, stated as one — not a forecast.

  ON REAL DATA the exchanges publish open interest
  overnight; the intraday figure is our estimate
  from the day's trades, and the guide says so.
==================================================
*/

import { sessionStarts } from './indicators';
import { levelRoles, pickLegWalls, type LevelRole } from '../core/walls';
import { DEFAULT_R } from '../core/carry';
import { dollarGammaPerContract } from '../core/gammaFlip';
import { bookToday, isoDate, isTradingDay } from '../core/calendar';
import { nyIsoDate, nySessionPhase } from '../core/nyTime';
import { recordDay } from './bookWindow';
import { datesOf, yearsTo } from './flipLevel';
import { ownIvDates, peekEntry, type OiChange } from './uwBook';
import { shownGamma } from '../components/gex/retailSign';
import { CLOSE_MIN, OPEN_MIN, SESSION_MIN, fmtDollars, fmtStrike, hhmm, type AheadClock } from './ahead';
import type { ExposureProfileData } from '../types/gex';
import type { Candle, GexSnapshot, MarketSnapshot } from '../types/market';

export type BuildRole = 'call wall' | 'put wall' | 'supreme' | null;
export type BuildVerdict = 'building' | 'draining' | 'steady' | 'switched' | 'new';

export interface BuildRow {
  strike: number;
  role: BuildRole;
  /** Every level the strike is, in the one order (core/walls.ts levelRoles) — 769 is "supreme · put wall" */
  roles: LevelRole[];
  pin: boolean;
  /** Net hedging at the strike now — signed dollars, house sign */
  now: number;
  /** What the open's contracts are worth at today's spot — same sign */
  open: number;
  /** Dollars of call hedging added today (negative = taken off) */
  callAdded: number;
  /** Dollars of put hedging added today (negative = taken off) */
  putAdded: number;
  /** Contracts */
  dCall: number;
  dPut: number;
  /** The change as the strike is printed, positive = built: a CALL WALL by its call gamma, a PUT WALL by its put gamma (the
      leg that makes it — levelsFor legsAt), the supreme and every other strike by |net now| − |net was| (the eighth audit's
      M2: the 765 call wall "shrank $341M" off its net while 8,499 calls were added to it) */
  sizeChange: number;
  /** What `sizeChange` measures — 'both' on a strike that is the call wall AND the put wall (and not the supreme): each
      role by its own leg, `callSize` and `putSize` (the ninth audit's M3: NVDA 212.50 "shrank $14M" off its net while
      6,018 calls and 4,549 puts were added) */
  basis: 'calls' | 'puts' | 'net' | 'both';
  /** The call leg's size change |now| − |was| (+ grew) — set when `basis` is 'both' */
  callSize?: number;
  /** The put leg's size change |now| − |was| (+ grew) — set when `basis` is 'both' */
  putSize?: number;
  /** |now| − |open| on the net, whatever the strike is — the totals' figure */
  netSizeChange: number;
  /** Net gamma now less what it was, in the RETAIL sign every page prints (calls +, puts −): the one change a strike shows
      — now − was = change, always (the fourth audit: "783 +$9M · was −$11M" beside a change of "−$2M") */
  change: number;
  /** The wall's size through the day, sampled, 0..1 of the row's own peak */
  shape: number[];
  /** Where most of the change landed: early · middle · late — null when nothing moved */
  when: 'early' | 'middle' | 'late' | null;
  verdict: BuildVerdict;
  /** Size change projected to the close at today's pace, dollars */
  byClose: number;
  /** The read line */
  words: string;
}

export interface Challenger {
  strike: number;
  /** Dollars still short of the wall's size */
  needs: number;
  /** "by 15:10" · null when today's pace never gets there */
  by: string | null;
  /** True when the wall itself is growing faster than its challenger */
  outrun: boolean;
}

export interface WallHeading {
  name: 'Call wall' | 'Put wall' | 'Supreme' | 'Flip';
  open: number | null;
  now: number | null;
  close: number | null;
  words: string;
  challenger: Challenger | null;
}

export interface Building {
  ticker: string;
  spot: number;
  rows: BuildRow[];
  /** The scale for the "now" capsules — largest |now| in the window */
  maxAbs: number;
  /** The scale for the change bars — largest |callAdded| or |putAdded| in the window */
  maxChange: number;
  /** Sum of every positive size change in the window */
  built: number;
  /** Sum of every negative size change (a positive number) */
  drained: number;
  fastestUp: BuildRow | null;
  fastestDown: BuildRow | null;
  /** Rows above spot, descending — the spot rule prints after this index */
  spotAfter: number;
  /** Minutes of trading behind the change */
  elapsedMin: number;
  minutesLeft: number;
  inSession: boolean;
  heading: WallHeading[];
  sentence: string;
  /** False when the snapshots carry no open interest at all */
  hasOi: boolean;
  /** True when the change is the vendor's overnight open-interest count (yesterday's trading), contract by contract —
      false when it is the day's volume walked onto the book (a book with no such count) */
  overnight: boolean;
  /** The open-interest dates the overnight change runs between, when it is the vendor's */
  oiDates: { from: string; to: string } | null;
  /** A live book whose overnight count has not landed yet — nothing is counted, the page prints "…" */
  loading: boolean;
}

/*
  THE OVERNIGHT COUNT, NAMED BY THE SESSION IT COUNTS (the fifth audit, 2026-10-23: at 01:00 ET Friday the change was
  called "yesterday's trading" while it was Wednesday's — OI 10-21 → 10-22; Thursday's count is set the next morning).
  The vendor's oi-change runs from the open interest of `last_date` to that of `curr_date`; the contracts opened and
  closed in between were traded on `last_date`'s session. The words name that session by its date, and say so when the
  latest finished session's count is not out yet.
*/
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monDay = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${MON[m - 1]} ${d}` : iso;
};
export interface OiWhen {
  /** "Oct 21's trading" — null when the count's dates are not known */
  trade: string | null;
  /** "in Oct 21's trading" */
  short: string;
  /** "Oct 21's trading (open interest 10-21 → 10-22)" */
  long: string;
  /** "Oct 21" — for a short head */
  day: string | null;
  /** "Oct 22's count is not out yet — it is set before the next open" — null when the count is the latest */
  pending: string | null;
}
export function oiWhen(dates: { from: string; to: string } | null | undefined): OiWhen {
  if (!dates) return { trade: null, short: 'in the overnight open-interest count', long: 'the overnight open-interest count', day: null, pending: null };
  const trade = `${monDay(dates.from)}'s trading`;
  /* the latest session that has finished: today's after its close, else the one before the session on record */
  const rec = recordDay();
  const finished = rec.done ? rec.date : lastSessionBefore(rec.date);
  /* WHEN THE NEXT ONE IS DUE, AND THAT IT IS WATCHED FOR (the seventh audit's retail finding): uwBook asks the vendor
     every five minutes while the count is behind, and reads it the moment it lands */
  const opened = nySessionPhase() !== 'before' && rec.date === nyIsoDate();
  const pending =
    dates.from < finished
      ? opened
        ? `${monDay(finished)}'s count is late today — the vendor usually has it out before the 9:30 open; checked every 5 minutes, used the moment it lands`
        : `${monDay(finished)}'s count is not out yet — the vendor publishes it before the 9:30 open; checked every 5 minutes, used the moment it lands`
      : null;
  return { trade, short: `in ${trade}`, long: `${trade} (open interest ${dates.from.slice(5)} → ${dates.to.slice(5)})`, day: monDay(dates.from), pending };
}
function lastSessionBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  for (let back = 1; back < 12; back++) {
    const p = new Date(y, m - 1, d - back);
    if (isTradingDay(p)) return isoDate(p);
  }
  return iso;
}

/** The change's time words: the vendor's count names the session it counts (oiWhen) — never "today" or "yesterday" */
export const changeWhen = (b: Pick<Building, 'overnight' | 'inSession'> & { oiDates?: Building['oiDates'] }): { short: string; long: string; head: string; drained: string; grew: string; shrank: string; pending: string | null } => {
  if (b.overnight) {
    const w = oiWhen(b.oiDates);
    return {
      short: w.short,
      long: w.long,
      head: w.day ? `Built ${w.day}` : 'Built overnight',
      drained: w.day ? `Drained ${w.day}` : 'Drained overnight',
      grew: w.day ? `Grew most ${w.day}` : 'Grew most overnight',
      shrank: w.day ? `Shrank most ${w.day}` : 'Shrank most overnight',
      pending: w.pending,
    };
  }
  return b.inSession
    ? { short: 'today', long: 'today', head: 'Built today', drained: 'Drained today', grew: 'Growing fastest', shrank: 'Fading fastest', pending: null }
    : { short: 'in the last session', long: 'in the last session', head: 'Built last session', drained: 'Drained last session', grew: 'Grew most', shrank: 'Shrank most', pending: null };
};

/** Net gamma in the retail sign a reader knows: "+$1.2B" / "−$245M" */
const retail = (house: number) => {
  const v = shownGamma(house);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtDollars(Math.abs(v))}`;
};

/* ---- the overnight change, valued contract by contract --------------------------------------------------------- */

interface Valued {
  dCall: number;
  dPut: number;
  /** House-signed dollars the change added: calls negative, puts positive */
  call: number;
  put: number;
}

/**
 * The vendor's open-interest change for the contracts in `chain` (one expiry, a sum of several, or every live one),
 * each contract valued at its OWN gamma: the vendor's per-contract gamma where its contract rows are in, else the
 * chain's own exposure per contract, else Black-Scholes at that contract's vol (or the expiry's at-the-money vol).
 * Expired contracts and dates outside the scope are left out.
 */
export function valueOiChange(snapshot: MarketSnapshot, chain: readonly { strike: number }[], change: OiChange, from?: string): Map<number, Valued> {
  const out = new Map<number, Valued>();
  const spot = snapshot.spot;
  /* `from`: the first expiry still counted — a past session's report counts its own (settled) date's contracts */
  const floor = from && from < isoDate(bookToday()) ? from : isoDate(bookToday());
  const scope = snapshot.liveBook ? datesOf(snapshot, chain as MarketSnapshot['chain']) : null;
  const inScope = (d: string) => d >= floor && (scope == null || scope === 'ALL' || scope.includes(d));
  const by = snapshot.uwByDate ?? {};
  const entry = peekEntry(snapshot.ticker);
  const nodeAt = new Map<string, Map<number, MarketSnapshot['chain'][number]>>();
  const node = (d: string, k: number) => {
    let m = nodeAt.get(d);
    if (!m) {
      m = new Map((by[d] ?? []).map(n => [n.strike, n]));
      nodeAt.set(d, m);
    }
    return m.get(k);
  };
  const per1 = spot * spot * 0.01 * 100;
  for (const r of change.rows) {
    if (!inScope(r.expiry)) continue;
    const n = node(r.expiry, r.strike);
    const call = r.right === 'C';
    const vendorGamma = call ? n?.callGamma : n?.putGamma;
    const oi = call ? n?.callOI : n?.putOI;
    const gex = call ? n?.callGex : n?.putGex;
    /* ONE PRICING FOR "NOW" AND THE CHANGE (the sixth audit, 2026-10-23): "now" is the vendor's live-book row — its
       gamma priced at the row's own price and minute (Thursday's 16:15 after the close) — but the change was valued at
       option-contracts' per-contract gamma, which the vendor re-prices live before the open, so "was" drifted between
       loads. The change is valued at the row's own pricing: the row's dollar gamma per contract (its exposure over the
       open interest it was computed on); a contract with no row exposure is priced by Black-Scholes at the row's price
       and minute. The vendor's live per-contract gamma is the last resort. */
    let dg = 0;
    if (oi && oi > 0 && gex) dg = Math.abs(gex) / oi;
    else if (n?.gexPx && n.gexPx > 0) {
      const iv = (call ? n?.callIv : n?.putIv) || entry?.termIv?.[r.expiry] || entry?.iv || 0;
      dg = dollarGammaPerContract(n.gexPx, r.strike, yearsTo(r.expiry, n.gexAt ?? undefined), iv, DEFAULT_R);
    } else if (vendorGamma && vendorGamma > 0) dg = vendorGamma * per1;
    else {
      const iv = (call ? n?.callIv : n?.putIv) || entry?.termIv?.[r.expiry] || entry?.iv || 0;
      dg = dollarGammaPerContract(spot, r.strike, yearsTo(r.expiry), iv, DEFAULT_R);
    }
    const cell = out.get(r.strike) ?? { dCall: 0, dPut: 0, call: 0, put: 0 };
    if (call) {
      cell.dCall += r.diff;
      cell.call += -r.diff * dg;
    } else {
      cell.dPut += r.diff;
      cell.put += r.diff * dg;
    }
    out.set(r.strike, cell);
  }
  return out;
}

/** A size change smaller than this share of the strike's own size reads as steady */
const MATERIAL = 0.1;
/** …and one under this share of the window's biggest strike is rounding, whatever its own size */
const FLOOR_SHARE = 0.005;
/** Points on each row's shape */
const SHAPE_POINTS = 40;

const fmtContracts = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')}`;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtDollars(v)}`;
/** A strike whose net changed sides, both figures in the RETAIL sign: "flipped from put-heavy to call-heavy (−$147M → +$122M)"
    — never "shrank $25M", which is the difference of two sizes on opposite sides (the eighth audit) */
export const switchedWords = (fromRetail: number, toRetail: number): string => {
  const side = (v: number) => (v > 0 ? 'call-heavy' : 'put-heavy');
  const f = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtDollars(Math.abs(v))}`;
  return `flipped from ${side(fromRetail)} to ${side(toRetail)} (${f(fromRetail)} → ${f(toRetail)})`;
};
/** A wall's size change in words — "grew $171M" / "shrank $171M" — never a sign beside a signed net (the seventh audit) */
export const sizeWords = (v: number): string => (Math.abs(v) < 0.5 ? 'held its size' : `${v > 0 ? 'grew' : 'shrank'} ${fmtDollars(Math.abs(v))}`);
/** A strike that is both walls, each role by its own leg: "calls grew $12M · puts grew $9M" */
export const bothWords = (r: Pick<BuildRow, 'callSize' | 'putSize'>): string =>
  [r.callSize != null ? `calls ${sizeWords(r.callSize)}` : null, r.putSize != null ? `puts ${sizeWords(r.putSize)}` : null].filter(Boolean).join(' · ');

/* NO BEHAVIOUR WORDS ON A $0 STRIKE (the ninth audit's m4: "$0 · put-heavy · dealers push moves along here") */
export const sideWords = (v: number) => (Math.abs(v) < 0.5 ? 'no gamma here' : v < 0 ? 'call-heavy, so dealers push back on moves here' : 'put-heavy, so dealers push moves along here');
/** The lean alone, for a compact cell: "call-heavy" · "put-heavy" · "no gamma" */
export const leanWord = (v: number) => (Math.abs(v) < 0.5 ? 'no gamma' : v < 0 ? 'call-heavy' : 'put-heavy');

/** Today's snapshots by the bars' own session cut — the same cut every session feature uses */
export function todaySnapshots(snaps: readonly GexSnapshot[], bars: readonly Candle[]): GexSnapshot[] {
  if (!snaps.length || !bars.length) return [];
  const starts = sessionStarts(bars, 1);
  const dayStart = bars[starts[starts.length - 1]].time;
  return snaps.filter(s => s.time >= dayStart);
}

export function buildBuilding(
  snapshot: MarketSnapshot,
  snaps: readonly GexSnapshot[],
  bars: readonly Candle[],
  profile: ExposureProfileData,
  clock: AheadClock,
  /** The vendor's open-interest change over the last session, contract by contract (uwBook's peekOiChange). When it is
      in, it is what was built — the day's volume walked onto the book is only the fallback, and only the shape of the day. */
  oiChange?: OiChange | null
): Building {
  const { ticker, spot } = snapshot;
  const today = todaySnapshots(snaps, bars);
  /* the contracts this book reads — the profile's own expiry, so a pane on another expiry than the Levels card values
     its own contracts */
  const chain = (snapshot.liveBook && snapshot.uwChains?.[profile.expiry]?.length ? snapshot.uwChains[profile.expiry] : snapshot.chain) ?? snapshot.chain;
  const valued = oiChange && oiChange.rows.length ? valueOiChange(snapshot, chain, oiChange) : null;
  const real = !!valued;
  /* NEVER THE VOLUME WALK ON A LIVE BOOK (the fourth audit's retail blocker: "Drained last session −$156.0B", "770 · was
     −$8.0B"): before the vendor's overnight count lands, the stand-in walked the WHOLE book's traded volume onto its open
     interest and valued it at the levels' own expiry's per-contract gamma — every expiry's volume at one date's units.
     On the live book the overnight count is the only measure; until it is in, nothing is counted, and the page says so */
  /* …and on a full book, until every in-scope date the count touches has its contract rows (each contract is valued at
     its own vendor gamma — before they land it is priced off the model, and the figures moved by a few million as they
     did) */
  const entry = snapshot.liveBook ? peekEntry(snapshot.ticker) : undefined;
  const scopeDates = snapshot.liveBook ? datesOf(snapshot, chain as MarketSnapshot['chain']) : null;
  const floor = isoDate(bookToday());
  /* ON WHAT IS ACTUALLY IN, NOT ON THE KIND OF BOOK (the seventh audit's M3, 2026-10-23: the Agenda's Building head
     read +$138M / −$584M at 15.9s and +$141M / −$549M at 16.5s — the gate only held on a book marked full). Every live
     date in scope that the count touches must have its chain and its contract rows read; a Board-only name reads the
     contracts of the dates its flip re-prices with their own vols (uwBook ownIvDates), and is held to those. */
  const by = snapshot.uwByDate ?? {};
  const liveDates = Object.keys(by).filter(d => d >= floor && by[d]?.length).sort();
  const own = ownIvDates(by, liveDates, liveDates[0]);
  const listed = new Set((entry?.expiries ?? []).map(e => e.date).filter(d => d >= floor));
  const touched = new Set(oiChange?.rows.filter(r => r.expiry >= floor && (scopeDates === 'ALL' || (Array.isArray(scopeDates) && scopeDates.includes(r.expiry)))).map(r => r.expiry) ?? []);
  const factsMissing =
    real &&
    !!entry &&
    [...touched].some(d => (by[d]?.length ? !entry.factsDates?.has(d) && (entry.wantFull || own.has(d)) : listed.has(d) && scopeDates !== 'ALL'));
  /* NO WHOLE-BOOK STAND-IN (the fifth audit, 2026-10-23: TSLA 420 read "+$25M" — final +$3M — and 400 "+$73.8M", the
     All figure, under "Today · Oct 23" while its chain loaded): until the scope's own chain is in, and its levels are
     final, nothing is printed but "…" */
  const scopeMissing = !!snapshot.liveBook && !snapshot.uwChains?.[profile.expiry]?.length;
  const levelsPending = !!snapshot.liveBook && profile.levels.complete === false;
  const loading = !!snapshot.liveBook && (!real || factsMissing || scopeMissing || levelsPending);
  const hasOi = (real && !loading) || (!snapshot.liveBook && today.length >= 2 && today.some(s => s.levels.some(l => l.callOI !== undefined)));
  const first = today[0];
  const last = today[today.length - 1];
  const elapsedMin = clock.inSession && clock.nowMin != null ? Math.max(30, clock.nowMin - OPEN_MIN) : SESSION_MIN;
  const minutesLeft = clock.minutesLeft;

  /* Per-contract hedging at today's spot — the chain's own units */
  const unit = new Map<number, { call: number; put: number; net: number }>();
  for (const n of chain) unit.set(n.strike, { call: n.callOI ? n.callGex / n.callOI : 0, put: n.putOI ? n.putGex / n.putOI : 0, net: n.netGex });

  const openAt = new Map<number, { c: number; p: number }>();
  if (hasOi) for (const l of first.levels) openAt.set(l.strike, { c: l.callOI ?? 0, p: l.putOI ?? 0 });
  const nowAt = new Map<number, { c: number; p: number }>();
  if (hasOi) for (const l of last.levels) nowAt.set(l.strike, { c: l.callOI ?? 0, p: l.putOI ?? 0 });

  /* Sampled OI through the day, per strike, for the shapes */
  const stepN = Math.max(1, Math.floor(today.length / SHAPE_POINTS));
  const sampled = today.filter((_, i) => i % stepN === 0 || i === today.length - 1);

  const { levels } = profile;
  const maxAbsBook = Math.max(1, ...profile.strikes.map(s => Math.abs(unit.get(s.strike)?.net ?? 0)));

  const rows: BuildRow[] = [];
  /* each strike's call and put legs at the open and now — the walls are the most call / put gamma (core/walls.ts) */
  const legsAt = new Map<number, { openC: number; openP: number; nowC: number; nowP: number }>();
  let maxAbs = 1;
  let maxChange = 1;
  for (const s of profile.strikes) {
    const K = s.strike;
    const u = unit.get(K) ?? { call: 0, put: 0, net: 0 };
    const now = u.net;
    const o = openAt.get(K);
    const n = nowAt.get(K) ?? { c: 0, p: 0 };
    const oc = real ? valued!.get(K) : undefined;
    const isNew = !real && hasOi && !o;
    const dCall = real ? (oc?.dCall ?? 0) : hasOi ? n.c - (o?.c ?? 0) : 0;
    const dPut = real ? (oc?.dPut ?? 0) : hasOi ? n.p - (o?.p ?? 0) : 0;
    /* Dollars in the house sign — call units are negative, so "calls added" is |dCall · unit|. The overnight count is
       valued contract by contract, each at its own gamma (valueOiChange) */
    const callAddedSigned = real ? (oc?.call ?? 0) : dCall * u.call;
    const putAddedSigned = real ? (oc?.put ?? 0) : dPut * u.put;
    const added = callAddedSigned + putAddedSigned;
    const open = now - added;
    const callAdded = real ? -(oc?.call ?? 0) : dCall * Math.abs(u.call);
    const putAdded = real ? (oc?.put ?? 0) : dPut * Math.abs(u.put);
    const netSizeChange = Math.abs(now) - Math.abs(open);
    const nowNode = chain.find(x => x.strike === K);
    const nowC = nowNode?.callGex ?? 0;
    const nowP = nowNode?.putGex ?? 0;
    legsAt.set(K, { nowC, nowP, openC: nowC - callAddedSigned, openP: nowP - putAddedSigned });
    /* THE LEG THAT MAKES THE LEVEL (the eighth audit's M2): a call wall is the most call gamma, so it grew when its call
       gamma grew; a put wall by its puts; the supreme (the most net) and every other strike by the net */
    const kRoles = levelRoles(K, levels);
    /* …AND A STRIKE THAT IS BOTH WALLS BY EACH LEG (the ninth audit's M3: NVDA 212.50, the call wall and the put wall, read
       "draining · shrank $14M" off its net while both legs grew) — the call wall's role by its calls, the put wall's by its
       puts, both said; only the supreme is read by the net */
    const isCall = kRoles.includes('call wall');
    const isPut = kRoles.includes('put wall');
    const basis: BuildRow['basis'] = kRoles.includes('supreme') ? 'net' : isCall && isPut ? 'both' : isCall ? 'calls' : isPut ? 'puts' : 'net';
    const callSize = Math.abs(nowC) - Math.abs(nowC - callAddedSigned);
    const putSize = Math.abs(nowP) - Math.abs(nowP - putAddedSigned);
    const legNow = basis === 'calls' ? nowC : basis === 'puts' ? nowP : basis === 'both' ? Math.abs(nowC) + Math.abs(nowP) : now;
    const legOpen = basis === 'calls' ? nowC - callAddedSigned : basis === 'puts' ? nowP - putAddedSigned : basis === 'both' ? Math.abs(nowC - callAddedSigned) + Math.abs(nowP - putAddedSigned) : open;
    const sizeChange = basis === 'net' ? netSizeChange : basis === 'both' ? callSize + putSize : Math.abs(legNow) - Math.abs(legOpen);

    /* The shape: the wall's size through the day at today's units */
    const series = sampled.map(snap => {
      const l = snap.levels.find(x => x.strike === K);
      return l ? Math.abs((l.callOI ?? 0) * u.call + (l.putOI ?? 0) * u.put) : 0;
    });
    const peak = Math.max(1, ...series);
    const shape = series.map(v => v / peak);
    let when: BuildRow['when'] = null;
    /* the vendor's change is session to session — it carries no time of day, so none is claimed */
    if (!real && series.length >= 3 && Math.abs(sizeChange) > 0) {
      const third = Math.floor(series.length / 3);
      const d1 = series[third] - series[0];
      const d2 = series[2 * third] - series[third];
      const d3 = series[series.length - 1] - series[2 * third];
      const dir = Math.sign(sizeChange);
      const parts = [d1 * dir, d2 * dir, d3 * dir];
      const spread = Math.max(...parts) - Math.min(...parts);
      const scale = Math.max(...parts.map(v => Math.abs(v)), 1);
      /* A straight ramp (today's volume walked onto the overnight print) is the same in every third.
         Calling that "early" is a false time of day. */
      if (spread / scale >= 0.2) {
        const i = parts.indexOf(Math.max(...parts));
        when = i === 0 ? 'early' : i === 1 ? 'middle' : 'late';
      }
    }

    /* MOVED IS MEASURED AGAINST THE STRIKE ITSELF (the second re-audit, 2026-10-22: "0 of 41 moved", every row steady,
       under "built overnight +$146M" — the bar was 5% of the book's biggest wall, which on SPY no single strike's change
       reached). A strike moved when its size changed by a tenth of what it holds (open or now, the larger), and by more
       than rounding: half a percent of the biggest wall in the window. */
    const own = Math.max(Math.abs(legNow), Math.abs(legOpen));
    const material = Math.abs(sizeChange) >= MATERIAL * own && Math.abs(sizeChange) >= FLOOR_SHARE * maxAbsBook;
    /* a wall's own leg cannot change sides — only a strike read by its net can */
    const switched = basis === 'net' && hasOi && Math.sign(now) !== Math.sign(open) && Math.abs(now) >= FLOOR_SHARE * maxAbsBook && Math.abs(open) >= FLOOR_SHARE * maxAbsBook;
    const verdict: BuildVerdict = !hasOi ? 'steady' : isNew && material ? 'new' : switched ? 'switched' : material ? (sizeChange > 0 ? 'building' : 'draining') : 'steady';
    const byClose = real ? 0 : (sizeChange / elapsedMin) * minutesLeft;

    const role: BuildRole = K === levels.callWall ? 'call wall' : K === levels.putWall ? 'put wall' : K === levels.supreme ? 'supreme' : null;
    /* the supreme that is also a wall keeps its net, and says each wall's leg beside it (the ninth audit's M3) */
    const wallLegs = basis === 'both' || (basis === 'net' && (isCall || isPut));
    rows.push({ strike: K, role, roles: kRoles, pin: !!s.pin, now, open, callAdded, putAdded, dCall, dPut, sizeChange, basis, ...(wallLegs ? { callSize: isCall ? callSize : undefined, putSize: isPut ? putSize : undefined } : {}), netSizeChange, change: shownGamma(now) - shownGamma(open), shape, when, verdict, byClose, words: '' });
    maxAbs = Math.max(maxAbs, Math.abs(now));
    maxChange = Math.max(maxChange, Math.abs(callAdded), Math.abs(putAdded));
  }

  /* THE WORDS, once the scale is known — the verdict first, then the change,
     then what stands there (Noah, 2026-09-13: "easily understandable…
     word wise as well"); the strike itself is printed by the surface */
  const whenWords = (w: BuildRow['when']) => (w === 'early' ? 'mostly early in the day' : w === 'middle' ? 'mostly through the middle of the day' : w === 'late' ? 'mostly late in the day' : '');
  const oiDates = real && oiChange?.lastDate && oiChange.currDate ? { from: oiChange.lastDate, to: oiChange.currDate } : null;
  const when = changeWhen({ overnight: real, inSession: clock.inSession, oiDates });
  const day = when.short;
  /* "before Oct 21's trading" — the state the count starts from */
  const before = real ? `before ${oiWhen(oiDates).trade ?? 'the overnight count'}` : 'at the open';
  for (const r of rows) {
    /* NET GAMMA IN THE RETAIL SIGN, as every other page prints it (the retail test: "now $245M, put-heavy" here against
       −$245M elsewhere) */
    const stand = `now ${retail(r.now)}, ${sideWords(r.now)}`;
    if (!hasOi) {
      /* nothing provisional while loading — not even the strike's "now", which may still be the whole book's */
      r.words = loading ? (scopeMissing || levelsPending ? 'Loading the contracts these levels are read from…' : 'Loading the overnight open-interest count…') : `No open interest on this feed yet — ${stand}.`;
      continue;
    }
    const dominant = Math.abs(r.callAdded) >= Math.abs(r.putAdded) ? 'calls' : 'puts';
    /* ONE SIGN FOR "THE CHANGE" (the fifth audit, 2026-10-23: 769 read "draining · net +$175M overnight" with CHANGE
       +$175M, while the head said "Shrank most 769 · −$175M" and the Map "−$175M taken off"): the change a strike shows
       is its wall's SIZE change, |now| − |was| — + grew, − shrank — the figure the CHANGE column, the head's grew/shrank
       most, the Agenda and the Map's report all print */
    /* THE CHANGE IN WORDS, NO SIGN TO MISREAD (the seventh audit's retail finding: "769 … −$595M net gamma · was −$766M
       … −$171M … DRAINING" — the net ROSE by $171M and the change read −$171M): the wall grew or shrank by so much.
       Building and draining are the wall's SIZE, never the contract counts — so where contracts were added and the wall
       still shrank, the words say why: calls and puts hedge in opposite directions, and the side that leans against the
       wall shrinks it */
    const callHeavy = r.now < 0 || (r.now === 0 && r.open < 0);
    const against = callHeavy ? { word: 'puts', n: r.dPut } : { word: 'calls', n: r.dCall };
    const why =
      r.verdict === 'draining' && against.n > 0
        ? `, though contracts were added: the ${fmtContracts(against.n).slice(1)} new ${against.word} hedge the opposite way to this ${callHeavy ? 'call' : 'put'}-heavy strike, so they offset it`
        : r.verdict === 'building' && (callHeavy ? r.dCall : r.dPut) < 0
          ? `, though contracts were closed: the ${callHeavy ? 'puts' : 'calls'} that left had been offsetting it`
          : '';
    const legWord = r.basis === 'calls' ? 'The call wall, read by its call gamma,' : r.basis === 'puts' ? 'The put wall, read by its put gamma,' : 'The wall';
    const change =
      r.verdict === 'switched'
        ? `It ${switchedWords(shownGamma(r.open), shownGamma(r.now))} ${day} (${fmtContracts(r.dCall)} calls, ${fmtContracts(r.dPut)} puts)`
        : r.basis === 'both'
          ? `It is the call wall and the put wall, each read by its own leg: ${bothWords(r)} ${day} (${fmtContracts(r.dCall)} calls, ${fmtContracts(r.dPut)} puts)`
          : `${legWord} ${sizeWords(r.sizeChange)} ${day} (${fmtContracts(r.dCall)} calls, ${fmtContracts(r.dPut)} puts)${r.basis === 'net' ? why : ''}${r.basis === 'net' && (r.callSize != null || r.putSize != null) ? `; as the ${[r.callSize != null ? 'call wall' : null, r.putSize != null ? 'put wall' : null].filter(Boolean).join(' and ')}, each read by its own leg: ${bothWords(r)}` : ''}`;
    const when = r.when ? `, ${whenWords(r.when)}` : '';
    const pace = clock.inSession && !real && r.verdict !== 'steady' ? ` At today's pace ${signed(r.byClose)} ${r.byClose >= 0 ? 'more' : 'further'} by the close.` : '';
    switch (r.verdict) {
      case 'building':
        r.words = `Building, ${dominant}. ${change}${when} — ${stand}.${pace}`;
        break;
      case 'draining':
        r.words = `Draining, ${dominant}. ${change}${when} — ${stand}.${pace}`;
        break;
      case 'switched':
        r.words = `Changed sides, now ${r.now < 0 ? 'calls' : 'puts'}; it was ${r.open < 0 ? 'call-heavy' : 'put-heavy'} ${before}. ${change} — ${stand}.${pace}`;
        break;
      case 'new':
        r.words = `New ${day}: nothing sat here ${before}. ${change} — ${stand}.${pace}`;
        break;
      default:
        /* steady is "small for this strike" — the change is still printed, with its share of the strike's size */
        {
          const own = Math.max(Math.abs(r.now), Math.abs(r.open));
          const share = own > 0 ? Math.abs(r.sizeChange) / own : 0;
          r.words =
            share >= MATERIAL
              ? `Too small to count. ${change} — under half a percent of the biggest strike here — ${stand}.`
              : `Little changed for its size. ${change}${own > 0 ? `, ${Math.round(share * 100)}% of what it holds` : ''} — ${stand}.`;
        }
    }
  }

  /* the totals are the book's own: every strike by its net, so a wall's leg is not counted on top of its strike */
  const built = rows.reduce((a, r) => a + Math.max(0, r.netSizeChange), 0);
  const drained = rows.reduce((a, r) => a + Math.max(0, -r.netSizeChange), 0);
  /* grew / shrank most: the change as each strike is printed — a strike that changed sides has no one size, so it is left out */
  const byUp = rows.filter(r => r.verdict !== 'switched').sort((a, b) => b.sizeChange - a.sizeChange);
  const fastestUp = byUp[0] && byUp[0].sizeChange > 0 ? byUp[0] : null;
  const fastestDown = byUp[byUp.length - 1] && byUp[byUp.length - 1].sizeChange < 0 ? byUp[byUp.length - 1] : null;
  const spotAfter = rows.findIndex(r => r.strike < spot);

  /* WHERE THE WALLS ARE HEADING — the levels re-picked on the open's book and on the projected one */
  type Pt = { strike: number; v: number; c: number; p: number };
  const legOf = (r: BuildRow) => legsAt.get(r.strike) ?? { openC: 0, openP: 0, nowC: 0, nowP: 0 };
  const openPts: Pt[] = rows.map(r => ({ strike: r.strike, v: r.open, c: legOf(r).openC, p: legOf(r).openP }));
  const nowPts: Pt[] = rows.map(r => ({ strike: r.strike, v: r.now, c: legOf(r).nowC, p: legOf(r).nowP }));
  /* the overnight count is one step between two sessions, not a pace through the day — nothing is projected off it */
  const pace = (a: number, b: number) => b + ((b - a) / elapsedMin) * minutesLeft;
  const closePts: Pt[] = real ? nowPts : rows.map(r => ({ strike: r.strike, v: pace(r.open, r.now), c: pace(legOf(r).openC, legOf(r).nowC), p: pace(legOf(r).openP, legOf(r).nowP) }));
  /* the most call gamma and the most put gamma (core/walls.ts pickLegWalls) — the Map's and the Agenda's rule */
  const walls = (pts: Pt[]) => pickLegWalls(pts, p => p.c, p => p.p);
  const supremeOf = (pts: { strike: number; v: number }[]) => pts.reduce<{ strike: number; v: number } | null>((b, p) => (!b || Math.abs(p.v) > Math.abs(b.v) ? p : b), null)?.strike ?? null;
  const wOpen = walls(openPts);
  const wNow = walls(nowPts);
  const wClose = walls(closePts);
  const horizon = clock.inSession ? 'by the close' : 'over the next session at that pace';

  const challengerFor = (side: 'call' | 'put', wall: number | null): Challenger | null => {
    if (wall == null) return null;
    const w = rows.find(r => r.strike === wall);
    if (!w) return null;
    /* a challenger grows the same leg: the most call (or put) gamma added */
    const legNow = (r: BuildRow) => Math.abs(side === 'call' ? legOf(r).nowC : legOf(r).nowP);
    const legGrew = (r: BuildRow) => legNow(r) - Math.abs(side === 'call' ? legOf(r).openC : legOf(r).openP);
    const cands = rows.filter(r => r.strike !== wall && legGrew(r) > 0);
    if (!cands.length) return null;
    const c = cands.sort((a, b) => legGrew(b) - legGrew(a))[0];
    const needs = legNow(w) - legNow(c);
    if (needs <= 0) return null;
    const rate = (legGrew(c) - legGrew(w)) / elapsedMin;
    let by: string | null = null;
    if (!real && rate > 0 && clock.inSession && clock.nowMin != null) {
      const t = needs / rate;
      if (t <= minutesLeft) by = hhmm(Math.min(CLOSE_MIN, Math.round(clock.nowMin + t)));
    }
    return { strike: c.strike, needs, by, outrun: rate <= 0 };
  };

  const levelWords = (name: string, open: number | null, now: number | null, close: number | null, ch: Challenger | null): string => {
    const moved =
      open != null && now != null && open !== now
        ? `moved from ${fmtStrike(open)} to ${fmtStrike(now)} ${real ? day : 'today'}`
        : now != null
          ? real
            ? `at ${fmtStrike(now)}, where it was ${before}`
            : `at ${fmtStrike(now)} since the open`
          : name === 'Flip'
            ? 'no flip within ±10%'
            : `none — no ${name === 'Call wall' ? 'call' : 'put'} gamma in the window`;
    const ahead = real || close == null || now == null ? '' : close === now ? ` · holds ${horizon}` : ` · ${horizon} it moves to ${fmtStrike(close)}`;
    const chal = ch ? ` · ${fmtStrike(ch.strike)} grew the most ${name === 'Call wall' ? 'call' : 'put'} gamma${real ? ` ${day}` : ''}, ${fmtDollars(ch.needs)} short${ch.by ? `, there by ${ch.by} at today's pace` : !real && ch.outrun ? ', but the wall is growing faster' : ''}` : '';
    return `${moved}${ahead}${chal}`;
  };

  const callCh = challengerFor('call', wNow.callWall);
  const putCh = challengerFor('put', wNow.putWall);
  const supOpen = supremeOf(openPts);
  const supNow = supremeOf(nowPts);
  const supClose = supremeOf(closePts);
  /* THE ONE FLIP (data/flipLevel.ts) — the book's zero crossing, re-priced at each price. No past book is on the feed to
     re-price, so the flip is today's alone */
  const flipNow = levels.flipFound === false ? null : levels.flip;
  const flipOpen = flipNow;
  const flipClose = flipNow;

  const heading: WallHeading[] = [
    { name: 'Call wall', open: wOpen.callWall, now: wNow.callWall, close: wClose.callWall, words: levelWords('Call wall', wOpen.callWall, wNow.callWall, wClose.callWall, callCh), challenger: callCh },
    { name: 'Put wall', open: wOpen.putWall, now: wNow.putWall, close: wClose.putWall, words: levelWords('Put wall', wOpen.putWall, wNow.putWall, wClose.putWall, putCh), challenger: putCh },
    { name: 'Supreme', open: supOpen, now: supNow, close: supClose, words: levelWords('Supreme', supOpen, supNow, supClose, null), challenger: null },
    { name: 'Flip', open: flipOpen, now: flipNow, close: flipClose, words: levelWords('Flip', flipOpen, flipNow, flipClose, null), challenger: null },
  ];

  /* THE SENTENCE */
  let sentence: string;
  if (!hasOi) sentence = loading ? (scopeMissing || levelsPending ? 'Loading the contracts these levels are read from…' : 'Loading the overnight open-interest count…') : 'Open interest is not on this feed yet, so nothing can be read as built or drained.';
  else {
    const parts: string[] = [];
    if (real) {
      /* THE OVERNIGHT COUNT, SAID AS ONE (the Pinpoint audit, 2026-10-22: "new hedging today" over a change that was set
         overnight from yesterday's trading) */
      if (fastestUp) parts.push(`${fmtStrike(fastestUp.strike)} grew most: its wall ${sizeWords(fastestUp.sizeChange)} ${day}${fastestUp.role ? `, and it is the ${fastestUp.role}` : ''}.`);
      if (fastestDown) parts.push(`${fmtStrike(fastestDown.strike)} shrank most: its wall ${sizeWords(fastestDown.sizeChange)}${fastestDown.role ? `, the ${fastestDown.role}` : ''}.`);
      if (!parts.length) parts.push(`Nothing was built or drained ${day}.`);
      if (when.pending) parts.push(`${when.pending}.`);
    } else if (clock.inSession) {
      if (fastestUp) parts.push(`${fmtStrike(fastestUp.strike)} is being built: ${fmtDollars(fastestUp.sizeChange)} of new hedging today${fastestUp.role ? `, and it is the ${fastestUp.role}` : ''}.`);
      if (fastestDown) parts.push(`${fmtStrike(fastestDown.strike)} is draining: its wall ${sizeWords(fastestDown.sizeChange)}${fastestDown.role ? `, the ${fastestDown.role}` : ''}.`);
      if (!parts.length) parts.push('Nothing has been built or drained today.');
    } else {
      if (fastestUp) parts.push(`${fmtStrike(fastestUp.strike)} was built in the last session: ${fmtDollars(fastestUp.sizeChange)} of new hedging${fastestUp.role ? `, and it is the ${fastestUp.role}` : ''}.`);
      if (fastestDown) parts.push(`${fmtStrike(fastestDown.strike)} drained: its wall ${sizeWords(fastestDown.sizeChange)}${fastestDown.role ? `, the ${fastestDown.role}` : ''}.`);
      if (!parts.length) parts.push('Nothing was built or drained in the last session.');
    }
    const ch = real ? '' : callCh?.by ? `At today's pace ${fmtStrike(callCh.strike)} overtakes ${fmtStrike(wNow.callWall!)} as the call wall by ${callCh.by}.` : putCh?.by ? `At today's pace ${fmtStrike(putCh.strike)} overtakes ${fmtStrike(wNow.putWall!)} as the put wall by ${putCh.by}.` : wNow.callWall != null && wClose.callWall === wNow.callWall && wNow.putWall != null && wClose.putWall === wNow.putWall ? `Both walls hold ${horizon}.` : '';
    if (ch) parts.push(ch);
    sentence = parts.join(' ');
  }

  return { ticker, spot, rows, maxAbs, maxChange, built, drained, fastestUp, fastestDown, spotAfter, elapsedMin, minutesLeft, inSession: clock.inSession, heading, sentence, hasOi, overnight: real || loading, oiDates, loading };
}
