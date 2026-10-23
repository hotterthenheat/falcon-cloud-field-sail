/*
  Pinpoint and Dossier stay warm. The first visit used to compile the page
  and then wait on the book. A hover on the rail, and an idle moment after
  the shell is up, fetches the code and starts the feed so the page opens
  on what is already there.
*/

const once = new Map<string, Promise<unknown>>();

function go(key: string, load: () => Promise<unknown>) {
  let job = once.get(key);
  if (!job) {
    job = load().catch(() => undefined);
    once.set(key, job);
  }
  return job;
}

export function warmPinpoint() {
  return go('pinpoint', async () => {
    await Promise.all([import('../pages/pinpoint/PinpointLayout'), import('../pages/pinpoint/MapDesk')]);
    await Promise.all([import('../pages/pinpoint/Agenda'), import('../pages/pinpoint/Board'), import('../pages/pinpoint/Compare')]);
  });
}

export function warmDossier() {
  return go('dossier', async () => {
    await Promise.all([import('../pages/record/RecordLayout'), import('../pages/record/News')]);
    await Promise.all([
      import('../pages/record/Earnings'),
      import('../pages/record/EarningsName'),
      import('../pages/record/Stocks'),
      import('../pages/record/StockName'),
      import('../pages/record/Insiders'),
      import('../pages/record/Congress'),
      import('../pages/record/FilePages'),
      import('../pages/record/BookFile'),
    ]);
  });
}

function warmFeeds() {
  void go('feeds', async () => {
    const [book, sim, record] = await Promise.all([import('./uwBook'), import('../core/simulator'), import('./liveRecord')]);
    book.ensureBook(sim.default.getActiveTicker(), 'full');
    record.warmNews();
  });
}

/** After the shell has painted. Idle, so it does not steal the page you are on. */
export function warmRooms() {
  if (typeof window === 'undefined') return;
  const run = () => {
    void warmPinpoint();
    void warmDossier();
    /* NOT ON TRACE (audit round 6): the warm feed started the active name's full Pinpoint book — greek-exposure by strike
       and expiry, spot exposures, the option contracts, 34 dates each — and the headlines' daily closes, all on the key's
       three slots while a Trace page waited on its own tape. Trace reads none of them; Pinpoint and Dossier start their
       own feeds the moment they open. The page code above still warms. */
    if (!window.location.pathname.startsWith('/trace')) warmFeeds();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1800 });
  else window.setTimeout(run, 900);
}

/** The rail, the moment a pointer is on the way. */
export function warmPath(path: string) {
  if (path.startsWith('/pinpoint')) void warmPinpoint();
  else if (path.startsWith('/dossier') || path.startsWith('/record')) void warmDossier();
}
