import type { CSSProperties } from 'react';

/* Heat ramps for the matrix and ladders: signed, diverging, a quiet zero; ink chosen by measured contrast. HEAT_MODE is the terminal default. */
export type HeatMode =
  | 'ember-glacier'
  | 'thermal-yellow'
  | 'steel-gold'
  | 'ice-plasma'
  | 'terminal'
  | 'pastel'
  | 'spectrum'
  | 'amber'
  | 'redwood'
  | 'thermal'
  | 'teal-violet'
  | 'gold-slate'
  | 'hybrid'
  | 'mono'
  | 'diverging';

// `as HeatMode` stops TS from narrowing to the literal so the other branches stay legal.
export const HEAT_MODE = 'ember-glacier' as HeatMode;

type RGB = [number, number, number];
type Stops = [number, RGB][];

const NEUTRAL: RGB = [42, 42, 42]; // dark gray — sits calmly on the panel surface

interface RampPalette {
  pos: Stops;
  neg: Stops;
  gradient: string;
  /** The magnitude curve this ramp reads best on — HEAT_GAMMA unless it says otherwise */
  gamma?: number;
}

// Ramps run from neutral (t=0) → extreme (t=1)
const RAMPS: Record<
  'ember-glacier' | 'thermal-yellow' | 'steel-gold' | 'ice-plasma' | 'terminal' | 'pastel' | 'spectrum' | 'amber' | 'redwood' | 'thermal' | 'teal-violet' | 'gold-slate',
  RampPalette
