/* THE CHANGELOG: what changed for the people who use the terminal, in their words, newest first. Written from main's own
   history; one entry is one change a reader would notice. To add one: put it at the top with today's New York date and
   an id nobody used before. The page sorts by date anyway (changelogOrder), so an entry out of place still lands right,
   and scripts/surfaces-proof.ts fails a duplicate id, a bad date or a vendor's name. */

export type ChangeKind = 'new' | 'improved' | 'fixed';

/** The page a change is about: one of the rail's products, or the terminal as a whole */
export type ChangeArea = 'Terminal' | 'Pulse' | 'Terrain' | 'Trace' | 'Dossier' | 'Pinpoint' | 'Compass' | 'Weigher' | 'Practice';

export interface ChangeEntry {
  /** Stable, unique: `YYYY-MM-DD-short-name` */
  id: string;
  /** New York date it reached main, YYYY-MM-DD */
  date: string;
  kind: ChangeKind;
  area: ChangeArea;
  title: string;
  /** One or two plain sentences: what the reader sees now */
  body: string;
  /** Where to see it */
  to?: string;
}

export const CHANGELOG: readonly ChangeEntry[] = [
  {
    id: '2026-11-06-help-surfaces',
    date: '2026-11-06',
    kind: 'new',
    area: 'Terminal',
    title: 'Status, changelog, bug reports, notifications and help',
    body: 'A status page shows whether live quotes, options flow, Compass and the server are answering, and how old their last answer is. Notifications gathers your alerts, Compass calls and paper fills in one list. Press “?” anywhere for the keyboard shortcuts and a short guide to the page you are on.',
    to: '/status',
  },
  {
    id: '2026-11-06-overlays',
    date: '2026-11-06',
    kind: 'improved',
    area: 'Terminal',
    title: 'Menus, drawers and the search work the same way everywhere',
    body: 'The search palette, the alerts and watchlist drawers, every dropdown, popover and tooltip now share one set of parts. Focus moves into them and back to where you were when they close, Escape closes the innermost one first, and they look the same in light and dark.',
  },
  {
    id: '2026-11-06-levels-gate',
    date: '2026-11-06',
    kind: 'fixed',
    area: 'Pinpoint',
    title: 'Walls and the flip appear only once the real book is in',
    body: 'Every page that draws a call wall, a put wall or the gamma flip now waits for the same finished reading. Terrain, Weigher, Pulse, the Trader’s Clock and Compass no longer show levels from a stand-in book while the day’s contracts are still loading, and they agree with each other.',
    to: '/pinpoint/map',
  },
  {
    id: '2026-11-06-expected-move',
    date: '2026-11-06',
    kind: 'fixed',
    area: 'Pinpoint',
    title: 'The expected move is the full one-standard-deviation move',
    body: 'The 1σ range, the cone and the corridor were drawn at about 85% of the move the options price in. They now come straight from each expiry’s own volatility, and an index’s weekly expiries are priced off their own contracts instead of the 30-day figure.',
    to: '/pinpoint/map',
  },
  {
    id: '2026-11-06-pinpoint-figures',
    date: '2026-11-06',
    kind: 'fixed',
    area: 'Pinpoint',
    title: 'Clearer figures and labels on the book',
    body: 'Amounts that round up to the next unit say so ($1.0B, not $1,000M). Speed is labelled per 1% move. Compare’s regime tag and the net-GEX hover read the same regime, so they no longer contradict each other before the open. Higher greeks and charm are priced off the contracts themselves.',
  },
  {
    id: '2026-11-06-spx-flip',
    date: '2026-11-06',
    kind: 'fixed',
    area: 'Pinpoint',
    title: 'SPX’s all-expiries flip settles',
    body: 'On names with more than forty listed expiries, like SPX, the all-expiries flip kept showing “…” all day. It now settles once every expiry the book reads has loaded.',
  },
  {
    id: '2026-11-06-traders-clock',
    date: '2026-11-06',
    kind: 'fixed',
    area: 'Pinpoint',
    title: 'The Trader’s Clock waits for the Board',
    body: 'The share of gamma expiring at the bell is now the same measure the Board uses. While the Board is still loading, the clock says it is waiting instead of showing a different number.',
  },
  {
    id: '2026-11-06-model-risk-off',
    date: '2026-11-06',
    kind: 'improved',
    area: 'Compass',
    title: 'Model Risk is off',
    body: 'The tail-risk fade no longer places calls. Every version of it failed when tested on 651 past sessions, so it stays off until one earns its place.',
    to: '/compass',
  },
  {
    id: '2026-11-06-heat-threads',
    date: '2026-11-06',
    kind: 'new',
    area: 'Terrain',
    title: 'A preview of two new looks for the exposure nodes',
    body: 'Heat and threads, two new ways to draw the book’s biggest strikes on the chart, are in testing on development builds, with the range cone on the book’s own 1σ. The live terminal keeps today’s look until they are switched on for everyone.',
  },
  {
    id: '2026-11-05-compass-record',
    date: '2026-11-05',
    kind: 'fixed',
    area: 'Compass',
    title: 'The Compass record settles calls more carefully',
    body: 'Calls made overnight or before the open are followed in their own session. A call whose exit second could not be read stays open instead of being closed on the minute’s quote, and profit targets round up to the cent and are never under 1.5×.',
    to: '/compass/blotter',
  },
  {
    id: '2026-11-05-math-audit',
    date: '2026-11-05',
    kind: 'fixed',
    area: 'Weigher',
    title: 'A round of maths fixes on Terrain, Weigher and Practice',
    body: 'Vanna and charm are priced off the contracts, touch odds use the right drift, theta never exceeds what a contract has left to lose, the paper balance takes out an open position’s commission, and the previous close skips holidays.',
    to: '/weigher',
  },
  {
    id: '2026-11-04-terrain-ladder',
    date: '2026-11-04',
    kind: 'improved',
    area: 'Terrain',
    title: 'Terrain’s ladder and levels read more plainly',
    body: 'The ladder compares call and put volume strike by strike, session levels are the regular session’s, and exposure trails sit on the candles as a dotted trace.',
    to: '/terrain',
  },
  {
    id: '2026-11-04-one-greek',
    date: '2026-11-04',
    kind: 'fixed',
    area: 'Practice',
    title: 'One set of greeks across Weigher, Paper Trade and Backtest',
    body: 'The three desks now compute a contract’s greeks the same way, and each label matches the number beside it: vega and rho per 1.00 of volatility and rate, cash spot marked as such.',
    to: '/practice/paper',
  },
  {
    id: '2026-11-04-compass-review',
    date: '2026-11-04',
    kind: 'improved',
    area: 'Compass',
    title: 'Compass call alerts are timed from when you hear them',
    body: 'A call alert’s chip is timed from the moment your browser hears it, an open card on the Tracker uses the live bid, and a missed day can be studied before today.',
    to: '/compass/study',
  },
  {
    id: '2026-11-02-terrain-search',
    date: '2026-11-02',
    kind: 'improved',
    area: 'Terrain',
    title: 'Every Terrain pane has its own name search',
    body: 'Each chart opens its own search card with the name’s price and session. Keys act on the pane on screen, strike views open in that pane’s rail, and the time axis names each day once.',
    to: '/terrain',
  },
  {
    id: '2026-11-01-drawing-tools',
    date: '2026-11-01',
    kind: 'new',
    area: 'Terrain',
    title: 'The full drawing toolbar, technicals and candle patterns',
    body: 'Eighty-six drawing tools with an object tree, templates, undo and redo; dozens of built-in indicators from A to Z; and forty-four candlestick patterns, volume profiles, pivots and auto Fibonacci.',
    to: '/terrain',
  },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Newest first; within a day, new before improved before fixed, then the list's own order. */
export function changelogOrder(entries: readonly ChangeEntry[]): ChangeEntry[] {
  const rank: Record<ChangeKind, number> = { new: 0, improved: 1, fixed: 2 };
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date === b.e.date ? rank[a.e.kind] - rank[b.e.kind] || a.i - b.i : a.e.date < b.e.date ? 1 : -1))
    .map(x => x.e);
}

/** The entries by day, newest day first */
export function changelogDays(entries: readonly ChangeEntry[] = CHANGELOG): { date: string; entries: ChangeEntry[] }[] {
  const out: { date: string; entries: ChangeEntry[] }[] = [];
  for (const e of changelogOrder(entries)) {
    const last = out[out.length - 1];
    if (last && last.date === e.date) last.entries.push(e);
    else out.push({ date: e.date, entries: [e] });
  }
  return out;
}

/** What is wrong with the list, for the proof: duplicate ids, bad dates, an empty title or body */
export function changelogProblems(entries: readonly ChangeEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) out.push(`duplicate id ${e.id}`);
    seen.add(e.id);
    if (!DATE.test(e.date) || Number.isNaN(Date.parse(`${e.date}T12:00:00Z`))) out.push(`${e.id}: bad date ${e.date}`);
    if (!e.title.trim() || !e.body.trim()) out.push(`${e.id}: empty words`);
  }
  return out;
}

/** The newest entry's date: the build's "as of" line (the About box, the bug report) */
export const LATEST_CHANGE = changelogOrder(CHANGELOG)[0]?.date ?? '';
