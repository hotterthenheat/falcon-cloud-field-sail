/*
==================================================
  SLAYER TERMINAL - ONE FLIP FOR EVERY PAGE
  (data/flipLevel.ts)

  The flip every Pinpoint surface prints — the Map's
  levels card and ruler, the Agenda, the Board's
  "Flip · how far" and "Flip crossed today", Compare —
  is read here, off the same contracts the levels are
  read from (the LEVELS scope: today's own expiry, or
  every listed one), with core/gammaFlip.ts's rule: the
  price where the book's net gamma, re-priced at that
  price, crosses zero.

  THE INPUTS ARE THE VENDOR'S, AND THE SAME ON EVERY
  PAGE. Each expiry's strikes carry the vendor's live
  open-interest gamma at spot (spot-exposures — each
  contract's OI × Γ × 100 × S² × 1%, data/uwBook.ts), so
  re-pricing a leg is pricing those contracts outright:
  G(S) = G₀ · Γ(S)S² / Γ(S₀)S₀², exact at spot, with no
  constant carried. THE VOL RULE, AS THE CODE RUNS IT
  (FLIP_RULE below is the same rule in a reader's words,
  printed on the Map's data card — the sixth audit's m4):
  · the front date and every date holding 0.5% or more of
    the dates' gross gamma (uwBook ownIvDates): each leg at
    its own contract's implied vol (option-contracts);
  · on those dates a leg whose contract prints no vol: the
    same expiry's smile at that strike (smileOf — the
    out-of-the-money side's vols, linear between strikes,
    flat past the last), and such a stand-in leg is capped
    at what its open interest can hold (core/gammaFlip.ts);
  · every other date (under 0.5%): its at-the-money vol off
    the term structure — never a far wing at the ATM vol on
    a date that matters (the fifth audit). The
  same ticker and scope must give the
  same flip whichever page loaded it first (the second
  re-audit, 2026-10-22: NVDA All expiries read 205.38 on
  the Board and 201.70 on the Map). Time to expiry runs
  to 4:00 ET on the date. Whatever of the whole book's
  per-strike total is not on a loaded date (a listing
  past the fortieth, or a date still loading — the flip
  is then marked provisional) is carried flat. No vol at
  all on a book falls back to the running-net crossing.

  THE REGIME IS THE SIGN OF NET GAMMA AT SPOT, never the
  side of the flip: long gamma (absorbing) when net is
  positive in the retail sign, short (amplifying) when it
  is negative. The flip is where that changes, so the
  word, the net figure and the flip cannot disagree.
==================================================
*/

import { bellDay, shortDay, todayScopeLabel } from './bookWindow';
import { DEFAULT_R } from '../core/carry';
import { cumulativeFlip, dollarGammaPerContract, netGammaAt, repricedFlip, type FlipRead, type GammaLeg } from '../core/gammaFlip';
import { nyIsoDate, nyMinutes, nySessionPhase, nyWallTime } from '../core/nyTime';
import { bookToday, isoDate, isTradingDay } from '../core/calendar';
import { bookCandles, ownIvDates, peekEntry, peekGammaPriced } from './uwBook';
import { registeredDates } from './chainDates';
import { callWallWords, putWallWords, wallPlace } from '../core/walls';
import type { MarketSnapshot, StrikeNode } from '../types/market';

/** The flip's rule in a reader's words — the one statement of it on the pages (keep it the code's: see the head) */
export const FLIP_RULE =
  "The flip is the price where the book's net gamma, re-priced at that price, crosses zero within ±10%. In the session, when the profile crosses more than once, the flip stays on the crossing it stood on while that crossing is still there (the first read takes the one nearest price); while that crossing is missing the flip shows the crossing nearest it, and it moves for good once its crossing has been gone from three reads in a row over two minutes — and says so; the other crossing is named beside it once it has held its place for three reads over two minutes. Outside the session the vendor's rows stand still, so the flip is the crossing nearest price — the same on every page. Each leg is re-priced from the price and minute the vendor priced it at (after the close, the rows' own minute — never the wall clock), to 4:00 ET on its expiry. Vol: on the front expiry and on every expiry holding 0.5% or more of the book's gamma, each contract's own implied vol; a contract there with no vol of its own takes its expiry's smile at that strike (linear between the strikes that have one), capped at what its open interest can hold — and so does an in-the-money contract in its last day whose own vol runs over 150% and well above the smile's (its gamma then rests on a vol nobody trades at: it is re-priced at the smile's vol and the rest of its printed gamma is carried flat); the smaller expiries take their at-the-money vol off the term structure. A leg too small to matter — under a ten-millionth of the book's gross gamma, or under a hundred-thousandth with no vol of its own — is carried flat (its growth would be rounding, or rest on a vol nobody quoted)";

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

