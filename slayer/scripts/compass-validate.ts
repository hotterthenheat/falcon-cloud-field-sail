/*
  Compass's live inputs against what the trees were trained on, on a day's real rows.

  The server engine logs every row it scores (src/data/compassServer.ts: .cache/compass/rows/YYYY-MM-DD.jsonl, the 56
  inputs as the trees read them). For each column this reports:
  - the live range today against the range the trees were trained on (the models' own feature_infos);
  - how many rows sat outside that range (a tree sends them down its outermost branch, as LightGBM would);
  - how many rows were missing, and how the trees take a missing value on that column: a split whose missing type is
    "NaN" sends it the way training did; a split with missing type "None" or "Zero" reads it as 0, which is a real
    value there and silently changes the path. Any such column is flagged.
  It also checks the identities between columns on every row (x15 = 390 - x0, the signed copies x46..x55, the mid and
  the spread, the side, the class flags).

  Run: npx tsx scripts/compass-validate.ts [YYYY-MM-DD] [--json out.json]
  The definition check of each column against independently rebuilt inputs is scripts/compass-validate.py.
*/

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLS_HIGHBETA, CLS_INDEX } from '../src/data/compassParams';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const day = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';
const dir = process.env.COMPASS_DIR || join(root, '.cache', 'compass');
const file = join(dir, 'rows', `${day}.jsonl`);
if (!existsSync(file)) {
  console.error(`No scored rows for ${day} at ${file}. The server engine writes them as it scores.`);
  process.exit(1);
}

interface Row { t: number; d: string; k: string; e: string; b: number; a: number; s: number | null; late?: boolean; x: (number | null)[]; p1: number; p2: number }
const rows: Row[] = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Row);

/* ---- the trees: trained ranges and how each column's splits take a missing value ---- */

function model(name: string) {
  const text = readFileSync(join(root, 'public', 'models', name), 'utf8');
  const infos = /^feature_infos=(.*)$/m.exec(text)?.[1].trim().split(/\s+/) ?? [];
  const ranges = infos.map(s => {
    const m = /^\[(.+):(.+)\]$/.exec(s);
    return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null;
  });
  const splits = Array.from({ length: 56 }, () => ({ none: 0, zero: 0, nan: 0 }));
  for (const block of text.split(/\nTree=/).slice(1)) {
    const feat = /\nsplit_feature=(.*)/.exec(block)?.[1].trim().split(/\s+/).map(Number) ?? [];
    const dec = /\ndecision_type=(.*)/.exec(block)?.[1].trim().split(/\s+/).map(Number) ?? [];
    feat.forEach((f, i) => {
      const missing = (dec[i] >> 2) & 3;
      if (missing === 2) splits[f].nan += 1;
      else if (missing === 1) splits[f].zero += 1;
      else splits[f].none += 1;
    });
  }
  return { ranges, splits };
}
const entry = model('model_entry_all6months.txt');
const runner = model('model_runner_all6months.txt');

const NAMES = [
  't (minutes after 09:30)', 'return from the open', '5-minute return', '15-minute return', '60-minute return', 'place in the day range',
  'day range / open', 'realised vol, 30 min', 'rv30 / rv of the 30 before', 'range compression', 'opening-range break', 'opening-range break size',
  'vs prior high', 'vs prior low', 'open gap', 'minutes left', 'VWAP z', 'volume vs median curve', 'last-5 volume vs curve',
  'SPY 5-minute', 'SPY 15-minute', 'SPY from open', 'sector 15-minute', 'sector from open', 'ATM IV', 'skew (put - call IV)',
  'IV / RV', 'net gamma ($bn)', 'call wall distance', 'put wall distance', 'moneyness', 'side', 'mid', 'spread / mid',
  'mid 5-minute change', 'mid 15-minute change', 'contract IV', 'delta', 'gamma', 'theta / day', 'vega', 'gamma / |theta|',
  'theta / mid', 'contract open interest', 'index class', 'high-beta class', 'signed return from open', 'signed 5-minute',
  'signed 15-minute', 'signed 60-minute', 'signed VWAP z', 'signed OR break', 'signed SPY 15-minute', 'signed sector 15-minute',
  'signed vs prior high', 'signed vs prior low',
];

const n = rows.length;
/* the minutes the trees were trained on: column 0 from 15 to 330 */
const inWindow = (row: Row) => row.x[0] != null && row.x[0] >= 15 && row.x[0] <= 330;
const nIn = rows.filter(inWindow).length;
const cols = Array.from({ length: 56 }, (_, i) => {
  let lo = Infinity;
  let hi = -Infinity;
  let missing = 0;
  let below = 0;
  let above = 0;
  let missingIn = 0;
  const r = entry.ranges[i];
  for (const row of rows) {
    const v = row.x[i];
    if (v == null) {
      missing += 1;
      if (inWindow(row)) missingIn += 1;
      continue;
    }
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    if (r && v < r.lo) below += 1;
    if (r && v > r.hi) above += 1;
  }
  const sameRange = JSON.stringify(entry.ranges[i]) === JSON.stringify(runner.ranges[i]);
  /* a missing value read as 0 by some split, on a column that is missing live */
  const silent = missingIn > 0 ? entry.splits[i].none + entry.splits[i].zero + runner.splits[i].none + runner.splits[i].zero : 0;
  const silentOut = missing - missingIn > 0 ? entry.splits[i].none + entry.splits[i].zero + runner.splits[i].none + runner.splits[i].zero : 0;
  return { col: i, name: NAMES[i], live: missing === n ? null : { lo, hi }, trained: r, sameRange, missing, missingIn, below, above, splits: { entry: entry.splits[i], runner: runner.splits[i] }, silent, silentOut };
});

