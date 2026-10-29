/* The Dossier's shared pieces: a head figure, a box, a door out, and the age of a story. */

import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { statHelp } from './statHelp';

/** A head figure: the label over the value; `partial` greys it while the read is still landing */
export const Fact = ({ label, children, testId, tip, partial, scope = 'record', nowrap }: { label: string; children: ReactNode; testId?: string; tip?: string; partial?: boolean; scope?: string; nowrap?: boolean }) => (
  <div className="min-w-0 max-w-full">
    <dt className="text-t10 text-textMuted whitespace-nowrap cursor-help" title={tip ?? statHelp(label)}>
      {label}
    </dt>
    <dd className={`mt-0.5 font-mono text-t12 tnum ${nowrap ? 'whitespace-nowrap truncate' : 'whitespace-normal break-words'} ${partial ? 'text-textMuted' : 'text-textPrimary'}`} {...{ [`data-${scope}-fact`]: testId }} data-partial={partial ? '' : undefined}>
      {children}
    </dd>
  </div>
);

/** A box in the house grammar: the 15px title, one muted line, an optional aside, then its body */
export const Box = ({ title, sub, aside, testId, scope = 'record', className = '', children }: { title: string; sub?: ReactNode; aside?: ReactNode; testId: string; scope?: string; className?: string; children: ReactNode }) => (
  <div id={`${scope}-${testId}`} className={`border border-borderSubtle rounded-md bg-panel flex flex-col scroll-mt-4 ${className}`} {...{ [`data-${scope}-box`]: testId }}>
    <div className="px-5 pt-4 pb-3 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-t15 font-semibold leading-tight text-textPrimary">{title}</h3>
        {sub && <p className="mt-0.5 text-t11 text-textMuted truncate">{sub}</p>}
      </div>
      {aside}
    </div>
    {children}
  </div>
);

/** A door out — small and labelled, never a bare icon */
export const Door = ({ onClick, onWarm, children }: { onClick: () => void; onWarm?: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} onMouseEnter={onWarm} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted font-mono text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
    <ArrowUpRight className="w-3 h-3" />
    {children}
  </button>
);

/** "just now", "12m ago", "2h 5m ago" */
export const ago = (m: number) => (m < 1 ? 'just now' : m < 60 ? `${Math.round(m)}m ago` : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m ago`);
