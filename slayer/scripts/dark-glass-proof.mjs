/*
  THE DARK GLASS PROOF (SITECHECK-2, 2026-11-06). A card painted with the dark glass — `background: 'rgba(8,8,10,…)'` —
  has to carry `data-chart-glass` (index.css): that is what sets the light ink ON the card. Without it the card's words
  take the page's ink, and on the light theme that is near-black words on the near-black glass — Pinpoint's tape read
  "Next session · One move … · Nothing left in this session" on light as an empty dark box.

  Fails on every JSX element whose own style paints the glass and whose opening tag has no data-chart-glass.
    node scripts/dark-glass-proof.mjs
*/

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const GLASS = /rgba\(\s*8\s*,\s*8\s*,\s*10\s*,/;

const files = [];
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) files.push(p);
  }
};
walk(ROOT);

/** Every JSX opening tag in a source: from `<Name` to the `>` that closes it outside any {…} or string */
function openingTags(src) {
  const out = [];
  const re = /<([A-Za-z][\w.]*)(?=[\s>/])/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 0, quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      else if (c === '<' && depth === 0) break; /* not a tag after all (a comparison) */
    }
    if (src[i] === '>') out.push({ at: m.index, text: src.slice(m.index, i + 1) });
  }
  return out;
}

let painted = 0;
const bad = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const t of openingTags(src)) {
    if (!GLASS.test(t.text)) continue;
    painted++;
    if (!/\bdata-chart-glass\b/.test(t.text)) {
      const line = src.slice(0, t.at).split('\n').length;
      bad.push(`${relative(ROOT, f)}:${line}  ${t.text.split('\n')[0].trim().slice(0, 90)}`);
    }
  }
}

if (painted === 0) {
  console.error('dark-glass-proof: found no glass card at all — the scan is broken');
  process.exit(1);
}
if (bad.length) {
  console.error(`dark-glass-proof: ${bad.length} of ${painted} dark-glass cards have no data-chart-glass — their words go dark on the light theme:`);
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`dark-glass-proof: all ${painted} dark-glass cards carry data-chart-glass`);
