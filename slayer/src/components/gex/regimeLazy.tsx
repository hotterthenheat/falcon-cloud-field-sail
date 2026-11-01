/* The Regime tab loads on first open: its charts are recharts (via components/shadcn/chart.tsx), about 118 KB
   gzipped, which no other part of Terrain needs — so the desk's first paint does not carry it. */

import { lazy, Suspense, type ComponentProps } from 'react';

const VolRegimeView = lazy(() => import('./VolRegimeView'));

const Wait = () => <div className="h-full flex items-center justify-center font-mono text-t11 uppercase tracking-widest text-textMuted">Loading…</div>;

export const RegimeTabs = {
  Regime: (p: ComponentProps<typeof VolRegimeView>) => (
    <Suspense fallback={<Wait />}>
      <VolRegimeView {...p} />
    </Suspense>
  ),
};
