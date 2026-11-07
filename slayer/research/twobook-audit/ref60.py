"""Independent audit implementation of TWO_BOOK_SPEC_V2 (slayer/docs/TWO_BOOK_SPEC_V2.md).

Written from the spec text alone. Every function takes a numeric backend `B`:
  MP  : mpmath at 60 significant digits (the audit reference)
  F64 : IEEE double with math.erfc (a plain double-precision twin, used to judge
        conditioning and to run Test 3 the way a production double implementation would)

Section map
  §1.1  t_years_from_minutes, settlement_instant, t_years_between
  §1.2  parity_forward, implied_spot
  §1.3  N, phi, d1d2, price
  §1.4  greeks
  §1.5  contract_status, no_arb_bounds, implied_vol, iv_from_quote, flat_wing_fill
  §3.3  uw_fields_from_greeks          (forward direction, used to build test rows)
  §3.4  uw_row_population, uw_to_slayer
  §3.5 / §4.4  exposures
  §4.1  classify, §4.2 accumulate
  §4.5  board_time_unit, apply_time_unit
  §5    hedge, hedge_in_instrument, total_gex_change_1pct
Reading choices for under-specified points are labelled [A<n>] and listed in AMBIGUITIES.md.
"""
from __future__ import annotations

import math
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

import mpmath as mp

mp.mp.dps = 60

D = 365                      # §1.1: days per year for T and every per-day conversion
MIN_PER_YEAR = D * 1440
ET = ZoneInfo("America/New_York")


# --------------------------------------------------------------------------- backends
class _MP:
    name = "mp"

    @staticmethod
    def f(x):
        if isinstance(x, str):
            return mp.mpf(x)
        return mp.mpf(x)

    exp = staticmethod(mp.exp)
    log = staticmethod(mp.log)
    sqrt = staticmethod(mp.sqrt)
    erfc = staticmethod(mp.erfc)
    pi = mp.pi

    @staticmethod
    def isfinite(x):
        try:
            return bool(mp.isfinite(mp.mpf(x)))
        except Exception:
            return False


class _F64:
    name = "f64"
    f = staticmethod(float)
    exp = staticmethod(math.exp)
    log = staticmethod(math.log)
    sqrt = staticmethod(math.sqrt)
    erfc = staticmethod(math.erfc)
    pi = math.pi

    @staticmethod
    def isfinite(x):
        try:
            return math.isfinite(float(x))
        except Exception:
            return False


MP = _MP()
F64 = _F64()


def _exp(B, x):
    # math.exp overflows above ~709; mpmath never does. Only reached for absurd inputs.
    try:
        return B.exp(x)
    except OverflowError:
        return math.inf


# --------------------------------------------------------------------------- §1.1 time
def t_years_from_minutes(B, minutes):
    return B.f(minutes) / (D * 1440)


# Root settlement table [A11]. AM-settled roots settle to an opening value: T runs to 09:30 ET.
AM_SETTLED_ROOTS = {"SPX", "NDX", "RUT", "XEO", "OEX", "DJX", "VIX"}


def settlement_instant(root: str, expiration: date) -> datetime:
    hhmm = time(9, 30) if root.upper() in AM_SETTLED_ROOTS else time(16, 0)
    return datetime.combine(expiration, hhmm, tzinfo=ET)


def calendar_minutes_between(now: datetime, settle: datetime):
    """Real elapsed minutes (UTC instants), so a DST change is not a 60-minute jump [A12]."""
    return (settle.astimezone(timezone.utc) - now.astimezone(timezone.utc)).total_seconds() / 60.0


def t_years_between(B, now: datetime, root: str, expiration: date):
    return t_years_from_minutes(B, calendar_minutes_between(now, settlement_instant(root, expiration)))


# --------------------------------------------------------------------------- §1.3 pricing
def N(B, x):
    return B.erfc(-x / B.sqrt(B.f(2))) / 2


def phi(B, x):
    return _exp(B, -x * x / 2) / B.sqrt(2 * B.pi)


