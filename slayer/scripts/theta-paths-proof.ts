/*
  The browser proxy's ThetaData allowlist (shared/thetaPaths.mjs) is narrowed to the endpoints the app calls, and the
  flat files (the whole market for a day, several GB each) are denied outright. Every path the app builds still passes:
  this reads every ThetaData path written in src/, server/, scripts/, theta/, api/ (and engine/, research/, which ask
  the terminal directly) and checks each one.
  Run:  npx tsx scripts/theta-paths-proof.ts
*/
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { thetaAllowed } from '../shared/thetaPaths.mjs';
import { proxyTheta } from '../server/thetaProxy.mjs';
import { chainPath, closesPath, nightLivePath, nightQuotePath, nightVixPath, oiPath } from '../server/terrainApi.mjs';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/* ---- every ThetaData path the code writes ---- */
const ROOTS = ['src', 'server', 'scripts', 'theta', 'api', 'shared', 'engine', 'research'];
const files: string[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'fixtures' || f.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|js|py)$/.test(f) && !p.endsWith('theta-paths-proof.ts')) files.push(p);
  }
};
for (const r of ROOTS) walk(r);

const LITERAL = /\/(stock|option|index)\/(list|snapshot|history|at_time|flat_file)\/[a-z_]+(?:\/[a-z_]+)?/g;
/* a root chosen at run time: `/${root}/history/ohlc` is the stock's or the index's */
const TEMPLATED = /\/\$\{[^}]+\}\/(list|snapshot|history|at_time)\/(\$\{what\}|[a-z_]+)/g;
const REFERENCE = /\/(calendar\/(?:today|on_date|year_holidays)|interest_rate\/history\/eod)/g;
const used = new Map<string, Set<string>>();
const note = (path: string, file: string) => {
  if (!used.has(path)) used.set(path, new Set());
  used.get(path)!.add(file);
};
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(LITERAL)) {
    /* the parent of a templated leaf (Python's f'/stock/list/dates/{kind}', a JS `/…/${x}`) is not an endpoint itself */
    const next = text.slice(m.index! + m[0].length, m.index! + m[0].length + 3);
    if (/^\/\$?\{/.test(next)) continue;
    note(m[0], f);
  }
  for (const m of text.matchAll(TEMPLATED)) {
    const leaf = m[2] === '${what}' ? 'ohlc' : m[2];
    for (const root of ['stock', 'index']) note(`/${root}/${m[1]}/${leaf}`, f);
  }
  for (const m of text.matchAll(REFERENCE)) note(`/${m[1]}`, f);
}
/* the warm reads the supervisor builds (theta/supervisor.mjs warmPath) and the probe the relay answers */
for (const p of ['/index/snapshot/price', '/stock/snapshot/quote', '/calendar/today']) note(p, 'theta/supervisor.mjs');

const paths = [...used.keys()].sort();
/* paths this repo names only to deny or to describe (none of them is ever called) */
const NAMED_ONLY = /\/flat_file\//;
const called = paths.filter(p => !NAMED_ONLY.test(p));
console.log(`     ${called.length} ThetaData endpoints written in ${files.length} files:`);
for (const p of called) console.log(`       ${thetaAllowed(`${p}?symbol=SPY&format=json`) ? 'pass' : 'DENY'}  ${p}  (${[...used.get(p)!].slice(0, 3).join(', ')}${used.get(p)!.size > 3 ? ', …' : ''})`);
/* engine/ and research/ ask the terminal itself (127.0.0.1:25503, research/compass-v2/data/clients.py THETA_BASE,
   engine/slayer_core/theta.py BASE), never the browser proxy or the relay: a path only they write is listed, not held
   to the proxy's allowlist (2026-11-05: research/compass-v2's /index/history/price, its one-second SPX prints) */
const DIRECT = /^(engine|research)\//;
const direct = (p: string) => [...used.get(p)!].every(f => DIRECT.test(f.replace(/\\/g, '/')));
const denied = called.filter(p => !direct(p) && (!thetaAllowed(`${p}?symbol=SPY&format=json`) || !thetaAllowed(p)));
const directOnly = called.filter(p => direct(p) && !thetaAllowed(`${p}?symbol=SPY&format=json`));
if (directOnly.length) console.log(`     straight to the terminal, not through the proxy (not on its list): ${directOnly.join(', ')}`);
check(`every endpoint the app calls passes the allowlist (${called.length - directOnly.length - denied.length}/${called.length - directOnly.length})${denied.length ? `: denied ${denied.join(', ')}` : ''}`, denied.length === 0 && called.length >= 30);
/* research's templated list read, as it writes it (f'/stock/list/dates/{kind}', kind quote and trade) */
check('the stock date lists research walks pass (/stock/list/dates/quote, /trade)', ['/stock/list/dates/quote?symbol=SPY&format=json', '/stock/list/dates/trade?symbol=SPY&format=json'].every(p => thetaAllowed(p)));

