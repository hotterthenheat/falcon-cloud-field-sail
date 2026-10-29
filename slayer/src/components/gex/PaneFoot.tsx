/* A chart's floating bar sits along the foot of the price pane, not the chart, so an indicator pane is never covered.
   The library reports no pane changes, so the pane's height is read each frame and the DOM written only on change. */

import { useEffect, useRef, type ReactNode } from 'react';
import type { IChartApi } from 'lightweight-charts';

interface Props {
  /** The chart, asked for every frame — never kept */
  chart: () => IChartApi | null;
  children: ReactNode;
  /** The gap between the bar and the pane's floor, in pixels */
  gap?: number;
  /** The wrapper's left inset (a host with a drawing rail down its left edge clears it) */
  className?: string;
  /** Keep clear of the price axis at the right (on by default). Off for a bar laid across TWO charts: it is centred on
      their seam, and the host gives it the same inset both sides. */
  axisPad?: boolean;
}

const PaneFoot = ({ chart, children, gap = 8, className = 'pl-3', axisPad = true }: Props) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let shownH = -1;
    let shownR = -1;
    const place = () => {
      raf = requestAnimationFrame(place);
      const c = chart();
      const el = ref.current;
      if (!c || !el) return;
      let h = 0;
      let r = 0;
      try {
        h = c.paneSize(0).height;
        r = c.priceScale('right').width();
      } catch {
        return; // the chart is on its way out
      }
      if (!(h > 0)) return;
      if (h !== shownH) {
        shownH = h;
        el.style.bottom = 'auto';
        el.style.top = `${h - gap}px`;
        el.style.transform = 'translateY(-100%)';
      }
      if (axisPad && r !== shownR) {
        shownR = r;
        el.style.paddingRight = `${r + 12}px`;
      }
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap, axisPad]);
  return (
    <div ref={ref} className={`absolute inset-x-0 z-30 pointer-events-none ${className}`} style={{ bottom: 34, paddingRight: axisPad ? 68 : undefined }} onDoubleClick={e => e.stopPropagation()} data-pane-foot>
      {children}
    </div>
  );
};

export default PaneFoot;
