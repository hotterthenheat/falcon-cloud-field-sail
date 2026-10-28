/*
  The Terrain contract the briefs named: no fake flip, stale is stale,
  missing open interest is not a pin, replay cannot see the future.
*/
import { DEALER_MODEL, figureOf, pinFromOi, snapsAsOf, unavailablePrice, STALE_MS } from '../src/data/exposureScope';

let failed = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) {
    failed += 1;
    console.error('FAIL', name);
  } else console.log('ok', name);
};

const spot = 500;
check('missing flip is not the spot', !Number.isFinite(unavailablePrice(null)) && unavailablePrice(null) !== spot);
check('missing wall is not the spot', !Number.isFinite(unavailablePrice(undefined)));
check('a real wall stays', unavailablePrice(455) === 455);

const fresh = figureOf(769.2, 'observed', 1_000, 1_000 + 10_000);
check('a fresh print is observed', fresh.status === 'OBSERVED' && fresh.value === 769.2);
const stale = figureOf(769.2, 'observed', 1_000, 1_000 + STALE_MS + 1);
check('an old print is stale', stale.status === 'STALE');
const gone = figureOf(null, 'calculated', 1_000, 2_000);
check('no flip is unavailable', gone.status === 'UNAVAILABLE' && gone.value === null);

check('no open interest is not a pin', pinFromOi([{ strike: 100, callOI: 0, putOI: 0 }, { strike: 105 }]) === null);
check('the heaviest open interest is the pin', pinFromOi([{ strike: 100, callOI: 2, putOI: 1 }, { strike: 110, callOI: 9, putOI: 0 }]) === 110);

const snaps = [{ time: 10, v: 1 }, { time: 20, v: 2 }, { time: 30, v: 3 }];
const seen = snapsAsOf(snaps, 20);
check('replay stops at the bar', seen.length === 2 && seen[1].time === 20 && !seen.some(s => s.time > 20));

check('dealer prior is labeled a model', DEALER_MODEL.status === 'MODELED' && DEALER_MODEL.note.includes('not observed'));

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('terrain contract proof passed');
