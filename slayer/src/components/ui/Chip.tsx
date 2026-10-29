/*
  Bare chip control — the house idiom for compact selectors that sit inside a
  panel's own toolbar. Lives here (not in ContractFlowChart, where it was born)
  so light callers can use it without pulling recharts through the lazy
  boundary.
*/

import type { ReactNode } from 'react';
import { Tip } from './Tooltip';

const Chip = ({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) => {
  const button = (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-2 py-0.5 rounded font-mono text-t10 whitespace-nowrap transition-colors ${
        active ? 'bg-ink/[0.09] text-textPrimary font-semibold' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.04]'
      }`}
    >
      {children}
    </button>
  );
  return title ? <Tip label={title}>{button}</Tip> : button;
};

export default Chip;
