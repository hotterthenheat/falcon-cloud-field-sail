import { useId } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import { useResolvedTheme } from '../../theme/theme';
import { ToggleGroup, ToggleGroupItem } from '../shadcn/toggle-group';

interface FilterTabsProps<V extends string> {
  /** THE GROUND THE RAIL STANDS ON (2026-10-17): a rail inside chart chrome wears the CHART's ground, not the page's —
      a light page with a dark tape has a dark panel, and the pill there is the holo, not the galaxy. Left out, the
      rail follows the page's theme. */
  paper?: boolean;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel?: string;
  /** 'sm': tighter pills for a narrow host (a pane's side panel); the default is unchanged */
  size?: 'md' | 'sm';
}

/** Soft tab strip (shadcn grammar): sentence-case labels in a faint grouped
    rail, the active option inverted to a solid white pill with black text —
    "white = where you are" at full contrast, without boxes or dividers.
    The pill is the TEXT ink and its label the PANEL's ground (#0a0a0a on the
    dark terminal — the value that was typed, so nothing moved there), both tokens: on
    paper the pill is black and the label white. The label was a typed
    #0a0a0a — black on the black pill, "the active one you cant even see"
    (Noah, 2026-09-19, the Tracker).
    The pill GLIDES between options (shared-layout), never teleports. */
const FilterTabs = <V extends string>({ options, value, onChange, ariaLabel, paper: paperProp, size = 'md' }: FilterTabsProps<V>) => {
  const scope = useId(); // isolates the pill from other FilterTabs instances
  /* THE PILL WEARS THE HOLO (Noah, 2026-10-15, on the panel's Ladder · Net · GEX: "let the active one have our changing
     holo silver color"): where-you-are is the silver since 2026-10-13, and the living foil is its moving face — the
     house's pairing, dark words on the foil on the dark terminal, the galaxy ink with light words on paper */
  const pagePaper = useResolvedTheme() === 'light';
  const paper = paperProp ?? pagePaper;

  /* THE STRIP IS A RADIO SET (shadcn ToggleGroup, 2026-11-01): one tab stop; the arrows walk the options, Space or Enter
     chooses (role radio, aria-checked). A press on the chosen one keeps it — the strip always holds a choice. */
  return (
    <LayoutGroup id={scope}>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={v => {
          if (v && v !== value) onChange(v as V);
        }}
        aria-label={ariaLabel}
        className="inline-flex items-center gap-0.5 rounded-lg bg-ink/[0.04] p-0.5"
        data-filter-tabs
      >
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <ToggleGroupItem key={opt.value} value={opt.value} bare size={size === 'sm' ? 'sm' : 'md'} className="text-textPrimary hover:text-textPrimary">
              {active && (
                /* THE GLIDE RUNS ONLY WHEN THE CHOICE CHANGES (Noah, 2026-10-15, dragging Terrain's panel: "the button
                   active looks delayed and doesnt drag with the button"): a shared-layout pill animates EVERY layout
                   change, so a rail moving under a drag started a 300ms glide on each pointer move and the pill trailed
                   its button across the screen; keyed to the value, the pill sits still in its button while the rail
                   moves and glides only between options */
                <motion.span
                  layoutId="filter-pill"
                  layoutDependency={value}
                  className={`absolute inset-0 rounded-md shadow-sm shadow-black/40 ${paper ? 'galaxy-bg' : 'holo-bg'} foil-glide`}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
              {/* a label never breaks in two inside its pill (the journal's periods at 375, 2026-09-26): a rail too wide for its row scrolls in the host's box */}
              <span className={`relative z-10 whitespace-nowrap ${active ? `font-semibold ${paper ? 'text-panel' : 'text-onfoil'}` : 'text-textSecondary hover:text-textPrimary'}`}>
                {opt.label}
              </span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </LayoutGroup>
  );
};

export default FilterTabs;
