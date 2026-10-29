/**
 * Slayer's LightGBM walk against LightGBM's own Booster.predict on fixed vectors.
 * Run: npx tsx scripts/lgbm-parity-proof.ts
 * The expected outputs come from scripts/lgbm-parity-fixture.py.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBoosters, predict } from '../src/data/lgbm.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/lgbm-parity.json'), 'utf8')) as {
  vectors: (number | null)[][];
  entry: number[];
  runner: number[];
};
const TOL = 1e-6;

function load(name: string) {
  const trees = parseBoosters(readFileSync(join(root, 'public/models', name), 'utf8'), 300);
  if (!trees) throw new Error(`${name}: did not parse as 300 numerical trees`);
  return trees;
}

const inputs = fixture.vectors.map(row => row.map(v => (v == null ? NaN : Math.fround(v))));
let failed = 0;
for (const [name, file, want] of [
  ['entry', 'model_entry_all6months.txt', fixture.entry],
  ['runner', 'model_runner_all6months.txt', fixture.runner],
] as const) {
  const trees = load(file);
  let worst = 0;
  inputs.forEach((x, i) => {
    const err = Math.abs(predict(trees, x) - want[i]);
    if (err > worst) worst = err;
    if (err > TOL) failed++;
  });
  console.log(`${name}: ${inputs.length} vectors, max |slayer - lightgbm| = ${worst.toExponential(2)}`);
}
if (failed) {
  console.error(`FAIL: ${failed} predictions differ by more than ${TOL}`);
  process.exit(1);
}
console.log('lgbm parity: pass');
