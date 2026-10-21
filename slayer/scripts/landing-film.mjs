/*
  THE LANDING'S CAMERA (2026-10-01) — how a page of the terminal is filmed. scripts/make-landing-clips.mjs holds the
  acts (what the pointer does on each page); this is the camera and the hand.

  Noah, of his partner's landing: "he has actual recordings of the page working which is exactly what we were missing …
  we will not be taking his actual recording but making our own because we have smoother animations when switching
  pages". So the films are of OUR terminal, and the thing they must keep is the way it moves.

  A FILM IS STEPPED, NOT WATCHED. Recording a screen in real time gives a frame whenever the machine has one to spare,
  and every fade comes out uneven. Here the page's own time is held still and moved one frame at a time:

      the clock        Playwright's clock holds Date, the timers and the animation frames of the terminal (its frame
                       too) and is run forward STEP milliseconds a frame — so a chart's glide, a count, a framer-motion
                       spring are all drawn exactly where they are at that instant
      CSS's own time   transitions and keyframes do not listen to that clock (the browser runs them itself), so every
                       animation the page has is paused the moment it appears and its time is set by hand, the same
                       STEP a frame; one that reaches its end is finished, so the page hears `transitionend` as it
                       would (a menu that waits for its exit to unmount still unmounts)
      the picture      taken after the page has drawn that instant, at the film's own pixel size

  So a 320ms swap is the same nine frames every time, however long a frame takes to photograph — that is what keeps
  our animations smooth on film.

  THE HAND. A pointer is drawn over the terminal (the real one is not in a screenshot): an arrow on a desk, a
  fingertip on a phone. It glides on an eased curve, presses, drags, types and scrolls, and the real mouse goes with
  it, so the page answers exactly as it does to a reader — hover cards, crosshairs, menus. It fades in when it starts
  and out when it has gone home, so a film's first and last frames have no pointer in them.

  THE FILM is H.264 in an MP4, which every browser and phone plays. Chrome encodes it itself (WebCodecs) and
  `mp4-muxer` wraps it — no ffmpeg to install. The encoder lives on a page of its own in a second browser context, whose
  clock is left alone.
*/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const FPS = 30;
/** the strip beside the terminal where the pointer rests, out of the picture */
const MARGIN = 24;
/** where the pointer rests: off the terminal's right edge */
export const homeOf = size => [size.w + MARGIN / 2, size.h * 0.62];

/* ---- THE ENCODER ---------------------------------------------------------------------------------------------------- */

