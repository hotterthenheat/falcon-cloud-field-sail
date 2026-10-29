import type { Config } from 'tailwindcss';

/* EVERY COLOUR IS A TOKEN (2026-09-12): the values live in src/theme/tokens.css
   as RGB channels under `:root` (dark) and `[data-theme='light']`; this config
   only names them. `<alpha-value>` keeps every modifier working (`bg-panel/70`,
   `border-borderSubtle/60`). A theme change touches tokens.css, never this
   file — Tailwind's config is not hot, tokens are. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        xs: '1px',
      },
      colors: {
        // Surfaces
        canvas: token('canvas'),
        panel: token('panel'),
        panelHover: token('panel-hover'),
        inset: token('inset'),
        inputBg: token('input-bg'),
        // The chip's ground (#0c0c0c on dark) and the card's (#121212) — the two
        // shades the pages used to write by hand
        chip: token('chip'),
        card: token('card'),

        // Borders
        borderSubtle: token('border-subtle'),
        borderMuted: token('border-muted'),
        borderFocus: token('border-focus'),

        // Text — tiers must clear WCAG on the dark canvas (muted was 2.06:1, illegible)
        textPrimary: token('text-primary'),
        textSecondary: token('text-secondary'),
        // Lifted #6b6b6b → #7d7d7d (2026-07-25): at the 9-10px label sizes this
        // token actually lives at, 6b6b6b was ~3.98:1 on canvas — below AA, and
        // Noah was squinting. 7d7d7d reads ~5.2:1 and stays clearly quieter
        // than textSecondary, so labels still whisper; they just stop mumbling.
        textMuted: token('text-muted'),
        // grey on the dark terminal, the page's black on paper (tokens.css, the light sweep 2026-09-19)
        tabRest: token('tab-rest'),
        textFigure: token('text-figure'),

        // THE INK a wash is made of — white on dark, near-black on light. Every
        // `bg-white/[0.06]` hover wash became `bg-ink/[0.06]` (2026-09-12).
        ink: token('ink'),
        night: token('night'),

        // Directional / status accents (always paired with a label or icon).
        // THE SPLIT (2026-07-20): green = the MARKET talking (bullish, calls,
        // beats, up-moves). The accent = the TERMINAL talking about itself
        // (selection, navigation, brand, what is live). One color, one
        // meaning. The accent was a neon lime until 2026-10-13 (the partner's
        // rule, at Noah's word: "remove all lime/green accent color it should
        // be holographic silver"); it is the holo family's flat silver now, so
        // no green on the desk is ever the terminal's own voice.
        // Green went mint #CFFFB1 → #30D158 on 2026-07-24: a true green reads
        // as green. The live chart keeps the old mint on purpose — see
        // CHART_MINT in components/gex/palette.ts.
        bull: token('bull'),
        bear: token('bear'),
        // True orange — caution reads clearly apart from green and hot red
        warn: token('warn'),
        // Interface accent — the silver (the same channels as `silver`), ~13:1
        // on canvas, the deep steel on paper. Interface only, never data.
        select: token('select'),
        // THE ACCENTS AS SURFACES (2026-09-12): a silver FILL with the dark word
        // on it is the same on either ground (a highlighter, the holo flat
        // form); only the accent as an INK is cut per theme (select, silver).
        selectFill: token('select-fill'),
        silverFill: token('silver-fill'),

        // GEX structural levels
        // Flip = INDECISION GRAY (Noah, 2026-08-29): "when something is
        // flipping it's on the verge of two sides — indecisive — vague/
        // neutral/gray." The regime border wears the color of neither side.
        flip: token('flip'),
        // Moon = the EVENING ink: after-close / overnight (the Earnings
        // "after close" markers, the Weigher's session read). A SOFT PURPLE
        // (Noah, 2026-08-30: "make the overnight color a soft purple").
        moon: token('moon'),
        // Supreme = MAGENTA (Noah, 2026-08-29): the engine's-standout family —
        // TOP PICK, supreme, NET, the whale.
        supreme: token('supreme'),
        /* the legs' and the walls' inks (call side glacier, put side ember) — never the sign's green and red (2026-10-23) */
        glacier: token('glacier'),
        ember: token('ember'),
        darkpool: token('darkpool'),

        // Legacy aliases (pre-redesign pages)
        primary: token('text-primary'),
        secondary: token('text-secondary'),
        silver: token('silver'),
        // positive gamma is the call side's green (paletteInk LONG_GAMMA) — it
        // borrowed the lime accent until 2026-10-13, and the accent is not data
        gammaPos: token('bull'),
        gammaNeg: token('bear'),
        warning: token('warn'),
        gridHead: token('grid-head'),
        onfoil: '#0a0a0a',
        goldline: '#F5C542',
        steelline: '#AAB6C6',
        lilacline: '#BBB2E8',
        paper: '#f2f2f2',
        paleline: '#E2EAF4',
        hotprint: '#FF5EA8',
        iceprint: '#3DD6E8',
      },
      fontSize: {
        'xxs': '0.7rem',
        'xxxs': '0.6rem',
        /* Named steps so a room does not invent text-[10px] for chrome. */
        meta: ['10px', { lineHeight: '14px', letterSpacing: '0.08em' }],
        fine: ['11px', { lineHeight: '15px' }],
        ui: ['12.5px', { lineHeight: '16px' }],
        body: ['13px', { lineHeight: '18px' }],
        /* Exact steps. A string, not a tuple, so line-height stays what it was. */
        t7: '7px',
        t75: '7.5px',
        t8: '8px',
        t85: '8.5px',
        t9: '9px',
        t95: '9.5px',
        t10: '10px',
        t105: '10.5px',
        t11: '11px',
        t115: '11.5px',
        t12: '12px',
        t125: '12.5px',
        t13: '13px',
        t135: '13.5px',
        t14: '14px',
        t145: '14.5px',
        t15: '15px',
        t155: '15.5px',
        t16: '16px',
        t17: '17px',
        t18: '18px',
        t19: '19px',
        t20: '20px',
        t21: '21px',
        t22: '22px',
        t23: '23px',
        t24: '24px',
        t26: '26px',
        t28: '28px',
        t30: '30px',
        t32: '32px',
        t38: '38px',
        t40: '40px',
        t44: '44px',
        t46: '46px',
        t50: '50px',
        t52: '52px',
        t54: '54px',
        t56: '56px',
        t64: '64px',
        t72: '72px',
        displaySm: 'clamp(2.7rem, 6.3vw, 5.7rem)',
        displayLg: 'clamp(2.75rem, 7.4vw, 7rem)',
        prompt: 'clamp(1.05rem, 2.6vw, 1.6rem)',
      },
      fontFamily: {
        // One family site-wide (2026-08-16). `mono` is kept as a token — it
        // marks the data/instrument voice (tabular figures via index.css),
        // not a different typeface.
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      }
    },
  },
  plugins: [],
} satisfies Config;
