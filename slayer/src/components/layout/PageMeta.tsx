/* Every page's title and description: the tab reads "Page · Section · Slayer Terminal", the description is the section's own subtitle
   (subnav.ts). `SayPage` lets a page built round one thing name it; a link preview reads index.html, not this. */

import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { GEX_SUBPAGES } from '../../pages/pinpoint/subnav';
import { TRACE_SUBPAGES } from '../../pages/trace/subnav';
import { RECORD_SUBPAGES } from '../../pages/record/subnav';
import { PRACTICE_SUBPAGES } from '../../pages/practice/subnav';

const SITE = 'Slayer Terminal';
const LANDING = {
  title: `${SITE} — Trade what you can see`,
  description: 'Most of what moves a price is public, just scattered. Slayer gathers it into one terminal: the prints, the positions, the levels, the filings. Every page explains itself in plain English.',
};

interface Meta {
  title: string;
  description: string;
}

const page = (name: string, description: string, section?: string): Meta => ({ title: `${[name, section].filter(Boolean).join(' · ')} · ${SITE}`, description });

/* the pages that stand alone */
const TOP: Record<string, Meta> = {
  /* The products' own pages. */
  '/products/pulse': page('Pulse', 'The live desk: tiles — the chart, the book, key levels, the wire — that you add, drag and size, on a desk that saves as you go.', 'Products'),
  '/products/practice': page('Practice', 'Three rooms: paper trading on today’s live option quotes, a backtest that replays a recorded market session at the bid and ask each contract had, and the journal every closed trade lands in.', 'Products'),
  '/products/paper': page('Paper Trade','The live desk with nothing at stake: a practice account trading options off the chain at each contract’s live bid and ask.', 'Products'),
  '/products/backtest': page('Backtest', 'A recorded market session replayed a minute at a time and traded with pretend money, filled at the bid and ask each contract had, with your own rules and a report at the end.', 'Products'),
  '/products/journal': page('Journal', 'Every closed trade on its day, with the period’s figures beside the month, and a page of its own for each trade: the chart, the shape of it, your tags and your words.', 'Products'),
  '/products/terrain': page('Terrain', 'The chart page: one to four charts side by side on one set of controls, the dealer book beside any of them as a strike rail, the key levels on the candles with one switch, drawing tools, your own Pine scripts, and replay a bar at a time.', 'Products'),
  '/products/compass': page('Compass', 'Contracts scored on the terminal’s live quotes, same day and one to seven days out: a board of the calls that clear the bar, a page for every call with its chart and quote, the blotter of every call, and a Tracker for the ones you follow.', 'Products'),
  '/products/weigher': page('Weigher', 'One desk for the contracts you care about: the chart, the chain with the book at every strike, your positions and your watchlist, and a card that says what a contract returns at every price and every date.', 'Products'),
  '/products/trace': page('Trace', 'The options tape and every way to read it: the live prints with the dark pool beside them, which way each name’s money leans, what was built overnight, the quarter hour it happened in, the spreads, two names side by side.', 'Products'),
  '/products/pinpoint': page('Pinpoint', 'Where dealer hedging sits and what it does to price: the book by strike and expiry, the range to the close, what today added, whether a wall holds, the strikes in the order they matter, every name on one board, two names side by side.', 'Products'),
  '/products/dossier': page('Dossier', 'What is on the record for any name: the news wire with the numbers behind each headline, the earnings calendar, insiders, Congress, and a screen that scores every name.', 'Products'),
  '/pulse': page('Pulse', 'Your own desk of live panels: the chart, the hedging at every strike and the book across the calendar, arranged your way and kept as you left it.'),
  '/terrain': page('Terrain', 'Charts and nothing in the way: one to four side by side on one set of controls, with drawing tools, your own scripts and the book beside the chart.'),
  '/compass': page('Compass', 'Contracts that fit the levels right now. Each one carries a live state: active while the structure holds, watch while it forms, fading when it breaks.'),
  '/compass/tracker': page('Tracker', 'The setups you kept, followed to the close.', 'Compass'),
  '/compass/blotter': page('Blotter', 'Every trade recorded, from the fill in to the fill out.', 'Compass'),
  '/compass/review': page('Session review', 'Every trade it took, reviewed after the close: what went right, what went wrong, and why.', 'Compass'),
  '/compass/study': page('Session study', 'What moved 50% in the scan’s band, what the model read, and what stopped it.', 'Compass'),
  '/weigher': page('Weigher', 'Weigh any contract before you take it: the chart, the chain and your watchlist on one desk, and what a position would return at every price.'),
  '/community': page('Community', 'The traders’ room. It opens after launch.'),
  '/start': page('Start', 'Every page of the terminal, one picture and one line each: pick where to begin.'),
  '/signin': page('Sign in', 'Sign in to Slayer Terminal, or create your account.'),
  '/checkout': page('Checkout', 'On your way to Stripe’s checkout for the plan you chose.'),
  /* The legal pages. */
  '/terms': page('Terms of Service', 'The agreement between you and Slayer Terminal for the site and the terminal, each section said in plain words first.'),
  '/privacy': page('Privacy Policy', 'What Slayer Terminal keeps about you, where it lives, what it is for, and how to take it with you or have it deleted.'),
};

