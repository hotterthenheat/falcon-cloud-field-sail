/*
==================================================
  SLAYER TERMINAL - THE PRODUCT PAGES' PICTURES
  (scripts/make-product-shots.mjs)

  A product's own page (2026-10-02) explains the
  product with pictures of it, and ONE recording
  (the film maker's `@<key>` films). The pictures
  are photographed here, from the real terminal in
  the landing's window, both themes, into
  public/landing/products/<product>/<name>-<theme>.webp

  PULSE: a close crop of two tiles (the head, the
  instrument, the read), the Add widget list open,
  and the five house desks, each as a small picture.

  PRACTICE: the paper desk's start page and the desk
  with a bracketed position, the futures desk with
  its ladder; the backtest's sessions page, its desk
  on a played day, the report; the journal's month
  with its figures, a day under it, and a trade's
  own page — the shape of it, and the words.

  WEIGHER: the desk whole (in a window tall enough
  for all four cards), the chain with a strike open,
  the position card by date and by price, the two
  lists, the Add a position form, and the two doors
  onto the watchlist — the + on a strike and the
  card's own.

  TRACE: the tape full and a print's card over it,
  the dark pool's shelves and crosses and where the
  dark money went, the screener, net flow, the
  footprints, the watchers, a quarter hour of the
  day, the same-day money on four panes, the tape
  as structures, two names side by side.

  PINPOINT: the Map's matrix and its calendar view,
  the trader's clock and how the levels held; the
  range and where it closes; what's being built and
  where the walls are heading; at the wall; the
  targets and where they sit; the board; head to
  head, the two books on one ruler, since the open
  and the pair.

  DOSSIER: the story in hand beside the map, the
  headlines with their impact marks, the calendar
  with the four reads under it, the earnings week
  and a name's last eight prints, the stocks screen
  and four sections of a name's full analysis, the
  insiders' and Congress's pages.

  Usage:  node scripts/make-product-shots.mjs [http://localhost:5199] [pulse] [dark|light]
==================================================
*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { openStage } from './landing-film.mjs';
import { PREPARE, seedFor } from './landing-stage.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5199';
const ONLY = process.argv.slice(3).filter(a => a !== 'dark' && a !== 'light');
const ONLY_THEMES = process.argv.slice(3).filter(a => a === 'dark' || a === 'light');
const AT = '2026-09-30T18:10:00Z';
const OUT = resolve(process.cwd(), 'public/landing/products');
const THEMES = ['dark', 'light'].filter(t => !ONLY_THEMES.length || ONLY_THEMES.includes(t));
const ON_QQQ = JSON.stringify({ opensOn: { ticker: 'QQQ', timeframe: null }, alertsSound: true, clock: 'local' });

/** a PNG turned into a WEBP, at most `w` wide, by a browser page's own canvas (no image library on this machine) */
const webp = async (page, png, w, q = 0.86) =>
  Buffer.from(
    (
      await page.evaluate(
        ([src, w, q]) =>
          new Promise(done => {
            const img = new Image();
            img.onload = () => {
              const s = Math.min(1, w / img.naturalWidth);
              const c = document.createElement('canvas');
              c.width = Math.round(img.naturalWidth * s);
              c.height = Math.round(img.naturalHeight * s);
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              done(c.toDataURL('image/webp', q));
            };
            img.src = src;
          }),
        [`data:image/png;base64,${png.toString('base64')}`, w, q]
      )
    ).split(',')[1],
    'base64'
  );

/** a stage on a page, settled: the frame, a scroller, and a crop of one element (with `pad` around it, and `more`
    pixels under it for what follows) photographed as webp */
const stageOn = async (browser, path, theme, dpr = 2, seed = null, ms = 6000, h = 1000) => {
  const stage = await openStage(browser, { base: BASE, w: 1440, h, dpr, path, theme, seed: seed ?? seedFor(path), at: AT, form: 'desk' });
  const { page, frame } = stage;
  await page.waitForTimeout(ms);
  await page.mouse.move(1450, 600);
  /* the page's scroller moved so an element stands at the window's top (+gap) */
  const scrollTo = async (sel, gap = 24) => {
    await frame.locator(sel).first().evaluate((el, gap) => {
      const m = document.querySelector('main');
      if (m) m.scrollTop += el.getBoundingClientRect().top - gap;
    }, gap);
    await page.waitForTimeout(700);
  };
  const crop = async (sel, { pad = 10, more = 0, maxW = 1800, q = 0.86, h: hh = null } = {}) => {
    const b = await frame.locator(sel).first().boundingBox();
    if (!b) return null;
    const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(1440 - Math.max(0, b.x - pad), b.width + pad * 2), height: Math.min(h - Math.max(0, b.y - pad), (hh ?? b.height) + pad * 2 + more) };
    return webp(page, await page.screenshot({ type: 'png', clip }), maxW, q);
  };
  const whole = async (maxW = 1440, q = 0.84) => webp(page, await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1440, height: h } }), maxW, q);
  /* a crop of a region of the window, as it stands */
  const region = async (x, y, w, hh, maxW = 1800, q = 0.86) => webp(page, await page.screenshot({ type: 'png', clip: { x, y, width: Math.min(w, 1440 - x), height: Math.min(hh, h - y) } }), maxW, q);
  /* a box named by its head: scrolled to the window's top, and cropped from the head's box down, `h` pixels */
  const underHead = async (words, h, { pad = 10, maxW = 1800 } = {}) => {
    const head = frame.locator('main h3', { hasText: words }).first();
    if (!(await head.count())) return null;
    await head.evaluate(el => {
      const m = document.querySelector('main');
      if (m) m.scrollTop += el.getBoundingClientRect().top - 40;
    });
    await page.waitForTimeout(700);
    const b = await head.boundingBox();
    if (!b) return null;
    /* the box the head stands in: the nearest bordered ancestor */
    const box = await head.evaluate(el => {
      let e = el;
      while (e && e !== document.body) {
        const cs = getComputedStyle(e);
        if (cs.borderTopWidth !== '0px' && cs.borderRadius !== '0px') break;
        e = e.parentElement;
      }
      const r = (e ?? el).getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    });
    return region(Math.max(0, box[0] - pad), Math.max(0, box[1] - pad), box[2] + pad * 2, Math.min(box[3], h) + pad * 2, maxW);
  };
  return { stage, page, frame, scrollTo, crop, whole, region, underHead, close: () => stage.ctx.close() };
};

