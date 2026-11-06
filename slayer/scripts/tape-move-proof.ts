/*
  Tape move proof: Pinpoint's tape (components/gex/TapeBox.tsx) prints "one move" as the move LEFT to the close while
  the session runs. Its band is the field's 1σ once the field is drawn, else the last price ± the 1σ to the close; the
  whole move around the close, and the card that says "Nothing left in this session", come only once no minute is left.
  SITECHECK 2026-11-06: at 10:46 ET, 314 minutes before the close, the Map read "One move 731.14 – 746.84. Nothing left
  in this session" (SPY 738.99 ± a full session's 7.85) while its field was still being drawn; the 1σ to the close was 7.54.
  Run:  npx tsx scripts/tape-move-proof.ts
*/
import { oneMoveBand, shutCardShows } from '../src/components/gex/TapeBox';

let fail = 0;
const check = (what: string, ok: boolean, got?: unknown) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` (got ${JSON.stringify(got)})`}`);
};

const SPOT = 738.99;
const TO_CLOSE = 7.54; // the 1σ left to the close (book/move.ts peekMoveToClose)
const SHUT = 'today 731.14–746.84'; // spot ± a full session's 1σ (7.85)
const FIELD = { lo1: 731.6, hi1: 746.3 };

/* mid-session, the field not drawn yet: the move left to the close, and no "nothing left" card */
const mid = oneMoveBand(TO_CLOSE, 314, SPOT, null, SHUT);
check('mid-session with no field: last ± the 1σ to the close', mid === '731.45–746.53', mid);
check('mid-session with no field: never the whole-session band', mid !== SHUT, mid);
check('mid-session with no field: no "nothing left in this session" card', !shutCardShows(314, null, '731.14–746.84'));
/* mid-session with the field drawn: the field's band */
const drawn = oneMoveBand(TO_CLOSE, 314, SPOT, FIELD, SHUT);
check('mid-session with the field: the field’s 1σ', drawn === '731.60–746.30', drawn);
check('the card stays off while the field is drawn', !shutCardShows(0, FIELD, '731.14–746.84'));
/* after the close: the whole move around the close, and the card */
const shut = oneMoveBand(7.85, 0, SPOT, null, SHUT);
check('after the close: the whole move around the close', shut === SHUT, shut);
check('after the close with no field: the card shows', shutCardShows(0, null, '731.14–746.84'));
/* no 1σ yet */
check('no 1σ yet: "…"', oneMoveBand(null, 314, SPOT, null, SHUT) === '…');

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\ntape-move proof: all checks passed');
