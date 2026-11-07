# Retail Options Product Gaps: Measure / Explain / Verify / Simulate Tools Buildable from ThetaData Pro + Unusual Whales API Basic

Scope: US listed options, 2024-2026. These are concepts that measure, explain, verify or simulate. None of them sells "winning signals". For each concept the notes cover what exists, who pays, what it needs technically, which of the two data sources supplies it, latency and history limits, and how defensible it is. Research budget was about 17 tool calls, so many vendor claims come from secondary comparison blogs, and those are flagged.

Shorthand used below:
- **TD** = ThetaData Pro. The brief says it provides OPRA trades with the NBBO attached, 1-second NBBO, quotes and trades at an exact millisecond, per-trade greeks and 1-minute greek history, open interest (OI) from 2012, stocks and indices, and live streaming.
- **UW** = Unusual Whales API Basic. The brief says it is REST-only, allows 3 concurrent requests, and has history from 2023-12. It provides flow alerts, GEX/charm/vanna per minute, variance risk premium (VRP), skew, OI changes, the daily tape, SEC filings, insider trades, earnings and prediction markets.

---

## Q0. Cross-cutting: what the two data sources actually support, and the licensing constraints

### Takeaway
ThetaData's documentation backs the core ingredient for nearly every concept: each OPRA trade paired with the NBBO in force at execution, plus per-trade greeks up to third order. The coverage-start dates differ by data type and by index versus equity. The biggest constraint on Unusual Whales is licensing rather than technology. Its self-serve API is described as non-redistributable and for personal use, so a product that shows UW-derived numbers to customers probably needs a business licence.

