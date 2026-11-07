# Licensing and regulatory constraints on showing US options data and derived analytics to paying retail users

Research date: 2026-11-07. Scope: US only. "Primary" means read directly from the issuer's own document. Where only a secondary summary was available, that is stated.

## 1. OPRA: vendor and subscriber agreements, pro vs non-pro, display vs non-display, delay threshold, derived data, current fees

### Takeaway
To show real-time OPRA options quotes or trades to paying retail users, a company becomes an OPRA "Vendor". That means signing the OPRA Vendor Agreement, paying a **$1,500/month Redistribution Fee** ($650 if the service is query-only with no auto-refresh), and paying **$1.25 per non-professional subscriber per month** (tiered down to $0.60 above 500,000 users), or **$31.50 per professional display device**. The redistribution fee still applies to **15-minute-delayed** data. Only redistribution limited to **historical** data (prior sessions) is exempt. Delayed and historical requests are not counted for usage-based fees. OPRA publishes **no public policy on derived data** (greeks, IV, GEX, aggregated flow). How those are treated must be settled with OPRA or the upstream vendor.

### Cited Findings
**Fee schedule.** The current OPRA fee schedule PDF (primary) has no printed effective date; its last fee step-ups are dated January 1, 2018. It lists:
  - Professional Subscriber Device-Based Fee: "$30.50 per display device commencing January 1, 2017" and "$31.50 per display device commencing January 1, 2018" — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
  - Nonprofessional Subscriber Fees, paid monthly by every vendor that furnishes OPRA data to non-pros: up to 75,000 users $1.25 each; 75,001–150,000 $1.15; 150,001–250,000 $1.00; 250,001–500,000 $0.75; 500,001+ $0.60 — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
  - Usage-based Vendor Fee (alternative to the flat fee): "$0.0075 per 'quote packet' or $0.03 per 'options chain'". For a non-pro the monthly fee is capped at $1.25. "requests for 'delayed' and 'historical' OPRA Data are not counted" — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
  - Redistribution Fee: "$1,500; $650 (Query service only)". It is payable "by every vendor that redistributes OPRA Data to any person, whether on a current or delayed basis, except that this fee does not apply to a Vendor whose redistribution of OPRA Data is limited solely to 'historical' OPRA Data." — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
  - The query-only rate requires access "only on a 'query' basis without any auto-refreshing capability", with no redistribution to downstream vendors or Hosted Solutions — [OPRA Fee Schedule fn. 8](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
  - Subscriber Indirect Access Fee: $600/month. Direct Access Fee: $1,000/month. Control Service Fee: $2,800/month — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
  - Non-Display Use Fees: Category 1 (own behalf) $2,000 per Enterprise; Category 2 (on behalf of clients) $2,000 per Enterprise; Category 3 (order matching) $2,000 per Platform — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
  - Hosted Solution Fee: current data $100 per Hosted Solution or a $10,000 Enterprise rate; delayed data $50 per Hosted Solution or a $5,000 Enterprise rate — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
  - New professional subscribers get a 30-day free trial — [OPRA Fee Schedule fn. 3](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)

**Delay threshold.** "OPRA Data becomes 'delayed' after at least 15 minutes have passed since the information was first transmitted…". Data "becomes 'historical' upon the opening of trading on the next succeeding trading day." — [OPRA Fee Schedule fn. 6](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf). The OPRA FAQ likewise defines "current" data as data transmitted within the preceding 15 minutes — [OPRA FAQ](https://opraplan.com/faqs)

**Delayed data, as vendors read it.** ThetaData: "There are currently no OPRA fees for using or redistributing data that is over 15 minutes delayed", but firms redistributing delayed data "may still need to register as an OPRA data vendor" — [ThetaData OPRA fee guide, May 29 2026](https://thetadata.net/articles/2026-05-29-opra-fee-guide-for-options-market-data). Sentisense instead says delayed and end-of-day data owe no per-subscriber or non-display fees, while the redistribution fee still applies to delayed redistribution and screens must carry a delay label — [Sentisense, Oct 13 2026](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/). **The two conflict on the redistribution fee. The primary fee-schedule text supports Sentisense:** the fee applies "whether on a current or delayed basis".

**Non-display definition.** Non-display covers use "for a purpose other than in support of the data recipient's display or further … redistribution." It includes "investment analysis… risk management… portfolio valuation" and algorithmic trading. Category 1 is own behalf, Category 2 is on behalf of clients, Category 3 is internal order matching. A server used solely for non-display is not charged device fees. A device used for both display and non-display pays both. Recipients must declare non-display use to OPRA when it starts and then annually — [OPRA Fee Schedule fn. 10](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)

**Nonprofessional definition (OPRA).** The individual applies "in his own capacity, not on behalf of a firm"; the "Information cannot be furnished to any other person or entity"; and the individual "is not a securities broker-dealer, investment advisor, futures commission merchant…". The vendor reviews the subscriber agreement to decide qualification — [OPRA FAQ](https://opraplan.com/faqs). A Nonprofessional generally must be a natural person, with a limited exception for certain personal trusts — [SEC Release 34-81900 (2017)](https://sec.gov/files/rules/sro/nms/2017/34-81900.pdf). OPRA's definition sits in an addendum to its subscriber-agreement forms, and the vendor agreement points to those forms — [OPRA policy re non-professionals (copy hosted by eToro)](https://www.etoro.com/wp-content/uploads/2022/10/opra-policy-regarding-non-professionals.pdf)

**Vendor obligations.** Per Sentisense: vendors must qualify users, report subscriber counts to OPRA at least monthly, and pay the professional rate on misclassified users. OPRA's hosted-solutions policy treats redistribution over the internet as external redistribution — [Sentisense](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/) (secondary)

**Recent changes.** A 2025 OPRA filing (OPRA-2025-02) changed direct-access wording and the website reference from opradata.com to opraplan.com, leaving fee amounts unchanged — [SEC OPRA-2025-02 Exhibit I](https://www.sec.gov/files/rules/sro/nms/2025/34-104267-ex1.pdf). Sentisense says a February 2026 SEC order changed direct-access wording, not amounts — [Sentisense](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/)

**Derived data.** "OPRA publishes no policy on implied volatility, greeks, or aggregates. Massive calls derived redistribution case-by-case. MarketData.app files computed greeks and IV under non-display category 2." The same article says whether a given derived value is fee-free is unverified — [Sentisense](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/). The OPRA FAQ does not address derived data, greeks, IV or analytics — [OPRA FAQ](https://opraplan.com/faqs)

**ThetaData's restatement of OPRA fees** (2026): Professional $31.50/user/month; Non-Professional $1.25/user/month; Non-Display $2,000/month per category; Redistributor License $1,500/month or $650 query-only — [ThetaData OPRA fee guide](https://thetadata.net/articles/2026-05-29-opra-fee-guide-for-options-market-data)

### Inferences
- **Real-time retail product (OPRA only).** Floor is about $1,500/month plus $1.25 per non-pro user per month. A web or app product that auto-refreshes needs the full $1,500 rate.
- **Non-display fees.** If the company computes analytics (greeks, GEX, IV surfaces, flow aggregation) from real-time OPRA data on its own servers, that computation plausibly falls under non-display "investment analysis". It could add $2,000/month for Category 1 and/or Category 2, since the analytics are computed on behalf of clients. With Category 2, the total is about $5,500/month before per-user fees.
- **Classification risk.** Where analytics are taken from an upstream licensed vendor, the upstream vendor's contract governs. It is uncertain whether OPRA would view the displayed output as OPRA data.
- **Delayed product.** At 15 minutes or more, per-user fees appear to go away. On the primary text, the $1,500 redistribution fee does not, and vendor registration is still needed.
- **Historical-only product.** Prior sessions only (end-of-day or next-morning) appears to escape the OPRA redistribution fee entirely. Upstream vendor licence terms still apply.
- **Reading derived data.** Greeks, IV and GEX are values computed from OPRA quotes, and OPRA has no published carve-out for them. The conservative reading: displaying a derived value next to, or in a form that can reconstruct, the raw quote is redistribution of OPRA data. Heavily aggregated, non-reconstructable metrics, such as one net GEX number per underlying, are more defensible as derived data. This must be confirmed in writing with OPRA or the vendor. The CT Plan's equity-side definition ("cannot be reverse engineered… cannot be used to create… a reasonable facsimile") is a reasonable analogue (see §2).

### Gaps
- The OPRA Vendor Agreement text, the Hosted Solutions policy and the current non-pro policy document were not retrieved from opraplan.com; only secondary copies and summaries were read.
- No OPRA written guidance on derived or calculated values was found. It does not appear to be public.
- No 2025–2026 change to OPRA per-user or redistribution fee amounts was found. The schedule appears unchanged since January 1, 2018, but the PDF itself carries no effective date.
- No source was found for OPRA audit practice or penalties for misclassification beyond Sentisense's summary.

## 2. Index data (Cboe SPX/VIX, S&P DJI, Nasdaq) and stock data via CTA/UTP SIP or exchange feeds

### Takeaway
**Index option quotes** (SPX, VIX, NDX options) come through OPRA. The **index values themselves** (the SPX level, the VIX spot) are licensed separately by the index owner (Cboe Global Indices, S&P DJI, Nasdaq GIDS). Their current per-user display fees are **not publicly posted**; only dated (2011–2019) figures surfaced.

For **stocks**, the SEC approved a new consolidated **CT Plan fee schedule on June 26, 2026** (Release 34-105778). It:
- cuts non-pro fees from $1.00 to a sliding scale starting at $0.90 per tape;
- moves to use-based Professional/Non-Professional definitions with a good-faith safe harbor;
- makes delayed and end-of-day data non-fee-liable, removing even Tape C's $250 delayed redistributor fee;
- **treats creation of derived data as fee-liable Non-Display Use**.

### Cited Findings
**CT Plan order.** "Order Approving the Second Amendment to the National Market System Plan Regarding Consolidated Equity Market Data, as Amended by Amendment No. 1 and Modified by the Commission, to Adopt a Fee Schedule", dated June 26, 2026 (Release 34-105778; File 4-757). It closes: "the Amended Fee Proposal… as modified by the Commission, is approved." — [SEC Release 34-105778](https://www.sec.gov/files/rules/sro/nms/2026/34-105778.pdf)

**Proposed per-device professional rates.** $26 (Tape A), $23 (Tape B), $24 (Tape C) — [policyrisk.com summary of FR 2025-24058](https://policyrisk.com/behind-the-curtain/federal-register/2025-24058) (secondary)

**Non-pro sliding scale.** Replaces "$1" per tape. Rates are $0.90 for the first 2,000 non-pros, $0.75 for 2,001–50,000, then $0.60 / $0.40 / $0.25, with $0.25 at 1,000,001+. It works "in a manner similar to tax brackets" — [SEC OIP Notice 34-105125, 91 FR 17026 (Apr. 3, 2026)](https://www.govinfo.gov/content/pkg/FR-2026-04-03/pdf/2026-06463.pdf)

**Old non-pro definition (status-based).** A natural person not registered with the SEC, CFTC, states or SROs; not acting as an "investment adviser" under §202(a)(11) of the Advisers Act; and not bank-employed in such a function — [OIP Notice](https://www.govinfo.gov/content/pkg/FR-2026-04-03/pdf/2026-06463.pdf)

**New definitions and safe harbor.** Professional Use is "use of market data by an individual to provide service to a third party for compensation", and Non-Professional Use is "any usage that is not Professional." A Real-Time Redistributor that relies in good faith on subscriber representations is exempt from audit liability for misclassification. This requires documented onboarding attestations and "commercially reasonable screening" — [SEC Release 34-105778](https://www.sec.gov/files/rules/sro/nms/2026/34-105778.pdf)

**Redistributor and delayed fees.** Real-Time Redistributor fee: $1,155 per Tape, up from $1,000, a 15.95% inflation adjustment. "The Amended Fee Proposal would not assess a fee for a Delayed Redistributor." Tape C's Delayed Redistributor, End-of-Day Redistributor and Delayed Data Access fees are eliminated. "Delayed Subscriber" and "End of Day Subscriber" are non-billable — [SEC Release 34-105778](https://www.sec.gov/files/rules/sro/nms/2026/34-105778.pdf)

**Non-display and derived data.**
- Non-display fees are $2,315 (Tape A), $1,155 (Tape B) and $2,025 (Tape C) for last sale, with identical fees for bid/ask. "Under the Amended Fee Proposal, the creation of Derived Data would be considered Non-Display Use and become fee liable." — [SEC Release 34-105778](https://www.sec.gov/files/rules/sro/nms/2026/34-105778.pdf)
- Derived Data is defined as "pricing data or other information that is created in whole or in part from the CT Plan Information". It "cannot be reverse engineered to recreate the Information" and "cannot be used to create other data that is recognized to be a reasonable facsimile". Under the existing schedules, derived data was "generally not fee-liable, except single-security Derived Data may be fee-liable at the underlying rate for Tape C." — [OIP Notice](https://www.govinfo.gov/content/pkg/FR-2026-04-03/pdf/2026-06463.pdf)
- In comments, Massive argued that a vendor paying non-display fees for derived-data creation should be able to redistribute that derived data "without additional reporting obligations, approval requirements, or customer-level fees". The Operating Committee did not respond on usage reporting for non-fee-liable categories — [SEC Release 34-105778](https://www.sec.gov/files/rules/sro/nms/2026/34-105778.pdf)

**Go-live timing.** The CT Plan Effective Date is November 20, 2024. The processor transition is due no later than 30 months after the Effective Date or 90 days after fee approval, whichever is later — [SEC Release 34-105778](https://www.sec.gov/files/rules/sro/nms/2026/34-105778.pdf)

**Legacy SIP fees still cited by vendors.**
- UTP delayed Level 1: $250 Annual Admin Fee for internal use; external delayed use is $250 Annual Admin Fee plus a $250/month Delayed Redistributor Fee — [Cboe DataShop SIP fees](https://datashop.cboe.com/sip-fees)
- CTA redistribution: Network A $1,000/month, Network B $1,000/month — [CTA Schedule of Market Data Charges](https://www.ctaplan.com/publicdocs/ctaplan/Schedule_of_Market_Data_Charges.pdf)

**Cboe indices.**
- A third-party source says Cboe moved to a "per client" fee for its index data in early 2019, with the CBOE Indices data group at $25/month. This is dated and unverified — [Optuma KB](https://www.optuma.com/kb/data/end-of-day-data-options/cboe-indices-data)
- Cboe's data shop says the Cboe Global Index Feed carries SPX and VIX spot values among 400+ products — [Cboe DataShop](https://datashop.cboe.com/sip-fees)
- A $1.00 non-pro figure in Cboe filings applies to C2 options data, not SPX/VIX index values — [SEC Cboe filing 2026](https://www.sec.gov/files/rules/sro/cboe/2026/34-105301-ex5.pdf)

**S&P DJI.**
- S&P DJI licenses real-time values of the DJIA and S&P 500 "to the media for display on television, websites, and mobile apps" — [S&P DJI Data & Index Licensing](https://www.spglobal.com/spdji/en/about-us/data-index-licensing)
- A ~2011 CME-distributed price sheet listed $1.00/user/month real-time, a $25 vendor minimum, a $4,200 annual redistribution licence and $600/month for real-time website display. This is dated — [CME advisory](https://www.cmegroup.com/tools-information/lookups/advisories/market-data/20110930-2.html)
- An undated broker notice reports S&P DJI end-user fees rising from $3 to $4 real-time and from $2 to $3 delayed — [Infront](https://www.infrontfinance.com/direct/service-changes/s-p-dow-jones-indices)

**Nasdaq GIDS.**
- GIDS consolidates all Nasdaq indexes. Firms "must submit the appropriate documentation and receive prior approval from Nasdaq" — [Nasdaq index data](https://www.nasdaq.com/solutions/nasdaq-index-data)
- Nasdaq's Index Data Use and Distribution Policy governs per-user counting — [Nasdaq Index Data Policy](https://m.nasdaqtrader.com/content/technicalsupport/dataproducts/indexdatapolicy.pdf)

**ThetaData index pricing.** ThetaData sells commercial index data at $400/month (startups "as low as $250/mo") — [ThetaData commercial-use](https://www.thetadata.net/commercial-use)

### Inferences
- **Stock data timing.** A product launching in 2026–2027 will likely face the legacy CTA/UTP schedule (about $1,000/tape/month redistribution, $1/non-pro/tape) until the CT Plan processor goes live. The new schedule ($1,155/tape redistribution, non-pro from $0.90/tape) follows. The 30-month go-live milestone falls around May 2027; this is computed from the order and not confirmed.
- **Delayed stock quotes** become essentially free at the SIP level under the CT Plan.
- **Derived data on stocks.** The CT Plan move to make derived-data creation fee-liable as Non-Display is the clearest regulatory signal on derived data. It suggests computing analytics from consolidated equity data will cost about $1,155–$2,315 per tape per month in non-display fees, and the derived outputs themselves likely won't carry per-user fees. OPRA has no equivalent published rule.
- **Index values.** For SPX and VIX index levels, a small company will almost certainly get these through a licensed vendor (ThetaData, Massive, dxFeed, Barchart) that passes through Cboe and S&P DJI exchange fees. Expect a few dollars per user per month for real-time, or delayed or end-of-day values to avoid fees.

### Gaps
- Current (2025–2026) Cboe Global Indices, S&P DJI and Nasdaq GIDS per-user display fees and vendor licence fees were not found publicly. They are typically quote-on-request (Cboe DataShop / LiveVol sales, S&P DJI Commercial Services, DataSales@Nasdaq.com).
- The exact operative date of the CT Plan fees was not found in the order excerpt.
- The full final fee schedule (Exhibit), including enterprise caps and the Commission's modifications beyond quarterly metrics, was not extracted.

## 3. ThetaData: redistribution, commercial use, display to third parties, enterprise licence and pricing

### Takeaway
ThetaData's standard subscriber agreement allows **personal or internal use by one individual only**. It prohibits redistribution, sublicensing, display of compilations "based upon information derived from the Data", and derivative works, and it bars redistributing derived works even after termination. Commercial plans are listed at **Options $1,600/month, Stocks $1,200/month, Indices $400/month, Interest Rates $200/month**, with startup discounts of up to 75% (options "as low as $500/mo"). Redistribution "is prohibited without a commercial agreement that permits it". Whether a commercial plan includes display rights, and what OPRA pass-through applies, is not stated publicly.

### Cited Findings
**Use and redistribution limits.**
- §1(a) limits use to "Licensee's internal personal use purposes". §1(b) says the licensee "shall not disclose, release, distribute, or deliver the Data" to third parties without prior written consent, nor "rent, lease, lend, sell, sublicense, assign, distribute, publish, transfer" it — [ThetaData Subscriber Agreement](https://www.thetadata.net/subscriber-agreement)
- §1(b)(v) prohibits the licensee to "publish, enhance, or display any compilation or directory based upon information derived from the Data". §1(b)(i) bars creating "derivative works of the Data" — [ThetaData Subscriber Agreement](https://www.thetadata.net/subscriber-agreement)
- §8(e): "Derived works generated from Theta Data cannot be redistributed before or after the time of termination," and they must be expunged within 30 days of termination — [ThetaData Subscriber Agreement](https://www.thetadata.net/subscriber-agreement)
- Exhibit A (OPRA terms) §C(2): "shall not retransmit or otherwise furnish OPRA Data to any other person". Exhibit A §B limits access to "one individual". The agreement carries no effective date ("© 2020- ThetaData") — [ThetaData Subscriber Agreement](https://www.thetadata.net/subscriber-agreement)

**Commercial plans.**
- Options $1,600/month (startups "as low as $500/mo"), Stocks $1,200/month (as low as $500), Indices $400/month (as low as $250), Interest Rates $200/month (as low as $125). "Up to 75% discount" for startups; bundle discounts; "For commercial applications and business use cases only." — [ThetaData Commercial Use](https://www.thetadata.net/commercial-use)
- The commercial page does not state redistribution or display rights. Contacts: sales@thetadata.net and a Business Use Inquiry form — [ThetaData Commercial Use](https://www.thetadata.net/commercial-use)
- Individual plans are "Personal use only, no redistribution or business use." Professional or non-display users must "reach out to sales to obtain a commercial use license" and register their firm with OPRA. "Redistribution of any Theta Data data is prohibited without a commercial agreement that permits it." — [ThetaData OPRA fee guide](https://thetadata.net/articles/2026-05-29-opra-fee-guide-for-options-market-data)
- Individual tiers listed as Value $40, Standard $80, Pro $160; commercial options $1,600/month — [Sentisense](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/)

### Inferences
- An individual ThetaData subscription (the likely current setup for a prototype) **cannot** legally power a paid retail product. Neither raw data nor analytics derived from it (GEX, IV surfaces) may be shown to others.
- A commercial plan ($500–$1,600/month for options) is the minimum. Even then, display to external subscribers is likely a separate redistribution addendum, and the company would separately register with OPRA and pay OPRA vendor fees ($1,500/month plus per-user) on top. This must be confirmed with ThetaData sales.

### Gaps
- No public ThetaData redistribution or display licence terms or price; the "commercial agreement that permits it" is not published.
- It is unclear whether the commercial plans include external-display rights or only internal business use.

## 4. Unusual Whales API: redistribution, display in another product, commercial tiers and pricing

### Takeaway
The self-serve Unusual Whales API (Options Starter $99, Basic $150, Advanced $375/month) is "strictly for personal use" and "Redistribution is not allowed". Businesses must use the Startup ($750/month, or $625/month billed annually) or Startup + Kafka ($3,000/month, or $2,500/month annually) tiers, which allow "Personal or commercial use". **Redistribution is available only under custom Professional & Enterprise, "upon approval."** A 15-minute-delayed option is offered at reduced pricing.

### Cited Findings
**Self-serve API.** API Options Starter $99/month (25,000 requests, 1-year lookback); API Basic $150/month (unlimited requests, 2-year lookback); API Advanced $375/month (adds CME futures live tape over WebSocket). "The Unusual Whales API is strictly for personal use." "Redistribution is not allowed." Accounts found redistributing are terminated without reimbursement — [Unusual Whales Public API](https://unusualwhales.com/public-api)

**Enterprise page.**
- Startup is $750/month or $625/month billed annually ($7,500/year), with 160,000 requests/day, 2-year lookback, WebSockets, "Personal or commercial use". Startup + Kafka is $3,000/month or $2,500/month annually ($30,000/year). Professional & Enterprise is custom — [Unusual Whales Enterprise](https://unusualwhales.com/enterprise)
- "Redistribution licensing upon approval" appears only under Professional & Enterprise. A delayed data option at reduced pricing has a 15-minute delay on all endpoints. "White-label solutions," "Embedded widgets," and "Branded experiences" are listed for brokers. Named customers are Perplexity, Yahoo Finance and Public — [Unusual Whales Enterprise](https://unusualwhales.com/enterprise)

**Add-ons and retail tiers.** Full-market historical option trades are a $250/month add-on. The retail dashboard has a free tier with flow delayed two trading days, then $50, $75 and $120/month — [Sentisense](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/)

### Inferences
- Showing Unusual Whales flow, alerts or derived data (dark pool prints, flow tags, GEX) to paying users of another product requires the custom Enterprise tier with approved redistribution.
- The Startup tier's "commercial use" most likely covers internal business use, such as research or building signals, not display to end users. The page does not define it, so confirm in writing.
- UW's own data embeds OPRA-sourced trades. Any redistribution licence would likely require the company, or UW on its behalf, to account for OPRA vendor and per-user fees. This is not stated publicly.

### Gaps
- The full Unusual Whales API terms of service and the Enterprise redistribution price were not found; the price is quote-only.
- No published UW policy on derived works, for example metrics computed from UW flow and shown to users.

## 5. Securities regulation for analytics and alerts vendors

### Takeaway
A data and analytics product sold by subscription generally avoids Investment Advisers Act registration under the **publisher's exclusion** (§202(a)(11)(D), as read in *Lowe v. SEC*, 1985). To qualify, the content must be impersonal, bona fide (not false or misleading, not touting securities the publisher holds) and of general and regular circulation. The exclusion is lost through:
- **personalized advice**, such as questionnaires that tailor recommendations;
- **auto-trading or discretion** (*Weiss Research*, SEC 2006);
- **timing advice to trade one's own positions** (*SEC v. Park*).

Uniform, opt-in **alerts that filter generally available content** remained within the exclusion in the 2024 *Seeking Alpha* decision. Separately, the FTC and state securities regulators have pursued alert and signal sellers for deceptive earnings claims (RagingBull: $2.425M FTC settlement; New Hampshire settlement limiting alerts).

### Cited Findings
**Lowe and the bona fide test.** *Lowe v. SEC*, 472 U.S. 181 (1985): newsletters and a stock-chart service fell within the bona fide publication exclusion, so the publishers were not "investment advisers" — [US Reports 472 U.S. 181](https://www.govinfo.gov/content/pkg/USREPORTS-472/pdf/USREPORTS-472-181.pdf); [Casemine commentary](https://www.casemine.com/commentary/us/exclusion-of-bona-fide-investment-publications-from-the-investment-advisers-act%3A-lowe-v.-sec/view). A publication is "bona fide" if it (1) is not a personal communication, (2) does not contain false or misleading information, and (3) is not designed to tout any security in which the publisher has an interest. It must also be of general and regular circulation — [Greenberg Traurig, Aug 2024](https://www.gtlaw.com/en/insights/2024/8/no-need-for-seeking-alpha-to-seek-registration)

**Seeking Alpha (2024).** On August 15, 2024 a federal court dismissed a putative class action alleging Seeking Alpha was an unregistered adviser. Alerts on ratings changes, recommendations and at-risk holdings did not make content "personal communications", because they only filter generally available content any subscriber could see. Publications updated in response to breaking news can still be "regular" — [Greenberg Traurig](https://www.gtlaw.com/en/insights/2024/8/no-need-for-seeking-alpha-to-seek-registration). The decision was at the pleading stage with leave to amend.

**In re Weiss Research (2006).**
- The SEC order of June 22, 2006 (Advisers Act Release No. 2525) held the exclusion "only applies where the communications between the publisher and subscribers are impersonal." Weiss used a questionnaire to select the "best" services for subscribers and obtained discretionary auto-trading authority to execute trades through subscribers' brokers. It also selectively advertised profitable trades. The order was settled on consent — [Cahill memo](https://www.cahill.com/publications/client-alerts/0000001); [Greenberg Traurig](https://www.gtlaw.com/en/insights/2024/8/no-need-for-seeking-alpha-to-seek-registration)
- *SEC v. Park* (N.D. Ill. 2000): the exclusion was lost where publishers timed advice to profit from price moves or to trade their own shares (scalping) — [Greenberg Traurig](https://www.gtlaw.com/en/insights/2024/8/no-need-for-seeking-alpha-to-seek-registration)

**RagingBull (FTC and New Hampshire).**
- The FTC sued RagingBull.com in December 2020, alleging deceptive earnings claims for stock and options trading services. It alleged Jason Bond's income came primarily from subscription fees, not trading, and that RagingBull didn't track customer results. Settling defendants (including Bond and Jeff Bishop) agreed to pay $2.425M, stop unsubstantiated earnings claims and simplify cancellation, without admitting liability — [FTC consumer alert, Mar 2022](https://www.consumer.ftc.gov/consumer-alerts/2022/03/investment-trading-operation-will-pay-millions-empty-promises); [FTC amended complaint](https://www.ftc.gov/system/files/documents/cases/ragingbull.com_-_amended_complaint_for_permanent_injunction_and_other_equitable_relief.pdf); [Bloomberg Law](https://news.bloomberglaw.com/antitrust/investment-site-to-pay-ftc-2-4-million-for-earnings-deception)
- New Hampshire's Bureau of Securities Regulation settled separately in December 2021. RagingBull agreed to limit trade alerts and send alerts before placing its own trades, and NH residents received refunds — [NH Bureau of Securities press release](https://www.investsmart.nh.gov/news-and-media/nh-bureau-securities-settles-ragingbull-nh-residents-and-others-receive-refunds); [NHPR](https://www.nhpr.org/nh-news/2021-12-22/ragingbull-settles-state-securities-regulators-lee)

**Data-licensing link.** Under the old CTA/UTP definition, a person "engaged as an 'investment adviser'… (whether or not registered)" is a Professional, not a Non-Professional — [OIP Notice](https://www.govinfo.gov/content/pkg/FR-2026-04-03/pdf/2026-06463.pdf). OPRA's non-pro criteria also exclude investment advisors — [OPRA FAQ](https://opraplan.com/faqs)

### Inferences
- **Product-design guardrails to stay within the publisher's exclusion:**
  - Identical content and alerts for all subscribers at a tier; user-configured filters over the same universe are fine (per *Seeking Alpha*).
  - No questionnaires that map users to recommendations.
  - No auto-trading, copy-trading or discretionary execution.
  - No trading by insiders against alerts (front-running or scalping); adopt a written personal-trading policy and disclose holdings.
  - No performance cherry-picking: show full track records or none.
  - Regular publication cadence.
- **AI chat or personalized portfolio-specific suggestions** ("given your positions, buy X") are the highest-risk feature: they look like personal communications.
- **Marketing.** Any performance or earnings claims are an FTC Act §5 and state-law risk regardless of Advisers Act status. RagingBull shows the FTC will act on "you can make $X" marketing for options alert services.
- **SEC Marketing Rule (Rule 206(4)-1).** It governs registered (or required-to-register) investment advisers. A product relying on the publisher's exclusion would not be directly subject to it, but becomes subject if the company registers as an RIA. Rule scope was not verified in this pass; see Gaps.
- **FINRA Rule 2210.** If the company partners with a FINRA member broker (co-branding, embedded in a broker app, paid referrals), the broker's communications rules would likely require the broker to review and approve content it distributes as its own. Third-party research may require disclosures. Not verified in this pass; see Gaps.
- **Data-fee knock-on.** If the company were deemed an investment adviser, its own staff and possibly some users could fall into Professional classification. That raises data costs: $31.50 vs $1.25 for OPRA.

### Gaps
- The SEC Marketing Rule text and FINRA Rule 2210 (including FINRA's guidance on third-party research and options communications under Rule 2220) were not fetched; statements above are general knowledge, flagged as inference.
- No SEC enforcement action from 2024–2026 specifically against an options "flow alert" or "signal" seller was found. RagingBull (FTC and state) is the closest. A search for recent SEC unregistered-adviser actions against Discord/Telegram signal groups would help.
- State-level investment adviser rules (for example, state "publisher" exemptions that mirror the federal one) were not researched beyond the NH RagingBull settlement.
- The Seeking Alpha case caption and docket number were not captured; the source is a law-firm alert.

## 6. Practical paths small fintechs use, with approximate costs

### Takeaway
Three realistic paths exist:
1. **Licensed data partner with redistribution rights.** Business or startup plans from ThetaData, Massive (Polygon), Intrinio, Databento, Unusual Whales Enterprise, MarketData.app or FlashAlpha. Expect roughly **$500–$3,000+/month** for the vendor plus **OPRA vendor fees** of $1,500/month and $1.25 per user. Public prices exist for some, but external-display or redistribution rights are usually "contact sales".
2. **Delayed or historical-only products.** These drop OPRA per-user fees and, for historical-only, the OPRA redistribution fee.
3. **Broker-API / bring-your-own-entitlement models.** The user's broker supplies real-time data under the user's own entitlement (for example, Tradier gives real-time only with a brokerage account).

### Cited Findings
**Vendor price table** (Sentisense, prices read October 13, 2026) — [Sentisense](https://sentisense.ai/blog/unusual-whales-api-alternatives-options-flow-apis-2026/):

| Vendor | Published prices | Licence / redistribution terms |
|---|---|---|
| Intrinio | Individual $150/month; Startup $333/month, rising to $999 after a year; Enterprise from $1,250/month | Individual: no display or redistribution. Startup: commercial and display rights. |
| Massive (formerly Polygon.io) | Starter $29, Developer $79, Advanced $199 | Individual use. A Business plan is needed "once others can see the data". Options Business price not shown. |
| Databento | Standard $199/month live; Plus $1,750/month plus pass-through exchange licence fees (annual contract) | External distribution on Plus. |
| MarketData.app | Starter $30/month, Trader $75/month | Internal use. Commercial plan with redistribution at custom price. |
| FlashAlpha | Basic $79 to Alpha $1,499 | Commercial use from $2,500/month. |
| ORATS | Delayed $199, Live $299, Intraday $599, All-In $899 | Redistribution not stated. |
| Tradier | Included with Lite, Pro and Pro Plus brokerage plans | Real-time only with a brokerage account; otherwise 15-minute delayed. |
| Cboe DataShop / LiveVol | No published prices | Not stated. |

**Massive's own documentation.** "Any user who wishes to redistribute Massive's market data must sign up for one of our business products." OPRA requires Massive to collect employment information to classify individual options subscribers as pro or non-pro. Massive's proprietary options fair-market-value field is Business-only — [Massive knowledge base (business)](https://massive.com/knowledge-base/categories/business); [Massive options docs](https://massive.com/docs/websocket/options/overview). Third-party guides say Massive business pricing is custom and not published — [QVeris Polygon pricing guide, May 2026](https://qveris.ai/guides/polygon-pricing-optimized/)

**Unusual Whales Enterprise.** Startup $625–$750/month with commercial use; redistribution only on custom Enterprise; 15-minute delayed option at reduced price; white-label and embedded widgets for brokers — [Unusual Whales Enterprise](https://unusualwhales.com/enterprise)

**ThetaData commercial.** Options $1,600/month (startups from $500) — [ThetaData Commercial Use](https://www.thetadata.net/commercial-use)

**OPRA layer on top of any vendor:**
- Redistribution $1,500/month (or $650 query-only), plus $1.25 per non-pro or $31.50 per pro device — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)
- A Hosted Solution (a vendor operating a branded site on behalf of a third party) has its own fee: $100 per solution or a $10,000 enterprise rate for current data, and $50 or a $5,000 enterprise rate for delayed data — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)

**Historical-only exemption.** Redistribution limited "solely to 'historical' OPRA Data" is exempt from the OPRA redistribution fee — [OPRA Fee Schedule](https://cdn.opraplan.com/documents/OPRA_Fee_Schedule.pdf)

**Stocks, delayed and end-of-day.** Under the June 2026 CT Plan order, delayed and end-of-day stock data are non-billable for subscribers and redistributors — [SEC Release 34-105778](https://www.sec.gov/files/rules/sro/nms/2026/34-105778.pdf)

### Inferences
**Approximate monthly cost to launch a real-time retail options analytics product with about 1,000 non-pro users:**
- Data vendor commercial and redistribution licence: about $500–$1,600 (ThetaData startup or list), $625–$3,000 (UW Startup/Kafka; redistribution needs custom Enterprise, price unknown), or custom (Massive, Cboe).
- OPRA: $1,500 redistribution, plus $1,250 for 1,000 non-pros at $1.25, plus possibly $2,000–$4,000 non-display if analytics are computed in-house from real-time data.
- Index values (SPX/VIX levels) and stock quotes: vendor pass-through, a few hundred dollars per month plus per-user fees; current figures not public.
- **Indicative all-in: about $3,500–$10,000/month plus about $1.25–$3 per user per month**, before legal and audit-compliance costs. Inferred by summing the published components; not a vendor quote.

**Cheapest compliant path.** A 15-minute-delayed or end-of-day/historical analytics product (for example, GEX, IV and flow summaries published after the close or on a delay):
- OPRA per-user fees drop to zero.
- OPRA's $1,500 redistribution fee is still owed for delayed data, but not for historical-only data.
- The SIP equity side becomes free under the CT Plan.
- Vendor licences still need redistribution or display rights. UW explicitly offers a delayed option; ThetaData and Massive must be asked.

**Broker-API / bring-your-own-data.** The user connects their own brokerage account (Tradier, Schwab, IBKR), and real-time data flows under the user's own exchange entitlements. This shifts OPRA fees to the broker relationship. It is common for options tools but depends on each broker's API terms allowing display in a third-party app. Not verified for each broker; see Gaps.

**Interpreting derived analytics.** Computing GEX, greeks or IV in-house and showing only aggregated, non-reconstructable outputs may reduce OPRA display exposure. This is untested, and both OPRA and upstream vendor contracts (for example, ThetaData §1(b)(v) and §8(e)) restrict derived works, so written vendor permission is the key gating item.

### Gaps
- dxFeed, Barchart OnDemand and Cboe LiveVol redistribution pricing was not found publicly; all appear to be quote-only.
- Massive (Polygon) options Business plan price is not published.
- Intrinio figures come from a secondary source (Sentisense); Intrinio's own pricing page was not fetched.
- Broker API terms (Schwab Trader API, IBKR, Tradier, Alpaca) on displaying data in third-party apps were not researched.
- The UW Enterprise redistribution price and ThetaData redistribution addendum price are not public.
