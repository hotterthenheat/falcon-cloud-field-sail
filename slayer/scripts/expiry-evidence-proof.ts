/* The expiry checks of the 2026-11-07 ticker audit (reports/expiry_mismatches.csv), on its own recorded cases
   (scripts/fixtures/expiry-audit-2026-11-06.json: each root's listed live dates and the dates its contracts were quoted
   or traded on 2026-11-06):
   1. the 56 dates the terminal lists with no contract (SPX 2088–2090, TT, PWR, RIO …) are never offered;
   2. the 18 dates first quoted on 2026-11-06 (SPX 12-15, NDX 12-14, RUT 11-23, SPY 2027-04-16 …) are offered the day
      their contracts appear, though the list does not carry them;
   3. the proxy's check (server/expiryCheck.mjs) does that to every /option/list/expirations answer, CSV or JSON, keeps
      the past as listed, reads each root's contracts once, and falls back to the last build's verdict when it cannot;
   4. the generated universe carries the build's verdicts, and every expiry picker hides the vendor's dates with no
      contract (CBTX, CBTXW, SPEQW, SPEQX) and the dates that have settled (data/expiryListing.ts);
   5. Trace's search offers the names the vendor lists options on (it reads the vendor only), not the terminal's.
   6. the vendor's deltas out of order or out of range (EWY, RLV, MXEF) break nothing that reads them.
   npx tsx scripts/expiry-evidence-proof.ts */

import fixture from './fixtures/expiry-audit-2026-11-06.json';
import universe from '../src/data/generated/tickerUniverse.json';
import { expirationsIn, verifyExpirations } from '../shared/expiryEvidence.mjs';
import { createExpiryCheck } from '../server/expiryCheck.mjs';
import { nyInstant } from '../shared/marketSession.mjs';
import { expiryShut, pickableExpiries } from '../src/data/expiryListing';
import { parseDirectory, setNoContractDates } from '../src/data/symbolDirectory';
import { roomOf, searchListed } from '../src/data/listedNames';
import { chooseContract } from '../src/data/model4Event';
import { positionDelta } from '../src/data/traceSpreads';
import type { SpreadLeg } from '../src/data/flowBook';

type Case = { symbol: string; date: string };
const F = fixture as unknown as {
  floor: string;
  phantom: Case[];
  new: Case[];
  vendorEmpty: Case[];
  vendorMissing: Case[];
  roots: Record<string, string[]>;
  listed: Record<string, string[]>;
  quoted: Record<string, string[]>;
  vendorRows: Record<string, [string, string, string, string, string][]>;
};
const U = universe as unknown as { expiries?: { verified: boolean; phantom: Record<string, string[]>; added: Record<string, string[]>; noContracts: Record<string, string[]> } };

let failed = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else {
    failed += 1;
    console.log(`  FAIL ${what}`);
  }
};

/* ---- 1, 2: the audit's cases, root by root ---- */
const offered = (symbol: string): Set<string> => {
  const out = new Set<string>();
  for (const r of F.roots[symbol] ?? [symbol]) for (const d of verifyExpirations({ listed: F.listed[r] ?? [], evidence: [F.quoted[r] ?? []], today: F.floor }).dates) out.add(d);
  return out;
};
const listedAny = (c: Case) => (F.roots[c.symbol] ?? [c.symbol]).some(r => (F.listed[r] ?? []).includes(c.date));
ok(F.phantom.length === 56, `the audit's phantom dates: ${F.phantom.length}`);
ok(F.phantom.every(listedAny), 'each is on the terminal list');
const shown = F.phantom.filter(c => offered(c.symbol).has(c.date));
ok(shown.length === 0, `none of the 56 is offered${shown.length ? ` (offered: ${shown.map(c => `${c.symbol} ${c.date}`).join(', ')})` : ''}`);
ok(F.new.length === 18, `the audit's new listings: ${F.new.length}`);
const unlisted = F.new.filter(c => !listedAny(c));
ok(unlisted.length === 17, `17 of them were missing from the terminal list (SUPN 2027-06-17 was the vendor's miss): ${unlisted.length}`);
const missed = F.new.filter(c => !offered(c.symbol).has(c.date));
ok(missed.length === 0, `all 18 are offered: ${F.new.map(c => `${c.symbol} ${c.date}`).join(', ')}${missed.length ? ` — missed ${missed.map(c => c.symbol).join(', ')}` : ''}`);
for (const [sym, d] of [['SPX', '2026-12-15'], ['NDX', '2026-12-14'], ['RUT', '2026-11-23'], ['SPY', '2027-04-16']] as const) ok(offered(sym).has(d), `${sym} offers ${d}`);
for (const [sym, d] of [['SPX', '2088-07-10'], ['SPX', '2090-06-18'], ['TT', '2027-04-16'], ['PWR', '2027-08-20'], ['RIO', '2031-01-01']] as const) ok(!offered(sym).has(d), `${sym} does not offer ${d}`);
/* a date both carry stays */
ok(offered('SPX').has('2026-12-18') && offered('TT').has('2026-11-20'), 'the dates both the list and the contracts carry stay (SPX 2026-12-18, TT 2026-11-20)');

