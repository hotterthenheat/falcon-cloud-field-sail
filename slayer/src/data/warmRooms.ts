/*
  The code each terminal route needs, by path, with the same import specifiers as the lazy routes in App.tsx so a
  fetch here is the chunk the route will use. Only code: no feed starts until the page itself opens.
  - warmPath: a pointer or focus is on a link to the route (fetch now)
  - routeReady / loadRoute: whether the route's code is in hand, and a promise for it (the shell holds the current page
    until it is)
  - warmIdle: once the shell is idle, fetch the main rooms one at a time (signed-in readers only)
*/

type Load = () => Promise<unknown>;

const pulse: Load = () => import('../pages/workspace/Pulse');
const terrain: Load = () => import('../pages/terrain/Terrain');
const compassLayout: Load = () => import('../pages/compass/CompassLayout');
const weigher: Load = () => import('../pages/Weigher');
const practiceLayout: Load = () => import('../pages/practice/PracticeLayout');
const recordLayout: Load = () => import('../pages/record/RecordLayout');
const pinpointLayout: Load = () => import('../pages/pinpoint/PinpointLayout');
const traceLayout: Load = () => import('../pages/trace/TraceLayout');

/* first match wins: the most specific paths first */
const ROUTES: [RegExp, Load[]][] = [
  [/^\/pulse\/?$/, [pulse]],
  [/^\/terrain\/?$/, [terrain]],
  [/^\/compass\/blotter/, [compassLayout, () => import('../pages/compass/Blotter')]],
  [/^\/compass\/tracker/, [compassLayout, () => import('../pages/Tracker')]],
  [/^\/compass\/[^/]+/, [compassLayout, () => import('../pages/compass/SetupPage')]],
  [/^\/compass\/?$/, [compassLayout, () => import('../pages/compass/Board')]],
  [/^\/weigher/, [weigher]],
  [/^\/practice\/backtest\/[^/]+\/report/, [practiceLayout, () => import('../pages/review/Report')]],
  [/^\/practice\/backtest\/[^/]+/, [practiceLayout, () => import('../pages/review/Desk')]],
  [/^\/practice\/(?:backtest|futures)/, [practiceLayout, () => import('../pages/review/Sessions')]],
  [/^\/practice\/journal\/[^/]+\/[^/]+/, [practiceLayout, () => import('../pages/practice/JournalTrade')]],
  [/^\/practice\/journal/, [practiceLayout, () => import('../pages/practice/Journal')]],
  [/^\/practice\/paper\/[^/]+/, [practiceLayout, () => import('../pages/paper/Desk')]],
  [/^\/practice(?:\/paper)?\/?$/, [practiceLayout, () => import('../pages/paper/Accounts'), () => import('../pages/paper/Desk')]],
  [/^\/dossier\/earnings\/[^/]+/, [recordLayout, () => import('../pages/record/EarningsName')]],
  [/^\/dossier\/earnings/, [recordLayout, () => import('../pages/record/Earnings')]],
  [/^\/dossier\/insiders/, [recordLayout, () => import('../pages/record/Insiders')]],
  [/^\/dossier\/congress\/[^/]+/, [recordLayout, () => import('../pages/record/BookFile')]],
  [/^\/dossier\/congress/, [recordLayout, () => import('../pages/record/Congress')]],
  [/^\/dossier\/stocks\/[^/]+/, [recordLayout, () => import('../pages/record/StockName')]],
  [/^\/dossier\/stocks/, [recordLayout, () => import('../pages/record/Stocks')]],
  [/^\/dossier\/(?:institutions|shorts|etfs)\/[^/]+/, [recordLayout, () => import('../pages/record/BookFile')]],
  [/^\/dossier\/(?:institutions|shorts|etfs)/, [recordLayout, () => import('../pages/record/FilePages')]],
  [/^\/dossier(?:\/news)?\/?$/, [recordLayout, () => import('../pages/record/News')]],
  [/^\/pinpoint\/agenda/, [pinpointLayout, () => import('../pages/pinpoint/Agenda')]],
  [/^\/pinpoint\/board/, [pinpointLayout, () => import('../pages/pinpoint/Board')]],
  [/^\/pinpoint\/compare/, [pinpointLayout, () => import('../pages/pinpoint/Compare')]],
  [/^\/pinpoint(?:\/map)?\/?$/, [pinpointLayout, () => import('../pages/pinpoint/MapDesk')]],
  [/^\/trace\/screener/, [traceLayout, () => import('../pages/trace/OptionsScreener')]],
  [/^\/trace\/net-flow/, [traceLayout, () => import('../pages/trace/NetFlow')]],
  [/^\/trace\/footprints/, [traceLayout, () => import('../pages/trace/Footprints')]],
  [/^\/trace\/watchers/, [traceLayout, () => import('../pages/trace/Watchers')]],
  [/^\/trace\/intervals/, [traceLayout, () => import('../pages/trace/Windows')]],
  [/^\/trace\/odte/, [traceLayout, () => import('../pages/trace/Odte')]],
  [/^\/trace\/multi-leg/, [traceLayout, () => import('../pages/trace/MultiLeg')]],
  [/^\/trace\/compare/, [traceLayout, () => import('../pages/trace/Compare')]],
  [/^\/trace\/dark-pool/, [traceLayout, () => import('../pages/trace/DarkPool')]],
  [/^\/trace\/tracker/, [traceLayout, () => import('../pages/trace/FlowTracker')]],
  [/^\/trace(?:\/live-tape)?\/?$/, [traceLayout, () => import('../pages/trace/LiveTape')]],
  [/^\/settings/, [() => import('../pages/settings/Settings')]],
  [/^\/start/, [() => import('../pages/start/Start')]],
  [/^\/community/, [() => import('../pages/community/Room')]],
];

