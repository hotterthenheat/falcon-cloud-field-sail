/*
  The engine's own would-calls on one built session (the late path every built mark takes, with the shipped trees),
  for the seat check: research/groupb/seatcheck.py runs evaluate.py's seat simulation with the current trees on the
  same session's rows and must call the same contracts at the same marks.
    GB_DATA=... npx tsx research/groupb/would.ts 2022-06-01
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, localTheta } from './localHost';

const day = process.argv[2];
const { setCompassHost } = await import('../../src/data/compassHost');
const scan = await import('../../src/data/compassScan');
const model = await import('../../src/data/compassModel');
const params = await import('../../src/data/compassParams');
const { optionScanOpen, odteAsleep, sessionDayOpen } = await import('../../src/data/compassSession');
const { nyWallTime, nyParts } = await import('../../src/core/nyTime');
const { sessionCloseMinOn } = await import('../../src/core/calendar');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const host = localTheta(day, { net: process.env.GB_NET === '1' });
setCompassHost({
  server: true,
  theta: host.theta,
  asset: async p => {
    const b = fs.readFileSync(path.join(root, 'public', p.replace(/^\/+/, '')));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  econ: () => [],
});
const ymd = day.replace(/-/g, '');
const close = sessionCloseMinOn(day);
model.setScoreClose(ymd, close < 16 * 60 ? close : null);
model.rollModelDay(ymd);
const [y, mo, d] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
const endAt = nyWallTime(y, mo, d, 17, 0);
const calls: { id: string; mark: number; book: string }[] = [];
for (let at = scan.sessionOpenAt(day); at <= endAt; at += 60_000) {
  const p = nyParts(at);
  if (!(params.sessionScanOpen(p.hour * 60 + p.minute, p.weekday) && sessionDayOpen(at))) continue;
  host.setMark(at);
  const jobs = [
    ...(odteAsleep(at) ? [] : scan.odteBook(at).filter(n => optionScanOpen(n, 0, at))).map(sym => ({ sym, sleeve: 'odte' as const })),
    ...scan.WEEKLY_FOCUS.filter(n => optionScanOpen(n, 1, at)).map(sym => ({ sym, sleeve: 'weekly' as const })),
  ];
  for (const j of jobs) {
    const snap = await scan.atMark(j.sym, at, j.sleeve);
    if (!snap.ok || !snap.setups.length) continue;
    await model.scoreBook(snap.setups, at, true, true).catch(() => 'fault');
    for (const s of model.takeWouldPicks()) calls.push({ id: s.id, mark: s.mark ?? at, book: s.band === 'top' ? 'A' : 'B' });
  }
}
fs.writeFileSync(path.join(DATA, `would-${day}.json`), JSON.stringify(calls));
console.log(`${day}: ${calls.length} engine would-calls`);
process.exit(0);