> = {
  /* Thermal: Observable Plot's BuYlRd (pale yellow balanced, orange to deep red amplifying), read on a square-root curve
     (at the house 0.4 the surface saturated). Chosen per surface (HeatPill `mode`), never terminal-wide. */
  'thermal-yellow': {
    // positive = put-dominant = dealers short gamma = AMPLIFY (warm)
    pos: [
      [0, [255, 255, 191]], //   #FFFFBF
      [0.2, [254, 224, 144]], // #FEE090
      [0.4, [253, 174, 97]], //  #FDAE61
      [0.6, [244, 109, 67]], //  #F46D43
      [0.8, [215, 48, 39]], //   #D73027
      [1, [165, 0, 38]], //      #A50026
    ],
    /* Absorb is green, as everywhere else: the cool half is ColorBrewer RdYlGn's green side, with the same yellow middle. */
    // negative = call-dominant = dealers long gamma = ABSORB (green)
    neg: [
      [0, [255, 255, 191]], //   #FFFFBF
      [0.2, [217, 239, 139]], // #D9EF8B
      [0.4, [166, 217, 106]], // #A6D96A
      [0.6, [102, 189, 99]], //  #66BD63
      [0.8, [26, 152, 80]], //   #1A9850
      [1, [0, 104, 55]], //      #006837
    ],
    gradient:
      'linear-gradient(to bottom, #A50026 0%, #D73027 10%, #F46D43 20%, #FDAE61 30%, #FEE090 40%, #FFFFBF 50%, #D9EF8B 60%, #A6D96A 70%, #66BD63 80%, #1A9850 90%, #006837 100%)',
    gamma: 0.5,
  },
  /* The house heat: a dark zero, each side travelling hues — amplify through ember (oxblood → gold), absorb through glacier (navy → ice).
     Arc-length-even stops in OKLab (scripts/ramp-ember-glacier.mjs regenerates them). */
  'ember-glacier': {
    /* Curve 0.6, not the house 0.4: at 0.4 a cell at a tenth of the heaviest was already deep red or navy. */
    gamma: 0.6,
    // positive = put-dominant = dealers short gamma = AMPLIFY (ember)
    pos: [
      [0, [42, 42, 42]], //     #2A2A2A
      [0.125, [82, 29, 25]], // #521D19
      [0.25, [117, 29, 20]], // #751D14
      [0.375, [154, 39, 21]], // #9A2715
      [0.5, [184, 65, 25]], // #B84119
      [0.625, [212, 94, 29]], // #D45E1D
      [0.75, [230, 127, 39]], // #E67F27
      [0.875, [239, 163, 52]], // #EFA334
      [1, [245, 197, 66]], //   #F5C542 honey gold
    ],
    // negative = call-dominant = dealers long gamma = ABSORB (glacier)
    neg: [
      [0, [42, 42, 42]], //     #2A2A2A
      [0.125, [23, 56, 86]], // #173856
      [0.25, [23, 81, 119]], // #175177
      [0.375, [25, 108, 149]], // #196C95
      [0.5, [37, 137, 174]], // #2589AE
      [0.625, [68, 165, 197]], // #44A5C5
      [0.75, [122, 189, 215]], // #7ABDD7
      [0.875, [169, 213, 231]], // #A9D5E7
      [1, [214, 237, 248]], //  #D6EDF8 ice
    ],
    // top of the bar is +maxAbs, so ember leads
    gradient:
      'linear-gradient(to bottom, #F5C542 0%, #EFA334 6%, #E67F27 13%, #D45E1D 19%, #B84119 25%, #9A2715 31%, #751D14 38%, #521D19 44%, #2A2A2A 50%, #173856 56%, #175177 63%, #196C95 69%, #2589AE 75%, #44A5C5 81%, #7ABDD7 88%, #A9D5E7 94%, #D6EDF8 100%)',
  },
  /* Steel-gold: absorb climbs achromatic steel, amplify climbs gold, so the sides separate for every vision type
     (pole luminance platinum 0.82 vs gold 0.60). Arc-length-even OKLab stops. */
  'steel-gold': {
    // positive = put-dominant = dealers short gamma = AMPLIFY (gold)
    pos: [
      [0, [42, 42, 42]], //     #2A2A2A
      [0.125, [66, 53, 20]], // #423514
      [0.25, [89, 72, 23]], //  #594817
      [0.375, [114, 91, 26]], // #725B1A
      [0.5, [139, 110, 28]], // #8B6E1C
      [0.625, [165, 131, 31]], // #A5831F
      [0.75, [191, 152, 37]], // #BF9825
      [0.875, [218, 174, 51]], // #DAAE33
      [1, [245, 197, 66]], //   #F5C542 honey gold
    ],
    // negative = call-dominant = dealers long gamma = ABSORB (steel)
    neg: [
      [0, [42, 42, 42]], //     #2A2A2A
      [0.125, [56, 63, 73]], // #383F49
      [0.25, [75, 85, 98]], //  #4B5562
      [0.375, [97, 108, 123]], // #616C7B
      [0.5, [120, 132, 148]], // #788494
      [0.625, [145, 157, 173]], // #919DAD
      [0.75, [170, 182, 198]], // #AAB6C6
      [0.875, [198, 208, 221]], // #C6D0DD
      [1, [226, 234, 244]], //  #E2EAF4 platinum
    ],
    // top of the bar is +maxAbs, so gold leads
    gradient:
      'linear-gradient(to bottom, #F5C542 0%, #DAAE33 6%, #BF9825 13%, #A5831F 19%, #8B6E1C 25%, #725B1A 31%, #594817 38%, #423514 44%, #2A2A2A 50%, #383F49 56%, #4B5562 63%, #616C7B 69%, #788494 75%, #919DAD 81%, #AAB6C6 88%, #C6D0DD 94%, #E2EAF4 100%)',
  },
  /* Ice-plasma: sign is dealer gamma (call-dominant = dealers long = absorb). netGex codes calls negative, so neg = ice, pos = plasma.
     Pole luminance offset (ice 0.55 vs plasma 0.32) separates the sides where hue cannot; arc-length-even OKLab stops. */
  'ice-plasma': {
    // positive = put-dominant = dealers short gamma = AMPLIFY (plasma)
    pos: [
      [0, [42, 42, 42]], //     #2A2A2A
      [0.125, [65, 28, 44]], // #411C2C
      [0.25, [91, 31, 61]], //  #5B1F3D
      [0.375, [118, 36, 78]], // #76244E
      [0.5, [146, 43, 94]], //  #922B5E
      [0.625, [174, 51, 111]], // #AE336F
      [0.75, [201, 63, 129]], // #C93F81
      [0.875, [228, 78, 149]], // #E44E95
      [1, [255, 94, 168]], //   #FF5EA8 plasma
    ],
    // negative = call-dominant = dealers long gamma = ABSORB (ice)
    neg: [
      [0, [42, 42, 42]], //     #2A2A2A
      [0.125, [22, 58, 71]], // #163A47
      [0.25, [21, 78, 94]], //  #154E5E
      [0.375, [21, 99, 117]], // #156375
      [0.5, [24, 121, 140]], // #18798C
      [0.625, [27, 143, 163]], // #1B8FA3
      [0.75, [38, 166, 186]], // #26A6BA
      [0.875, [49, 190, 209]], // #31BED1
      [1, [61, 214, 232]], //   #3DD6E8 ice
    ],
    // top of the bar is +maxAbs, so plasma leads
    gradient:
      'linear-gradient(to bottom, #FF5EA8 0%, #E44E95 6%, #C93F81 13%, #AE336F 19%, #922B5E 25%, #76244E 31%, #5B1F3D 38%, #411C2C 44%, #2A2A2A 50%, #163A47 56%, #154E5E 63%, #156375 69%, #18798C 75%, #1B8FA3 81%, #26A6BA 88%, #31BED1 94%, #3DD6E8 100%)',
  },
  // Terminal red/green: one hue per side walking luminance only, poles the real bull/bear tokens.
  // netGex is option-side coded (calls negative), so green belongs on `neg`: the call wall prints negative, the put wall positive.
  terminal: {
    // positive = put-dominant
    pos: [
      [0, [42, 42, 42]], //      #2A2A2A
      [0.125, [50, 38, 38]], //  #322626
      [0.25, [62, 34, 33]], //   #3E2221
      [0.375, [75, 28, 26]], //  #4B1C1A
      [0.5, [96, 22, 18]], //    #601612 oxblood
      [0.625, [139, 28, 22]], // #8B1C16
      [0.75, [181, 36, 29]], //  #B5241D brick
      [0.875, [218, 48, 38]], // #DA3026
      [1, [255, 59, 48]], //     #FF3B30 bear
    ],
    // negative = call-dominant
    neg: [
      [0, [42, 42, 42]], //      #2A2A2A
      [0.125, [37, 51, 42]], //  #25332A
      [0.25, [30, 64, 42]], //   #1E402A
      [0.375, [20, 84, 43]], //  #14542B deep pine
      [0.5, [25, 106, 50]], //   #196A32
      [0.625, [29, 128, 58]], // #1D803A
      [0.75, [35, 152, 67]], //  #239843 signal green
      [0.875, [41, 178, 76]], // #29B24C
      [1, [48, 209, 88]], //     #30D158 bull
    ],
    // top of the bar is +maxAbs, so red leads
    gradient:
      'linear-gradient(to bottom, #FF3B30 0%, #DA3026 6%, #B5241D 13%, #8B1C16 19%, #601612 25%, #4B1C1A 31%, #3E2221 38%, #322626 44%, #2A2A2A 50%, #25332A 56%, #1E402A 63%, #14542B 69%, #196A32 75%, #1D803A 81%, #239843 88%, #29B24C 94%, #30D158 100%)',
  },
  // Requested pastel scheme — cool blues (+, stabilizing) ↔ warm lavender/cream
  // (−, accelerating). Softer than the punchy schemes; neutral stays dark so
  // near-zero cells recede into the panel.
  pastel: {
    pos: [
      [0.0, NEUTRAL],
      [0.5, [175, 212, 216]], // #AFD4D8 powder blue
      [1.0, [151, 136, 196]], // #9788C4 periwinkle
    ],
    neg: [
      [0.0, NEUTRAL],
      [0.5, [188, 169, 209]], // #BCA9D1 lavender
      [1.0, [239, 232, 224]], // #EFE8E0 cream
    ],
    gradient:
      'linear-gradient(to bottom, #9788C4 0%, #AFD4D8 32%, #2a2a2a 50%, #BCA9D1 68%, #EFE8E0 100%)',
  },
  // Periwinkle → blue → cyan (+) ↔ pale pink → plum (−), gray neutral
  spectrum: {
    pos: [
      [0.0, NEUTRAL],
      [0.4, [137, 161, 239]], // #89A1EF periwinkle
      [0.7, [0, 165, 224]], //   #00A5E0 fresh sky
      [1.0, [50, 203, 255]], //  #32CBFF sky aqua
    ],
    neg: [
      [0.0, NEUTRAL],
      [0.4, [254, 206, 241]], // #FECEF1 petal frost
      [1.0, [239, 156, 218]], // #EF9CDA plum
    ],
    gradient:
      'linear-gradient(to bottom, #32CBFF 0%, #00A5E0 18%, #89A1EF 38%, #2a2a2a 50%, #FECEF1 72%, #EF9CDA 100%)',
  },
  // Cool blue (+) ↔ bright amber/gold (−). High-contrast on dark; uses the
  // requested FFD000/FFB700 yellows for the strongly-visible negative pole.
  amber: {
    pos: [
      [0.0, NEUTRAL],
      [0.4, [46, 92, 132]],
      [0.72, [74, 150, 208]],
      [1.0, [122, 196, 240]],
    ],
    neg: [
      [0.0, NEUTRAL],
      [0.4, [150, 110, 24]],
      [0.72, [255, 208, 0]], //  #FFD000 jonquil
      [1.0, [255, 183, 0]], //   #FFB700 selective yellow
    ],
    gradient:
      'linear-gradient(to bottom, #7AC4F0 0%, #4A96D0 20%, #2E5C84 38%, #2A2929 50%, #966E18 62%, #FFD000 82%, #FFB700 100%)',
  },
  // Cool Blue / Light Grayish (+) ↔ Redwood / Burnt Umber (−), gray neutral
  redwood: {
    pos: [
      [0.0, NEUTRAL],
      [0.42, [17, 48, 71]], //  #113047 cool blue
      [0.72, [115, 154, 185]], // #739ab9 light grayish blue
      [1.0, [168, 197, 218]], //  brighter steel
    ],
    neg: [
      [0.0, NEUTRAL],
      [0.42, [109, 18, 11]], //  #6d120b burnt umber
      [0.72, [176, 42, 41]], //  #b02a29 redwood
      [1.0, [214, 82, 76]], //   brighter red
    ],
    gradient:
      'linear-gradient(to bottom, #A8C5DA 0%, #739ab9 20%, #113047 40%, #2a2a2a 50%, #6d120b 64%, #b02a29 82%, #D6524C 100%)',
  },
  thermal: {
    pos: [
      [0.0, NEUTRAL],
      [0.4, [96, 120, 168]], //  slate
      [0.7, [56, 140, 210]], //  steel blue
      [1.0, [80, 190, 245]], //  ice blue
    ],
    neg: [
      [0.0, NEUTRAL],
      [0.4, [196, 122, 54]], //  ember (brighter)
      [0.7, [242, 158, 48]], //  amber
      [1.0, [255, 188, 72]], //  bright orange
    ],
    gradient:
      'linear-gradient(to bottom, #50BEF5 0%, #388CD2 20%, #6078A8 38%, #2a2a2a 50%, #C47A36 64%, #F29E30 82%, #FFBC48 100%)',
  },
  'teal-violet': {
    pos: [
      [0.0, NEUTRAL],
      [0.45, [40, 120, 110]],
      [0.75, [30, 170, 150]],
      [1.0, [45, 212, 191]],
    ],
    neg: [
      [0.0, NEUTRAL],
      [0.45, [110, 88, 150]],
      [0.75, [140, 110, 220]],
      [1.0, [167, 139, 250]],
    ],
    gradient:
      'linear-gradient(to bottom, #2DD4BF 0%, #1EAA96 22%, #2a2a2a 50%, #8C6EDC 78%, #A78BFA 100%)',
  },
  'gold-slate': {
    pos: [
      [0.0, NEUTRAL],
      [0.45, [138, 112, 52]],
      [0.75, [196, 158, 60]],
      [1.0, [224, 184, 78]],
    ],
    neg: [
      [0.0, NEUTRAL],
      [0.45, [78, 94, 128]],
      [0.75, [82, 112, 168]],
      [1.0, [110, 140, 198]],
    ],
    gradient:
      'linear-gradient(to bottom, #E0B84E 0%, #C49E3C 22%, #2a2a2a 50%, #5270A8 78%, #6E8CC6 100%)',
  },
};