/** A page that turns PNG frames into MP4s. `open(id, { w, h, qp })`, `frame(id, pngBase64)`, `close(id)` → the film. */
export const openEncoder = async (browser, base) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', m => m.type() === 'error' && console.log('  [encoder]', m.text().slice(0, 200)));
  await page.route(`${base}/__film-encoder`, r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(`${base}/__film-encoder`);
  await page.addScriptTag({ content: readFileSync(resolve(process.cwd(), 'node_modules/mp4-muxer/build/mp4-muxer.js'), 'utf8') });
  await page.evaluate(fps => {
    const films = new Map();
    const b64 = buf => {
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    };
    /* the profile's level by the picture's size: 3.1 to 720p, 4.0 to 1080p-sized, 5.0 above */
    const codecFor = (w, h) => (w * h <= 921600 ? 'avc1.64001f' : w * h <= 2088960 ? 'avc1.640028' : 'avc1.640032');
    window.film = {
      async open(id, o) {
        const target = new Mp4Muxer.ArrayBufferTarget();
        const muxer = new Mp4Muxer.Muxer({ target, video: { codec: 'avc', width: o.w, height: o.h, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
        const f = { ...o, target, muxer, n: 0, failed: null };
        f.encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => (f.failed = String(e)) });
        const base = { codec: codecFor(o.w, o.h), width: o.w, height: o.h, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
        /* A CONSTANT QUALITY where the machine's encoder offers one (a still stretch of a film then costs nearly nothing);
           else a bitrate, by the software encoder */
        const byQuality = { ...base, bitrateMode: 'quantizer', hardwareAcceleration: 'no-preference' };
        if ((await VideoEncoder.isConfigSupported(byQuality)).supported) {
          f.encoder.configure(byQuality);
          f.mode = 'quality';
        } else {
          f.encoder.configure({ ...base, bitrateMode: 'variable', bitrate: Math.round(o.w * o.h * 0.9), hardwareAcceleration: 'prefer-software' });
          f.mode = 'bitrate';
        }
        films.set(id, f);
        return f.mode;
      },
      /** one frame; with `webp`, also answers this frame as a WebP (the film's still) */
      async frame(id, png, webp) {
        const f = films.get(id);
        const blob = await (await fetch('data:image/png;base64,' + png)).blob();
        const bmp = await createImageBitmap(blob, f.resize ? { resizeWidth: f.w, resizeHeight: f.h, resizeQuality: 'high' } : undefined);
        const vf = new VideoFrame(bmp, { timestamp: Math.round((f.n * 1e6) / fps), duration: Math.round(1e6 / fps) });
        /* a key frame every five seconds: a film is short and loops from its start, and each key frame is a whole picture */
        const opts = { keyFrame: f.n % (fps * 5) === 0 };
        if (f.mode === 'quality') opts.avc = { quantizer: f.qp };
        f.encoder.encode(vf, opts);
        vf.close();
        let still = null;
        if (webp) {
          /* the still is the picture AS TAKEN, at its full size — a phone's is photographed finer than its film is kept;
             a copy that is made small on purpose (the wall's) is the small one */
          const full = f.resize && !f.smallStill ? await createImageBitmap(blob) : bmp;
          const c = new OffscreenCanvas(full.width, full.height);
          c.getContext('2d').drawImage(full, 0, 0);
          if (full !== bmp) full.close();
          still = b64(new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: 0.8 })).arrayBuffer()));
        }
        bmp.close();
        f.n++;
        if (f.failed) throw new Error(f.failed);
        return still;
      },
      async close(id) {
        const f = films.get(id);
        await f.encoder.flush();
        f.muxer.finalize();
        f.encoder.close();
        films.delete(id);
        return { mp4: b64(new Uint8Array(f.target.buffer)), frames: f.n };
      },
    };
  }, FPS);
  return {
    open: (id, o) => page.evaluate(([id, o]) => window.film.open(id, o), [id, o]),
    frame: (id, png, webp = false) => page.evaluate(([id, png, webp]) => window.film.frame(id, png, webp), [id, png, webp]),
    close: async id => {
      const r = await page.evaluate(id => window.film.close(id), id);
      return { mp4: Buffer.from(r.mp4, 'base64'), frames: r.frames };
    },
    dispose: () => ctx.close(),
  };
};

/* ---- THE STAGE ------------------------------------------------------------------------------------------------------ */

const ARROW = `<svg viewBox="0 0 24 24" width="22" height="22" style="display:block;filter:drop-shadow(0 1px 1.5px rgb(0 0 0 / .45))"><path d="M5.2 2.6 19 11.2l-6.3 1.4 3.7 6.9-2.7 1.4-3.6-7-4.9 4.3z" fill="#fff" stroke="#0b0b0b" stroke-width="1.35" stroke-linejoin="round"/></svg>`;
const FINGER = `<div style="width:30px;height:30px;border-radius:50%;background:rgb(150 160 180 / .34);border:1.5px solid rgb(255 255 255 / .7);box-shadow:0 0 0 1px rgb(0 0 0 / .35)"></div>`;

/** THE TERMINAL IN A WINDOW (src/embed.ts): a frame, asked for with ?embed — exactly how the landing used to hold it —
    under a host page served from the same origin (in a frame under a blank page the browser denies the terminal its
    storage). The context's clock is installed at `at` BEFORE the page loads, and runs until the film holds it. */
