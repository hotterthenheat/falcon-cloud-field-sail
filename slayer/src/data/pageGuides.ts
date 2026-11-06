/* A short guide to each page, for the "?" help sheet: what the page is for and the two or three things to know first.
   The page in view is matched by the longest prefix of its address. Plain words; no vendor is named. */

export interface PageGuide {
  /** The address prefix the guide covers */
  path: string;
  name: string;
  /** One line: what the page is for */
  line: string;
  /** Two or three things to know first */
  tips: string[];
}

export const PAGE_GUIDES: readonly PageGuide[] = [
  {
    path: '/pulse',
    name: 'Pulse',
    line: 'Your desk of live panels: the chart, dealer pressure and key levels, arranged your way.',
    tips: ['Add, drag and resize tiles; the desk saves as you go.', 'The name in the top bar is the one every tile reads — change it with Ctrl K.', 'A tile stamped “as of” is showing its last reading while the fresh one loads.'],
  },
  {
    path: '/terrain',
    name: 'Terrain',
    line: 'Charts only: one to four side by side on one set of controls.',
    tips: ['Press 1–4 for the number of charts and [ ] to move between them.', 'The strike rail (R) puts the dealer book beside a chart.', 'Each pane has its own name search; S opens it.'],
  },
  {
    path: '/trace',
    name: 'Trace',
    line: 'The options flow tape and the ways to read it: the prints, net flow, dark pool and spreads.',
    tips: ['Live Tape is every print as it lands; the screener filters it.', 'Net Flow shows which way each name’s money leans through the day.', 'Mark a contract with its bookmark to follow it in the Tracker.'],
  },
  {
    path: '/dossier',
    name: 'Dossier',
    line: 'The file on a name: news, earnings, insiders, Congress, institutions and how it screens.',
    tips: ['Open any name’s page from the Stocks screen or the search.', 'The earnings calendar shows the move the options price in for each report.', 'Filings are the record as filed, not a quote: they refresh in minutes.'],
  },
  {
    path: '/pinpoint',
    name: 'Pinpoint',
    line: 'Where dealer hedging sits and what it does to price: the book by strike and expiry.',
    tips: ['The Map shows the book; the Agenda ranks the strikes that matter today.', 'Walls and the flip appear only once the day’s contracts are in — “…” means still loading.', 'Compare puts two names side by side; the Board shows every name at once.'],
  },
  {
    path: '/compass',
    name: 'Compass',
    line: 'Contracts scored on live quotes by the server’s scan, same day and one to seven days out.',
    tips: ['The board lists the calls that cleared the bar; open one for its chart and quote.', 'The Blotter is the official record of every call, entry to exit.', 'Turn on call alerts to hear a new call wherever you are.'],
  },
  {
    path: '/weigher',
    name: 'Weigher',
    line: 'Chart, chain and watchlist on one desk: weigh a contract before you take it.',
    tips: ['Pick a strike in the chain to see what it returns at every price and date.', 'The book sits at every strike of the chain.', 'Your watchlist sits on the same desk.'],
  },
  {
    path: '/practice/paper',
    name: 'Paper Trade',
    line: 'Trade today’s option chains with pretend money at each contract’s live bid and ask.',
    tips: ['Orders fill only on a fresh two-sided quote.', 'Nothing reaches a broker.', 'Closed trades land in the Journal.'],
  },
  {
    path: '/practice/backtest',
    name: 'Backtest',
    line: 'Replay a past session a minute at a time and trade it with pretend money.',
    tips: ['Space plays and pauses the clock; ← → step a minute.', 'Fills are at the recorded bid and ask.', 'N rings the bell and opens the next day.'],
  },
  {
    path: '/practice/journal',
    name: 'Journal',
    line: 'Every trade you closed, on its day, with your own words on it.',
    tips: ['Open a trade for its chart and notes; ← → walk the trades.', 'Paper and backtest books are kept apart.'],
  },
  {
    path: '/community',
    name: 'Community',
    line: 'The traders’ room. It opens after launch.',
    tips: [],
  },
  {
    path: '/settings',
    name: 'Settings',
    line: 'Your account and plan, how the terminal looks, what the desk opens on.',
    tips: ['Appearance switches dark, light or your system’s choice.', 'Data exports everything this machine keeps, and shows whether the feeds answer.'],
  },
  {
    path: '/status',
    name: 'Status',
    line: 'Whether each of the terminal’s data paths is answering, and how old its last answer is.',
    tips: ['It reads what the pages themselves heard, and asks each path once more while open.', 'An outage here also shows as a strip over every page.'],
  },
  {
    path: '/changelog',
    name: 'Changelog',
    line: 'What changed in the terminal, newest first.',
    tips: [],
  },
  {
    path: '/report',
    name: 'Report a problem',
    line: 'Tell us what went wrong; the page attaches the details that help us find it.',
    tips: ['You see everything attached before it leaves, and it leaves only when you copy or download it.', 'Never paste a password, a card number or a key.'],
  },
];

/** The guide for an address: the longest prefix that matches, or null */
export function guideFor(pathname: string): PageGuide | null {
  let best: PageGuide | null = null;
  for (const g of PAGE_GUIDES) if ((pathname === g.path || pathname.startsWith(`${g.path}/`)) && (!best || g.path.length > best.path.length)) best = g;
  return best;
}
