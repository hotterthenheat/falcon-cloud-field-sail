/*
  After-hours bad prints proof (data/barSanity.ts, data/thetaTape.ts): SPY's one-minute after-hours bars of Fri 2026-10-30
  16:00–16:59 as ThetaData's terminal answered them (recorded 2026-11-01). One off-exchange venue (exchange 57, Form T,
  conditions 108/1/4, none of which may set a high, low or last) reported 769.5594 eleven times between 16:01 and 16:28,
  and 728.741 at 16:45, with SPY at 756. Two holes let them onto the chart:
  - the chart's after-hours tape is its own run of bars (16:00–19:59), and the rule never judged a run's first three
    minutes, so 16:01 kept its 769.56 wick;
  - a stock's first paint was the vendor's bars as they came, and the rule ran only inside the print cleaner, so every
    spike stayed on screen until the cleaner finished, and for good when it never did.
  Run:  npx tsx scripts/after-hours-prints-proof.ts
*/
import { badBars, saneBars } from '../src/data/barSanity';
import { nyWallTime } from '../src/core/nyTime';
import type { Candle } from '../src/types/market';

/* [ET minute, open, high, low, close, volume] */
type Row = [string, number, number, number, number, number];
const ROWS: Row[] = [
  ['16:00', 755.71, 756.2, 755.56, 756.1293, 3524815], ['16:01', 756.1, 769.5594, 755.98, 756.35, 263806], ['16:02', 756.37, 756.4457, 755.08, 756.1, 573404],
  ['16:03', 756.161, 769.5594, 755.99, 756.1369, 194956], ['16:04', 756.1107, 756.21, 755.72, 755.97, 88587], ['16:05', 755.99, 756.14, 755.89, 756.0, 77417],
  ['16:06', 755.99, 756.11, 755.95, 756.08, 43699], ['16:07', 756.06, 756.16, 755.72, 756.115, 82909], ['16:08', 756.149, 756.209, 756.07, 756.16, 19773],
  ['16:09', 756.16, 756.18, 756.07, 756.1607, 40605], ['16:10', 756.16, 769.5594, 755.72, 756.18, 166677], ['16:11', 756.1707, 769.5594, 756.1707, 756.3501, 192336],
  ['16:12', 756.37, 756.97, 756.3512, 756.86, 151019], ['16:13', 756.73, 769.5594, 756.68, 756.73, 137129], ['16:14', 756.704, 756.87, 756.6, 756.76, 17007],
  ['16:15', 756.75, 756.8053, 755.5041, 756.6831, 2438571], ['16:16', 756.7, 769.5594, 756.6, 756.7, 422682], ['16:17', 756.7, 756.7, 756.31, 756.34, 40929],
  ['16:18', 756.32, 756.32, 755.5836, 756.16, 1039807], ['16:19', 756.15, 769.5594, 756.15, 756.3585, 200732], ['16:20', 755.72, 769.5594, 755.72, 756.2602, 423861],
  ['16:21', 756.28, 769.5594, 756.0, 756.11, 148392], ['16:22', 756.08, 769.5594, 756.06, 756.08, 160692], ['16:23', 756.06, 769.5594, 755.96, 756.0078, 263252],
  ['16:24', 756.01, 756.0428, 755.9, 755.97, 11508], ['16:25', 755.96, 756.0, 755.89, 755.9474, 10892], ['16:26', 755.95, 756.07, 755.92, 756.07, 32686],
  ['16:27', 756.08, 756.16, 756.0265, 756.1339, 12535], ['16:28', 769.5594, 769.5594, 756.06, 756.2, 3691843], ['16:29', 756.179, 756.2465, 756.16, 756.2465, 6844],
  ['16:30', 756.25, 756.25, 756.12, 756.1317, 13819], ['16:31', 756.15, 756.16, 756.0777, 756.12, 9047], ['16:32', 756.169, 756.2301, 756.0, 756.08, 14779],
  ['16:33', 756.11, 756.11, 755.9, 755.9, 10861], ['16:34', 755.89, 755.9478, 755.85, 755.9315, 1643], ['16:35', 755.94, 756.06, 755.94, 755.97, 1814],
  ['16:36', 755.929, 755.94, 755.85, 755.85, 7382], ['16:37', 755.9, 755.9, 755.78, 755.8, 28151], ['16:38', 755.77, 755.9856, 755.7205, 755.9438, 14620],
  ['16:39', 755.97, 756.01, 755.96, 755.99, 1769], ['16:40', 755.979, 756.11, 755.9507, 756.07, 1428], ['16:41', 756.1, 756.3398, 756.1, 756.27, 2126],
  ['16:42', 756.2735, 756.3878, 756.2, 756.2538, 2331], ['16:43', 756.23, 756.26, 756.1294, 756.19, 3553], ['16:44', 756.2, 756.2817, 756.2, 756.2817, 1396],
  ['16:45', 756.23, 756.2867, 728.741, 756.2368, 269238], ['16:46', 756.2169, 756.2169, 756.09, 756.09, 5977], ['16:47', 756.1, 756.1353, 756.05, 756.0798, 2435],
  ['16:48', 756.09, 756.1, 756.01, 756.07, 4486], ['16:49', 756.07, 756.12, 756.02, 756.03, 2228], ['16:50', 756.0367, 756.0638, 755.91, 755.98, 2971],
  ['16:51', 756.0, 756.0, 755.9, 755.9278, 5255], ['16:52', 755.92, 755.9838, 755.91, 755.9339, 9116], ['16:53', 755.94, 755.9796, 755.87, 755.91, 4318],
  ['16:54', 755.86, 755.91, 755.8, 755.81, 16541], ['16:55', 755.8, 755.85, 755.75, 755.8325, 5721], ['16:56', 756.67, 756.67, 755.7912, 755.8417, 10256],
  ['16:57', 755.81, 755.83, 755.72, 755.76, 2598], ['16:58', 755.76, 755.85, 755.72, 755.8, 55937], ['16:59', 755.84, 755.9839, 755.79, 755.8401, 5255],
];

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const bar = ([hm, open, high, low, close, volume]: Row): Candle => {
  const [h, m] = hm.split(':').map(Number);
  return { time: Math.floor(nyWallTime(2026, 10, 30, h, m) / 1000), open, high, low, close, volume };
};
const raw = ROWS.map(bar);
const at = (bs: Candle[], hm: string) => bs[ROWS.findIndex(r => r[0] === hm)];
const spikes = ROWS.filter(r => r[1] > 760 || r[2] > 760 || r[3] < 750).map(r => r[0]);

