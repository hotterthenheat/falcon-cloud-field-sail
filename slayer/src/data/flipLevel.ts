/* The one flip every Pinpoint page prints: the price where the levels' contracts' net gamma, re-priced at that price
   (core/gammaFlip.ts), crosses zero. Inputs are the vendor's open-interest gamma, each leg at its own contract vol (the
   smile, or the date's ATM vol on the trading clock, when it has none). The regime is the sign of net gamma at spot. */

import { bellDay, shortDay, todayScopeLabel } from './bookWindow';
import { carryFor } from '../core/carry';
import { tradingMinutesBetween, tradingYears } from '../core/tradingYear';
import { vendorIvOnTradingClock } from '../core/volClock';
import { dollarGammaPerContract, netGammaAt, quietLegs, repricedFlip, type FlipRead, type GammaLeg } from '../core/gammaFlip';
import { nyIsoDate, nySessionPhase, nyWallTime } from '../core/nyTime';
import { bookToday, isoDate, isTradingDay } from '../core/calendar';
import { bookCandles, ownIvDates, peekEntry, peekGammaPriced } from './uwBook';
import { registeredDates } from './chainDates';
import { callWallWords, putWallWords, wallPlace } from '../core/walls';
import type { MarketSnapshot, StrikeNode } from '../types/market';

/** The flip's rule in a reader's words — the one statement of it on the pages (keep it the code's: see the head) */
export const FLIP_RULE =
  "The flip is the price where the book's net gamma, re-priced at that price, crosses zero within ±10%. Each contract is re-priced from the price and minute the vendor priced it at, to 4:00 ET on its expiry, at its own implied vol — or its expiry's smile, or the at-the-money vol for small expiries; contracts too far from price for their printed gamma to matter are priced from their open interest. When the profile crosses more than once in the session, the flip stays on its crossing until that crossing is gone, and says so; outside the session it is the crossing nearest price.";

/* ---- which dates a chain is ---------------------------------------------------------------------------------- */

/** Which expiry dates a chain is: one date's own strikes, a registered sum of dates, or the whole live book */
export function datesOf(snapshot: MarketSnapshot, chain: readonly StrikeNode[]): string[] | 'ALL' | null {
  const reg = registeredDates(chain);
  if (reg) return reg;
  const by = snapshot.uwByDate;
  if (by) for (const d of Object.keys(by)) if (by[d] === chain) return [d];
  if (snapshot.uwChains?.ALL === chain) return 'ALL';
  return null;
}

/* ---- the clock and the vol ----------------------------------------------------------------------------------- */

const YEAR_SESSION = 252;
/** Years from the pricing minute to 16:00 ET on the expiry — trading minutes only, five at the least. */
export function yearsTo(expiry: string, now: number = Date.now()): number {
  return tradingYears(expiry, now);
}

/* A leg with no vol of its own takes its expiry's smile at that strike (the OTM side's vol, linear between strikes,
   flat past the last) — a far wing at the ATM vol would grow without bound as price walks toward it. */
export function smileOf(chain: readonly StrikeNode[], spot: number): (k: number) => number {
  const pts: [number, number][] = [];
  for (const n of chain) {
    const otm = n.strike >= spot ? n.callIv : n.putIv;
    const itm = n.strike >= spot ? n.putIv : n.callIv;
    const iv = otm && otm > 0 ? otm : itm && itm > 0 ? itm : 0;
    if (iv > 0) pts.push([n.strike, iv]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return (k: number) => {
    if (!pts.length) return 0;
    if (k <= pts[0][0]) return pts[0][1];
    const last = pts[pts.length - 1];
    if (k >= last[0]) return last[1];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] < k) continue;
      const [k0, v0] = pts[i - 1];
      const [k1, v1] = pts[i];
      return k1 > k0 ? v0 + ((v1 - v0) * (k - k0)) / (k1 - k0) : v1;
    }
    return last[1];
  };
}

/** The own vol over which a same-day in-the-money leg is taken as runaway (see legsOfDate) */
const ITM_RUNAWAY_IV = 1.5;

/** One date's legs. `own`: each contract's own vol where it is in, the same expiry's smile at that strike where it is
    not — else the date's ATM vol (a calendar-year vol, moved onto the trading clock the legs run on). `s0`: the price
    the date's gamma was priced at, when it is not the search's spot. `spot`: where the smile's OTM side is read from. */