/* Magnitude → ramp position on a power curve: GEX is heavy-tailed (live SPY: max $543.6M, median $27.4M), so linear |v|/max
   leaves most cells black. Gamma 0.4 maps median 0.05 → 0.30, p90 0.24 → 0.56; order, sign and zero survive. */
const HEAT_GAMMA = 0.4;
function heatT(value: number, maxAbs: number, gamma: number = HEAT_GAMMA): number {
  if (!Number.isFinite(value)) return 0;
  const linear = Math.min(1, Math.abs(value) / (maxAbs || 1));
  return Math.pow(linear, gamma);
}

function lerp(a: number, b: number, u: number): number {
  return Math.round(a + (b - a) * u);
}

function rampColor(stops: Stops, t: number): RGB {
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0 || 1);
      return [lerp(c0[0], c1[0], u), lerp(c0[1], c1[1], u), lerp(c0[2], c1[2], u)];
    }
  }
  return stops[stops.length - 1][1];
}

/* Cell ink: the best flip point is where contrast against both inks is equal, L = sqrt((Ll + 0.05)(Ld + 0.05)) − 0.05 ≈ 0.168,
   which guarantees ≥4.11:1 for this pair. Not a knob. */
const INK_LIGHT = '#ededed';
const INK_DARK = '#0a0a0a';
function relativeLuminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const INK_CROSSOVER = Math.sqrt((relativeLuminance([237, 237, 237]) + 0.05) * (relativeLuminance([10, 10, 10]) + 0.05)) - 0.05;
const inkFor = (rgb: RGB): string => (relativeLuminance(rgb) > INK_CROSSOVER ? INK_DARK : INK_LIGHT);

