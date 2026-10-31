/* A click on a rail link to a page whose code is not here yet keeps the current page on screen while the code
   arrives, then moves: no blank frame and no skeleton flash between two loaded pages. A thin bar at the top says
   it is on its way. Links elsewhere move at once (their page's skeleton has the page's shape). */

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAccount } from '../../data/account';
import { loadRoute, routeReady, warmIdle, warmPath } from '../../data/warmRooms';
import { stopRoomData, warmRoomData } from '../../data/warmData';
import { ensureRate } from '../../data/rateFeed';
import { ensureHolidays } from '../../data/holidayFeed';
import { useTicker } from '../../context/MarketDataContext';

const HELD = '[data-sidenav] a[href], [data-mobile-menu] a[href], [data-route-hold] a[href]';
/** Past this the move happens anyway and the page's skeleton takes over */
const MAX_HOLD_MS = 4000;

export default function RouteHold() {
  const navigate = useNavigate();
  const [holding, setHolding] = useState(false);
  const seq = useRef(0);
  const account = useAccount();
  /* the rooms' code at idle, for a reader inside the terminal (signed in, or no account service) — code only */
  useEffect(() => {
    if (account.status === 'in' || account.status === 'off') warmIdle();
  }, [account.status]);
  /* and the other rooms' first-paint data for the name in view, once this page has had its own (data/warmData.ts) */
  const { activeTicker } = useTicker();
  const { pathname } = useLocation();
  useEffect(() => {
    if (account.status === 'in' || account.status === 'off') warmRoomData(activeTicker, pathname);
  }, [activeTicker, pathname, account.status]);
  useEffect(() => stopRoomData, []);
  /* the reference every priced contract needs, on any page that may ask for it: today's rate (data/rateFeed.ts) and the
     year's holidays (data/holidayFeed.ts) — each one shared read a day on the server; a page that may not ask keeps the
     last rate this browser read and the holiday table */
  useEffect(() => {
    if (account.status !== 'in' && account.status !== 'off') return;
    ensureRate();
    ensureHolidays();
  }, [pathname, account.status]);
  /* any link in the shell: its page's code on pointer or focus, ahead of the click */
  useEffect(() => {
    const onIntent = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      const href = a?.getAttribute('href') ?? '';
      if (href.startsWith('/') && !href.startsWith('//')) warmPath(href);
    };
    document.addEventListener('pointerover', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent);
    return () => {
      document.removeEventListener('pointerover', onIntent);
      document.removeEventListener('focusin', onIntent);
    };
  }, []);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.(HELD) as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//')) return;
      if (routeReady(href)) return;
      const here = window.location.pathname;
      /* a row of the section you are in folds its tree rather than leaving: let the rail handle it */
      if (href !== '/' && here.startsWith(href) && a.hasAttribute('aria-expanded')) return;
      e.preventDefault();
      e.stopPropagation();
      const mine = ++seq.current;
      setHolding(true);
      const go = () => {
        if (mine !== seq.current) return;
        seq.current += 1;
        setHolding(false);
        navigate(href);
      };
      const cap = window.setTimeout(go, MAX_HOLD_MS);
      void loadRoute(href).then(() => {
        window.clearTimeout(cap);
        go();
      });
    };
    /* capture: ahead of the router's own link handler */
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);
  if (!holding) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[95] h-[2px] overflow-hidden" role="progressbar" aria-label="Opening the page" data-route-hold-bar>
      <div className="h-full w-1/3 bg-select/80 animate-route-hold" />
    </div>
  );
}
