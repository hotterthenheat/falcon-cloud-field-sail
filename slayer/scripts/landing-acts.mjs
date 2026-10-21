/*
  THE LANDING'S ACTS (2026-10-01) — what the pointer does on each page while it is filmed
  (scripts/make-landing-clips.mjs runs them; scripts/landing-film.mjs is the camera and the hand).

  An act is written the way a reader would use the page: a row hovered for its card, a menu opened and a choice made, a
  day pressed, a desk switched, a page opened and left again. Three rules:

      IT ENDS WHERE IT BEGAN   a film loops, so whatever an act changes it changes back — the choice put back, the row
                               let go, the page left — and the pointer goes home last
      IT USES THE PAGE'S OWN   every place is found by the page's own selectors at the moment it is needed; a place that
      DOORS                    is not on the screen is skipped (and said when the film is written), never guessed at
      IT SHOWS HOW IT MOVES    the swaps, the menus, the cards, a page opening — the things that are ours — each given
                               the time to finish before the next press

  Times are the page's own milliseconds; a film runs faster than that (SPEED in make-landing-clips.mjs).
*/
import { on, says, at } from './landing-film.mjs';

/** the page's scroller */
const SCROLLER = 'main';

/* ---- pieces an act is made of --------------------------------------------------------------------------------------- */

const ITEMS = id => `[data-dropdown-card="${id}"] [role="menuitemradio"]`;

/** A card of choices opened and one picked: by its words (how they begin), by its place, or 'next' — the one after the
    one that is picked. Answers the place of the one picked BEFORE, so the act can put it back; null if nothing was done. */
export const choose = async (film, id, pick, n = 0) => {
  if (!(await film.press(on(`[data-dropdown="${id}"]`, n), { after: 420 }))) return null;
  const state = await film.frame
    .locator(ITEMS(id))
    .evaluateAll(els => ({ was: els.findIndex(e => e.getAttribute('data-state') === 'checked'), words: els.map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase()) }))
    .catch(() => ({ was: -1, words: [] }));
  const count = state.words.length;
  const idx = typeof pick === 'number' ? pick : pick === 'next' ? (count ? (state.was + 1) % count : -1) : state.words.findIndex(w => w.startsWith(String(pick).toLowerCase()));
  if (idx < 0 || idx >= count || !(await film.press(on(ITEMS(id), idx, 0.3), { after: 560 }))) {
    await film.key('Escape', 420);
    film.skip(`${id}: ${pick}`);
    return null;
  }
  return state.was;
};

/** the pointer runs down a few of the page's rows, so each lights and shows its card */
const browse = async (film, sel, places, { fx = 0.5, rest = 420, ms } = {}) => {
  for (const n of places) {
    if (await film.glide(on(sel, n, fx), ms)) await film.wait(rest);
  }
};

/** A grid's n-th row AS IT STANDS ON THE SCREEN, top to bottom (a grid keeps its rows in no order in the page, and
    numbers them from the top of its list, not of what is in view) */
/* the rows a grid shows, top to bottom. A row scrolled out of the grid's OWN window still has a box in the page — over
   whatever stands above the grid — so a row counts only where it is inside that window (2026-10-02: the paper chain's
   first rows were under the account card, and the pointer pressed the card). A full-width row (a strike's opened
   drop-down) is not a row to press. */
const gridRows = async (film, scope) =>
  (
    await film.frame
      .locator(`${scope} .ag-row:not(.ag-full-width-row)`)
      .evaluateAll(els =>
        els.map(e => {
          const r = e.getBoundingClientRect();
          const v = e.closest('.ag-body-viewport, .ag-body, .ag-root')?.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height, v ? r.top >= v.top - 1 && r.bottom <= v.bottom + 1 : true];
        })
      )
      .catch(() => [])
  )
    .filter(([x, y, w, h, inside]) => inside && w > 2 && h > 2 && y > 60 && y + h < film.size.h - 8)
    .sort((a, b) => a[1] - b[1]);

const gridRow = (scope, n, fx = 0.4) =>
  Object.assign(
    async film => {
      const all = await gridRows(film, scope);
      if (!all.length) return null;
      const [x, y, w, h] = all[Math.max(0, Math.min(all.length - 1, n))];
      return [x + Math.min(w, film.size.w - x) * fx, y + h / 2];
    },
    { label: `${scope} row ${n}` }
  );

/** …the pointer down a few of them */
const rows = async (film, scope, places, { fx = 0.4, rest = 400, ms } = {}) => {
  for (const n of places) {
    if (await film.glide(gridRow(scope, n, fx), ms)) await film.wait(rest);
  }
};

/** THE CHAIN'S STRIKE n OVER THE MARKET'S LINE (1 = the first strike above it): the chain's strike rows on screen above
    the divider, nearest the line first — a row is named by its id, `s<strike>`. Null when the line is not on screen. */
const strikeOverTheLine = async (film, scope, n) => {
  const line = await film.frame.locator(`${scope} [data-chain-divider]`).first().boundingBox().catch(() => null);
  if (!line) return null;
  const rows = await film.frame
    .locator(`${scope} .ag-row[row-id^="s"]`)
    .evaluateAll(els => els.map(e => [e.getBoundingClientRect().bottom, Number((e.getAttribute('row-id') ?? '').slice(1))]))
    .catch(() => []);
  const above = rows.filter(([bottom, k]) => Number.isFinite(k) && bottom <= line.y + 1).sort((a, b) => b[0] - a[0]);
  return above[Math.min(n - 1, above.length - 1)]?.[1] ?? null;
};

