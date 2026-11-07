"""
Independent high-precision reference for the two-book Greek exposure engine (docs/TWO_BOOK_SPEC_V2.md).

Written from the spec text alone (the owner's slayer_ref.py is not available). mpmath at MP_DPS digits; every number
that leaves this module is an mpf (callers format it). Section numbers are the spec's.

Mutation hooks: MUT is a set of names; a name present switches one formula to a known-wrong form (Test 6's list). The
tests set it, run the suite, and expect failures. Production code never touches it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Optional

import mpmath as mp

MP_DPS = 60
mp.mp.dps = MP_DPS

D = mp.mpf(365)  # calendar days per year, for T and every per-day conversion (§1.1)
MUT: set[str] = set()

MUTATIONS = [
    "color_no_bmr",        # color missing (b − r)
    "veta_1_minus",        # veta (1 − d1·d2)
    "charm_sign",          # charm sign
    "charm_no_carry",      # charm without carry term
    "speed_sign",          # speed sign
    "zomma_plus",          # zomma (d1·d2 + 1)
    "vanna_d1",            # vanna with d1
    "COLOR_no_minus",      # COLOR without minus
    "CHARM_extra_minus",   # CHARM with extra minus
    "VANNA_no_S",          # VANNA without S
    "model2_buy_sign",     # Model 2 buy sign
    "uw_dex_no_put_flip",  # UW DEX without put flip
]


def mpf(x) -> mp.mpf:
    """Exact: a float becomes its binary value (what the TypeScript engine sees), a string its decimal value."""
    return x if isinstance(x, mp.mpf) else mp.mpf(x)


# ---- §1.3 normal ------------------------------------------------------------------------------------------------

def N(x):
    return mp.erfc(-x / mp.sqrt(2)) / 2


def phi(x):
    return mp.exp(-x * x / 2) / mp.sqrt(2 * mp.pi)


# ---- §1.5 status -------------------------------------------------------------------------------------------------

OK, EXPIRED, UNAVAILABLE = "OK", "EXPIRED", "UNAVAILABLE"


def _finite(x) -> bool:
    try:
        return x is not None and mp.isfinite(mpf(x))
    except Exception:
        return False


def contract_status(S, K, sigma, T) -> str:
    if not all(_finite(v) for v in (S, K, sigma, T)):
        return UNAVAILABLE
    if mpf(T) <= 0:
        return EXPIRED
    if mpf(S) <= 0 or mpf(K) <= 0 or mpf(sigma) <= 0:
        return UNAVAILABLE
    return OK


# ---- §1.3 price, §1.4 Greeks -------------------------------------------------------------------------------------

def _d(S, K, T, sigma, b):
    sq = mp.sqrt(T)
    d1 = (mp.log(S / K) + (b + sigma * sigma / 2) * T) / (sigma * sq)
    return d1, d1 - sigma * sq, sq


def price(S, K, T, sigma, r, b, right):
    S, K, T, sigma, r, b = map(mpf, (S, K, T, sigma, r, b))
    d1, d2, _ = _d(S, K, T, sigma, b)
    ec = mp.exp((b - r) * T)
    df = mp.exp(-r * T)
    if right == "C":
        return S * ec * N(d1) - K * df * N(d2)
    return K * df * N(-d2) - S * ec * N(-d1)


def greeks(S, K, T, sigma, r, b, right):
    """The ten raw Greeks of §1.4 (per 1.00 vol, per year, per $1). Time derivatives hold S, σ, r, b fixed."""
    S, K, T, sigma, r, b = map(mpf, (S, K, T, sigma, r, b))
    d1, d2, sq = _d(S, K, T, sigma, b)
    ec = mp.exp((b - r) * T)
    p = phi(d1)
    dd1dT = b / (sigma * sq) - d2 / (2 * T)
    delta = ec * N(d1) if right == "C" else -ec * N(-d1)
    gamma = ec * p / (S * sigma * sq)
    vega = S * ec * p * sq
    vanna = -ec * p * (d1 if "vanna_d1" in MUT else d2) / sigma
    vomma = vega * d1 * d2 / sigma
    carry = 0 if "charm_no_carry" in MUT else (b - r)
    if right == "C":
        charm = -ec * (p * dd1dT + carry * N(d1))
    else:
        charm = -ec * (p * dd1dT - carry * N(-d1))
    if "charm_sign" in MUT:
        charm = -charm
    bmr = 0 if "color_no_bmr" in MUT else (b - r)
    colorT = gamma * (bmr + (d1 * d2 - 1) / (2 * T) - b * d1 / (sigma * sq))
    speed = -gamma / S * (1 + d1 / (sigma * sq))
    if "speed_sign" in MUT:
        speed = -speed
    veta_bracket = (1 - d1 * d2) if "veta_1_minus" in MUT else (1 + d1 * d2)
    vetaT = vega * ((b - r) + veta_bracket / (2 * T) - b * d1 / (sigma * sq))
    zomma = gamma * ((d1 * d2 + 1) if "zomma_plus" in MUT else (d1 * d2 - 1)) / sigma
    return {
        "delta": delta, "gamma": gamma, "vega": vega, "vanna": vanna, "vomma": vomma,
        "charm": charm, "colorT": colorT, "speed": speed, "vetaT": vetaT, "zomma": zomma,
        "d1": d1, "d2": d2,
    }


GREEK_NAMES = ["delta", "gamma", "vega", "vanna", "vomma", "charm", "colorT", "speed", "vetaT", "zomma"]


# ---- §4.4 exposures, §3.5 six, §5 hedge --------------------------------------------------------------------------

EXPOSURE_NAMES = ["GEX", "DEX", "VEGA", "VANNA", "CHARM", "VOMMA", "COLOR", "SPEED", "VETA", "ZOMMA"]


def exposures(g, C, M, S, per_hour=False):
    """§4.4. `g` the raw Greeks, C signed contracts, M multiplier, S the contract's S_T. Per hour divides the three
    time rates by 24 (§4.5)."""
    C, M, S = mpf(C), mpf(M), mpf(S)
    u = mpf(24) if per_hour else mpf(1)
    charm = g["charm"] * C * M * S / D / u
    if "CHARM_extra_minus" in MUT:
        charm = -charm
    color = g["colorT"] * C * M * S * S * mpf("0.01") / D / u
    if "COLOR_no_minus" not in MUT:
        color = -color
    vanna = g["vanna"] * C * M * mpf("0.01") * (1 if "VANNA_no_S" in MUT else S)
    return {
        "GEX": g["gamma"] * C * M * S * S * mpf("0.01"),
        "DEX": g["delta"] * C * M * S,
        "VEGA": g["vega"] * C * M * mpf("0.01"),
        "VANNA": vanna,
        "CHARM": charm,
        "VOMMA": g["vomma"] * C * M * mpf("0.0001"),
        "COLOR": color,
        "SPEED": g["speed"] * C * M * S ** 3 * mpf("0.0001"),
        "VETA": -g["vetaT"] * C * M * mpf("0.01") / D / u,
        "ZOMMA": g["zomma"] * C * M * S * S * mpf("0.0001"),
    }


def total_gex_change_1pct(g, C, M, S):
    C, M, S = mpf(C), mpf(M), mpf(S)
    return C * M * mpf("0.0001") * (g["speed"] * S ** 3 + 2 * g["gamma"] * S * S)


def hedge(g, C, M, S):
    C, M, S = mpf(C), mpf(M), mpf(S)
    units = g["delta"] * C * M
    dex = units * S
    return {
        "dealer_delta_units": units,
        "hedge_units": -units,
        "dealer_dex": dex,
        "hedge_dollars": -dex,
        "hedge_units_change_1pct": -g["gamma"] * C * M * mpf("0.01") * S,
    }


INSTRUMENT_MULT = {"SPY": 1, "ES": 50, "MES": 5}


def hedge_in_instrument(hedge_dollars, instrument_price, instrument):
    return mpf(hedge_dollars) / (mpf(instrument_price) * INSTRUMENT_MULT[instrument])


# ---- §3.4 UW conversions -----------------------------------------------------------------------------------------

def uw_to_slayer(row, S, iv30, per_hour=False):
    """row: call_/put_ gamma_oi, delta_oi, vanna_oi, charm_oi (UW units). S = row `price`. Returns Slayer units."""
    g = lambda k: mpf(row.get(k, 0) or 0)
    S, iv30 = mpf(S), mpf(iv30)
    u = mpf(24) if per_hour else mpf(1)
    if "uw_dex_no_put_flip" in MUT:
        dex = (g("call_delta_oi") + g("put_delta_oi")) * 100 / S
    else:
        dex = (g("call_delta_oi") - g("put_delta_oi")) * 100 / S
    return {
        "GEX": g("call_gamma_oi") + g("put_gamma_oi"),
        "DEX": dex,
        "VANNA": (g("call_vanna_oi") + g("put_vanna_oi")) / iv30,
        "CHARM": (g("call_charm_oi") + g("put_charm_oi")) * 100 / (365 * D) / u,
        "DEX_UW_SIGN": (g("call_delta_oi") + g("put_delta_oi")) * 100 / S,
    }


def uw_fields_from_greeks(g, OI, S, iv30, right):
    """§3.3 forward: what UW would publish for one contract (used to build conversion cases)."""
    OI, S, iv30 = mpf(OI), mpf(S), mpf(iv30)
    s = 1 if right == "C" else -1
    pre = "call_" if right == "C" else "put_"
    return {
        pre + "gamma_oi": s * g["gamma"] * OI * S * S,
        pre + "delta_oi": g["delta"] * OI * S * S,
        pre + "vanna_oi": s * g["vanna"] * OI * S * iv30,
        pre + "charm_oi": s * g["charm"] * OI * S * 365,
    }


# ---- §1.5 implied vol --------------------------------------------------------------------------------------------

def bounds(S, K, T, r, b, right):
    S, K, T, r, b = map(mpf, (S, K, T, r, b))
    fwd = S * mp.exp((b - r) * T)
    pvk = K * mp.exp(-r * T)
    if right == "C":
        return max(mpf(0), fwd - pvk), fwd
    return max(mpf(0), pvk - fwd), pvk


def implied_vol(target, S, K, T, r, b, right, lo=mpf("1e-4"), hi=mpf(10)):
    """Price → σ in [1e-4, 10] with |price error| ≤ 1e-10·S, else None."""
    target, S = mpf(target), mpf(S)
    f = lambda s: price(S, K, T, s, r, b, right) - target
    flo, fhi = f(lo), f(hi)
    if flo > 0 or fhi < 0:
        return None
    a, c = mpf(lo), mpf(hi)
    while c - a > mpf("1e-45"):
        m = (a + c) / 2
        fm = f(m)
        if fm == 0:
            return m
        if fm < 0:
            a = m
        else:
            c = m
    m = (a + c) / 2
    return m if abs(f(m)) <= mpf("1e-10") * S else None


def iv_from_quote(bid, ask, S, K, T, r, b, right, tick):
    """§1.5: None when the IV is not identifiable."""
    if not (_finite(bid) and _finite(ask)):
        return None
    bid, ask = mpf(bid), mpf(ask)
    if bid <= 0 or bid >= ask:
        return None
    mid = (bid + ask) / 2
    lb, ub = bounds(S, K, T, r, b, right)
    if mid <= lb + mpf(tick) / 2 or mid >= ub:
        return None
    return implied_vol(mid, S, K, T, r, b, right)


def flat_wing(contracts):
    """contracts: list of dicts with expiry, right, strike, iv (None when not identifiable). Fills iv from the nearest
    strike of the same expiry and right with a valid iv (ties: the lower strike) and sets provenance."""
    out = []
    for c in contracts:
        c = dict(c)
        if c.get("iv") is not None:
            c["iv_prov"] = "SOLVED"
            out.append(c)
            continue
        peers = [p for p in contracts if p["expiry"] == c["expiry"] and p["right"] == c["right"] and p.get("iv") is not None]
        if not peers:
            c["iv_prov"] = "UNAVAILABLE"
        else:
            best = min(peers, key=lambda p: (abs(mpf(p["strike"]) - mpf(c["strike"])), mpf(p["strike"])))
            c["iv"] = best["iv"]
            c["iv_prov"] = "MODELED_FLAT_WING_IV"
        out.append(c)
    return out


# ---- §1.2 forwards and S* ----------------------------------------------------------------------------------------

def parity_forward(pairs, S_ref, r, T, count=6):
    """pairs: (K, call_bid, call_ask, put_bid, put_ask). Median over the `count` strikes nearest S_ref with two-sided
    quotes on both legs of K + e^{rT}(C_mid − P_mid). None with no such strike."""
    S_ref, r, T = mpf(S_ref), mpf(r), mpf(T)
    ok = []
    for K, cb, ca, pb, pa in pairs:
        if all(_finite(v) for v in (cb, ca, pb, pa)) and mpf(cb) > 0 and mpf(ca) > mpf(cb) and mpf(pb) > 0 and mpf(pa) > mpf(pb):
            ok.append((mpf(K), (mpf(cb) + mpf(ca)) / 2, (mpf(pb) + mpf(pa)) / 2))
    if not ok:
        return None
    ok.sort(key=lambda x: (abs(x[0] - S_ref), x[0]))
    near = ok[:count]
    g = mp.exp(r * T)
    fs = sorted(K + g * (c - p) for K, c, p in near)
    n = len(fs)
    return fs[n // 2] if n % 2 else (fs[n // 2 - 1] + fs[n // 2]) / 2


def implied_spot(T1, F1, TL, FL):
    T1, F1, TL, FL = map(mpf, (T1, F1, TL, FL))
    return mp.exp((TL * mp.log(F1) - T1 * mp.log(FL)) / (TL - T1))


def pick_t1_tl(forwards):
    """forwards: list of (T, F or None) for unexpired expiries. T1 nearest with a valid F; TL nearest OTHER with
    T ≥ 7 days and a valid F."""
    valid = sorted((mpf(T), mpf(F)) for T, F in forwards if F is not None and mpf(T) > 0)
    if not valid:
        return None, None
    t1 = valid[0]
    week = mpf(7) / D
    tl = next((v for v in valid[1:] if v[0] >= week), None)
    return t1, tl


def spot_and_carry(forwards, r_of_T):
    """§1.2 in full: S*, the provenance, and each expiry's (T, F_model, b_T). forwards: list of (T, F or None);
    r_of_T: callable T → r_T."""
    t1, tl = pick_t1_tl(forwards)
    if t1 is None:
        return None
    if tl is None:
        S = t1[1] * mp.exp(-mpf(r_of_T(t1[0])) * t1[0])
        prov = "APPROX"
    else:
        S = implied_spot(t1[0], t1[1], tl[0], tl[1])
        prov = "CALCULATED"
    valid = sorted((mpf(T), mp.log(mpf(F))) for T, F in forwards if F is not None and mpf(T) > 0)
    nodes = [(mpf(0), mp.log(S))] + valid
    out = []
    for T, F in forwards:
        T = mpf(T)
        if F is not None:
            lnF = mp.log(mpf(F))
        elif len(valid) == 1:
            lnF = mp.log(S) + mpf(r_of_T(T)) * T
        else:
            lo = max((n for n in nodes if n[0] <= T), key=lambda n: n[0])
            his = [n for n in nodes if n[0] >= T and n[0] > lo[0]]
            if his:
                hi = min(his, key=lambda n: n[0])
                lnF = lo[1] + (hi[1] - lo[1]) * (T - lo[0]) / (hi[0] - lo[0])
            else:
                a, c = nodes[-2], nodes[-1]
                lnF = c[1] + (c[1] - a[1]) / (c[0] - a[0]) * (T - c[0])
        out.append((T, mp.exp(lnF), (lnF - mp.log(S)) / T))
    return {"S": S, "prov": prov, "expiries": out}


# ---- §4.1 classify, §4.2 accumulate ------------------------------------------------------------------------------

CANCEL = {40, 41, 42, 43, 44}
EXT_HOURS = {1, 65, 118, 148}
COMPLEX = {35, 36, 37, 38, 124, 147} | set(range(130, 145))
CROSS = {45, 127, 128}
LATE = {2, 5, 6, 13, 15}
NO_CONDITION = 255


def classify(conditions: Iterable[int], size, price_, bid, ask, quote_age_ms):
    """§4.1 top to bottom; returns (bucket, dealer_C)."""
    cs = {int(c) for c in conditions if c is not None and int(c) != NO_CONDITION}
    size_f = float(size) if size is not None else float("nan")
    if cs & CANCEL:
        return "CANCEL", 0
    if cs & EXT_HOURS:
        return "EXCLUDED_EXT_HOURS", 0
    if cs & COMPLEX:
        return "EXCLUDED_COMPLEX", 0
    if cs & CROSS:
        return "EXCLUDED_CROSS", 0
    if not (size_f > 0) or price_ is None or not math.isfinite(float(price_)) or float(price_) <= 0:
        return "EXCLUDED_INVALID", 0
    buy = -size if "model2_buy_sign" not in MUT else size
    if 145 in cs:
        return "BUY", buy
    if 146 in cs:
        return "SELL", size
    if cs & LATE:
        return "EXCLUDED_LATE", 0
    if bid is None or ask is None or not math.isfinite(float(bid)) or not math.isfinite(float(ask)) or float(ask) <= 0 or float(bid) < 0:
        return "EXCLUDED_NO_QUOTE", 0
    if float(bid) >= float(ask):
        return "EXCLUDED_LOCKED_CROSSED", 0
    if quote_age_ms is None or not math.isfinite(float(quote_age_ms)) or quote_age_ms < 0 or quote_age_ms > 1000:
        return "EXCLUDED_STALE_QUOTE", 0
    if float(price_) >= float(ask):
        return "BUY", buy
    if float(price_) <= float(bid):
        return "SELL", size
    return "MID", 0


def accumulate(prints):
    """prints: dicts with key (root, expiry, strike, right), conditions, size, price, bid, ask, quote_age_ms, seq.
    A cancel removes the trade it cancels: by `ref` (the sequence it names) when given, else the latest earlier kept
    print of the same contract, price and size. Returns (C by key, bucket sizes, unlinked cancels)."""
    kept = []
    buckets: dict[str, float] = {}
    unlinked = 0
    for p in prints:
        bucket, c = classify(p["conditions"], p["size"], p["price"], p.get("bid"), p.get("ask"), p.get("quote_age_ms"))
        if bucket == "CANCEL":
            idx = None
            for i in range(len(kept) - 1, -1, -1):
                k = kept[i]
                if k is None:
                    continue
                if p.get("ref") is not None:
                    if k["seq"] == p["ref"]:
                        idx = i
                        break
                elif k["key"] == p["key"] and k["price"] == p["price"] and k["size"] == p["size"]:
                    idx = i
                    break
            if idx is None:
                unlinked += 1
            else:
                k = kept[idx]
                buckets[k["bucket"]] = buckets.get(k["bucket"], 0) - k["size"]
                kept[idx] = None
            buckets["CANCEL"] = buckets.get("CANCEL", 0) + p["size"]
            continue
        buckets[bucket] = buckets.get(bucket, 0) + p["size"]
        kept.append({"key": p["key"], "price": p["price"], "size": p["size"], "seq": p.get("seq"), "bucket": bucket, "C": c})
    inv: dict = {}
    for k in kept:
        if k is None:
            continue
        inv[k["key"]] = inv.get(k["key"], 0) + k["C"]
    return inv, buckets, unlinked


# ---- §4.5 board unit ---------------------------------------------------------------------------------------------

def board_unit(Ts):
    return "hour" if any(mpf(T) * D < 1 for T in Ts) else "day"
