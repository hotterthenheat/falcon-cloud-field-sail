/*
  The site footer, rendered by AppShell under every page (the landing and product pages render it too). It is
  FooterArt's screen with the page's scene (footer/registry.ts), the links and a status line. `home` changes only
  link behaviour: on the landing #pricing/#faq are in-page anchors and doors into the terminal play the launch gate;
  inside the terminal they route back to the landing. Product pages (/products/*) are outside the terminal too.
*/

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLaunch } from './LaunchTransition';
import Wordmark from '../../brand/Wordmark';
import Signature from '../../brand/Signature';
import { readMarketState } from '../../data/marketState';
import { nyClock, nyMinutes } from '../../core/nyTime';
import { useAlertsDrawer } from '../../data/alertsDrawer';
import { sceneFor } from './footer/registry';

const FooterArt = lazy(() => import('./FooterArt'));

/* Every row goes where it says. Products follow the rail's order; one with its own site page opens that page, the rest
   open the terminal. Alerts is a drawer over every page, not a product. */
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
        /* the legal pages */
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

/** Site pages outside the terminal: a link to one is plain, never the launch gate. */
const SITE = /^\/(products\/|terms|privacy|$)/;

/** One link component (anchor, route, mailto). `home`: anchors are in-page; `gate`: doors into the terminal play the
    launch transition. */
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
  /* from outside the terminal every door into it plays the launch gate */
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

/* the market state in New York for the status line, from data/marketState.ts like the signature's word */
/* pre-market starts at 04:00 ET; before it and from 20:00 it is overnight. The clock beside it is Central, 12-hour. */
const sessionWordAt = (d: Date, short: string): string => {
  if (short !== 'pre-market' && short !== 'after hours') return short;
  const m = nyMinutes(d);
  return m < 4 * 60 || m >= 20 * 60 ? 'overnight' : short;
};
const marketNow = (d = new Date()): { words: string; clock: string } => ({ words: sessionWordAt(d, readMarketState(d).short), clock: nyClock(d, { zone: true }) });
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
  /* the landing shows every product at once, other pages their own; with the alerts drawer open, the alerts scene */
  const alerts = useAlertsDrawer();
  const scene = home && pathname === '/' ? 'landing' : alerts ? 'alerts' : sceneFor(pathname);
  const market = useMarketNow();
  return (
    /* shrink-0: on the Weigher the footer shares a fixed-height column and would otherwise collapse to nothing */
    <footer className="shrink-0 border-t border-borderSubtle overflow-hidden bg-canvas" data-site-footer={scene}>
      <Suspense fallback={<div className="min-h-[120px]" />}>
      <FooterArt scene={scene} live={scene === 'landing'}>
        {/* the column is the container query (index.css .footer-sheet): the footer lays out by the room it has */}
        <div className="footer-sheet mx-auto w-full max-w-[1240px] px-6 lg:px-10 pt-12 lg:pt-14">
          <div className="footer-grid">
            {/* the art frames the panels ([data-footer-panel]) under the pointer */}
            <div className="self-start" data-footer-panel>
              {/* the wordmark with its cursor */}
              <Wordmark height={13} cursor label="Slayer Terminal" />
              <p className="footer-word mt-4 text-t16 leading-[22px] font-medium tracking-tight text-textPrimary" data-footer-lit>
                Trade what you can see.
              </p>
              <p className="footer-word mt-1.5 max-w-[46ch] text-t125 leading-relaxed text-textSecondary" data-footer-lit>
                Most of what moves a price is public, just scattered. Slayer gathers it into one terminal.
              </p>
            </div>
            {/* the empty box the art draws the scene in */}
            <div aria-hidden="true" data-footer-scene />
            {/* the link stacks sit close so the picture gets the room */}
            <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-7">
              {STACKS.map(stack => (
                <div key={stack[0].title} className="flex flex-col gap-6">
                  {stack.map(col => (
                    <div key={col.title} className="footer-col" data-footer-panel>
                      <span className="footer-word block font-mono text-t10 font-bold uppercase tracking-widest text-textMuted" data-footer-lit>
                        {col.title}
                      </span>
                      <ul className={`mt-3 grid gap-x-4 gap-y-2 ${col.wide ? 'grid-cols-4' : ''}`}>
                        {col.links.map(l => (
                          <li key={l.label}>
                            <FooterLink to={l.to} home={home} gate={gate} className="footer-word footer-link whitespace-nowrap text-t125 leading-[18px] text-textSecondary hover:text-textPrimary transition-colors">
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
        {/* the status line: market state, disclaimer, owner */}
        <div className="mx-auto w-full max-w-[1240px] px-6 lg:px-10 mt-10 lg:mt-12">
          <div className="border-t border-borderSubtle/70 py-4 flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-t105 tracking-wide text-textMuted">
            {/* the signature, the finer session word where it adds one (pre-market, after hours, weekend), and the New York clock */}
            <span className="inline-flex items-center whitespace-nowrap" data-footer-market={market.words}>
              <Signature rule={false} detail={`· ${market.words === 'market open' || market.words === 'closed' ? '' : `${market.words} · `}${market.clock} New York`} className="text-t105" />
            </span>
            <span className="footer-word order-last lg:order-none basis-full lg:basis-auto" data-footer-lit>
              For informational purposes only. Not investment advice.
            </span>
            <span className="footer-word ml-auto whitespace-nowrap" data-footer-lit>
              {/* the year from the calendar */}© {new Date().getFullYear()} Slayer Terminal
            </span>
          </div>
        </div>
      </FooterArt>
      </Suspense>
    </footer>
  );
};

export default SiteFooter;