/** a chain row by its strike, wherever it stands on the screen (the grid names a strike's row `s<strike>`) */
const chainRow = (scope, k, fx = 0.3) => on(`${scope} .ag-row[row-id="s${k}"]`, 0, fx, 0.5);

/** WHERE A SETUP CHART'S MARKS STAND, top to bottom. The targets and the floor are drawn on the tape, not in the page, so
    nothing in the page says where they are. The pointer is run down the tape's right edge UNSEEN — no frame is taken
    and the film's clock does not move — and the mark's own card says what it is on. */
const markPlaces = async film => {
  const box = await film.frame.locator('[data-setup-chart] [data-chart-ink] canvas').first().boundingBox().catch(() => null);
  if (!box) return [];
  const x = box.x + box.width - 16;
  const seen = new Map();
  for (let y = box.y + 8; y < box.y + box.height - 8; y += 3) {
    await film.page.mouse.move(x, y);
    await new Promise(r => setTimeout(r, 18));
    const kind = await film.doc().evaluate(() => document.querySelector('[data-setup-mark-card]')?.getAttribute('data-setup-mark-card') ?? null);
    if (kind) seen.set(kind, [...(seen.get(kind) ?? []), y]);
  }
  await film.page.mouse.move(film.x, film.y);
  await new Promise(r => setTimeout(r, 40));
  return [...seen].map(([kind, ys]) => ({ kind, at: [x, (ys[0] + ys[ys.length - 1]) / 2] })).sort((a, b) => a.at[1] - b.at[1]);
};

/** A SEARCHING CARD (the board's Name): opened, a name typed, its row pressed. `pick` is a value (`data-search-option`),
    or a function of the rows on offer ({ value, words }). Back comes what was picked, or null. */
const search = async (film, id, pick, typed = v => v.slice(0, 2).toLowerCase()) => {
  const ROWS = `[data-dropdown-card="${id}"] [data-search-option]`;
  if (!(await film.press(on(`[data-dropdown="${id}"]`), { after: 450 }))) return null;
  const rows = await film.frame.locator(ROWS).evaluateAll(els => els.map(e => ({ value: e.getAttribute('data-search-option'), words: (e.textContent ?? '').replace(/\s+/g, ' ').trim() })));
  const want = typeof pick === 'function' ? pick(rows) : pick;
  const words = want ? typed(want) : '';
  if (words) {
    await film.type(words, 150);
    await film.wait(350);
  }
  if (!want || !(await film.press(on(`[data-dropdown-card="${id}"] [data-search-option="${want}"]`, 0, 0.4), { after: 620 }))) {
    await film.key('Escape', 420);
    film.skip(`${id}: ${want ?? 'nothing to pick'}`);
    return null;
  }
  return want;
};

/** TWO TARGETS AND A STOP PULLED OFF THE POSITION'S OWN CHIP on the chart (Noah, 2026-10-02: "actually dragging the
    take profits and stop on the literal chart to make it look more simple"): a line leaves the chip and follows the
    hand; let go above the price it is a target, below it a stop; a second pull above adds another target and splits
    the contracts between the two (so the position is two contracts — one has nothing to split). */
const pullTwoTargetsAndAStop = async (film, { up = 66, further = 118, down = 60 } = {}) => {
  for (const dy of [-up, -further, down]) {
    /* the chip stands at the position's price; the pull starts on its words, clear of its × */
    const at = await film.point(on('[data-chart-position]', 0, 0.22, 0.5));
    if (!at) return film.skip('the position’s chip on the chart');
    await film.glide(at, 700);
    await film.wait(260);
    await film.drag([at[0], at[1] + dy], 950);
    await film.wait(520);
  }
  return true;
};

/** How far the page scrolls before the site's footer comes up (the footer is the site's, not the page's: never filmed) */
const roomOf = film =>
  film.doc().evaluate(sel => {
    const m = document.querySelector(sel);
    if (!m) return 0;
    const foot = m.querySelector('footer');
    const end = foot ? foot.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop : m.scrollHeight;
    return Math.max(0, Math.round(end - m.clientHeight));
  }, SCROLLER);

/** The page scrolled until `sel` stands `gap` pixels under the window's top (never past the page's own room); back comes
    how far it went, to come back by */
const scrollTo = async (film, sel, gap = 70, ms = 1200) => {
  const top = await film.doc().evaluate(sel => document.querySelector(sel)?.getBoundingClientRect().top ?? null, sel);
  if (top == null) return film.skip(`scroll to ${sel}`), 0;
  const at = await film.doc().evaluate(sel => document.querySelector(sel)?.scrollTop ?? 0, SCROLLER);
  const dy = Math.round(Math.max(-at, Math.min((await roomOf(film)) - at, top - gap)));
  if (Math.abs(dy) > 4) await film.scroll(SCROLLER, dy, ms);
  return dy;
};

/** The page left the way it was entered: the app's own history, a step back */
const back = async film => {
  await film.doc().evaluate(() => history.back());
  await film.wait(900);
};

const end = async film => {
  await film.home();
  await film.wait(500);
};

/* ---- a phone: a thumb reads the page down and back ------------------------------------------------------------------ */

