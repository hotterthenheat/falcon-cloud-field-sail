/*
  THE LANDING'S FILMS (2026-10-01) — `npm run landing:clips`, with the dev server up.

  Noah, of his partner's landing: "he has actual recordings of the page working which is exactly what we were missing …
  we will not be taking his actual recording but making our own because we have smoother animations when switching
  pages" — and then: "replace the big window with the wall, recordings in the tour too". So every page the tour names is
  FILMED from the real terminal: staged as a reader's own (scripts/landing-stage.mjs), and then used by a pointer for a
  dozen seconds — a menu opened and a choice made, a row hovered for its card, a day pressed, a desk switched. Nothing is
  laid over the film but the pointer.

  HOW a frame is taken, and why the films keep our animations smooth, is in scripts/landing-film.mjs.

  ONE MOMENT FOR EVERY FILM. The page's clock is set to the same minute of an open market (AT), so every film is of
  an open session and its live mark is lit. The feed keeps moving under the pointer. (The simulated prices are drawn
  afresh on each visit, so two films do not show the same quote for a name.)

  A FILM LOOPS: whatever an act changes it changes back before it ends, and the pointer goes home and fades, so the
  last frame is the page as the first frame had it (the feed has moved on a few seconds; nothing else has).

  WHAT IT WRITES, for each page, theme and size —
      public/landing/clips/<page>-<theme>-<desk|phone>.mp4     the film
      public/landing/<page>-<theme>-<desk|phone>.webp          its first frame: the still the landing shows until the
                                                               film can play, and all it shows a visitor who asked for
                                                               less motion
      src/pages/landing/films.json                             each film's length, in seconds
  and for the eight rooms on the landing's first screen (the wall), from the desk film —
      public/landing/wall/<page>-<theme>.mp4                   a small copy, 640 wide
      public/landing/wall/<page>-<theme>.webp                  its first frame

  After the address: pages ("/terrain"), a size ("desk" | "phone"), a theme ("dark" | "light"); `stills` takes only the
  first frames. PREVIEW=1 films small and quick into the system's temp folder and touches nothing in public/ or src/.
  In Git Bash put MSYS_NO_PATHCONV=1 in front, or a page's leading slash is rewritten into a Windows path.
*/
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ALL_PAGES, seedFor, PREPARE, slug } from './landing-stage.mjs';
import { FPS, Film, homeOf, openEncoder, openStage } from './landing-film.mjs';
import { ACTS, EXTRA, phoneAct, readAct } from './landing-acts.mjs';

/** the page's scroller */
const SCROLLER = 'main';

const BASE = process.argv[2] ?? 'http://localhost:5199';
const ARGS = process.argv.slice(3);
const ONLY = ARGS.filter(a => a.startsWith('/'));
/* `@pulse-arrange`: a product page's own film (landing-acts.mjs EXTRA) — filmed on its page, named by its key, desk only */
const EXTRAS = ARGS.filter(a => a.startsWith('@')).map(a => a.slice(1));
for (const k of EXTRAS) if (!EXTRA[k]) throw new Error(`no such film: @${k} (landing-acts.mjs EXTRA has ${Object.keys(EXTRA).join(', ')})`);
const FORMS = ARGS.filter(a => a === 'desk' || a === 'phone');
const ONLY_THEMES = ARGS.filter(a => a === 'dark' || a === 'light');
const STILLS = ARGS.includes('stills');
const PREVIEW = !!process.env.PREVIEW;
const PUBLIC = PREVIEW ? resolve(tmpdir(), 'slayer-film-preview') : resolve(process.cwd(), 'public/landing');
const MANIFEST = PREVIEW ? resolve(PUBLIC, 'films.json') : resolve(process.cwd(), 'src/pages/landing/films.json');
mkdirSync(resolve(PUBLIC, 'clips'), { recursive: true });
mkdirSync(resolve(PUBLIC, 'wall'), { recursive: true });

/* what is filmed: the tour's pages (by path), or the extras asked for by name — each a page and the act to run on it */
const PAGES = EXTRAS.length ? EXTRAS.map(k => ({ path: EXTRA[k].path, key: k, act: EXTRA[k].act, extra: true })) : ALL_PAGES.filter(p => !ONLY.length || ONLY.includes(p)).map(p => ({ path: p, key: slug(p), act: ACTS[p] ?? readAct, extra: false }));
const THEMES = ['dark', 'light'].filter(t => !ONLY_THEMES.length || ONLY_THEMES.includes(t));
/* A DESK at a pixel and a quarter a point: 1800 across, twice what the tour's window is wide on most screens. A PHONE is
   photographed at three (its still stays as sharp as an iPhone draws it) and its film kept at two. `qp` is the film's
   quality — lower is finer and heavier. */
const SIZES = [
  { form: 'desk', w: 1440, h: 1000, dpr: PREVIEW ? 0.5 : 1.25, film: PREVIEW ? [720, 500] : [1800, 1250], qp: 32 },
  { form: 'phone', w: 390, h: 760, dpr: PREVIEW ? 1 : 3, film: PREVIEW ? [390, 760] : [780, 1520], qp: 30 },
].filter(z => !FORMS.length || FORMS.includes(z.form));
/* A WIDER DESK FOR THE WEIGHER (Noah, 2026-10-07, of its recording: "the live chart does not match the live chart we
   have. the timeframes and top section is 2 rows unlike ours"): its chart shares the desk with the chain, and on a
   1440 desk the chart's strip has no room for its toolbar beside the name, so the toolbar takes a second row — as it
   does on any 1440 screen. On his screen the chart is wider and the strip is one row. The film is shot on a 1920 desk
   (the same shape, the pixel ratio lowered so the film stays 1800 across) where the strip is one row, as he sees it. */
