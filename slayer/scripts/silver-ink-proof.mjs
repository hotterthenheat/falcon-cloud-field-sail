/*
  THE SILVER INK PROOF (SITECHECK-2, 2026-11-06). `--silver-fill` is the silver as a SURFACE (a filled pill with a dark
  word) and is the same pale 199 211 232 on both grounds; as an ink — a line, a word — it is `--silver`, deep steel on
  paper (paletteInk.ts). Dossier's NVDA earnings drew the term structure's Median line, and wrote its legend figure
  ("Median 40.5%"), in SILVER_FILL: 1.5:1 on the light panel.

  Fails on any chart series or word inked with the surface silver: `ink: SILVER_FILL`, `color: SILVER_FILL`, or a
  colour / stroke written as rgb(var(--silver-fill)).
    node scripts/silver-ink-proof.mjs
*/

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BAD = [
  /\b(?:ink|color|stroke)\s*:\s*SILVER_FILL\b/,
  /\b(?:ink|color|stroke)\s*:\s*['"`]rgb\(var\(--silver-fill\)\)/,
];

const files = [];
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(p)) files.push(p);
  }
};
walk(ROOT);

const hits = [];
for (const f of files) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (BAD.some(re => re.test(line))) hits.push(`${relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
}
if (hits.length) {
  console.error(`silver-ink-proof: ${hits.length} ink(s) use the surface silver — pale on the light theme; use rgb(var(--silver)):`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`silver-ink-proof: no line or word is inked with --silver-fill (${files.length} files)`);