export const phoneAct = async film => {
  await film.wait(900);
  /* how far the page goes before its footer comes up — the footer is the site's, not the page's, and is never filmed */
  const room = await film.doc().evaluate(sel => {
    const m = document.querySelector(sel);
    if (!m) return 0;
    const foot = m.querySelector('footer');
    const end = foot ? foot.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop : m.scrollHeight;
    return Math.max(0, Math.round(end - m.clientHeight));
  }, SCROLLER);
  if (room < 140) {
    /* a page that is one screen (Pulse's one chart): nothing to scroll — the feed moves, and a fingertip rests on the chart */
    film.x = film.size.w * 0.5;
    film.y = film.size.h * 0.42;
    for (let i = 0; i < 6; i++) {
      film.alpha = Math.min(1, film.alpha + 0.25);
      await film.shoot();
    }
    await film.page.mouse.move(film.x, film.y);
    await film.wait(3600);
    for (let i = 0; i < 6; i++) {
      film.alpha = Math.max(0, film.alpha - 0.2);
      await film.shoot();
    }
    film.alpha = 0;
    await film.page.mouse.move(film.size.w + 12, film.size.h * 0.62);
    await film.wait(1400);
    return;
  }
  const leg = Math.min(460, Math.round(room / 2));
  film.x = film.size.w * 0.62;
  film.y = film.size.h * 0.74;
  await film.scroll(SCROLLER, leg, 1500);
  await film.wait(1300);
  film.y = film.size.h * 0.74;
  await film.scroll(SCROLLER, leg, 1300);
  await film.wait(1300);
  film.y = film.size.h * 0.4;
  await film.scroll(SCROLLER, -2 * leg, 1700);
  film.alpha = 0;
  await film.wait(700);
};

/* ---- a page with no act of its own: the pointer reads down it and back ---------------------------------------------- */

export const readAct = async film => {
  await film.wait(700);
  await film.glide(at(0.4, 0.42));
  await film.wait(500);
  await film.glide(at(0.56, 0.6), 900);
  await film.wait(700);
  await film.glide(at(0.34, 0.72), 900);
  await film.wait(600);
  await end(film);
};

/* ---- the desks ------------------------------------------------------------------------------------------------------ */

