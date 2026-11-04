import { Suspense, useLayoutEffect, useRef, type ReactNode } from 'react';
import { UNSAFE_LocationContext, useLocation, useOutlet, NavigationType, type Location } from 'react-router-dom';
import MarkLoad from '../../brand/MarkLoad';
import RouteSkeleton from '../ui/RouteSkeleton';
import { DeskAwakeContext, useDeskAwake } from '../../data/deskAwake';

/** Rooms that stay mounted after the first visit. Settings and the marketing pages do not. */
const KEPT = new Set(['pulse', 'terrain', 'compass', 'weigher', 'practice', 'dossier', 'pinpoint', 'trace']);
/** Subpages kept inside one room, so a trip to the next page does not tear this one down. */
const KEPT_PAGES = 8;

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

function remember(cache: Map<string, Slot>, key: string, slot: Slot, cap: number) {
  cache.delete(key);
  cache.set(key, slot);
  while (cache.size > cap) {
    const oldest = cache.keys().next().value;
    if (oldest == null || oldest === key) break;
    cache.delete(oldest);
  }
}

/** The matched page plus every desk already opened. A hidden desk keeps the element it last drew, so another desk's
    URL cannot retarget it. The desk on screen always draws the live match, in the same place, so it is not remounted. */
export default function DeskKeep() {
  const location = useLocation();
  const outlet = useOutlet();
  const room = roomOf(location.pathname);
  const keep = KEPT.has(room);
  const cache = useRef(new Map<string, Slot>());
  const scrolls = useRef(new Map<string, number>());
  const prev = useRef(room);
  if (keep && outlet) remember(cache.current, room, { location, node: outlet }, 12);

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
          <div key={id} className={active ? 'contents' : 'hidden'} aria-hidden={active ? undefined : true} data-desk-keep={id}>
            <DeskAwakeContext.Provider value={active}>
              <Suspense fallback={active ? (<><MarkLoad /><RouteSkeleton pathname={location.pathname} /></>) : null}>
                <UNSAFE_LocationContext.Provider value={{ location: active ? location : slot.location, navigationType: NavigationType.Pop }}>
                  {active ? outlet : slot.node}
                </UNSAFE_LocationContext.Provider>
              </Suspense>
            </DeskAwakeContext.Provider>
          </div>
        );
      })}
      {!keep ? outlet : null}
    </>
  );
}

/** The subpages of one desk. The one on screen is live; the ones already opened stay mounted and hidden. */
export function KeepOutlet({ fallback }: { fallback?: ReactNode }) {
  const location = useLocation();
  const outlet = useOutlet();
  const cache = useRef(new Map<string, Slot>());
  const path = location.pathname;
  if (outlet) remember(cache.current, path, { location, node: outlet }, KEPT_PAGES);
  const slots = [...cache.current.entries()];
  const deskAwake = useDeskAwake();
  if (!slots.length) return fallback ? <>{fallback}</> : null;
  return (
    <>
      {slots.map(([id, slot]) => {
        const active = id === path;
        return (
          <div key={id} className={active ? 'contents' : 'hidden'} aria-hidden={active ? undefined : true} data-page-keep={id}>
            <DeskAwakeContext.Provider value={deskAwake && active}>
              <UNSAFE_LocationContext.Provider value={{ location: active ? location : slot.location, navigationType: NavigationType.Pop }}>
                <Suspense fallback={active ? fallback : null}>{active ? outlet : slot.node}</Suspense>
              </UNSAFE_LocationContext.Provider>
            </DeskAwakeContext.Provider>
          </div>
        );
      })}
    </>
  );
}
