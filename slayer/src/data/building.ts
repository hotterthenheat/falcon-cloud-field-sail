/* Building: the hedging added or taken off at each strike, so a wall shows forming or draining. The overnight open-interest change
   is valued at each contract's own gamma (valueOiChange), in the house sign; a wall's |now| − |was| is built or drained. */

import { sessionStarts } from './indicators';
import { levelRoles, pickLegWalls, type LevelRole } from '../core/walls';
import { dollarGammaPerContract } from '../core/gammaFlip';
import { bookToday, isoDate, isTradingDay, nextSession, sessionBefore, today as nyTodayDate, MONTHS as MON } from '../core/calendar';
import { nyIsoDate, nyMinutes, nySessionPhase } from '../core/nyTime';
import { recordDay } from './bookWindow';
import { datesOf, noFlipWords, smileOf, yearsTo } from './flipLevel';
import { ownIvDates } from './book/scale';
import { datesComplete, peekEntry } from './book/store';
import type { OiChange, OiSource } from './book/oiChange';
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
  /** The change as the strike is printed, positive = built: a call wall by its call gamma, a put wall by its put gamma, every other strike by |net now| − |net was|. */
  sizeChange: number;
  /** What `sizeChange` measures; 'both' on a strike that is the call wall and the put wall (not the supreme), each role by its own leg. */
  basis: 'calls' | 'puts' | 'net' | 'both';
  /** The call leg's size change |now| − |was| (+ grew) — set when `basis` is 'both' */
  callSize?: number;
  /** The put leg's size change |now| − |was| (+ grew) — set when `basis` is 'both' */
  putSize?: number;
  /** |now| − |open| on the net, whatever the strike is — the totals' figure */
  netSizeChange: number;
  /** Net gamma now less what it was, in the retail sign (calls +, puts −): now − was = change, always. */
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
  /** The read line's words; for a level with no strike they say why — "…" while it is still being read (`pending`),
      "none — …" for a final reading that has none */
  words: string;
  challenger: Challenger | null;
  /** The level's contracts or pricing are still landing: nothing is drawn, the row prints "…" */
  pending?: boolean;
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
  /** True when the change is the overnight open-interest count (yesterday's trading), contract by contract —
      false when it is the day's volume walked onto the book (a book with no such count) */
  overnight: boolean;
  /** The open-interest report dates the overnight change runs between */
  oiDates: { from: string; to: string } | null;
  /** Where the overnight change came from: every listed contract ('terminal'), or the shorter movers' list ('movers') */
  oiSource: OiSource | null;
  /** The complete source's count of contracts listed in the later report */
  oiListed: number | null;
  /** A live book whose overnight count has not landed yet — nothing is counted, the page prints "…" */
  loading: boolean;
}

const monDay = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${MON[m - 1]} ${d}` : iso;
};
interface OiWhen {
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
export function oiWhen(dates: { from: string; to: string } | null | undefined, source: OiSource | null = null): OiWhen {
  if (!dates) return { trade: null, short: 'in the overnight open-interest count', long: 'the overnight open-interest count', day: null, pending: null };
  const trade = `${monDay(dates.from)}'s trading`;
  /* the latest session that has finished: today's after its close, else the one before the session on record */
  const rec = recordDay();
  const finished = rec.done ? rec.date : lastSessionBefore(rec.date);
  /* When the next count is due: data/book/oiChange.ts looks again every five minutes from the stamp (06:35 ET for the complete reports, 07:00 for the movers' list) on a trading day while the count is behind. */
  /* …said from where the clock stands: after the close a count is not late, it is due before the next open. */
  const phase = nySessionPhase();
  const tradingToday = isTradingDay(nyTodayDate());
  const late = tradingToday && phase === 'open' && rec.date === nyIsoDate();
  /* the complete reports are stamped about 06:30 ET and looked for from 06:35; the movers' list from 07:00 */
  const terminal = source === 'terminal';
  const lookFrom = terminal ? '06:35' : '07:00';
  const due = terminal ? 'the report is stamped about 06:30 ET' : 'it is usually out before the 9:30 open';
  const watching = tradingToday && phase === 'before' && nyMinutes() >= (terminal ? 6 * 60 + 35 : 7 * 60);
  const nextOpen = tradingToday && phase === 'before' ? null : nextSessionWord();
  const pending =
    dates.from < finished
      ? late
        ? `${monDay(finished)}'s count is late today — ${due}; checked every 5 minutes, used the moment it lands`
        : watching
          ? `${monDay(finished)}'s count is not out yet — ${due}; checked every 5 minutes, used the moment it lands`
          : nextOpen
            ? `${monDay(finished)}'s count is due before ${nextOpen}'s open; this is ${monDay(dates.from)}'s — looked for from ${lookFrom} ET that morning`
            : `${monDay(finished)}'s count is due before today's 9:30 open; this is ${monDay(dates.from)}'s — looked for from ${lookFrom} ET`
      : null;
  return { trade, short: `in ${trade}`, long: `${trade} (open interest ${dates.from.slice(5)} → ${dates.to.slice(5)})`, day: monDay(dates.from), pending };
}

