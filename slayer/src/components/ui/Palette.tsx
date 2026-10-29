/*
  Palette: adapted from Bencho's "Palette" block (bencho.dev, MIT, bencho.dev/licence).
  With `sets`/`index`/`onChange` it switches between given palettes; without, it is the original generator.
  Sizes are props (defaults are the original constants), `label` titles the first pill, `edge` adds the hairline.
  The CSS tokens it reads are mapped onto the house tokens on `.pal` (index.css).
*/

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMotionValue, useSpring as useMotionSpring, useTransform, useVelocity } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

/* Colours are generated in OKLCH (perceptually uniform, unlike HSL) as a lightness ramp within one hue family, with
   chroma peaking mid-ramp where the gamut has room; converted to hex on the way out. */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* oklch -> oklab -> LMS -> linear sRGB -> sRGB (Ottosson's matrices); out-of-gamut channels are clipped */
function hex(L: number, C: number, H: number) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;

  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];

  return (
    '#' +
    lin
      .map(v => {
        const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055;
        return Math.round(clamp(g, 0, 1) * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

export type Swatch = { hex: string };

/* A base hue, a 16-34 degree step and a lightness ramp. One set in three ends on an accent 150-175 degrees round the
   wheel (a split complement), continuing in the ramp's own direction. */
function make(n: number): Swatch[] {
  const base = Math.random() * 360;
  const step = (16 + Math.random() * 18) * (Math.random() < 0.5 ? -1 : 1);
  const accent = Math.random() < 0.34;

  return Array.from({ length: n }, (_, i) => {
    const p = n === 1 ? 0 : i / (n - 1);
    /* light at the top of the ramp, deep at the bottom */
    const L = 0.9 - p * 0.5;
    /* and vivid in the middle, where the gamut has the room */
    const C = 0.05 + Math.sin(p * Math.PI) * 0.105;
    const H = accent && i === n - 1 ? base + (n - 1) * step + (150 + Math.random() * 25) * Math.sign(step) : base + i * step;
    return { hex: hex(L, C, ((H % 360) + 360) % 360) };
  });
}

/* Two pills of one height, padding and corner: the colours (segments of one bar) and the refresh key beside them. */
const W = 300;
/* the inset inside each pill */
const PAD = 10;
const BAR_H = 58;
/* the refresh key is as tall as a swatch and about half as wide; the width saved goes to the swatches */
const TOOL = 30;
/* the space between the two pills, tighter than the inset so they read as a pair */
const GAP = 6;
const CORNER = 14;
const BASE = 760;
/* a small gap between swatches: they read as one bar, and each may overshoot its slot without being clipped */
const SEAM = 4;

/* A swatch changes colour by drawing into a circle, swapping at its smallest and spreading back. Each swatch is one
   solid colour at every frame: the goo filter blurs only the gaps between swatches, so colours never smear. */

/* blur carried by the run; zero at rest */
const HEAT = 5;

/* every swatch runs the same clock: a refresh replaces the whole set at once */

/* out fast, then back past rest and settle (a back-out curve); the colour swaps at OUT, the top of the deformation */
const OUT = 0.4;
const back = (k: number) => {
  const c = 1.7;
  const u = k - 1;
  return 1 + (c + 1) * u ** 3 + c * u ** 2;
};
const swellOf = (ti: number) => (ti <= 0 ? 0 : ti < OUT ? 1 - (1 - ti / OUT) ** 3 : 1 - back((ti - OUT) / (1 - OUT)));

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/* Shared motion parts: one spring, one goo filter. The filter id comes from useId (duplicate SVG ids collide across
   mounts). The goo's hard alpha cut fuses nearby shapes, so it must never cover text. */

/* zeta ~ 0.67: about 6% overshoot before settling */
export const LIQUID = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 14,
  mass: 0.5,
};

/* non-drag blocks use the same feel without overshoot */
/* For animating corner radii, where overshoot reads as a wobble: stiffness raised with damping keeps zeta ~ 1.03, no
   overshoot, settling in about 180 ms. */
export const LIQUID_STILL = { ...LIQUID, stiffness: 420, damping: 30 };

export function useGoo(blur = 7, cut = 28) {
  /* useId yields ":r0:", which url(#...) cannot reference: strip the colons */
  const id = `goo-${useId().replace(/:/g, '')}`;
  const goo = (
    <svg className="liq-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="smear" />
          <feColorMatrix in="smear" type="matrix" values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${cut} ${-(cut / 2)}`} />
        </filter>
      </defs>
    </svg>
  );
  return { id, url: `url(#${id})`, goo };
}

/* drag velocity -> skew: the element leans against its motion; the skew is sprung, since raw velocity jitters */
export function useDragSkew(limit = 12, range = 1600) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const vx = useVelocity(x);
  const vy = useVelocity(y);
  const skewX = useMotionSpring(useTransform(vx, [-range, range], [limit, -limit]), LIQUID);
  const skewY = useMotionSpring(useTransform(vy, [-range, range], [limit / 2, -limit / 2]), LIQUID);
  return { x, y, skewX, skewY };
}

/* Framer interpolates only real colours, and tokens (often color-mix()) are not resolved by getPropertyValue, so a
   hidden probe inheriting the component's custom properties lets the engine compute them. */
export function useTokens(ref: React.RefObject<HTMLElement | null>, names: string[]): Record<string, string> {
  const [vals, setVals] = useState<Record<string, string>>({});
  const key = names.join('|');
  const last = useRef('');

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    const read = () => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
      host.appendChild(probe);
      const next: Record<string, string> = {};
      for (const n of names) {
        /* a bare token is wrapped; a fallback chain or literal is already a colour expression */
        probe.style.color = n.startsWith('--') ? `var(${n})` : n;
        next[n] = getComputedStyle(probe).color;
      }
      probe.remove();
      const sig = JSON.stringify(next);
      if (sig !== last.current) {
        last.current = sig;
        setVals(next);
      }
    };

    read();

    /* every ancestor that can redefine the palette */
    const mo = new MutationObserver(read);
    const flags = ['data-theme', 'data-fill', 'data-surface', 'data-stroke'];
    for (let el: HTMLElement | null = host; el; el = el.parentElement) {
      mo.observe(el, { attributes: true, attributeFilter: flags });
    }
    return () => mo.disconnect();
  }, [ref, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return vals;
}

/* Elastic knobs run 0..100 outside and real units inside; 50 is always the component's tuned value. */

/* speed as a multiplier on the tuned duration: 0 is ~1.6x slower, 50 exactly 1, 100 is 2.5x faster */
export const rate = (speed: number) => 1.6 - (speed / 100) * 1.2;

/* landing hardness: the bezier's second control-point y is the overshoot (1 stops dead, above 1 overshoots); 50 returns
   the tuned y */
export const overshoot = (bounce: number, tuned: number) => Number((1 + (bounce / 100) * (tuned - 1) * 2).toFixed(3));

/* the same, as a transition */
export const curve = (bounce: number, tuned: number, x1 = 0.28, x2 = 0.36) => `cubic-bezier(${x1}, ${overshoot(bounce, tuned)}, ${x2}, 1)`;

/* One spring for everything that settles: velocity toward a target, damped, snapping when delta and velocity fall
   under 0.02. */

/* 0..100 into stiffness and decay; 50 is the tuned feel, and both ends still arrive */
/* chosen by damping ratio, zeta = -ln(d) / (2 * sqrt(k)), then written back as stiffness and decay, since the ratio
   is what a person is actually setting */
const springOf = (tune: number) => ({
  /* stiffness: how hard it is pulled toward the target */
  k: 0.08 + (tune / 100) * 0.16,
  /* decay, per frame: how much of the velocity survives */
  d: 0.62 + (tune / 100) * 0.2,
});

/* the snap threshold is absolute: drive the spring in pixels or 0..100, never 0..1 */
export function useSpring(target: number, tune = 50, instant = false) {
  const [at, setAt] = useState(target);
  const cur = useRef(target);
  const vel = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (instant) {
      cur.current = target;
      vel.current = 0;
      setAt(target);
      return;
    }
    const { k, d } = springOf(tune);
    let prev = 0;
    const tick = (t: number) => {
      const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
      prev = t;
      vel.current += (target - cur.current) * k * dt;
      vel.current *= Math.pow(d, dt);
      cur.current += vel.current * dt;
      if (Math.abs(target - cur.current) < 0.02 && Math.abs(vel.current) < 0.02) {
        cur.current = target;
        vel.current = 0;
        setAt(target);
        raf.current = 0;
        return;
      }
      setAt(cur.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    /* `tune` is a dependency so a knob turned mid-flight takes effect; the restart continues from the refs */
  }, [target, tune, instant]);

  return at;
}

/* read once: a preference, not a live input */
const stillness = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export interface PaletteProps {
  /* colours per set, 3..5 (the generator's); with `sets` each set's own count stands */
  count?: number;
  /* the swatch corner, 0 to half the bar height (square to fully round) */
  corner?: number;
  /* how quickly a colour changes, 0..100 */
  morph?: number;
  /* `sets`: the palettes to switch between. The host owns `index`; the button asks for the next via `onChange`. */
  sets?: string[][];
  index?: number;
  onChange?: (index: number) => void;
  /* the label before the bar ("COLOURS") */
  label?: ReactNode;
  /* the button's accessible description, e.g. "Colours: House. Press for Thermal" */
  title?: string;
  /* the house hairline on both pills */
  edge?: boolean;
  /* sizes as props (defaults are the original constants); with `swatch` the bar is built from the swatch width */
  width?: number;
  swatch?: number;
  barH?: number;
  pad?: number;
  tool?: number;
  gap?: number;
  seam?: number;
  testId?: string;
}

export function Palette({ count = 4, corner = CORNER, morph = 50, sets, index = 0, onChange, label, title, edge = false, width = W, swatch, barH = BAR_H, pad = PAD, tool = TOOL, gap = GAP, seam = SEAM, testId }: PaletteProps = {}) {
  const given = sets && sets.length > 0 ? sets : null;
  const at = given ? ((index % given.length) + given.length) % given.length : 0;
  const n = given ? given[at].length : clamp(Math.round(count), 3, 5);
  const [own, setOwn] = useState<Swatch[]>(() => (given ? [] : make(n)));
  /* with sets the palette is the host's; no local copy can drift */
  const pal: Swatch[] = given ? given[at].map(hex => ({ hex })) : own;
  const [next, setNext] = useState<Swatch[] | null>(null);
  const [t, setT] = useState(0);
  const raf = useRef(0);
  const spins = useRef(0);
  const still = stillness();

  /* the palette follows the knob without waiting for a press */
  if (!given && own.length !== n) {
    setOwn(make(n));
    setNext(null);
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const roll = () => {
    /* a press mid-run is ignored, so no swatch shows a palette that no longer exists */
    if (raf.current) return;
    spins.current += 1;

    const to = given ? (at + 1) % given.length : -1;
    const fresh: Swatch[] = given ? given[to].map(hex => ({ hex })) : make(n);
    if (still) {
      if (given) onChange?.(to);
      else setOwn(fresh);
      return;
    }

    setNext(fresh);
    const ms = BASE * rate(clamp(morph, 0, 100));
    const t0 = performance.now();
    /* the host is told at OUT, the frame the swatches swap, so its own transition runs under the orbs' return */
    let told = false;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setT(p);
      if (!told && p >= OUT) {
        told = true;
        if (given) onChange?.(to);
      }
      if (p < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        raf.current = 0;
        /* the generator takes its new set as the run lands, in the same render that clears the run */
        if (!given) setOwn(fresh);
        setNext(null);
        setT(0);
      }
    };
    raf.current = requestAnimationFrame(tick);
  };

  /* both pills share one padding, so they come out the same height */
  const toolW = tool + pad * 2;
  /* seams come out of the row before it is divided, so swatches stay equal at any count */
  const barW = swatch != null ? swatch * n + seam * (n - 1) : width - toolW - gap - pad * 2;
  const seg = (barW - seam * (n - 1)) / n;
  const step = seg + seam;
  /* the goo blur is zero at rest (crisp seams) and only rises while something moves */
  /* the blur is sized by the neck two swatches must bridge (seam plus the orbs' inset at three tenths of the swell),
     kept small against the swatch so colours never smear into one band */
  const NECK_REF = SEAM + 0.3 * (53 - BAR_H * 0.66);
  const heat = Math.sin(Math.PI * clamp(t, 0, 1)) * HEAT * ((seam + 0.3 * (seg - barH * 0.66)) / NECK_REF);
  const { url: gooUrl, goo } = useGoo(heat, 26);

  const r = clamp(corner, 0, barH / 2);
  /* The slab corner is the swatch corner plus padding, with the offset fading in over the first CORNER pixels so square
     swatches never sit in a rounded slab. */
  const slabR = r + pad * Math.min(1, r / CORNER);

  /* The colour pill dips 3.5% with the swatches and returns slightly past 1 (raw swellOf, unclamped): a scale, so
     the bar never relayouts per frame, and under a pixel of corner distortion. */
  const beat = 1 - 0.035 * swellOf(clamp(t, 0, 1));

  return (
    <div className="pal" style={{ ...(swatch == null ? { width } : {}), gap }} data-stroke={edge ? 'on' : undefined} data-palette-switch={testId} data-palette-index={given ? at : undefined} data-palette-running={raf.current ? '' : undefined}>
      <div className="pal-slab" style={{ padding: pad, borderRadius: slabR, scale: beat }}>
        {label != null && (
          <span className="pal-label" aria-hidden="true">
            {label}
          </span>
        )}
        {/* no clip and no corner: each swatch carries its own radius, and a clipping bar would cut the overshoot */}
        <div className="pal-bar" style={{ height: barH, width: barW }}>
          <div className="pal-blobs" aria-hidden="true" style={{ filter: gooUrl }}>
            {pal.map((c, i) => {
              /* one clock for every swatch */
              const ti = clamp(t, 0, 1);
              /* the colour changes at the top of the deformation */
              const shown = next && ti >= OUT ? next[i].hex : c.hex;
              const d = Math.max(0, swellOf(ti));

              /* into a circle and back out into its slot */
              const side = mix(seg, barH * 0.66, d);
              const h = mix(barH, barH * 0.66, d);
              return (
                <span
                  key={i}
                  className="pal-seg"
                  style={{
                    background: shown,
                    width: side,
                    height: h,
                    top: (barH - h) / 2,
                    borderRadius: mix(r, h / 2, d),
                    transform: `translateX(${(i * step + (seg - side) / 2).toFixed(2)}px)`,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* the button pill shares the palette pill's padding and corner; the button wears the swatch radius */}
      <div className="pal-slab pal-tool" style={{ padding: pad, borderRadius: slabR }}>
        <button className="pal-go" type="button" onClick={roll} aria-label={title ?? 'Generate a new palette'} title={title} style={{ width: tool, height: barH, borderRadius: r }} data-palette-go>
          {/* a turn per press, always the same way (unwinding would read as undo) */}
          <RefreshCw size={Math.round(Math.min(18, barH * 0.62))} strokeWidth={2.2} style={{ rotate: `${spins.current * 180}deg` }} />
        </button>
      </div>

      {goo}
    </div>
  );
}

export default Palette;
