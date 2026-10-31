# Slayer brand system

The production side of the Slayer Terminal brand: every logo file, and in time every social, mail, event, holiday,
product, ad, press and merchandise asset, drawn from **the terminal's own sources** and exported under one naming
convention with one record per file.

It reads the app and never writes to it. Nothing here changes the terminal: no file under `src/` is touched, and the
terminal keeps its own mark (the tile and corner brackets from 64 px are the terminal's chrome). Outside the terminal
the mark always stands free — never on a tile, in a badge, a circle or a frame.

## Commands

Run from `slayer/`.

| Command | What it does |
| --- | --- |
| `npm run brand:sync` | Reads the terminal (outlines, tokens, rooms, plans, product heads, the landing's own words) into `lib/generated/`. |
| `npm run brand:check` | Fails if `lib/generated/` no longer matches the app — run it after any change to the brand's sources. |
| `npm run brand:build` | Renders every template family to `exports/<category>/` and records each asset in `manifest.json`. |
| `npm run brand:build -- logos --only=symbol` | One family, only the entries whose id contains `symbol`. |

`brand:build` uses the app's Playwright and launches Chrome when it is installed, otherwise Playwright's Chromium.
`PW_CHROMIUM=/path/to/chrome` names another browser; `PLAYWRIGHT_MODULE` another Playwright. The output is
deterministic: the same sources give byte-identical files.

## What lives where

```
brand/
  sync.mjs              reads the terminal → lib/generated/ (never edit generated/ by hand)
  build.mjs             the exporter: SVG masters, PNG and WebP rasters, ICO, manifest.json
  lib/kit.mjs           the two grounds as hex, the type stacks, the naming rule, the categories
  lib/draw.mjs          the mark, wordmark, lockups, page glyphs and signature, as SVG/HTML strings
  lib/generated/        source.mjs (outlines) · tokens.mjs (colours, foil, galaxy) · product.mjs (rooms, plans, heads, voice)
  templates/logos.mjs   the logo package: 54 entries — every logo form the spec names
  exports/logo/         the logo files, named by the convention
  manifest.json         one record per asset
```

`lib/` is isomorphic (no Node APIs), so the same templates run in the exporter and, later, in a browser-based
campaign generator.

| Source in the app | Becomes |
| --- | --- |
| `src/brand/paths.ts`, `src/brand/wordmarkPaths.ts` | The mark's and the wordmark's traced outlines |
| `src/components/ui/glyphPaths.ts` | The thirteen product glyphs |
| `src/theme/tokens.css`, `src/index.css` | Every colour on both grounds; the foil, its bright cut, the galaxy ink |
| `src/components/layout/nav.ts` | Room names, groups, lines and desk inks |
| `src/data/billing.ts` | Plans and prices |
| `src/pages/landing/products/*` | Each product's two-tone head, intro and plan line |
| `src/pages/landing/Landing.tsx`, `SiteFooter.tsx` | The hero, "It does / It never", the FAQ, the disclaimer |

## Names

`SLAYER_CATEGORY_CAMPAIGN_PLATFORM_FORMAT_VERSION`, for example `SLAYER_EVENT_FOMC_X_BANNER_V01`.

- Every slot is upper case, letters and digits only, at most 24 characters; the version is always two digits.
- The exporter writes the name from the template's own fields — nobody types one.
- A changed file is a new version (`_V02`), never a new word: no `final`, `final-final`, `new` or `v2-fixed`.
- Categories: IDENTITY, LOGO, SOCIAL, EMAIL, HOLIDAY, EVENT, TRADING, PRODUCT, INDICATOR, AD, PROMO, WEB, VIDEO, PRESS,
  MERCH, CX.

## The manifest

Each record holds the asset's name, title, variant, intended use, category, campaign, platform, format, version,
dimensions, file types and paths, ground, source template (`brand/templates/<family>.mjs#<id>`), created and updated
dates, campaign association, expiry date and approval (`status`, `by`, `at`).

Approval runs **draft → internal review → approved → published → retired**. Every new asset starts in internal review.
A financial promotion is never published without an approval on record. Anything with a date (an FOMC decision, a
market holiday, an earnings week) carries an `expires` date and is checked against its official source, in the viewer's
own time zone, before it leaves review.

## Adding a template family

1. Write `templates/<family>.mjs`: a default export of entries `{ id, category, campaign, platform, format, version,
   types, title, variant, use, w, h, ground, theme, svg(ctx)?, html(ctx) }`. Draw only with `lib/draw.mjs` and the
   tokens in `lib/kit.mjs`; `ctx.asset('landing/…')` resolves a file under `public/`.
2. Add it to `FAMILIES` in `build.mjs`.
3. `npm run brand:build -- <family>`, then look at every file before committing.

## Rules the templates keep

- The outlines are never redrawn, stretched, outlined, rotated, recoloured or given a glow or a shadow.
- The foil lives in the S, in "terminal" in the wordmark, in the signature's dot, in the landing's marked word and its
  solid doors — never as a wash, a border or a background. On paper the galaxy ink takes its place.
- Inter for every word, tabular figures for every number, nothing under 12 px outside the terminal.
- Green, red and orange are data inks, never decoration, and never on the mark.
- Every picture is the terminal itself, never a mock-up; practice accounts and sample data only.
- No promise of profit, no performance claim, no invented testimonial or user count, no implied affiliation with an
  exchange, a regulator or the Federal Reserve, no official seal. The fine print stays word for word:
  "For informational purposes only. Not investment advice."

The brand canvas (a Claude Design artifact) draws its boards with this same library.
