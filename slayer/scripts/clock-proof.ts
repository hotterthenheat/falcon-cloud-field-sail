import { dollarGammaPerContract } from '../src/core/gammaFlip';
import { nyWallTime } from '../src/core/nyTime';
import { tradingYears } from '../src/core/tradingYear';
import { calendarYears, dealerInventory, flowConfidence, flowFirm, flowImbalance, markGap, quoteMaxAge, smoothSmile, usableMid, vendorIvOnTradingClock } from '../src/core/volClock';
import { holdBand, morningMiss, nodeMark, noteNodes, peakStrikes, priceTag } from '../src/data/nodeScore';

const exp = '2026-10-27';
const morning = nyWallTime(2026, 10, 27, 10, 0);
const late = nyWallTime(2026, 10, 27, 15, 55);
const tMorning = tradingYears(exp, morning);
const tLate = tradingYears(exp, late);
const timeRatio = tMorning / tLate;
if (Math.abs(timeRatio - 72) > 0.05) throw new Error(`trading clock ${timeRatio}, expected 72`);

const gMorning = dollarGammaPerContract(580, 580, tMorning, 0.2);
const gLate = dollarGammaPerContract(580, 580, tLate, 0.2);
const gRatio = gLate / gMorning;
const want = Math.sqrt(timeRatio);
if (Math.abs(gRatio / want - 1) > 0.02) throw new Error(`gamma grew ${gRatio}, expected ${want}`);

const twist = tLate / calendarYears(exp, late);
if (twist < 5 || twist > 5.6) throw new Error(`year mismatch ${twist}, the 5.3× calendar clock came back`);

const vendor = 0.2;
const converted = vendorIvOnTradingClock(vendor, exp, late);
const left = vendor * vendor * calendarYears(exp, late);
const right = converted * converted * tLate;
if (Math.abs(left - right) / left > 1e-9) throw new Error('variance did not survive the conversion');

if (dealerInventory(100, 10, 0, 0, 10) !== 110) throw new Error('ask buy did not make the dealer shorter');
if (dealerInventory(100, 0, 10, 0, 10) !== 90) throw new Error('bid sale did not make the dealer longer');
if (dealerInventory(100, 10, 0, 10, 10) !== 100) throw new Error('a multi-leg print was counted as a side');
const put770 = dealerInventory(1566, 316025, 331853, 9323, 664323);
if (!(put770 < 0)) throw new Error('put inventory was stopped at zero');
if (!(-put770 > 0)) throw new Error('a negative inventory did not flip the greek sign');
const callNet = flowImbalance(500806, 493714, 37628, 1006749);
if (!(flowConfidence(callNet, 1006749, (12227 + 2) / 1006749) < 0.02)) throw new Error('770 call net was treated as firm');
if (flowFirm(callNet, 1006749, 0)) throw new Error('a net under 2% of gross was firm');
if (!flowFirm(30_000, 1_000_000, 0)) throw new Error('a 3% net was faded');

const smile = smoothSmile([
  { strike: 100, iv: 0.9 },
  { strike: 105, iv: 0.2 },
  { strike: 110, iv: 0.21 },
  { strike: 115, iv: 0.22 },
]);
if (!(smile[0].iv < 0.4)) throw new Error(`wing stayed at ${smile[0].iv}`);

if (quoteMaxAge(exp, morning) !== 2 * 60_000) throw new Error('0DTE quote window');
if (quoteMaxAge('2026-11-20', morning) !== 15 * 60_000) throw new Error('longer quote window');

if (usableMid(1, 1.2) !== 1.1) throw new Error('a tight mid was refused');
if (usableMid(0.2, 0.8) !== 0) throw new Error('a wide mid was solved');

if (markGap(8, 2, 100)) throw new Error('a small strike was marked');
if (!markGap(100, 50, 100)) throw new Error('a real gap was missed');

const miss = morningMiss(
  [{ expiry: '2026-10-30', strike: 580, right: 'C', flow: 110, oi: 100 }],
  '2026-10-28',
  [{ expiry: '2026-10-30', strike: 580, right: 'C', flow: 110, oi: 100 }],
);
if (!miss || Math.abs(miss.rate - 0.1) > 1e-9) throw new Error(`morning miss ${miss?.rate}`);
if (!miss.byExpiry[0]?.call || Math.abs(miss.byExpiry[0].call.rate - 0.1) > 1e-9) throw new Error('call split missing');
if (miss.byExpiry[0]?.put) throw new Error('a put miss was invented');
const ties = peakStrikes([{ strike: 100, value: 10 }, { strike: 101, value: 10 }, { strike: 102, value: 1 }]);
if (ties.join(',') !== '100,101') throw new Error(`ties ${ties}`);
if (nodeMark([{ v: 1, peak: false }, { v: 5, peak: true }, { v: 5, peak: true }], 1) !== 'born') throw new Error('born');
if (nodeMark([{ v: 5, peak: true }, { v: 0, peak: false }, { v: 0, peak: false }], 1) !== 'died') throw new Error('died');
if (nodeMark([{ v: 5, peak: true }, { v: -5, peak: true }], 1) !== 'flipped') throw new Error('flipped');
if (priceTag(100, [100, 100.01, 100]) !== 'absorbed') throw new Error('absorbed');
if (priceTag(100, [99, 100, 101]) !== 'broke') throw new Error('broke');
if (priceTag(100, [99, 100, 99.2]) !== 'rejected') throw new Error('rejected');
const dead = morningMiss(
  [{ expiry: '2026-10-27', strike: 580, right: 'C', flow: 110, oi: 100 }],
  '2026-10-28',
  [{ expiry: '2026-10-27', strike: 580, right: 'C', flow: 110, oi: 50 }],
);
if (dead) throw new Error('an expired strike was scored');

if (holdBand(100) !== 0.05) throw new Error('five cents');
if (Math.abs(holdBand(6000) - 1.2) > 1e-9) throw new Error('two basis points');
const HOLD_WAIT = 10 * 60 * 1000;
const early = noteNodes('PROOF', 100, [100], [], 0.39, 0);
const soon = noteNodes('PROOF', 100.01, [100], [], 0.39, 60_000);
if (soon.flowHeld !== 0 || soon.flowBroke !== 0) throw new Error('a hold was scored before ten minutes');
const later = noteNodes('PROOF', 100.01, [100], [], 0.39, HOLD_WAIT);
if (later.flowHeld !== 1) throw new Error(`held ${later.flowHeld}`);
void early;

console.log('clock proof ok', { timeRatio, gRatio, twist });
