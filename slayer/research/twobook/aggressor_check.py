"""
Where do prints flagged 145 (BID_AGGRESSOR) and 146 (ASK_AGGRESSOR) sit against the NBBO in force?
Input: a ThetaData /option/history/trade_quote CSV (exclusive=true). Prints the position of each flagged print:
at/above the ask (customer bought), at/below the bid (customer sold), inside.

    python3 research/twobook/aggressor_check.py <trade_quote.csv>
"""

import csv
import sys
from collections import Counter

c = Counter()
n = 0
with open(sys.argv[1]) as fh:
    for row in csv.DictReader(fh):
        n += 1
        conds = {int(row[k]) for k in ("condition", "ext_condition1", "ext_condition2", "ext_condition3", "ext_condition4") if row.get(k) not in (None, "")}
        for code in (145, 146):
            if code not in conds:
                continue
            p, b, a = float(row["price"]), float(row["bid"]), float(row["ask"])
            side = "at/above ask" if p >= a else "at/below bid" if p <= b else "inside"
            c[(code, side)] += 1
            c[(code, "all")] += 1
            c[(code, "primary" if int(row["condition"]) == code else "extension")] += 1
print(f"{n} prints")
for code in (145, 146):
    tot = c[(code, "all")]
    print(code, tot, {s: c[(code, s)] for s in ("at/above ask", "at/below bid", "inside", "primary", "extension")})
