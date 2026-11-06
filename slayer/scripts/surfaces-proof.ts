/*
  Surfaces proof: the data logic under the status page, the stale states, the banner, the changelog, the notification
  center and the bug report.
  - Stale thresholds (data/freshness.ts): each source's window in and out of a session, the boundary, down is
    reconnecting whatever the age, nothing read is unknown (never live).
  - The status rows (data/statusModel.ts): a path nothing asked is "checking", never "up"; a down path, a refused
    login, a stale Compass mark; a server sentence naming a vendor comes out neutral.
  - The banner (data/banner.ts): an outage only after its wait, the server's outage hiding the others, an outage before
    an announcement, an announcement only in its window, dismissal per message (a new outage shows again), and the
    storage helpers surviving a storage that throws.
  - The changelog (data/changelog.ts): newest first whatever the list's order, by day, no duplicate id or bad date,
    and no vendor named.
  - The notification center (data/notices.ts): newest first, a cleared item gone, an id listed once.
  - The bug report (data/diagnostics.ts): no key, token, card, password or email survives, in the reader's words, the
    errors or the health lines; nothing outside the allowlist is copied; a kept console error is already scrubbed.
  - No vendor's name in the new surfaces' files.
  Run:  npx tsx scripts/surfaces-proof.ts
*/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshnessOf, staleAfter, STALE_MS, ageWords } from '../src/data/freshness';
import { compassRow, neutral, overall, pathRow, recorderRow } from '../src/data/statusModel';
import type { PathRead } from '../src/data/pathHealth';
import { ANNOUNCEMENTS, OUTAGE_AFTER_MS, outageMessages, readDismissed, selectBanner, writeDismissed, type BannerMessage } from '../src/data/banner';
import { CHANGELOG, changelogDays, changelogOrder, changelogProblems, type ChangeEntry } from '../src/data/changelog';
import { visibleNotices, unreadCount, type Notice } from '../src/data/notices';
import { buildReport, noteError, recentErrors, reportText, scrub, bareUrl, type ReportEnv } from '../src/data/diagnostics';

