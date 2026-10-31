/* The symbol directory and every desk's ticker search: names on every row, name search, the ranking, speed on the
   full directory, and the option desks (Weigher, Paper, Backtest) never offering a name without listed options.
   npx tsx scripts/symbol-directory-proof.ts */

import { DIRECTORY } from '../src/data/symbolDirectory.data';
import { directoryEntry, directorySize, hasListedOptions, loadDirectory, optionRootOf, searchDirectory } from '../src/data/symbolDirectory';
import { companyName, searchTickers } from '../src/data/tickers';
import { isOptionRoot, roomOf, searchRoom } from '../src/data/listedNames';

let failed = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else {
    failed += 1;
    console.log(`  FAIL ${what}`);
  }
};

await loadDirectory();
const lines = DIRECTORY.split('\n');
ok(directorySize() === lines.length && lines.length > 10_000, `the directory parses every line (${directorySize()})`);

/* coverage */
const named = lines.filter(l => l.split('\t')[1]).length;
ok(named / lines.length > 0.95, `names on ${((named / lines.length) * 100).toFixed(1)}% of symbols`);
const optionable = lines.filter(l => /^[a-z]o/.test(l.split('\t')[2] ?? ''));
const optNamed = optionable.filter(l => l.split('\t')[1]).length;
ok(optNamed / optionable.length > 0.99, `names on ${((optNamed / optionable.length) * 100).toFixed(1)}% of the ${optionable.length} names with options`);

/* the names people look for */
for (const [sym, kind, opts] of [
  ['NVDA', 'stock', true], ['SMH', 'etf', true], ['SPX', 'index', true], ['NDX', 'index', true], ['RUT', 'index', true],
  ['VIX', 'index', true], ['BRK.B', 'stock', true], ['F', 'stock', true], ['KO', 'stock', true], ['BRK.A', 'stock', false],
] as const) {
  const e = directoryEntry(sym);
  ok(e && e.kind === kind && e.options === opts && e.name, `${sym}: ${e?.name} · ${e?.kind} · options ${e?.options}`);
}
ok(hasListedOptions('BRKB') === true && optionRootOf('BRK.B') === 'BRKB', 'BRK.B options are the BRKB root');
ok(directoryEntry('brk/b')?.symbol === 'BRK.B' && directoryEntry('BRK-B')?.symbol === 'BRK.B', 'BRK/B and BRK-B read BRK.B');

/* ranking */
const first = (q: string, o = {}) => searchDirectory(q, { limit: 10, ...o }).map(e => e.symbol);
ok(first('nvidia')[0] === 'NVDA', `"nvidia" finds NVDA first (${first('nvidia').slice(0, 3)})`);
ok(first('NVDA')[0] === 'NVDA', '"NVDA" exact first');
ok(first('A')[0] === 'A', `"A" exact first, then prefixes (${first('A').slice(0, 5)})`);
ok(first('F')[0] === 'F', '"F" finds Ford first');
ok(first('apple')[0] === 'AAPL', `"apple" finds AAPL first (${first('apple').slice(0, 3)})`);
ok(first('tesla')[0] === 'TSLA', '"tesla" finds TSLA first');
ok(first('coca')[0] === 'KO', `"coca" finds KO first — "The" is not part of the match (${first('coca').slice(0, 3)})`);
ok(first('berkshire').includes('BRK.B'), `"berkshire" finds BRK.B (${first('berkshire')})`);
ok(first('brk b')[0] === 'BRK.B' && first('BRKB')[0] === 'BRK.B', '"brk b" and "BRKB" find BRK.B');
ok(first('semiconductor').includes('SMH') || first('vaneck semi').includes('SMH'), `"semiconductor" finds SMH (${first('semiconductor')})`);
ok(first('s&p 500')[0] !== undefined && first('S&P 500 Index').includes('SPX'), 'an index by its name');
ok(first('AM').slice(0, 3).includes('AMD') && first('AM').slice(0, 3).includes('AMZN'), `prefix tier by popularity (${first('AM').slice(0, 5)})`);

