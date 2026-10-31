/*
  SLAYER BRAND — THE LOGO PACKAGE (brand/templates/logos.mjs)

  Every logo file the spec names (§1), each from the same outlines (lib/draw.mjs). A logo entry is a vector master
  (`svg`, cropped tight to the artwork) and the rasters drawn from it (`png`, `webp`) with the clear space built in, so a
  raster dropped into a layout is never crowded. Naming: SLAYER_LOGO_<VARIANT>_<CONTEXT>_<COLOURWAY>_V01 — the
  convention's five slots with CONTEXT in the platform slot and the colourway in the format slot.

    DARK      full colour on the black ground (ground included)      ONDARK   full colour, transparent, for dark grounds
    LIGHT     full colour on paper (ground included)                 ONLIGHT  full colour, transparent, for light grounds
    WHITE     one colour, white, transparent                         BLACK    one colour, black, transparent
    MONO      one colour of the house: silver on black, galaxy-dark on paper (the S's own ink, flat)
*/
import { T } from '../lib/kit.mjs';
import { markSvg, wordmarkSvg, lockupSvg, markParts, wordmarkParts, lockupParts } from '../lib/draw.mjs';

const K = 0.6; /* the clear space built into every raster: this share of the artwork's height, on every side */

/** The artwork's aspect (w/h) for a kind — from the parts themselves, so a raster is never squeezed. */
const aspectOf = kind => {
  const p =
    kind === 'symbol'
      ? markParts({ prompt: true })
      : kind === 'compact'
        ? markParts({ prompt: false })
        : kind === 'wordmark'
          ? wordmarkParts({ cursor: false })
          : kind === 'primary'
            ? wordmarkParts({ cursor: true })
            : lockupParts({ kind });
  return p.box[2] / p.box[3];
};

/** The artwork, `h` px tall, in a colourway. */
const art = (kind, h, way, opts = {}) => {
  const theme = way === 'LIGHT' || way === 'ONLIGHT' ? 'paper' : 'dark';
  const solid = way === 'WHITE' ? '#FFFFFF' : way === 'BLACK' ? '#000000' : way === 'MONO' ? (opts.paper ? T.paper.foil[0] : T.dark.silver) : opts.solid ?? null;
  const doc = !!opts.doc;
  if (kind === 'symbol') return markSvg({ h, theme, prompt: true, solid, doc });
  if (kind === 'compact') return markSvg({ h, theme, prompt: false, solid, doc });
  if (kind === 'wordmark') return wordmarkSvg({ h, theme, solid, cursor: false, doc });
  if (kind === 'primary') return wordmarkSvg({ h, theme, solid, cursor: true, doc });
  return lockupSvg({ kind, h, theme, solid, doc });
};

const groundOf = way => (way === 'DARK' ? T.dark.ground : way === 'LIGHT' ? T.paper.ground : null);

/** A raster frame: the artwork centred on its ground (or on nothing), k × its height clear on every side. */
const frameHtml = (kind, way, W, H, opts = {}) => {
  const a = aspectOf(kind);
  const k = opts.k ?? K;
  const h = Math.min(W / (a + 2 * k), H / (1 + 2 * k));
  const ground = opts.ground !== undefined ? opts.ground : groundOf(way);
  return `<div style="width: ${W}px; height: ${H}px; display: flex; align-items: center; justify-content: center;${ground ? ` background: ${ground};` : ''}${opts.opacity != null ? ` opacity: ${opts.opacity};` : ''}">${art(kind, +h.toFixed(2), way, opts)}</div>`;
};

/** The tight vector master: the artwork alone, cropped to itself, with its ground behind it when it has one. */
const masterSvg = (kind, way, opts = {}) => {
  const h = 480;
  let svg = art(kind, h, way, { ...opts, doc: true });
  const ground = groundOf(way);
  if (ground) svg = svg.replace(/(<svg[^>]*>(?:<title>[^<]*<\/title>)?)/, `$1<rect x="-10000" y="-10000" width="20000" height="20000" fill="${ground}"></rect>`);
  return svg;
};

const entry = (o) => ({ category: 'LOGO', version: 1, types: ['svg', 'png', 'webp'], group: 'Logo package', ...o });

/** wide artworks render 2400 wide with their clear space; square ones on 1024 */
const sizeFor = kind => {
  const a = aspectOf(kind);
  if (a < 2) return { w: 1024, h: 1024 };
  const h = 2400 / (a + 2 * K);
  return { w: 2400, h: Math.round(h * (1 + 2 * K)) };
};

