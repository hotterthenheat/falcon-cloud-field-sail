/*
  The pricing rate is the market's overnight rate (SOFR), not a fixed 4.2% (core/carry.ts, data/rateFeed.ts).

  Known numbers: the rate history the terminal answered for SOFR, 2026-10-20 → 10-30 (scripts/fixtures/theta-carry/
  sofr-2026-10-20-30.json, the audit's probe p02): 3.88 3.88 3.90 3.92 3.92 3.92 3.93 3.95 3.94 3.94 3.94 percent, the
  last for 2026-10-30. And the terminal's own greeks for SPY's 2026-11-06 chain at Friday's close (spy-greeks-all-…):
  the vendor solves its IVs at SOFR, so ours, solved at the same rate, should now agree with them.
  Run:  npx tsx scripts/rate-proof.ts
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_R, carryFor, getCarry, rateNow, rateOn, resetCarry, setRate } from '../src/core/carry';
import { impliedVolFromPrice } from '../src/core/greeks';
import { loadHeldRate, monthPath, parseRates, publishDay, ratePath, rateWords, takeRates } from '../src/data/rateFeed';
import { readContract, explainContract, modelAt } from '../src/data/weigherGate';
import { thetaTtl } from '../shared/thetaPaths.mjs';
import { createHub } from '../server/hub.mjs';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const pct = (r: number, d = 2) => `${(r * 100).toFixed(d)}%`;

/* this browser's storage, for the held copy */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const sofr = JSON.parse(fs.readFileSync('scripts/fixtures/theta-carry/sofr-2026-10-20-30.json', 'utf8'));

/* ---- before: nothing read, the fixed fallback, and the hover says so ---- */
resetCarry();
check(`before any read the rate is the fixed ${pct(DEFAULT_R)}: carryFor('SPY').r = ${carryFor('SPY').r}, source ${rateNow().source}`, carryFor('SPY').r === 0.042 && rateNow().source === 'fixed');
check(`the hover says so: "${rateWords()}"`, rateWords().includes('fixed 4.20%'));

/* ---- the answer ---- */
const rows = parseRates(sofr.response);
check(`11 daily rows parsed, percent → fraction: ${rows.map(r => (r.r * 100).toFixed(2)).join(' ')}`, rows.length === 11 && rows[0].r === 0.0388 && rows[10].r === 0.0394 && rows[10].day === '2026-10-30');
const last = takeRates(sofr);
check(`the newest row is the rate in use: ${pct(rateNow().r)} for ${rateNow().asOf} (${rateNow().source})`, last?.r === 0.0394 && rateNow().r === 0.0394 && rateNow().asOf === '2026-10-30' && rateNow().source === 'live');
check(`every pricer's default carry moves with it: getCarry().r ${getCarry().r}, carryFor('SPX').r ${carryFor('SPX').r}`, getCarry().r === 0.0394 && carryFor('SPX').r === 0.0394);
check(`hover: "${rateWords()}"`, rateWords() === 'a 3.94% rate (the overnight SOFR rate for Oct 30)');

/* ---- past days: that day's own rate ---- */
check(`a backtest day is priced at its own rate: 2026-10-21 ${pct(rateOn('2026-10-21').r)}, 10-27 ${pct(rateOn('2026-10-27').r)}`, rateOn('2026-10-21').r === 0.0388 && rateOn('2026-10-27').r === 0.0395);
check(`carryFor(…, { on }) takes it: SPY on 2026-10-22 r = ${carryFor('SPY', { on: '2026-10-22' }).r}`, carryFor('SPY', { on: '2026-10-22' }).r === 0.039);
check(`a day with no row of its own takes the newest before it (2026-10-31, a Saturday past the window: ${pct(rateOn('2026-10-31').r)} of ${rateOn('2026-10-31').asOf})`, rateOn('2026-10-31').r === 0.0394 && rateOn('2026-10-31').asOf === '2026-10-30');
check(`a day long before the window has none loaded: it says it is today's rate (asOf ${rateOn('2024-03-01').asOf})`, rateOn('2024-03-01') === rateNow());

