/*
  THE LANDING'S STAGE (2026-10-01) — what every page of the tour opens on before it is filmed, and how it is set up.

  The landing shows the terminal itself, never a drawing of it: each page the tour names is opened the way the landing
  used to hold it (the embed seam: the rail folded, no launch gate, no sound, the theme named by the address) and, where
  a first-time visitor's page would be empty, USED the way a reader would use it — a contract watched, a position
  entered, a session started and traded — never by typing its storage by hand. This file is that staging, and nothing
  else: SEED is what the visitor's terminal holds, PREPARE is the steps taken on a page before the camera runs.

  scripts/make-landing-clips.mjs imports it, films each page from here, and keeps the film's first frame as the page's
  still. (Until 2026-10-01 this lived in make-landing-shots.mjs, which took stills only.)

  WHAT EACH PAGE OPENS ON is a first-time visitor's terminal, with the exceptions Noah set by picture:
      Terrain      two charts side by side, SPY on the dark candles and QQQ on Stone, each with its strike rail open
      the Map      its own first view, the matrix (2026-09-28)
      the Weigher  a desk in use (2026-09-20: "right now all 3 sections are blank") — contracts watched and positions held
                   across a few names, one position open in the card at the right; see PREPARE below
*/
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every page the tour names, read off the tour's own list — a page added to the tour is filmed the next time this runs */
const landing = readFileSync(resolve(process.cwd(), 'src/pages/landing/Landing.tsx'), 'utf8');
export const ALL_PAGES = [...new Set([...landing.matchAll(/path: '(\/[a-z/-]+)'/g)].map(m => m[1]))];

/* what a page opens on, where a first-time visitor's terminal is not what the picture should be */
export const SEED = {
  slayer_candle_theme_sky1: '1',
  slayer_terrain_sky1: '1',
  /* the Weigher's sash pulled up (its own control; 560 by default): the picture is 1,000px tall, and at the default the
     Watchlist card — the third thing the picture is there to show — starts below its edge */
  slayer_weigher_top: '360',
  /* the drawing rail folded to its tab, as in Noah's picture — the chart is the subject */
  slayer_draw_rail: JSON.stringify({ dock: 'left', open: false }),
  slayer_terrain_v1: JSON.stringify({
    layout: 2,
    /* the rails read one expiry, two weeks out (his picture: "Oct 2") */
    railCut: 14,
    panes: [
      { ticker: 'SPY', timeframe: '15m', theme: 'glacier', ladder: true },
      { ticker: 'QQQ', timeframe: '15m', theme: 'stone', ladder: true },
    ],
  }),
};

/* WHAT ONE PAGE'S VISITOR HOLDS, over the shared seed — only that page's film opens on it.

   PULSE IS FILMED ON "THE OPEN" (Noah, 2026-10-02, with his picture of the desk: "have the recording be on 'the open' …
   the exp should be the next seven"): the house's own desk of that name, exactly as it ships — the chart, the book across
   the calendar, key levels, the wire and who reports — with the book's Expiries card on The next seven, and on QQQ, the
   name in his picture (Settings › The desk › Opens on, the reader's own setting). The four-tile arrangement of
   2026-09-22 that stood here went with the old desk. */
/** The open, as the house ships it — `without` names a tile left off it */
const theOpen = (without = null) => {
  const cells = [
    [{ id: 'chart-1', key: 'chart' }, { x: 0, y: 0, w: 6, h: 5 }],
    [{ id: 'book-1', key: 'book', state: { view: 'calendar', span: 'next' } }, { x: 6, y: 0, w: 6, h: 5 }],
    [{ id: 'levels-1', key: 'levels' }, { x: 0, y: 5, w: 4, h: 4 }],
    [{ id: 'news-1', key: 'news' }, { x: 4, y: 5, w: 4, h: 4 }],
    [{ id: 'earnings-1', key: 'earnings' }, { x: 8, y: 5, w: 4, h: 4 }],
  ].filter(([inst]) => inst.key !== without);
  return JSON.stringify({ active: 'The open', desks: { 'The open': { instances: cells.map(([inst]) => inst), layout: cells.map(([inst, l]) => ({ i: inst.id, ...l })) } } });
};
const ON_QQQ = JSON.stringify({ opensOn: { ticker: 'QQQ', timeframe: null }, alertsSound: true, clock: 'local' });

