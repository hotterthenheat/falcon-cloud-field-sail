# EDGE-B results (2026-11-05): no candidate survives; nothing frozen

Pre-registration: `specs/PREREG.md` @ 4fb4b12 (F3 amendment A1 @ 240ac41, made before any F3 outcome).
Global ledger lines: /home/user/falcon-cloud-field-sail/research-v2-ledger.md (EDGE-B rows).
Data: /home/user/falcon-cloud-field-sail/v2data/edge-b (466 MB): UW flow alerts 428,520 rows and dark-pool prints
182,042 rows (both DEV+VAL only), ThetaData 1-second stock NBBO windows, and 1-second option NBBO for the 963 F1 DEV trades.

## Data depth
- UW token: history from **2023-12-06** only (rolling 2-year window; the start moves forward every day, so the raw
  pulls are cached here). DEV = 2023-12-06..2024-12-31 without Aug 2024 (245-247 sessions); VAL = 2025-04..12 (189-190).
- UW news: per ticker back to ~2026-08-06, global back to 2026-09-17. **All of it falls in the LOCKED TEST window.** F2 not run.
- Flow alerts: UW `created_at` lags the last fill by 2.5-30 s (median 7.7 s). It is the decision stamp used, so the
  test is live-realistic.

## Every test run (EDGE-B: 59 looks + 1 pipeline check)
| id | set | n | result | null pass rates | verdict |
|---|---|---|---|---|---|
| F1-A1 flow >=$250k, Stage A (4 horizons) | DEV | 1794 | h30 **+6.9 bp [+2.1, +11.9]**, perm p .007; win 50% | perm 2.0%, synth 3.5% | gate pass |
| F1-A2 >=$1M, Stage A | DEV | 127 | h30 +7.1 bp [-14.6, +29.9] p .40 | 3-3.5% | fail |
| F1-A3 sweeps, Stage A | DEV | 923 | h30 +4.0 bp [-3.5, +11.2] p .14 | 5%, 3% | fail |
| F1-A1 Stage B, 27 exits, 0.30 delta, 1-9 DTE | DEV | 963 | best -2.03%/trade [-3.66, -0.38] with fee (-1.20% without), win 37%; all 27 exits negative; opposite side -4.2% | shuffle beats 85%; shuffle-null CI pass 0%; synth (rv) 3.3%; synth (iv, no-edge) mean -2.70%, pass 0%; PBO 0.43; DSR ~0 | **fail** |
| F1-A1/A2/A3 Stage A, confirmation | VAL | 1874/105/826 | A1 h30 **-1.2 bp [-7.0, +4.1]** p .77: the DEV drift does not replicate. A3 h15 +5.6 bp p .008 (failed DEV; 1 of 12 VAL looks) | 1-7% | fail |
| F3-D1 dark pool >=$5M at/through the NBBO, Stage A | DEV | 2500 | h30 +0.4 bp [-1.8, +2.6] p .38 | 2-5.5% | fail |
| F3-D2 >=$20M, Stage A | DEV | 635 | h30 +1.1 bp p .29; h5 +2.2 bp [+0.6, +3.8] p .007 | 0.5-4% | fail |
| F2 news | - | 0 | not testable: no DEV or VAL data | - | not run |

The null false-pass rates sit at 0-7% per look (mostly 2-5%), so the pipeline is calibrated. The pricing-consistent
synthetic null (path vol = option IV, zero drift) costs -2.7% a trade, which is the spread plus the fee. The real F1
trades did only about 0.7 points better than that no-edge world.

## Verdict
None of the three families shows an exploitable edge after realistic fills. Aggressive short-dated OTM flow carries a
small, unstable directional footprint in the underlying: +7 bp over 30 min in 2024, nothing in 2025. That is far too
little to pay a 0.30-delta option's spread (median 1.7%) plus its decay and fees. Dark-pool blocks at or through the
quote show no 30-minute direction. Nothing is frozen and the blind scorer has nothing to score.

Proposal for F2: record UW headlines live, starting now, and split forward-only: first 40 sessions DEV, next 40
VAL, then a fresh locked block. Or buy a historical news feed. The protocol split cannot be applied to it as written.