/* the parser reads the terminal's three shapes */
ok([...expirationsIn('symbol,expiration\n"SPX","2026-12-18"\n"SPX","20261219"\n')].join() === '2026-12-18,2026-12-19', 'a CSV list');
ok([...expirationsIn('timestamp,symbol,expiration,strike,right,bid\n2026-11-06T15:59:59,"TT","2027-06-17",340.000,"CALL",1\n')].join() === '2027-06-17', 'a snapshot CSV');
ok([...expirationsIn(JSON.stringify({ response: [{ expiration: '2026-11-20' }, { contract: { expiration: 20261218 } }] }))].join() === '2026-11-20,2026-12-18', 'both JSON shapes');

/* ---- 3: the proxy's check ---- */
{
  const SAT = nyInstant('2026-11-07', 12 * 60);
  const listedSpx = ['2026-11-06', ...F.listed.SPX];
  const asked: string[] = [];
  let snapshotUp = true;
  const csvOf = (dates: string[]) => `symbol,expiration\n${dates.map(d => `"SPX","${d}"`).join('\n')}\n`;
  const snapOf = (dates: string[]) => `timestamp,symbol,expiration,strike,right,bid\n${dates.map(d => `2026-11-06T16:00:00,"SPX","${d}",7000,"CALL",1`).join('\n')}\n`;
  const terminal = async (p: string) => {
    asked.push(p);
    if (p.startsWith('/option/list/expirations')) {
      if (p.includes('format=json')) return { status: 200, body: JSON.stringify({ response: listedSpx.map(e => ({ symbol: 'SPX', expiration: e })) }), type: 'application/json' };
      return { status: 200, body: csvOf(listedSpx), type: 'text/csv' };
    }
    if (p.startsWith('/option/snapshot/quote')) return snapshotUp ? { status: 200, body: snapOf([...F.quoted.SPX, '2026-12-15']), type: 'text/csv' } : { status: 503, body: '{"code":"terminal_down"}', type: 'application/json' };
    if (p.startsWith('/option/snapshot/open_interest')) return snapshotUp ? { status: 200, body: snapOf(F.quoted.SPX.slice(0, 5)), type: 'text/csv' } : { status: 503, body: '{"code":"terminal_down"}', type: 'application/json' };
    if (p.startsWith('/option/list/contracts/quote')) return snapshotUp ? { status: 472, body: 'No data', type: 'text/plain' } : { status: 503, body: '', type: 'text/plain' };
    return { status: 404, body: '', type: 'text/plain' };
  };
  const lines: string[] = [];
  let at = SAT;
  const check = createExpiryCheck({ load: terminal, now: () => at, log: l => lines.push(l), fallbackOf: () => ({ drop: ['2088-07-19'], add: ['2026-12-15'] }) });
  const got = await check.answer('/option/list/expirations?symbol=SPX&format=csv');
  const dates = [...expirationsIn(String(got.body))];
  ok(got.status === 200 && String(got.type).includes('csv') && String(got.body).startsWith('symbol,expiration\n"SPX","2026-11-06"'), 'a CSV list is answered as CSV, the past as listed');
  ok(!dates.some(d => d >= '2088'), `SPX's 2088–2090 dates are gone (${F.listed.SPX.filter(d => d >= '2088').length} dropped)`);
  ok(dates.includes('2026-12-15'), 'a date only the snapshot carries is added');
  ok(asked.filter(p => p.startsWith('/option/snapshot/quote')).length === 1 && asked.some(p => p.includes('/option/list/contracts/quote?symbol=SPX&date=20261106')), "the snapshot, the open interest and Friday's quoted contracts are read");
  ok(lines.length === 1 && /dropped 2088-07-19/.test(lines[0]) && /added 2026-12-15/.test(lines[0]), `the verdict is logged: ${lines[0]?.slice(0, 120)}…`);
  const n = asked.length;
  const again = await check.answer('/option/list/expirations?symbol=SPX&format=json');
  const j = JSON.parse(String(again.body)) as { response: { expiration: string }[] };
  ok(asked.length === n + 1 && j.response.some(r => r.expiration === '2026-12-15') && !j.response.some(r => r.expiration >= '2088'), 'a JSON list is answered as JSON, the contracts not read again');
  ok(lines.length === 1, 'the same verdict is not logged twice');
  /* the contracts cannot be read: the last build's verdict */
  snapshotUp = false;
  at = SAT + 2 * 3_600_000;
  const down = createExpiryCheck({ load: terminal, now: () => at, log: () => {}, fallbackOf: () => ({ drop: ['2088-07-19'], add: ['2026-12-15'] }) });
  const fb = [...expirationsIn(String((await down.answer('/option/list/expirations?symbol=SPX&format=csv')).body))];
  ok(fb.includes('2026-12-15') && !fb.includes('2088-07-19') && fb.includes('2088-10-18'), "no contract read: the list less the build's empty dates, plus its new ones");
  ok(down.stats().unverified === 1, 'and it is counted as unverified');
  /* a list the terminal refuses passes through */
  const none = createExpiryCheck({ load: async () => ({ status: 472, body: 'No data', type: 'text/plain' }), now: () => SAT });
  ok((await none.answer('/option/list/expirations?symbol=ZZZZ&format=json')).status === 472, 'a 472 list is answered as the terminal answered');
}

