/* The neutral words a user sees for our data feeds. This is a public website: no vendor or competitor is named
   anywhere a user can read it (titles, tooltips, aria-labels, meta, error and empty states). Code comments and
   internal identifiers may keep the vendor names; anything rendered imports its wording from here. */

/** The real-time quotes feed (stock, index and option prices, the chain, minute bars). */
export const QUOTES_FEED = 'Live quotes';
/** The market-data feed (the dealer book, the tape, flow, the record). */
export const MARKET_FEED = 'Market data';
/** Recorded history the backtest replays. */
export const HISTORY_FEED = 'recorded market data';

/** Short status word for the quotes feed being down. */
export const LIVE_OFFLINE = 'Live data offline';
/** The line a box shows while the quotes feed is down. */
export const LIVE_RECONNECTING = 'Live data offline — reconnecting';
/** The rail chip / dot tooltip while the quote feed is down and the last price is kept. */
export const LIVE_OFFLINE_KEPT = 'Live data is not answering. The price is the last one it gave.';
/** Waiting on the first live price. */
export const LIVE_WAITING = 'Waiting on live prices';

/** The dealer book did not answer for a name. */
export const bookNoAnswer = (again = 'The desk asks again on its next sweep.'): string =>
  `The market-data feed did not answer for this name's dealer book. ${again}`;
/** The dealer book has not landed yet. */
export const BOOK_NOT_LANDED = 'The dealer book has not landed yet.';

/** A price label: "Live quote · 10:42 ET". */
export const quoteStamp = (when?: string): string => (when ? `Live quote · ${when}` : 'Live quote');
/** A market-data quote label. */
export const marketStamp = (when?: string): string => (when ? `Market data · ${when}` : 'Market data');
