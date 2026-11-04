/* The sidebar: the desk's subject first, then the groups with the current product's pages on a tree rail.
   The edge bar is one element on the panel (a row's own bar would be clipped by the scroller), gliding between rows. */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Eye, Lock, Menu, PanelLeftClose, PanelLeftOpen, Search, UserRound } from 'lucide-react';
import { setStandalone } from '../../data/standalone';
import { useAccess } from '../../data/access';
import JingleBell from '../ui/JingleBell';
import Fold from '../ui/Fold';
import Avatar from '../ui/Avatar';
import { SAMPLE_PROFILE, useProfile } from '../../data/profile';
import { useAccount } from '../../data/account';
import { useTicker } from '../../context/MarketDataContext';
import { NavOffline, NavPrice, quoteSymbolOf } from './NavQuote';
import { peekThetaPrice } from '../../data/thetaQuote';
import { warmPath } from '../../data/warmRooms';
import CompanyLogo from '../ui/CompanyLogo';
import { NAV_GROUPS, NAV_GROUP_META, NAV_INK, itemsByGroup } from './nav';
import { subpagesFor } from './navTree';
import MobileMenu from './MobileMenu';
import { useMediaQuery } from '../ui/useMediaQuery';
import { readSessionClock } from '../../data/moc';
import { nyClock } from '../../core/nyTime';
import { marketPhase } from '../../core/marketPhase';
import { useAllAlerts, useUnseenAll } from '../gex/alertStore';
import { toggleAlertsDrawer, useAlertsDrawer } from '../../data/alertsDrawer';
import { toggleWatchlist, useNameWatch, useWatchlistOpen } from '../../data/nameWatch';
import { beginGlide, endGlide } from '../../core/glide';
import { EMBEDDED } from '../../embed';
import SlayerMark from '../../brand/SlayerMark';
import PageGlyph from '../ui/PageGlyph';
import Wordmark from '../../brand/Wordmark';
import Signature, { SignatureDot } from '../../brand/Signature';
import { nextOpenWords, readMarketState } from '../../data/marketState';
import { useMarketSession } from '../../core/session';
import { lookup } from '../../data/universe';

const COLLAPSED_KEY = 'slayer_sidenav_collapsed';
const MODE_KEY = 'slayer_sidenav_mode';
/** The panel's widths — open, and the icon rail */
const SIDENAV_W = 236;
const SIDENAV_RAIL_W = 52;
/** The edge bar's height */
const BAR_H = 18;
/** A nested page row's pitch — the tree fill is computed from it, not measured */
const SUB_H = 26;

/* which pages sit under each product is navTree.ts — the phone's menu reads the same list */

const readCollapsed = () => {
  /* in the landing's window the rail opens folded, so the page has the width — and unwritten (embed.ts) */
  if (EMBEDDED) return true;
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

type RailMode = 'icon' | 'offcanvas' | 'fixed';

const readMode = (): RailMode => {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'offcanvas' || v === 'fixed' || v === 'icon') return v;
  } catch {
    /* private mode — icons for the session */
  }
  return 'icon';
};

interface SideNavProps {
  onOpenPalette: () => void;
  /** THE RAIL WAITS AT THE EDGE (the partner tree's data/standalone.ts, 2026-11-01 port): on a room that stands alone the
      panel leaves the frame — the page has the whole window — and a rest of the pointer at the left edge slides it over
      the page, never into it; leaving it slides it back */
  overlay?: boolean;
  /** the standalone-capable room the page is in (its path), for the notch that lets it stand alone or keeps the rail */
  room?: string | null;
}

const REVEAL_DWELL_MS = 90;
const REVEAL_LINGER_MS = 220;

interface Tip {
  label: string;
  x: number;
  y: number;
}

