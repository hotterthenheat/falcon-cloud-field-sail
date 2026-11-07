"""Golden vectors for TWO_BOOK_SPEC_V2: case builders, evaluators and the scorer.

  python3 golden.py gen      -> writes golden_audit.json (expected values from ref60 at 60 digits)
  python3 golden.py score    -> re-evaluates every case with ref60 (mp and f64) and scores it

Every case is {"id", "inputs", "expected", "info"?, "ambiguity"?}. Only "expected" is scored.
See SCHEMA below (also embedded in the JSON as "_schema").
"""
from __future__ import annotations

import json
import math
import random
import sys
from datetime import date, datetime

import mpmath as mp

import ref60

TOL_REL, TOL_ABS = 1e-10, 1e-14

SCHEMA = {
    "file": "golden_audit.json",
    "tolerance": "numeric expected value e passes when |got - e| <= 1e-10*|e| + 1e-14; strings, booleans and "
                 "null must match exactly; lists compare element-wise; dicts key-wise (every expected key).",
    "number_encoding": "finite numbers are JSON numbers: the 60-digit result rounded to the nearest IEEE double. "
                       "Non-finite inputs are the strings 'NaN', 'Infinity', '-Infinity'. null = missing/None.",
    "inputs": "all numeric inputs are IEEE doubles; expected values are the exact mathematical result for those "
              "doubles (evaluated with mpmath at 60 digits), so T is given in years directly (T_minutes is info).",
    "info": "never scored: reason codes, the f64 twin's out-of-tolerance fields (conditioning), vega for IV cases.",
    "ambiguity": "list of AMBIGUITIES.md item ids whose chosen reading the expected value depends on.",
    "groups": {
        "greeks_exposures": "inputs S,K,sigma,T,r,b,right(C/P),C,M,mode,instrument_prices{SPY,ES,MES}. expected: price, "
                            "d1, d2, the ten Greeks (raw, per year, vega per 1.00 vol), the ten exposures of §4.4 "
                            "(= §3.5 for the six when mode=UW_COMPAT, r=b=0), CHARM/COLOR/VETA per hour (/24), §5 "
                            "hedge outputs, total_gex_change_1pct (speed form), its closed form, and "
                            "hedge_in_<instrument> = hedge_dollars/(price*multiplier) with SPY 1, ES 50, MES 5.",
        "model1_six": "Model 1 six (§3.5) in UW_COMPAT: inputs S(row price),K,sigma,T,right,OI,M; C = +OI call / -OI put.",
        "uw_contract_fields": "§3.3 forward formulas: inputs right, delta, gamma, vanna, charm, OI, S, IV30 -> "
                              "gamma_oi, delta_oi, vanna_oi, charm_oi.",
        "uw_conversion": "§3.4 step 3: inputs eight raw *_oi fields, S, IV30 -> GEX, DEX, VANNA, CHARM (per day), "
                         "CHARM_per_hour, DEX_UW_OWN_SIGN ((call+put)*100/S, OBSERVED secondary).",
        "uw_population": "§3.4 step 2: snapshot (ISO with offset), expiration, am_settlement_day -> DROP/FLAG_AM/INCLUDE.",
        "time_to_settlement": "§1.1: snapshot (ISO with offset), root, expiration -> minutes (real elapsed) and T years, "
                              "status EXPIRED when T <= 0.",
        "status": "§1.5: S,K,sigma,T -> OK/UNAVAILABLE/EXPIRED.",
        "iv": "§1.5: bid, ask, S,K,T,r,b,right,tick -> identifiable, iv (exact root of price=mid) or null.",
        "flat_wing": "§1.5: one (expiration,right) list of {K, iv|null}, S_ref -> iv per strike and provenance.",
        "parity_forward": "§1.2: quotes [{K,cb,ca,pb,pa}], S_ref (strike selection only), r, T -> F or null.",
        "implied_spot": "§1.2: expiries [{id,T,r,S_ref,quotes}] -> S_star, provenance, T1, TL, per expiry F, b, source.",
        "classifier": "§4.1: one print {condition,size,price,bid,ask,trade_ts_ms,quote_ts_ms} -> bucket, dealer_C.",
        "accumulate": "§4.1/§4.2: ordered prints with contract, seq, ref_seq(cancels) -> C per contract, "
                      "unlinked cancel seqs.",
        "time_unit": "§4.5: contracts [{T, C}] in the board filter -> unit hour/day (only C != 0 and T > 0 count).",
        "board_model2": "end-to-end Model 2 board: chain -> S*, b_T; contracts with C and quotes -> IV (flat-wing "
                        "fill) -> summed ten exposures in the board time unit, total_gex_change_1pct, hedge.",
    },
}


