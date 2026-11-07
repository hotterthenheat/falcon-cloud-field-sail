/* The proxy's expiry check (server/expiryCheck.mjs) against the live terminal, on the 2026-11-07 audit's cases
   (scripts/fixtures/expiry-audit-2026-11-06.json): which of the 56 phantom dates the terminal still lists and whether
   any is offered, and whether each of the 18 new listings is offered. One request in flight, nothing else.
     node scripts/expiry-check-live.mjs        (THETA_URL, default http://127.0.0.1:25503/v3) */

import { readFileSync } from 'node:fs';
import { createExpiryCheck } from '../server/expiryCheck.mjs';
import { expirationsIn } from '../shared/expiryEvidence.mjs';

const THETA = process.env.THETA_URL || 'http://127.0.0.1:25503/v3';
const F = JSON.parse(readFileSync(new URL('./fixtures/expiry-audit-2026-11-06.json', import.meta.url), 'utf8'));
let asked = 0;
const load = async (p) => {
  asked += 1;
  const res = await fetch(`${THETA}${p}`, { signal: AbortSignal.timeout(120_000) });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
};
const lines = [];
const check = createExpiryCheck({ load, log: (l) => lines.push(l), fallbackOf: () => undefined });
const raw = new Map();
const offered = new Map();
for (const root of [...new Set(Object.values(F.roots).flat())].sort()) {
  const got = await check.answer(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=csv`);
  offered.set(root, got.status === 200 ? expirationsIn(String(got.body)) : new Set());
  raw.set(root, expirationsIn(String((await load(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=csv`)).body)));
}
const any = (m, c) => (F.roots[c.symbol] ?? [c.symbol]).some((r) => m.get(r)?.has(c.date));
const stillListed = F.phantom.filter((c) => any(raw, c));
const phantomOffered = F.phantom.filter((c) => any(offered, c));
const newListed = F.new.filter((c) => any(raw, c));
const newOffered = F.new.filter((c) => any(offered, c));
console.log(`terminal requests: ${asked}`);
console.log(`phantom dates: ${F.phantom.length}; still on the terminal's list today: ${stillListed.length}; offered after the check: ${phantomOffered.length}${phantomOffered.length ? ` (${phantomOffered.map((c) => `${c.symbol} ${c.date}`).join(', ')})` : ''}`);
console.log(`new listings: ${F.new.length}; on the terminal's list today: ${newListed.length}; offered after the check: ${newOffered.length}`);
for (const c of F.new) console.log(`  ${c.symbol} ${c.date}: list ${any(raw, c) ? 'has it' : 'lacks it'}, offered ${any(offered, c) ? 'yes' : 'NO'}`);
console.log('verdicts logged:');
for (const l of lines) console.log(`  ${l}`);
process.exit(phantomOffered.length || newOffered.length < F.new.length ? 1 : 0);
