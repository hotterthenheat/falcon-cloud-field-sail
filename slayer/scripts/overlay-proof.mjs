/*
  The overlays' keyboard and focus contract, in a real browser: every shared overlay (the palette, the alerts and
  watchlist drawers, the Modal, the dropdowns, the ticker search, the tip, the tab strips) opened from its trigger, then
  - focus moves into it, and Tab (14 presses) never leaves a dialog or a menu;
  - it carries its role (dialog with aria-modal and a name, menu, combobox with a listbox, tooltip, radio or tab);
  - the arrow keys move inside it (menus, lists, tab strips);
  - Escape closes it and focus goes back to the trigger, never to <body>;
  - with reduced motion asked for, nothing in it animates.
  Run on its own against any server:  OVERLAY_BASE=http://127.0.0.1:8080 node scripts/overlay-proof.mjs
  browser-smoke.mjs runs it on the production build after the routes (overlayChecks below).
  SMOKE_CHROMIUM points at a Chromium other than Playwright's own.
*/

import { fileURLToPath } from 'node:url';

const OVERLAY =
  '[data-command-palette],div.fixed.inset-0.z-50,[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],[data-alerts-drawer],[data-watchlist-drawer],[data-dropdown-card]';

/* ---- the probes, run in the page ---- */

/** Marks what is already open, so the overlay found after the trigger is the new one */
const markPre = page => page.evaluate(sel => document.querySelectorAll(sel).forEach(e => e.setAttribute('data-qa-pre', '')), OVERLAY);

/** The overlay that opened: the outermost new one with a box, marked data-qa-open */
const findOpen = page =>
  page.evaluate(sel => {
    const seen = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const fresh = [...document.querySelectorAll(sel)].filter(e => !e.hasAttribute('data-qa-pre') && seen(e));
    const outer = fresh.filter(e => !fresh.some(o => o !== e && o.contains(e)));
    const el = outer[0];
    if (!el) return null;
    el.setAttribute('data-qa-open', '');
    /* the role may sit on the element or, for a positioned wrapper, on its first child with one */
    const roled = el.getAttribute('role') ? el : el.querySelector('[role]');
    const name = roled?.getAttribute('aria-label') || (roled?.getAttribute('aria-labelledby') && document.getElementById(roled.getAttribute('aria-labelledby'))?.textContent) || '';
    return {
      role: roled?.getAttribute('role') ?? null,
      modal: roled?.getAttribute('aria-modal') ?? null,
      name: name.trim().slice(0, 40),
      focusIn: el.contains(document.activeElement),
    };
  }, OVERLAY);

const focusInOpen = page => page.evaluate(() => {
  const o = document.querySelector('[data-qa-open]');
  return !!o && o.contains(document.activeElement);
});

const isOpen = page => page.evaluate(() => {
  const o = document.querySelector('[data-qa-open]');
  if (!o || !o.isConnected) return false;
  const r = o.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(o).visibility !== 'hidden';
});

/** What the keyboard is on: an id for the focused element and the highlighted row */
const where = page =>
  page.evaluate(() => {
    const a = document.activeElement;
    const desc = a?.getAttribute('aria-activedescendant');
    const lit = document.querySelector('[data-qa-open] [data-highlighted], [data-qa-open] [aria-selected="true"]');
    return `${a?.id || a?.tagName}|${desc || ''}|${lit?.textContent?.slice(0, 30) ?? ''}`;
  });

/** Running animations inside the overlay (reduced motion asked: there should be none) */
const moving = page =>
  page.evaluate(() => {
    const o = document.querySelector('[data-qa-open]');
    if (!o) return 0;
    return o.getAnimations({ subtree: true }).filter(a => a.playState === 'running' && Number(a.effect?.getTiming().duration) > 0).length;
  });

/* ---- one case ---- */

/**
 * kind: 'dialog' (role dialog, aria-modal, a name, Tab stays) · 'menu' (role menu, arrows move) · 'combobox' (an input
 * with role combobox and a listbox) · 'tooltip' · 'tabs' (arrows move the choice along the strip)
 */