/** Which count Building values and which two reports it compares, for the hover text — no vendor named:
    "every listed contract: the open-interest reports of Oct 27 and Oct 28 (each stamped about 06:30 ET for the close
    before), compared contract by contract" */
export function oiSourceWords(b: Pick<Building, 'oiSource' | 'oiDates' | 'oiListed'>): string {
  const d = b.oiDates;
  const pair = d ? `the open-interest reports of ${monDay(d.from)} and ${monDay(d.to)}` : 'the two latest open-interest reports';
  if (b.oiSource === 'terminal')
    return `Source: every listed contract${b.oiListed ? ` (${b.oiListed.toLocaleString('en-US')} in the later report)` : ''} — ${pair}, each stamped about 06:30 ET for the close before, compared contract by contract`;
  if (b.oiSource === 'movers')
    return `Source: the shorter list of the contracts whose open interest moved most — the complete reports could not be read just now, so smaller changes are left out; ${pair} compared`;
  return '';
}
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The next session's weekday, from after today: "Monday" */
function nextSessionWord(): string {
  const t = nyTodayDate();
  return DOW_LONG[nextSession(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)).getDay()];
}
function lastSessionBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(sessionBefore(new Date(y, m - 1, d)));
}

/** The change's time words: the count names the session it counts (oiWhen) — never "today" or "yesterday" */
export const changeWhen = (b: Pick<Building, 'overnight' | 'inSession'> & { oiDates?: Building['oiDates']; oiSource?: Building['oiSource'] }): { short: string; long: string; head: string; drained: string; grew: string; shrank: string; pending: string | null } => {
  if (b.overnight) {
    const w = oiWhen(b.oiDates, b.oiSource ?? null);
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
  /** The same change valued at the vendor row's own per-contract gamma; on a same-day contract the main figure uses a steady gamma,
      and a direction the two disagree on is noise. */
  callAlt?: number;
  putAlt?: number;
  put: number;
}

/** The open-interest change (the complete reports, else the movers' list) for the contracts in `chain`, each valued at its own gamma: the vendor's per-contract gamma,
    else the chain's exposure per contract, else Black-Scholes at that contract's (or the expiry's ATM) vol. Expired and out-of-scope dates are left out. */
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
  const smiles = new Map<string, (k: number) => number>();
  const smileAt = (d: string, k: number, px: number) => {
    let f = smiles.get(d);
    if (!f) {
      f = smileOf(by[d] ?? [], px);
      smiles.set(d, f);
    }
    return f(k);
  };
  for (const r of change.rows) {
    if (!inScope(r.expiry)) continue;
    const n = node(r.expiry, r.strike);
    const call = r.right === 'C';
    const vendorGamma = call ? n?.callGamma : n?.putGamma;
    const oi = call ? n?.callOI : n?.putOI;
    const gex = call ? n?.callGex : n?.putGex;
    /* One pricing for "now" and the change: the row's own dollar gamma per contract (its exposure over the OI it was computed on);
       a contract with no row exposure is priced by Black-Scholes at the row's price and minute; the vendor's live per-contract gamma is the last resort. */
    let dg = 0;
    if (oi && oi > 0 && gex) dg = Math.abs(gex) / oi;
    else if (n?.gexPx && n.gexPx > 0) {
      const iv = (call ? n?.callIv : n?.putIv) || entry?.termIv?.[r.expiry] || entry?.iv || 0;
      dg = dollarGammaPerContract(n.gexPx, r.strike, yearsTo(r.expiry, n.gexAt ?? undefined), iv);
    } else if (vendorGamma && vendorGamma > 0) dg = vendorGamma * per1;
    else {
      const iv = (call ? n?.callIv : n?.putIv) || entry?.termIv?.[r.expiry] || entry?.iv || 0;
      dg = dollarGammaPerContract(spot, r.strike, yearsTo(r.expiry), iv);
    }
    /* A same-day contract is valued at a steady gamma (Black-Scholes at the row's price and minute, at the smile's vol for its strike):
       its row gamma near the bell jumps between reads. The row's figure is kept beside it (`callAlt`/`putAlt`). */
    const px = n?.gexPx && n.gexPx > 0 ? n.gexPx : spot;
    const tLeft = yearsTo(r.expiry, n?.gexAt ?? undefined);
    let dgMain = dg;
    if (tLeft < 1 / 365) {
      const vol = smileAt(r.expiry, r.strike, px) || (call ? n?.callIv : n?.putIv) || entry?.termIv?.[r.expiry] || 0;
      const steady = vol > 0 ? dollarGammaPerContract(px, r.strike, tLeft, vol) : 0;
      if (steady > 0 || dg === 0) dgMain = steady;
    }
    const cell = out.get(r.strike) ?? { dCall: 0, dPut: 0, call: 0, put: 0, callAlt: 0, putAlt: 0 };
    if (call) {
      cell.dCall += r.diff;
      cell.call += -r.diff * dgMain;
      cell.callAlt = (cell.callAlt ?? 0) + -r.diff * dg;
    } else {
      cell.dPut += r.diff;
      cell.put += r.diff * dgMain;
      cell.putAlt = (cell.putAlt ?? 0) + r.diff * dg;
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
/** A strike whose net changed sides, both figures in the retail sign, never the difference of two sizes on opposite sides. */
export const switchedWords = (fromRetail: number, toRetail: number): string => {
  const side = (v: number) => (v > 0 ? 'call-heavy' : 'put-heavy');
  const f = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtDollars(Math.abs(v))}`;
  return `flipped from ${side(fromRetail)} to ${side(toRetail)} (${f(fromRetail)} → ${f(toRetail)})`;
};
/** A wall's size change in words ("grew $171M" / "shrank $171M"), never a sign beside a signed net. */
export const sizeWords = (v: number): string => (Math.abs(v) < 0.5 ? 'held its size' : `${v > 0 ? 'grew' : 'shrank'} ${fmtDollars(Math.abs(v))}`);
/** A strike that is both walls, each role by its own leg: "calls grew $12M · puts grew $9M" */
export const bothWords = (r: Pick<BuildRow, 'callSize' | 'putSize'>): string =>
  [r.callSize != null ? `calls ${sizeWords(r.callSize)}` : null, r.putSize != null ? `puts ${sizeWords(r.putSize)}` : null].filter(Boolean).join(' · ');

/* No behaviour words on a $0 strike. */
export const sideWords = (v: number) => (Math.abs(v) < 0.5 ? 'no gamma here' : v < 0 ? 'call-heavy, so dealers push back on moves here' : 'put-heavy, so dealers push moves along here');
/** The lean alone, for a compact cell: "call-heavy" · "put-heavy" · "no gamma" */
export const leanWord = (v: number) => (Math.abs(v) < 0.5 ? 'no gamma' : v < 0 ? 'call-heavy' : 'put-heavy');

/** Today's snapshots by the bars' own session cut — the same cut every session feature uses */
function todaySnapshots(snaps: readonly GexSnapshot[], bars: readonly Candle[]): GexSnapshot[] {
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
  /** The open-interest change over the last session, contract by contract (uwBook's peekOiChange: the complete
      reports, else the movers' list). When it is in, it is what was built — the day's volume walked onto the book is only the fallback, and only the shape of the day. */
  oiChange?: OiChange | null
): Building {
  const { ticker, spot } = snapshot;
  const today = todaySnapshots(snaps, bars);
  /* the contracts this book reads — the profile's own expiry, so a pane on another expiry than the Levels card values
     its own contracts */
  const chain = (snapshot.liveBook && snapshot.uwChains?.[profile.expiry]?.length ? snapshot.uwChains[profile.expiry] : snapshot.chain) ?? snapshot.chain;
  const valued = oiChange && oiChange.rows.length ? valueOiChange(snapshot, chain, oiChange) : null;
  const real = !!valued;
  /* Never the volume walk on a live book: the overnight count is the only measure, and until it is in nothing is counted. */
  /* …and on a full book, until every in-scope date the count touches has its contract rows (each contract is valued at
     its own vendor gamma — before they land it is priced off the model, and the figures moved by a few million as they
     did) */
  const entry = snapshot.liveBook ? peekEntry(snapshot.ticker) : undefined;
  const scopeDates = snapshot.liveBook ? datesOf(snapshot, chain as MarketSnapshot['chain']) : null;
  const floor = isoDate(bookToday());
  /* Gated on what is actually in: every live in-scope date the count touches must have its chain and contract rows read
     (a Board-only name: the dates its flip re-prices with their own vols, uwBook ownIvDates). */
  const by = snapshot.uwByDate ?? {};
  const liveDates = Object.keys(by).filter(d => d >= floor && by[d]?.length).sort();
  const own = ownIvDates(by, liveDates, liveDates[0], !!entry?.wantFull);
  const listed = new Set((entry?.expiries ?? []).map(e => e.date).filter(d => d >= floor));
  const touched = new Set(oiChange?.rows.filter(r => r.expiry >= floor && (scopeDates === 'ALL' || (Array.isArray(scopeDates) && scopeDates.includes(r.expiry)))).map(r => r.expiry) ?? []);
  const factsMissing =
    real &&
    !!entry &&
    [...touched].some(d => (by[d]?.length ? !entry.factsDates?.has(d) && (entry.wantFull || own.has(d)) : listed.has(d) && scopeDates !== 'ALL'));
  /* No whole-book stand-in: until the scope's own chain is in and its levels are final, only "…". */
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
  if (hasOi && !real && first) for (const l of first.levels) openAt.set(l.strike, { c: l.callOI ?? 0, p: l.putOI ?? 0 });
  const nowAt = new Map<number, { c: number; p: number }>();
  if (hasOi && !real && last) for (const l of last.levels) nowAt.set(l.strike, { c: l.callOI ?? 0, p: l.putOI ?? 0 });

  /* Sampled OI through the day, per strike, for the shapes */
  const stepN = Math.max(1, Math.floor(today.length / SHAPE_POINTS));
  const sampled = today.filter((_, i) => i % stepN === 0 || i === today.length - 1);

  const { levels } = profile;
  const maxAbsBook = Math.max(1, ...profile.strikes.map(s => Math.abs(unit.get(s.strike)?.net ?? 0)));

  const rows: BuildRow[] = [];
  /* each strike's call and put legs at the open and now — the walls are the most call / put gamma (core/walls.ts) */
  let maxAbs = 1;
  let maxChange = 1;
  /* What a strike added since the open (or overnight), each leg in dollars, house sign — one reading for the window's rows
     and for the whole chain the walls are picked on */
  const addedAt = (K: number) => {
    const u = unit.get(K) ?? { call: 0, put: 0, net: 0 };
    const o = openAt.get(K);
    const n = nowAt.get(K) ?? { c: 0, p: 0 };
    const oc = real ? valued!.get(K) : undefined;
    const dCall = real ? (oc?.dCall ?? 0) : hasOi ? n.c - (o?.c ?? 0) : 0;
    const dPut = real ? (oc?.dPut ?? 0) : hasOi ? n.p - (o?.p ?? 0) : 0;
    /* Dollars in the house sign — call units are negative, so "calls added" is |dCall · unit|. The overnight count is
       valued contract by contract, each at its own gamma (valueOiChange) */
    return { u, o, oc, dCall, dPut, callAddedSigned: real ? (oc?.call ?? 0) : dCall * u.call, putAddedSigned: real ? (oc?.put ?? 0) : dPut * u.put };
  };
  for (const s of profile.strikes) {
    const K = s.strike;
    const { u, o, oc, dCall, dPut, callAddedSigned, putAddedSigned } = addedAt(K);
    const now = u.net;
    const isNew = !real && hasOi && !o;
    const added = callAddedSigned + putAddedSigned;
    const open = now - added;
    const callAdded = real ? -(oc?.call ?? 0) : dCall * Math.abs(u.call);
    const putAdded = real ? (oc?.put ?? 0) : dPut * Math.abs(u.put);
    const netSizeChange = Math.abs(now) - Math.abs(open);
    const nowNode = chain.find(x => x.strike === K);
    const nowC = nowNode?.callGex ?? 0;
    const nowP = nowNode?.putGex ?? 0;
    /* The leg that makes the level: a call wall by its call gamma, a put wall by its puts, the supreme and every other strike by the net. */
    const kRoles = levelRoles(K, levels);
    /* …and a strike that is both walls by each leg; only the supreme is read by the net. */
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

    /* A strike moved when its size changed by a tenth of what it holds (open or now, the larger) and by more than half a percent of the window's biggest wall. */
    const own = Math.max(Math.abs(legNow), Math.abs(legOpen));
    /* A direction only where both valuations agree; otherwise the change is inside per-contract gamma noise and the strike reads steady. */
    let alt = sizeChange;
    if (real && oc && (oc.callAlt != null || oc.putAlt != null)) {
      const cA = oc.callAlt ?? oc.call;
      const pA = oc.putAlt ?? oc.put;
      const openA = now - (cA + pA);
      const cS = Math.abs(nowC) - Math.abs(nowC - cA);
      const pS = Math.abs(nowP) - Math.abs(nowP - pA);
      alt = basis === 'net' ? Math.abs(now) - Math.abs(openA) : basis === 'both' ? cS + pS : basis === 'calls' ? cS : pS;
    }
    const agrees = Math.sign(alt) === Math.sign(sizeChange);
    const material = agrees && Math.abs(sizeChange) >= MATERIAL * own && Math.abs(sizeChange) >= FLOOR_SHARE * maxAbsBook;
    /* a wall's own leg cannot change sides — only a strike read by its net can */
    const switched = basis === 'net' && hasOi && Math.sign(now) !== Math.sign(open) && Math.abs(now) >= FLOOR_SHARE * maxAbsBook && Math.abs(open) >= FLOOR_SHARE * maxAbsBook;
    const verdict: BuildVerdict = !hasOi ? 'steady' : isNew && material ? 'new' : switched ? 'switched' : material ? (sizeChange > 0 ? 'building' : 'draining') : 'steady';
    const byClose = real ? 0 : (sizeChange / elapsedMin) * minutesLeft;

    const role: BuildRole = K === levels.callWall ? 'call wall' : K === levels.putWall ? 'put wall' : K === levels.supreme ? 'supreme' : null;
    /* The supreme that is also a wall keeps its net and states each wall's leg beside it. */
    const wallLegs = basis === 'both' || (basis === 'net' && (isCall || isPut));
    rows.push({ strike: K, role, roles: kRoles, pin: !!s.pin, now, open, callAdded, putAdded, dCall, dPut, sizeChange, basis, ...(wallLegs ? { callSize: isCall ? callSize : undefined, putSize: isPut ? putSize : undefined } : {}), netSizeChange, change: shownGamma(now) - shownGamma(open), shape, when, verdict, byClose, words: '' });
    maxAbs = Math.max(maxAbs, Math.abs(now));
    maxChange = Math.max(maxChange, Math.abs(callAdded), Math.abs(putAdded));
  }

  /* The words, once the scale is known: the verdict, the change, then what stands there. */
  const whenWords = (w: BuildRow['when']) => (w === 'early' ? 'mostly early in the day' : w === 'middle' ? 'mostly through the middle of the day' : w === 'late' ? 'mostly late in the day' : '');
  const oiDates = real && oiChange?.lastDate && oiChange.currDate ? { from: oiChange.lastDate, to: oiChange.currDate } : null;
  const oiSource = real ? (oiChange?.source ?? null) : null;
  const oiListed = real ? (oiChange?.listed ?? null) : null;
  const when = changeWhen({ overnight: real, inSession: clock.inSession, oiDates, oiSource });
  const day = when.short;
  /* "before Oct 21's trading" — the state the count starts from */
  const before = real ? `before ${oiWhen(oiDates).trade ?? 'the overnight count'}` : 'at the open';
  for (const r of rows) {
    /* Net gamma in the retail sign, as every other page prints it. */
    const stand = `now ${retail(r.now)}, ${sideWords(r.now)}`;
    if (!hasOi) {
      /* nothing provisional while loading — not even the strike's "now", which may still be the whole book's */
      r.words = loading ? (scopeMissing || levelsPending ? 'Loading the contracts these levels are read from…' : 'Loading the overnight open-interest count…') : `No open interest on this feed yet — ${stand}.`;
      continue;
    }
    const dominant = Math.abs(r.callAdded) >= Math.abs(r.putAdded) ? 'calls' : 'puts';
    /* One sign for "the change": a strike's change is its wall's size change, |now| − |was| (+ grew, − shrank), the figure every page prints. */
    /* The change in words: building and draining are the wall's size, never contract counts; where contracts were added and the wall
       still shrank, the words say the side leaning against it shrank it. */
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

  /* Where the walls are heading: the levels re-picked on the open's book and on the projected one — over EVERY strike of
     the contracts, as the levels themselves are (exposure.ts, core/walls.ts: "anywhere on the book"), never only the
     rows' window: a wall outside the window is still the wall, and the strike-axis picture widens to it. */
  type Pt = { strike: number; v: number; c: number; p: number };
  const book = chain.map(node => {
    const a = addedAt(node.strike);
    const nowC = node.callGex ?? 0;
    const nowP = node.putGex ?? 0;
    const now = a.u.net;
    return { strike: node.strike, now, open: now - (a.callAddedSigned + a.putAddedSigned), nowC, nowP, openC: nowC - a.callAddedSigned, openP: nowP - a.putAddedSigned };
  });
  const openPts: Pt[] = book.map(b => ({ strike: b.strike, v: b.open, c: b.openC, p: b.openP }));
  const nowPts: Pt[] = book.map(b => ({ strike: b.strike, v: b.now, c: b.nowC, p: b.nowP }));
  /* the overnight count is one step between two sessions, not a pace through the day — nothing is projected off it */
  const pace = (a: number, b: number) => b + ((b - a) / elapsedMin) * minutesLeft;
  const closePts: Pt[] = real ? nowPts : book.map(b => ({ strike: b.strike, v: pace(b.open, b.now), c: pace(b.openC, b.nowC), p: pace(b.openP, b.nowP) }));
  /* the most call gamma and the most put gamma (core/walls.ts pickLegWalls) — the Map's and the Agenda's rule */
  const walls = (pts: Pt[]) => pickLegWalls(pts, p => p.c, p => p.p);
  const supremeOf = (pts: { strike: number; v: number }[]) => pts.reduce<{ strike: number; v: number } | null>((b, p) => (!b || Math.abs(p.v) > Math.abs(b.v) ? p : b), null)?.strike ?? null;
  const wOpen = walls(openPts);
  const wNow = walls(nowPts);
  const wClose = walls(closePts);
  const horizon = clock.inSession ? 'by the close' : 'over the next session at that pace';

  const challengerFor = (side: 'call' | 'put', wall: number | null): Challenger | null => {
    if (wall == null) return null;
    const w = book.find(r => r.strike === wall);
    if (!w) return null;
    /* a challenger grows the same leg: the most call (or put) gamma added, anywhere on the contracts as the wall is */
    type Leg = (typeof book)[number];
    const legNow = (r: Leg) => Math.abs(side === 'call' ? r.nowC : r.nowP);
    const legGrew = (r: Leg) => legNow(r) - Math.abs(side === 'call' ? r.openC : r.openP);
    const cands = book.filter(r => r.strike !== wall && legGrew(r) > 0);
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
            ? noFlipWords(levels.net)
            : `none — no ${name === 'Call wall' ? 'call' : 'put'} gamma on these contracts`;
    const ahead = real || close == null || now == null ? '' : close === now ? ` · holds ${horizon}` : ` · ${horizon} it moves to ${fmtStrike(close)}`;
    const chal = ch ? ` · ${fmtStrike(ch.strike)} grew the most ${name === 'Call wall' ? 'call' : 'put'} gamma${real ? ` ${day}` : ''}, ${fmtDollars(ch.needs)} short${ch.by ? `, there by ${ch.by} at today's pace` : !real && ch.outrun ? ', but the wall is growing faster' : ''}` : '';
    return `${moved}${ahead}${chal}`;
  };

  const callCh = challengerFor('call', wNow.callWall);
  const putCh = challengerFor('put', wNow.putWall);
  const supOpen = supremeOf(openPts);
  const supNow = supremeOf(nowPts);
  const supClose = supremeOf(closePts);
  /* The one flip (data/flipLevel.ts); no past book is on the feed to re-price, so the flip is today's alone. */
  const flipNow = levels.flipFound === false ? null : levels.flip;
  const flipOpen = flipNow;
  const flipClose = flipNow;

  /* Nothing provisional is drawn as a level: the walls and the supreme wait for the scope's own contracts (the whole book
     standing in for "Today" names other walls), the flip for its final pricing — until then a level is "…", never "none". */
  const wallsPending = !!snapshot.liveBook && (scopeMissing || !!snapshot.levelsPending || (profile.expiry === 'ALL' && !!entry && !datesComplete(entry)));
  const flipPending = wallsPending || levelsPending;
  const pendingLevel = (name: WallHeading['name']): WallHeading => ({ name, open: null, now: null, close: null, words: '…', challenger: null, pending: true });
  const heading: WallHeading[] = [
    wallsPending ? pendingLevel('Call wall') : { name: 'Call wall', open: wOpen.callWall, now: wNow.callWall, close: wClose.callWall, words: levelWords('Call wall', wOpen.callWall, wNow.callWall, wClose.callWall, callCh), challenger: callCh },
    wallsPending ? pendingLevel('Put wall') : { name: 'Put wall', open: wOpen.putWall, now: wNow.putWall, close: wClose.putWall, words: levelWords('Put wall', wOpen.putWall, wNow.putWall, wClose.putWall, putCh), challenger: putCh },
    wallsPending ? pendingLevel('Supreme') : { name: 'Supreme', open: supOpen, now: supNow, close: supClose, words: levelWords('Supreme', supOpen, supNow, supClose, null), challenger: null },
    flipPending ? pendingLevel('Flip') : { name: 'Flip', open: flipOpen, now: flipNow, close: flipClose, words: levelWords('Flip', flipOpen, flipNow, flipClose, null), challenger: null },
  ];

  /* THE SENTENCE */
  let sentence: string;
  if (!hasOi) sentence = loading ? (scopeMissing || levelsPending ? 'Loading the contracts these levels are read from…' : 'Loading the overnight open-interest count…') : 'Open interest is not on this feed yet, so nothing can be read as built or drained.';
  else {
    const parts: string[] = [];
    if (real) {
      /* The overnight count, said as one (it was set overnight from yesterday's trading). */
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

  return { ticker, spot, rows, maxAbs, maxChange, built, drained, fastestUp, fastestDown, spotAfter, elapsedMin, minutesLeft, inSession: clock.inSession, heading, sentence, hasOi, overnight: real || loading, oiDates, oiSource, oiListed, loading };
}
