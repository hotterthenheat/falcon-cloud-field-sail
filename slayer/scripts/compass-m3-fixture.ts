/*
  Writes scripts/fixtures/compass-m3-sweeps.json: the same-day chain of every recorded Model 3 call at its sweep minute,
  from the terminal's recorded one-minute quotes (16 strikes either side of the recorded spot; the terminal centres
  strike_range on today's price, so the ask is wide and the strikes are kept here). scripts/compass-m3-switch-proof.ts
  replays Model 3 on them offline.
    COMPASS_DIR=<a copy of the record> npx tsx scripts/compass-m3-fixture.ts
  Read-only on the record; one terminal request in flight.
*/
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTerminalHost } from './compassTerminal';
import { compassHost } from '../src/data/compassHost';
import { nyParts, nyWallStamp } from '../src/core/nyTime';
import type { Signal } from '../src/data/compassLedger';

const dir = process.env.COMPASS_DIR;
if (!dir) throw new Error('COMPASS_DIR: a copy of the record');
installTerminalHost();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const days = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const sweeps: unknown[] = [];
for (const f of days) {
  const calls = ((JSON.parse(readFileSync(join(dir, f), 'utf8')) as { calls?: Signal[] }).calls ?? []).filter(c => c.book === 'C' && !c.would);
  for (const call of calls) {
    const mark = call.mark ?? Math.floor(call.firedAt / 60_000) * 60_000;
    const p = nyParts(mark);
    const hm = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00`;
    const day = call.day.replace(/-/g, '');
    const got = await compassHost().theta(`/option/history/quote?symbol=${call.ticker}&expiration=${call.expiry.replace(/-/g, '')}&start_date=${day}&end_date=${day}&strike=*&interval=1m&start_time=${hm}&end_time=${hm}&format=json`);
    const quotes: { strike: number; right: 'C' | 'P'; bid: number; ask: number; bidSize?: number; askSize?: number; t: number }[] = [];
    for (const item of Array.isArray(got.data) ? got.data : []) {
      const row = item as { contract?: Record<string, unknown>; data?: Record<string, unknown>[] };
      const q = (row.data ?? []).filter(d => nyWallStamp(d.timestamp) <= mark + 59_000).pop();
      const strike = Number(row.contract?.strike);
      if (!q || !(strike > 0)) continue;
      quotes.push({ strike, right: String(row.contract?.right ?? '').toUpperCase().startsWith('C') ? 'C' : 'P', bid: Number(q.bid), ask: Number(q.ask), ...(q.bid_size != null ? { bidSize: Number(q.bid_size), askSize: Number(q.ask_size) } : {}), t: nyWallStamp(q.timestamp) });
    }
    const spot = call.spot ?? 0;
    const strikes = [...new Set(quotes.map(q => q.strike))].sort((a, b) => a - b);
    let atm = 0;
    strikes.forEach((k, i) => {
      if (Math.abs(k - spot) < Math.abs(strikes[atm] - spot)) atm = i;
    });
    const keep = new Set(strikes.filter((_, i) => Math.abs(i - atm) <= 16));
    const kept = quotes.filter(q => keep.has(q.strike)).sort((a, b) => a.strike - b.strike || (a.right === 'C' ? -1 : 1));
    sweeps.push({ day: call.day, ticker: call.ticker, expiry: call.expiry, mark, spot, recorded: call.contract, quotes: kept });
    console.log(`${call.day} ${call.ticker} ${hm}: ${kept.length} quotes (recorded ${call.contract})`);
  }
}
writeFileSync(join(root, 'scripts', 'fixtures', 'compass-m3-sweeps.json'), `${JSON.stringify({ note: 'Recorded one-minute quotes at each recorded Model 3 sweep minute (scripts/compass-m3-fixture.ts)', sweeps })}\n`);
process.exit(0);
