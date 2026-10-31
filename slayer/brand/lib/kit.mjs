/*
  SLAYER BRAND — THE KIT (brand/lib/kit.mjs)

  The two grounds as plain hex, read from the terminal's own tokens (generated/tokens.mjs, from src/theme/tokens.css),
  the type stacks, and the asset-naming convention. Isomorphic: no Node APIs, so the studio runs it in a browser.
*/
import { TOKENS, GRADIENTS } from './generated/tokens.mjs';

const channels = v => String(v).trim().split(/\s+/).map(Number);
export const hexOf = v => `#${channels(v).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export const rgba = (v, a) => `rgba(${channels(v).join(', ')}, ${a})`;

const themeOf = (t, name) => {
  const h = k => hexOf(t[k]);
  return {
    name,
    /* grounds */
    ground: h('canvas'),
    panel: h('panel'),
    panelHover: h('panel-hover'),
    inset: h('inset'),
    chip: h('chip'),
    card: h('card'),
    /* hairlines */
    hair: h('border-subtle'),
    hair2: h('border-muted'),
    focus: h('border-focus'),
    /* text tiers */
    t1: h('text-primary'),
    t2: h('text-secondary'),
    t3: h('text-muted'),
    /* the wash ink: white on black, near-black on paper */
    inkA: a => rgba(t.ink, a),
    /* direction and status — data inks, never brand */
    bull: h('bull'),
    bear: h('bear'),
    warn: h('warn'),
    /* the accent: the holo silver (where you are, and live) */
    silver: h('silver'),
    silverFill: h('silver-fill'),
    select: h('select'),
    liveBg: t['live-bg'],
    liveInk: t['live-ink'],
    liveEdge: t['live-edge'],
    /* market-structure inks */
    supreme: h('supreme'),
    flip: h('flip'),
    darkpool: h('darkpool'),
    moon: h('moon'),
    ember: h('ember'),
    glacier: h('glacier'),
    thermalWarm: h('thermal-warm'),
    thermalCool: h('thermal-cool'),
    /* the news beats: a muted categorical set */
    cat: Object.fromEntries(['earnings', 'guidance', 'analyst', 'macro', 'ma', 'product', 'regulatory'].map(k => [k, h(`cat-${k}`)])),
    /* the mark: its tile (retired outside the terminal), prompt, cursor and the five foil stops */
    tile: h('tile'),
    tileEdge: h('tile-edge'),
    bracket: h('bracket'),
    prompt: h('chevron'),
    lit: h('wordmark'),
    foil: [1, 2, 3, 4, 5].map(i => h(`foil-${i}`)),
    glyph: [1, 2, 3, 4, 5].map(i => h(`glyph-${i}`)),
    /* the landing's theme turn: night → dawn 1–5 → day */
    dawn: [1, 2, 3, 4, 5].map(i => h(`dawn-${i}`)),
  };
};

/** The house's two grounds: dark (the terminal's own) and paper (the light theme). */
export const T = { dark: themeOf(TOKENS.dark, 'dark'), paper: themeOf(TOKENS.light, 'paper') };
/** The raw token maps, for the colour pages. */
export { TOKENS };
/** The foil (holo) on black, its bright cut for filled pills, and the galaxy ink that replaces it on paper. */
export const GRAD = GRADIENTS;

/* ── type ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Inter for every word (public/fonts/InterVariable.woff2, SIL OFL); the system faces only as fallback. */
export const SANS = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
/** The data voice is Inter too, with tabular figures (index.css .font-mono). */
export const DATA = `font-family: ${SANS}; font-variant-numeric: tabular-nums`;
/** A real monospace only for code samples in documentation. */
export const CODE = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
/** The @font-face for Inter, from wherever the caller serves the file. */
export const interFace = url =>
  `@font-face{font-family:'Inter';src:url('${url}') format('woff2');font-weight:100 900;font-style:normal;font-display:block}`;
/** The landing's headline voice: Inter Light, tight. */
export const HEADLINE = 'font-weight: 300; letter-spacing: -0.045em; line-height: 0.98';

/* ── the naming convention ────────────────────────────────────────────────────────────────────────────────── */

const SLOT = s =>
  String(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 24);

/**
 * SLAYER_CATEGORY_CAMPAIGN_PLATFORM_FORMAT_VERSION — e.g. SLAYER_EVENT_FOMC_X_BANNER_V01.
 * Every slot is upper case, letters and digits only; the version is two digits.
 */
export const assetName = ({ category, campaign, platform, format, version = 1 }) =>
  ['SLAYER', SLOT(category), SLOT(campaign), SLOT(platform), SLOT(format), `V${String(version).padStart(2, '0')}`].join('_');

/** Asset categories — the library's top-level folders (spec §14). */
export const CATEGORIES = [
  'IDENTITY',
  'LOGO',
  'SOCIAL',
  'EMAIL',
  'HOLIDAY',
  'EVENT',
  'TRADING',
  'PRODUCT',
  'INDICATOR',
  'AD',
  'PROMO',
  'WEB',
  'VIDEO',
  'PRESS',
  'MERCH',
  'CX',
];
