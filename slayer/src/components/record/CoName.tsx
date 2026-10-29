import { useEffect, useRef, useState } from 'react';
import { useCompanyName } from '../../data/liveFiles';
import { displayName } from '../../data/tickers';

/* One observer for every name cell: a cell asks for its company's name once it is on screen. */
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

/** The company's name under a ticker: asked of the vendor once on screen (bundled names can be stale), "…" while out,
    the fallback only after the vendor answers without one, never the ticker twice. */
export const CoSub = ({ ticker, fallback, className = 'text-t10 text-textMuted truncate', vendor = true }: { ticker: string; fallback?: string | null; className?: string; /** the symbol came off a vendor feed, so the feed knows it */ vendor?: boolean }) => {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  const fallbackName = fallback && fallback.toUpperCase() !== ticker.toUpperCase() ? fallback : '';
  /* a feed row that names its company is not asked about again (one /info call per name saved) */
  const n = useCompanyName(ticker, vendor, seen && !fallbackName);
  const asking = n === '';
  const fromBook = !asking && n.toUpperCase() !== ticker.toUpperCase() ? n : '';
  const v = fromBook || (!asking ? fallbackName : '');
  return (
    <span ref={ref} className={className} title={v || undefined}>
      {v ? displayName(v) : <span className="opacity-60">{asking ? '…' : '—'}</span>}
    </span>
  );
};