const WIDE_DESK = { '/weigher': { w: 1920, h: 1333, dpr: PREVIEW ? 0.375 : 1800 / 1920 } };
/** the wall's screens: a small copy of each room's desk film */
const WALL = [640, 444];
/** the rooms on the landing's first screen — the tour's eight tools, by the page each opens on */
const ROOM_PAGES = ['/pulse', '/compass', '/terrain', '/pinpoint/map', '/trace/live-tape', '/weigher', '/dossier/news', '/practice/paper'];
/** How much faster than life a film runs. At one and a half a 320ms swap is still six frames — the animations read as
    they do in the terminal — and a dozen seconds of film holds a little over a quarter minute of use. */
const SPEED = 1.5;
/** the minute every film is set in: a Wednesday afternoon, the market open (14:10 in New York) */
const AT = '2026-09-30T18:10:00Z';
/** the page's time that passes, held, before the first frame — what the staging left moving comes to rest */
const PREROLL = 1200;

/* ---- THE FILMING ---------------------------------------------------------------------------------------------------- */

/* the list of films is read again each time one is added: two runs may be filming at once, each on its own pages */
const list = (key, seconds) => {
  const all = { ...(existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}), [key]: seconds };
  writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
};
const browser = await chromium.launch({ channel: 'chrome' });
const encoder = await openEncoder(browser, BASE);
let made = 0;
let bytes = 0;
for (const form of SIZES) {
  for (const theme of THEMES) {
    for (const { path, key: name, act, extra } of PAGES) {
      if (extra && form.form !== 'desk') continue;
      /* the page's own desk, where one is wider than the others' (WIDE_DESK) */
      const size = form.form === 'desk' && !extra && WIDE_DESK[path] ? { ...form, ...WIDE_DESK[path] } : form;
      const key = `${name}-${theme}-${size.form}`;
      const t0 = Date.now();
      /* a fresh visitor every time: nothing one page did is left for the next */
      const stage = await openStage(browser, { base: BASE, w: size.w, h: size.h, dpr: size.dpr, path, theme, seed: seedFor(extra ? `@${name}` : path), at: AT, form: size.form });
      try {
        await stage.page.waitForTimeout(size.form === 'desk' ? 6500 : 5500);
        await PREPARE[path]?.(stage.page, theme, size);
        /* the page at rest: its head on screen, the pointer off it */
        await stage.frame.locator(SCROLLER).first().evaluate(m => (m.scrollTop = 0)).catch(() => {});
        await stage.page.mouse.move(...homeOf(size));
        await stage.page.waitForTimeout(700);

        const wall = size.form === 'desk' && ROOM_PAGES.includes(path) && !STILLS && !extra;
        const sinks = [{ id: key }, ...(wall ? [{ id: `wall-${key}` }] : [])];
        const resized = size.film[0] !== Math.round(size.w * size.dpr);
        await encoder.open(key, { w: size.film[0], h: size.film[1], qp: size.qp, resize: resized });
        if (wall) await encoder.open(`wall-${key}`, { w: WALL[0], h: WALL[1], qp: 30, resize: true, smallStill: true });

        const film = new Film({ stage, size, speed: SPEED, encoder, sinks, tag: key });
        await film.hold();
        for (let ms = 0; ms < PREROLL; ms += film.step) await film.tick();
        if (STILLS) await film.shoot();
        else await (size.form === 'phone' ? phoneAct : act)(film);

        const main = await encoder.close(key);
        const seconds = +(main.frames / FPS).toFixed(2);
        writeFileSync(resolve(PUBLIC, `${key}.webp`), film.stills[key]);
        bytes += film.stills[key].length;
        if (!STILLS) {
          writeFileSync(resolve(PUBLIC, 'clips', `${key}.mp4`), main.mp4);
          list(key, seconds);
          bytes += main.mp4.length;
        }
        if (wall) {
          const small = await encoder.close(`wall-${key}`);
          const wallName = `${slug(path)}-${theme}`;
          writeFileSync(resolve(PUBLIC, 'wall', `${wallName}.mp4`), small.mp4);
          writeFileSync(resolve(PUBLIC, 'wall', `${wallName}.webp`), film.stills[`wall-${key}`]);
          bytes += small.mp4.length + film.stills[`wall-${key}`].length;
        }
        made++;
        console.log(`${key}  ${STILLS ? 'still' : `${seconds}s  ${Math.round(main.mp4.length / 1024)} KB`}  (${Math.round((Date.now() - t0) / 1000)}s to make)${film.skipped.length ? `  — skipped: ${film.skipped.join('; ')}` : ''}`);
      } catch (e) {
        console.log(`${key}  NOT MADE: ${String(e).split('\n')[0]}`);
      }
      await stage.ctx.close();
    }
  }
}
await encoder.dispose();
await browser.close();
console.log(`\n${made} ${STILLS ? 'stills' : 'films'} · ${(bytes / 1024 / 1024).toFixed(1)} MB in ${PUBLIC}`);
