"""
Scores this branch's Python reference (research/twobook/ref/slayer_ref.py) against the lead's independent audit golden
file. Groups the reference does not implement as functions (the clock, the UW population, the end-to-end board, which
live in the TypeScript engine) are scored by score-audit.ts only.

    python3 research/twobook/audit/score_audit.py <golden_audit.json>
"""

from __future__ import annotations

import json
import math
import os
import sys

import mpmath as mp

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ref"))
import slayer_ref as R  # noqa: E402

G = json.load(open(sys.argv[1]))["groups"]
stats: dict = {}
misses = []


def num(v):
    if v is None:
        return None
    if isinstance(v, str):
        return float(v)
    return v


def score(group, c, got, keymap=lambda k: k):
    s = stats.setdefault(group, [0, 0, 0])
    s[0] += 1
    f64 = set((c.get("info") or {}).get("f64_twin_out_of_tol", []))

    def walk(e, g, path):
        if isinstance(e, dict):
            for k, v in e.items():
                walk(v, g.get(keymap(k)) if isinstance(g, dict) else None, f"{path}.{k}" if path else k)
            return
        if isinstance(e, list):
            for i, v in enumerate(e):
                walk(v, g[i] if isinstance(g, list) and i < len(g) else None, f"{path}[{i}]")
            return
        s[1] += 1
        if isinstance(e, (int, float)) and not isinstance(e, bool):
            try:
                gv = mp.mpf(g)
                ok = abs(gv - e) <= mp.mpf("1e-10") * abs(mp.mpf(e)) + mp.mpf("1e-14")
            except Exception:
                ok = False
        else:
            ok = e == g
        if not ok:
            s[2] += 1
            misses.append((group, c["id"], path, g, e, c.get("ambiguity", []), path in f64))

    walk(c["expected"], got, "")


gk = lambda k: {"color_T": "colorT", "veta_T": "vetaT"}.get(k, k)
for c in G["greeks_exposures"]:
    x = c["inputs"]
    g = R.greeks(x["S"], x["K"], x["T"], x["sigma"], x["r"], x["b"], x["right"])
    e = R.exposures(g, x["C"], x["M"], x["S"])
    h = R.exposures(g, x["C"], x["M"], x["S"], per_hour=True)
    hd = R.hedge(g, x["C"], x["M"], x["S"])
    got = {"price": R.price(x["S"], x["K"], x["T"], x["sigma"], x["r"], x["b"], x["right"]), **g, **e, **hd,
           "CHARM_per_hour": h["CHARM"], "COLOR_per_hour": h["COLOR"], "VETA_per_hour": h["VETA"], "speed_gex_component": e["SPEED"],
           "total_gex_change_1pct": R.total_gex_change_1pct(g, x["C"], x["M"], x["S"]),
           "total_gex_change_1pct_closed": mp.mpf(x["C"]) * x["M"] * mp.mpf("0.0001") * g["gamma"] * mp.mpf(x["S"]) ** 2 * (1 - g["d1"] / (mp.mpf(x["sigma"]) * mp.sqrt(mp.mpf(x["T"]))))}
    for k in ("SPY", "ES", "MES"):
        got[f"hedge_in_{k}"] = R.hedge_in_instrument(hd["hedge_dollars"], x["instrument_prices"][k], k)
    score("greeks_exposures", c, got, gk)
for c in G["model1_six"]:
    x = c["inputs"]
    C = x["OI"] if x["right"] == "C" else -x["OI"]
    g = R.greeks(x["S"], x["K"], x["T"], x["sigma"], 0, 0, x["right"])
    e = R.exposures(g, C, x["M"], x["S"])
    h = R.exposures(g, C, x["M"], x["S"], per_hour=True)
    score("model1_six", c, {**e, "C": C, "COLOR_per_hour": h["COLOR"], "VETA_per_hour": h["VETA"]})
for c in G["uw_conversion"]:
    x = c["inputs"]
    d = R.uw_to_slayer(x, x["S"], x["IV30"])
    h = R.uw_to_slayer(x, x["S"], x["IV30"], per_hour=True)
    score("uw_conversion", c, {**d, "DEX_UW_OWN_SIGN": d["DEX_UW_SIGN"], "CHARM_per_hour": h["CHARM"]})
for c in G["status"]:
    x = c["inputs"]
    score("status", c, {"status": R.contract_status(num(x["S"]), num(x["K"]), num(x["sigma"]), num(x["T"]))})
