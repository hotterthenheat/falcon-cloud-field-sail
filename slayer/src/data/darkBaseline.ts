/* A name's dark-pool day against its own trailing sessions: today's dark share of volume and today's dark posture,
   each as a z-score and a percentile over the name's previous DARK_BASELINE_SESSIONS (20) sessions.

   DEFINITIONS

   Dark share of a session (darkDayOf, traceDark): the session's off-exchange shares at prices the lit tape also
   traded (/darkpool/{t}/price-levels?date=, the off-market buckets set apart) over the session's whole share volume,
   in %. The whole volume is the largest running total_volume of that date's one-minute bars
   (/stock/{t}/ohlc/1m?date=, pre-market to 20:00) — what Trace's dated dark day (useDarkDay) divides by. Checked
   equal to the last dark print's cumulative `volume` (SPY 2026-10-29: 40,298,297; 2026-10-23: 33,422,019). The daily
   bars are not used: their pr / r / po rows swap `volume` and `total_volume` and some days lack the po row (SPY
   2026-10-23 reads 7,775,349). A session with no volume, or fewer shares in the day than in the dark, has no share
   (NaN) and is left out of the baseline.

   Dark posture of a session (darkPosture, traceDark — the one definition): over the session's regular-hours dark
   prints priced at the quote and sized for the name (notional ≥ darkSizedFloor(adv)), net = (dollars over the mid −
   dollars under it) / their dollars × 100. The prints are read whole-session: every print of the date with premium
   ≥ the floor (/darkpool/{t}?date=&min_premium=, paged back by older_than), cancelled ones dropped, each once.
   The floor is fixed for the whole window at today's (one second of the average day, from the screener's avg30
   volume × close), so every session is cut at the same line. A session with fewer than DARK_MIN_PRINTS (12) read
   prints has no posture and is left out of the posture baseline.

   Baseline statistics over the n previous sessions that have a value (x = today, b_i = the baseline values):
     mean = Σb / n;  sd = √(Σ(b − mean)² / (n − 1))  (sample);  z = (x − mean) / sd  (null when n < 2 or sd = 0);
     percentile = 100 × (#{b < x} + ½ #{b = x}) / n  (mid-rank; 0–100); both null when the status is UNAVAILABLE.
   Status: OK with n ≥ 20; PARTIAL with 5 ≤ n < 20 (coverage says how many); UNAVAILABLE with n < 5 or no value today.
   Coverage names every session wanted, which had a share, which had a posture, and which were missing. */

import type { DarkPoolPrint } from '../types/darkpool';
import { isoDate, sessionBefore } from '../core/calendar';
/* through traceLive, as every Trace module does: traceRows is in an import cycle that only resolves in that order */
import { darkDayOf, darkPosture, darkPrint, darkSizedFloor, num, rowsOf } from './traceLive';
import { postureOfNet } from './traceLean';

export const DARK_BASELINE_SESSIONS = 20;
/** Fewer baseline sessions than this is no baseline */
export const DARK_BASELINE_MIN = 5;
/** Pages of 500 prints read for one session's posture, at most */
const POSTURE_PAGES = 12;
const PAGE = 500;

export type BaselineStatus = 'OK' | 'PARTIAL' | 'UNAVAILABLE';
export interface BaselineStat {
  today: number;
  n: number;
  mean: number;
  sd: number;
  z: number | null;
  percentile: number | null;
  status: BaselineStatus;
}

