/*
  THE IMPACT INK PROOF (SITECHECK-2, 2026-11-06). The news calendar's pills write the print's title IN its impact ink, on
  a 13% wash of that ink (NewsCalendar.tsx Pill). The medium tier was the thermal ramp's #FDAE61 on both grounds: on the
  light theme a medium print ("US Services PMI · October", "Weekly Jobless Claims") read pale orange on pale orange, 1.7:1.

  Resolves each tier's ink on the light ground (a literal, or rgb(var(--token)) from tokens.css's light block), lays the
  pill's wash over the light panel and fails under 3.5:1 (the light set's label inks are cut to about 4.3:1 on white; the
  wash takes a little off that).
    node scripts/impact-ink-proof.mjs
*/

import { readFileSync } from 'node:fs';

const src = p => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const tokens = src('theme/tokens.css');
const mark = src('components/record/impactMark.tsx');

const block = sel => {
  const at = tokens.indexOf(`${sel} {`);
  if (at < 0) throw new Error(`no ${sel} block in tokens.css`);
  return tokens.slice(at, tokens.indexOf('\n}', at));
};
const light = block("[data-theme='light']");
const dark = block("[data-theme='dark']");
const tokenOf = (b, name) => {
  const m = b.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  return m ? m.slice(1, 4).map(Number) : null;
};
const rgbOf = (ink, b) => {
  const v = ink.match(/^rgb\(var\(--([\w-]+)\)\)$/);
  if (v) {
    const t = tokenOf(b, v[1]);
    if (!t) throw new Error(`--${v[1]} is not set in the block`);
    return t;
  }
  const h = ink.match(/^#([0-9a-f]{6})$/i);
  if (h) return [0, 2, 4].map(i => parseInt(h[1].slice(i, i + 2), 16));
  throw new Error(`cannot read the ink ${ink}`);
};
const lum = c => c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (top, a, bot) => top.map((v, i) => v * a + bot[i] * (1 - a));

const inks = mark.match(/IMPACT_INK[^=]*=\s*\{([^}]*)\}/);
if (!inks) throw new Error('IMPACT_INK not found in impactMark.tsx');
const tiers = [...inks[1].matchAll(/(\w+):\s*'([^']+)'/g)].map(m => ({ tier: m[1], ink: m[2] }));
if (tiers.length !== 3) throw new Error(`expected three tiers, read ${tiers.length}`);

const FLOOR = 3.5;
let failed = 0;
for (const [name, b] of [['light', light], ['dark', dark]]) {
  const panel = tokenOf(b, 'panel');
  for (const { tier, ink } of tiers) {
    if (tier === 'low') continue; /* the muted text ink, the theme's own */
    const fg = rgbOf(ink, b);
    const ground = over(fg, 0.13, panel);
    const r = ratio(fg, ground);
    const ok = name === 'dark' || r >= FLOOR; /* the dark ground is reported, the light one is the guard */
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${tier.padEnd(6)} ${ink.padEnd(26)} rgb(${fg.join(',')}) on its pill ${r.toFixed(2)}:1`);
  }
}
if (failed) {
  console.error(`impact-ink-proof: ${failed} impact ink(s) under ${FLOOR}:1 on the light pill`);
  process.exit(1);
}
console.log('impact-ink-proof: every impact ink holds on the light pill');