const legsOfDate = (chain: readonly StrikeNode[], date: string, atmIv: number, now: number, own: boolean, s0?: number, perRow = false, spot = 0): GammaLeg[] => {
  const t0 = yearsTo(date, now);
  const atm0 = vendorIvOnTradingClock(atmIv, date, now);
  const out: GammaLeg[] = [];
  const smile = own ? smileOf(chain, s0 && s0 > 0 ? s0 : spot) : null;
  for (const n of chain) {
    /* each row at its own price and minute when the vendor's rows carry them, the date's latest otherwise */
    const own0 = perRow && n.gexPx && n.gexPx > 0 ? n.gexPx : s0;
    const t = perRow && n.gexAt ? yearsTo(date, n.gexAt) : t0;
    const atm = perRow && n.gexAt ? vendorIvOnTradingClock(atmIv, date, n.gexAt) : atm0;
    const wing = smile ? smile(n.strike) : 0;
    const volOf = (mine: number | undefined) => (own && mine && mine > 0 ? mine : wing > 0 ? wing : atm);
    const at = own0 && own0 > 0 ? own0 : spot;
    const push = (g0: number, mine: number | undefined, oi: number, itm: boolean, side: 1 | -1) => {
      let g = g0;
      let iv = volOf(mine);
      let ownIv = own && !!mine && mine > 0;
      /* An in-the-money leg in its last day trades at parity, so a runaway own vol (over ITM_RUNAWAY_IV and well above
         the smile) is noise: its gamma at spot is scaled to the smile's vol and the rest is carried flat (legSet). */
      if (own && ownIv && itm && t <= 1 / YEAR_SESSION && at > 0 && (mine ?? 0) > ITM_RUNAWAY_IV && wing > 0 && wing < (mine ?? 0) * 0.7) {
        const g1 = dollarGammaPerContract(at, n.strike, t, wing);
        const g2 = dollarGammaPerContract(at, n.strike, t, mine!);
        if (g2 > 0) {
          g = g0 * Math.min(1, g1 / g2);
          iv = wing;
          ownIv = false;
        }
      }
      /* a leg the vendor prints no gamma for at spot still holds contracts: priced outright from its open interest
         (core/gammaFlip.ts) once price walks toward it */
      if (g || (oi > 0 && iv > 0)) out.push({ strike: n.strike, g0: g, iv, t, s0: own0, oi: oi > 0 ? oi : undefined, side, ownIv });
    };
    push(n.callGex, n.callIv, n.callOI, n.strike < at, -1);
    push(n.putGex, n.putIv, n.putOI, n.strike > at, 1);
  }
  return out;
};

/** The last regular session's 4:00 ET close, as an instant — the clock a closed market's book is priced at when the
    vendor's own pricing minute is not in hand */
function lastCloseAt(now: number = Date.now()): number {
  const iso = nyIsoDate(now);
  const [y, m, d] = iso.split('-').map(Number);
  const todayClose = nyWallTime(y, m, d, 16, 0);
  const day = new Date(y, m - 1, d);
  if (isTradingDay(day) && now >= todayClose) return todayClose;
  for (let back = 1; back < 10; back++) {
    const p = new Date(y, m - 1, d - back);
    if (isTradingDay(p)) return nyWallTime(p.getFullYear(), p.getMonth() + 1, p.getDate(), 16, 0);
  }
  return todayClose;
}

/** The clock a live leg is priced at: the minute the vendor priced its rows (after the close that is the close — the
    flip stops moving until new rows print), else the wall clock in the session and the last close outside it */
function pricingClock(pricedAt: number | undefined, now: number): number {
  if (pricedAt && pricedAt > 0) return pricedAt;
  const [y, m, d] = nyIsoDate(now).split('-').map(Number);
  return nySessionPhase(now) === 'open' && isTradingDay(new Date(y, m - 1, d)) ? now : lastCloseAt(now);
}

/** The price at a minute off the name's cash bars: the open of the first bar at or after it (null without bars) */
function priceAtMinute(ticker: string, at: number): number | null {
  const bars = bookCandles(ticker) ?? [];
  const sec = Math.floor(at / 1000);
  const b = bars.find(x => x.time >= sec && x.time - sec < 3600);
  return b && b.open > 0 ? b.open : null;
}