/* Paper: the dark ramps climb toward light, which vanishes on grey, so on paper a bar or figure runs from the muted ink to a deep pole
   (the light tokens), and a capsule from a faint tint of the pole to the pole. The dark ramps are untouched. */
const PAPER_MUTED: RGB = [75, 78, 86]; /* --text-muted on paper */
const PAPER_INSET: RGB = [245, 244, 240]; /* --inset on paper, the island's ground */
const PAPER_POLES: Record<'ember-glacier' | 'thermal-yellow', { pos: RGB; neg: RGB }> = {
  'ember-glacier': { pos: [146, 86, 4], neg: [3, 105, 161] },
  'thermal-yellow': { pos: [165, 0, 38], neg: [49, 54, 149] },
};
/* One pair on paper: every light surface walks the thermal pair (deep red and navy) whatever the palette; the Colours cards are hidden there.
   `mode` stays in the signature for a future paper palette. */
const paperPole = (sign: 1 | -1, _mode: HeatMode): RGB => {
  const p = PAPER_POLES['thermal-yellow'];
  return sign >= 0 ? p.pos : p.neg;
};
const mixRgb = (a: RGB, b: RGB, u: number): RGB => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
/** A bar's or a figure's ink on paper: the muted ink at zero, the deep pole at one */
const paperInk = (sign: 1 | -1, t: number, mode: HeatMode): RGB => mixRgb(PAPER_MUTED, paperPole(sign, mode), Math.max(0, Math.min(1, t)));
/** A capsule's fill on paper: a faint tint of the pole at zero (never the bare ground — a quiet cell is still a cell), the pole at one */
const paperTint = (sign: 1 | -1, t: number, mode: HeatMode): RGB => mixRgb(PAPER_INSET, paperPole(sign, mode), 0.16 + 0.84 * Math.max(0, Math.min(1, t)));

