# The engine spec, carved against launch

*Written 2026-10-10 for Noah and his partner, after reading the partner's spec v2.5 whole (`partner-spec-v2.5.md`, the
HTML beside it). This is the terminal's side of the table: what the spec is, what it moves, what we would build from
it first, what waits, and the three places it collides with rulings already made. Argue from this page.*

## What the spec is, in one paragraph

A specification for the engine behind Compass — not for the product. A non-executing options signal platform: market
data from Massive and Unusual Whales plus two new vendors (the full OPRA feed through Databento, NYSE auction data)
into a TimescaleDB time-series store at nanosecond precision; a data-health gate that refuses stale or crossed quotes
and prices only at the natural bid or ask; twenty alpha modules; nine expiry horizons; five strategy families rolled
out in phases; four risk tiers; a five-state lifecycle; a JSON "callout" the website displays; walk-forward backtests,
feed ablation and a thirty-day live shadow before anything is published; fifteen phases, each gated on the one before.
It never mentions Terrain, Pinpoint, Trace, Dossier, the Weigher, Practice, the landing, billing, accounts or the
gates — the product around the engine, which is what a person touches on day one.

## What it moves toward launch

By itself, nothing: it is a plan for the thing behind one room. Taken literally it pushes launch out — phases 1–7
have to land before the thirty-day shadow can start, and the shadow has to end before Compass may publish a single
live setup. Honest sizing:

| | |
|---|---|
| The spec as written | 12–18 months with a dedicated quant developer, plus an ingestion server and a database we operate ourselves |
| First live Compass signal, literal reading | 5–7 months after the data plane starts |
| The carved version below, after the Massive keys | 6–10 weeks |

The path: **launch first, engine second.** The rooms run on Massive's data and on Unusual Whales' dealer positioning
(Noah's ruling, 2026-10-10; `signed-book-spec.md` stays filed as a check against their numbers). Compass at launch runs the twelve kinds (`compass-backtest-spec.md`, the kinds-and-sleeves
table) on real chains and real levels, with the honest states it has now. The spec's cheap, real phases are then
built inside Compass; the rest waits until the engine has earned it.

## The fifteen phases, one by one

| # | The spec's phase | What exists today | Verdict | The work |
|---|---|---|---|---|
| 1 | Data-source inventory: Massive, Unusual Whales, Databento/OPRA websockets | The provider decision (Massive for stocks, futures, options, indices; Unusual Whales for flow and dark pool); the engine port's parity tests; nothing wired until the keys | **Now, without Databento** | Massive + Unusual Whales clients; their positioning read first (see the collisions) |
| 2 | TimescaleDB hypertables, nanosecond normalisation, continuous aggregates | The shape agreed on 2026-09-17 (`launch-costs.md`, chapter 1b): Supabase Postgres for the rows the app queries (accounts, billing, the stores, the recent window of the loop's records) and Parquet files on Cloudflare R2 for the big history. Our Supabase project runs Postgres 17, where Supabase no longer offers TimescaleDB at all (checked 2026-10-10; it points hypertables at `pg_partman`) | **Defer** | We are not storing a hundred billion messages a day. Massive's bars and chains, cached in Postgres where a page needs history, the archive as Parquet on R2; a time-series store only if an ingestion of our own ever exists, and then on its own box, not inside Supabase |
| 3 | Data-health gates: stale quotes, crossed markets, true NBBO, no mid | The paper desk and the Weigher price at the natural side; no stale/crossed check anywhere | **Now** | One `quoteHealth(quote)` the rooms share: age, crossed, missing metadata; the natural price everywhere a figure is sold as executable. A day. Makes every room more honest, not only Compass |
| 4 | The callout schema and the candidates/rejections ledger | Compass's states; the Tracker; the journal; `audit_log` for accounts | **Now** | A `compass_ledger` table (candidate, kind, sleeve, the gate's verdict and reason, the state changes) under RLS — also the track record the partner will want; the schema's fields map onto our Setup, with the numbers kept inside |
| 5 | Baseline directional forecasts, single-leg evaluation | The twelve kinds on five sleeves, first-cut profiles on the sim | **Now** | The kinds on real chains; the partner's math per kind replaces the first cuts one by one |
| 6 | The lifecycle: wait / no-trade / entry / hold / exit, the counterfactual hold audit | Active · Watch · Fading on every card; the Tracker follows to the close | **Now, mapped** | WAIT = Watch, ENTRY = Active, HOLD = Active with the audit, EXIT = the Tracker's close, NO-TRADE = the gate's refusal into the ledger. The hold audit is a rule on the Tracker, not a new room |
| 7 | The risk engine: Reg T vs Portfolio Margin stress, tiers 1–4 | The four words (strong · good · caution · poor), the case on the Weigher | **Now, mapped** | The tiers are computed and kept inside; the page says the four words, with the confidence figure beside them since his ruling (see the collisions). The ±15% stress array is a function on the chain we already price |
| 8 | Defined-risk verticals with package pricing | Backtest prices debit spreads; credit spreads not built | **Soon** | Credit spreads in the backtest engine; package pricing at the natural side of both legs |
| 9 | The news engine: NLP, entity linkage, reaction latency | The Dossier's news wire with the numbers behind each headline | **Later** | A simpler scoring on the Dossier's wire first (novelty, source, freshness); entity linkage and latency arbitrage when there is a quant to own them |
| 10 | Volatility strategies: eSSVI + SABR surfaces, straddles/strangles | The chain's own smile (one estimator every surface prices with) | **Later — the partner's math** | A fitted surface is a real piece of work; it earns its place once single legs and verticals have a track record |
| 11 | Calendars and diagonals across the term structure | Nothing | **Later** | After 10 |
| 12 | Butterflies, condors, broken-wing butterflies | Nothing | **Later** | After 10 and 11 |
| 13 | Microstructure: NYSE auctions, dark pool, Unusual Whales GEX | Trace (the tape, the dark pool), our own dealer positioning | **Partly now** | Dark pool, flow and the dealer positioning from Unusual Whales now (his ruling); NYSE auction data is a new vendor — later; our own exposure math stays as a check |
| 14 | Walk-forward backtests and feed ablation | The backtest engine and its proofs; the journal's reads | **Later** | Walk-forward on our own harness once real history is stored; ablation when there is more than one feed to ablate |
| 15 | A thirty-day live shadow before public release | Nothing | **Replace** | A private beta with the ledger: real people, real chains, every candidate and refusal recorded; the audit the shadow wanted, with the launch not held hostage to it |

