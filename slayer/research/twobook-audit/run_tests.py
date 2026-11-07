"""Audit test suite against an engine module R (default ref60). Each test returns a list of failure strings.

  python3 run_tests.py            -> runs everything on ref60
Used by mutation_check.py on mutated copies.
"""
from __future__ import annotations

import math
import sys

import mpmath as mp

import fd_check
import golden
import ref60


def _rel(a, b):
    a, b = mp.mpf(a), mp.mpf(b)
    return abs(a - b) / max(abs(b), mp.mpf("1e-300"))


def test1_scaling(R):
    B = R.MP
    f = []
    for S in (37.5, 100, 752.1, 7566.48):
        g = R.greeks(B, S, S * 1.02, 0.3, 0.1, 0.045, 0.032, "C")
        e = R.exposures(B, g, 1, 100, S)
        if _rel(e["GEX"], g["gamma"] * 100 * mp.mpf(S) ** 2 * mp.mpf("0.01")) > 1e-50:
            f.append(f"T1 GEX S={S}")
        if _rel(e["DEX"], g["delta"] * 100 * mp.mpf(S)) > 1e-50:
            f.append(f"T1 DEX S={S}")
    return f


def _dealer_C(R, right, price, bid=1.0, ask=1.1, size=10):
    bucket, c = R.classify({"condition": 18, "size": size, "price": price, "bid": bid, "ask": ask,
                            "trade_ts_ms": 1000, "quote_ts_ms": 900})
    return c


def test2_signs(R):
    B = R.MP
    f = []
    S = 100
    gp = R.greeks(B, S, 100, 0.25, 0.1, 0.045, 0.032, "P")
    e = R.exposures(B, gp, -1, 100, S)
    if not (e["GEX"] < 0 and e["DEX"] > 0):
        f.append("T2 short put GEX<0 DEX>0")
    gc = R.greeks(B, S, 100, 0.25, 0.1, 0.045, 0.032, "C")
    C = _dealer_C(R, "C", 1.1)
    if not (C < 0 and R.exposures(B, gc, C, 100, S)["GEX"] < 0):
        f.append("T2 customer buys call at ask -> C<0, GEX<0")
    C = _dealer_C(R, "C", 1.0)
    if not (R.exposures(B, gc, C, 100, S)["GEX"] > 0):
        f.append("T2 customer sells call at bid -> GEX>0")
    C = _dealer_C(R, "P", 1.1)
    if not (R.exposures(B, gp, C, 100, S)["GEX"] < 0):
        f.append("T2 customer buys put at ask -> GEX<0")
    return f


def test3_fd(R, B=None):
    stats, fails = fd_check.run(R, B or R.F64, verbose=False)
    return [f"T3 {k}: {v['failed']} failed" for k, v in stats.items() if v["failed"]]


def test5_model2(R):
    B = R.MP
    f = []
    # every classifier row reachable
    rows = {"CANCEL", "EXCLUDED_EXT_HOURS", "EXCLUDED_COMPLEX", "EXCLUDED_CROSS", "EXCLUDED_INVALID", "BUY", "SELL",
            "EXCLUDED_LATE", "EXCLUDED_NO_QUOTE", "EXCLUDED_LOCKED_CROSSED", "EXCLUDED_STALE_QUOTE", "MID"}
    seen = set()
    base = dict(condition=18, size=10, price=1.05, bid=1.0, ask=1.1, trade_ts_ms=5000, quote_ts_ms=4500)
    for kw in (dict(condition=40), dict(condition=1), dict(condition=35), dict(condition=45), dict(size=0),
               dict(condition=145), dict(condition=146), dict(condition=2), dict(bid=float("nan")), dict(bid=1.1),
               dict(quote_ts_ms=0), dict(price=1.1), dict(price=1.0), dict()):
        seen.add(R.classify({**base, **kw})[0])
    if seen != rows:
        f.append(f"T5 classifier rows {sorted(rows - seen)}")
    # linear in C, zero at C=0, change with S, sigma, T
    args = (100.0, 103.0, 0.3, 0.05, 0.045, 0.032, "C")
    g = R.greeks(B, *args)
    e1, e3, e0 = (R.exposures(B, g, c, 100, 100.0) for c in (1, 3, 0))
    for k in R.EXPOSURE_NAMES:
        if _rel(e3[k], 3 * e1[k]) > 1e-45 or e0[k] != 0:
            f.append(f"T5 linear/zero {k}")
    for i, bump in ((0, 1.01), (2, 1.05), (3, 1.1)):
        a2 = list(args)
        a2[i] *= bump
        S2 = a2[0]
        e2 = R.exposures(B, R.greeks(B, *a2), 1, 100, S2)
        for k in R.EXPOSURE_NAMES:
            if e2[k] == e1[k]:
                f.append(f"T5 {k} unchanged under bump {i}")
    # GEX(S(1+eps)) - GEX ~ eps/0.01 * total_gex_change_1pct
    tot = R.total_gex_change_1pct(B, g, 1, 100, 100.0)
    tot2 = R.total_gex_change_1pct_closed(B, g, 1, 100, 100.0, 0.3, 0.05)
    if _rel(tot, tot2) > 1e-45:
        f.append("T5 total_gex closed form")
    eps = mp.mpf("1e-8")
    Sx = mp.mpf(100) * (1 + eps)
    gx = R.greeks(B, Sx, *args[1:])
    dG = (R.exposures(B, gx, 1, 100, Sx)["GEX"] - e1["GEX"]) / eps * mp.mpf("0.01")
    if _rel(dG, tot) > 1e-6:
        f.append(f"T5 GEX after +1% vs total_gex_change_1pct rel {mp.nstr(_rel(dG, tot), 3)}")
    # hedge signs
    h = R.hedge(B, g, 1, 100, 100.0)
    if not (h["hedge_dollars"] == -e1["DEX"] and h["hedge_units"] == -g["delta"] * 100):
        f.append("T5 hedge")
    return f


