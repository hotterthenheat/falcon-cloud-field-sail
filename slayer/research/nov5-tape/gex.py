"""Python port of Pinpoint's audited book definitions (PREREG "The book"). Line-for-line where it matters:

  core/gammaFlip.ts   dollarGammaPerContract, netGammaAt / netGammaPath, quietLegs, repricedFlip (two grids, bisection)
  data/flipLevel.ts   smileOf, the same-day ITM runaway rule of legsOfDate, stickFlip hysteresis (flip only)
  core/walls.ts       pickLegWalls;  pinpointRaw levelsOfRows' supreme (max |call + put|)
  core/settle.ts      settleOf (PM / AM / ADJUSTED roots)

Legs are a dict of numpy arrays: strike, g0 (house sign: call legs negative), iv, t, s0 (0 = none), oi (0 = none),
side (house sign of one contract: calls -1, puts +1; 0 = none), own (bool: own printed vol), t0 (0 = none).
parity/ checks this file against the TS functions themselves (tsx) to 1e-9.
"""
import math
import numpy as np

SQRT2PI = math.sqrt(2 * math.pi)
RANGE = 0.1
STEPS = 240
OUTRIGHT_D1 = 6.0
ONE_SESSION = 1 / 252
STICK_FRAC = 0.004
HOLD_READS = 3
HOLD_MS = 120_000
ITM_RUNAWAY_IV = 1.5

FIELDS = ('strike', 'g0', 'iv', 't', 's0', 'oi', 'side', 'own', 't0')


def make_legs(**kw):
    n = len(kw['strike'])
    out = {}
    for f in FIELDS:
        v = kw.get(f)
        if v is None:
            v = np.zeros(n, bool if f == 'own' else float)
        out[f] = np.asarray(v, bool if f == 'own' else float).copy()
    return out


def subset(legs, m):
    return {f: legs[f][m] for f in FIELDS}


def _d1(S, K, t, iv, r, q):
    return (np.log(S / K) + (r - q + iv * iv / 2) * t) / (iv * np.sqrt(t))


def dollar_gamma_per_contract(S, K, t, iv, r=0.0, q=0.0):
    """e^{-qT} phi(d1) / (S sigma sqrt T) * S^2 * 0.01 * 100 (0 where any input is not positive)"""
    S, K, t, iv = (np.asarray(a, float) for a in (S, K, t, iv))
    ok = (S > 0) & (K > 0) & (t > 0) & (iv > 0)
    Ss, Ks, ts, vs = (np.where(ok, a, 1.0) for a in (S, K, t, iv))
    d1 = _d1(Ss, Ks, ts, vs, r, q)
    pdf = np.exp(-(d1 * d1) / 2) / SQRT2PI
    g = np.exp(-q * ts) * (pdf / (Ss * vs * np.sqrt(ts))) * Ss * Ss * 0.01 * 100
    return np.where(ok, g, 0.0)


