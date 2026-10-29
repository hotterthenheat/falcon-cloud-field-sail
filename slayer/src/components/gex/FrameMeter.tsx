/* A hidden frame-rate readout: `?fps=1` on the page's address. Rolling frames per second and the 95th-percentile
   frame time over the last 240 frames, written straight to the DOM twice a second, so it costs one rAF callback. */

import { useEffect, useRef } from 'react';

const WINDOW = 240;

/** True when the address asks for the readout. Read once per mount. */
export const frameMeterOn = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).get('fps') === '1';
  } catch {
    return false;
  }
};

export default function FrameMeter() {
  const textRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const gaps = new Float64Array(WINDOW);
    const sorted = new Float64Array(WINDOW);
    let n = 0;
    let head = 0;
    let last = 0;
    let shownAt = 0;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      /* a hidden tab stops rAF; the first frame back is not a frame time */
      if (last > 0 && now - last < 1000) {
        gaps[head] = now - last;
        head = (head + 1) % WINDOW;
        if (n < WINDOW) n += 1;
      }
      last = now;
      if (now - shownAt < 500 || n < 10 || !textRef.current) return;
      shownAt = now;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += gaps[i];
        sorted[i] = gaps[i];
      }
      const part = sorted.subarray(0, n).sort();
      const p95 = part[Math.min(n - 1, Math.floor(n * 0.95))];
      const worst = part[n - 1];
      textRef.current.textContent = `${(1000 / (sum / n)).toFixed(0)} fps · p95 ${p95.toFixed(1)} ms · max ${worst.toFixed(1)} ms`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className="fixed bottom-2 right-2 z-[200] pointer-events-none rounded bg-black/75 px-2 py-1 font-mono text-[11px] tnum text-white"
      style={{ contain: 'layout paint' }}
      data-frame-meter
    >
      <span ref={textRef}>measuring…</span>
    </div>
  );
}
