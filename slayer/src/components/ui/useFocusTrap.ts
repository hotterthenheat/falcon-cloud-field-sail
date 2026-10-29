import { useEffect, useRef, type RefObject } from 'react';

/*
  Keeps keyboard focus inside an open overlay and returns it on close. It remembers the opener (in a ref, so a re-run
  effect cannot capture an element inside the overlay), moves focus in (first focusable child, else the container,
  hence tabIndex={-1} on it), wraps Tab and Shift+Tab at both ends, and on close refocuses the opener if it is still
  in the document. Keydown is captured on `document`, so an overlay's own key handlers cannot swallow Tab first.
*/

/* every branch excludes tabindex="-1": `button:not([disabled])` alone matches untabbable buttons, which pushed `last`
  far from the real end and let focus escape */
const FOCUSABLE = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>): void {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const container = ref.current;
    if (!container) return undefined;

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    /* Rendered ones only — a zero-box control is not somewhere focus can
       usefully land, and a collapsed section full of them would otherwise
       make Tab appear to do nothing. */
    const inside = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
      );

    if (!container.contains(document.activeElement)) {
      const first = inside()[0];
      (first ?? container).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = inside();
      if (list.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const here = document.activeElement;
      if (!container.contains(here)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && here === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [active, ref]);
}

export default useFocusTrap;
