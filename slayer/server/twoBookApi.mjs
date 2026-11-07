/*
  /api/twobook/oi?ticker=SPY — Pinpoint's open-interest book (Model 1, docs/TWO_BOOK_SPEC_V2.md §3), built on this
  server from the listed rows through the shared hub (src/data/twobook/model1Server.ts) and shared by every viewer.
  The flow book (Model 2) is the option tape's: /api/tape/flowbook (server/tapeApi.mjs).
  Behind the same gate as /api/uw (server/auth.mjs).
*/

import { gate, sendDenied } from './auth.mjs';
import { uwDirect } from './uwProxy.mjs';

/**
 * @param {() => Promise<any>} load  imports src/data/twobook/model1Server.ts the way this server runs TypeScript
 */
export function twoBookMount(load) {
  let keeper = null;
  let mod = null;
  let ready = null;
  const start = () => {
    if (ready) return ready;
    ready = (async () => {
      try {
        mod = await load();
        keeper = mod.startModel1({ uw: (p) => uwDirect(p, { lane: 'record', maxAge: mod.REUSE_MS }), log: (l) => console.log(l) });
      } catch (e) {
        console.warn(`[twobook] the open-interest book did not start: ${e && e.message ? e.message : e}`);
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
      if (!keeper || !mod) {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'The open-interest book is not running on this server.', code: 'oi_book_down' }));
        return;
      }
      mod.model1Route(keeper, req, res);
    },
  };
}
