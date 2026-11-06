/*
  The option tape on a day the terminal has not processed (src/data/tapeServer.ts): the terminal answers HTTP 400
  "Cannot fetch current-day data without specifying an expiration" to /option/history/trade_quote and
  /option/history/open_interest with expiration=* for the current day (checked on the terminal 2026-11-06 after the
  close, windows at 09:30 and 15:50 alike). Before the fix the tape asked the wildcard every 30 s all day and stayed
  EMPTY with "the read did not land": the Prints tab, the chart's events lane and premium VWAPs, the flow pane and its
  net drift on Terrain, and a Compass setup's session prints showed nothing intraday.

  A fixture terminal refuses the wildcard for the current day and answers one expiry a read:
    1. today: the tape lists the root's expiries, reads the nearest DAY_EXPIRIES within DAY_MAX_DTE days one at a time
       (open interest, then the prints), never the wildcard, and fills — rows in time order, each contract's running
       volume and opening read right, the per-expiry reads given the longer timeout, two reads at most, one when the
       terminal has no room;
    2. live: a pass waits DAY_PASS_GAP_MS after the last, then reads only the newest minute;
    3. a past day the terminal still refuses: one wildcard read, then one expiry a read, filled to the close and not kept;
    4. a refusal that will never pass: a plain fault and REFUSED_BACKOFF_MS before the next ask, not 30 s forever;
    5. the tape reads on everyone else's lane (server/thetaProxy.mjs thetaUncached): never the engine's reserved slots.
  Run:  npx tsx scripts/tape-current-day-proof.ts
*/
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tape from '../src/data/tapeServer';
import { nyInstant } from '../shared/marketSession.mjs';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/* the tapes look every 5 s (tapeServer TICK_MS): a wait this long sees at least one look */
const TICK_WAIT = 5_600;
const until = async (ok: () => boolean, ms = 20_000) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await wait(25);
  return ok();
};
const k = tape as unknown as Record<string, number | undefined>;
const DAY_EXPIRIES = k.DAY_EXPIRIES ?? 4;
const DAY_PASS_GAP_MS = k.DAY_PASS_GAP_MS ?? 60_000;
const REFUSED_BACKOFF_MS = k.REFUSED_BACKOFF_MS ?? 30 * 60_000;
const DAY_READ_TIMEOUT_MS = k.DAY_READ_TIMEOUT_MS ?? 0;

