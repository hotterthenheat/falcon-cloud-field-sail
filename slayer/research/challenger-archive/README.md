> **VOID — archived, not shipped.** Every positive result in this folder (K2b, K4 and the other overnight books) is a
> replay artefact: the challenger replay's tapeOf read day D's 09:30 open for pre-open marks (look-ahead). Re-run on the
> real chain at the mark, K5 is n=252, win 40.1% [34.1, 46.4], −7.7%/trade [−13.7, −1.5]. See "KILLED" below. Kept for the
> record (LOG.md: 152 hypotheses tried) so nothing here is re-run as if it worked. The code lives on an old, unrelated
> history (before the 31 Oct rewrite) as `patches/`; the raw data (~5 GB) is not kept.

# Compass "Model 4" research — final state (stopped 1 Nov 2026 by the owner)

Status: **not finished, not shipped.** No candidate has passed the owner's bar (60% win rate on a locked holdout,
win = the bid reaches 1.5× the ask paid before the stop). The current Compass models were never changed.

## What's in here
- `patches/` — 29 commits, made with `git format-patch` against **6657dad** (main before the 31 Oct history rewrite;
  the same tree is commit `ca6ad6e`'s parent line on today's main). Apply on a scratch branch:
  `git checkout -b model4 <commit with that tree> && git am patches/*.patch`.
  Code: `slayer/research/challenger/*` (fetch, build, seat simulation, train, overfit checks, holdout scorer),
  `slayer/src/data/compassChallenger.ts` (shadow scorer, off unless a machine is shipped; `CHALLENGER_SHADOW=0` turns it off),
  `challengerFeatures.ts`, `challengerParams.ts` (no machine hashes = nothing ships), `challengerExit.ts` (hard-stop exit),
  `scripts/golden/challenger-golden.ts` (proves the live Compass path is unchanged with the shadow off/on/calling).
- `LOG.md` — the full research log (every hypothesis, 152 tried).
- `HOW_MOVES_HAPPEN.md` — what moves option prices, by move type.
- `compass-challenger.md` — design doc.
- `results/` — holdout tables (H1) per candidate, and evaluation notes.
- The raw data (~5 GB of cached ThetaData answers) is **not** included; `research/challenger/fetch.ts` rebuilds it
  with a ThetaData key (Professional options/stocks/indices). Allow many hours.

## Results so far
**Locked holdout H1** (63 sessions: Jun 2022, Aug 2024, Oct 2026; scored once):

| Book | Calls | Win [95%] | Return/call [95%] |
|---|---|---|---|
| Hit + Runner (current Model 1/2) | 256 | 25% [19, 31] | −5.6% [−10.7, −0.6] |
| Late sweep (current Model 3) | 96 | 44% [29, 60] | −3.4% [−22.6, +19.3] |
| K2b overnight SPXW, 15–30Δ, side of the move | 51 | 45% [32, 59] | **+12.3% [+1.4, +23.0]** |
| K4 overnight SPXW, 10–20Δ, against the move | 29 | 38% [21, 56] | +11.2% [−1.3, +23.8] |

**Lead candidate K5 (frozen, never scored on a holdout):** SPXW, overnight marks 00:00–05:59 ET, |delta| 0.10–0.20,
the side the overnight move favours, strike nearest 0.15 delta, hard-stop exit (1.5× take-profit or the 0.5322 stop,
no break-even move), flat 09:20. Development (273 sessions): **49 calls, 86% win, +38.6% a call** (86% again when
settled on 1-second quotes). Overfitting: PBO 0.04 for its family (pass < 0.5); deflated Sharpe 0.94 at 155 trials
(pass ≥ 0.95 — not yet). The second locked holdout **H2** (Jul–Sep 2022 + Jan–Mar 2025) was still being built when
the work stopped (2022 Q3 complete; 2025 Q1 partly fetched), so K5's one honest test has **not** run.

**What the data says:** nothing in the regular session gets near 60% (best cells 46–48% and losing). The only pocket is
SPXW overnight after midnight — the moves are real (they match XSP×10 at the same minute), and SPXW's tighter spread is
why it pays when XSP doesn't. 2022 (bear market) was roughly flat for the overnight rule.

## To finish it (for the next developer)
1. Finish fetching/building H2 (`research/challenger/fetch_loop.sh`, `keepgoing2.sh`; caps: 2 builders, ≤3 terminal requests).
2. Score K5 on H2 once (`research/challenger/holdout.py` with the frozen K5 config) — report win rate with its 95% interval.
3. Only if it clears 60% with an interval that supports it, and PBO < 0.5 and DSR ≥ 0.95: ship it in the shadow as
   "Model 4", watch it live, then ask the owner. Never show a score or percentage in Compass.

## 2026-11-05 — KILLED: every overnight result above is a replay artefact
A red-team review (slayer/research/compass-v2/redteam/TRACE.md on branch worktree-agent-a4213257d81bacfac; ledger
research-v2-ledger.md) found a look-ahead in this pipeline's replay: for every pre-open mark, `compassFeatures.tapeOf`
returns `o[0]` — day D's 09:30 open — so build.ts's Book A gate (`dist <= 4` strikes from `tape.S`) keeps only strikes
within ~20 pts of where SPX WILL open. The 0.15Δ "overnight" universe is therefore conditioned on the future open.
Honest K5 on the real chain at the mark: n=252, win 40.1% [34.1, 46.4], −7.7%/trade [−13.7, −1.5]. This voids K2b, K4,
K5, M5, the DEV 86%, and the F2 family's PBO/DSR. Do not ship or cite any overnight number from this folder.
The main app's engine (≥ 416c196) truncates bars to before the mark and does not have this leak; the research cache does.
