#!/bin/bash
# Appendix B inputs from the ThetaData terminal, one request at a time: SPXW 2026-11-02 0DTE prints 09:30-15:30 with the
# NBBO at each (exclusive), the quotes in force at 15:30 for the 0DTE and Nov-09 expiries, the index at 15:30, SOFR.
# Raw data stays under .cache (git-ignored).   bash research/twobook/appendixb_fetch.sh
set -u
out=.cache/tb/ab
mkdir -p "$out"
T=http://127.0.0.1:25503/v3
get() { # url file
  [ -s "$2" ] && { echo "have $2"; return; }
  curl -s -m 1800 "$1" -o "$2.part" && mv "$2.part" "$2" && echo "got $2 $(wc -c <"$2")"
}
for h in 09:30:00-10:29:59.999 10:30:00-11:29:59.999 11:30:00-12:29:59.999 12:30:00-13:29:59.999 13:30:00-14:29:59.999 14:30:00-15:29:59.999; do
  s=${h%-*}; e=${h#*-}
  get "$T/option/history/trade_quote?symbol=SPXW&expiration=20261102&date=20261102&start_time=$s&end_time=$e&exclusive=true&format=csv" "$out/tq_${s//:/}.csv"
done
for x in 20261102 20261103 20261104 20261105 20261106 20261109 20261110 20261116 20261120 20261130; do
  get "$T/option/at_time/quote?symbol=SPXW&expiration=$x&right=both&start_date=20261102&end_date=20261102&time_of_day=15:30:00.000&format=csv" "$out/q1530_$x.csv"
done
get "$T/option/at_time/quote?symbol=SPX&expiration=20261120&right=both&start_date=20261102&end_date=20261102&time_of_day=15:30:00.000&format=csv" "$out/q1530_SPX_20261120.csv"
get "$T/index/history/price?symbol=SPX&date=20261102&start_time=15:29:00&end_time=15:30:00.999&interval=1m&format=csv" "$out/spx_1530.csv"
get "$T/interest_rate/history/eod?symbol=SOFR&start_date=20261020&end_date=20261102&format=json" "$out/sofr.json"
get "$T/option/history/greeks/second_order?symbol=SPXW&expiration=20261109&date=20261102&interval=1m&start_time=15:30:00&end_time=15:30:00.999&format=csv" "$out/greeks2_20261109.csv"
get "$T/option/history/greeks/third_order?symbol=SPXW&expiration=20261109&date=20261102&interval=1m&start_time=15:30:00&end_time=15:30:00.999&format=csv" "$out/greeks3_20261109.csv"
get "$T/option/history/greeks/first_order?symbol=SPXW&expiration=20261109&date=20261102&interval=1m&start_time=15:30:00&end_time=15:30:00.999&format=csv" "$out/greeks1_20261109.csv"
echo done
