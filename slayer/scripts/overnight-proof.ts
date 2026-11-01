/*
  Terrain's overnight SPX line (data/overnightLine.ts on core/parity.ts, read by server/terrainApi.mjs and
  shared/overnight.mjs) against known numbers: the GTH night the session module opens, its nearest SPXW expiry, the
  price a parity forward implies at a known rate (the median of the strikes nearest the money, one bad quote outvoted),
  the stock's empty night, and the reader's request budget — one quote read per half of the night however many viewers
  ask, one live snapshot, the VIX not read before it prints, never more than two history reads at once.
  Run: npx tsx scripts/overnight-proof.ts
*/

import { calendarYears } from '../src/core/volClock';
import { nyInstant, REGULAR_OPEN_MIN } from '../src/core/session';
import { nightLine, nightPoint, stepPoints, stockNight, vixAt, type OvernightRead } from '../src/data/overnightLine';
import { nightAt, nightExpiry, nightParts, pairsAround, readQuoteStamps } from '../shared/overnight.mjs';
import { createTerrain, HISTORY_AT_ONCE, nightLivePath, nightQuotePath, nightVixPath } from '../server/terrainApi.mjs';

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const near = (a: number | null | undefined, b: number, eps: number) => a != null && Math.abs(a - b) <= eps;

/* ---- 1. the night ---- */
const AT = nyInstant('2026-10-30', 2 * 60);
const night = nightAt(AT);
check('Friday 02:00 New York: the GTH night is open', !!night && night.live === true);
check('it opened Thursday 20:15 and closes Friday before the cash open', !!night && night.from === nyInstant('2026-10-29', 20 * 60 + 15) && night.to <= nyInstant('2026-10-30', REGULAR_OPEN_MIN));
check('its options: the nearest SPXW expiry, Friday', !!night && nightExpiry(night) === '2026-10-30');
const parts = night ? nightParts(night) : [];
check('read in two halves: the evening date and the morning date', parts.length === 2 && parts[0].date === '2026-10-29' && parts[1].date === '2026-10-30' && parts[0].start === '20:15:00', JSON.stringify(parts));
const noon = nightAt(nyInstant('2026-10-30', 12 * 60));
check('Friday noon (the cash index prints): no night open, the latest one is closed', !!noon && noon.live === false && noon.from === night?.from);

/* ---- 2. the price the options imply ---- */
const r = 0.0394;
const EXP = '2026-10-30';
const t = calendarYears(EXP, AT);
const S = 6840.25;
const F = S * Math.exp(r * t);
type Pair = [number, number, number, number, number];
const pairsAt = (bad?: number): Pair[] => {
  const out: Pair[] = [];
  for (let K = 6800; K <= 6880; K += 5) {
    /* parity at the forward: C − P = e^{−rT}(F − K), each leg a dollar wide */
    const diff = Math.exp(-r * t) * (F - K);
    const p = Math.max(1, 12 - diff / 2);
    const c = p + diff;
    const skew = K === bad ? 9 : 0;
    out.push([K, c - 0.5 + skew, c + 0.5 + skew, p - 0.5, p + 0.5]);
  }
  return out;
};
{
  const pt = nightPoint(AT, pairsAround(new Map(pairsAt().map(p => [p[0], p.slice(1)]))), EXP, r);
  check(`clean quotes: the implied SPX is ${S}`, near(pt?.spot, S, 0.01), pt ? pt.spot.toFixed(4) : 'none');
  check('the forward is the median of 4 strikes', pt?.n === 4);
  const atm = Math.round(F / 5) * 5;
  const off = nightPoint(AT, pairsAround(new Map(pairsAt(atm).map(p => [p[0], p.slice(1)]))), EXP, r);
  check('one strike quoted $9 rich: outvoted by the median, within 5 cents', near(off?.spot, S, 0.05), off ? off.spot.toFixed(4) : 'none');
  check('fewer than three valid strikes: no point', nightPoint(AT, pairsAt().slice(0, 2), EXP, r) === null);
  const read: OvernightRead = { v: 1, at: AT, expiry: EXP, bars: [[AT - 300_000, pairsAt()], [AT, pairsAt()]], vix: [[nyInstant(EXP, 3 * 60 + 15), 17.4]] };
  check('the whole night: a point per stamp', nightLine(read, r).length === 2);
  check('the VIX before 03:15: none; at 03:20 its 03:15 print', vixAt(read, AT) === null && vixAt(read, nyInstant(EXP, 3 * 60 + 20))?.value === 17.4);
  check('5-minute stamps on a 15-minute chart: one slot a step, its last value', stepPoints([{ ms: AT, value: 1 }, { ms: AT + 300_000, value: 2 }, { ms: AT + 900_000, value: 3 }], 900).map(p => p.value).join() === '2,3');
}

