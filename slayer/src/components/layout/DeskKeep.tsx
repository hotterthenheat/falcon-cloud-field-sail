import { Suspense, useLayoutEffect, useRef, type ReactNode } from 'react';
import { UNSAFE_LocationContext, useLocation, useOutlet, NavigationType, type Location } from 'react-router-dom';
import MarkLoad from '../../brand/MarkLoad';
import RouteSkeleton from '../ui/RouteSkeleton';

/** Rooms that stay mounted after the first visit. Settings and the marketing pages do not. */
const KEPT = new Set(['pulse', 'terrain', 'compass', 'weigher', 'practice', 'dossier', 'pinpoint', 'trace']);

function roomOf(pathname: string): string {
  const s = pathname.split('/')[1] || 'root';
  if (s === 'paper' || s === 'review') return 'practice';
  if (s === 'record' || s === 'stocks' || s === 'news' || s === 'newsroom' || s === 'earnings') return 'dossier';
  if (s === 'watchlist') return 'weigher';
  if (s === 'tracker' || s === 'auditor-log' || s === 'skys-vision') return 'compass';
  if (s === 'live-terminal' || s === 'workspace' || s === 'home') return 'pulse';
  if (s === 'liquidity' || s === 'flow-desk') return 'trace';
  if (s === 'pinpoint-gex') return 'pinpoint';
  return s;
}

interface Slot {
  location: Location;
  node: ReactNode;
}

/**
 * The matched page, plus every desk already opened.
 * Hidden desks keep their React state. Their location is frozen so a live
 * URL on another desk cannot retarget their hooks. The shell's own routes
 * stay the source of the match.
 */
export default function DeskKeep() {
  const location = useLocation();
  const outlet = useOutlet();
  const room = roomOf(location.pathname);
  const keep = KEPT.has(room);
  const cache = useRef(new Map<string, Slot>());
  const scrolls = useRef(new Map<string, number>());
  const prev = useRef(room);
  if (keep && outlet) {
    const had = cache.current.get(room);
    const same = had && had.location.pathname === location.pathname && had.location.search === location.search && had.location.hash === location.hash;
    if (!same) cache.current.set(room, { location, node: outlet });
  }

  useLayoutEffect(() => {
    const el = document.querySelector('main');
    if (!el || prev.current === room) return;
    scrolls.current.set(prev.current, el.scrollTop);
    const next = scrolls.current.get(room) ?? 0;
    prev.current = room;
    el.scrollTop = next;
  }, [room]);

  const slots = [...cache.current.entries()];
  return (
    <>
      {slots.map(([id, slot]) => {
        const active = keep && id === room;
        return (
          <div key={id} className={active ? 'contents' : 'hidden'} aria-hidden={active ? undefined : true}>
            <Suspense fallback={active ? (<><MarkLoad /><RouteSkeleton pathname={slot.location.pathname} /></>) : null}>
              <UNSAFE_LocationContext.Provider value={{ location: active ? location : slot.location, navigationType: NavigationType.Pop }}>
                {slot.node}
              </UNSAFE_LocationContext.Provider>
            </Suspense>
          </div>
        );
      })}
      {!keep ? outlet : null}
    </>
  );
}
