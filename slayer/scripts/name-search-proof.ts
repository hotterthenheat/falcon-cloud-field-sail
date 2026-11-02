/* Terrain's name search (components/ui/NameSearchSheet.tsx) lists what data/nameSearch.ts searchNames returns: this
   proof runs that function on the full symbol directory. At rest the watchlist's names lead, each name once, then the
   featured names; typed, the exact symbol comes first, a company is found by its name, a weekly index root folds into
   its index, an ETF, a cash index, a small cap and a name with no listed options are all offered with their names,
   and the rows come back fast enough for a keystroke. Before the directory's chunk lands the bundled list answers.
   npx tsx scripts/name-search-proof.ts */

import { searchNames, NAME_LIMIT } from '../src/data/nameSearch';
import { directoryEntry, directoryReady, loadDirectory } from '../src/data/symbolDirectory';

let failed = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else {
    failed += 1;
    console.log(`  FAIL ${what}`);
  }
};
const top = (q: string, n = 5) => searchNames(q).slice(0, n).map(r => r.symbol);

/* ---- before the directory: the bundled listings answer the first keystroke ---- */
ok(!directoryReady(), 'the directory is not loaded yet');
const early = searchNames('NVDA');
ok(early[0]?.symbol === 'NVDA', `before the chunk lands, "NVDA" still finds NVDA (${early.slice(0, 3).map(r => r.symbol)})`);
ok(searchNames('').length > 0, 'before the chunk lands, the list at rest is not empty');

await loadDirectory();
ok(directoryReady(), 'the directory loads');

/* ---- at rest ---- */
const watched = ['NVDA', 'xle', 'NVDA', 'SPY'];
const rest = searchNames('', watched);
ok(rest.slice(0, 3).map(r => r.symbol).join() === 'NVDA,XLE,SPY', `the watchlist leads, in its order, each once (${rest.slice(0, 4).map(r => r.symbol)})`);
ok(new Set(rest.map(r => r.symbol)).size === rest.length, 'no name twice at rest');
ok(rest.length === NAME_LIMIT + 3, `forty names after the watchlist's three (${rest.length})`);
/* (a company may be named its own letters — IREN is "IREN") */
ok(rest.every(r => r.name) && rest.filter(r => r.name.toUpperCase() !== r.symbol).length >= rest.length - 2, 'every row at rest carries a company name');
const bare = searchNames('').map(r => r.symbol);
ok(bare[0] === 'SPY' && bare.slice(0, 3).includes('QQQ'), `with no watchlist the featured names lead (${bare.slice(0, 5)})`);
ok(!bare.includes('SPXW') && !bare.includes('RUTW'), 'a weekly root is never offered as its own name');

/* ---- typed: the symbols people ask for, exact first ---- */
const exact = [
  'SPY', 'QQQ', 'IWM', 'SPX', 'NDX', 'VIX', 'RUT', 'AAPL', 'NVDA', 'TSLA', 'AMD', 'PLTR', 'SMCI', 'XLE',
  'SOUN', 'RKLB', 'OPEN', 'ASTS', 'IONQ', 'GME', 'KO', 'HIMS', 'DJT', 'BRK.A', 'BRK.B',
];
for (const sym of exact) {
  const got = searchNames(sym);
  ok(got[0]?.symbol === sym && got[0].name && got[0].name !== sym, `"${sym}" → ${got[0]?.symbol} · ${got[0]?.name}`);
}
ok(top('spy')[0] === 'SPY' && top('$nvda')[0] === 'NVDA', 'lower case and a $ prefix read as the symbol');

/* ---- a company by its name ---- */
for (const [q, sym] of [
  ['apple', 'AAPL'], ['nvidia', 'NVDA'], ['tesla', 'TSLA'], ['palantir', 'PLTR'], ['super micro', 'SMCI'],
  ['advanced micro', 'AMD'], ['coca', 'KO'], ['soundhound', 'SOUN'], ['gamestop', 'GME'],
] as const) {
  ok(top(q)[0] === sym, `"${q}" finds ${sym} first (${top(q, 3)})`);
}
ok(top('berkshire').includes('BRK.B'), `"berkshire" offers BRK.B (${top('berkshire')})`);
ok(top('brk b')[0] === 'BRK.B' && top('brk/b')[0] === 'BRK.B', '"brk b" and "brk/b" read BRK.B');
ok(top('energy select').includes('XLE'), `an ETF by its name (${top('energy select')})`);
ok(top('volatility').includes('VIX'), `an index by its name (${top('volatility')})`);

/* ---- folds, kinds, no options ---- */
ok(top('SPXW')[0] === 'SPX' && top('RUTW')[0] === 'RUT' && top('VIXW')[0] === 'VIX', `a weekly root folds into its index (${top('SPXW', 2)} · ${top('RUTW', 2)})`);
ok(directoryEntry('SPX')?.kind === 'index' && directoryEntry('XLE')?.kind === 'etf', 'SPX is an index, XLE an ETF (the rows tag them)');
const noOpt = searchNames('BRK.A')[0];
ok(noOpt?.symbol === 'BRK.A' && directoryEntry('BRK.A')?.options === false, 'a name with no listed options is still offered on Terrain (its row says "no options")');

/* ---- prefixes by popularity, and nothing for nonsense ---- */
const am = top('AM', 6);
ok(am[0] === 'AM' || (am.includes('AMD') && am.includes('AMZN')), `"AM": the exact symbol, then prefixes by popularity (${am})`);
ok(top('NV', 3)[0] === 'NVDA', `"NV" puts NVDA first (${top('NV', 3)})`);
ok(searchNames('zzqqxx-not-a-name').length === 0, 'a query nothing matches lists nothing (the sheet says so)');
ok(searchNames('a'.repeat(4)).length <= NAME_LIMIT, 'a query lists forty at most');

/* ---- speed: a keystroke's search on the full directory ---- */
const t0 = performance.now();
for (const q of ['a', 'ap', 'app', 'appl', 'apple', 'n', 'nv', 'nvd', 'nvda', 's', 'sp', 'spx', 'energy', 'micro']) searchNames(q);
const per = (performance.now() - t0) / 14;
ok(per < 25, `a keystroke's search takes ${per.toFixed(2)} ms on ${'14k'} listings`);

if (failed) {
  console.log(`${failed} name-search check(s) failed`);
  process.exit(1);
}
console.log('name search: every check passed');