export const SEED_FOR = {
  /* THE PULSE PRODUCT PAGE'S FILM (2026-10-02, `@pulse-arrange`): The open with the Earnings tile left off — an open
     space at the foot's right for a tile to be dragged into, and for another to be pulled wider into. A desk a reader
     took a tile off is a real desk; nothing cascades below the window, and the film ends where it began. */
  '@pulse-arrange': { slayer_desk_prefs: ON_QQQ, slayer_desks_v2: theOpen('earnings') },
  '/pulse': {
    slayer_desk_prefs: ON_QQQ,
    slayer_desks_v2: theOpen(),
  },
};
export const seedFor = path => ({ ...SEED, ...(SEED_FOR[path] ?? {}) });

export const slug = path => path.replace(/^\//, '').replace(/\//g, '-');

/* A PAGE THAT IS EMPTY FOR A FIRST-TIME VISITOR is set up by USING the terminal, the way a reader would — never by typing
   its storage by hand. The Tracker holds what you kept, so three setups are kept first: each is opened off the board and its
   "Track setup" pressed. */
const go = async (page, to, theme, wait = 4500) => {
  await page.evaluate(src => (document.getElementById('t').src = src), `${to}?embed=1&photo=1&theme=${theme}`);
  await page.waitForTimeout(wait);
};
export const PREPARE = {
  /* THE LIVE TAPE, FULL (2026-09-22, Noah: "live tape on the landing page cuts off, it should read full"): a first visit's
     tape holds the prints of its first few seconds and the box grows with them, so the picture caught fourteen rows and
     a window of black under them. The tape is let run — nothing typed, nothing seeded — until its box reaches the
     window's foot, or 45 seconds pass. */
  '/trace/live-tape': async (page, theme, size) => {
    const frame = page.frameLocator('#t');
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      const bottom = await frame.locator('[data-tape-body]').evaluate(el => el.getBoundingClientRect().bottom).catch(() => 0);
      if (bottom >= size.h - 4) break;
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(600);
  },
  '/compass/tracker': async (page, theme) => {
    const frame = page.frameLocator('#t');
    await go(page, '/compass', theme, 5500);
    const ids = await frame.locator('[data-compass-card]').evaluateAll(els => els.slice(0, 3).map(e => e.getAttribute('data-compass-card')));
    for (const id of ids) {
      await go(page, `/compass/${id}`, theme, 5000);
      const track = frame.locator('[data-setup-track="off"]').first();
      if (await track.count()) await track.click();
      await page.waitForTimeout(500);
    }
    await go(page, '/compass/tracker', theme, 5500);
  },

  /* THE WEIGHER, IN USE (Noah, 2026-09-20: "i would like a few things to be in the your positions and watchlist sections
     with a position being opened up on the right. add a few different tickers"). A first-time visitor's desk is three
     empty cards — true, and no picture of what the desk is FOR. So the desk is used, by its own doors, the way a reader
     would: the name is switched on the chart's capsule, a strike is watched with the chain's +, a position is entered on
     the "Add a position" form. Nothing is typed into storage — every row is marked by the store at the tick it was added.
     The LAST thing entered is the position the card opens on (the desk picks a position the moment it is added).
     Desk only: the phone's picture ends above these cards. */
  '/weigher': async (page, theme, size) => {
    if (size.form !== 'desk') return;
    const frame = page.frameLocator('#t');
    const name = async sym => {
      await frame.locator('[data-weigher-desk] button[title="Switch ticker"]').first().click();
      const box = frame.getByPlaceholder('Search S&P 500 + more…');
      await box.fill(sym);
      await page.waitForTimeout(350);
      await box.press('Enter');
      /* the chain for the new name is built on the desk's sweep */
      await page.waitForTimeout(3800);
    };
    /* the strikes the chain has on screen, and the money between them */
    const ladder = () =>
      frame.locator('[data-chain-grid]').evaluate(grid => {
        const strikes = [...grid.querySelectorAll('[data-chain-watch]')].map(b => Number(b.getAttribute('data-chain-watch'))).sort((a, b) => a - b);
        const spot = Number((grid.querySelector('[data-chain-divider]')?.textContent ?? '').replace(/[^0-9.]/g, ''));
        return { strikes, spot };
      });
    /* `steps` strikes out of the money (calls: above the market; puts: below) — or, below zero, that many INTO it */
    const strikeOut = async (steps, side = 'C') => {
      const { strikes, spot } = await ladder();
      const above = strikes.filter(k => k > spot);
      const below = strikes.filter(k => k < spot).reverse();
      const [out, into] = side === 'C' ? [above, below] : [below, above];
      const from = steps >= 0 ? out : into;
      return from[Math.min(steps >= 0 ? steps : -steps - 1, from.length - 1)];
    };
    const watch = async steps => {
      const k = await strikeOut(steps);
      await frame.locator(`[data-chain-watch="${k}"]`).click();
      await page.waitForTimeout(700);
    };
    const enter = async ({ k, side, contracts, expires, paid }) => {
      await frame.locator('[data-add-position]').click();
      const form = frame.locator('[data-position-form]');
      await form.locator('[data-field="strike"]').fill(String(k));
      if (side === 'P') await form.getByRole('button', { name: 'Put', exact: true }).click();
      await form.locator('[data-field="contracts"]').fill(String(contracts));
      if (expires) {
        await form.locator('[data-field="expiry"]').click();
        await frame.locator('[data-quick-picks]').getByRole('button', { name: expires, exact: true }).click();
      }
      if (paid) await form.locator('[data-field="entry"]').fill(paid);
      await form.locator('[data-save-position]').click();
      await page.waitForTimeout(1200);
    };
    /* A POSITION BOUGHT EARLIER: entered once to learn what the desk marks that very contract at (its own expiry, not
       the chain's on screen), taken off, and entered again with what was paid — a share of that mark. Entered blank, a
       position is marked at the tick it was added and every return in the picture reads +$0. */
    const hold = async ({ steps, side = 'C', contracts, expires, paidShare }) => {
      const k = await strikeOut(steps, side);
      await enter({ k, side, contracts, expires });
      const newest = frame.locator('[data-list="positions"] .ag-row[row-index="0"]');
      const mark = Number(((await newest.locator('[col-id="mark"]').textContent()) ?? '').replace(/[^0-9.]/g, ''));
      if (!(mark > 0)) return;
      await newest.locator('[data-list-remove]').click();
      await page.waitForTimeout(900);
      await enter({ k, side, contracts, expires, paid: (mark * paidShare).toFixed(2) });
    };

    /* watched: four names (the list is newest first, and the picture ends three rows into it) */
    await name('AAPL');
    await watch(1);
    await name('AMD');
    await watch(2);
    await name('META');
    await watch(1);
    await name('QQQ');
    await watch(3);
    /* held: five names, some ahead and some behind — the last one entered is the one the card opens on. Next Friday, not
       the next session: a contract a day from its bell swings by half in the minute this takes */
    await name('SPY');
    await hold({ steps: 2, contracts: 10, expires: 'Next Friday', paidShare: 0.82 });
    await name('TSLA');
    await hold({ steps: 1, side: 'P', contracts: 3, expires: 'Next Friday', paidShare: 1.12 });
    await name('MSFT');
    await hold({ steps: 1, contracts: 2, expires: 'Monthly', paidShare: 0.9 });
    await name('COIN');
    await hold({ steps: 2, contracts: 4, expires: 'Next Friday', paidShare: 1.2 });
    /* the one the card opens on: a strike INSIDE the market, so the chain's market line stays in view above the picked
       row (picked above the line, the row's own details push the line out and the chain raises its "back to the market" pill) */
    await name('NVDA');
    await hold({ steps: -1, contracts: 5, expires: 'Next Friday', paidShare: 0.78 });
    /* the tape moves the marks a little before the picture is taken */
    await page.waitForTimeout(6000);
  },
};

/* REVIEW, IN USE (2026-09-20). A first-time visitor has no sessions: the page is an empty list — true, and no picture of
   what the room is FOR. So a session is run, by its own doors: the rules are picked on the form's cards, the session is
   started, the clock is played forward on its bar, a contract is bought off the chain, and (where there is a chart wide
   enough to do it on) a target and a stop are pulled off the position's own chip. Nothing is typed into storage. */
const reviewSession = async (page, size, { roundTrips = 0 } = {}) => {
  const frame = page.frameLocator('#t');
  const choose = async (card, words) => {
    await frame.locator(`[data-dropdown="${card}"]`).click();
    await page.waitForTimeout(350);
    await frame.locator(`[data-dropdown-card="${card}"]`).getByText(words, { exact: false }).first().click();
    await page.waitForTimeout(350);
  };
  if (size.form === 'desk') {
    await choose('review-rule-open', '3 positions');
    await choose('review-rule-risk', '5% of the account');
    await choose('review-rule-day', 'Down 3%');
  }
  await frame.locator('[data-review-start]').click();
  await frame.locator('[data-review-tape="page"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const top = () => frame.locator('main').evaluate(m => (m.scrollTop = 0));
  /* the clock, by its own track: a share of the day */
  const playTo = async share => {
    await top();
    const t = await frame.locator('[data-replay-track]').first().boundingBox();
    if (t) await page.mouse.click(t.x + t.width * share, t.y + t.height / 2);
    await page.waitForTimeout(1500);
  };
  /* the Order card is the paper desk's (2026-09-26): a press on Buy takes it at the ask */
  const buy = async row => {
    await frame.locator('[data-chain-row]').nth(row).click();
    await frame.locator('[data-order-act="buy"]').first().waitFor();
    await page.waitForTimeout(400);
    await frame.locator('[data-order-act="buy"]').first().click();
    await page.waitForTimeout(900);
    await top();
  };
  await playTo(0.16);
  /* closed trades for the journal and the book: in, a while on, out */
  for (let i = 0; i < roundTrips; i++) {
    await buy(11 + (i % 3));
    await playTo(0.2 + i * 0.07);
    /* out by the × on the chart's own chip: the book's Close is a far column, and a phone's grid does not draw those */
    await top();
    await frame.locator('[data-chart-close]').first().click();
    await page.waitForTimeout(900);
  }
  return { frame, top, playTo, buy };
};
/* THE MAP (2026-09-22): it opens on all five greeks by itself (MapDesk's pick), so nothing is picked — an earlier
   recipe that ticked "All five" would now untick it. What the picture adds is THE ROW UNDER THE POINTER (Noah: "the
   hover button should be visible in the screenshot"): a strike a few rows under spot is hovered, so its row lights and
   its card stands with the put, the call and the net. Desk only — a phone has no pointer. */
PREPARE['/pinpoint/map'] = async (page, theme, size) => {
  if (size.form !== 'desk') return;
  const frame = page.frameLocator('#t');
  /* the Map opens on the Exposure Matrix (2026-09-28): the pointer rests on the fourth row under spot, over its GEX net
     cell, so the still carries the row lit and the card beside it */
  await frame.locator('[data-matrix-row]').first().waitFor({ timeout: 15000 });
  const spot = await frame.locator('[data-matrix-spot]').boundingBox();
  const rows = frame.locator('[data-matrix-row]');
  const n = await rows.count();
  let target = null;
  for (let i = 0; i < n; i++) {
    const b = await rows.nth(i).boundingBox();
    if (b && spot && b.y > spot.y) { target = rows.nth(Math.min(n - 1, i + 3)); break; }
  }
  if (target) {
    const cell = await target.locator('[data-matrix-leg="net"]').first().boundingBox();
    if (cell) {
      await page.mouse.move(cell.x + cell.width * 0.6, cell.y + cell.height / 2, { steps: 6 });
      await page.waitForTimeout(900);
    }
  }
};

PREPARE['/practice/backtest'] = async (page, theme, size) => {
  const { frame, top, playTo, buy } = await reviewSession(page, size, { roundTrips: size.form === 'desk' ? 2 : 0 });
  /* the morning is played FIRST: what is bought last is what the picture is of, still open, its target and stop still working */
  await playTo(0.44);
  /* ON THE DESK THE TRADE IS THE FILM'S TO MAKE (Noah, 2026-10-02: "actually enter a position place 2 tps and a stop"):
     the session stands with its morning played and its two closed trades, nothing open — the act picks the strike, sets
     the size, the two targets and the stop on the order card, and buys. A phone's picture keeps its bought contract. */
  if (size.form === 'desk') {
    await top();
    await page.mouse.move(size.w - 10, 6);
    await page.waitForTimeout(1500);
    return;
  }
  await buy(12);
  if (size.form === 'desk') {
    /* a target up and a stop down, pulled off the position's chip the way a reader would */
    for (const dy of [-64, 58]) {
      const c = await frame.locator('[data-chart-position]').first().boundingBox();
      if (!c) break;
      await page.mouse.move(c.x + 40, c.y + 11);
      await page.mouse.down();
      await page.mouse.move(c.x + 40, c.y + 11 + dy / 2, { steps: 5 });
      await page.mouse.move(c.x + 40, c.y + 11 + dy, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(800);
    }
    /* three minutes on, by the bar's own step: the figures move, and neither line is reached */
    for (let i = 0; i < 3; i++) await frame.locator('[aria-label="One step on"]').first().click();
    /* the ticket is left on a strike NOT held: its drop-down open in the chain, a buy on the ticket with the Spread choice —
       on the held one it says, in amber, that the contracts are spoken for (true, and not what the picture is of) */
    await frame.locator('[data-chain-row]').nth(10).click();
    await page.waitForTimeout(900);
  }
  await top();
  /* the pointer off the chart: no crosshair in the picture */
  await page.mouse.move(size.w - 10, 6);
  await page.waitForTimeout(1500);
};
/* A FUTURES SESSION, IN USE — /practice/futures is the sessions page with its first card on Futures. The risk rule is set, so
   the ticket is shown doing what it is for: a stop typed, the size taken from the risk, a long with its target and stop on
   the chart of the day session. */
PREPARE['/practice/futures'] = async (page, theme, size) => {
  const frame = page.frameLocator('#t');
  /* THE RISK RULE IS LEFT OFF ON THE DESK (2026-10-02): with one, the engine will not buy until a stop is on the ticket
     — and the film buys first, then pulls its stop off the position on the chart, the simple way Noah asked for. A
     phone's picture keeps the 2% rule and its sized, bracketed buy. */
  if (size.form !== 'desk') {
    await frame.locator('[data-dropdown="review-rule-risk"]').click();
    await page.waitForTimeout(350);
    await frame.locator('[data-dropdown-card="review-rule-risk"] [role^="menuitem"]', { hasText: '2% of the account' }).first().click();
    await page.waitForTimeout(350);
  }
  await frame.locator('[data-review-start]').click();
  await frame.locator('[data-review-kind="futures"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const top = () => frame.locator('main').evaluate(m => (m.scrollTop = 0));
  await frame.locator('[data-review-open]').click();
  await page.waitForTimeout(1500);
  /* an hour into the day session, by the bar's own track */
  await top();
  const t = await frame.locator('[data-replay-track]').first().boundingBox();
  if (t) await page.mouse.click(t.x + t.width * (990 / 1380), t.y + t.height / 2);
  await page.waitForTimeout(1500);
  /* on the desk the trade is the film's to make (2026-10-02): the session stands an hour into the day, nothing open */
  if (size.form === 'desk') {
    await top();
    await page.mouse.move(size.w - 10, 6);
    await page.waitForTimeout(1500);
    return;
  }
  /* the Order card is the paper desk's (2026-09-26): the brackets are DISTANCES in points from the fill, and Buy takes them */
  const last = Number(((await frame.locator('[data-review-ticket]').textContent()) ?? '').match(/last ([\d,.]+)/)?.[1].replace(/,/g, '') ?? 0);
  if (last > 0) {
    /* wide enough that the four minutes stepped after the buy rarely take the stop out (a 5-point stop was hit in the still) */
    await frame.locator('[data-ticket-field="stop"]').fill('8');
    await frame.locator('[data-ticket-field="target"]').fill('12');
    await page.waitForTimeout(300);
    if (size.form === 'desk') await frame.locator('[data-ticket-risk="0.02"]').click();
    await page.waitForTimeout(300);
    await frame.locator('[data-order-act="buy"]').click();
    await page.waitForTimeout(900);
  }
  for (let i = 0; i < 4; i++) await frame.locator('[aria-label="One step on"]').first().click();
  await top();
  await page.mouse.move(size.w - 10, 6);
  await page.waitForTimeout(1500);
};
/* THE JOURNAL, AS IT OPENS (2026-09-26): calendar first, on the sample September (data/paper/sample.ts) — a day opened on
   the desk form, so the picture shows what a press on a day gives */
PREPARE['/practice/journal'] = async (page, theme, size) => {
  const frame = page.frameLocator('#t');
  await frame.locator('[data-journal-daybars]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  if (size.form === 'desk') {
    const busiest = await frame.locator('[data-journal-day]').evaluateAll(els => els.sort((a, b) => +b.getAttribute('data-trades') - +a.getAttribute('data-trades'))[0]?.getAttribute('data-journal-day'));
    if (busiest) {
      await frame.locator(`[data-journal-day="${busiest}"]`).click();
      await page.waitForTimeout(1200);
    }
    await frame.locator('main').evaluate(m => (m.scrollTop = 0));
  }
  /* the pointer parked on empty ground: at the corner it raised the rail's "Home" tooltip over the page's title */
  await page.mouse.move(size.w * 0.6, size.h - 40);
  await page.waitForTimeout(600);
};
/* PAPER, IN USE (2026-09-26 — Noah, of the start page's two cards: "the page should be a look of the options papertrading
   not just some image of 2 boxes"). In the landing's window the paper store holds nothing; in THE PHOTOGRAPHER'S WINDOW
   (embed.ts PHOTO, the `photo=1` above) it may start a throwaway account and run it in memory. So, the way a reader would:
   a practice account of $25,000 started by the page's own door, a strike of SPY's chain opened, one call bought at the
   ask — the picture is the desk with the position on its chart and the strike's order open under it. */
PREPARE['/practice/paper'] = async (page, theme, size) => {
  const frame = page.frameLocator('#t');
  await frame.locator('[data-paper-start]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await frame.locator('[data-paper-start-size="25000"]').click();
  /* the paper chain is the Weigher's grid (AG Grid rows, `row-id` s<strike>), lowest strike first, the market's line among them */
  const rows = frame.locator('[data-paper-chain-grid] .ag-row');
  await rows.first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const top = () => frame.locator('main').evaluate(m => (m.scrollTop = 0));
  /* on the desk the trade is the film's to make (2026-10-02): the account stands open, nothing bought */
  if (size.form === 'desk') {
    await top();
    await page.mouse.move(size.w - 10, 6);
    await page.waitForTimeout(800);
    return;
  }
  try {
    /* a strike a little out of the money: two rows above the middle of what is drawn */
    const n = await rows.count();
    const row = rows.nth(Math.min(n - 1, Math.floor(n / 2) + 2));
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await frame.locator('[data-order-act="buy"]').first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    await frame.locator('[data-order-act="buy"]').first().click();
    await page.waitForTimeout(2500);
  } catch (e) {
    console.log(`  paper: the buy did not go (${String(e).split('\n')[0]}) — the picture is the desk without it`);
  }
  await top();
  await page.mouse.move(size.w - 10, 6);
  await page.waitForTimeout(800);
};
