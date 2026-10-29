/* Swaps the SVG favicon to the mark's state (one attribute write per change); the PNG and touch icons stay still. */

import { useEffect } from 'react';
import { useMarkState, type MarkState } from './markState';
import { markSvg, svgDataUrl } from './iconSvg';

const cache = new Map<MarkState, string>();
const urlFor = (state: MarkState): string => {
  let url = cache.get(state);
  if (!url) {
    url = svgDataUrl(markSvg({ state, theme: 'dark' }));
    cache.set(state, url);
  }
  return url;
};

/** Keeps the tab icon on the mark's state; mounted once at the root. */
export function useFaviconFollowsMark(): void {
  const state = useMarkState();
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (!link) return;
    const next = urlFor(state);
    if (link.href !== next) link.href = next;
  }, [state]);
}

/** The hook as an element for the root's provider list. */
export const FaviconFollowsMark = (): null => {
  useFaviconFollowsMark();
  return null;
};
