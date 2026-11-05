# Compass v2 global research ledger (append only)

One line per hypothesis/variant/look: date | worker | id | set | n | result | note.

2026-11-05 | EDGE | K5 (challenger, frozen 2026-10-31) | DEV re-run (320 non-H2 sessions, no H2 row read) | 60 | win 83.3% [73.2,92.2], +37.7%/call [+29.1,+44.6] (fee +37.3%) | reproduction only; H2 look handed to the blind scorer (edge/specs/K5.spec.md); prior trials 155
2026-11-05 | EDGE | PREREG E1 MOM-CLOSE | spec | - | registered, 8 variants | edge/specs/PREREG.md
2026-11-05 | EDGE | PREREG E2 OPEN-REV | spec | - | registered, 4 variants | edge/specs/PREREG.md
2026-11-05 | EDGE | PREREG E3 GAMMA-BREAK | spec | - | registered, 4 variants (2 hypothesis + 2 contrast) | edge/specs/PREREG.md
2026-11-05 | EDGE-B | PREREG F1 FLOW (informed aggressive short-dated OTM option flow) | spec | - | registered: Stage A 3 variants x 4 horizons (12 looks), Stage B 27 exits per gate passer | edge-b/specs/PREREG.md @ 4fb4b12
2026-11-05 | EDGE-B | PREREG F2 NEWS (headline drift) | spec | - | NOT TESTABLE: UW headlines start 2026-08-06, all inside LOCKED TEST; 0 trials | edge-b/specs/PREREG.md @ 4fb4b12
2026-11-05 | EDGE-B | PREREG F3 DARKPOOL (block at/through NBBO) | spec | - | registered: Stage A 2 variants x 4 horizons (8 looks), Stage B 27 exits per gate passer | edge-b/specs/PREREG.md @ 4fb4b12
2026-11-05 | FOUNDATION | PREREG BASELINE B1-B3 (no-edge references: B1 random side 0.30d 0DTE at 10:00; B2 0DTE ATM straddle 09:35; B3 side of first-15-min move 0.30d; all vol-scaled 1.0x bracket on 30-min RV or 15:50) | spec | - | baseline reference, 3 variants, expected sign <= 0 after costs; not candidates | compass-v2/baselines/strategies.py @ 6e280f9 (smoke-run once on 2024-04-17 while debugging the engine)
2026-11-05 | EDGE | PREREG E1-E3 commit | - | - | specs/PREREG.md + specs/K5.spec.md @ c45a7d2 (branch worktree-agent-a460ec9b7e819b473) | before any DEV outcome
2026-11-05 | EDGE-B | F1-A1 Stage A (flow >=$250k ask-side OTM <=7DTE, underlying drift) | DEV | 1794 ev / 245 sess | h5 +2.3bp [+0.2,+4.7] p.022; h15 +2.5 [-1.3,+6.2]; h30 +6.9bp [+2.1,+11.9] perm p .007 (GATE PASS, Bonferroni .0167); h60 +6.8 [+0.8,+13.3]; win 50% | nulls: perm CI-pass 2.0%, synthetic CI-pass 3.5% (h30)
2026-11-05 | EDGE-B | F1-A2 Stage A (>= $1M) | DEV | 127 ev | h30 +7.1bp [-14.6,+29.9] p .40 | gate FAIL
2026-11-05 | EDGE-B | F1-A3 Stage A (>= $250k sweeps) | DEV | 923 ev | h30 +4.0bp [-3.5,+11.2] p .14 | gate FAIL
2026-11-05 | EDGE-B | PREREG F3 amendment A1 (trade_settlement regular/null, trade_code null/ISO) | spec | - | registered before any F3 outcome | edge-b/specs/PREREG.md @ 240ac41
2026-11-05 | EDGE-B | F1-A1 Stage B (0.30d same-side option, 1-9 DTE, 27 adaptive exits) | DEV | 963 tr / 232 sess | best exit (kt2.0,ks1.0,T30) -2.03%/tr [-3.66,-0.38] fee-incl (-1.20% no fee), win 36.7%, median -5.8%; ALL 27 exits negative (-2.0..-3.3%); opposite side same exit -4.2% | shuffle beats 85% (<95%), shuffle-null CI pass 0%, synthetic CI pass 3.3%, PBO 0.43, DSR 0.00 (260 trials) -> FAIL, not frozen
2026-11-05 | EDGE-B | F1-A1/A2/A3 Stage A confirmatory look | VAL | A1 1874 ev/189 sess | A1 h30 -1.2bp [-7.0,+4.1] p .77 (DEV drift does NOT replicate); A2 h30 -0.1bp p .46; A3 h15 +5.6bp [+1.5,+9.6] p .008, h30 +4.9 [-0.5,+10.5] (A3 failed DEV; 12 VAL looks -> not pursued) | nulls CI-pass 1-7%
2026-11-05 | EDGE-B | F1-A1 Stage B pricing-consistent synthetic null (path vol = option IV) | DEV | 963 tr x 60 reps | no-edge best-exit mean -2.70%/tr, CI-pass 0% (real signal -2.03% ~ no-edge +0.7pt) | pipeline check, not a hypothesis
2026-11-05 | BLIND | K5 | LOCKED TEST (one look) | 59 | 252/253 locked sessions (2025-01-08 not built). Spec exit on rows: win 88.1% [79.1, 95.9], +41.7%/trade [+34.8, +47.5] (fee +41.4% [+34.5, +47.2]), payoff 1.36, maxDD -160% cum/-$1187 per ct; regimes 2022 n16 +50.0%, 2024 n5 -11.9%, 2025-Q1 n9 +50.0%, 2026-H2 n29 +43.8%. Same 59 calls, protocol-2 execution (foundation sim, 1-s NBBO, ask in/bid out, +2 s, displayed size): TP-win 76.3% [64.7, 86.7], gross +34.7% [+24.9, +43.2], net +34.4% [+24.6, +42.9], payoff 1.71, maxDD -128%/-$855; regimes 2022 +30.5%, 2024 -17.6%, 2025-Q1 +45.3%, 2026-H2 +42.8%. Repro: worktree-agent-a537945bf25597d8c slayer/research/compass-v2/blind/ (BLIND_SCORER=1 python3 k5_locked.py; k5_locked_exec.py) | spec sha256 4c181938a0d0408b91814b41dcee12ee0532d202f02c32cd6e49d29006a667f3 (blob 73a09c2a @ c45a7d2)
2026-11-05 | EDGE | E1 MOM-CLOSE z0.5-X1 | DEV | 848 | win 17% [13,21], exp -8.0% [-21.1,+7.1] net | FAIL
2026-11-05 | EDGE | E1 MOM-CLOSE z0.5-X2 | DEV | 848 | win 40% [35,44], exp -5.5% [-10.5,-0.1] net | FAIL (best variant); shuffled null beats 86%
2026-11-05 | EDGE | E1 MOM-CLOSE z0.5-X3 | DEV | 848 | win 30% [25,34], exp -8.4% [-15.5,-1.4] net | FAIL
2026-11-05 | EDGE | E1 MOM-CLOSE z1.0-X1 | DEV | 490 | win 17% [12,21], exp -12.2% [-27.5,+7.5] net | FAIL
2026-11-05 | EDGE | E1 MOM-CLOSE z1.0-X2 | DEV | 490 | win 39% [33,45], exp -7.0% [-13.3,-0.7] net | FAIL
2026-11-05 | EDGE | E1 MOM-CLOSE z1.0-X3 | DEV | 490 | win 29% [23,35], exp -9.5% [-19.2,-0.5] net | FAIL; E1 PBO 0.59, DSR 0.00 at N=292
2026-11-05 | EDGE | PREREG E6 CHARM-PIN | spec | - | registered, 2 variants (after E1 DEV fail, before any E6 look) | edge/specs/PREREG.md
2026-11-05 | EDGE | E1 synthetic zero-drift null (z0.5-X2, 100 runs) | DEV-synthetic | ~921/run | null mean -14.2%, p95 -11.3%, null pass rate 0% | pipeline FDR ok; real -5.5% beats synthetic but is negative
2026-11-05 | EDGE | E2 OPEN-REV a0.35-Y1 | DEV | 125 | win 50% [40,61], exp -7.5% [-14.2,-0.4] net | FAIL (<150 trades and negative)
2026-11-05 | EDGE | E2 OPEN-REV a0.35-Y2 | DEV | 125 | win 50% [40,61], exp -5.9% [-12.6,+1.0] net | FAIL
2026-11-05 | EDGE | E2 OPEN-REV a0.6-Y1 | DEV | 19 | win 63%, exp -0.2% [-20.8,+16.6] | FAIL (n)
2026-11-05 | EDGE | E2 OPEN-REV a0.6-Y2 | DEV | 19 | win 74%, exp +8.8% [-7.5,+21.0] | FAIL (n=19; shuffled null beats 96%)
2026-11-05 | EDGE-B | F3-D1 Stage A (dark-pool print >= $5M at/through NBBO, 24 names) | DEV | 2500 ev (of 3970) / 247 sess | h5 -0.0bp; h15 +1.3 [-0.5,+3.0] p .12; h30 +0.4bp [-1.8,+2.6] p .38; h60 -0.2 | gate FAIL; nulls CI-pass 2-5.5%
2026-11-05 | EDGE-B | F3-D2 Stage A (>= $20M) | DEV | 635 ev / 228 sess | h5 +2.2bp [+0.6,+3.8] p .007 (secondary horizon, 2bp cannot pay an option spread); h30 +1.1bp [-2.1,+4.1] p .29 | gate FAIL; no Stage B, no VAL look
2026-11-05 | EDGE-B | SUMMARY | - | - | 59 looks + 1 pipeline check; F1 fails (DEV Stage B, VAL drift), F3 fails gate, F2 untestable; NOTHING FROZEN | edge-b/RESULTS.md @ 8a09354
2026-11-05 | REDTEAM | K5 attack 1 LOOK-AHEAD (code trace + reconstruction) | LOCKED (red-team looks, post-blind) | 59/64/252 | BROKEN: rows exist only where Book A gate dist<=4 strikes from ATM(tape.S); on the replay tapeOf returns day D's 09:30 OPEN for every pre-open mark (retOpen==0 on 100% of overnight rows, dev and locked); 59/59 locked calls: open moved toward the strike, median |K-S_mark| 43.8 pts vs |K-open| 17.6. Rebuilt from a +-40-strike chain fetch (253 nights, 87 MB): with the future-open gate n=64 win 82.8% +36.3% (reproduces); gate from the spot at the mark (live) n=2, 2 stops; NO gate (spec rule on the real chain) n=252 win 40.1% [34.1,46.4], -7.7%/trade [-13.7,-1.5] | slayer/research/compass-v2/redteam/{TRACE.md,k5_honest.py,a1_*.csv}
2026-11-05 | REDTEAM | K5 attack 2 FILL REALISM (59 locked 1-s NBBO) | LOCKED | 59 | SURVIVED: spread at fill median $0.20 (4.1% of fill), 95th $0.50 (7.6%); displayed ask size median 29 (min 1); 0 locked/0 crossed over 649k state changes; ask stale >60 s at entry 5/59; next-5-tick ask min <= fill 58/59 | redteam/a2_fills.py
2026-11-05 | REDTEAM | K5 attack 3 SURVIVORSHIP | LOCKED | 252 | BROKEN: called nights have |open - S(00:00)| median 25.7 pts vs 9.1 on uncalled; gap |open - prior close| 32 vs 14; 64/64 the open lies on the strike's side; no post-open trend difference (|close-open| 27.6 vs 31.6) | redteam/a3_survivorship.py
2026-11-05 | REDTEAM | K5 attack 4 REGIME (as scored, exec net) | LOCKED | 59 | WEAKENED even before attack 1: drop top-3 +32.2%; ex-2022&2026 n=14 +22.5% [-0.2,+42.9]; high-IV tercile +20.7% [-1.3,+40.0]; 2024 n=5 -17.8%; 00:xx marks +21.4% [-0.2,+41.1] | redteam/a4_regime.py
2026-11-05 | REDTEAM | K5 attack 5 MULTIPLE TESTING | LOCKED | 59 | as scored DSR 0.995 at N=156 (SR/trade 0.97); CSCV 27-config neighbourhood (delta band x TP x stop) WITH the leak: PBO 0.055, 27/27 positive (not a cliff: the whole neighbourhood inherits the leak); honest universe: 0/27 positive (-4.4..-9.2%/session) | redteam/k5_honest_report.py
2026-11-05 | REDTEAM | K5 attack 6 DATA GENUINENESS | LOCKED | 252 | SURVIVED: every overnight quote row exchange code 5 (same as 09:00-09:29; Cboe-only product), 359/359 night minutes quoted (median), 00:00 row is a date-boundary ask=0 artefact, frozen contracts <=15% (deep wings); no holiday/early-close effect (flat 09:20) | redteam/a6_genuine.py
2026-11-05 | REDTEAM | K5 attack 7 CAPACITY | LOCKED | 59 | WEAKENED: one user fills 5 contracts on 57/59 nights, 10 on 54/59; 200 users x 1 contract exceeds displayed ask size on 59/59 nights | redteam/a2_fills.py
2026-11-05 | REDTEAM | K5 attack 8 NULLS | LOCKED | 59/252 | leaked calls vs side-shuffle null: null win 48.2% [37-58], observed 83% (p<0.001: the leak, not the signal); honest rule vs its shuffle null: 41.8% vs 39.2%, p=0.23; anti-signal -12.7%; both sides every night n=441 -9.9% [-14.5,-5.3]; synthetic zero-drift (GBM at realised vol, BS at contract IV) expected win 21%, ret -29% | redteam/k5_honest_report.py
2026-11-05 | REDTEAM | K5 VERDICT | LOCKED | - | KILL: the locked 88%/76% is a replay artefact (candidate universe conditioned on the next morning's open); the spec's rule on an honest universe loses -7.7%/trade with a CI excluding 0; the DEV 86% and the 155-trial family F2 share the leak (retOpen==0 on all dev overnight rows) | redteam/TRACE.md (results section) + k5_honest_report.log
2026-11-05 | EDGE-D | PREREG D1 EVENT-STRADDLE (CPI+NFP 08:30; ATM 0DTE/1DTE SPXW straddle bought 08:25 at ask, GTH quotes) | spec | - | registered BOTH signs (theory: D1- variance premium); 5 exit variants X1-X5; key null = same rule on weekday-matched control mornings | edge-d/specs/PREREG.md @ aa6fd76
2026-11-05 | EDGE-D | PREREG D1b FOMC-STRADDLE (14:00; straddle 13:55) | spec | - | registered both signs; 4 variants | edge-d/specs/PREREG.md @ aa6fd76
2026-11-05 | EDGE-D | PREREG D2 POST-EVENT DRIFT (side of 08:30-08:35 parity-forward move >= 0.10%; 0.30d same-side 0DTE at 08:36; flat 10:30) | spec | - | registered both signs: E1-E4 continuation (expected +), C1-C3 reversal contrast; nulls: control mornings, shuffled side, synthetic zero-drift | edge-d/specs/PREREG.md @ aa6fd76
2026-11-05 | EDGE-D | PREREG D2b FOMC-DRIFT (side of 14:00-14:05 move; pick 14:06; flat 15:55) | spec | - | registered both signs; 3 variants | edge-d/specs/PREREG.md @ aa6fd76
2026-11-05 | EDGE-D | PREREG D3 EARNINGS (1-DTE straddle 15:55 before AMC report, expected NEGATIVE; D3b next-morning drift) | spec | - | registered in concept; run only if time remains after D1/D2 | edge-d/specs/PREREG.md @ aa6fd76
2026-11-05 | EDGE-D | PREREG amendment A1 (SPXW GTH quotes absent 2018-12..2021-12 — chain rows all zero; 2018 pre-open spreads 16-45% of mid; sample = 2022+; PPI added to the 08:30 event set, retail sales dropped) | spec | - | registered after a 2018 smoke run (D1: 20 days, 1 executable straddle, -12%; D2: 0 picks) and before any 2022+ outcome | edge-d/specs/PREREG.md @ e5051fb
2026-11-05 | EDGE-D | PREREG amendment A2 (controls carry NO 08:30 release: Mon/Tue/Wed/Fri, +-1 day from CPI/NFP/PPI/FOMC excluded, day-of-month 13-19 and 24-31 excluded; 57 controls 2022+; drift legs fetched by BS |delta| nearest 0.30 +-1 strike instead of a +-3-strike band) | spec | - | registered after the pipeline audit, before any control-day run and before any 2022+ DEV outcome | edge-d/specs/PREREG.md @ fd809d1
2026-11-05 | EDGE-D | PREREG amendment A3 D3 EARNINGS-STRADDLE (UW postmarket reports, 15 liquid names, ATM straddle on first expiry after the report bought 15:55 at ask; exits Y1 09:35 / Y2 10:00 / Y3 15:55 next session; expected NEGATIVE; null = same name 14 days earlier; D3b not run, 0 trials) | spec | - | registered before any D3 data was fetched | edge-d/specs/PREREG.md @ 997f8ce
2026-11-05 | EDGE-D | D1 X1 EVENT | DEV | 89 tr / 108 sess | net -5.6% [-9.2,-1.5] (gross -5.5%), win 25% [+15.7,+33.7], payoff 1.37, by year {2018: n1 -13.3%, 2022: n22 +3.3%, 2023: n33 -10.0%, 2024: n33 -6.9%} | FAIL
2026-11-05 | EDGE-D | D1 X1 CONTROL | DEV | 44 tr / 44 sess | net -2.6% [-3.5,-1.7] (gross -2.5%), win 14% [+4.5,+25.0], payoff 0.79, by year {2022: n10 -3.7%, 2023: n17 -1.9%, 2024: n17 -2.8%} | FAIL
2026-11-05 | EDGE-D | D1 X2 EVENT | DEV | 89 tr / 108 sess | net -4.8% [-9.1,-0.0] (gross -4.8%), win 28% [+19.1,+38.2], payoff 1.41, by year {2018: n1 -13.7%, 2022: n22 +4.3%, 2023: n33 -7.9%, 2024: n33 -7.5%} | FAIL
2026-11-05 | EDGE-D | D1 X2 CONTROL | DEV | 44 tr / 44 sess | net -3.1% [-4.3,-1.6] (gross -3.0%), win 11% [+2.3,+20.5], payoff 1.37, by year {2022: n10 -5.5%, 2023: n17 -2.1%, 2024: n17 -2.6%} | FAIL
2026-11-05 | EDGE-D | D1 X3 EVENT | DEV | 89 tr / 108 sess | net -7.4% [-12.0,-2.2] (gross -7.3%), win 26% [+16.9,+34.8], payoff 1.26, by year {2018: n1 -12.4%, 2022: n22 +2.2%, 2023: n33 -11.0%, 2024: n33 -10.0%} | FAIL
2026-11-05 | EDGE-D | D1 X3 CONTROL | DEV | 44 tr / 44 sess | net -4.7% [-6.9,-2.3] (gross -4.6%), win 14% [+4.5,+25.0], payoff 1.12, by year {2022: n10 -6.1%, 2023: n17 -5.9%, 2024: n17 -2.7%} | FAIL
2026-11-05 | EDGE-D | D1 X4 EVENT | DEV | 89 tr / 108 sess | net -22.9% [-27.1,-19.3] (gross -22.8%), win 1% [+0.0,+3.4], payoff 0.06, by year {2018: n1 -8.5%, 2022: n22 -20.4%, 2023: n33 -24.1%, 2024: n33 -23.7%} | FAIL
2026-11-05 | EDGE-D | D1 X4 CONTROL | DEV | 44 tr / 44 sess | net -4.9% [-6.9,-3.1] (gross -4.8%), win 11% [+2.3,+20.5], payoff 0.42, by year {2022: n10 -3.6%, 2023: n17 -5.3%, 2024: n17 -5.2%} | FAIL
2026-11-05 | EDGE-D | D1 X5 EVENT | DEV | 89 tr / 108 sess | net -7.8% [-12.3,-2.9] (gross -7.7%), win 26% [+16.9,+34.8], payoff 1.17, by year {2018: n1 -12.4%, 2022: n22 +1.1%, 2023: n33 -10.9%, 2024: n33 -10.5%} | FAIL
2026-11-05 | EDGE-D | D1 X5 CONTROL | DEV | 44 tr / 44 sess | net -4.7% [-6.9,-2.3] (gross -4.6%), win 14% [+4.5,+25.0], payoff 1.12, by year {2022: n10 -6.1%, 2023: n17 -5.9%, 2024: n17 -2.7%} | FAIL
2026-11-05 | EDGE-D | D1 synthetic_null_X3_real | DEV-null | 8 | mean +45.3%, p95 +61.9%, candidate beats 0.0, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D1 synthetic_null_X3_rv | DEV-null | 8 | mean +34.8%, p95 +47.2%, candidate beats 0.0, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D1 X1 EVENT | VALIDATION | 23 tr / 23 sess | net -8.3% [-13.6,-2.8] (gross -8.3%), win 17% [+4.3,+34.8], payoff 0.82, by year {2025: n23 -8.3%} | FAIL
2026-11-05 | EDGE-D | D1 X1 CONTROL | VALIDATION | 12 tr / 12 sess | net -2.1% [-3.5,-0.5] (gross -2.0%), win 17% [+0.0,+41.7], payoff 1.06, by year {2025: n12 -2.1%} | FAIL
2026-11-05 | EDGE-D | D1 X2 EVENT | VALIDATION | 23 tr / 23 sess | net -9.2% [-14.5,-3.5] (gross -9.1%), win 17% [+4.3,+34.8], payoff 0.66, by year {2025: n23 -9.2%} | FAIL
2026-11-05 | EDGE-D | D1 X2 CONTROL | VALIDATION | 12 tr / 12 sess | net -0.9% [-3.4,+2.1] (gross -0.9%), win 25% [+0.0,+50.0], payoff 1.87, by year {2025: n12 -0.9%} | FAIL
2026-11-05 | EDGE-D | D1 X3 EVENT | VALIDATION | 23 tr / 23 sess | net -9.2% [-15.1,-2.8] (gross -9.2%), win 22% [+4.3,+39.1], payoff 0.67, by year {2025: n23 -9.2%} | FAIL
2026-11-05 | EDGE-D | D1 X3 CONTROL | VALIDATION | 12 tr / 12 sess | net -2.4% [-4.5,-0.1] (gross -2.3%), win 17% [+0.0,+41.7], payoff 1.13, by year {2025: n12 -2.4%} | FAIL
2026-11-05 | EDGE-D | D1 X4 EVENT | VALIDATION | 23 tr / 23 sess | net -23.1% [-32.0,-15.6] (gross -23.0%), win 4% [+0.0,+13.0], payoff 0.02, by year {2025: n23 -23.1%} | FAIL
2026-11-05 | EDGE-D | D1 X4 CONTROL | VALIDATION | 12 tr / 12 sess | net -2.0% [-3.7,+0.0] (gross -1.9%), win 17% [+0.0,+41.7], payoff 1.28, by year {2025: n12 -2.0%} | FAIL
2026-11-05 | EDGE-D | D1 X5 EVENT | VALIDATION | 23 tr / 23 sess | net -9.6% [-15.3,-3.7] (gross -9.6%), win 22% [+4.3,+39.1], payoff 0.54, by year {2025: n23 -9.6%} | FAIL
2026-11-05 | EDGE-D | D1 X5 CONTROL | VALIDATION | 12 tr / 12 sess | net -2.4% [-4.5,-0.1] (gross -2.3%), win 17% [+0.0,+41.7], payoff 1.13, by year {2025: n12 -2.4%} | FAIL
2026-11-05 | EDGE-D | D1 synthetic_null_X3_real | VALIDATION-null | 8 | mean +11.1%, p95 +22.2%, candidate beats 0.0, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D1 synthetic_null_X3_rv | VALIDATION-null | 8 | mean +26.7%, p95 +44.2%, candidate beats 0.0, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D1b X1 EVENT | DEV | 28 tr / 28 sess | net -0.1% [-8.5,+11.0] (gross +0.0%), win 36% [+17.9,+53.6], payoff 1.79, by year {2021: n8 -1.5%, 2022: n5 -9.4%, 2023: n8 +0.2%, 2024: n7 +7.9%} | FAIL
2026-11-05 | EDGE-D | D1b X1 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b X2 EVENT | DEV | 28 tr / 28 sess | net +0.3% [-13.4,+16.7] (gross +0.4%), win 29% [+14.2,+46.4], payoff 2.55, by year {2021: n8 +6.1%, 2022: n5 -20.4%, 2023: n8 -3.2%, 2024: n7 +12.4%} | FAIL
2026-11-05 | EDGE-D | D1b X2 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b X3 EVENT | DEV | 28 tr / 28 sess | net +19.1% [-14.6,+69.0] (gross +19.2%), win 54% [+35.7,+71.4], payoff 1.67, by year {2021: n8 +9.4%, 2022: n5 +8.5%, 2023: n8 -9.0%, 2024: n7 +69.9%} | FAIL
2026-11-05 | EDGE-D | D1b X3 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b X4 EVENT | DEV | 28 tr / 28 sess | net -18.7% [-25.5,-11.9] (gross -18.6%), win 4% [+0.0,+10.7], payoff 0.86, by year {2021: n8 -33.7%, 2022: n5 -8.6%, 2023: n8 -14.9%, 2024: n7 -13.2%} | FAIL
2026-11-05 | EDGE-D | D1b X4 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b X5 EVENT | DEV | 28 tr / 28 sess | net +4.9% [-12.3,+23.7] (gross +5.0%), win 50% [+32.1,+67.9], payoff 1.31, by year {2021: n8 +6.1%, 2022: n5 +24.8%, 2023: n8 -0.3%, 2024: n7 -4.6%} | FAIL
2026-11-05 | EDGE-D | D1b X5 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b synthetic_null_X3_real | DEV-null | 8 | mean +16.1%, p95 +33.8%, candidate beats 0.75, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D1b synthetic_null_X3_rv | DEV-null | 8 | mean +116.2%, p95 +183.2%, candidate beats 0.0, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D1b X1 EVENT | VALIDATION | 6 tr / 6 sess | net -12.8% [-17.7,-7.2] (gross -12.7%), win 0% [+0.0,+0.0], payoff 0.00, by year {2025: n6 -12.8%} | FAIL
2026-11-05 | EDGE-D | D1b X1 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b X2 EVENT | VALIDATION | 6 tr / 6 sess | net -11.7% [-28.5,+18.0] (gross -11.7%), win 17% [+0.0,+50.0], payoff 2.30, by year {2025: n6 -11.7%} | FAIL
2026-11-05 | EDGE-D | D1b X2 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b X3 EVENT | VALIDATION | 6 tr / 6 sess | net -4.9% [-40.3,+34.5] (gross -4.8%), win 33% [+0.0,+66.7], payoff 1.57, by year {2025: n6 -4.9%} | FAIL
2026-11-05 | EDGE-D | D1b X3 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b X4 EVENT | VALIDATION | 6 tr / 6 sess | net -22.7% [-35.1,-13.0] (gross -22.6%), win 0% [+0.0,+0.0], payoff 0.00, by year {2025: n6 -22.7%} | FAIL
2026-11-05 | EDGE-D | D1b X4 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b X5 EVENT | VALIDATION | 6 tr / 6 sess | net -15.8% [-41.3,+10.9] (gross -15.8%), win 33% [+0.0,+66.7], payoff 0.67, by year {2025: n6 -15.8%} | FAIL
2026-11-05 | EDGE-D | D1b X5 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D1b synthetic_null_X3_real | VALIDATION-null | 8 | mean +11.1%, p95 +47.5%, candidate beats 0.25, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D1b synthetic_null_X3_rv | VALIDATION-null | 8 | mean +93.0%, p95 +200.0%, candidate beats 0.125, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D2 E1 EVENT | DEV | 64 tr / 108 sess | net -19.3% [-33.6,-3.4] (gross -19.2%), win 25% [+14.1,+35.9], payoff 1.35, by year {2022: n18 -24.4%, 2023: n22 -25.7%, 2024: n24 -9.6%} | FAIL
2026-11-05 | EDGE-D | D2 E1 CONTROL | DEV | 6 tr / 44 sess | net -12.9% [-29.8,+10.9] (gross -12.7%), win 17% [+0.0,+50.0], payoff 1.85, by year {2022: n2 +3.1%, 2023: n2 -23.4%, 2024: n2 -18.3%} | FAIL
2026-11-05 | EDGE-D | D2 E1 CONTRAST_EVENT | DEV | 66 tr / 108 sess | net +1.2% [-14.5,+18.5] (gross +1.4%), win 39% [+28.8,+51.5], payoff 1.61, by year {2022: n17 +2.1%, 2023: n23 +6.6%, 2024: n26 -4.1%} | FAIL
2026-11-05 | EDGE-D | D2 E2 EVENT | DEV | 64 tr / 108 sess | net -8.9% [-22.4,+5.2] (gross -8.7%), win 42% [+29.7,+54.7], payoff 0.94, by year {2022: n18 -17.5%, 2023: n22 -8.1%, 2024: n24 -3.1%} | FAIL
2026-11-05 | EDGE-D | D2 E2 CONTROL | DEV | 6 tr / 44 sess | net -10.3% [-29.8,+18.5] (gross -10.2%), win 17% [+0.0,+50.0], payoff 2.47, by year {2022: n2 +10.7%, 2023: n2 -23.4%, 2024: n2 -18.3%} | FAIL
2026-11-05 | EDGE-D | D2 E2 CONTRAST_EVENT | DEV | 66 tr / 108 sess | net -6.4% [-17.3,+4.7] (gross -6.2%), win 45% [+34.8,+57.6], payoff 0.87, by year {2022: n17 -5.0%, 2023: n23 -7.0%, 2024: n26 -6.8%} | FAIL
2026-11-05 | EDGE-D | D2 E3 EVENT | DEV | 64 tr / 108 sess | net -4.7% [-18.7,+9.7] (gross -4.5%), win 58% [+45.3,+70.3], payoff 0.60, by year {2022: n18 -12.7%, 2023: n22 -9.9%, 2024: n24 +6.1%} | FAIL
2026-11-05 | EDGE-D | D2 E3 CONTROL | DEV | 6 tr / 44 sess | net -22.9% [-65.5,+25.1] (gross -22.8%), win 33% [+0.0,+66.7], payoff 0.85, by year {2022: n2 +4.7%, 2023: n2 -47.1%, 2024: n2 -26.3%} | FAIL
2026-11-05 | EDGE-D | D2 E3 CONTRAST_EVENT | DEV | 66 tr / 108 sess | net -3.7% [-15.5,+7.8] (gross -3.5%), win 59% [+47.0,+71.2], payoff 0.58, by year {2022: n17 -5.2%, 2023: n23 -3.8%, 2024: n26 -2.5%} | FAIL
2026-11-05 | EDGE-D | D2 E4 EVENT | DEV | 64 tr / 108 sess | net -3.6% [-15.9,+9.8] (gross -3.4%), win 41% [+28.1,+53.1], payoff 1.24, by year {2022: n18 -13.6%, 2023: n22 +3.6%, 2024: n24 -2.6%} | FAIL
2026-11-05 | EDGE-D | D2 E4 CONTROL | DEV | 6 tr / 44 sess | net -5.8% [-26.8,+23.3] (gross -5.6%), win 33% [+0.0,+66.7], payoff 1.32, by year {2022: n2 +14.5%, 2023: n2 -26.9%, 2024: n2 -4.9%} | FAIL
2026-11-05 | EDGE-D | D2 shuffled_null_E1 | DEV-null | 50 | mean -9.8%, p95 +2.8%, candidate beats 0.06, CI-pass rate 0.0 | null calibration
2026-11-05 | EDGE-D | D2 synthetic_null_E1_real | DEV-null |  | mean +10.5%, p95 +33.1%, candidate beats 0.0, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D2 E1 EVENT | VALIDATION | 20 tr / 23 sess | net -18.4% [-35.7,-0.2] (gross -18.3%), win 20% [+5.0,+40.0], payoff 1.33, by year {2025: n20 -18.4%} | FAIL
2026-11-05 | EDGE-D | D2 E1 CONTROL | VALIDATION | 1 tr / 12 sess | net -19.9% [-19.9,-19.9] (gross -19.8%), win 0% [+0.0,+0.0], payoff 0.00, by year {2025: n1 -19.9%} | FAIL
2026-11-05 | EDGE-D | D2 E1 CONTRAST_EVENT | VALIDATION | 22 tr / 23 sess | net +0.1% [-18.6,+24.9] (gross +0.3%), win 32% [+13.6,+54.5], payoff 2.16, by year {2025: n22 +0.1%} | FAIL
2026-11-05 | EDGE-D | D2 E2 EVENT | VALIDATION | 20 tr / 23 sess | net -18.8% [-35.3,-2.2] (gross -18.6%), win 25% [+5.0,+45.0], payoff 0.94, by year {2025: n20 -18.8%} | FAIL
2026-11-05 | EDGE-D | D2 E2 CONTROL | VALIDATION | 1 tr / 12 sess | net -19.9% [-19.9,-19.9] (gross -19.8%), win 0% [+0.0,+0.0], payoff 0.00, by year {2025: n1 -19.9%} | FAIL
2026-11-05 | EDGE-D | D2 E2 CONTRAST_EVENT | VALIDATION | 22 tr / 23 sess | net -3.6% [-16.4,+10.2] (gross -3.5%), win 41% [+22.7,+63.6], payoff 1.11, by year {2025: n22 -3.6%} | FAIL
2026-11-05 | EDGE-D | D2 E3 EVENT | VALIDATION | 20 tr / 23 sess | net -14.0% [-43.4,+19.5] (gross -13.8%), win 40% [+20.0,+60.0], payoff 0.97, by year {2025: n20 -14.0%} | FAIL
2026-11-05 | EDGE-D | D2 E3 CONTROL | VALIDATION | 1 tr / 12 sess | net +3.0% [+3.0,+3.0] (gross +3.1%), win 100% [+100.0,+100.0], payoff inf, by year {2025: n1 +3.0%} | FAIL
2026-11-05 | EDGE-D | D2 E3 CONTRAST_EVENT | VALIDATION | 22 tr / 23 sess | net -1.5% [-22.4,+18.8] (gross -1.3%), win 68% [+50.0,+86.4], payoff 0.43, by year {2025: n22 -1.5%} | FAIL
2026-11-05 | EDGE-D | D2 E4 EVENT | VALIDATION | 20 tr / 23 sess | net -10.0% [-28.6,+10.7] (gross -9.8%), win 40% [+20.0,+60.0], payoff 0.89, by year {2025: n20 -10.0%} | FAIL
2026-11-05 | EDGE-D | D2 E4 CONTROL | VALIDATION | 1 tr / 12 sess | net +28.9% [+28.9,+28.9] (gross +29.0%), win 100% [+100.0,+100.0], payoff inf, by year {2025: n1 +28.9%} | FAIL
2026-11-05 | EDGE-D | D2 shuffled_null_E1 | VALIDATION-null | 50 | mean -5.4%, p95 +13.6%, candidate beats 0.12, CI-pass rate 0.02 | null calibration
2026-11-05 | EDGE-D | D2 synthetic_null_E1_real | VALIDATION-null |  | mean +11.1%, p95 +76.2%, candidate beats 0.25, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D2b E1 EVENT | DEV | 15 tr / 28 sess | net +36.3% [-34.7,+114.6] (gross +36.5%), win 47% [+20.0,+73.3], payoff 1.97, by year {2021: n1 +246.8%, 2022: n4 -30.3%, 2023: n5 +8.0%, 2024: n5 +75.7%} | FAIL
2026-11-05 | EDGE-D | D2b E1 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D2b E1 CONTRAST_EVENT | DEV | 18 tr / 28 sess | net -31.6% [-79.4,+27.3] (gross -31.5%), win 22% [+5.6,+44.4], payoff 1.94, by year {2021: n3 -99.1%, 2022: n5 +71.4%, 2023: n5 -42.8%, 2024: n5 -82.9%} | FAIL
2026-11-05 | EDGE-D | D2b E2 EVENT | DEV | 15 tr / 28 sess | net +42.5% [-16.5,+108.5] (gross +42.7%), win 47% [+20.0,+73.3], payoff 3.01, by year {2021: n1 +337.0%, 2022: n4 +32.9%, 2023: n5 +26.2%, 2024: n5 +7.5%} | FAIL
2026-11-05 | EDGE-D | D2b E2 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D2b E2 CONTRAST_EVENT | DEV | 18 tr / 28 sess | net -16.3% [-48.9,+18.1] (gross -16.2%), win 50% [+27.8,+72.2], payoff 0.55, by year {2021: n3 -62.9%, 2022: n5 -19.4%, 2023: n5 +30.3%, 2024: n5 -32.0%} | FAIL
2026-11-05 | EDGE-D | D2b E3 EVENT | DEV | 15 tr / 28 sess | net +23.6% [-25.7,+80.7] (gross +23.8%), win 53% [+26.7,+80.0], payoff 1.65, by year {2021: n1 +288.4%, 2022: n4 +9.6%, 2023: n5 +18.2%, 2024: n5 -12.7%} | FAIL
2026-11-05 | EDGE-D | D2b E3 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D2b E3 CONTRAST_EVENT | DEV | 18 tr / 28 sess | net -18.1% [-42.7,+5.7] (gross -18.0%), win 50% [+27.8,+72.2], payoff 0.39, by year {2021: n3 -29.4%, 2022: n5 -5.8%, 2023: n5 -11.3%, 2024: n5 -30.4%} | FAIL
2026-11-05 | EDGE-D | D2b E4 EVENT | DEV | 15 tr / 28 sess | net +7.7% [-19.5,+39.9] (gross +7.8%), win 47% [+20.0,+73.3], payoff 1.64, by year {2021: n1 -47.4%, 2022: n4 +23.4%, 2023: n5 -23.3%, 2024: n5 +37.0%} | FAIL
2026-11-05 | EDGE-D | D2b E4 CONTROL | DEV | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D2b shuffled_null_E1 | DEV-null | 50 | mean +6.6%, p95 +50.4%, candidate beats 0.82, CI-pass rate 0.02 | null calibration
2026-11-05 | EDGE-D | D2b synthetic_null_E1_real | DEV-null |  | mean -9.8%, p95 +74.4%, candidate beats 0.75, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | D2b E1 EVENT | VALIDATION | 3 tr / 6 sess | net -23.6% [-100.1,+127.6] (gross -23.4%), win 33% [+0.0,+100.0], payoff 1.29, by year {2025: n3 -23.6%} | FAIL
2026-11-05 | EDGE-D | D2b E1 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D2b E1 CONTRAST_EVENT | VALIDATION | 3 tr / 6 sess | net -4.0% [-100.1,+169.2] (gross -3.9%), win 33% [+0.0,+100.0], payoff 1.87, by year {2025: n3 -4.0%} | FAIL
2026-11-05 | EDGE-D | D2b E2 EVENT | VALIDATION | 3 tr / 6 sess | net -64.5% [-100.1,+4.9] (gross -64.3%), win 33% [+0.0,+100.0], payoff 0.05, by year {2025: n3 -64.5%} | FAIL
2026-11-05 | EDGE-D | D2b E2 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D2b E2 CONTRAST_EVENT | VALIDATION | 3 tr / 6 sess | net -8.4% [-81.2,+80.4] (gross -8.3%), win 33% [+0.0,+100.0], payoff 1.52, by year {2025: n3 -8.4%} | FAIL
2026-11-05 | EDGE-D | D2b E3 EVENT | VALIDATION | 3 tr / 6 sess | net -36.8% [-100.1,+11.2] (gross -36.7%), win 33% [+0.0,+100.0], payoff 0.18, by year {2025: n3 -36.8%} | FAIL
2026-11-05 | EDGE-D | D2b E3 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D2b E3 CONTRAST_EVENT | VALIDATION | 3 tr / 6 sess | net -1.0% [-100.1,+104.4] (gross -0.8%), win 33% [+0.0,+100.0], payoff 1.95, by year {2025: n3 -1.0%} | FAIL
2026-11-05 | EDGE-D | D2b E4 EVENT | VALIDATION | 3 tr / 6 sess | net -31.3% [-41.9,-10.3] (gross -31.1%), win 0% [+0.0,+0.0], payoff 0.00, by year {2025: n3 -31.3%} | FAIL
2026-11-05 | EDGE-D | D2b E4 CONTROL | VALIDATION | 0 | no executable trades | FAIL
2026-11-05 | EDGE-D | D2b shuffled_null_E1 | VALIDATION-null | 50 | mean -17.0%, p95 +66.2%, candidate beats 0.34, CI-pass rate 0.0 | null calibration
2026-11-05 | EDGE-D | D2b synthetic_null_E1_real | VALIDATION-null |  | mean -36.8%, p95 +8.7%, candidate beats 0.375, CI-pass rate n/a | null calibration
2026-11-05 | EDGE-D | PIPELINE NOTE synthetic zero-drift null for STRADDLES (D1/D1b) | null | 8 seeds x 2 modes | MIS-SPECIFIED: the path carries the event jump variance after entry while options are priced at the window-average (rv) or median (real) IV, so a no-edge straddle shows +11..+116%; its pass rate is NOT an FDR estimate; it can only make real results look worse (no false pass). D1 verdicts rest on the control-morning null; directional D2/D2b shuffled-side nulls are calibrated (CI-pass 0-2%) | edge-d/run.py synthetic_preopen
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y1 EVENT | DEV | 143 tr / 15 names (of 152 before 8% spread filter) | net +2.6% [-6.0,+12.1] (gross +2.8%), win 43%, realized/implied median 0.88, by year {2022: n35 -5.2%, 2023: n60 +0.4%, 2024: n48 +11.0%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y2 EVENT | DEV | 143 tr / 15 names (of 152 before 8% spread filter) | net +5.8% [-3.8,+16.1] (gross +6.1%), win 47%, realized/implied median 0.92, by year {2022: n35 -1.2%, 2023: n60 +2.5%, 2024: n48 +15.2%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y3 EVENT | DEV | 143 tr / 15 names (of 152 before 8% spread filter) | net +4.9% [-5.2,+15.8] (gross +5.2%), win 49%, realized/implied median 0.99, by year {2022: n35 -4.4%, 2023: n60 +3.0%, 2024: n48 +14.0%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y1 CONTROL | DEV | 99 tr / 15 names (of 151 before 8% spread filter) | net -1.0% [-5.1,+3.8] (gross -0.2%), win 31%, realized/implied median 0.33, by year {2022: n26 -4.8%, 2023: n43 -3.3%, 2024: n30 +5.6%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y2 CONTROL | DEV | 99 tr / 15 names (of 151 before 8% spread filter) | net -2.0% [-6.4,+2.7] (gross -1.2%), win 32%, realized/implied median 0.46, by year {2022: n26 -5.3%, 2023: n43 -4.2%, 2024: n30 +4.1%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y3 CONTROL | DEV | 99 tr / 15 names (of 151 before 8% spread filter) | net -0.5% [-11.2,+10.1] (gross +0.3%), win 31%, realized/implied median 0.63, by year {2022: n26 -0.8%, 2023: n43 -11.7%, 2024: n30 +15.7%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y1 EVENT | VALIDATION | 38 tr / 14 names (of 44 before 8% spread filter) | net -6.0% [-24.6,+15.9] (gross -5.7%), win 29%, realized/implied median 0.67, by year {2025: n38 -6.0%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y2 EVENT | VALIDATION | 38 tr / 14 names (of 44 before 8% spread filter) | net -11.6% [-29.9,+11.4] (gross -11.3%), win 32%, realized/implied median 0.69, by year {2025: n38 -11.6%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y3 EVENT | VALIDATION | 38 tr / 14 names (of 44 before 8% spread filter) | net -25.8% [-43.1,-4.3] (gross -25.5%), win 24%, realized/implied median 0.52, by year {2025: n38 -25.8%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y1 CONTROL | VALIDATION | 22 tr / 9 names (of 45 before 8% spread filter) | net -3.1% [-12.3,+7.9] (gross -2.6%), win 32%, realized/implied median 0.31, by year {2025: n22 -3.1%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y2 CONTROL | VALIDATION | 22 tr / 9 names (of 45 before 8% spread filter) | net -7.8% [-19.7,+5.1] (gross -7.3%), win 27%, realized/implied median 0.41, by year {2025: n22 -7.8%} | FAIL
2026-11-05 | EDGE-D | D3 EARNINGS-STRADDLE Y3 CONTROL | VALIDATION | 22 tr / 9 names (of 45 before 8% spread filter) | net -12.3% [-29.3,+6.3] (gross -11.8%), win 32%, realized/implied median 0.52, by year {2025: n22 -12.3%} | FAIL
2026-11-05 | EDGE-D | D3b post-earnings drift | - | 0 | NOT RUN (time); 0 trials | -
2026-11-05 | EDGE-D | SUMMARY | DEV+VAL | - | D1 (08:30 straddle) loses in DEV and VAL with CI<0 (option market over-prices the 08:30 move, realized ~0.3x implied); D1b, D2, D2b, D3 fail; NOTHING FROZEN, no locked look | edge-d/RESULTS.md