interface LevelFlip extends FlipRead {
  /** False while some of the scope's expiries have not landed — the flip is then provisional */
  complete: boolean;
  /** Another price where the profile crosses zero inside the range, nearest the flip — null when it crosses once */
  second?: number | null;
  /** The flip moved today because the crossing it stood on closed: where it was, and when (epoch ms) */
  moved?: { from: number; at: number } | null;
}

/* With more than one crossing the flip stays on the one it stood on while it is there (within STICK_FRAC of price) and
   the other is disclosed (`second`); it moves only when its crossing closes, and says so (`moved`). */
const STICK_FRAC = 0.004;
/* The kept crossing must be missing HOLD_READS reads in a row over HOLD_MS before the hold gives it up. */
const HOLD_READS = 3;
const HOLD_MS = 120_000;
/* A second crossing is disclosed only once seen in place on SECOND_READS reads over SECOND_MS. */
const SECOND_READS = 3;
const SECOND_MS = 120_000;
/* The hold only ever prints one of the current read's crossings; it counts the live book at its own price, once per
   input key, and only in the session — outside it every page takes the crossing nearest price off the same inputs. */
interface Stick {
  flip: number | null;
  moved: { from: number; at: number } | null;
  /** The kept crossing has been missing since `since`, on `reads` reads in a row */
  miss?: { since: number; reads: number } | null;
  /** A second crossing being watched (`shown` once steady) */
  second?: { at: number; since: number; reads: number; shown: boolean } | null;
  /** The input key of the last read counted */
  seen?: string;
}
const sticky = new Map<string, Stick>();
const STICK_STORE = 'pinpoint.flipStick.v3';
let stickRaw: string | null | undefined;
/* Every tab of this browser reads the same kept choice (re-read whenever another tab wrote it). */
function loadStick(): void {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STICK_STORE) : null;
    if (raw === stickRaw) return;
    stickRaw = raw;
    if (!raw) return;
    const today = nyIsoDate();
    const got = JSON.parse(raw) as Record<string, Stick>;
    for (const [k, v] of Object.entries(got)) if (k.endsWith(`|${today}`) && v && (v.flip === null || Number.isFinite(v.flip))) sticky.set(k, v);
  } catch {
    /* no storage: the choice lives for this page */
  }
}
function saveStick(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const today = nyIsoDate();
    const out: Record<string, unknown> = {};
    for (const [k, v] of sticky) if (k.endsWith(`|${today}`)) out[k] = v;
    stickRaw = JSON.stringify(out);
    localStorage.setItem(STICK_STORE, stickRaw);
    /* the old store's choices are not read again (v2 counted every call and held crossings that had gone) */
    localStorage.removeItem('pinpoint.flipStick.v2');
  } catch {
    /* no storage */
  }
}
/** The flip among the profile's crossings, with hysteresis (see above) — `key` names the name, contracts and day;
    `readKey` the read's inputs (a read is counted once however many pages ask) */
export function stickFlip(key: string, read: FlipRead, spot: number, now: number = Date.now(), readKey: string = `${now}`): { flip: number | null; second: number | null; moved: { from: number; at: number } | null } {
  loadStick();
  const xs = read.crossings ?? (read.flip != null ? [read.flip] : []);
  const tol = STICK_FRAC * spot;
  const nearestTo = (f: number, pool: readonly number[]) => [...pool].sort((a, b) => Math.abs(a - f) - Math.abs(b - f))[0] ?? null;
  const prev = sticky.get(key);
  const fresh = !prev || prev.seen !== readKey;
  /* the crossing kept, the one printed (always on this read), and the miss count */
  let kept: number | null = read.flip;
  let flip: number | null = read.flip;
  let moved = prev?.moved ?? null;
  let miss: Stick['miss'] = null;
  if (prev && prev.flip != null) {
    const near = nearestTo(prev.flip, xs);
    if (near != null && Math.abs(near - prev.flip) <= tol) kept = flip = near;
    else {
      /* the kept crossing is not on this read: print the crossing nearest where it stood, keep it until it has stayed
         away HOLD_READS reads over HOLD_MS */
      miss = fresh ? { since: prev.miss?.since ?? now, reads: (prev.miss?.reads ?? 0) + 1 } : prev.miss ?? { since: now, reads: 1 };
      flip = near;
      if (miss.reads >= HOLD_READS && now - miss.since >= HOLD_MS) {
        kept = read.flip;
        flip = read.flip;
        if (kept != null) moved = { from: prev.flip, at: now };
        miss = null;
      } else kept = prev.flip;
    }
  }
  /* the second crossing: the nearest other crossing to the flip, named only once steady */
  const others = flip == null ? [] : xs.filter(x => Math.abs(x - flip!) > Math.max(1e-6, tol * 0.25));
  let second: Stick['second'] = null;
  if (others.length) {
    const was = prev?.second;
    const keep = was ? nearestTo(was.at, others) : null;
    if (was && keep != null && Math.abs(keep - was.at) <= tol) {
      const reads = was.reads + (fresh ? 1 : 0);
      second = { at: keep, since: was.since, reads, shown: was.shown || (reads >= SECOND_READS && now - was.since >= SECOND_MS) };
    } else {
      const cand = nearestTo(flip!, others)!;
      second = { at: cand, since: now, reads: 1, shown: false };
    }
  }
  const next: Stick = { flip: kept, moved, miss, second, seen: readKey };
  if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
    sticky.set(key, next);
    saveStick();
  }
  return { flip, second: second?.shown ? second.at : null, moved };
}

