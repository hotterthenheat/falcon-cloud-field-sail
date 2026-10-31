/*
  SLAYER BRAND — SYNC (brand/sync.mjs)

  The brand system draws nothing of its own: the mark, the wordmark, the page glyphs, every colour, the room names and
  their lines, and the plans are the terminal's, read from the app's sources and written once into plain JavaScript
  under brand/lib/generated/. Plain JS so the same templates run in Node (brand/build.mjs, the exporter) and in a
  browser (brand/studio, the campaign generator) without a build step.

    src/brand/paths.ts               the mark's outlines        → generated/source.mjs  MARK, MARK_CONTENT
    src/brand/wordmarkPaths.ts       the wordmark's outlines    → generated/source.mjs  WORDMARK
    src/components/ui/glyphPaths.ts  the thirteen page glyphs   → generated/source.mjs  GLYPH_DRAW
    src/theme/tokens.css             every colour, both themes  → generated/tokens.mjs  TOKENS
    src/index.css                    the holo and galaxy inks   → generated/tokens.mjs  GRADIENTS
    src/components/layout/nav.ts     rooms, lines, desk inks    → generated/product.mjs ROOMS, NAV_INK
    src/data/billing.ts              the plans and prices       → generated/product.mjs PLANS
    src/pages/landing/products/*     each product's head, intro → generated/product.mjs PRODUCTS
    src/pages/landing/Landing.tsx    hero, does/never, FAQ      → generated/product.mjs VOICE
    src/components/layout/SiteFooter the disclaimer line        → generated/product.mjs VOICE.disclaimer

  Run:    npm run brand:sync   (tsx brand/sync.mjs — tsx so the app's .ts sources can be imported as they are)
  Check:  npm run brand:check  (tsx brand/sync.mjs --check) — fails if generated/ is stale, so a change to the
          terminal's brand can never leave the marketing system drawing the old one.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const OUT = resolve(HERE, 'lib/generated');
const read = p => readFileSync(resolve(APP, p), 'utf8');

const { MARK, MARK_CONTENT } = await import(resolve(APP, 'src/brand/paths.ts'));
const { WORDMARK } = await import(resolve(APP, 'src/brand/wordmarkPaths.ts'));
const { GLYPH_DRAW } = await import(resolve(APP, 'src/components/ui/glyphPaths.ts'));

/* ── tokens.css: the dark block (":root, [data-theme='dark']") and the paper block ("[data-theme='light']") ── */
const tokensCss = read('src/theme/tokens.css');
const blockOf = start => {
  const at = tokensCss.indexOf(start);
  if (at < 0) throw new Error(`brand/sync: no "${start}" block in tokens.css`);
  let depth = 0;
  let i = tokensCss.indexOf('{', at);
  const open = i;
  for (; i < tokensCss.length; i++) {
    if (tokensCss[i] === '{') depth++;
    else if (tokensCss[i] === '}' && --depth === 0) break;
  }
  return tokensCss.slice(open + 1, i);
};
const varsOf = body => {
  const out = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
};
const rootVars = varsOf(blockOf(':root {'));
const dark = { ...rootVars, ...varsOf(blockOf(":root,\n[data-theme='dark'] {")) };
const light = { ...dark, ...varsOf(blockOf("[data-theme='light'] {")) };

/* ── index.css: the foil and galaxy gradients the landing and the buttons wear ── */
const indexCss = read('src/index.css');
const gradient = name => {
  const m = indexCss.match(new RegExp(`--${name}:\\s*(linear-gradient\\([\\s\\S]*?\\));`));
  if (!m) throw new Error(`brand/sync: no --${name} in index.css`);
  return m[1].replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
};
const GRADIENTS = { holo: gradient('holo-gradient'), holoBright: gradient('holo-gradient-bright'), galaxy: gradient('galaxy-gradient') };

/* ── nav.ts: each room's name, line, group and ink, parsed (nav.ts imports the icon set, so it is read, not run) ── */
const navTs = read('src/components/layout/nav.ts');
const NAV_INK = Object.fromEntries([...navTs.match(/NAV_INK = \{([\s\S]*?)\} as const/)[1].matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)].map(m => [m[1], m[2]]));
const itemsSrc = navTs.slice(navTs.indexOf('export const NAV_ITEMS'), navTs.indexOf('];', navTs.indexOf('export const NAV_ITEMS')));
const ROOMS = [...itemsSrc.matchAll(/\{([\s\S]*?)\n  \}/g)]
  .map(m => m[1])
  .map(body => {
    const field = k => (body.match(new RegExp(`${k}:\\s*'((?:[^'\\\\]|\\\\.)*)'`)) || [])[1];
    const ink = (body.match(/ink:\s*NAV_INK\.(\w+)/) || [])[1];
    return { path: field('path'), name: field('label'), code: field('code'), glyph: field('glyph') ?? null, ink: ink ? NAV_INK[ink] : null, line: field('description'), group: field('group') };
  })
  .filter(r => r.path && r.name);

/* ── billing.ts: the plans as the landing prices them ── */
const billingTs = read('src/data/billing.ts');
const PLANS = [...billingTs.matchAll(/\{ key: '(\w+)', name: '([^']+)', kicker: '([^']+)', price: '([^']+)', period: '([^']+)', monthly: (\d+|null) \}/g)].map(m => ({
  key: m[1],
  name: m[2],
  kicker: m[3],
  price: m[4],
  period: m[5],
  monthly: m[6] === 'null' ? null : Number(m[6]),
}));
const roomsOf = (billingTs.match(/\/\* Book (\$\d+) \(([^)]+)\), Tape (\$\d+) \(([^)]+)\), Desk (\$\d+) \(([^)]+)\)/) || []).slice(1).map(s => s.replace(/\s+/g, ' ').trim());

