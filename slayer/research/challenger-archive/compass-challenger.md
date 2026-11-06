# The Compass challenger (shadow)

Two challenger machines score beside the live books: one for the same-day sleeve (0DTE) and one for the 1–7 DTE
sleeve. They **never place a call, never take a live seat and never change what a viewer sees as a call.** What they
would call is kept in the session record's `challenger` section, settled by the same exits, and shown apart on the
Blotter as **"Model 4 · shadow"** (the owner's naming: a machine is called by its number only, never shown with a score
or a percentage). Promotion to live is the owner's decision; nothing here does it. **Nothing is shipped today:** no
candidate has met the owner's bar (60% or more wins, +50% before the stop, on a locked holdout); the v1 machines
were removed and the shadow stays off until one does.

Research log (hypothesis → test → result): `research/challenger/LOG.md`. The move study:
`research/challenger/HOW_MOVES_HAPPEN.md`.

## What runs live (shadow)

- `src/data/compassModel.ts` emits every row the scan built inputs for (`onFeatureRow`: the contract, its 56 live
  inputs, Model 1 and Model 2 or null, the gates the books applied, and the reads the row was built from) and the end
  of each scoring pass. It computes nothing and emits nothing when no listener is registered; a listener's fault is
  swallowed. Nothing the scan decides depends on it.
- `src/data/compassChallenger.ts` (server only) listens: each row inside the entry minutes, in Book A's span or Book
  B's wing band, past the spread and the theta burn, is scored by its sleeve's machine on the challenger inputs
  (`src/data/challengerFeatures.ts`), calibrated, and at or over the line goes to the pass's pool; at the end of the
  pass the same seat rules as the live books pick (five seats a session, one call a root, one a contract, the drive
  rule, a flat root with both sides clearing calls neither, drives first then the highest score) — in the
  challenger's own book. Book A rides the ratchet when the Runner score clears 0.50, Book B always, as live.
- No request of its own for scoring: every input is a read the scan already made (the board at the mark, its quotes
  30 minutes back, the day's and prior sessions' bars from the scan's memo, the open interest). Settlement uses the
  ledger's own reads and rules (`contractPath`, the 1-second stop/target minutes, `settleSignal`), once a minute.
- `src/data/compassServer.ts`: the record's `challenger` section (`compass-challenger/1`: the model hashes, the line,
  the calls), resumed after a restart, rolled at 20:15 with the session; `/api/compass/state` carries `challenger`
  (this session and the four before) and `challengerLock` (why it is off, if it is).
- The Blotter shows a second track record, "Model 4 · shadow", under the live one: calls, won · lost, hit rate,
  average return, P&L, worst, by book and by machine. Never mixed into the live record.
- **`CHALLENGER_SHADOW=0`** turns it off: no listener, no section in the record, nothing scored beside the books.
- The files: `public/models/challenger-odte.txt`, `challenger-weekly.txt` (LightGBM text dumps, the format
  `src/data/lgbm.ts` reads) and `challenger-meta.json` (input count, tree counts, the isotonic calibration per
  time-of-day bucket, the line), locked by `src/data/challengerParams.ts` — separate from the live models' hashes in
  `compassParams.ts`. A file that does not hash leaves the shadow off and says why.

## Proofs that the live path is unchanged

- `scripts/lgbm-parity-proof.ts` and `scripts/golden/compass-golden.ts`: unchanged and passing.
- `scripts/golden/challenger-golden.ts`: a recorded session (`scripts/fixtures/challenger-day`, 2026-10-30, SPY and
  XSP same-day and weekly, GLD and AAPL; overnight 20:30–21:30 and 09:45–11:00) through the engine's late path with
  the challenger off and on, each in its own process: the same rows scored with the same Model 1 and Model 2, the same
  would-calls, the same seats; the challenger's calls only in its own book.
- The replay of 2026-10-30 (`scripts/compass-replay.ts`, 09:30–15:05) with the code before the challenger and after,
  through a caching relay so both read byte-identical answers: the same calls.
- `scripts/challenger-parity-proof.ts`: the TypeScript scorer and calibration against LightGBM's own
  `Booster.predict` and the meta file's isotonic maps on 200 real rows per machine and edge vectors, to 1e-12.

## Data

