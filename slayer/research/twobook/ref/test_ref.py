"""
Tests 1, 2, 3, 5 and 7 of TWO_BOOK_SPEC_V2 §7 against the reference, the sympy derivation of the ten Greeks from §1.3,
and the mutation check (Test 6's list: every injected bug must fail).

    python3 research/twobook/ref/test_ref.py            all of it (about two minutes)
    python3 research/twobook/ref/test_ref.py --quick    a smaller Test 3 grid (CI-sized)

Plain script, no pytest: prints one line per test and a summary; exit 1 on any failure.
"""

from __future__ import annotations

import json
import os
import random
import sys
import time

import mpmath as mp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import slayer_ref as R  # noqa: E402

mpf = R.mpf
QUICK = "--quick" in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))


class Fail(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise Fail(msg)


def rel(a, b):
    a, b = mpf(a), mpf(b)
    return abs(a - b) / max(abs(b), mpf("1e-300"))


# ---- Test 1 — single-contract scaling ---------------------------------------------------------------------------

def test1():
    for S in (37.5, 100.0, 752.1, 7566.48):
        g = R.greeks(S, S * 1.02, 0.1, 0.22, 0.04, 0.03, "C")
        e = R.exposures(g, 1, 100, S)
        check(e["GEX"] == g["gamma"] * 100 * mpf(S) ** 2 * mpf("0.01"), f"GEX scaling at S={S}")
        check(e["DEX"] == g["delta"] * 100 * mpf(S), f"DEX scaling at S={S}")
    return "C=+1, M=100 at four spots: GEX and DEX exact"


# ---- Test 2 — signs ---------------------------------------------------------------------------------------------

def test2():
    S = 100.0
    gp = R.greeks(S, 95, 30 / 365, 0.25, 0.04, 0.04, "P")
    e = R.exposures(gp, -1, 100, S)  # short put
    check(e["GEX"] < 0 and e["DEX"] > 0, "short put: GEX < 0 and DEX > 0")
    gc = R.greeks(S, 105, 30 / 365, 0.25, 0.04, 0.04, "C")
    b, c = R.classify([18], 5, 1.25, 1.20, 1.25, 10)
    check(b == "BUY" and c < 0, "customer buys call at ask → C < 0")
    check(R.exposures(gc, c, 100, S)["GEX"] < 0, "… → GEX < 0")
    b, c = R.classify([18], 5, 1.20, 1.20, 1.25, 10)
    check(b == "SELL" and R.exposures(gc, c, 100, S)["GEX"] > 0, "customer sells call at bid → GEX > 0")
    b, c = R.classify([18], 5, 0.80, 0.75, 0.80, 10)
    check(b == "BUY" and R.exposures(gp, c, 100, S)["GEX"] < 0, "customer buys put at ask → GEX < 0")
    return "four sign rules"


# ---- Test 3 — finite differences --------------------------------------------------------------------------------

def fd(f, x, h):
    return (-f(x + 2 * h) + 8 * f(x + h) - 8 * f(x - h) + f(x - 2 * h)) / (12 * h)


RB = [(0.0, 0.0), (0.045, 0.045), (0.045, 0.032), (0.02, -0.01)]


def test3():
    S = mpf(100)
    if QUICK:
        KS, SIG, TS = [0.7, 1.0, 1.35], [0.08, 0.4, 1.5], [15 / 525600, 30 / 365, 3.0]
    else:
        KS = [0.70, 0.80, 0.90, 1.00, 1.10, 1.20, 1.35]
        SIG = [0.08, 0.15, 0.25, 0.40, 0.60, 1.00, 1.50]
        TS = [15 / 525600, 1 / 365, 30 / 365, 3.0]
    checks = 0
    skipped = 0
    worst = mpf(0)
    for sig in SIG:
        for T in TS:
            for r, b in RB:
                for right in ("C", "P"):
                    # ref = max |greek| across strikes 0.6S–1.6S
                    refs = {n: mpf(0) for n in R.GREEK_NAMES}
                    for i in range(41):
                        g = R.greeks(S, S * (mpf("0.6") + i * mpf("0.025")), T, sig, r, b, right)
                        for n in R.GREEK_NAMES:
                            refs[n] = max(refs[n], abs(g[n]))
                    for ks in KS:
                        K = S * mpf(ks)
                        sg, Tm = mpf(sig), mpf(T)
                        hS = mpf("1e-3") * S * sg * mp.sqrt(Tm)
                        hs = mpf("1e-3") * sg
                        hT = mpf("1e-3") * Tm
                        GS = lambda x: R.greeks(x, K, Tm, sg, r, b, right)
                        Gs = lambda x: R.greeks(S, K, Tm, x, r, b, right)
                        GT = lambda x: R.greeks(S, K, x, sg, r, b, right)
                        g0 = R.greeks(S, K, Tm, sg, r, b, right)
                        pairs = [
                            ("delta", fd(lambda x: R.price(x, K, Tm, sg, r, b, right), S, hS)),
                            ("vega", fd(lambda x: R.price(S, K, Tm, x, r, b, right), sg, hs)),
                            ("gamma", fd(lambda x: GS(x)["delta"], S, hS)),
                            ("vanna", fd(lambda x: Gs(x)["delta"], sg, hs)),
                            ("vomma", fd(lambda x: Gs(x)["vega"], sg, hs)),
                            ("speed", fd(lambda x: GS(x)["gamma"], S, hS)),
                            ("zomma", fd(lambda x: Gs(x)["gamma"], sg, hs)),
                            ("charm", -fd(lambda x: GT(x)["delta"], Tm, hT)),
                            ("colorT", fd(lambda x: GT(x)["gamma"], Tm, hT)),
                            ("vetaT", fd(lambda x: GT(x)["vega"], Tm, hT)),
                        ]
                        for name, v in pairs:
                            a = g0[name]
                            ref = refs[name]
                            if abs(a) < mpf("1e-12") * ref and abs(v) < mpf("1e-12") * ref:
                                skipped += 1
                                continue
                            tol = mpf("2e-6") * abs(v) + mpf("1e-9") * ref
                            err = abs(a - v)
                            check(err <= tol, f"Test 3 {name} {right} K/S={ks} σ={sig} T={T} r={r} b={b}: {a} vs fd {v}")
                            worst = max(worst, err / tol)
                            checks += 1
                        # exposure level, calendar convention (C = −3, M = 100)
                        C, M = -3, 100
                        E = lambda gg, s=S: R.exposures(gg, C, M, s)
                        e0 = E(g0)
                        Dm = R.D
                        exp_pairs = [
                            ("CHARM", -fd(lambda x: E(GT(x))["DEX"], Tm, hT) / Dm),
                            ("COLOR", -fd(lambda x: E(GT(x))["GEX"], Tm, hT) / Dm),
                            ("VETA", -fd(lambda x: E(GT(x))["VEGA"], Tm, hT) / Dm),
                            ("VANNA", fd(lambda x: E(Gs(x))["DEX"], sg, hs) * mpf("0.01")),
                            ("VOMMA", fd(lambda x: E(Gs(x))["VEGA"], sg, hs) * mpf("0.01")),
                            ("ZOMMA", fd(lambda x: E(Gs(x))["GEX"], sg, hs) * mpf("0.01")),
                            ("TGC", fd(lambda x: E(GS(x), x)["GEX"], S, hS) * mpf("0.01") * S),
                        ]
                        for name, v in exp_pairs:
                            a = R.total_gex_change_1pct(g0, C, M, S) if name == "TGC" else e0[name]
                            if abs(a) < mpf("1e-30") and abs(v) < mpf("1e-30"):
                                skipped += 1
                                continue
                            check(abs(a - v) <= mpf("2e-6") * abs(v) + mpf("1e-20"), f"Test 3 exposure {name} {right} K/S={ks} σ={sig} T={T}: {a} vs {v}")
                            checks += 1
    n_contracts = len(KS) * len(SIG) * len(TS) * len(RB) * 2
    return f"{n_contracts} contracts per Greek, {checks} checks, {skipped} numerically-zero skips, worst err/tol {mp.nstr(worst, 3)}"


# ---- Test 5 — Model 2 -------------------------------------------------------------------------------------------

CLASSIFY_CASES = [
    # (conditions, size, price, bid, ask, quote_age_ms, bucket, C)
    ([40], 5, 1.0, 0.9, 1.1, 10, "CANCEL", 0),
    ([44, 145], 5, 1.0, 0.9, 1.1, 10, "CANCEL", 0),
    ([1], 5, 1.0, 0.9, 1.1, 10, "EXCLUDED_EXT_HOURS", 0),
    ([148], 5, 1.1, 0.9, 1.1, 10, "EXCLUDED_EXT_HOURS", 0),
    ([35], 5, 1.1, 0.9, 1.1, 10, "EXCLUDED_COMPLEX", 0),
    ([137], 5, 1.1, 0.9, 1.1, 10, "EXCLUDED_COMPLEX", 0),
    ([147], 5, 1.1, 0.9, 1.1, 10, "EXCLUDED_COMPLEX", 0),
    ([45], 5, 1.1, 0.9, 1.1, 10, "EXCLUDED_CROSS", 0),
    ([128], 5, 1.1, 0.9, 1.1, 10, "EXCLUDED_CROSS", 0),
    ([18], 0, 1.1, 0.9, 1.1, 10, "EXCLUDED_INVALID", 0),
    ([18], 5, 0.0, 0.9, 1.1, 10, "EXCLUDED_INVALID", 0),
    ([18], 5, float("nan"), 0.9, 1.1, 10, "EXCLUDED_INVALID", 0),
    ([145], 7, 1.0, 0.9, 1.1, 5000, "BUY", -7),
    ([146], 7, 1.0, 0.9, 1.1, 5000, "SELL", 7),
    ([2], 5, 1.1, 0.9, 1.1, 10, "EXCLUDED_LATE", 0),
    ([18], 5, 1.1, float("nan"), 1.1, 10, "EXCLUDED_NO_QUOTE", 0),
    ([18], 5, 1.1, 0.9, 0.0, 10, "EXCLUDED_NO_QUOTE", 0),
    ([18], 5, 1.1, -0.1, 1.1, 10, "EXCLUDED_NO_QUOTE", 0),
    ([18], 5, 1.1, 1.1, 1.1, 10, "EXCLUDED_LOCKED_CROSSED", 0),
    ([18], 5, 1.1, 0.9, 1.1, -1, "EXCLUDED_STALE_QUOTE", 0),
    ([18], 5, 1.1, 0.9, 1.1, 1001, "EXCLUDED_STALE_QUOTE", 0),
    ([18], 5, 1.1, 0.9, 1.1, 1000, "BUY", -5),
    ([18, 255, 255], 9, 1.15, 0.9, 1.1, 0, "BUY", -9),
    ([18], 4, 0.9, 0.9, 1.1, 10, "SELL", 4),
    ([18], 4, 0.85, 0.9, 1.1, 10, "SELL", 4),
    ([18], 4, 1.0, 0.9, 1.1, 10, "MID", 0),
    ([18], 4, 0.05, 0.0, 0.1, 10, "MID", 0),
    ([95], 6, 0.1, 0.0, 0.1, 10, "BUY", -6),
]


def test5():
    for conds, size, px, bid, ask, age, bucket, C in CLASSIFY_CASES:
        got = R.classify(conds, size, px, bid, ask, age)
        check(got == (bucket, C), f"classify {conds} {size}@{px} [{bid},{ask}] age {age}: {got} != {(bucket, C)}")
    # inventory before Greeks, one contract per row of the table, plus a linked and an unlinked cancel
    key = ("SPXW", "2026-11-02", 7570.0, "C")
    prints = []
    for i, (conds, size, px, bid, ask, age, bucket, C) in enumerate(CLASSIFY_CASES):
        if bucket == "CANCEL":
            continue
        prints.append({"key": key, "conditions": conds, "size": size, "price": px, "bid": bid, "ask": ask, "quote_age_ms": age, "seq": i})
    prints.append({"key": key, "conditions": [18], "size": 3, "price": 1.1, "bid": 0.9, "ask": 1.1, "quote_age_ms": 1, "seq": 100})
    prints.append({"key": key, "conditions": [40], "size": 3, "price": 1.1, "bid": 0.9, "ask": 1.1, "quote_age_ms": 1, "seq": 101})
    prints.append({"key": key, "conditions": [40], "size": 2, "price": 9.9, "bid": 0.9, "ask": 1.1, "quote_age_ms": 1, "seq": 102})
    inv, buckets, unlinked = R.accumulate(prints)
    expect = sum(c[7] for c in CLASSIFY_CASES if c[6] != "CANCEL")
    check(inv[key] == expect, f"inventory {inv[key]} != {expect}")
    check(unlinked == 1, "one unlinked cancel")
    # linearity, zero at C = 0, sensitivity, +1% check
    S, K, T, sg, r, b = 7566.48, 7570.0, 30 / 525600, 0.15, 0.0395, 0.0427
    g = R.greeks(S, K, T, sg, r, b, "C")
    e1 = R.exposures(g, 1, 100, S)
    e7 = R.exposures(g, -7, 100, S)
    e0 = R.exposures(g, 0, 100, S)
    for n in R.EXPOSURE_NAMES:
        check(abs(e7[n] + 7 * e1[n]) <= mpf("1e-40") * abs(e1[n]), f"{n} linear in C")
        check(e0[n] == 0, f"{n} zero at C = 0")
        for alt in (R.greeks(S * 1.001, K, T, sg, r, b, "C"), R.greeks(S, K, T, sg * 1.01, r, b, "C"), R.greeks(S, K, T * 0.9, sg, r, b, "C")):
            e_alt = R.exposures(alt, 1, 100, S)
            check(e_alt[n] != e1[n], f"{n} changes with S, σ or T")
    g2 = R.greeks(752.1, 755, 20 / 365, 0.18, 0.04, 0.04, "C")
    tgc = R.total_gex_change_1pct(g2, -5, 100, 752.1)
    gex0 = R.exposures(g2, -5, 100, 752.1)["GEX"]
    up = 752.1 * 1.01
    gex1 = R.exposures(R.greeks(up, 755, 20 / 365, 0.18, 0.04, 0.04, "C"), -5, 100, up)["GEX"]
    # first order: the +1% move's GEX change approaches total_gex_change_1pct as the move shrinks (error O(move))
    for eps in ("1e-4", "1e-6"):
        gx = lambda x: R.exposures(R.greeks(x, 755, 20 / 365, 0.18, 0.04, 0.04, "C"), -5, 100, x)["GEX"]
        e = mpf(eps)
        slope = (gx(mpf(752.1) * (1 + e)) - gx(mpf(752.1) * (1 - e))) / (2 * e) * mpf("0.01")
        check(rel(slope, tgc) < 1e-5, f"GEX central slope at {eps}: {slope} vs {tgc}")
    # the +1% move itself, on a contract where the first-order term dominates (half a year, 6% out of the money)
    gl = lambda x: R.greeks(x, 800, 0.5, 0.25, 0.04, 0.04, "C")
    tgc_l = R.total_gex_change_1pct(gl(752.1), -5, 100, 752.1)
    g_lo = R.exposures(gl(752.1), -5, 100, 752.1)["GEX"]
    g_hi = R.exposures(gl(up), -5, 100, up)["GEX"]
    check(abs(g_hi - (g_lo + tgc_l)) <= mpf("0.1") * abs(g_hi - g_lo), f"GEX after +1% {g_hi} vs GEX + total change {g_lo + tgc_l} (from {g_lo})")
    return f"{len(CLASSIFY_CASES)} classifier cases (all 14 rows), inventory with linked/unlinked cancels, linearity/zero/sensitivity of ten exposures, +1% GEX"


# ---- Test 7 — identities, IV round trip, parity, invalid inputs -------------------------------------------------

def test7():
    rnd = random.Random(7)
    worst = mpf(0)
    for _ in range(200):
        S = mpf(rnd.choice([37.5, 100, 752.1, 7566.48]))
        K = S * mpf(rnd.uniform(0.7, 1.35))
        T = mpf(rnd.choice([15 / 525600, 1 / 365, 0.1, 1.0, 3.0]))
        sg = mpf(rnd.uniform(0.08, 1.5))
        r, b = rnd.choice(RB)
        c = R.greeks(S, K, T, sg, r, b, "C")
        p = R.greeks(S, K, T, sg, r, b, "P")
        ec = mp.exp((mpf(b) - mpf(r)) * T)
        for a, z in [
            (c["delta"] - p["delta"], ec),
            (c["charm"] - p["charm"], -(mpf(b) - mpf(r)) * ec),
            (c["speed"] * S + 2 * c["gamma"], c["gamma"] * (1 - c["d1"] / (sg * mp.sqrt(T)))),
        ]:
            err = abs(a - z) / max(abs(z), mpf("1e-200"))
            worst = max(worst, err)
            check(err < mpf("1e-40") or abs(a - z) < mpf("1e-50"), "identity")
        for n in ("gamma", "vega", "vanna", "vomma", "speed", "zomma", "colorT", "vetaT"):
            check(c[n] == p[n], f"{n} call = put")
    # r = b = 0 regression to the v1 forms
    for _ in range(50):
        S, K, T, sg = mpf(100), mpf(rnd.uniform(70, 135)), mpf(rnd.uniform(0.001, 2)), mpf(rnd.uniform(0.1, 1))
        g = R.greeks(S, K, T, sg, 0, 0, "C")
        d1, d2, ph, sq = g["d1"], g["d2"], R.phi(g["d1"]), mp.sqrt(T)
        check(rel(g["charm"], ph * d2 / (2 * T)) < 1e-40, "v1 charm")
        check(rel(g["colorT"], -ph * (1 - d1 * d2) / (2 * S * T * sg * sq)) < 1e-40, "v1 color")
        check(rel(g["vetaT"], g["vega"] * (1 + d1 * d2) / (2 * T)) < 1e-40, "v1 veta")
    # IV round trip
    for _ in range(60):
        S = mpf(100)
        K = S * mpf(rnd.uniform(0.8, 1.2))
        T, sg = mpf(rnd.choice([1 / 365, 0.1, 1.0])), mpf(rnd.uniform(0.1, 0.9))
        r, b = rnd.choice(RB)
        right = rnd.choice("CP")
        px = R.price(S, K, T, sg, r, b, right)
        iv = R.implied_vol(px, S, K, T, r, b, right)
        check(iv is not None and rel(R.price(S, K, T, iv, r, b, right), px) < 1e-8, "IV round trip")
    # parity forward recovers S·e^{bT} to 1e-12
    for S, r, b, T in [(7566.48, 0.0395, 0.0427, 30 / 525600), (752.1, 0.04, 0.012, 0.25), (100, 0.0, 0.0, 1.0)]:
        pairs = []
        for k in range(-6, 7):
            K = mpf(S) * (1 + mpf(k) / 200)
            c = R.price(S, K, T, 0.2, r, b, "C")
            p = R.price(S, K, T, 0.2, r, b, "P")
            pairs.append((K, c - mpf("0.05"), c + mpf("0.05"), p - mpf("0.03"), p + mpf("0.03")))
        F = R.parity_forward(pairs, S, r, T)
        check(rel(F, mpf(S) * mp.exp(mpf(b) * mpf(T))) < 1e-12, f"parity forward at S={S}")
    # invalid inputs rejected
    for args, want in [((None, 100, 0.2, 0.1), R.UNAVAILABLE), ((100, 0, 0.2, 0.1), R.UNAVAILABLE), ((100, 100, 0, 0.1), R.UNAVAILABLE),
                       ((100, 100, 0.2, 0), R.EXPIRED), ((100, 100, 0.2, -1e-9), R.EXPIRED), ((-1, 100, 0.2, 0.1), R.UNAVAILABLE),
                       ((float("inf"), 100, 0.2, 0.1), R.UNAVAILABLE), ((100, 100, 0.2, 0.1), R.OK)]:
        check(R.contract_status(*args) == want, f"status {args}")
    # unidentifiable IV rejected
    S, K, T, r, b = 100, 100, 0.1, 0.04, 0.04
    lb, ub = R.bounds(S, K, T, r, b, "C")
    check(R.iv_from_quote(0, 2, S, K, T, r, b, "C", 0.01) is None, "bid = 0")
    check(R.iv_from_quote(2, 2, S, K, T, r, b, "C", 0.01) is None, "bid ≥ ask")
    deep = R.bounds(S, 60, T, r, b, "C")[0]
    check(R.iv_from_quote(float(deep) - 0.002, float(deep) + 0.006, S, 60, T, r, b, "C", 0.05) is None, "mid ≤ lower bound + ½ tick")
    check(R.iv_from_quote(float(ub) - 0.01, float(ub) + 0.03, S, K, T, r, b, "C", 0.01) is None, "mid ≥ upper bound")
    check(R.iv_from_quote(3.0, 3.1, S, K, T, r, b, "C", 0.01) is not None, "a fair quote solves")
    return f"identities on 200 random points (worst rel {mp.nstr(worst, 3)}), v1 regression, IV round trip, parity forward, statuses, unidentifiable IV"


# ---- sympy derivation of the ten Greeks from §1.3 ---------------------------------------------------------------

def test_sympy():
    import sympy as sp
    S, K, T, s, r, b = sp.symbols("S K T sigma r b", positive=True)

    class Ncdf(sp.Function):
        """N(x) = ½·erfc(−x/√2), kept unevaluated: sympy rewrites erfc(−z) as 2 − erfc(z), which loses the lower tail
        at any precision (the §1.3 warning). Its derivative is the normal density, by definition."""

        def fdiff(self, argindex=1):
            x = self.args[0]
            return sp.exp(-x ** 2 / 2) / sp.sqrt(2 * sp.pi)

    Nf = Ncdf
    d1 = (sp.log(S / K) + (b + s ** 2 / 2) * T) / (s * sp.sqrt(T))
    d2 = d1 - s * sp.sqrt(T)
    ec = sp.exp((b - r) * T)
    worst = mp.mpf(0)
    rnd = random.Random(1)
    for right, V in (("C", S * ec * Nf(d1) - K * sp.exp(-r * T) * Nf(d2)), ("P", K * sp.exp(-r * T) * Nf(-d2) - S * ec * Nf(-d1))):
        delta = sp.diff(V, S)
        gamma = sp.diff(delta, S)
        vega = sp.diff(V, s)
        sym = {
            "delta": delta, "gamma": gamma, "vega": vega,
            "vanna": sp.diff(delta, s), "vomma": sp.diff(vega, s), "charm": -sp.diff(delta, T),
            "colorT": sp.diff(gamma, T), "speed": sp.diff(gamma, S), "vetaT": sp.diff(vega, T), "zomma": sp.diff(gamma, s),
        }
        fns = {k: sp.lambdify((S, K, T, s, r, b), v, [{"Ncdf": lambda x: mp.erfc(-x / mp.sqrt(2)) / 2}, "mpmath"]) for k, v in sym.items()}
        with mp.workdps(50):
            for _ in range(200):
                args = (mp.mpf(rnd.uniform(30, 8000)),)
                args = args + (args[0] * mp.mpf(rnd.uniform(0.7, 1.35)), mp.mpf(rnd.uniform(0.0003, 3)), mp.mpf(rnd.uniform(0.08, 1.5)),
                               mp.mpf(rnd.uniform(-0.01, 0.06)), mp.mpf(rnd.uniform(-0.02, 0.06)))
                ref = R.greeks(*args, right)
                for k, f in fns.items():
                    v = f(*args)
                    err = abs(v - ref[k]) / max(abs(ref[k]), mp.mpf("1e-300"))
                    worst = max(worst, err)
                    check(err < mp.mpf("1e-35"), f"sympy {k} {right}: {v} vs {ref[k]}")
    return f"sympy derivatives of the §1.3 price match §1.4 on 400 random points at 50 digits (worst rel {mp.nstr(worst, 3)})"


# ---- golden vectors (Test 6, the reference's own copy) ----------------------------------------------------------

def test_golden():
    path = os.path.join(HERE, "golden_vectors.json")
    if not os.path.exists(path):
        return "golden_vectors.json not built yet (run make_golden.py)"
    import make_golden as G
    fresh = G.build()
    with open(path) as fh:
        kept = json.load(fh)
    bad = G.compare(kept, fresh)
    check(not bad, f"golden mismatch: {bad[:3]}")
    return f"{G.count(kept)} golden values reproduced"


TESTS = [("Test 1", test1), ("Test 2", test2), ("Test 5", test5), ("Test 7", test7), ("sympy", test_sympy), ("golden", test_golden), ("Test 3", test3)]


def run(tests, quiet=False):
    fails = []
    for name, fn in tests:
        t0 = time.time()
        try:
            msg = fn()
            if not quiet:
                print(f"PASS {name}: {msg} ({time.time() - t0:.1f}s)")
        except Fail as e:
            fails.append((name, str(e)))
            if not quiet:
                print(f"FAIL {name}: {e}")
    return fails


def mutation_check():
    """Each injected bug must fail at least one of the suites (the golden vectors carry most of the weight)."""
    caught = []
    quick = [t for t in TESTS if t[0] != "Test 3"]
    for m in R.MUTATIONS:
        R.MUT.clear()
        R.MUT.add(m)
        fails = run(quick, quiet=True)
        caught.append((m, [f[0] for f in fails]))
    R.MUT.clear()
    return caught


if __name__ == "__main__":
    fails = run(TESTS)
    caught = mutation_check()
    missed = [m for m, f in caught if not f]
    for m, f in caught:
        print(f"MUTATION {m}: {'caught by ' + ', '.join(f) if f else 'NOT CAUGHT'}")
    print(f"mutations caught {len(caught) - len(missed)}/{len(caught)}")
    if fails or missed:
        sys.exit(1)