export const openStage = async (browser, { base, w, h, dpr, path, theme, seed, at, form }) => {
  /* the window is a little wider than the terminal: the pointer rests in that margin, OUTSIDE the terminal's frame, so
     nothing in the page is under it when a film begins and ends (a pointer parked on the page lit whatever it sat on) */
  const ctx = await browser.newContext({ viewport: { width: w + MARGIN, height: h }, deviceScaleFactor: dpr });
  await ctx.clock.install({ time: new Date(at) });
  await ctx.addInitScript(seed => {
    try {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  const page = await ctx.newPage();
  const hot = form === 'phone' ? [15, 15] : [4.8, 2.4];
  await page.route(`${base}/__shot-host`, r =>
    r.fulfill({
      contentType: 'text/html',
      /* `photo=1` (embed.ts PHOTO): the photographer's window — the paper desk may start a throwaway account for its picture */
      body: `<html><body style="margin:0;background:#000;overflow:hidden"><iframe id="t" src="${path}?embed=1&photo=1&theme=${theme}" style="border:0;display:block;width:${w}px;height:${h}px"></iframe><div id="hand" data-hot="${hot.join(',')}" style="position:fixed;left:0;top:0;z-index:9;pointer-events:none;opacity:0;transform-origin:${hot[0]}px ${hot[1]}px">${form === 'phone' ? FINGER : ARROW}</div></body></html>`,
    })
  );
  await page.goto(`${base}/__shot-host`);
  return { ctx, page, frame: page.frameLocator('#t'), hot };
};

/* ---- THE FILM ------------------------------------------------------------------------------------------------------- */

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Film {
  /** `sinks`: the films this take feeds — [{ id, still?: true }] opened on the encoder already */
  constructor({ stage, size, speed, encoder, sinks, tag = 'film' }) {
    Object.assign(this, { page: stage.page, frame: stage.frame, hot: stage.hot, size, encoder, sinks, tag });
    if (process.env.FRAMES) mkdirSync(resolve(process.env.FRAMES, tag), { recursive: true });
    /** how much of the page's time one frame is, in ms */
    this.step = (1000 / FPS) * speed;
    [this.x, this.y] = homeOf(size);
    this.alpha = 0;
    this.down = false;
    this.frames = 0;
    this.stills = {};
    this.app = null;
    this.skipped = [];
    /** what an act remembers between its steps */
    this.memo = {};
  }

  /** The terminal's own frame (for running code inside it) */
  doc() {
    return (this.app ??= this.page.frames().find(f => f !== this.page.mainFrame()));
  }

  /** HOLD THE PAGE'S TIME. From here nothing in the terminal moves unless a frame is taken. */
  async hold() {
    const now = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(new Date(now + 60));
    await this.doc().evaluate(() => {
      const mine = new WeakMap();
      const done = new WeakSet();
      /* every animation the page has, moved `ms` on by hand; one first seen now starts from its beginning.
         ONE THAT HAS RUN TO ITS END IS LEFT THERE: an animation that holds its last frame (fill: forwards / both — the
         modal's card) is still on the page's list after it ends, and taken for a new one it was begun again on every
         frame after — the card blinked in and out for as long as it stood (2026-10-02, the tape's print card). */
      window.__filmStep = ms => {
        for (const a of document.getAnimations()) {
          if (done.has(a)) continue;
          let t = mine.get(a);
          if (t === undefined) {
            if (a.playState === 'paused') continue; /* the page itself holds this one */
            a.pause();
            t = 0;
          }
          t += ms;
          const end = a.effect?.getComputedTiming().endTime;
          if (typeof end === 'number' && Number.isFinite(end) && t >= end) {
            mine.delete(a);
            done.add(a);
            try {
              a.finish();
            } catch {}
          } else {
            mine.set(a, t);
            a.currentTime = t;
          }
        }
      };
      /* …and the page given a turn to draw what its timers changed (React renders on a message, not a timer) */
      window.__filmSettle = () =>
        new Promise(done => {
          const c = new MessageChannel();
          let n = 0;
          c.port1.onmessage = () => (++n < 3 ? c.port2.postMessage(0) : done());
          c.port2.postMessage(0);
        });
    });
  }

  /** Time moves one frame on, with nothing photographed */
  async tick() {
    await this.page.clock.runFor(this.step);
    await this.doc().evaluate(async ms => {
      window.__filmStep(ms);
      await window.__filmSettle();
      window.__filmStep(0);
    }, this.step);
  }

  async hand() {
    await this.page.evaluate(
      ([x, y, a, down]) => {
        const el = document.getElementById('hand');
        const [hx, hy] = el.dataset.hot.split(',').map(Number);
        el.style.transform = `translate(${x - hx}px, ${y - hy}px) scale(${down ? 0.86 : 1})`;
        el.style.opacity = String(a);
      },
      [this.x, this.y, this.alpha, this.down]
    );
  }

  /** ONE FRAME: time moves a step, the page draws, the picture is taken */
  async shoot() {
    await this.tick();
    await this.hand();
    const shot = await this.page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: this.size.w, height: this.size.h } });
    /* FRAMES=<folder>: every tenth frame (or every FRAME_EVERY-th) is kept as a picture under the film's own name, to
       look at an act without playing its film */
    if (process.env.FRAMES && this.frames % Number(process.env.FRAME_EVERY ?? 10) === 0) writeFileSync(resolve(process.env.FRAMES, this.tag, `f${String(this.frames).padStart(4, '0')}.png`), shot);
    const png = shot.toString('base64');
    for (const s of this.sinks) {
      const still = await this.encoder.frame(s.id, png, this.frames === 0);
      if (still) this.stills[s.id] = Buffer.from(still, 'base64');
    }
    this.frames++;
  }

  /** `ms` of the page's time passes */
  async wait(ms) {
    for (let n = Math.max(1, Math.round(ms / this.step)); n > 0; n--) await this.shoot();
  }

  async point(to) {
    const p = typeof to === 'function' ? await to(this) : to;
    if (!p) return null;
    const pad = 3;
    return [Math.max(pad, Math.min(this.size.w - pad, p[0])), Math.max(pad, Math.min(this.size.h - pad, p[1]))];
  }

  /** The pointer glides to a place; with no time given, as long as the distance asks */
  async glide(to, ms) {
    const p = await this.point(to);
    if (!p) return this.skip(to);
    const [x0, y0] = [this.x, this.y];
    const dist = Math.hypot(p[0] - x0, p[1] - y0);
    const n = Math.max(2, Math.round((ms ?? 260 + dist * 0.85) / this.step));
    /* a hand does not travel a ruled line: the path bows a little, more over a long reach */
    const bow = Math.min(46, dist * 0.09) * (p[0] > x0 ? -1 : 1);
    for (let i = 1; i <= n; i++) {
      const e = ease(i / n);
      const lift = Math.sin(Math.PI * e) * bow;
      this.x = x0 + (p[0] - x0) * e;
      this.y = y0 + (p[1] - y0) * e + lift;
      this.alpha = Math.min(1, this.alpha + 0.22);
      await this.page.mouse.move(this.x, this.y);
      await this.shoot();
    }
    return true;
  }

  /** It glides there (if a place is given), rests a beat, and presses */
  async press(to, { ms, rest = 140, after = 260 } = {}) {
    if (to && !(await this.glide(to, ms))) return false;
    await this.wait(rest);
    this.down = true;
    await this.page.mouse.down();
    await this.wait(90);
    this.down = false;
    await this.page.mouse.up();
    await this.wait(after);
    return true;
  }

  /** It presses where it is, glides to a place holding, and lets go */
  async drag(to, ms = 900) {
    const p = await this.point(to);
    if (!p) return this.skip(to);
    this.down = true;
    await this.page.mouse.down();
    await this.wait(120);
    const [x0, y0] = [this.x, this.y];
    const n = Math.max(3, Math.round(ms / this.step));
    for (let i = 1; i <= n; i++) {
      const e = ease(i / n);
      this.x = x0 + (p[0] - x0) * e;
      this.y = y0 + (p[1] - y0) * e;
      await this.page.mouse.move(this.x, this.y);
      await this.shoot();
    }
    await this.wait(120);
    this.down = false;
    await this.page.mouse.up();
    await this.wait(200);
    return true;
  }

  /** Letters typed where the page's focus is, one at a time */
  async type(text, per = 110) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await this.wait(per);
    }
  }

  async key(name, after = 240) {
    await this.page.keyboard.press(name);
    await this.wait(after);
  }

  /** A SCROLLER moved by hand: `sel` inside the terminal goes `dy` pixels over `ms`, eased — its own scrollTop, set a
      frame at a time (a smooth scroll is the browser's and would not keep the film's time). On a phone the fingertip
      drags the other way, as a thumb does. `axis: 'x'` moves it sideways (a wide table inside a narrow box). */
  async scroll(sel, dy, ms = 1100, axis = 'y') {
    const side = axis === 'x' ? 'scrollLeft' : 'scrollTop';
    const from = await this.doc().evaluate(([sel, side]) => document.querySelector(sel)?.[side] ?? null, [sel, side]);
    if (from == null) return this.skip(`scroll ${sel}`);
    const n = Math.max(3, Math.round(ms / this.step));
    const [x0, y0] = [this.x, this.y];
    const thumb = this.size.form === 'phone' && axis === 'y';
    if (thumb) this.down = true;
    for (let i = 1; i <= n; i++) {
      const e = ease(i / n);
      await this.doc().evaluate(([sel, side, to]) => (document.querySelector(sel)[side] = to), [sel, side, from + dy * e]);
      if (thumb) {
        this.y = Math.max(70, Math.min(this.size.h - 40, y0 - dy * e * 0.55));
        this.alpha = Math.min(1, this.alpha + 0.25);
      }
      await this.shoot();
    }
    if (thumb) {
      this.down = false;
      await this.wait(120);
      this.x = x0;
    }
    return true;
  }

  /** The pointer goes home and fades; the film's last frames have none in them */
  async home(ms = 700) {
    const p = homeOf(this.size);
    const [x0, y0] = [this.x, this.y];
    const n = Math.max(3, Math.round(ms / this.step));
    for (let i = 1; i <= n; i++) {
      const e = ease(i / n);
      this.x = x0 + (p[0] - x0) * e;
      this.y = y0 + (p[1] - y0) * e;
      this.alpha = Math.max(0, 1 - i / (n * 0.9));
      await this.page.mouse.move(this.x, this.y);
      await this.shoot();
    }
    this.alpha = 0;
  }

  skip(what) {
    this.skipped.push(typeof what === 'function' ? what.label ?? 'a place that was not on screen' : String(what));
    return false;
  }
}

