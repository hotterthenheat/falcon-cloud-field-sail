/* Folds a control in or out while keeping it mounted: a grid track animates 1fr → 0fr with the child clipped and faded,
   so neighbours slide on real layout. Shut, it leaves the tab order and pointer. */

import { useLayoutEffect, useState, type ReactNode } from 'react';

const FOLD_MS = 220;
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

interface FoldProps {
  open: boolean;
  /** 'x' folds the width (a control on a row); 'y' folds the height (a row in a column) */
  axis?: 'x' | 'y';
  /** The row's gap beside this fold, cancelled while shut so nothing is left behind (x only) */
  gap?: number;
  className?: string;
  children: ReactNode;
  testId?: string;
  /** Open and settled, stop clipping, so a control's invisible hit box (`.hit-24`, 44px on a touch screen) reaches
      past the fold's edge; it clips again the moment it starts to shut, and only once the glide in is done does it let
      go. For a fold whose row has room for it open (the last-targets pass, 2026-10-30). */
  bleed?: boolean;
}

const Fold = ({ open, axis = 'x', gap = 0, className = '', children, testId, bleed = false }: FoldProps) => {
  const Tag = axis === 'x' ? 'span' : 'div';
  const [settled, setSettled] = useState(open);
  useLayoutEffect(() => {
    if (!bleed) return;
    if (!open) {
      setSettled(false);
      return;
    }
    const t = window.setTimeout(() => setSettled(true), FOLD_MS);
    return () => window.clearTimeout(t);
  }, [open, bleed]);
  const clip = !(bleed && open && settled);
  return (
    <Tag
      className={`grid min-w-0 min-h-0 motion-reduce:transition-none ${className}`}
      style={{
        ...(axis === 'x' ? { gridTemplateColumns: open ? '1fr' : '0fr', marginRight: open ? 0 : -gap } : { gridTemplateRows: open ? '1fr' : '0fr' }),
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        transition: `grid-template-columns ${FOLD_MS}ms ${EASE}, grid-template-rows ${FOLD_MS}ms ${EASE}, margin ${FOLD_MS}ms ${EASE}, opacity ${FOLD_MS}ms ${EASE}, visibility 0s linear ${open ? 0 : FOLD_MS}ms`,
      }}
      aria-hidden={!open || undefined}
      data-fold={open ? 'open' : 'shut'}
      {...(testId ? { [testId]: '' } : {})}
    >
      <Tag className={`min-w-0 min-h-0 ${clip ? 'overflow-hidden' : ''} ${axis === 'x' ? 'inline-flex items-center whitespace-nowrap [&>*]:shrink-0' : 'flex flex-col'}`}>{children}</Tag>
    </Tag>
  );
};

export default Fold;
