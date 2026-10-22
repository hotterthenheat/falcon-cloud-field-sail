# The wall back-test

**Question.** When price reaches a wall the Pinpoint Agenda lists, how often does it turn back, and does the model's
reading say which walls turn it back more often?

**Answer, in one paragraph.** Over two years of SPY, QQQ and NVDA (496 sessions each, 2024-10-22 → 2026-10-21), walls
held about **63%** of the touches that resolved by the close. The **name** explains most of the difference: SPY walls
held **56%**, QQQ **59%**, NVDA **73%**. A wall's **size** against the typical wall on its own book barely mattered once
the name is accounted for, and read alone the heaviest walls held *less* often (the biggest strikes pull price in, like
a pin, as often as they turn it away). A **fast arrival** turned back *more* often than a slow one. The day's earlier
tests added almost nothing. The old hand-set model had all three of those the wrong way round, so its "strong" walls
held less often than its "weak" ones (59% vs 66%). The shipped reading is now the fitted one, and it is calibrated: when
it says 55–60%, 58% held; when it says 70–75%, 73% held.

## Data

Unusual Whales only (see `docs/DATA_SOURCES.md`), inside the plan's lookback:

| What | Route | Notes |
|---|---|---|
| The book as of the open of session D | `/stock/{t}/greek-exposure/strike?date=P` (whole book) and `/stock/{t}/greek-exposure/strike-expiry?date=P&expiry=E` (front expiry) | P is the previous session. Open interest settles overnight, so P's end-of-day book is the book a reader saw at 09:30 — no look-ahead. E is the nearest listed expiry on or after D (`/greek-exposure/expiry?date=P`): the same day for SPY and QQQ, the coming Friday for NVDA. |
| The day's prices | `/stock/{t}/ohlc/1m?date=D` | 390 regular-session bars (`market_time = "r"`) |
| Implied vol | `/stock/{t}/iv-rank?date=…&timespan=1y` | One call per year; P's `volatility` |

History reaches back past October 2024 on this key. The rate-limit header reads 1,000,000 requests a minute.

## Method

`scripts/wall-backtest.ts` replays each session through the **shipped** code: `buildExposureProfile` (20 strikes each
side, like the Agenda), `buildAgenda`, `buildWallContext` / `oddsAt`, `testEvents`, `speedRatio`, and `chainFrom` from
`uwBook.ts` for the vendor-to-house transform.

- **Wall**: a strike the Agenda lists as a shelf at the open (`Target.isShelf`).
- **Touch**: the first 1-minute bar whose range reaches the strike from the side price was on. A wall the open already
  crossed is not counted that day.
- **Held**: after the touch (the touch bar included), price comes back 0.15% away from the wall before any bar
  **closes** 0.15% through it. **Broke**: a close through it by 0.15% comes first. Within one bar a close through it
  counts first. **Open**: neither by the close (counted, left out of the rates).
- **Re-touch**: after a hold, the next visit is a new touch, read with the day's tests so far. After a break the wall is
  done for the day.
- The model is read on the bars **before** the touch bar, with the clock at that minute and spot at the prior close.
- Two books: **Today** (the front expiry — the Agenda's default) and **All** (the whole book).

4,837 touches in all (2,745 on the Today book, 2,092 on the All book), 4,690 resolved.

## Results (margin 0.15%)

### Today book (the Agenda's default)

| bucket | resolved touches | open at the close | held | 95% CI |
|---|---|---|---|---|
| SPY | 855 | 56 | 56% | 53%–59% |
| QQQ | 945 | 26 | 59% | 56%–62% |
| NVDA | 856 | 7 | 73% | 70%–76% |
| first touch | 1440 | 49 | 61% | 58%–63% |
| re-touch | 1216 | 40 | 64% | 62%–67% |
| weight < 0.5× the typical wall | 246 | 7 | 65% | 58%–70% |
| 0.5–1× | 481 | 9 | 68% | 63%–72% |
| 1–2× | 1435 | 46 | 62% | 59%–64% |
| ≥ 2× | 494 | 27 | 58% | 54%–63% |
| **all walls** | **2656** | **89** | **63%** | **61%–64%** |

The old model's words on the same touches: strong 59% (56–62%, n=1145), medium 65% (62–68%, n=862), weak 66% (62–69%,
n=649) — backwards.

### All book

SPY 55% (51–59%, n=633) · QQQ 61% (57–64%, n=732) · NVDA 72% (68–75%, n=669) · weight ≥ 2× 53% (47–59%, n=256) against
0.5–1× 69% (64–73%, n=443) · all walls 63% (61–65%, n=2034).