/* each is the line the section itself wears under its heading (pages/settings/Settings.tsx) */
const SETTINGS: Record<string, string> = {
  account: 'Who you are to the terminal: your picture, your name and how you sign in.',
  billing: 'Your plan and the card behind it. The card lives with Stripe, never here.',
  data: 'What is yours on this machine (the board, the marks, the alerts, the desks, these settings) and where the feed stands.',
  appearance: 'The terminal drawn in each theme: dark, light, or whatever your machine is set to.',
  desk: 'What every desk reads by: the ruler, the name and timeframe it opens on, the chime and the clock.',
  keyboard: 'Every key the terminal answers to, by where it works.',
  about: 'The terminal and its version.',
};
const SETTINGS_NAME: Record<string, string> = { account: 'Account', billing: 'Billing', data: 'Data', appearance: 'Appearance', desk: 'The desk', keyboard: 'Keyboard', about: 'About' };

const SECTIONS: { base: string; name: string; pages: { path: string; label: string; subtitle: string }[] }[] = [
  { base: '/pinpoint', name: 'Pinpoint', pages: GEX_SUBPAGES },
  { base: '/trace', name: 'Trace', pages: TRACE_SUBPAGES },
  { base: '/dossier', name: 'Dossier', pages: RECORD_SUBPAGES },
  { base: '/practice', name: 'Practice', pages: PRACTICE_SUBPAGES },
];

/* a NAME's own page says what is on it about that name — the list page's subtitle is about every name */
const NAME_PAGE: Record<string, (name: string) => string> = {
  '/dossier/stocks': n => `The dossier on ${n}, on one page: its chart, how it screens, its news, its earnings and its filings.`,
  '/dossier/earnings': n => `${n}’s earnings: the next print, the move priced for it, and what the name has typically done.`,
};

/** A subtitle is written for under a heading ("a & b — c"); as a description it reads as a sentence */
const sentence = (s: string): string => {
  const t = s.replace(/\s&\s/g, ' and ').replace(/\s—\s/g, ': ').trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/* ---- the words a page says of itself (the head note) ---- */
let said: string | null = null;
const saidListeners = new Set<() => void>();
export const sayPage = (words: string | null) => {
  if (words === said) return;
  said = words;
  saidListeners.forEach(fn => fn());
};
const useSaid = () =>
  useSyncExternalStore(
    fn => {
      saidListeners.add(fn);
      return () => saidListeners.delete(fn);
    },
    () => said,
    () => said
  );
/** Mounted by a page built round one thing: the tab carries its name while the page is up */
export const SayPage = ({ words }: { words: string | null | undefined }) => {
  useEffect(() => {
    sayPage(words ?? null);
    return () => sayPage(null);
  }, [words]);
  return null;
};
/** A segment of an address that is a NAME (a ticker), not an id */
const TICKER = /^[A-Za-z^][A-Za-z0-9.^-]{0,5}$/;

export function metaFor(pathname: string, own: string | null = null): Meta {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return LANDING;
  if (TOP[path]) return TOP[path];

  if (path === '/settings' || path.startsWith('/settings/')) {
    const s = path.split('/')[2] ?? 'account';
    return SETTINGS[s] ? page(SETTINGS_NAME[s], SETTINGS[s], 'Settings') : page('Settings', SETTINGS.account);
  }
  /* a setup's own page: /compass/NVDA-480-C-weekly-… — the name is the address's first part */
  if (path.startsWith('/compass/')) {
    const name = decodeURIComponent(path.split('/')[2] ?? '').split('-')[0].toUpperCase();
    return page(name ? `${name} setup` : 'Setup', 'One setup on its own page: why it was chosen, the levels it leans on, and its live state.', 'Compass');
  }
  for (const sec of SECTIONS) {
    if (path !== sec.base && !path.startsWith(`${sec.base}/`)) continue;
    const exact = sec.pages.find(p => p.path === path);
    /* a page's own words lead the tab where it says them (the Agenda's Building face: "Building · Agenda · Pinpoint") */
    if (exact) return page(own ?? exact.label, sentence(exact.subtitle), sec.name);
    /* a page under one of the section's pages: a NAME's own (/record/stocks/NVDA — the segment is the name), or a thing
       with an id (/practice/backtest/smuaf0fpb3x, /practice/journal/<account>/<trade>) that says its own words, or none */
    const parent = sec.pages.find(p => path.startsWith(`${p.path}/`));
    if (parent) {
      if (own) return page(own, sentence(parent.subtitle), parent.label);
      const seg = decodeURIComponent(path.slice(parent.path.length + 1).split('/')[0]);
      if (!TICKER.test(seg)) return page(parent.label, sentence(parent.subtitle), sec.name);
      const name = seg.toUpperCase();
      const about = NAME_PAGE[parent.path]?.(name) ?? sentence(parent.subtitle);
      return page(`${name} · ${parent.label}`, about, sec.name);
    }
    return page(sec.name, sentence(sec.pages[0].subtitle));
  }
  return { title: SITE, description: LANDING.description };
}

const setMeta = (selector: string, content: string) => {
  document.head.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content);
};

const PageMeta = () => {
  const { pathname } = useLocation();
  const own = useSaid();
  useEffect(() => {
    const m = metaFor(pathname, own);
    document.title = m.title;
    setMeta('meta[name="description"]', m.description);
    setMeta('meta[property="og:title"]', m.title);
    setMeta('meta[property="og:description"]', m.description);
    setMeta('meta[name="twitter:title"]', m.title);
    setMeta('meta[name="twitter:description"]', m.description);
  }, [pathname, own]);
  return null;
};

export default PageMeta;