let fail = 0;
let n = 0;
const check = (what: string, ok: boolean) => {
  n++;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/* a Tuesday: 2026-11-03 14:00 ET (regular session) and 23:00 ET (closed-ish: overnight) */
const OPEN = Date.UTC(2026, 10, 3, 19, 0);
const NIGHT = Date.UTC(2026, 10, 8, 3, 0); /* Saturday 22:00 ET: closed */

/* ---- stale thresholds ---- */
console.log('\n-- stale thresholds');
for (const src of Object.keys(STALE_MS) as (keyof typeof STALE_MS)[]) {
  const [open, closed] = STALE_MS[src];
  check(`${src}: the closed window (${ageWords(closed)}) is longer than the session's (${ageWords(open)})`, closed > open);
  check(`${src}: in a session the window is ${ageWords(open)}`, staleAfter(src, OPEN, true) === open);
  check(`${src}: with no session moving it is ${ageWords(closed)}`, staleAfter(src, NIGHT, false) === closed);
  check(`${src}: at the window's edge still live`, freshnessOf({ at: OPEN - open, source: src, now: OPEN, moving: true }).state === 'live');
  check(`${src}: a millisecond past it stale`, freshnessOf({ at: OPEN - open - 1, source: src, now: OPEN, moving: true }).state === 'stale');
  check(`${src}: the same age at night is live`, freshnessOf({ at: NIGHT - open - 1, source: src, now: NIGHT, moving: false }).state === 'live');
}
check('quotes in a session stale past 45 s', staleAfter('quotes', OPEN, true) === 45_000);
check('down is reconnecting even for a reading a second old', freshnessOf({ at: OPEN - 1000, source: 'quotes', now: OPEN, down: true }).state === 'reconnecting');
check('down with nothing kept is reconnecting, age null', (() => { const f = freshnessOf({ at: null, source: 'flow', now: OPEN, down: true }); return f.state === 'reconnecting' && f.ageMs === null; })());
check('nothing read is unknown, never live', freshnessOf({ at: 0, source: 'book', now: OPEN }).state === 'unknown');
check('a reading from the future is not stale (age 0)', freshnessOf({ at: OPEN + 5000, source: 'quotes', now: OPEN, moving: true }).ageMs === 0);
check('the session test follows the market (Tuesday 14:00 ET moving, Saturday night not)', staleAfter('quotes', OPEN) === STALE_MS.quotes[0] && staleAfter('quotes', NIGHT) === STALE_MS.quotes[1]);

/* ---- the status rows ---- */
console.log('\n-- status rows');
const read = (p: Partial<PathRead>): PathRead => ({ condition: 'unknown', okAt: 0, dataAt: null, failAt: 0, failSince: 0, why: '', login: false, ...p });
check('a path nothing asked is checking, never up', pathRow('quotes', read({}), OPEN).state === 'checking');
check('a path that answered 3 s ago is up', pathRow('flow', read({ condition: 'up', okAt: OPEN - 3000 }), OPEN).state === 'up');
check('an answer long ago is degraded, not up', pathRow('quotes', read({ condition: 'up', okAt: OPEN - 20 * 60_000 }), OPEN).state === 'degraded');
const loginRow = pathRow('quotes', read({ condition: 'down', failSince: OPEN - 60_000, login: true, okAt: OPEN - 120_000 }), OPEN);
check('a refused login is down and says the data key', loginRow.state === 'down' && /data key/.test(loginRow.line));
check('a refused gate is "closed to you", not down', pathRow('flow', read({ condition: 'refused' }), OPEN).state === 'refused');
const cBase = { status: 'live' as const, heardAt: OPEN - 2000, at: OPEN - 60_000, error: '', engine: { running: true, readOnly: false, startedAt: OPEN - 3600_000, why: '' }, lastMark: OPEN - 60_000, quotes: 'up', quotesDownSince: 0, markDue: true };
check('Compass running with a mark a minute ago is up', compassRow(cBase, OPEN).state === 'up');
check('Compass with its last mark 4 minutes ago in the session is degraded', compassRow({ ...cBase, lastMark: OPEN - 4 * 60_000 }, OPEN).state === 'degraded');
check('Compass with no mark due (outside the window) is up on an old mark', compassRow({ ...cBase, lastMark: OPEN - 4 * 3600_000, markDue: false }, OPEN).state === 'up');
check('Compass not heard inside its window is degraded (stale)', /Stale/.test(compassRow({ ...cBase, heardAt: OPEN - 60_000 }, OPEN).line));
check('Compass on a kept copy is degraded and reconnecting', (() => { const r = compassRow({ ...cBase, status: 'kept' }, OPEN); return r.state === 'degraded' && /Reconnecting/.test(r.line); })());
check('Compass serving the record only is "off"', compassRow({ ...cBase, engine: { running: false, readOnly: true, startedAt: 0, why: 'The scan is off in this process.' } }, OPEN).state === 'off');
check('Compass with quotes down is degraded (paused)', compassRow({ ...cBase, quotes: 'down', quotesDownSince: OPEN - 90_000 }, OPEN).state === 'degraded');
const vendorLine = compassRow({ ...cBase, status: 'offline', error: 'ThetaData terminal did not answer; Unusual Whales too' }, OPEN).line;
check('a server sentence naming a vendor comes out neutral', !/theta|whales/i.test(vendorLine) && /market data/.test(vendorLine));
check('neutral() keeps an ordinary sentence', neutral('The Compass server did not answer.') === 'The Compass server did not answer.');
check('the recorder asked nothing yet is checking', recorderRow({ kind: 'asking' }, OPEN).state === 'checking');
check('the recorder not running here is off', recorderRow({ kind: 'none', code: 'recorder_down', status: 503 }, OPEN).state === 'off');
check('the recorder with a pass 10 min ago in a session is degraded', recorderRow({ kind: 'ok', recording: true, why: '', lastAt: OPEN - 10 * 60_000, took: 5000, fault: null, backoffUntil: 0, names: 25 }, OPEN).state === 'degraded');
check('the summary is the worst row (down beats off and checking)', overall([pathRow('quotes', read({ condition: 'down', failSince: OPEN - 1 }), OPEN), recorderRow({ kind: 'asking' }, OPEN), compassRow({ ...cBase, engine: { running: false, readOnly: true, startedAt: 0, why: '' } }, OPEN)]) === 'down');
check('the summary: checking beats off (never "all answering" while one is unread)', overall([recorderRow({ kind: 'asking' }, OPEN), compassRow({ ...cBase, engine: { running: false, readOnly: true, startedAt: 0, why: '' } }, OPEN)]) === 'checking');

/* ---- the banner ---- */
console.log('\n-- banner');
const paths = (p: Partial<Record<'quotes' | 'flow' | 'server', Partial<PathRead>>>) => ({ quotes: read(p.quotes ?? {}), flow: read(p.flow ?? {}), server: read(p.server ?? {}) });
const now = OPEN;
check('a blip shorter than the wait is no outage', outageMessages(paths({ quotes: { condition: 'down', failSince: now - (OUTAGE_AFTER_MS - 1) } }), now).length === 0);
const qOut = outageMessages(paths({ quotes: { condition: 'down', failSince: now - OUTAGE_AFTER_MS } }), now);
check('quotes down past the wait is an outage, with the reconnecting words and a Status link', qOut.length === 1 && /reconnecting/.test(qOut[0].text) && qOut[0].link?.to === '/status');
check('a refused gate is not an outage', outageMessages(paths({ flow: { condition: 'refused', failSince: now - 3600_000 } }), now).length === 0);
const both = outageMessages(paths({ quotes: { condition: 'down', failSince: now - 60_000 }, flow: { condition: 'down', failSince: now - 60_000 } }), now);
check('two paths down: two messages, quotes first', both.length === 2 && both[0].id.startsWith('outage:quotes:'));
const srv = outageMessages(paths({ quotes: { condition: 'down', failSince: now - 60_000 }, server: { condition: 'down', failSince: now - 60_000 } }), now);
check('the server down hides the others', srv.length === 1 && srv[0].id.startsWith('outage:server:'));
check('a refused login says the data key', /data key/.test(outageMessages(paths({ quotes: { condition: 'down', login: true, failSince: now - 60_000 } }), now)[0]?.text ?? ''));
const info: BannerMessage = { id: 'a', tone: 'info', text: 'hello', from: now - 1000, until: now + 1000, dismissible: true };
const later: BannerMessage = { id: 'b', tone: 'info', text: 'later', from: now + 5000 };
const gone: BannerMessage = { id: 'c', tone: 'notice', text: 'gone', until: now };
check('an outage is chosen before an announcement', selectBanner([info, ...qOut], new Set(), now)?.tone === 'outage');
check('an announcement before its window is not shown', selectBanner([later], new Set(), now) === null);
check('an announcement at its end is not shown', selectBanner([gone], new Set(), now) === null);
check('an announcement in its window is shown', selectBanner([info, later, gone], new Set(), now)?.id === 'a');
check('a dismissed message is not shown; the next one is', selectBanner([info, ...qOut], new Set([qOut[0].id]), now)?.id === 'a');
const again = outageMessages(paths({ quotes: { condition: 'down', failSince: now - 50_000 } }), now + 10_000);
check('a new outage (a later start) shows again after the old one was dismissed', again[0].id !== qOut[0].id && selectBanner(again, new Set([qOut[0].id]), now + 10_000)?.tone === 'outage');
check('a message that cannot be dismissed ignores the dismissal', selectBanner([{ ...info, dismissible: false }], new Set(['a']), now)?.id === 'a');
check('every hand-written announcement has a unique id and no vendor named', new Set(ANNOUNCEMENTS.map(a => a.id)).size === ANNOUNCEMENTS.length && ANNOUNCEMENTS.every(a => !/thetadata|unusual whales/i.test(a.text)));
/* storage: absent, working, throwing */
const g = globalThis as { localStorage?: unknown };
g.localStorage = undefined;
check('no storage: nothing dismissed, and writing does not throw', readDismissed().size === 0 && (() => { try { writeDismissed(new Set(['x'])); return true; } catch { return false; } })());
const mem = new Map<string, string>();
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
writeDismissed(new Set(['one', 'two']));
check('dismissals round-trip through storage', readDismissed().has('two') && readDismissed().size === 2);
mem.set('slayer_banner_dismissed_v1', '{not json');
check('a torn value reads as nothing dismissed', readDismissed().size === 0);
g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
check('a storage that throws: read and write are caught', readDismissed().size === 0 && (() => { try { writeDismissed(new Set(['x'])); return true; } catch { return false; } })());
g.localStorage = undefined;

/* ---- the changelog ---- */
console.log('\n-- changelog');
check('the entries have no problems (ids unique, dates real, words present)', changelogProblems(CHANGELOG).length === 0);
const ordered = changelogOrder(CHANGELOG);
check('newest first', ordered.every((e, i) => i === 0 || ordered[i - 1].date >= e.date));
const shuffled = [...CHANGELOG].reverse();
check('the order does not depend on the list’s own order (dates)', changelogOrder(shuffled).map(e => e.date).join() === ordered.map(e => e.date).join());
const sameDay: ChangeEntry[] = [
  { id: 'x-fixed', date: '2026-11-01', kind: 'fixed', area: 'Terminal', title: 't', body: 'b' },
  { id: 'x-new', date: '2026-11-01', kind: 'new', area: 'Terminal', title: 't', body: 'b' },
  { id: 'y-old', date: '2026-10-30', kind: 'new', area: 'Terminal', title: 't', body: 'b' },
  { id: 'z-newest', date: '2026-11-02', kind: 'fixed', area: 'Terminal', title: 't', body: 'b' },
];
check('within a day, new before fixed; days newest first', changelogOrder(sameDay).map(e => e.id).join() === 'z-newest,x-new,x-fixed,y-old');
check('by day: one group a date, newest first', changelogDays(sameDay).map(d => d.date).join() === '2026-11-02,2026-11-01,2026-10-30');
check('a duplicate id and a bad date are caught', changelogProblems([...sameDay, { ...sameDay[0] }, { ...sameDay[1], id: 'bad', date: '2026-13-40' }]).length === 2);
check('no entry names a vendor', CHANGELOG.every(e => !/theta\s*data|unusual\s*whales/i.test(`${e.title} ${e.body}`)));

/* ---- the notification center ---- */
console.log('\n-- notices');
const items: Notice[] = [
  { id: 'alert:SPY:1', kind: 'alert', at: 100, title: 'a', detail: '', tone: 'alert' },
  { id: 'compass:2', kind: 'compass', at: 300, title: 'b', detail: '', tone: 'silver' },
  { id: 'paper:3', kind: 'paper', at: 200, title: 'c', detail: '', tone: 'silver' },
  { id: 'compass:2', kind: 'compass', at: 300, title: 'b again', detail: '', tone: 'silver' },
];
const vis = visibleNotices(items, id => id === 'paper:3', id => id === 'alert:SPY:1');
check('newest first, the cleared one gone, a repeated id once', vis.map(x => x.id).join() === 'compass:2,paper:3');
check('read marks carried, unread counted', vis.find(x => x.id === 'paper:3')?.read === true && unreadCount(vis) === 1);

/* ---- the bug report ---- */
console.log('\n-- bug report');
/* every fake secret is built at run time, so no secret-shaped literal sits in this file */
const j = (...p: string[]) => p.join('');
const FAKES = {
  dataKey: j('td1', '_', 'abcDEF1234567890ghij'),
  jwt: j('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'abcDEFghiJKL123'),
  bearer: j('Bearer ', 'zz9', 'Q'.repeat(20)),
  stripe: j('sk', '_live_', '51HxYzABCdefGHIjk'),
  hexKey: j('a1b2c3d4', 'e5f6a7b8', 'c9d0e1f2', 'a3b4c5d6'),
  uuid: j('1b4e28ba', '-2fa1-11d2-883f-', '0016d3cca427'),
  card: j('4242 4242', ' 4242 4242'),
  password: j('password', '=', 'hunter2hunter2'),
  apiKey: j('api_key', ': ', '"', 'sekret-value-99', '"'),
  query: j('/api/uw/x?', 'token', '=', 'abc123secretXYZ'),
  email: j('trader', '@', 'example.com'),
};
const all = Object.values(FAKES);
for (const [name, v] of Object.entries(FAKES)) check(`scrub removes a ${name}`, !scrub(`before ${v} after`).includes(v.replace(/^(Bearer |password=|api_key: ")/, '')) && scrub(`before ${v} after`).includes('before'));
check('scrub keeps ordinary words, a ticker, a clock and a 13-digit epoch', scrub('SPY at 14:03 ET, 1762436523123 ms, session: regular') === 'SPY at 14:03 ET, 1762436523123 ms, session: regular');
check('a URL keeps no query', bareUrl(FAKES.query) === '/api/uw/x');
noteError([`fetch failed with ${FAKES.bearer} and ${FAKES.dataKey}`, new Error(`key ${FAKES.hexKey}`)]);
check('a console error is kept already scrubbed', recentErrors().length === 1 && all.every(v => !recentErrors()[0].message.includes(v)));
const env = {
  page: `/pinpoint/map?${j('access_token', '=', 'zzzLEAK123456')}`,
  ticker: 'SPY',
  version: '1.0.0',
  build: '2026-11-06',
  mode: 'production',
  theme: 'dark',
  themeChoice: 'system',
  viewport: { width: 390, height: 844, dpr: 2 },
  browser: 'Mozilla/5.0 test',
  language: 'en-US',
  zone: 'America/New_York',
  online: true,
  /* fields that are not on the allowlist, smuggled in */
  token: FAKES.jwt,
  localStorage: { slayer_profile: FAKES.email },
  cookie: FAKES.bearer,
} as unknown as ReportEnv;
const report = buildReport(
  { happened: `It broke after I pasted ${FAKES.dataKey} and ${FAKES.card}`, expected: `${FAKES.password}`, steps: `1. ${FAKES.apiKey}\n2. mail ${FAKES.email}\n3. ${FAKES.stripe} ${FAKES.uuid}` },
  env,
  [...recentErrors(), { at: 1, message: `raw ${FAKES.jwt}` }],
  [{ id: 'quotes', label: 'Live quotes', state: 'Down', line: `Not answering ${FAKES.hexKey}` }],
  OPEN,
);
const wire = JSON.stringify(report);
const text = reportText(report);
check('the JSON carries no secret', all.every(v => !wire.includes(v)) && !wire.includes('zzzLEAK123456'));
check('the text carries no secret', all.every(v => !text.includes(v)) && !text.includes('zzzLEAK123456'));
check('nothing outside the allowlist is copied (no token, storage or cookie field)', !/"token"|"localStorage"|"cookie"/.test(wire) && Object.keys(report.diagnostics!.env).sort().join() === 'browser,build,language,mode,online,page,theme,themeChoice,ticker,version,viewport,zone');
check('the page keeps its path, not its query', report.diagnostics!.env.page === '/pinpoint/map');
check('the reader’s words survive around what was removed', report.words.happened.startsWith('It broke after I pasted') && text.includes('What happened'));
check('without diagnostics, none are attached', buildReport({ happened: 'x', expected: '', steps: '' }, null, recentErrors(), [], OPEN).diagnostics === null);
/* the release key prefixes the repo's pre-push grep watches never appear (built at run time here too) */
const watched = [j('td1', '_prod_'), j('1a51', 'd5ce'), j('2581', '6f9b')];
check('none of the watched key prefixes in the report', watched.every(w => !wire.includes(w)));

/* ---- no vendor named in the new surfaces ---- */
console.log('\n-- no vendor named');
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|ts)$/.test(f)) files.push(p);
  }
};
for (const d of ['components/help', 'pages/status', 'pages/changelog', 'pages/report']) walk(join(root, d));
for (const f of ['data/changelog.ts', 'data/banner.ts', 'data/pageGuides.ts', 'data/notices.ts', 'data/freshness.ts', 'data/pathHealth.ts', 'data/diagnostics.ts', 'components/ui/Freshness.tsx']) files.push(join(root, f));
const named = files.filter(f => /thetadata|theta\s+data|unusual\s+whales/i.test(readFileSync(f, 'utf8')));
check(`${files.length} files of the new surfaces name no vendor${named.length ? ` (${named.join(', ')})` : ''}`, named.length === 0);

console.log(`\nsurfaces proof: ${n - fail} of ${n} checks pass`);
if (fail) process.exit(1);
