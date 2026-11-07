"""
Golden vectors for the two-book engine, from the 60-digit reference (slayer_ref.py).

    python3 research/twobook/ref/make_golden.py     writes golden_vectors.json here and scripts/golden/twobook-vectors.json

Inputs are written as the decimal repr of the binary double the TypeScript engine reads (so both sides start from the
same number); outputs as 30 significant digits. The TS suite compares with |got − expected| ≤ 1e-10·|expected| + 1e-14.

Sets:
  greeks    S ∈ {37.5, 100, 752.1, 7566.48} × M ∈ {10, 100} × K/S ∈ {0.85, 1, 1.1} × (σ, T) ∈ {(0.18, 30 min),
            (0.25, 7 d), (0.6, 1 y)} × (r, b) ∈ {(0, 0), (0.045, 0.032)} × call/put: price, ten Greeks, ten exposures per
            day and per hour, hedge, total_gex_change_1pct, SPY/ES/MES hedges
  uw        §3.4 conversion cases (UW fields built from §3.3 at known Greeks) and the §4.4 values they must equal
  classify  the §4.1 cases (every row) ; accumulate: one sequence with linked and unlinked cancels
  spot      §1.2 S*, provenance and per-expiry (F, b_T), incl. interpolated, extrapolated and one-forward fallback
  iv        §1.5 quote → IV or not identifiable
"""

from __future__ import annotations

import json
import math
import os
import sys

import mpmath as mp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import slayer_ref as R  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_TS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "scripts", "golden", "twobook-vectors.json"))


def fin(x: float) -> str:
    if isinstance(x, str):
        return x
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    return repr(float(x))


def fout(v) -> str | None:
    if v is None:
        return None
    return mp.nstr(mp.mpf(v), 30)


SPOTS = [37.5, 100.0, 752.1, 7566.48]
MULTS = [10, 100]
KS = [0.85, 1.0, 1.1]
SIGT = [(0.18, 30 / 525600), (0.25, 7 / 365), (0.6, 1.0)]
RB = [(0.0, 0.0), (0.045, 0.032)]
INSTR = {"SPY": 683.25, "ES": 6850.25, "MES": 6850.25}