/* ---- 3. the stock's night: no prints, a labelled gap ---- */
{
  const w = stockNight(AT);
  check('a stock at 02:00: the overnight session is open, from 20:00', !!w && w.live && w.from === nyInstant('2026-10-29', 20 * 60));
}

/* ---- 4. the reader's budget ---- */
{
  const csv = (m: number) => {
    const rows = ['symbol,expiration,strike,right,timestamp,bid,ask'];
    for (const [K, cb, ca, pb, pa] of pairsAt()) {
      const stamp = `2026-10-30T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000`;
      rows.push(`SPXW,2026-10-30,${K},CALL,${stamp},${cb},${ca}`, `SPXW,2026-10-30,${K},PUT,${stamp},${pb},${pa}`);
    }
    return rows.join('\n');
  };
  check('quote rows read back by stamp and strike', readQuoteStamps(csv(115)).get(nyInstant('2026-10-30', 115))?.size === pairsAt().length);
  const calls: string[] = [];
  let open = 0;
  let peak = 0;
  const theta = async (p: string) => {
    calls.push(p);
    open += 1;
    peak = Math.max(peak, open);
    await new Promise(res => setTimeout(res, 5));
    open -= 1;
    return { status: 200, body: p.includes('/index/') ? '{"response":[]}' : csv(115) };
  };
  let t0 = AT;
  const reader = createTerrain({ theta, dir: null, now: () => t0 });
  await Promise.all([reader.overnight(), reader.overnight(), reader.overnight(), reader.overnight()]);
  await reader.settle();
  const evening = nightQuotePath(EXP, '2026-10-29', '20:15:00', '23:59:59');
  check('four viewers at once: ONE read of the evening half, ONE of the morning so far, ONE live snapshot', calls.filter(p => p === evening).length === 1 && calls.filter(p => p.includes('date=20261030') && p.includes('/history/quote')).length === 1 && calls.filter(p => p === nightLivePath(EXP)).length === 1, `${calls.length} calls`);
  check('the VIX is not read at 02:00 (it prints from about 03:15)', !calls.some(p => p.startsWith('/index/')));
  check(`never more than ${HISTORY_AT_ONCE} history reads at once`, peak <= HISTORY_AT_ONCE + 1 && reader.stats().peakHistory <= HISTORY_AT_ONCE, `peak ${reader.stats().peakHistory}`);
  const a = await reader.overnight();
  check('the answer: the night, its expiry and a stamp of pairs around the money', a.expiry === EXP && Array.isArray(a.bars) && (a.bars as unknown[]).length === 1);
  const before = calls.length;
  t0 += 10_000;
  await reader.overnight();
  await reader.settle();
  check('10 s later: nothing read again (the evening half is whole, the live pairs fresh for 15 s)', calls.length === before);
  t0 = nyInstant(EXP, 3 * 60 + 20);
  await reader.overnight();
  await reader.settle();
  check('03:20: the VIX is read, once', calls.filter(p => p === nightVixPath(EXP, '03:00:00', '09:25:00')).length === 1, calls.filter(p => p.startsWith('/index/')).join(' '));
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