def d1d2(B, S, K, sig, T, b):
    S, K, sig, T, b = (B.f(v) for v in (S, K, sig, T, b))
    sq = B.sqrt(T)
    vs = sig * sq
    d1 = (B.log(S / K) + (b + sig * sig / 2) * T) / vs
    return d1, d1 - vs


def price(B, S, K, sig, T, r, b, right):
    S, K, sig, T, r, b = (B.f(v) for v in (S, K, sig, T, r, b))
    d1, d2 = d1d2(B, S, K, sig, T, b)
    ec = _exp(B, (b - r) * T)
    df = _exp(B, -r * T)
    if right == "C":
        return S * ec * N(B, d1) - K * df * N(B, d2)
    return K * df * N(B, -d2) - S * ec * N(B, -d1)


# --------------------------------------------------------------------------- §1.4 Greeks
GREEK_NAMES = ("delta", "gamma", "vega", "vanna", "vomma", "charm", "color_T", "speed", "veta_T", "zomma")


def greeks(B, S, K, sig, T, r, b, right):
    S, K, sig, T, r, b = (B.f(v) for v in (S, K, sig, T, r, b))
    sq = B.sqrt(T)
    vs = sig * sq
    d1 = (B.log(S / K) + (b + sig * sig / 2) * T) / vs
    d2 = d1 - vs
    ph = phi(B, d1)
    ec = _exp(B, (b - r) * T)
    dd1dT = b / vs - d2 / (2 * T)
    if right == "C":
        delta = ec * N(B, d1)
        charm = -ec * (ph * dd1dT + (b - r) * N(B, d1))
    else:
        delta = -ec * N(B, -d1)
        charm = -ec * (ph * dd1dT - (b - r) * N(B, -d1))
    gamma = ec * ph / (S * vs)
    vega = S * ec * ph * sq
    vanna = -ec * ph * d2 / sig
    vomma = vega * d1 * d2 / sig
    color_T = gamma * ((b - r) + (d1 * d2 - 1) / (2 * T) - b * d1 / vs)
    speed = -gamma / S * (1 + d1 / vs)
    veta_T = vega * ((b - r) + (1 + d1 * d2) / (2 * T) - b * d1 / vs)
    zomma = gamma * (d1 * d2 - 1) / sig
    return {
        "d1": d1, "d2": d2, "price": price(B, S, K, sig, T, r, b, right),
        "delta": delta, "gamma": gamma, "vega": vega, "vanna": vanna, "vomma": vomma,
        "charm": charm, "color_T": color_T, "speed": speed, "veta_T": veta_T, "zomma": zomma,
    }


# --------------------------------------------------------------------------- §1.5 status / IV
def contract_status(B, S, K, sig, T):
    """UNAVAILABLE / EXPIRED / OK. sig may be None when the IV is still to be solved [A15]."""
    for v in (S, K, T):
        if v is None or not B.isfinite(v):
            return "UNAVAILABLE"
    if B.f(S) <= 0 or B.f(K) <= 0:
        return "UNAVAILABLE"
    if B.f(T) <= 0:
        return "EXPIRED"
    if sig is not None and (not B.isfinite(sig) or B.f(sig) <= 0):
        return "UNAVAILABLE"
    return "OK"


def no_arb_bounds(B, S, K, T, r, b, right):
    """European bounds of the generalized BSM price (limits sigma->0 and sigma->inf) [A9]."""
    S, K, T, r, b = (B.f(v) for v in (S, K, T, r, b))
    fwd_pv = S * _exp(B, (b - r) * T)
    k_pv = K * _exp(B, -r * T)
    if right == "C":
        return max(B.f(0), fwd_pv - k_pv), fwd_pv
    return max(B.f(0), k_pv - fwd_pv), k_pv


SIG_LO, SIG_HI = 1e-4, 10.0


