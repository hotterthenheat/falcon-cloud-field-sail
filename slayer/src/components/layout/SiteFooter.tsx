/*
==================================================
  SLAYER TERMINAL - SITE FOOTER
  The landing page's footer, extracted so it ends
  EVERY main page (Noah, 2026-08-23) — AppShell
  renders it under the routed content; the landing
  and the products' pages keep their own copies.

  ONE PIECE, HIS PARTNER'S PICTURES (2026-10-03 —
  Noah, with his partner's footer: the whole footer
  one screen, the terminal caught in the dark, a
  picture a page, still until a hand is on it; then
  2026-10-07: "for the footers my partner actually
  wants the other ones and not the actual look of the
  website"). The footer is FooterArt's screen, and the
  picture on it is one of his partner's drawn scenes
  (footer/scenes.ts, picked by the address in
  footer/registry.ts) — Pulse's desk, Terrain's strike
  field, Trace's tape, the Dossier's map, the book's
  walls, Compass's cards, the Weigher's curve, Paper's
  orders, the backtest's scrubber, the Journal's month,
  and on the landing every product at once, moving. The
  page's own still broken into pixels — our first cut —
  is gone at his word. Half the height his first one had
  (his: "the footers are a bit big"): the words and the
  three stacks of links on the left, the picture beside
  them as tall as they are, one status line at the
  foot. The words stay crisp: the fringe is the
  picture's, not the links'.

  `home` changes only the link plumbing, never the
  look: on the landing, #pricing/#faq are in-page
  anchors and every door into the terminal plays the
  launch gate; in the terminal they route back to the
  landing's sections and the doors are plain
  navigations. A product's own page (/products/*) is
  outside the terminal too, so its doors play the
  gate; its anchors route home.
==================================================
*/

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLaunch } from './LaunchTransition';
import Wordmark from '../../brand/Wordmark';
import Signature from '../../brand/Signature';
import { readMarketState } from '../../data/marketState';
import { useAlertsDrawer } from '../../data/alertsDrawer';
import FooterArt from './FooterArt';
import { sceneFor } from './footer/registry';

/* THE LINKS, WALKED (2026-09-19). What was wrong: "Launch Terminal" and "Log in / Sign up" both went to "/", the front page
   — on the front page itself they did nothing, and there is no sign-in to go to yet; "Pulse" was listed twice; Terrain, a
   whole product, was not listed at all; "FAQ" is called Questions everywhere else. Now every row goes where it says.
   THE PRODUCTS ARE THE PRODUCTS MENU'S (2026-10-03): the eleven, in the rail's order, four abreast; one with a page of its own
   on the site opens that page, the rest open the terminal at theirs. Alerts is not among them (Noah, 2026-10-10: "just an
   in-house thing not an entire page") — a drawer over every page of the terminal, not a product. */
interface FooterLinkDef {
  label: string;
  to: string;
}
interface FooterCol {
  title: string;
  links: FooterLinkDef[];
  /** the links four abreast (the products) */
  wide?: true;
}
const PRODUCTS: FooterCol = {
  title: 'Products',
  wide: true,
  links: [
    { label: 'Pulse', to: '/products/pulse' },
    { label: 'Terrain', to: '/products/terrain' },
    { label: 'Trace', to: '/products/trace' },
    { label: 'Dossier', to: '/products/dossier' },
    { label: 'Pinpoint', to: '/products/pinpoint' },
    { label: 'Compass', to: '/products/compass' },
    { label: 'Weigher', to: '/products/weigher' },
    { label: 'Practice', to: '/products/practice' },
    { label: 'Paper Trade', to: '/products/paper' },
    { label: 'Backtest', to: '/products/backtest' },
    { label: 'Journal', to: '/products/journal' },
  ],
};
const STACKS: FooterCol[][] = [
  [PRODUCTS],
  [
    {
      title: 'Company',
      links: [
        { label: 'Pricing', to: '#pricing' },
        { label: 'Questions', to: '#faq' },
        { label: 'Community', to: '/community' },
        { label: 'Contact', to: 'mailto:info@slayerterminal.com' },
        /* the legal pages (2026-10-05) */
        { label: 'Terms', to: '/terms' },
        { label: 'Privacy', to: '/privacy' },
      ],
    },
    { title: 'Social', links: [{ label: '@JoinSlayer on X', to: 'https://x.com/JoinSlayer' }] },
  ],
  [
    {
      title: 'Terminal',
      links: [
        { label: 'Launch terminal', to: '/pulse' },
        { label: 'Tracker', to: '/compass/tracker' },
        { label: 'Settings', to: '/settings' },
        { label: 'Keyboard shortcuts', to: '/settings/keyboard' },
        { label: 'Front page', to: '/' },
      ],
    },
  ],
];

/** the pages of the site that are not the terminal: a door to one is a plain link, never the launch gate */
const SITE = /^\/(products\/|terms|privacy|$)/;

/** Anchor / route / mailto — one link component so the columns stay declarative. `home`: the anchors are in-page; `gate`:
    a door into the terminal plays the launch transition (the landing and the products' pages). */