const jobs = new Map<string, Promise<unknown>>();
const done = new Set<string>();

function routeOf(path: string): { key: string; loads: Load[] } | null {
  const p = path.split(/[?#]/)[0];
  for (const [re, loads] of ROUTES) if (re.test(p)) return { key: re.source, loads };
  return null;
}

/** A promise for the route's code (resolved at once when it is in hand, or when the path is not a known route) */
export function loadRoute(path: string): Promise<unknown> {
  const r = routeOf(path);
  if (!r) return Promise.resolve();
  let job = jobs.get(r.key);
  if (!job) {
    job = Promise.all(r.loads.map(l => l()))
      .then(() => done.add(r.key))
      .catch(() => {
        /* a failed fetch is asked again next time; the route's own boundary reports a real failure */
        jobs.delete(r.key);
      });
    jobs.set(r.key, job);
  }
  return job;
}

/** The route's code is in hand (or the path is not a route this knows) */
export function routeReady(path: string): boolean {
  const r = routeOf(path);
  return !r || done.has(r.key);
}

/** A link to the route has a pointer or focus on it */
export function warmPath(path: string): void {
  void loadRoute(path);
}

/** Mark a route as in hand once its page has rendered (a first load that came in by the URL) */
export function noteRouteShown(path: string): void {
  const r = routeOf(path);
  if (r && !jobs.has(r.key)) void loadRoute(path);
}

const IDLE_ORDER = ['/pulse', '/terrain', '/trace', '/pinpoint', '/dossier', '/compass', '/weigher', '/practice/paper', '/settings'];
let idleStarted = false;

/** Fetch the main rooms' code one at a time while the page is idle. Never on a slow or data-saving connection. */
export function warmIdle(): void {
  if (idleStarted || typeof window === 'undefined') return;
  idleStarted = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return;
  const idle: (cb: () => void) => void =
    typeof window.requestIdleCallback === 'function' ? cb => window.requestIdleCallback(cb, { timeout: 4000 }) : cb => window.setTimeout(cb, 1500);
  const queue = [...IDLE_ORDER];
  const step = () => {
    const next = queue.shift();
    if (!next) return;
    if (document.visibilityState === 'hidden') {
      queue.unshift(next);
      window.setTimeout(() => idle(step), 5000);
      return;
    }
    void loadRoute(next).then(() => idle(step));
  };
  /* after the first page has had its own time */
  window.setTimeout(() => idle(step), 3000);
}
