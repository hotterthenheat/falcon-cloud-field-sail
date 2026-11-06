/*
  Kept price proof: Pinpoint's live price (components/gex/LivePrice.tsx) says "offline" over a kept print only once the
  terminal has been heard down. On a fresh page the price kept from an earlier visit shows at once, before this page's
  first ask has answered (data/thetaQuote.ts status 'unknown'); that is the last print, stamped "as of", not an outage.
  SITECHECK 2026-11-06: the Map read "OFFLINE · NOV 6, 10:26 ET" for its first seconds at 10:30 while every path answered.
  Run:  npx tsx scripts/kept-price-proof.ts
*/
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/* a print kept from an earlier visit, in the browser's store, before the module reads it */
const READ = Date.UTC(2026, 10, 6, 15, 26);
const store = new Map<string, string>([['slayer_theta_kept_v1', JSON.stringify({ 'S:SPY': { price: 740.54, prevClose: 733.0, todayClose: null, at: READ, read: READ } })]]);
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const { LivePrice } = await import('../src/components/gex/LivePrice');
const { thetaStatus, peekThetaPrice } = await import('../src/data/thetaQuote');

check('no answer yet this page: the status is unknown', thetaStatus() === 'unknown');
check('the kept print is held, not live', peekThetaPrice('SPY')?.live === false);
const html = renderToStaticMarkup(createElement(LivePrice, { ticker: 'SPY' }));
check('the kept price is printed', html.includes('740.54'));
check('it is marked kept', html.includes('data-live-price="kept"'));
check('before the first answer it does not say offline', !/offline/i.test(html.replace(/data-live-price="[^"]*"/g, '')));
check('it is stamped as of its read', /as of /i.test(html));
const compact = renderToStaticMarkup(createElement(LivePrice, { ticker: 'SPY', compact: true }));
check('the compact price carries the stamp alone, and no title says offline', !/offline|as of/i.test(compact.replace(/data-live-price="[^"]*"/g, '')));

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\nkept-price proof: all checks passed');
