#!/usr/bin/env python3
"""Compass corrected spec, with the 0DTE listing fact-check written in."""

from fpdf import FPDF

OUT = "/workspace/artifacts/compass-spec.pdf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SANSB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


class Doc(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_font("Sans", size=8)
        self.set_text_color(90, 90, 90)
        self.cell(0, 8, f"{self.page_no()}", align="R")


def h1(pdf, text):
    pdf.ln(3)
    pdf.set_font("Sans", "B", 13)
    pdf.set_text_color(0, 0, 0)
    pdf.multi_cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)


def h2(pdf, text):
    pdf.ln(2)
    pdf.set_font("Sans", "B", 11)
    pdf.set_text_color(0, 0, 0)
    pdf.multi_cell(0, 6, text, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)


def p(pdf, text):
    pdf.set_font("Sans", size=9.5)
    pdf.set_text_color(20, 20, 20)
    pdf.multi_cell(0, 4.6, text, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)


def bullet(pdf, text):
    pdf.set_font("Sans", size=9.5)
    pdf.set_text_color(20, 20, 20)
    pdf.multi_cell(0, 4.6, f"  \u2022  {text}", new_x="LMARGIN", new_y="NEXT")


def note(pdf, text):
    pdf.set_fill_color(245, 245, 245)
    pdf.set_font("Sans", size=9)
    pdf.set_text_color(20, 20, 20)
    pdf.multi_cell(0, 4.6, text, fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)


def table(pdf, headers, rows, widths):
    pdf.set_font("Sans", "B", 8)
    pdf.set_fill_color(230, 230, 230)
    pdf.set_text_color(0, 0, 0)
    for i, h in enumerate(headers):
        pdf.cell(widths[i], 6, h, border=1, fill=True)
    pdf.ln()
    pdf.set_font("Sans", size=8)
    for row in rows:
        # measure height
        heights = []
        for i, cell in enumerate(row):
            lines = pdf.multi_cell(widths[i], 4.2, cell, dry_run=True, output="LINES", new_x="RIGHT", new_y="TOP")
            heights.append(max(1, len(lines)) * 4.2)
        h = max(heights)
        if pdf.get_y() + h > pdf.h - 16:
            pdf.add_page()
            pdf.set_font("Sans", "B", 8)
            pdf.set_fill_color(230, 230, 230)
            for i, head in enumerate(headers):
                pdf.cell(widths[i], 6, head, border=1, fill=True)
            pdf.ln()
            pdf.set_font("Sans", size=8)
        x0, y0 = pdf.get_x(), pdf.get_y()
        x = x0
        for i, cell in enumerate(row):
            pdf.set_xy(x, y0)
            pdf.rect(x, y0, widths[i], h)
            pdf.multi_cell(widths[i], 4.2, cell, new_x="RIGHT", new_y="TOP")
            x += widths[i]
        pdf.set_xy(x0, y0 + h)


