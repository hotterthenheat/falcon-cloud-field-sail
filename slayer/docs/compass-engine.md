# The Compass engine

Compass scans, calls and settles on the server, once for every viewer. Browsers only render what it found.

## Where it runs

- **`npm run dev`** (the Vite dev server) and **`npm run serve`** (`server.ts`) start the engine when they start
  listening and stop it when they close (Ctrl-C, SIGINT or SIGTERM). It runs whether or not anyone has Compass open.
  `vite preview` serves the record the same way.
- The code is `src/data/compassServer.ts` (the engine, the record files, the HTTP answers), `src/data/compassScan.ts`
  (the marks, the live pass, the late pass, Book C, the card quotes, settlement), and the scorer the browser also uses
  (`compassModel.ts`, `compassFeatures.ts`, `compassParams.ts`, `compassLedger.ts`, `compassOutcome.ts`).
  `src/data/compassHost.ts` is where they read from: the browser through `/api/theta` and HTTP, the server through
  the hub in-process (`server/thetaProxy.mjs` `thetaDirect`), with the same eight-request cap every viewer's call goes
  through. `server/compassApi.mjs` mounts it.
- One process per record folder runs the scan: it holds `.cache/compass/engine.lock` and refreshes it every 30 s. A
  second server on the same folder serves the first one's record and scans nothing; it asks for the lock every 30 s
  and takes over the scan once the holder's lock is stale (two minutes unrefreshed, or its process gone). A scanner
  that finds the lock taken by another live process stops scanning and becomes a reader.
- A failed engine start (an import error, a disk error) is tried again after 5 s, doubling to 5 minutes, and logged.
  Each background step of the scan (the tick, the card quotes, settlement, the late fill) logs a failure instead of
  leaving an unhandled rejection, and the servers log any unhandled rejection or uncaught exception
  (`installProcessLogger`). A model-lock reason (a file missing, a hash miss) is logged when it changes.
- `slayer/.gitattributes` keeps `public/models/*` and `public/config/*.json` byte-exact (no line-end conversion):
  their SHA-256 is the lock.
