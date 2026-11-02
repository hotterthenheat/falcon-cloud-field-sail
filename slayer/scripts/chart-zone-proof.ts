/* The axis named one day twice (Terrain, SPY 15m, "Oct 29 … Oct 29"): the library put its Day tick on the first bar of
   each UTC day, the overnight session's 20:00 New York bar, and the formatter named it in New York. The weights now
   follow the zone's own midnights (src/components/gex/zoneWeights.ts). */
import { fillZoneWeights, zoneShift, zoneWeight } from '../src/components/gex/zoneWeights';
import { nyWallTime } from '../src/core/nyTime';

const DAY = 50;
const fail = (m: string) => {
  throw new Error(`chart-zone-proof: ${m}`);
};

/* A 15m tape the way Terrain held it on Sunday 1 Nov 2026: the Oct 28 and Oct 29 extended days (04:00–20:00 New
   York), then the overnight that opened Thursday 20:00 and ran into Friday's pre-market and session. */
const bars: number[] = [];
const span = (y: number, mo: number, d: number, h0: number, m0: number, h1: number, m1: number) => {
  for (let t = nyWallTime(y, mo, d, h0, m0); t < nyWallTime(y, mo, d, h1, m1); t += 15 * 60_000) bars.push(t / 1000);
};
span(2026, 10, 28, 4, 0, 20, 0);
span(2026, 10, 29, 4, 0, 20, 0);
span(2026, 10, 29, 20, 0, 23, 59);
span(2026, 10, 30, 0, 0, 20, 0);

const nyDate = (sec: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(sec * 1000));
const dayTicks = (zone: string | null) => {
  const pts = bars.map(t => ({ timeWeight: 0, originalTime: t as unknown }));
  fillZoneWeights(pts, 0, zoneShift(zone));
  return pts.filter((p, i) => i > 0 && p.timeWeight >= DAY).map(p => p.originalTime as number);
};

/* The library's own calendar (UTC) reproduces the bug: the 20:00 New York bar is a Day tick, named "Oct 29" again */
const utc = dayTicks('UTC').map(nyDate);
if (utc.join(',') !== 'Oct 29,Oct 29') fail(`UTC weights should reproduce the doubled day, got ${utc.join(',')}`);

/* New York's calendar: Oct 29 at its 04:00 pre-market bar, Oct 30 at the overnight's midnight bar — each day once */
const ny = dayTicks('America/New_York');
const names = ny.map(nyDate);
if (names.join(',') !== 'Oct 29,Oct 30') fail(`New York day ticks ${names.join(',')}`);
if (ny[0] !== nyWallTime(2026, 10, 29, 4, 0) / 1000) fail('Oct 29 tick is not on its first bar');
if (ny[1] !== nyWallTime(2026, 10, 30, 0, 0) / 1000) fail('Oct 30 tick is not on New York midnight');
if (new Set(names).size !== names.length) fail('a day is named twice');

/* Incremental weighing (a live bar appended) agrees with weighing the whole tape */
const whole = bars.map(t => ({ timeWeight: 0, originalTime: t as unknown }));
fillZoneWeights(whole, 0, zoneShift('America/New_York'));
const step = bars.map(t => ({ timeWeight: 0, originalTime: t as unknown }));
fillZoneWeights(step, 0, zoneShift('America/New_York'));
for (let i = 0; i < step.length; i++) step[i].timeWeight = i === 0 ? step[i].timeWeight : 0;
for (let i = 1; i < step.length; i++) fillZoneWeights(step, i, zoneShift('America/New_York'));
for (let i = 0; i < whole.length; i++) if (whole[i].timeWeight !== step[i].timeWeight) fail(`incremental weight differs at ${i}`);

/* Fall back (Sunday 1 Nov 2026, 02:00 EDT → 01:00 EST): New York's midnight is 04:00 UTC before, 05:00 UTC after */
const sh = zoneShift('America/New_York');
const sat = nyWallTime(2026, 10, 31, 23, 45) / 1000;
const sunMid = nyWallTime(2026, 11, 1, 0, 0) / 1000;
const monLast = nyWallTime(2026, 11, 1, 23, 45) / 1000;
const monMid = nyWallTime(2026, 11, 2, 0, 0) / 1000;
if (sh(sunMid) !== -4 * 3600 || sh(monMid) !== -5 * 3600) fail(`DST shift ${sh(sunMid)} ${sh(monMid)}`);
if (zoneWeight(sunMid + sh(sunMid), sat + sh(sat)) !== 60) fail('Nov 1 midnight (EDT) is not a Month tick');
if (zoneWeight(monMid + sh(monMid), monLast + sh(monLast)) !== DAY) fail('Nov 2 midnight (EST) is not a Day tick');
/* 19:00 EST is UTC midnight after the change: not a day in New York */
const eve = nyWallTime(2026, 11, 2, 19, 0) / 1000;
if (zoneWeight(eve + sh(eve), eve - 900 + sh(eve - 900)) >= DAY) fail('19:00 EST was weighed a day');

/* Business days are dates already: never shifted */
const bd = [{ timeWeight: 0, originalTime: '2026-10-29' as unknown }, { timeWeight: 0, originalTime: { year: 2026, month: 10, day: 30 } as unknown }];
fillZoneWeights(bd, 0, zoneShift('Asia/Tokyo'));
if (bd[1].timeWeight !== DAY) fail('business day weight');

console.log(`chart-zone-proof ok · day ticks UTC=${utc.join('/')} NY=${names.join('/')}`);