const DAY = '2026-11-06';
const D = DAY.replace(/-/g, '');
const REFUSAL = 'Cannot fetch current-day data without specifying an expiration';
/* the root's listing: a past expiry, the four nearest, a fifth inside 14 days, one far out */
const LISTED = ['2026-10-30', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-13', '2026-11-20', '2026-12-18'];
const NEAR = LISTED.slice(1, 1 + DAY_EXPIRIES);
const HEAD = 'symbol,expiration,strike,right,trade_timestamp,quote_timestamp,sequence,ext_condition1,ext_condition2,ext_condition3,ext_condition4,condition,size,exchange,price,bid_size,bid_exchange,bid,bid_condition,ask_size,ask_exchange,ask,ask_condition';
const two = (n: number) => String(n).padStart(2, '0');
const secOf = (hms: string) => hms.split(':').reduce((a, x) => a * 60 + Number(x), 0);

/* every expiry prints a call at 600 every five minutes, i seconds into the minute (so the expiries interleave in time),
   200 contracts at the ask of 5.00 — $100,000, a print kept whole; the open interest is 300, so the second print of a
   contract is the first that opens */
function prints(exp: string, from: number, to: number): string {
  const i = NEAR.indexOf(exp) >= 0 ? NEAR.indexOf(exp) : LISTED.indexOf(exp);
  const out = [HEAD];
  for (let m = 570; m < 960; m += 5) {
    const s = m * 60 + 10 + i * 7;
    if (s < from || s > to) continue;
    const at = `${DAY}T${two(Math.floor(m / 60))}:${two(m % 60)}:${two(10 + i * 7)}.000`;
    out.push(`"SPY","${exp}",600.000,"CALL",${at},${at},${m * 10 + i},255,255,255,255,18,200,5,5.00,10,1,4.90,50,10,1,5.00,50`);
  }
  return `${out.join('\n')}\n`;
}

type Ask = { p: string; timeoutMs?: number };
function terminal(opt: { refuse?: (p: string) => string | null; slow?: number } = {}) {
  const asked: Ask[] = [];
  let inFlight = 0;
  let most = 0;
  const theta = async (p: string, o?: { timeoutMs?: number }) => {
    asked.push({ p, timeoutMs: o?.timeoutMs });
    inFlight++;
    most = Math.max(most, inFlight);
    try {
      await wait(opt.slow ?? 3);
      const q = new URLSearchParams(p.split('?')[1] ?? '');
      const refused = opt.refuse?.(p);
      if (refused) return { status: 400, body: refused };
      if (q.get('expiration') === '*' && q.get('date') === D) return { status: 400, body: REFUSAL };
      if (p.startsWith('/option/list/expirations')) return { status: 200, body: `symbol,expiration\n${LISTED.map(e => `"SPY","${e}"`).join('\n')}\n` };
      if (p.startsWith('/option/history/open_interest')) {
        const e = q.get('expiration')!;
        const exp = `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}`;
        return { status: 200, body: `symbol,expiration,strike,right,timestamp,open_interest\n"SPY","${exp}",600.000,"CALL",${DAY}T06:30:00.000,300\n"SPY","${exp}",600.000,"PUT",${DAY}T06:30:00.000,50\n` };
      }
      if (p.startsWith('/option/history/trade_quote')) {
        const e = q.get('expiration')!;
        const exp = `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}`;
        return { status: 200, body: prints(exp, secOf(q.get('start_time')!), secOf(q.get('end_time')!)) };
      }
      if (p.startsWith('/stock/history/ohlc')) {
        const rows = ['timestamp,open,high,low,close,volume'];
        for (let m = 570; m < 960; m++) rows.push(`${DAY}T${two(Math.floor(m / 60))}:${two(m % 60)}:00.000,600,600,600,600,1`);
        return { status: 200, body: `${rows.join('\n')}\n` };
      }
      return { status: 472, body: '' };
    } finally {
      inFlight--;
    }
  };
  return { theta, asked, most: () => most };
}

const options = (asked: Ask[]) => asked.filter(a => a.p.startsWith('/option/history/trade_quote'));
const expOf = (p: string) => new URLSearchParams(p.split('?')[1]).get('expiration');
const spanOf = (p: string) => {
  const q = new URLSearchParams(p.split('?')[1]);
  return `${q.get('start_time')}–${q.get('end_time')}`;
};

/* ---- 1. today: one expiry a read, filled ---- */
{
  let clock = nyInstant(DAY, 840) + 5_000;
  const term = terminal();
  const lines: string[] = [];
  const tapes = tape.startTapes({ dir: mkdtempSync(join(tmpdir(), 'tape-day-')), now: () => clock, theta: term.theta, log: l => lines.push(l) });
  tapes.options('SPY', 0);
  await until(() => {
    const w = tapes.options('SPY', 0)!;
    return w.through >= nyInstant(DAY, 840) || !!w.fault;
  });
  const w = tapes.options('SPY', 0)!;
  const expect = NEAR.length * ((840 - 570) / 5);
  console.log(`     today's tape: ${w.prints.length} prints, through ${new Date(w.through).toISOString().slice(11, 16)} UTC, fault ${JSON.stringify(w.fault)}`);
  check(`the tape fills to the last whole minute with every print of the ${NEAR.length} nearest expiries: ${w.prints.length}/${expect}, no fault`, w.prints.length === expect && w.fault == null && w.through === nyInstant(DAY, 840));
  const opt = options(term.asked);
  const exps = [...new Set(opt.map(a => expOf(a.p)))].sort();
  check(`it reads the ${DAY_EXPIRIES} nearest listed expiries within 14 days, one at a time: ${exps.join(' ')}`, exps.join(',') === NEAR.map(e => e.replace(/-/g, '')).join(','));
  check('…never the wildcard on the current day (the terminal refuses it)', term.asked.every(a => !a.p.includes('expiration=*')));
  check('…the listing read once', term.asked.filter(a => a.p.startsWith('/option/list/expirations')).length === 1);
  const firstQuote = term.asked.findIndex(a => a.p.startsWith('/option/history/trade_quote'));
  const ois = term.asked.map((a, i) => (a.p.startsWith('/option/history/open_interest') ? i : -1)).filter(i => i >= 0);
  check(`each expiry's open interest is read before the first window (${ois.length} reads), and the tape says so`, ois.length === NEAR.length && ois.every(i => i < firstQuote) && w.oi);
  const times = w.prints.map(p => p[0]);
  check('the rows land in time order across the expiries', times.every((t, i) => i === 0 || t >= times[i - 1]));
  const byContract = new Map<string, number[]>();
  for (const p of w.prints) byContract.set(p[1], [...(byContract.get(p[1]) ?? []), p[13]]);
  check('each contract\'s running volume counts its own prints in order (200, 400, …)', [...byContract.values()].every(v => v.every((x, i) => x === 200 * (i + 1))));
  check('the opening read uses its expiry\'s open interest: the first print (200 ≤ 300) does not open, the second (400) does', w.prints.every(p => p[14] === 300 && p[12] === (p[13] > 300 ? 1 : 0)));
  const spans = opt.filter(a => expOf(a.p) === NEAR[0].replace(/-/g, '')).map(a => spanOf(a.p));
  check(`the backfill reads half-hour windows (a read costs about the same whatever its span): ${spans[0]} … ${spans.at(-1)}`, spans[0] === '09:30:00–09:59:59.999' && spans.at(-1) === '13:30:00–13:59:59.999' && spans.length === 9);
  check(`the per-expiry reads may take ${DAY_READ_TIMEOUT_MS / 1000} s (the 90 s of a history read is short for a busy 0DTE book); the others keep the default`, DAY_READ_TIMEOUT_MS >= 120_000 && opt.every(a => a.timeoutMs === DAY_READ_TIMEOUT_MS) && term.asked.filter(a => !a.p.startsWith('/option/history/trade_quote')).every(a => a.timeoutMs == null));
  check(`never more than 2 reads at once (most: ${term.most()})`, term.most() <= 2);
  check('the log says the day is read one expiry at a time, and which', lines.some(l => l.includes('one expiry a read') && l.includes(NEAR.join(' '))));

  /* ---- 2. live: the next pass waits its gap, then reads only the newest minute ---- */
  const before = opt.length;
  clock += 30_000;
  await wait(TICK_WAIT);
  check(`30 s on, no new pass (each waits ${DAY_PASS_GAP_MS / 1000} s after the last): ${options(term.asked).length - before} reads`, options(term.asked).length === before);
  clock += DAY_PASS_GAP_MS;
  await until(() => options(term.asked).length >= before + NEAR.length, 12_000);
  const live = options(term.asked).slice(before);
  check(`then each expiry reads only the newest minute: ${[...new Set(live.map(a => spanOf(a.p)))].join(' · ')}`, live.length === NEAR.length && live.every(a => spanOf(a.p) === '14:00:00–14:00:59.999'));
  tapes.stop();
}

/* ---- 3. a past day the terminal has not processed: one wildcard read, then one expiry a read ---- */
{
  const clock = nyInstant('2026-11-07', 600);
  const term = terminal();
  const lines: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'tape-past-'));
  /* the terminal has no room for a second read: one at a time */
  const slots = () => ({ terminal: 8, history: 6, busy: 6, busyHistory: 5, waiting: 0 });
  const tapes = tape.startTapes({ dir, now: () => clock, theta: term.theta, slots, log: l => lines.push(l) });
  tapes.options('SPY', 0);
  await until(() => tapes.options('SPY', 0)!.complete || !!tapes.options('SPY', 0)!.fault);
  const w = tapes.options('SPY', 0)!;
  const wild = term.asked.filter(a => a.p.includes('expiration=*'));
  check(`Saturday, Friday not yet processed: one wildcard read (${wild.length}), refused, then one expiry a read`, wild.length === 1 && lines.some(l => l.includes('has not processed the day')));
  check(`…filled to the close: ${w.prints.length}/${NEAR.length * 78} prints, complete, no fault`, w.complete && w.fault == null && w.prints.length === NEAR.length * 78);
  check(`…one read at a time while the terminal has no room for a second (most: ${term.most()})`, term.most() === 1);
  await wait(50);
  check('…and not kept on disk (it holds the nearest expiries only; once processed the wildcard reads the day whole)', readdirSync(dir).length === 0 && !lines.some(l => l.endsWith(': kept')));
  tapes.stop();
}

