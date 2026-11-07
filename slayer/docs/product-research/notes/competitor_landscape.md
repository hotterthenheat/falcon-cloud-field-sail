# Retail options-analytics and flow tools: competitor landscape (2025-2026)

Research date: 2026-11-07. "Seen 2026-11-07" means the price was read off the vendor's own page that day. Prices from third-party review or affiliate sites carry that site's date (where it had one) and should be treated as less reliable. Several vendor pricing pages blocked automated fetches (Cheddar Flow, OptionStrat, Market Chameleon plans page, SpotGamma support centre); for those, the figures below are secondary and flagged.

## Q1. Core features, price tiers, data shown, real-time vs delayed (per vendor)

### Takeaway
The paid retail market falls into three groups. (a) Flow tapes at about $40-150 a month: Unusual Whales, Cheddar Flow, FlowAlgo, InsiderFinance, Tradytics, BlackBoxStocks, OptionStrat Live Flow, Barchart Premier. (b) Dealer-positioning (GEX/vanna/charm) dashboards at about $89-1,000+ a month: SpotGamma, Menthor Q, Volland. (c) Vol, backtest and research tools: ORATS, Market Chameleon, tastytrade backtester, the IBKR labs. Brokers give away chains, risk graphs and probability tools, but almost no flow or dealer-positioning data. The newest trend among the flow vendors is API and MCP (AI-agent) access bundled into the top tier.

### Cited Findings