## Three collisions with rulings already made — and how Noah settled them (2026-10-10)

1. **The callout publishes numbers** — directional confidence 0.84, estimated edge, a tier. The ruling of 2026-09-19
   was no score, grade, weight or cut in public; four words only. **Noah's answer: "yes public confidence numbers."**
   So a setup's confidence prints as a percentage again wherever Compass speaks — the board's card, the setup's page,
   the Tracker, the print card's Compass scale — the figure beside the word, the word keeping its ink and meter. The
   rest of the old ruling stands until he says otherwise: the stock page's read, the news wire's "sure", the dark
   pool's posture and conviction stay words; no track record or hit rate in public. Two cautions: a percentage
   promises calibration, and the sim's confidence is a score on another scale — on real data the ledger (module 20)
   must run before "84%" means 84 in 100; and the lawyer reads the wording of any published probability. Not built yet.
2. **The dealer positioning comes from Unusual Whales in the spec.** It had been ours by decision, and the signed book
   was to be the first build after the keys. **Noah's answer: "dealer positioning will be from unusual whales."** So
   the gamma, delta, vanna and charm exposure by strike and by expiry, and the flip, are read from their endpoints
   (verify routes, fields and sign convention against their docs before wiring); the Map, the walls, the flip, the
   supreme, Pulse's book tiles and the Weigher's strike block read their numbers; our exposure math stays as the dev
   feed and a check beside theirs. The first build after the keys becomes their adapter. The page still says what a
   figure is and why, from their published definitions.
3. **The words.** Callouts, alpha, signals, ISOs, epistemic uncertainty. Inside the engine, fine. On the page, plain
   English, as every room already speaks. **Noah's answer: "use his wording" — with one exception: "only keep our word
   'setups' and not 'callouts'."** So as the engine's phases land, the page speaks the spec's vocabulary — thesis
   confidence, estimated edge, risk tier, the published statuses, NBBO, natural price, IV percentile, regime — and the
   plain line moves one hover away: his word on the page, our sentence underneath in the Term explainer
   (`src/data/terms.ts`, the dotted underline). The table below is the rename map. Two notes. Of his lifecycle, the
   page shows the PUBLISHED statuses (WAIT · TRIGGERED · HOLD · TARGET HIT · INVALIDATED · EXPIRED · WITHDRAWN); ENTRY
   and EXIT are the engine's internal verdicts and stay inside, as they always have. And one word of his stays banned:
   "regime" (Noah, 2026-10-10, keeping his ruling of 2026-09-05) — the page says "which way dealers are hedging", "a
   trend day", "a range day"; the engine's regime module keeps its name inside. Nothing is renamed until he says build it;
   each rename rides the phase that brings its feature.

## His words and ours — the rename map

Since the ruling, his word is what the page will say. The third column is what the page says today, to be replaced as
each phase lands, with today's plain sentence moving under his term as its explainer. Where his concept has no twin
here yet (edge, tier, the no-trade reasons, term structure), his word arrives with the feature. The Greeks and the
options words are the same on both sides (gamma, delta, vanna, charm, open interest, implied volatility, the walls,
the flip). The kinds and the sleeves are already his: they come from his own setups table of 2026-10-10
(`compass-backtest-spec.md`), not from this spec's nine horizons and five strategy families. And one word is ours by
his exception: a setup, never a callout.

