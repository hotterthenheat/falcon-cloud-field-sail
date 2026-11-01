import { useLayoutEffect, useRef, useState } from 'react';

/*
==================================================
  SLAYER TERMINAL - A MENU STAYS IN ITS PANE (components/ui/useMenuBounds.ts)

  The partner tree's (Noah, 2026-10-19, a rail's calendar open over the neighbouring pane on a two-up desk: "calendar
  needs to stay within the side its being activated on"). The house's Radix cards keep their menus inside the WINDOW
  (collisionPadding) and nothing else; on a desk of several panes a menu opened at a pane's right edge ran over the
  next pane's chart. A box that wants its menus kept inside it carries `data-menu-bounds` (Terrain's pane). A card
  puts this hook's ref on its trigger and hands the element found to Radix as `collisionBoundary` — the menu shifts
  along its side to stay inside that box, or flips. No such ancestor, no boundary: the window's edges as before.
==================================================
*/

export function useMenuBounds<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [bounds, setBounds] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setBounds(ref.current?.closest('[data-menu-bounds]') ?? null);
  }, []);
  return { ref, bounds: bounds ?? undefined };
}
