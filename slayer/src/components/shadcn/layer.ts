/* What every Slayer overlay shares, beside Radix's own behaviour:

   - THE THEME SCOPE OF A PORTAL. Radix portals into <body>, which wears the PAGE's theme; a menu opened from a dark chart
     host on a light page (Terrain's panes, data-theme="dark") would come up in paper. `scopeTheme` copies the theme of
     the box the overlay was opened from onto the overlay itself: the tokens are re-declared under every [data-theme]
     (theme/tokens.css), so the colours follow without a var() alias. The opener is the trigger Radix points at the
     content (aria-controls / aria-describedby), or the element focused when it opened.
   - FOCUS BACK TO THE OPENER. Radix returns focus to its own Trigger; an overlay opened from somewhere else (a store flag,
     a key, a sidebar row) has none and focus fell to <body>. `useOpener` keeps the element focused when it opened and
     hands it focus back on close.
   - ESCAPE, INNERMOST FIRST, THE HOUSE WAY. The terminal's hand-rolled layers (a toolbar menu inside a dialog, Terrain's
     fullscreen) mark the Escape they took with preventDefault on the document. Radix's own Escape listens in the capture
     phase, before them, so a dialog would close under a menu that should have taken the key. `useLayeredEscape` listens
     where the old overlays did (the document, bubbling), skips a key already taken and takes its own. */

import { useCallback, useEffect, useRef, type Ref, type RefCallback } from 'react';

/** The one ref a component hands out, made of several */
export function composeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return node => {
    for (const r of refs) {
      if (typeof r === 'function') r(node);
      else if (r) (r as { current: T | null }).current = node;
    }
  };
}

/** The element an overlay's content was opened from: the trigger that controls or is described by it */
const openerOf = (el: HTMLElement): Element | null => {
  const ids = [el.id, ...[...el.querySelectorAll('[id]')].slice(0, 4).map(n => n.id)].filter(Boolean);
  for (const id of ids) {
    const q = CSS.escape(id);
    const hit = document.querySelector(`[aria-controls="${q}"], [aria-describedby~="${q}"]`);
    if (hit && !el.contains(hit)) return hit;
  }
  return null;
};

/** Gives `el` the theme of the box it was opened from, where that differs from the page's */
export function scopeTheme(el: HTMLElement | null, anchor?: Element | null): void {
  if (!el) return;
  const from = anchor ?? openerOf(el) ?? (document.activeElement !== document.body ? document.activeElement : null);
  const theme = from?.closest('[data-theme]')?.getAttribute('data-theme') ?? null;
  const page = document.documentElement.getAttribute('data-theme');
  if (theme && theme !== page) el.setAttribute('data-theme', theme);
  else if (el.getAttribute('data-theme') && el.getAttribute('data-theme') !== page) el.removeAttribute('data-theme');
}

/** A ref for an overlay's content that scopes its theme as it mounts */
export const themeScopeRef: RefCallback<HTMLElement> = el => scopeTheme(el);

/**
 * The element focused when `open` turned true, and the handler that gives it focus back as the overlay closes (pass to
 * Radix's onCloseAutoFocus). A Radix Trigger, when there is one, is focused already and is left alone.
 */
export function useOpener(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  if (open && !opener.current && typeof document !== 'undefined') {
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
  }
  const onCloseAutoFocus = useCallback((e: Event) => {
    const el = opener.current;
    opener.current = null;
    if (el && el.isConnected) {
      e.preventDefault();
      el.focus({ preventScroll: true });
    }
  }, []);
  return { opener, onCloseAutoFocus };
}

/**
 * The same for a Radix Dialog, Sheet or AlertDialog content, by its focus events: as it opens (onOpenAutoFocus, before
 * Radix moves focus in) the focused element is the opener; as it closes (onCloseAutoFocus) it gets focus back. Where
 * nothing was focused (a Safari click), Radix's own Trigger takes it.
 */
export function useFocusReturn(): { onOpenAutoFocus: (e: Event) => void; onCloseAutoFocus: (e: Event) => void } {
  const opener = useRef<HTMLElement | null>(null);
  const onOpenAutoFocus = useCallback(() => {
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
  }, []);
  const onCloseAutoFocus = useCallback((e: Event) => {
    const el = opener.current;
    opener.current = null;
    if (el && el.isConnected) {
      e.preventDefault();
      el.focus({ preventScroll: true });
    }
  }, []);
  return { onOpenAutoFocus, onCloseAutoFocus };
}

/**
 * Escape closes, after any layer inside had its say (see the head of this file). Returns the handler for Radix's
 * onEscapeKeyDown: Radix is stood down (its dismiss needs the key unmarked), the key's own preventDefault is watched, and
 * a document listener — bubbling, after every handler inside — closes only if nothing inside took the key. A Radix layer
 * open inside (a menu) is the highest layer and takes Escape itself; this one is never asked.
 */
export function useLayeredEscape(open: boolean, onClose: () => void): (e: KeyboardEvent) => void {
  const close = useRef(onClose);
  close.current = onClose;
  const pending = useRef<KeyboardEvent | null>(null);
  const taken = useRef(false);
  const onEscapeKeyDown = useCallback((e: KeyboardEvent) => {
    taken.current = e.defaultPrevented;
    pending.current = e;
    const mark = Event.prototype.preventDefault.bind(e);
    mark();
    e.preventDefault = () => {
      taken.current = true;
      mark();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pending.current !== e) return;
      pending.current = null;
      if (!taken.current) close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return onEscapeKeyDown;
}
