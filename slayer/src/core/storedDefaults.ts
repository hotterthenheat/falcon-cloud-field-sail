/* Carries a changed default into stored state once, behind a flag, before the app reads anything: key levels off on stored Terrain panes
   and the Pulse board, and a stored 'glacier' pane theme let go to the page default. Saved layouts are never touched. */

const LEVELS_OFF_FLAG = 'slayer_levels_off_v1';
const PANE_THEME_FOLLOWS_FLAG = 'slayer_pane_theme_follows_v1';

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => !!v && typeof v === 'object' && !Array.isArray(v);
const levelsOff = (holder: unknown): void => {
  if (isBag(holder) && isBag(holder.overlays)) holder.overlays.levels = false;
};

const rewrite = (key: string, edit: (parsed: unknown) => void): void => {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const parsed: unknown = JSON.parse(raw);
  edit(parsed);
  localStorage.setItem(key, JSON.stringify(parsed));
};

/** One pass, once, behind its flag */
const once = (flag: string, pass: () => void): void => {
  try {
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, '1');
    pass();
  } catch {
    /* storage off, or a value that will not parse — each page's own loader already copes with both */
  }
};

/** Run before the first render. Safe to call on every load: each pass does its work once. */
export function applyStoredDefaults(): void {
  once(LEVELS_OFF_FLAG, () => {
    rewrite('slayer_terrain_v1', c => {
      if (!isBag(c)) return;
      levelsOff(c);
      if (Array.isArray(c.panes)) c.panes.forEach(levelsOff);
      if (isBag(c.setups)) Object.values(c.setups).forEach(levelsOff);
    });
    rewrite('slayer_pulse_board', cells => {
      if (Array.isArray(cells)) cells.forEach(levelsOff);
    });
  });
  once(PANE_THEME_FOLLOWS_FLAG, () => {
    rewrite('slayer_terrain_v1', c => {
      if (!isBag(c) || !Array.isArray(c.panes)) return;
      c.panes.forEach(p => {
        if (isBag(p) && p.theme === 'glacier') delete p.theme;
      });
    });
  });
}