class Prepared:
    """netGammaPath with every S-free part of each leg worked out once (the same arithmetic as gammaFlip.ts)."""

    def __init__(self, legs, S0, r=0.0, q=0.0):
        self.r, self.q = r, q
        self.flat = 0.0
        self.empty = not len(legs['strike'])
        if self.empty:
            return
        g0, iv, t, K = legs['g0'], legs['iv'], legs['t'], legs['strike']
        oi, side, own = legs['oi'], legs['side'], legs['own']
        active = (g0 != 0) | ((oi > 0) & (side != 0))
        flat = active & ~((iv > 0) & (t > 0))
        self.flat = float(g0[flat].sum())
        live = active & ~flat
        g0, iv, t, K, oi, side, own = (a[live] for a in (g0, iv, t, K, oi, side, own))
        s0, t0 = legs['s0'][live], legs['t0'][live]
        base = np.where(s0 > 0, s0, S0)
        tb = np.where(t0 > 0, t0, t)
        a = _d1(base, K, tb, iv, r, q) if len(K) else np.zeros(0)
        out_leg = np.abs(a) > OUTRIGHT_D1
        has = out_leg & (oi > 0) & (side != 0)
        self.flat += float(g0[out_leg & ~has].sum())
        self.o = (K[has], t[has], iv[has], side[has] * oi[has])
        m = ~out_leg
        g0m, ivm, tm, Km, am, tbm, basem = g0[m], iv[m], t[m], K[m], a[m], tb[m], base[m]
        drift = (r - q + ivm * ivm / 2) * tm
        volT = ivm * np.sqrt(tm)
        lead = -q * (tm - tbm)
        tterm = np.where(tbm != tm, 0.5 * np.log(np.where(tbm != tm, tbm / tm, 1.0)), 0.0)
        self.m = (g0m, Km, drift, volT, lead + am * am / 2 + tterm, basem)
        capped = (oi[m] > 0) & (~own[m] | (tm <= ONE_SESSION))
        cap = np.maximum(np.abs(g0m), (oi[m] * Km * np.exp(-q * tm)) / (SQRT2PI * ivm * np.sqrt(tm)))
        self.cap = np.where(capped, cap, np.inf)
        self.lead = lead
        self.aterm = am * am / 2
        self.tterm = tterm

    def eval(self, prices):
        prices = np.atleast_1d(np.asarray(prices, float))
        sums = np.full(len(prices), self.flat) if not self.empty else np.zeros(len(prices))
        if self.empty:
            return sums
        P = prices[None, :]
        Ko, to, vo, so = self.o
        if len(Ko):
            sums = sums + (so[:, None] * dollar_gamma_per_contract(P, Ko[:, None], to[:, None], vo[:, None], self.r, self.q)).sum(axis=0)
        g0m, Km, drift, volT, _, basem = self.m
        if len(Km):
            if not hasattr(self, '_c'):
                # S-free parts: b = (lnS - lnK + drift)/volT ; ln = c0 + lnS - b^2/2
                self._c = ((drift - np.log(Km)) / volT, 1.0 / volT, self.lead - np.log(basem) + self.aterm + self.tterm,
                           np.isfinite(self.cap).any())
            u0, iv_t, c0, anycap = self._c
            lp = np.log(prices)
            b = u0[:, None] + np.multiply.outer(iv_t, lp)
            b *= b
            b *= -0.5
            b += c0[:, None]
            b += lp[None, :]
            np.minimum(b, 60, out=b)
            np.exp(b, out=b)
            b *= g0m[:, None]
            if anycap:
                cap = self.cap[:, None]
                with np.errstate(invalid='ignore'):
                    b = np.where(np.abs(b) > cap, np.sign(b) * cap, b)
            sums = sums + b.sum(axis=0)
        return sums


def net_gamma_path(legs, S0, prices, r=0.0, q=0.0):
    """netGammaAt at every price (netGammaPath): legs x prices, summed over legs."""
    return Prepared(legs, S0, r, q).eval(prices)


def net_gamma_at(legs, S0, S, r=0.0, q=0.0):
    return float(net_gamma_path(legs, S0, [S], r, q)[0])


def quiet_legs(legs):
    gross = np.abs(legs['g0']).sum()
    keep = (legs['oi'] > 0) & (legs['side'] != 0)
    a = np.abs(legs['g0'])
    quiet = ~keep & ((a < gross * 1e-7) | (~legs['own'] & (a < gross * 1e-5)))
    out = {f: legs[f].copy() for f in FIELDS}
    out['iv'] = np.where(quiet, 0.0, out['iv'])
    return out


