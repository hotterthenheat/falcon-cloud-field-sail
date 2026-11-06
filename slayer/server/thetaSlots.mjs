/*
  The terminal's request slots, shared by everything in this process that reads ThetaData (server/thetaProxy.mjs).

  The terminal answers at most `terminal` requests at once (its log: "Max concurrent requests: 8"); past that it refuses
  with 429. Four queues wait for a slot, served in this order:
    1. the Compass engine's live reads (lane 'engine', not history)
    2. the engine's history reads (lane 'engine', history), within the history cap
    3. everyone else's snapshots (the pages, the hub's refreshes, the recorders)
    4. everyone else's history, within the history cap
  and everyone but the engine may hold at most `terminal - reserved` slots, so the engine always finds `reserved` free
  however busy the site is (2026-11-06: 09:35–10:15 ET the scan scored nothing while a site check loaded every page
  and a live checker ran on the same terminal). History never holds more than `history` slots, the engine's included.
  A request already waiting in a lower queue that the engine then asks for too (the hub joins them into one) is moved
  to the engine's queue (promote).
*/

const HISTORY = /\/(history|at_time)\//;

/**
 * @param {{ terminal?: number, history?: number, reserved?: number }} [o]
 */
export function createSlots(o = {}) {
  const terminal = Math.max(1, o.terminal ?? 8);
  const history = Math.max(1, Math.min(terminal, o.history ?? terminal - 2));
  /* the slots only the engine may take: at least one is left to everyone else */
  const reserved = Math.max(0, Math.min(terminal - 1, o.reserved ?? 2));
  let busy = 0;
  let busyHistory = 0;
  let busyEngine = 0;
  /** waiting readers, by queue: { path, hist, engine, go } */
  const queues = { engineQuick: [], engineSlow: [], quick: [], slow: [] };
  const isHistory = (p) => HISTORY.test(p);
  const queueOf = (hist, engine) => (engine ? (hist ? 'engineSlow' : 'engineQuick') : hist ? 'slow' : 'quick');
  const canTake = (hist, engine) => {
    if (busy >= terminal) return false;
    if (hist && busyHistory >= history) return false;
    if (!engine && busy - busyEngine >= terminal - reserved) return false;
    return true;
  };
  const take = (hist, engine) => {
    busy += 1;
    if (hist) busyHistory += 1;
    if (engine) busyEngine += 1;
  };
  const give = (hist, engine) => {
    busy -= 1;
    if (hist) busyHistory -= 1;
    if (engine) busyEngine -= 1;
  };
  function wake() {
    for (const name of ['engineQuick', 'engineSlow', 'quick', 'slow']) {
      const q = queues[name];
      while (q.length && canTake(q[0].hist, q[0].engine)) {
        const w = q.shift();
        take(w.hist, w.engine);
        w.go();
      }
    }
  }
  /**
   * Run `fn` holding one slot for `path`. `lane` 'engine' is the Compass engine; anything else is everyone else.
   * @template T
   * @param {string} path
   * @param {() => Promise<T>} fn
   * @param {string} [lane]
   * @returns {Promise<T>}
   */
  async function slot(path, fn, lane) {
    const hist = isHistory(path);
    const w = { path, hist, engine: lane === 'engine', go: () => {} };
    const name = queueOf(hist, w.engine);
    /* a reader never jumps its own queue: it goes ahead only when nobody of its kind waits */
    if (!queues[name].length && canTake(hist, w.engine)) take(hist, w.engine);
    else await new Promise((resolve) => {
      w.go = resolve;
      queues[name].push(w);
    });
    /* the slot is counted for us when we are woken; it is given back as it was taken (a promoted reader was moved
       before it took one, so it took it as the engine's) */
    const engine = w.engine;
    try {
      return await fn();
    } finally {
      give(hist, engine);
      wake();
    }
  }
  /** The engine now waits on `path` too: a reader of it still waiting in everyone else's queues moves to the engine's. */
  function promote(path) {
    for (const name of ['quick', 'slow']) {
      const q = queues[name];
      const i = q.findIndex((w) => w.path === path);
      if (i < 0) continue;
      const [w] = q.splice(i, 1);
      w.engine = true;
      queues[queueOf(w.hist, true)].push(w);
      wake();
      return true;
    }
    return false;
  }
  const stats = () => ({
    terminal,
    history,
    reserved,
    busy,
    busyHistory,
    busyEngine,
    waiting: queues.engineQuick.length + queues.engineSlow.length + queues.quick.length + queues.slow.length,
    waitingEngine: queues.engineQuick.length + queues.engineSlow.length,
  });
  return { slot, promote, stats, isHistory };
}
