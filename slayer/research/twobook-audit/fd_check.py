"""Test 3 (spec §7) exactly as written: 4th-order central differences, ONE level deep (the analytic
lower-order quantity is differentiated), steps h_S = 1e-3*S*sigma*sqrtT, h_sigma = 1e-3*sigma,
h_T = 1e-3*T, tolerance |analytic - fd| <= 2e-6*|fd| + 1e-9*ref, skip only when both |analytic|
and |fd| < 1e-12*ref, ref = max |greek| across strikes 0.6S-1.6S for that (sigma, T, r, b, right).

Grid (1,568 contracts): S = 100; K/S = 7 points 0.70..1.35; sigma in {8%, 25%, 60%, 150%};
T in {15 min, 1 h, 1 d, 7 d, 30 d, 1 y, 3 y}; (r, b) in {(0,0), (4.5%,4.5%), (4.5%,3.2%), (2%,-1%)};
calls and puts.  Run: python3 fd_check.py [mp|f64]
"""
import json
import sys

import ref60

S0 = 100.0
KS = [0.70 + i * (1.35 - 0.70) / 6 for i in range(7)]
SIGS = [0.08, 0.25, 0.60, 1.50]
TS = [15 / 525600, 60 / 525600, 1 / 365, 7 / 365, 30 / 365, 1.0, 3.0]
RB = [(0.0, 0.0), (0.045, 0.045), (0.045, 0.032), (0.02, -0.01)]
C_, M_ = 1, 100

# (name, analytic quantity, lower-order quantity, variable, sign)
GREEK_CHECKS = [
    ("delta", "delta", "price", "S", 1), ("vega", "vega", "price", "sig", 1),
    ("gamma", "gamma", "delta", "S", 1), ("vanna", "vanna", "delta", "sig", 1),
    ("vomma", "vomma", "vega", "sig", 1), ("speed", "speed", "gamma", "S", 1),
    ("zomma", "zomma", "gamma", "sig", 1), ("charm", "charm", "delta", "T", -1),
    ("color_T", "color_T", "gamma", "T", 1), ("veta_T", "veta_T", "vega", "T", 1),
]
# exposure level, calendar convention: target = sign * d(lower)/dvar * scale
EXPO_CHECKS = [
    ("CHARM", "CHARM", "DEX", "T", -1, "1/D"), ("COLOR", "COLOR", "GEX", "T", -1, "1/D"),
    ("VETA", "VETA", "VEGA", "T", -1, "1/D"), ("VANNA", "VANNA", "DEX", "sig", 1, "0.01"),
    ("VOMMA", "VOMMA", "VEGA", "sig", 1, "0.01"), ("ZOMMA", "ZOMMA", "GEX", "sig", 1, "0.01"),
    ("total_gex_change_1pct", "TOTAL", "GEX", "S", 1, "0.01S"),
]


def quantities(R, B, S, K, sig, T, r, b, right):
    g = R.greeks(B, S, K, sig, T, r, b, right)
    e = R.exposures(B, g, C_, M_, S)
    q = dict(g)
    q.update(e)
    q["TOTAL"] = R.total_gex_change_1pct(B, g, C_, M_, S)
    return q


def fd(R, B, lower, var, S, K, sig, T, r, b, right):
    x = {"S": B.f(S), "sig": B.f(sig), "T": B.f(T)}
    sqT = B.sqrt(B.f(T))
    h = {"S": B.f("1e-3") * B.f(S) * B.f(sig) * sqT, "sig": B.f("1e-3") * B.f(sig),
         "T": B.f("1e-3") * B.f(T)}[var]

    def f(k):
        y = dict(x)
        y[var] = x[var] + k * h
        return quantities(R, B, y["S"], K, y["sig"], y["T"], r, b, right)[lower]

    return (-f(2) + 8 * f(1) - 8 * f(-1) + f(-2)) / (12 * h)


def ref_strikes(B, sig, T, b):
    ks = {0.6 * S0 + i * S0 / 400 for i in range(401)}
    F = S0 * float(B.exp(B.f(b) * B.f(T)))
    w = sig * T ** 0.5
    import math
    for i in range(961):
        z = -12 + 24 * i / 960
        k = F * math.exp(z * w)
        if 0.6 * S0 <= k <= 1.6 * S0:
            ks.add(k)
    ks.update(S0 * k for k in KS)
    return sorted(ks)


def run(R=ref60, B=None, verbose=True, stop_after_fail=False):
    B = B or R.MP
    names = [c[0] for c in GREEK_CHECKS] + [c[0] for c in EXPO_CHECKS]
    stats = {n: {"checked": 0, "passed": 0, "failed": 0, "skipped": 0, "worst_ratio": 0.0} for n in names}
    fails = []
    for (r, b) in RB:
        for right in "CP":
            for sig in SIGS:
                for T in TS:
                    # ref per (sigma, T, r, b, right)
                    ref = {}
                    for K in ref_strikes(B, sig, T, b):
                        q = quantities(R, B, S0, K, sig, T, r, b, right)
                        for c in GREEK_CHECKS + EXPO_CHECKS:
                            v = abs(q[c[1]])
                            if v > ref.get(c[1], 0):
                                ref[c[1]] = v
                    for ks in KS:
                        K = S0 * ks
                        q = quantities(R, B, S0, K, sig, T, r, b, right)
                        for c in GREEK_CHECKS + EXPO_CHECKS:
                            name, ana, lower, var, sign = c[:5]
                            d = fd(R, B, lower, var, S0, K, sig, T, r, b, right)
                            if len(c) == 6:
                                scale = {"1/D": B.f(1) / R.D, "0.01": B.f("0.01"),
                                         "0.01S": B.f("0.01") * B.f(S0)}[c[5]]
                                d = d * scale
                            d = sign * d
                            a = q[ana]
                            rf = ref.get(ana, 0)
                            st = stats[name]
                            if abs(a) < B.f("1e-12") * rf and abs(d) < B.f("1e-12") * rf:
                                st["skipped"] += 1
                                continue
                            st["checked"] += 1
                            tol = B.f("2e-6") * abs(d) + B.f("1e-9") * rf
                            err = abs(a - d)
                            ratio = float(err / tol) if tol > 0 else (0.0 if err == 0 else float("inf"))
                            st["worst_ratio"] = max(st["worst_ratio"], ratio)
                            if err <= tol:
                                st["passed"] += 1
                            else:
                                st["failed"] += 1
                                fails.append({"check": name, "K": K, "sig": sig, "T": T, "r": r, "b": b,
                                              "right": right, "analytic": float(a), "fd": float(d),
                                              "ref": float(rf)})
                                if stop_after_fail:
                                    return stats, fails
    if verbose:
        for n in names:
            s = stats[n]
            print(f"{n:24s} checked {s['checked']:5d} passed {s['passed']:5d} failed {s['failed']:5d} "
                  f"skipped {s['skipped']:4d} worst err/tol {s['worst_ratio']:.3g}")
    return stats, fails


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "mp"
    B = ref60.MP if which == "mp" else ref60.F64
    stats, fails = run(ref60, B)
    with open(f"results_fd_{which}.json", "w") as f:
        json.dump({"backend": which, "contracts_per_check": len(KS) * len(SIGS) * len(TS) * len(RB) * 2,
                   "stats": stats, "failures": fails[:200]}, f, indent=1)
    print("total failures", len(fails))