const YEAR_MIN = 365 * 24 * 60;
/** Years from now to 4:00 ET on the expiry date — five minutes at the least, so a leg at the bell stays finite */
export function yearsTo(expiry: string, now: number = Date.now()): number {
  const today = nyIsoDate(now);
  const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const mins = days * 1440 + (16 * 60 - nyMinutes(now));
  return Math.max(5, mins) / YEAR_MIN;
}

/*
  THE VOL A LEG WITHOUT ITS OWN IS RE-PRICED WITH (the fifth audit, 2026-10-23: TSLA's 252.5P/257.5P, CROX's wings —
  contracts the vendor prints gamma for but no implied vol — took the at-the-money vol, and a deep wing priced at the
  ATM vol "grows" by millions as price walks toward it: ≈ −$7e12 at 0.95× spot, which moved TSLA's Today flip from
  365.1 to 366.7 and CROX's from 113.8 to 115.6). The smile of the same expiry stands in: at each strike the
  out-of-the-money side's own vol (the in-the-money one where that is all there is), linear between strikes that
  have one, flat past the last — the vol the market is actually quoting near that strike. ATM only with no smile.
*/
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

/** One date's legs. `own`: re-price with each contract's own vol where it is in (the front date), the same expiry's
    smile at that strike where it is not — else the date's ATM vol. `s0`: the price the date's gamma was priced at, when
    it is not the search's spot. `spot`: the price the smile's out-of-the-money side is read from. */
const legsOfDate = (chain: readonly StrikeNode[], date: string, atmIv: number, now: number, own: boolean, s0?: number, perRow = false, spot = 0): GammaLeg[] => {
  const t0 = yearsTo(date, now);
  const out: GammaLeg[] = [];
  const smile = own ? smileOf(chain, s0 && s0 > 0 ? s0 : spot) : null;
  for (const n of chain) {
    /* EACH ROW AT ITS OWN PRICE AND MINUTE when the vendor's rows carry them (after its overnight roll every strike of a
       date has its own) — the date's latest otherwise */
    const own0 = perRow && n.gexPx && n.gexPx > 0 ? n.gexPx : s0;
    const t = perRow && n.gexAt ? yearsTo(date, n.gexAt) : t0;
    const wing = smile ? smile(n.strike) : 0;
    const volOf = (mine: number | undefined) => (own && mine && mine > 0 ? mine : wing > 0 ? wing : atmIv);
    /* THE CONTRACTS' OWN CEILING: a leg's dollar gamma can never pass what its open interest holds at the strike,
       OI × K·e^(−rT) / (√(2π)·σ·√T) — whatever vol it is re-priced with (core/gammaFlip.ts) */
    const at = own0 && own0 > 0 ? own0 : spot;
    const push = (g0: number, mine: number | undefined, oi: number, itm: boolean) => {
      let g = g0;
      let iv = volOf(mine);
      let ownIv = own && !!mine && mine > 0;
      /* AN IN-THE-MONEY SAME-DAY LEG AT A RUNAWAY VOL IS DAMPED (the tenth audit's M1, 2026-10-23: PLTR's 190C, $5 in the
         money with minutes left, printed IV 265% and its gamma ran $0.5M at 15:01 → $8.28M at 15:25 with price unchanged —
         an in-the-money contract near its bell trades at parity, so its vol, and the gamma the vendor computes from it, is
         noise, and it hopped the flip). A leg in its last day, in the money, whose own vol is over ITM_RUNAWAY_IV and well
         above the out-of-the-money side's at its strike (the smile), is re-priced at the smile's vol: its gamma at spot is
         scaled by the two vols' gamma ratio, and the rest of the vendor's figure is carried flat (legSet), so the net at
         spot is still the vendor's */
      if (own && ownIv && itm && t < 1 / 365 && at > 0 && (mine ?? 0) > ITM_RUNAWAY_IV && wing > 0 && wing < (mine ?? 0) * 0.7) {
        const g1 = dollarGammaPerContract(at, n.strike, t, wing, DEFAULT_R);
        const g2 = dollarGammaPerContract(at, n.strike, t, mine!, DEFAULT_R);
        if (g2 > 0) {
          g = g0 * Math.min(1, g1 / g2);
          iv = wing;
          ownIv = false;
        }
      }
      if (g) out.push({ strike: n.strike, g0: g, iv, t, s0: own0, oi: own && oi > 0 ? oi : undefined, ownIv });
    };
    if (n.callGex) push(n.callGex, n.callIv, n.callOI, n.strike < at);
    if (n.putGex) push(n.putGex, n.putIv, n.putOI, n.strike > at);
  }
  return out;
};

