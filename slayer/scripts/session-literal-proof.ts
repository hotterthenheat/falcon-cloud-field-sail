/*
  Session literals proof (audit "Sessions", 2026-10-31): the session is read through the session module —
  src/core/session.ts (shared/marketSession.mjs: sessionAt, windowAt, phaseAt, regularCloseMin, REGULAR_OPEN_MIN) and
  src/core/calendar.ts (sessionCloseMinOn) — never off a bare clock range. A bare 9*60+30, 16*60, 570 or 960 in a code
  line anywhere else in src/ fails here.

  The files that still spell one are listed in KNOWN with their count today: a ratchet. A count may only fall (lower it
  here when a file is moved onto the module); a new file, or a higher count, fails. Most of what is listed is a drawing
  frame (an axis from 09:30 to 16:00) or the Compass model's own clock (compassParams, compassSession, compassFeatures,
  compassModel, compassStudy — model files, changed only with the model). The surfaces the audit named — book/day.ts,
  ahead.ts, earningsFeed.ts, exposureLog.ts, book/oiChange.ts, book/store.ts, agenda.ts, compassFeed.ts and compassScan's
  sessionsAhead — read the module and are held at zero (or at what compassScan keeps elsewhere).
  Run:  npx tsx scripts/session-literal-proof.ts
*/
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(root, 'src');
/** The session module itself */
const MODULE = new Set(['src/core/session.ts', 'src/core/calendar.ts']);
const LITERAL = /\b9\s*\*\s*60\s*\+\s*30\b|\b16\s*\*\s*60\b|(?<![\w.])(?:570|960)(?![\w.])/g;

/** Files that still spell a session literal, and how many (the ratchet: only ever lowered) */
const KNOWN: Record<string, number> = {
  'src/components/gex/BookThroughDay.tsx': 1,
  'src/components/gex/ExposureField.tsx': 1,
  'src/components/gex/StrikeChart.tsx': 2,
  'src/components/gex/TraderClock.tsx': 2,
  'src/components/layout/footer/parts/field.ts': 2,
  'src/components/record/NewsMap.tsx': 3,
  'src/components/trace/PrintDrilldown.tsx': 1,
  'src/components/vendor/LiveDesk.tsx': 6,
  'src/core/nyTime.ts': 2,
  'src/data/aheadHistory.ts': 1,
  'src/data/book/load.ts': 1,
  'src/data/book/tape.ts': 3,
  'src/data/compassFeatures.ts': 3,
  'src/data/compassModel.ts': 4,
  'src/data/compassOutcome.ts': 2,
  'src/data/compassParams.ts': 17,
  'src/data/compassScan.ts': 5,
  'src/data/compassServer.ts': 1,
  'src/data/compassSession.ts': 20,
  'src/data/compassStudy.ts': 10,
  'src/data/compassTrack.ts': 2,
  'src/data/contractflow.ts': 1,
  'src/data/deskSession.ts': 4,
  'src/data/exposureHistServer.ts': 3,
  'src/data/exposureRecorder.ts': 2,
  'src/data/liveFiles.ts': 2,
  'src/data/moc.ts': 1,
  'src/data/paper/clock.ts': 2,
  'src/data/review/history.ts': 4,
  'src/data/stockFile.ts': 2,
  'src/data/terrainCone.ts': 2,
  'src/data/thetaEligible.ts': 1,
  'src/data/thetaTape.ts': 2,
  'src/data/timeframe.ts': 4,
  'src/data/traceDark.ts': 1,
  'src/data/traceLive.ts': 3,
  'src/data/traceRows.ts': 4,
  'src/data/volOutlook.ts': 4,
  'src/data/weigherChain.ts': 1,
  'src/data/weigherGate.ts': 1,
  'src/pages/compass/Board.tsx': 1,
  'src/pages/landing/products/WeigherPage.tsx': 1,
  'src/pages/record/Earnings.tsx': 1,
  'src/pages/trace/LiveTape.tsx': 1,
  'src/pages/trace/NetFlow.tsx': 2,
  'src/pages/trace/Windows.tsx': 2,
};
/** The surfaces the audit moved onto the session module: none may spell one again */
const MOVED = ['src/data/book/day.ts', 'src/data/ahead.ts', 'src/data/earningsFeed.ts', 'src/data/book/exposureLog.ts', 'src/data/book/oiChange.ts', 'src/data/book/store.ts', 'src/data/agenda.ts', 'src/data/compassFeed.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const codeOf = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');

let fail = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got !== undefined ? ` — ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`);
};

const counts: Record<string, number> = {};
for (const file of walk(SRC)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (MODULE.has(rel)) continue;
  const n = (codeOf(readFileSync(file, 'utf8')).match(LITERAL) ?? []).length;
  if (n) counts[rel] = n;
}
const grown = Object.entries(counts).filter(([f, n]) => n > (KNOWN[f] ?? 0));
check('no file outside the session module spells a session literal it did not already (9*60+30, 16*60, 570, 960)', grown.length === 0, grown.map(([f, n]) => `${f} ${n} (allowed ${KNOWN[f] ?? 0})`).join(', '));
const moved = MOVED.filter(f => counts[f]);
check('the surfaces moved onto the session module spell none', moved.length === 0, moved.join(', ') || `${MOVED.length} files`);
const lower = Object.entries(KNOWN).filter(([f, n]) => (counts[f] ?? 0) < n);
if (lower.length) console.log(`note  lower the ratchet: ${lower.map(([f, n]) => `${f} ${counts[f] ?? 0} (listed ${n})`).join(', ')}`);
check('the detector sees a bare literal', ('if (m >= 9 * 60 + 30 && m < 16*60) x = 570 + 960;'.match(LITERAL) ?? []).length === 4);
check('…and not a longer number or a comment', (codeOf('const a = 15700; const b = 9600.5; // 570\n/* 960 */').match(LITERAL) ?? []).length === 0);

console.log(fail ? `\n${fail} FAILED` : '\nsession literals proof: all checks pass');
process.exit(fail ? 1 : 0);