/* ---- WHERE THE POINTER GOES ----------------------------------------------------------------------------------------- */

/* The boxes of everything matching `sel` that stand on the screen */
const boxes = async (film, sel) =>
  (
    await film.frame
      .locator(sel)
      .evaluateAll(els =>
        els.map(e => {
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return [r.x, r.y, r.width, r.height, s.visibility !== 'hidden' && s.display !== 'none'];
        })
      )
      .catch(() => [])
  )
    .filter(([x, y, w, h, shown]) => shown && w > 2 && h > 2 && y + h > 2 && y < film.size.h - 2 && x < film.size.w - 2 && x + w > 2)
    .map(([x, y, w, h]) => [x, y, w, h]);

const named = (fn, label) => Object.assign(fn, { label });

/** A point on the n-th element matching `sel` that is on screen (from the end below zero; 'mid' = the one nearest the
    screen's middle); `fx`, `fy` place the point inside its box */
export const on = (sel, n = 0, fx = 0.5, fy = 0.5) =>
  named(async film => {
    const all = await boxes(film, sel);
    if (!all.length) return null;
    let i = n === 'mid' ? all.reduce((best, b, k) => (Math.abs(b[1] + b[3] / 2 - film.size.h / 2) < Math.abs(all[best][1] + all[best][3] / 2 - film.size.h / 2) ? k : best), 0) : n < 0 ? all.length + n : n;
    i = Math.max(0, Math.min(all.length - 1, i));
    const [x, y, w, h] = all[i];
    return [x + w * fx, y + h * fy];
  }, `${sel} [${n}]`);

