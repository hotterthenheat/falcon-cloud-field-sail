/*
==================================================
  SLAYER TERMINAL - THE VISIT COUNT (core/analytics.ts)

  One measurement tool, Plausible (plausible.io, run
  from the EU): counts visits and pages without a
  cookie and without a profile of anyone — the page,
  the site that sent them, the browser and device
  family, the country. Never a name, an email or an
  address. Chosen 2026-10-10 over an in-house page
  (Noah asked for "a analytics page … in real time";
  the answer was: not ours to build, a service does
  it better for $9 a month).

  THE SWITCH IS THE BUILD'S: `VITE_PLAUSIBLE_DOMAIN`
  names the site (slayerterminal.com) and the script
  loads; blank or absent, nothing loads and nothing
  is counted — development, the checks and every
  build before the domain exists. The privacy page
  reads the same switch, so it says what is true of
  the build it is on (pages/landing/legal/Privacy.tsx).

  Not a visit: the terminal inside the landing's
  window (src/embed.ts), and an automated browser —
  the photographer, the link check, the phone sweep.
==================================================
*/

const named = (import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined)?.trim() ?? '';

/** the site Plausible counts under — blank means the count is off on this build */
export const PLAUSIBLE_DOMAIN: string = named;
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
