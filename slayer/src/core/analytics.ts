/* Plausible (EU-hosted) counts visits without cookies or profiles. `VITE_PLAUSIBLE_DOMAIN` switches it on (blank: nothing loads),
   and the privacy page reads the same switch. Not counted: the landing's embedded terminal and automated browsers. */

const named = (import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined)?.trim() ?? '';

/** the site Plausible counts under — blank means the count is off on this build */
const PLAUSIBLE_DOMAIN: string = named;
export const ANALYTICS_ON: boolean = named.length > 0;

/** Loads the script once, at boot, when the build names the site. Plausible's script follows the router on its own
    (it listens for pushState), so every page change is a page view with nothing more from us. */
export function bootAnalytics(): void {
  if (!ANALYTICS_ON || typeof document === 'undefined') return;
  try {
    if (window.self !== window.top) return;
    if (navigator.webdriver) return;
    if (document.querySelector('script[data-domain]')) return;
  } catch {
    return;
  }
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://plausible.io/js/script.js';
  s.dataset.domain = PLAUSIBLE_DOMAIN;
  document.head.appendChild(s);
}