const cache = new Map<string, LevelFlip>();

/** A chain's content as a short hash (memoised per array): the flip re-prices only when its inputs change, not on
    every refresh of the same rows. */
const sigMemo = new WeakMap<readonly StrikeNode[], string>();
function chainSig(chain: readonly StrikeNode[] | undefined): string {
  if (!chain) return '-';
  const hit = sigMemo.get(chain);
  if (hit) return hit;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const mix = (v: number | undefined) => {
    const x = v == null || !Number.isFinite(v) ? 0 : Math.round(v * 1000);
    h1 = Math.imul(h1 ^ (x | 0), 16777619);
    h2 = Math.imul(h2 ^ ((x / 4294967296) | 0), 2246822519) ^ (h1 >>> 13);
  };
  for (const n of chain) {
    mix(n.strike);
    mix(n.callGex);
    mix(n.putGex);
    mix(n.netGex);
    mix(n.callIv);
    mix(n.putIv);
    mix(n.callOI);
    mix(n.putOI);
    mix(n.gexAt);
    mix(n.gexPx);
  }
  const out = `${chain.length}.${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
  sigMemo.set(chain, out);
  return out;
}

interface LegSet {
  legs: GammaLeg[];
  complete: boolean;
  key: string;
  withVol: number;
}

/** The re-priced legs of the contracts in `chain` — the one leg set the flip, and the net path, are read off */
function legSet(snapshot: MarketSnapshot, chain: readonly StrikeNode[], at?: number): LegSet | null {
  const spot = snapshot.spot;
  const dates = snapshot.liveBook ? datesOf(snapshot, chain) : null;
  const entry = snapshot.liveBook ? peekEntry(snapshot.ticker) : undefined;
  if (!dates || !entry || !snapshot.uwByDate) return null;
  const by = snapshot.uwByDate;
  const floor = isoDate(bookToday());
  const want = dates === 'ALL' ? Object.keys(by).filter(d => d >= floor && by[d]?.length) : dates.filter(d => by[d]?.length);
  if (!want.length) return null;
  const listed = (snapshot.uwExpiries ?? []).map(e => e.date).filter(d => d >= floor);
  const complete = dates === 'ALL' ? listed.length === 0 || listed.every(d => want.includes(d)) : true;
  /* `at` pins the clock (a finished session's close). Live levels price each date from the price and at the minute the
     vendor priced its rows (uwBook peekGammaPriced). */
  const pinned = at ?? snapshot.asOf ?? snapshot.flipAt;
  const wall = Date.now();
  const priced = pinned == null ? want.map(d => peekGammaPriced(snapshot.ticker, d)) : [];
  const sig = pinned != null ? `p${Math.floor(pinned / 60_000)}` : priced.map(p => (p ? `${p.at}@${p.price}` : '-')).join(',') + (priced.every(Boolean) ? '' : `|${Math.floor(pricingClock(undefined, wall) / 60_000)}`);
  /* the front date: the first live listing that holds strikes — the one date every page loads contracts for */
  const front = Object.keys(by).filter(d => d >= floor && by[d]?.length).sort()[0];
  /* The front date and every date holding 0.5% or more of the dates' gross gamma re-price with their own contract vols. */
  const ownDates = ownIvDates(by, want, front);
  /* Final only once those dates' contracts are read; until then the pages print "…". */
  const factsIn = [...ownDates].every(d => !!entry.factsDates?.has(d));
  /* …and once the own-vol dates' pricing minute and the term structure (the other dates' vols) are in. */
  const asOfPx = snapshot.asOf != null && at == null ? priceAtMinute(snapshot.ticker, snapshot.asOf) : null;
  const pricedIn = pinned != null || !entry.gammaLive || [...ownDates].every(d => !!peekGammaPriced(snapshot.ticker, d));
  const termIn = want.every(d => ownDates.has(d)) || !!entry.termIv;
  const carry = carryFor(snapshot.ticker);
  const key = `${snapshot.ticker}|${dates === 'ALL' ? 'ALL' : dates.join(',')}|${want.length}|${spot}|${want.map(d => chainSig(by[d])).join(',')}|${chainSig(chain)}|${sig}|${chain.length}|${factsIn}|${entry.factsDates?.size ?? 0}|${pricedIn}|${termIn}|${asOfPx ?? ''}|${carry.r}|${carry.q}`;
  const term = entry.termIv ?? {};
  const legs: GammaLeg[] = [];
  let withVol = 0;
  for (let i = 0; i < want.length; i++) {
    const d = want[i];
    const atm = term[d] ?? (entry.iv > 0 ? entry.iv : 0);
    const p = pinned == null ? priced[i] : null;
    const now = pinned ?? pricingClock(p?.at, wall);
    /* A snapshot pinned to an earlier minute is re-priced from the price at that minute. */
    const own0 = p && p.price > 0 && p.price !== spot ? p.price : asOfPx != null && asOfPx !== spot ? asOfPx : undefined;
    const ls = legsOfDate(by[d], d, atm, now, ownDates.has(d) || snapshot.asOf != null, own0, pinned == null, spot);
    for (const l of ls) if (l.iv > 0) withVol++;
    legs.push(...ls);
  }
  {
    /* the whole book's per-strike total less what the loaded dates hold, carried flat — G(spot) is the book's own net
       (nothing on a date's own chain or a sum of dates; on the whole book a listing not loaded, or — the session's book
       after the close — the contracts that expired at the bell) */
    const onDates = new Map<number, number>();
    for (const l of legs) onDates.set(l.strike, (onDates.get(l.strike) ?? 0) + l.g0);
    for (const n of chain) {
      const rest = n.netGex - (onDates.get(n.strike) ?? 0);
      if (rest) legs.push({ strike: n.strike, g0: rest, iv: 0, t: 0 });
    }
    for (const [k, v] of onDates) if (!chain.some(n => n.strike === k)) legs.push({ strike: k, g0: -v, iv: 0, t: 0 });
  }
  return { legs, complete: complete && factsIn && pricedIn && termIn, key, withVol };
}

/** The flip of the contracts in `chain` (defaults to the snapshot's levels chain) — see the head of this file */
export function levelFlip(snapshot: MarketSnapshot, chain: readonly StrikeNode[] = snapshot.chain, at?: number): LevelFlip {
  const spot = snapshot.spot;
  /* No re-priced profile yet (the dates' rows or any vol not in): no flip, provisional — never a second rule standing in. */
  const fallback = (): LevelFlip => ({ flip: null, netAtSpot: chain.reduce((a, n) => a + n.netGex, 0), beyond: null, range: 0.1, method: 'repriced', complete: false });
  const set = legSet(snapshot, chain, at);
  if (!set) return fallback();
  if (!set.withVol) return fallback();
  /* the re-pricing is cached on its inputs; the hold is applied on every call (it is cheap, and another page of this
     browser may have moved it) */
  let base = cache.get(set.key);
  if (!base) {
    const raw = repricedFlip(set.legs, spot, carryFor(snapshot.ticker).r, undefined, carryFor(snapshot.ticker).q);
    /* off the hold: the crossing nearest price, and the other crossing nearest it disclosed — the same inputs give the same
       answer on every page and in every profile */
    const second = (raw.crossings?.length ?? 0) > 1 && raw.flip != null ? raw.crossings!.filter(x => x !== raw.flip).sort((a, b) => Math.abs(a - raw.flip!) - Math.abs(b - raw.flip!))[0] ?? null : null;
    base = { ...raw, complete: set.complete, second, moved: null };
    if (cache.size > 400) cache.clear();
    cache.set(set.key, base);
  }
  /* The hold applies only to the live book at its own price, in the session, once final (holdRead). */
  if (!set.complete || !holdRead(snapshot, at)) return base;
  const dates = datesOf(snapshot, chain);
  const stick = stickFlip(`${snapshot.ticker}|${dates === 'ALL' ? 'ALL' : (dates ?? []).join(',')}|${nyIsoDate()}`, base, spot, Date.now(), set.key);
  if (stick.flip === base.flip && stick.second === base.second && stick.moved == null) return base;
  const memoKey = `${set.key}|${stick.flip}|${stick.second}|${stick.moved?.from ?? ''}|${stick.moved?.at ?? ''}`;
  const hit = held.get(memoKey);
  if (hit) return hit;
  const out: LevelFlip = { ...base, flip: stick.flip, second: stick.second, moved: stick.moved, beyond: stick.flip == null ? null : base.netAtSpot < 0 ? 'short' : 'long' };
  if (held.size > 400) held.clear();
  held.set(memoKey, out);
  return out;
}
const held = new Map<string, LevelFlip>();

/** The market is in its regular session — the only time the vendor's rows move under the levels */
export function sessionLive(now: number = Date.now()): boolean {
  const [y, m, d] = nyIsoDate(now).split('-').map(Number);
  return nySessionPhase(now) === 'open' && isTradingDay(new Date(y, m - 1, d));
}

/** A read of the live book itself, at its own price, in the session — the only read the hold keeps */
function holdRead(snapshot: MarketSnapshot, at: number | undefined): boolean {
  if (at != null || snapshot.asOf != null || snapshot.flipAt != null || !snapshot.liveBook) return false;
  const e = peekEntry(snapshot.ticker);
  if (!e || e.byDate !== snapshot.uwByDate || e.spot !== snapshot.spot) return false;
  return sessionLive();
}

/* The book's net through the day in the levels' scope: the flip's legs priced at each price handed in, so the path ends
   at the headline net. RETAIL sign (+ absorbs). Null while the legs are not final. `times`: each price's own minute —
   every leg then carries the time to expiry that minute had. */
export function levelNetPath(snapshot: MarketSnapshot, chain: readonly StrikeNode[], prices: readonly number[], times?: readonly number[]): { path: number[]; complete: boolean } | null {
  const set = legSet(snapshot, chain);
  if (!set || !set.withVol) return null;
  const legs = quietLegs(set.legs);
  const ref = pricingClock(undefined, Date.now());
  const y = carryFor(snapshot.ticker);
  const path = prices.map((S, i) => {
    const at = times?.[i];
    /* each minute at its own clock: the time to expiry it had, its time now plus the session minutes since */
    const back = at != null && Number.isFinite(at) ? tradingMinutesBetween(at, ref) / (390 * 252) : 0;
    const these = back > 0 ? legs.map(l => (l.iv > 0 && l.t > 0 ? { ...l, t: l.t + back, t0: l.t } : l)) : legs;
    const v = netGammaAt(these, snapshot.spot, S, y.r, y.q);
    return v === 0 ? 0 : -v;
  });
  return { path, complete: set.complete };
}

/** Each date's own net gamma at each price, house sign — the same legs the flip re-prices (legSet), one set a date;
    null for a date whose rows cannot be re-priced. The profile's curve is these, added. */
export function datesNetAt(snapshot: MarketSnapshot, dates: readonly string[], prices: readonly number[]): (number[] | null)[] {
  const y = carryFor(snapshot.ticker);
  return dates.map(d => {
    const chain = snapshot.uwByDate?.[d];
    const set = chain?.length ? legSet(snapshot, chain) : null;
    if (!set || !set.withVol) return null;
    const legs = quietLegs(set.legs);
    return prices.map(S => netGammaAt(legs, snapshot.spot, S, y.r, y.q));
  });
}

/* ---- the words ----------------------------------------------------------------------------------------------- */

/** Long (absorbing) or short (amplifying) gamma at spot, off the house-signed net — the ONE regime rule */
export const regimeOfNet = (houseNet: number): 'LONG' | 'SHORT' | null => (houseNet < 0 ? 'LONG' : houseNet > 0 ? 'SHORT' : null);

const fmtK = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? v.toFixed(0) : v.toFixed(2));

/** Which side of the flip absorbs on THIS book: the side price is on wears the regime of the net, the far side the other. */
export function flipSidesWords(flip: number, spot: number, houseNet: number): string {
  const long = houseNet < 0;
  const aboveAbsorbs = long ? flip < spot : flip > spot;
  return aboveAbsorbs
    ? 'where dealer hedging switches sides. On this book, above it their hedging absorbs moves, below it amplifies them.'
    : 'where dealer hedging switches sides. On this book, below it their hedging absorbs moves, above it amplifies them.';
}

/* ---- "expires today", one wording for every page (the Map's clock, the Board, Compare, the Agenda) -------------- */

/** What "Expires today" prints when nothing on the name expires that day ("nothing expires Fri 10/23" after the close). */
export const bellNone = (): string => {
  const b = bellDay();
  return `nothing ${b.head.charAt(0).toLowerCase()}${b.head.slice(1)}`;
};
export const BELL_NONE_TITLE = (ticker: string): string => `Nothing on ${ticker} expires ${todayScopeLabel() === 'Today' ? 'today' : `on ${shortDay(bellDay().date)}, the next session`} — its nearest contracts expire on a later date`;

/* ---- the book in one sentence, on the one regime rule ----------------------------------------------------------- */

interface RegimeRead {
  key: 'ON THE FLIP' | 'PINNED' | 'ABSORBING' | 'WHIPSAW' | 'AMPLIFYING';
  read: string;
}

/** The book read as one sentence: the regime is the sign of net gamma at spot, the flip is where it changes, and each wall
    is described from where it sits against price (a put wall above price is overhead hedging, not a floor). */
export function readRegime(levels: { spot: number; flip: number; flipFound?: boolean; callWall: number; putWall: number; net?: number }, netAt?: (strike: number) => number | null): RegimeRead {
  const { spot, callWall, putWall } = levels;
  const flip = levels.flipFound === false ? null : levels.flip;
  /* one strike format on every page */
  const px = fmtK;
  const long = levels.net != null ? levels.net < 0 : flip != null && spot >= flip;
  /* the walls are the most call and the most put gamma either side of price, so each is placed by where it is */
  /* One tolerance for "at price" (core/walls.ts wallPlace, 0.05%). */
  const side = (k: number) => {
    const p = wallPlace(k, spot);
    return p === 'at' ? 'right at price' : p;
  };
  const cw = `the ${px(callWall)} call wall ${side(callWall)}`;
  const pw = `the ${px(putWall)} put wall ${side(putWall)}`;
  const cwPct = (Math.abs(callWall - spot) / Math.max(spot, 1)) * 100;
  const pwPct = (Math.abs(spot - putWall) / Math.max(spot, 1)) * 100;
  const between = putWall < spot && spot < callWall;
  const flipClause =
    flip == null
      ? ` No flip within ±10% — dealers stay ${long ? 'long' : 'short'} gamma across the whole range.`
      : ` A move ${flip > spot ? 'above' : 'below'} the ${px(flip)} flip turns them ${long ? 'short gamma, and their hedging starts to amplify moves' : 'long gamma, and their hedging starts to absorb moves'}.`;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (flip != null && (Math.abs(spot - flip) / Math.max(spot, 1)) * 100 < 0.05)
    return { key: 'ON THE FLIP', read: `Sitting on the ${px(flip)} flip — net gamma is near zero, so the hedging can tip either way; ${cw} and ${pw} are the levels that decide it.` };
  if (long && between && cwPct <= 1.2 && pwPct <= 1.2)
    return { key: 'PINNED', read: `Dealers are long gamma, so their hedging absorbs moves between the ${px(callWall)} call wall and the ${px(putWall)} put wall — dips get bought, rallies get sold, drift beats trend until one side gives.${flipClause}` };
  if (long)
    return { key: 'ABSORBING', read: `Dealers are long gamma, so their hedging absorbs moves. ${cap(cw)}: ${callWallWords(callWall, spot, netAt?.(callWall))}; ${pw}: ${putWallWords(putWall, spot, netAt?.(putWall))}.${flipClause}` };
  if (putWall < spot && pwPct >= 2.6)
    return { key: 'WHIPSAW', read: `Dealers are short gamma, so their hedging speeds a move up whichever way it goes, and the put wall is all the way down at ${px(putWall)}.${flipClause}` };
  return {
    key: 'AMPLIFYING',
    /* the one order (core/walls.ts LEVEL_ORDER): the call wall, then the put wall */
    read: `Dealers are short gamma, so their hedging amplifies moves. ${cap(cw)}: ${callWallWords(callWall, spot, netAt?.(callWall))}; ${pw}: ${putWallWords(putWall, spot, netAt?.(putWall))}.${flipClause}`,
  };
}
