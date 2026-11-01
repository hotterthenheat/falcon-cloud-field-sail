/* The Surface tab's lenses beyond the dealer-gamma profile load on first open: their charts are recharts (via
   components/shadcn/chart.tsx), which no other part of Terrain's first paint needs. */

import { lazy, Suspense, type ComponentProps } from 'react';
import { Seg } from './railFacts';

const SkewView = lazy(() => import('./SkewView'));

const Wait = () => <div className="h-full flex items-center justify-center font-mono text-t11 uppercase tracking-widest text-textMuted">Loading…</div>;

export const SurfaceLenses = {
  Skew: (p: ComponentProps<typeof SkewView>) => (
    <Suspense fallback={<Wait />}>
      <SkewView {...p} />
    </Suspense>
  ),
};

/** What the Surface tab draws: dealer gamma across spot (the field's profile), or the vol skew and surface */
export type SurfaceLens = 'gamma' | 'skew';
const LENSES = [
  { value: 'gamma', label: 'Gamma', hint: 'Dealer gamma across spot — the curve the flip is read off' },
  { value: 'skew', label: 'Skew', hint: 'Implied vol by delta and expiry, against the prior close' },
] as const satisfies readonly { value: SurfaceLens; label: string; hint: string }[];

const KEY = 'slayer_surface_lens';
export const readLens = (): SurfaceLens => {
  try {
    const v = localStorage.getItem(KEY);
    return LENSES.some(l => l.value === v) ? (v as SurfaceLens) : 'gamma';
  } catch {
    return 'gamma';
  }
};
export const keepLens = (v: SurfaceLens): void => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage off: the choice lives for the session */
  }
};

/** The lens switch on the Surface tab's head, dressed as the field's Settled · Live */
export const LensSwitch = ({ value, onChange }: { value: SurfaceLens; onChange: (v: SurfaceLens) => void }) => (
  <span className="pointer-events-auto inline-flex" data-surface-lens={value}>
    <Seg options={LENSES} value={value} onChange={onChange} testId="surface-lens" title="What the Surface tab draws" />
  </span>
);
