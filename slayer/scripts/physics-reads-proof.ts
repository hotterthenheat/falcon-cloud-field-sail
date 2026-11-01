/*
  The five physics reads on the chart (src/data/physicsReads.ts), fixed fixtures in, hand-computed answers out:
    - the session cut: regular minutes only, off the session module's open and that day's close (an early close too);
      a day's first return is its own open → close and the overnight gap is never a return (lib.py returns);
    - Kaufman efficiency ratio |Σr| / Σ|r| against a hand-computed window, a straight line (1) and a zig-zag (0);
    - Amihud mean |r| / dollar volume in bps per $1M against a hand-computed value, bars with no volume skipped, too few
      traded bars → blank;
    - the market vol shock √(mean r² last 15) / √(mean r² last 390) against the closed form, and its alignment to a
      5-minute chart (the value at each bar's last minute);
    - the HAR band's wiring: the inverse of volOutlook.ts's annualising, the rest-of-day σ at the open / half / bell,
      the early close's shorter session, other days blank, and the chart asking the very hooks Pulse's tile asks;
    - the gamma regime's sign, and its words: damped / extend, never a pin, a pull or a magnet.
  Run:  npx tsx scripts/physics-reads-proof.ts
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  alignShock, amihudSeries, dayOfAnnual, efficiencyRatioSeries, flipDistancePct, gammaRegimeSeries, harBandSeries, hourOfAnnual,
  PHYSICS_READS, regimeWords, regularOf, regularReturns, restOfDaySigma, volShockSeries, type PhysBar,
} from '../src/data/physicsReads';
import { annualiseDay, annualiseHour } from '../src/data/volOutlook';
import { isEarlyClose, sessionLengthOn } from '../src/core/calendar';
import { INDICATOR_ITEMS } from '../src/components/gex/indicatorItems';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
};
const near = (a: number | null | undefined, b: number, e = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= e;

/* Wednesday 2026-10-28 is a full session on New York daylight time: 09:30 ET = 13:30 UTC. Friday 2026-11-27, the day
   after Thanksgiving, closes at 13:00 on standard time: 09:30 ET = 14:30 UTC. */
const OCT28 = Date.UTC(2026, 9, 28, 13, 30) / 1000;
const OCT29 = Date.UTC(2026, 9, 29, 13, 30) / 1000;
const NOV27 = Date.UTC(2026, 10, 27, 14, 30) / 1000;
const bar = (time: number, open: number, close: number, volume = 0): PhysBar => ({ time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume });

/* ---- the session cut ---- */
{
  const at = (base: number, m: number) => base + m * 60;
  const w = regularOf([{ time: at(OCT28, -1) }, { time: at(OCT28, 0) }, { time: at(OCT28, 389) }, { time: at(OCT28, 390) }], 1);
  check('09:29 is off the session, 09:30 and 15:59 on, 16:00 off', !w[0].reg && w[1].reg && w[2].reg && !w[3].reg, JSON.stringify(w));
  check('2026-11-27 is an early close in the calendar', isEarlyClose('2026-11-27') && sessionLengthOn('2026-11-27') === 210);
  const e = regularOf([{ time: at(NOV27, 209) }, { time: at(NOV27, 210) }], 1);
  check('on the early close 12:59 is on and 13:00 is off', e[0].reg && !e[1].reg, JSON.stringify(e));
  const r = regularReturns([bar(at(OCT28, -5), 99, 99.5), bar(at(OCT28, 0), 100, 101), bar(at(OCT28, 1), 101, 102), bar(at(OCT29, 0), 110, 111)], 1);
  check('a pre-market bar has no return', r[0] === null);
  check('the first regular bar is its own open → close', near(r[1], Math.log(101 / 100)));
  check('the next is close → close', near(r[2], Math.log(102 / 101)));
  check('the overnight gap is not a return: the next day starts open → close', near(r[3], Math.log(111 / 110)));
}

