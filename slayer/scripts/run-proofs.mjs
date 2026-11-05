/*
  Every proof and golden test CI runs, in one list: `npm test` runs this, and so does CI (.github/workflows/ci.yml), so
  the two can never drift apart. A proof is added here, nowhere else.
    npm test                      every proof, then every scripts/golden/*-golden.ts
    npm test -- pine-proof hub-proof   only the ones named (a proof's file name without its extension)
  Each runs in its own process (node --import tsx for TypeScript), one after another; the run stops at the end with a
  list of what failed and a non-zero exit. Under GitHub Actions each one's output is folded into its own group.
*/

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The proofs, run in this order: scripts/<name>.ts, or .mjs where it says so */
const PROOFS = [
  'trace-moneyness-proof',
  'gamma-sign-proof',
  'book-scale-proof',
  'lgbm-parity-proof',
  'chart-proof',
  'clock-proof',
  'chart-zone-proof',
  'bar-pass-proof',
  'contract-quote-proof',
  'compass-return-proof',
  'compass-gate-proof',
  'compass-groupb-proof',
  'compass-late-proof',
  'compass-record-proof',
  'fixture-proof',
  'higher-proof',
  'paper-proof',
  'replay-proof',
  'review-engine-proof',
  'review-journal-proof',
  'spx-book-proof',
  'terrain-contract-proof',
  'terrain-setups-proof',
  'exposure-recorder-proof',
  'pine-proof',
  'indicators-mz-proof',
  'vol-outlook-proof',
  'weigher-density-proof',
  'weigher-audit-proof',
  'session-proof',
  'session-literal-proof',
  'symbol-directory-proof',
  'name-search-proof',
  'name-card-proof.mjs',
  'opening-lean-proof',
  'tape-cache-proof',
  'walls-flip-proof',
  'theta-wait-proof',
  'book-mode-proof',
  'carry-proof',
  'rate-proof',
  'forward-proof',
  'live-check-proof',
  'heatmap-proof',
  'holidays-proof',
  'theta-paths-proof',
  'flow-tags-proof',
  'flow-room-proof',
  'stock-prints-proof',
  'cone-feed-proof',
  'weigher-gamma-proof',
  'node-strikes-proof',
  'edge-label-fit-proof',
  'ribbon-proof',
  'node-levels-proof',
  'physics-reads-proof',
  'session-levels-proof',
  'exposure-hist-proof',
  'proxy-auth-proof.mjs',
  'hub-proof.mjs',
  'vol-regime-proof.mjs',
  'oi-change-proof.mjs',
  'skew-proof',
  'charm-drift-proof',
  'overnight-proof',
  'wind-proof',
  'terrain-desk-proof',
  'world-sessions-proof',
  'after-hours-prints-proof',
  'drawing-geometry-proof',
  'candle-patterns-proof',
  'volume-at-price-proof',
  'tv-levels-proof',
  'indicators-al-proof',
];

const goldens = () =>
  readdirSync(join(root, 'scripts', 'golden'))
    .filter(f => f.endsWith('-golden.ts'))
    .sort()
    .map(f => `golden/${f}`);

const fileOf = name => (/\.(m?js|ts)$/.test(name) ? name : `${name}.ts`);
const all = [...PROOFS.map(fileOf), ...goldens()];
const asked = process.argv.slice(2);
const chosen = asked.length ? all.filter(f => asked.some(a => f === fileOf(a) || f.replace(/\.(m?js|ts)$/, '') === a || f === `golden/${fileOf(a)}`)) : all;
if (asked.length && !chosen.length) {
  console.error(`run-proofs: none of ${asked.join(', ')} is in the list`);
  process.exit(2);
}

const ci = !!process.env.GITHUB_ACTIONS;
const failed = [];
const t0 = Date.now();
for (const f of chosen) {
  const args = f.endsWith('.ts') ? ['--import', 'tsx', join('scripts', f)] : [join('scripts', f)];
  console.log(ci ? `::group::${f}` : `\n── ${f}`);
  const started = Date.now();
  const got = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  const ok = got.status === 0;
  if (ci) console.log('::endgroup::');
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (!ok) failed.push(f);
}
console.log(`\n${chosen.length - failed.length} of ${chosen.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)} s${failed.length ? ` — failed: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
