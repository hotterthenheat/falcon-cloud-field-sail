/*
  Tape cache proof (audit §10 DL6): the chart tape's slots and prints (src/data/thetaTape.ts) are bounded to about
  twelve panes (TAPE_PANES). Once a thirteenth is made, the least recently used one no pane wants is let go: the newest
  are kept, a read or a want marks one used, and a slot a pane still wants is never let go however many are wanted.
  The real stores are driven through wantTape / wantPrint / peekTape. The page is set to a Trace address, where the
  tape asks nothing (data/theta.ts thetaUseHere), so no request leaves the process.
  Run:  npx tsx scripts/tape-cache-proof.ts
*/
(globalThis as { location?: unknown }).location = { pathname: '/trace/live-tape' };
const tape = await import('../src/data/thetaTape');
const { TAPE_PANES, wantTape, wantPrint, peekTape, heldTapeKeys, heldPrintNames } = tape;

let fail = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got !== undefined ? ` — ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`);
};
const names = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(2, '0')}`);
const key = (s: string) => `${s}|1m|rth`;
const held = () => heldTapeKeys();
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

check('twelve panes', TAPE_PANES === 12, TAPE_PANES);

/* 1. twenty tapes opened and closed in turn: the newest twelve are kept, oldest first */
for (const s of names('A', 1, 20)) wantTape(s, '1m', 'rth')();
check('20 tapes drawn and closed: the newest 12 kept (A09…A20), A01…A08 let go', same(held(), names('A', 9, 20).map(key)), held().map(k => k.split('|')[0]).join(' '));

/* 2. a read marks one used: A09, the oldest, is peeked, then one more tape is drawn — A10 goes, not A09 */
peekTape('A09', '1m', 'rth');
wantTape('A21', '1m', 'rth')();
check('a tape read again is kept: after peeking A09, the next new tape lets go A10, not A09', held().includes(key('A09')) && !held().includes(key('A10')) && held()[held().length - 1] === key('A21') && held().length === 12, held().map(k => k.split('|')[0]).join(' '));

/* 3. wanted tapes are never let go: three panes keep B1…B3 open while twenty more are drawn and closed */
const keepOpen = ['B1', 'B2', 'B3'].map(s => wantTape(s, '1m', 'rth'));
for (const s of names('C', 1, 20)) wantTape(s, '1m', 'rth')();
const h3 = held();
check('three tapes still open survive twenty newer ones; the other nine are the newest (C12…C20)', ['B1', 'B2', 'B3'].every(s => h3.includes(key(s))) && same(h3.filter(k => k.startsWith('C')), names('C', 12, 20).map(key)) && h3.length === 12, h3.map(k => k.split('|')[0]).join(' '));
keepOpen.forEach(release => release());

/* 4. more panes than the bound: fifteen open at once are all held; closing them lets go the oldest three */
const fifteen = names('D', 1, 15).map(s => wantTape(s, '1m', 'rth'));
check('fifteen tapes open at once: all fifteen held, none let go while wanted', names('D', 1, 15).every(s => held().includes(key(s))), held().length);
fifteen.forEach(release => release());
check('… closed in turn: the newest twelve kept (D04…D15)', same(held(), names('D', 4, 15).map(key)), held().map(k => k.split('|')[0]).join(' '));

/* 5. a new tape is never let go by its own arrival, even with twelve already wanted */
const twelve = names('E', 1, 12).map(s => wantTape(s, '1m', 'rth'));
const thirteenth = wantTape('E13', '1m', 'rth');
check('a thirteenth wanted tape is held beside twelve wanted ones', held().includes(key('E13')) && names('E', 1, 12).every(s => held().includes(key(s))), held().length);
[...twelve, thirteenth].forEach(release => release());

/* 6. one name, many grains and sessions: each is its own slot under the same bound */
for (const g of ['15s', '1m', '5m', '15m', '30m', '1h', 'day', 'week'] as const) for (const ses of ['rth', 'pre'] as const) wantTape('F', g, ses)();
check('sixteen grain × session tapes of one name: twelve kept, the last made newest', held().length === 12 && held()[11] === 'F|week|pre', held().slice(-3).join(' '));

/* 7. the prints, the same way */
for (const s of names('P', 1, 20)) wantPrint(s)();
check('20 prints wanted and released: the newest 12 kept (P09…P20)', same(heldPrintNames(), names('P', 9, 20)), heldPrintNames().join(' '));
const pinned = wantPrint('P01');
for (const s of names('Q', 1, 20)) wantPrint(s)();
check('a print still wanted survives twenty newer ones', heldPrintNames().includes('P01') && heldPrintNames().length === 12 && same(heldPrintNames().filter(n => n.startsWith('Q')), names('Q', 10, 20)), heldPrintNames().join(' '));
pinned();

/* 8. one regular-session window for every reader of minute bars (audit §10 DL7): the chart's tape, the Weigher's, the
   book's day tape and the vol outlook ask the same start and end, so a name's day is one request in the hub's cache.
   The book's tape used to end at 16:15:59.999 and the chart's at 15:59:59.999: two requests for the same minutes. */
{
  const { readFileSync } = await import('node:fs');
  const { RTH_WINDOW, EXT_WINDOWS } = await import('../src/data/thetaEligible');
  const { minutePath } = await import('../src/data/volOutlook');
  const readers = ['src/data/thetaTape.ts', 'src/data/weigherTape.ts', 'src/data/book/tape.ts', 'src/data/volOutlook.ts'];
  const root = new URL('..', import.meta.url);
  const spelled = readers.filter(f => {
    const code = readFileSync(new URL(f, root), 'utf8')
      .split('\n')
      .filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join('\n');
    return /end:\s*'1[56]:(59|15):59\.999'|end_time=1[56]:/.test(code) || /start:\s*'09:30:00'/.test(code);
  });
  check('no reader of minute bars spells its own regular-session window; all take RTH_WINDOW', spelled.length === 0, spelled.join(', ') || readers.length + ' readers');
  check('the window ends on 15:59\'s last millisecond, the post window opens on 16:00', RTH_WINDOW.start === '09:30:00' && RTH_WINDOW.end === '15:59:59.999' && EXT_WINDOWS.post.start === '16:00:00');
  const p = minutePath('SPY', '20261029', '20261029');
  check('the vol outlook\'s read carries the shared window', p.includes(`start_time=${RTH_WINDOW.start}&end_time=${RTH_WINDOW.end}`), p);
  const book = readFileSync(new URL('src/data/book/tape.ts', root), 'utf8');
  check('the book\'s day tape asks RTH_WINDOW first and keeps the post window for the 16:00–16:15 index tail', /const windows = \[\s*RTH_WINDOW,\s*EXT_WINDOWS\.pre,\s*EXT_WINDOWS\.post,/.test(book));
}

console.log(fail ? `\n${fail} FAILED` : '\ntape cache proof: all checks pass');
process.exit(fail ? 1 : 0);