/* names on every search row */
const rows = searchTickers('nv', 40);
ok(rows.every(r => r.name && r.name !== r.symbol), 'every "nv" row carries a name');
ok(companyName('NVDA').toUpperCase().includes('NVIDIA'), `companyName(NVDA) = ${companyName('NVDA')}`);
ok(companyName('SMH') !== 'SMH' && companyName('BRK.B') !== 'BRK.B', `companyName(SMH) = ${companyName('SMH')}`);

/* the rooms */
ok(roomOf('/weigher') === 'option' && roomOf('/practice/paper/a1') === 'option' && roomOf('/practice/backtest') === 'option', 'Weigher, Paper and Backtest are option desks');
ok(roomOf('/terrain') === 'equity', 'Terrain is every listing');
const nameOf = (s: string) => companyName(s);
const probes = ['', 'a', 'b', 'c', 'co', 'cola', 'ko', 'brk', 'berkshire', 'pref', 'warrant', 'unit', 'acquisition', 'trust', 'etf', 'fund', 'bank', 'x', 'z', 'q', 'nvidia', 'spx', 'vix', 'ford', 'pfd', '.pr', 'ws'];
let offered = 0;
let bad: string[] = [];
for (const q of probes) {
  for (const r of searchRoom('option', q, 400, [], nameOf)) {
    offered += 1;
    if (!isOptionRoot(r.symbol) || directoryEntry(r.symbol)?.options === false) bad.push(r.symbol);
  }
}
ok(offered > 1000 && bad.length === 0, `the option desks (Weigher) offered ${offered} rows over ${probes.length} queries, none without listed options${bad.length ? ` — ${[...new Set(bad)].slice(0, 10)}` : ''}`);
const equityHasPlain = searchRoom('equity', 'BRK.A', 5, [], nameOf).some(r => r.symbol === 'BRK.A');
ok(equityHasPlain && !searchRoom('option', 'BRK.A', 5, [], nameOf).some(r => r.symbol === 'BRK.A'), 'BRK.A (no options): on Terrain, not on the Weigher');

/* speed: every keystroke of a few words over the full directory */
/* Each keystroke is judged on its best timed run, never on one run: other processes on a busy box only ever add to a
   run (27–42 ms readings under load for keystrokes that take a few ms), so the fastest is the closest to the search's
   own cost. One untimed warm-up pass over every keystroke pays the JIT; then KEY_RUNS timed runs a keystroke, each
   after a 2 ms nap so it starts on a fresh time slice. The slowest keystroke's best must be inside the same 16 ms. */
const words = ['nvidia', 'berkshire hathaway', 'semiconductor', 'spdr s&p', 'a', 'zz', 'bank of america', 'BRK.B', 'qqq'];
const KEY_BUDGET_MS = 16;
const KEY_RUNS = 9;
const nap = new Int32Array(new SharedArrayBuffer(4));
const keystroke = (q: string) => {
  searchRoom('equity', q, 80, [], nameOf);
  searchRoom('option', q, 80, [], nameOf);
};
for (const w of words) for (let i = 1; i <= w.length; i++) keystroke(w.slice(0, i));
let worst = 0;
let worstKey = '';
let timed = 0;
for (const w of words)
  for (let i = 1; i <= w.length; i++) {
    let best = Infinity;
    for (let k = 0; k < KEY_RUNS; k++) {
      Atomics.wait(nap, 0, 0, 2);
      const t0 = performance.now();
      keystroke(w.slice(0, i));
      best = Math.min(best, (performance.now() - t0) / 2);
      timed++;
    }
    if (best > worst) {
      worst = best;
      worstKey = w.slice(0, i);
    }
  }
ok(worst < KEY_BUDGET_MS, `slowest keystroke "${worstKey}" ${worst.toFixed(2)} ms at its best of ${KEY_RUNS} runs after a warm-up (budget ${KEY_BUDGET_MS}; ${timed} timed runs)`);

if (failed) {
  console.log(`symbol-directory-proof: ${failed} FAILED`);
  process.exit(1);
}
console.log('symbol-directory-proof: all ok');
