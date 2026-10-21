import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const exe = '/opt/pw-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const out = '/workspace/artifacts/replay-ui';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8080/pinpoint/map', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#map-session', { timeout: 60000 });
await page.waitForTimeout(2500);
await page.click('[data-map-replay]');
await page.waitForSelector('[data-replay-play]', { timeout: 15000 });
await page.waitForTimeout(800);
await page.click('[data-replay-play]');
await page.waitForTimeout(400);

const track = await page.locator('[data-replay-track]').boundingBox();
if (track) {
  await page.mouse.click(track.x + track.width * 0.42, track.y + track.height / 2);
}
await page.waitForTimeout(1200);

const time = await page.locator('[data-replay-time]').first().innerText();
const move = await page.locator('[data-tape-move]').first().innerText().catch(() => 'NO MOVE');
const trackW = track?.width ?? 0;

const plot = page.locator('#map-session [data-tape-plot]');
const box = await plot.boundingBox();
let ahead = '';
if (box) {
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.48);
  await page.waitForTimeout(400);
  ahead = await page.locator('[data-tape-ahead]').innerText().catch(() => 'NO AHEAD');
  await page.screenshot({ path: `${out}/fix-cone.png` });
  const hedge = page.locator('#map-session [data-through-plot]');
  const hb = await hedge.boundingBox();
  if (hb) {
    await page.mouse.move(hb.x + hb.width * 0.72, hb.y + hb.height * 0.45);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${out}/fix-hedge.png` });
}

const before = await page.locator('[data-replay-time]').first().innerText();
const block = page.locator('#map-clock [data-block="30"]');
if (await block.count()) {
  await block.click();
  await page.waitForTimeout(900);
}
const after = await page.locator('[data-replay-time]').first().innerText();
const clockCard = await page.locator('[data-clock-card]').innerText().catch(() => '');
await page.screenshot({ path: `${out}/fix-clock.png`, fullPage: false });

console.log(JSON.stringify({ time, move, trackW, ahead, before, after, clockCard: clockCard.slice(0, 240), errors }, null, 2));
await browser.close();
