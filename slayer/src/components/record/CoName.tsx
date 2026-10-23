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

/** The company's name under a ticker: the vendor's own (its stock info), asked once the cell is on screen; the bundled
    listing's only when the vendor has none; else the fallback — never the ticker said twice (the re-audit, 2026-10-22:
    the listing called SERV "ServiceMaster"; round 8: the grid still did, until the vendor's name is asked per cell) */
export const CoSub = ({ ticker, fallback, className = 'text-[10px] text-textMuted truncate', vendor = true }: { ticker: string; fallback?: string | null; className?: string; /** the symbol came off a vendor feed, so the vendor knows it */ vendor?: boolean }) => {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  /* a vendor feed's own name for the row (an insider filing's, a 13F line's) needs no ask of its own */
  const own = fallback && fallback.toUpperCase() !== ticker.toUpperCase() ? fallback : '';
  const n = useCompanyName(ticker, vendor, seen && !own);
  const v = n && n.toUpperCase() !== ticker.toUpperCase() ? n : own;
  return (
    <span ref={ref} className={className} title={v || undefined}>
      {/* THE TICKER ONCE (audit round 10: "RAPP RAPP RAPP", "AMD AMD" — the ticker stood in the name line while the name
          was asked, beside the ticker itself): "…" while it is asked, "—" when the vendor has none */}
      {v ? displayName(v) : <span className="opacity-60">{n === '' ? '…' : '—'}</span>}
    </span>
  );
};
