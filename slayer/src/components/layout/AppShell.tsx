import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SideNav from './SideNav';
import SiteFooter from './SiteFooter';
import RouteSkeleton from '../ui/RouteSkeleton';
import { PlanGate } from './PlanWall';
import MarkLoad from '../../brand/MarkLoad';
import EditorDockGate from '../scripts/EditorDockGate';
import ScrollHome from './ScrollHome';
import DeskKeep from './DeskKeep';
import WayBack from './WayBack';
import { OPEN_PALETTE_EVENT } from './paletteDoor';
import { FaultView, isLoadFault, reloadOnceForStaleBuild } from '../ui/Fault';
import { openFeeds } from '../../data/feedGate';
import { noteRouteShown } from '../../data/warmRooms';
import RouteHold from './RouteHold';

/* Loaded after the shell paints, on terminal pages only: the alert engine, the drawers, the paper runner. The palette
   (and the ticker universe it searches) loads the first time it is opened. */
const AlertsDrawer = lazy(() => import('../alerts/AlertsDrawer'));
const WatchlistDrawer = lazy(() => import('./WatchlistDrawer'));
const AlertWatcher = lazy(() => import('../alerts/AlertWatcher'));
const AlertToasts = lazy(() => import('../alerts/AlertToasts'));
const PaperRunner = lazy(() => import('../paper/PaperRunner'));
const CommandPalette = lazy(() => import('./CommandPalette'));

/** A page crash renders a fault panel instead of a blank shell. It resets on navigation through resetKey,
    not a React key, so a subpage change does not remount the whole section. */
class RouteBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prevProps: { resetKey: string }) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }
  componentDidCatch(error: Error) {
    /* a chunk from a previous deploy: reload once rather than show a fault */
    if (isLoadFault(error) && navigator.onLine !== false) reloadOnceForStaleBuild();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <FaultView
        error={this.state.error}
        scope="page"
        back={
          <Link to="/pulse" onClick={() => this.setState({ error: null })} className="inline-flex items-center h-10 px-4 rounded-md border border-borderMuted text-t125 font-medium text-textPrimary hover:bg-ink/[0.05]">
            Back to Pulse
          </Link>
        }
      />
    );
  }
}

const AppShell = () => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  const location = useLocation();

  const openPalette = useCallback(() => {
    setPaletteLoaded(true);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  /* the paid-data feeds open while the shell is mounted; opened during render so the pages' first effects may call */
  const closeFeeds = useRef<(() => void) | null>(null);
  if (!closeFeeds.current) closeFeeds.current = openFeeds();
  useEffect(() => {
    if (!closeFeeds.current) closeFeeds.current = openFeeds();
    return () => {
      closeFeeds.current?.();
      closeFeeds.current = null;
    };
  }, []);

  /* THE TEXT FLOOR: inside the terminal no type step is under 11px (index.css html[data-type-floor]); on <html>, so the
     drawers, menus and toasts in portals meet it too. Set before the first paint; the site pages keep their sizes. */
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-type-floor', '');
    return () => root.removeAttribute('data-type-floor');
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteLoaded(true);
        setPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    /* a page may offer the palette as a button (paletteDoor.ts) */
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, openPalette);
    };
  }, [openPalette]);

  /* the page on screen counts as loaded, so a later click back to it never waits */
  useEffect(() => noteRouteShown(location.pathname), [location.pathname]);
  /* the last page shown in this tab, for addresses that are drawers, not pages (/alerts in App.tsx) */
  useEffect(() => {
    try {
      sessionStorage.setItem('slayer.lastPage', `${location.pathname}${location.search}`);
    } catch {
      /* no storage: those addresses open on Pulse */
    }
  }, [location.pathname, location.search]);

  /* the chart pages are framed to the viewport from md up; on a phone their board and panes stack, so they scroll like
     every other page (overflow-hidden there clipped Net Flow's pane and the 0DTE desk) */
  const bleedPage = /^\/trace\/(net-flow|odte)/.test(location.pathname);

  return (
    /* h-dvh: on a phone 100vh excludes the address bar, and this frame never lets the document scroll */
    <div className="h-screen h-dvh flex flex-row bg-canvas text-textPrimary overflow-hidden">
      <RouteHold />
      <SideNav onOpenPalette={openPalette} />
      {/* Trace pages reserve the scrollbar gutter so switching between them never changes the page width */}
      <main
        /* max-md:pt-12 clears the fixed phone strip (SideNav, h-12) */
        className={`flex-1 min-w-0 min-h-0 h-full max-md:pt-12 ${bleedPage ? 'overflow-y-auto md:overflow-hidden' : 'overflow-y-auto'} ${
          location.pathname.startsWith('/trace') ? '[scrollbar-gutter:stable]' : ''
        }`}
      >
        <div className={`w-full min-w-0 max-w-full flex flex-col ${bleedPage ? 'min-h-full md:h-full' : 'min-h-full'}`}>
            <ScrollHome />
            <WayBack />
            <div
              className={`${bleedPage ? 'px-4 lg:px-6 2xl:px-8 pt-5 pb-16 md:pb-0 gap-4 md:h-full md:min-h-0 md:overflow-hidden' : 'px-4 lg:px-6 2xl:px-8 pt-5 pb-16 gap-4'} flex flex-col flex-grow min-w-0 max-w-full`}
            >
              <RouteBoundary resetKey={location.pathname}>
                <Suspense
                  fallback={
                    <>
                      <MarkLoad />
                      <RouteSkeleton pathname={location.pathname} />
                    </>
                  }
                >
                  <PlanGate fill={!bleedPage}>
                    <DeskKeep />
                  </PlanGate>
                </Suspense>
              </RouteBoundary>
            </div>
            {!location.pathname.startsWith('/trace') && !location.pathname.startsWith('/terrain') && <SiteFooter />}
        </div>
      </main>
      <EditorDockGate />
      <Suspense fallback={null}>
        <AlertsDrawer />
        <WatchlistDrawer />
        <AlertWatcher />
        <PaperRunner />
        <AlertToasts />
      </Suspense>
      {paletteLoaded && (
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onClose={closePalette} />
        </Suspense>
      )}
    </div>
  );
};

export default AppShell;
