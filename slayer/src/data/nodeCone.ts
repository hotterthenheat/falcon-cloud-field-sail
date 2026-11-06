/* THE NODES VIEW'S CONE (dev only, behind ?nodes=heat|threads; components/gex/nodeConcept.ts). The candidate looks
   draw the expected-move cone off the book's own 1σ — data/book/move.ts, the numbers Pinpoint, the tape's corridor and
   the reach odds print (scripts/expected-move-proof.ts) — so a node and the cone beside it read one expected move:

     - the rest of today's session: peekMoveToClose, the 1σ from now to today's close (a same-day expiry's own move
       once its session runs, else one session's 1σ scaled once by √(minutes left / 390));
     - every session after it: peekDaySigma, one full session's 1σ, its variance running only while the market is open
       (a session of variance a session, the trading clock forwardCone keeps).

   So the variance at h trading minutes ahead is toClose² · min(h, closeMin) / closeMin + session² · max(0, h − closeMin)
   / 390, and 1σ there is its root, in dollars. The cone's clock (how far ahead, where today's close falls) is the
   chart's own (terrainCone coneFrame), so the shape and the tip land on the same bars as today's cone. Pure but for
   bookConeSigma's read of the book store, so scripts/node-cone-proof.ts runs it on the expected-move proof's books. */

import { isTradingDay } from '../core/calendar';
import { nyIsoDate, nySessionPhase } from '../core/nyTime';
import { tradingMinutes, TRADING_DAYS } from '../core/tradingYear';
import { peekDaySigma, peekMoveToClose } from './book/move';
import { sessionAfter, type ForwardCone, type ForwardConePoint } from './terrainCone';

/** One cash session's minutes, the unit peekDaySigma's 1σ is quoted over */
export const BOOK_SESSION_MIN = 390;

/** The book's 1σ, dollars, as the cone reads it */
export interface BookSigma {
  /** Trading minutes from now to today's cash close; 0 when today's session is not running */
  closeMin: number;
  /** 1σ from now to today's close (book/move.ts peekMoveToClose); null when the session is shut or the book has none */
  toClose: number | null;
  /** One full session's 1σ (book/move.ts peekDaySigma); null when the book has none */
  session: number | null;
}

/** The book's 1σ for `ticker` now (null when the book carries no expected move yet) */
export function bookConeSigma(ticker: string, now: number = Date.now()): BookSigma | null {
  const today = nyIsoDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const open = isTradingDay(new Date(y, m - 1, d)) && nySessionPhase(now) === 'open';
  const closeMin = open ? tradingMinutes(today, now, false) ?? 0 : 0;
  const session = peekDaySigma(ticker);
  const toClose = closeMin > 0 ? peekMoveToClose(ticker, null, closeMin) : null;
  const ok = (v: number | null): v is number => v != null && Number.isFinite(v) && v > 0;
  if (!ok(session) && !ok(toClose)) return null;
  return { closeMin, toClose: ok(toClose) ? toClose : null, session: ok(session) ? session : null };
}

/** The variance (dollars²) the book's 1σ puts h trading minutes ahead; NaN when the book cannot price that far */
export function bookVariance(sig: BookSigma, h: number): number {
  if (!(h > 0)) return 0;
  const inToday = sig.closeMin > 0 ? Math.min(h, sig.closeMin) : 0;
  const after = h - inToday;
  /* today's rate off the move to its close; with none, a session's own rate */
  const todayRate = sig.closeMin > 0 && sig.toClose != null ? (sig.toClose * sig.toClose) / sig.closeMin : sig.session != null ? (sig.session * sig.session) / BOOK_SESSION_MIN : NaN;
  /* the sessions after: one session's 1σ a session; with none, today's rate carried on */
  const nextRate = sig.session != null ? (sig.session * sig.session) / BOOK_SESSION_MIN : todayRate;
  return (inToday > 0 ? todayRate * inToday : 0) + (after > 0 ? nextRate * after : 0);
}

/**
 * The cone from `spot` over the chart's clock (`clock.today`: trading minutes to the frame's own close mark, 0 for none;
 * `clock.next`: to the tip), on the book's 1σ. `step`: trading minutes between points. `open`: today's opening price,
 * for today's expected move (open ± one session's 1σ). Null when the book cannot price the tip.
 */
export function bookCone(spot: number, clock: { today: number; next: number }, sig: BookSigma, now: number, step = 5, open: number | null = null): ForwardCone | null {
  if (!(spot > 0)) return null;
  const todayMin = Math.max(0, clock.today);
  const nextMin = Math.max(todayMin, clock.next);
  if (!(nextMin > 0)) return null;
  const tip = bookVariance(sig, nextMin);
  if (!Number.isFinite(tip) || !(tip > 0)) return null;
  const points: ForwardConePoint[] = [];
  const at = (h: number) => {
    const w = Math.sqrt(Math.max(0, bookVariance(sig, h)));
    points.push({ minutesAhead: h, up1: spot + w, dn1: spot - w, up2: spot + 2 * w, dn2: spot - 2 * w });
  };
  const s = Math.max(1, step);
  for (let h = 0; h < nextMin; h += s) at(h);
  if (todayMin > 0 && todayMin !== nextMin && !points.some(p => p.minutesAhead === todayMin)) {
    at(todayMin);
    points.sort((a, b) => a.minutesAhead - b.minutesAhead);
  }
  at(nextMin);
  const today = nyIsoDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const todayIsSession = isTradingDay(new Date(y, m - 1, d));
  const nextDay = sig.closeMin > 0 ? (nextMin <= sig.closeMin ? today : sessionAfter(today)) : todayIsSession && nySessionPhase(now) === 'before' ? today : sessionAfter(today);
  /* the vols the cone stands for, on the trading clock (annualised fraction): σ_session / S · √252 */
  const yearly = (perSession: number | null) => (perSession != null && perSession > 0 ? (perSession / spot) * Math.sqrt(TRADING_DAYS) : null);
  const todaySession = sig.closeMin > 0 && sig.toClose != null ? sig.toClose * Math.sqrt(BOOK_SESSION_MIN / sig.closeMin) : null;
  const sessionSigma = sig.session ?? todaySession;
  const anchor = open != null && open > 0 ? open : null;
  return {
    spot,
    points,
    todayMin,
    nextMin,
    nextDay,
    sigmaToday: todayMin > 0 ? Math.sqrt(bookVariance(sig, todayMin)) : null,
    sigmaNext: Math.sqrt(tip),
    ivToday: yearly(todaySession),
    ivNext: yearly(sessionSigma) ?? 0,
    nextExpiry: nextDay,
    move: anchor != null && sessionSigma != null && sessionSigma > 0 ? { anchor, sigma: sessionSigma, high: anchor + sessionSigma, low: anchor - sessionSigma } : null,
  };
}
