# NEXTGEX Phase 1: the shortlist (desk research, 2026-11-07)

Question from the owner: GEX was a desk tool for years before retail got it. What is the next desk-grade read that
retail tools do not have, can we prove it is real on our history, and can we prototype it?

## What Slayer already has (so "new" means new to Slayer too)

A grep of `slayer/src` shows the app already ships most of the dealer-positioning family:
net GEX / DEX / VEX by strike, call/put walls, flip, supreme strike and a "pin" (`types/gex.ts`, `data/exposure.ts`,
`data/flipLevel.ts`), vanna and charm (`data/vannacharm.ts`, `data/charmDrift.ts`), a hedge-flow ladder of dollars
dealers must trade per strike (`data/hedgeFlow.ts`), a HAR realised-vol forecast (`data/volOutlook.ts`), skew and
surface (`data/skew.ts`), and a **risk-neutral density of the close by Breeden-Litzenberger** with wall-touch odds
(`data/weigherDensity.ts`, drawn by `components/weigher/ExpiryDensity.tsx`). Every probability the app prints today
(touch odds, the cone, the density) is a *priced* (risk-neutral) probability. Nothing in the app, and nothing in the
competitor table (`docs/product-research/notes/competitor_landscape.md`), says how often those priced odds come true.

## Scores (1 = poor, 5 = strong)

Criteria: **aha** = one picture or number that changes how a retail trader sees the day; **pedigree** = desk /
academic use; **data** = computable with our exact data (local history: 0DTE 1-min NBBO boards, daily OI by expiry,
1-min index/ETF bars, VIX/VIX1D bars; flow aggregates only Jan-Mar 2023 so far; live: commercial chain, greeks, OI,
flow); **test** = testable on 2020-2024 history without look-ahead; **novel** = vs SpotGamma / Menthor Q / Volland /
Unusual Whales and vs what Slayer already ships.

