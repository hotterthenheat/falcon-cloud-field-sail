/*
  /api/compass/*: the official Compass engine's board, record and marks (src/data/compassServer.ts), read-only. The
  engine starts with the server process and stops with it; the scan runs whether or not anyone is viewing.
  The gate is the data proxies' own (server/auth.mjs): open on local work, a signed-in plan when accounts are on.

  COMPASS_ENGINE=0 serves the record without scanning; COMPASS_DIR moves the record (default .cache/compass).
  On Vercel there is no long-lived process: the engine does not run there (docs/compass-engine.md).
*/

import path from 'node:path';
import { gate, sendDenied } from './auth.mjs';
import { thetaDirect } from './thetaProxy.mjs';
import { uwDirect } from './uwProxy.mjs';

/** Logs a promise nobody caught and an exception nobody handled, once per process. An unhandled rejection is logged
    and the process keeps serving (an engine read that rejected must not take the dev server down); an uncaught
    exception is only observed (uncaughtExceptionMonitor), so Node's own crash still happens. */
export function installProcessLogger(log = (line) => console.error(line)) {
  const flag = Symbol.for('slayer.processLogger');
  if (globalThis[flag]) return;
  globalThis[flag] = true;
  const text = (e) => (e && e.stack ? e.stack : String(e));
  process.on('unhandledRejection', (reason) => log(`[process] unhandled rejection: ${text(reason)}`));
  process.on('uncaughtExceptionMonitor', (err, origin) => log(`[process] uncaught exception (${origin}): ${text(err)}`));
}

/** Backoff between engine start attempts: 5 s, doubling, at most 5 minutes. */
export const startDelay = (attempt) => Math.min(300_000, 5_000 * 2 ** Math.max(0, attempt - 1));

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

/**
 * @param {() => Promise<any>} load  imports src/data/compassServer.ts the way this server runs TypeScript
 * @param {string} [root]            the app folder (public/, .cache/)
 */
export function compassMount(load, root = process.cwd()) {
  let engine = null;
  let mod = null;
  let stopped = false;
  const hosted = !!process.env.VERCEL;
  let ready = null;
  let attempts = 0;
  let retry = null;
  let nextAt = 0;
  /* one start at a time; a failed start is tried again with backoff (and by the first request after the wait), so one
     bad import or a disk error is not "down until the process restarts" */
  const start = () => {
    if (ready) return ready;
    if (engine || hosted || stopped || Date.now() < nextAt) return Promise.resolve();
    ready = (async () => {
      try {
        mod = await load();
        if (stopped) return;
        engine = mod.startCompassEngine({
          dir: process.env.COMPASS_DIR || path.join(root, '.cache', 'compass'),
          publicDir: path.join(root, 'public'),
          theta: thetaDirect,
          uw: uwDirect,
          scan: process.env.COMPASS_ENGINE !== '0',
          log: (line) => console.log(line),
        });
        attempts = 0;
      } catch (e) {
        engine = null;
        attempts += 1;
        const wait = startDelay(attempts);
        nextAt = Date.now() + wait;
        console.warn(`[compass] the engine did not start (attempt ${attempts}): ${e && e.message ? e.message : e}; trying again in ${Math.round(wait / 1000)} s`);
        if (!retry && !stopped) {
          retry = setTimeout(() => {
            retry = null;
            void start();
          }, wait);
          retry.unref?.();
        }
      } finally {
        ready = null;
      }
    })();
    return ready;
  };
  return {
    start,
    async handle(req, res) {
      const verdict = await gate(req, 'theta');
      if (!verdict.ok) {
        sendDenied(res, verdict);
        return;
      }
      await start();
      if (!engine || !mod) {
        send(res, 503, { error: 'The Compass engine is not running on this server.', code: hosted ? 'engine_hosted' : 'engine_down' });
        return;
      }
      mod.compassRoute(engine, req, res);
    },
    stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      if (engine) engine.stop();
      engine = null;
    },
  };
}
