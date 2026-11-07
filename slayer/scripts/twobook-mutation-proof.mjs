/*
  The two-book engine's mutation check (docs/TWO_BOOK_SPEC_V2.md §7 Test 6): each bug the spec lists is injected into a
  copy of src/engine/twobook, scripts/twobook-proof.ts runs against the copy, and the proof MUST fail. Four scaling bugs
  are added beside the spec's twelve. A mutation whose text is no longer found in the engine is itself a failure (the
  engine's formula lines were edited: update the table here).
    node scripts/twobook-mutation-proof.mjs
*/

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = join(root, 'src', 'engine', 'twobook');
const session = pathToFileURL(join(root, 'shared', 'marketSession.mjs')).href;

/** [name, file, from, to] — every `from` must occur in the file */
const MUTATIONS = [
  ['color missing (b − r)', 'bsm.ts', 'gamma * ((b - r) + (d1 * d2 - 1)', 'gamma * ((d1 * d2 - 1)'],
  ['veta (1 − d1·d2)', 'bsm.ts', '(1 + d1 * d2) / (2 * T)', '(1 - d1 * d2) / (2 * T)'],
  ['charm sign', 'bsm.ts', 'const charm = charmRaw;', 'const charm = -charmRaw;'],
  ['charm without carry term', 'bsm.ts', [['(b - r) * N1)', '0 * N1)'], ['(b - r) * Nm1)', '0 * Nm1)']]],
  ['speed sign', 'bsm.ts', 'const speed = (-gamma / S)', 'const speed = (gamma / S)'],
  ['zomma (d1·d2 + 1)', 'bsm.ts', '(gamma * (d1 * d2 - 1)) / sigma', '(gamma * (d1 * d2 + 1)) / sigma'],
  ['vanna with d1', 'bsm.ts', '(-ec * p * d2) / sigma', '(-ec * p * d1) / sigma'],
  ['COLOR without minus', 'exposures.ts', '(-g.colorT * C', '(g.colorT * C'],
  ['CHARM with extra minus', 'exposures.ts', 'CHARM: (g.charm * C', 'CHARM: (-g.charm * C'],
  ['VANNA without S', 'exposures.ts', 'VANNA: g.vanna * C * M * S * 0.01', 'VANNA: g.vanna * C * M * 0.01'],
  ['Model 2 buy sign', 'classify.ts', 'const buyC = -size;', 'const buyC = size;'],
  ['UW DEX without put flip', 'exposures.ts', '(f.call_delta_oi - f.put_delta_oi) * 100', '(f.call_delta_oi + f.put_delta_oi) * 100'],
  /* scaling bugs beside the spec's list */
  ['D = 365.25 (scaling)', 'contracts.ts', 'export const D = 365;', 'export const D = 365.25;'],
  ['GEX without the 1% (scaling)', 'exposures.ts', 'GEX: g.gamma * C * M * S * S * 0.01', 'GEX: g.gamma * C * M * S * S'],
  ['SPEED with S² (scaling)', 'exposures.ts', 'SPEED: g.speed * C * M * S * S * S * 0.0001', 'SPEED: g.speed * C * M * S * S * 0.0001'],
  ['per hour not ÷24 (scaling)', 'exposures.ts', "const u = per === 'hour' ? 24 : 1;\n  return {\n    GEX", "const u = 1;\n  return {\n    GEX"],
];

let bad = 0;
const rows = [];
for (const [name, file, from, to] of MUTATIONS) {
  const dir = mkdtempSync(join(tmpdir(), 'twobook-mut-'));
  try {
    cpSync(engine, dir, { recursive: true });
    for (const f of ['contracts.ts']) {
      const p = join(dir, f);
      writeFileSync(p, readFileSync(p, 'utf8').replace("'../../../shared/marketSession.mjs'", `'${session}'`));
    }
    const p = join(dir, file);
    let src = readFileSync(p, 'utf8');
    const pairs = Array.isArray(from) ? from : [[from, to]];
    let missing = false;
    for (const [a, b] of pairs) {
      if (!src.includes(a)) missing = true;
      src = src.split(a).join(b);
    }
    if (missing) {
      bad++;
      rows.push(`✗ ${name}: the text to mutate is not in ${file} — update scripts/twobook-mutation-proof.mjs`);
      continue;
    }
    writeFileSync(p, src);
    const run = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'twobook-proof.ts')], { cwd: root, env: { ...process.env, TWOBOOK_ENGINE: dir, TWOBOOK_QUIET: '1' }, encoding: 'utf8' });
    const out = `${run.stdout}${run.stderr}`;
    const n = /FAIL: (\d+) failure/.exec(out)?.[1];
    if (run.status === 0) {
      bad++;
      rows.push(`✗ ${name}: NOT caught (the proof passed)`);
    } else if (!n) {
      bad++;
      rows.push(`✗ ${name}: the proof did not run (${out.trim().split('\n').slice(-1)[0]})`);
    } else rows.push(`✓ ${name}: caught (${n} failures)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const r of rows) console.log(r);
const caught = MUTATIONS.length - bad;
if (bad) {
  console.log(`twobook-mutation-proof FAIL: ${caught}/${MUTATIONS.length} injected bugs caught`);
  process.exit(1);
}
console.log(`twobook-mutation-proof OK: ${caught}/${MUTATIONS.length} injected bugs caught (the spec's 12 and 4 scaling bugs)`);