export const ACTS = {
  /* PULSE, ON "THE OPEN" (Noah's cut, 2026-10-02: "move the chart around, play with the timeframes … change between
     matrix calendar and for the matrix you should change to see 'all' the greeks then go back to gex, hover over the news,
     earnings and key levels for a brief moment"). The desk is staged on The open with the book across the next seven
     expiries (landing-stage.mjs, SEED_FOR). Every step is put back, so the film ends on the frame it began on:
     the chart by its own Reset and the interval it opened on, the book by the cards that changed it. */
  '/pulse': async film => {
    const tape = (fx, fy) => on('[data-tile="chart"] canvas', 0, fx, fy);
    const chart = words => says(words, '[data-tile="chart"]');
    /* a row of the matrix, at a place INSIDE the tile: with all five Greeks the table is wider than its box, and a point
       taken off the row's own width lands past the tile's edge */
    const bookRow = (n, fx) => async f => {
      const row = await on('[data-matrix-row]', n, 0, 0.5)(f);
      const tile = await on('[data-tile="book"]', 0, fx, 0.5)(f);
      return row && tile ? [tile[0], row[1]] : null;
    };
    const MATRIX = '[data-tile="book"] [data-matrix-scroll]';
    await film.wait(400);
    /* the chart, moved about: back through the morning, forward again, then its own Reset */
    await film.glide(tape(0.56, 0.44), 1000);
    await film.wait(250);
    await film.drag(tape(0.9, 0.38), 1100);
    await film.wait(350);
    await film.drag(tape(0.42, 0.5), 1000);
    await film.wait(350);
    await film.press(chart('Reset'), { after: 800 });
    /* the interval, on the chart's own taskbar */
    await film.press(chart('5m'), { after: 1000 });
    await film.press(chart('15m'), { after: 1000 });
    await film.press(chart('1m'), { after: 800 });
    /* the book: the calendar → the matrix → all five Greeks → GEX again → the calendar again */
    const view = await choose(film, 'tile-book-view', 'matrix');
    await film.wait(700);
    const greek = await choose(film, 'tile-book-greek', 'all');
    if (await film.glide(bookRow(5, 0.42))) await film.wait(650);
    /* five Greeks do not fit the tile side by side: the table is slid across to vanna and charm and back, with the
       pointer up on the Greek card, where it is going next */
    await film.glide(on('[data-dropdown="tile-book-greek"]'));
    const room = await film.doc().evaluate(sel => {
      const m = document.querySelector(sel);
      return m ? m.scrollWidth - m.clientWidth : 0;
    }, MATRIX);
    if (room > 8) {
      await film.scroll(MATRIX, room, 1500, 'x');
      await film.wait(550);
      await film.scroll(MATRIX, -room, 1100, 'x');
      await film.wait(250);
    }
    if (greek != null) await choose(film, 'tile-book-greek', greek);
    await film.wait(600);
    if (view != null) await choose(film, 'tile-book-view', view);
    await film.wait(600);
    /* the foot of the desk, left to right — a moment on each: key levels, the wire, who reports */
    await browse(film, '[data-levels-tile] .grid.items-center', [0, 3], { fx: 0.4, rest: 480 });
    await browse(film, '[data-tile="news"] [data-tile-row]', [1, 4], { fx: 0.45, rest: 480 });
    await browse(film, '[data-tile="earnings"] [data-tile-row]', [1, 3], { fx: 0.45, rest: 480 });
    await end(film);
  },

  /* FOUR CHARTS — the crosshair on one, its interval changed and put back, then across to another */
  '/pulse/board': async film => {
    await film.wait(500);
    await film.glide(at(0.2, 0.28));
    await film.glide(at(0.36, 0.33), 1200);
    await film.press(says('1h', 'main', 0), { after: 1300 });
    await film.glide(at(0.3, 0.3), 700);
    await film.wait(500);
    await film.press(says('1m', 'main', 0), { after: 1000 });
    await film.glide(at(0.7, 0.3));
    await film.glide(at(0.84, 0.36), 1100);
    await film.glide(at(0.74, 0.76));
    await film.glide(at(0.62, 0.8), 1000);
    await end(film);
  },

  /* COMPASS (Noah's cut, 2026-10-02: "switch through the gamma voi oi from spot and exposure and clicking the card to see
     the full analysis and hovering over the tps and stops on the chart + the setup and contract that is right next to
     the 'why we chose this', on the board change the kind and also the name"). The Heaviest rail read its four ways; the
     picked card pressed, which opens the setup's own page; the floor and the targets on its chart, each under the
     pointer; the card's Setup and Contract tabs; back on the board, the Kind changed and one name searched for.
     Everything is put back — the rail on Gamma, the Name on every name, the Kind it opened on, the card it opened on. */
  '/compass': async film => {
    const rail = words => says(words, '[data-compass-rail]');
    const tab = words => says(words, '[data-setup-card]');
    await film.wait(400);
    /* the board re-sorts on a sweep, so the card to come back to is remembered by its name, not its place */
    film.memo.card = await film.frame.locator('[data-compass-card][data-selected]').first().getAttribute('data-compass-card').catch(() => null);
    await film.press(rail('Vol/OI'), { after: 850 });
    await film.press(rail('From spot'), { after: 850 });
    await film.press(rail('Exposure'), { after: 850 });
    await film.press(rail('Gamma'), { after: 450 });
    /* the picked card pressed opens the setup's own page — on "Why we chose this" */
    await film.press(on('[data-compass-card][data-selected]', 0, 0.45, 0.62), { after: 1900 });
    /* the floor and the targets, top to bottom, each with its card */
    for (const m of (await markPlaces(film)).filter(m => m.kind !== 'entry')) {
      if (await film.glide(m.at)) await film.wait(620);
    }
    await film.press(tab('Setup'), { after: 1300 });
    await film.press(tab('Contract'), { after: 1400 });
    await film.press(says('The board', '[data-setup-back]'), { after: 1100 });
    /* the board: another kind, then one name. The kind is "All kinds" and the name the one with the most setups, so the
       board a single name leaves is still a full page (two cards of one kind left the window half empty, with the
       site's footer in it) */
    const kind = await choose(film, 'compass-kind', 'all');
    await film.wait(900);
    /* the name with the most setups on this sweep (its row says how many) */
    const setups = r => Number(/(\d+) setups?/.exec(r.words)?.[1] ?? 0);
    const name = await search(film, 'compass-name', rows => rows.filter(r => r.value !== 'ALL').sort((a, b) => setups(b) - setups(a))[0]?.value);
    await film.wait(900);
    if (name) await search(film, 'compass-name', 'ALL', () => '');
    if (kind != null) await choose(film, 'compass-kind', kind);
    await film.wait(300);
    /* the first card picked again — pressed only if it is not the picked one (a second press would open its page) */
    if (film.memo.card) await film.press(on(`[data-compass-card="${film.memo.card}"]:not([data-selected])`, 0), { after: 600 });
    await end(film);
  },

  /* THE TRACKER — what was kept, as cards and then as a table */
  '/compass/tracker': async film => {
    await film.wait(600);
    await browse(film, '[data-tracker-read]', [0, 1, 2], { rest: 380 });
    await film.press(says('Table'), { after: 1300 });
    await film.glide(at(0.42, 0.3), 700);
    await film.wait(600);
    await film.press(says('Cards'), { after: 900 });
    await end(film);
  },

  /* TERRAIN — the crosshair down a chart, the strike rail read strike by strike, the rail turned to its net and back,
     the desk taken to one chart and back to two */
  '/terrain': async film => {
    await film.wait(500);
    await film.glide(at(0.1, 0.4));
    await film.glide(at(0.22, 0.52), 1300);
    await film.glide(at(0.4, 0.3));
    await film.glide(at(0.41, 0.62), 1500);
    await film.press(on('[data-profile-view="net"]', 0), { after: 1100 });
    await film.press(on('[data-profile-view="ladder"]', 0), { after: 800 });
    await film.press(says('1', '[data-terrain-desk-bar]'), { after: 1500 });
    await film.press(says('2', '[data-terrain-desk-bar]'), { after: 1200 });
    await end(film);
  },

  /* THE MAP — rows hovered for their card, the matrix turned into the calendar (the swap is ours) and back */
  '/pinpoint/map': async film => {
    await film.wait(500);
    await browse(film, '[data-matrix-row]', [4, 7, 10, 13], { fx: 0.46, rest: 380 });
    const view = await choose(film, 'ledger-view', 'next');
    await film.wait(700);
    await film.glide(at(0.3, 0.42));
    await film.glide(at(0.52, 0.55), 1100);
    await film.wait(500);
    if (view != null) await choose(film, 'ledger-view', view);
    await film.wait(400);
    await end(film);
  },

  /* BUILDING — the strikes read down, the steady ones unfolded and folded, the order changed and put back */
  '/pinpoint/building': async film => {
    await film.wait(500);
    await browse(film, '[data-build-row]', [1, 3, 5], { fx: 0.55, rest: 420 });
    await film.press(on('[data-build-fold]', 0, 0.5), { after: 1100 });
    await film.press(on('[data-build-fold]', 0, 0.5), { after: 800 });
    const order = await choose(film, 'build-order', 'next');
    await film.wait(900);
    if (order != null) await choose(film, 'build-order', order);
    await end(film);
  },

  /* COMPARE — the two names read head to head, then the two books on one ruler */
  '/pinpoint/compare': async film => {
    await film.wait(500);
    await film.glide(at(0.34, 0.33));
    await film.glide(at(0.6, 0.45), 1200);
    await film.wait(400);
    await film.scroll(SCROLLER, 560, 1300);
    await film.glide(at(0.3, 0.5));
    await film.glide(at(0.66, 0.56), 1500);
    await film.wait(300);
    await film.glide(at(0.36, 0.62), 1100);
    await film.wait(500);
    await film.scroll(SCROLLER, -560, 1200);
    await end(film);
  },

  /* THE LIVE TAPE — it runs by itself; a print's row is read, the tape is cut to one kind and let go. And (Noah,
     2026-10-02: he liked the film "except that fact that the live tape doesnt have the pop up card when you click one of
     the rows and also the pausing and playing again the tape") the tape is HELD by its own Live button, a row pressed
     and its print's card read and closed, and the tape let run again. */
  '/trace/live-tape': async film => {
    await film.wait(900);
    await rows(film, '', [2, 5], { fx: 0.3, rest: 450 });
    /* held: nothing moves under the pointer until it is let go */
    const held = await film.press(on('button[title^="Hold the page"]'), { after: 800 });
    /* a row pressed opens the print's own card, over the tape */
    if (await film.press(gridRow('', 4, 0.3), { after: 1200 })) {
      await film.glide(on('[role="dialog"]', 0, 0.42, 0.4), 800);
      await film.glide(on('[role="dialog"]', 0, 0.5, 0.72), 1100);
      await film.wait(500);
      await film.press(on('[role="dialog"] [aria-label="Close"]'), { after: 800 });
    }
    if (held) await film.press(on('button[title^="Resume"]'), { after: 1300 });
    const kind = await choose(film, 'tape-kind', 'next');
    await film.wait(1500);
    if (kind != null) await choose(film, 'tape-kind', kind);
    await film.wait(900);
    await end(film);
  },

  /* NET FLOW — another name put on the pane, its lines read with the crosshair, the first name put back */
  '/trace/net-flow': async film => {
    await film.wait(500);
    await film.glide(at(0.5, 0.5));
    await film.glide(at(0.72, 0.44), 1300);
    await film.press(on('[data-names] button[data-ticker]', 1), { after: 1500 });
    await film.glide(at(0.52, 0.52));
    await film.glide(at(0.8, 0.46), 1400);
    await film.press(on('[data-names] button[data-ticker="SPY"]', 0), { after: 1200 });
    await end(film);
  },

  /* THE DARK POOL — the shelves read, the crosses cut by read and let go */
  '/trace/dark-pool': async film => {
    await film.wait(500);
    await browse(film, '[data-dark-pool-shelf]', [0, 1, 2], { rest: 420 });
    const read = await choose(film, 'dark-pool-read', 'next');
    await film.wait(1100);
    if (read != null) await choose(film, 'dark-pool-read', read);
    await rows(film, '', [2, 5], { fx: 0.4, rest: 400 });
    await end(film);
  },

  /* THE SCREENER — another screen picked, its rows read, the first screen put back */
  '/trace/screener': async film => {
    await film.wait(500);
    await rows(film, '', [1, 4], { fx: 0.4, rest: 380 });
    const screen = await choose(film, 'screener-screen', 'next');
    await film.wait(900);
    await rows(film, '', [2, 5, 8], { fx: 0.5, rest: 380 });
    if (screen != null) await choose(film, 'screener-screen', screen);
    await end(film);
  },

  /* THE WEIGHER — the position read by price and by date, the chain's rows, another position opened in the card and the
     first one come back to. And first (Noah, 2026-10-02: he liked the film, "add something else as well … move around
     the horizontal scroll for the position card so the curve moves back and forth") THE PRICE RULER under the position's
     curve is dragged one way, the other, and back to where it stood — the simulated return and its curve move with it.
     The three drags come to nothing, so the price is the one it began on; opening another position later lets it go
     back to the market's. */
  '/weigher': async film => {
    const ruler = fx => on('[data-price-ruler] svg', 0, fx, 0.62);
    await film.wait(500);
    /* THE CASE FOR A STRIKE (Noah, 2026-10-09, approving it: "refilm it"). The desk opens on the held position, and the
       chain on its strike — the case already unfolded, four lines of it in the docked card. So the chain is taken
       fullscreen (the chain is the screen, edge to edge) and the open case read down with the pointer: the word and its
       line, for it and against it, what has to happen, if not this one. Back at the top, a strike two over the market
       pressed, and its own case unfolds under it; its door to the other strike pressed, if it has one, and the chain opens
       on THAT case. Then put back: the chain where it stood, the desk again, and the held position pressed in the list —
       the card and the chain return to it, as the film began. The docked chain is a keyhole for a case this tall;
       fullscreen it reads. */
    const CHAIN = '[data-chain-grid]';
    const VIEW = `${CHAIN} .ag-grid-viewport`;
    const chainTop = () => film.doc().evaluate(sel => document.querySelector(sel)?.scrollTop ?? 0, VIEW);
    const readCase = async () => {
      await film.glide(on('[data-strike-reasons="For it"]', 0, 0.25, 0.2), 700);
      await film.wait(1000);
      await film.scroll(VIEW, 380, 1100);
      await film.glide(on('[data-strike-needs]', 0, 0.25, 0.25), 700);
      await film.wait(1000);
      await film.scroll(VIEW, 380, 1100);
      await film.glide(on('[data-strike-instead]', 0, 0.2, 0.15), 600);
      await film.wait(800);
    };
    if (await film.press(on('button[title="Fullscreen chain"]'), { after: 1000 })) {
      const was = await chainTop();
      if (await film.frame.locator('[data-strike-case]').count().catch(() => 0)) await readCase();
      let now = await chainTop();
      if (Math.abs(now - was) > 4) await film.scroll(VIEW, was - now, 900);
      await film.wait(300);
      /* another strike, two over the market: its own case */
      const k = await strikeOverTheLine(film, CHAIN, 2);
      if (k != null && (await film.press(chainRow(CHAIN, k, 0.3), { after: 1500 }))) {
        await film.glide(on('[data-strike-line]', 0, 0.3, 0.5), 700);
        await film.wait(1100);
        /* its door to the other strike, when it has one: the chain opens on that case at the top of the window */
        if (await film.press(on('[data-strike-alt="strike"]', 0, 0.4, 0.5), { after: 1900 })) {
          await film.glide(on('[data-strike-line]', 0, 0.3, 0.5), 700);
          await film.wait(1300);
        }
      }
      now = await chainTop();
      if (Math.abs(now - was) > 4) await film.scroll(VIEW, was - now, 900);
      await film.wait(300);
      await film.press(on('button[title="Exit fullscreen (Esc)"]'), { after: 1000 });
      /* the held position pressed: the card and the chain are its again */
      await film.press(gridRow('[data-list="positions"]', 0, 0.3), { after: 1600 });
    }
    if (await film.glide(ruler(0.5), 900)) {
      await film.wait(300);
      await film.drag(ruler(0.8), 1000);
      await film.wait(450);
      await film.drag(ruler(0.2), 1500);
      await film.wait(450);
      await film.drag(ruler(0.5), 1000);
      await film.wait(400);
    }
    await film.press(says('By price'), { after: 1300 });
    await film.glide(at(0.7, 0.62));
    await film.glide(at(0.86, 0.6), 1100);
    await film.press(says('By date'), { after: 900 });
    await rows(film, '[data-list="positions"]', [1, 2], { fx: 0.3, rest: 300 });
    await film.press(gridRow('[data-list="positions"]', 2, 0.3), { after: 2400 });
    await film.glide(at(0.74, 0.6), 800);
    await film.wait(500);
    await film.press(gridRow('[data-list="positions"]', 0, 0.3), { after: 2400 });
    await end(film);
  },

  /* NEWS (Noah's cut, 2026-10-02: "click the read the whole story dropdown, and also scrolling down to click the
     different news headlines that move the map, then going all the way down to the calendar and click a few days to see
     what is going on, on that calendar date"). The open story unfolded by its own door; the page taken down until the
     headlines stand under the map, and three of them pressed — each opens beside the map and draws the map in on its
     place; down to The day, where three dates are pressed and the panel beside the month says what is on each. Then all
     of it put back: today's date, the first headline, the page's head, the map on the whole world. */
  '/dossier/news': async film => {
    await film.wait(600);
    await film.glide(at(0.3, 0.42));
    await film.glide(at(0.5, 0.5), 1000);
    /* the story beside the map: its first paragraph stands in the open, the rest is behind this door */
    await film.press(on('[data-news-body-door]'), { after: 1500 });
    /* the headlines, with the map still whole above them */
    const toRows = await scrollTo(film, '[data-news-map]', 62, 900);
    await film.wait(250);
    for (const n of [2, 4, 5]) await film.press(on('[data-news-row]', n, 0.42), { after: 1500 });
    /* all the way down, to the calendar */
    const toDay = await scrollTo(film, '[data-news-calendar]', 110, 1500);
    await film.wait(500);
    const today = await film.frame.locator('[data-cal-day][data-today]').first().getAttribute('data-cal-day').catch(() => null);
    /* three dates with something on them, top to bottom of the month (a date with nothing on it has nothing to show) */
    const busy = await film.frame.locator('[data-cal-day]').evaluateAll(days => days.filter(d => !d.hasAttribute('data-today') && d.querySelectorAll('[data-cal-pill]').length >= 2).map(d => d.getAttribute('data-cal-day')));
    const pick = busy.length >= 3 ? [busy[1], busy[Math.floor(busy.length / 2)], busy[busy.length - 2]] : busy;
    for (const day of pick) await film.press(on(`[data-cal-day="${day}"]`, 0, 0.5, 0.75), { after: 1250 });
    if (today) await film.press(on(`[data-cal-day="${today}"]`, 0, 0.5, 0.75), { after: 700 });
    /* back up: the first headline opened again, the head of the page, the map on the whole world */
    if (toDay) await film.scroll(SCROLLER, -toDay, 1500);
    await film.press(on('[data-news-row]', 0, 0.42), { after: 1100 });
    if (toRows) await film.scroll(SCROLLER, -toRows, 800);
    await film.press(on('[data-news-map-fit]', 0), { after: 1200 });
    await end(film);
  },

  /* EARNINGS — the week's board read, a name's own page opened — a page opening is ours to show — and left again. The
     name's page is READ DOWN (Noah, 2026-10-02: the film "is good just need to scroll down a bit more when you click a
     specific company"): in two legs to its foot, then back to its head before it is left. */
  '/dossier/earnings': async film => {
    await film.wait(500);
    await browse(film, '[data-earnings-card]', [0, 2, 4], { rest: 350 });
    await film.press(on('[data-earnings-card]', 1), { after: 2000 });
    await film.glide(at(0.4, 0.45));
    await film.glide(at(0.6, 0.52), 1200);
    await film.wait(400);
    const room = await roomOf(film);
    if (room > 80) {
      const leg = Math.round(room / 2);
      await film.scroll(SCROLLER, leg, 1300);
      await film.wait(900);
      await film.scroll(SCROLLER, room - leg, 1300);
      await film.wait(1100);
      await film.scroll(SCROLLER, -room, 1200);
      await film.wait(300);
    }
    await back(film);
    await film.wait(400);
    await end(film);
  },

  /* INSIDERS — the grid kept to one name and let go, the rows read */
  '/dossier/insiders': async film => {
    await film.wait(500);
    await browse(film, '[data-insiders-name]', [0, 1], { rest: 320 });
    await film.press(on('[data-insiders-name]', 2), { after: 1500 });
    await rows(film, '', [0, 2], { fx: 0.4, rest: 420 });
    await film.press(on('[data-insiders-name]', 2), { after: 1100 });
    await end(film);
  },

  /* CONGRESS — the grid kept to one member and let go, the rows read */
  '/dossier/congress': async film => {
    await film.wait(500);
    await browse(film, '[data-congress-report]', [0, 1], { rest: 320 });
    await film.press(on('[data-congress-report]', 2), { after: 1500 });
    await rows(film, '', [0, 2], { fx: 0.4, rest: 420 });
    await film.press(on('[data-congress-report]', 2), { after: 1100 });
    await end(film);
  },

  /* STOCKS — the grid kept to one sector and let go, the rows read */
  '/dossier/stocks': async film => {
    await film.wait(500);
    await browse(film, '[data-stocks-sector]', [0, 1, 2], { rest: 300 });
    await film.press(on('[data-stocks-sector]', 1), { after: 1500 });
    await rows(film, '', [1, 3, 5], { fx: 0.4, rest: 400 });
    await film.press(on('[data-stocks-sector]', 1), { after: 1100 });
    await end(film);
  },

  /* THE THREE TRADING DESKS (Noah's cut, 2026-10-02: "i want you to actually enter a position place 2 tps and a stop
     for the options and futures" — and, of a first cut that typed them on the order card, "no i meant like actually
     dragging the take profits and stop on the literal chart to make it look more simple"). Each film MAKES the trade it
     used to open on: a contract picked, two of it bought, then two targets and a stop PULLED OFF ITS CHIP on the chart.
     The stage leaves the desk with nothing open (landing-stage.mjs); these films do not end where they began, and never
     did (a played day cannot be unplayed). */

  /* PAPER — the live desk: the chart read, a strike of the chain opened, and the order inside its dropdown filled and bought */
  '/practice/paper': async film => {
    const ORDER = '[data-chain-order="buy"]';
    await film.wait(500);
    await film.glide(at(0.2, 0.4));
    await film.glide(at(0.4, 0.46), 1100);
    /* a strike just above the market's line (the line is the one gap in the chain's rows): its row opens on the stats,
       the greeks and the order */
    const strike = Object.assign(
      async f => {
        const all = await gridRows(f, '[data-paper-chain-grid]');
        if (all.length < 2) return null;
        let at = 0;
        for (let i = 1; i < all.length - 1; i++) if (all[i + 1][1] - all[i][1] > all[at + 1][1] - all[at][1]) at = i;
        const [x, y, w, h] = all[at];
        return [x + w * 0.3, y + h / 2];
      },
      { label: 'the strike above the market' }
    );
    await film.press(strike, { after: 1100 });
    /* the page taken down until the order stands in the window; two bought at the ask */
    const down = await scrollTo(film, ORDER, 330, 900);
    await film.press(on(`${ORDER} [aria-label="One contract more"]`), { after: 450 });
    await film.press(on(`${ORDER} [data-order-act="buy"]`, 0), { after: 1100 });
    /* back to the head: the position on the chart — then its targets pulled up off it and its stop pulled down */
    if (down) await film.scroll(SCROLLER, -down, 900);
    await pullTwoTargetsAndAStop(film);
    await film.glide(at(0.42, 0.5), 800);
    await film.wait(1500);
    await end(film);
  },

  /* THE BACKTEST — options, on a past day: a strike picked off the chain as it stood, the order filled and bought, then
     the day played — the clock runs, the candles print, the position's figures move — and held */
  '/practice/backtest': async film => {
    const ORDER = '[data-chain-order="buy"]';
    await film.wait(500);
    await film.press(on('[data-chain-row]', 4, 0.3), { after: 1000 });
    const down = await scrollTo(film, ORDER, 420, 900);
    await film.press(on(`${ORDER} [aria-label="One contract more"]`), { after: 450 });
    await film.press(on(`${ORDER} [data-order-act="buy"]`, 0), { after: 1100 });
    if (down) await film.scroll(SCROLLER, -down, 900);
    await pullTwoTargetsAndAStop(film);
    await film.press(on('[data-replay-play]', 0), { after: 3600 });
    await film.glide(at(0.4, 0.45), 900);
    await film.glide(at(0.5, 0.5), 1200);
    await film.press(on('[data-replay-play]', 0), { after: 800 });
    await end(film);
  },

  /* FUTURES — the same on the day session: two contracts long at market, two targets pulled up off the position and a
     stop pulled down, then the day played and held */
  '/practice/futures': async film => {
    const ORDER = '[data-review-ticket]';
    await film.wait(500);
    await film.press(on(`${ORDER} [aria-label="One contract more"]`), { after: 450 });
    await film.press(on(`${ORDER} [data-order-act="buy"]`, 0), { after: 1200 });
    await pullTwoTargetsAndAStop(film);
    await film.press(on('[data-replay-play]', 0), { after: 3600 });
    await film.glide(at(0.4, 0.5), 900);
    await film.glide(at(0.5, 0.55), 1200);
    await film.press(on('[data-replay-play]', 0), { after: 800 });
    await end(film);
  },

  /* THE JOURNAL — another day opened under the month, its trades read, and the first day come back to */
  '/practice/journal': async film => {
    await film.wait(500);
    film.memo.day = await film.frame.locator('[data-journal-day][data-on]').first().getAttribute('data-journal-day').catch(() => null);
    await browse(film, '[data-journal-day]:not([data-trades="0"])', [1, 3], { rest: 320 });
    await film.press(on('[data-journal-day]:not([data-trades="0"]):not([data-on])', 4), { after: 1500 });
    await film.scroll(SCROLLER, 380, 1100);
    await film.glide(at(0.4, 0.62));
    await film.glide(at(0.6, 0.66), 1000);
    await film.wait(500);
    await film.scroll(SCROLLER, -380, 1000);
    if (film.memo.day) await film.press(on(`[data-journal-day="${film.memo.day}"]`, 0), { after: 1200 });
    await end(film);
  },
};

