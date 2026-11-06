import { useId } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import { Tabs, TabsList, TabsTrigger } from '../shadcn/tabs';

/** The child tab tier, for controls inside a panel (page-level switches use FilterTabs): mono caps with a white
    hairline that glides between tabs. On paper every tab is black and the current one has a thicker rule; `tabRest`
    and `--tab-rule` are tokens, so a tab inside a dark chart on a light page keeps the dark set.
    A TAB STRIP (shadcn Tabs, 2026-11-01): one tab stop, the arrows, Home and End walk the tabs, Space or Enter chooses
    (role tablist / tab, aria-selected). The panels are the host's own, so a tab names no panel. */
const CardTabs = <V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'sm',
}: {
  /** `disabled`: the tab stands, greyed, and says why in its `title` (a tab that cannot act yet never looks live) */
  options: readonly { value: V; label: string; disabled?: boolean; title?: string }[];
  value: V;
  onChange: (v: V) => void;
  ariaLabel?: string;
  /** `title`: the tabs as a box's title, in the title's face (15px semibold), the rule under the current one */
  size?: 'sm' | 'title';
}) => {
  const scope = useId(); // isolates the line from other CardTabs instances
  return (
    <LayoutGroup id={scope}>
      <Tabs
        value={value}
        onValueChange={v => {
          const hit = options.find(o => o.value === v);
          if (hit && !hit.disabled && v !== value) onChange(hit.value);
        }}
        activationMode="manual"
        className="contents"
      >
        {/* flex-wrap: tabs that do not fit fold to a second line; the hairline follows the tab */}
        <TabsList aria-label={ariaLabel} className="inline-flex items-center gap-4 flex-wrap">
          {options.map(opt => {
            const active = opt.value === value;
            return (
              <TabsTrigger
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                aria-controls={undefined}
                title={opt.title}
                /* hit-24: the tab's hit area reaches 24px at a desk and 44 on a phone; the drawn tab is unchanged. The
                   strip draws its own gliding rule, so the shadcn tab's static one is off (after:hidden). */
                className={
                  size === 'title'
                    ? 'hit-24 relative pt-0 pb-0.5 font-sans normal-case tracking-normal text-t15 font-semibold leading-tight transition-colors after:hidden disabled:opacity-100'
                    : 'hit-24 relative py-1 font-mono text-t10 uppercase tracking-widest transition-colors after:hidden disabled:opacity-100'
                }
              >
                <span className={active ? 'text-textPrimary' : opt.disabled ? 'text-textMuted opacity-50 cursor-not-allowed' : 'text-tabRest hover:text-textPrimary'}>{opt.label}</span>
                {active && (
                  <motion.span
                    layoutId="card-tab-line"
                    className="absolute left-0 right-0 bottom-0 h-[var(--tab-rule)] bg-textPrimary"
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </LayoutGroup>
  );
};

export default CardTabs;