async function runCase(browser, base, c) {
  const ctx = await browser.newContext({ viewport: c.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const out = { name: c.name, checks: {} };
  const ok = (k, v) => (out.checks[k] = v);
  try {
    await page.goto(base + c.path, { waitUntil: 'load', timeout: 45_000 });
    await page.locator(c.trigger).first().waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(600);
    const trigger = page.locator(c.trigger).first();
    await trigger.evaluate(el => el.setAttribute('data-qa-trigger', ''));
    await trigger.focus();

    if (c.kind === 'tabs') {
      const read = () =>
        page.evaluate(sel => {
          const t = document.querySelector(sel);
          const group = t?.closest('[role="tablist"],[role="radiogroup"],[role="group"]');
          const on = group?.querySelector('[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"],[data-state="on"],[data-state="active"]');
          return { role: group?.getAttribute('role') ?? null, item: document.activeElement?.getAttribute('role') ?? null, focus: document.activeElement?.textContent?.trim() ?? '', on: on?.textContent?.trim() ?? '' };
        }, '[data-qa-trigger]');
      const before = await read();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      const after = await read();
      ok('role', ['tablist', 'radiogroup', 'group'].includes(before.role ?? '') && ['tab', 'radio'].includes(after.item ?? ''));
      ok('arrows', after.focus !== before.focus);
      return out;
    }

    await markPre(page);
    if (c.kind === 'tooltip') await page.waitForTimeout(900);
    else await page.keyboard.press(c.key ?? 'Enter');
    await page.waitForTimeout(700);
    const open = await findOpen(page);

    if (c.kind === 'tooltip') {
      const tip = await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"]')].some(t => (t.textContent ?? '').trim().length > 0));
      ok('shows on focus', tip);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      ok('esc hides', !(await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"]')].some(t => t.getBoundingClientRect().width > 0))));
      return out;
    }

    ok('opens', !!open);
    if (!open) return out;
    ok('reduced motion', (await moving(page)) === 0);
    ok('focus in', open.focusIn);
    if (c.kind === 'dialog') ok('role', (open.role === 'dialog' || open.role === 'alertdialog') && open.modal === 'true' && open.name.length > 0);
    if (c.kind === 'menu') ok('role', open.role === 'menu');
    if (c.kind === 'combobox') {
      ok(
        'role',
        await page.evaluate(() => {
          const o = document.querySelector('[data-qa-open]');
          const box = o?.querySelector('[role="combobox"]');
          return !!box && !!o?.querySelector('[role="listbox"]') && box.getAttribute('aria-expanded') === 'true';
        }),
      );
    }
    if (c.kind !== 'dialog' || c.list) {
      const a = await where(page);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      ok('arrows', (await where(page)) !== a);
    }
    let left = 0;
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      /* focus outside an overlay still open is the escape; a combobox popup that Tab closes moves on, as it should */
      if (!(await isOpen(page))) break;
      if (!(await focusInOpen(page))) left++;
    }
    ok('tab stays', left === 0);
    if (!(await isOpen(page))) {
      /* a list that Tab closed is reopened for the Escape check */
      await page.locator('[data-qa-trigger]').focus();
      await markPre(page);
      await page.keyboard.press(c.key ?? 'Enter');
      await page.waitForTimeout(600);
      await findOpen(page);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    ok('esc closes', !(await isOpen(page)));
    ok(
      'focus back',
      await page.evaluate(() => {
        const t = document.querySelector('[data-qa-trigger]');
        return !!t && (document.activeElement === t || t.contains(document.activeElement));
      }),
    );
  } catch (e) {
    out.error = String(e).split('\n')[0].slice(0, 160);
  } finally {
    await ctx.close();
  }
  return out;
}

export const CASES = [
  { name: 'Command palette', path: '/pulse', trigger: '[data-subject]', kind: 'dialog', list: true },
  { name: 'Alerts drawer', path: '/pulse', trigger: '[data-nav-alerts]', kind: 'dialog' },
  { name: 'Watchlist drawer', path: '/pulse', trigger: '[data-nav-watchlist]', kind: 'dialog' },
  { name: 'Modal (Settings › Data, clear)', path: '/settings/data', trigger: '[data-settings-door="clear"]', kind: 'dialog' },
  { name: 'DropdownSelect (Dossier › Stocks)', path: '/dossier/stocks', trigger: 'button[data-dropdown][aria-haspopup="menu"]:not([data-picked])', kind: 'menu' },
  { name: 'DropdownMulti (Dossier › Stocks filter)', path: '/dossier/stocks', trigger: '[data-dropdown="stocks-filter"]', kind: 'menu' },
  { name: 'DropdownSearch (Compass board)', path: '/compass', trigger: '[data-dropdown-search]', kind: 'combobox' },
  /* on the Weigher the door is the scope chip's own card (ui/ScopeChip.tsx, hand-rolled) round the TickerLookup: the
     lookup is a combobox, so Tab leaves it; the chip's card neither closes on that nor gives focus back on Escape yet */
  { name: 'Ticker lookup in the scope chip (Weigher)', path: '/weigher', trigger: '[data-ticker-search], button[title$="switch ticker"], button[title="Switch ticker"]', kind: 'combobox' },
  { name: 'Tip on keyboard focus (Compass board)', path: '/compass', trigger: 'button[data-dropdown][aria-haspopup="menu"]', kind: 'tooltip' },
  /* the Dossier's news strip draws before any data lands (Pinpoint's Agenda strip waits on the book) */
  { name: 'CardTabs (Dossier › news)', path: '/dossier', trigger: '[aria-label="Which news"] button', kind: 'tabs' },
  { name: 'FilterTabs (Practice › Journal)', path: '/practice/journal', trigger: '[aria-label="Which period"] button', kind: 'tabs' },
  { name: 'Mobile menu (390)', path: '/pulse', trigger: '[data-mobile-menu-door]', kind: 'dialog', phone: true },
];

/** Every case against `base`; the failures, as lines */
export async function overlayChecks(browser, base, log = console.log) {
  const failures = [];
  for (const c of CASES) {
    const r = await runCase(browser, base, c);
    const bad = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
    if (r.error) bad.push(`error: ${r.error}`);
    if (!Object.keys(r.checks).length && !r.error) bad.push('nothing checked');
    log(`${bad.length ? 'FAIL' : 'ok  '} overlay ${r.name.padEnd(42)} ${Object.entries(r.checks).map(([k, v]) => `${v ? '✓' : '✗'} ${k}`).join('  ')}${r.error ? `  (${r.error})` : ''}`);
    if (bad.length) failures.push(`${r.name}: ${bad.join(', ')}`);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { chromium } = await import('playwright');
  const base = process.env.OVERLAY_BASE || 'http://127.0.0.1:8080';
  const browser = await chromium.launch(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM, args: ['--disable-dev-shm-usage'] } : {});
  const only = (process.env.OVERLAY_ONLY || '').toLowerCase();
  if (only) CASES.splice(0, CASES.length, ...CASES.filter(c => c.name.toLowerCase().includes(only)));
  const failures = await overlayChecks(browser, base);
  await browser.close();
  console.log(`\noverlay proof: ${CASES.length - failures.length} of ${CASES.length} overlays keep the contract`);
  process.exit(failures.length ? 1 : 0);
}
