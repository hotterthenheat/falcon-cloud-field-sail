/*
  /api/tape/*: the server's option and stock tapes for Terrain (src/data/tapeServer.ts) — one tape per name, read here
  in windows and shared by every pane and every viewer, so a browser never asks the terminal for a print.
    GET /api/tape/options?ticker=SPY&since=<ms>   the option prints, tagged and sided, from `since` to `through`
    GET /api/tape/stock?ticker=SPY&since=<ms>     the stock prints' venue mix and the off-exchange and block marks
    GET /api/tape/__stats                          the terminal reads made (not in production)
  The gate is the ThetaData proxy's own (server/auth.mjs): the prints are ThetaData's.

  TAPE_READ=0 serves what is kept without reading; TAPE_DIR moves the kept days (default .cache/tape).
  On Vercel there is no long-lived process: the route answers 503 and the panes say the prints are not available.
*/

import path from 'node:path';
import { gate, sendDenied } from './auth.mjs';
import { thetaSlots, thetaUncached } from './thetaProxy.mjs';

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

/**
 * @param {() => Promise<any>} load  imports src/data/tapeServer.ts the way this server runs TypeScript
 * @param {string} [root]            the app folder (.cache/)
 */
export function tapeMount(load, root = process.cwd()) {
  let tapes = null;
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
        tapes = mod.startTapes({
          dir: process.env.TAPE_DIR || path.join(root, '.cache', 'tape'),
          theta: thetaUncached,
          slots: thetaSlots,
          read: process.env.TAPE_READ !== '0',
          log: (line) => console.log(line),
        });
      } catch (e) {
        console.warn(`[tape] the tapes did not start: ${e && e.message ? e.message : e}`);
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
      if (!tapes || !mod) {
        send(res, 503, { error: 'The tapes are not running on this server.', code: hosted ? 'tape_hosted' : 'tape_down' });
        return;
      }
      mod.tapeRoute(tapes, req, res);
    },
    stop() {
      stopped = true;
      if (tapes) tapes.stop();
      tapes = null;
    },
  };
}