| His word | Plainly | What the page says today (to be renamed) |
|---|---|---|
| callout, signal | one published trade idea | a setup — STAYS OURS (his one exception) |
| alpha, alpha module | a source of edge; one scoring input | never said — "Why we chose this", "Behind the read", the reasons for and against |
| strategy family, taxonomy | the shape of the trade | a kind (the twelve on the Compass board); in Practice "a debit spread" |
| expiration horizon (nine, 0DTE to LEAPS) | how far out | a sleeve (five): 0DTE · Weekly · Swing · Position · Long-dated |
| thesis, directional forecast | which way, and why | "The case", "Why we chose this" |
| directional confidence 0.84 | how sure the engine is | strong · good · caution · poor — and the percentage beside it, since his ruling |
| estimated edge, expected value | what it should make after costs | not shown; the nearest is the position card's return — a new thing to name if it comes |
| risk tier 1–4 | how dangerous | not graded; the case's word and "the levels in the way" carry it — a tier would be new |
| WAIT · ENTRY · HOLD · EXIT · NO-TRADE; TRIGGERED, TARGET HIT, INVALIDATED, EXPIRED, WITHDRAWN | the state of the idea | Watch · Active · Fading; the Tracker's closes — states, never orders; ENTER/EXIT never printed |
| no-trade ledger, rejection rationale | passed on it, and why | nothing public yet; would read "Passed — the spread was too wide" |
| data-health gate, executable-quality gate | stale or crossed quotes thrown out | silent on the page; at most a "stale" tag |
| NBBO, natural price, midpoint | the best bid and ask across exchanges; what you would actually pay; halfway | "the bid and ask"; Flow: "BUY paid the offer, SELL hit the bid, MID negotiated in between"; Mark: "halfway between what buyers bid and sellers ask" |
| intermarket sweep order (ISO) | an order raced across exchanges at once | a sweep — "A SWEEP raced across exchanges at once" |
| GEX flip price; dealer hedging flows; pinning | where dealers switch sides; what they must buy or sell; the strike price gravitates to | "Gamma flip", "the flip"; "dealers must sell $X of stock to stay hedged — a headwind"; Pin |
| market regime, regime classification | the kind of day the market is having | STAYS BANNED (his word, 2026-10-10) — "which way dealers are hedging", "Hedging today", "a range day / a trend day" |
| microstructure | how orders actually trade | "price", "prints", "the flow" |
| institutional footprinting | big money's tracks | "accumulating · distributing", the dark pool's posture |
| IV percentile, IV crush, IV expansion | how pricey options are against their own past; the collapse after an event | "IV rank — where this name's option prices sit against their own past year"; "Priced vs typical"; "Expected move" |
| term structure, contango and backwardation, skew | near versus far expiries' prices; puts versus calls | not on a page yet; would read "near-dated options cost more than far-dated ones" |
| eSSVI, SABR, β and ν, Levenberg–Marquardt | fitting the volatility surface | engine only, never on a page |
| catalyst, entity linkage, reaction latency | the news event; who else it touches; how fast price caught up | "a headline lands"; the Dossier's "Already priced in", "Odds next session up" |
| epistemic uncertainty, model disagreement | the models do not agree | "the reads disagree" — the stock page's agreement chips |
| crowded trade, squeeze risk | everyone is in the same trade | not shown |
| counterfactual hold-versus-exit audit | should you still be in it | Fading; the Tracker's "the case now reads caution" |
| walk-forward, ablation, live shadow, calibration ledger | the engine's own tests | never public; the runs page is owners only |
| package pricing, legging risk | all legs priced as one order; the risk of filling one leg at a time | would read "both legs priced as one order" |
| Reg T, Portfolio Margin | the two margin rulebooks | not said; the terminal does not talk margin |
| theta decay, gamma, vega, delta | the Greeks | kept, each with its line: "Theta — what one day costs" |
| ts_event, nanosecond timestamps, hypertables, TimescaleDB | plumbing | never |

Two things the spec gets right that we should adopt everywhere, not only in Compass: the natural price (never the
mid) wherever a figure is sold as executable, and the no-trade ledger — a refusal recorded with its reason is a
decision, not a failure.

## What this means for the order of work

Unchanged from the roadmap: the domain and hosting, Stripe live, mail, the launch loose ends, then the Massive and
Unusual Whales keys with their positioning on the Map (the signed book stays as a check). The carving adds, after the keys: the health gate (3), the ledger (4), the twelve kinds on real
chains (5), the lifecycle mapped (6), the tiers inside the four words (7), credit spreads (8). Then the private beta
(15, replaced). The partner's math lands kind by kind on top of that, and the surfaces (10–12) come when a quant owns
them.
