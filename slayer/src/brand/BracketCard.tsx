/* A card with the mark tile's corner brackets (--bracket ink): fault screens, the error boundary, the share image. */

import type { ReactNode } from 'react';

const Corner = ({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) => {
  const pos = { tl: 'top-3 left-3 border-t border-l', tr: 'top-3 right-3 border-t border-r', bl: 'bottom-3 left-3 border-b border-l', br: 'bottom-3 right-3 border-b border-r' }[at];
  return <span className={`pointer-events-none absolute w-5 h-5 ${pos}`} style={{ borderColor: 'rgb(var(--bracket))' }} aria-hidden />;
};

const BracketCard = ({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) => (
  <div className={`relative rounded-2xl border border-borderSubtle bg-panel ${className}`} data-bracket-card={label}>
    <Corner at="tl" />
    <Corner at="tr" />
    <Corner at="bl" />
    <Corner at="br" />
    {children}
  </div>
);

export default BracketCard;
