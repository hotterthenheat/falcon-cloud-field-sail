/* Which listed expiry dates an expiry picker may offer for a name. One rule for every page:
   - a date that has settled is not a choice: before today in New York, or today once options have stopped trading
     (16:15 ET at the latest; the vendor still lists Friday's date on Saturday — 709 such dates in the 2026-11-07 audit);
   - a vendor date with no contract behind it is not a choice (the audit's unresolved index products: CBTX, CBTXW,
     SPEQW and SPEQX list dates with no exposure and no contract anywhere — scripts/build-ticker-universe.mjs finds them
     every build, `noContracts` in the generated universe). A date with no exposure but contracts (a new listing with no
     open interest yet, SPX 2026-12-15) stays.
   The terminal's own lists are checked against its contracts on the server before any page reads them
   (server/expiryCheck.mjs); this is the browser's side for the vendor's lists. Every date hidden is logged once. */

import { isSessionDay, nyWall, regularCloseMin } from '../../shared/marketSession.mjs';
import { loadDirectory, noContractDates } from './symbolDirectory';

/** Options stop trading 15 minutes after the stock close at the latest (16:15 New York; 13:15 on an early close):
    after that a same-day date has settled */
const LATE_OPTION_MIN = 15;

export type ShutReason = 'settled' | 'no contracts';

/** Why a listed date is not offered for `ticker` at `at`, or null when it may be offered */
export function expiryShut(ticker: string | null | undefined, iso: string, at: number = Date.now()): ShutReason | null {
  const w = nyWall(at);
  if (iso < w.iso) return 'settled';
  if (iso === w.iso && (!isSessionDay(w.iso) || w.min >= regularCloseMin(w.iso) + LATE_OPTION_MIN)) return 'settled';
  if (ticker && noContractDates(ticker).has(iso)) return 'no contracts';
  return null;
}

const told = new Set<string>();
/** Log a hidden date once per name, date and reason */
function tell(ticker: string, iso: string, why: ShutReason): void {
  const key = `${ticker}|${iso}|${why}`;
  if (told.has(key)) return;
  told.add(key);
  if (told.size > 2_000) told.clear();
  if (why === 'no contracts') console.info(`[expiries] ${ticker} ${iso} hidden: listed with no contract behind it`);
}

/** The items whose date may be offered for `ticker`; `dateOf` reads an item's YYYY-MM-DD (null: not a date, kept).
    `settled: false` leaves the settled rule to a list that already counts from its own floor (Pinpoint's book counts
    from bookToday, which turns to the next session at the close). */
export function pickableExpiries<T>(ticker: string | null | undefined, items: readonly T[], dateOf: (item: T) => string | null, opt: { at?: number; settled?: boolean } = {}): T[] {
  if (ticker) void loadDirectory();
  const at = opt.at ?? Date.now();
  return items.filter(item => {
    const iso = dateOf(item);
    if (!iso) return true;
    let why = expiryShut(ticker, iso, at);
    if (why === 'settled' && opt.settled === false) why = null;
    if (why && ticker) tell(ticker.toUpperCase(), iso, why);
    return !why;
  });
}