/** The ladder's leg on paper: from a 35% tint of the pole on the island's grey to the deep pole, so quiet strikes and walls separate. */
export function heatPaperLeg(sign: 1 | -1, t: number, mode: HeatMode): RGB {
  return mixRgb(PAPER_INSET, paperPole(sign, mode), 0.35 + 0.65 * Math.max(0, Math.min(1, t)));
}

/** The same journey on any ramp; `paper` reads the paper ink ramp. */
export function heatRampColorFor(sign: 1 | -1, t: number, mode: HeatMode, paper = false): RGB {
  if (paper) return paperInk(sign, t, mode);
  const r = RAMPS[mode as keyof typeof RAMPS];
  const tt = Math.max(0, Math.min(1, t));
  if (!r) {
    const c = Math.round((0.3 + 0.6 * tt) * 255);
    return [c, c, c];
  }
  return rampColor(sign >= 0 ? r.pos : r.neg, tt);
}

const EMERALD: RGB = [48, 209, 88];
const ROSE: RGB = [255, 59, 48];
const TINT_START = 0.78;
const TINT_MAX = 0.5;

const ramp = RAMPS[HEAT_MODE as keyof typeof RAMPS];

/** One cell's fill and ink. `mode` lets ONE surface read another ramp (the
    Ledger's thermal try) without moving the terminal-wide HEAT_MODE. */
