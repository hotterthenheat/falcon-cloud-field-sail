import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { FLOW_CHIPS } from '../../data/flowBuckets';
import type { FlowFilters } from '../../data/deskPrefs';

/* The flow pane's filters on a small pane: one door in the caption where the six chips were, the chips inside it — each
   still a press that steps its filter to the next setting. A narrowed filter is counted on the door, so a reader sees
   at a glance that the pane is filtered. */
export function FlowFilterDoor({ filters, legsIn = false, onStep }: { filters: FlowFilters; legsIn?: boolean; onStep: (key: keyof FlowFilters) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const narrowed = FLOW_CHIPS.filter(c => (filters[c.key] ?? c.options[0].value) !== 'all').length;
  return (
    <span ref={ref} className="relative pointer-events-auto" data-flow-door>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="The flow pane's filters"
        className={`inline-flex items-center gap-1 rounded-[3px] px-1 py-px transition-colors hover:bg-ink/[0.08] hover:text-textPrimary ${open ? 'bg-ink/[0.08] text-textPrimary' : 'text-textMuted'}`}
      >
        <SlidersHorizontal className="w-2.5 h-2.5" aria-hidden />
        Filters
        {narrowed > 0 && <span className="tnum text-textSecondary">{narrowed}</span>}
      </button>
      {open && (
        <span className="absolute left-0 bottom-full mb-1 z-40 flex flex-col min-w-[150px] rounded-md border border-borderSubtle bg-panel/95 p-1 shadow-lg shadow-black/40 normal-case tracking-normal" role="menu">
          {FLOW_CHIPS.map(c => {
            /* the Spread legs type counts its legs whatever the Legs chip holds */
            const opt = c.key === 'leg' && legsIn ? (c.options.find(o => o.value === 'all') ?? c.options[0]) : (c.options.find(o => o.value === filters[c.key]) ?? c.options[0]);
            const next = c.options[(c.options.indexOf(opt) + 1) % c.options.length];
            return (
              <button
                key={c.key}
                type="button"
                role="menuitem"
                onClick={() => onStep(c.key)}
                title={`${c.hint} — click for ${next.label}`}
                className={`flex items-center justify-between gap-3 rounded px-1.5 py-1 text-left font-mono text-t10 transition-colors hover:bg-ink/[0.08] ${opt.value !== 'all' ? 'text-textPrimary' : 'text-textMuted'}`}
                data-flow-chip={c.key}
              >
                <span>{opt.label}</span>
                <span className="text-t9 text-textMuted">→ {next.short}</span>
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