/* ---- identities on every row ---- */

const INDEX_CLS = new Set<string>(CLS_INDEX);
const HIGH_CLS = new Set<string>(CLS_HIGHBETA);
const close = (a: number | null, b: number, tol = 1e-6) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const fails: Record<string, number> = {};
const fail = (what: string) => (fails[what] = (fails[what] ?? 0) + 1);
for (const row of rows) {
  const x = row.x;
  const right = row.k.trim().slice(-1);
  const dir = right === 'C' ? 1 : -1;
  const ticker = row.k.split(' ')[0];
  if (!close(x[15], 390 - (x[0] ?? NaN))) fail('x15 = 390 - x0');
  if (x[31] !== dir) fail('x31 is the side of the contract');
  const mid = (row.b + row.a) / 2;
  if (!close(x[32], Math.fround(mid), 1e-6)) fail('x32 = (bid + ask) / 2');
  if (!close(x[33], Math.fround((row.a - row.b) / mid), 1e-5)) fail('x33 = (ask - bid) / mid');
  if (x[44] !== (INDEX_CLS.has(ticker) ? 1 : 0)) fail('x44 index class');
  if (x[45] !== (HIGH_CLS.has(ticker) ? 1 : 0)) fail('x45 high-beta class');
  for (const [k, src] of [[46, 1], [47, 2], [48, 3], [49, 4], [50, 16], [51, 11], [52, 20], [53, 22], [54, 12], [55, 13]] as const) {
    const s = x[src];
    if (s == null ? x[k] != null : !close(x[k], Math.fround(s * dir), 1e-6)) fail(`x${k} = x${src} × side`);
  }
  if (x[5] != null && (x[5] < -1e-9 || x[5] > 1 + 1e-9)) fail('x5 inside [0, 1]');
  if (x[10] != null && ![-1, 0, 1].includes(x[10])) fail('x10 is -1, 0 or 1');
  if (x[33] != null && x[33] > 0.08 + 1e-6) fail('x33 at most 8% (the spread gate)');
  if (x[41] != null && x[38] != null && x[39] != null && x[39] !== 0 && !close(x[41], Math.fround(x[38] / Math.abs(x[39])), 1e-4)) fail('x41 = gamma / |theta|');
  if (x[42] != null && x[39] != null && x[32] != null && !close(x[42], Math.fround(x[39] / x[32]), 1e-4)) fail('x42 = theta / mid');
  if (x[26] != null && x[24] != null && x[7] != null && !close(x[26], Math.fround(x[24] / (x[7] * Math.sqrt(390 * 252))), 1e-4)) fail('x26 = ATM IV / (rv30 · √(390·252))');
}

/* ---- the report ---- */

const pct = (k: number) => `${((k / n) * 100).toFixed(1)}%`;
const fmt = (v: number) => (Math.abs(v) >= 1000 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(4));
console.log(`Compass inputs, ${day}: ${n} scored rows (${rows.filter(r => r.late).length} scored late), ${new Set(rows.map(r => r.k.split(' ')[0])).size} names, ${new Set(rows.map(r => r.t)).size} marks\n`);
console.log('col  input                          live today                 trained                    missing   outside   missing read as 0');
for (const c of cols) {
  const live = c.live ? `[${fmt(c.live.lo)}, ${fmt(c.live.hi)}]` : 'all missing';
  const trained = c.trained ? `[${fmt(c.trained.lo)}, ${fmt(c.trained.hi)}]` : '?';
  const out = c.below + c.above ? `${c.below + c.above} (${pct(c.below + c.above)})` : '0';
  const silent = c.missing ? (c.silent ? `YES, inside 15–330 (${c.missingIn} rows, ${c.silent} splits)` : c.silentOut ? 'only outside 15–330' : 'no') : '';
  console.log(`x${String(c.col).padEnd(3)} ${c.name.padEnd(30)} ${live.padEnd(26)} ${trained.padEnd(26)} ${(c.missing ? pct(c.missing) : '0').padEnd(9)} ${out.padEnd(9)} ${silent}`);
}
const identity = Object.entries(fails);
console.log(`\nIdentities: ${identity.length ? identity.map(([k, v]) => `${k}: ${v} rows fail`).join('; ') : `all hold on ${n} rows`}`);
const flagged = cols.filter(c => c.silent);
console.log(`${nIn} of ${n} rows are inside the trained minutes (t 15 to 330); outside them column 0 is past every tree's range.`);
console.log(`Missing read as 0 on a split, inside the trained minutes: ${flagged.length ? flagged.map(c => `x${c.col}`).join(', ') : 'none (every split on a column that is missing there sends NaN the trained way)'}`);
const outside = cols.filter(c => c.silentOut && !c.silent);
if (outside.length) console.log(`Missing read as 0 only outside the trained minutes: ${outside.map(c => `x${c.col}`).join(', ')}`);
console.log(`Entry and runner trained ranges ${cols.every(c => c.sameRange) ? 'are the same on every column' : `differ on ${cols.filter(c => !c.sameRange).map(c => `x${c.col}`).join(', ')}`}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ day, rows: n, cols, identities: fails }, null, 1));