export function heatCellStyle(value: number, maxAbs: number, mode: HeatMode = HEAT_MODE, paper = false): CSSProperties {
  const pal = mode === HEAT_MODE ? ramp : RAMPS[mode as keyof typeof RAMPS];
  const t = heatT(value, maxAbs, pal?.gamma);

  if (paper) {
    const rgb = paperTint(value >= 0 ? 1 : -1, t, mode);
    return { backgroundColor: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, color: inkFor(rgb) };
  }
  if (pal) {
    const rgb = rampColor(value >= 0 ? pal.pos : pal.neg, t);
    return { backgroundColor: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, color: inkFor(rgb) };
  }

  if (HEAT_MODE === 'diverging') {
    const alpha = 0.05 + t * 0.5;
    return {
      backgroundColor:
        value >= 0 ? `rgba(48,209,88,${alpha.toFixed(3)})` : `rgba(255,59,48,${alpha.toFixed(3)})`,
      color: '#ededed',
    };
  }

  // mono base: neutral gray (t=0) → white for positive, black for negative
  const luminance = value >= 0 ? 0.24 + t * 0.68 : 0.24 - t * 0.22;
  const channel = Math.round(luminance * 255);
  let r = channel;
  let g = channel;
  let b = channel;

  if (HEAT_MODE === 'hybrid' && t > TINT_START) {
    const weight = ((t - TINT_START) / (1 - TINT_START)) * TINT_MAX;
    const tint = value >= 0 ? EMERALD : ROSE;
    r = lerp(r, tint[0], weight);
    g = lerp(g, tint[1], weight);
    b = lerp(b, tint[2], weight);
  }

  return {
    backgroundColor: `rgb(${r},${g},${b})`,
    color: luminance > 0.52 ? '#0a0a0a' : '#ededed',
  };
}

/** One lane's colour on the ramp itself, as a capsule of that value would wear; `floor` keeps a small lane off the panel's dark zero. */
export function heatLaneColor(value: number, maxAbs: number, mode: HeatMode = HEAT_MODE, floor = 0.3, paper = false): string {
  const pal = RAMPS[mode as keyof typeof RAMPS];
  if (paper) {
    /* on paper the floor is the muted ink itself — every figure reads — so the journey starts a little up the ramp
       only to keep a small bar from being pure grey */
    const t = 0.15 + 0.85 * heatT(value, maxAbs, pal?.gamma);
    const c = paperInk(value >= 0 ? 1 : -1, t, mode);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  if (!pal) return value >= 0 ? '#ededed' : '#8f8f8f';
  const t = floor + (1 - floor) * heatT(value, maxAbs, pal.gamma);
  const c = rampColor(value >= 0 ? pal.pos : pal.neg, t);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* The ladder reads each side through a window (the saturated stretch, deep to bright) and against the length cut,
   so ordinary strikes span the window and walls sit at its end. On paper the window is the paper ink ramp's upper part. Other surfaces keep the full journey. */
const LADDER_WINDOWS: Record<'ember-glacier' | 'thermal-yellow', { pos: [number, number]; neg: [number, number] }> = {
  /* ember from fire to gold; glacier from azure to the sky the house glacier token is (0.75), short of the ice. The
     window's START is set by the FIGURE: a net figure at a small amount wears the same ink as its bar and must read
     on black at 4.5:1 — measured, fire (0.6) is 5.0:1 and azure (0.5) 4.9:1, while rust (0.5) was 3.6 and navy 3.1 */
  'ember-glacier': { pos: [0.6, 1], neg: [0.5, 0.75] },
  /* Thermal's window: RdYlBu's cool side is pastel until 0.6 and navy past 0.8, and both deep poles fall under 4.5:1 on black,
     so the ends stop short of them; the walls wear the bright end. */
  'thermal-yellow': { pos: [0.4, 0.75], neg: [0.6, 0.78] },
};
const PAPER_WINDOW: [number, number] = [0.55, 1];
/** Where on its ramp the ladder reads an amount at `t` (0..1 against the cut) */
export function ladderRampT(sign: 1 | -1, t: number, mode: HeatMode, paper = false): number {
  const [a, b] = paper ? PAPER_WINDOW : (LADDER_WINDOWS[mode as keyof typeof LADDER_WINDOWS] ?? LADDER_WINDOWS['ember-glacier'])[sign >= 0 ? 'pos' : 'neg'];
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
/** A ladder bar's or figure's ink: the amount against the CUT, through the window, on the page's ramp */
export function heatLadderColor(value: number, cut: number, mode: HeatMode, paper = false): string {
  const pal = RAMPS[mode as keyof typeof RAMPS];
  const sign: 1 | -1 = value >= 0 ? 1 : -1;
  const u = ladderRampT(sign, heatT(value, cut, pal?.gamma), mode, paper);
  const c = paper ? paperInk(sign, u, mode) : pal ? rampColor(sign >= 0 ? pal.pos : pal.neg, u) : ([128, 128, 128] as RGB);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