/** Today's value against the baseline values (see the header) */
export function baselineStat(today: number, history: readonly number[], wanted = DARK_BASELINE_SESSIONS): BaselineStat {
  const b = history.filter(Number.isFinite);
  const n = b.length;
  const mean = n ? b.reduce((a, v) => a + v, 0) / n : NaN;
  const sd = n >= 2 ? Math.sqrt(b.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : NaN;
  const okToday = Number.isFinite(today);
  const status: BaselineStatus = !okToday || n < DARK_BASELINE_MIN ? 'UNAVAILABLE' : n >= wanted ? 'OK' : 'PARTIAL';
  /* no baseline, no figure: an UNAVAILABLE stat carries no z and no percentile */
  const z = status !== 'UNAVAILABLE' && sd > 0 ? (today - mean) / sd : null;
  const percentile = status !== 'UNAVAILABLE' ? (100 * (b.filter(v => v < today).length + 0.5 * b.filter(v => v === today).length)) / n : null;
  return { today, n, mean, sd, z, percentile, status };
}

/** One session's dark figures */
export interface DarkSession {
  iso: string;
  darkShares: number;
  dayVolume: number;
  /** % of the day's volume; NaN when not to hand */
  sharePct: number;
  /** darkPosture's net, %, and whether enough prints were read */
  postureNet: number;
  postureEnough: boolean;
  postureRead: number;
}
export interface DarkBaseline {
  ticker: string;
  todayIso: string;
  /** The sized line every session was cut at, dollars */
  floorUsd: number;
  today: DarkSession;
  share: BaselineStat;
  posture: BaselineStat & { todayPosture: 'ACCUMULATING' | 'DISTRIBUTING' | 'BALANCED' | null };
  coverage: { wanted: number; asked: string[]; withShare: string[]; withPosture: string[]; missing: string[] };
  history: DarkSession[];
}

/** The baseline from sessions already read: `today` first, then the previous sessions (any order) */
export function darkBaselineOf(ticker: string, today: DarkSession, history: readonly DarkSession[], floorUsd: number, wanted = DARK_BASELINE_SESSIONS, todayPosture: DarkBaseline['posture']['todayPosture'] = null): DarkBaseline {
  const withShare = history.filter(s => Number.isFinite(s.sharePct));
  const withPosture = history.filter(s => s.postureEnough && Number.isFinite(s.postureNet));
  const share = baselineStat(today.sharePct, withShare.map(s => s.sharePct), wanted);
  const posture = baselineStat(today.postureEnough ? today.postureNet : NaN, withPosture.map(s => s.postureNet), wanted);
  const asked = history.map(s => s.iso);
  return {
    ticker,
    todayIso: today.iso,
    floorUsd,
    today,
    share,
    posture: { ...posture, todayPosture },
    coverage: {
      wanted,
      asked,
      withShare: withShare.map(s => s.iso),
      withPosture: withPosture.map(s => s.iso),
      missing: history.filter(s => !Number.isFinite(s.sharePct) && !s.postureEnough).map(s => s.iso),
    },
    history: [...history],
  };
}

/** The session and the `count` trading sessions before it, newest first */
export function sessionsBack(iso: string, count: number): string[] {
  const [y, m, d] = iso.split('-').map(Number);
  let at = new Date(y, m - 1, d);
  const out = [iso];
  for (let i = 0; i < count; i++) {
    at = sessionBefore(at);
    out.push(isoDate(at));
  }
  return out;
}

/** The day's whole share volume from its one-minute bars: the largest running total */
export const dayVolumeOfBars = (bars: Record<string, unknown>[]): number => bars.reduce((m, b) => Math.max(m, num(b.total_volume)), 0);

/** A session's dark prints at or over a premium line, every page, cancelled ones out, each once, of that date only */
export async function sessionDarkPrints(get: (path: string) => Promise<unknown>, ticker: string, iso: string, minPremium: number): Promise<DarkPoolPrint[]> {
  const out: DarkPoolPrint[] = [];
  const seen = new Set<number>();
  const gone = new Set<number>();
  let older: number | null = null;
  for (let page = 0; page < POSTURE_PAGES; page++) {
    const rows = rowsOf(await get(`/darkpool/${encodeURIComponent(ticker)}?date=${iso}&min_premium=${Math.floor(minPremium)}&limit=${PAGE}${older != null ? `&older_than=${older}` : ''}`));
    let oldest = Infinity;
    for (const [i, r] of rows.entries()) {
      const t = Date.parse(String(r.executed_at ?? ''));
      if (Number.isFinite(t)) oldest = Math.min(oldest, t);
      const p = darkPrint(r, i);
      if (r.canceled === true || r.canceled === 'true') {
        gone.add(p.id);
        continue;
      }
      if (seen.has(p.id) || p.dateIso !== iso) continue;
      seen.add(p.id);
      out.push(p);
    }
    if (rows.length < PAGE || !Number.isFinite(oldest) || (older != null && oldest >= older)) break;
    older = oldest;
  }
  return out.filter(p => !gone.has(p.id));
}

/** Read one session's figures */
export async function readDarkSession(get: (path: string) => Promise<unknown>, ticker: string, iso: string, adv: number): Promise<DarkSession> {
  const floor = darkSizedFloor(adv);
  const dayVolume = dayVolumeOfBars(rowsOf(await get(`/stock/${encodeURIComponent(ticker)}/ohlc/1m?date=${iso}&limit=1000`)));
  const levels = rowsOf(await get(`/darkpool/${encodeURIComponent(ticker)}/price-levels?date=${iso}`));
  const day = darkDayOf(levels, dayVolume);
  const prints = await sessionDarkPrints(get, ticker, iso, floor);
  const pv = darkPosture(prints, { advUsd: () => adv });
  return {
    iso,
    darkShares: day?.darkShares ?? 0,
    dayVolume,
    sharePct: day && dayVolume > 0 ? day.sharePct : NaN,
    postureNet: pv.net,
    postureEnough: pv.enough,
    postureRead: pv.read.length,
  };
}

/** Read a name's last session and its trailing sessions and set one against the other. `get` answers a vendor path
    with its JSON (in the app: uwCall(path).data). One call at a time — the key allows three for everyone. */
export async function loadDarkBaseline(get: (path: string) => Promise<unknown>, ticker: string, todayIso: string, opts: { sessions?: number; advUsd?: number } = {}): Promise<DarkBaseline> {
  const t = ticker.toUpperCase();
  const wanted = opts.sessions ?? DARK_BASELINE_SESSIONS;
  let adv = opts.advUsd ?? 0;
  if (!(adv > 0)) {
    const row = rowsOf(await get(`/screener/stocks?ticker=${encodeURIComponent(t)}`)).find(r => String(r.ticker ?? '').toUpperCase() === t);
    adv = row ? num(row.avg30_volume) * num(row.close) : 0;
  }
  const isos = sessionsBack(todayIso, wanted);
  const read: DarkSession[] = [];
  for (const iso of isos) read.push(await readDarkSession(get, t, iso, adv));
  const [today, ...history] = read;
  const pv = today.postureEnough ? postureOfNet(today.postureNet) : null;
  return darkBaselineOf(t, today, history, darkSizedFloor(adv), wanted, pv);
}