/* ---- 4. a refusal that will never pass: a plain fault and a long back-off ---- */
{
  let clock = nyInstant(DAY, 840) + 5_000;
  const term = terminal({ refuse: p => (p.startsWith('/option/history/trade_quote') ? 'Invalid strike range' : null) });
  const lines: string[] = [];
  const tapes = tape.startTapes({ dir: mkdtempSync(join(tmpdir(), 'tape-refused-')), now: () => clock, theta: term.theta, log: l => lines.push(l) });
  tapes.options('SPY', 0);
  await until(() => !!tapes.options('SPY', 0)!.fault);
  const w = tapes.options('SPY', 0)!;
  check(`the fault says the terminal refused, and when it is asked again: "${w.fault}"`, /refused/.test(w.fault ?? '') && w.prints.length === 0);
  check('…and the log carries the terminal\'s own words', lines.some(l => l.includes('Invalid strike range')));
  /* a viewer keeps asking the server meanwhile (a tape nobody asks for stops reading) */
  const n = term.asked.length;
  clock += 31_000;
  tapes.options('SPY', 0);
  await wait(TICK_WAIT);
  clock += 5 * 60_000;
  tapes.options('SPY', 0);
  await wait(TICK_WAIT);
  check(`31 s and 5 min on, nothing is asked again (${term.asked.length - n} reads; the old rule asked every 30 s)`, term.asked.length === n);
  clock += REFUSED_BACKOFF_MS;
  tapes.options('SPY', 0);
  await until(() => term.asked.length > n, 12_000);
  check(`after ${REFUSED_BACKOFF_MS / 60_000} min it asks again`, term.asked.length > n);
  tapes.stop();
}

/* ---- 5. everyone else's lane ---- */
{
  const proxy = readFileSync(join(import.meta.dirname, '..', 'server', 'thetaProxy.mjs'), 'utf8');
  const body = /export async function thetaUncached\([^)]*\) \{([\s\S]*?)\n\}/.exec(proxy)?.[1] ?? '';
  const mount = readFileSync(join(import.meta.dirname, '..', 'server', 'tapeApi.mjs'), 'utf8');
  check('the tapes read through thetaUncached, which takes a slot on everyone else\'s lane (never \'engine\')', /theta: thetaUncached/.test(mount) && /load\(reqPath, undefined,/.test(body) && !/engine/.test(body));
}

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