const KINDS = [
  ['primary', 'PRIMARY', 'Primary logo', 'The wordmark ending on its cursor. Headers, mail, print, the pages outside the terminal.'],
  ['horizontal', 'HORIZONTAL', 'Horizontal logo', 'The symbol beside the wordmark, for wide spaces: a site header, a deck, a banner.'],
  ['vertical', 'VERTICAL', 'Vertical logo', 'The symbol over the wordmark, for square and tall spaces: an end card, a cover, a sign.'],
  ['symbol', 'SYMBOL', 'Standalone symbol', '>S| — the mark alone, from 32 px tall.'],
  ['wordmark', 'WORDMARK', 'Standalone wordmark', '>slayer_terminal without the cursor, where the line already moves on (a footer).'],
  ['compact', 'COMPACT', 'Compact logo', 'S| — the symbol for small spaces, under 32 px tall and in tight corners.'],
];

const logos = [];
for (const [kind, V, title, use] of KINDS) {
  const { w, h } = sizeFor(kind);
  for (const way of ['DARK', 'LIGHT', 'ONDARK', 'ONLIGHT']) {
    logos.push(
      entry({
        id: `logo-${kind}-${way.toLowerCase()}`,
        campaign: V,
        platform: 'ALL',
        format: way,
        title,
        variant: { DARK: 'On black', LIGHT: 'On paper', ONDARK: 'Transparent, for dark grounds', ONLIGHT: 'Transparent, for light grounds' }[way],
        use,
        w,
        h,
        ground: groundOf(way),
        theme: way === 'LIGHT' || way === 'ONLIGHT' ? 'paper' : 'dark',
        svg: () => masterSvg(kind, way),
        html: () => frameHtml(kind, way, w, h),
      })
    );
  }
}

/* one-colour forms of the horizontal lockup and the symbol */
for (const [kind, V, title] of [
  ['horizontal', 'HORIZONTAL', 'Horizontal logo'],
  ['symbol', 'SYMBOL', 'Standalone symbol'],
  ['primary', 'PRIMARY', 'Primary logo'],
]) {
  const { w, h } = sizeFor(kind);
  for (const [way, variant, use] of [
    ['WHITE', 'White, one colour', 'Over photography and colour fields, single-ink print, foil, etching.'],
    ['BLACK', 'Black, one colour', 'Single-ink print on white: forms, fax, newsprint, a stamp.'],
    ['MONO', 'Monochrome', 'One ink of the house: the silver on black.'],
  ]) {
    logos.push(entry({ id: `logo-${kind}-${way.toLowerCase()}`, campaign: V, platform: 'ALL', format: way, title, variant, use, w, h, ground: null, theme: 'dark', svg: () => masterSvg(kind, way), html: () => frameHtml(kind, way, w, h) }));
  }
}