/** Something whose own words are `words` (a string, or a function of the film), inside `scope` */
export const says = (words, scope = 'body', n = 0, kinds = 'button, [role="button"], [role="tab"], [role^="menuitem"], [role="option"], a') =>
  named(async film => {
    const want = String(typeof words === 'function' ? words(film) : words)
      .trim()
      .toLowerCase();
    if (!want) return null;
    const sel = kinds
      .split(',')
      .map(k => `${scope} ${k.trim()}`)
      .join(', ');
    const all = (
      await film.frame
        .locator(sel)
        .evaluateAll(
          (els, want) =>
            els
              .filter(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === want)
              .map(e => {
                const r = e.getBoundingClientRect();
                return [r.x, r.y, r.width, r.height];
              }),
          want
        )
        .catch(() => [])
    ).filter(([x, y, w, h]) => w > 2 && h > 2 && y + h > 2 && y < film.size.h - 2 && x < film.size.w - 2 && x + w > 2);
    if (!all.length) return null;
    const [x, y, w, h] = all[Math.max(0, Math.min(all.length - 1, n < 0 ? all.length + n : n))];
    return [x + w / 2, y + h / 2];
  }, `"${typeof words === 'function' ? '…' : words}"`);

/** a point by fractions of the screen */
export const at = (fx, fy) => named(async film => [fx * film.size.w, fy * film.size.h], `at ${fx},${fy}`);

/** What an element inside the terminal says now (its words, trimmed) — to remember a choice and put it back */
export const read = async (film, sel, n = 0) =>
  film.frame
    .locator(sel)
    .nth(n)
    .evaluate(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
    .catch(() => '');