def test6_golden(R, B=None):
    res = golden.score(R, B or R.MP)
    return [f"T6 {g}: {v['fail']} fail e.g. {v['fails'][:2]}" for g, v in res.items() if v["fail"]]


def test7_identities(R):
    B = R.MP
    f = []
    import random
    rng = random.Random(3)
    for _ in range(300):
        S = rng.choice([37.5, 100, 752.1, 7566.48])
        K = S * rng.uniform(0.6, 1.6)
        sig, T = rng.uniform(0.05, 1.5), 10 ** rng.uniform(-4.5, 0.5)
        r, b = rng.uniform(-0.01, 0.06), rng.uniform(-0.03, 0.06)
        c = R.greeks(B, S, K, sig, T, r, b, "C")
        p = R.greeks(B, S, K, sig, T, r, b, "P")
        ec = mp.exp((mp.mpf(b) - mp.mpf(r)) * mp.mpf(T))
        sc = 1 + abs(ec)
        if abs(c["delta"] - p["delta"] - ec) > 1e-50 * sc:
            f.append("T7 delta parity")
        for k in ("gamma", "vega", "vanna", "vomma", "speed", "zomma", "color_T", "veta_T"):
            if abs(c[k] - p[k]) > mp.mpf("1e-45") * (1 + abs(c[k])):
                f.append(f"T7 call=put {k}")
        if abs((c["charm"] - p["charm"]) + (mp.mpf(b) - mp.mpf(r)) * ec) > 1e-45 * sc:
            f.append("T7 charm parity")
        vs = mp.mpf(sig) * mp.sqrt(T)
        lhs = c["speed"] * mp.mpf(S) + 2 * c["gamma"]
        rhs = c["gamma"] * (1 - c["d1"] / vs)
        if abs(lhs - rhs) > mp.mpf("1e-40") * (abs(rhs) + abs(c["gamma"])) + mp.mpf("1e-300"):
            f.append("T7 speed identity")
    # v1 regression at r = b = 0
    for (S, K, sig, T) in ((100, 95, 0.2, 0.1), (752.1, 760, 0.15, 0.003), (7566.48, 7500, 0.4, 1.5)):
        g = R.greeks(B, S, K, sig, T, 0, 0, "C")
        sq = mp.sqrt(T)
        ph = R.phi(B, g["d1"])
        exp_ = {"charm": ph * g["d2"] / (2 * T),
                "color_T": -ph * (1 - g["d1"] * g["d2"]) / (2 * S * T * sig * sq),
                "veta_T": g["vega"] * (1 + g["d1"] * g["d2"]) / (2 * T)}
        for k, v in exp_.items():
            if _rel(g[k], v) > 1e-12:
                f.append(f"T7 v1 regression {k}")
    # IV round trip
    for (S, K, sig, T, r, b, right) in ((100, 100, 0.2, 0.25, 0.04, 0.03, "C"), (100, 120, 0.5, 1, 0, 0, "P"),
                                        (7566.48, 7600, 0.12, 1 / 365, 0.04, 0.0427, "C"), (37.5, 30, 0.8, 0.01, 0.02, -0.01, "P")):
        pr = R.price(B, S, K, sig, T, r, b, right)
        iv, why = R.implied_vol(B, pr, S, K, T, r, b, right)
        if iv is None or _rel(R.price(B, S, K, iv, T, r, b, right), pr) > 1e-8:
            f.append(f"T7 IV round trip {S},{K}")
    # parity forward recovers S e^{bT}
    for (S, r, b, T) in ((100.0, 0.05, 0.02, 0.5), (7566.48, 0.0395, 0.0427, 30 / 525600), (37.5, 0.0, -0.01, 2.0)):
        qs = []
        for kk in (0.97, 0.99, 1.0, 1.01, 1.03, 1.05, 1.2):
            K = S * kk
            c, p = R.price(B, S, K, 0.3, T, r, b, "C"), R.price(B, S, K, 0.3, T, r, b, "P")
            qs.append({"K": K, "cb": c - 1, "ca": c + 1, "pb": p - 1, "pa": p + 1})   # mp quotes, exact mids
        F = R.parity_forward(B, qs, S, r, T)
        if F is None or _rel(F, mp.mpf(S) * mp.exp(mp.mpf(b) * mp.mpf(T))) > 1e-12:
            f.append(f"T7 parity forward S={S}")
    # invalid inputs rejected
    for args in ((0, 100, 0.2, 1), (100, -1, 0.2, 1), (100, 100, 0, 1), (float("nan"), 100, 0.2, 1)):
        if R.contract_status(B, *args) != "UNAVAILABLE":
            f.append(f"T7 invalid accepted {args}")
    if R.contract_status(B, 100, 100, 0.2, 0) != "EXPIRED":
        f.append("T7 T=0 not EXPIRED")
    # unidentifiable IV rejected
    for q in ((0.0, 1.0), (1.0, 1.0), (1.2, 1.0)):
        if R.iv_from_quote(B, q[0], q[1], 100, 100, 0.1, 0, 0, "C", 0.05)[0] is not None:
            f.append(f"T7 unidentifiable accepted {q}")
    return f