/** TWO TARGETS AND A STOP PULLED OFF THE POSITION'S CHIP — the simple way, as the films do it (landing-acts.mjs) */
const pullBrackets = async (page, frame) => {
  for (const dy of [-66, -118, 60]) {
    const c = await frame.locator('[data-chart-position]').first().boundingBox().catch(() => null);
    if (!c) return;
    const x = c.x + c.width * 0.22;
    const y = c.y + c.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy / 2, { steps: 6 });
    await page.mouse.move(x, y + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
};
/** two of the contract in hand, bought at the order card's first button */
const buyTwo = async (page, frame, scope) => {
  await frame.locator(`${scope} [aria-label="One contract more"]`).first().click();
  await page.waitForTimeout(300);
  await frame.locator(`${scope} [data-order-act="buy"]`).first().click();
  await page.waitForTimeout(1200);
};

/** a page's dropdown card picked by its words (the house's DropdownSelect) */
const pick = async (page, frame, id, words) => {
  await frame.locator(`[data-dropdown="${id}"]`).first().click();
  await page.waitForTimeout(400);
  await frame.locator(`[data-dropdown-card="${id}"] [role^="menuitem"]`, { hasText: words }).first().click();
  await page.waitForTimeout(1200);
};

const PRODUCTS = {
  /* TERRAIN (2026-10-03): the desk whole, a pane's strip and the desk bar, the strike rail as the ladder and as the net,
     a drawing family's list and the sheet of every tool, the scripts' library and the editor docked beside a fullscreen
     chart, and the replay card at a chart's foot */
  terrain: async (browser, theme, dir) => {
    const save = (k, buf) => {
      if (!buf) return console.log(`  ${k}-${theme}.webp  NOT MADE`);
      writeFileSync(resolve(dir, `${k}-${theme}.webp`), buf);
      console.log(`  ${k}-${theme}.webp  ${Math.round(buf.length / 1024)} KB`);
    };
    const st = await stageOn(browser, '/terrain', theme, 1.5, null, 3000);
    const { page, frame } = st;
    await frame.locator('[data-terrain-desk-bar]').first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(4500);
    await page.mouse.move(1450, 600);
    /* the desk whole */
    save('desk', await st.whole(1440, 0.84));
    const box = async (frame, sel) => frame.locator(sel).first().boundingBox().catch(() => null);
    const tap = async sel => {
      const b = await box(frame, sel);
      if (!b) return false;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(250);
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      return true;
    };
    /* the largest chart box on the page — the pane in hand */
    const bigPane = async () => {
      const boxes = await frame.locator('main [data-chart-ground]').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
      return boxes.sort((p, q) => q[2] * q[3] - p[2] * p[3])[0] ?? null;
    };
    /* the desk bar */
    save('bar', await st.crop('[data-terrain-desk-bar]', { pad: 8, maxW: 1400 }));
    /* the strike rail: the ladder, then the net — the rail's top 520px (the key, the heads and the rows round the market;
       the whole rail is a column too tall to read) */
    const rail = () => st.crop('[data-profile-panel]', { pad: 6, maxW: 900, h: 520 });
    save('rail-ladder', await rail());
    await tap('[data-profile-view="net"]');
    await page.waitForTimeout(1200);
    await page.mouse.move(1450, 600);
    save('rail-net', await rail());
    await tap('[data-profile-view="ladder"]');
    await page.waitForTimeout(600);
    /* ONE CHART, DOCKED — wide enough for the toolbar to ride the identity row and for the replay card to stand whole
       (a pane of the two-up is 343px of chart; in fullscreen the floating bar lies over the card) */
    await tap('[data-terrain-desk-bar] [aria-label="1 chart"]');
    await page.waitForTimeout(1800);
    await page.mouse.move(1450, 600);
    let pane = await bigPane();
    if (pane) save('strip', await st.region(Math.max(0, pane[0] - 6), Math.max(0, pane[1] - 6), pane[2] + 12, 62, 1400));
    /* replay: the Replay button if the strip shows one, else the P key with the pointer on the chart; then a bar picked a
       third of the way in */
    if (pane) {
      const chartX = pane[0] + pane[2] * 0.3;
      const chartY = pane[1] + pane[3] * 0.5;
      await page.mouse.move(chartX, chartY);
      await page.waitForTimeout(400);
      const replayBtn = frame.locator('main button', { hasText: /^Replay$/ }).first();
      if (await replayBtn.count()) {
        const b = await replayBtn.boundingBox();
        if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      } else {
        await page.mouse.click(chartX, chartY);
        await page.keyboard.press('p');
      }
      await page.waitForTimeout(800);
      await page.mouse.click(chartX, pane[1] + pane[3] * 0.45);
      await frame.locator('[data-replay-strip]').first().waitFor({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1400);
      await page.mouse.move(1450, 600);
      const strip = await box(frame, '[data-replay-strip]');
      if (strip) {
        const y0 = Math.max(pane[1], strip.y - 320);
        save('replay', await st.region(pane[0], y0, pane[2], Math.min(1000 - y0, strip.y + strip.height + 36 - y0), 1400));
      } else console.log('  replay: no strip');
      if (!(await tap('[data-replay-exit]'))) await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }
    /* FULLSCREEN — a wide chart for the tools, the library and the editor. Clicks go by coordinates: the toolbar's doors
       live in a row that shows under the pointer, and Playwright's own click took the canvas beside them for a cover.
       Escape leaves fullscreen on Terrain, so after any Escape the pane is expanded again. */
    const ensureFull = async () => {
      if (await frame.locator('[data-terrain-desk-bar="floating"]').count()) return;
      await tap('[data-expand-door]');
      await page.waitForTimeout(1500);
    };
    await ensureFull();
    pane = await bigPane();
    /* the drawing rail, folded behind its small button at the chart's left edge; a family's list opens from its chevron
       (a right click opens the chart's own menu over it) */
    const railDoor = frame.locator('button[data-chart-rail]').first();
    if (await railDoor.count()) {
      const b = await railDoor.boundingBox();
      if (b) {
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(900);
      }
    }
    const fam = await box(frame, '[data-draw-family]');
    if (fam) {
      await page.mouse.move(fam.x + fam.width / 2, fam.y + fam.height / 2);
      await page.waitForTimeout(400);
      const more = await box(frame, '[data-draw-family-more]');
      if (more) await page.mouse.click(more.x + more.width / 2, more.y + more.height / 2);
      else {
        await page.mouse.down();
        await page.waitForTimeout(650);
        await page.mouse.up();
      }
      await page.waitForTimeout(900);
      const list = await box(frame, '[data-draw-list]');
      const rails = await frame.locator('[data-chart-rail]').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }).filter(r => r[3] > 100));
      const railBox = rails[0] ? { x: rails[0][0], y: rails[0][1], width: rails[0][2], height: rails[0][3] } : null;
      if (list && railBox) {
        const x0 = Math.max(0, Math.min(railBox.x, list.x) - 12);
        const y0 = Math.max(0, Math.min(railBox.y, list.y) - 12);
        /* a breath of the chart to the right of the list, so the picture is wide enough to stand in a column unscaled */
        const x1 = Math.min(1440, Math.max(railBox.x + railBox.width, list.x + list.width) + 150);
        const y1 = Math.min(1000, Math.max(railBox.y + Math.min(railBox.height, 420), list.y + list.height) + 12);
        save('tools-family', await st.region(x0, y0, x1 - x0, y1 - y0, 1000));
      } else console.log('  tools-family: list', !!list, 'rail', !!railBox);
      /* the list closes on a press elsewhere — on the strip, which arms nothing */
      if (pane) await page.mouse.click(pane[0] + pane[2] * 0.5, pane[1] + 12);
      await page.waitForTimeout(500);
    } else console.log('  tools-family: no family button');
    if (await tap('[data-draw-sheet-door]')) {
      await frame.locator('[data-draw-sheet]').first().waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900);
      save('tools-sheet', await st.crop('[data-draw-sheet]', { pad: 10, maxW: 1200 }));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      await ensureFull();
      pane = await bigPane();
    } else console.log('  tools-sheet: no door');
    /* the scripts' library, behind the Indicators door on the strip: the card itself, head to foot */
    if (pane) {
      await page.mouse.move(pane[0] + pane[2] * 0.5, pane[1] + pane[3] * 0.5);
      await page.waitForTimeout(500);
    }
    if (await tap('[data-scripts-door]')) {
      await frame.locator('[data-library]').first().waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const lib = await box(frame, '[data-library]');
      const head = await frame.getByText('Indicators and scripts', { exact: true }).first().boundingBox().catch(() => null);
      const foot = await box(frame, '[data-library-foot]');
      if (lib) {
        const y0 = Math.max(0, (head ? head.y : lib.y) - 22);
        const y1 = Math.min(1000, (foot ? foot.y + foot.height : lib.y + lib.height) + 22);
        save('library', await st.region(Math.max(0, lib.x - 26), y0, Math.min(1440, lib.width + 52), y1 - y0, 1200));
      } else console.log('  library: no card');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      await ensureFull();
    } else console.log('  library: no door');
    /* the editor, docked beside the fullscreen chart: the rail folded away so the chart has the room, the Pine door on
       the floating bar */
    if (await frame.locator('[data-profile-panel]').count()) {
      await tap('[data-terrain-desk-bar] [data-strikes-toggle]');
      await page.waitForTimeout(900);
    }
    if (await tap('[data-terrain-pine]')) {
      await frame.locator('[data-editor-dock]').first().waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1800);
      await page.mouse.move(1450, 600);
      save('editor', await st.whole(1440, 0.84));
    } else console.log('  editor: no Pine door');
    await st.close();
  },
  /* COMPASS (2026-10-03): the board with its rail, the four choices (the strip, the Kind and the Name cards open), the
     board as a table, the setup's page whole, its chart, the card on each of its three tabs, the contracts around it, and
     the Tracker as cards and as a table (the stage's PREPARE tracks three setups first) */
  compass: async (browser, theme, dir) => {
    const save = (k, buf) => {
      if (!buf) return console.log(`  ${k}-${theme}.webp  NOT MADE`);
      writeFileSync(resolve(dir, `${k}-${theme}.webp`), buf);
      console.log(`  ${k}-${theme}.webp  ${Math.round(buf.length / 1024)} KB`);
    };
    const box = async (frame, sel) => frame.locator(sel).first().boundingBox().catch(() => null);
    let ids = [];
    /* THE BOARD */
    {
      const st = await stageOn(browser, '/compass', theme, 1.5, null, 3000);
      await st.frame.locator('[data-compass-card]').first().waitFor({ timeout: 90000 });
      await st.page.waitForTimeout(3500);
      await st.page.mouse.move(1450, 600);
      /* the cards' addresses, the picked one first — the setup's page is taken on the first that is still alive */
      const picked = await st.frame.locator('[data-compass-card][data-selected]').first().getAttribute('data-compass-card').catch(() => null);
      const all = await st.frame.locator('[data-compass-card]').evaluateAll(els => els.map(e => e.getAttribute('data-compass-card')));
      ids = [picked, ...all.filter(x => x && x !== picked)].filter(Boolean);
      save('board', await st.crop('[data-compass-row]', { pad: 10, maxW: 1440, h: 880 }));
      /* the four choices in one line, with the Kind card open under its word, then the Name card — the whole line in the
         picture, so it is wide enough to stand in a column without growing */
      const a = await box(st.frame, '[data-dropdown="compass-expiry"]');
      const z = await box(st.frame, '[data-dropdown="compass-layout"]');
      for (const [k, which] of [['kind-open', 'compass-kind'], ['name-open', 'compass-name']]) {
        await st.frame.locator(`[data-dropdown="${which}"]`).first().click();
        await st.page.waitForTimeout(700);
        const c = await box(st.frame, `[data-dropdown-card="${which}"]`);
        if (a && z && c) {
          const x0 = Math.max(0, Math.min(a.x, c.x) - 16);
          const x1 = Math.min(1440, Math.max(z.x + z.width, c.x + c.width) + 16);
          const y0 = Math.max(0, a.y - 14);
          save(k, await st.region(x0, y0, x1 - x0, Math.min(1000 - y0, c.y + c.height + 18 - y0), 1400));
        } else console.log(`  ${k}: card not found`);
        await st.page.keyboard.press('Escape');
        await st.page.waitForTimeout(500);
      }
      /* the board as a table */
      await pick(st.page, st.frame, 'compass-layout', 'Table');
      await st.page.mouse.move(1450, 600);
      save('table', await st.crop('[data-trace-grid="compass-board"]', { pad: 10, maxW: 1400, h: 600 }));
      await pick(st.page, st.frame, 'compass-layout', 'Cards');
      await st.close();
    }
    /* THE SETUP'S PAGE — of a setup that is still alive: the top pick's floor broke a minute into the stage once, and a
       retired setup draws no targets (the ladder is the picture) */
    let made = false;
    for (const id of ids.slice(0, 6)) {
      const st = await stageOn(browser, `/compass/${id}`, theme, 1.5, seedFor('/compass'), 3000);
      await st.frame.locator('[data-setup-card]').first().waitFor({ timeout: 90000 });
      await st.page.waitForTimeout(3500);
      if (await st.frame.locator('[data-setup-retired]').count()) {
        console.log(`  ${id} is retired — the next card`);
        await st.close();
        continue;
      }
      made = true;
      await st.page.mouse.move(1450, 600);
      save('setup', await st.whole(1440, 0.84));
      save('chart', await st.crop('[data-setup-chart]', { pad: 10, maxW: 1400 }));
      const card = () => st.crop('[data-setup-card]', { pad: 10, maxW: 1200 });
      save('why', await card());
      for (const [k, words] of [['setup-tab', 'Setup'], ['contract-tab', 'Contract']]) {
        await st.frame.locator('[data-setup-card]').getByText(words, { exact: true }).first().click();
        await st.page.waitForTimeout(1000);
        await st.page.mouse.move(1450, 600);
        save(k, await card());
      }
      await st.scrollTo('[data-setup-drivers]', 24);
      await st.page.mouse.move(1450, 600);
      save('drivers', await st.crop('[data-setup-drivers]', { pad: 10, maxW: 1400, h: 520 }));
      await st.close();
      break;
    }
    if (!made) console.log('  no live setup among the first six cards — the setup pictures were not made');
    /* THE TRACKER: three setups tracked by the stage's own hands, then the page as cards and as a table */
    {
      const st = await stageOn(browser, '/compass/tracker', theme, 1.5, seedFor('/compass'), 2000);
      await PREPARE['/compass/tracker'](st.page, theme);
      await st.frame.locator('[data-tracker-read]').first().waitFor({ timeout: 60000 }).catch(() => {});
      await st.page.waitForTimeout(1500);
      await st.page.mouse.move(1450, 600);
      /* the page from its head to the foot of what it shows — never the footer under it */
      const main = await box(st.frame, 'main');
      const footOf = async sel => {
        const bottoms = await st.frame.locator(sel).evaluateAll(els => els.map(e => e.getBoundingClientRect().bottom));
        return bottoms.length ? Math.max(...bottoms) : null;
      };
      const cardsFoot = await footOf('[data-tracker-read]');
      if (main) save('tracker-cards', await st.region(main.x, main.y, main.width, Math.min(700, (cardsFoot ?? main.y + 600) + 80 - main.y), 1400));
      await st.frame.getByRole('button', { name: 'Table', exact: true }).first().click();
      await st.page.waitForTimeout(1200);
      await st.page.mouse.move(1450, 600);
      /* the grid's own box (its role), else the page's foot above the footer — never the footer itself */
      const footer = await box(st.frame, '[data-site-footer]');
      const rowsFoot = (await footOf('[role="grid"]')) ?? (await footOf('[data-trace-grid]')) ?? (footer ? footer.y - 72 : null);
      if (main) save('tracker-table', await st.region(main.x, main.y, main.width, Math.min(700, footer ? footer.y - 36 - main.y : 700, (rowsFoot ?? main.y + 600) + 36 - main.y), 1400));
      await st.close();
    }
  },
  weigher: async (browser, theme, dir) => {
    const out = {};
    const save = (k, buf) => {
      if (!buf) return console.log(`  ${k}-${theme}.webp  NOT MADE`);
      writeFileSync(resolve(dir, `${k}-${theme}.webp`), buf);
      console.log(`  ${k}-${theme}.webp  ${Math.round(buf.length / 1024)} KB`);
    };
    const staged = async (dpr, h = 1000) => {
      const st = await stageOn(browser, '/weigher', theme, dpr, null, 3000, h);
      await st.frame.locator('[data-weigher-desk]').first().waitFor({ timeout: 90000 });
      await st.page.waitForTimeout(4000);
      await PREPARE['/weigher'](st.page, theme, { form: 'desk', w: 1440, h });
      await st.page.mouse.move(1450, 600);
      await st.page.waitForTimeout(500);
      return st;
    };
    /* THE DESK, whole — in a window tall enough for the four cards to stand without a scroll */
    {
      const st = await staged(1, 1260);
      save('desk', await st.crop('[data-weigher-desk]', { pad: 10, maxW: 1440 }));
      await st.close();
    }
    /* the rest on one staged desk at a pixel and a half */
    const st = await staged(1.5);
    const card = () => st.crop('[data-position-card]', { pad: 10, maxW: 1400 });
    /* the position card: by date (as it opens), then by price */
    save('card-date', await card());
    await st.frame.locator('[data-position-card]').getByRole('button', { name: 'By price' }).first().click();
    await st.page.waitForTimeout(1200);
    await st.page.mouse.move(1450, 600);
    save('card-price', await card());
    await st.frame.locator('[data-position-card]').getByRole('button', { name: 'By date' }).first().click();
    await st.page.waitForTimeout(800);
    /* the two lists */
    save('positions', await st.crop('[data-positions-card]', { pad: 10, maxW: 1400 }));
    save('watchlist', await st.crop('[data-watchlist-card]', { pad: 10, maxW: 1400 }));
    /* ADD A POSITION: the form open over the positions card */
    await st.frame.locator('[data-add-position]').first().click();
    await st.page.waitForTimeout(900);
    save('add-position', await st.crop('[data-positions-card]', { pad: 10, maxW: 1400 }));
    await st.page.keyboard.press('Escape');
    await st.page.waitForTimeout(500);
    /* THE CHAIN with a strike open — THE STRONGEST CASE NEAR THE MARKET (Noah, 2026-10-09: "i would like for the dark
       chain to read much stronger case for the page"): the rows in the chain's window opened one at a time — the ones
       over the market first, nearest it first — and the first whose word is strong kept. An open case's own doors are
       read too: a door that says strong (the other strike, the other expiry) is pressed, and the chain opens on it. When
       the window has none, the chain is scrolled a page up, then a page down, and those rows tried; failing all, the
       best word seen is opened again. EVERY STEP IS READ BACK FROM THE GRID — what is open, whether a row stands in the
       window — a click by coordinates on a scrolled, virtualised grid is not a fact until the grid says so (the first
       cut pressed where a row had been and photographed the wrong strike). The + at a row's end is hovered after, for
       the watch picture. */
    const chain = await st.frame.locator('[data-chain-head]').first().boundingBox();
    const inWindow = (y, h) => !!chain && y > chain.y + 60 && y + h < chain.y + chain.height - 10;
    const grid = () => st.frame.locator('[data-chain-grid]').first();
    const view = () => st.frame.locator('[data-chain-grid] .ag-grid-viewport, [data-chain-grid] .ag-body-viewport').first();
    const scrollTop = () => view().evaluate(v => v.scrollTop).catch(() => 0);
    const scrollTo = async top => {
      await view().evaluate((v, t) => (v.scrollTop = t), top).catch(() => {});
      await st.page.waitForTimeout(800);
    };
    /** the id (`s<strike>`) of the row whose dropdown stands open — the row over the drill row — or null */
    const openId = () =>
      grid()
        .evaluate(g => {
          const drill = g.querySelector('[data-chain-drill]')?.closest('.ag-row');
          const idx = Number(drill?.getAttribute('row-index'));
          return (Number.isFinite(idx) && g.querySelector(`.ag-row[row-index="${idx - 1}"]`)?.getAttribute('row-id')) || null;
        })
        .catch(() => null);
    const until = async (test, ms = 2500) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await test()) return true;
        await st.page.waitForTimeout(120);
      }
      return test();
    };
    /* the open strike's row brought under the column header (which stands INSIDE the scroller's box — a row aligned to
       the scroller's top is hidden), its case unfolding under it; the drill row is the one UNDER the strike's */
    const alignOpenRow = () =>
      grid()
        .evaluate(g => {
          const v = g.querySelector('.ag-grid-viewport, .ag-body-viewport');
          const drill = g.querySelector('[data-chain-drill]')?.closest('.ag-row');
          const idx = Number(drill?.getAttribute('row-index'));
          const open = Number.isFinite(idx) ? g.querySelector(`.ag-row[row-index="${idx - 1}"]`) : null;
          const headBottom = g.querySelector('.ag-header')?.getBoundingClientRect().bottom ?? v?.getBoundingClientRect().top ?? 0;
          if (v && open) v.scrollTop += open.getBoundingClientRect().top - headBottom - 2;
        })
        .catch(() => {});
    /* the strike cells in the window, each with ITS ROW'S ID (the cell's own attribute carries no value), in the order
       to try: over the market nearest first, then under it */
    const rowsInView = async () => {
      const all = (await st.frame.locator('[data-chain-strike]').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, e.closest('.ag-row')?.getAttribute('row-id') ?? '']; }))).filter(r => inWindow(r[1], r[3])).sort((a, b) => a[1] - b[1]);
      const divider = await st.frame.locator('[data-chain-divider]').first().boundingBox().catch(() => null);
      const above = divider ? all.filter(r => r[1] + r[3] <= divider.y) : all;
      const below = divider ? all.filter(r => r[1] >= divider.y) : [];
      return [...above].reverse().concat(below);
    };
    const RANK = { strong: 0, good: 1, caution: 2, poor: 3 };
    const cellOf = id => st.frame.locator(`[data-chain-grid] .ag-row[row-id="${id}"] [data-chain-strike]`).first();
    /** a row in the window pressed, and the grid asked whether it opened or shut */
    const pressRow = async (id, want) => {
      const cell = await cellOf(id).boundingBox().catch(() => null);
      if (!cell || !inWindow(cell.y, cell.height)) return false;
      await st.page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
      return until(async () => (want === 'open' ? (await openId()) === id : (await openId()) !== id));
    };
    const wordOf = async () => ((await st.frame.locator('[data-strike-case] [data-strike-word]').first().textContent().catch(() => '')) ?? '').trim().toLowerCase();
    /** whatever is open, shut — brought under the header first when it stands outside the window */
    const shut = async () => {
      const id = await openId();
      if (!id) return true;
      if (await pressRow(id, 'shut')) return true;
      await alignOpenRow();
      await st.page.waitForTimeout(500);
      return pressRow(id, 'shut');
    };
    const home = await scrollTop();
    const tried = new Set();
    let best = null;
    const seen = async id => {
      const word = await wordOf();
      const rank = RANK[word] ?? 9;
      if (!best || rank < best.rank) best = { id, rank, word, at: await scrollTop() };
      return word;
    };
    const scan = async () => {
      for (const r of await rowsInView()) {
        if (tried.has(r[4])) continue;
        tried.add(r[4]);
        if (!(await pressRow(r[4], 'open'))) continue;
        await st.page.waitForTimeout(600);
        if ((await seen(r[4])) === 'strong') return true;
        /* the case's own doors: one that says strong is pressed, and the chain opens on that contract */
        const doors = await st.frame.locator('[data-strike-case] [data-strike-alt]').evaluateAll(els => els.map(e => [e.getAttribute('data-strike-alt'), (e.querySelector('[data-strike-word]')?.textContent ?? '').trim().toLowerCase()])).catch(() => []);
        const strongDoor = doors.find(([, w]) => w === 'strong');
        if (strongDoor) {
          await st.frame.locator(`[data-strike-case] [data-strike-alt="${strongDoor[0]}"]`).first().click().catch(() => {});
          await until(async () => (await openId()) !== r[4], 3000);
          await st.page.waitForTimeout(1200);
          const id = await openId();
          if (id) {
            tried.add(id);
            if ((await seen(id)) === 'strong') return true;
          }
        }
        if (!(await shut())) return false;
        await st.page.waitForTimeout(400);
      }
      return false;
    };
    const leaf = chain ? Math.max(150, Math.round(chain.height - 140)) : 300;
    let found = await scan();
    for (const top of [home - leaf, home + leaf]) {
      if (found) break;
      await scrollTo(Math.max(0, top));
      found = await scan();
    }
    if (best && !found) {
      console.log(`  chain: no strong case near the market — ${best.word} at ${best.id}`);
      await shut();
      await scrollTo(best.at);
      await pressRow(best.id, 'open');
      await st.page.waitForTimeout(600);
    }
    const pickId = await openId();
    if (pickId) {
      await alignOpenRow();
      await st.page.waitForTimeout(900);
      await st.page.mouse.move(1450, 600);
      save('chain', await st.crop('[data-chain-head]', { pad: 10, maxW: 1400 }));
      /* (a picture of the card with its Watch it door was made here until 2026-10-10; the page never asked for it) */
      /* the row pressed shut and the chain back on the market, so the + picture has rows round it (the case filled
         the window, and no + stood in it) */
      if (!(await shut())) console.log('  the strike stayed open for the + picture (row', await openId(), ')');
      await scrollTo(home);
      await st.page.waitForTimeout(300);
    }
    /* FROM THE CHAIN: a + that stands in the chain's window, hovered */
    const pluses = (await st.frame.locator('[data-chain-watch]:not([data-on])').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }))).filter(r => chain && r[1] > chain.y + 60 && r[1] + r[3] < chain.y + chain.height - 10);
    const plus = pluses[Math.min(2, pluses.length - 1)];
    if (plus) {
      await st.page.mouse.move(plus[0] + plus[2] / 2, plus[1] + plus[3] / 2);
      await st.page.waitForTimeout(800);
      save('watch-chain', await st.crop('[data-chain-head]', { pad: 10, maxW: 1400 }));
    } else console.log('  watch-chain: no + in the chain’s window');
    await st.close();
  },
  trace: async (browser, theme, dir) => {
    const out = {};
    const size = { form: 'desk', w: 1440, h: 1000 };
    const ready = async (st, sel = '[data-trace-box]') => {
      await st.frame.locator(sel).first().waitFor({ timeout: 90000 });
      await st.page.waitForTimeout(4000);
    };
    /* THE TAPE, full (the stage lets it run until its box reaches the window's foot), then a print's card over it */
    {
      const st = await stageOn(browser, '/trace/live-tape', theme, 1, null, 3000);
      await ready(st);
      await PREPARE['/trace/live-tape'](st.page, theme, size);
      await st.page.mouse.move(1450, 600);
      out['tape'] = await st.whole(1440);
      /* the tape held, a row pressed: the print's card */
      await st.frame.locator('button[title^="Hold the page"]').first().click();
      await st.page.waitForTimeout(600);
      const rows = st.frame.locator('[data-trace-grid] .ag-row:not(.ag-full-width-row)');
      await rows.nth(3).click();
      await st.frame.locator('[role="dialog"]').first().waitFor({ timeout: 8000 });
      await st.page.waitForTimeout(1800);
      await st.page.mouse.move(1450, 990);
      out['print'] = await st.whole(1440);
      await st.close();
    }
    /* THE DARK POOL: the shelves and the crosses; where the dark money went */
    {
      const st = await stageOn(browser, '/trace/dark-pool', theme, 1.5, null, 3000);
      await ready(st);
      out['dark-pool'] = await st.crop('[data-trace-box="dark-pool"]', { pad: 10, h: 880, maxW: 1800 });
      await st.scrollTo('[data-trace-box="dark-leaders"]', 16);
      out['dark-leaders'] = await st.crop('[data-trace-box="dark-leaders"]', { pad: 10, h: 700, maxW: 1800 });
      await st.close();
    }
    /* the pages that are one box a screen tall, whole or cropped */
    for (const [key, path, sel, h] of [
      ['screener', '/trace/screener', null, null],
      ['net-flow', '/trace/net-flow', null, null],
      ['odte', '/trace/odte', null, null],
      ['compare', '/trace/compare', null, null],
      ['footprints', '/trace/footprints', '[data-trace-box="footprints"]', 820],
      ['watchers', '/trace/watchers', '[data-trace-box="watchers"]', 820],
      ['multi-leg', '/trace/multi-leg', '[data-trace-box="multi-leg"]', 820],
    ]) {
      const st = await stageOn(browser, path, theme, sel ? 1.5 : 1, null, 3000);
      await ready(st);
      out[key] = sel ? await st.crop(sel, { pad: 10, h, maxW: 1800 }) : await st.whole(1440);
      await st.close();
    }
    /* A QUARTER HOUR OF THE DAY: the navigator strip stands over the box — both, from the page's top */
    {
      const st = await stageOn(browser, '/trace/intervals', theme, 1.5, null, 3000);
      await ready(st);
      out['intervals'] = await st.region(66, 82, 1354, 840, 1800);
      await st.close();
    }
    for (const [k, buf] of Object.entries(out)) {
      if (!buf) {
        console.log(`  ${k}-${theme}.webp  NOT MADE`);
        continue;
      }
      writeFileSync(resolve(dir, `${k}-${theme}.webp`), buf);
      console.log(`  ${k}-${theme}.webp  ${Math.round(buf.length / 1024)} KB`);
    }
  },
  pinpoint: async (browser, theme, dir) => {
    const out = {};
    const ready = async st => {
      await st.frame.locator('[data-scope-ticker], [data-board]').first().waitFor({ timeout: 90000 });
      await st.page.waitForTimeout(4000);
    };
    /* THE MAP: the matrix, the same box as the calendar, the trader's clock, how the levels held */
    {
      const st = await stageOn(browser, '/pinpoint/map', theme, 1.5, null, 3000);
      await ready(st);
      out['map-matrix'] = await st.crop('[data-calendar]', { pad: 10, maxW: 1800 });
      await pick(st.page, st.frame, 'ledger-view', 'Calendar');
      await st.page.mouse.move(1450, 600);
      await st.page.waitForTimeout(800);
      out['map-calendar'] = await st.crop('[data-calendar]', { pad: 10, maxW: 1800 });
      await st.scrollTo('[data-day]', 16);
      out['map-clock'] = await st.crop('[data-day]', { pad: 10, maxW: 1800 });
      await st.scrollTo('[data-report]', 16);
      out['map-report'] = await st.crop('[data-report]', { pad: 10, maxW: 1800 });
      await st.close();
    }
    /* BUILDING: what's being built, where the walls are heading */
    {
      const st = await stageOn(browser, '/pinpoint/agenda?view=building', theme, 1.5, null, 3000);
      await ready(st);
      out['building'] = await st.crop('[data-build]', { pad: 10, maxW: 1800 });
      await st.close();
    }
    /* TARGETS: the first three and the list's head; where they sit */
    {
      const st = await stageOn(browser, '/pinpoint/agenda', theme, 1.5, null, 3000);
      await ready(st);
      out['targets'] = await st.crop('[data-targets]', { pad: 10, h: 760, maxW: 1800 });
      await st.close();
    }
    /* THE BOARD, whole */
    {
      const st = await stageOn(browser, '/pinpoint/board', theme, 1, null, 3000);
      await ready(st);
      out['board'] = await st.whole(1440);
      await st.close();
    }
    /* COMPARE: head to head, the two books on one ruler, since the open, the pair */
    {
      const st = await stageOn(browser, '/pinpoint/compare', theme, 1.5, null, 3000);
      await st.frame.locator('[data-compare-ruler]').first().waitFor({ timeout: 90000 });
      await st.page.waitForTimeout(4000);
      out['compare-head'] = await st.underHead('Head to head', 560);
      out['compare-ruler'] = await st.underHead('The two books on one ruler', 700);
      out['compare-open'] = await st.underHead('Since the open', 420);
      out['compare-pair'] = await st.underHead('The pair', 640);
      await st.close();
    }
    for (const [k, buf] of Object.entries(out)) {
      if (!buf) {
        console.log(`  ${k}-${theme}.webp  NOT MADE`);
        continue;
      }
      writeFileSync(resolve(dir, `${k}-${theme}.webp`), buf);
      console.log(`  ${k}-${theme}.webp  ${Math.round(buf.length / 1024)} KB`);
    }
  },
  practice: async (browser, theme, dir) => {
    const out = {};
    const size = { form: 'desk', w: 1440, h: 1000 };
    /* PAPER: the start page as a first visitor finds it; then the desk with two calls bought and bracketed, up close */
    {
      const st = await stageOn(browser, '/practice/paper', theme, 1, null, 6000);
      await st.frame.locator('[data-paper-start]').waitFor({ timeout: 20000 });
      out['paper-start'] = await st.whole(1440);
      await st.close();
    }
    {
      const st = await stageOn(browser, '/practice/paper', theme, 1.5, null, 5000);
      await PREPARE['/practice/paper'](st.page, theme, size);
      /* the strike just above the market's line, as the film picks it: the one gap in the chain's rows */
      const rows = (await st.frame.locator('[data-paper-chain-grid] .ag-row:not(.ag-full-width-row)').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); const v = e.closest('.ag-body-viewport')?.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, v ? r.top >= v.top - 1 && r.bottom <= v.bottom + 1 : true]; }))).filter(r => r[4]).sort((a, b) => a[1] - b[1]);
      let at = 0;
      for (let i = 1; i < rows.length - 1; i++) if (rows[i + 1][1] - rows[i][1] > rows[at + 1][1] - rows[at][1]) at = i;
      if (rows.length > 2) await st.page.mouse.click(rows[at][0] + rows[at][2] * 0.3, rows[at][1] + rows[at][3] / 2);
      await st.page.waitForTimeout(1000);
      await buyTwo(st.page, st.frame, '[data-chain-order="buy"]');
      await st.scrollTo('main', 0).catch(() => {});
      await st.frame.locator('main').evaluate(m => (m.scrollTop = 0));
      await st.page.waitForTimeout(500);
      await pullBrackets(st.page, st.frame);
      await st.page.mouse.move(1450, 600);
      await st.page.waitForTimeout(600);
      out['paper-desk'] = await st.whole(1440);
      /* the order inside the strike's drop-down, and the account card */
      await st.scrollTo('[data-chain-order]', 60).catch(() => {});
      out['paper-order'] = await st.crop('[data-chain-order]', { pad: 12, maxW: 1400 });
      await st.frame.locator('main').evaluate(m => (m.scrollTop = 0));
      await st.page.waitForTimeout(400);
      out['paper-account'] = await st.crop('[data-paper-account]', { pad: 10, maxW: 1200 });
      await st.close();
    }
    /* PAPER, A FUTURE: the ladder beside the chart (the ladder is the reader's own toggle, kept — opened here as a reader
       who uses it would have left it) */
    {
      const st = await stageOn(browser, '/practice/paper', theme, 1, { ...seedFor('/practice/paper'), slayer_paper_ladder: '1' }, 5000);
      await PREPARE['/practice/paper'](st.page, theme, size);
      await st.frame.locator('[data-paper-dom], [data-paper-ladder]').first().waitFor({ timeout: 4000 }).catch(() => {});
      let seen = await st.frame.locator('[data-paper-dom], [data-paper-ladder]').count();
      if (!seen) {
        /* the desk's name picker: a future */
        const picker = st.frame.locator('[data-paper-ticker]').first();
        if (await picker.count()) {
          await picker.click();
          await st.page.waitForTimeout(500);
          await st.frame.locator('[data-paper-ticker-search]').fill('ES');
          await st.page.waitForTimeout(500);
          /* the futures group's first row — ES's front month, whatever the card calls it */
          const es = st.frame.locator('[data-paper-ticker-card] [data-paper-ticker-group="futures"] [role="option"]').first();
          if (await es.count()) {
            await es.click();
            await st.page.waitForTimeout(3000);
          } else await st.page.keyboard.press('Escape');
        }
        seen = await st.frame.locator('[data-paper-dom], [data-paper-ladder]').count();
      }
      if (seen) {
        await st.page.mouse.move(1450, 600);
        out['paper-futures'] = await st.whole(1440);
      } else console.log('  paper-futures: no ladder on screen — the desk did not turn to a future');
      await st.close();
    }
    /* THE BACKTEST: the sessions page; the desk on a played day with a bracketed position; the report */
    {
      const st = await stageOn(browser, '/practice/backtest', theme, 1, null, 6000);
      out['backtest-sessions'] = await st.whole(1440);
      await PREPARE['/practice/backtest'](st.page, theme, size);
      await st.frame.locator('[data-chain-row]').nth(4).click();
      await st.page.waitForTimeout(900);
      await buyTwo(st.page, st.frame, '[data-chain-order="buy"]');
      await st.frame.locator('main').evaluate(m => (m.scrollTop = 0));
      await st.page.waitForTimeout(400);
      await pullBrackets(st.page, st.frame);
      await st.page.mouse.move(1450, 600);
      await st.page.waitForTimeout(600);
      out['backtest-desk'] = await st.whole(1440);
      await st.close();
    }
    {
      const st = await stageOn(browser, '/practice/backtest', theme, 2, null, 6000);
      await PREPARE['/practice/backtest'](st.page, theme, size);
      out['backtest-replay'] = await st.crop('[data-replay-strip]', { pad: 14, maxW: 1400 });
      /* the report: the session's door in its head */
      const door = st.frame.locator('button, a').filter({ hasText: /The report/i }).first();
      if (await door.count()) {
        await door.click();
        await st.page.waitForTimeout(3000);
        await st.page.mouse.move(1450, 600);
        out['backtest-report'] = await st.whole(1440);
      }
      await st.close();
    }
    /* FUTURES, in the backtest: the contract card and the order card with its brackets */
    {
      const st = await stageOn(browser, '/practice/futures', theme, 1, null, 6000);
      await PREPARE['/practice/futures'](st.page, theme, size);
      await buyTwo(st.page, st.frame, '[data-review-ticket]');
      await pullBrackets(st.page, st.frame);
      await st.page.mouse.move(1450, 600);
      await st.page.waitForTimeout(600);
      out['backtest-futures'] = await st.whole(1440);
      await st.close();
    }
    /* THE JOURNAL: the month with its figures and a day under it; a trade's own page */
    {
      const st = await stageOn(browser, '/practice/journal', theme, 1, null, 6000);
      await PREPARE['/practice/journal'](st.page, theme, size);
      out['journal-month'] = await st.whole(1440);
      await st.scrollTo('[data-journal-day-region]', 70).catch(() => {});
      await st.page.waitForTimeout(500);
      out['journal-day'] = await st.whole(1440);
      await st.close();
    }
    /* A TRADE'S OWN PAGE — from the backtest's book, not the sample's: the sample's trades keep no words (they are not
       the reader's), so a page photographed on one says "nothing kept yet" over three answered boxes. A backtest session
       is run as the stage runs it (two closed trades), the journal is walked to on its own rail, turned to the backtest's
       book, and the first trade of its day opened; its three questions are answered as a reader would. */
    {
      const st = await stageOn(browser, '/practice/backtest', theme, 1, null, 6000);
      await PREPARE['/practice/backtest'](st.page, theme, size);
      await st.frame.locator('a[href="/practice/journal"]').first().click();
      await st.page.waitForTimeout(2500);
      await st.frame.locator('[data-journal-home] [role="tab"], [data-journal-home] button').filter({ hasText: /^Backtest$/ }).first().click().catch(() => {});
      await st.page.waitForTimeout(1500);
      const day = st.frame.locator('[data-journal-day]:not([data-trades="0"])').first();
      if (await day.count()) {
        await day.click();
        await st.page.waitForTimeout(1200);
      }
      await st.scrollTo('[data-journal-day-region]', 70).catch(() => {});
      const row = st.frame.locator('[data-journal-day-trades] .ag-row, [data-journal-trades] .ag-row').first();
      await row.click();
      await st.page.waitForTimeout(3500);
      const answers = {
        why: 'SPY held the put wall at 553 twice on the open and the book was leaning long. Bought the 555 calls on the second hold, a day out, with the stop under the wall.',
        saw: 'It went my way for twenty minutes, then the flip gave and I watched it come back through my entry before I did anything about it.',
        again: 'Take the first target at the call wall when the tape slows. Waiting for the second one with no plan is what cost me the whole move.',
      };
      for (const [key, words] of Object.entries(answers)) {
        const box = st.frame.locator(`[data-journal-answer="${key}"]`).first();
        if (await box.count()) {
          await box.fill(words);
          await st.page.waitForTimeout(250);
        }
      }
      await st.page.keyboard.press('Tab');
      await st.page.waitForTimeout(2500);
      await st.frame.locator('main').evaluate(m => (m.scrollTop = 0));
      await st.page.mouse.move(1450, 600);
      await st.page.waitForTimeout(500);
      out['journal-trade'] = await st.whole(1440);
      await st.scrollTo('[data-journal-shape]', 24).catch(() => {});
      await st.page.waitForTimeout(500);
      out['journal-shape'] = await st.crop('[data-journal-shape]', { pad: 10, maxW: 1600 });
      await st.scrollTo('[data-journal-tags]', 24).catch(() => {});
      await st.page.waitForTimeout(500);
      const tg = await st.frame.locator('[data-journal-tags]').first().boundingBox();
      const wd = await st.frame.locator('[data-journal-words]').first().boundingBox();
      if (tg && wd) out['journal-words'] = await st.crop('[data-journal-tags]', { pad: 10, h: Math.min(1000 - tg.y - 20, wd.y + wd.height - tg.y), maxW: 1600 });
      await st.close();
    }
    for (const [k, buf] of Object.entries(out)) {
      if (!buf) {
        console.log(`  ${k}-${theme}.webp  NOT MADE`);
        continue;
      }
      writeFileSync(resolve(dir, `${k}-${theme}.webp`), buf);
      console.log(`  ${k}-${theme}.webp  ${Math.round(buf.length / 1024)} KB`);
    }
  },
  dossier: async (browser, theme, dir) => {
    const out = {};
    /* THE WIRE: the story in hand beside the map; the headlines with their marks; the calendar and the four reads */
    {
      const st = await stageOn(browser, '/dossier/news', theme, 2, null, 7000);
      out['story'] = await st.crop('[data-news-story]', { pad: 8, maxW: 1200 });
      await st.scrollTo('[data-news-rows]', 150);
      /* the rows' head carries the legend (high · medium · low); the rows under it */
      const rows = await st.frame.locator('[data-news-rows]').first().boundingBox();
      if (rows) out['headlines'] = await st.crop('[data-news-rows]', { pad: 10, h: Math.min(rows.height, 420) });
      await st.scrollTo('[data-news-calendar]', 60);
      const cal = await st.frame.locator('[data-news-calendar]').first().boundingBox();
      const reads = await st.frame.locator('[data-news-reads]').first().boundingBox();
      if (cal) out['calendar'] = await st.crop('[data-news-calendar]', { pad: 10, more: reads ? reads.y + reads.height - (cal.y + cal.height) : 0 });
      await st.close();
    }
    /* EARNINGS: the week, and a name's last eight prints */
    {
      const st = await stageOn(browser, '/dossier/earnings', theme, 1, null, 7000);
      out['earnings-week'] = await st.whole(1440);
      await st.frame.locator('[data-earnings-card]').first().click();
      await st.page.waitForTimeout(3500);
      await st.close();
    }
    {
      const st = await stageOn(browser, '/dossier/earnings', theme, 2, null, 7000);
      await st.frame.locator('[data-earnings-card]').first().click();
      await st.page.waitForTimeout(3500);
      await st.scrollTo('[data-earnings-box="replay"]', 16);
      const a = await st.frame.locator('[data-earnings-box="replay"]').first().boundingBox();
      const b = await st.frame.locator('[data-earnings-box="moves"]').first().boundingBox();
      if (a && b) out['earnings-name'] = await st.crop('[data-earnings-box="replay"]', { pad: 10, h: b.y + b.height - a.y });
      await st.close();
    }
    /* STOCKS: how every name screens, and four sections of one name's full analysis */
    {
      const st = await stageOn(browser, '/dossier/stocks', theme, 1, null, 7000);
      out['stocks'] = await st.whole(1440);
      await st.close();
    }
    {
      const st = await stageOn(browser, '/dossier/stocks/NVDA', theme, 2, null, 8000);
      await st.scrollTo('#stock-name', 16);
      out['stock-name'] = await st.crop('#stock-name', { pad: 8 });
      await st.scrollTo('#stock-why', 16);
      out['stock-why'] = await st.crop('#stock-why', { pad: 8 });
      await st.scrollTo('#stock-trend', 16);
      const t = await st.frame.locator('#stock-trend').first().boundingBox();
      const m = await st.frame.locator('#stock-money').first().boundingBox();
      if (t && m) {
        const x = Math.min(t.x, m.x) - 8;
        const clip = { x, y: Math.min(t.y, m.y) - 8, width: Math.max(t.x + t.width, m.x + m.width) + 8 - x, height: Math.min(1000 - (Math.min(t.y, m.y) - 8), Math.max(t.height, m.height) + 16) };
        out['stock-trend-money'] = await webp(st.page, await st.page.screenshot({ type: 'png', clip }), 1800, 0.86);
      }
      await st.scrollTo('#stock-score', 16);
      const sc = await st.frame.locator('#stock-score').first().boundingBox();
      if (sc) out['stock-behind'] = await st.crop('#stock-score', { pad: 8, h: Math.min(sc.height, 940) });
      await st.close();
    }
    /* INSIDERS and CONGRESS: the pages, whole */
    for (const [key, path] of [['insiders', '/dossier/insiders'], ['congress', '/dossier/congress']]) {
      const st = await stageOn(browser, path, theme, 1, null, 7000);
      out[key] = await st.whole(1440);
      await st.close();
    }
    for (const [k, buf] of Object.entries(out)) {
      if (!buf) {
        console.log(`  ${k}-${theme}.webp  NOT MADE`);
        continue;
      }
      writeFileSync(resolve(dir, `${k}-${theme}.webp`), buf);
      console.log(`  ${k}-${theme}.webp  ${Math.round(buf.length / 1024)} KB`);
    }
  },
  pulse: async (browser, theme, dir) => {
    const out = {};
    /* the desk on The open, photographed at two pixels a point: the tiles close up, and the list of tiles open */
    {
      const stage = await openStage(browser, { base: BASE, w: 1440, h: 1000, dpr: 2, path: '/pulse', theme, seed: seedFor('/pulse'), at: AT, form: 'desk' });
      const { page, frame } = stage;
      await frame.locator('[data-tile="levels"]').waitFor({ timeout: 60000 });
      await page.waitForTimeout(5000);
      await page.mouse.move(1450, 600);
      /* two tiles of the foot — Key levels and News — with the edge of the chart and the book above them */
      const a = await frame.locator('[data-tile="levels"]').boundingBox();
      const b = await frame.locator('[data-tile="news"]').boundingBox();
      if (a && b) {
        const clip = { x: a.x - 10, y: a.y - 10, width: b.x + b.width - a.x + 20, height: a.height + 20 };
        out['tiles'] = await webp(page, await page.screenshot({ type: 'png', clip }), 1800);
      }
      /* the list of tiles, open under its button */
      await frame.getByRole('button', { name: /Add widget/ }).click();
      await page.waitForTimeout(900);
      const pk = await frame.locator('[data-picker]').boundingBox();
      const bar = await frame.locator('[data-desk-bar]').boundingBox();
      if (pk && bar) {
        const x = Math.max(0, pk.x - 24);
        const clip = { x, y: bar.y - 6, width: Math.min(1440 - x, pk.x + pk.width + 24 - x), height: pk.y + pk.height + 16 - (bar.y - 6) };
        out['picker'] = await webp(page, await page.screenshot({ type: 'png', clip }), 1200);
      }
      await stage.ctx.close();
    }
    /* the five house desks, whole, small */
    for (const name of ['The session', 'The open', '0DTE', 'The close', 'My book']) {
      const seed = { ...seedFor('/pulse'), slayer_desk_prefs: ON_QQQ, slayer_desks_v2: JSON.stringify({ active: name, desks: {} }) };
      const stage = await openStage(browser, { base: BASE, w: 1440, h: 1000, dpr: 1, path: '/pulse', theme, seed, at: AT, form: 'desk' });
      await stage.page.waitForTimeout(7000);
      await stage.page.mouse.move(1450, 600);
      await stage.page.waitForTimeout(400);
      out[`desk-${name.toLowerCase().replace(/\s+/g, '-')}`] = await webp(stage.page, await stage.page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1440, height: 1000 } }), 960, 0.82);
      await stage.ctx.close();
    }
    for (const [k, buf] of Object.entries(out)) {
      writeFileSync(resolve(dir, `${k}-${theme}.webp`), buf);
      console.log(`  ${k}-${theme}.webp  ${Math.round(buf.length / 1024)} KB`);
    }
  },
};

const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, shoot] of Object.entries(PRODUCTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const dir = resolve(OUT, name);
  mkdirSync(dir, { recursive: true });
  for (const theme of THEMES) {
    console.log(`${name} · ${theme}`);
    await shoot(browser, theme, dir);
  }
}
await browser.close();
