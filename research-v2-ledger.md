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