/* ── the landing's product pages: each product's two-tone head, its intro and its plan — the marketing voice ── */
const PRODUCT_PAGES = ['Pulse', 'Terrain', 'Trace', 'Dossier', 'Pinpoint', 'Compass', 'Weigher', 'Practice'].map(n => `src/pages/landing/products/${n === 'Practice' ? 'PracticePages' : `${n}Page`}.tsx`);
const plainJsx = s =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{' '\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const PRODUCTS = PRODUCT_PAGES.flatMap(file => {
  const src = read(file);
  const planConst = (src.match(/const PLAN = '([^']+)'/) || [])[1];
  return [...src.matchAll(/<ProductPage\s([\s\S]*?)\n  >/g)].map(([, props]) => {
    const str = k => (props.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] ?? null;
    const head = (props.match(/head=\{\['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\]\}/) || []).slice(1);
    const intro = (props.match(/intro=\{\s*<>([\s\S]*?)<\/>\s*\}/) || [])[1];
    const plan = str('plan') ?? (/plan=\{PLAN\}/.test(props) ? planConst : null);
    return { name: str('name'), glyph: str('glyph'), group: str('group'), head, intro: intro ? plainJsx(intro) : null, path: str('path'), plan };
  });
}).filter(p => p.name && p.head.length === 2);

/* ── the landing's own promises: what Slayer does and what it never does (Landing.tsx) — the compliance voice ── */
const landingTsx = read('src/pages/landing/Landing.tsx');
const listOf = name => {
  const m = landingTsx.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`brand/sync: no ${name} in Landing.tsx`);
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(x => x[1]);
};
const faqSrc = (landingTsx.match(/const FAQ[^=]*= \[([\s\S]*?)\n\];/) || [])[1] ?? '';
const FAQ = [...faqSrc.matchAll(/\{ q: '((?:[^'\\]|\\.)*)', a: '((?:[^'\\]|\\.)*)' \}/g)].map(m => ({ q: m[1], a: m[2] }));
const heroM = landingTsx.match(/data-landing-headline>\s*([^{<]+?)\{' '\}[\s\S]*?(?:holo-text|galaxy-text)[^>]*>([^<]+)<\/span>/);
const ledeM = landingTsx.match(/<p className="max-w-\[35rem\][^"]*">\s*([\s\S]*?)\s*<\/p>/);
const footerTsx = read('src/components/layout/SiteFooter.tsx');
const disclaimerM = footerTsx.match(/data-footer-lit>\s*(For informational[^<{]+?)\s*</);
if (!FAQ.length || !heroM || !ledeM || !disclaimerM) throw new Error('brand/sync: the landing’s FAQ, hero or the footer’s disclaimer moved');
const VOICE = {
  hero: { line: heroM[1].trim(), marked: heroM[2].trim(), lede: ledeM[1].replace(/\s+/g, ' ') },
  does: listOf('IT_DOES'),
  never: listOf('IT_NEVER'),
  faq: FAQ,
  disclaimer: disclaimerM[1].trim(),
};

const banner = src => `/* GENERATED by brand/sync.mjs from ${src} — do not edit; run \`npm run brand:sync\`. */\n`;
const files = {
  'source.mjs':
    banner('src/brand/paths.ts, src/brand/wordmarkPaths.ts, src/components/ui/glyphPaths.ts') +
    `export const MARK = ${JSON.stringify(MARK)};\nexport const MARK_CONTENT = ${JSON.stringify(MARK_CONTENT)};\nexport const WORDMARK = ${JSON.stringify(WORDMARK)};\nexport const GLYPH_DRAW = ${JSON.stringify(GLYPH_DRAW)};\n`,
  'tokens.mjs':
    banner('src/theme/tokens.css and src/index.css') +
    `export const TOKENS = ${JSON.stringify({ dark, light }, null, 1)};\nexport const GRADIENTS = ${JSON.stringify(GRADIENTS, null, 1)};\n`,
  'product.mjs':
    banner('src/components/layout/nav.ts, src/data/billing.ts and src/pages/landing/products/*') +
    `export const NAV_INK = ${JSON.stringify(NAV_INK, null, 1)};\nexport const ROOMS = ${JSON.stringify(ROOMS, null, 1)};\nexport const PLANS = ${JSON.stringify(PLANS, null, 1)};\nexport const PLAN_ROOMS = ${JSON.stringify(roomsOf)};\n/** The landing's product pages: the two-tone head (first line bright, second muted), the intro, the plan line. */\nexport const PRODUCTS = ${JSON.stringify(PRODUCTS, null, 1)};\n/** The landing's own words: the hero, "A read. Never an instruction." (does / never), the FAQ, the footer's disclaimer. */\nexport const VOICE = ${JSON.stringify(VOICE, null, 1)};\n`,
};

if (process.argv.includes('--check')) {
  const stale = Object.entries(files).filter(([f, body]) => !existsSync(resolve(OUT, f)) || readFileSync(resolve(OUT, f), 'utf8') !== body);
  if (stale.length) {
    console.error(`brand/sync: stale — ${stale.map(([f]) => f).join(', ')}. Run npm run brand:sync.`);
    process.exit(1);
  }
  console.log('brand/sync: generated/ matches the app.');
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(resolve(OUT, f), body);
  console.log(`brand/sync: ${ROOMS.length} rooms, ${PRODUCTS.length} product pages, ${PLANS.length} plans, ${Object.keys(GLYPH_DRAW).length} glyphs, ${Object.keys(dark).length} tokens → brand/lib/generated/`);
}
