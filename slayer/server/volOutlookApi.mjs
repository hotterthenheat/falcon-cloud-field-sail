/*
  /api/vol-outlook/<TICKER>: the vol outlook's sessions for Pulse's Vol outlook tile (src/data/volOutlookServer.ts),
  read on this server once a New York day per name — the hot names from the start, any name a tile asks for today — so
  a cold first view paints in a second instead of reading a year of one-minute bars in the browser.
  The gate is the ThetaData proxy's own (server/auth.mjs): the sessions are ThetaData's bars, digested.

  VOL_OUTLOOK=0 serves what is kept without reading; VOL_OUTLOOK_DIR moves it (default .cache/vol-outlook);
  VOL_OUTLOOK_MAX caps the asked-for names a day beyond the hot ones (25).
  On Vercel there is no long-lived process: the route answers 503 and the tile reads the bars itself.
*/

import path from 'node:path';
import { gate, sendDenied } from './auth.mjs';
import { thetaDirect } from './thetaProxy.mjs';
import { HOT_NAMES } from './hub.mjs';

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

/**
 * @param {() => Promise<any>} load  imports src/data/volOutlookServer.ts the way this server runs TypeScript
 * @param {string} [root]            the app folder (.cache/)
 */
export function volOutlookMount(load, root = process.cwd()) {
  let srv = null;
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
        const max = Number(process.env.VOL_OUTLOOK_MAX);
        srv = mod.startVolOutlookServer({
          dir: process.env.VOL_OUTLOOK_DIR || path.join(root, '.cache', 'vol-outlook'),
          theta: thetaDirect,
          hot: HOT_NAMES,
          read: process.env.VOL_OUTLOOK !== '0',
          max: Number.isFinite(max) && max >= 0 ? Math.floor(max) : 25,
          log: (line) => console.log(line),
        });
      } catch (e) {
        console.warn(`[vol-outlook] the reader did not start: ${e && e.message ? e.message : e}`);
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
      if (!srv || !mod) {
        send(res, 503, { error: 'The vol outlook reader is not running on this server.', code: hosted ? 'reader_hosted' : 'reader_down' });
        return;
      }
      mod.volOutlookRoute(srv, req, res);
    },
    stop() {
      stopped = true;
      if (srv) srv.stop();
      srv = null;
    },
  };
}
