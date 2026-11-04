/*
  DATA READINESS (2026-10-31, the owner: "does all the data instantly load even if I'm not on the page?"). warmRooms
  fetches the main rooms' CODE at idle; this fetches their first-paint DATA for the active name, so moving to another
  room paints real numbers at once instead of a skeleton:

    1. the book (data/book — Terrain's field and rail, Pinpoint's map, Pulse's tiles, Weigher's levels)
    2. the price and the daily closes behind the day's change (data/thetaQuote)
    3. today's one-minute bars and the newest history chunk, every session (data/thetaTape via thetaCandles)
    4. Weigher's nearest-expiry chain, kept the way Weigher keeps its own (data/thetaFeed keepTheta), so Weigher paints it
       "as of" while its live read lands

  One job at a time, each after an idle moment, only once the page in view has had its own first data (a few seconds
  after it opened), never while the tab is hidden, and the queue is dropped the moment the reader moves or changes name.
  Each job is the stores' own read, so nothing is fetched that a store already holds fresh, and the data rules hold:
  where a page may not ask ThetaData (Trace, the Dossier; data/theta.ts) the ThetaData jobs ask nothing. The modules are
  loaded with the jobs, so the shell carries none of them.
*/

const START_AFTER_MS = 4_000;
/** A job that has not landed in this long is left to finish on its own; the queue moves on */
const JOB_CAP_MS = 12_000;
/** A kept chain younger than this is the reader's own Weigher visit: not replaced by the warm read */
const CHAIN_KEPT_FRESH_MS = 60_000;

let run = 0;
let timer = 0;

const idle = () =>
  new Promise<void>(resolve => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 3_000 });
    else window.setTimeout(resolve, 200);
  });

/** Resolves when `done()` holds (checked on each store change and every 250 ms), or after the cap */
function until(done: () => boolean, subscribe: (fn: () => void) => () => void, cap = JOB_CAP_MS): Promise<void> {
  return new Promise(resolve => {
    if (done()) return resolve();
    let off = () => {};
    const finish = () => {
      off();
      window.clearInterval(poll);
      window.clearTimeout(stop);
      resolve();
    };
    off = subscribe(() => {
      if (done()) finish();
    });
    const poll = window.setInterval(() => {
      if (done()) finish();
    }, 250);
    const stop = window.setTimeout(finish, cap);
  });
}

type Job = (ticker: string, here: string) => Promise<void>;

const bookJob: Job = async ticker => {
  const [{ ensureBook }, { peekEntry, subscribeBook }] = await Promise.all([import('./book/load'), import('./book/store')]);
  ensureBook(ticker, 'board');
  await until(() => peekEntry(ticker)?.status !== 'loading', subscribeBook);
};

const priceJob: Job = async ticker => {
  const [{ ensureThetaPrice, peekThetaPrice, subscribeTheta }, { thetaAllowedHere }] = await Promise.all([import('./thetaQuote'), import('./theta')]);
  if (!thetaAllowedHere('/stock/snapshot/trade')) return;
  ensureThetaPrice(ticker);
  await until(() => !!peekThetaPrice(ticker), subscribeTheta);
};

const barsJob: Job = async ticker => {
  const [{ wantChartTape }, { peekTape, subscribeTape }, { thetaAllowedHere }] = await Promise.all([import('./thetaCandles'), import('./thetaTape'), import('./theta')]);
  if (!thetaAllowedHere('/stock/history/ohlc')) return;
  /* every session's one-minute tape and the print, held only until the first reads land: the bars stay in the store */
  const offs = wantChartTape(ticker, '1m', 'rth');
  try {
    await until(() => peekTape(ticker, '1m', 'rth').state !== 'loading', subscribeTape);
  } finally {
    offs.forEach(off => off());
  }
};

const chainJob: Job = async (ticker, here) => {
  if (/^\/weigher/.test(here)) return;
  const [desk, feed, { thetaAllowedHere }] = await Promise.all([import('./weigherDesk'), import('./thetaFeed'), import('./theta')]);
  if (!thetaAllowedHere('/option/snapshot/quote')) return;
  const listed = await desk.listLiveExpiries(ticker);
  const rows = desk.listedOpen(listed.rows);
  if (listed.down || !rows.length) return;
  /* the expiry Weigher opens on for a name it has not shown: the front weekly */
  const front = rows.find(e => e.weekday === 0) ?? rows[0];
  const root = front.root || ticker;
  /* a chain already held fresh — the Weigher's own read, Paper's, an earlier warm-up (data/chainStore.ts) — is not read again */
  const { chainHeld } = await import('./chainStore');
  if (chainHeld(root, front.iso, 20, CHAIN_KEPT_FRESH_MS)) return;
  const key = `chain:${ticker}|${root}|${front.iso}`;
  const kept = await feed.keptTheta<unknown>(key);
  if (kept && Date.now() - kept.at < CHAIN_KEPT_FRESH_MS) return;
  const chain = await desk.loadLiveChain(ticker, front.dte, 20, front.root);
  if (chain.offline || !chain.rows.length || chain.expiryIso !== front.iso) return;
  feed.keepTheta(key, { ...chain, takenAt: Date.now() });
};

const compassJob: Job = async (_ticker, here) => {
  if (/^\/compass/.test(here)) return;
  const { holdCompassFeed, compassFeed, subscribeCompassFeed } = await import('./compassFeed');
  const release = holdCompassFeed();
  try {
    await until(() => compassFeed().status !== 'loading', subscribeCompassFeed);
  } finally {
    release();
  }
};

const JOBS: Job[] = [bookJob, priceJob, barsJob, chainJob, compassJob];

/** The data the other main rooms paint first, for `ticker`, after the page at `here` has had its own. A later call (a
    move, another name) drops whatever of the last queue had not started. */
export function warmRoomData(ticker: string | null | undefined, here: string): void {
  if (typeof window === 'undefined') return;
  const mine = ++run;
  window.clearTimeout(timer);
  const name = (ticker ?? '').trim().toUpperCase();
  if (!name) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return;
  timer = window.setTimeout(async () => {
    for (const job of JOBS) {
      await idle();
      if (mine !== run) return;
      if (document.visibilityState === 'hidden') {
        await new Promise<void>(resolve => {
          const on = () => {
            if (document.visibilityState === 'hidden') return;
            document.removeEventListener('visibilitychange', on);
            resolve();
          };
          document.addEventListener('visibilitychange', on);
        });
        if (mine !== run) return;
      }
      try {
        await Promise.race([job(name, here), new Promise<void>(resolve => window.setTimeout(resolve, JOB_CAP_MS))]);
      } catch {
        /* a warm read that fails is only a read the room makes itself when it opens */
      }
    }
  }, START_AFTER_MS);
}

/** Stop the queue (the shell is leaving) */
export function stopRoomData(): void {
  run += 1;
  window.clearTimeout(timer);
}
