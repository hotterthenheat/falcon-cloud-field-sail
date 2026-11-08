/*
  Compass words proof (owner's rules, docs/PRODUCT_REVIEW.md Part 3): no Compass page and no Pulse tile ever shows a
  model score as a percentage, and no page names "Book A/B/C". The pages are rendered (react-dom/server) on a kept
  Compass state whose every call and card carries the score the engine read (scripts/fixtures/compassSetups.ts and the
  recorded calls below), and the rendered text and attributes are scanned. Hover labels (Tip) are not rendered until a
  pointer rests on them, so the Compass sources are scanned too, for a score formatted as a percentage or a book letter
  written for a reader.
  Run:  npx tsx scripts/compass-words-proof.ts
*/
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* a kept state in the browser's store before any Compass module reads it (data/compassFeed.ts paints it first) */
const { FIXTURE_SETUPS } = await import('./fixtures/compassSetups');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const now = Date.now();
const cards = FIXTURE_SETUPS.map(s => ({ ...s, expiryDate: today, seenAt: now - 60_000, quotedAt: now - 61_000, mark: now - 60_000 }));
const call = (o: Record<string, unknown>) => ({
  key: `${today}|${o.id}`,
  day: today,
  sleeve: 'odte',
  firedAt: now - 30 * 60_000,
  quoteAt: now - 30 * 60_000,
  expiry: today,
  pathAt: now,
  spark: [5.7, 5.9, 6.4],
  how: 'live',
  outcome: { status: 'closed', fill: { at: now - 29 * 60_000, bid: 5.6, ask: 5.68 }, exit: { at: now - 20 * 60_000, px: 8.52, why: 'Take profit 1.50×' }, peak: 8.6, stop: 2.66, last: null, ret: 50, pnl: 284, heldMin: 9 },
  ...o,
});
const signals = [
  call({ id: 'SPY-757-P-top-setups-odte', book: 'A', ticker: 'SPY', contract: 'SPY 757P', right: 'P', strike: 757, bid: 5.66, ask: 5.68, spot: 754.15, p1: 0.7563, prun: 0.4127, runner: false, cost: cards[0].cost }),
  call({ id: 'IWM-271-C-top-setups-odte', book: 'B', ticker: 'IWM', contract: 'IWM 271C', right: 'C', strike: 271, bid: 2.37, ask: 2.4, spot: 272.9, p1: 0.7281, prun: 0.6233, runner: true }),
  call({ id: 'SPXW-7420-C-top-setups-odte', book: 'C', ticker: 'SPXW', contract: 'SPXW 7420C', right: 'C', strike: 7420, bid: 1.35, ask: 1.4, spot: 7403.39, p1: null, prun: null, runner: false }),
];
const kept = {
  format: 'compass-record/1',
  rev: 1,
  at: now,
  day: today,
  engine: { running: true, readOnly: false, startedAt: now - 3_600_000, why: '' },
  meta: { spots: { SPY: 754.15 }, sparks: {}, line: '', theta: 'up', downSince: 0, busy: false },
  lock: '',
  close: null,
  model: {
    day: today.replace(/-/g, ''),
    picks: [[cards[0].id, cards[0]]],
    wings: [[cards[1].id, cards[1]]],
    lottery: [[cards[2].id, cards[2]]],
    near: [[cards[3].id, cards[3]]],
    kept: [],
    pass: [{ ticker: 'QQQ', contract: 'QQQ 660P', sleeve: 'odte', expiry: today, p1: 0.6987, why: 'Under the line.' }],
    seen: cards.slice(0, 3).map(c => c.id),
    scanned: { odte: now - 60_000, weekly: now - 60_000 },
    reports: { odte: { best: 0.8021, prun: 0.3, contract: 'GLD 373P', ticker: 'GLD', scored: 120, quiet: 0, setup: null }, weekly: { best: 0.7012, prun: 0.2, contract: 'QQQ 660P', ticker: 'QQQ', scored: 80, quiet: 0, setup: null } },
  },
  earlier: null,
  signals,
  would: [],
  /* the first call's random-side twin, closed at a loss (data/compassTwins.ts) */
  twins: [{ ...call({ id: 'SPY-751-C-top-setups-odte|twin', book: 'A', ticker: 'SPY', contract: 'SPY 751C', right: 'C', strike: 751, bid: 0, ask: 0, spot: 754.15, p1: null, prun: null, runner: false }), key: `${today}|SPY-757-P-top-setups-odte|twin`, twin: true, twinOf: `${today}|SPY-757-P-top-setups-odte`, outcome: { status: 'closed', fill: { at: now - 29 * 60_000, bid: 4.1, ask: 4.15 }, exit: { at: now - 20 * 60_000, px: 3.2, why: 'Stop' }, peak: 4.2, stop: 1.94, last: null, ret: -22.9, pnl: -95, heldMin: 9 } }],
  marks: [],
};
const store = new Map<string, string>([['slayer_compass_state_v2', JSON.stringify(kept)]]);
const g = globalThis as Record<string, unknown>;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: () => null, length: 0, clear: () => store.clear() };

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? `\n       ${detail}` : ''}`);
};

/** Every score the fixtures carry, as a page would print it: 75.6%, 75.63%, 76%, 41%, ... */
const scores = [...cards.map(c => c.p1), ...cards.map(c => c.prun), ...signals.map(s => s.p1 as number | null), ...signals.map(s => s.prun as number | null), 0.8021, 0.7012, 0.6987]
  .filter((v): v is number => typeof v === 'number')
  .flatMap(v => [0, 1, 2].map(d => `${(v * 100).toFixed(d)}%`));

/** The forbidden words: a book letter, a model next to a percentage, the old KPI and line */
const FORBIDDEN: [string, RegExp][] = [
  ['a book letter', /\bBooks? [ABC]\b|\bBook [ABC]\/[ABC]\b|\bBooks A,? B/],
  ['a model next to a percentage', /Model\s*(?:[123]|Risk)?\s*[:·]?\s*(?:Read\s*)?\d+(?:\.\d+)?\s*%/],
  ['a percentage next to a model', /\d+(?:\.\d+)?\s*%\s*(?:on|from)?\s*Model\s*[123]/],
  ['the best-score KPI', /Best Model/],
  ['the line as a score', /70\.67|P\(TP1?\)|P\(run\)/],
  ['a data vendor', /ThetaData|Theta Data|Unusual Whales/],
];

/** Text a reader sees: tags out, attributes (title, aria-label, alt, placeholder) kept */
const readable = (html: string) => {
  const attrs = [...html.matchAll(/\s(?:title|aria-label|alt|placeholder)="([^"]*)"/g)].map(m => m[1]);
  const text = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  return `${text} ${attrs.join(' ')}`.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
};

const scan = (where: string, html: string) => {
  const text = readable(html);
  for (const [what, re] of FORBIDDEN) {
    const m = re.exec(text);
    check(`${where}: never ${what}`, !m, m ? `…${text.slice(Math.max(0, m.index - 60), m.index + 60)}…` : '');
  }
  const hit = scores.find(s => new RegExp(`(^|[^\\d.])${s.replace('.', '\\.')}`).test(text));
  check(`${where}: never a score the engine read`, !hit, hit ? `prints ${hit}` : '');
  return text;
};

/* the server renderer warns on every layout effect; the pages are read here, not hydrated */
const quiet = console.error;
console.error = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].includes('useLayoutEffect does nothing on the server')) return;
  quiet(...a);
};

const { MemoryRouter, Routes, Route } = await import('react-router-dom');
/* the app's own providers, outermost first (src/App.tsx) */
const { TooltipProvider } = await import('../src/components/shadcn/tooltip');
const { MarketDataProvider } = await import('../src/context/MarketDataContext');
const { FocusProvider } = await import('../src/context/FocusContext');
const { TrackerProvider } = await import('../src/context/TrackerContext');
const { WatchProvider } = await import('../src/context/WatchContext');
const wrap = (el: ReactElement) =>
  [WatchProvider, TrackerProvider, FocusProvider, MarketDataProvider, TooltipProvider].reduce<ReactElement>((inner, P) => createElement(P as (p: { children: ReactElement }) => ReactElement, null, inner), el);
const at = (path: string, el: ReactElement, route = path) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, wrap(createElement(Routes, null, createElement(Route, { path: route, element: el })))));

const render = (where: string, fn: () => string): string => {
  try {
    const html = fn();
    check(`${where}: renders`, html.length > 200, `only ${html.length} characters`);
    return scan(where, html);
  } catch (e) {
    check(`${where}: renders`, false, String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | '));
    return '';
  }
};

/* the cards: the scan's, the table view, and the Pulse tile's (which renders the same card) */
const { default: SetupScanCard } = await import('../src/components/compass/SetupScanCard');
const { default: SetupScanBoard } = await import('../src/components/compass/SetupScanBoard');
const noop = () => {};
const cardText = render('scan cards', () => cards.map((s, i) => at('/compass', createElement(SetupScanCard, { setup: s, rank: i + 1, selected: false, onSelect: noop, onAnalysis: noop, expiryChip: '' }))).join(''));
check('scan cards: each called card names its model', ['Model 1', 'Model 3', 'Model 2 riding'].every(w => cardText.includes(w)));
check('scan cards: a call says what it needs, in the stock\'s terms', /Needs SPY ≤ 751\.9 by \d\d:\d\d \(0\.31× the priced move\)/.test(cardText));
render('scan board, cards', () => at('/compass', createElement(SetupScanBoard, { setups: cards, layout: 'cards', selectedId: null, onSelect: noop, onAnalysis: noop, expiryChip: '' })));
render('scan board, table', () => at('/compass', createElement(SetupScanBoard, { setups: cards, layout: 'table', selectedId: null, onSelect: noop, onAnalysis: noop, expiryChip: '' })));

/* a grid's rows mount only in a browser (AG Grid): its columns are rendered here cell by cell, with their hover text */
type Col<T> = { key: string; header: string; render: (r: T) => unknown };
const gridText = <T,>(where: string, columns: readonly Col<T>[], rows: readonly T[], tooltips: Record<string, string> = {}) => {
  const Cell = ({ c, r }: { c: Col<T>; r: T }) => c.render(r) as ReactElement;
  const html = [
    ...columns.map(c => `<th title="${tooltips[c.key] ?? ''}">${c.header}</th>`),
    ...rows.flatMap(r => columns.map(c => `<td>${at('/compass', createElement(Cell, { c, r }), '/compass')}</td>`)),
  ].join('');
  return render(where, () => html);
};
const { scanColumns, SCAN_TOOLTIPS } = await import('../src/components/compass/SetupScanBoard');
const scanGrid = gridText('scan table rows', scanColumns(noop), cards.map((c, i) => ({ ...c, rank: i + 1 })), SCAN_TOOLTIPS);
check('scan table rows: the column is Model, and says Model 1/3', /\bModel\b/.test(scanGrid) && /Model 1/.test(scanGrid) && /Model 3/.test(scanGrid) && !/\bBook\b/.test(scanGrid));
const { CompassCards } = await import('../src/pages/workspace/tiles/trade');
render('Pulse Compass tile', () => at('/pulse', createElement(CompassCards, { ranked: cards, expiryChip: '', onOpen: noop })));

/* the pages, on the kept state */
const { default: CompassLayout, COMPASS_LINE } = await import('../src/pages/compass/CompassLayout');
scan('page subtitle', COMPASS_LINE);
const pages: [string, string, () => Promise<{ default: (p: Record<string, unknown>) => ReactElement | null }>, Record<string, unknown>?][] = [
  ['Compass board', '/compass', () => import('../src/pages/compass/Board')],
  ['Blotter', '/compass/blotter', () => import('../src/pages/compass/Blotter')],
  ['Tracker', '/compass/tracker', () => import('../src/pages/Tracker'), { embedded: true }],
  ['Review', '/compass/review', () => import('../src/pages/compass/SessionReview')],
  ['Study', '/compass/study', () => import('../src/pages/compass/SessionStudy')],
];
const seen: Record<string, string> = {};
for (const [where, path, load, props] of pages) {
  const { default: Page } = await load();
  seen[where] = render(where, () => at(path, createElement(Page, props ?? {})));
}
/* the scan is on the kept state: the pages above read real rows, not an empty frame */
check('Blotter: the decision math is withdrawn', seen.Blotter.includes('The decision math is withdrawn') && !seen.Blotter.includes('SPY 757P'));
check('Compass board: publishes no call', seen['Compass board'].includes('The decision math is withdrawn') && !seen['Compass board'].includes('SPY 757P'));
const { BLOTTER_GRID } = await import('../src/pages/compass/Blotter');
const blotterGrid = gridText('Blotter rows', BLOTTER_GRID.columns, (signals as unknown as Parameters<typeof BLOTTER_GRID.lineOf>[0][]).map(BLOTTER_GRID.lineOf), BLOTTER_GRID.tooltips);
check('Blotter rows: each call by its model', blotterGrid.includes('SPY 757P') && blotterGrid.includes('Model 1 · Model 2 riding') && blotterGrid.includes('Model 3'));
const { STUDY_GRID } = await import('../src/pages/compass/SessionStudy');
const movers = [
  { contract: 'QQQ 660P', sleeve: 'odte', mark: '10:25', expiry: today, ask: 2.1, bestBid: 4.4, bestAt: '10:41', ratio: 2.1, stopFirst: false, p1: 0.6987, gate: 'Under the line', heldDown: [] },
  { contract: 'GLD 373P', sleeve: 'odte', mark: '10:30', expiry: today, ask: 0.53, bestBid: 1.2, bestAt: '11:02', ratio: 2.3, stopFirst: true, p1: 0.8021, gate: 'Spread', heldDown: [] },
];
gridText('Study movers rows', STUDY_GRID.columns as unknown as Col<(typeof movers)[number]>[], movers);
render('Compass layout', () => at('/compass', createElement(CompassLayout), '/compass/*'));
const { CompassGuide } = await import('../src/components/compass/CompassGuide');
render('How to read', () => renderToStaticMarkup(createElement(CompassGuide)));

/* the hover labels and every string a Compass reader can see, at the source */
const SOURCES = [
  'src/components/compass',
  'src/pages/compass',
  'src/pages/Tracker.tsx',
  'src/pages/workspace/tiles/trade.tsx',
];
const files = SOURCES.flatMap(p => (p.endsWith('.tsx') || p.endsWith('.ts') ? [p] : readdirSync(join(root, p)).filter(f => /\.tsx?$/.test(f)).map(f => `${p}/${f}`)));
for (const f of files) {
  const src = readFileSync(join(root, f), 'utf8');
  /* code comments may name the engine's book letters; strings may not */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const book = /['"`>][^'"`<]*\bBooks? [ABC]\b/.exec(code);
  check(`${f}: no book letter written for a reader`, !book, book ? book[0].slice(0, 120) : '');
  const pct = /\b(?:p1|prun|modelRead|meanP1|overMeanP1|topBest|best)\b[^;\n]{0,40}\*\s*100\)?\.toFixed\(\d\)\}?%/.exec(code);
  check(`${f}: no model score formatted as a percentage`, !pct, pct ? pct[0] : '');
}

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\ncompass words proof: every check passed');
process.exit(0);