/* the backtest's own quote (data/review/quotes.ts quoteAt) on the hand-made market: SPY 500C on that stored minute.
   The greek is readGreek (calendar time, that day's SOFR). The fill is still the recorded bid and ask. */
{
  const { installTestMarket, D1, FAR, spot, mid } = await import('./review-market-fixture');
  const { quoteAt, yearsLeft } = await import('../src/data/review/quotes');
  const { blackScholesGreeks } = await import('../src/core/greeks');
  const { readGreek } = await import('../src/core/readGreek');
  const { nyWallTime } = await import('../src/core/nyTime');
  installTestMarket();
  const c = { ticker: 'SPY', strike: 500, right: 'C' as const, expiry: FAR };
  const S = spot('SPY', D1, 200);
  const t = yearsLeft(D1, 200, FAR);
  const m = mid(S, 500, 'C');
  const hand = (r: number) => {
    const iv = impliedVolFromPrice(m, S, 500, t, 'C', r, 0)!;
    return { iv, delta: blackScholesGreeks(S, 500, t, iv, r, 0).deltaCall };
  };
  const q = quoteAt(c, D1, 200);
  const at42 = hand(0.042);
  const [y, mo, da] = D1.split('-').map(Number);
  const wall = 9 * 60 + 30 + 200 + 1;
  const at = nyWallTime(y, mo, da, Math.floor(wall / 60), wall % 60);
  const solved = readGreek({ right: 'C', strike: 500, expiry: FAR, at, option: { bid: q.bid, ask: q.ask, at }, stock: { price: S, at } });
  check(`backtest SPY 500C on ${D1} minute 200 is readGreek (delta ${q.delta.toFixed(5)}); the old trading-year 4.2% delta was ${at42.delta.toFixed(5)}`, solved.ok && Math.abs(q.delta - solved.delta) < 1e-9 && Math.abs(q.iv - solved.iv) < 1e-9 && Math.abs(q.delta - at42.delta) > 1e-4);
}

/* ---- the vendor agrees with us now: our IV from each ATM mid (±1.2% of spot) against theirs, both at 7 calendar days ---- */
{
  const chain = JSON.parse(fs.readFileSync('scripts/fixtures/theta-carry/spy-greeks-all-2026-11-06.json', 'utf8')).response as { contract: { strike: number; right: string }; data: Record<string, number>[] }[];
  const T = 7 / 365;
  const gap = (r: number) => {
    let sum = 0;
    let n = 0;
    for (const it of chain) {
      const x = it.data[0];
      if (Math.abs(it.contract.strike / x.underlying_price - 1) > 0.012) continue;
      const iv = impliedVolFromPrice((x.bid + x.ask) / 2, x.underlying_price, it.contract.strike, T, it.contract.right[0] as 'C' | 'P', r, 0);
      if (iv == null) continue;
      sum += Math.abs(iv - x.implied_vol);
      n++;
    }
    return { mean: sum / n, n };
  };
  const old = gap(0.042);
  const now = gap(rateNow().r);
  check(`our IVs against the vendor's on ${now.n} ATM SPY 11-06 contracts: mean gap ${(old.mean * 100).toFixed(4)} vol pt at 4.2% → ${(now.mean * 100).toFixed(4)} at SOFR`, now.mean < old.mean / 3 && now.mean < 0.0002);
}