/** New York's time to the second — its own component so the tick re-renders this span, not the rail */
const NavClock = () => {
  const [time, setTime] = useState(() => nyClock(undefined, { seconds: true, zone: true }));
  useEffect(() => {
    const id = window.setInterval(() => setTime(nyClock(undefined, { seconds: true, zone: true })), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="ml-auto whitespace-nowrap text-textMuted select-none">{time}</span>;
};

const SideNav = ({ onOpenPalette, overlay = false, room = null }: SideNavProps) => {
  const { activeTicker } = useTicker();
  const profile = useProfile();
  /* The foot is a sign-in door while signed out; without an account service the sample profile stands. */
  const account = useAccount();
  const signedOut = account.status === 'out' || account.status === 'loading';
  const placeholder = profile.name === SAMPLE_PROFILE.name && profile.handle === SAMPLE_PROFILE.handle && profile.email === SAMPLE_PROFILE.email;
  const guest = signedOut || placeholder;
  const { pathname } = useLocation();
  const [storedCollapsed, setCollapsed] = useState(readCollapsed);
  /* Icons: the 52 px rail. Edge: the panel leaves the frame. Fixed: it stays open. A half-monitor snap
     still uses icons — 236 px is a quarter of that window. */
  const [mode, setMode] = useState<RailMode>(readMode);
  const narrow = useMediaQuery('(min-width: 768px) and (max-width: 1279.98px)');
  const [narrowOpen, setNarrowOpen] = useState(false);
  useEffect(() => {
    if (!narrow) setNarrowOpen(false);
  }, [narrow]);
  /* over the page the rail is always the open panel — it has all the width it wants there.
     Under 1280 the rail stays icons. Fixed keeps it open on a wide window. Edge hides it completely. */
  const collapsed = overlay ? false : narrow ? !narrowOpen : mode === 'fixed' ? false : storedCollapsed;
  const offscreen = !overlay && !narrow && mode === 'offcanvas' && storedCollapsed;
  /* THE REVEAL: the pointer at the left edge slides the rail out after a short rest; leaving the rail slides it back */
  const [revealed, setRevealed] = useState(false);
  const revealTimer = useRef(0);
  const lingerTimer = useRef(0);
  const armReveal = () => {
    window.clearTimeout(lingerTimer.current);
    if (revealed || revealTimer.current) return;
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = 0;
      setRevealed(true);
    }, REVEAL_DWELL_MS);
  };
  const disarmReveal = () => {
    window.clearTimeout(revealTimer.current);
    revealTimer.current = 0;
  };
  const stayRevealed = () => window.clearTimeout(lingerTimer.current);
  const linger = () => {
    window.clearTimeout(lingerTimer.current);
    lingerTimer.current = window.setTimeout(() => setRevealed(false), REVEAL_LINGER_MS);
  };
  useEffect(
    () => () => {
      window.clearTimeout(revealTimer.current);
      window.clearTimeout(lingerTimer.current);
    },
    []
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const [clock, setClock] = useState(() => readSessionClock());
  const asideRef = useRef<HTMLElement | null>(null);
  /* a page picked puts the rail back */
  useEffect(() => {
    setRevealed(false);
  }, [pathname, overlay]);
  /* WHILE IT IS OUT, THE POINTER'S PLACE DECIDES (the partner tree's walk): any move past the panel's width plus a margin,
     a press outside it, or Escape slides it back */
  useEffect(() => {
    if (!revealed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRevealed(false);
    };
    const onMove = (e: PointerEvent) => {
      if (e.clientX > SIDENAV_W + 16) linger();
      else stayRevealed();
    };
    const onDown = (e: PointerEvent) => {
      if (!asideRef.current?.contains(e.target as Node)) setRevealed(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);
  const standAlone = () => {
    if (room) setStandalone(room, true);
    setTip(null);
  };
  const keepRail = () => {
    if (room) setStandalone(room, false);
    setRevealed(false);
    setTip(null);
  };
  const navRef = useRef<HTMLElement | null>(null);
  const [bar, setBar] = useState<{ top: number } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  /* the rail's list scrolls when a section's pages are open on a short window: each edge with more behind it says so */
  const [edges, setEdges] = useState<{ above: boolean; below: boolean }>({ above: false, below: false });
  /* Every name's alerts: how many are set, how many fired unseen, and whether the drawer is open. */
  const allAlerts = useAllAlerts();
  const setTotal = allAlerts.reduce((n, a) => n + a.alerts.filter(x => !x.firedAt).length, 0);
  const unseen = useUnseenAll();
  const drawerOpen = useAlertsDrawer();

  /* the rail re-renders only when the session's words change; the seconds tick in NavClock alone */
  const shownAs = useRef('');
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = readSessionClock();
      const key = `${next.phase}|${next.label}|${readMarketState().badge}|${marketPhase()}`;
      if (key === shownAs.current) return;
      shownAs.current = key;
      setClock(next);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const writeMode = (next: RailMode) => {
    setMode(next);
    if (!EMBEDDED) {
      try {
        localStorage.setItem(MODE_KEY, next);
      } catch {
        /* private mode — the choice lives for the session */
      }
    }
    if (next === 'fixed') setCollapsed(false);
  };

  const toggleCollapsed = () => {
    /* The main column is told its width once the panel has folded (core/glide.ts), measured off <main>, so desks lay out for it at once. */
    const main = document.querySelector('main');
    const opening = collapsed || offscreen;
    const nextW = !opening ? (mode === 'offcanvas' && !narrow ? 0 : SIDENAV_RAIL_W) : SIDENAV_W;
    const fromW = offscreen ? 0 : width;
    const to = main ? { mainWidth: main.getBoundingClientRect().width + (fromW - nextW) } : null;
    beginGlide(700, 'frame', to);
    setTip(null);
    if (narrow) {
      setNarrowOpen(o => !o);
      return;
    }
    if (mode === 'fixed') writeMode('icon');
    setCollapsed(c => {
      const next = mode === 'fixed' ? true : !c;
      if (!EMBEDDED) {
        try {
          localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
        } catch {
          /* private mode — the choice lives for the session */
        }
      }
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* The edge bar follows the current product row, measured against the panel; hidden while the row is scrolled out. */
  const measure = useCallback(() => {
    const aside = asideRef.current;
    const nav = navRef.current;
    const row = aside?.querySelector<HTMLElement>('[data-nav-current]');
    if (!aside || !nav || !row) {
      setBar(null);
      return;
    }
    const a = aside.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (mid < n.top || mid > n.bottom) {
      setBar(null);
      return;
    }
    setBar({ top: Math.round(mid - a.top - BAR_H / 2) });
  }, []);
  /* A frame after the commit: measuring in a layout effect forced the new page's layout early (~24 ms per route). */
  useEffect(() => {
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [measure, pathname, collapsed]);
  useEffect(() => {
    const nav = navRef.current;
    nav?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      nav?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);
  const markEdges = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const above = nav.scrollTop > 2;
    const below = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2;
    setEdges(e => (e.above === above && e.below === below ? e : { above, below }));
  }, []);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    markEdges();
    nav.addEventListener('scroll', markEdges, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(markEdges) : null;
    ro?.observe(nav);
    for (const c of Array.from(nav.children)) ro?.observe(c);
    return () => {
      nav.removeEventListener('scroll', markEdges);
      ro?.disconnect();
    };
  }, [markEdges, pathname, collapsed]);

  /* A hover tip for the rail — one fixed label beside the row, never clipped */
  const showTip = (e: MouseEvent<HTMLElement>, label: string) => {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, x: r.right + 10, y: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);

  const name = lookup(activeTicker)?.name ?? null;
  /* the one session the site follows (core/session.ts): the rail re-renders when it turns */
  const session = useMarketSession();
  const open = session.phase !== 'closed';
  /* the price itself renders in NavPrice (its own subscription); the folded rail's hover reads it when shown */
  const priceNow = () => {
    const p = peekThetaPrice(quoteSymbolOf(activeTicker))?.value.price;
    return p ? `$${p.toFixed(2)}` : '';
  };

  /* the signature's word, read on the clock's own tick so the dot and the session line never disagree */
  const marketState = readMarketState();
  const marketWord = marketState.word;
  /* shut, the session line says when the next session opens (New York time, as the clock beside it) */
  const nextOpen = nextOpenWords();
  /* the time stays on one line when the badge wraps ("Sun 8:00 PM ET") */
  const sessionWords = marketState.badge.replace(/ (\d{1,2}:\d{2}) (AM|PM) ET$/, '\u00a0$1\u00a0$2\u00a0ET');

  /* The mark and wordmark, the door home: the S| with its foil and cursor and ">slayer_terminal" beside it; folded, the S| alone
     with its cursor held lit. The S brightens as the pointer nears. */
  /* Open, the long word. Shut, the S. The click folds and opens the rail — there is no notch beside it. */
  const brand = (
    <NavLink
      to="/"
      onMouseEnter={e => showTip(e, 'Home')}
      onMouseLeave={hideTip}
      className="shrink-0 w-fit overflow-hidden flex items-center h-[52px] select-none pl-[14px]"
      aria-label="Slayer Terminal — the front page"
      data-brand
    >
      {collapsed ? <SlayerMark size={26} bare prompt near label="" /> : <Wordmark height={14} cursor label="" />}
    </NavLink>
  );

  /* THE SUBJECT, dressed as the search field under the mark: the name you
     are on, its price and change, and the key that changes it. */
  const subject = collapsed ? (
    <button
      type="button"
      onClick={onOpenPalette}
      data-subject
      aria-label={`Watching ${activeTicker} — switch`}
      onMouseEnter={e => showTip(e, `${activeTicker} ${priceNow()} · ⌘K to switch`)}
      onMouseLeave={hideTip}
      className="ml-[10px] w-8 h-8 rounded-lg border border-ink/[0.08] bg-ink/[0.03] hover:border-silver/50 transition-colors flex items-center justify-center"
    >
      <CompanyLogo ticker={activeTicker} size={16} />
    </button>
  ) : (
    <button
      type="button"
      onClick={onOpenPalette}
      data-subject
      aria-label={`Watching ${activeTicker} — switch`}
      title={name ? `${name} · ⌘K to switch` : '⌘K to switch'}
      className="group w-full min-w-0 h-[34px] overflow-hidden rounded-lg border border-ink/[0.08] bg-ink/[0.03] hover:border-silver/50 hover:bg-ink/[0.05] transition-colors flex items-center gap-1.5 pl-2 pr-2 text-left"
    >
      <CompanyLogo ticker={activeTicker} size={16} />
      <span className="shrink-0 text-t12 font-semibold text-textPrimary" data-subject-ticker>
        {activeTicker}
      </span>
      <NavPrice ticker={activeTicker} />
      <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-textMuted group-hover:text-textSecondary transition-colors">
        <Search className="w-3 h-3" />
        <kbd className="font-mono text-t9 tracking-wide">⌘K</kbd>
      </span>
    </button>
  );

  /* The alerts row: fired-and-unseen count, else how many are set; it opens the drawer over the current page. Silver while open. */
  const alertsRow = (
    <button
      type="button"
      onClick={toggleAlertsDrawer}
      data-nav-alerts
      aria-expanded={drawerOpen}
      onMouseEnter={e => showTip(e, unseen > 0 ? `${unseen} alerted` : setTotal > 0 ? `${setTotal} alert${setTotal === 1 ? '' : 's'} set` : 'Alerts')}
      onMouseLeave={hideTip}
      /* A button, so it is told to fill its row; open, it wears the nav rows' current look. */
      className={`group relative flex items-center gap-2.5 h-[30px] rounded-lg text-t13 text-left transition-colors ${
        collapsed ? 'w-8 ml-[10px] justify-center' : 'w-full px-2.5'
      } ${drawerOpen ? 'bg-ink/[0.06] text-textPrimary font-medium' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04]'}`}
      aria-label="Alerts"
    >
      {/* Jingles when an alert is set on any name; its dot is always the alert ink. */}
      <JingleBell
        count={setTotal}
        ink={NAV_INK.alerts}
        lit={drawerOpen || unseen > 0}
        glyph={17}
        className={`shrink-0 transition-opacity duration-200 ${drawerOpen ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}
      />
      {!collapsed && <span>Alerts</span>}
      {/* Fired and unseen: the count in a small red rounded square, on the icon's corner when collapsed, at the row's end when open. */}
      {collapsed
        ? unseen > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-[4px] bg-bear text-white font-mono text-t8 font-bold leading-[14px] text-center tnum" data-alerts-count>
              {unseen > 9 ? '9+' : unseen}
            </span>
          )
        : unseen > 0 ? (
            <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-md bg-bear text-white font-mono text-t10 font-bold leading-[18px] text-center tnum" data-alerts-count>
              {unseen > 99 ? '99+' : unseen}
            </span>
          ) : setTotal > 0 ? (
            <span className="ml-auto font-mono text-t10 tnum text-textMuted" data-alerts-count>
              {setTotal} set
            </span>
          ) : null}
    </button>
  );

  /* The watchlist door (WatchlistDrawer.tsx), opened at the right like the alerts, with the count of names. */
  const watchOpen = useWatchlistOpen();
  const watchCount = useNameWatch().sections.reduce((n, s) => n + s.names.length, 0);
  const watchLabel = watchCount > 0 ? `Watchlist — ${watchCount} ${watchCount === 1 ? 'name' : 'names'}` : 'Watchlist';
  const watchRow = (
    <button
      type="button"
      onClick={toggleWatchlist}
      data-nav-watchlist
      aria-expanded={watchOpen}
      onMouseEnter={e => showTip(e, watchLabel)}
      onMouseLeave={hideTip}
      className={`group relative flex items-center gap-2.5 h-[30px] rounded-lg text-t13 text-left transition-colors ${
        collapsed ? 'w-8 ml-[10px] justify-center' : 'w-full px-2.5'
      } ${watchOpen ? 'bg-ink/[0.06] text-textPrimary font-medium' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04]'}`}
      aria-label={watchLabel}
    >
      <Eye className={`w-[17px] h-[17px] shrink-0 transition-opacity duration-200 ${watchOpen ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`} strokeWidth={1.75} aria-hidden />
      {!collapsed && <span>Watchlist</span>}
      {!collapsed && watchCount > 0 && (
        <span className="ml-auto font-mono text-t10 tnum text-textMuted" data-watchlist-count>
          {watchCount}
        </span>
      )}
    </button>
  );

  /* The tree folds: a section's pages drop down on entry; clicking its row while inside folds and unfolds without navigating.
     Leaving a section forgets the fold. */
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  /* the plan held, for the locks on the rooms outside it (data/access.ts) */
  const access = useAccess();
  useEffect(() => {
    setFolded(f => {
      const next = Object.fromEntries(Object.entries(f).filter(([path]) => pathname.startsWith(path)));
      return Object.keys(next).length === Object.keys(f).length ? f : next;
    });
  }, [pathname]);

  /* The rail's order (nav.ts): Home above the Alerts row, the captioned groups, More pinned to the foot. */
  const groupBlocks = NAV_GROUPS.map((group, gi) => {
    const meta = NAV_GROUP_META[group];
    const first = gi === 1;
    const last = gi === NAV_GROUPS.length - 1;
    return (
      <div key={group} className={`flex flex-col gap-[2px] ${gi === 0 ? '' : first ? 'mt-1' : last ? 'mt-auto pt-5' : 'mt-5'}`} data-nav-group={group}>
        {!collapsed ? (
          meta.caption && (
            <span className="px-2.5 pb-1 text-t10 uppercase tracking-[0.1em] text-textMuted" title={meta.hint}>
              {meta.caption}
            </span>
          )
        ) : (
          gi > 1 && <span className="mx-3 mb-2 border-t border-ink/[0.08]" aria-hidden />
        )}
        {itemsByGroup(group).map(item => {
          const inside = pathname.startsWith(item.path);
          const tree = !collapsed && inside ? subpagesFor(item.path, pathname) : undefined;
          const open = !!tree && !folded[item.path];
          const subs = tree;
          /* The page you are on is the longest nested path the pathname starts with (/compass prefixes every Compass page). */
          const activeIdx = subs ? subs.reduce((best, s, i) => (pathname.startsWith(s.path) && (best < 0 || s.path.length > subs[best].path.length) ? i : best), -1) : -1;
          const link = (
            <NavLink
              key={item.path}
              to={item.path}
              data-nav-item={item.path}
              data-nav-current={inside || undefined}
              onMouseEnter={e => {
                showTip(e, item.label);
                warmPath(item.path);
              }}
              onMouseLeave={hideTip}
              onClick={e => {
                /* inside a section with pages: the row folds and unfolds its tree instead of leaving the page */
                if (!tree) return;
                e.preventDefault();
                setFolded(f => ({ ...f, [item.path]: !f[item.path] }));
              }}
              aria-expanded={tree ? open : undefined}
              className={`group relative flex items-center gap-2.5 h-[30px] rounded-lg text-t13 transition-colors ${
                collapsed ? 'w-8 ml-[10px] justify-center' : 'px-2.5'
              } ${inside ? 'bg-ink/[0.06] text-textPrimary font-medium' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04]'}`}
              title={collapsed ? undefined : tree ? `${item.description} — click to ${open ? 'fold' : 'unfold'} its pages` : item.description}
              aria-label={item.label}
            >
              {/* The page's glyph as the landing draws it (foil body, one coloured part); Settings keeps its line icon. */}
              {item.glyph ? (
                <PageGlyph name={item.glyph} size={17} className={`shrink-0 transition-opacity duration-200 ${inside ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`} />
              ) : (
                <item.icon
                  className={`w-4 h-4 shrink-0 transition-colors duration-200 ${inside ? 'text-ink' : 'text-textMuted group-hover:text-ink'}`}
                  strokeWidth={inside ? 2 : 1.75}
                  style={{ '--ink': item.ink } as CSSProperties}
                  data-nav-icon
                />
              )}
              {!collapsed && <span className="truncate">{item.label}</span>}
              {/* A room outside the held plan wears a quiet lock. */}
              {!collapsed && access.on && !access.can(item.path) && <Lock className={`${tree ? '' : 'ml-auto'} w-3 h-3 shrink-0 text-textMuted`} aria-hidden data-nav-locked />}
              {/* the fold's chevron — only on a section with pages, only while you are in it */}
              {tree && <ChevronDown className={`ml-auto w-3 h-3 shrink-0 text-textMuted transition-transform duration-200 ${open ? '' : '-rotate-90'}`} aria-hidden data-nav-fold={open ? 'open' : 'folded'} />}
            </NavLink>
          );
          if (!subs) return link;
          /* The tree rail: a dim track from the first page's centre to the last, and a bright fill down to the page you are on. */
          const fillTo = activeIdx >= 0 ? activeIdx * SUB_H + SUB_H / 2 : 0;
          return (
            <div key={item.path} className="flex flex-col" data-nav-open={item.path}>
              {link}
              {/* The fold glides (height and opacity over 220 ms); nothing mounts or unmounts on a click. */}
              <Fold axis="y" open={open} testId="data-nav-tree-fold">
              <div className="relative ml-[23px] mt-1 mb-1" data-nav-tree>
                <span className="absolute left-0 w-px bg-ink/[0.12]" style={{ top: SUB_H / 2, bottom: SUB_H / 2 }} aria-hidden data-nav-track />
                {activeIdx >= 0 && (
                  <>
                    <span
                      data-nav-fill
                      aria-hidden
                      className="absolute -left-px w-[3px] rounded-full nav-accent transition-[height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{ top: SUB_H / 2, height: Math.max(0, fillTo - SUB_H / 2) }}
                    />
                    <span
                      data-nav-fill-dot
                      aria-hidden
                      className="absolute w-[7px] h-[7px] rounded-full nav-accent transition-[top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{ left: -3, top: fillTo - 3.5 }}
                    />
                  </>
                )}
                <div className="flex flex-col pl-3">
                  {subs.map((s, i) => {
                    const active = i === activeIdx;
                    return (
                      <NavLink
                        key={s.path}
                        to={s.path}
                        data-nav-sub={s.path}
                        style={{ height: SUB_H }}
                        className={`flex items-center px-2 rounded-md text-t12 transition-colors ${
                          active ? 'text-textPrimary font-medium' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04]'
                        }`}
                        onMouseEnter={() => warmPath(s.path)}
                        onFocus={() => warmPath(s.path)}
                      >
                        {s.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
              </Fold>
            </div>
          );
        })}
      </div>
    );
  });
  const [home, ...groups] = groupBlocks;

  const width = offscreen ? 0 : collapsed ? SIDENAV_RAIL_W : SIDENAV_W;
  /* Rail rows keep a fixed left inset that centres them in the 52 px rail, so icons do not jump while the width glides. */

  return (
    <>
      {/* THE PANEL, hugging the left edge from tablet width up */}
      {/* THE ROOM STANDS ALONE: a strip five pixels wide at the window's left edge is where the pointer finds the rail — a
          rest there slides it over the page. Not while a button is held: a drag that crosses the edge must not open it. */}
      {overlay && (
        <div
          className={`hidden md:block fixed inset-y-0 left-0 w-[5px] z-[69] transition-colors ${revealed ? '' : 'hover:bg-silver/30'}`}
          onPointerEnter={e => {
            if (e.buttons === 0) armReveal();
          }}
          onPointerLeave={disarmReveal}
          aria-hidden
          data-rail-edge
        />
      )}
      {offscreen && (
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Show the sidebar"
          title="Show the sidebar · ⌘B"
          data-sidenav-edge
          className="hidden md:flex fixed inset-y-0 left-0 z-[69] w-3 items-center justify-center"
        >
          <span className="h-8 w-[3px] rounded-full nav-accent" aria-hidden />
        </button>
      )}
      <aside
        ref={asideRef}
        onMouseEnter={overlay ? stayRevealed : undefined}
        onMouseLeave={() => {
          hideTip();
          if (overlay) linger();
        }}
        onTransitionEnd={e => {
          measure();
          /* Two frames on: the desk's grid measures its new width on the
             frame after the aside settles and lays its items out on the next */
          if (e.target === asideRef.current && e.propertyName === 'width') requestAnimationFrame(() => requestAnimationFrame(endGlide));
        }}
        className={
          overlay
            ? /* WAITING, THE RAIL SHOWS NOTHING (the partner tree's 50405ea): clipped while off screen, so nothing of it
                 peeks into the room at x = 0; revealed, the notch stands out again */
              `fixed inset-y-0 left-0 z-[70] hidden md:flex flex-col bg-panel border-r border-ink/[0.07] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${revealed ? 'overflow-visible shadow-[16px_0_48px_rgba(0,0,0,0.45)]' : 'overflow-hidden'}`
            : `relative hidden md:flex shrink-0 h-full flex-col bg-panel border-r border-ink/[0.07] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${offscreen ? 'overflow-hidden min-w-0' : 'overflow-visible'}`
        }
        style={overlay ? { width: SIDENAV_W, transform: revealed ? 'translateX(0)' : 'translateX(-100%)' } : { width }}
        data-sidenav
        data-collapsed={collapsed || undefined}
        data-sidenav-mode={mode}
        data-sidenav-offcanvas={offscreen || undefined}
        data-sidenav-overlay={overlay || undefined}
        data-sidenav-revealed={(overlay && revealed) || undefined}
        aria-hidden={(overlay && !revealed) || undefined}
      >
        {overlay ? (
          /* over the page there is nothing to collapse: the notch keeps the rail in the frame instead */
          <button
            type="button"
            onClick={keepRail}
            aria-label="Keep the sidebar in the frame on this page"
            title="Keep the sidebar here — the page gives it the room back"
            data-sidenav-keep
            className="absolute -right-[11px] top-[15px] z-10 w-[22px] h-[22px] rounded-full border border-ink/[0.12] bg-card text-textMuted hover:text-textPrimary hover:border-silver/60 shadow-md shadow-black/50 flex items-center justify-center transition-colors"
          >
            <PanelLeftOpen className="w-3 h-3" />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Open the sidebar' : offscreen ? 'Show the sidebar' : 'Collapse the sidebar to icons'}
              title={collapsed || offscreen ? 'Open the sidebar · ⌘B' : 'Collapse to icons · ⌘B'}
              data-sidenav-toggle
              className="absolute -right-[11px] top-[15px] z-10 w-[22px] h-[22px] rounded-full border border-ink/[0.12] bg-card text-textMuted hover:text-textPrimary hover:border-silver/60 shadow-md shadow-black/50 flex items-center justify-center transition-colors"
            >
              {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </button>
            {/* THE SECOND NOTCH, on a room that can stand alone: the rail leaves the frame and waits at the edge */}
            {room && (
              <button
                type="button"
                onClick={standAlone}
                aria-label="Let this page stand alone — the sidebar waits at the left edge"
                title="Let the page stand alone — the sidebar waits at the left edge; rest the pointer there to bring it over"
                data-sidenav-alone
                className="absolute -right-[11px] top-[43px] z-10 w-[22px] h-[22px] rounded-full border border-ink/[0.12] bg-card text-textMuted hover:text-textPrimary hover:border-silver/60 shadow-md shadow-black/50 flex items-center justify-center transition-colors"
              >
                <PanelLeftClose className="w-3 h-3" />
              </button>
            )}
          </>
        )}
        {/* The edge bar — one, on the edge, gliding to the current product */}
        {bar && (
          <span
            data-nav-accent
            aria-hidden
            className="absolute -right-px w-[3px] rounded-full nav-accent transition-[top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ top: bar.top, height: BAR_H }}
          />
        )}

        {brand}
        <div className={`shrink-0 flex flex-col gap-1 pb-1 ${collapsed ? 'px-0' : 'px-3'}`}>
          {subject}
          {!collapsed && <NavOffline ticker={activeTicker} />}
          <div className={collapsed ? '' : '-mx-1'}>
            {home}
            {alertsRow}
            {watchRow}
          </div>
        </div>
        <div className="relative flex-1 min-h-0 flex flex-col" data-nav-scroll={edges.below ? (edges.above ? 'both' : 'below') : edges.above ? 'above' : undefined}>
          <nav ref={navRef} className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-1 flex flex-col ${collapsed ? 'px-0' : 'px-2'}`} aria-label="Terminal">
            {groups}
          </nav>
          {/* the list scrolls: a shade and a hairline at the edge that has more behind it; the bottom one is a door down */}
          <span aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-panel to-transparent border-t border-ink/[0.06] transition-opacity duration-200 ${edges.above ? 'opacity-100' : 'opacity-0'}`} />
          <span aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-panel via-panel/80 to-transparent transition-opacity duration-200 ${edges.below ? 'opacity-100' : 'opacity-0'}`} />
          {edges.below && (
            <button
              type="button"
              onClick={() => navRef.current?.scrollBy({ top: navRef.current.clientHeight * 0.8, behavior: 'smooth' })}
              aria-label="More pages below — scroll the list"
              title="More below"
              className="absolute bottom-0.5 left-1/2 -translate-x-1/2 inline-flex items-center justify-center w-10 h-6 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
              data-nav-more-below
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* Who is at the desk: picture and name at the foot, a door to the account; the rail keeps the picture alone. */}
        <NavLink
          to={guest ? '/signin' : '/settings/account'}
          title={collapsed ? undefined : guest ? 'Sign in' : 'Your account'}
          onMouseEnter={e => showTip(e, guest ? 'Sign in · your account' : `${profile.name} · @${profile.handle} · your account`)}
          onMouseLeave={hideTip}
          className={({ isActive }) =>
            `shrink-0 flex items-center gap-2.5 border-t border-ink/[0.07] transition-colors ${collapsed ? 'pl-[14px] pr-0 py-2' : 'px-3.5 py-2'} ${
              isActive ? 'bg-ink/[0.05]' : 'hover:bg-ink/[0.03]'
            }`
          }
          data-sidenav-me
        >
          {guest ? (
            <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border border-borderSubtle text-textMuted" aria-hidden="true" data-avatar="signed-out">
              <UserRound className="w-3.5 h-3.5" />
            </span>
          ) : (
            <Avatar profile={profile} size={24} />
          )}
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-t12 font-semibold text-textPrimary">{guest ? 'Sign in' : profile.name}</span>
              <span className="block truncate font-mono text-t10 text-textMuted">{guest ? 'or create an account' : `@${profile.handle}`}</span>
            </span>
          )}
        </NavLink>
        {/* The signature: "slayer:~ $ ● live", the market's own word, over the session line and the clock; folded, the dot alone. */}
        <div
          className={`shrink-0 border-t border-ink/[0.07] bg-ink/[0.02] ${collapsed ? 'pl-[22px] pr-0 py-3.5' : 'px-3.5 py-2.5'}`}
          title={collapsed ? `slayer:~ $ ${marketWord} · ${sessionWords}` : undefined}
          onMouseEnter={e => showTip(e, `slayer:~ $ ${marketWord} · ${sessionWords} · ${nyClock(undefined, { seconds: true, zone: true })}`)}
          onMouseLeave={hideTip}
          data-sidenav-signature
        >
          {collapsed ? (
            <SignatureDot state={marketWord} className="w-2 h-2" label={`slayer:~ $ ${marketWord}`} />
          ) : (
            <>
              <Signature state={marketWord} rule={false} className="text-t105" />
              <span className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 font-mono text-t10 tnum">
                <span className="min-w-0 text-textSecondary leading-snug" title={!open && nextOpen ? `${marketState.line} ${nextOpen.long}` : `${sessionWords} · ${clock.label}. ${marketState.line}`} data-session-line data-session-phase={session.phase}>
                  {/* 16:00–16:15 on Trace: stock options are shut, index and ETF options still trade. */}
                  {pathname.startsWith('/trace') && marketPhase() === 'late' ? 'After hours · index & ETF options to 16:15 ET' : sessionWords}
                </span>
                <NavClock />
              </span>
              <div className="mt-2 flex items-center gap-1" role="group" aria-label="Sidebar" data-sidenav-mode={mode}>
                {(
                  [
                    ['icon', 'Icons', 'Collapse to icons'],
                    ['offcanvas', 'Edge', 'Slide off the page. The accent at the left edge brings it back.'],
                    ['fixed', 'Fixed', 'Keep the sidebar open'],
                  ] as const
                ).map(([id, label, hint]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => writeMode(id)}
                    aria-pressed={mode === id}
                    title={hint}
                    className={`h-6 px-2 rounded-full font-mono text-t11 ${mode === id ? 'bg-ink/10 text-textPrimary' : 'text-textMuted hover:text-textPrimary'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* The rail's hover tip — portalled so no scroller clips it */}
      {tip &&
        collapsed &&
        createPortal(
          <div
            data-nav-tip
            role="tooltip"
            style={{ position: 'fixed', left: tip.x, top: tip.y }}
            className="z-[90] -translate-y-1/2 pointer-events-none whitespace-nowrap px-2 py-1 rounded-md border border-ink/[0.1] bg-card/95 backdrop-blur-md text-t11 text-textPrimary shadow-lg shadow-black/50 animate-fade-in"
          >
            {tip.label}
          </div>,
          document.body
        )}

      {/* The phone strip: the menu (MobileMenu.tsx, opened by the house mark), the subject and the search. */}
      <div className="md:hidden fixed inset-x-0 top-0 z-40 h-12 flex items-center gap-2.5 px-2.5 bg-canvas/80 backdrop-blur-md border-b border-borderSubtle">
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-haspopup="dialog" aria-expanded={menuOpen} className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-md border border-borderSubtle text-textSecondary" data-mobile-menu-door>
          <Menu className="w-4 h-4" />
        </button>
        {/* The name's chip gives way, never the search door. */}
        <button onClick={onOpenPalette} className="inline-flex items-center gap-2 h-10 rounded-md border border-borderMuted bg-chip px-2.5 min-w-0 overflow-hidden" data-phone-subject>
          <CompanyLogo ticker={activeTicker} size={16} />
          <span className="text-t12 font-semibold text-textPrimary">{activeTicker}</span>
          <NavPrice ticker={activeTicker} compact />
        </button>
        <button onClick={onOpenPalette} aria-label="Search or jump to…" className="ml-auto shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-md border border-borderSubtle text-textMuted">
          <Search className="w-3.5 h-3.5" />
        </button>
      </div>
      <MobileMenu open={menuOpen} onClose={closeMenu} />
    </>
  );
};

export default SideNav;
