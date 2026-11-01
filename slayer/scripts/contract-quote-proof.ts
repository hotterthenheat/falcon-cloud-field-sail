/**
 * Consistency proofs for the compass contract quote.
 * Run: npx tsx scripts/contract-quote-proof.ts
 */
import assert from 'node:assert/strict';
import {
  OPTION_MULTIPLIER,
  STOP_KEEP,
  entryGate,
  expirationBreakeven,
  extrinsicValue,
  intrinsicValue,
  lossAtStop,
  maxPremiumLoss,
  quoteContract,
  quoteMissing,
  quoteStale,
} from '../src/data/contractQuote.ts';

assert.equal(expirationBreakeven(120, 1.5, 'P'), 118.5);
assert.equal(expirationBreakeven(120, 1.5, 'C'), 121.5);

assert.equal(intrinsicValue(119, 120, 'P'), 1);
assert.equal(intrinsicValue(119, 120, 'C'), 0);
assert.equal(extrinsicValue(1.25, 1), 0.25);

const put = quoteContract({
  ticker: 'NVDA',
  contract: 'NVDA 120P',
  strike: 120,
  right: 'P',
  spot: 119,
  bid: 1.2,
  ask: 1.3,
  ivPct: 35,
  quotedAt: 1_700_000_000_000,
  source: 'theta',
});

assert.equal(put.mid, 1.25);
assert.equal(put.mark, put.mid);
assert.ok(Math.abs(put.intrinsic + put.extrinsic - put.mark) < 1e-9);
assert.equal(put.entryPremium, 1.3);
assert.equal(put.fill, null);
assert.equal(put.breakeven, 120 - 1.3);
assert.ok(Math.abs(put.stopPremium - 1.3 * STOP_KEEP) < 1e-12);
assert.ok(Math.abs(put.lossAtStop - (1.3 - put.stopPremium) * OPTION_MULTIPLIER) < 1e-9);
assert.equal(put.maxPremiumLoss, 1.3 * OPTION_MULTIPLIER);
assert.ok(put.maxPremiumLoss > put.lossAtStop);
assert.equal(put.fees, null);
assert.notEqual(put.stopPremium, put.spot);

const call = quoteContract({
  ticker: 'NVDA',
  contract: 'NVDA 120C',
  strike: 120,
  right: 'C',
  spot: 121,
  bid: 2,
  ask: 2.1,
  ivPct: 35,
  quotedAt: 1_700_000_000_000,
});
assert.equal(call.breakeven, 120 + 2.1);
assert.equal(call.intrinsic, 1);
assert.ok(Math.abs(call.intrinsic + call.extrinsic - call.mark) < 1e-9);

assert.equal(quoteMissing(put), false);
assert.equal(quoteStale(put.quotedAt, put.quotedAt + 9_000, false), true);
assert.equal(quoteStale(put.quotedAt, put.quotedAt + 1_000, false), false);

assert.deepEqual(entryGate({ sessionOpen: false, expired: true, quoteOk: true, executionQuote: false }), {
  eligible: false,
  reason: 'Expired — entry unavailable',
});
assert.equal(entryGate({ sessionOpen: false, expired: false, quoteOk: true, executionQuote: true }).eligible, false);
assert.equal(entryGate({ sessionOpen: true, expired: false, quoteOk: true, executionQuote: false }).eligible, false);
assert.equal(entryGate({ sessionOpen: true, expired: false, quoteOk: true, executionQuote: true }).eligible, true);

assert.equal(lossAtStop(1, 0.5), 50);
assert.equal(maxPremiumLoss(1), 100);

console.log('contract-quote-proof ok');
