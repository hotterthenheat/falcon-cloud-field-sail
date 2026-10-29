import { useEffect, useState } from 'react';

/* Media queries in JS, to mount something else below a width (CSS hiding would still mount the hidden layout's charts). */

/** A phone, not a narrow window: under Tailwind's md (767.98 so fractional widths never fall between),
    or a coarse pointer under 540 px tall (a phone in landscape). */
const PHONE_QUERY = '(max-width: 767.98px), (pointer: coarse) and (max-height: 540px)';

/** Whether `query` matches now, kept current as the window changes. */
export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';

  // Read on the first render: seeding false would mount the wide layout for one frame on every phone, a full chart create and destroy.
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supported) return;
    const mql = window.matchMedia(query);
    // Re-read on subscribe: a resize between render and effect fires no change event.
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
