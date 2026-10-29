import { useEffect, useRef, type RefObject } from 'react';

/* Keeps focus inside an open overlay (Tab and Shift+Tab wrap) and returns it to the opener on close. Keydown is captured
   on `document` so the overlay's own handlers cannot swallow Tab; the container needs tabIndex={-1} as a fallback target. */

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

function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>): void {
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