| # | Concept | aha | pedigree | data | test | novel | total | note |
|---|---|---|---|---|---|---|---|---|
| 1 | **Calibrated odds: priced (risk-neutral) vs real (realised-frequency) probabilities of the close, and where across strikes the overpricing sits** | 5 | 5 | 5 | 5 | 5 | **25** | Model-free from the 0DTE board (vertical-spread prices = priced odds). Bliss & Panigirtzoglou (JF 2004): risk-neutral densities fail forecast tests, risk-adjusted ones pass; Minneapolis Fed and BoE publish market-implied densities; Bandi, Fusari & Renò (2023) on 0DTE premia. No retail tool calibrates. Absorbs candidates 5 (premium across strikes) and 9 (skew-implied crash odds). |
| 2 | **Pin gravity: does the close land at large-OI strikes more often than the board prices?** | 4 | 4 | 5 | 5 | 3 | **21** | Ni, Pearson & Poteshman (JFE 2005), Avellaneda & Lipkin (2003). Retail has "max pain" and unmeasured "pins"; Slayer already marks a pin without evidence. Testable model-free: butterfly price at a strike vs its payoff, by the strike's OI. |
| 3 | Mechanical-flow map (dealer gamma + leveraged-ETF rebalance + vol-target + CTA triggers + MOC + buybacks) | 5 | 5 | 2 | 2 | 4 | 18 | Baltussen, Da, Lammers & Martens (JFE 2021) tie last-30-min momentum to gamma and LETF hedging. Only the gamma piece is computable here (Slayer has it). No LETF AUM, MOC imbalance, vol-target or buyback history locally; CTA levels are a model of other people's models. Its testable part is EDGE0DTE B7 / X4, already registered. |
| 4 | Intraday dealer inventory from signed flow ("live positioning", vs HIRO) | 4 | 5 | 3 | 2 | 2 | 16 | Flow history covers ~50 sessions (2023 Q1); quote-rule signing is right 59-83% of the time and 35-45% of SPXW volume is multi-leg and unsignable. HIRO exists. Revisit when the FLOW-DATA build reaches 2022-2024. |
| 5 | Variance-premium term structure and its strike profile | 3 | 5 | 3 | 4 | 3 | 18 | Locally only 0DTE quotes: no term structure. Strike profile folded into #1 (H1.5). |
| 6 | Implied vs realised correlation (dispersion) | 3 | 5 | 1 | 1 | 4 | 14 | Needs component option quotes; none locally. |
| 7 | Options order-flow toxicity (VPIN-style) | 3 | 3 | 3 | 2 | 5 | 16 | VPIN's predictive claims are contested; flow history too short. |
| 8 | Option market impact (Kyle's lambda per contract) | 2 | 5 | 3 | 2 | 5 | 17 | A microstructure cost read, not a market read; short flow history. |
| 9 | Skew-implied crash probability | 4 | 4 | 5 | 3 | 3 | 19 | CBOE SKEW is public. Same-day "crash" is the left tail of #1: tested there. |
| 10 | Expiry pin dynamics | (= #2) | | | | | | |
| 11 | Variance-swap fair value for any ticker | 2 | 5 | 5 | 5 | 2 | 19 | VIX1D already exists for SPX; EDGE-L measured realised/implied 0.91 on DEV. A number, not a picture. |
| 12 | (own) Leveraged-ETF rebalance estimate alone | 4 | 4 | 2 | 3 | 4 | 17 | Needs daily LETF AUM history (not local). |
| 13 | (own) Variance budget clock: share of today's priced variance already realised | 4 | 3 | 5 | 5 | 3 | 20 | Overlaps EDGE0DTE D1/D4. |
| 14 | (own) GEX with error bars (dealer-sign uncertainty) | 3 | 3 | 4 | 3 | 4 | 17 | Honest, but still GEX; Slayer's `levelSureness.ts` already prints the assumption and the flipped book. |

**Top 2: #1 Calibrated odds, #2 Pin gravity.** Both are computed from what the board and the OI *show* (OBS/CALC),
with no dealer-sign assumption, which is what kills most GEX claims in our ledger (EDGE E3/E6, EDGE-C, EMA-S1C).

## Why the earlier ledger matters here

* EDGE-L (2026-11-05): 0DTE realised/implied variance 0.908 at 09:45 on DEV; short-gamma days 0.911 vs long 0.905.
  So the board already prices the GEX regime, and priced odds should overstate wide moves. #1 turns that one
  number into a strike-by-strike, time-of-day map and asks whether a correction learnt on the past holds next year.
* EDGE E6 CHARM-PIN and NOV5 N3 failed as *trades*. #2 asks a narrower, model-free question (is the pin priced?) and
  is reported as a description either way.

## Sources

* Breeden & Litzenberger (1978); Minneapolis Fed market-based probabilities:
  https://www.minneapolisfed.org/banking/current-and-historical-market-based-probabilities
* Bliss & Panigirtzoglou, "Option-Implied Risk Aversion Estimates", Journal of Finance 59(1) 2004 (working paper:
  https://www.chicagofed.org/~/media/publications/working-papers/2001/wp2001-15r3-pdf.pdf)
* Bank of England, summary statistics of option-implied densities:
  https://www.bankofengland.co.uk/-/media/boe/files/working-paper/2008/summary-statistics-of-option-implied-probability-density-functions.pdf
* Jackwerth, "The Pricing Kernel Puzzle" (survey); Aït-Sahalia & Lo (2000)
* Bandi, Fusari & Renò, "0DTE Option Pricing" (2023): https://carey.jhu.edu/articles/risk-reward-insights-0dte-option-trading
* Ni, Pearson & Poteshman, "Stock price clustering on option expiration dates", JFE 78(1) 2005:
  https://ideas.repec.org/a/eee/jfinec/v78y2005i1p49-87.html ; Avellaneda & Lipkin pinning slides:
  https://math.nyu.edu/inmemoriam/avellaneda/PinningSlides.pdf
* Counter-evidence on 0DTE pinning (unreviewed): https://harbourfrontquant.substack.com/p/from-pinning-to-amplification-evidence
* Baltussen, Da, Lammers & Martens, "Hedging Demand and Market Intraday Momentum", JFE 142(1) 2021:
  https://www3.nd.edu/~zda/intramom.pdf
* Trade-sign accuracy (59-83%): JFQA, "On Inferring the Direction of Option Trades" (cited in the product research)