check("the recorded hour holds the venue's 769.56 and 728.74 prints in thirteen minutes", raw.length === 60 && spikes.length === 13, spikes.join(' '));
const fixed = new Set(badBars(raw).map(f => ROWS[f.index][0]));
check('every one of those minutes is flagged', spikes.every(s => fixed.has(s)), spikes.filter(s => !fixed.has(s)).join(' ') || 'all');
check("16:01, the run's second minute, is judged against the minutes after it", fixed.has('16:01'));
const out = saneBars(raw);
const hi = Math.max(...out.map(b => b.high));
const lo = Math.min(...out.map(b => b.low));
check('mended, the after-hours hour spans the market: 755–757.5', hi < 757.5 && lo > 755, `${lo}–${hi}`);
check('16:28 opens where 16:27 closed, not on the 769.56 print', Math.abs(at(out, '16:28').open - at(raw, '16:27').close) < 0.01, `${at(out, '16:28').open}`);
check('no bar added or dropped; every volume and every unflagged minute as it came', out.length === raw.length && out.every((b, i) => b.volume === raw[i].volume && (fixed.has(ROWS[i][0]) || b === raw[i])));
check('every bar holds its body', out.every(b => b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close)));

/* a real move at a run's start keeps its shape: news in the first after-hours minute, held by the minutes after it */
{
  const calm = out.slice(0, 20);
  const news = calm.map((b, i) => (i === 0 ? { ...b, high: b.high + 6, close: b.close + 6 } : { ...b, open: b.open + 6, high: b.high + 6, low: b.low + 6, close: b.close + 6 }));
  const kept = saneBars(news)[0];
  check('a first minute that opens at the close and runs 6 points, held after, is kept as it came', kept.open === news[0].open && kept.close === news[0].close && kept.high === news[0].high, `o${kept.open} h${kept.high} c${kept.close}`);
  const wick = calm.map((b, i) => (i === 0 ? { ...b, high: b.high + 13 } : b));
  check("a first minute's lone 13-point wick, against the minutes after it, is cut", saneBars(wick)[0].high < 757, `${saneBars(wick)[0].high}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