/* Terrain's Regime tab (server/regimeApi.mjs), as it writes them */
const REGIME_READS = [
  '/index/snapshot/price?symbol=VIX1D,VIX9D,VIX,VIX3M,VIX6M,VVIX,SKEW&format=json',
  '/index/history/ohlc?symbol=VIX3M&start_date=20261030&end_date=20261030&interval=1m&start_time=03:00:00&end_time=16:15:00&format=json',
  '/index/history/eod?symbol=VIX&start_date=20251029&end_date=20261029&format=json',
];
check(`the Regime reads pass (${REGIME_READS.length}: the index snapshot, 1m and eod history)`, REGIME_READS.every(p => thetaAllowed(p)));
/* Building's complete open-interest change (server/oiChangeApi.mjs), as it writes it: one root, every expiration, one date */
const OI_CHANGE_READS = ['/option/history/open_interest?symbol=SPY&expiration=*&date=20261030&format=json', '/option/history/open_interest?symbol=SPXW&expiration=*&date=20261030&format=json'];
check(`Building's all-expiration open-interest read passes (${OI_CHANGE_READS.length})`, OI_CHANGE_READS.every(p => thetaAllowed(p)));

/* Terrain's option-chain reads (server/terrainApi.mjs), as it writes them: the Surface tab's Skew and Drift lenses */
const TERRAIN_READS = [chainPath('SPXW'), oiPath('SPXW'), closesPath('SPXW', '2026-10-29')];
check(`the Terrain chain reads pass (${TERRAIN_READS.length}: the all-expiry greeks and open-interest snapshots, the prior session's end-of-day greeks)`, TERRAIN_READS.every(p => thetaAllowed(p)));

/* Terrain's overnight SPX line (server/terrainApi.mjs), as it writes it: the night's SPXW quotes by half, the live pairs, the VIX's morning */
const NIGHT_READS = [nightQuotePath('2026-10-30', '2026-10-29', '20:15:00', '23:59:59'), nightQuotePath('2026-10-30', '2026-10-30', '00:00:00', '09:25:00'), nightLivePath('2026-10-30'), nightVixPath('2026-10-30', '03:00:00', '09:25:00')];
check(`the overnight line's reads pass (${NIGHT_READS.length}: the night's quote history, its live quotes, the VIX's 5-minute history)`, NIGHT_READS.every(p => thetaAllowed(p)));

/* ---- what is shut ---- */
const FLAT = ['/option/flat_file/trade_quote', '/option/flat_file/eod', '/option/flat_file/open_interest', '/option/flat_file/quote', '/stock/flat_file/trade_quote', '/stock/flat_file/eod', '/stock/flat_file/quote', '/index/flat_file/eod'];
check(`all 8 flat-file endpoints are denied (they passed /^\\/option\\/.+/ and /^\\/stock\\/.+/ before)`, FLAT.every(p => !thetaAllowed(`${p}?date=20261030&format=json`) && !thetaAllowed(p)));
const NEVER = ['/option/snapshot/market_value', '/stock/snapshot/market_value', '/index/snapshot/market_value', '/option/history/trade_greeks/all', '/option/snapshot/binomial_greeks/all', '/stock/at_time/trade', '/option/flat_file', '/stock/anything/else', '/option/snapshot/greeks/first_order/../../../flat_file/eod'];
check(`endpoints the app does not call are shut too: ${NEVER.filter(p => !thetaAllowed(`${p}?symbol=SPY`)).length}/${NEVER.length}`, NEVER.every(p => !thetaAllowed(`${p}?symbol=SPY`)));
/* Terrain's tapes (src/data/tapeServer.ts): the option prints and the stock prints, each with the quote in force */
check('the tapes\' reads pass: /option/history/trade_quote, /stock/history/trade_quote, /option/history/open_interest', ['/option/history/trade_quote?symbol=SPY&expiration=*&date=20261030&start_time=15:00:00&end_time=15:14:59.999&strike_range=30&exclusive=true&format=csv', '/stock/history/trade_quote?symbol=SPY&date=20261030&start_time=15:00:00&end_time=15:09:59.999&exclusive=true&venue=utp_cta&format=csv', '/option/history/open_interest?symbol=SPXW&expiration=*&date=20261030&format=csv'].every(p => thetaAllowed(p)));
check('a query cannot smuggle a path in: /option/history/eod?x=/flat_file/ passes, /option/flat_file/eod?x=/history/eod does not', thetaAllowed('/option/history/eod?symbol=SPY&x=/flat_file/') && !thetaAllowed('/option/flat_file/eod?x=/option/history/eod'));

/* ---- the proxy itself answers 404 for a flat file, before the caller is even checked ---- */
{
  const res = { statusCode: 0, headers: {} as Record<string, string>, body: '', setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: string) { this.body = b; } };
  await proxyTheta({ method: 'GET', url: '/api/theta/option/flat_file/quote?date=20261030&format=json', headers: {} } as never, res as never);
  check(`the browser proxy answers ${res.statusCode} ${res.body} for /option/flat_file/quote`, res.statusCode === 404);
}

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