def main():
    pdf = Doc(format="Letter")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_font("Sans", "", SANS)
    pdf.add_font("Sans", "B", SANSB)
    pdf.add_font("Mono", "", MONO)
    pdf.add_page()

    pdf.set_font("Sans", "B", 16)
    pdf.multi_cell(0, 8, "Compass 0DTE scanner", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Sans", size=10)
    pdf.set_text_color(60, 60, 60)
    pdf.multi_cell(0, 5, "The corrected specification, as sent, with the listing facts checked. Paper only. Not a validated edge.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    h1(pdf, "Fact check")
    p(pdf, "The spec says: \"SPX, NDX, RUT and VIX have no same-day contracts on their expiry date, so they never qualify.\" That sentence is wrong for SPX, NDX, and RUT. It is right only for VIX, and only because VIX does not expire every day.")
    bullet(pdf, "SPX has 0DTE every session day. The contract is SPXW. It is PM-settled, cash-settled, and European. It trades on expiration day and stops at 16:00 ET. Cboe's 2026 calendar lists SPX and XSP Weeklys as expiring every business day. The old AM-settled monthly SPX is a different series. It stops the day before its own expiration. That is not \"SPX has no 0DTE.\"")
    bullet(pdf, "XSP has the same daily cycle, at one-tenth the notional.")
    bullet(pdf, "NDX has 0DTE every session day via NDXP, the PM-settled Nasdaq-100 series, Monday through Friday. Standard NDX is the third-Friday AM series. \"NDXP is not entitled\" is a feed claim, not a listing fact. The indices product named in this project includes SPX, VIX, and RUT. It does not name NDX.")
    bullet(pdf, "RUT has 0DTE every session day via RUTW. Standard RUT is the AM-settled monthly.")
    bullet(pdf, "VIX does not have a daily 0DTE. VIX and VIXW expire on Wednesday, moved to the prior business day if that Wednesday is a holiday. They are AM-settled. The last trading day is the day before the settlement value is calculated. A Monday VIX contract is not 0DTE, and the expiring Wednesday contract is not still trading that morning.")
    note(pdf, "Checked against the Cboe 2026 options expiration calendar and the Cboe hours page. SPX 0DTE in the market is the SPXW series. Underlying for the feature math stays SPX for SPXW, RUT for RUTW, and XSP for XSP.")

    h1(pdf, "1. Universe and schedule")
    rows = [
        ["Universe", "Exactly the 458 tickers in config/universe_458.json. If the list differs, fail validation. Do not add, remove, substitute, or deduplicate."],
        ["Universe hash", "sha256 of the ordered list: eb0ed706ae8dd5d5442a99d012db5077e6f9ba1ad0ef10a551af36b87840ef7e"],
        ["Options", "Same-day expiration only. SPXW, NDXP, RUTW, and XSP qualify on the day they expire. The AM-settled monthly roots do not trade on their own expiry morning. VIX does not qualify as a daily 0DTE."],
        ["Strikes", "ATM, nearest to spot, plus or minus 4 strikes. Calls and puts."],
        ["Timezone", "America/New_York"],
        ["Scan times", "09:45, 09:50, through 15:00 ET, every 5 minutes, inclusive. Internally t = minutes after 09:30, t in {15, 20, ..., 330}."],
        ["Forced exit", "15:55 ET, at the bid."],
        ["Open positions", "5 maximum."],
        ["Entries", "At most 1 per ticker per day."],
        ["Size", "1 contract."],
        ["Mode", "Paper only. Do not route live orders. Do not represent the strategy as validated."],
    ]
    table(pdf, ["Item", "Value"], rows, [32, 154])
    pdf.ln(2)
    p(pdf, "Underlying used for the price: SPXW uses SPX. RUTW uses RUT. XSP uses XSP. NDXP uses NDX, and NDX is not on the indices product named in this project.")

    h1(pdf, "2. Entry eligibility")
    p(pdf, "Evaluated on the quote stamped at scan time t. All of these must pass. Never use the last trade, a theoretical price, or the midpoint as a fill.")
    bullet(pdf, "bid > $0.15")
    bullet(pdf, "bid >= 0, ask > 0, ask >= bid, and the quote is timestamped at t. Not stale.")
    bullet(pdf, "midpoint = (bid + ask) / 2")
    bullet(pdf, "spread_pct = (ask - bid) / midpoint, and that fraction is <= 0.08. This is a fraction, not a percent. Feature 33 uses the same definition.")
    bullet(pdf, "Same-day expiration. Strike within ATM plus or minus 4.")
    bullet(pdf, "Ticker not yet entered today. Fewer than 5 positions open.")

    h1(pdf, "3. Models and thresholds")
    p(pdf, "Two LightGBM binary models, 300 trees each, 56 features, Column_0 through Column_55. Do not merge them. Do not retrain. Do not change the thresholds.")
    table(
        pdf,
        ["File", "sha256", "Output", "Enter when"],
        [
            ["model_entry_all6months.txt", "94592d667860d271e85e24dc9f8e82252b71d393c97cb019af871bd3782bdb8d", "p1 = P(TP1)", "p1 >= 0.7067"],
            ["model_runner_all6months.txt", "8a41876361259eec2c525b1977f703ddb0944bd2c39784fe3484959b1037302c", "prun = P(runner)", "runner if prun >= 0.50"],
        ],
        [52, 78, 28, 28],
    )
    pdf.ln(2)
    bullet(pdf, "Load each with lightgbm.Booster(model_file=...).")
    bullet(pdf, "Pass inputs as float32 in the column order below. A missing value is NaN, never 0.")
    bullet(pdf, "Picker: at each scan, for each ticker, take the eligible contract with the highest p1. If slots are scarce, fill them in descending p1.")
    bullet(pdf, "These files saw all 6 months. They are for forward paper use only. To reproduce the historical backtest, rerun the walk-forward. Do not backtest with these files.")
    p(pdf, "Notation. S is the underlying at t: for stocks and ETFs, the close of the 1-minute bar ending at t; for indexes, the index print at t. op is the open: for stocks, the 09:30 bar open; for indexes, the first valid print from 09:30 to 09:35. H and L are the session high and low of the 1-minute bars closed by t. dir is +1 for a call and -1 for a put. r = 0.042. T = (390 - t) / (390 x 252) + 1e-6. IV is solved by bisection on [0.01, 8.0] from the contract mid, 60 iterations. If IV <= 0.011 or there is no solution, iv is NaN and the Greeks use atm_iv, or 0.30 if atm_iv is missing.")

    h2(pdf, "Features, in order")
    feats = [
        ["0", "t", "Minutes after 09:30."],
        ["1", "ret_open", "S/op - 1"],
        ["2", "ret_5", "S/S(t-5) - 1"],
        ["3", "ret_15", "S/S(t-15) - 1"],
        ["4", "ret_60", "S/S(t-60) - 1"],
        ["5", "pos_range", "(S - L)/(H - L). NaN if H = L."],
        ["6", "range_open", "(H - L)/op"],
        ["7", "rv30", "Standard deviation of 1-minute log returns, t-30 through t. Needs at least 10 values, else NaN."],
        ["8", "rv_ratio", "rv30 divided by the same measure over t-60 through t-30."],
        ["9", "compress", "Stocks: mean(high-low) of the last 5 bars divided by the mean of the last 60. Indexes: standard deviation of the last 5 price changes divided by the standard deviation of the last 60."],
        ["10", "or_state", "t >= 30: +1 if S > ORH, -1 if S < ORL, else 0. ORH and ORL are the high and low of 09:30-09:59. NaN if t < 30."],
        ["11", "or_dist", "t >= 30: (S - ORH)/op if above, (S - ORL)/op if below, else 0."],
        ["12", "pdh_dist", "S / prior-day high - 1"],
        ["13", "pdl_dist", "S / prior-day low - 1"],
        ["14", "gap", "op / prior-day close - 1"],
        ["15", "minutes_left", "390 - t"],
        ["16", "vwap_z", "Stocks: (S - VWAP) / standard deviation of (close - VWAP) since the open. Indexes: NaN."],
        ["17", "rvol", "Cumulative volume to t divided by the median cumulative volume at minute t over the prior 20 sessions. Needs at least 5 sessions. Indexes: NaN."],
        ["18", "rvol5", "The same, for the last 5 minutes of volume."],
        ["19", "spy_ret_5", "SPY 5-minute return at t."],
        ["20", "spy_ret_15", "SPY 15-minute return."],
        ["21", "spy_ret_open", "SPY return since its open."],
        ["22", "sec_ret_15", "Sector ETF 15-minute return. NaN if the name has no sector below."],
        ["23", "sec_ret_open", "Sector ETF return since the open."],
        ["24", "atm_iv", "Mean IV of the ATM call and ATM put mids at t."],
        ["25", "iv_skew", "ATM put IV minus ATM call IV."],
        ["26", "iv_rv", "atm_iv / (rv30 x square root of (390 x 252))"],
        ["27", "net_gex_bn", "Sum over strikes and rights of OI x Black-Scholes gamma(atm_iv) x S squared x 0.01 x (+1 call / -1 put), divided by 1e9. Same-day OI. Core tickers only, otherwise NaN."],
        ["28", "call_wall_dist", "(Strike of the largest call OI at or above S) / S - 1. Core only."],
        ["29", "put_wall_dist", "(Strike of the largest put OI at or below S) / S - 1. Core only."],
        ["30", "otm_pct", "Calls: K/S - 1. Puts: 1 - K/S."],
        ["31", "dir", "+1 call, -1 put."],
        ["32", "mid", "Contract mid at t."],
        ["33", "spread_pct", "(ask - bid) / mid at t. A fraction, not a percent."],
        ["34", "opt_ret_5", "mid(t) / mid(t-5) - 1"],
        ["35", "opt_ret_15", "mid(t) / mid(t-15) - 1"],
        ["36", "iv", "Contract IV, by the bisection rule above."],
        ["37", "delta", "Black-Scholes delta."],
        ["38", "gamma", "Black-Scholes gamma."],
        ["39", "theta", "Black-Scholes theta per calendar day, the /365 convention in bs()."],
        ["40", "vega", "Black-Scholes vega per 1 vol point (divided by 100)."],
        ["41", "gamma_theta", "The paste cuts this definition at \"gamma/\". Do not guess the rest. Match states.py."],
        ["42", "theta_pct", "theta / mid"],
        ["43", "oi", "Contract open interest. Core only, else NaN."],
        ["44", "cls_index", "1 for SPXW, SPX, NDXP, NDX, XSP, RUTW, RUT, SPY, QQQ, IWM, DIA, VOO, RSP. Else 0."],
        ["45", "cls_highbeta", "1 for AFRM, AGQ, AMC, BITX, BOIL, CLSK, COIN, CVNA, DJT, FAS, GME, HOOD, IREN, JNUG, KOLD, LABU, MARA, MSTR, NUGT, NVDA, NVDL, PLTR, RIOT, SMCI, SOXL, SOXS, SPXL, SPXS, SPXU, SQQQ, SVIX, SVXY, TNA, TQQQ, TSLA, TSLL, TZA, UPRO, UPST, UVIX, UVXY, VXX, YINN. Else 0."],
        ["46", "a_ret_open", "ret_open x dir"],
        ["47", "a_ret_5", "ret_5 x dir"],
        ["48", "a_ret_15", "ret_15 x dir"],
        ["49", "a_ret_60", "ret_60 x dir"],
        ["50", "a_vwap_z", "vwap_z x dir"],
        ["51", "a_or_dist", "or_dist x dir"],
        ["52", "a_spy_ret_15", "spy_ret_15 x dir"],
        ["53", "a_sec_ret_15", "sec_ret_15 x dir"],
        ["54", "a_pdh_dist", "pdh_dist x dir"],
        ["55", "a_pdl_dist", "pdl_dist x dir"],
    ]
    table(pdf, ["Col", "Name", "Definition"], feats, [12, 32, 142])
    pdf.ln(2)

    h2(pdf, "Sector ETFs")
    sectors = [
        ["SMH", "NVDA, AMD, AVGO, MU, TSM, ASML, AMAT, LRCX, KLAC, MRVL, QCOM, INTC, SMCI, ARM, ON, NXPI, ADI, TXN, SWKS, WOLF, COHR, STX, WDC, NTAP, SOXL, SOXS, NVDL"],
        ["BITO", "COIN, MSTR, MARA, RIOT, CLSK, IREN, HUT, CIFR, WULF, CORZ, BITX, HOOD"],
        ["XLE", "XOM, CVX, OXY, COP, DVN, EOG, APA, HAL, SLB, MPC, PSX, VLO, FANG, EQT, AR, BTU, OIH, XOP, USO, UCO"],
        ["GDX", "NEM, GOLD, AEM, WPM, PAAS, AG, GDXJ, NUGT, JNUG, SLV, GLD, AGQ"],
        ["XLF", "JPM, BAC, C, WFC, GS, MS, SCHW, AXP, COF, USB, TFC, KRE, FAS, DPST, ALLY, BLK, BX, KKR, APO"],
    ]
    table(pdf, ["ETF", "Names"], sectors, [18, 168])
    pdf.ln(2)
    p(pdf, "Core tickers with open-interest features. Everyone else is NaN on those columns: SPXW, NVDA, SPY, QQQ, NDXP, IWM, TSLA, META, XSP, AVGO, MSFT, AAPL, TLT, RUTW, AMZN, SLV, GOOGL, GLD, SMH, XLF.")
    p(pdf, "The reference implementation is code/states.py. Match it for numerical parity before enabling signals. Feature parity is within 1e-6 on known historical rows.")

    h1(pdf, "4. Entry execution")
    bullet(pdf, "Signal at t. Fill at the ask of the quote stamped t+1 minute.")
    bullet(pdf, "That quote must be valid: bid >= 0, ask > 0, ask >= bid. Otherwise the entry is UNAVAILABLE. Do not substitute a price.")
    bullet(pdf, "The backtest did not re-check the 8% spread at t+1. If that check is added, flag it as a deviation.")
    bullet(pdf, "Record signal-time and fill-time bid, ask, and mid.")
    bullet(pdf, "Fees: the Robinhood schedule.")
    bullet(pdf, "Nothing after t may enter the features.")

    h1(pdf, "5. Exit rules")
    p(pdf, "A is the entry ask that filled. b is the bid each minute. peak is the highest bid since entry. Stops never move down.")
    exits = [
        ["Hard stop", "stop = A x (1 - 0.5322), which is -53.22%."],
        ["Time-velocity", "If minutes since fill >= 55, and peak < 1.15 x A, and no milestone yet, sell at the bid."],
        ["Breakeven lock", "When peak >= 1.25 x A, stop = max(stop, A)."],
        ["TP1, +50%", "Non-runner: resting limit at 1.50 x A. Fills at 1.50 x A when b >= 1.50 x A. Runner (prun >= 0.50): milestone only, and stop = max(stop, 1.25 x A)."],
        ["TP2, +100%", "When b >= 2.00 x A, stop = max(stop, 1.50 x A)."],
        ["TP3, +200%", "When b >= 3.00 x A, stop = max(stop, 2.25 x A)."],
        ["TP4 trail", "If TP3 has been reached and b >= 4.00 x A, stop = max(stop, 0.75 x peak). That is 25% under the peak."],
        ["End of day", "Sell at the 15:55 bid."],
    ]
    table(pdf, ["Rule", "Parameter"], exits, [32, 154])
    pdf.ln(2)
    p(pdf, "Each minute, in this order: stop check, then the time-velocity exit, then the breakeven lock, then TP1, then TP2, TP3, and TP4. If b <= stop, sell at that bid. Stops and the time exit fill at the observed bid, or the next valid bid if that one is delayed. The non-runner TP1 is a limit, filled at its price.")
    p(pdf, "One contract, so there are no partial exits. A runner holds the single contract. The milestones only ratchet the stop. Show this rule in the trade details.")

    h1(pdf, "6. What the live page has to show")
    bullet(pdf, "Scanner status and feed health.")
    bullet(pdf, "Every candidate, with eligibility and the rejection reason.")
    bullet(pdf, "p1, prun, and the thresholds.")
    bullet(pdf, "Signal-time and fill quotes. The live bid and the P&L.")
    bullet(pdf, "Peak and the time of the peak. The active stop. Milestones with timestamps.")
    bullet(pdf, "The exit trigger, the price, the fees, the realized P&L, and the holding time.")
    bullet(pdf, "Peak gain, the protected stop level, and realized gain are three different numbers.")
    p(pdf, "The later writeup of the same spec also asks for market status and the next scan, quote timestamps, stale and missing flags, the option symbol, call or put, strike, expiration, time left, model version, current unrealized P&L in dollars and percent, and a full event history from signal to fill to exit.")

    h1(pdf, "7. Audit, before it is turned on")
    bullet(pdf, "Universe sha256 matches.")
    bullet(pdf, "Both model sha256 values match. Two models, not one merged file.")
    bullet(pdf, "Features match states.py within 1e-6. Predictions match.")
    bullet(pdf, "No t+1 data in the features. The original leak was the t+1 ask.")
    bullet(pdf, "Fills and exits are timestamped. The exit order is the one above. The one-contract runner rule holds.")
    bullet(pdf, "Logs use OBSERVED, CALCULATED, MODELED, and UNAVAILABLE. All Greeks are MODELED, Black-Scholes from the mid.")
    bullet(pdf, "Forward test: about 60 frozen paper sessions. No tuning on those sessions.")
    p(pdf, "Historical reference, from the walk-forward models, not from these two files. July 24 to October 23, out of sample: 338 trades, 61.2% wins, +53.8% per trade, profit factor 7.84, max drawdown -$1,749 on 1 contract. Reverse-time check, April through June: 257 trades, +40.0% per trade, profit factor 5.5. About 56% of trades are at 09:45, so those get audited first. One minute of delay did not degrade the results.")
    note(pdf, "The page states RESEARCH / PAPER ONLY. EDGE NOT YET VERIFIED. Do not claim a verified win rate. Do not promote the backtest as an expected future return.")

    h1(pdf, "Where the second copy of the spec disagrees")
    p(pdf, "The same paste repeats the spec in a second writeup. Where they conflict, the corrected copy above is the one that matches the feature table.")
    bullet(pdf, "Spread. The second copy writes spread_pct = (ask - bid) / midpoint x 100. Feature 33 and the corrected entry rule keep it as a fraction, <= 0.08.")
    bullet(pdf, "Models. The second copy says one file, final markup.txt, with 600 trees. The corrected spec says two files, 300 trees each, with the two hashes above. The model header pasted with the spec is model_entry_all6months.txt, binary sigmoid, max_feature_idx=55, version v4.")
    bullet(pdf, "Hard stop. The second copy rounds it to -53.2%. The corrected rule is A x (1 - 0.5322), which is -53.22%.")
    bullet(pdf, "The second copy's exit table is the same ladder in words: time exit if +15% has not been reached in 55 minutes, breakeven after +25%, TP1 +50% with a +25% stop for a runner, TP2 +100% then a +50% stop, TP3 +200% then a +125% stop, and past +300% a stop 25% under the peak. 15:55 is the same close.")

    h1(pdf, "Model header that was pasted")
    p(pdf, "The tree bodies are the model file. They are not restated here. The header that came with them:")
    header = [
        "version=v4",
        "num_class=1",
        "num_tree_per_iteration=1",
        "label_index=0",
        "max_feature_idx=55",
        "objective=binary sigmoid:1",
        "feature_names=Column_0 through Column_55",
        "Tree 0 shrinkage=1. Later trees in the paste use shrinkage=0.05.",
        "num_leaves=31 on the trees that were included.",
    ]
    pdf.set_font("Mono", size=8)
    for line in header:
        pdf.multi_cell(0, 4.2, line, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("Sans", size=9)
    p(pdf, "Training ranges on the 56 columns, as feature_infos in that header, low to high:")
    ranges = [
        ["0 t", "15 to 330"],
        ["1 ret_open", "-0.17568947374820709 to 0.22265625"],
        ["2 ret_5", "-0.034657210111618042 to 0.036940664052963257"],
        ["3 ret_15", "-0.0568113774061203 to 0.079866744577884674"],
        ["4 ret_60", "-0.19724284112453461 to 0.19463337957859039"],
        ["5 pos_range", "-4.4935507815787104e-14 to 1"],
        ["6 range_open", "0.00032310179085470736 to 0.2578125"],
        ["7 rv30", "1.6275878806482069e-05 to 0.012304282747209072"],
        ["8 rv_ratio", "0.12808504700660706 to 11.914429664611816"],
        ["9 compress", "0 to 5.9171595573425293"],
        ["10 or_state", "-1 to 1"],
        ["11 or_dist", "-0.094994895160198212 to 0.18359375"],
        ["12 pdh_dist", "-0.74765902757644653 to 1.4906948804855347"],
        ["13 pdl_dist", "-0.74073201417922974 to 1.6120026111602783"],
        ["14 gap", "-0.75240468978881836 to 1.1018474102020264"],
        ["15 minutes_left", "60 to 375"],
        ["16 vwap_z", "-5.8519186973571777 to 4.5161972045898438"],
        ["17 rvol", "0.028957366943359375 to 64.002700805664062"],
        ["18 rvol5", "0 to 64.765907287597656"],
        ["19 spy_ret_5", "-0.0076112216338515282 to 0.0088903885334730148"],
        ["20 spy_ret_15", "-0.0088538769632577896 to 0.011780350469052792"],
        ["21 spy_ret_open", "-0.027293143793940544 to 0.015907865017652512"],
        ["22 sec_ret_15", "-0.027962787076830864 to 0.025922542437911034"],
        ["23 sec_ret_open", "-0.061935815960168839 to 0.040038131177425385"],
        ["24 atm_iv", "0.010567907243967056 to 8"],
        ["25 iv_skew", "-5.9805655479431152 to 6.8921160697937012"],
        ["26 iv_rv", "0.15899965167045593 to 85.463188171386719"],
        ["27 net_gex_bn", "-0.46947285532951355 to 0.79200863838195801"],
        ["28 call_wall_dist", "0 to 1.7410534620285034"],
        ["29 put_wall_dist", "-0.9913516640663147 to 0"],
        ["30 otm_pct", "-4.041593074798584 to 0.079286009073257446"],
        ["31 dir", "-1 to 1"],
        ["32 mid", "0.16500000655651093 to 97.550003051757812"],
        ["33 spread_pct", "0 to 0.079999998211860657"],
        ["34 opt_ret_5", "-0.70890408754348755 to 18.827587127685547"],
        ["35 opt_ret_15", "-0.87537091970443726 to 244.5"],
        ["36 iv", "0.019584208726882935 to 8"],
        ["37 delta", "-1 to 1"],
        ["38 gamma", "0 to 1.6291899681091309"],
        ["39 theta", "-35.739292144775391 to 0.78050732612609863"],
        ["40 vega", "0 to 1.919594407081604"],
        ["41 gamma_theta", "0 to 2634.567138671875"],
        ["42 theta_pct", "-11.902731895446777 to 0.040969289839267731"],
        ["43 oi", "0 to 136750"],
        ["44 cls_index", "0 to 1"],
        ["45 cls_highbeta", "0 to 1"],
        ["46 a_ret_open", "-0.20250000059604645 to 0.22265625"],
        ["47 a_ret_5", "-0.035351227968931198 to 0.036940664052963257"],
        ["48 a_ret_15", "-0.079866744577884674 to 0.079866744577884674"],
        ["49 a_ret_60", "-0.16988953948020935 to 0.19724284112453461"],
        ["50 a_vwap_z", "-5.8519186973571777 to 5.5033349990844727"],
        ["51 a_or_dist", "-0.16343750059604645 to 0.18359375"],
        ["52 a_spy_ret_15", "-0.011780350469052792 to 0.011780350469052792"],
        ["53 a_sec_ret_15", "-0.027962787076830864 to 0.027962787076830864"],
        ["54 a_pdh_dist", "-1.4906948804855347 to 1.4906948804855347"],
        ["55 a_pdl_dist", "-1.6120026111602783 to 1.6120026111602783"],
    ]
    table(pdf, ["Column", "Training range in the model header"], ranges, [36, 150])

    pdf.output(OUT)


if __name__ == "__main__":
    main()