for c in G["iv"]:
    x = c["inputs"]
    v = R.iv_from_quote(num(x["bid"]), num(x["ask"]), x["S"], x["K"], x["T"], x["r"], x["b"], x["right"], x["tick"])
    score("iv", c, {"identifiable": v is not None, "iv": v})
for c in G["flat_wing"]:
    cs = [{"expiry": "e", "right": "C", "strike": k["K"], "iv": k["iv"], "S_ref": c["inputs"]["S_ref"]} for k in c["inputs"]["contracts"]]
    out = R.flat_wing(cs)
    score("flat_wing", c, {"iv": [o["iv"] for o in out], "provenance": [o["iv_prov"] for o in out]})
qs = lambda q: [(k["K"], num(k["cb"]), num(k["ca"]), num(k["pb"]), num(k["pa"])) for k in q]
for c in G["parity_forward"]:
    x = c["inputs"]
    score("parity_forward", c, {"F": R.parity_forward(qs(x["quotes"]), x["S_ref"], x["r"], x["T"])})
for c in G["implied_spot"]:
    ex = [e for e in c["inputs"]["expiries"] if e["T"] > 0]
    fw = [(e["T"], e["F"] if "F" in e else R.parity_forward(qs(e["quotes"]), e["S_ref"], e["r"], e["T"])) for e in ex]
    pts = sorted((e["T"], e["r"]) for e in ex)

    def r_of(T, pts=pts):
        T = float(T)
        if T <= pts[0][0]:
            return pts[0][1]
        for i in range(1, len(pts)):
            if T <= pts[i][0]:
                return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (T - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])
        return pts[-1][1]

    res = R.spot_and_carry(fw, r_of)
    if res is None:
        score("implied_spot", c, {"S_star": None, "provenance": "UNAVAILABLE", "T1": None, "TL": None})
        continue
    t1, tl = R.pick_t1_tl(fw)
    idof = lambda T: next((e["id"] for e in ex if mp.mpf(e["T"]) == T), None)
    per = {e["id"]: {"F": F, "b": b, "source": src} for e, (T, F, b, src) in zip(ex, res["expiries"])}
    score("implied_spot", c, {"S_star": res["S"], "provenance": "EXACT" if res["prov"] == "CALCULATED" else res["prov"], "T1": idof(t1[0]), "TL": idof(tl[0]) if tl else None, "per_expiry": per})
for c in G["classifier"]:
    x = c["inputs"]
    age = None if x["trade_ts_ms"] is None or x["quote_ts_ms"] is None else num(x["trade_ts_ms"]) - num(x["quote_ts_ms"])
    b, C = R.classify([] if x["condition"] is None else [num(x["condition"])], num(x["size"]), num(x["price"]), num(x["bid"]), num(x["ask"]), age)
    score("classifier", c, {"bucket": b, "dealer_C": C})
for c in G["accumulate"]:
    prints = []
    for p in c["inputs"]["prints"]:
        age = None if p["trade_ts_ms"] is None or p["quote_ts_ms"] is None else num(p["trade_ts_ms"]) - num(p["quote_ts_ms"])
        prints.append({"key": p["contract"], "conditions": [p["condition"]], "size": num(p["size"]), "price": num(p["price"]), "bid": num(p["bid"]), "ask": num(p["ask"]), "quote_age_ms": age, "seq": p["seq"], "ref": p.get("ref_seq")})
    inv, buckets, unlinked = R.accumulate(prints)
    bl = [R.classify(p["conditions"], p["size"], p["price"], p["bid"], p["ask"], p["quote_age_ms"])[0] for p in prints]
    score("accumulate", c, {"C": {k: inv.get(k, 0) for k in c["expected"]["C"]}, "buckets": bl, "unlinked_cancels": unlinked})
for c in G["time_unit"]:
    score("time_unit", c, {"unit": R.board_unit([k["T"] for k in c["inputs"]["contracts"] if k["C"] != 0 and k["T"] > 0])})

tot = [0, 0, 0]
for g, s in stats.items():
    print(f"{g:20s} {s[0]:5d} cases {s[1]:7d} values {s[2]:4d} off")
    tot = [a + b for a, b in zip(tot, s)]
print(f"TOTAL {tot[0]} cases, {tot[1]} values, {tot[2]} off")
for m in misses[:60]:
    print("  ", m[0], m[1], m[2], "got", m[3], "expected", m[4], m[5], "(f64)" if m[6] else "")