/* the Weigher's own read of one contract (data/weigherGate readContract): SPY 757C 11-06 off the mid. No rate loaded:
   the greek is blank. With that day's SOFR it solves, and a different rate moves the delta. The 4.2% fallback is not
   this greek — modelAt still takes whatever carry it is given. */
{
  const stamp = Date.parse('2026-10-30T20:15:00Z');
  const input = { ticker: 'SPY', spot: 756.59, strike: 757, right: 'C' as const, bid: 3.2, ask: 3.3, expiryIso: '2026-11-06', optionAt: stamp, stockAt: stamp, now: stamp };
  resetCarry();
  const blank = explainContract(input);
  check(`no rate loaded: the greek is blank (${blank.ok ? 'solved' : blank.why})`, !blank.ok && blank.why === 'rate not loaded');
  setRate(0.0394, 'live', '2026-10-30');
  const at = readContract(input)!;
  const at42 = modelAt(756.59, 757, 'C', 3.2, 3.3, 7 / 365, at.iv / 100, { r: 0.042, q: 0 })!;
  const at394 = modelAt(756.59, 757, 'C', 3.2, 3.3, 7 / 365, at.iv / 100, { r: 0.0394, q: 0 })!;
  check(`Weigher SPY 757C solves at 3.94% (delta ${at.delta.toFixed(5)}); modelAt still moves from 4.2% (${at42.delta.toFixed(5)}) to 3.94% (${at394.delta.toFixed(5)})`, at.delta > 0 && at394.delta < at42.delta);
}

/* ---- the fallbacks: the last good read, then 4.2% ---- */
resetCarry();
loadHeldRate(true);
check(`a reload before today's read prices at the kept one: ${pct(rateNow().r)} for ${rateNow().asOf} (${rateNow().source})`, rateNow().r === 0.0394 && rateNow().source === 'held');
check(`and says so: "${rateWords()}"`, rateWords().includes("last SOFR rate read, for Oct 30; today's has not loaded"));
check('a held copy never replaces a live read', setRate(0.039, 'live', '2026-10-31') && !setRate(0.05, 'held', '2026-10-01') && rateNow().r === 0.039);
check('a bad number is refused (NaN, 300%): the rate stays', !setRate(NaN, 'live', null) && !setRate(3, 'live', null) && rateNow().r === 0.039);
store.clear();
resetCarry();
loadHeldRate(true);
check(`nothing kept and nothing read: the fixed ${pct(rateNow().r)}`, rateNow().source === 'fixed' && rateNow().r === DEFAULT_R);

/* ---- once a day on the server: one path a publishing day, kept by the hub for a day ---- */
const fri0800 = Date.parse('2026-10-30T12:00:00Z'); // 08:00 New York
const fri0900 = Date.parse('2026-10-30T13:00:00Z');
const fri1500 = Date.parse('2026-10-30T19:00:00Z');
check(`the publishing day turns at 08:30 New York: 08:00 → ${publishDay(fri0800)}, 09:00 → ${publishDay(fri0900)}`, publishDay(fri0800) === '2026-10-29' && publishDay(fri0900) === '2026-10-30');
check(`every browser asks one path all day: ${ratePath(fri0900)}`, ratePath(fri0900) === ratePath(fri1500) && ratePath(fri0900) === '/interest_rate/history/eod?symbol=SOFR&start_date=20261016&end_date=20261030&format=json');
check(`a past day's month: ${monthPath('2026-03-11', fri1500)}`, monthPath('2026-03-11', fri1500) === '/interest_rate/history/eod?symbol=SOFR&start_date=20260222&end_date=20260331&format=json');
check(`the hub keeps a rate answer ${thetaTtl(ratePath(fri0900)) / 3_600_000} h (it was 5 min)`, thetaTtl(ratePath(fri0900)) === 24 * 3_600_000);
{
  let calls = 0;
  const hub = createHub({
    name: 'rate-proof',
    file: path.join(os.tmpdir(), `rate-proof-${process.pid}.json`),
    hours: () => true,
    refreshPerSec: 0,
    ttl: thetaTtl,
    fetch: async () => {
      calls++;
      return { status: 200, body: Buffer.from(JSON.stringify(sofr)), type: 'application/json' };
    },
  });
  for (let i = 0; i < 200; i++) await hub.get(ratePath(fri0900 + i * 60_000));
  check(`200 viewers' asks through the day → ${calls} vendor call`, calls === 1);
}

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
