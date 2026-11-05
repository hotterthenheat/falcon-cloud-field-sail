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
