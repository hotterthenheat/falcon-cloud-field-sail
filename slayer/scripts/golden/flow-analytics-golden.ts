/*
  Flow analytics golden: CI runs every scripts/golden/*-golden.ts, so this runs scripts/flow-analytics-proof.ts —
  rolls, repeat clusters and the dark baseline on hand-built rows and the recorded 2026-10-28 SPY tape
  (fixtures/golden/trace-2026-10-29). It exits non-zero on any failure.
  Run:  npx tsx scripts/golden/flow-analytics-golden.ts
*/
import '../flow-analytics-proof';