# --------------------------------------------------------------------------- helpers
def enc(x):
    """60-digit value -> JSON value."""
    if x is None:
        return None
    if isinstance(x, (bool, str)):
        return x
    if isinstance(x, dict):
        return {k: enc(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [enc(v) for v in x]
    v = float(x)
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    return v


def dec(x):
    if x == "NaN":
        return float("nan")
    if x == "Infinity":
        return float("inf")
    if x == "-Infinity":
        return float("-inf")
    return x


def close(got, exp):
    if exp is None or isinstance(exp, (bool, str)):
        return got == exp
    if isinstance(exp, dict):
        return isinstance(got, dict) and all(k in got and close(got[k], v) for k, v in exp.items())
    if isinstance(exp, list):
        return isinstance(got, list) and len(got) == len(exp) and all(close(g, e) for g, e in zip(got, exp))
    if got is None or isinstance(got, (str, bool)):
        return False
    g = float(got)
    return abs(g - exp) <= TOL_REL * abs(exp) + TOL_ABS


def bad_fields(got, exp, prefix=""):
    """list of field paths where got fails."""
    out = []
    if isinstance(exp, dict):
        for k, v in exp.items():
            if not isinstance(got, dict) or k not in got:
                out.append(prefix + k)
            else:
                out += bad_fields(got[k], v, prefix + k + ".")
        return out
    if isinstance(exp, list):
        if not isinstance(got, list) or len(got) != len(exp):
            return [prefix.rstrip(".")]
        for i, (g, e) in enumerate(zip(got, exp)):
            out += bad_fields(g, e, prefix + f"[{i}].")
        return out
    return [] if close(got, exp) else [prefix.rstrip(".")]


INSTRUMENT_PRICES = {"SPY": 752.1, "ES": 7580.25, "MES": 7580.25}


# --------------------------------------------------------------------------- evaluators (R = engine module)
def ev_greeks_exposures(R, B, i):
    g = R.greeks(B, i["S"], i["K"], i["sigma"], i["T"], i["r"], i["b"], i["right"])
    e = R.exposures(B, g, i["C"], i["M"], i["S"])
    h = R.hedge(B, g, i["C"], i["M"], i["S"])
    out = {k: g[k] for k in ("price", "d1", "d2") + R.GREEK_NAMES}
    out.update(e)
    for k in ("CHARM", "COLOR", "VETA"):
        out[k + "_per_hour"] = e[k] / 24
    out.update(h)
    out["total_gex_change_1pct"] = R.total_gex_change_1pct(B, g, i["C"], i["M"], i["S"])
    out["total_gex_change_1pct_closed"] = R.total_gex_change_1pct_closed(B, g, i["C"], i["M"], i["S"], i["sigma"], i["T"])
    for ins, px in i["instrument_prices"].items():
        out["hedge_in_" + ins] = R.hedge_in_instrument(B, h["hedge_dollars"], px, R.INSTRUMENT_MULT[ins])
    return out


def ev_model1_six(R, B, i):
    C = i["OI"] if i["right"] == "C" else -i["OI"]
    g = R.greeks(B, i["S"], i["K"], i["sigma"], i["T"], 0.0, 0.0, i["right"])
    e = R.exposures(B, g, C, i["M"], i["S"])
    out = {k: e[k] for k in ("VEGA", "VOMMA", "COLOR", "SPEED", "VETA", "ZOMMA")}
    out["C"] = B.f(C)
    for k in ("COLOR", "VETA"):
        out[k + "_per_hour"] = e[k] / 24
    return out


def ev_uw_contract_fields(R, B, i):
    return R.uw_fields_from_greeks(B, i["right"], i["delta"], i["gamma"], i["vanna"], i["charm"], i["OI"], i["S"], i["IV30"])


def ev_uw_conversion(R, B, i):
    o = R.uw_to_slayer(B, i["call_gamma_oi"], i["put_gamma_oi"], i["call_delta_oi"], i["put_delta_oi"],
                       i["call_vanna_oi"], i["put_vanna_oi"], i["call_charm_oi"], i["put_charm_oi"], i["S"], i["IV30"])
    o = dict(o)
    o["CHARM_per_hour"] = o["CHARM"] / 24
    return o


def _dt(s):
    return datetime.fromisoformat(s)


def ev_uw_population(R, B, i):
    return {"action": R.uw_row_population(_dt(i["snapshot"]), date.fromisoformat(i["expiration"]), i["am_settlement_day"])}


def ev_time_to_settlement(R, B, i):
    now = _dt(i["snapshot"])
    exp = date.fromisoformat(i["expiration"])
    minutes = R.calendar_minutes_between(now, R.settlement_instant(i["root"], exp))
    T = R.t_years_from_minutes(B, minutes)
    return {"minutes": B.f(minutes), "T": T, "status": "EXPIRED" if T <= 0 else "OK"}


def ev_status(R, B, i):
    return {"status": R.contract_status(B, *(dec(i[k]) for k in ("S", "K", "sigma", "T")))}


def ev_iv(R, B, i):
    iv, reason = R.iv_from_quote(B, dec(i["bid"]), dec(i["ask"]), i["S"], i["K"], i["T"], i["r"], i["b"], i["right"], i["tick"])
    return {"identifiable": iv is not None, "iv": iv}, {"reason": reason}


def ev_flat_wing(R, B, i):
    res = R.flat_wing_fill(B, i["contracts"], i["S_ref"])
    return {"iv": [r[0] for r in res], "provenance": [r[1] for r in res]}


def ev_parity_forward(R, B, i):
    return {"F": R.parity_forward(B, i["quotes"], i["S_ref"], i["r"], i["T"])}


def ev_implied_spot(R, B, i):
    res = R.implied_spot(B, i["expiries"])
    out = {"S_star": res["S_star"], "provenance": res["provenance"], "T1": res.get("T1"), "TL": res.get("TL")}
    out["per_expiry"] = {k: {"F": v["F"], "b": v["b"], "source": v["source"]} for k, v in res["per_expiry"].items()}
    return out


def ev_classifier(R, B, i):
    p = {k: dec(v) for k, v in i.items()}
    bucket, c = R.classify(p)
    return {"bucket": bucket, "dealer_C": c}


def ev_accumulate(R, B, i):
    prints = [{k: dec(v) for k, v in p.items()} for p in i["prints"]]
    C, buckets, unlinked = R.accumulate(prints)
    return {"C": {str(k): v for k, v in sorted(C.items())}, "buckets": buckets, "unlinked_cancels": unlinked}


def ev_time_unit(R, B, i):
    Ts = [c["T"] for c in i["contracts"] if c["C"] != 0 and c["T"] > 0]
    return {"unit": R.board_time_unit(B, Ts)}


def ev_board_model2(R, B, i):
    spot = R.implied_spot(B, i["chain"])
    S = spot["S_star"]
    per = spot["per_expiry"]
    # solve IVs per (expiry, right) over the whole listed strip, then flat-wing fill
    ivs = {}
    unid = {}
    for (eid, right), strip in _strips(i["contracts"]).items():
        exp = next(e for e in i["chain"] if e["id"] == eid)
        T, r, b = B.f(exp["T"]), B.f(exp["r"]), per[eid]["b"]
        rows = []
        for c in strip:
            iv, _ = R.iv_from_quote(B, c["bid"], c["ask"], S, c["K"], T, r, b, right, c["tick"])
            rows.append({"K": c["K"], "iv": iv})
        filled = R.flat_wing_fill(B, rows, S)
        for c, (iv, prov) in zip(strip, filled):
            ivs[c["key"]] = iv
            unid[c["key"]] = prov != "SOLVED"
    totals = {k: B.f(0) for k in R.EXPOSURE_NAMES}
    tg = B.f(0)
    hd = B.f(0)
    Ts = []
    absC = B.f(0)
    absC_mod = B.f(0)
    for c in i["contracts"]:
        if c["C"] == 0:
            continue
        exp = next(e for e in i["chain"] if e["id"] == c["expiry"])
        T, r, b = B.f(exp["T"]), B.f(exp["r"]), per[c["expiry"]]["b"]
        if T <= 0 or ivs[c["key"]] is None:
            continue
        Ts.append(T)
        g = R.greeks(B, S, c["K"], ivs[c["key"]], T, r, b, c["right"])
        e = R.exposures(B, g, c["C"], c["M"], S)
        for k in totals:
            totals[k] += e[k]
        tg += R.total_gex_change_1pct(B, g, c["C"], c["M"], S)
        hd += R.hedge(B, g, c["C"], c["M"], S)["hedge_dollars"]
        absC += abs(c["C"])
        if unid[c["key"]]:
            absC_mod += abs(c["C"])
    unit = R.board_time_unit(B, Ts)
    totals = R.apply_time_unit(B, totals, unit)
    return {"S_star": S, "unit": unit, "totals": totals, "total_gex_change_1pct": tg, "hedge_dollars": hd,
            "share_absC_modeled_iv": absC_mod / absC if absC else None,
            "hedge_ES": R.hedge_in_instrument(B, hd, i["es_price"], 50)}


def _strips(contracts):
    out = {}
    for c in contracts:
        out.setdefault((c["expiry"], c["right"]), []).append(c)
    return out


EVAL = {
    "greeks_exposures": ev_greeks_exposures, "model1_six": ev_model1_six,
    "uw_contract_fields": ev_uw_contract_fields, "uw_conversion": ev_uw_conversion,
    "uw_population": ev_uw_population, "time_to_settlement": ev_time_to_settlement, "status": ev_status,
    "iv": ev_iv, "flat_wing": ev_flat_wing, "parity_forward": ev_parity_forward, "implied_spot": ev_implied_spot,
    "classifier": ev_classifier, "accumulate": ev_accumulate, "time_unit": ev_time_unit,
    "board_model2": ev_board_model2,
}


def evaluate(R, B, group, inputs):
    out = EVAL[group](R, B, inputs)
    if isinstance(out, tuple):
        return out
    return out, {}


# --------------------------------------------------------------------------- case builders
MIN_Y = 525600.0


def build_greeks_cases():
    cases = []
    Cs = [1, -7, 250, -1]
    n = 0
    for S in (37.5, 100.0, 752.1, 7566.48):
        for kk in (0.8, 0.95, 1.0, 1.04, 1.2):
            for sig in (0.12, 0.35, 0.9):
                for tm in (20, 390, 4320, 43200, 525600, 1051200):
                    for (r, b) in ((0.0, 0.0), (0.045, 0.045), (0.045, 0.032), (0.02, -0.01)):
                        for right in "CP":
                            M = 100 if (n // 2) % 2 == 0 else 10
                            C = Cs[n % 4]
                            cases.append({"id": f"ge{n:05d}", "inputs": {
                                "S": S, "K": S * kk, "sigma": sig, "T": tm / MIN_Y, "r": r, "b": b, "right": right,
                                "C": C, "M": M, "mode": "UW_COMPAT" if (r, b) == (0.0, 0.0) else "SLAYER",
                                "instrument_prices": INSTRUMENT_PRICES},
                                "info": {"T_minutes": tm}})
                            n += 1
    return cases


def build_model1_six():
    cases = []
    n = 0
    for S in (752.1, 7566.48, 37.5, 100.0):
        for kk in (0.9, 1.0, 1.1):
            for tm in (1425, 26000, 200000):
                for right in "CP":
                    cases.append({"id": f"m1_{n:03d}", "inputs": {"S": S, "K": round(S * kk, 0), "sigma": 0.2 + 0.05 * (n % 3),
                                                              "T": tm / MIN_Y, "right": right, "OI": 1000 + 37 * n,
                                                              "M": 100}, "info": {"T_minutes": tm}})
                    n += 1
    return cases


def build_uw_cases():
    B = ref60.MP
    contract_cases, conv_cases = [], []
    n = 0
    for S, IV30 in ((752.1, 0.172), (7566.48, 0.155), (37.5, 0.41)):
        for kk in (0.97, 1.0, 1.03):
            for right in "CP":
                K = round(S * kk)
                g0 = ref60.greeks(B, S, K, 0.18, 26000 / MIN_Y, 0, 0, right)
                gc = ref60.greeks(B, S, K, 0.18, 26000 / MIN_Y, 0.045, 0.045, right)   # UW carry model for vanna/charm
                contract_cases.append({"id": f"uwc{n:02d}", "inputs": {
                    "right": right, "delta": float(g0["delta"]), "gamma": float(g0["gamma"]), "vanna": float(gc["vanna"]),
                    "charm": float(gc["charm"]), "OI": 1200 + 311 * n, "S": S, "IV30": IV30}})
                n += 1
    # conversion cases: aggregate contract fields per strike (call + put at the same strike)
    m = 0
    for S, IV30 in ((752.1, 0.172), (7566.48, 0.155), (37.5, 0.41)):
        for kk in (0.95, 1.0, 1.05):
            K = round(S * kk)
            row = {}
            for right in "CP":
                g0 = ref60.greeks(B, S, K, 0.2, 26000 / MIN_Y, 0, 0, right)
                gc = ref60.greeks(B, S, K, 0.2, 26000 / MIN_Y, 0.045, 0.045, right)
                OI = 5000 + 1000 * m + (17 if right == "P" else 0)
                f = ref60.uw_fields_from_greeks(B, right, g0["delta"], g0["gamma"], gc["vanna"], gc["charm"], OI, S, IV30)
                p = "call_" if right == "C" else "put_"
                for k, v in f.items():
                    row[p + k] = float(v)
            row.update({"S": S, "IV30": IV30})
            conv_cases.append({"id": f"uwx{m:02d}", "inputs": row})
            m += 1
    # hand cases incl. the measured sign flip example structure
    conv_cases.append({"id": "uwx_hand0", "inputs": {"call_gamma_oi": 1.0e9, "put_gamma_oi": -2.5e9, "call_delta_oi": 3.0e11,
                                                     "put_delta_oi": -4.0e11, "call_vanna_oi": 2.0e8, "put_vanna_oi": -5.0e7,
                                                     "call_charm_oi": 7.0e10, "put_charm_oi": -9.0e10, "S": 752.1, "IV30": 0.172}})
    conv_cases.append({"id": "uwx_hand_zero", "inputs": {k: 0.0 for k in ("call_gamma_oi", "put_gamma_oi", "call_delta_oi",
                                                                          "put_delta_oi", "call_vanna_oi", "put_vanna_oi",
                                                                          "call_charm_oi", "put_charm_oi")} | {"S": 7555.0, "IV30": 0.1}})
    return contract_cases, conv_cases


def build_population():
    c = []
    rows = [
        ("2026-11-02T15:59:00-05:00", "2026-11-02", False, []),
        ("2026-11-02T16:00:00-05:00", "2026-11-02", False, []),
        ("2026-11-02T16:15:00-05:00", "2026-11-02", False, []),
        ("2026-11-02T16:15:00-05:00", "2026-11-03", False, []),
        ("2026-11-02T10:00:00-05:00", "2026-10-30", False, []),
        ("2026-11-20T09:29:00-05:00", "2026-11-20", True, []),
        ("2026-11-20T09:30:00-05:00", "2026-11-20", True, ["A13"]),
        ("2026-11-20T15:59:59-05:00", "2026-11-20", True, ["A13"]),
        ("2026-11-20T16:00:00-05:00", "2026-11-20", True, ["A13"]),
        ("2026-11-19T16:15:00-05:00", "2026-11-20", True, []),
        ("2026-11-02T21:30:00+00:00", "2026-11-02", False, ["A12"]),   # 16:30 ET given in UTC
        ("2026-11-03T03:00:00+00:00", "2026-11-02", False, []),        # 22:00 ET on 11-02 given in UTC (next UTC day)
    ]
    for n, (s, e, am, amb) in enumerate(rows):
        c.append({"id": f"pop{n:02d}", "inputs": {"snapshot": s, "expiration": e, "am_settlement_day": am}, "ambiguity": amb})
    return c


def build_tts():
    rows = [
        ("2026-11-02T15:30:00-05:00", "SPXW", "2026-11-02", []),
        ("2026-11-02T15:30:00-05:00", "SPY", "2026-11-03", []),
        ("2026-11-19T16:15:00-05:00", "SPX", "2026-11-20", ["A11"]),
        ("2026-11-19T16:15:00-05:00", "SPXW", "2026-11-20", []),
        ("2026-11-20T10:00:00-05:00", "SPX", "2026-11-20", ["A11"]),
        ("2026-11-20T09:30:00-05:00", "SPX", "2026-11-20", ["A11"]),
        ("2026-11-02T16:00:00-05:00", "SPXW", "2026-11-02", []),
        ("2026-10-30T15:00:00-04:00", "SPY", "2026-11-06", ["A12"]),     # crosses DST end (2026-11-01)
        ("2026-03-06T15:00:00-05:00", "SPY", "2026-03-13", ["A12"]),     # crosses DST start (2026-03-08)
        ("2026-11-02T15:59:00-05:00", "SPXW", "2028-12-15", []),
        ("2026-11-02T15:59:00-05:00", "NDX", "2026-11-20", ["A11"]),
        ("2026-11-02T15:59:00-05:00", "XSP", "2026-11-20", ["A11"]),
        ("2026-11-02T15:59:00-05:00", "AAPL", "2026-11-20", ["A11"]),
    ]
    return [{"id": f"tts{n:02d}", "inputs": {"snapshot": s, "root": r, "expiration": e}, "ambiguity": a}
            for n, (s, r, e, a) in enumerate(rows)]


def build_status():
    rows = [
        (100, 100, 0.2, 0.1, []), (100, 100, 0.2, 0.0, []), (100, 100, 0.2, -1e-9, []),
        (0, 100, 0.2, 0.1, []), (-5, 100, 0.2, 0.1, []), (100, 0, 0.2, 0.1, []), (100, 100, 0.0, 0.1, []),
        (100, 100, -0.1, 0.1, []), ("NaN", 100, 0.2, 0.1, []), (100, "Infinity", 0.2, 0.1, []),
        (100, 100, "NaN", 0.1, []), (100, 100, 0.2, "NaN", []), (None, 100, 0.2, 0.1, []),
        (100, 100, None, 0.0, ["A15"]), (100, 100, "NaN", -0.01, ["A15"]), (0, 100, 0.2, -1, ["A15"]),
        (100, 100, 1e-300, 1e-12, []),
    ]
    return [{"id": f"st{n:02d}", "inputs": {"S": S, "K": K, "sigma": s, "T": T}, "ambiguity": a}
            for n, (S, K, s, T, a) in enumerate(rows)]


def build_iv():
    B = ref60.MP
    cases = []
    n = 0
    rng = random.Random(7)
    for S in (37.5, 100.0, 752.1, 7566.48):
        for kk in (0.9, 1.0, 1.08):
            for sig in (0.15, 0.6):
                for tm in (390, 43200, 525600):
                    for (r, b) in ((0.0, 0.0), (0.045, 0.032)):
                        right = "CP"[n % 2]
                        K = S * kk
                        T = tm / MIN_Y
                        p = float(ref60.price(B, S, K, sig, T, r, b, right))
                        lo, _ = ref60.no_arb_bounds(B, S, K, T, r, b, right)
                        w = max(0.005, 0.01 * p)
                        bid, ask = p - w, p + w
                        tick = 0.01
                        if bid <= 0 or (bid + ask) / 2 <= float(lo) + tick / 2:
                            n += 1
                            continue
                        g = ref60.greeks(B, S, K, sig, T, r, b, right)
                        cases.append({"id": f"iv{n:03d}", "inputs": {"bid": bid, "ask": ask, "S": S, "K": K, "T": T, "r": r,
                                                                    "b": b, "right": right, "tick": tick},
                                      "info": {"sigma_generating": sig, "vega": float(g["vega"])}})
                        n += 1
    S, K, T = 100.0, 100.0, 30 / 365
    up = float(ref60.no_arb_bounds(B, S, K, T, 0.045, 0.032, "C")[1])
    p10 = float(ref60.price(B, S, K, 10.0, T, 0.045, 0.032, "C"))
    lo_itm = float(ref60.no_arb_bounds(B, 100.0, 80.0, T, 0.0, 0.0, "C")[0])
    special = [
        ("bid0", dict(bid=0.0, ask=0.05, S=S, K=130.0, T=T, r=0.0, b=0.0, right="C", tick=0.05), []),
        ("locked", dict(bid=1.0, ask=1.0, S=S, K=K, T=T, r=0.0, b=0.0, right="C", tick=0.05), []),
        ("crossed", dict(bid=1.1, ask=1.0, S=S, K=K, T=T, r=0.0, b=0.0, right="C", tick=0.05), []),
        ("below_lower_half_tick", dict(bid=lo_itm - 0.02, ask=lo_itm + 0.06, S=100.0, K=80.0, T=T, r=0.0, b=0.0,
                                       right="C", tick=0.05), ["A9"]),
        ("exactly_lower_plus_half_tick", dict(bid=lo_itm, ask=lo_itm + 0.05, S=100.0, K=80.0, T=T, r=0.0, b=0.0,
                                              right="C", tick=0.05), ["A8", "A20"]),
        ("just_above_lower_plus_half_tick", dict(bid=lo_itm + 0.01, ask=lo_itm + 0.05, S=100.0, K=80.0, T=T, r=0.0,
                                                 b=0.0, right="C", tick=0.05), ["A8"]),
        ("at_upper", dict(bid=up - 0.5, ask=up + 0.5, S=S, K=K, T=T, r=0.045, b=0.032, right="C", tick=0.05), []),
        ("no_bracket_hi", dict(bid=p10 + (up - p10) * 0.2, ask=p10 + (up - p10) * 0.6, S=S, K=K, T=T, r=0.045,
                               b=0.032, right="C", tick=0.0), []),
        ("put_deep_itm_r", dict(bid=29.0, ask=29.4, S=70.0, K=100.0, T=1.0, r=0.045, b=0.045, right="P", tick=0.05), ["A9"]),
        ("nan_bid", dict(bid="NaN", ask=1.0, S=S, K=K, T=T, r=0.0, b=0.0, right="C", tick=0.05), []),
        ("neg_bid", dict(bid=-0.05, ask=1.0, S=S, K=K, T=T, r=0.0, b=0.0, right="C", tick=0.05), []),
    ]
    for name, inp, amb in special:
        cases.append({"id": "iv_" + name, "inputs": inp, "ambiguity": amb})
    return cases


def build_flat_wing():
    return [
        {"id": "fw0", "inputs": {"S_ref": 100.0, "contracts": [
            {"K": 80.0, "iv": None}, {"K": 90.0, "iv": 0.31}, {"K": 100.0, "iv": 0.25}, {"K": 110.0, "iv": 0.22},
            {"K": 120.0, "iv": None}, {"K": 130.0, "iv": None}]}},
        {"id": "fw_tie_equidistant", "inputs": {"S_ref": 100.0, "contracts": [
            {"K": 90.0, "iv": 0.31}, {"K": 95.0, "iv": None}, {"K": 100.0, "iv": 0.25}, {"K": 105.0, "iv": None},
            {"K": 110.0, "iv": 0.22}]}, "ambiguity": ["A10"]},
        {"id": "fw_tie_wing_both_sides", "inputs": {"S_ref": 7566.48, "contracts": [
            {"K": 7400.0, "iv": 0.3}, {"K": 7450.0, "iv": None}, {"K": 7500.0, "iv": 0.2}, {"K": 7550.0, "iv": None},
            {"K": 7600.0, "iv": 0.15}]}, "ambiguity": ["A10"]},
        {"id": "fw_none_valid", "inputs": {"S_ref": 100.0, "contracts": [{"K": 90.0, "iv": None}, {"K": 100.0, "iv": None}]},
         "ambiguity": ["A10"]},
        {"id": "fw_uneven_grid", "inputs": {"S_ref": 50.0, "contracts": [
            {"K": 40.0, "iv": None}, {"K": 42.5, "iv": 0.5}, {"K": 45.0, "iv": None}, {"K": 49.0, "iv": None},
            {"K": 50.0, "iv": 0.4}, {"K": 60.0, "iv": None}]}},
    ]


# synthetic chains ------------------------------------------------------------
def _chain_quotes(S0, b, r, T, strikes, sig_fn, tick_fn, spread_ticks=1, skew=0.0, drop=()):
    B = ref60.MP
    qs = []
    for K in strikes:
        sig = sig_fn(K)
        c = float(ref60.price(B, S0, K, sig, T, r, b, "C"))
        p = float(ref60.price(B, S0, K, sig, T, r, b, "P"))
        q = {"K": float(K)}
        for side, px in (("c", c), ("p", p)):
            t = tick_fn(px)
            mid = round(px / t) * t + (skew * t if side == "c" else 0.0)
            bid = round(mid - spread_ticks * t, 2)
            ask = round(mid + spread_ticks * t, 2)
            q[side + "b"], q[side + "a"] = bid, ask
        if K in drop:
            q["pb"] = 0.0
        qs.append(q)
    return qs


def _spx_tick(px):
    return 0.05 if px < 3 else 0.10


def build_parity_cases():
    B = ref60.MP
    cases = []
    S0, r = 7566.48, 0.0395
    T = 7 / 365
    smile = lambda K: 0.14 + 2.0 * (math.log(K / S0)) ** 2
    strikes = [7500 + 5 * i for i in range(27)]
    qs = _chain_quotes(S0, 0.0427, r, T, strikes, smile, _spx_tick)
    cases.append({"id": "pf_spx_7d", "inputs": {"quotes": qs, "S_ref": 7565.88, "r": r, "T": T}})
    # exact mids (mid = model price): recovers S*e^{bT} (Test 7)
    qs2 = []
    for K in (95.0, 97.5, 100.0, 102.5, 105.0, 110.0):
        c = float(ref60.price(B, 100.0, K, 0.3, 0.5, 0.05, 0.02, "C"))
        p = float(ref60.price(B, 100.0, K, 0.3, 0.5, 0.05, 0.02, "P"))
        qs2.append({"K": K, "cb": c - 0.25, "ca": c + 0.25, "pb": p - 0.25, "pa": p + 0.25})
    cases.append({"id": "pf_exact_mids", "inputs": {"quotes": qs2, "S_ref": 100.0, "r": 0.05, "T": 0.5},
                  "info": {"S_e_bT": float(100 * mp.exp(mp.mpf(0.02) * mp.mpf(0.5)))}})
    # even count: only 4 eligible strikes
    qs3 = [dict(q) for q in qs[10:16]]
    qs3[0]["cb"] = 0.0
    qs3[5]["pa"] = qs3[5]["pb"]       # locked put -> not two-sided
    cases.append({"id": "pf_even_count_4", "inputs": {"quotes": qs3, "S_ref": 7565.88, "r": r, "T": T}, "ambiguity": ["A1", "A3"]})
    # 6th-position distance tie: S_ref on a strike; 7550 and 7580 tie at distance 15
    qs4 = [dict(q) for q in qs if 7545 <= q["K"] <= 7585]
    for q in qs4:
        if q["K"] == 7550:
            q["ca"] += 3.0; q["cb"] += 3.0           # make the tie-break change the median
        if q["K"] == 7580:
            q["pa"] += 3.0; q["pb"] += 3.0
    cases.append({"id": "pf_tie_6th", "inputs": {"quotes": qs4, "S_ref": 7565.0, "r": r, "T": T}, "ambiguity": ["A2"]})
    # odd count (5) and single strike
    cases.append({"id": "pf_odd_5", "inputs": {"quotes": qs[12:17], "S_ref": 7565.88, "r": r, "T": T}})
    cases.append({"id": "pf_single", "inputs": {"quotes": qs[13:14], "S_ref": 7565.88, "r": r, "T": T}, "ambiguity": ["A4"]})
    cases.append({"id": "pf_none", "inputs": {"quotes": [dict(q, pb=0.0) for q in qs[10:16]], "S_ref": 7565.88, "r": r, "T": T}})
    # S_ref far from the money changes selection
    cases.append({"id": "pf_sref_offcenter", "inputs": {"quotes": qs, "S_ref": 7520.0, "r": r, "T": T}, "ambiguity": ["A3"]})
    return cases


def _spx_chain(spec):
    """spec: list of (id, minutes, r, b, valid). Returns expiries list."""
    S0 = 7566.48
    out = []
    for eid, mins, r, b, valid in spec:
        T = mins / MIN_Y
        strikes = [7520 + 5 * i for i in range(19)]
        if T > 0:
            w = 0.13 + 0.02 * math.sqrt(T)
            qs = _chain_quotes(S0, b, r, T, strikes, lambda K, w=w: w + 1.5 * math.log(K / S0) ** 2, _spx_tick)
        else:
            qs = []
        if not valid:
            qs = [dict(q, cb=0.0) for q in qs]
        out.append({"id": eid, "T": T, "r": r, "S_ref": 7565.88, "quotes": qs})
    return out


def build_implied_spot_cases():
    base = [("0d", 30, 0.0395, 0.0427, True), ("1d", 1470, 0.0395, 0.041, True), ("3d", 4350, 0.0396, 0.0405, True),
            ("7d", 10080, 0.0397, 0.040, True), ("7d30m", 10110, 0.0397, 0.0402, True),
            ("14d", 20190, 0.0398, 0.0399, True), ("30d", 43230, 0.0400, 0.0385, True)]
    cases = []

    def mk(cid, spec, amb=()):
        cases.append({"id": cid, "inputs": {"expiries": _spx_chain(spec)}, "ambiguity": list(amb)})

    mk("is_all_valid_TL_exactly_7d", base, ["A5"])
    mk("is_0dte_invalid", [(e[0], e[1], e[2], e[3], e[0] != "0d") for e in base], ["A6"])
    mk("is_middle_invalid", [(e[0], e[1], e[2], e[3], e[0] not in ("3d", "14d")) for e in base])
    mk("is_last_invalid_extrapolate", [(e[0], e[1], e[2], e[3], e[0] != "30d") for e in base], ["A7"])
    mk("is_two_last_invalid", [(e[0], e[1], e[2], e[3], e[0] not in ("14d", "30d")) for e in base], ["A7"])
    mk("is_only_one_valid_fallback", [(e[0], e[1], e[2], e[3], e[0] == "3d") for e in base], ["A6", "A7"])
    mk("is_none_valid", [(e[0], e[1], e[2], e[3], False) for e in base])
    mk("is_no_TL_two_short_valid", [(e[0], e[1], e[2], e[3], e[0] in ("0d", "1d")) for e in base], ["A5"])
    mk("is_expired_present", [("exp", 0, 0.0395, 0.04, True)] + base[1:], [])
    mk("is_appendixB_like", [("0d", 30, 0.0395, 0.0427, True), ("nov09", 10110, 0.0397, 0.0405, True)])
    mk("is_T1_long", [("10d", 14400, 0.0397, 0.040, True), ("20d", 28800, 0.0398, 0.039, True),
                      ("40d", 57600, 0.0401, 0.037, True)])
    # direct-forward cases (no quotes): exercise the formulas in isolation
    cases.append({"id": "is_direct_appendixB", "inputs": {"expiries": [
        {"id": "0d", "T": 30 / MIN_Y, "r": 0.0395, "F": 7566.50}, {"id": "nov09", "T": 10110 / MIN_Y, "r": 0.0397, "F": 7572.69}]}})
    cases.append({"id": "is_direct_interp", "inputs": {"expiries": [
        {"id": "a", "T": 60 / MIN_Y, "r": 0.04, "F": 100.01}, {"id": "b", "T": 3 / 365, "r": 0.04, "F": None},
        {"id": "c", "T": 9 / 365, "r": 0.04, "F": 100.12}, {"id": "d", "T": 20 / 365, "r": 0.04, "F": None},
        {"id": "e", "T": 40 / 365, "r": 0.04, "F": 100.40}, {"id": "f", "T": 90 / 365, "r": 0.04, "F": None},
        {"id": "z", "T": 10 / MIN_Y, "r": 0.04, "F": None}]}, "ambiguity": ["A6", "A7"]})
    return cases


def build_classifier_cases():
    base = dict(condition=18, size=10, price=1.05, bid=1.00, ask=1.10, trade_ts_ms=1_000_000, quote_ts_ms=999_500)
    rows = []

    def add(cid, amb=(), **kw):
        p = dict(base)
        p.update(kw)
        rows.append({"id": "cl_" + cid, "inputs": p, "ambiguity": list(amb)})

    # one per table row
    add("r1_cancel", condition=40)
    add("r2_ext", condition=1)
    add("r3_complex", condition=35)
    add("r4_cross", condition=45)
    add("r5_invalid_size0", size=0)
    add("r6_bid_aggr", condition=145, price=1.02)
    add("r7_ask_aggr", condition=146, price=1.09)
    add("r8_late", condition=2, price=1.10)
    add("r9_noquote", bid="NaN")
    add("r10_locked", bid=1.05, ask=1.05)
    add("r11_stale", quote_ts_ms=998_999)
    add("r12_buy", price=1.10)
    add("r13_sell", price=1.00)
    add("r14_mid", price=1.05)
    # order / precedence edges
    add("cancel_beats_invalid", condition=44, size=0, price="NaN")
    add("cross_beats_invalid", condition=128, size=-1)
    add("complex_beats_ext_none", condition=147)
    add("ext_148", condition=148)
    add("ext_65", condition=65)
    add("ext_118", condition=118)
    add("invalid_before_aggr", condition=145, size=0)
    add("aggr_no_quote", condition=146, bid="NaN", ask="NaN")
    add("aggr_stale", condition=145, quote_ts_ms=0)
    add("aggr_beats_late", condition=146)
    add("late_with_quote_at_ask", condition=13, price=1.10)
    add("late_15", condition=15)
    add("late_5", condition=5)
    add("late_6", condition=6)
    # code range edges
    for c in (0, 3, 4, 7, 12, 14, 16, 34, 39, 46, 64, 66, 117, 119, 123, 125, 126, 129, 149, 255):
        add(f"code_{c}_regular", condition=c, price=1.10)
    for c in (36, 37, 38, 124, 130, 131, 137, 143, 144):
        add(f"code_{c}_complex", condition=c)
    for c in (41, 42, 43):
        add(f"code_{c}_cancel", condition=c)
    add("code_127_cross", condition=127)
    # quote edges
    add("age_0", quote_ts_ms=1_000_000, price=1.10)
    add("age_1000", quote_ts_ms=999_000, price=1.00)
    add("age_1001", quote_ts_ms=998_999, price=1.00)
    add("age_neg1", quote_ts_ms=1_000_001, price=1.00)
    add("tie_ask", price=1.10)
    add("tie_bid", price=1.00)
    add("above_ask", price=1.20)
    add("below_bid", price=0.95)
    add("bid0_sell", bid=0.0, ask=0.05, price=0.0)        # price 0 -> invalid
    add("bid0_at_bid_px", bid=0.0, ask=0.05, price=0.01)  # inside -> MID
    add("bid0_lift", bid=0.0, ask=0.05, price=0.05)
    add("bid_neg", bid=-0.01)
    add("ask0", bid=0.0, ask=0.0)
    add("ask_neg", ask=-1.0)
    add("crossed", bid=1.2, ask=1.1)
    add("ask_inf", ask="Infinity")
    add("price_inf", price="Infinity")
    add("price_neg", price=-1.0)
    add("size_neg", size=-5)
    add("size_nan", size="NaN", amb=["A18"])
    add("missing_quote_ts", quote_ts_ms=None, amb=["A19"])
    add("big_size_buy", size=12345, price=1.10)
    rng = random.Random(20261107)
    codes = [0, 1, 2, 5, 6, 13, 15, 18, 35, 38, 40, 44, 45, 65, 118, 124, 127, 128, 129, 130, 144, 145, 146, 147, 148, 149]
    for n in range(2000):
        bid = rng.choice([0.0, 0.05, 1.0, 1.0, 1.0, 2.5, 2.5, -0.01, "NaN"])
        spread = rng.choice([0.0, 0.05, 0.1, 0.1, 0.25, -0.05])
        ask = bid + spread if isinstance(bid, float) else rng.choice([1.0, "NaN"])
        pxc = rng.choice(["bid", "ask", "mid", "bid", "ask", "mid", "below", "above", "zero", "nan"])
        if isinstance(bid, float) and isinstance(ask, float):
            px = {"bid": bid, "ask": ask, "mid": (bid + ask) / 2, "below": bid - 0.05, "above": ask + 0.05,
                  "zero": 0.0, "nan": "NaN"}[pxc]
        else:
            px = rng.choice([1.0, 0.0, "NaN"])
        age = rng.choice([-1, 0, 0, 1, 500, 999, 1000, 1000, 1001, 5000])
        rows.append({"id": f"clf{n:04d}", "inputs": {
            "condition": rng.choice(codes) if rng.random() < 0.5 else rng.choice([0, 18, 95]), "size": rng.choice([1, 1, 5, 5, 100, 100, 0, -3]), "price": px, "bid": bid,
            "ask": ask, "trade_ts_ms": 2_000_000, "quote_ts_ms": 2_000_000 - age}})
    return rows


def build_accumulate():
    def P(contract, seq, cond, size, price, ref=None, bid=1.0, ask=1.1):
        d = {"contract": contract, "seq": seq, "condition": cond, "size": size, "price": price, "bid": bid, "ask": ask,
             "trade_ts_ms": 10_000, "quote_ts_ms": 9_900}
        if ref is not None:
            d["ref_seq"] = ref
        return d
    A, Bc = "SPXW 2026-11-02 7565 C", "SPXW 2026-11-02 7565 P"
    return [
        {"id": "acc_basic", "inputs": {"prints": [P(A, 1, 18, 10, 1.1), P(A, 2, 18, 4, 1.0), P(A, 3, 18, 3, 1.05),
                                                  P(Bc, 1, 18, 7, 1.1)]}},
        {"id": "acc_cancel_linked", "inputs": {"prints": [P(A, 1, 18, 10, 1.1), P(A, 2, 18, 4, 1.0),
                                                          P(A, 3, 40, 0, 0, ref=1)]}, "ambiguity": ["A17"]},
        {"id": "acc_cancel_unlinked", "inputs": {"prints": [P(A, 1, 18, 10, 1.1), P(A, 2, 41, 10, 1.1, ref=99)]}, "ambiguity": ["A17"]},
        {"id": "acc_cancel_no_ref", "inputs": {"prints": [P(A, 1, 18, 10, 1.1), P(A, 2, 42, 10, 1.1)]}, "ambiguity": ["A17"]},
        {"id": "acc_double_cancel", "inputs": {"prints": [P(A, 1, 18, 10, 1.1), P(A, 2, 40, 0, 0, ref=1),
                                                          P(A, 3, 40, 0, 0, ref=1)]}, "ambiguity": ["A17"]},
        {"id": "acc_cancel_other_contract", "inputs": {"prints": [P(A, 1, 18, 10, 1.1), P(Bc, 2, 40, 0, 0, ref=1)]},
         "ambiguity": ["A17"]},
        {"id": "acc_cancel_mid_print", "inputs": {"prints": [P(A, 1, 18, 10, 1.05), P(A, 2, 43, 0, 0, ref=1)]}, "ambiguity": ["A17"]},
        {"id": "acc_cancel_excluded_print", "inputs": {"prints": [P(A, 1, 35, 10, 1.1), P(A, 2, 44, 0, 0, ref=1),
                                                                  P(A, 3, 146, 6, 1.1)]}, "ambiguity": ["A17"]},
        {"id": "acc_cancel_before_trade", "inputs": {"prints": [P(A, 2, 40, 0, 0, ref=3), P(A, 3, 18, 5, 1.1)]},
         "ambiguity": ["A17"]},
        {"id": "acc_cancel_of_cancel", "inputs": {"prints": [P(A, 1, 18, 5, 1.0), P(A, 2, 40, 0, 0, ref=1),
                                                             P(A, 3, 40, 0, 0, ref=2)]}, "ambiguity": ["A17"]},
        {"id": "acc_aggressor_flags", "inputs": {"prints": [P(A, 1, 145, 3, 1.02), P(A, 2, 146, 2, 1.08),
                                                            P(Bc, 3, 145, 9, 1.0, bid="NaN", ask="NaN")]}},
    ]


def build_time_unit():
    d = 1 / 365
    rows = [
        ("tu_all_long", [{"T": 2 * d, "C": 5}, {"T": 30 * d, "C": -2}], []),
        ("tu_one_0dte", [{"T": 2 * d, "C": 5}, {"T": 0.3 * d, "C": -2}], []),
        ("tu_exactly_1d", [{"T": d, "C": 5}], []),
        ("tu_just_below_1d", [{"T": d * (1 - 1e-12), "C": 5}], []),
        ("tu_0dte_C0", [{"T": 2 * d, "C": 5}, {"T": 0.3 * d, "C": 0}], ["A16"]),
        ("tu_expired_only_short", [{"T": 2 * d, "C": 5}, {"T": 0.0, "C": 3}], ["A16"]),
        ("tu_lt_1h", [{"T": 10 / MIN_Y, "C": 1}], []),
    ]
    return [{"id": i, "inputs": {"contracts": c}, "ambiguity": a} for i, c, a in rows]


def build_board_model2():
    chain = _spx_chain([("0d", 30, 0.0395, 0.0427, True), ("1d", 1470, 0.0395, 0.041, True),
                        ("7d30m", 10110, 0.0397, 0.0402, True), ("14d", 20190, 0.0398, 0.0399, True)])
    contracts = []
    rng = random.Random(42)
    for e in chain:
        qmap = {q["K"]: q for q in e["quotes"]}
        for K in sorted(qmap):
            for right in "CP":
                q = qmap[K]
                bid, ask = (q["cb"], q["ca"]) if right == "C" else (q["pb"], q["pa"])
                if rng.random() < 0.15:
                    bid = 0.0                        # unidentifiable -> flat wing
                contracts.append({"key": f"{e['id']}|{K}|{right}", "expiry": e["id"], "K": K, "right": right,
                                  "bid": bid, "ask": ask, "tick": _spx_tick((bid + ask) / 2), "M": 100,
                                  "C": rng.choice([0, 0, -5, -20, 3, 12, -1, 40])})
    return [{"id": "board_m2_spxw", "inputs": {"chain": chain, "contracts": contracts, "es_price": 7580.25},
             "ambiguity": ["A1", "A2", "A3", "A6", "A8", "A10", "A16"]}]


BUILDERS = {
    "greeks_exposures": build_greeks_cases, "model1_six": build_model1_six,
    "uw_population": build_population, "time_to_settlement": build_tts, "status": build_status, "iv": build_iv,
    "flat_wing": build_flat_wing, "parity_forward": build_parity_cases, "implied_spot": build_implied_spot_cases,
    "classifier": build_classifier_cases, "accumulate": build_accumulate, "time_unit": build_time_unit,
    "board_model2": build_board_model2,
}


def count_values(x):
    if isinstance(x, dict):
        return sum(count_values(v) for v in x.values())
    if isinstance(x, list):
        return sum(count_values(v) for v in x)
    return 1


def generate(path="golden_audit.json"):
    groups = {}
    for name, fn in BUILDERS.items():
        groups[name] = fn()
    uwc, uwx = build_uw_cases()
    groups["uw_contract_fields"] = uwc
    groups["uw_conversion"] = uwx
    total_cases = total_vals = 0
    f64_flags = 0
    for gname, cases in groups.items():
        for c in cases:
            exp, info = evaluate(ref60, ref60.MP, gname, c["inputs"])
            c["expected"] = enc(exp)
            if info:
                c.setdefault("info", {}).update(enc(info))
            # conditioning: does the IEEE-double twin hit the tolerance?
            try:
                e64, _ = evaluate(ref60, ref60.F64, gname, c["inputs"])
                bad = bad_fields(enc(e64), c["expected"])
            except Exception as ex:          # noqa: BLE001
                bad = [f"f64 error: {type(ex).__name__}: {ex}"]
            if bad:
                c.setdefault("info", {})["f64_twin_out_of_tol"] = bad
                f64_flags += 1
            c.setdefault("ambiguity", [])
            total_cases += 1
            total_vals += count_values(c["expected"])
    doc = {"_schema": SCHEMA, "meta": {
        "spec": "slayer/docs/TWO_BOOK_SPEC_V2.md", "generator": "slayer/research/twobook-audit/golden.py",
        "engine": "slayer/research/twobook-audit/ref60.py (mpmath, 60 digits)", "D": 365,
        "tolerance": {"rel": TOL_REL, "abs": TOL_ABS},
        "counts": {g: len(v) for g, v in groups.items()}, "total_cases": total_cases, "total_values": total_vals,
        "cases_with_f64_twin_out_of_tol": f64_flags}, "groups": groups}
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), allow_nan=False)
    print(json.dumps(doc["meta"], indent=1))
    return doc


def score(R, B, path="golden_audit.json", groups=None, verbose=False, stop_on_first=False):
    with open(path) as f:
        doc = json.load(f)
    res = {}
    for gname, cases in doc["groups"].items():
        if groups and gname not in groups:
            continue
        ok = bad = 0
        fails = []
        for c in cases:
            try:
                got, _ = evaluate(R, B, gname, c["inputs"])
                bf = bad_fields(enc(got), c["expected"])
            except Exception as ex:          # noqa: BLE001
                bf = [f"error {type(ex).__name__}: {ex}"]
            if bf:
                bad += 1
                fails.append((c["id"], bf[:5]))
                if stop_on_first:
                    res[gname] = {"pass": ok, "fail": bad, "fails": fails}
                    return res
            else:
                ok += 1
        res[gname] = {"pass": ok, "fail": bad, "fails": fails[:10]}
        if verbose:
            print(f"{gname:20s} pass {ok:5d} fail {bad:5d} {fails[:3] if fails else ''}")
    return res


if __name__ == "__main__":
    if sys.argv[1] == "gen":
        generate()
    elif sys.argv[1] == "score":
        for B in (ref60.MP, ref60.F64):
            print("backend", B.name)
            score(ref60, B, verbose=True)