/* ---- 4: the generated universe and the pickers ---- */
{
  const E = U.expiries;
  ok(E && E.verified, 'the universe carries verified expiry checks');
  if (E) {
    const rootPhantom = (c: Case) => (F.roots[c.symbol] ?? [c.symbol]).some(r => (E.phantom[r] ?? []).includes(c.date));
    const rootAdded = (c: Case) => (F.roots[c.symbol] ?? [c.symbol]).some(r => (E.added[r] ?? []).includes(c.date));
    ok(F.phantom.every(rootPhantom), `the build marks all 56 phantom dates (${F.phantom.filter(rootPhantom).length})`);
    ok(unlisted.every(rootAdded), `the build adds the 17 dates its list lacked (${unlisted.filter(rootAdded).length})`);
    const zero = (t: string, d: string) => (F.vendorRows[t] ?? []).some(r => r[0] === d && r.slice(1).every(x => !Number(x)));
    const flat = F.vendorEmpty.filter(c => zero(c.symbol, c.date));
    const hid = flat.filter(c => (E.noContracts[c.symbol] ?? []).includes(c.date));
    ok(hid.length === flat.length, `of the audit's ${F.vendorEmpty.length} unresolved vendor dates, the ${flat.length} with no exposure and no contract are marked (${hid.length})`);
    const kept = F.vendorEmpty.filter(c => !zero(c.symbol, c.date));
    ok(kept.every(c => !(E.noContracts[c.symbol] ?? []).includes(c.date)), `the ${kept.length} with exposure on the vendor's book (open interest: contracts) stay: ${kept.map(c => `${c.symbol} ${c.date}`).join(', ')}`);
    ok(zero('SPX', '2026-12-15') && !(E.noContracts.SPX ?? []).includes('2026-12-15'), 'SPX 2026-12-15 has no exposure yet but has contracts: it stays');
    setNoContractDates(E.noContracts);
  }
  const SAT = nyInstant('2026-11-07', 12 * 60);
  const days = ['2026-11-06', '2026-11-09', '2026-11-13', '2026-11-20', '2026-11-30'];
  const cbtx = pickableExpiries('CBTX', days, d => d, { at: SAT });
  ok(cbtx.join() === '2026-11-20,2026-11-30', `CBTX's picker on Saturday: Friday's settled date and the dates with no contract hidden (${cbtx.join(' ')})`);
  ok(expiryShut('SPX', '2026-12-15', SAT) === null && expiryShut('CBTX', '2026-11-09', SAT) === 'no contracts' && expiryShut('SPY', '2026-11-06', SAT) === 'settled', 'each date says why');
  const fri = nyInstant('2026-11-06', 16 * 60 + 20);
  ok(expiryShut('SPY', '2026-11-06', fri) === 'settled' && expiryShut('SPY', '2026-11-06', nyInstant('2026-11-06', 15 * 60)) === null, "today's date settles at 16:15, not before");
  ok(pickableExpiries('CBTX', days, d => d, { at: SAT, settled: false }).includes('2026-11-06'), 'a list with its own floor (Pinpoint) keeps the settled rule its own');
}

