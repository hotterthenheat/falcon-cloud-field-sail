/*
==================================================
  SLAYER TERMINAL - THE SITE'S PIECES
  (pages/landing/pieces.tsx)

  What the landing page and the products' own pages
  share (2026-10-02, the day the products got pages
  of their own): the bar with its Products menu and
  its one door, the pills, the eyebrow and the
  two-tone head, the page's width. They were the
  landing's alone until then — every note on them
  below is from Landing.tsx, kept with the code.
==================================================
*/

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion';
import { ArrowRight, ChevronDown, Menu, Moon, Sun, X } from 'lucide-react';
import { useLaunch } from '../../components/layout/LaunchTransition';
import { MorphingInfinity, useWorking } from '../../components/ui/Working';
import { DOOR, START, doorTo } from '../../data/openDoor';
import { useBlockGround, useGround, type Ground } from './ground';
import { themeIntent } from './films';
import PageGlyph, { type GlyphName } from '../../components/ui/PageGlyph';
import SlayerMark from '../../brand/SlayerMark';
import Wordmark from '../../brand/Wordmark';

export const MAIL = 'info@slayerterminal.com';
/** WHERE EVERY DOOR INTO THE TERMINAL LANDS — data/openDoor.ts (the start page, every time, unless Settings › The desk ›
    Opens on › Page names another; read at the click). Re-exported so the landing's pages keep one import. */
export { DOOR, START, doorTo };
/* THE BAR'S THREE WORDS. "Products" opens the menu of every product (Noah, 2026-10-01, of his partner's bar: "notice how
   my partners page has a 'Products' section and not 'the tools'"); Pricing and Questions are this page's own sections. */
const NAV: { label: string; href: string }[] = [
  { label: 'Pricing', href: '#pricing' },
  { label: 'Questions', href: '#faq' },
];
/** what the link's address says: the section on the landing */
const hrefOf = (hash: string, home: boolean) => (home ? hash : `/${hash}`);

/* EVERY PRODUCT, ONE LINE EACH — the Products menu. The groups are the terminal's rail's (layout/nav.ts), in its order;
   a pick opens that page in the terminal. The lines are written for this menu, each read against the terminal as it
   stands. ALERTS IS NOT ON THE MENU (Noah, 2026-10-10: "alerts shouldn't be a section for the landing page, that's just
   an in-house thing not an entire page"): it is a drawer over every page of the terminal, not a product. */
export interface Product {
  name: string;
  glyph: GlyphName;
  line: string;
  path: string;
  /** THE PRODUCT'S OWN PAGE (2026-10-02, Noah: "make the products sections open up a new brief page explaining that
      product with recordings"): a pick opens this page of the site, not the terminal. The products without one still
      launch the terminal at their page. */
  page?: string;
}
export const PRODUCT_GROUPS: { caption: string; products: Product[] }[] = [
  {
    caption: 'Home',
    products: [
      { name: 'Pulse', glyph: 'pulse', line: 'Your desk of live tiles: the chart, the book and key levels, arranged your way', path: '/pulse', page: '/products/pulse' },
    ],
  },
  {
    caption: 'Market',
    products: [
      { name: 'Terrain', glyph: 'terrain', line: 'Charts only: up to four side by side, your Pine scripts, your drawings', path: '/terrain', page: '/products/terrain' },
      { name: 'Trace', glyph: 'trace', line: 'The live tape, with dark pool, net flow, footprints, 0DTE and multi-leg', path: '/trace/live-tape', page: '/products/trace' },
      { name: 'Dossier', glyph: 'dossier', line: 'The file on a ticker: news, earnings, insiders, Congress trades, how it screens', path: '/dossier/news', page: '/products/dossier' },
    ],
  },
  {
    caption: 'The book',
    products: [{ name: 'Pinpoint', glyph: 'pinpoint', line: 'Where dealer hedging holds and pushes price: the walls, the flip, the range into the close', path: '/pinpoint/map', page: '/products/pinpoint' }],
  },
  {
    caption: 'Trade',
    products: [
      { name: 'Compass', glyph: 'compass', line: 'Contracts that fit the levels right now, 0DTE to long-dated, plus the Tracker', path: '/compass', page: '/products/compass' },
      { name: 'Weigher', glyph: 'weigher', line: 'The chain, your watchlist and your positions on one desk, and what each returns at every price', path: '/weigher', page: '/products/weigher' },
    ],
  },
  {
    caption: 'Practice',
    products: [
      { name: 'Practice', glyph: 'practice', line: 'Trade with pretend money, replay the past, review every trade', path: '/practice', page: '/products/practice' },
      { name: 'Paper Trade', glyph: 'paper', line: 'Today’s prices with pretend money, on a practice account or a prop firm’s evaluation', path: '/practice/paper', page: '/products/paper' },
      { name: 'Backtest', glyph: 'backtest', line: 'Replay a past market minute by minute and trade it', path: '/practice/backtest', page: '/products/backtest' },
      { name: 'Journal', glyph: 'journal', line: 'Every closed trade on its day, with your tags and your words', path: '/practice/journal', page: '/products/journal' },
    ],
  },
];


