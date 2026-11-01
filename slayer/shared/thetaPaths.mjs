/* The ThetaData v3 paths the app may call, and how long an answer stays good. Shared by the dev/Vercel proxy
   (server/thetaProxy.mjs) and the relay beside the always-on terminal (theta/relay.mjs). */

/* By family and endpoint, only what the app calls (scripts/theta-paths-proof.ts lists every path in src/, server/,
   scripts/ and theta/ and checks each passes). Anything else answers 404 — above all the flat files
   (/option|stock|index/flat_file/*: the whole market for a day, several GB), which are denied before the list is read.
   A new endpoint needs its line here. */
export const THETA_DENIED = [/\/flat_file(?:\/|\?|$)/, /\/market_value(?:\?|$)/];

export const THETA_ALLOWED = [
  /^\/stock\/list\/(?:symbols|dates\/(?:trade|quote))(?:\?|$)/,
  /^\/stock\/snapshot\/(?:quote|trade|ohlc)(?:\?|$)/,
  /* trade_quote: Terrain's stock tape on the server (src/data/tapeServer.ts), each print with the quote in force */
  /^\/stock\/history\/(?:eod|ohlc|trade|quote|trade_quote)(?:\?|$)/,
  /^\/option\/list\/(?:symbols|expirations|strikes|dates\/(?:trade|quote)|contracts\/(?:trade|quote))(?:\?|$)/,
  /^\/option\/snapshot\/(?:quote|ohlc|open_interest|greeks\/(?:first_order|second_order|all|implied_volatility))(?:\?|$)/,
  /^\/option\/history\/(?:eod|ohlc|quote|trade|trade_quote|open_interest|greeks\/(?:eod|first_order|second_order|all|implied_volatility))(?:\?|$)/,
  /^\/option\/at_time\/quote(?:\?|$)/,
  /^\/index\/list\/symbols(?:\?|$)/,
  /^\/index\/snapshot\/(?:price|ohlc)(?:\?|$)/,
  /^\/index\/history\/(?:eod|ohlc)(?:\?|$)/,
  /^\/calendar\/(?:today|on_date|year_holidays)(?:\?|$)/,
  /^\/interest_rate\/history\/eod(?:\?|$)/,
];

export const thetaAllowed = (p) => typeof p === 'string' && !THETA_DENIED.some((re) => re.test(p.split('?')[0])) && THETA_ALLOWED.some((re) => re.test(p));

const NY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayNy = () => NY_DATE.format(new Date()).replace(/-/g, '');

/** Milliseconds an answer may be reused. Snapshots move every tick: shared only within a burst. */
export function thetaTtl(p) {
  const [path, query = ''] = p.split('?');
  /* the rate history and a year's holidays change once a day at most: every browser asks one path a publishing day
     (src/data/rateFeed.ts ratePath, holidayFeed.ts), so the vendor is asked about once a day */
  if (/^\/(interest_rate\/|calendar\/year_holidays)/.test(path)) return 24 * 3_600_000;
  if (/^\/calendar\//.test(path)) return 300_000;
  if (/\/list\//.test(path)) return 300_000;
  if (/\/snapshot\//.test(path)) return 400;
  if (/\/(history|at_time)\//.test(path)) {
    /* a day that has closed never changes again */
    const q = new URLSearchParams(query);
    const end = (q.get('end_date') || q.get('date') || q.get('start_date') || '').replace(/-/g, '');
    if (end && end < todayNy()) return 6 * 3_600_000;
    return 5_000;
  }
  return 1_000;
}

/** The terminal answers "Invalid session ID" when another terminal holds the account. */
export const sessionLost = (text) => /invalid session id/i.test(text);
