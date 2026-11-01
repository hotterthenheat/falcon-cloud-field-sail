/* The pieces the rail's Regime tab draws in the house's own hand, beside the Calendar, Matrix and
   Surface tabs: the head's fact chips (the Expiry card's clothes, without its menu), the section heads (the matrix's
   column heads), the one-line foot (the Surface tab's), and the chart frame every recharts chart there sits in. */

import type { ReactNode } from 'react';

/** A fact in the head row, dressed as the head's cards: a muted caps label, the value in the figures' voice */
export const FactChip = ({ label, children, title, testId }: { label: string; children: ReactNode; title?: string; testId?: string }) => (
  <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-borderSubtle bg-chip font-mono whitespace-nowrap select-none" title={title} data-rail-fact={testId}>
    <span className="text-t9 uppercase tracking-widest text-textMuted">{label}</span>
    <span className="text-t11 font-semibold tnum text-textPrimary">{children}</span>
  </span>
);

/** A section's head: the matrix's column head — the name in caps, its gloss after a dot */
export const SectionHead = ({ name, gloss, aside }: { name: string; gloss?: ReactNode; aside?: ReactNode }) => (
  <div className="flex items-baseline gap-2 px-3 pt-2.5 pb-1 min-w-0">
    <span className="font-mono text-t11 font-semibold uppercase tracking-widest text-textPrimary whitespace-nowrap">{name}</span>
    {gloss != null && <span className="font-mono text-t11 text-textMuted truncate">· {gloss}</span>}
    {aside != null && <span className="ml-auto font-mono text-t11 tnum text-textSecondary whitespace-nowrap">{aside}</span>}
  </div>
);

/** A two- or three-way choice in the head, dressed as the field's Settled · Live switch beside it */
export const Seg = <V extends string>({ options, value, onChange, testId, title }: { options: readonly { value: V; label: string; hint?: string }[]; value: V; onChange: (v: V) => void; testId?: string; title?: string }) => (
  <span className="inline-flex shrink-0 items-center rounded-md border border-borderMuted p-0.5" data-rail-seg={testId} title={title}>
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        aria-pressed={o.value === value}
        title={o.hint}
        onClick={() => onChange(o.value)}
        className={`px-1.5 py-0.5 rounded font-mono text-t10 ${o.value === value ? 'bg-ink/[0.12] text-textPrimary' : 'text-textMuted hover:text-textSecondary'}`}
      >
        {o.label}
      </button>
    ))}
  </span>
);

/** The tab's one-line foot, as the Surface tab's */
export const RailFoot = ({ children }: { children: ReactNode }) => (
  <p className="shrink-0 truncate px-3 py-1 text-t11 text-textMuted border-t border-borderSubtle/60">{children}</p>
);

/** The axis and label type every chart in these tabs uses: the figures' face at the rail's small size */
export const TICK = { fontSize: 10 } as const;
/** The series inks — the house tokens through the chart aliases (theme/tokens.css) */
export const INK = {
  select: 'rgb(var(--chart-1))',
  ink: 'rgb(var(--chart-2))',
  secondary: 'rgb(var(--chart-3))',
  call: 'rgb(var(--chart-4))',
  put: 'rgb(var(--chart-5))',
  grid: 'rgb(var(--chart-grid))',
  axis: 'rgb(var(--chart-axis))',
} as const;