def implied_vol(B, target, S, K, T, r, b, right):
    """Root of price(sigma) = target on [1e-4, 10]; None if no bracket or no convergence."""
    S, K, T, r, b, target = (B.f(v) for v in (S, K, T, r, b, target))
    lo, hi = B.f(SIG_LO), B.f(SIG_HI)
    plo = price(B, S, K, lo, T, r, b, right) - target
    phi_ = price(B, S, K, hi, T, r, b, right) - target
    if plo > 0 or phi_ < 0:
        return None, "NO_BRACKET"
    if plo == 0:
        return lo, "OK"
    if phi_ == 0:
        return hi, "OK"
    # bisection to a tight bracket, then Newton (vega) polish; works for both backends
    iters = 400 if B is MP else 200
    for _ in range(iters):
        mid = (lo + hi) / 2
        pm = price(B, S, K, mid, T, r, b, right) - target
        if pm == 0:
            lo = hi = mid
            break
        if pm < 0:
            lo = mid
        else:
            hi = mid
        if hi - lo <= (B.f("1e-55") if B is MP else 0.0):
            break
        if B is F64 and (hi - lo) <= 4e-16 * hi:
            break
    sig = (lo + hi) / 2
    for _ in range(8):
        g = greeks(B, S, K, sig, T, r, b, right)
        err = g["price"] - target
        if g["vega"] == 0:
            break
        nxt = sig - err / g["vega"]
        if not (B.f(SIG_LO) <= nxt <= B.f(SIG_HI)):
            break
        sig = nxt
    err = price(B, S, K, sig, T, r, b, right) - target
    if abs(err) > B.f("1e-10") * S:
        return None, "NO_CONVERGENCE"
    return sig, "OK"


# Default tick table [A8]. Callers may pass an explicit tick instead.
def default_tick(root: str, px: float) -> float:
    root = root.upper()
    if root in {"SPX", "SPXW", "NDX", "NDXP", "RUT", "RUTW"}:
        return 0.05 if px < 3.0 else 0.10
    if root in {"SPY", "QQQ", "IWM", "XSP"}:
        return 0.01
    return 0.01 if px < 3.0 else 0.05   # penny-program equity default


def iv_from_quote(B, bid, ask, S, K, T, r, b, right, tick):
    """§1.5: returns (iv or None, reason). reason 'OK' or the first failing rule."""
    if bid is None or ask is None or not (B.isfinite(bid) and B.isfinite(ask)):
        return None, "NO_QUOTE"
    bid, ask = B.f(bid), B.f(ask)
    if bid == 0:
        return None, "BID_ZERO"
    if bid < 0:
        return None, "NO_QUOTE"
    if bid >= ask:
        return None, "LOCKED_CROSSED"
    mid = (bid + ask) / 2
    lo, hi = no_arb_bounds(B, S, K, T, r, b, right)
    if mid <= lo + B.f(tick) / 2:
        return None, "BELOW_LOWER_BOUND"
    if mid >= hi:
        return None, "ABOVE_UPPER_BOUND"
    return implied_vol(B, mid, S, K, T, r, b, right)


def flat_wing_fill(B, contracts, S_ref):
    """contracts: list of {K, iv or None} of ONE (expiration, right).
    Fills each None with the valid IV of the nearest strike; tie -> the strike nearer to S_ref,
    then the lower strike [A10]. Returns list of (iv or None, provenance)."""
    valid = [(c["K"], c["iv"]) for c in contracts if c["iv"] is not None]
    out = []
    for c in contracts:
        if c["iv"] is not None:
            out.append((c["iv"], "SOLVED"))
            continue
        if not valid:
            out.append((None, "UNAVAILABLE"))
            continue
        K = B.f(c["K"])
        best = min(valid, key=lambda kv: (abs(B.f(kv[0]) - K), abs(B.f(kv[0]) - B.f(S_ref)), B.f(kv[0])))
        out.append((best[1], "MODELED_FLAT_WING_IV"))
    return out


# --------------------------------------------------------------------------- §1.2 forwards
def _two_sided(B, bid, ask):
    return (bid is not None and ask is not None and B.isfinite(bid) and B.isfinite(ask)
            and B.f(bid) > 0 and B.f(ask) > B.f(bid))


