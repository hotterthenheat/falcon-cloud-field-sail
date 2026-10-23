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
import { bookToday, isoDate } from '../core/calendar';
import { datesOf, yearsTo } from './flipLevel';
import { peekEntry, type OiChange } from './uwBook';
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
  /** |now| − |open| — the wall's size change, positive = built */
  sizeChange: number;
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
}

/** The change's time words: the vendor's count is set overnight from yesterday's trading — never "today" */
export const changeWhen = (b: Pick<Building, 'overnight' | 'inSession'>): { short: string; long: string; head: string } =>
  b.overnight
    ? { short: 'overnight', long: "in yesterday's trading (the overnight open-interest count)", head: 'Built overnight' }
    : b.inSession
      ? { short: 'today', long: 'today', head: 'Built today' }
      : { short: 'last session', long: 'in the last session', head: 'Built last session' };

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
export function valueOiChange(snapshot: MarketSnapshot, chain: readonly { strike: number }[], change: OiChange): Map<number, Valued> {
  const out = new Map<number, Valued>();
  const spot = snapshot.spot;
  const floor = isoDate(bookToday());
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
    let dg = 0;
    if (vendorGamma && vendorGamma > 0) dg = vendorGamma * per1;
    else if (oi && oi > 0 && gex) dg = Math.abs(gex) / oi;
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

export const sideWords = (v: number) => (v < 0 ? 'call-heavy, so dealers push back on moves here' : 'put-heavy, so dealers push moves along here');

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
  const hasOi = real || (today.length >= 2 && today.some(s => s.levels.some(l => l.callOI !== undefined)));
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
    const sizeChange = Math.abs(now) - Math.abs(open);
    const nowNode = chain.find(x => x.strike === K);
    const nowC = nowNode?.callGex ?? 0;
    const nowP = nowNode?.putGex ?? 0;
    legsAt.set(K, { nowC, nowP, openC: nowC - callAddedSigned, openP: nowP - putAddedSigned });

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
    const own = Math.max(Math.abs(now), Math.abs(open));
    const material = Math.abs(sizeChange) >= MATERIAL * own && Math.abs(sizeChange) >= FLOOR_SHARE * maxAbsBook;
    const switched = hasOi && Math.sign(now) !== Math.sign(open) && Math.abs(now) >= FLOOR_SHARE * maxAbsBook && Math.abs(open) >= FLOOR_SHARE * maxAbsBook;
    const verdict: BuildVerdict = isNew && material ? 'new' : switched ? 'switched' : material ? (sizeChange > 0 ? 'building' : 'draining') : 'steady';
    const byClose = real ? 0 : (sizeChange / elapsedMin) * minutesLeft;

    const role: BuildRole = K === levels.callWall ? 'call wall' : K === levels.putWall ? 'put wall' : K === levels.supreme ? 'supreme' : null;
    rows.push({ strike: K, role, roles: levelRoles(K, levels), pin: !!s.pin, now, open, callAdded, putAdded, dCall, dPut, sizeChange, shape, when, verdict, byClose, words: '' });
    maxAbs = Math.max(maxAbs, Math.abs(now));
    maxChange = Math.max(maxChange, Math.abs(callAdded), Math.abs(putAdded));
  }

  /* THE WORDS, once the scale is known — the verdict first, then the change,
     then what stands there (Noah, 2026-09-13: "easily understandable…
     word wise as well"); the strike itself is printed by the surface */
  const whenWords = (w: BuildRow['when']) => (w === 'early' ? 'mostly early in the day' : w === 'middle' ? 'mostly through the middle of the day' : w === 'late' ? 'mostly late in the day' : '');
  const when = changeWhen({ overnight: real, inSession: clock.inSession });
  const day = when.short;
  for (const r of rows) {
    /* NET GAMMA IN THE RETAIL SIGN, as every other page prints it (the retail test: "now $245M, put-heavy" here against
       −$245M elsewhere) */
    const stand = `now ${retail(r.now)}, ${sideWords(r.now)}`;
    if (!hasOi) {
      r.words = `No open interest on this feed yet — ${stand}.`;
      continue;
    }
    const dominant = Math.abs(r.callAdded) >= Math.abs(r.putAdded) ? 'calls' : 'puts';
    const change = `${signed(r.sizeChange)} ${day} (${fmtContracts(r.dCall)} calls, ${fmtContracts(r.dPut)} puts)`;
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
        r.words = `Changed sides, now ${r.now < 0 ? 'calls' : 'puts'}; it was ${r.open < 0 ? 'call-heavy' : 'put-heavy'} ${real ? 'before yesterday’s trading' : 'at the open'}. ${change} — ${stand}.${pace}`;
        break;
      case 'new':
        r.words = `New ${day}: nothing sat here ${real ? 'before yesterday’s trading' : 'at the open'}. ${change} — ${stand}.${pace}`;
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

  const built = rows.reduce((a, r) => a + Math.max(0, r.sizeChange), 0);
  const drained = rows.reduce((a, r) => a + Math.max(0, -r.sizeChange), 0);
  const byUp = [...rows].sort((a, b) => b.sizeChange - a.sizeChange);
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
        ? `moved from ${fmtStrike(open)} to ${fmtStrike(now)} ${real ? 'overnight' : 'today'}`
        : now != null
          ? real
            ? `at ${fmtStrike(now)}, where it was before yesterday's trading`
            : `at ${fmtStrike(now)} since the open`
          : name === 'Flip'
            ? 'no flip within ±10%'
            : `none — no ${name === 'Call wall' ? 'call' : 'put'} gamma in the window`;
    const ahead = real || close == null || now == null ? '' : close === now ? ` · holds ${horizon}` : ` · ${horizon} it moves to ${fmtStrike(close)}`;
    const chal = ch ? ` · ${fmtStrike(ch.strike)} grew the most ${name === 'Call wall' ? 'call' : 'put'} gamma${real ? ' overnight' : ''}, ${fmtDollars(ch.needs)} short${ch.by ? `, there by ${ch.by} at today's pace` : !real && ch.outrun ? ', but the wall is growing faster' : ''}` : '';
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
  if (!hasOi) sentence = 'Open interest is not on this feed yet, so nothing can be read as built or drained.';
  else {
    const parts: string[] = [];
    if (real) {
      /* THE OVERNIGHT COUNT, SAID AS ONE (the Pinpoint audit, 2026-10-22: "new hedging today" over a change that was set
         overnight from yesterday's trading) */
      if (fastestUp) parts.push(`${fmtStrike(fastestUp.strike)} grew most overnight: ${fmtDollars(fastestUp.sizeChange)} of hedging added in yesterday's trading${fastestUp.role ? `, and it is the ${fastestUp.role}` : ''}.`);
      if (fastestDown) parts.push(`${fmtStrike(fastestDown.strike)} shrank most, ${signed(fastestDown.sizeChange)}${fastestDown.role ? `, the ${fastestDown.role}` : ''}.`);
      if (!parts.length) parts.push('Nothing was built or drained in the overnight open-interest count.');
    } else if (clock.inSession) {
      if (fastestUp) parts.push(`${fmtStrike(fastestUp.strike)} is being built: ${fmtDollars(fastestUp.sizeChange)} of new hedging today${fastestUp.role ? `, and it is the ${fastestUp.role}` : ''}.`);
      if (fastestDown) parts.push(`${fmtStrike(fastestDown.strike)} is draining, ${signed(fastestDown.sizeChange)}${fastestDown.role ? `, the ${fastestDown.role}` : ''}.`);
      if (!parts.length) parts.push('Nothing has been built or drained today.');
    } else {
      if (fastestUp) parts.push(`${fmtStrike(fastestUp.strike)} was built in the last session: ${fmtDollars(fastestUp.sizeChange)} of new hedging${fastestUp.role ? `, and it is the ${fastestUp.role}` : ''}.`);
      if (fastestDown) parts.push(`${fmtStrike(fastestDown.strike)} drained, ${signed(fastestDown.sizeChange)}${fastestDown.role ? `, the ${fastestDown.role}` : ''}.`);
      if (!parts.length) parts.push('Nothing was built or drained in the last session.');
    }
    const ch = real ? '' : callCh?.by ? `At today's pace ${fmtStrike(callCh.strike)} overtakes ${fmtStrike(wNow.callWall!)} as the call wall by ${callCh.by}.` : putCh?.by ? `At today's pace ${fmtStrike(putCh.strike)} overtakes ${fmtStrike(wNow.putWall!)} as the put wall by ${putCh.by}.` : wNow.callWall != null && wClose.callWall === wNow.callWall && wNow.putWall != null && wClose.putWall === wNow.putWall ? `Both walls hold ${horizon}.` : '';
    if (ch) parts.push(ch);
    sentence = parts.join(' ');
  }

  const oiDates = real && oiChange?.lastDate && oiChange.currDate ? { from: oiChange.lastDate, to: oiChange.currDate } : null;
  return { ticker, spot, rows, maxAbs, maxChange, built, drained, fastestUp, fastestDown, spotAfter, elapsedMin, minutesLeft, inSession: clock.inSession, heading, sentence, hasOi, overnight: real, oiDates };
}
