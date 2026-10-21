# Slayer Terminal — Complete Product Specification and Architecture (the partner's spec, v2.5)

*His partner's document, filed whole on 2026-10-10 from the Google Doc's text export; the same text in its presentation form is `partner-spec-v2.5.html` beside this file (the twenty modules live in that file's script and are appended below). The small digits glued to some words are the original's citation marks; a symbol in square brackets stands where the export dropped an equation object, restored from the HTML or marked as missing. Our reading of it against the fifteen phases is in `compass-engine-carving.md`.*

## Executive Summary and System Objective

The Slayer Terminal project aims to architect and deploy an advanced, data-driven options research and signal-generation platform. The core objective is to identify, evaluate, rank, and publish high-quality options trade callouts to a web interface. The product transcends generic options scanners, which typically rely on rudimentary volume or open interest filters. Instead, Slayer Terminal synthesizes real-time market microstructure data, non-arbitrage volatility analytics, non-standard options activity, cross-asset macro indicators, and proprietary risk models. The system determines the optimal underlying asset, the precise options strategy, the exact expiration and strike structure, and the lifecycle management logic (entry, hold, adjustment, exit, or rejection).

The platform operates strictly as an intelligence and signal-publishing engine; it does not connect to a brokerage or execute trades autonomously. This document serves as the foundational Product Requirements and Technical Design specification, establishing the data architecture, strategy taxonomy, mathematical models, validation plan, risk framework, and implementation roadmap required before authorizing production strategy code. The explicit goal is a differentiated, comprehensive options-intelligence platform that selects the most appropriate strategy for each opportunity and transparently documents both the mathematical edge and the structural risks.

## Data Architecture, Timestamps, and Quality Controls

To manage the immense volume of options data—which routinely exceeds 100 billion messages per day and generates massive microbursts during volatile events—the system requires a robust, high-throughput time-series data architecture1.

### Storage and Normalization Architecture

The underlying storage relies on a time-series database optimized for high-frequency financial data, utilizing hypertables partitioned by timestamps to enable continuous aggregations and columnar compression2. The architecture utilizes TimescaleDB to handle the ingestion of raw trades and quotes, ensuring that historical backtesting and real-time querying operate with minimal latency. Continuous aggregates allow the system to pre-calculate minute and daily bars, dramatically reducing query times for historical volatility modeling3.

### Microstructure and Timestamp Precision

The platform requires nanosecond-precision timestamps to maintain the exact sequencing of market events and to prevent look-ahead bias during historical validation. The system records multiple timestamps for every event: ts_event (the time the event occurred at the matching engine), ts_recv (the time the capture server received the packet), and ts_in_delta (the sending timestamp offset)4. By strictly querying against the ts_event timestamp bounded by the current system clock during shadow testing, the architecture guarantees point-in-time accuracy, completely isolating the simulation from future corporate actions, news ingestion, or closing open-interest figures.

### Executable-Quality and Data-Health Gate

Before any signal generation occurs, a deterministic data-health gate evaluates the real-time tape. The system rejects opportunities where quotes are stale, markets are crossed, or required contract metadata is missing. For multi-leg positions, the system accounts for realistic package pricing. Theoretical midpoint pricing is strictly prohibited; the engine evaluates the natural price (buying the ask, selling the bid) across the National Best Bid and Offer (NBBO)6. If the resulting net debit or credit eliminates the statistical edge, or if liquidity stress suggests severe slippage, the setup transitions to a "No-Trade" state. All rejected candidates and their specific rejection rationales are recorded in a dedicated database ledger.

### API Endpoint-to-Feature Mapping

The platform integrates distinct data providers, ensuring each input has a documented purpose and demonstrates incremental value through ablation testing.

| Data Source | Specific Endpoints and Fields | Target System Feature / Module |
|---|---|---|
| Massive Equities & Indices | trades, quotes, aggregates, snapshots, technicals, financials7 | Multi-timeframe directional forecasting, market-regime classification, benchmark relative strength. |
| Massive Options | Option chains, Greek snapshots, historical implied volatility (IV), open interest9 | Single-leg evaluation, IV surface baseline calculation, cross-contract consistency analysis. |
| OPRA via Databento | OPRA.PILLAR multicast binary feed, nanosecond ts_event, consolidated NBBO11 | Microstructure analysis, execution-quality gating, multi-leg package pricing, slippage modeling. |
| Unusual Whales | Options flow (blocks/sweeps), GEX (Gamma Exposure) flip price, Dark Pool prints13 | Options flow quality, SPX 0DTE positioning, institutional footprinting, support/resistance mapping. |
| NYSE Auction Data | Real-time opening and closing imbalance data15 | Short-horizon opportunity detection, opening gap forecasting, closing momentum analysis. |
| Massive Cross-Asset | Forex and Crypto aggregates and volatility metrics9 | Macroeconomic context, cross-asset correlation shocks, systemic risk sentiment analysis. |

## Stock News and Catalyst Intelligence Engine

A proprietary Natural Language Processing (NLP) pipeline evaluates market catalysts. The engine continuously ingests headlines, automatically deduplicating repetitive syndications and scoring updates based on novelty, source reliability, and timestamp freshness. The engine utilizes entity linkage to map news not only to the directly mentioned ticker but also to affected suppliers, competitors, and sector ETFs.

Crucially, the news engine separates directional implications (e.g., an earnings beat signaling upside) from volatility implications (e.g., pending litigation signaling sustained IV expansion). The system measures the market's response immediately following a headline, analyzing price action, volume spikes, and IV skew adjustments. The "News Reaction Latency" module detects delayed repricing; a signal is generated only if a quantifiable, executable mispricing remains on the options chain after the initial market reaction has been absorbed by high-frequency market makers.

## Alpha Module Construction

The intelligence engine operates as a network of independently measurable alpha modules. Each module contributes to the final expected value calculation, and any module failing to add reliable predictive edge after execution costs is systematically deprecated.

### Directional, Regime, and Macroeconomic Modules

The Multi-Timeframe Directional Forecasting module synthesizes price momentum, statistical mean-reversion, and volume profiles across horizons ranging from intraday minutes to multi-month trends. The Market-Regime and Cross-Asset Analysis module contextualizes these directional forecasts by classifying the prevailing environment (e.g., high-inflation, low-volatility, trend-following) using futures, commodity, and currency inputs. To enhance predictive confidence, the Historical Analogs module employs dynamic time warping and vector embeddings to locate statistically similar market setups from the past 20 years, evaluating the probability distribution of subsequent price action. The Futures and Macroeconomic Context module acts as a systemic risk overlay, capable of suppressing bullish equity signals if cross-asset stress indicators trigger.

### Volatility, Pricing, and Relative Value Modules

The Implied Volatility and Surface-Relative Opportunity Detection module fits the empirical volatility surface to detect localized mispricings. The system utilizes the extended Surface Stochastic Volatility Inspired (eSSVI) parametrization, a model that generates a total-variance curve in log-moneyness, guaranteeing a surface free of calendar spread and butterfly arbitrage17. The model relies on a vega-weighted objective function minimized via the Levenberg-Marquardt optimizer17. Complementing this, the Volatility Expansion and Contraction module applies the Stochastic Alpha Beta Rho (SABR) model to forecast future volatility states, calibrating the [β] (skew) and [ν] (vol of vol) parameters to assess the probability of IV crush or expansion21. The Term-Structure and Skew Analysis module evaluates relative pricing across expirations (contango versus backwardation) and strikes (put/call skew steepness), while the Cross-Contract Consistency module identifies relative-value anomalies between highly correlated assets. The Earnings and Catalyst Pricing Analysis module compares historical pre-event IV expansion and post-event volatility crush against current pricing to detect mispriced binary events.

### Microstructure, Flow, and Execution Modules

The Options Flow Quality and Price-Response module filters the consolidated tape for high-premium intermarket sweep orders (ISOs) executed at the ask, differentiating urgent institutional directional bets from routine delta-neutral hedging23. The SPX and 0DTE Positioning module evaluates short-dated gamma profiles, utilizing Gamma Exposure (GEX) flip prices to forecast dealer hedging flows and intraday pinning risks14. The Auction Imbalance and Dark-Pool Context modules analyze off-exchange liquidity and opening/closing crosses for hidden institutional support levels.

To manage system integrity, the Model Disagreement and Forecast Uncertainty module quantifies variance among the predictive engines; high epistemic uncertainty forces a downgrade in the risk tier or an outright signal rejection. The Liquidity Stress and Crowding modules analyze bid/ask spread widths, OPRA quote update frequencies, and correlated opportunity clusters to prevent signaling crowded trades susceptible to squeeze risks. Finally, the Early-Warning Signals and Counterfactual Hold-versus-Exit modules continuously audit active positions, reassessing the expected value of remaining in the trade versus liquidating at the current NBBO.

## Expiration and Contract Coverage Rules

The strategy selection engine maps the opportunity's intended holding horizon to specific expirations, accounting for liquidity, Greek decay curves, and catalyst timing. Contract specifications, exercise styles (American vs. European), and settlement types (physical vs. cash) are strictly evaluated.

| Expiration Horizon | Primary Use Cases | Greek Sensitivities and Risk Profile |
|---|---|---|
| 0DTE | Intraday mean-reversion, macro event hedging on SPX/NDX. | Extreme gamma risk; binary theta decay. Highly speculative (Tier 3/4). |
| 1–2 DTE | Short-horizon momentum, immediate post-earnings reactions. | High gamma; rapid theta bleed. Requires precise timing. |
| 3–7 DTE | Imminent known binary catalysts (e.g., FDA decisions, CPI). | Elevated vega sensitivity; vulnerable to sudden IV crush. |
| 8–14 DTE | Short-term swing trading, tactical vertical spreads. | Balanced gamma/theta; optimal for rapid directional setups. |
| 15–30 DTE | Primary horizon for directional swings and credit spreads. | Manageable theta decay; sufficient time for thesis realization. |
| 31–60 DTE | Core horizon for structural shifts and multi-leg income trades. | Optimal theta decay curve; lower gamma risk; stable delta exposure. |
| 61–90 DTE | Medium-term thematic trends, calendar spread deferred legs. | High vega sensitivity; slow theta decay; highly liquid on standard cycles. |
| 91–180 DTE | Broad macroeconomic thesis expression, equity replacement. | Dominant vega and delta exposure; resilient to short-term noise. |
| LEAPS (>1 Year) | Long-term directional bets, deep ITM synthetic stock. | Minimal theta; deep liquidity checks required; high capital efficiency. |

The engine never assumes equal suitability across expirations. A bullish volatility forecast for a 14-day event will explicitly reject a 60-DTE option if the term structure indicates the deferred volatility premium is unjustified.

## Full Strategy Catalog, Mechanics, and Phased Rollout

The strategy taxonomy is divided into distinct families. The engine evaluates the complete payoff distribution rather than selecting the cheapest contract. Multi-leg strategies are modeled as complete mathematical positions26.

### Phase 1: Single-Leg Strategies

This category encompasses fundamental directional and yielding strategies. While structurally simple, their risk profiles vary drastically.

#### Long Calls and Long Puts

- Market Conditions and Thesis: Deployed for high-confidence directional forecasts where implied volatility is relatively inexpensive, and the expected underlying movement significantly exceeds the breakeven threshold.
- Rejection Logic: Rejected if the IV percentile is historically high, if theta decay over the intended holding period destroys the expected edge, or if the bid/ask spread exceeds the acceptable slippage limit.
- Strike and Expiration Selection: Short-term momentum bursts favor high-gamma, short-DTE ATM options. Longer-term macro theses favor lower-theta, deeper ITM (0.70+ delta) selections.
- Entry Triggers: Triggered when the directional module crosses the confidence threshold and the offer price on the OPRA feed is within the acceptable modeled limit.
- Payoff: Max Loss is 100% of the premium paid. Max Gain is infinite for calls, and strike minus premium for puts. Breakeven is Strike [±] Premium.
- Greeks: Positive gamma, negative theta, positive vega. Highly sensitive to volatility crush.
- Lifecycle and Adjustments: Exit if the underlying thesis invalidates, if the target delta is reached (profit taking), or if a time-stop triggers due to excessive theta bleed.
- Assignment/Execution: Must monitor ex-dividend dates to mitigate early assignment risk on deep ITM calls. No legging risk.
- Risk Tier: Tier 2 or 3 depending on DTE and IV. Despite defined maximum loss, the probability of losing 100% of the premium is high.
- Value Add: Capital efficiency and defined downside in low-volatility directional environments.

#### Covered Calls and Cash-Secured Puts

- Market Conditions and Thesis: Deployed in neutral to mildly directional regimes to harvest volatility premium and theta decay.
- Rejection Logic: Rejected if the premium received does not adequately compensate for the downside equity risk (for covered calls) or capital lockup (for cash-secured puts).
- Strike and Expiration Selection: Typically 30-45 DTE, targeting 0.20 to 0.30 delta strikes to balance income generation with assignment probability.
- Payoff: Max Loss is substantial (underlying falling to zero). Max Gain is capped at the premium received plus capital appreciation up to the short strike.
- Lifecycle and Adjustments: Hold to expiration unless the short option can be repurchased for 10-20% of its initial value, freeing capital early.
- Risk Tier: Tier 2. Risk is synonymous with holding the underlying equity, but upside is capped.

#### Protective Puts

- Market Conditions and Thesis: Deployed to hedge long delta portfolios against imminent systemic shocks identified by macro modules.
- Value Add: Acts as synthetic portfolio insurance. Risk Tier 1, as it purely defines downside risk.

#### Naked Short Options

- Distinction: Clearly separated from long-premium trades. Naked shorts possess undefined tail risk.
- Rejection Logic: Severely restricted. Only flagged for analytical tracking or deployed under strict Portfolio Margin constraints when the empirical volatility surface demonstrates severe overpricing relative to realized volatility27.
- Risk Tier: Tier 4 (Extreme Risk).

### Phase 2: Vertical Spreads

Vertical spreads manage volatility and time decay by pairing a long and short option of the same expiration.

#### Bull Call / Bear Put Debit Spreads

- Market Conditions and Thesis: Deployed for directional trades where IV is moderate to high, offsetting the long option's cost and theta decay through the sale of the short option.
- Strike and Expiration Selection: The long strike is placed ATM; the short strike is placed at the forecasted target price of the underlying move.
- Payoff: Max Loss is the net premium paid. Max Gain is the strike width minus the net premium.
- Greeks: Muted vega and theta compared to single legs. Gamma peaks near expiration between the strikes.
- Lifecycle: Exit when the spread reaches 80% of max profit to avoid holding tail risk for marginal residual gains.
- Risk Tier: Tier 1 or 2. Defined risk with muted Greeks provides high stability.

#### Bull Put / Bear Call Credit Spreads

- Market Conditions and Thesis: Deployed for directional or neutral theses where IV is elevated and expected to mean-revert (volatility crush).
- Strike and Expiration Selection: Strikes are placed outside the expected range of movement, typically targeting a 0.15 to 0.25 delta short strike.
- Payoff: Max Loss is the strike width minus the net premium received. Max Gain is the net premium received.
- Assignment/Execution: Pin risk at expiration requires mandatory exit signaling before the closing bell on expiration day if the short leg is near the money.
- Risk Tier: Tier 2. High probability of profit, but adverse gap scenarios can result in maximum loss quickly.

### Phase 3: Volatility Strategies

These strategies express theses purely on the magnitude of movement and the pricing of volatility.

#### Long Straddles and Strangles

- Market Conditions and Thesis: Deployed when the catalyst module predicts a magnitude of movement far exceeding the market's implied expectation (e.g., an unpriced earnings shock).
- Rejection Logic: Rejected if IV is already hyper-inflated, or if OPRA liquidity prevents efficient multi-leg package pricing.
- Strike and Expiration Selection: Straddles utilize the ATM strike. Strangles utilize equidistant OTM strikes calibrated to 1 standard deviation of the forecasted move. Expirations closely bracket the catalyst.
- Payoff: Max Loss is the total net debit. Max Gain is infinite. Breakevens are the Strikes [±] Net Premium.
- Greeks: Massively positive vega and gamma, suffering from extreme negative theta.
- Lifecycle: Strict hold constraints. If the catalyst passes and the move is insufficient, an immediate exit is triggered to mitigate total IV crush.
- Risk Tier: Tier 3. High probability of total premium loss.

#### Short Straddles and Strangles

- Market Conditions and Thesis: Deployed to exploit structural overpricing of implied versus realized volatility in mean-reverting regimes.
- Risk Tier: Tier 4. Undefined maximum loss. The system models these heavily to calculate the theoretical edge of the market maker, but restricts retail callout publication due to severe margin requirements and gap risk27.

#### Event-Driven and IV Expansion Strategies

- Thesis: Purchases options weeks ahead of a known catalyst to profit solely from the predictable rise in implied volatility as the event approaches, exiting before the event occurs.

### Phase 4: Time and Volatility-Structure Strategies

These structures exploit discrepancies across the time axis and the volatility surface.

#### Calendar and Diagonal Spreads

- Market Conditions and Thesis: Deployed when near-term IV is structurally overpriced compared to deferred IV, or to capitalize on localized theta decay while maintaining a directional bias (Diagonals).
- Rejection Logic: Rejected if the term structure is in severe, justified backwardation (e.g., imminent bankruptcy risk), or if dividend schedules interfere with pricing.
- Strike and Expiration Selection: Short leg is placed in the near expiration; long leg in the deferred expiration. Strikes are ATM for neutral calendars, or skewed for directional diagonals.
- Payoff: Risk is generally capped at the debit paid. Max gain is dynamically dependent on the implied volatility of the deferred option at the expiration of the near-term option.
- Lifecycle: Must be closed or rolled prior to the near-term expiration. The system evaluates the expected value of the remaining long leg at the near-term expiry.
- Risk Tier: Tier 2. Defined risk, but payoffs are highly sensitive to complex vega dynamics and horizontal skew shifts.

### Phase 5: Multi-Leg Defined-Risk Strategies

These advanced strategies require simultaneous 3- or 4-leg package execution to eliminate legging risk26.

#### Standard Butterflies and Iron Condors

- Market Conditions and Thesis: Deployed in mean-reverting, range-bound regimes to harvest theta and vega decay within a highly defined risk parameter.
- Payoff: Max gain is achieved if the underlying pins the center strike(s) at expiration. Max loss is strictly capped at the spread width minus net credit (Condors) or net debit paid (Butterflies).
- Lifecycle: Managed proactively to prevent the underlying from threatening the short strikes. Time and volatility contraction are strictly required for profitability.
- Risk Tier: Tier 1 or 2.

#### Broken-Wing Butterflies (BWB)

- Market Conditions and Thesis: Deployed to combine a directional bias with a high probability of profit. The BWB modifies a standard butterfly by skipping a strike, shifting the payoff profile30.
- Entry and Mechanics: By structuring one wing wider than the other, the trade can often be entered for a net credit32. The system calculates the net position based on current NBBO quotes. If entered for a credit, the strategy eliminates the risk of loss on one side of the market entirely if the underlying moves away from the broken wing33.
- Payoff: [the maximum-gain formula, an equation the text export dropped]35. Max loss is the width of the wide spread minus the width of the narrow spread, adjusted for the initial premium33.
- Risk Tier: Tier 2. Highly efficient asymmetric risk, but requires precise package execution and faces severe pin risk if held to expiration.

#### Ratio Spreads and Backspreads

- Market Conditions and Thesis: Used to finance a directional bet by selling more out-of-the-money options than are purchased.
- Risk Tier: Tier 3 or 4 depending on whether the ratio creates undefined tail risk (e.g., front spreads) or defined risk (e.g., backspreads).

#### Collars

- Thesis: Combines a protective put and a covered call to bracket equity returns. Used primarily for capital preservation in Tier 1 risk parameters.

## Contract-Level Risk Tiering and Evaluation Framework

Risk cannot be generalized; it must be calculated on a per-callout basis utilizing strategy-specific models. The system contrasts standard Regulation T (Reg T) fixed-percentage margin requirements with Portfolio Margin (PM) risk-based stress testing, which utilizes pricing models to calculate theoretical losses over a [±15%] underlying price movement27.

The engine evaluates probability of loss, theta decay instability, spread width, catalyst uncertainty, and multi-leg settlement risks to assign one of four calibrated tiers:

| Risk Tier | Profile Characteristics | Strategy Examples |
|---|---|---|
| Tier 1 (Lower Relative Risk) | High liquidity, manageable Greek sensitivities, adequate time to expiration, minimal event exposure, defined and narrow maximum loss. | 60-DTE wide credit spreads on SPY; protective collars. |
| Tier 2 (Moderate Risk) | Meaningful exposure to time decay or IV shifts. Moderate liquidity. Standard directional risk but defined maximum loss. | 30-DTE debit spreads; Broken-Wing Butterflies; Calendar spreads. |
| Tier 3 (High Risk) | Substantial sensitivity to binary events. High gamma instability. High probability of losing 100% of the premium paid. | Pre-earnings long straddles; 1-2 DTE directional long options; narrow ratio spreads. |
| Tier 4 (Extreme/Speculative Risk) | Severe short-dated exposure. Unstable Greeks. Poor liquidity. Undefined tail risk or severe margin expansion risk. | 0DTE OTM long options; Naked short strangles; Unhedged front ratio spreads. |

Every published callout displays three independent assessments: Thesis Confidence (e.g., 85% probability of a bullish breakout), Estimated Edge (expected value after realistic slippage and commissions), and the Risk Tier with its dominant risk drivers explicitly stated (e.g., "Tier 3: Extreme Gamma / Impending Volatility Crush"). High-confidence signals are routinely rejected if their risk tier is incompatible with the expected net value.

## Lifecycle Management: Entry, Exit, Hold, Wait, and No-Trade Logic

Every strategy is governed by a strict state machine, dictating its status based on continuous real-time re-evaluation.

1. Wait: The foundational thesis is active, but the entry trigger (e.g., technical breakout, specific IV percentile drop) has not yet been achieved.
2. No-Trade: The thesis triggered, but the Executable-Quality gate failed. This occurs when OPRA quotes cross, liquidity evaporates, model uncertainty peaks, or transaction costs consume the theoretical edge. This is logged as a successful system decision.
3. Entry: The trigger conditions and acceptable execution prices are met. The signal is published with an explicit maximum acceptable entry cost, specifying the intended holding horizon and the exact thesis invalidation criteria.
4. Hold (Counterfactual Audit): The position is live. The system continuously recalculates the expected value of the current position using the live OPRA NBBO. The system asks: Does the expected value of remaining in this position justify the ongoing theta decay, changing Greeks, and impending event exposure? If the expected value of holding no longer exceeds the expected value of liquidating, the state changes.
5. Exit: An exit signal is published under five conditions: target profitability is reached, the underlying thesis invalidates, the time-based holding horizon expires, an adverse volatility shift occurs, or liquidity begins to deteriorate. For multi-leg positions, the exit evaluates the total package value, issuing a unified exit order.

## Website Callout Data Schema

The platform outputs callouts to the web frontend using a strict OpenAPI/JSON schema36. This ensures programmatic consistency and enables users to parse the exact parameters of the opportunity.

Each JSON payload must structurally enforce the publication of:

- Asset and Structure: Underlying ticker, complete strategy taxonomy, and leg specifications (expiration, strike, right, action).
- State Machine: Signal timestamp (nanosecond precision), quote freshness, and lifecycle status (WAIT, TRIGGERED, HOLD, TARGET HIT, INVALIDATED, EXPIRED, WITHDRAWN).
- Scoring: Directional Confidence, Estimated Edge, and Risk Tier (1-4).
- Execution Parameters: Maximum acceptable entry cost, modeled slippage, intended holding horizon.
- Risk/Reward Matrices: Max loss, max gain, breakevens, and tabular arrays projecting payoff scenarios across base, bear, and bull underlying price targets.
- Greeks and Volatility: Current IV percentile, delta, gamma, theta, vega, and eSSVI surface anomalies.
- Qualitative Context: A concatenated summary of relevant news catalysts, options flow quality indicators, and the explicit rationale explaining why this specific strategy was selected over alternatives.

## Validation Before Production and Live Shadowing

Slayer Terminal mandates rigorous out-of-sample validation before any strategy family or alpha module is promoted to live publication.

- Walk-Forward and Ablation Testing: Models are trained on rolling historical windows and tested on untouched subsequent periods. Every data feed must be systematically disabled (ablated) during testing to measure its isolated incremental contribution to the total system edge. Feeds failing to provide a positive net expectancy impact are pruned.
- Realistic Fills: The backtester utilizes the true historical OPRA NBBO, applying severe penalty assumptions for multi-leg slippage, signal delays, and standard commission drag.
- Live Shadow Evaluation: Prior to production, the system must operate in a live "shadow" environment for a minimum of 30 days. It generates unnotified callouts that are subsequently audited for predictive accuracy and fill feasibility against the live tape. Every candidate, rejection, and expiration outcome is tracked.

## Known Limitations, Unresolved Questions, and Assumptions

Before proceeding to engineering, several inherent limitations must be documented:

- Execution Drift: Because the platform does not execute trades, the published signal price will inevitably drift between generation, user consumption, and manual execution. The "maximum acceptable entry cost" parameter mitigates this, but cannot eliminate user-end slippage.
- FLEX Options: While the system supports standard equity, ETF, and index options, it does not currently model Flexible Exchange (FLEX) options due to their bespoke, institutional, non-standardized strike and settlement structures38.
- Package Fill Probabilities: Multi-leg strategies assume that the brokerage can route the order as a single complex package. If a user attempts to leg into a Broken-Wing Butterfly manually, they assume severe execution risk that the system's risk models cannot account for29.
- Margin Discrepancies: While the system models Reg T and Portfolio Margin requirements, individual brokerages often impose proprietary house margin requirements that may exceed regulatory minimums, potentially restricting a user's ability to execute a signaled credit strategy39.

## Prioritized Implementation Roadmap

The engineering build-out proceeds in 15 sequential phases. A phase cannot commence until the acceptance criteria of the preceding phase are validated.

1. Data-Source and Endpoint Inventory: Establish API connections and WebSocket streams for Massive, Unusual Whales, and Databento/OPRA.
2. Normalized Market-Data Architecture: Implement the TimescaleDB hypertable schema, ensuring point-in-time querying and nanosecond timestamp normalization.
3. Contract Reference Data and Data-Health Gates: Construct the logic to filter stale quotes, validate contract metadata, and calculate true NBBO for slippage.
4. Website Callout Interface and Ledger: Design the OpenAPI/JSON schema and the database ledger for tracking candidates, rejections, and state-machine transitions.
5. Baseline Directional Forecasts and Single-Leg Evaluation: Implement primary directional alpha modules and map them to basic long call/put selections.
6. Lifecycle Engine (Entry, Exit, Hold, No-Trade): Program the state machine and the continuous counterfactual audit loops.
7. Independent Risk Engine and Tiering: Build the risk models (evaluating Reg T vs. PM stresses) and map the Tier 1-4 logic.
8. Defined-Risk Vertical Spreads: Implement debit and credit spread modeling, integrating multi-leg package pricing execution logic.
9. News Intelligence and Event-Pricing Engine: Deploy the NLP pipeline for catalyst detection and delayed-repricing evaluation.
10. Volatility Strategies (Straddles/Strangles): Integrate SABR and eSSVI models to identify pure volatility expansions and mispricings.
11. Time and Structure Strategies (Calendars/Diagonals): Enable evaluation of term-structure and skew-relative opportunities.
12. Advanced Multi-Leg Strategies (Butterflies/Condors/BWB): Implement complex 3- and 4-leg structures, validating their highly specific asymmetric payoffs and net-credit entry logic.
13. Microstructure and Cross-Asset Modules: Integrate NYSE auction imbalances, dark pools, macro regimes, and Unusual Whales options flow/GEX analysis.
14. Historical Validation and Ablation Testing: Execute the full backtesting suite, point-in-time validation, and feed-ablation analysis.
15. Live Shadow Evaluation and Production Monitoring: Run the system silently on live data, conducting post-callout audits before initiating a controlled release to the public web interface.

## Appendix — the twenty alpha modules, as the HTML lists them

| # | Domain | Module | What it does |
|---|---|---|---|
| 1 | directional | Multi-Timeframe Directional Forecasting | Synthesizes price momentum, statistical mean-reversion, and volume profiles across horizons ranging from intraday minutes to multi-month trends. |
| 2 | directional | Market-Regime & Cross-Asset Analysis | Contextualizes directional forecasts by classifying the prevailing environment (e.g. high-inflation, low-volatility, trend-following) using futures, commodity, and currency inputs. |
| 3 | directional | Historical Analogs Vector Search | Employs dynamic time warping and vector embeddings to locate statistically similar market setups from the past 20 years, evaluating the probability distribution of subsequent price action. |
| 4 | directional | Futures & Macroeconomic Context | Acts as a systemic risk overlay capable of suppressing bullish equity signals if cross-asset stress indicators trigger. |
| 5 | volatility | Implied Volatility & eSSVI Surface Detection | Fits the empirical volatility surface to detect localized mispricings using extended Surface Stochastic Volatility Inspired (eSSVI) parametrization. |
| 6 | volatility | SABR Volatility Expansion & Contraction | Calibrates beta (skew) and nu (vol of vol) parameters under the Stochastic Alpha Beta Rho model to forecast IV crush or expansion probabilities. |
| 7 | volatility | Term-Structure & Skew Analysis | Evaluates relative pricing across expirations (contango versus backwardation) and strikes (put/call skew steepness) to optimize wing selection. |
| 8 | volatility | Cross-Contract Consistency Analysis | Identifies relative-value arbitrage anomalies between highly correlated underlying assets, index options, and sector ETF option chains. |
| 9 | volatility | Earnings & Catalyst Volatility Pricing | Compares historical pre-event IV expansion and post-event volatility crush against current chain pricing to detect mispriced binary events. |
| 10 | microstructure | Options Flow Quality & Sweep Detector | Filters consolidated tape for high-premium Intermarket Sweep Orders (ISOs) executed at ask, differentiating urgent directional bets from delta-neutral hedging. |
| 11 | microstructure | SPX & 0DTE Dealer Gamma Flip Positioning | Evaluates short-dated gamma profiles using Gamma Exposure (GEX) flip prices to forecast dealer hedging flows and intraday pinning risks. |
| 12 | microstructure | Opening & Closing Auction Imbalance Tracker | Analyzes NYSE opening and closing order imbalances for short-horizon opportunity detection and closing momentum analysis. |
| 13 | microstructure | Dark Pool Print Accumulation Mapping | Tracks off-exchange institutional accumulation blocks to map key hidden support/resistance levels and institutional inventory shifts. |
| 14 | microstructure | News Reaction Latency Arbitrage | Detects delayed option chain repricing following headline news when executable statistical edge remains on options quotes. |
| 15 | microstructure | Model Disagreement & Epistemic Uncertainty | Quantifies variance among predictive engines; high epistemic uncertainty forces a downgrade in risk tier or outright signal rejection. |
| 16 | microstructure | Liquidity Stress & Execution Evaluator | Monitors bid/ask spread widths, OPRA quote update frequencies, and order book depth to ensure execution feasibility. |
| 17 | microstructure | Crowded Trade & Squeeze Risk Detector | Analyzes correlated opportunity clusters and high short-interest positioning to prevent signaling crowded trades susceptible to squeeze risks. |
| 18 | microstructure | Position Greek Drift & Early-Warning Audit | Continuously audits active positions for adverse Greek changes, gamma acceleration, or deteriorating underlying market structure. |
| 19 | microstructure | Counterfactual Hold-versus-Exit Evaluator | Continuously audits active positions to determine whether maintaining the position yields higher expected value than liquidating at natural NBBO. |
| 20 | microstructure | Post-Callout Expectancy & Calibration Ledger | Conducts post-trade performance audits to continuously recalibrate strategy confidence weights and prune underperforming features. |