- `COMPASS_ENGINE=0` serves the record without scanning. `COMPASS_DIR` moves the record.
- The exposure recorder (Terrain's per-strike field, `docs/exposure-recorder.md`) runs beside it the same way: started
  and stopped with the server, one lock per folder (`.cache/exposure/recorder.lock`), read-only at `/api/exposure/*`.

## What it does

- At every mark (every five minutes while a root's options trade, plus 09:29 VIX, 15:59 and 16:14) it reads a
  snapshot of every name on the sleeve (0DTE: the roots with a same-day contract; 1–7 DTE: the twenty roots with the
  full feature row) and scores Books A and B. Book C sweeps once from 15:20 ET.
- A name the terminal does not answer inside the mark's minute (the terminal down, the session lost, the previous
  pass still running) is scored afterwards from the quotes that stood at that exact instant (`option/at_time/quote`).
  **Live calls only:** a late mark is never an official call and never takes a seat. What it would have called is
  kept as a "would have called" entry (`would` in the record), settled by the same rules, for the review and the
  study. A name ThetaData has no quotes for at that mark is recorded as not scored. When the engine starts after the
  open, it fills the session's marks from 09:30 ET the same way, oldest first, and always behind the live pass.
  A record written before this rule, with a late call in `calls`, is read with that call moved to `would` and its
  seat given back.
- After the close (from 16:20 ET, once every call has settled and no mark is pending) it builds the session's review
  and study once, and a day it missed the next time it runs (`src/data/compassReview.ts`, `compassStudy.ts`).
  `npm run compass:study -- YYYYMMDD` builds them for any day on record, through the dev server's `/api/theta`.
- Between marks it refreshes the cards' quotes every 15 seconds and settles every open call once a minute on the
  contract's own one-minute NBBO.
- On an early-close day nothing is scored after the close and the flats move with it. The close is
  `core/calendar`'s (13:00 on a listed early close) from the day roll, and ThetaData's calendar is asked every tick
  (at most every 10 s) until it answers.
- A market holiday is no session: no mark is scanned on it or in the overnight before it, and that clock's record
  belongs to the next trading day.
- At 20:15 ET the session rolls to the next trading day: a new file, every seat free.

## The rules the scan applies

- **Entry time (Books A and B).** A mark can call only if `t` (minutes after 09:30) is inside the trees' trained
  minutes, 15 to 330 (09:45 to 15:00), **and** at least 55 minutes before the session's flat: `flatT − t ≥ 55`, with
  `flatT = 385` (15:55) on a full day and `close − 5 − 570` on an early close (205 on a 13:00 close, so the last
  entry is 12:00). `entryTimeOk` in `compassParams.ts`. 09:30–09:40, 15:05 on, the curb and every overnight mark are
  scored and logged, but call nothing. The theta-burn check reads the same flat.
- **Inputs the trees never saw missing.** A LightGBM split with missing type *none* reads a NaN as 0. Where 0 is
  outside the column's training range, that row walks a branch no training row took, so the model is not scored
  (`lgbm.ts nanUnsafeColumns`): Model 1 on columns 0, 6, 7, 15, 32; Model 2 on 0, 6, 7, 9, 15, 32, 38, 40, 41. Live
  that is Model 2 before 10:30 (range compression, column 9, needs 60 minutes) and any row without realised vol
  (column 7) or gamma/|theta| (column 41). Model 2 unscored: `prun` is null, Book A does not ride, the reason says
  so. Model 1 unscored: no call. Column 5 (place in the day range) is clipped to its training [0, 1]; to the trees
  that changes nothing (every split on it lies in 0.0118–0.9857).
- **Fresh bars.** A live score needs minute t−1's bar; a memo that does not reach it is read again.
- **Late marks** are judged on the seats and contracts as they stood at their own mark.
- **The weekly read** is each name's nearest expiry 1 to 7 sessions out, 17 strikes either side of the money (Book
  B's outer strike at the widest span); the same-day read is 16.
- **Exits.** Books A and B settle on the contract's one-minute NBBO, and on its 1-second quotes in every minute
  whose range crosses the stop, the 1.50× target or a ratchet rung (at most 12 such minutes a call). The 1.25×
  break-even stop is the ask plus the round trip's fees. Fees: $0.50 commission and $0.04 exchange a side, the SEC
  fee (0.0000278 of the sale) and FINRA's TAF ($0.00279 a contract sold).
- **Sessions to expiry** (`weekdayDte`) skip market holidays. `yearFrac` for a 1–7 DTE contract still counts only
  today's minutes, as the training rows did; it is a retrain item, not a live fix.
- **The study.** Pooled rates carry cluster-robust Wilson intervals (by session; by name and session in a pool of one
  session) and an effective row count; the rows bar reads effective rows. Each label follows its own book's exit.
  The threshold sweep is advisory: it tries seven cuts on the same rows.

## The record

One file per session date, `.cache/compass/YYYY-MM-DD.json` (git-ignored):

```
{
  "format": "compass-record/1",
  "day": "2026-10-29",
  "savedAt": 1793297290023,
  "close": null,                      // the early close, minute of the day, or null
  "calls": [ Signal ],                // every call the live scan fired, newest first, with its settlement
  "would": [ Signal ],                // what late marks would have called: never calls, never seats
  "marks": [ { "at", "clock": "10:15", "sleeve": "odte" | "weekly" | "lottery",
               "names": { "SPY": "live" | "late" | "quiet" | "none" | "pending" }, "scored", "ranAt" } ],
  "lottery": true,                    // Book C swept this session
  "state": { … },                     // the cards, passes and seats, to resume after a restart
  "meta": { "spots", "sparks", "line", "theta", "downSince" }
}
```

A `Signal` (`src/data/compassLedger.ts`) is the call: contract, book, the bid and ask it fired on and their stamp,
Model 1 and Model 2, `how` (`live` or `late`), `mark`, and `outcome` (fill, exit, peak, stop, return, P&L per
contract after fees). Every scored row's 56 inputs are also logged to `.cache/compass/rows/YYYY-MM-DD.jsonl` for
`scripts/compass-validate.ts` and `scripts/compass-validate.py`.

After the session: `.cache/compass/review/YYYY-MM-DD.json` (every trade: the entry snapshot with the inputs that
pushed Model 1 up and held it down, by tree path attribution; the underlying, IV, mid and spread after; the cause),
`.cache/compass/study/YYYY-MM-DD.json` (the 50%+ movers on both sleeves and what stopped each, the miss reasons, the
calibration table, the suggested changes, none applied) and `.cache/compass/labels/YYYY-MM-DD.jsonl` (every scored
row with what the books would have done from its mark: the fill, the exit, take-profit before the stop, whether the
bid ever reached 1.50× before the flat). The labels are the training and validation set the "Unvalidated" label
needs, built from the live inputs.

## The API (read-only)

- `GET /api/compass/state[?rev=N]`: the board, the record (this session and the four before) and the engine's state;
  `{ rev, same: true }` when the browser already holds `rev`.
- `GET /api/compass/record?day=YYYY-MM-DD`: one session's official record.
- `GET /api/compass/days`: the sessions on record and their call counts.
- `GET /api/compass/review?day=YYYY-MM-DD` and `GET /api/compass/study?day=YYYY-MM-DD`: a session's review and study.

The gate is the data proxies' (`server/auth.mjs`): open on local work, a signed-in plan when accounts are on.

## A hosted deployment

Vercel runs functions, not a long-lived process: the engine cannot run there, and `/api/compass/*` answers that it
is not running. A hosted Compass needs one always-on machine, the same one that runs the ThetaData terminal and its
relay (`docs/theta-terminal.md`), running `npm run serve` (or `server.ts` under a process manager) with a writable
`.cache/compass/`, and the site reading `/api/compass/*` from it (a rewrite of `/api/compass/*` to that host, behind
the same sign-in gate). Nothing of that is built yet.
