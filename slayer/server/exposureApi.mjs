/*
  /api/exposure/*: the exposure recorder's per-strike series for Terrain's field (src/data/exposureRecorder.ts),
  read-only. The recorder starts with the server process and stops with it; it reads whether or not anyone is viewing.
  The gate is the Unusual Whales proxy's own (server/auth.mjs): open on local work, a signed-in plan when accounts are on.

  EXPOSURE_RECORDER=0 serves the record without reading; EXPOSURE_DIR moves it (default .cache/exposure);
  EXPOSURE_NAMES (comma list) replaces the house's names, EXPOSURE_NAMES_MAX caps the names (25),
  EXPOSURE_KEEP_DAYS keeps that many days (10), EXPOSURE_FRONT=0 records the whole book only, EXPOSURE_EXT_EVERY sets
  the minutes between reads outside the regular session (2; 0 reads 09:30–16:15 only).
  On Vercel there is no long-lived process: the recorder does not run there (docs/exposure-recorder.md).

  /api/exposure/hist serves a finished day the recorder does not hold, rebuilt from the terminal's open interest, quotes
  and bars (src/data/exposureHistServer.ts); EXPOSURE_HIST_DIR moves its kept inputs (default .cache/exposure-hist).
*/

import path from 'node:path';
import { gate, sendDenied } from './auth.mjs';
import { uwDirect } from './uwProxy.mjs';
import { thetaDirect } from './thetaProxy.mjs';

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

const int = (v, d) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? Math.floor(n) : d;
};

/**
 * @param {() => Promise<any>} load  imports src/data/exposureRecorder.ts the way this server runs TypeScript
 * @param {string} [root]            the app folder (.cache/)
 */
export function exposureMount(load, root = process.cwd()) {
  let rec = null;
  let mod = null;
  let hist = null;
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
        const names = (process.env.EXPOSURE_NAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
        rec = mod.startExposureRecorder({
          dir: process.env.EXPOSURE_DIR || path.join(root, '.cache', 'exposure'),
          /* the background lane: a copy up to 45 s old is reused, a vendor call waits behind every viewer */
          uw: (p) => uwDirect(p, { lane: 'record', maxAge: mod.REUSE_MS }),
          record: process.env.EXPOSURE_RECORDER !== '0',
          house: names.length ? names : undefined,
          max: int(process.env.EXPOSURE_NAMES_MAX, 25),
          keepDays: int(process.env.EXPOSURE_KEEP_DAYS, 10),
          front: process.env.EXPOSURE_FRONT !== '0',
          extEvery: int(process.env.EXPOSURE_EXT_EVERY, 2),
          log: (line) => console.log(line),
        });
        hist = mod.createExposureHist({
          dir: process.env.EXPOSURE_HIST_DIR || path.join(root, '.cache', 'exposure-hist'),
          theta: thetaDirect,
          recorded: (t, day) => rec.day(t, day, 0),
          log: (line) => console.log(line),
        });
      } catch (e) {
        console.warn(`[exposure] the recorder did not start: ${e && e.message ? e.message : e}`);
      }
    })();
    return ready;
  };
  return {
    start,
    async handle(req, res) {
      const verdict = await gate(req, 'uw');
      if (!verdict.ok) {
        sendDenied(res, verdict);
        return;
      }
      await start();
      if (!rec || !mod) {
        send(res, 503, { error: 'The exposure recorder is not running on this server.', code: hosted ? 'recorder_hosted' : 'recorder_down' });
        return;
      }
      if (hist && /^(\/api\/exposure)?\/hist(\?|$)/.test(req.url || '')) {
        await mod.histRoute(hist, req, res);
        return;
      }
      mod.exposureRoute(rec, req, res);
    },
    stop() {
      stopped = true;
      if (rec) rec.stop();
      rec = null;
    },
  };
}
