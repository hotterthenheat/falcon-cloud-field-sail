// Session levels are the cash session, not the first bars in the file.
// Premarket and after-hours spikes are not PDH and not the opening range.
// CPI marks use the BLS dates, not a guessed Wednesday.
//   npx tsx scripts/session-levels-proof.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSessionLevels } from '../src/data/sessionLevels';
import { macroWindow } from '../src/data/events';
import { nyWallTime } from '../src/core/nyTime';
import type { Candle } from '../src/types/market';

let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fail++;
};

const price = (high: number, low: number, close: number): Pick<Candle, 'open' | 'high' | 'low' | 'close' | 'volume'> => ({
  open: close,
  high,
  low,
  close,
  volume: 1000,
});

function bar(y: number, m: number, d: number, h: number, mi: number, high: number, low: number, close: number): Candle {
  return { time: Math.floor(nyWallTime(y, m, d, h, mi) / 1000), ...price(high, low, close) };
}

const px = (s: ReturnType<typeof buildSessionLevels>, key: string) => s.levels.find(l => l.key === key)?.price;

/* Friday 6 Nov 2026 cash, with a premarket spike and an after-hours spike that must not be the day. */
const friday = [
  bar(2026, 11, 6, 8, 0, 50, 49, 49.5),
  bar(2026, 11, 6, 9, 30, 10, 9, 9.5),
  bar(2026, 11, 6, 10, 0, 12, 9, 11),
  bar(2026, 11, 6, 15, 59, 11.5, 10.5, 11.2),
  bar(2026, 11, 6, 16, 5, 40, 39, 39.5),
];
/* Monday before the open: the premarket high is not the opening range. */
const mondayEarly = [
  ...friday,
  bar(2026, 11, 9, 4, 0, 30, 29, 29.5),
  bar(2026, 11, 9, 8, 0, 28, 27, 27.5),
];
const before = buildSessionLevels(mondayEarly, 15);
check('before the open, yesterday is the cash day and the opening range has not started', before.hasPrior && px(before, 'prevHigh') === 12 && px(before, 'prevLow') === 9 && px(before, 'prevClose') === 11.2 && px(before, 'orHigh') == null && !before.orComplete, JSON.stringify(before.levels));

const monday = [
  ...mondayEarly,
  bar(2026, 11, 9, 9, 30, 11, 10.5, 10.8),
  bar(2026, 11, 9, 9, 40, 11.4, 10.6, 11.1),
  bar(2026, 11, 9, 9, 43, 11.3, 10.8, 11.05),
];
const forming = buildSessionLevels(monday, 15);
check('at 9:43 the 15-minute range is still forming and ignores the premarket', forming.orElapsed === 14 && !forming.orComplete && px(forming, 'orHigh') === 11.4 && px(forming, 'orLow') === 10.5, `elapsed ${forming.orElapsed} high ${px(forming, 'orHigh')}`);

const closed = buildSessionLevels([...monday, bar(2026, 11, 9, 9, 44, 11.2, 10.9, 11)], 15);
check('at 9:44 the 15-minute range is closed', closed.orComplete && closed.orElapsed === 15 && px(closed, 'orHigh') === 11.4);

const at1029 = buildSessionLevels([...monday, bar(2026, 11, 9, 10, 29, 13, 10.4, 12.5)], 15);
const at1100 = buildSessionLevels([...monday, bar(2026, 11, 9, 10, 29, 13, 10.4, 12.5), bar(2026, 11, 9, 11, 0, 18, 12, 17)], 15);
check('the first hour includes 10:29 and not 11:00', at1029.ibComplete && px(at1029, 'ibHigh') === 13 && px(at1100, 'ibHigh') === 13);

/* Early close 27 Nov 2026: 13:00. A 13:10 print is not the close. */
const early = [
  bar(2026, 11, 27, 9, 30, 5, 4, 4.5),
  bar(2026, 11, 27, 12, 59, 6, 5.5, 6),
  bar(2026, 11, 27, 13, 10, 20, 19, 19.5),
  bar(2026, 11, 30, 9, 30, 7, 6.5, 6.8),
];
const afterEarly = buildSessionLevels(early, 15);
check('an early close ends at 12:59, and the print after 13:00 is not the prior day', afterEarly.hasPrior && px(afterEarly, 'prevHigh') === 6 && px(afterEarly, 'prevClose') === 6, JSON.stringify(afterEarly.levels));

const rthOnly = [bar(2026, 11, 6, 9, 30, 10, 9, 9.5), bar(2026, 11, 6, 9, 44, 10.2, 9.4, 10), bar(2026, 11, 9, 9, 30, 11, 10, 10.5)];
const plain = buildSessionLevels(rthOnly, 15);
check('a cash-only tape still cuts the opening range from 9:30', plain.hasPrior && px(plain, 'prevHigh') === 10.2 && px(plain, 'orHigh') === 11 && plain.orElapsed === 1);

const cpi = macroWindow(new Date(2026, 10, 3), 45, 45).filter(m => m.label === 'CPI release');
check('CPI on 3 Nov 2026 is the BLS date, not a guessed Wednesday', cpi.some(m => m.iso === '2026-11-10' && !/approximat/i.test(m.detail)) && cpi.every(m => !/approximat/i.test(m.detail)), cpi.map(m => m.iso).join(','));

const chart = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/components/gex/StrikeChart.tsx'), 'utf8');
check('scripts are fed the book minute gamma', chart.includes('supreme: levels.supreme, netGex'));

console.log(fail ? `\n${fail} FAILED` : '\nsession levels: all checks pass');
process.exit(fail ? 1 : 0);