### Cited Findings
- ThetaData has a trade-quote endpoint that "returns every trade reported by OPRA paired with the last NBBO quote at the time of trade". It also has separate endpoints for every NBBO quote and every trade. Source is a third-party SDK documentation mirror (ThetaDataDx), not ThetaData's own site. — [ThetaDataDx trade-quote reference](https://userfrm.github.io/ThetaDataDx/reference/option/history/trade-quote)
- Per-trade greeks are available as first order (delta, theta, vega, rho, epsilon, lambda), second order (gamma, vanna, charm, vomma, veta) and third order (speed, zomma, color, ultima). — [ThetaDataDx trade greeks](https://userfrm.github.io/ThetaDataDx/reference/option/history/trade-greeks/all); [third-order](https://userfrm.github.io/ThetaDataDx/reference/option/history/trade-greeks/third-order)
- ThetaData's marketing says all greeks use Black-Scholes and that OPRA coverage starts in June 2012. — [ThetaData options data page](https://thetadata.net/options-data)
- Coverage caveats:
  - A ThetaData blog describes "12 years of cached and v2 (anything that isn't quotes)" OPRA data. That wording suggests quote history may not reach as far back as trades and OI. — [ThetaData blog, Aug 2024](https://thetadata.net/blog/2024-08-02-live-stocks-data-dividends-more-features)
  - Greeks on index options only go back to 2017-01-01. — [ThetaData docs: Data Issues](https://docs.thetadata.us/Articles/Data-And-Requests/Data-Issues.html)
  - The open interest endpoint reports the open interest from the end of the previous trading day. — [ThetaData docs: Making Requests / Data Availability](https://docs.thetadata.us/Articles/Data-And-Requests/Making-Requests.html)
  - SPX (AM-settled) has no data on its expiration day, while SPXW (PM-settled) does. — [ThetaData docs: Making Requests / Data Availability](https://docs.thetadata.us/Articles/Data-And-Requests/Making-Requests.html)
- Unusual Whales:
  - The public API page says "Redistribution is not allowed". — [UW public API](https://unusualwhales.com/public-api)
  - A third-party review says "The standard, self-serve API is strictly for non-professional, personal use". — [Sentisense: UW API alternatives 2026](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/)
  - UW API pricing conflicts across sources: $99 "Options Starter" on the official lander; $150 Basic / $375 Advanced in one Oct-2026 comparison; $125 / $350 in the page's structured data. — [UW API lander](https://unusualwhales.com/api_lander); [Sentisense](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/)
  - The official page cites "120 requests per minute" and "100+ REST endpoints across 19 categories". — [UW API lander](https://unusualwhales.com/api_lander)
  - A third-party review lists API Basic at 40,000 requests/day with a 2-year lookback. This is unverified. — [agenttrading.ai review](https://agenttrading.ai/blog/unusual-whales-review)

### Inferences
- TD is the backbone for every "measure / verify / simulate" concept, because those need the NBBO at the exact moment of a trade. UW is best treated as a pre-computed context layer (GEX, VRP, skew, earnings, flow alerts), and only from 2023-12 onward. Concepts that need long history or auditable models should use TD, not UW.
- The UW Basic limits are 3 concurrent requests, 120/min, and possibly 40k/day. With those limits, any per-user, on-demand UW query will not scale to many users. UW data would have to be pulled once into a shared cache, and that cache is exactly the redistribution the licence seems to forbid. Treat UW as a research and validation input unless a commercial licence is negotiated.
- Because TD's greeks are Black-Scholes, they are model outputs and not ground truth. Products should state the model, including how dividends and rates are treated for American-style equity options.

### Gaps
- I did not find ThetaData's own redistribution or "display to end users" licence terms. Showing OPRA-derived NBBO to customers usually requires OPRA vendor/subscriber agreements, but this was not verified here. This is a material open question for every concept.
- I did not confirm which ThetaData Pro tier includes trade greeks and second/third-order greeks. The docs' tier tables were reported as inconsistent.
- I did not confirm whether TD's trade records include OPRA condition codes, such as the complex/multi-leg and ISO indicators. That matters for multi-leg detection (Q10).
- I did not verify the UW Basic concurrency limit (3) or the 2023-12 history start; both are taken from the brief.

---

## Q1. Fill-quality audit for retail options fills (user fill vs NBBO at the millisecond; vs broker 605/606 claims)

### Takeaway
No independent, per-fill options TCA product for retail turned up. Brokers publish self-reported aggregate execution-quality figures, mostly for equities. Rule 605 is being expanded, with broker reports due in 2026, but I could not confirm that it covers listed options. Retail options losses are dominated by spread costs, so a fill audit targets the largest measurable cost retail traders pay.

### Cited Findings
- **Size of the cost:** retail investors favour cheap weekly options with an average bid-ask spread of 12.6%. Over Nov 2019-Jun 2021, aggregate retail losses were about $2.1B over a 10-day holding window, against roughly $6.4B in spread costs and about $0.9B in commissions. The authors say losses come mostly from execution costs rather than bad forecasts. — [Bryzgalova, Pavlova & Sikorskaya, J. Finance 2023](https://lbsresearch.london.edu/id/eprint/2827/1/The%20Journal%20of%20Finance%20-%202023%20-%20BRYZGALOVA%20-%20Retail%20Trading%20in%20Options%20and%20the%20Rise%20of%20the%20Big%20Three%20Wholesalers.pdf)
- **Counterpoint:** using individual trading-journal data, the average option trade returns -0.9%, which is small next to typical 5-10% spreads. The authors argue aggregate-proxy studies overstate retail losses. 0DTE trades lose 4.71% relative to other option trades. — [Bogousslavsky & Muravyev, "An Anatomy of Retail Option Trading"](https://www.lsu.edu/business/files/event-files/2025-finance-mardi-gras/retail_option_trading_v2.pdf)
- **Rule 605 amendments:**
  - Adopted March 2024. They extend the rule to larger broker-dealers and require a summary execution-quality report. — [SEC press release 2024-32](https://www.sec.gov/newsroom/press-releases/2024-32); [KPMG reg alert](https://kpmg.com/us/en/articles/2024/sec-final-amendments-rule-605-of-regulation-nms-reg-alert.html)
  - Robinhood's FY2025 10-K says that "Beginning in August 2026" brokers including Robinhood Financial and Robinhood Securities must publish the new execution-quality disclosures. — [Robinhood 10-K FY2025](https://www.sec.gov/Archives/edgar/data/1783879/000178387926000023/hood-20251231.htm)
  - A 2025 SEC release sets November 1, 2026 as the compliance date for price-improvement statistics measured against the best available displayed price. — [SEC Release 34-104147](https://www.sec.gov/files/rules/final/2025/34-104147.pdf)
  - Orders with special handling requests are excluded from "covered orders". — [SEC Rule 605 FAQ](https://www.sec.gov/rules-regulations/staff-guidance/trading-markets-frequently-asked-questions/frequently-asked-questions-rule-605-regulation-nms)
- **Robinhood's voluntary metrics:**
  - Robinhood publishes net price improvement per 100 shares, the percentage of orders executed at the NBBO or better, and effective-over-quoted spread. All three are equity-share framed. — [UChicago Business Law Review, "A Disclosure Gap in the Market for Order Flow"](https://businesslawreview.uchicago.edu/print-archive/disclosure-gap-market-order-flow)
  - Robinhood has a quarterly execution-quality page; the indexed snippet showed no per-contract options figures. — [Robinhood: Our execution quality](https://robinhood.com/us/en/about-us/our-execution-quality)
  - A Robinhood policy brief argues that even amended Rule 605 cannot show whether one broker's customers send systematically easier or harder orders. This is a self-interested source. — [Robinhood policy blog](https://robinhood.com/us/en/policy/blog/rule-605-and-the-limits-of-efficacy/)
- **Schwab:** publishes execution-quality claims in dollar totals, framed for equities. — [Schwab execution quality](https://www.schwab.com/execution-quality?sf7988521=1)
- **Payment for order flow (PFOF) per contract:** Q2 2025 rates were about $0.56 per option contract for Robinhood flow versus about $0.40 for Schwab. That is revenue to the broker, not a customer saving. — [GlobalTrading](https://www.globaltrading.net/schwab-overtakes-robinhood-in-options-pfof-as-per-contract-rates-diverge/)
- **Conflicting price-improvement figures:** an SEC comment letter cites Robinhood-reported price improvement of 9.3% (equal-weighted). A blog citing an unnamed 2024 study says 7% versus up to 52% at the best brokers. The methods are not comparable. — [SEC comment letter 4-887](https://www.sec.gov/comments/4-887/4887-753447-2321514.pdf)
- **User demand:** an r/options thread compared thinkorswim and Robinhood options execution quality by hand, which shows retail traders want this comparison. — [r/options "Deep dive into ToS vs Robinhood execution quality" (mirror)](https://axebps-redlib.hf.space/r/options/comments/1jxsg0n/deep_dive_into_tos_vs_robinhood_execution_quality)

### Inferences
- **How it would work:**
  1. The user imports fills from a broker CSV or API, or through a SnapTrade/Plaid-style aggregator.
  2. For each fill, query the TD NBBO at the fill timestamp (millisecond quote query), plus a short window before and after (1-second NBBO).
  3. Then try to find the user's own print in the OPRA tape by matching contract, price, size and a time window. TD's trade-quote data gives the exchange, the exact time and the NBBO at that moment.
  4. Compute the metrics: effective spread, price improvement versus NBBO in dollars per contract and as % of the half-spread, fill position within the spread (0 = bid, 1 = ask), 1s/5s/60s markouts, and a "you paid $X in spread this year" total.
- **Data sources:** TD supplies everything needed. UW is unnecessary apart from the daily tape as a cross-check.
- **Latency and history limits:** live audit is possible via TD streaming. Historical audit can go back as far as TD's quote history reaches; see the Q0 gap on how far that is.
- **Who would pay:**
  - Active retail traders, as a premium journal add-on.
  - Advisers and RIAs who need best-execution documentation.
  - Journalists and academics; B2B data licensing is a possibility.
- **Defensibility:**
  - The NBBO lookup itself is commodity once you have TD.
  - The moat is the crowdsourced cross-broker fill dataset: "median price improvement on SPY 0DTE at Broker A vs B". No regulatory report gives this if Rule 605 excludes options.
  - That dataset is self-selected, which echoes Robinhood's "order mix" objection, so results must be risk-adjusted by spread width, DTE and order type.
- **Main technical risk:** many broker exports give fill times only to the second or minute. Matching the user's fill to the OPRA print is how to recover the millisecond. It fails for small fills in busy contracts where many identical prints occur.

### Gaps
- I could not confirm from primary text whether amended Rule 605 covers listed options. My understanding is that it applies to NMS stocks only and that Rule 606 routing reports do cover options, but the fetched sources did not confirm this. The Federal Register page redirected to a captcha. This needs checking against 17 CFR 242.605 and 242.600.
- I found no third-party TCA product aimed at retail options fills. There may be niche tools such as broker-specific Chrome extensions or Substack analyses that searches missed.
- Broker timestamp precision in CSV exports, by broker, was not researched.

---

## Q2. Trade autopsy / P&L attribution (delta, gamma, theta, vega, spread paid, residual)

### Takeaway
Greek-level P&L attribution is rare in retail journals. Sources credit only TraderSync (higher tier) and TradesViz, and those claims come from competitor review sites. None of them is described as separating spread paid from model P&L. Per-trade greeks plus 1-minute greek history in TD make a full Taylor-expansion attribution straightforward.

### Cited Findings
- **TraderSync:** a review site claims it is "the only journal" combining greek import, multi-leg grouping and P&L attribution, with per-greek attribution on a higher tier. The source is a competitor's comparison site. — [JournalPlus feature guide](https://journalplus.co/best/journal-with-options-greeks-tracking)
- **TradesViz and Trademetria:** TradesViz is credited with greek-level P&L; Trademetria reportedly lacks greek attribution. — [JournalPlus comparison](https://journalplus.co/compare/journalplus-vs-trademetria-vs-tradesviz)
- **Model basis:** TD per-trade greeks (first to third order) are computed with Black-Scholes. — [ThetaData options data](https://thetadata.net/options-data); [ThetaDataDx trade greeks](https://userfrm.github.io/ThetaDataDx/reference/option/history/trade-greeks/all)

### Inferences
- **Method:**
  1. Split the holding period into 1-minute steps using TD 1-minute greek history.
  2. For each step, attribute P&L as:
     - delta × ΔS
     - ½ gamma × ΔS²
     - theta × Δt
     - vega × ΔIV
     - optionally vanna × ΔS × ΔIV and charm terms
  3. Add an explicit "spread paid" line: entry fill minus entry mid, plus exit mid minus exit fill. Both come from the NBBO at the fill millisecond.
  4. The residual is whatever the sum leaves unexplained.
- **Institutional analogue:** risk-based "P&L explain" on desks. The regulatory version is the FRTB P&L attribution test. This analogy is from general knowledge and was not sourced in this session.
- **Defensibility:** low to medium on its own. The maths is textbook. The differentiators are:
  - plain-language explanations, e.g. "you were right on direction but lost 70% to IV crush and spread";
  - combining it with the fill audit (Q1);
  - aggregating across many trades, e.g. "your theta bleed per 0DTE trade averages X".
- **Data and limits:**
  - TD supplies all of it.
  - UW adds context only, e.g. "dealer gamma regime at entry".
  - Index-option greeks only go back to 2017. For older trades, or where TD's model differs, recompute greeks from TD quotes.

### Gaps
- I did not verify TraderSync's or TradesViz's attribution methods first-hand, for example whether they use 1-minute greeks or end-of-day.
- I found no academic or industry write-up of retail-facing P&L attribution accuracy.

---

## Q3. "Could you really have made that?" verifier for social P&L screenshots and alert-service track records

### Takeaway
Existing verification works by connecting to a broker (Kinfo) or by running hypothetical model accounts (Collective2). Nothing found checks a claimed options trade against the actual OPRA tape and NBBO. The data to do that, whether a print existed at that price and time and whether the ask was reachable, is exactly what TD provides.

### Cited Findings
- **Kinfo:**
  - Kinfo says it only uses direct broker integrations and that trades cannot be added, edited or deleted. It markets itself as "100% verified". — [Kinfo: Verified Trades](https://kinfo.com/verified-trades); [Kinfo: How it works](https://kinfo.com/how-it-works/)
  - Kinfo has publicly acknowledged and patched a technical issue on its platform. — [Kinfo: Facts and misinformation](https://kinfo.com/facts-and-misinformation/)
- **Collective2:** says its track records "must still be considered hypothetical". A competitor's page adds that they are model accounts unless the manager is certified, and that they can be reset for a fee. — [Collective2](https://trade.collective2.com/); [DT Terminal comparison (competitor)](https://www.thedtterminal.com/compare/verification)
- **Autopilot / TipRanks:** no sourced information was retrieved in this session.

### Inferences
- **Verifier logic, for a claim (contract, side, entry/exit price, approximate time or date, size):**
  1. Did any OPRA print occur at or better than the claimed price in that window? Use the TD trades with NBBO attached.
  2. Was the claimed entry inside the NBBO when it was supposedly placed? Was the claimed exit achievable, i.e. at or below the bid for a sale?
  3. Was the claimed size larger than the total volume printed at that price?
  4. What was the best achievable P&L that day, i.e. is the claim in the top x% of possible outcomes?
- **Alert services:** replay each alert's timestamp, add a realistic subscriber latency (e.g. 5-60s), then buy at the TD ask and sell at the bid under the stated exit rules. This gives an "achievable" track record to set beside the advertised one.
- **Data:**
  - TD supplies everything, live and historical.
  - UW flow alerts (from 2023-12) could support a meta-study of whether UW's own alerts were achievable, but publishing that would collide with redistribution limits.
- **Defensibility:**
  - Medium-high on brand and trust, since it is a novel category.
  - Legal risk is real: defamation exposure from publicly "debunking" named influencers. Output should be framed as "consistent / inconsistent with the public tape", not "fraud".
  - The verifier proves feasibility, not ownership. A real print at the claimed price does not show the poster made it.
- **Who would pay:**
  - Prop/challenge firms and alert marketplaces wanting audit badges (B2B).
  - Discord and community operators.
  - Individual buyers vetting alert services before subscribing.

### Gaps
- Not researched: whether TipRanks or Autopilot verify options trades for retail influencers, and Autopilot's methods.
- Not researched: the regulatory and legal framework for publishing third-party performance verification, including FINRA/SEC marketing-rule implications.

---

## Q4. Cost-to-trade transparency on the chain (round-trip cost as % of premium, liquidity score) and break-even calculators that include spread

### Takeaway
The supporting fact is strong: the average retail options spread is 12.6%, per Bryzgalova et al. (Q1). Brokers show bid/ask, but I found no evidence of a mainstream retail chain showing round-trip cost as % of premium or a spread-inclusive break-even. Building it from TD 1-second NBBO plus streaming is easy. Defensibility is low; this is a feature, not a company.

### Cited Findings
- Retail favours cheap weekly options with a 12.6% average bid-ask spread, and the bulk of losses comes from indirect trading costs. — [Bryzgalova et al. 2023](https://www.sikorskaya.net/files/Bryzgalova_Pavlova_Sikorskaya_2023.pdf)
- Retail 0DTE losses are concentrated in single-leg, premium-paying, high-IV trades. These figures come from secondary summaries of Beckmeyer, Branger & Gayda, a working paper, and the reported daily-loss figures disagree across versions ($184k vs $241k/day; $350k/day after May 2022). — [Enlightened Stock Trading summary](https://enlightenedstocktrading.com/what-percentage-of-traders-lose-money/); [JoinCFU stats](https://joincfu.com/blog/options-trading-statistics)
- OptionStrat is described as a modelling tool, not a substitute for live quotes and fills at the broker. — [Options backtesting software compared (TraderSentiments)](https://tradersentiments.com/learn/options-backtesting-software)

### Inferences
- **Metrics, from TD NBBO:**
  - Round-trip cost % = (ask − bid) / mid.
  - Time-of-day spread profile from 1-second NBBO history, e.g. "this contract's spread is 3× wider in the first 5 minutes".
  - Depth-adjusted cost, if NBBO size is available.
  - Spread-inclusive break-even: underlying move needed to exit at the bid for zero P&L after buying at the ask.
  - Liquidity score combining spread %, quote size, trade count, OI (TD OI is previous-day) and how often the quote changes.
- **Data limits:** live needs the TD stream. UW adds nothing essential.
- **Defensibility and use:** low on its own, since any broker could add it. It works best as a free top-of-funnel widget or browser extension that leads into the paid fill audit and replay simulator.

### Gaps
- I found no survey of which broker chains (Robinhood, Webull, tastytrade, thinkorswim, IBKR) already show spread %, a liquidity score or a spread-inclusive break-even. That needs direct product checks.

---

## Q5. Honest backtesting: random-entry baselines, real bid/ask fills, multiple-testing warnings

### Takeaway
Retail options backtesters are now many, and several model fills beyond the midpoint:
- Option Omega uses 1-minute data with NBBO-based stops.
- Option Alpha has slippage-from-mid settings.
- ORATS is described as handling bid-ask.

I found none that offer random-entry baselines or multiple-testing/overfitting warnings. That "statistical honesty" layer is the gap.

### Cited Findings
- **Option Omega:** the backtester uses 1-minute data. Stop-loss triggers can use NBBO alone or NBBO + trades, and the docs note that trade-based triggers cause the most stops. — [Option Omega docs: Backtest setup](https://docs.optionomega.com/backtesting); [Option Omega Backtesting FAQ](https://docs.optionomega.com/backtesting/backtesting-faq)
- **Option Alpha:** lets users set slippage from the mid-price for opening and closing trades. — [Option Alpha blog: backtest slippage](https://optionalpha.com/blog/backtest-slippage-when-opening-and-closing-trades)
- **OptionNet Explorer (ONE):**
  - Manual replay with no automated backtesting, on 5-minute intraday historical data. Positions are built by clicking bid or ask in the historical chain. — [DayTrading.com: OptionNet Explorer](https://www.daytrading.com/optionnet-explorer); [SteadyOptions review](https://steadyoptions.com/articles/optionnet-explorer-one-options-backtesting-software-r743)
  - Pricing is roughly £10 for a 10-day trial, £160 for 3 months, £525 per year. — [Aeromir ONE](https://aeromir.com/one)
- **ORATS:** comparison blogs describe its historical data as including greeks, IV surfaces and bid-ask spreads, with "realistic fill assumptions". These are secondary, possibly affiliate, sources. — [TraderSentiments](https://tradersentiments.com/learn/options-backtesting-software); [Gitnux](https://gitnux.org/best/options-backtesting-software/)
- **tastytrade:** its backtester is free for account holders. — [Strike.money: Option Alpha alternatives](https://www.strike.money/reviews/option-alpha-alternatives)
- **Pricing conflicts across blogs:** ORATS $99 vs $99-199/mo; Option Alpha $79-299 vs $99/mo. — [TraderSentiments](https://tradersentiments.com/learn/options-backtesting-software); [Gitnux](https://gitnux.org/best/options-backtesting-software/)

### Inferences
- **Honest-backtest features buildable on TD:**
  1. Fill at the ask/bid from historical NBBO at the decision timestamp plus a latency. Optionally allow a limit fill only if a TD print traded at or through the limit, or the NBBO crossed it.
  2. A random-entry baseline: the same strategy shape and holding rules with entries drawn at random times. Report where the user's result sits in that distribution.
  3. A deflated-Sharpe or "number of variants tried" counter that warns when a user has tested N parameter sets.
  4. Walk-forward and holdout enforcement.
  5. Separate "gross edge" from "spread paid".
- **Data limits:**
  - TD reaches 2012 for trades/OI, but quote depth may be shorter (Q0 gap).
  - UW-based features such as "only enter when GEX < 0" can only be backtested from 2023-12. That is under 3 years and too short for regime-conditional claims; the UI should say so.
- **Defensibility:** medium. Engineering is substantial: TBs of quotes and fast replay. The "honesty" features could be copied, but they cut against competitors' marketing incentives, since honest baselines make strategies look worse. That makes them less likely to be copied.

### Gaps
- No practitioner head-to-head comparing simulated versus live fills across ORATS, Option Omega, Option Alpha and tastytrade was found.
- The academic multiple-testing references (Harvey-Liu-Zhu; Bailey & López de Prado deflated Sharpe) were not retrieved this session and should be cited by the report writer only if verified elsewhere.

---

## Q6. Dealer-positioning dashboards with stated assumptions and error bars; how accurate are GEX-style estimates?

### Takeaway
Standard GEX rests on an unobserved assumption: dealers are long calls and short puts, per the SqueezeMetrics convention. Academic evidence links market-maker gamma to intraday volatility and reversal/momentum, but finds the effect sign-dependent and modest. I found no published test of how often the dealer-sign assumption is right. Trade-direction algorithms themselves are only 59-83% accurate, and about 50% on index complex trades.

### Cited Findings
- **The assumption:** standard GEX assumes dealers are long the calls customers sell and short the puts customers buy, attributed to the SqueezeMetrics white paper. Some vendors instead infer direction from trade data, e.g. glassnode's taker-flow GEX. — [LuxAlgo GEX concept](https://www.luxalgo.com/library/concept/gamma-exposure/); [glassnode taker-flow GEX](https://research.glassnode.com/gamma-exposure/)
- **Sign errors invert regimes:** the call/put sign is an inventory assumption, not a property of gamma. Flipping it negates net GEX but leaves the flip level unchanged, so a sign error inverts the long-gamma and short-gamma regimes. Seen only via the abstract and snippet. — [Chilingarian, "The Sign of Dealer Gamma", SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7131778)
- **Unverified error estimate:** a Substack post cites "30-50%" GEX error from an unnamed reference paper. — [Harbourfront Quant](https://harbourfrontquant.substack.com/p/extending-the-dealer-gamma-exposure)
- **0DTE evidence (Dim, Eraker & Vilkov):** market makers' net gamma in 0DTE SPX is on average positive and negatively related to future intraday volatility. Positive (negative) market-maker gamma strengthens intraday reversal (momentum). — [Dim, Eraker & Vilkov, "0DTEs: Trading, Gamma Risk and Volatility Propagation", SSRN 4692190](https://papers.ssrn.com/sol3/Delivery.cfm/4692190.pdf?abstractid=4692190)
- **Hedge-rebalancing channel (Ni, Pearson, Poteshman & White, RFS 2021):** shows a non-informational channel through which option market-maker hedge rebalancing affects stock return volatility and the probability of large moves. — [Ni, Pearson, Poteshman & White, RFS 2021](https://econpapers.repec.org/RePEc:oup:rfinst:v:34:y:2021:i:4:p:1952-1986.)
- **Vendor-cited Cboe study:** reportedly finds estimated dealer gamma relates to volatility only conditionally and modestly. I saw it only via vendor citation. — [SpotGamma GEX page](https://spotgamma.com/gamma-exposure-gex/)
- **Trade-direction accuracy (JFQA):** against a proprietary CBOE dataset with true trade direction, four common classification rules sign 83%, 80%, 77% and 59% of classifiable trades correctly. Index-option complex-trade components not executed on RAES are misclassified about 50% of the time by any method. — [JFQA, "On Inferring the Direction of Option Trades"](https://www.cambridge.org/core/journals/journal-of-financial-and-quantitative-analysis/article/abs/on-inferring-the-direction-of-option-trades/FDA4541B57F78B2C8DCE129AFC25AAF0)
- **Opening/closing ground truth:** Cboe sells Open-Close data, aggregate opening/closing volume by origin such as customer and firm, plus a trade-by-trade dataset. — [FX News Group on Cboe datasets](https://fxnewsgroup.com/forex-news/exchanges/cboe-launches-two-complementary-datasets-for-complete-visibility-into-options-trading-activity-on-c1/); [Federal Register 2021-11175 (Open-Close Report)](https://www.govinfo.gov/content/pkg/FR-2021-05-27/pdf/2021-11175.pdf)

### Inferences
- **Buildable dashboard:**
  1. Compute GEX several ways from TD:
     - (a) the naive OI convention;
     - (b) a signed-flow version, classifying each TD print by its position against the attached NBBO (quote rule) and accumulating signed OI changes;
     - (c) UW's per-minute GEX, from 2023-12, as a third estimate.
  2. Show the spread across methods as an "assumption band" (error bar).
  3. Publish a running scorecard: did the regime label predict next-session realized intraday volatility, measured from TD stock/index data? Did "flip level" crossings precede volatility changes?
  4. Report hit rates and confidence intervals honestly, including when the effect is about zero.
- **The honest framing** is "model sensitivity", not "true dealer position". Without Cboe Open-Close (separate cost, not in either data source), dealer sign cannot be validated, only bracketed.
- **Data and limits:**
  - UW gives convenience but a black-box model and a short (2023-12+) history.
  - TD gives an auditable model but heavy computation: all SPX/SPY prints and per-trade greeks.
- **Defensibility:** medium. Many GEX vendors exist (SpotGamma, FlashAlpha, MenthorQ, etc.). "GEX with error bars and a public accuracy scorecard" stands out against vendor marketing and fits the measure/explain/verify positioning.

### Gaps
- The SqueezeMetrics white paper's exact text was not retrieved. Its date is given as 2017 by some sources and 2016 (revised 2017) by others.
- Baltussen, Da, Lammers & Martens, "Hedging demand and market intraday momentum" (JFE 2021), was not surfaced by search, so its findings are not cited here.
- Secondary summaries mention Amaya et al. (market-maker gamma adds at most about 3.3 points to annualized volatility), Brogaard, Han & Won (a 0DTE volume effect beyond MM gamma, attributed to retail), and a Cboe estimate of MM net 0DTE gamma at 0.04-0.17% of daily ES liquidity. Primary URLs were not retrieved, so verify before citing.
- No published empirical test of how often the "dealers long calls / short puts" sign is correct was found.

---

## Q7. Event-volatility tools: implied earnings move vs realized, IV-crush calculators, variance-premium history

### Takeaway
This category is well served. Market Chameleon already shows straddle-implied moves against 4- and 12-report average and median realized moves, and past straddle P&L. ORATS publishes implied-versus-historical analyses. A new entrant would need differentiation, such as spread-inclusive straddle P&L, distributions rather than averages, or honest base rates.

### Cited Findings
- **Market Chameleon:** compares the ATM-straddle implied earnings move with the absolute average move over the prior 4 and 12 reports and a 12-report median. It also tracks past straddle profitability and IV shifts. — [Market Chameleon: Upcoming Earnings Analysis](https://marketchameleon.com/EarningsReport/UpcomingEarningsAnalysis); [MC video: Charting Implied vs Actual Earnings Moves](https://marketchameleon.com/Instructional-Stock-and-Options-Trading-Videos/593/Charting-Implied-vs-Actual-Earnings-Moves)
- **ORATS:** an analysis of Meta found an average absolute move of about 7.9% versus an average implied move of 7.2% over twelve reports. — [ORATS blog: Meta earnings expected move](https://orats.com/blog/meta-earnings-expected-move)
- **Unsourced base rate:** a glossary site claims implied moves exceed realized about 65-70% of the time without citing a study. Treat as unverified. — [Convextrade glossary](https://convextrade.com/glossary/vol-of-earnings-premium)

### Inferences
- **Build:**
  - UW earnings history (dates and timing) plus TD quotes before the event (ATM straddle at the ask/bid, not mid) and TD stock data after the event (realized move).
  - TD greeks and IV history support an IV-crush calculator: expected post-event IV from the term-structure "event variance" decomposition.
  - UW VRP and skew history add context (2023-12+).
- **History:** TD reaching back to 2012 gives about 50+ earnings events per name. UW alone gives only about 11-12.
- **Differentiators:**
  - Straddle P&L after paying the spread; the incumbents' methods are unclear on this.
  - Full distribution and tail plots.
  - The share of events where buying the straddle at the ask was profitable.
- **Defensibility:** low; crowded.

### Gaps
- Not verified whether Market Chameleon or ORATS compute historical straddle P&L at mid or at bid/ask.
- No primary academic source on the frequency with which implied earnings moves exceed realized ones was retrieved.

---

## Q8. Journaling plus behavioural analytics (overtrading, revenge trading, 0DTE habits)

### Takeaway
Journals are a crowded, paid category:
- Edgewonk is the psychology/behavioural specialist.
- TraderSync is the options-oriented one, with AI coaching on tags.
- TradeZella and Tradervue are the others.

The gap is market-context enrichment of each journal entry: spread paid, NBBO at fill, greeks/IV at entry, and attribution. Few journals do this, because they lack tick-level options data.

### Cited Findings
- **Edgewonk:** focuses on psychology and behavioural analysis, with "Edge Finder" and a "tiltmeter". — [LuxAlgo: Edgewonk analysis](https://www.luxalgo.com/blog/edgewonk-journal-tool-analysis/)
- **TraderSync:** reportedly offers AI coaching that links behavioural patterns in notes and tags to P&L, and options greek import / multi-leg grouping. Competitor-hosted review. — [JournalPlus feature guide](https://journalplus.co/best/journal-with-options-greeks-tracking)
- **Tradervue:** positioned as simpler, with a free tier and lighter options features. — [Tradervue: best trading journals](https://www.tradervue.com/blog/best-trading-journal)
- **TradeZella:** credited with clean spread logging. Pricing figures across these comparison blogs conflict, e.g. Edgewonk $169/yr versus $29/$49 monthly. — [TradeZella: best trading journal 2026](https://www.tradezella.com/blog/best-trading-journal-2026)
- **0DTE-specific journals:** a market page exists for "journal for zero-DTE options traders". — [JournalPlus 0DTE guide](https://journalplus.co/best/journal-for-zero-dte-options-traders)
- **0DTE underperformance (Bogousslavsky & Muravyev):** 0DTE trades underperform other option trades by 4.71%, from journal data. This supports 0DTE-habit analytics. — [Bogousslavsky & Muravyev](https://www.lsu.edu/business/files/event-files/2025-finance-mardi-gras/retail_option_trading_v2.pdf)

### Inferences
- **Behavioural detectors** need only the user's own fills:
  - re-entry within N minutes after a loss (revenge);
  - size escalation after losses;
  - trades per day versus personal baseline (overtrading);
  - share of 0DTE trades and their P&L versus other expiries;
  - time-of-day losses.
- **TD enrichment:** cost of trading at the open (spread width), whether fills were at the ask, and IV percentile at entry.
- **Defensibility:** low for the journal itself. Medium if bundled with the fill audit (Q1), attribution (Q2) and replay (Q9), because "your own trades replayed against the real tape" is hard for incumbents without OPRA tick data.
- **Who pays:** active traders, typically $20-50/mo per the conflicting blog pricing.

### Gaps
- No academic validation was found that behavioural flags (revenge or overtrading detectors) improve retail outcomes.
- Broker-import coverage for options (multi-leg, assignments) across journals was not researched.

---

## Q9. Education / simulation: replay simulator on real historical tick data with real fills

### Takeaway
Tick-replay simulators with recorded bid/ask exist for stocks, futures, forex and crypto (TradingSim, FX Replay). Some platforms (NinjaTrader, ATAS) synthesize the bid/ask. The options-specific replay found, OptionNet Explorer, uses 5-minute data. I found no options replay simulator on recorded tick-level NBBO with trade-through fill logic. TD's 1-second NBBO and every-trade data would support one.

### Cited Findings
- **TradingSim:** says it replays real tick data and fills against historical bid/ask across stocks, futures and crypto; options are not listed. — [TradingSim](https://www.tradingsim.com/trading-simulator)
- **NinjaTrader:** tick replay stores only the best bid/ask at the last trade event. Without bid/ask stamps it simulates them as last price ± 1 tick at random. — [NinjaTrader docs: Developing for Tick Replay](https://docs.ninjatrader.com/ninjascript/developing_for_tick_replay)
- **ATAS:** replay mode "Ticks + Generated DOM" uses real trades but generated best bid/ask. — [ATAS Replay docs](https://help.atas.net/en/support/solutions/articles/72000661942-replay-trading-simulator-)
- **OptionNet Explorer:** 5-minute historical options data, with manual bid/ask click entry. — [DayTrading.com: ONE](https://www.daytrading.com/optionnet-explorer)
- **Option Omega:** 1-minute data, but positioned as a backtester rather than a discretionary replay. — [Option Omega docs](https://docs.optionomega.com/backtesting)

### Inferences
- **Build:** stream TD 1-second NBBO (or full quote ticks) plus prints for a chosen session at 1×-60× speed.
- **Fill rules:**
  - Market orders fill at the ask/bid plus a configurable latency.
  - Limit orders fill only if an OPRA print occurs at or through the limit, or the NBBO crosses it, with optional queue-position haircuts.
- **Overlays:** greeks, a P&L attribution ticker (Q2), and optional UW GEX/flow overlays (2023-12+ only).
- **Uses:** education ("trade the Aug 5 2024 open"), pre-live practice, and a sandbox for "would this alert have been tradeable?" (Q3).
- **Costs and limits:**
  - Storage and egress are heavy: SPX/SPY quote ticks run to many GB per day.
  - TD request throughput is a constraint, so pre-cache curated "famous days" and popular tickers.
  - Licensing for showing historical OPRA quotes to end users is unverified (Q0).
- **Defensibility:** medium-high. This is the most engineering-heavy concept, and incumbents' 1- and 5-minute data cannot replicate microstructure-faithful fills.
- **Who pays:** education buyers (options courses, prop challenges, brokers' education arms as B2B) and retail.

### Gaps
- Not checked: thinkorswim OnDemand's options replay granularity and fill logic. It is the most likely incumbent; the search did not surface it.
- Not checked: tastytrade, Webull and IBKR paper-trading fill logic for options.

---

## Q10. Flow transparency: opening/closing classification via next-day OI change; multi-leg detection; base rates for "unusual" alerts

### Takeaway
Open/close labels in retail flow tools are usually inferred. Ground truth exists only in paid exchange data such as Cboe Open-Close. Next-day OI change is a noisy proxy, because OI moves only when both sides open or both close. I found no tool publishing systematic base rates, i.e. how often "unusual" alerts were followed by a profitable move after costs. That is a clear "verify, don't signal" gap.

### Cited Findings
- **How OI moves:** OI rises only when both sides open and falls only when both close. One opener plus one closer leaves OI unchanged. — [CertFuel: Volume and Open Interest](https://app.certfuel.com/series7/learn/options/options-fundamentals/volume-and-open-interest)
- **OCC consolidation:** OCC computes OI by consolidating exchange reports of opening and closing transactions. — [Federal Register 2021-11175](https://www.govinfo.gov/content/pkg/FR-2021-05-27/pdf/2021-11175.pdf)
- **Open/close is inferred in vendor tools:** a vendor notes that side classification gives buyer versus seller, and opening versus closing needs a further inference layer. — [FlashAlpha: opening vs closing bias](https://flashalpha.com/articles/opening-vs-closing-bias-options-flow-oi-simulator)
- **Ground truth is paid:** Cboe Open-Close summary data and a trade-by-trade dataset are sold separately. — [FX News Group](https://fxnewsgroup.com/forex-news/exchanges/cboe-launches-two-complementary-datasets-for-complete-visibility-into-options-trading-activity-on-c1/)
- **Side-classification accuracy is limited:**
  - 59-83% depending on the rule; index complex-trade legs about 50% misclassified. — [JFQA](https://www.cambridge.org/core/journals/journal-of-financial-and-quantitative-analysis/article/abs/on-inferring-the-direction-of-option-trades/FDA4541B57F78B2C8DCE129AFC25AAF0)
  - A study of more than 125M trades matched to ISE/CBOE/GEMX Open/Close data finds classification success "considerably limited". — [Scribd: Option Trade Classification](https://www.scribd.com/document/700039427/Option-Trade-Classification)
- **OI-change screeners:** Barchart offers a free/paid OI-change screener. — [Barchart OI change](https://www.barchart.com/options/open-interest-change)
- **UW flow-alert taxonomy:** UW publishes a breakdown of its flow-alert types. — [UW Substack: types of Flow Alerts](https://unusualwhales.substack.com/p/a-breakdown-of-every-type-of-flow)

### Inferences
- **Open/close estimate:**
  1. For each contract-day, compare TD volume with the next-day OI change (TD OI is previous-day EOD, so use the T+1 value).
  2. If ΔOI ≈ +volume, flow was mostly opening; if ΔOI ≈ −volume, mostly closing. Report a bounded range rather than a label, e.g. "at least 60% of today's 12k volume was opening".
  3. The estimate is only available the next morning, not live.
  4. UW "OI changes" can cross-check from 2023-12.
- **Multi-leg detection:** group TD prints by timestamp (same millisecond), same underlying, matching sizes and ratios, and complex-order condition codes if present (unverified, Q0). The JFQA result implies leg-level side inference is about a coin flip for index complex trades, so the UI should say so.
- **Base-rate study:**
  1. Pull all UW flow alerts (2023-12 onward; at 3 concurrent requests, backfilling roughly 3 years is feasible but slow).
  2. For each alert compute forward underlying returns and the P&L of buying the alerted contract at the TD ask N seconds later and selling at the bid at fixed horizons.
  3. Compare against matched random contracts (same DTE, moneyness, premium bucket, time of day).
  4. Publish hit rates with confidence intervals and multiple-testing caveats.
- **Defensibility:** high on credibility, since few vendors would publish base rates that may show their alerts are near-random.
- **Licensing conflict:** publishing UW-alert-derived statistics may breach UW's no-redistribution term. Building "unusual" detection independently from TD prints avoids the conflict.

### Gaps
- Pan & Poteshman (2006) on informed option volume, and later evidence on whether the predictive power of open-buy put/call ratios survives, were not retrieved.
- I did not find any published study of the forward performance of retail "unusual options activity" alerts, either academic or vendor.
- Whether TD exposes OPRA trade condition codes, including complex/multi-leg flags, was not verified.

---

## Q11. Additional concepts surfaced, and overall ranking

### Takeaway
The strongest opportunities are where (a) the user's own trades meet (b) millisecond NBBO data that incumbents lack, and (c) the output is verification rather than prediction. That points to the fill audit, trade autopsy, achievable-track-record verifier and tick-accurate replay. Event-vol, GEX and journaling are crowded unless reframed around error bars and honesty.

### Cited Findings
- Retail options losses are attributed mostly to execution costs (12.6% average spread). This makes cost measurement the most evidence-backed value proposition. — [Bryzgalova et al. 2023](https://lbsresearch.london.edu/id/eprint/2827/1/The%20Journal%20of%20Finance%20-%202023%20-%20BRYZGALOVA%20-%20Retail%20Trading%20in%20Options%20and%20the%20Rise%20of%20the%20Big%20Three%20Wholesalers.pdf)
- That magnitude is disputed by journal-level data showing -0.9% average trade returns. — [Bogousslavsky & Muravyev](https://www.lsu.edu/business/files/event-files/2025-finance-mardi-gras/retail_option_trading_v2.pdf)
- New Rule 605 broker-level disclosures start in 2026 (August 2026 per Robinhood's 10-K; Nov 1 2026 for best-available-displayed-price statistics). They will raise public attention to execution quality, whether or not options are covered. — [Robinhood 10-K FY2025](https://www.sec.gov/Archives/edgar/data/1783879/000178387926000023/hood-20251231.htm); [SEC Release 34-104147](https://www.sec.gov/files/rules/final/2025/34-104147.pdf)
- PFOF per options contract differs by broker (about $0.56 Robinhood versus $0.40 Schwab, Q2 2025). This makes broker-level options execution comparison newsworthy. — [GlobalTrading](https://www.globaltrading.net/schwab-overtakes-robinhood-in-options-pfof-as-per-contract-rates-diverge/)

### Inferences
- **Additional concepts worth evaluating**, all buildable from TD with no extra data source:
  - (a) **Broker options execution league table** built from crowdsourced fills (an extension of Q1). This fills the probable gap if Rule 605 excludes options.
  - (b) **Pin/assignment and expiration-risk explainer:** OI by strike near expiry from TD, plus early-exercise risk for American calls before ex-dividend. This is education, not a signal.
  - (c) **Contract liquidity alerts:** "this contract's spread just widened 3×", via the TD stream.
  - (d) **"Alert achievability" API for alert marketplaces** (B2B version of Q3).
- **Rough ranking**, using evidence of need, uniqueness of the TD data advantage, and defensibility:

| Rank | Concept | Section |
|---|---|---|
| 1 | Fill audit / broker execution comparison | Q1, Q11a |
| 2 | Tick-accurate replay simulator | Q9 |
| 3 | Achievable track-record verifier | Q3 |
| 4 | Trade autopsy / attribution | Q2 |
| 5 | Honest backtester with baselines | Q5 |
| 6 | Alert base-rate study (licensing-dependent) | Q10 |
| 7 | GEX with error bars and scorecard | Q6 |
| 8 | Cost-to-trade chain widget (funnel feature) | Q4 |
| 9 | Journal with behavioural flags | Q8 |
| 10 | Event-vol tools (crowded) | Q7 |

  This ranking is a judgment call, not a sourced result.
- **UW Basic's role** is mainly prototyping and validation (GEX, VRP, earnings calendar, alert backfill). The redistribution clause and 3-concurrent limit make it unsuitable as a production backend for customer-facing numbers.

### Gaps
- No market-sizing data (number of active retail options traders, willingness to pay for audit/verification tools) was gathered.
- No Reddit or forum demand evidence was gathered beyond one r/options execution-quality thread; the r/options and r/thetagang feature-request evidence base is thin.
- Primary-source confirmation is still needed for: Rule 605 options scope; ThetaData end-user display licensing; TD condition codes; UW Basic concurrency and history limits.