/* ---- THE PRODUCT PAGES' FILMS -----------------------------------------------------------------------------------------

   A product's own page (2026-10-02, Noah: "make the products sections open up a new brief page explaining that product
   with recordings") carries ONE recording of its own, of the one thing he named for it — not the tour's film of the page.
   These are keyed by name, not by path: `@pulse-arrange` on the film maker's command line films EXTRA['pulse-arrange']
   on its page, and the film is `public/landing/clips/pulse-arrange-<theme>-desk.mp4`. Desk only. */
export const EXTRA = {
  /* PULSE — THE DESK, ARRANGED (Noah, 2026-10-02: "only one screen recording on this page showcasing the ability to drag
     and move things around and how they plop into open spaces or fit their container … also how clicking full screen on
     something brings you to that page with the back to pulse button up top being shown"). A tile dragged by its head
     across the desk — the landing spot shows in silver, the others make room — and dragged back; a tile pulled wider by
     its corner, and back; then a tile's door pressed: its whole page opens with "Back to Pulse" at the top, and that
     is pressed. */
  'pulse-arrange': {
    path: '/pulse',
    act: async film => {
      /* a tile is taken by its head, at its words — the head's middle is its own cards, and its right its buttons */
      const head = key => on(`[data-tile="${key}"] .widget-drag`, 0, 0.1, 0.5);
      const corner = key => on(`[data-tile="${key}"]`, 0, 1, 1);
      /* the desk's grid: a column is a twelfth of the desk, measured off two tiles that stand a column apart */
      const col = async () => {
        const a = await film.frame.locator('[data-tile="levels"]').boundingBox().catch(() => null);
        const b = await film.frame.locator('[data-tile="news"]').boundingBox().catch(() => null);
        return a && b ? (b.x - a.x) / 4 : 110;
      };
      await film.wait(500);
      const c = await col();
      /* News dragged into the open space at the right: it plops into it, and the space it left is open */
      let p = await film.point(head('news'));
      if (p) {
        await film.glide(p, 900);
        await film.wait(300);
        await film.drag([p[0] + 4 * c, p[1]], 1300);
        await film.wait(900);
      }
      /* Key levels pulled wider by its corner, into the space News left: it fits what it is given — then back */
      p = await film.point(corner('levels'));
      if (p) {
        await film.glide([p[0] - 6, p[1] - 6], 700);
        await film.wait(300);
        await film.drag([p[0] - 6 + 4 * c, p[1] - 6], 1200);
        await film.wait(1000);
        const q = await film.point(corner('levels'));
        if (q) {
          await film.glide([q[0] - 6, q[1] - 6], 300);
          await film.drag([q[0] - 6 - 4 * c, q[1] - 6], 1000);
          await film.wait(700);
        }
      }
      /* News dragged home */
      p = await film.point(head('news'));
      if (p) {
        await film.glide(p, 700);
        await film.wait(250);
        await film.drag([p[0] - 4 * c, p[1]], 1300);
        await film.wait(900);
      }
      /* the Key levels tile's door: the Map opens as its whole page, "Back to Pulse" at the top; and back */
      if (await film.press(on('[data-tile="levels"] [data-tile-door]'), { after: 2200 })) {
        await film.glide(at(0.5, 0.45), 900);
        await film.wait(600);
        await film.press(on('[data-way-back]'), { after: 1800 });
      }
      await end(film);
    },
  },
};