def test_uw_consistency(R):
    """§3.3 fields built from engine Greeks with C = +OI / -OI, converted by §3.4, equal §4.4 (M = 100)."""
    B = R.MP
    f = []
    S, IV30 = 752.1, 0.172
    for K in (700, 752, 800):
        tot_uw = {k: mp.mpf(0) for k in ("call_gamma_oi", "put_gamma_oi", "call_delta_oi", "put_delta_oi",
                                         "call_vanna_oi", "put_vanna_oi", "call_charm_oi", "put_charm_oi")}
        slayer = {k: mp.mpf(0) for k in ("GEX", "DEX", "VANNA", "CHARM")}
        for right, OI in (("C", 1234), ("P", 4321)):
            g = R.greeks(B, S, K, 0.2, 0.08, 0, 0, right)
            fl = R.uw_fields_from_greeks(B, right, g["delta"], g["gamma"], g["vanna"], g["charm"], OI, S, IV30)
            p = "call_" if right == "C" else "put_"
            for k, v in fl.items():
                tot_uw[p + k] += v
            e = R.exposures(B, g, OI if right == "C" else -OI, 100, S)
            for k in slayer:
                slayer[k] += e[k]
        conv = R.uw_to_slayer(B, *(tot_uw[k] for k in ("call_gamma_oi", "put_gamma_oi", "call_delta_oi", "put_delta_oi",
                                                       "call_vanna_oi", "put_vanna_oi", "call_charm_oi", "put_charm_oi")),
                              S, IV30)
        for k in slayer:
            if _rel(conv[k], slayer[k]) > 1e-45:
                f.append(f"UW consistency {k} K={K}")
    return f


TESTS = {"T1": test1_scaling, "T2": test2_signs, "T3": test3_fd, "T5": test5_model2, "T6": test6_golden,
         "T7": test7_identities, "UW": test_uw_consistency}


def run_all(R=ref60, only=None, verbose=True):
    out = {}
    for name, fn in TESTS.items():
        if only and name not in only:
            continue
        try:
            fails = fn(R)
        except Exception as ex:      # noqa: BLE001
            fails = [f"{name} raised {type(ex).__name__}: {ex}"]
        out[name] = fails
        if verbose:
            print(f"{name}: {'PASS' if not fails else 'FAIL'} {fails[:4]}")
    return out


if __name__ == "__main__":
    res = run_all(ref60)
    sys.exit(1 if any(res.values()) else 0)
