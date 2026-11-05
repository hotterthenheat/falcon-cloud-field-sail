# "Don't chase" filter for Model 1 (Hit score, Book A) — research log (worker DC, 2026-11-05)

Owner-approved test of one Model 1 filter: skip a call when, at the mark, the underlying has already moved more than
X% in the call's direction since the regular open AND sits in the top Y% of the day's range on the call's side (the
top for a call, the bottom for a put). From the Nov 4 study (`research/nov4` on worker RS's branch): Compass's
calls had median move +1.08% with the call and range position 0.79; the >= 2x runners -0.62% and 0.12.

## Pre-registration (written before any outcome was looked at)

**Calls.** Every Model 1 (Book A) call the engine made on the challenger's built sessions
(`research/challenger/data/rows/*.calls.json`, read-only; 443 sessions, 437 with a Book A call, 1,792 calls, all in
the regular session). The regime samples (2020, 2022, 2024) have SPY, QQQ, IWM, SPXW only; 2025-2026 every Compass root.

**Outcome (owner's definition).** Fill = the ask of the first minute quote at or after the mark + 1 minute (within 3).
Win = the bid reaches 1.50x that ask (rounded up to the cent) before it falls to 0.4678x (stop never moves); else flat
at the call's flat (15:55, or five before an early close) at the bid. Return = exit / ask - 1. Minute path from the
bulk chain cache; the minute that crosses the stop or target is read in 1-second quotes (the shadow's own request) and
the exit judged on them. A window the terminal does not answer leaves the call on its minute exit and is counted.
No fees.

**Filter inputs at the mark** (bars begun before the mark's minute only): open = 09:30 bar's open; price = last
bar's close before the mark; high/low of the regular bars so far. move = side-signed return since the open;
pos = (S - L)/(H - L) for calls, (H - S)/(H - L) for puts. Skip if move > X and pos >= 1 - Y.

**Sets.** Holdout H1 (locked 2026-10-31 by the challenger, never used for this filter): 2022-06, 2024-08,
2026-10-05..10-30. Holdout H2 (locked, built since): 2022-07..09, 2025-01..03. Development: every other built session
(2020-02..04, 2022-02..05, 2022-10, 2024-07, 2025-11..2026-09). Note: the brief said "sessions before the locked
holdouts"; H1 starts in 2022-06, so a strictly earlier set would be only 2020 + 2022 Feb-May (4 roots). I use every
non-holdout session instead and say so.

**Variants (pre-registered, all counted).** Start X = 0.8%, Y = 20%; grid X in {0.5, 0.8, 1.2}%, Y in {10, 20, 30}%:
9 variants (the start is one of them). Variant count = 9.

**Selection rule (dev only).** The variant with the highest development win rate of the kept calls; if it beats
X = 0.8 / Y = 20 by less than 1 point, keep 0.8 / 20 (the a-priori spec). Frozen, then scored once on H1 and once on H2.

**Statistics.** 95% intervals by session-cluster bootstrap (2,000 resamples of whole sessions) for the win rate and
the return per call; the paired difference (filtered book minus unfiltered, per session) the same way. Split check:
sessions by the underlying's open-to-close move (with the call's side > +0.5%, against < -0.5%, flat between), and
|move| >= 1% "trend days" vs the rest.

**Bar to ship to the Model 1 gate:** the removed calls lose more than the kept ones on H1 with the paired return
interval above zero, the same sign on H2, and not concentrated in one trend direction. Otherwise shadow or drop.

## Run (2026-11-05)

- `calls.py`: 1,792 Model 1 calls, every one with a tape at the mark and a fill. 1,532 exit minutes crossed the stop or
  target; all 1,532 1-second windows answered (1,026 from the challenger's cache1s, 506 read now, two in flight;
  kept in the scratchpad `dc1s/`, not committed). Spot at the mark = the call's recorded spot (checked on 8 calls).
  One look before the grid: the pooled exit-type counts of all 1,792 calls (minute path), not split by the filter.
- 1,626 of the 1,792 calls marked 09:45-09:59: "the day's range" is mostly the first 15 minutes.
- Sets: development 1,015 calls / 253 sessions; H1 256 / 63 (the challenger's H1 count for the Hit book, 256, again);
  H2 521 / 121.

### Development (`dev.txt`), 9 variants
Kept-book win rate 44.9-45.7% for every variant against 44.9% unfiltered. Best 1.2 / 10 (45.72%, removes 46 calls
that won 28%), less than 1 point over 0.8 / 20 (45.32%): by the rule, **frozen X = 0.8%, Y = 20%**.
0.8 / 20 on development: removes 117 of 1,015 (12%); removed win 41.9% vs kept 45.3%; paired gain +1.4% return a
session [-5.2, +10.1].

### Holdout, scored once (`holdout.txt`)

| set | book | calls | win [95%] | return/call [95%] |
|---|---|---:|---:|---:|
| H1 | no filter | 256 | 39.5% [33.3, 45.7] | -5.5% [-12.0, +1.2] |
| H1 | don't chase | 230 | 40.4% [33.9, 47.1] | -4.9% [-11.9, +2.4] |
| H1 | removed | 26 | 30.8% [13.8, 52.0] | -10.7% [-28.3, +8.1] |
| H2 | no filter | 521 | 37.6% [32.6, 42.8] | -8.0% [-13.0, -3.0] |
| H2 | don't chase | 478 | 37.9% [32.4, 43.2] | -7.8% [-13.0, -2.4] |
| H2 | removed | 43 | 34.9% [21.1, 49.0] | -11.3% [-24.8, +2.7] |

Paired gain a session: H1 +4.4% [-5.1, +20.6], H2 +4.0% [-1.6, +14.6]. Both intervals include zero.

**Trend split.** The filter fires mostly on days the underlying went on in the call's direction: 90 of 117 removed
(dev), 20 of 26 (H1), 31 of 43 (H2). Those are Model 1's good days (kept calls there win 72-75%). Inside each
day-direction group, the removed calls do worse than the kept ones: with the call 40-52% win vs 72-75%; flat days
0-6% vs 27-38%. But the filter cannot know the day's direction at the mark, and pooled the gap almost goes away.

**Verdict.** The sign is right on dev, H1 and H2. The size is too small to matter: about 1 point of win rate and
under 1% of return per call. It never comes near the 60% bar, and Model 1 still loses either way. The ship bar is
not met. Recommendation: drop it as a gate. At most, keep it as a shadow tag on calls.

Caveat: the calls are the engine's late-path calls on the challenger's built sessions (engine at 6657dad plus the
challenger patches). They were not rebuilt with b71a22b. The changes since then (7d44d21 A6-A8: curb ends, holiday
GTH, overnight and pre-market marks reading no later bar) are outside the regular session, where all 1,792 calls sit.
The 2020/2022/2024 sessions have only SPY, QQQ, IWM and SPXW.