/** The last regular session's 4:00 ET close, as an instant — the clock a closed market's book is priced at when the
    vendor's own pricing minute is not in hand */
export function lastCloseAt(now: number = Date.now()): number {
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

export interface LevelFlip extends FlipRead {
  /** False while some of the scope's expiries have not landed — the flip is then provisional */
  complete: boolean;
  /** Another price where the profile crosses zero inside the range, nearest the flip — null when it crosses once */
  second?: number | null;
  /** The flip moved today because the crossing it stood on closed: where it was, and when (epoch ms) */
  moved?: { from: number; at: number } | null;
}

/*
  TWO CROSSINGS, ONE FLIP, NO SILENT SWAP (the ninth audit's M4, 2026-10-23: SPY's Today flip read 764.21 → 772.62 →
  764.04 → 772.06 → 773.13 → 764.36 → 763.96 within 35 minutes — with ~2.5h to expiry the profile crossed zero twice, and
  the nearer crossing opened and closed as the minute's rows re-priced). When the profile crosses more than once, the flip
  stays on the crossing it stood on while that crossing is still there (within STICK_FRAC of price), and the other is
  disclosed (`second`). It moves only when its crossing closes — and then says so (`moved`). The choice is kept per name,
  contracts and New York day, in this browser (localStorage), so a reload with the same inputs reads the same flip; a
  first read takes the crossing nearest price.
*/
const STICK_FRAC = 0.004;
/* THE HOLD OUTLASTS A BRIEF READ (the tenth audit's M1, 2026-10-23: Compare's SPY flip went 764.19 → 756.68 at 15:25 on
   one read, GOOGL 325.33 → 316.31 → none → 329.40 across reloads; the vendor's in-the-money same-day gamma jumps between
   reads — PLTR's 190C $0.5M at 15:01, $8.28M at 15:25 with price unchanged). The kept crossing has to be missing from
   HOLD_READS reads in a row spanning HOLD_MS before the hold gives it up. */
const HOLD_READS = 3;
const HOLD_MS = 120_000;
/* THE SECOND CROSSING IS NAMED ONLY ONCE IT IS STEADY (the same audit: the disclosed second flip jumped 769 → 750 → 752 →
   753 → 756 → 776 → 788 in 70 minutes): a crossing is disclosed beside the flip only after it has been seen, within
   STICK_FRAC of where it was, on SECOND_READS reads spanning SECOND_MS; once disclosed it keeps its place the way the
   flip does */
const SECOND_READS = 3;
const SECOND_MS = 120_000;
/*
  THE HOLD NEVER PRINTS A CROSSING THAT IS NOT THERE, AND COUNTS READS, NOT CALLS (the eleventh audit's B1, 2026-10-24:
  on a closed market Compare and the Dossier read SPY's Next-session flip 766.50 while the Map read 773.31 — the profile
  crossed once, at 773.31. Compare's side panel prices replay books at the day's earlier prices, each was taken as a live
  read, and the last one, priced at 763.64, seeded the kept crossing; the result was cached on its input key, so the hold
  never looked again while the market was shut). Now:
  · only the live book at its own price is a read of the hold (holdRead below) — a replay, a scenario or a session's
    report is priced on its own and never touches it;
  · a read counts once per input key (`seen`): the same rows read by ten components are one read;
  · the flip printed is always one of the current read's crossings — while the kept one is missing it is the crossing
    nearest where the kept one stood, and the kept one is given up once it has been missing HOLD_READS reads over HOLD_MS;
  · outside the session there is no hold at all: the rows do not move, so every page and every fresh profile takes the
    same crossing off the same inputs — the one nearest price (data/flipLevel.ts levelFlip).
*/
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
/* EVERY PAGE OF THIS BROWSER READS THE SAME CHOICE (the same audit: QQQ's flip 732.17 on Compare against 692.34 on the
   Board 12 minutes later): the kept choice is re-read from storage whenever another tab has written it */
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
  /* `at`: the clock to re-price at (a finished session's close) — without the asOf's contract-vol switch. A pinned clock
     (the session's report, the replay) prices the snapshot's own spot at it; the live levels price each date FROM the
     price and AT the minute the vendor priced its rows (uwBook peekGammaPriced, the fourth audit 2026-10-23) */
  const pinned = at ?? snapshot.asOf ?? snapshot.flipAt;
  const wall = Date.now();
  const priced = pinned == null ? want.map(d => peekGammaPriced(snapshot.ticker, d)) : [];
  const sig = pinned != null ? `p${Math.floor(pinned / 60_000)}` : priced.map(p => (p ? `${p.at}@${p.price}` : '-')).join(',') + (priced.every(Boolean) ? '' : `|${Math.floor(pricingClock(undefined, wall) / 60_000)}`);
  /* the front date: the first live listing that holds strikes — the one date every page loads contracts for */
  const front = Object.keys(by).filter(d => d >= floor && by[d]?.length).sort()[0];
  /* WHICH DATES RE-PRICE WITH THEIR OWN CONTRACTS' VOLS (the fifth audit, 2026-10-23): the front date, and every live
     date holding 0.5% or more of the dates' gross gamma (uwBook ownIvDates): with only the front date's own vols AAPL's
     whole book read 336.7 (its later dates' wings at the ATM vol), against 326.0 with every contract's own. The Map and a
     Board-only name pick the same dates off the same chains and load their contracts, so both re-price with the same vols. */
  const ownDates = ownIvDates(by, want, front);
  /* FINAL ONLY WITH THOSE DATES' OWN VOLS (the fourth audit's M1: SPY's Map read 771.25 off the at-the-money vol for
     seconds, then 772.17): until their contracts are read the flip is provisional, and the pages print "…" */
  /* …ON A PINNED CLOCK TOO (the seventh audit's M2, 2026-10-23): a finished session's book, priced at its close, was
     taken as final before its own contract vols were in — "How the levels held" graded AAPL against 344.01 (then
     326.75), and the Board froze "Flip crossed · 10/22" at META 6× (0×), GOOGL 18× (0×). Pinned or live, a flip is
     final only once the dates it re-prices with their own vols have their contracts read. */
  const factsIn = [...ownDates].every(d => !!entry.factsDates?.has(d));
  /* …AND ONLY ONCE EVERY INPUT THAT MOVES THE ANSWER IS IN (the eleventh audit's B1): the own-vol dates' live rows with
     the price and minute the vendor priced them at (until then a date is re-priced from the wrong price and clock), and
     the term structure the other dates take their vol from */
  const asOfPx = snapshot.asOf != null && at == null ? priceAtMinute(snapshot.ticker, snapshot.asOf) : null;
  const pricedIn = pinned != null || !entry.gammaLive || [...ownDates].every(d => !!peekGammaPriced(snapshot.ticker, d));
  const termIn = want.every(d => ownDates.has(d)) || !!entry.termIv;
  const key = `${snapshot.ticker}|${dates === 'ALL' ? 'ALL' : dates.join(',')}|${want.length}|${spot}|${entry.at}|${sig}|${chain.length}|${factsIn}|${entry.factsDates?.size ?? 0}|${pricedIn}|${termIn}|${asOfPx ?? ''}`;
  const term = entry.termIv ?? {};
  const legs: GammaLeg[] = [];
  let withVol = 0;
  for (let i = 0; i < want.length; i++) {
    const d = want[i];
    const atm = term[d] ?? (entry.iv > 0 ? entry.iv : 0);
    const p = pinned == null ? priced[i] : null;
    const now = pinned ?? pricingClock(p?.at, wall);
    /* A SNAPSHOT IS RE-PRICED FROM ITS OWN PRICE AT ITS OWN TIME (the eleventh audit's m5): the session's morning rows
       (asOf 9:30) were priced from the closing price the report's book carries — they are priced from the price at their
       own minute (the first cash bar at or after it) */
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
  /* the running-net fallback is final only off a book that is not the live one; on the live book it stands in while the
     dates land, and says so (the fourth audit's M1: "FLIP none nearby" for seconds on a cold load) */
  const fallback = (final = !snapshot.liveBook): LevelFlip => ({ ...cumulativeFlip(chain.map(n => ({ strike: n.strike, net: n.netGex })), spot), complete: final });
  const set = legSet(snapshot, chain, at);
  if (!set) return fallback();
  if (!set.withVol) return fallback(set.complete);
  /* the re-pricing is cached on its inputs; the hold is applied on every call (it is cheap, and another page of this
     browser may have moved it) */
  let base = cache.get(set.key);
  if (!base) {
    const raw = repricedFlip(set.legs, spot, DEFAULT_R);
    /* off the hold: the crossing nearest price, and the other crossing nearest it disclosed — the same inputs give the same
       answer on every page and in every profile */
    const second = (raw.crossings?.length ?? 0) > 1 && raw.flip != null ? raw.crossings!.filter(x => x !== raw.flip).sort((a, b) => Math.abs(a - raw.flip!) - Math.abs(b - raw.flip!))[0] ?? null : null;
    base = { ...raw, complete: set.complete, second, moved: null };
    if (cache.size > 400) cache.clear();
    cache.set(set.key, base);
  }
  /* THE HOLD IS THE LIVE BOOK'S, IN THE SESSION, ONCE FINAL (the eleventh audit's B1): a read is the hold's only when it is
     the live book itself at its own price — not a replay or scenario book priced at another price (Compare's side panel
     seeded SPY's hold at 766.51 from its 763.64 replay), not a pinned clock (a session's report). Outside the session the
     rows stand still and there is no hold: every page reads the crossing nearest price off the same inputs. */
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

/*
  THE BOOK'S NET THROUGH THE DAY, IN THE LEVELS' SCOPE (the fifth audit, 2026-10-23: the Map's "Dealer gamma through the
  day" drew the vendor's whole-book minute series — −13B…−18B, the settled day in it, and NVDA's green 0…700M — under a
  headline of the Today scope's −$3.1B / −$73.9M). The vendor's minute series is the open-interest book re-priced at
  each minute's price; this is the same thing for the scope's own contracts: the legs the flip reads, priced at each
  price handed in — so the path ends at the headline's net, in the same scope and the same sign. RETAIL sign (+ absorbs).
  Null while the scope's legs are not final.
*/
/* …AT EACH MINUTE'S OWN CLOCK (the tenth audit's retail finding: the morning minutes were priced at the current time to
   expiry, so a same-day leg drew the afternoon's gamma at the morning's prices). `times` (epoch ms, one per price): each
   leg is re-priced with the time to its expiry that minute had — its time now plus the time since that minute. */
export function levelNetPath(snapshot: MarketSnapshot, chain: readonly StrikeNode[], prices: readonly number[], times?: readonly number[]): { path: number[]; complete: boolean } | null {
  const set = legSet(snapshot, chain);
  if (!set || !set.withVol) return null;
  const gross = set.legs.reduce((a, l) => a + Math.abs(l.g0), 0);
  const legs = set.legs.map(l => (Math.abs(l.g0) < gross * 1e-7 || (!l.ownIv && Math.abs(l.g0) < gross * 1e-5) ? { ...l, iv: 0 } : l));
  const wall = Date.now();
  const ref = pricingClock(undefined, wall);
  const YEAR_MS = YEAR_MIN * 60_000;
  const path = prices.map((S, i) => {
    const at = times?.[i];
    const back = at != null && Number.isFinite(at) ? Math.max(0, ref - at) / YEAR_MS : 0;
    const these = back > 0 ? legs.map(l => (l.iv > 0 && l.t > 0 ? { ...l, t: l.t + back, t0: l.t } : l)) : legs;
    const v = netGammaAt(these, snapshot.spot, S, DEFAULT_R);
    return v === 0 ? 0 : -v;
  });
  return { path, complete: set.complete };
}

/* ---- the words ----------------------------------------------------------------------------------------------- */

/** Long (absorbing) or short (amplifying) gamma at spot, off the house-signed net — the ONE regime rule */
export const regimeOfNet = (houseNet: number): 'LONG' | 'SHORT' | null => (houseNet < 0 ? 'LONG' : houseNet > 0 ? 'SHORT' : null);

const fmtK = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? v.toFixed(0) : v.toFixed(2));

/** The flip in a reader's words: "766.10" — or "no flip nearby" with what the book is across the whole range */
export function flipWords(read: Pick<FlipRead, 'flip' | 'netAtSpot' | 'range'>): string {
  if (read.flip != null) return fmtK(read.flip);
  const pct = Math.round(read.range * 100);
  return read.netAtSpot < 0 ? `no flip within ±${pct}% — dealers are long gamma across the whole range` : read.netAtSpot > 0 ? `no flip within ±${pct}% — dealers are short gamma across the whole range` : 'no flip nearby';
}

/** The short form for a cell: the flip, or "none nearby" */
export const flipShort = (read: Pick<FlipRead, 'flip'>): string => (read.flip != null ? fmtK(read.flip) : 'none nearby');

/** What the flip means here, one sentence: which side is which on THIS book */
export function flipMeaning(read: Pick<FlipRead, 'flip' | 'netAtSpot' | 'range'>, spot: number): string {
  if (read.flip == null) return flipWords(read);
  const long = read.netAtSpot < 0;
  const dir = read.flip > spot ? 'above' : 'below';
  return long
    ? `Dealers are long gamma here (their hedging absorbs moves); a move ${dir} ${fmtK(read.flip)} turns them short gamma, and their hedging starts to amplify moves.`
    : `Dealers are short gamma here (their hedging amplifies moves); a move ${dir} ${fmtK(read.flip)} turns them long gamma, and their hedging starts to absorb moves.`;
}

/** Which side of the flip absorbs, on THIS book (the fourth audit's m4: the tip said "above it absorbs, below it
    amplifies" whatever the book): the side price is on wears the regime of the net, the far side the other */
export function flipSidesWords(flip: number, spot: number, houseNet: number): string {
  const long = houseNet < 0;
  const aboveAbsorbs = long ? flip < spot : flip > spot;
  return aboveAbsorbs
    ? 'where dealer hedging switches sides. On this book, above it their hedging absorbs moves, below it amplifies them.'
    : 'where dealer hedging switches sides. On this book, below it their hedging absorbs moves, above it amplifies them.';
}

/* ---- "expires today", one wording for every page (the Map's clock, the Board, Compare, the Agenda) -------------- */

/** What "Expires today" prints when nothing on the name expires that day: "nothing expires today", after the close
    "nothing expires Fri 10/23" (the fourth audit: "— none today" sat under "EXPIRES FRI 10/23") */
export const bellNone = (): string => {
  const b = bellDay();
  return `nothing ${b.head.charAt(0).toLowerCase()}${b.head.slice(1)}`;
};
export const BELL_NONE_TITLE = (ticker: string): string => `Nothing on ${ticker} expires ${todayScopeLabel() === 'Today' ? 'today' : `on ${shortDay(bellDay().date)}, the next session`} — its nearest contracts expire on a later date`;

/* ---- the book in one sentence, on the one regime rule ----------------------------------------------------------- */

export interface RegimeRead {
  key: 'ON THE FLIP' | 'PINNED' | 'ABSORBING' | 'WHIPSAW' | 'AMPLIFYING';
  read: string;
}

/**
 * THE BOOK READ AS ONE SENTENCE — PINPOINT'S (replacing data/gex.ts readHeatPattern on these pages, which named the
 * regime by the side of the flip: "below the flip the hedging amplifies moves, whatever the book nets to"). The regime
 * is the sign of net gamma at spot; the flip is where it changes; the levels are named as the Agenda names them — the
 * call wall (the most call hedging) and the put wall (the most put hedging), each described from where it sits against
 * price (core/walls.ts callWallWords / putWallWords) — a put wall above price is overhead hedging, not a floor.
 */
export function readRegime(levels: { spot: number; flip: number; flipFound?: boolean; callWall: number; putWall: number; net?: number }, netAt?: (strike: number) => number | null): RegimeRead {
  const { spot, callWall, putWall } = levels;
  const flip = levels.flipFound === false ? null : levels.flip;
  /* one strike format on every page (the seventh audit's m2: "769.00" here, "769" everywhere else) */
  const px = fmtK;
  const long = levels.net != null ? levels.net < 0 : flip != null && spot >= flip;
  /* THE WALLS ARE THE MOST CALL AND THE MOST PUT GAMMA, EITHER SIDE OF PRICE (core/walls.ts pickLegWalls, the second
     re-audit 2026-10-22) — so each is placed in words by where it actually is */
  /* ONE TOLERANCE FOR "AT PRICE" (core/walls.ts wallPlace, 0.05%): the clause and the wall's words beside it agree */
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
    /* the one order (core/walls.ts LEVEL_ORDER): the call wall, then the put wall (the seventh audit's m2) */
    read: `Dealers are short gamma, so their hedging amplifies moves. ${cap(cw)}: ${callWallWords(callWall, spot, netAt?.(callWall))}; ${pw}: ${putWallWords(putWall, spot, netAt?.(putWall))}.${flipClause}`,
  };
}