- `research/challenger/fetch.ts`: per session and root, ONE chain-NBBO request per expiry and calendar date
  (1-minute, the engine's own strike band: 16 either side same-day, 17 weekly), over every session the root trades
  (the index roots' overnight from 20:15 the evening before, the 07:30 options pre-market, the regular session, the
  curb); the open interest of each GEX-core expiry; 1-minute bars one request per symbol and month. Newest first,
  resumable per day, at most two requests in flight. Git-ignored under `research/challenger/data/`.
- `research/challenger/localHost.ts` answers the engine's own requests from that cache, so
  `research/challenger/build.ts` runs **the engine's own late path** (the replay's loop: `atMark`, `scoreBook`,
  `recordPicks`, Book C's sweep) over each session: every gate, every live input, Model 1 and Model 2 exactly as the
  engine computes them. Book C's 15:20:15 board and every 1-second exit window are read from the terminal once and
  cached.
- Each Book A/B candidate row (inside the entry minutes, in the books' strike bands, past the spread) is written with
  its live scores, the challenger inputs, the gates and the pass it was scored in (for the seat simulation), and its
  outcome under the books' exits on the contract's 1-minute NBBO, as a non-runner and as a runner, plus the move's
  anatomy (time to +50%, the best bid, the greeks attribution).

## Inputs (60, `CHALLENGER_INPUTS`)

Session-relative or scale-free throughout, so the overnight index session and the options pre-market score on the
same footing as the regular session:

- the underlying is the chain's own put–call parity forward (the cash index has no overnight print), its path read
  from the same chain 5–30 minutes back (forward returns, realised vol over 30 minutes, the efficiency ratio);
- time: the session kind, minutes since that session opened, minutes to its own flat, t, weekday, sessions and true
  days to expiry (the live trees' T counts only today's minutes);
- the contract: signed log-moneyness and moneyness in expected moves, mid/spot, spread/mid, contract IV and IV − ATM
  IV, |delta|, gamma·S²/mid, theta/mid, vega/mid, premium/expected move, the mid's 5/15/30-minute change, ask against
  its ask 30 minutes back;
- vol: ATM IV and its 15/30-minute change, skew and its 30-minute change, realised/implied, the HAR horizons (1, 5,
  15 sessions) and ATM IV / HAR forecast (research/physics #1), SPY's HAR forecast;
- the prior session: gap, distance to the prior high and low, its range;
- the regular session only (NaN elsewhere, a missing value to the trees): return from the open, place in the day
  range, range/open, rv30/ATM IV, VWAP z, volume against its curve, the opening-range break;
- market: SPY's 15-minute return and its vol shock (15-minute against the day's realised vol, research/physics #3);
- dealer gamma from open interest (research/physics #2, scale-free): net/gross gamma, the gamma flip and the walls in
  expected moves, the contract's share of the expiry's open interest;
- the index and high-beta classes, the book (A or B).

## Training and validation

`research/challenger/train.py` (protocol fixed before any test session was looked at):

- one LightGBM binary classifier per sleeve; label: the 1.50× take-profit reached before the stop under Book A's
  non-runner rules (the books' own exit);
- walk-forward by session: held-out blocks of consecutive sessions; a block's models see only sessions ending five
  sessions before it (purge: every label closes inside its own session; the embargo covers the slow inputs);
- hyper-parameters fixed a priori (`PARAMS`), never tuned on a test block;
- inside each fold's training sessions the last quarter is its calibration set: isotonic per time-of-day bucket
  (overnight, pre-market, 09:30–10:30, 10:30–12:00, 12:00–14:00, 14:00+), so a score means the same at 09:45 as at
  13:00; the line is the one on a fixed grid that maximises the expected P&L per session (no fees) of the calls the
  seats make on the calibration sessions;
- `research/challenger/evaluate.py`: the challenger against the current books on the same held-out sessions, the
  same seats and the same exits: the Hit score + Runner score (Books A/B), the Hit score without the ride, the Late
  sweep (Book C, its own record), per call and per session, with session-block bootstrap intervals and the paired
  difference.

## Results

See the latest section of `research/challenger/LOG.md` for the current numbers and their intervals.

## Promotion (the owner's decision)

The challenger is not promoted by any of this. What would justify asking: enough **live shadow sessions** (the
record's `challenger` section, settled by the live exits) that the paired per-session difference against the live
books excludes zero; the same across session types (overnight, pre-market, regular) and both sleeves; no input drift
between the shadow's live rows and the training rows. To promote, the owner would move the machines into the live
scorer behind their own flag, with the live models' hashes untouched until then.
