import { impliedVolFromPrice } from './greeks';
import { tradingMinutes, tradingYears, TRADING_DAYS } from './tradingYear';
import { sessionCloseMinOn } from './calendar';
import { nyIsoDate, nyMinutes } from './nyTime';

/** The vendor's year. Their own implied move is k·S·σ·√(dte/365). */
const CALENDAR_YEAR_MIN = 365 * 24 * 60;
const FLOOR_MIN = 5;

/** Calendar minutes from `now` to the expiry's cash close (16:00 ET, 13:00 on an early close), five at the least. This is the clock a 365-day vol was solved on. */
export function calendarYears(expiry: string, nowMs = Date.now()): number {
  const today = nyIsoDate(nowMs);
  const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const mins = days * 1440 + (sessionCloseMinOn(expiry) - nyMinutes(nowMs));
  return Math.max(FLOOR_MIN, mins) / CALENDAR_YEAR_MIN;
}

/** A calendar-year vol on the trading clock with the variance unchanged: σ_trading² · T_trading = σ_vendor² · T_calendar. */
export function vendorIvOnTradingClock(vendorIv: number, expiry: string, nowMs = Date.now()): number {
  if (!(vendorIv > 0)) return 0;
  const tTrade = tradingYears(expiry, nowMs);
  const tCal = calendarYears(expiry, nowMs);
  if (!(tTrade > 0) || !(tCal > 0)) return vendorIv;
  return vendorIv * Math.sqrt(tCal / tTrade);
}

/**
 * THE one-sigma move, dollars, for every page: an at-the-money vol quoted on the calendar year for `expiry`, moved onto
 * the trading clock with the variance unchanged, over `horizonMin` trading minutes (the variance runs only while the
 * market is open): S × σ_trading × √(minutes / (390 × 252)). With `horizonMin` = the minutes left to the expiry's close
 * this is exactly S·σ·√T_calendar, the move the option prices. 0 without a price, a vol or a horizon.
 */
export function sigmaMoveOfQuotedIv(spot: number, quotedIv: number, expiry: string, horizonMin: number, nowMs = Date.now()): number {
  if (!(spot > 0) || !(quotedIv > 0) || !(horizonMin > 0)) return 0;
  const ivTrade = vendorIvOnTradingClock(quotedIv, expiry, nowMs);
  return spot * ivTrade * Math.sqrt(horizonMin / (390 * TRADING_DAYS));
}

/** The same σ to the expiry's own close: S·σ·√T on the expiry's clock (null once the expiry has closed). */
export function sigmaToExpiry(spot: number, quotedIv: number, expiry: string, nowMs = Date.now()): number | null {
  const left = tradingMinutes(expiry, nowMs, false);
  return left == null ? null : sigmaMoveOfQuotedIv(spot, quotedIv, expiry, left, nowMs);
}

/** ∂σ_trading/∂σ_quoted = √(T_calendar/T_trading): a vega, vanna or zomma taken per trading-clock vol point, times this, is
    per point of the vol the vendor quotes (the calendar vol a trader reads); vomma takes it twice. */
export function quotedVolPoint(expiry: string, nowMs = Date.now()): number {
  const tTrade = tradingYears(expiry, nowMs);
  const tCal = calendarYears(expiry, nowMs);
  return tTrade > 0 && tCal > 0 ? Math.sqrt(tCal / tTrade) : 1;
}

/** A 0DTE quote is stale after 2 minutes. A longer expiry keeps 15. */
export function quoteMaxAge(expiry: string, nowMs = Date.now()): number {
  return expiry === nyIsoDate(nowMs) ? 2 * 60_000 : 15 * 60_000;
}

/** Mid only when the spread is at most 40% of it. Wider than that, the mid is the spread. */
const SPREAD_OF_MID = 0.4;

export function usableMid(bid: number, ask: number): number {
  if (!(ask > 0) || bid < 0 || ask + 1e-6 < bid) return 0;
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return 0;
  if ((ask - bid) / mid > SPREAD_OF_MID) return 0;
  return mid;
}

/** The vol the trading clock prices: solved from the mid when the spread is tight, else the vendor print rescaled to the same variance. */
export function ivOnTradingClock(
  bid: number,
  ask: number,
  vendorIv: number,
  spot: number,
  strike: number,
  expiry: string,
  right: 'C' | 'P',
  nowMs = Date.now(),
  r?: number,
  q?: number,
): number {
  const t = tradingYears(expiry, nowMs);
  const mid = usableMid(bid, ask);
  if (mid > 0 && spot > 0 && strike > 0 && t > 0) {
    const solved = impliedVolFromPrice(mid, spot, strike, t, right, r, q);
    if (solved != null && solved > 0.01 && solved < 5) return solved;
  }
  return vendorIvOnTradingClock(vendorIv, expiry, nowMs);
}

