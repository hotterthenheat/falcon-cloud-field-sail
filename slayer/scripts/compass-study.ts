/*
  A session's review and study, for any day on record: every trade reviewed, every 50%+ mover counted, every scored
  row labelled (.cache/compass/{review,study,labels}/YYYY-MM-DD.*). ThetaData is read through the dev server's
  /api/theta (the hub and its eight-request cap), so run it with the dev server up.

  npm run compass:study -- 20261029        (or 2026-10-29)
  COMPASS_DIR moves the record folder; THETA_VIA the ThetaData base (default http://127.0.0.1:8080/api/theta).
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCompassHost } from '../src/data/compassHost';
import { readDay, thetaAnswer } from '../src/data/compassServer';
import { buildSession } from '../src/data/compassReview';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.slice(2).find(a => /^\d{8}$|^\d{4}-\d{2}-\d{2}$/.test(a));
if (!arg) {
  console.error('Usage: npm run compass:study -- YYYYMMDD');
  process.exit(2);
}
const day = arg.length === 8 ? `${arg.slice(0, 4)}-${arg.slice(4, 6)}-${arg.slice(6, 8)}` : arg;
const dir = process.env.COMPASS_DIR || path.join(root, '.cache', 'compass');
const via = process.env.THETA_VIA || 'http://127.0.0.1:8080/api/theta';
const record = readDay(dir, day);
if (!record) {
  console.error(`No Compass record for ${day} in ${dir}.`);
  process.exit(1);
}
setCompassHost({
  server: true,
  theta: async p => {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(`${via}${p}`, { headers: { 'x-theta-soft': '0' } });
        const got = thetaAnswer(r.status, await r.text(), r.headers.get('content-type') || '');
        /* the terminal drops its session for a minute at a time: wait for it, up to five minutes */
        if (got.error === 'terminal_down' && i < 60) {
          await new Promise(res => setTimeout(res, 5_000));
          continue;
        }
        return got;
      } catch {
        if (i >= 60) return { status: 503, data: null, error: 'terminal_down' };
        await new Promise(res => setTimeout(res, 5_000));
      }
    }
  },
  asset: async p => {
    const b = fs.readFileSync(path.join(root, 'public', p.replace(/^\/+/, '')));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  econ: () => [],
});
const t0 = Date.now();
const { review, study } = await buildSession(dir, day, record, line => console.log(line));
console.log(`\n${day}: ${review.trades.length} trades reviewed, ${study.labels} rows labelled, ${Math.round((Date.now() - t0) / 1000)} s`);
for (const s of ['odte', 'weekly'] as const) {
  const x = study.sleeves[s];
  console.log(`${s === 'odte' ? '0DTE' : '1–7 DTE'}: ${x.names} names, ${x.marks} marks, ${x.contractMarks} contract-marks; ${x.movers} contracts made a 50%+ move (${x.moverMarks} contract-marks); ${x.scored} scored at that mark, ${x.aboveThreshold} at or over the threshold, ${x.called} called`);
}
console.log('Miss reasons:', study.missReasons.map(r => `${r.gate} ${r.n}`).join('; '));
console.log('Inputs holding scores down:', study.heldDownMost.map(r => `${r.name} ${r.n}`).join('; '));
for (const t of review.trades) console.log(`${t.would ? 'WOULD' : 'CALL '} ${t.mark} ${t.contract} Book ${t.book}: ${t.verdict.cause}. ${t.verdict.line}${t.verdict.flags.length ? ` [${t.verdict.flags.join('; ')}]` : ''}`);
console.log('Calibration:', study.calibration.map(c => `${c.bucket} n=${c.n} tp1=${(c.tp1 * 100).toFixed(1)}%`).join(' | '));
for (const s of study.suggestions) console.log(`SUGGEST ${s.change} (n=${s.n}): ${s.evidence}`);
for (const n of study.notes) console.log(`NOTE ${n}`);
process.exit(0);