def repriced_flip(legs_in, spot, r=0.0, rng=RANGE, q=0.0, fast=False):
    """core/gammaFlip.ts repricedFlip: {flip, netAtSpot, beyond, crossings}. fast=True closes each bracket with three
    vectorised 64-point refinements (64^3 = 2^18 cells) instead of 40 serial bisections: the same bracket, the flip
    within ~1e-8 of spot of the serial answer (parity/PARITY.md measures it); used for the 300k history reads."""
    net0 = float(np.sum(legs_in['g0'])) if len(legs_in['g0']) else 0.0
    # TS reduces left to right; reproduce that order exactly
    net0 = 0.0
    for v in legs_in['g0']:
        net0 += float(v)
    legs = quiet_legs(legs_in)
    if not (spot > 0) or not len(legs['strike']):
        return {'flip': None, 'netAtSpot': net0, 'beyond': None, 'crossings': []}
    lo = spot * (1 - rng)
    hi = spot * (1 + rng)
    coarse = (hi - lo) / STEPS
    w = np.where((legs['iv'] > 0) & (legs['t'] > 0), legs['iv'] * np.sqrt(np.maximum(legs['t'], 0)) * spot, np.inf)
    isb = w >= 4 * coarse
    broad, narrow = subset(legs, isb), subset(legs, ~isb)
    cx = np.array(sorted([lo + coarse * i for i in range(STEPS + 1)] + [spot]))
    PB = Prepared(broad, spot, r, q)
    PN = Prepared(narrow, spot, r, q)
    cy = PB.eval(cx)

    def broad_at(S):
        S = np.atleast_1d(np.asarray(S, float))
        k = np.searchsorted(cx, S, side='left')
        k = np.clip(k, 1, len(cx) - 1)
        x0, x1 = cx[k - 1], cx[k]
        u = np.where(x1 > x0, (S - x0) / np.where(x1 > x0, x1 - x0, 1.0), 0.0)
        v = cy[k - 1] + (cy[k] - cy[k - 1]) * u
        v = np.where(S <= cx[0], cy[0], v)
        v = np.where(S >= cx[-1], cy[-1], v)
        return v

    own_spot = bool(np.all((legs['s0'] == 0) | (legs['s0'] == spot)))
    has_narrow = len(narrow['strike']) > 0

    def at(S):
        S = np.atleast_1d(np.asarray(S, float))
        v = broad_at(S) + (PN.eval(S) if has_narrow else 0.0)
        if own_spot:
            v = np.where(S == spot, net0, v)
        return v

    def exact(S):
        S = np.atleast_1d(np.asarray(S, float))
        v = PB.eval(S) + (PN.eval(S) if has_narrow else 0.0)
        if own_spot:
            v = np.where(S == spot, net0, v)
        return v

    net_at_spot = float(at(spot)[0])
    width = math.inf
    if has_narrow:
        maxg = float(np.max(np.abs(narrow['g0'])))
        sel = np.abs(narrow['g0']) >= 0.01 * maxg
        if sel.any():
            width = float(np.min(narrow['iv'][sel] * np.sqrt(narrow['t'][sel]) * spot))
    steps = max(STEPS, min(8000, math.ceil((hi - lo) / max(1e-9, width / 2)))) if math.isfinite(width) else STEPS
    xs = np.array(sorted([lo + ((hi - lo) * i) / steps for i in range(steps + 1)] + [spot]))
    ys = at(xs)
    best, best_d, allx = None, math.inf, []

    def keep(x):
        nonlocal best, best_d
        allx.append(x)
        d = abs(x - spot)
        if d < best_d:
            best_d, best = d, x

    nz = np.flatnonzero(ys != 0)
    sg = np.sign(ys[nz])
    ch = np.flatnonzero(sg[1:] != sg[:-1])
    for c in ch:
        j, i = int(nz[c]), int(nz[c + 1])
        if i - j > 1:
            keep((float(xs[j + 1]) + float(xs[i - 1])) / 2)
            continue
        a, b = float(xs[j]), float(xs[i])
        ea, eb = float(exact(a)[0]), float(exact(b)[0])
        use_exact = ea != 0 and eb != 0 and math.copysign(1, ea) != math.copysign(1, eb)
        f = (lambda x: float(exact(x)[0])) if use_exact else (lambda x: float(at(x)[0]))
        fa = ea if use_exact else float(ys[j])
        if fast:
            fv = exact if use_exact else at
            for _ in range(3):
                g = np.linspace(a, b, 65)
                v = fv(g)
                v[0] = fa
                s0 = np.sign(v[0])
                idx = np.flatnonzero(np.sign(v[1:]) != s0)
                if not len(idx):
                    break
                k = int(idx[0]) + 1
                if v[k] == 0:
                    a = b = float(g[k])
                    break
                a, b, fa = float(g[k - 1]), float(g[k]), float(v[k - 1])
            keep((a + b) / 2)
            continue
        for _ in range(40):
            m = (a + b) / 2
            fm = f(m)
            if fm == 0:
                a = b = m
                break
            if math.copysign(1, fm) == math.copysign(1, fa):
                a, fa = m, fm
            else:
                b = m
        keep((a + b) / 2)
    beyond = None if best is None else ('short' if net_at_spot < 0 else 'long')
    return {'flip': best, 'netAtSpot': net_at_spot, 'beyond': beyond, 'crossings': allx}


# ---------------------------------------------------------------- flipLevel.ts