interface SmilePoint {
  strike: number;
  iv: number;
}

function off(v: number, line: number): boolean {
  return line > 0 && (v > line * 1.45 || v < line / 1.45);
}

/** Interior strikes use their two neighbours. The wings use the line through the next two strikes. */
export function smoothSmile(points: readonly SmilePoint[]): SmilePoint[] {
  const known = points.filter(p => p.iv > 0).slice().sort((a, b) => a.strike - b.strike);
  const bad = new Set<number>();
  const lineAt = (i: number, j: number, k: number): number => {
    const a = known[j];
    const b = known[k];
    if (!a || !b || b.strike === a.strike) return known[i]?.iv ?? 0;
    const u = (known[i].strike - a.strike) / (b.strike - a.strike);
    return a.iv + (b.iv - a.iv) * u;
  };
  if (known.length >= 3) {
    if (off(known[0].iv, lineAt(0, 1, 2))) bad.add(known[0].strike);
    if (off(known[known.length - 1].iv, lineAt(known.length - 1, known.length - 3, known.length - 2))) bad.add(known[known.length - 1].strike);
  }
  for (let i = 1; i < known.length - 1; i++) {
    const mid = (known[i - 1].iv + known[i + 1].iv) / 2;
    if (off(known[i].iv, mid)) bad.add(known[i].strike);
  }
  const kept = known.filter(p => !bad.has(p.strike));
  return points.map(p => {
    if (!bad.has(p.strike)) return p;
    let lo = kept[0];
    let hi = kept[kept.length - 1];
    if (!lo || !hi) return { strike: p.strike, iv: 0 };
    for (const q of kept) {
      if (q.strike <= p.strike) lo = q;
      if (q.strike >= p.strike) {
        hi = q;
        break;
      }
    }
    if (!lo || !hi || hi.strike === lo.strike) return { strike: p.strike, iv: 0 };
    const u = (p.strike - lo.strike) / (hi.strike - lo.strike);
    if (u < -0.5 || u > 1.5) return { strike: p.strike, iv: 0 };
    return { strike: p.strike, iv: lo.iv + (hi.iv - lo.iv) * u };
  });
}

/** Five sessions or fewer. Open interest is already stale there. */
export function flowWindow(expiry: string, nowMs = Date.now()): boolean {
  const minutes = tradingMinutes(expiry, nowMs, false);
  if (minutes == null) return false;
  return minutes <= 5 * 390;
}

/** Dealer inventory. A customer buy at the ask shortens the dealer. A customer sale at the bid lengthens it. The count may cross zero. Multi-leg volume is removed in proportion, then the ask and the bid are what is left. */
export function dealerInventory(oi: number, askVol: number, bidVol: number, multiVol: number, volume: number): number {
  const complex = volume > 0 ? Math.min(1, Math.max(0, multiVol / volume)) : 0;
  const ask = Math.max(0, askVol) * (1 - complex);
  const bid = Math.max(0, bidVol) * (1 - complex);
  return oi - ask + bid;
}

/** Ask minus bid after multi-leg volume is removed. This is the net, not the inventory, and it may be negative. */
export function flowImbalance(askVol: number, bidVol: number, multiVol: number, volume: number): number {
  const complex = volume > 0 ? Math.min(1, Math.max(0, multiVol / volume)) : 0;
  return Math.max(0, askVol) * (1 - complex) - Math.max(0, bidVol) * (1 - complex);
}

/** Below this, the classified net is smaller than the noise in the side label. Tuned when the morning miss is in. */
const FLOW_FIRM = 0.02;

/** Net as a share of gross volume, reduced by the share that printed at mid or with no side. */
export function flowConfidence(net: number, volume: number, unsigned: number): number {
  if (!(volume > 0)) return 1;
  const known = 1 - Math.min(1, Math.max(0, unsigned));
  return (Math.abs(net) / volume) * known;
}

/** False when the net is under about 2% of gross once unsigned volume is taken out. No tape means the open-interest book, which is firm. */
export function flowFirm(net: number, volume: number, unsigned: number): boolean {
  if (!(volume > 0)) return true;
  return flowConfidence(net, volume, unsigned) >= FLOW_FIRM;
}

/** Share of the contracts that printed at mid or with no side. */
export function unsignedShare(midVol: number, noSideVol: number, volume: number): number {
  if (!(volume > 0)) return 0;
  return Math.min(1, Math.max(0, (midVol + noSideVol) / volume));
}

/** A gap is marked only when it is both a fifth of that strike and 8% of the biggest node. */
export function markGap(flow: number, oi: number, biggest: number): boolean {
  const gap = Math.abs(flow - oi);
  const scale = Math.max(Math.abs(flow), Math.abs(oi));
  return scale > 0 && biggest > 0 && gap / scale > 0.2 && gap >= biggest * 0.08;
}