**Unusual Whales (seen 2026-11-07)**
- Free: $0. Options flow on a 2-trading-day delay, alerts on a 30-minute delay. Retail Basic: $50/mo, or $42/mo billed $504/yr. Retail Pro: $75/mo, or $63/mo billed $756/yr. Retail Max ("new"): $120/mo, or $102/mo billed $1,224/yr. — [Unusual Whales pricing](https://unusualwhales.com/pricing)
- All paid tiers get real-time flow and a real-time GEX heatmap for all US tickers. SPX market-maker exposure updates every 10 minutes from CBOE on Basic and Pro, and every 1 minute (plus a 1-minute "GEX Periscope") on Max. Dark-pool data comes as daily downloads. Basic has 25 custom alerts; Pro and Max are unlimited. Paid tiers also include Greeks and volatility dashboards, Market Tide and Net Tide, institutional holdings and insider trades. Backtesting is not mentioned for any tier. — [Unusual Whales pricing](https://unusualwhales.com/pricing)
- The "Whale Bundle" and "Everything" bundles add full API access (REST, WebSocket, MCP), "Unusual Predictions" and Data Shop credits. No prices are listed for the bundles or the API. — [Unusual Whales pricing](https://unusualwhales.com/pricing)
- In 2023 Unusual Whales partnered with TradeStation so users could trade from inside its tools. — [BusinessWire, Aug 2023](https://www.businesswire.com/news/home/20230821041895/en/Unusual-Whales-Collaborates-with-TradeStation-Securities-to-Allow-Trading-Through-its-Suite-of-Tools)

**SpotGamma (seen 2026-11-07)**
- Standard: $89/mo (first month $17), or $67/mo billed $801/yr. Pro: $129/mo, or $97/mo billed $1,161/yr. Alpha: $299/mo (page also says "then $249/mo"), or $224/mo billed $2,691/yr. Essential: $99/mo (page also says "then $129/mo"), or $74/mo billed $891/yr. Institutional: from $1,999/mo. The page contains internally conflicting promo text. — [SpotGamma subscribe page](https://spotgamma.com/subscribe-to-spotgamma/)
- Every tier includes HIRO (real-time hedging-impact indicator), TRACE (strike-by-time heatmap built on Gamma, Delta Pressure and Charm Pressure models) and Equity Hub. Standard, Pro and Alpha also share Founder's Notes, FlowPatrol, Key Levels, Options Calculator, Compass & Scanners, Volatility Dashboard and Tape. Only Alpha and Institutional get the "Synthetic OI" lens in Equity Hub. Vanna is not named on the pricing page. Only the Institutional tier lists "real-time alerts". — [SpotGamma subscribe page](https://spotgamma.com/subscribe-to-spotgamma/)
- A third-party comparison says SpotGamma is dashboard-first, with no programmatic API for retail. — [FlashAlpha comparison (written by a competitor)](https://flashalpha.com/articles/options-analytics-comparison-flashalpha-spotgamma-unusual-whales)

**Menthor Q (seen 2026-11-07)**
- Premium: $129/mo ($59 first month). Pro: $349/mo ($174.50 first month). Premium includes "20+ trading models, 10+ integrations, 350+ Academy lessons", guides and webinars. Pro adds 24 hours a week with pro traders, 9 live sessions a week and a monthly strategy session. Annual prices were not visible. — [Menthor Q pricing](https://menthorq.com/pricing/)
- The models include Net GEX / NetDEX charts, Q-Score and TradingView integration. The pricing page does not map them to tiers. — [Menthor Q pricing](https://menthorq.com/pricing/); [Menthor Q "What is Net GEX"](https://menthorq.com/guide/what-is-net-gex/)
- Menthor Q markets itself to futures traders as well as options traders. — [Menthor Q guide: best GEX tools for futures traders 2026](https://menthorq.com/guide/best-gex-tools-for-futures-traders-in-2026/)

**Volland / vol.land (Wizard of Ops)**
- The June 2024 user guide lists four monthly tiers: Basic $150 (updates once a day after the close), Volland 3 $250, Volland 30 $400, and Volland Live $1,000 (updates every 5 minutes during regular trading hours). Current prices could not be confirmed because the pricing page renders client-side. — [Volland User Guide, Jun 2024](https://vol.land/VollandUserGuide_Jun24.pdf)
- The vendor says Volland measures dealer positioning "order by order", aggregates it and visualises it. Coverage is the top 200 tickers by option notional, with vanna and charm exposures; the vendor pitches vanna for swing trades and charm for 0DTE. — [Wizard of Ops article](https://www.wizofops.com/articles/what-makes-volland-the-best-source-for-option-dealer-positioning); [press release, Jun 2023](https://www.fintechfutures.com/press-releases/wizard-of-ops-launches-innovative-real-time-fintech-solution-for-options-dealer-positioning)
- ORATS runs a discount page for Volland clients (individual licences only). It lists Trading Tools at $49/mo, Delayed Data API at $99/mo, one-time historical data (2007 to present) at $399, and recurring yearly data at $399. No date or deal terms are given. — [ORATS /volland](https://orats.com/volland)

**Tradytics (seen 2026-11-07)**
- Free: $0. Charts, scanner, dealer gamma, stock research, and yesterday's options flow and dark-pool prints. Plus: $39/mo or $299/yr, adds today's flow "to the second". Pro: $69/mo or $499/yr, adds an unlimited AI analyst, an API (50,000 calls a day) and an MCP server. — [Tradytics pricing](https://tradytics.com/pricing)

**Cheddar Flow (vendor page returned 403; secondary sources only)**
- Standard is about $85/mo with a 7-day trial: real-time flow, filters, unusual volume and history, but no dark pool, watchlists or alerts. Professional is $99/mo or $891/yr and adds dark pool, watchlists and alerts. Outlier figures: Standard $75 (Pure Power Picks), Professional $65 (Toolify). — [Modest Money review](https://www.modestmoney.com/cheddar-flow-review); [DayTradeReview](https://daytradereview.com/cheddar-flow-review); [Pure Power Picks](https://purepowerpicks.com/cheddar-flow-review/)

**BlackBoxStocks (seen 2026-11-07, monthly prices)**
- Options Basic: $59/mo. Real-time flow, algo options alerts, daily OI changes, heatmap, and most active calls and puts. No Discord or trading rooms.
- Options Plus: $79/mo. Adds real-time and historical dark pool, real-time net options delta and gamma exposure, historical flow, a historical volume/OI/volatility dashboard, custom alerts, Discord and live rooms.
- Equities Plus: $89/mo.
- Equities & Options Premium: $149/mo.
- The page says "All sales are final" and does not state whether each data feed is real-time or delayed. — [BlackBoxStocks pricing](https://blackboxstocks.com/pricing)

**FlowAlgo (seen 2026-11-07)**
- Real-time sweeps, blocks, equity blocks and dark-pool prints, with history back to June 2017 and voice alerts. Pricing shows "$199 $149/month" and "from $99/month paid annually", plus a 2-week trial for $37. The page also says "New sign-ups are paused". — [FlowAlgo homepage](https://www.flowalgo.com/)
- FlowAlgo discloses its own latency: options data "may be delayed anywhere from 500ms up to 15s"; equity blocks are delayed "up to 20 minutes"; dark-pool prints may arrive "a few hours later, the next day". — [FlowAlgo homepage](https://www.flowalgo.com/)

**InsiderFinance (seen 2026-11-07)**
- $75 monthly, $65/mo quarterly ($195), or $55/mo annual ($660). Every plan has the same features: real-time options order flow, unusual activity and sweeps, dark-pool and equity prints, real-time news and sentiment, "proprietary indicators and signals", Discord, and a free flow trial. GEX appears in the navigation but is not listed as a plan feature. — [InsiderFinance pricing](https://www.insiderfinance.io/pricing)

**OptionStrat (vendor page returned 403; secondary sources only)**
- Free tier plus Live Tools (~$39.99/mo) and Live Flow (~$99.99/mo), per 2026 third-party guides. Older figures of $49.99 and $50 appear on the OptionStrat blog and on directories. Free and Live Tools data is 15-minute delayed; real-time flow requires Live Flow. Live Flow also adds alerts, congress and insider trades, and news. The core product is a strategy builder and optimizer. — [TradingToolsHub pricing guide 2026](https://tradingtoolshub.com/blog/optionsstrat-pricing-guide-2026/); [DayTradeReview](https://daytradereview.com/optionstrat-review); [OptionStrat blog: enhanced flow](https://optionstrat.com/blog/introducing-enhanced-options-flow)

**ORATS**
- Its own pages list:
  - Trading Tools: $49/mo ("50% off")
  - Delayed Data API: $99/mo ("50% off")
  - Historical data 2007 to present: $399 one-time
  — [ORATS /volland](https://orats.com/volland)
- A Tradier-linked ORATS page lists the Delayed Data API at $199/mo, for individual non-pro use. — [ORATS /tradier](https://orats.com/tradier)
- Backtester add-ons:
  - The dashboard subscription allows 2,000 custom backtests a month; browsing 300M+ precomputed backtests is free.
  - Backtest Finder API: $99/mo.
  - Intraday (1-minute) Backtester API: $299/mo.
  — [ORATS backtester](https://orats.com/backtester)
- NexusFi (third party) lists the platform at $99/mo with a 14-day trial. — [NexusFi](https://nexusfi.com/d/data-providers/orats/)

**Market Chameleon**
- Stock Trader $39, Options Trader $69, Earnings Trader $79, Total Access $99/mo, with a 7-day free trial. Sources conflict on real-time data: one says standard plans are 15-minute delayed, with real-time costing extra. — [Market Chameleon Total Access](https://marketchameleon.com/Subscription/TotalAccess); [Modest Money review 2025](https://www.modestmoney.com/market-chameleon-review); [TradingToolsHub 2026](https://tradingtoolshub.com/blog/market-chameleon-pricing-guide-2026/)

**Barchart**
- Premier is "from $19.99/month (billed annually)". It covers unusual options activity, Options Flow (launched Feb 2024), time and sales, IV rank and GEX charts. UOA history goes back to 05/14/2020, with 250 CSV downloads a day. — [Barchart Premier](https://www.barchart.com/get-barchart-premier?ref=tab); [Barchart Options Flow blog](https://barchart.com/solutions/company/blog/6000457/barchart-provides-powerful-market-intelligence-into-options-trading-activity-with-options-flow); [Barchart help](https://help.barchart.com/support/solutions/articles/246565-view-historical-unusual-options-activity)
- The GEX page states its defaults: 4 nearby expirations (2 weeklies and 2 monthlies), a 1% move, and *delayed intraday data*. — [Barchart GEX page](https://www.barchart.com/stocks/quotes/KB/gamma-exposure)

**Brokers (free with account)**
- **Thinkorswim (Schwab):** Analyze tab with Risk Profile and Probability Analysis (projected price range), plus the Option Hacker scanner (Greeks, IV, probability ITM/OTM, DTE, OI, thinkScript conditions). Third-party reviews say real-time data is free, possibly after signing exchange agreements; I did not verify this on an official page. — [thinkorswim Learning Center: Analyze](https://toslc.thinkorswim.com/center/howToTos/thinkManual/Analyze); [Schwab: StreetSmart Edge to thinkorswim](https://www.schwabassetmanagement.com/story/streetsmart-edge-to-thinkorswim-part-2); [TradingToolsHub review](https://tradingtoolshub.com/review/thinkorswim/)
- **Robinhood:**
  - Legend desktop platform launched in October 2024. — [Robinhood newsroom, Oct 2024](https://robinhood.com/newsroom/the-legend-awakens)
  - Pre-trade "Simulated Returns" for options announced in June 2025 and listed again at Hood Summit in September 2025. — [Robinhood newsroom, Jun 2025](https://robinhood.com/us/en/newsroom/introducing-robinhood-legend-charts-on-mobile/); [Hood Summit 2025](https://robinhood.com/newsroom/hood-summit-2025-news)
  - The help page discloses the models: Bjerksund-Stensland for stock and ETF options, Black-Scholes for index options. — [Robinhood Simulated Returns](https://www.robinhood.com/us/en/support/articles/simulated-returns/)
  - Options chain metrics differ between the app, web classic and Legend. — [Robinhood options chain metrics](https://robinhood.com/us/en/support/articles/options-chain-metrics)
- **Webull:** "Unusual Option Activity" ranks symbols by a Pulse Index, defined as daily option volume compared with the 30-day average. I found no IV-skew tool. — [Webull HK FAQ](https://www.webull.hk/en/help/faq/1532-Unusual-Option-Activity)
- **tastytrade:**
  - Free options backtester (originally "lookback", around 2021-22), with 10+ years of data, multi-leg strategies, and a Backtesting API. Web and desktop only; not on mobile. — [tastytrade options backtesting](https://tastytrade.com/options-backtesting/); [Benzinga, 2021](https://benzinga.com/z/23947689)
  - Still described as "new" in October 2024. — [tastylive, Oct 18 2024](https://tastylive.com/shows/tasty-extras/episodes/backtesting-10-18-2024)
- **IBKR:** Probability Lab (compare your own price distribution with the market-implied one; its strategy scanner shows breakevens *without commissions*), Volatility Lab (implied vs realised vol), OptionTrader (quote and work orders in volatility terms) and Strategy Builder (payoff shown before sending). — [IBKR options tools](https://www.interactivebrokers.com/en/trading/options-trading-tools.php); [IBKR Campus: Probability Lab](https://www.interactivebrokers.eu/campus/trading-lessons/ibkr-probability-lab/)
- **TradingView:**
  - "TradingView Options" (strategy builder, chains, volatility analyzer) launched in May 2024. — [TradingView blog](https://www.tradingview.com/blog/en/new-product-tradingview-options-44783); [Finance Magnates, 27 May 2024](https://www.financemagnates.com/forex/tradingview-unveils-options-strategy-builder-supporting-contracts-from-major-exchanges/)
  - TradeStation confirms single-leg options trading from TradingView charts. — [TradeStation](https://tradestation.com/platforms-and-tools/tradingview)
  - A single third-party source dates TradeStation options to Feb 2025 and Alpaca/Tradier to Q1 2026, and says multi-leg orders route to the broker's own dashboard. Unverified. — [Financial Tech Wiz](https://financialtechwiz.com/post/tradingview-options)

### Inferences
- Rough monthly price bands seen in 2026:
  - Flow tapes: $39-149.
  - GEX dashboards: $89-349 at retail and up to $1,000 for Volland Live.
  - Vol and backtest research: $39-99.
  - Broker tools: free.
- A new terminal at about $50-100 a month would compete directly with Unusual Whales Pro and Max, which bundle flow, GEX, dark pool and alerts.
- "Real-time" means different things across vendors:
  - Unusual Whales SPX exposure refreshes every 10 minutes (1 minute on Max).
  - Volland Live refreshes every 5 minutes.
  - FlowAlgo flow can lag by up to 15 seconds.
  - Barchart GEX runs on delayed data.
  
  Almost no vendor states the latency end to end; FlowAlgo is the exception.
- Bundling MCP and API access into retail tiers (Unusual Whales, Tradytics) is a 2025-26 trend: vendors are positioning for AI-agent consumers.

### Gaps
- Current Volland prices (latest found is June 2024), current OptionStrat and Cheddar Flow prices from the vendors themselves, and Market Chameleon's real-time policy. The pages were blocked or rendered client-side.
- Menthor Q annual prices and which tier includes which model.
- Whether thinkorswim, Webull or IBKR show any GEX, vanna or charm natively. No official source surfaced; none is known to me as an official feature.
- Unusual Whales API pricing is not published.

## Q2. Who discloses model assumptions, data provenance, or track record?

### Takeaway
Disclosure is weak across the board. No vendor I found publishes a verified, out-of-sample track record for its signals. On methodology:
- SpotGamma openly calls the naive dealer-sign convention an assumption, but describes its replacement ("Synthetic OI") only as "empirical, not inferred", with no published method.
- Barchart states its GEX parameters.
- Robinhood names its pricing models.
- FlowAlgo states its latency.
- Most flow vendors disclaim themselves as "data providers, not stock picks", while marketing "proven track record" (InsiderFinance) or signal quality.

### Cited Findings
- **SpotGamma** says public OI "does not identify dealer versus customer ownership", so basic GEX assigns signs by a convention that "can be useful, but it is still an assumption". It markets Synthetic OI as isolating market-maker positions with "high-fidelity data across multiple exchanges; it is empirical, not inferred". I found no public methodology document behind that claim. — [SpotGamma Equity Hub Synthetic OI](https://spotgamma.com/equity-hub-synthetic-oi-lp/); [SpotGamma GEX page](https://spotgamma.com/gamma-exposure-gex/)
- **SpotGamma support** says it "models market maker positioning based on options flow data". Negative OI in Equity Hub means it estimates MMs are net short. — [SpotGamma support: negative OI](https://support.spotgamma.com/hc/en-us/articles/50266092992019-Why-does-EquityHub-show-negative-OI-Open-Interest-values)
- **Unusual Whales'** own educational post calls its net gamma "a naive calculation meant to show you where we've built up open interest by strike". I found no formal sign-convention document. A third party (gexa.ai) claims Unusual Whales uses the standard dealer-perspective convention; that is secondhand. — [Unusual Whales Substack](https://unusualwhales.substack.com/p/how-to-understand-gamma-delta-gex); [gexa.ai methodology](https://gexa.ai/methodology.html)
- **Menthor Q's** guides describe GEX as "a proxy" and tell users to "flip the position" to get dealer exposure. No formal methodology page was found. — [Menthor Q: What is GEX](https://menthorq.com/guide/what-is-gex/)
- **Volland** claims order-by-order measurement of dealer positioning, but does not publish the classification method. The press release notes RIA registration "does not imply any level of skill". — [Wizard of Ops](https://www.wizofops.com/articles/what-makes-volland-the-best-source-for-option-dealer-positioning); [press release](https://finance.yahoo.com/news/wizard-ops-launches-innovative-real-123600905.html)
- **Barchart** discloses its GEX parameters: 4 expirations, a 1% move, delayed intraday data. — [Barchart GEX](https://www.barchart.com/stocks/quotes/KB/gamma-exposure)
- **Robinhood** discloses its models (Bjerksund-Stensland and Black-Scholes) and says results are hypothetical. — [Robinhood Simulated Returns](https://www.robinhood.com/us/en/support/articles/simulated-returns/)
- **IBKR** discloses that breakevens in Probability Lab exclude commissions. — [IBKR options tools](https://www.interactivebrokers.com/en/trading/options-trading-tools.php)
- **FlowAlgo** discloses latency (500ms-15s for options, up to 20 minutes for equity blocks, dark pool same day or next day). Its methodology is only "order type, order size, the speed of the order... among many more". No performance results. Disclaimer: "solely a data-provider and not a stock picks alert service". — [FlowAlgo](https://www.flowalgo.com/)
- **InsiderFinance** advertises "Live Trade Ideas With Proven Track Record" with no supporting data. Its disclaimer says it is "solely a data-provider and not a stock picks alert service". — [InsiderFinance pricing](https://www.insiderfinance.io/pricing)
- **Unusual Whales'** own disclaimer says "it is highly recommended not to trade on this, or any, information from Unusual Whales". — [Unusual Whales Reddit-reviews page (vendor-hosted)](https://unusualwhales.com/lp/unusual-whales-reddit-reviews)
- **Independent critique of the dealer-sign convention:**
  - The long-calls / short-puts convention is "a modeled stand-in rather than a measured position".
  - It fails when institutions buy puts to hedge, when large directional put sellers are active, or when retail sells puts.
  - Every published GEX figure inherits it.
  — [FlashAlpha GEX explainer](https://flashalpha.com/articles/what-is-gamma-exposure-gex-explained); [Options Analysis Suite: dealer positioning](https://www.optionsanalysissuite.com/documentation/dealer-positioning)
  - Some vendors use flow-signed GEX, which infers the dealer side from trades and can flip individual strikes. — [FlashAlpha quantitative approach](https://flashalpha.com/articles/dealer-positioning-gex-quantitative-approach-options-flow)
  - Customer/dealer splits are sometimes assumed, e.g. 60/40 or 70/30. — [LambdaFin](https://www.lambdafin.com/articles/dealer-gamma-vs-retail-sentiment)

### Inferences
- No retail vendor attaches error bars or confidence intervals to GEX, dealer positioning or flow classification, and none shows how its numbers change under alternative sign assumptions.
- Publishing the assumption, a sensitivity band, and a historical hit-rate of "levels held" would be a clear differentiator.
- The pattern of "data provider, not a signals service" disclaimers next to "proven track record" marketing is an opening for a product that publishes audited, time-stamped signal outcomes.

### Gaps
- I found no vendor-published verified performance records (e.g. third-party audited signal P&L) for any listed tool. This is absence of evidence from a limited search, not proof that none exist.
- SpotGamma's "Structural Dealer Positioning" and "DDOI" support articles exist but returned 403, so I could not read their exact assumptions.
- Data provenance (OPRA direct, vendor resale, Cboe LiveVol and similar) is not stated by most vendors. Unusual Whales names CBOE as the source for SPX exposure updates; I found nothing comparable for the others.

## Q3. What do users complain about most?

### Takeaway
The recurring complaints:
- Alerts that lag or fire after the move.
- Noisy "unusual" signals.
- High price relative to cheaper look-alikes.
- Weak support and community toxicity in Discord-centric products.
- Cluttered UIs with steep learning curves.

Academic evidence partly supports the "already priced in" critique: the edge in unusual-options-activity signals has decayed since 2020. My search did not surface independent Reddit threads with good signal (vendor-hosted "Reddit reviews" pages dominate results), so the Reddit evidence here is thin.

### Cited Findings
- **BlackBoxStocks on Trustpilot:** 3.5/5 from 29 reviews (28% 1-star; seen 2026-11-07). Complaints:
  - "frequently laggy, overly noisy, and available elsewhere for a fraction of the price" (Aug 20, 2026).
  - Alerts trigger after the move has happened (Aug 2026).
  - Price is not worth it at about $149/mo (Aug 2023, Aug 2026, Feb 2026).
  - "Transparency is essentially gone" (Feb 6, 2026).
  - Discord moderation is hostile (Feb 2025, May 2026, Oct 2026).
  - No acknowledgement from support (Oct 10, 2026).
  - The company has not replied to negative reviews.
  — [Trustpilot: BlackBoxStocks](https://www.trustpilot.com/review/blackboxstocks.com)
- **Unusual Whales:** its own vendor-hosted page admits users call the UI "cluttered" with a "steep learning curve". The trustpilot.com profile for unusualwhales.com showed 0 reviews and was unclaimed (seen 2026-11-07). — [Unusual Whales Reddit-reviews page](https://unusualwhales.com/lp/unusual-whales-reddit-reviews); [Trustpilot UW](https://www.trustpilot.com/review/unusualwhales.com)
- **Third-party reviews** rate OptionStrat and Cheddar Flow 3.5/5. — [Pure Power Picks OptionStrat](https://purepowerpicks.com/optionstrat-review/); [Pure Power Picks Cheddar Flow](https://purepowerpicks.com/cheddar-flow-review/)
- **Robinhood:** a reviewer says the desktop and web experience "lacks professional-grade charting and analytics". — [Pure Power Picks Robinhood review](https://purepowerpicks.com/robinhood-review/)
- **Academic evidence on UOA (Strong, *Journal of Portfolio Management*, 2013-2023 OptionMetrics/CRSP):**
  - Large option trades in general are not predictive.
  - Properly defined UOA in out-of-the-money, near-expiry calls does predict abnormal returns.
  - Put-based signals are weaker or negative.
  - Profitability has declined since 2020 as the strategy became widely followed: stronger same-day reaction, less drift.
  — [PM Research / JPM](https://www.pm-research.com/content/iijpormgmt/52/9/257); [Wayne State news](https://ilitchbusiness.wayne.edu/news/unusual-options-activity-revealed-as-a-potential-return-signal-in-new-finance-research-67679)
- Even Barchart's own editorial says "unusual options flow is not magic. It is not always right." — [Barchart DXCM case study](https://www.barchart.com/story/news/35202618/why-i-follow-unusual-options-flow-a-dxcm-case-study)
- **Hidden latency:** FlowAlgo's disclosure (up to 15 seconds for options, up to 20 minutes for equity blocks, dark pool next day) shows how much latency "real-time" products can carry. — [FlowAlgo](https://www.flowalgo.com/)

### Inferences
- The largest documented pain points are lag and noise, then cost. A product that time-stamps alerts against the subsequent move (alert-to-move latency) and shows hit-rates against a random baseline would answer the top complaints directly.
- Discord-and-community products (BlackBoxStocks, Menthor Q Pro, SpotGamma Essential) carry a reputational risk from community moderation that pure-software products avoid.

### Gaps
- I did not obtain primary Reddit threads (r/options, r/thetagang, r/wallstreetbets) or app-store reviews. Search results were dominated by vendor and affiliate pages, so complaint themes rest mostly on Trustpilot, vendor admissions and reviews.
- No Trustpilot data for SpotGamma, Menthor Q, Cheddar Flow or Tradytics was gathered.
- I found no user evidence specifically about "repainting" (historical levels or signals being revised after the fact) for any named vendor.

## Q4. Capabilities absent from retail products (or institutional-only)

### Takeaway
I found no retail product that offers:
- Options fill-quality or execution audits.
- Per-trade P&L attribution into Greeks (delta, gamma, vega, theta, plus residual).
- Signal backtests against random or null baselines.
- Verified claim checking.
- A cost-to-trade (spread/slippage) map on the chain.
- GEX or dealer positioning with stated assumptions and error bars.

The nearest retail analogues are partial:
- tastytrade and ORATS backtesters (strategy backtests, not signal audits with baselines).
- Robinhood and thinkorswim pre-trade simulators (model-based payoffs, no fill-cost modelling).
- IBKR's Probability Lab (explicitly excludes commissions).

Regulation is not closing the fill-quality gap for options: the amended SEC Rule 605 execution-quality reports (compliance Aug 1, 2026) cover NMS stocks.

### Cited Findings
- **Backtesting that exists:**
  - tastytrade: free strategy backtester, 10+ years of data, with an API. — [tastytrade](https://tastytrade.com/options-backtesting/)
  - ORATS: 300M+ precomputed backtests and a 1-minute intraday backtester API at $299/mo. — [ORATS backtester](https://orats.com/backtester)
  
  Neither describes random-baseline comparisons or signal-level (flow/GEX) backtests.
- **Pre-trade simulators are model-only:** Robinhood uses Bjerksund-Stensland and Black-Scholes and states results are "hypothetical". — [Robinhood](https://www.robinhood.com/us/en/support/articles/simulated-returns/). IBKR breakevens exclude commissions. — [IBKR](https://www.interactivebrokers.com/en/trading/options-trading-tools.php)
- **Unusual Whales** lists no backtesting on any tier. — [Unusual Whales pricing](https://unusualwhales.com/pricing)
- **Amended Rule 605:**
  - Effective June 14, 2024; compliance date moved from Dec 14, 2025 to Aug 1, 2026.
  - Applies to market centers and broker-dealers reporting on orders in "NMS stocks".
  - A 2026 notice reportedly sets a 100,000-customer-account threshold for broker-dealer reporting (summary only seen).
  — [SEC exemptive order 34-105136 (2026)](https://www.sec.gov/files/rules/exorders/2026/34-105136.pdf); [Federal Register 2025-19316](https://public-inspection.federalregister.gov/2025-19316.pdf); [Sidley, Apr 2024](https://www.sidley.com/en/insights/newsupdates/2024/04/sec-adopts-amendments-to-modernize-disclosure-of-order-execution-information)
- **Dealer positioning with uncertainty:** vendors either use the fixed convention (described as an assumption) or claim proprietary "empirical" methods (SpotGamma Synthetic OI, Volland order-by-order). None found publishes error bars or sensitivity ranges. — [SpotGamma](https://spotgamma.com/equity-hub-synthetic-oi-lp/); [Volland](https://www.wizofops.com/articles/what-makes-volland-the-best-source-for-option-dealer-positioning)

### Inferences
- Rule 605 reporting is defined for NMS stocks; listed options are not NMS stocks (my understanding of Reg NMS, not confirmed in the sources above). If so, the 2026 amendments leave options execution quality without standardised public disclosure. An independent options fill-quality audit (fill versus NBBO mid at order time, by broker) would fill a gap that regulation leaves open.
- Gaps that a new terminal could plausibly own, none of which surfaced in any retail product:
  - Greek P&L attribution per position (institutional risk systems do this; no retail vendor surfaced it).
  - Spread-as-percent-of-mid and expected-slippage heatmaps on the chain.
  - Signal "report cards" with random baselines.
  - GEX shown as a band across sign-assumption scenarios.

### Gaps
- I did not verify that institutional products (e.g. Cboe LiveVol/Trade Alert, Bloomberg OVME/PORT, OptionMetrics) offer these specific features. The "institutional-only" framing rests on my general knowledge, not on sources in this note.
- I did not confirm whether any broker (e.g. IBKR's PortfolioAnalyst or Transaction Cost Analysis) offers options-specific TCA to retail. IBKR is the most likely candidate and should be checked.

## Q5. Notable launches, acquisitions, shutdowns (2024-2026)

### Takeaway
Activity in 2024-26 was mostly product launches; I found no confirmed M&A among the named vendors. Launches:
- TradingView Options (May 2024).
- Barchart Options Flow (Feb 2024).
- Robinhood Legend (Oct 2024) and options Simulated Returns (2025).
- Unusual Whales Retail Max tier and API/MCP bundles (2025-26).
- Tradytics MCP server.
- SpotGamma's Synthetic OI lens and Alpha tier.

FlowAlgo's site says "new sign-ups are paused", a possible wind-down signal I could not confirm elsewhere.

### Cited Findings
- **TradingView Options** (strategy builder, chains, volatility analyzer) launched in May 2024. — [Finance Magnates](https://www.financemagnates.com/forex/tradingview-unveils-options-strategy-builder-supporting-contracts-from-major-exchanges/); [TradingView blog](https://www.tradingview.com/blog/en/new-product-tradingview-options-44783)
- **Barchart Options Flow** was introduced in February 2024. — [Barchart blog](https://barchart.com/solutions/company/blog/6000457/barchart-provides-powerful-market-intelligence-into-options-trading-activity-with-options-flow)
- **Robinhood:**
  - Legend and index options, October 2024. — [Robinhood newsroom](https://robinhood.com/newsroom/the-legend-awakens)
  - Legend charts on mobile and options Simulated Returns, June 2025. — [Robinhood newsroom](https://robinhood.com/us/en/newsroom/introducing-robinhood-legend-charts-on-mobile/)
  - Hood Summit, September 2025. — [Robinhood](https://robinhood.com/newsroom/hood-summit-2025-news)
- **Unusual Whales:** Retail Max tier labelled "new"; bundles with REST, WebSocket and MCP API and "Unusual Predictions" (seen 2026-11-07). — [Unusual Whales pricing](https://unusualwhales.com/pricing)
- **Tradytics Pro:** AI analyst, 50k calls a day API and MCP server (seen 2026-11-07). — [Tradytics pricing](https://tradytics.com/pricing)
- **SpotGamma:** Alpha tier and Institutional tier with Synthetic OI. — [SpotGamma](https://spotgamma.com/subscribe-to-spotgamma/)
- **FlowAlgo:** homepage says "New sign-ups are paused" (seen 2026-11-07); no news coverage found. — [FlowAlgo](https://www.flowalgo.com/)
- **ORATS and Volland** have a cross-discount arrangement, with no date or terms given. Not evidence of an acquisition. — [ORATS /volland](https://orats.com/volland)
- **tastytrade's** free backtester dates to around 2021-22, so it is not a 2025 launch. — [Benzinga 2021](https://benzinga.com/z/23947689)

### Inferences
- Vendors are moving toward API and MCP feeds for AI agents and toward model-driven simulators in brokers. Neither trend addresses execution quality or verified signal performance.
- FlowAlgo's paused sign-ups, if confirmed, could free up a user base of high-priced flow subscribers.

### Gaps
- I found no confirmed acquisitions or shutdowns among the named vendors in 2024-26. The search was limited, so a targeted news check on each vendor's name plus "acquires" or "acquired" is advisable.
- I could not date the FlowAlgo pause. The page also shows a "trial offer ends Dec 31st" banner with no year.