def median(vals):
    v = sorted(vals)
    n = len(v)
    if n % 2:
        return v[n // 2]
    return (v[n // 2 - 1] + v[n // 2]) / 2     # [A1] even count: mean of the middle two


def parity_forward(B, quotes, S_ref, r, T):
    """quotes: list of {K, cb, ca, pb, pa} (call/put bid/ask). Median over the (up to) 6 strikes
    nearest S_ref with two-sided call AND put quotes [A2][A3][A4]. None if no valid forward."""
    elig = [q for q in quotes if _two_sided(B, q["cb"], q["ca"]) and _two_sided(B, q["pb"], q["pa"])]
    if not elig:
        return None
    Sr = B.f(S_ref)
    elig.sort(key=lambda q: (abs(B.f(q["K"]) - Sr), B.f(q["K"])))
    g = _exp(B, B.f(r) * B.f(T))
    vals = []
    for q in elig[:6]:
        cm = (B.f(q["cb"]) + B.f(q["ca"])) / 2
        pm = (B.f(q["pb"]) + B.f(q["pa"])) / 2
        vals.append(B.f(q["K"]) + g * (cm - pm))
    F = median(vals)
    if not (F > 0):
        return None
    return F


SEVEN_DAYS = 7 / 365


def implied_spot(B, expiries):
    """expiries: list of {id, T, r, quotes, S_ref} (or {id, T, r, F} with F given directly / None).
    Returns dict(S_star, provenance, per_expiry={id: {F, b, source}}) per §1.2 [A5][A6][A7]."""
    rows = []
    for e in expiries:
        T = B.f(e["T"])
        if not (T > 0):
            continue                                   # expired: excluded
        F = e["F"] if "F" in e else parity_forward(B, e["quotes"], e["S_ref"], e["r"], e["T"])
        rows.append({"id": e["id"], "T": T, "r": B.f(e["r"]), "F": None if F is None else B.f(F)})
    rows.sort(key=lambda x: x["T"])
    valid = [x for x in rows if x["F"] is not None]
    if not valid:
        return {"S_star": None, "provenance": "UNAVAILABLE", "per_expiry": {}}
    t1 = valid[0]
    tl = None
    for x in valid[1:]:
        if x["T"] >= B.f(7) / 365:
            tl = x
            break
    if tl is not None:
        T1, TL = t1["T"], tl["T"]
        lnS = (TL * B.log(t1["F"]) - T1 * B.log(tl["F"])) / (TL - T1)
        S_star = _exp(B, lnS)
        prov = "EXACT"
    else:
        S_star = t1["F"] * _exp(B, -t1["r"] * t1["T"])      # fallback
        prov = "APPROX"
    lnS = B.log(S_star)
    nodes = [(B.f(0), lnS)] + [(x["T"], B.log(x["F"])) for x in valid]
    per = {}
    for x in rows:
        T = x["T"]
        if x["F"] is not None:
            lnF, src = B.log(x["F"]), "PARITY"
        else:
            # piecewise linear in T through (0, ln S*) and every valid forward; beyond the last
            # valid expiry, extend the last segment
            j = None
            for i in range(1, len(nodes)):
                if T <= nodes[i][0]:
                    j = i
                    break
            if j is None:
                (ta, la), (tb, lb) = nodes[-2], nodes[-1]
                src = "EXTRAPOLATED"
            else:
                (ta, la), (tb, lb) = nodes[j - 1], nodes[j]
                src = "INTERPOLATED"
            lnF = la + (lb - la) * (T - ta) / (tb - ta)
        per[x["id"]] = {"F": _exp(B, lnF), "b": (lnF - lnS) / T, "T": T, "source": src}
    return {"S_star": S_star, "provenance": prov, "per_expiry": per,
            "T1": t1["id"], "TL": None if tl is None else tl["id"]}


# --------------------------------------------------------------------------- exposures §4.4/§3.5
EXPOSURE_NAMES = ("GEX", "DEX", "VEGA", "VANNA", "CHARM", "VOMMA", "COLOR", "SPEED", "VETA", "ZOMMA")


def exposures(B, g, C, M, S):
    C, M, S = B.f(C), B.f(M), B.f(S)
    pct, bp = B.f("0.01"), B.f("0.0001")
    return {
        "GEX": g["gamma"] * C * M * S * S * pct,
        "DEX": g["delta"] * C * M * S,
        "VEGA": g["vega"] * C * M * pct,
        "VANNA": g["vanna"] * C * M * S * pct,
        "CHARM": g["charm"] * C * M * S / D,
        "VOMMA": g["vomma"] * C * M * bp,
        "COLOR": -g["color_T"] * C * M * S * S * pct / D,
        "SPEED": g["speed"] * C * M * S * S * S * bp,
        "VETA": -g["veta_T"] * C * M * pct / D,
        "ZOMMA": g["zomma"] * C * M * S * S * bp,
    }


def total_gex_change_1pct(B, g, C, M, S):
    C, M, S = B.f(C), B.f(M), B.f(S)
    return C * M * B.f("0.0001") * (g["speed"] * S ** 3 + 2 * g["gamma"] * S ** 2)


def total_gex_change_1pct_closed(B, g, C, M, S, sig, T):
    C, M, S, sig, T = (B.f(v) for v in (C, M, S, sig, T))
    return C * M * B.f("0.0001") * g["gamma"] * S ** 2 * (1 - g["d1"] / (sig * B.sqrt(T)))


# --------------------------------------------------------------------------- §5 hedge
def hedge(B, g, C, M, S):
    C, M, S = B.f(C), B.f(M), B.f(S)
    ddu = g["delta"] * C * M
    dex = g["delta"] * C * M * S
    return {
        "dealer_delta_units": ddu,
        "hedge_units": -ddu,
        "dealer_dex": dex,
        "hedge_dollars": -dex,
        "hedge_units_change_1pct": -g["gamma"] * C * M * B.f("0.01") * S,
        "speed_gex_component": g["speed"] * C * M * S ** 3 * B.f("0.0001"),
    }


INSTRUMENT_MULT = {"SPY": 1, "ES": 50, "MES": 5}


def hedge_in_instrument(B, hedge_dollars, instrument_price, instrument_multiplier):
    return B.f(hedge_dollars) / (B.f(instrument_price) * B.f(instrument_multiplier))


# --------------------------------------------------------------------------- §4.5 time unit
def board_time_unit(B, Ts):
    """Ts: T (years) of every contract in the board's current filter that enters the sums
    (C != 0, not EXPIRED/UNAVAILABLE) [A16]. 'hour' if any T < 1 day."""
    one_day = B.f(1) / D
    return "hour" if any(B.f(T) < one_day for T in Ts) else "day"


def apply_time_unit(B, exp, unit):
    out = dict(exp)
    if unit == "hour":
        for k in ("CHARM", "COLOR", "VETA"):
            out[k] = exp[k] / 24
    return out


# --------------------------------------------------------------------------- §3.3 / §3.4 UW
def uw_fields_from_greeks(B, right, delta, gamma, vanna, charm, OI, S, IV30):
    """§3.3 measured formulas (forward direction). Returns the four UW _oi fields of ONE contract."""
    delta, gamma, vanna, charm, OI, S, IV30 = (B.f(v) for v in (delta, gamma, vanna, charm, OI, S, IV30))
    sg = 1 if right == "C" else -1
    return {
        "gamma_oi": sg * gamma * OI * S * S,
        "delta_oi": delta * OI * S * S,           # puts NOT negated
        "vanna_oi": sg * vanna * OI * S * IV30,
        "charm_oi": sg * charm * OI * S * 365,
    }


def uw_to_slayer(B, call_gamma_oi, put_gamma_oi, call_delta_oi, put_delta_oi,
                 call_vanna_oi, put_vanna_oi, call_charm_oi, put_charm_oi, S, IV30):
    S, IV30 = B.f(S), B.f(IV30)
    cg, pg, cd, pd, cv, pv, cc, pc = (B.f(v) for v in (call_gamma_oi, put_gamma_oi, call_delta_oi, put_delta_oi,
                                                        call_vanna_oi, put_vanna_oi, call_charm_oi, put_charm_oi))
    return {
        "GEX": cg + pg,
        "DEX": (cd - pd) * 100 / S,
        "VANNA": (cv + pv) / IV30,
        "CHARM": (cc + pc) * 100 / (365 * D),
        "DEX_UW_OWN_SIGN": (cd + pd) * 100 / S,    # OBSERVED secondary value
    }


def uw_row_population(snapshot_et: datetime, expiration: date, am_settlement_day: bool):
    """§3.4 step 2: 'DROP', 'FLAG_AM' or 'INCLUDE'. Drop rule wins over the AM flag [A13]."""
    snap = snapshot_et.astimezone(ET)
    sd = snap.date()
    if expiration < sd:
        return "DROP"
    if expiration == sd and snap.time() >= time(16, 0):
        return "DROP"
    if expiration == sd and am_settlement_day and snap.time() >= time(9, 30):
        return "FLAG_AM"
    return "INCLUDE"


# --------------------------------------------------------------------------- §4.1 classifier
CANCEL = {40, 41, 42, 43, 44}
EXT_HOURS = {1, 65, 118, 148}
COMPLEX = {35, 36, 37, 38, 124, 147} | set(range(130, 145))
CROSS = {45, 127, 128}
LATE = {2, 5, 6, 13, 15}


def _fin(x):
    try:
        return x is not None and math.isfinite(float(x))
    except Exception:
        return False


def classify(p):
    """p: {condition, size, price, bid, ask, trade_ts_ms, quote_ts_ms}. Returns (bucket, dealer_C)."""
    c = p.get("condition")
    size = p.get("size")
    px = p.get("price")
    if c in CANCEL:
        return "CANCEL", 0
    if c in EXT_HOURS:
        return "EXCLUDED_EXT_HOURS", 0
    if c in COMPLEX:
        return "EXCLUDED_COMPLEX", 0
    if c in CROSS:
        return "EXCLUDED_CROSS", 0
    # size must be a finite positive number [A18]
    if not _fin(size) or size <= 0 or not _fin(px) or px <= 0:
        return "EXCLUDED_INVALID", 0
    if c == 145:
        return "BUY", -size
    if c == 146:
        return "SELL", +size
    if c in LATE:
        return "EXCLUDED_LATE", 0
    bid, ask = p.get("bid"), p.get("ask")
    if not _fin(bid) or not _fin(ask) or ask <= 0 or bid < 0:
        return "EXCLUDED_NO_QUOTE", 0
    if bid >= ask:
        return "EXCLUDED_LOCKED_CROSSED", 0
    tts, qts = p.get("trade_ts_ms"), p.get("quote_ts_ms")
    if not _fin(tts) or not _fin(qts):
        return "EXCLUDED_STALE_QUOTE", 0          # [A19] unknown age treated as stale
    age = tts - qts
    if age < 0 or age > 1000:
        return "EXCLUDED_STALE_QUOTE", 0
    if px >= ask:
        return "BUY", -size
    if px <= bid:
        return "SELL", +size
    return "MID", 0


def accumulate(prints):
    """§4.2 with cancel linking [A17]. prints in arrival order; each has contract (hashable), seq,
    and cancels carry ref_seq = seq of the print they cancel on the same contract.
    Returns (C by contract, buckets list, unlinked_cancel_seqs)."""
    C = {}
    live = {}            # (contract, seq) -> dealer contribution, still cancellable
    buckets = []
    unlinked = []
    for p in prints:
        bucket, dc = classify(p)
        buckets.append(bucket)
        key = p["contract"]
        if bucket == "CANCEL":
            ref = (key, p.get("ref_seq"))
            if p.get("ref_seq") is None or ref not in live:
                unlinked.append(p.get("seq"))
                continue
            C[key] = C.get(key, 0) - live.pop(ref)
            continue
        live[(key, p.get("seq"))] = dc
        if dc != 0:
            C[key] = C.get(key, 0) + dc
        else:
            C.setdefault(key, C.get(key, 0))
    return C, buckets, unlinked