export const Wrap = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 ${className}`}>{children}</div>;

/** A short rule and one small word — above every head on the page */
/* THE ARRIVALS (his partner's, at Noah's word, 2026-10-03: "add the arrivals to our section headings"): a block wrapped in
   `Arrive` is set waiting if it stands below the fold when it mounts, and set in — once — as it comes into view; its lines
   marked `arrive-line` then come up one at a time by their `--i` (index.css), the big line (`arrive-settle`) out of a
   soft blur. A block already on screen at mount is never touched, nor is anything where less motion is asked for. */
const useArrival = <T extends HTMLElement>(margin = '0px 0px -18% 0px', watch = true) => {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!watch || !el || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.82) return;
    el.dataset.arrival = 'wait';
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        el.dataset.arrival = 'in';
        io.disconnect();
      },
      { rootMargin: margin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin, watch]);
  return ref;
};

/** A block whose heading arrives: a div the arrival watches. `atMount`: a block that is on screen when the page opens
    and should arrive anyway — its lines rise on the first paint (the legal pages' head, 2026-10-05: "make the
    transition … have a nice simple smooth animation"); the viewport is not consulted, and less-motion still wins (index.css). */
export const Arrive = ({ id, className = '', atMount = false, children }: { id?: string; className?: string; atMount?: boolean; children: ReactNode }) => {
  const ref = useArrival<HTMLDivElement>(undefined, !atMount);
  return (
    <div ref={ref} id={id} className={className} data-arrival={atMount ? 'in' : undefined}>
      {children}
    </div>
  );
};

export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <p className="arrive-line [--i:0] flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-textMuted">
    <span className="w-8 h-px bg-textMuted/60" aria-hidden="true" />
    {children}
  </p>
);

/** EVERY HEAD IS TWO LINES IN TWO TONES: what it is in ink, the turn of the thought in grey */
export const TwoTone = ({ first, second, className = '' }: { first: string; second: string; className?: string }) => (
  <h2 className={`arrive-line arrive-settle [--i:1] font-light tracking-[-0.04em] leading-[1.02] text-[40px] sm:text-[56px] lg:text-[72px] [text-wrap:balance] ${className}`}>
    {first} <span className="block text-textMuted">{second}</span>
  </h2>
);

/* THE DOOR'S ARROW GLIDES (Noah, 2026-09-20, on the plan buttons: "the middle ones arrow should be moving to the right smoothly in
   and out on hover… same with the launch terminal arrows"). One class for every door with an arrow: four pixels to the right
   under the pointer and back again on the same curve — the house's ease, so it leaves as smoothly as it arrives. A NAMED group
   (`group/door`): an unnamed one answers to any ancestor's hover too (the tour's rows are groups). */
export const DOOR_GROUP = 'group/door';
export const DOOR_ARROW = 'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/door:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover/door:translate-x-0';

/** THE PILL. Solid: the silver foil on black, solid ink on paper (the foil is a surface, it would vanish there). Ghost: a hairline.
    NO GROWING UNDER THE POINTER (the same day: the two ghost pills "look laggy"): a 2% scale re-draws the words at a size
    between two pixel grids every frame, soft while it moves and snapping sharp at the end — that was the lag. The ghost
    answers with its edge and a wash, the solid with its arrow; only a press still gives (2%, 100ms). */
/** `busy`: the door is waiting on something it asked for (a plan's checkout being made at Stripe) — after the house's
    300ms the arrow gives way to the working mark, and a second press does nothing */
export const Pill = ({ children, onClick, href, kind = 'solid', size = 'lg', testId, busy = false }: { children: ReactNode; onClick?: () => void; href: string; kind?: 'solid' | 'ghost'; size?: 'lg' | 'sm'; testId?: string; busy?: boolean }) => {
  const ground = useBlockGround();
  const working = useWorking(busy);
  const fill = kind === 'solid' ? (ground === 'dark' ? 'holo-bg text-[#0a0a0a]' : 'galaxy-bg') : 'border border-borderMuted text-textPrimary hover:border-textPrimary/70 hover:bg-ink/[0.06]';
  const glyph = size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  return (
    <a
      href={href}
      onClick={e => {
        if (!onClick) return;
        e.preventDefault();
        if (busy) return;
        onClick();
      }}
      aria-busy={busy || undefined}
      data-landing-door={testId}
      className={`${DOOR_GROUP} inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-200 ease-out active:scale-[0.98] active:duration-100 motion-reduce:transform-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-silver ${busy ? 'cursor-progress' : ''} ${size === 'lg' ? 'h-12 pl-6 pr-5 text-[15px]' : 'h-9 pl-4 pr-3.5 text-[13px]'} ${fill}`}
    >
      {children}
      {working ? <MorphingInfinity viewBox="4 4 16 16" className={glyph} /> : kind === 'solid' && <ArrowRight className={`${glyph} ${DOOR_ARROW}`} aria-hidden="true" />}
    </a>
  );
};

const toAnchor = (href: string) => {
  document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  history.replaceState(null, '', href);
};

/** THE SITE'S OWN PAGES share the bar (the landing, and each product's page): a link to a section of the landing scrolls
    there on the landing and goes there from anywhere else — the landing lands on its hash when it opens */
const useSiteLinks = () => {
  const home = useLocation().pathname === '/';
  const navigate = useNavigate();
  return {
    home,
    /** '#pricing' → the section, from here or from the landing */
    section: (hash: string) => (home ? toAnchor(hash) : navigate(`/${hash}`)),
    /** a product's own page */
    page: (path: string) => navigate(path),
  };
};

/** ONE LAUNCH DOOR ON THE SCREEN AT A TIME (Noah, 2026-10-01): the bar's own door stands only while no other
    "Launch the terminal" is in view — the page's doors are marked `data-landing-door="hero"` / `"close"` */
export const useDoorSeen = (): boolean => {
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return setSeen(false);
    const inView = new Set<Element>();
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) inView.add(e.target);
          else inView.delete(e.target);
        }
        setSeen(inView.size > 0);
      },
      { rootMargin: '-76px 0px 0px 0px', threshold: 0.2 }
    );
    document.querySelectorAll('[data-landing-door="hero"], [data-landing-door="close"]').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
  return seen;
};

/** THE PRODUCTS MENU: the groups in the rail's order, each product beside its icon (small, bare) with its one line. On a
    desk the groups flow in two columns; on a phone they are names in one column, no lines. Its foot is the door to
    "Every page, by room" further down the page. */
export const ProductsMenu = ({ onPick, onEvery, compact = false }: { onPick: (p: Product) => void; onEvery: () => void; compact?: boolean }) => (
  <div>
    <div className={compact ? 'flex flex-col' : 'columns-2 gap-x-10'} data-landing-products>
      {PRODUCT_GROUPS.map(g => (
        <div key={g.caption} className={compact ? 'pt-3' : 'break-inside-avoid pb-5'}>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-textMuted">{g.caption}</p>
          <ul className={compact ? 'mt-1' : 'mt-2 flex flex-col gap-0.5'}>
            {g.products.map(pr => (
              <li key={pr.name}>
                <a
                  href={pr.page ?? pr.path}
                  onClick={e => {
                    e.preventDefault();
                    onPick(pr);
                  }}
                  className={`group flex items-start gap-3 rounded-xl transition-colors hover:bg-ink/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-silver ${compact ? 'py-2 px-1' : 'p-2 -mx-2'}`}
                  data-landing-product={pr.name}
                >
                  <PageGlyph name={pr.glyph} size={compact ? 16 : 18} className="shrink-0 mt-[3px]" />
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-medium text-textPrimary leading-tight">{pr.name}</span>
                    {!compact && <span className="mt-1 block text-[12.5px] leading-snug text-textSecondary max-w-[38ch]">{pr.line}</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
    <a
      href="#everything"
      onClick={e => {
        e.preventDefault();
        onEvery();
      }}
      className={`group mt-3 flex items-center justify-between gap-3 border-t border-borderSubtle text-[13px] text-textSecondary hover:text-textPrimary transition-colors ${compact ? 'pt-3 pb-1' : 'pt-4'}`}
      data-landing-products-every
    >
      Every page, by room
      <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
    </a>
  </div>
);

/** THE BAR. Flat across the top of the page; once the page moves it lifts into a floating pill of
    glass. It wears the ground that is under it, so it turns when the page does. */
export const Nav = ({ ground, door }: { ground: Ground; door: boolean }) => {
  const { a, flip } = useGround();
  const { launch } = useLaunch();
  const site = useSiteLinks();
  const { scrollY } = useScroll();
  const [lifted, setLifted] = useState(false);
  useMotionValueEvent(scrollY, 'change', y => setLifted(y > 24));
  /* ONE MOTION, NOT TWO (Noah, 2026-10-03: "the button lags a bit before finding its spot in the far right corner. it
     moves to one spot then shifts to the right after like half a second" — then, of the door at the toggle's left: "the
     launch terminal should be far right always"). The bar used to narrow to the pill at 24px of scroll and take its door
     later, when the hero's door had left the screen — two triggers, so the toggle moved twice. Now the glass comes at
     24px and MOVES NOTHING (the bar keeps its width), and the bar narrows to the pill at the moment the door slides in,
     so the door's arrival and the pill's shrink are one motion, the door always last. The same one motion back, when the
     hero's or the closing door comes into view again. */
  const narrow = lifted && door;
  /* THE PHONE'S MENU (2026-09-19): under 768px the bar's three links were simply gone — a visitor on a phone, which is most
     of them, had no way to Pricing or the questions but to scroll for them. A button opens them as a small sheet under the
     bar, in the page's own grammar: rows on hairlines. It closes on a pick, on Escape, and on a tap outside it. */
  const [menu, setMenu] = useState(false);
  /* the Products menu on a desk: opens under its word, closes the same ways */
  const [products, setProducts] = useState(false);
  useEffect(() => {
    if (!menu && !products) return;
    const shut = () => {
      setMenu(false);
      setProducts(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shut();
    };
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-landing-menu], [data-landing-menu-door], [data-landing-products-panel], [data-landing-products-door]')) shut();
    };
    window.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', down, true);
    };
  }, [menu, products]);
  /* THE MENU OPENS UNDER THE POINTER (Noah, 2026-10-05: "i hover of this product button up top i think the dropdown should
     show and not wait for the user to click it"): a mouse resting on the word opens it, and it stays while the pointer is
     on the word or in the panel; leaving either closes it after a short grace, long enough to cross the gap between the
     bar and the panel. A touch or a key still opens and closes it by the press. A mouse CLICK on the word opens it rather
     than toggling, so a reader who hovers and then clicks out of habit does not shut what just opened. */
  const hoverClose = useRef(0);
  const byMouse = (e: ReactPointerEvent) => e.pointerType === 'mouse';
  const openOnHover = (e: ReactPointerEvent) => {
    if (!byMouse(e)) return;
    window.clearTimeout(hoverClose.current);
    setProducts(true);
  };
  const stay = (e: ReactPointerEvent) => {
    if (byMouse(e)) window.clearTimeout(hoverClose.current);
  };
  const closeSoon = (e: ReactPointerEvent) => {
    if (!byMouse(e)) return;
    window.clearTimeout(hoverClose.current);
    hoverClose.current = window.setTimeout(() => setProducts(false), 220);
  };
  useEffect(() => () => window.clearTimeout(hoverClose.current), []);
  const pick = (pr: Product) => {
    setMenu(false);
    setProducts(false);
    if (pr.page) return site.page(pr.page);
    launch(pr.path);
  };
  const toEvery = () => {
    setMenu(false);
    setProducts(false);
    site.section('#everything');
  };
  const glide = 'transition-[max-width,background-color,border-color,box-shadow,padding] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none';
  return (
    <header data-theme={ground} className="fixed top-0 inset-x-0 z-40 flex justify-center px-3 sm:px-4 pt-2.5 sm:pt-3.5 pointer-events-none" data-landing-nav={ground} data-lifted={lifted || undefined}>
      <div
        className={`pointer-events-auto relative w-full h-[52px] flex items-center gap-2 sm:gap-4 rounded-full border ${glide} ${
          lifted ? 'border-borderSubtle bg-panel/75 backdrop-blur-xl shadow-[0_16px_50px_-20px_rgb(0_0_0/0.55)]' : 'border-transparent bg-transparent'
        } ${narrow ? 'max-w-[860px] pl-5 pr-1.5' : 'max-w-[1408px] pl-1 sm:pl-2 lg:pl-6 pr-0 sm:pr-1 lg:pr-5'}`}
      >
        <button
          type="button"
          onClick={() => (site.home ? window.scrollTo({ top: 0, behavior: 'smooth' }) : site.page('/'))}
          className="shrink-0 inline-flex items-center select-none rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver"
          aria-label={site.home ? 'Slayer Terminal, back to the top' : 'Slayer Terminal, the front page'}
          data-landing-brand
        >
          {/* HIS PARTNER'S LOGO SYSTEM (2026-10-03): the wordmark with its cursor on the open bar; the bare S| on the lifted
              pill and on a phone */}
          <span className={narrow ? 'hidden' : 'hidden sm:inline-flex'}>
            <Wordmark height={15} cursor label="" />
          </span>
          <span className={narrow ? 'inline-flex' : 'sm:hidden inline-flex'}>
            <SlayerMark size={26} bare near label="" />
          </span>
        </button>
        {/* the three words stand at the bar's own middle, whatever is at its ends — they do not shift when the door slides in */}
        <nav className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2" aria-label="On this page">
          <button
            type="button"
            /* a key (detail 0) toggles; a mouse press opens */
            onClick={e => (e.detail === 0 ? setProducts(o => !o) : setProducts(true))}
            onPointerEnter={openOnHover}
            onPointerLeave={closeSoon}
            aria-expanded={products}
            aria-controls="landing-products"
            className={`h-8 pl-3.5 pr-2.5 inline-flex items-center gap-1 rounded-full text-[13.5px] transition-colors ${products ? 'text-textPrimary bg-ink/[0.06]' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`}
            data-landing-products-door
          >
            Products
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${products ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {NAV.map(l => (
            <a
              key={l.href}
              href={hrefOf(l.href, site.home)}
              onClick={e => {
                e.preventDefault();
                setProducts(false);
                site.section(l.href);
              }}
              className="h-8 px-3.5 inline-flex items-center rounded-full text-[13.5px] text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>
        {/* the right cluster: the toggle, the phone's menu, and the door LAST (Noah, 2026-10-03: "the launch terminal should be
            far right always"); the door's arrival moves the toggle once, with the pill's shrink (see `narrow` above) */}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={flip}
            /* the films are told the reader is reaching for the theme (films.ts themeIntent): the other theme's films start
               hidden and in step, so the press finds them playing */
            onPointerEnter={themeIntent}
            onPointerDown={themeIntent}
            onFocus={themeIntent}
            className="h-9 w-9 inline-flex items-center justify-center rounded-full text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-silver"
            aria-label={a === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
            title={a === 'dark' ? 'Light theme' : 'Dark theme'}
            data-landing-theme={a}
          >
            {a === 'dark' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => setMenu(m => !m)}
            className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-full text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-silver"
            aria-label={menu ? 'Close the menu' : 'Menu'}
            aria-expanded={menu}
            aria-controls="landing-menu"
            data-landing-menu-door
          >
            {menu ? <X className="w-4 h-4" aria-hidden="true" /> : <Menu className="w-4 h-4" aria-hidden="true" />}
          </button>
          {/* ONE DOOR ON THE SCREEN AT A TIME (Noah, 2026-10-01, with the bar's door and the hero's circled: "dont you think
              these 2 buttons being the same thing with the same shape and same wording is redundant?"). The bar's door
              stands only while no other "Launch the terminal" is in view — it slides in as the hero's leaves the screen,
              and out again where the closing one comes up. */}
          <AnimatePresence initial={false}>
            {door && (
              <motion.span
                key="door"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="shrink-0 overflow-hidden rounded-full"
              >
                <a
                  href={doorTo()}
                  onClick={e => {
                    e.preventDefault();
                    launch(doorTo());
                  }}
                  className={`${DOOR_GROUP} h-10 pl-4 pr-3.5 inline-flex items-center gap-1.5 rounded-full text-[13.5px] font-medium whitespace-nowrap ${ground === 'dark' ? 'holo-bg text-[#0a0a0a]' : 'galaxy-bg'}`}
                  data-landing-door="nav"
                >
                  <span className="sm:hidden">Launch</span>
                  <span className="hidden sm:inline">Launch terminal</span>
                  <ArrowRight className={`w-3.5 h-3.5 ${DOOR_ARROW}`} aria-hidden="true" />
                </a>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {/* the panel is centred by a still wrapper — the fade's own transform would undo a translate on the same box */}
        <div className="hidden md:block absolute top-[60px] left-1/2 -translate-x-1/2 w-[min(720px,calc(100vw-32px))]">
          <AnimatePresence>
            {products && (
              <motion.div
                id="landing-products"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                onPointerEnter={stay}
                onPointerLeave={closeSoon}
                className="max-h-[calc(100svh-96px)] overflow-y-auto rounded-3xl border border-borderSubtle bg-panel/95 backdrop-blur-xl shadow-[0_24px_60px_-24px_rgb(0_0_0/0.6)] px-7 pt-6 pb-5"
                data-landing-products-panel
              >
                <ProductsMenu onPick={pick} onEvery={toEvery} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {menu && (
          <motion.nav
            id="landing-menu"
            aria-label="On this page"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden pointer-events-auto absolute top-[70px] inset-x-3 max-h-[calc(100svh-90px)] overflow-y-auto rounded-3xl border border-borderSubtle bg-panel/95 backdrop-blur-xl shadow-[0_24px_60px_-24px_rgb(0_0_0/0.6)] px-5 pt-1 pb-4"
            data-landing-menu
          >
            <ProductsMenu onPick={pick} onEvery={toEvery} compact />
            <div className="mt-3 border-t border-borderSubtle" />
            {NAV.map(l => (
              <a
                key={l.href}
                href={hrefOf(l.href, site.home)}
                onClick={e => {
                  e.preventDefault();
                  setMenu(false);
                  site.section(l.href);
                }}
                className="flex items-center justify-between h-[52px] border-b border-borderSubtle text-[17px] text-textPrimary"
              >
                {l.label}
                <ArrowRight className="w-4 h-4 text-textMuted" aria-hidden="true" />
              </a>
            ))}
            <a
              href={doorTo()}
              onClick={e => {
                e.preventDefault();
                setMenu(false);
                launch(doorTo());
              }}
              className={`${DOOR_GROUP} mt-4 h-12 flex items-center justify-center gap-2 rounded-full text-[15px] font-medium ${ground === 'dark' ? 'holo-bg text-[#0a0a0a]' : 'galaxy-bg'}`}
              data-landing-door="menu"
            >
              Launch the terminal
              <ArrowRight className={`w-4 h-4 ${DOOR_ARROW}`} aria-hidden="true" />
            </a>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
};

/* THE LAST WORDS, READ BY SCROLLING (2026-10-03 — Noah, of his partner's closing lines: "the 'seen enough? step inside'
   of my partners has a cool animation that glides in so take a look at that and add it as well"): each letter of the
   closing lines stands faint and turns to its own ink, one letter at a time, as the lines come up the screen — the
   scroll is the playhead, and scrolling back takes them back. A reader that hears the page hears the lines whole (the
   label); where less motion is asked for, they stand lit. Only the letters that change are touched, and only while the
   lines are near the screen. A scroll that comes to rest with them on screen lights the rest of them, one after another.
   His partner's piece, in our words. */
export const LitLines = ({ lines, className = '' }: { lines: { text: string; ink: string }[]; className?: string }) => {
  const ref = useRef<HTMLHeadingElement | null>(null);
  const calm = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || calm) return;
    const letters = Array.from(el.querySelectorAll<HTMLElement>('[data-letter]'));
    let lit = -1;
    let raf = 0;
    let floor = 0;
    let rest = 0;
    let undo = 0;
    const show = (n: number) => {
      if (n === lit) return;
      const from = lit < 0 ? 0 : Math.min(n, lit);
      const to = lit < 0 ? letters.length : Math.max(n, lit);
      for (let i = from; i < to; i++) letters[i].dataset.lit = i < n ? 'on' : 'off';
      lit = n;
    };
    /* the lines light from the moment their top crosses 95% of the screen's height to the moment it reaches 70% */
    const paint = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      const vh = window.innerHeight;
      if (top > vh * 0.95) floor = 0;
      const p = Math.max(0, Math.min(1, (vh * 0.95 - top) / (vh * 0.25)));
      show(Math.max(floor, Math.round(p * letters.length)));
    };
    /* a scroll that stops with the lines on screen: the rest of the letters come on, 30ms apart */
    const settle = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.top > vh * 0.9 || r.bottom < 0 || lit >= letters.length) return;
      const from = Math.max(0, lit);
      for (let i = from; i < letters.length; i++) letters[i].style.transitionDelay = `${(i - from) * 30}ms`;
      floor = letters.length;
      show(letters.length);
      window.clearTimeout(undo);
      undo = window.setTimeout(() => letters.forEach(l => (l.style.transitionDelay = '')), (letters.length - from) * 30 + 250);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(paint);
      window.clearTimeout(rest);
      rest = window.setTimeout(settle, 700);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          window.addEventListener('scroll', on, { passive: true });
          on();
        } else window.removeEventListener('scroll', on);
      },
      { rootMargin: '25% 0px' }
    );
    io.observe(el);
    paint();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', on);
      cancelAnimationFrame(raf);
      window.clearTimeout(rest);
      window.clearTimeout(undo);
    };
  }, [calm]);
  return (
    <h2 ref={ref} aria-label={lines.map(l => l.text).join(' ')} className={className} data-lit-lines>
      {lines.map((l, i) => (
        <span key={l.text} aria-hidden="true" className={i ? 'block' : ''}>
          {l.text.split(' ').map((word, w, words) => (
            <span key={w}>
              <span className="inline-block whitespace-nowrap">
                {Array.from(word).map((ch, c) => (
                  <span key={c} data-letter data-lit={calm ? 'on' : 'off'} className={`${l.ink} data-[lit=off]:text-textPrimary/[0.14] transition-colors duration-200 motion-reduce:transition-none`}>
                    {ch}
                  </span>
                ))}
              </span>
              {w < words.length - 1 && ' '}
            </span>
          ))}
          {i < lines.length - 1 && ' '}
        </span>
      ))}
    </h2>
  );
};