def smile_of(strikes, call_iv, put_iv, spot):
    """flipLevel.ts smileOf: OTM side's vol (ITM if the OTM has none), linear between strikes, flat past the ends."""
    pts = []
    for k, c, p in zip(strikes, call_iv, put_iv):
        otm, itm = (c, p) if k >= spot else (p, c)
        iv = otm if (otm and otm > 0) else (itm if (itm and itm > 0) else 0)
        if iv > 0:
            pts.append((float(k), float(iv)))
    pts.sort()
    if not pts:
        return lambda k: np.zeros_like(np.asarray(k, float))
    xk = np.array([p[0] for p in pts])
    xv = np.array([p[1] for p in pts])

    def f(k):
        k = np.asarray(k, float)
        return np.interp(k, xk, xv)  # flat beyond the ends, linear between (np.interp's clamp = smileOf's)
    return f


class StickFlip:
    """flipLevel.ts stickFlip, the flip part (no second crossing): one read per call, now in ms."""

    def __init__(self):
        self.flip = None
        self.miss = None  # (since, reads)

    def read(self, rd, spot, now):
        xs = rd['crossings'] or ([rd['flip']] if rd['flip'] is not None else [])
        tol = STICK_FRAC * spot
        kept = flip = rd['flip']
        miss = None
        if self.flip is not None:
            near = min(xs, key=lambda x: abs(x - self.flip)) if xs else None
            if near is not None and abs(near - self.flip) <= tol:
                kept = flip = near
            else:
                since = self.miss[0] if self.miss else now
                reads = (self.miss[1] if self.miss else 0) + 1
                miss = (since, reads)
                flip = near
                if reads >= HOLD_READS and now - since >= HOLD_MS:
                    kept = flip = rd['flip']
                    miss = None
                else:
                    kept = self.flip
        self.flip, self.miss = kept, miss
        return flip


def runaway_scale(g0, own_iv, wing, at, strike, t, itm):
    """legsOfDate: a same-day ITM leg whose own vol is a runaway (> 1.5 and wing < 0.7 own) is scaled to the smile's vol.
    Vectorised; returns (g0', iv', own')."""
    cond = itm & (t <= 1 / 252) & (at > 0) & (own_iv > ITM_RUNAWAY_IV) & (wing > 0) & (wing < own_iv * 0.7)
    g1 = dollar_gamma_per_contract(at, strike, t, np.where(cond, wing, 1.0))
    g2 = dollar_gamma_per_contract(at, strike, t, np.where(cond, own_iv, 1.0))
    ok = cond & (g2 > 0)
    g = np.where(ok, g0 * np.minimum(1, g1 / np.where(g2 > 0, g2, 1)), g0)
    return g, np.where(ok, wing, own_iv), ~ok


# ---------------------------------------------------------------- walls.ts, levelsOfRows


def pick_leg_walls(strikes, call_vals, put_vals):
    cw = pw = None
    ca = pa = 0.0
    for k, c, p in zip(strikes, call_vals, put_vals):
        c, p = abs(c), abs(p)
        if c > ca:
            ca, cw = c, k
        if p > pa:
            pa, pw = p, k
    return {'callWall': cw, 'putWall': pw}


def levels_of_rows(strikes, c, p):
    """pinpointRaw levelsOfRows: net, walls, supreme (vendor sign rows)"""
    net, cw, pw, sup = 0.0, (0, 0.0), (0, 0.0), (0, 0.0)
    for k, a, b in zip(strikes, c, p):
        net += a + b
        if abs(a) > cw[1]:
            cw = (k, abs(a))
        if abs(b) > pw[1]:
            pw = (k, abs(b))
        if abs(a + b) > sup[1]:
            sup = (k, abs(a + b))
    return {'net': net, 'callWall': cw[0], 'putWall': pw[0], 'supreme': sup[0]}


# ---------------------------------------------------------------- settle.ts

INDEX_ROOTS = {'SPX': (('SPX',), ('SPXW',)), 'NDX': (('NDX',), ('NDXP',)), 'RUT': (('RUT',), ('RUTW',)),
               'DJX': (('DJX',), ()), 'VIX': (('VIX', 'VIXW'), ())}
INDEX_OF = {'SPXW': 'SPX', 'NDXP': 'NDX', 'RUTW': 'RUT', 'VIXW': 'VIX'}


def settle_of(ticker, root):
    t = ticker.strip().upper()
    name = INDEX_OF.get(t, t)
    r = root.strip().upper()
    if name in INDEX_ROOTS:
        am, pm = INDEX_ROOTS[name]
        return 'AM' if r in am else 'PM' if r in pm else 'ADJUSTED'
    if r == name or r == name.replace('.', '').replace('-', '').replace('/', ''):
        return 'PM'
    return 'ADJUSTED'