/* ---- Kaufman efficiency ratio ---- */
{
  const closes = [100, 101, 100, 102];
  const bars = closes.map((c, i) => bar(OCT28 + i * 60, i === 0 ? 100 : closes[i - 1], c));
  const er = efficiencyRatioSeries(bars, 1, 3);
  /* by hand: the last three returns ln1.01, ln(100/101), ln1.02 → |Σ| = ln 1.02 = 0.0198026, Σ|r| = 2·ln 1.01 + ln 1.02
     = 0.0199007 + 0.0198026 = 0.0397033 → 0.498764 */
  check('ER over the window matches the hand value 0.49876', near(er[3], 0.0198026 / 0.0397033, 2e-5), String(er[3]));
  check('ER is blank until the window is full', er[0] === null && er[1] === null && er[2] !== null);
  const line = Array.from({ length: 10 }, (_, i) => bar(OCT28 + i * 60, 100 + i, 101 + i));
  check('a straight line has ER 1', near(efficiencyRatioSeries(line, 1, 5)[9], 1, 1e-12));
  const zig = Array.from({ length: 10 }, (_, i) => bar(OCT28 + i * 60, i === 0 ? 100 : i % 2 ? 100 : 101, i % 2 ? 101 : 100));
  check('a zig-zag of equal steps has ER 0', near(efficiencyRatioSeries(zig, 1, 4)[9], 0, 1e-12));
}

/* ---- Amihud ---- */
{
  const bars = [bar(OCT28, 100, 100, 1000), bar(OCT28 + 60, 100, 101, 2000), bar(OCT28 + 120, 101, 100, 0)];
  /* by hand: |r| / (close × volume): 0 / 100,000 = 0; 0.00995033 / 202,000 = 4.92590e-8; the third bar did not trade.
     Mean of the two that traded = 2.46295e-8, × 1e10 → 246.295 bps per $1M */
  const a = amihudSeries(bars, 1, 3);
  check('Amihud matches the hand value 246.30 bps per $1M', near(a[2], 246.295, 0.01), String(a[2]));
  const thin = [bar(OCT28, 100, 100, 0), bar(OCT28 + 60, 100, 101, 2000), bar(OCT28 + 120, 101, 100, 0)];
  check('fewer traded bars than a third of the window + 1 → blank', amihudSeries(thin, 1, 3)[2] === null);
}

/* ---- the market vol shock ---- */
{
  const d = 0.001;
  const bars: PhysBar[] = [];
  let c = 400;
  for (let m = 0; m < 390; m++) {
    const step = (m >= 375 ? 2 * d : d) * (m % 2 ? -1 : 1);
    const open = m === 0 ? c / Math.exp(step) : c;
    if (m > 0) c = c * Math.exp(step);
    bars.push(bar(OCT28 + m * 60, open, m === 0 ? c : c));
  }
  const s = volShockSeries(bars);
  const last = s[s.length - 1];
  /* closed form: short mean 4d², long mean (375 d² + 15 · 4d²) / 390 → √(4 · 390 / 435) = 1.893728 */
  check('the shock ratio matches the closed form 1.8937', near(last?.value, Math.sqrt((4 * 390) / 435), 1e-6), String(last?.value));
  const calm = s.find(p => p.time === OCT28 + 200 * 60);
  check('steady minutes read 1', near(calm?.value, 1, 1e-9), String(calm?.value));
  check('blank until a third of the long window', s[0].time === OCT28 + 129 * 60, String((s[0].time - OCT28) / 60));
  const chart = [{ time: OCT28 + 370 * 60 }, { time: OCT28 + 385 * 60 }];
  const al = alignShock(chart, 5, s);
  const at374 = s.find(p => p.time === OCT28 + 374 * 60)!.value;
  check('a 5-minute bar reads the shock at its last minute', near(al[0], at374) && near(al[1], last.value), JSON.stringify(al));
  check('no shock on daily bars', alignShock([{ time: OCT28 }], 1440, s)[0] === null);
}

