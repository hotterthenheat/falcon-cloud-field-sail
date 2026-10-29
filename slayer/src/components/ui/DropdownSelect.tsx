/* One choice from a short list: a labelled trigger and a card with a check on the current choice and optional hints.
   Radix DropdownMenu supplies keyboard, focus, dismissal, typeahead and placement. */

import { Fragment, type CSSProperties } from 'react';
import { FLAT_DOOR, FLAT_OPEN } from './flatDoor';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { Tip } from './Tooltip';

const SILVER = 'rgb(var(--silver))'; /* the silver token (deep steel on the light theme) */

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
  /** One line under the label — what picking this means */
  hint?: string;
  /** A directional choice (calls/puts, bullish/bearish) washes green or red under the pointer and its word takes the
      ink; non-directional choices keep the plain wash. */
  tone?: 'bull' | 'bear';
  /** A choice meaning "none" ("Not said"): the trigger prints it in the secondary ink, so a set choice reads as set */
  quiet?: boolean;
  /** A section name: rows sharing it stand under one heading, in order; rows without one stand above the first */
  group?: string;
  /** A row that belongs to the row above it — set in a step */
  indent?: boolean;
  /** Shown, never picked (the Legs card's "Both" on the calendar) — the keys pass over it */
  disabled?: boolean;
  /** The trigger's words when this row is chosen, where the row says more than the line of cards has room for (the
      Strikes card: "±20" on the trigger, "20 each side" in the row) — defaults to the label */
  short?: string;
}

/* whole class strings, so Tailwind sees them */
const ROW_WASH = {
  plain: 'data-[highlighted]:bg-ink/[0.06] data-[highlighted]:text-textPrimary',
  bull: 'data-[highlighted]:bg-bull/[0.12] data-[highlighted]:text-bull',
  bear: 'data-[highlighted]:bg-bear/[0.12] data-[highlighted]:text-bear',
} as const;

interface DropdownSelectProps<T extends string | number> {
  /** The control's name, printed small before the current choice */
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  /** A heading inside the card; defaults to the label */
  title?: string;
  align?: 'start' | 'end';
  /** A glyph before the label, in the muted ink */
  icon?: LucideIcon;
  /** The glyph's colour on hover and while open (the sidebar's rule) */
  ink?: string;
  /** A data-* hook for probes */
  testId?: string;
  /** Trigger height: 28 by default; `sm` is 24, for a 32px card head */
  size?: 'md' | 'sm';
  /** Hide the printed name on a line too short for it; it stays in the tooltip, aria-label and open card heading. */
  bare?: boolean;
  /** The name shown only from this breakpoint up — a tight head keeps the choice and its icon, the name in the title */
  labelFrom?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** The flat control (ui/flatDoor.ts): tracked capitals, no edge, a wash under the pointer */
  flat?: boolean;
}

const LABEL_FROM: Record<NonNullable<DropdownSelectProps<string>['labelFrom']>, string> = { sm: 'hidden sm:inline', md: 'hidden md:inline', lg: 'hidden lg:inline', xl: 'hidden xl:inline', '2xl': 'hidden 2xl:inline' };

/** The card every dropdown on the terminal opens — one surface, one shadow, one radius */
export const CARD = 'z-[90] rounded-lg border border-borderSubtle bg-chip shadow-[0_16px_48px_rgba(0,0,0,0.65)] animate-soft-in';

const DropdownSelect = <T extends string | number>({ label, value, options, onChange, title, align = 'start', icon: Icon, ink, testId, size = 'md', bare = false, labelFrom, flat = false }: DropdownSelectProps<T>) => {
  const current = options.find(o => o.value === value);
  const tip = bare || labelFrom ? (title ? `${label} — ${title}` : label) : title;
  return (
    <DropdownMenu.Root modal={false}>
      <Tip label={tip}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            data-dropdown={testId ?? label}
            aria-label={`${label}: ${current?.short ?? current?.label ?? ''}`}
            className={
            flat
              ? `${FLAT_DOOR} ${FLAT_OPEN} group max-w-full text-left`
              : `group inline-flex items-center gap-1.5 ${size === 'sm' ? 'h-6 px-2' : 'h-7 px-2.5'} rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none`
          }
          style={ink ? ({ '--ink': ink } as CSSProperties) : undefined}
        >
          {Icon && (
            <Icon
              className={`w-3 h-3 shrink-0 transition-colors duration-200 ${ink ? 'text-textMuted group-hover:text-ink group-data-[state=open]:text-ink' : 'text-textMuted'}`}
              aria-hidden="true"
              data-dropdown-icon
            />
          )}
          {!bare && <span className={`shrink-0 ${flat ? 'text-t11' : 'text-t9 uppercase tracking-widest'} text-textMuted ${labelFrom ? LABEL_FROM[labelFrom] : ''}`}>{label}</span>}
          {/* min-w-0 + truncate: in a phone's two-column cards line the card is as wide as its cell, and a long value gives before the card does */}
          {/* the trigger wears the choice's tone, as its row did */}
          <span className={`min-w-0 truncate text-t11 font-semibold ${current?.tone === 'bull' ? 'text-bull' : current?.tone === 'bear' ? 'text-bear' : current?.quiet ? 'text-textSecondary' : 'text-textPrimary'}`} data-tone={current?.tone ?? (current?.quiet ? 'quiet' : undefined)}>
            {current?.short ?? current?.label ?? '—'}
          </span>
          <ChevronDown className="w-3 h-3 shrink-0 text-textMuted" />
        </button>
      </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        {/* a long list scrolls inside the card rather than running off a short screen */}
        <DropdownMenu.Content align={align} sideOffset={6} collisionPadding={12} className={`${CARD} min-w-[220px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto p-1.5`} data-dropdown-card={testId ?? label}>
          <DropdownMenu.Label className="px-2 pt-1 pb-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted">{title ?? label}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={String(value)}
            onValueChange={v => {
              const hit = options.find(o => String(o.value) === v);
              if (hit) onChange(hit.value);
            }}
          >
            {options.map((o, i) => (
              <Fragment key={String(o.value)}>
                {o.group && o.group !== options[i - 1]?.group && (
                  <DropdownMenu.Label className={`px-2 pt-2 pb-1 text-t11 font-semibold text-textSecondary ${i > 0 ? 'mt-1 border-t border-borderSubtle' : ''}`} data-dropdown-group={o.group}>
                    {o.group}
                  </DropdownMenu.Label>
                )}
              <DropdownMenu.RadioItem
                value={String(o.value)}
                disabled={o.disabled}
                data-tone={o.tone}
                className={`group flex items-start gap-2 rounded-md px-2 py-1.5 outline-none text-textSecondary ${o.indent ? 'pl-5' : ''} ${o.disabled ? 'cursor-default text-textMuted' : `cursor-pointer ${ROW_WASH[o.tone ?? 'plain']}`} data-[state=checked]:text-textPrimary transition-colors`}
              >
                <span className="mt-[2px] w-3 h-3 shrink-0 flex items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check className="w-3 h-3" style={{ color: SILVER }} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="flex flex-col gap-[1px] min-w-0">
                  <span className="font-mono text-t11 leading-snug group-data-[state=checked]:font-semibold">{o.label}</span>
                  {o.hint && <span className="font-mono text-t9 leading-snug text-textMuted">{o.hint}</span>}
                </span>
              </DropdownMenu.RadioItem>
              </Fragment>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

export default DropdownSelect;