/* the contexts: each a use the spec names, drawn from the same artwork */
const ctx = [
  /* small resolution: the compact symbol, flat (a gradient muddies under 48 px), pixel sizes */
  ...[16, 24, 32, 48, 64].map(px =>
    entry({
      id: `logo-small-${px}`,
      campaign: 'SMALL',
      platform: 'ALL',
      format: `DARK${px}`,
      title: 'Small-resolution logo',
      variant: `${px} px, flat silver on black`,
      use: 'Where a logo is drawn at its pixel size: a list row, a tab, an embed.',
      w: px,
      h: px,
      types: ['png'],
      ground: T.dark.ground,
      theme: 'dark',
      html: () => `<div style="width: ${px}px; height: ${px}px; display: flex; align-items: center; justify-content: center; background: ${T.dark.ground}">${markSvg({ h: +(px * 0.66).toFixed(2), prompt: false, solid: T.dark.silver })}</div>`,
    })
  ),
  entry({
    id: 'logo-tiny-solid',
    campaign: 'TINY',
    platform: 'ALL',
    format: 'SOLID',
    title: 'Simplified symbol for tiny areas',
    variant: 'S|, one flat ink',
    use: 'Under 24 px, or wherever a gradient cannot be drawn: a status bar, a map pin, a partner’s icon row.',
    w: 512,
    h: 512,
    ground: null,
    theme: 'dark',
    svg: () => markSvg({ h: 480, prompt: false, solid: T.dark.silver, doc: true }),
    html: () => frameHtml('compact', 'MONO', 512, 512),
  }),
  entry({
    id: 'logo-appicon-ios',
    campaign: 'APPICON',
    platform: 'IOS',
    format: 'DARK',
    title: 'App icon',
    variant: '1024, the ground edge to edge',
    use: 'The ground fills the square; the platform rounds its own corners. Never a tile or a border drawn inside.',
    w: 1024,
    h: 1024,
    ground: T.dark.ground,
    theme: 'dark',
    svg: () => masterSvg('symbol', 'DARK'),
    html: () => frameHtml('symbol', 'DARK', 1024, 1024, { k: 0.45 }),
  }),
  entry({
    id: 'logo-appicon-maskable',
    campaign: 'APPICON',
    platform: 'ANDROID',
    format: 'MASKABLE',
    title: 'App icon, maskable',
    variant: '512, >S| inside the middle 80%',
    use: 'The web manifest’s maskable icon: any launcher may cut a circle, a squircle or a square from it.',
    w: 512,
    h: 512,
    types: ['png', 'webp'],
    ground: T.dark.ground,
    theme: 'dark',
    html: () => frameHtml('symbol', 'DARK', 512, 512, { k: 0.5 }),
  }),
  entry({
    id: 'logo-favicon',
    campaign: 'FAVICON',
    platform: 'WEB',
    format: 'ADAPTIVE',
    title: 'Browser favicon',
    variant: 'S|, silver on a dark tab strip and the galaxy ink on a light one',
    use: 'One SVG that reads the colour scheme; favicon.ico and a 32 px PNG for whatever cannot read SVG.',
    w: 32,
    h: 32,
    types: ['svg', 'png'],
    ground: null,
    theme: 'dark',
    svg: () => {
      const d = markParts({ theme: 'dark', prompt: false });
      const p = markParts({ theme: 'paper', prompt: false });
      const [x, y, w, h] = d.box;
      const side = Math.max(w, h) * 1.12;
      const vx = x + w / 2 - side / 2;
      const vy = y + h / 2 - side / 2;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(2)} ${vy.toFixed(2)} ${side.toFixed(2)} ${side.toFixed(2)}"><title>Slayer Terminal</title><style>.l{display:none}@media (prefers-color-scheme: light){.d{display:none}.l{display:inline}}</style><defs>${d.defs}${p.defs}</defs><g class="d">${d.body}</g><g class="l">${p.body}</g></svg>`;
    },
    html: () => `<div style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center">${markSvg({ h: 26, prompt: false })}</div>`,
  }),
  entry({
    id: 'logo-avatar',
    campaign: 'AVATAR',
    platform: 'SOCIAL',
    format: 'DARK',
    title: 'Social media avatar',
    variant: '1000 square, S| inside the circle crop',
    use: 'Every profile picture: the platform cuts the circle; the S| sits well inside it.',
    w: 1000,
    h: 1000,
    ground: T.dark.ground,
    theme: 'dark',
    html: () => `<div style="width: 1000px; height: 1000px; display: flex; align-items: center; justify-content: center; background: ${T.dark.ground}">${markSvg({ h: 520, prompt: false })}</div>`,
  }),
  entry({
    id: 'logo-watermark-image',
    campaign: 'WATERMARK',
    platform: 'IMAGE',
    format: 'WHITE',
    title: 'Watermark logo',
    variant: 'Horizontal, white at 30%',
    use: 'Bottom right of a still, its height a twentieth of the image’s; already faded, so place it at 100%.',
    w: 1200,
    h: 200,
    types: ['png', 'webp'],
    ground: null,
    theme: 'dark',
    html: () => frameHtml('horizontal', 'WHITE', 1200, 200, { opacity: 0.3, k: 0.25 }),
  }),
  entry({
    id: 'logo-watermark-video',
    campaign: 'WATERMARK',
    platform: 'VIDEO',
    format: 'WHITE',
    title: 'Video watermark',
    variant: 'S|, white at 55%',
    use: 'A video’s bottom-right corner, 4% of the frame’s height, inside the title-safe area.',
    w: 256,
    h: 256,
    types: ['png', 'webp'],
    ground: null,
    theme: 'dark',
    html: () => `<div style="width: 256px; height: 256px; display: flex; align-items: center; justify-content: center; opacity: 0.55">${markSvg({ h: 170, prompt: false, solid: '#FFFFFF' })}</div>`,
  }),
  ...['LIGHT', 'DARK'].map(way =>
    entry({
      id: `logo-email-header-${way.toLowerCase()}`,
      campaign: 'EMAILHEADER',
      platform: 'EMAIL',
      format: way,
      title: 'Email header logo',
      variant: `The wordmark, 2× for 160 px wide, ${way === 'LIGHT' ? 'for the light mail' : 'for the dark mail'}`,
      use: 'A PNG (mail strips SVG) with the alt text “Slayer Terminal”, 160 px wide in the header row.',
      w: 320,
      h: 34,
      types: ['png'],
      ground: null,
      theme: way === 'LIGHT' ? 'paper' : 'dark',
      html: () => `<div style="width: 320px; height: 34px; display: flex; align-items: center">${wordmarkSvg({ h: 33, theme: way === 'LIGHT' ? 'paper' : 'dark', cursor: true })}</div>`,
    })
  ),
  entry({
    id: 'logo-email-footer',
    campaign: 'EMAILFOOTER',
    platform: 'EMAIL',
    format: 'GREY',
    title: 'Email footer logo',
    variant: 'S|, flat grey, 2× for 24 px',
    use: 'The footer’s sign-off: quiet, one ink, reads on light and dark clients alike.',
    w: 48,
    h: 48,
    types: ['png'],
    ground: null,
    theme: 'dark',
    html: () => `<div style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center">${markSvg({ h: 34, prompt: false, solid: '#7D7D7D' })}</div>`,
  }),
  ...['DARK', 'LIGHT'].map(way =>
    entry({
      id: `logo-site-footer-${way.toLowerCase()}`,
      campaign: 'FOOTER',
      platform: 'WEB',
      format: way,
      title: 'Website footer logo',
      variant: `The wordmark without its cursor, ${way === 'DARK' ? 'on black' : 'on paper'}`,
      use: 'SiteFooter’s own: 14 px tall over the footer’s line.',
      w: 560,
      h: 120,
      ground: groundOf(way),
      theme: way === 'LIGHT' ? 'paper' : 'dark',
      svg: () => masterSvg('wordmark', way),
      html: () => frameHtml('wordmark', way, 560, 120),
    })
  ),
  entry({
    id: 'logo-merch',
    campaign: 'MERCH',
    platform: 'PRINT',
    format: 'WHITE',
    title: 'Merchandise logo',
    variant: 'Vertical lockup, white, one screen',
    use: 'Screen print on black stock: one white screen, no gradient, no halftone.',
    w: 1600,
    h: 1600,
    ground: null,
    theme: 'dark',
    svg: () => masterSvg('vertical', 'WHITE'),
    html: () => frameHtml('vertical', 'WHITE', 1600, 1600),
  }),
  entry({
    id: 'logo-embroidery',
    campaign: 'EMBROIDERY',
    platform: 'MERCH',
    format: 'TWOTHREAD',
    title: 'Embroidery-compatible logo',
    variant: '>S|, two threads: metallic silver and white',
    use: 'At least 50 mm wide: the prompt and the S in metallic silver thread, the cursor in white. No wordmark under 90 mm.',
    w: 1024,
    h: 1024,
    ground: T.dark.ground,
    theme: 'dark',
    svg: () => {
      const p = markParts({ prompt: true, solid: '#C7D3E8' });
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.box.join(' ')}"><title>Slayer Terminal — embroidery: metallic silver thread, cursor white</title>${p.body.replace(/<rect([^>]*)fill="#C7D3E8"/, '<rect$1fill="#FFFFFF"')}</svg>`;
    },
    html: () => {
      const p = markParts({ prompt: true, solid: '#C7D3E8' });
      const body = p.body.replace(/<rect([^>]*)fill="#C7D3E8"/, '<rect$1fill="#FFFFFF"');
      return `<div style="width: 1024px; height: 1024px; display: flex; align-items: center; justify-content: center; background: ${T.dark.ground}"><svg width="${(600 * p.box[2]) / p.box[3]}" height="600" viewBox="${p.box.join(' ')}" aria-hidden="true" style="display: block">${body}</svg></div>`;
    },
  }),
  ...[
    ['BLACK', 'One colour, black', 'Any single-ink print on white.'],
    ['SPOT2', 'Two spot colours: metallic silver and black', 'The S in metallic silver ink (proof against Pantone 877 C), everything else black. On black stock, the silver and white.'],
  ].map(([way, variant, use]) =>
    entry({
      id: `logo-print-${way.toLowerCase()}`,
      campaign: 'PRINT',
      platform: 'PRINT',
      format: way,
      title: 'Print-compatible logo',
      variant,
      use,
      w: 2400,
      h: sizeFor('horizontal').h,
      ground: null,
      theme: 'paper',
      svg: () => {
        if (way === 'BLACK') return masterSvg('horizontal', 'BLACK');
        const p = lockupParts({ kind: 'horizontal', solid: '#000000' });
        /* the S is the lockup's second path: give it the silver */
        /* the S (its outline starts M34.37 43.49) takes the metallic silver's screen stand-in; on press, Pantone 877 C */
        const body = p.body.replace(/(<path d="M34\.37 43\.49[^"]*") fill="#000000"/, '$1 fill="#8A8D8F"');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.box.map(v => +v.toFixed(2)).join(' ')}"><title>Slayer Terminal — print: S in metallic silver (Pantone 877 C), the rest black</title>${body}</svg>`;
      },
      html: () => frameHtml('horizontal', way === 'BLACK' ? 'BLACK' : 'ONLIGHT', 2400, sizeFor('horizontal').h, { ground: '#FFFFFF' }),
    })
  ),
];

export default [...logos, ...ctx];
