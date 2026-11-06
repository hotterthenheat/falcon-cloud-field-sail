# EDGE-K log: a data-driven contract chooser, tested on the same signals

Protocol /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10-14. Long calls/puts only. Pre-registration `specs/PREREG.md` @ a0e1dc6
(12 variants, before any fit or outcome). Full tables: `results/DEV.md`; look-ahead test `results/lookahead.txt`;
synthetic null `results/synthetic_null.json`.

## The chooser in plain words
For a signal (root, side, time) it takes every listed 0DTE contract on that side with a two-sided quote (and, for SPX
signals, every XSP contract), and for each one asks: "if I buy this at today's ask and run the exits this signal really
uses, what do I get back per dollar paid, on average, after spread and fees?" It answers by simulating 1,000-2,000
paths of the underlying for the rest of the hold. The paths' size comes from the underlying's own recent realised
moves (a per-minute variance profile from the last 60 sessions, scaled by how volatile yesterday and this morning were,
with the scaling learned on DEV), never from the option's implied vol. Their direction comes only from what the signal
has historically been worth (the signal's average move, learned on DEV). Each contract is re-priced along every path
at its own implied variance, decaying in the underlying's business time; the exit bid is the model mid minus a spread
that scales with the price the way DEV spreads do. The exits (stop, trail, time flat) are applied to that bid. The
contract with the best average net return per dollar wins; if none is above zero, it picks nothing. Every fitted number
for a session comes from the other 80% of DEV (5 contiguous folds).

## Implementation notes (all before any outcome was read)
- z pool demeaned and unit-scaled (the prereg's "standardised"): the first smoke test showed a raw pool from a rising
  60-day window adds a +0.2% drift over a day, which is the drift term's job. Fixed before any pick was stored.
- Fetch order: phase 1 fetches the compared pickers (K-forced, K-root, A, B, C, D), phase 2 the null picks (random,
  kappa = 0). Order changes no outcome.
- XSP boards fetched one minute each (~4-10 s per request on the shared terminal).
