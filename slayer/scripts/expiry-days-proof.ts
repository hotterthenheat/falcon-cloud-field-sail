/*
  The expiry calendar's days (components/gex/ExposureField.tsx, Pinpoint's Expiries card) are the listed dates
  themselves (core/calendar.ts listedExpiry), never a day count read from today.

  Found by the ticker-universe render check, Saturday 2026-11-07: the vendor's expiry rows were written Friday Nov 6 and
  count their dte from that day; read from Saturday, VIX's Wednesday expiries (11-11, 11-18, 12-09, 12-16) and its
  Tuesday ones (11-24, 12-01) all lit one day late on Pinpoint's calendar. A name whose list still carried Friday's
  settled 0-DTE row was re-based (book/levels.ts liveListing) and looked right, which is why SPY never showed it.

  1. On that Saturday every VIX date maps to itself; the old count lands a day late on at least one of them.
  2. A listed date that is not a session walks back to the session before it (a holiday's weeklies expire the day before).
  3. Not an ISO date: the count stands.

  Run: npx tsx scripts/expiry-days-proof.ts
*/
import { freezeClock } from './golden/uwFixtures';

/* Saturday 2026-11-07, 12:00 ET */
freezeClock('2026-11-07T17:00:00Z');
const { listedExpiry, expiryFor, isoDate } = await import('../src/core/calendar');

let failed = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else {
    failed += 1;
    console.log(`  FAIL ${what}`);
  }
};

/* the vendor's /stock/VIX/greek-exposure/expiry rows, written 2026-11-06: [expiry, dte] */
const VIX: [string, number][] = [
  ['2026-11-11', 5], ['2026-11-18', 12], ['2026-11-24', 18], ['2026-12-01', 25], ['2026-12-09', 33], ['2026-12-16', 40], ['2027-01-20', 75],
];
const shown = VIX.map(([d, dte]) => isoDate(listedExpiry(d, dte).date));
ok(shown.every((d, i) => d === VIX[i][0]), `VIX on the Saturday: every listed date is its own day (${shown.join(' ')})`);
const old = VIX.map(([, dte]) => isoDate(expiryFor(dte).date));
ok(old.some((d, i) => d !== VIX[i][0]), `the old day count put them on ${old.join(' ')}`);

/* Thanksgiving 2026-11-26 is a holiday: a date listed on it walks back to the 25th */
ok(isoDate(listedExpiry('2026-11-26', 19).date) === '2026-11-25', 'a listed holiday walks back to the session before it');
ok(isoDate(listedExpiry('2026-11-20', 13).date) === '2026-11-20', 'a Friday monthly is itself');
ok(isoDate(listedExpiry('Nov 20', 13).date) === isoDate(expiryFor(13).date), 'not an ISO date: the day count stands');

if (failed) {
  console.log(`expiry-days-proof: ${failed} FAILED`);
  process.exit(1);
}
console.log('expiry-days-proof: all ok');