/* ---- 5: Trace's search reads the vendor's optionable flag ---- */
parseDirectory(['BOTH\tBoth Corp\tsovtpQ', 'TERM\tTerminal Only Corp\tsotQ', 'VEND\tVendor Only Corp\tsvpQ', 'NONE\tNo Options Corp\tstQ'].join('\n'));
const names = (room: 'trace' | 'option') => searchListed(room, '', 10, [], s => s).map(r => r.symbol).join();
ok(roomOf('/trace/tape') === 'trace' && roomOf('/weigher') === 'option', 'Trace is its own room');
ok(names('trace') === 'BOTH,VEND', `Trace offers the vendor's optionable names (${names('trace')})`);
ok(names('option') === 'BOTH,TERM', `the option desks offer the terminal's (${names('option')})`);
ok(searchListed('trace', 'TERM', 10, [], s => s).length === 0, 'a name only the terminal lists options on is not offered on Trace');

/* ---- 6: the vendor's non-monotone and out-of-range deltas (the audit's EWY: 13 strikes out of order, RLV: 9,
   MXEF: 30 outside [-1, 1] on 2026-11-20) are summed or shown, never searched as an ordered curve ---- */
{
  const ewy = [
    { strike: 60, delta: 0.62 }, { strike: 61, delta: 0.47 }, { strike: 62, delta: 0.55 }, { strike: 63, delta: 0.41 }, { strike: 64, delta: 0.52 },
  ];
  const pick = chooseContract('call', ewy);
  ok(pick?.strike === 64 && pick.delta === 0.52, `a delta curve out of order still picks the delta nearest 0.50 in the band (${pick?.strike} @ ${pick?.delta})`);
  const mxef = [{ strike: 1300, delta: 1.7 }, { strike: 1310, delta: -0.2 }, { strike: 1320, delta: Number.NaN }];
  ok(chooseContract('call', mxef) === null, 'deltas outside [-1, 1] or not numbers are not eligible: no contract, no throw');
  const net = positionDelta([{ side: 'BUY', delta: 1.7, contracts: 2 }, { side: 'SELL', delta: 0.47, contracts: 1 }] as SpreadLeg[]);
  ok(net != null && Number.isFinite(net) && Math.abs(net - (1.7 * 200 - 47)) < 1e-9, `a spread's net delta with an out-of-range leg is a finite sum (${net})`);
  ok(positionDelta([{ side: 'BUY', delta: Number.NaN }] as SpreadLeg[]) === null, 'a leg with no usable delta falls back to the vendor net');
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nexpiry evidence: every check holds');