def build():
    from test_ref import CLASSIFY_CASES

    out = {"meta": {"spec": "docs/TWO_BOOK_SPEC_V2.md", "digits": R.MP_DPS, "D": 365, "tolerance": "1e-10*|expected| + 1e-14"}}
    greeks = []
    for S in SPOTS:
        for M in MULTS:
            for ks in KS:
                K = float(S * ks)
                for sg, T in SIGT:
                    for r, b in RB:
                        for right in ("C", "P"):
                            C = -7.0 if right == "C" else 13.0
                            g = R.greeks(S, K, T, sg, r, b, right)
                            ed = R.exposures(g, C, M, S)
                            eh = R.exposures(g, C, M, S, per_hour=True)
                            h = R.hedge(g, C, M, S)
                            greeks.append({
                                "in": {"S": fin(S), "K": fin(K), "T": fin(T), "sigma": fin(sg), "r": fin(r), "b": fin(b), "right": right, "C": fin(C), "M": fin(M)},
                                "price": fout(R.price(S, K, T, sg, r, b, right)),
                                "greeks": {n: fout(g[n]) for n in R.GREEK_NAMES},
                                "day": {n: fout(ed[n]) for n in R.EXPOSURE_NAMES},
                                "hour": {n: fout(eh[n]) for n in R.EXPOSURE_NAMES},
                                "hedge": {k: fout(v) for k, v in h.items()},
                                "tgc": fout(R.total_gex_change_1pct(g, C, M, S)),
                                "instr": {k: fout(R.hedge_in_instrument(h["hedge_dollars"], px, k)) for k, px in INSTR.items()},
                            })
    out["greeks"] = greeks

    uw = []
    for S, iv30, legs in [
        (752.1, 0.172, [(745.0, 21 / 365, 0.19, 15000, 22000), (760.0, 21 / 365, 0.16, 31000, 9000)]),
        (7566.48, 0.149, [(7550.0, 3 / 365, 0.14, 4200, 8800)]),
        (100.0, 0.31, [(95.0, 45 / 365, 0.33, 1200, 6100), (105.0, 45 / 365, 0.29, 7000, 900), (100.0, 10 / 365, 0.30, 0, 500)]),
    ]:
        row = {}
        engine = {n: mp.mpf(0) for n in ("GEX", "DEX", "VANNA", "CHARM")}
        for K, T, sg, oic, oip in legs:
            for right, oi in (("C", oic), ("P", oip)):
                g = R.greeks(S, K, T, sg, 0, 0, right)
                for k, v in R.uw_fields_from_greeks(g, oi, S, iv30, right).items():
                    row[k] = row.get(k, mp.mpf(0)) + v
                e = R.exposures(g, oi if right == "C" else -oi, 100, S)
                for n in engine:
                    engine[n] += e[n]
        rowf = {k: fin(float(v)) for k, v in row.items()}
        conv_d = R.uw_to_slayer({k: float(v) for k, v in row.items()}, S, iv30)
        conv_h = R.uw_to_slayer({k: float(v) for k, v in row.items()}, S, iv30, per_hour=True)
        uw.append({
            "in": {"row": rowf, "S": fin(S), "iv30": fin(iv30)},
            "day": {k: fout(v) for k, v in conv_d.items()},
            "hour": {k: fout(v) for k, v in conv_h.items()},
            "engine": {k: fout(v) for k, v in engine.items()},
        })
    out["uw"] = uw

    out["classify"] = [{"in": {"conditions": c[0], "size": fin(c[1]), "price": fin(c[2]), "bid": fin(c[3]), "ask": fin(c[4]), "age": fin(c[5])}, "bucket": c[6], "C": c[7]} for c in CLASSIFY_CASES]

    seq = [
        ("A", [18], 10, 1.10, 1.00, 1.10, 5), ("A", [18], 4, 1.00, 1.00, 1.10, 5), ("B", [145], 3, 2.0, 1.9, 2.1, 900),
        ("A", [40], 4, 1.00, 1.00, 1.10, 5), ("B", [18], 6, 2.0, 1.9, 2.1, 20), ("B", [130], 50, 2.0, 1.9, 2.1, 20),
        ("C", [18], 2, 0.5, 0.45, 0.5, 3), ("C", [41], 9, 0.7, 0.45, 0.5, 3), ("A", [18], 1, 1.05, 1.00, 1.10, 5),
        ("C", [146], 5, 0.47, 0.45, 0.5, 3), ("B", [2], 8, 2.0, 1.9, 2.1, 20),
    ]
    prints = [{"key": k, "conditions": c, "size": s, "price": p, "bid": bd, "ask": a, "quote_age_ms": age, "seq": i} for i, (k, c, s, p, bd, a, age) in enumerate(seq)]
    inv, buckets, unlinked = R.accumulate(prints)
    out["accumulate"] = {
        "in": [{"key": p["key"], "conditions": p["conditions"], "size": fin(p["size"]), "price": fin(p["price"]), "bid": fin(p["bid"]), "ask": fin(p["ask"]), "age": fin(p["quote_age_ms"]), "seq": p["seq"]} for p in prints],
        "inventory": inv, "buckets": buckets, "unlinked": unlinked,
    }

    spot = []
    r = 0.0395
    t0 = 30 / 525600
    t7 = (7 * 1440 + 30) / 525600
    for name, fwds in [
        ("appendixB-like", [(t0, 7566.50), (1 / 365 + t0, None), (t7, 7572.69), (14 / 365 + t0, 7579.10), (60 / 365, None)]),
        ("one-forward", [(t0, 7566.50), (t7, None)]),
        ("t1-beyond-week", [(9 / 365, 754.20), (16 / 365, 755.10), (30 / 365, 756.90), (3 / 365, None)]),
    ]:
        res = R.spot_and_carry([(float(T), F) for T, F in fwds], lambda T: r)
        spot.append({
            "name": name,
            "in": {"forwards": [[fin(T), None if F is None else fin(F)] for T, F in fwds], "r": fin(r)},
            "S": fout(res["S"]), "prov": res["prov"],
            "expiries": [{"T": fout(T), "F": fout(F), "b": fout(b)} for T, F, b in res["expiries"]],
        })
    out["spot"] = spot

    iv = []
    for bid, ask, S, K, T, r_, b_, right, tick in [
        (3.0, 3.1, 100.0, 100.0, 0.1, 0.04, 0.04, "C", 0.01),
        (1.2, 1.35, 752.1, 760.0, 7 / 365, 0.04, 0.012, "C", 0.01),
        (4.1, 4.3, 752.1, 745.0, 7 / 365, 0.04, 0.012, "P", 0.01),
        (0.35, 0.45, 7566.48, 7590.0, 30 / 525600, 0.0395, 0.0427, "C", 0.05),
        (0.0, 0.05, 7566.48, 7700.0, 30 / 525600, 0.0395, 0.0427, "C", 0.05),
        (2.0, 2.0, 100.0, 100.0, 0.1, 0.0, 0.0, "C", 0.01),
        (39.9, 40.1, 100.0, 60.0, 0.1, 0.0, 0.0, "C", 0.05),
        (99.0, 101.0, 100.0, 100.0, 0.1, 0.0, 0.0, "C", 0.01),
        (12.5, 12.9, 7566.48, 7570.0, 30 / 525600, 0.0395, 0.0427, "P", 0.1),
    ]:
        v = R.iv_from_quote(bid, ask, S, K, T, r_, b_, right, tick)
        iv.append({"in": {"bid": fin(bid), "ask": fin(ask), "S": fin(S), "K": fin(K), "T": fin(T), "r": fin(r_), "b": fin(b_), "right": right, "tick": fin(tick)}, "iv": fout(v)})
    out["iv"] = iv
    return out


def walk(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ("in", "meta"):
                continue
            yield from walk(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f"{path}[{i}]")
    else:
        yield path, o


def count(o) -> int:
    return sum(1 for p, v in walk(o) if v is not None and not isinstance(v, str) or (isinstance(v, str) and v[:1] in "-0123456789"))


def compare(a, b):
    bad = []
    da, db = dict(walk(a)), dict(walk(b))
    for k, v in db.items():
        w = da.get(k)
        if isinstance(v, str) and v[:1] in "-0123456789" and isinstance(w, str):
            x, y = mp.mpf(w), mp.mpf(v)
            if abs(x - y) > mp.mpf("1e-25") * abs(y) + mp.mpf("1e-40"):
                bad.append((k, w, v))
        elif v != w:
            bad.append((k, w, v))
    return bad


if __name__ == "__main__":
    data = build()
    for p in (os.path.join(HERE, "golden_vectors.json"), OUT_TS):
        with open(p, "w") as fh:
            json.dump(data, fh, indent=0, sort_keys=False)
            fh.write("\n")
    print(f"wrote {count(data)} golden values ({len(data['greeks'])} Greek/exposure/hedge cases, {len(data['uw'])} UW, {len(data['classify'])} classifier, {len(data['spot'])} spot, {len(data['iv'])} IV)")
