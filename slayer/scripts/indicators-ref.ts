/*
  THE INDICATORS' PARITY FIXTURE (2026-09-17). Runs getIndicators — the indicator math the
  snapshot's RSI, EMAs and squeeze come from (scripts/indicatorsRef.ts, kept from the retired
  simulator) — over the recorded histories and over series drawn to hit its branches, and writes
  engine/tests/fixtures/indicators_ref.json for engine/tests/test_snapshot.py. The four long
  histories are the ones recorded in that fixture (2026-09-17); the app has no simulator to draw
  them again. The inputs are chosen; every answer is the engine's.

    npx tsx scripts/indicators-ref.ts
*/

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getIndicators } from './indicatorsRef';

const recorded = JSON.parse(readFileSync('engine/tests/fixtures/indicators_ref.json', 'utf8')) as { cases: { name: string; prices: number[] }[] };

const drawn: { name: string; prices: number[] }[] = [
  { name: 'up only: no losses in the window', prices: Array.from({ length: 80 }, (_, i) => 100 + i * 0.5) },
  { name: 'down only: no gains in the window', prices: Array.from({ length: 80 }, (_, i) => 100 - i * 0.5) },
  { name: 'flat', prices: Array.from({ length: 80 }, () => 100) },
  { name: 'saw', prices: Array.from({ length: 120 }, (_, i) => 100 + ((i % 7) - 3) * 0.8 + i * 0.01) },
  { name: 'tight then wide', prices: Array.from({ length: 90 }, (_, i) => 100 + (i < 70 ? Math.sin(i) * 0.02 : Math.sin(i) * 3)) },
  { name: 'exactly fifty', prices: Array.from({ length: 50 }, (_, i) => 50 + Math.cos(i / 3) * 2) },
  { name: 'forty-nine: neutral', prices: Array.from({ length: 49 }, (_, i) => 50 + Math.cos(i / 3) * 2) },
  { name: 'three', prices: [100, 101, 102] },
  { name: 'one', prices: [100] },
];
const seeded = ['SPY', 'QQQ', 'AAPL', 'NVDA'].map(name => {
  const hit = recorded.cases.find(c => c.name === `${name} history`);
  if (!hit) throw new Error(`no recorded ${name} history in the fixture`);
  return { name: hit.name, prices: hit.prices };
});

const cases = [...seeded, ...drawn].map(c => ({ ...c, out: getIndicators(c.prices) }));
const out = { generatedBy: 'scripts/indicators-ref.ts', cases };
mkdirSync('engine/tests/fixtures', { recursive: true });
writeFileSync('engine/tests/fixtures/indicators_ref.json', JSON.stringify(out));
console.log(`wrote ${cases.length} series (${cases.map(c => c.prices.length).join(', ')} points)`);
