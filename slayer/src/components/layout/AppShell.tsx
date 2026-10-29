import { Component, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SideNav from './SideNav';
import CommandPalette from './CommandPalette';
import SiteFooter from './SiteFooter';
import RouteSkeleton from '../ui/RouteSkeleton';
import { PlanGate } from './PlanWall';
import MarkLoad from '../../brand/MarkLoad';
import EditorDockGate from '../scripts/EditorDockGate';
/* THE ENGINES BEHIND THE SHELL LOAD AFTER THE SHELL (the speed pass, 2026-10-11): the alert watcher carries the Pine
   interpreter, the built-in scripts and the indicators; the toasts and the paper runner carry the paper and review
   engines. Imported plainly they sat in the entry script of EVERY page, the landing included — a third of it. Lazy,
   they arrive a moment after the shell has painted, on terminal pages only, and nothing visible waits on them. */
const AlertsDrawer = lazy(() => import('../alerts/AlertsDrawer'));
const WatchlistDrawer = lazy(() => import('./WatchlistDrawer'));
const AlertWatcher = lazy(() => import('../alerts/AlertWatcher'));
const AlertToasts = lazy(() => import('../alerts/AlertToasts'));
const PaperRunner = lazy(() => import('../paper/PaperRunner'));
import ScrollHome from './ScrollHome';
import DeskKeep from './DeskKeep';
import WayBack from './WayBack';
import { useIsBelowLg } from '../ui/useMediaQuery';
import { OPEN_PALETTE_EVENT } from './paletteDoor';
import { FaultView, isLoadFault, reloadOnceForStaleBuild } from '../ui/Fault';
import { warmRooms } from '../../data/warmRooms';

/** A page crash must never black-screen the terminal — it renders a readable
    fault panel instead. Recovers via the resetKey prop (NOT a React key: a key
    would remount the whole section on every subtab change and kill the smooth
    subnav transitions). */
class RouteBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prevProps: { resetKey: string }) {
    // Navigating anywhere clears a shown fault so the next page gets a clean try
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }
  componentDidCatch(error: Error) {
    /* a page's code asked for by a name the server no longer has (a deploy under an open tab): nothing is wrong, so it
       reloads itself — once (ui/Fault.tsx) */
    if (isLoadFault(error) && navigator.onLine !== false) reloadOnceForStaleBuild();
  }
  render() {
    if (!this.state.error) return this.props.children;
    /* WHAT THE READER IS TOLD is ui/Fault.tsx (2026-09-19): it used to say "tell us in Community → Feedback", a page that
       was removed on 2026-09-13, under a lime button — lime is the live ink, not a button's */
    return (
      <FaultView
        error={this.state.error}
        scope="page"
        back={
          <Link to="/pulse" onClick={() => this.setState({ error: null })} className="inline-flex items-center h-9 px-4 rounded-md border border-borderMuted text-t125 font-medium text-textPrimary hover:bg-ink/[0.05]">
            Back to Pulse
          </Link>
        }
      />
    );
  }
}

