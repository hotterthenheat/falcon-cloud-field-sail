import { useEffect, useRef, useState } from 'react';
import { useCompanyName } from '../../data/liveFiles';
import { displayName } from '../../data/tickers';

/* ONE OBSERVER FOR EVERY NAME CELL (round 8): a cell asks the vendor for its company's name once it is on screen — a
   200-row grid asks for the rows a reader can see, not all 200 at once */
const seenCb = new WeakMap<Element, () => void>();
let io: IntersectionObserver | null = null;
const observer = (): IntersectionObserver | null => {
  if (io || typeof IntersectionObserver === 'undefined') return io;
  io = new IntersectionObserver(
    es => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        seenCb.get(e.target)?.();
        seenCb.delete(e.target);
        io?.unobserve(e.target);
      }
    },
    { rootMargin: '200px 0px' },
  );
  return io;
};
/** True once the element has come within 200px of the screen */
export function useSeen<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const o = observer();
    if (!el || !o) {
      setSeen(true);
      return;
    }
    seenCb.set(el, () => setSeen(true));
    o.observe(el);
    return () => {
      seenCb.delete(el);
      o.unobserve(el);
    };
  }, []);
  return [ref, seen];
}

/** The company's name under a ticker. The vendor is asked once the cell is on screen even when a bundled or filing name
    is already in hand — that listing is years stale on some symbols. "…" while the ask is out. The vendor's name when it
    has one. The fallback only after the vendor answers without one. Never the ticker said twice. */
export const CoSub = ({ ticker, fallback, className = 'text-t10 text-textMuted truncate', vendor = true }: { ticker: string; fallback?: string | null; className?: string; /** the symbol came off a vendor feed, so the feed knows it */ vendor?: boolean }) => {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  const fallbackName = fallback && fallback.toUpperCase() !== ticker.toUpperCase() ? fallback : '';
  const n = useCompanyName(ticker, vendor, seen);
  const asking = n === '';
  const fromBook = !asking && n.toUpperCase() !== ticker.toUpperCase() ? n : '';
  const v = fromBook || (!asking ? fallbackName : '');
  return (
    <span ref={ref} className={className} title={v || undefined}>
      {v ? displayName(v) : <span className="opacity-60">{asking ? '…' : '—'}</span>}
    </span>
  );
};
