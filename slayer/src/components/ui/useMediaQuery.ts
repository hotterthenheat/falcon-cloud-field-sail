import { useEffect, useState } from 'react';

/*
  Media queries from JavaScript, for mounting something else below a width (CSS hiding still mounts and runs the
  hidden layout's charts and subscriptions; a JS branch never builds the other side).
*/

/**
 * A phone, the device rather than a narrow window: `(max-width: 767.98px)` (Tailwind's md floor; .98 so fractional
 * widths never fall between this and `md:`) or `(pointer: coarse) and (max-height: 540px)`, a phone in landscape
 * (375-440px tall; the smallest landscape tablet is 744).
 */
const PHONE_QUERY = '(max-width: 767.98px), (pointer: coarse) and (max-height: 540px)';

/** Whether `query` matches now, kept current as the window changes. */
export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';

  // Read on the FIRST render, not in an effect. Seeding `false` and correcting
  // afterwards would mount the wide layout for one frame on every phone —
  // and for a layout that builds charts, one frame is a full chart create and
  // destroy before the right one is even asked for.
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supported) return;
    const mql = window.matchMedia(query);
    // Re-read on subscribe rather than trusting the render-time value: the
    // window can be resized between that read and this effect, and the change
    // event only fires for crossings AFTER the listener is attached, so a
    // crossing inside that gap would otherwise be lost until the next one.
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query, supported]);

  return matches;
}

/** A handset, in either orientation — or any window too narrow for a desk. */
export const useIsPhone = (): boolean => useMediaQuery(PHONE_QUERY);

/** Below Tailwind's `lg` (1024), where Terrain becomes a scrolling column; fractional bound as PHONE_QUERY. */
const BELOW_LG_QUERY = '(max-width: 1023.98px)';
export const useIsBelowLg = (): boolean => useMediaQuery(BELOW_LG_QUERY);
/** Under 1280 wide the desk pages (Terrain's panes, the Weigher's chain, Compare's wings) take their stacked shape;
    `lg` stays for everything else. */
const BELOW_XL_QUERY = '(max-width: 1279.98px)';
export const useIsBelowXl = (): boolean => useMediaQuery(BELOW_XL_QUERY);
/** A tall screen that is not a phone — the portrait monitor, a tablet upright: the desks say they stack on purpose */
const PORTRAIT_DESK_QUERY = '(orientation: portrait) and (min-width: 768px)';
export const useIsPortraitDesk = (): boolean => useMediaQuery(PORTRAIT_DESK_QUERY);