const AppShell = () => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    warmRooms();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    /* a page may offer the palette as a button (paletteDoor.ts) — the not-found page's search */
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, openPalette);
    };
  }, [openPalette]);

  /* Only the CHART pages stay framed to the viewport. The table pages scroll
     with the page like the Live Tape (Noah, 2026-08-30) — they left this set. */
  const bleedPage = /^\/trace\/(net-flow|odte)/.test(
    location.pathname
  );
  /* The Weigher desk is VIEWPORT-FITTED but the page still scrolls (Noah,
     2026-08-30: "the footer should still be visible at the bottom which means
     a slight scroll down"). The trick is calc-free: main's height is definite,
     so a child's h-full resolves to exactly the viewport remainder — the desk
     fills the first screenful, and the footer sits just past the fold. */
  /* …and NOT below `lg` (the phone pass, 2026-09-13): a phone's screenful
     cannot hold four cards, and a tablet's column beside the sidebar is 532px
     — so the desk stacks into a column there and the page scrolls like any
     other. */
  /* …and since 2026-09-14 NOT AT ALL: the Weigher is a page like the others — its top row
     (the chart and the chain) is a window whose height the sash sets, its bottom row (the
     watchlist and the position) grows with its rows, and the page scrolls (Noah: the fixed
     frame could not hold the position card). */
  const framePage = bleedPage;

  return (
    /* THE FRAME (Noah, 2026-09-05, direction B): the terminal's ONE subject
       and its navigation live in a sidebar on the left; the page owns the
       rest of the width. The top bar is gone. */
    /* h-dvh over h-screen: on a phone 100vh is the height with the address bar AWAY, and this frame never lets the document
       scroll, so the bar never leaves — the last ~80px of every page sat under it (index.css, "a touch screen's two traps") */
    <div className="h-screen h-dvh flex flex-row bg-canvas text-textPrimary overflow-hidden">
      <SideNav onOpenPalette={openPalette} />
      {/* The Trace flow pages are a FIXED FRAME, not a scroll: main stops
          scrolling, every layer fills its parent exactly, and the page's own
          flex-1 table absorbs the remainder — the tape ends ON the viewport
          floor on ANY screen height, no calc calibration to drift (Noah,
          2026-08-30: the leftover band read as a phantom footer). */}
      {/* ONE FRAME ACROSS TRACE (Noah, 2026-09-03, switching Live Tape →
          Net Flow: "the height of it expands into a bigger view leaving the
          user startled"). Measured per frame in Chrome: the instant the
          route changed, the tape — still fading out — jumped 18px up and
          32px wider, because this wrapper swapped to the chart pages'
          tighter, gutterless padding under it; then Net Flow landed with
          its head 73px higher than the tape's. So the chart pages now wear
          the SAME gutters, top padding and gap as the table pages (only the
          floor differs: they are viewport-fitted, the tables scroll), and
          main reserves its scrollbar gutter on every Trace page so a page
          without a scrollbar is not 15px wider than one with. */}
      <main
        /* max-md:pt-12 — the phone strip (SideNav, fixed, h-12) used to sit on
           the first 48px of every page; the page head began under it (the
           phone pass, 2026-09-13). Pulse's and Terrain's phone layouts
           subtract the same 3rem from the viewport. */
        className={`flex-1 min-w-0 min-h-0 h-full max-md:pt-12 ${bleedPage ? 'overflow-hidden' : 'overflow-y-auto'} ${
          location.pathname.startsWith('/trace') ? '[scrollbar-gutter:stable]' : ''
        }`}
      >
        {/* Keyed by top-level section only — subpage changes animate inside
            their section layout so the header/tabs never remount */}
        {/* NO EXIT WAIT (2026-09-06, the perf sweep — Noah: "it just pops right
            over"): with mode="wait" the old page faded out for 80ms, the
            column sat BLACK, then the new page faded in from nothing — the
            skeletons it carries never got their moment. Now the old page
            leaves at once and the new one lands on the next frame with its
            head and its skeleton boxes already in place, the boxes filling
            one per frame (Deferred); a 100ms fade keeps it from being a
            hard cut. */}
        <div className={`w-full min-w-0 max-w-full flex flex-col ${framePage ? 'h-full' : 'min-h-full'}`}>
            <ScrollHome />
            <WayBack />
            <div
              className={`${bleedPage ? 'px-4 lg:px-6 2xl:px-8 pt-5 pb-0 gap-4 h-full min-h-0 overflow-hidden' : 'px-4 lg:px-6 2xl:px-8 pt-5 pb-16 gap-4'} flex flex-col flex-grow min-w-0 max-w-full`}
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
      {/* THE SCRIPT EDITOR (2026-09-10): docked at the right of a full-screen
          chart, the takeover narrowed to leave it room — see data/editorDock.ts */}
      <EditorDockGate />
      {/* EVERY ALERT IN ONE PLACE (2026-09-10): the sidebar's bell opens it
          at the right, over any page — see data/alertsDrawer.ts */}
      <Suspense fallback={null}>
        <AlertsDrawer />
        {/* ONE WATCHLIST OF NAMES (2026-10-13, the partner's, at Noah's word): the rail's Watchlist door opens it at the
            right, over any page — see data/nameWatch.ts */}
        <WatchlistDrawer />
        {/* HEAR IT EVERYWHERE (2026-09-10): every name's alerts watched on every
            page, and a firing shown wherever the reader is */}
        <AlertWatcher />
        {/* A PAPER ACCOUNT'S ORDERS, WATCHED ON EVERY PAGE (2026-09-22) — a stop fills while the reader is elsewhere, and the
            chip above says so (data/paper/store.ts) */}
        <PaperRunner />
        <AlertToasts />
      </Suspense>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
};

export default AppShell;
