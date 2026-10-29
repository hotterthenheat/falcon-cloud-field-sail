import { useId } from 'react';
import { LayoutGroup, motion } from 'framer-motion';

/** The child tab tier, for controls inside a panel (page-level switches use FilterTabs): mono caps with a white
    hairline that glides between tabs. On paper every tab is black and the current one has a thicker rule; `tabRest`
    and `--tab-rule` are tokens, so a tab inside a dark chart on a light page keeps the dark set. */
const CardTabs = <V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'sm',
}: {
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  ariaLabel?: string;
  /** `title`: the tabs as a box's title, in the title's face (15px semibold), the rule under the current one */
  size?: 'sm' | 'title';
}) => {
  const scope = useId(); // isolates the line from other CardTabs instances
  return (
    <LayoutGroup id={scope}>
      {/* flex-wrap: tabs that do not fit fold to a second line; the hairline follows the tab */}
      <div role="group" aria-label={ariaLabel} className="inline-flex items-center gap-4 flex-wrap">
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={size === 'title' ? 'relative pb-0.5 text-t15 font-semibold leading-tight transition-colors' : 'relative py-1 font-mono text-t10 uppercase tracking-widest transition-colors'}
            >
              <span className={active ? 'text-textPrimary' : 'text-tabRest hover:text-textPrimary'}>{opt.label}</span>
              {active && (
                <motion.span
                  layoutId="card-tab-line"
                  className="absolute left-0 right-0 bottom-0 h-[var(--tab-rule)] bg-textPrimary"
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
};

export default CardTabs;
