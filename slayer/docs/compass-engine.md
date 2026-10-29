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
- One process per record folder runs the scan: it holds `.cache/compass/engine.lock`. A second server on the same
  folder serves the first one's record and scans nothing.
- `COMPASS_ENGINE=0` serves the record without scanning. `COMPASS_DIR` moves the record.

## What it does

- At every mark (every five minutes while a root's options trade, plus 09:29 VIX, 15:59 and 16:14) it reads a
  snapshot of every name on the sleeve (0DTE: the roots with a same-day contract; 1–7 DTE: the twenty roots with the
  full feature row) and scores Books A and B. Book C sweeps once from 15:20 ET.
- A name the terminal does not answer inside the mark's minute (the terminal down, the session lost, the previous
  pass still running) is scored afterwards from the quotes that stood at that exact instant (`option/at_time/quote`),
  marked "scored late from recorded quotes (HH:MM ET mark)". A name ThetaData has no quotes for at that mark is
  recorded as not scored. When the engine starts after the open, it fills the session's marks from 09:30 ET the
  same way, oldest first, and always behind the live pass.
- Between marks it refreshes the cards' quotes every 15 seconds and settles every open call once a minute on the
  contract's own one-minute NBBO.
- On an early-close day (ThetaData's calendar) nothing is scored after the close and the flats move with it.
- At 20:15 ET the session rolls to the next trading day: a new file, every seat free.

## The record

One file per session date, `.cache/compass/YYYY-MM-DD.json` (git-ignored):

```
{
  "format": "compass-record/1",
  "day": "2026-10-29",
  "savedAt": 1793297290023,
  "close": null,                      // the early close, minute of the day, or null
  "calls": [ Signal ],                // every Book A, B and C call, newest first, with its settlement
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

## The API (read-only)

- `GET /api/compass/state[?rev=N]`: the board, the record (this session and the four before) and the engine's state;
  `{ rev, same: true }` when the browser already holds `rev`.
- `GET /api/compass/record?day=YYYY-MM-DD`: one session's official record.
- `GET /api/compass/days`: the sessions on record and their call counts.

The gate is the data proxies' (`server/auth.mjs`): open on local work, a signed-in plan when accounts are on.

## A hosted deployment

Vercel runs functions, not a long-lived process: the engine cannot run there, and `/api/compass/*` answers that it
is not running. A hosted Compass needs one always-on machine, the same one that runs the ThetaData terminal and its
relay (`docs/theta-terminal.md`), running `npm run serve` (or `server.ts` under a process manager) with a writable
`.cache/compass/`, and the site reading `/api/compass/*` from it (a rewrite of `/api/compass/*` to that host, behind
the same sign-in gate). Nothing of that is built yet.
