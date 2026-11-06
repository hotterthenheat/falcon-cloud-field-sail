# Nov 5 2026 SPXW full-tape study: report

**Verdict: the "Thursday signs" worked on Thursday and nowhere else.** Before looking at any other day, 16 rule
variants were pre-registered (`PREREG.md`, commit 3d8e576). On Wed Nov 4 none of them triggered. On 600 DEV sessions
(2020–2024, 1-second fills, ask-in / bid-out +2 s, $0.65 a side) none passed. The best is N2-XB-D30 at +3.6% a trade,
95% CI [−5.0, +12.8], n 173. PBO is 0.41; DSR is ≤ 0.01 at N = 725. The synthetic zero-drift null passed 0% of the
time. No VALIDATION look was taken, and LOCKED was never opened beyond the two declared study days.

## The ceiling (hindsight upper bounds, `results/CEILING_20261105.md`)
- The best round trips were puts 1–4% out of the money at the open, bought at 09:30:10–11 (SPX 7680) and sold at 15:58–15:59
  (SPX 7350). Examples: 7650P 7.10 → 293.20 ($28.6k a lot, 41×); 7600P 1.65 → 245.20 (149×); 7500P 0.25 → 146.80 (587×).
- All 46 puts in that band made at least 100×. The median best multiple was 297× for 1–2% OTM and 579× for 2–4% OTM.
- The best three non-overlapping legs were the same for every contract: 09:30 → 10:53, 11:35 → 14:06 and 14:53 → 15:59.
- Calls paid only on the counter-trend legs. For example, 7405C went 42.10 → 89.50, 10:53 → 11:35.
- Summed best trades: puts $3.77M, calls $0.91M (of which $0.81M is deep-ITM calls tracking SPX).

## The turns, and what was visible strictly before each (`results/TIMELINE_20261105.md`)
- **H0, 09:30, 7681 (day high).** SPX opened below the rebuilt flip (~7700), so dealers were short gamma all day. 0DTE ATM
  IV was 9.5% against 14.6% for 1DTE. Pre-bell Hormuz headlines. Nothing else marked the top.
- **L1, 10:53, 7394.** The 7500 large-gamma strike broke at 10:37. ATM IV went 0.19 → 0.26 and VIX rose 3.6 points.
  Put buying ran +$12.8M, then call selling −$16.6M into the low. The low pierced 7400 and closed back. Headline:
  "Nasdaq into correction".
- **H2, 11:35, 7486.** The bounce stalled under 7500. VIX fell 2.4 points. The relief headline ("risk of renewed war with Iran
  eased") came six minutes before the high.
- **L3, 14:06, 7363.** A slow grind with flat VIX.
- **H4, 14:53, 7431.** VIX fell 2.1 points and call buying ran +$8.8M.
- **L5, 15:59, 7350.** The close pinned at the 7350 strike.
- The option's own EMA 9/21 lagged every low.
- The gamma sign and the walls were knowable in advance. The VIX/IV spikes and the flow moved with the market, not ahead of it.

## Rules tested (`PREREG.md`, `results/RULES_*.md`, `results/DEV.md`)

| Rule | Plain words | Nov 5 (in sample) | Nov 4 | DEV |
|---|---|---|---|---|
| N1 short-gamma drive | at 10:00, if dealers are short gamma and SPX is ≥ 2× its 30-minute implied move from the open, buy the trend side | +46% to +967% | no trigger | n 45, −1.5% to −14.1% |
| N2 wall break | while dealers are short gamma, SPX closes beyond the largest-gamma strike in its 30-minute direction: buy that side | +91% to +389% | no trigger | n 164–173, −0.5% to +3.6% (side beats 80–99% of shuffles) |
| N3 wall rejection | after a large move, a bar pierces the largest-gamma strike and closes back: buy the reversal | +15% to +50% | no trigger | n 81, −4.9% to −8.3% (beats only 12–22% of shuffles) |

**Reading:**
- The fortune was owning cheap OTM puts at 09:30 on a day that fell 4.2%. Short gamma at the open didn't predict that.
- Wall breaks in short gamma do tend to continue, but the drift is about one 0DTE round trip of cost.
- Bottom/top-ticking at the walls fails on history.

**Worth forward pre-registration (live recorder plus ticks):** the relief headline before a high, crowd flow chasing each leg,
and the IV spike into a low.

**Data note:** the terminal answered "No data" for Nov 5 sub-minute options for about two hours under load, and silently
truncates whole-chain (`strike=*`) reads after about 30 s. `fetch_tape.py` works around both. The raw data (175 MB) is in
`v2data/nov5-tape/`, not committed.
