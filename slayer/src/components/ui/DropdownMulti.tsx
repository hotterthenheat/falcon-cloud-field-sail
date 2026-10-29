/*
  Any number of choices, in the same dropdown card as DropdownSelect: the trigger prints what is picked, the card
  lists grouped checkbox rows (each independent), stays open while ticking, and ends with Clear. Built on Radix
  DropdownMenu.
*/

import { FLAT_DOOR, FLAT_OPEN } from './flatDoor';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { CARD } from './DropdownSelect';

export interface MultiOption {
  value: string;
  label: string;
  /** One line under the label — what this is */
  hint?: string;
  /** How many of the page's rows it covers, printed at the row's right */
  count?: number;
}

export interface MultiGroup {
  title: string;
  options: MultiOption[];
}

interface DropdownMultiProps {
  /** The control's name, printed small before the summary */
  label: string;
  values: string[];
  groups: MultiGroup[];
  onChange: (values: string[]) => void;
  /** A heading inside the card; defaults to the label */
  title?: string;
  /** What the trigger says when nothing is picked */
  emptyWord?: string;
  /** The summary's ink once something is picked */
  tone?: 'warn' | 'bull' | 'bear';
  align?: 'start' | 'end';
  /** A data-* hook for probes */
  testId?: string;
  /** Hide the printed name on a line too short for it; it stays in the tooltip, aria-label and open card heading. */
  bare?: boolean;
  /** The house's flat control (ui/flatDoor.ts) — the Map band's */
  flat?: boolean;
  /** The foot's clearing row, where the host's empty word is not "everything" (the Map's Greek card: "All five") */
  clearWord?: string;
}

/** The trigger's summary: nothing · one name · two names · two names +N */
const summarise = (values: string[], groups: MultiGroup[], emptyWord: string): string => {
  if (values.length === 0) return emptyWord;
  const labels = values.map(v => groups.flatMap(g => g.options).find(o => o.value === v)?.label ?? v);
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
};

const DropdownMulti = ({ label, values, groups, onChange, title, emptyWord = 'Everything', align = 'end', testId, bare = false, flat = false, tone, clearWord = 'Clear · show everything' }: DropdownMultiProps) => {
  const picked = new Set(values);
  const toggle = (v: string) => onChange(picked.has(v) ? values.filter(x => x !== v) : [...values, v]);
  const summary = summarise(values, groups, emptyWord);
  const shown = groups.filter(g => g.options.length > 0);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-dropdown={testId ?? label}
          data-picked={values.length}
          aria-label={`${label}: ${summary}`}
          title={bare ? label : undefined}
          className={flat ? `${FLAT_DOOR} ${FLAT_OPEN} max-w-[260px]` : 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none max-w-[260px]'}
        >
          {!bare && <span className={flat ? 'text-t11 text-textMuted' : 'text-t9 uppercase tracking-widest text-textMuted'}>{label}</span>}
          <span className={`text-t11 font-semibold truncate ${values.length ? (tone === 'warn' ? 'text-warn' : tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-textPrimary') : 'text-textSecondary'}`} data-tone={values.length && tone ? tone : undefined}>{summary}</span>
          <ChevronDown className="w-3 h-3 text-textMuted shrink-0" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className={`${CARD} p-1.5`} data-dropdown-card={testId ?? label}>
          <DropdownMenu.Label className="px-2 pt-1 pb-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted">{title ?? label}</DropdownMenu.Label>
          {shown.length === 0 ? (
            <div className="px-2 py-3 font-mono text-t10 text-textMuted">Nothing on the page to pick from</div>
          ) : (
            <div className="grid gap-x-2" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(200px, 1fr))` }}>
              {shown.map(g => (
                <div key={g.title} className="min-w-0 flex flex-col gap-0.5 max-h-[420px] overflow-y-auto" data-multi-group={g.title}>
                  <DropdownMenu.Label className="px-2 pt-1 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">{g.title}</DropdownMenu.Label>
                  {g.options.map(o => {
                    const on = picked.has(o.value);
                    return (
                      <DropdownMenu.CheckboxItem
                        key={o.value}
                        checked={on}
                        onCheckedChange={() => toggle(o.value)}
                        onSelect={e => e.preventDefault()}
                        className="flex items-start gap-2.5 px-2 py-1.5 rounded outline-none cursor-pointer text-left transition-colors data-[highlighted]:bg-ink/[0.04]"
                        data-multi-option={o.value}
                      >
                        {/* a tick means where-you-are: holo silver */}
                        <span className={`mt-px inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded-[3px] border ${on ? 'bg-silverFill border-silverFill' : 'border-borderMuted'}`}>
                          {on && <Check className="w-2.5 h-2.5 text-onfoil" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={`min-w-0 truncate font-mono text-t11 font-semibold ${on ? 'text-textPrimary' : 'text-textSecondary'}`}>{o.label}</span>
                            {o.count != null && <span className="ml-auto font-mono text-t9 tnum text-textMuted">{o.count}</span>}
                          </span>
                          {o.hint && <span className="block text-t10 text-textMuted leading-snug truncate">{o.hint}</span>}
                        </span>
                      </DropdownMenu.CheckboxItem>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {values.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-borderSubtle" />
              <DropdownMenu.Item
                onSelect={() => onChange([])}
                className="px-2 py-1.5 rounded outline-none cursor-pointer font-mono text-t10 uppercase tracking-widest text-textSecondary data-[highlighted]:bg-ink/[0.04] data-[highlighted]:text-textPrimary"
                data-multi-clear
              >
                {clearWord}
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

export default DropdownMulti;
