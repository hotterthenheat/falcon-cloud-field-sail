/* The ThetaData v3 paths the app may call, and how long an answer stays good. Shared by the dev/Vercel proxy
   (server/thetaProxy.mjs) and the relay beside the always-on terminal (theta/relay.mjs). */

export const THETA_ALLOWED = [
  /^\/stock\/.+/,
  /^\/option\/.+/,
  /^\/index\/.+/,
  /^\/calendar\/(?:today|on_date|year_holidays)(?:\?|$)/,
  /^\/interest_rate\/history\/eod(?:\?|$)/,
];

export const thetaAllowed = (p) => THETA_ALLOWED.some((re) => re.test(p));

const NY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayNy = () => NY_DATE.format(new Date()).replace(/-/g, '');

/** Milliseconds an answer may be reused. Snapshots move every tick: shared only within a burst. */
export function thetaTtl(p) {
  const [path, query = ''] = p.split('?');
  if (/^\/(calendar|interest_rate)\//.test(path)) return 300_000;
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
