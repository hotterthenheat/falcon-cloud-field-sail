import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/*
==================================================
  SLAYER TERMINAL - A MENU THAT OPENS ON THE HOVER (ui/useHoverOpen.ts)

  Noah, 2026-10-31: "the layout and candle buttons should have the dropdown on the hover so no click is needed". The
  pointer resting on the trigger opens the menu after a short intent wait; leaving the trigger AND the menu closes it
  after a grace long enough to cross the gap between them (the menu is a portal, so the two are not one DOM subtree —
  one timer is shared by both). A click still toggles as before.

  Two guards. TOUCH never hover-opens (a tap would open on enter and close on the click that follows). TEXT ENTRY IN
  THE MENU holds it open — a reader who clicked the desk-name input and moved the mouse away to type must not lose the
  menu under their hands; it then closes the old way, on an outside press or Escape. Only text entry: a row pressed
  (a switch flipped) also leaves focus in the menu, and that must still close when the pointer leaves.
==================================================
*/

const OPEN_AFTER_MS = 80;
const CLOSE_AFTER_MS = 220;

type Handlers = { onPointerEnter?: (e: ReactPointerEvent) => void; onPointerLeave?: (e: ReactPointerEvent) => void };

export function useHoverOpen(
  enabled: boolean,
  setOpen: (open: boolean) => void,
  menuRef: RefObject<HTMLElement | null>
): { trigger: Handlers; menu: Handlers } {
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clear, []);
  if (!enabled) return { trigger: {}, menu: {} };
  const mouse = (e: ReactPointerEvent) => e.pointerType !== 'touch';
  const enterTrigger = (e: ReactPointerEvent) => {
    if (!mouse(e)) return;
    clear();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setOpen(true);
    }, OPEN_AFTER_MS);
  };
  const leave = (e: ReactPointerEvent) => {
    if (!mouse(e)) return;
    clear();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const f = document.activeElement;
      if (f && menuRef.current?.contains(f) && f.matches('input, textarea, [contenteditable]')) return;
      setOpen(false);
    }, CLOSE_AFTER_MS);
  };
  const enterMenu = (e: ReactPointerEvent) => {
    if (!mouse(e)) return;
    clear();
  };
  return { trigger: { onPointerEnter: enterTrigger, onPointerLeave: leave }, menu: { onPointerEnter: enterMenu, onPointerLeave: leave } };
}