/* ---- the HAR band's wiring ---- */
{
  check('dayOfAnnual undoes annualiseDay', near(dayOfAnnual(annualiseDay(0.0101)), 0.0101, 1e-15));
  check('hourOfAnnual undoes annualiseHour', near(hourOfAnnual(annualiseHour(0.0023)), 0.0023, 1e-15));
  const annual = 0.16;
  const day = annual / Math.sqrt(252);
  check('rest-of-day σ at the open is the whole day', near(restOfDaySigma(annual, 390, 390), day, 1e-15));
  check('…halfway it is the day × √½', near(restOfDaySigma(annual, 195, 390), day * Math.SQRT1_2, 1e-15));
  check('…and 0 at the bell', restOfDaySigma(annual, 0, 390) === 0);
  /* the early close: a bar 11:15–11:16 on 2026-11-27 leaves 104 of 210 minutes */
  const b = bar(NOV27 + 105 * 60, 100, 100);
  const hour = annualiseHour(0.002);
  const band = harBandSeries([b, bar(OCT28, 100, 100)], 1, '2026-11-27', annual, () => hour, 1);
  check('the early close spreads the day over 210 minutes', near(band.up[0], 100 * (1 + day * Math.sqrt(104 / 210)), 1e-9), String(band.up[0]));
  check('the next-hour band is ± the hour read de-annualised', near(band.hourDn[0], 100 * (1 - 0.002), 1e-9), String(band.hourDn[0]));
  check('another day stays blank (the forecast is for one session)', band.up[1] === null && band.hourUp[1] === null);
  const k2 = harBandSeries([b], 1, '2026-11-27', annual, () => null, 2);
  check('the width input scales the band and a missing hour read leaves its lines blank', near(k2.up[0], 100 * (1 + 2 * day * Math.sqrt(104 / 210)), 1e-9) && k2.hourUp[0] === null);
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const chart = readFileSync(join(root, 'src/components/gex/StrikeChart.tsx'), 'utf8');
  check('the chart reads the vol outlook fit and today’s minutes the tile reads (no fetch of its own)', chart.includes("useVolOutlook(ticker, harOn)") && chart.includes("useThetaTape(ticker, '1m', 'rth', harOn)") && chart.includes('hourReadNow(ticker, harMinutes.bars, endMs)'));
  check('the market shock reads the one shared SPY minute tape', chart.includes("useThetaTape('SPY', '1m', 'rth', shockOn)"));
  const phys = readFileSync(join(root, 'src/data/physicsReads.ts'), 'utf8');
  check('the reads module makes no request', !/fetch\(|thetaGet|uwGet/.test(phys));
}

/* ---- the gamma regime and the words ---- */
{
  const bars = [{ time: OCT28 - 60 }, { time: OCT28 }, { time: OCT28 + 60 }, { time: OCT28 + 120 }];
  const g = gammaRegimeSeries(bars, 1, [5, 3, -2, 0]);
  check('long and short gamma by the minute net, nothing off the session or on a zero', g[0] === null && g[1] === 1 && g[2] === -1 && g[3] === null, JSON.stringify(g));
  check('the regime reads damped / extend', regimeWords(1).includes('damped') && regimeWords(-1).includes('extend'));
  check('distance to the flip: + when price is above it', near(flipDistancePct(101, 100), (1 / 101) * 100, 1e-12) && flipDistancePct(0, 100) === null);
  const words = [regimeWords(1), regimeWords(-1), ...INDICATOR_ITEMS.filter(i => i.group === 'physics').map(i => i.hint)].join(' ').toLowerCase();
  check('no pin, pull, magnet, edge or score in the physics copy', !/\bpin(ning|s)?\b|\bpull(s|ing)?\b|magnet|\bedge\b|\bscore\b/.test(words.replace('not a magnet', '')));
  const tags = INDICATOR_ITEMS.filter(i => i.physics).map(i => PHYSICS_READS[i.physics!].tag);
  check('five reads, one MODEL (the HAR forecast) and four CALCULATED', tags.length === 5 && tags.filter(t => t === 'MODEL').length === 1 && PHYSICS_READS.harBand.tag === 'MODEL');
}

console.log(fail ? `\n${fail} FAILED` : '\nphysics reads: all checks pass');
process.exit(fail ? 1 : 0);