### The margin

Held at 0.10% / 0.15% / 0.25%: 66% / 63% / 57% (Today), 67% / 63% / 58% (All). A wider margin asks more of a hold and
resolves fewer touches; the ordering between names and buckets does not change.

## The fit and the shipped constants

Logistic regression on the Today book's resolved touches:
`held ~ 1 + log2(weight / typical wall) + testsScore + speedExcess + QQQ + NVDA`.

**Out of sample** — fitted on the first year (1,296 touches before 2025-10-28), scored on the second (1,360): Brier
0.2292 for the model against 0.2346 for one pooled rate and 0.2301 for each name's own rate. Test-year calibration:

| predicted | touches | held | 95% CI |
|---|---|---|---|
| 50–55% | 221 | 53% | 47%–60% |
| 55–60% | 515 | 58% | 54%–63% |
| 60–65% | 132 | 58% | 50%–66% |
| 65–70% | 35 | 74% | 58%–86% |
| 70–75% | 220 | 65% | 58%–71% |
| 75–100% | 237 | 78% | 72%–82% |

**Refitted on both years (n = 2,656)**:
`z = 0.324 − 0.038·log2(ratio) + 0.048·tests + 0.458·speedExcess + 0.115·QQQ + 0.725·NVDA`.

In `src/data/wall.ts` that is `BASE_LOGIT = { SPY: 0.324, QQQ: 0.439, NVDA: 1.049 }` (any other name 0.597, the
touch-weighted mean of the three), `A_WEIGHT = −0.038`, `A_TESTS = 0.048`, `A_SPEED = −0.458` (the constant is a
penalty, so negative means a fast arrival *raises* the hold). `PAR_RATIO` stays 1.

**The shipped reading, on all two years**:

| shipped hold | Today: touches · held | All: touches · held |
|---|---|---|
| 50–55% | 486 · 54% (49–58%) | 348 · 52% (47–57%) |
| 55–60% | 772 · 58% (55–62%) | 596 · 60% (56–64%) |
| 60–65% | 437 · 58% (54–63%) | 334 · 59% (54–64%) |
| 65–70% | 221 · 69% (62–75%) | 186 · 68% (61–75%) |
| 70–75% | 565 · 73% (69–77%) | 457 · 74% (70–78%) |
| 75–80% | 132 · 79% (71–85%) | 80 · 75% (65–83%) |

(Below 50% and above 80% there are fewer than 30 touches; those buckets are noise.)

## What changed in the app

- `wall.ts`: the fitted constants above; the hold is `sigmoid(name + size + tests + speed)`.
- The **build**, **prints** and **vanna** terms cannot be replayed (the vendor's history has no intraday book and no
  tape). They keep their hand-set constants and still appear in the factor list with their push, but they **no longer
  move the printed hold**, so the percentage on the page is the back-tested one. With them in, SPY's call walls read 35–45%
  on the live page against a measured 56–58%.
- The pages print the hold as a back-tested percentage to the nearest 5% (`holdLabel`): the Agenda (cards, table,
  sentences), the Board, Compare's side panel and the workspace tile. The How-to-read guide says how it was measured.
- The speed factor's words now say what the back-test found: fast arrivals turned back more often.

## Limitations

- **Three names.** Other names read at the three names' average logit; their own rate may differ (NVDA's is 15 points
  above SPY's). Adding a name is a re-run with `--tickers`.
- **The open's book all day.** The live page re-reads gamma through the session; the replay holds the open's book.
- **Build, prints, vanna untested** — shown as context, kept out of the number.
- **Touches are correlated.** Re-touches of one wall in one day, and the same touch on the Today and All books, are not
  independent; the confidence intervals treat them as if they were, so they are a little narrow.
- **One definition of a hold.** 0.15% (with 0.10% and 0.25% reported). A trader's own stop distance changes the number.

## Re-running

```bash
cd slayer
UW_KEY=<your Unusual Whales key> npx tsx scripts/wall-backtest.ts --from 2024-10-21 --to 2026-10-21
# options: --tickers SPY,QQQ,NVDA  --margin 0.0015  --cache <dir>  --out <file>
```

Responses are cached (default `../screenshots/audit/final/bt-cache`, outside git), so a re-run with an empty `UW_KEY`
works offline from the cache. The script prints every table above, the out-of-sample check, and the refitted constants
to paste into `src/data/wall.ts`.
