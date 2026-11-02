/* Where the market is, one reading for the mark, the signature, the rail and the footer, plus a plain sentence per state
   (overnight, pre-market, open, after hours, closed, early close, holiday). The rule is core/session.ts — the one session
   the whole site follows: the week opens Sunday 20:00 with the overnight session, not Monday 09:30. */

import { EARLY_CLOSES } from '../core/calendar';
import { nextOpenLine, sessionAt, sessionBadge, whenWords, type MarketSessionAt } from '../core/session';

type MarketStateKind = 'overnight' | 'open' | 'pre-market' | 'after-hours' | 'closed' | 'early-close' | 'holiday';

interface MarketState {
  kind: MarketStateKind;
  /** the state word the brand prints beside the dot: live whenever a session trades (overnight, pre, regular, after) */
  word: 'live' | 'closed';
  /** the short form the rail and the footer print: "overnight", "pre-market", "market open", "after hours", "closed for the weekend" */
  short: string;
  /** the rail's badge: "Overnight · open" … "Closed · overnight opens Sun 8:00 PM ET" */
  badge: string;
  /** one plain sentence */
  line: string;
  session: MarketSessionAt;
}

/** The holiday's name, by where it falls — enough for the line, not a calendar of its own */
function holidayName(iso: string): string {
  const m = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (m === 1 && day <= 2) return 'New Year’s Day';
  if (m === 1) return 'Martin Luther King Jr. Day';
  if (m === 2) return 'Presidents’ Day';
  if (m === 3 || m === 4) return 'Good Friday';
  if (m === 5) return 'Memorial Day';
  if (m === 6) return 'Juneteenth';
  if (m === 7) return 'Independence Day';
  if (m === 9) return 'Labor Day';
  if (m === 11) return 'Thanksgiving';
  return 'Christmas';
}

/** When the next session opens while the market is shut (null while one trades): "overnight opens Sun 8:00 PM ET" for
    the rail, "overnight Sun 8:00 PM ET (regular Mon 9:30 AM ET)" for a hover. */
export function nextOpenWords(now: Date = new Date()): { short: string; long: string } | null {
  const s = sessionAt(now.getTime());
  if (s.phase !== 'closed' || !s.nextPhase) return null;
  const short = nextOpenLine(s) ?? '';
  const regular = s.regularOpenAt > now.getTime() ? ` · the regular session opens ${whenWords(s.regularOpenAt, now.getTime())}` : '';
  return { short, long: `${short}${regular}` };
}

/** Where the market is right now, as the brand says it */
export function readMarketState(now: Date = new Date()): MarketState {
  const s = sessionAt(now.getTime());
  const badge = sessionBadge(s);
  const reg = whenWords(s.regularOpenAt, now.getTime());
  const early = EARLY_CLOSES.has(s.tradingDay) ? ' Early close at 1:00 PM ET.' : '';
  const base = { session: s, badge };
  if (s.phase === 'overnight') return { ...base, kind: 'overnight', word: 'live', short: 'overnight', line: `Overnight session. The regular session opens ${reg}.${early}` };
  if (s.phase === 'pre') return { ...base, kind: 'pre-market', word: 'live', short: 'pre-market', line: `Pre-market. The regular session opens at 9:30 AM ET.${early}` };
  if (s.phase === 'regular') {
    if (s.isEarlyClose) return { ...base, kind: 'early-close', word: 'live', short: 'market open', line: 'Early close today at 1:00 PM ET.' };
    return { ...base, kind: 'open', word: 'live', short: 'market open', line: 'The market is open.' };
  }
  if (s.phase === 'post') return { ...base, kind: 'after-hours', word: 'live', short: 'after hours', line: `After hours. ${nextOpenLine({ ...s, open: false, next: s.nextPhase }) ?? ''}`.trim() };
  const next = nextOpenLine({ ...s, open: false, next: s.nextPhase });
  const opens = next ? ` The ${next.replace(' opens ', ' session opens ')}.` : '';
  if (s.isHoliday) return { ...base, kind: 'holiday', word: 'closed', short: `closed for ${holidayName(s.date)}`, line: `Closed for ${holidayName(s.date)}.${opens}` };
  const wd = new Date(`${s.date}T12:00:00Z`).getUTCDay();
  const weekend = wd === 0 || wd === 6 || (wd === 5 && s.minute >= 20 * 60);
  if (weekend) return { ...base, kind: 'closed', word: 'closed', short: 'closed for the weekend', line: `The market is closed.${opens}` };
  if (EARLY_CLOSES.has(s.date)) return { ...base, kind: 'closed', word: 'closed', short: 'closed early', line: `The market closed early at 1:00 PM ET.${opens}` };
  return { ...base, kind: 'closed', word: 'closed', short: 'closed', line: `The market is closed.${opens}` };
}