const FooterLink = ({ to, home, gate, className, children }: { to: string; home: boolean; gate: boolean; className: string; children: ReactNode }) => {
  const { launch } = useLaunch();
  if (to.startsWith('https:')) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  if (to.startsWith('mailto:')) {
    return (
      <a href={to} className={className}>
        {children}
      </a>
    );
  }
  if (to.startsWith('#')) {
    return home ? (
      <a href={to} className={className}>
        {children}
      </a>
    ) : (
      <Link to={`/${to}`} className={className}>
        {children}
      </Link>
    );
  }
  /* on the front page, "Front page" is the way back to its top */
  if (to === '/' && home) {
    return (
      <a
        href="/"
        className={className}
        onClick={e => {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      >
        {children}
      </a>
    );
  }
  /* from outside the terminal every door into it plays the launch gate — it was only Pulse's, and the other products cut
     straight to a half-loaded page */
  if (gate && !SITE.test(to)) {
    return (
      <a
        href={to}
        className={className}
        onClick={e => {
          e.preventDefault();
          launch(to);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
};

/* THE MARKET'S STATE, in New York, on the real clock (the status line): the brand's own reading (data/marketState.ts —
   the signature's word comes from the same place, so the dot and the words never disagree) and the clock */
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
const marketNow = (d = new Date()): { words: string; clock: string } => ({ words: readMarketState(d).short, clock: NY.format(d).replace(/^24/, '00') });
const useMarketNow = () => {
  const [state, setState] = useState(marketNow);
  useEffect(() => {
    const t = window.setInterval(() => setState(marketNow()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return state;
};

const SiteFooter = ({ home = false }: { home?: boolean }) => {
  const { pathname } = useLocation();
  const gate = home || pathname.startsWith('/products/');
  /* the landing's picture is every product at once; every other page's is its own, by its address — and while the alerts
     drawer is open over a page, the footer under it is the alerts' (his partner's rule: they have no page of their own) */
  const alerts = useAlertsDrawer();
  const scene = home && pathname === '/' ? 'landing' : alerts ? 'alerts' : sceneFor(pathname);
  const market = useMarketNow();
  return (
    /* shrink-0: on the Weigher the footer shares a definite-height flex column
       with a full-viewport desk — left shrinkable, flexbox would absorb the
       whole deficit HERE and silently collapse the footer to nothing. */
    <footer className="shrink-0 border-t border-borderSubtle overflow-hidden bg-canvas" data-site-footer={scene}>
      <FooterArt scene={scene} live={scene === 'landing'}>
        {/* the column is the layout's query (index.css .footer-sheet): a page with the rail open lays its footer by the
            room it has, not the screen's */}
        <div className="footer-sheet mx-auto w-full max-w-[1240px] px-6 lg:px-10 pt-12 lg:pt-14">
          <div className="footer-grid">
            {/* the art frames the panels ([data-footer-panel]) under the pointer */}
            <div className="self-start" data-footer-panel>
              {/* the wordmark with its cursor (his partner's logo system, 2026-10-03) */}
              <Wordmark height={13} cursor label="Slayer Terminal" />
              <p className="footer-word mt-4 text-[16px] leading-[22px] font-medium tracking-tight text-textPrimary" data-footer-lit>
                Trade what you can see.
              </p>
              <p className="footer-word mt-1.5 max-w-[46ch] text-[12.5px] leading-relaxed text-textSecondary" data-footer-lit>
                Most of what moves a price is public, just scattered. Slayer gathers it into one terminal.
              </p>
            </div>
            {/* THE SCREEN'S PICTURE: an empty box the art draws the page's scene in */}
            <div aria-hidden="true" data-footer-scene />
            {/* the stacks a step closer (2026-10-07): the room they give up goes to the picture beside them */}
            <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-7">
              {STACKS.map(stack => (
                <div key={stack[0].title} className="flex flex-col gap-6">
                  {stack.map(col => (
                    <div key={col.title} className="footer-col" data-footer-panel>
                      <span className="footer-word block font-mono text-[10px] font-bold uppercase tracking-widest text-textMuted" data-footer-lit>
                        {col.title}
                      </span>
                      <ul className={`mt-3 grid gap-x-4 gap-y-2 ${col.wide ? 'grid-cols-4' : ''}`}>
                        {col.links.map(l => (
                          <li key={l.label}>
                            <FooterLink to={l.to} home={home} gate={gate} className="footer-word footer-link whitespace-nowrap text-[12.5px] leading-[18px] text-textSecondary hover:text-textPrimary transition-colors">
                              <span data-footer-lit>{l.label}</span>
                            </FooterLink>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </div>
        {/* THE STATUS LINE, at the screen's foot: the market's state on the real clock, what this is not, whose it is */}
        <div className="mx-auto w-full max-w-[1240px] px-6 lg:px-10 mt-10 lg:mt-12">
          <div className="border-t border-borderSubtle/70 py-4 flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[10.5px] tracking-wide text-textMuted">
            {/* the signature (his partner's logo system, 2026-10-03), the market's finer word after it where it adds one
                (pre-market, after hours, the weekend), and the New York clock */}
            <span className="inline-flex items-center whitespace-nowrap" data-footer-market={market.words}>
              <Signature rule={false} detail={`· ${market.words === 'market open' || market.words === 'closed' ? '' : `${market.words} · `}${market.clock} New York`} className="text-[10.5px]" />
            </span>
            <span className="footer-word order-last lg:order-none basis-full lg:basis-auto" data-footer-lit>
              For informational purposes only. Not investment advice.
            </span>
            <span className="footer-word ml-auto whitespace-nowrap" data-footer-lit>
              {/* the year is the calendar's, not a number typed once (2026-09-19) */}© {new Date().getFullYear()} Slayer Terminal
            </span>
          </div>
        </div>
      </FooterArt>
    </footer>
  );
};

export default SiteFooter;
