import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = '/workspace/artifacts/replay-ui';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto('http://127.0.0.1:8080/pinpoint/map', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('#map-session', { timeout: 45000 });
await page.waitForTimeout(2500);

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

await shot('a-live');

await page.click('[data-map-replay]');
await page.waitForSelector('[data-replay-play]', { timeout: 15000 });
await page.waitForTimeout(800);
await page.click('[data-replay-play]'); // pause
await page.waitForTimeout(400);

const track = page.locator('[data-replay-track]');
const box = await track.boundingBox();
console.log('TRACK', JSON.stringify(box));
console.log('STRIP', await page.locator('[data-replay-strip]').first().innerText().catch(() => 'none'));
console.log('TIME', await page.locator('[data-replay-time]').first().innerText().catch(() => 'none'));

const seek = async (frac) => {
  const b = await track.boundingBox();
  await page.mouse.click(b.x + b.width * frac, b.y + b.height / 2);
  await page.waitForTimeout(700);
  console.log('AT', frac, await page.locator('[data-replay-time]').first().innerText());
  const move = await page.locator('[data-tape-move]').first().innerText().catch(() => '');
  console.log('MOVE', move);
};

await seek(0.02);
await shot('b-open');

await seek(0.42);
await shot('c-mid-full');

// canvases inside the day
const canvases = await page.locator('#map-session canvas').evaluateAll(els =>
  els.map(e => {
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
  })
);
console.log('CANVASES', JSON.stringify(canvases));

const big = canvases.filter(c => c.w > 400 && c.h > 180).sort((a, b) => a.y - b.y);
console.log('BIG', JSON.stringify(big));
const price = big[0];
const hedge = big[1];

const hover = async (label, x, y) => {
  await page.mouse.move(x, y);
  await page.waitForTimeout(350);
  const card = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#map-session *')].filter(n => {
      const t = (n.innerText || '').trim();
      if (!t || t.length > 80) return false;
      const r = n.getBoundingClientRect();
      if (r.width < 40 || r.height < 16 || r.height > 48) return false;
      const s = getComputedStyle(n);
      return s.position === 'absolute' || s.position === 'fixed';
    }).slice(0, 8).map(n => n.innerText.replace(/\s+/g, ' ').slice(0, 120));
    return nodes;
  });
  console.log('HOVER', label, x, y, JSON.stringify(card));
  await shot(label);
};

if (price) {
  // right portion of the price plot: the cone, vertically centered, then high and low in the cloud
  await hover('d-cone-core', price.x + price.w * 0.72, price.y + price.h * 0.48);
  await hover('e-cone-upper', price.x + price.w * 0.78, price.y + price.h * 0.28);
  await hover('f-cone-lower', price.x + price.w * 0.78, price.y + price.h * 0.72);
  // the seam where price meets cone
  await hover('g-seam', price.x + price.w * 0.42, price.y + price.h * 0.45);
  // empty black above the path, left side
  await hover('h-price-left', price.x + price.w * 0.12, price.y + price.h * 0.35);
}
if (hedge) {
  await hover('i-hedge-future', hedge.x + hedge.w * 0.75, hedge.y + hedge.h * 0.45);
  await hover('j-hedge-past', hedge.x + hedge.w * 0.2, hedge.y + hedge.h * 0.4);
}

// drag the scrubber slowly across a bit so we see the handle
if (box) {
  await page.mouse.move(box.x + box.width * 0.42, box.y + 8);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + 8, { steps: 12 });
  await page.waitForTimeout(200);
  await shot('k-dragging');
  await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('AFTER DRAG', await page.locator('[data-replay-time]').first().innerText());
}

await seek(0.88);
await shot('l-late-full');

console.log('ERRORS', errors.slice(0, 5));
await browser.close();
