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
  const start = () => {
    if (ready) return ready;
    ready = (async () => {
      if (hosted) return;
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
      } catch (e) {
        console.warn(`[compass] the engine did not start: ${e && e.message ? e.message : e}`);
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
      if (engine) engine.stop();
      engine = null;
    },
  };
}
