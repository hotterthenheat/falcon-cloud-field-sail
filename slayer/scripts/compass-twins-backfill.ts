/*
  The forward test over a Compass record that has no twins yet (the engine fills them in by itself from recorded
  quotes; this does the same offline, for a copy of the record): every official call's random-side twin is made and
  settled by the engine's own code (data/compassTwins.ts settleTwins) on the terminal's recorded quotes, written to
  <dir>/twins/YYYY-MM-DD.json in the engine's format, and the forward test is printed.
    COMPASS_DIR=<a copy of .cache/compass> npx tsx scripts/compass-twins-backfill.ts [--csv out.csv]
  Never point it at the live engine's folder while the engine runs: it writes twin files there.
*/
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installTerminalHost, terminalReads } from './compassTerminal';
import { importTwins, settleTwins, twinRows, type Twin } from '../src/data/compassTwins';
import { forwardCsv, forwardTest, rateWords } from '../src/data/compassForward';
import { TWINS_FORMAT } from '../src/data/compassServer';
import type { Signal } from '../src/data/compassLedger';
import { sessionIso } from '../src/data/compassSession';

const dir = process.env.COMPASS_DIR;
if (!dir) throw new Error('COMPASS_DIR: a copy of the record');
installTerminalHost();

const days = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort();
const calls: Signal[] = days.flatMap(d => (JSON.parse(readFileSync(join(dir, `${d}.json`), 'utf8')) as { calls?: Signal[] }).calls ?? []);
const kept: Twin[] = days.flatMap(d => {
  try {
    return (JSON.parse(readFileSync(join(dir, 'twins', `${d}.json`), 'utf8')) as { twins?: Twin[] }).twins ?? [];
  } catch {
    return [];
  }
});
importTwins(kept);
console.log(`${calls.length} calls on ${days.length} sessions; ${kept.length} twins kept`);

/* passes until every twin is settled for good (closed or unavailable) or a pass changes nothing */
let at = Date.now();
for (let pass = 0; pass < 40; pass++) {
  const before = JSON.stringify(twinRows().map(t => [t.key, t.outcome?.status, t.outcome?.exit?.at]));
  await settleTwins(calls, at, 1_000);
  at += 600_000;
  const open = twinRows().filter(t => !t.outcome || t.outcome.status === 'open' || t.outcome.status === 'waiting').length;
  console.log(`pass ${pass + 1}: ${twinRows().length} twins, ${open} not settled, ${terminalReads} terminal reads`);
  if (!open && twinRows().length >= calls.filter(c => c.book !== 'R').length) break;
  if (JSON.stringify(twinRows().map(t => [t.key, t.outcome?.status, t.outcome?.exit?.at])) === before && pass > 2) break;
}

mkdirSync(join(dir, 'twins'), { recursive: true });
for (const d of days) {
  const list = twinRows().filter(t => sessionIso(t.firedAt) === d);
  if (list.length) writeFileSync(join(dir, 'twins', `${d}.json`), JSON.stringify({ format: TWINS_FORMAT, day: d, savedAt: Date.now(), twins: list }));
}

const ft = forwardTest(calls, twinRows());
for (const l of ft.lines) {
  console.log(`\n${l.label}: ${l.calls.n} closed calls over ${l.calls.days} sessions, won ${rateWords(l.calls)}, net $${l.calls.net}`);
  const b = (m: { mean: number | null; lo: number | null; hi: number | null }) => `${m.mean?.toFixed(1)} [${m.lo?.toFixed(1)}, ${m.hi?.toFixed(1)}]`;
  console.log(`  calls  $/call ${b(l.calls.perCall)}  %prem ${b(l.calls.perPremium)}`);
  console.log(`  paired ${l.paired.n}: calls ${rateWords(l.paired)} $/call ${b(l.paired.perCall)} | twins ${rateWords(l.twins)} $/call ${b(l.twins.perCall)} net $${l.twins.net}`);
  console.log(`  coin flip $/call ${b(l.coin.perCall)}; call − twin ${b(l.edge)}; beat ${l.beatsCoin ?? '— (under 5 sessions)'} of 2000 coin-flip records; unpaired ${l.unpaired}`);
}
console.log(`\nsessions ${ft.sessions} of ${ft.target}`);
const csvAt = process.argv.indexOf('--csv');
if (csvAt > 0) writeFileSync(process.argv[csvAt + 1], forwardCsv(calls, twinRows()));
process.exit(0);
