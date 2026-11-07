"""EDGE0DTE Stage 1, family C (options microstructure): C1-C7 features plus the B6 control used by X11.

Every feature is ONE registered function of (sess, t) (lib.panel @feature), so the registry's leakage test applies;
families/c_test_leakage.py runs it with the flow data truncated as well (lib's Session.truncated does not know the
flow table). Exact definitions (fixed before any outcome is computed; see results/stage1/C.md):

Flow (OBS/CALC, v2data/edge0dte/flow/{SPXW,SPY}/D.parquet): flow minute index m covers 09:30+m and is usable at
t >= 60 * (571 + m). Below, mm = 570 + m is the minute of day; a window of W minutes ending at t is
mm in [t//60 - W, t//60 - 1].

C1  vc, vp = 0DTE call / put contract volume (ALL kept prints: single-leg, multi-leg, late and bad-quote) in the last
    15 min; rc = vc / median(vc over the prior 20 root expiry sessions with flow, same minutes), rp likewise (>= 10
    prior sessions, median > 0). Event at threshold X: max(rc, rp) > X; direction = +1 if rc > rp else -1.
C2  delta flow DF = sum over classified single-leg prints of (vol_buy - vol_sell) * delta * 100 (quote rule, at-mid,
    multi-leg, late and bad-quote prints excluded). delta = Black-76 delta of the contract from the board snapshot
    stamped at the END of the print's minute (mm + 1, usable at t >= 60(mm+1)), forward F and T of that snapshot, IV =
    the snapshot's call-equivalent (parity) IV interpolated linearly in strike over the strikes with a finite IV, flat
    beyond the quoted band. If that snapshot has no smile, the latest earlier snapshot within 5 min is used.
    Standardised: DF_W(t) / RMS(DF_W at the same t over the prior 20 root expiry sessions with flow, >= 10). Sign kept.
C3  per snapshot: near-ATM contracts with a valid quote and |delta| in [0.20, 0.50] (own-right IV, as
    Session.select_delta); imb_call = (sum bid size - sum ask size) / (sum of both), imb_put likewise;
    c3 = imb_call - imb_put. Feature = mean over the snapshots stamped in (t//60 - W, t//60] (>= W/2 present).
C4  dIV = IV_atm(t) - IV_atm(t - L); dlnS = ln S(t) / S(t - L). Fit dIV = a + b dlnS by OLS on the grid points of the
    prior 20 root expiry sessions (panel values, >= 10 sessions, >= 50 pairs). Residual = dIV - a - b dlnS.
C5  skew(t) = IV of the 25-delta put minus IV of the 25-delta call at the snapshot <= t: own-right IVs of OTM strikes
    (put k < F, call k > F), linear interpolation in |delta| (no extrapolation). Feature = skew(t) - skew(t - L).
C6  OI_D = OI published for D (before the open) of the D expiry; OI_{D-1} = the D expiry's OI in the file published
    on the previous NYSE session (strict: N/A when that session has no OI file or the expiry is absent). Strikes
    within +/- p of the session open (first 1-minute bar's open, usable at t >= 09:31). raw = dOI_put - dOI_call
    (strikes missing on one date count as OI 0); norm = raw / (OI_D puts + calls in the band).
C7  per snapshot: median (ask - bid) / mid over near-ATM contracts (|delta| 0.20-0.50, valid quotes, both rights);
    ratio = value(t) / median(value at the same minute over the prior 20 root expiry sessions, >= 10).
B6 control (for X11): z5 = ln(S(t)/S(t-5m)) / (IV_atm(t) sqrt(5m)); b6 = sign(z5) when |z5| > 2 AND the 5-min and
    15-min returns share the sign AND |r5|/5 > |r15|/15 (per-minute acceleration), else 0.
"""
import bisect
import functools
import math
import os

import numpy as np
import pandas as pd

from lib import bs
from lib.cal import expiry_sessions, prev_sessions
from lib.config import DATA, YEAR_MIN
from lib.data import oi as load_oi
from lib.panel import feature

FLOW = os.path.join(DATA, 'flow')
NPRIOR, MINPRIOR = 20, 10
NAN = float('nan')

# day-level stores of per-minute values already computed for a COMPLETED earlier session (filled by the driver after
# it finishes a session; only ever read for days < the current day)
STORE = {'df': {}, 'c7': {}}


# ------------------------------------------------------------------ helpers

@functools.lru_cache(maxsize=8)
def _exp_list(root):
    return tuple(expiry_sessions(root))


def prior_expiry(root, day, n=NPRIOR):
    s = _exp_list(root)
    i = bisect.bisect_left(s, day)
    return list(s[max(0, i - n):i])


@functools.lru_cache(maxsize=48)
def _flow_file(root, day):
    f = os.path.join(FLOW, root, f'{day}.parquet')
    if not os.path.exists(f):
        return None
    x = pd.read_parquet(f, columns=['m', 'strike', 'right', 'volume', 'vol_buy', 'vol_sell'])
    x['mm'] = 570 + x.m.astype(np.int32)
    x['net'] = (x.vol_buy - x.vol_sell).astype(np.float64)
    return x.sort_values(['mm', 'strike', 'right']).reset_index(drop=True)


def flow(sess):
    """The session's flow rows (whole day as stored). Callers slice to mm + 1 <= t // 60. The leakage test sets
    sess._flow to the truncated table."""
    if not hasattr(sess, '_flow'):
        sess._flow = _flow_file(sess.root, sess.day)
    return sess._flow


def has_flow(root, day):
    return os.path.exists(os.path.join(FLOW, root, f'{day}.parquet'))


def _cp_minute(f):
    """Per-minute call and put volume arrays (index mm - 570, 390 minutes) from a flow table."""
    vc = np.zeros(390)
    vp = np.zeros(390)
    if f is not None and len(f):
        i = f.mm.values - 570
        c = f.right.values == 1
        np.add.at(vc, i[c], f.volume.values[c])
        np.add.at(vp, i[~c], f.volume.values[~c])
    return vc, vp


@functools.lru_cache(maxsize=64)
def _cp_prior(root, day):
    return _cp_minute(_flow_file(root, day))


# ------------------------------------------------------------------ C1 unusual volume

@feature('c1', 'CALC')
def c1(sess, t):
    out = {'vc': NAN, 'vp': NAN, 'rc': NAN, 'rp': NAN}
    f = flow(sess)
    if f is None:
        return out
    m1 = t // 60 - 1
    m0 = m1 - 14
    if m0 < 570:
        return out
    u = f[(f.mm.values >= m0) & (f.mm.values <= m1) & (f.mm.values + 1 <= t // 60)]
    vc = float(u.volume.values[u.right.values == 1].sum())
    vp = float(u.volume.values[u.right.values == 0].sum())
    out['vc'], out['vp'] = vc, vp
    hc, hp = [], []
    for d in prior_expiry(sess.root, sess.day):
        if not has_flow(sess.root, d):
            continue
        a, b = _cp_prior(sess.root, d)
        hc.append(a[m0 - 570:m1 - 570 + 1].sum())
        hp.append(b[m0 - 570:m1 - 570 + 1].sum())
    if len(hc) >= MINPRIOR:
        mc, mp = float(np.median(hc)), float(np.median(hp))
        out['rc'] = vc / mc if mc > 0 else NAN
        out['rp'] = vp / mp if mp > 0 else NAN
    return out


# ------------------------------------------------------------------ C2 aggressive delta flow

def _smile_back(sess, mm, back=5):
    """Smile of the snapshot stamped mm, else the latest earlier one within `back` minutes (all stamped <= mm)."""
    for x in range(mm, mm - back - 1, -1):
        sm = sess.smile(x * 60)
        if sm is not None:
            return sm
    return None


def _df_minute(sess, mm):
    """Delta flow of the prints in minute mm (delta from the snapshot stamped mm + 1). Cached on the session."""
    cache = sess.__dict__.setdefault('_dfc', {})
    if mm in cache:
        return cache[mm]
    f = flow(sess)
    val = 0.0
    if f is not None and len(f):
        if '_dfidx' not in sess.__dict__ or sess._dfidx[0] is not f:
            sess._dfidx = (f, f.mm.values)
        mmv = sess._dfidx[1]
        a, z = np.searchsorted(mmv, mm, 'left'), np.searchsorted(mmv, mm, 'right')
        g = f.iloc[a:z]
        g = g[g.net.values != 0]
        if len(g):
            sm = _smile_back(sess, mm + 1)
            if sm is None:
                val = NAN
            else:
                fin = np.isfinite(sm.iv.values)
                if fin.sum() < 2:
                    val = NAN
                else:
                    kf, ivf = sm.k.values[fin], sm.iv.values[fin]
                    k = g.strike.values.astype(float)
                    iv = np.interp(k, kf, ivf)
                    F, T = float(sm.F.iloc[0]), float(sm.Tyr.iloc[0])
                    dl = bs.delta(F, k, T, iv, g.right.values == 1)
                    val = float(np.sum(g.net.values * dl * 100.0))
    cache[mm] = val
    return val


def _df_window(get, t, W):
    m1 = t // 60 - 1
    vals = [get(mm) for mm in range(m1 - W + 1, m1 + 1) if mm >= 570]
    if not vals:
        return NAN
    v = np.array(vals, float)
    if np.isnan(v).sum() > 0.1 * len(v):
        return NAN
    return float(np.nansum(v))


def _df_prior_series(root, day):
    """Per-minute delta flow of a completed earlier session (store first, else computed from that session)."""
    key = (root, day)
    if key in STORE['df']:
        return STORE['df'][key]
    from lib.panel import session
    s = session(root, day)
    s._flow = _flow_file(root, day)
    d = {mm: _df_minute(s, mm) for mm in range(570, 931)}
    STORE['df'][key] = d
    return d


@feature('c2', 'CALC')
def c2(sess, t):
    out = {}
    if flow(sess) is None:
        return {f'{k}{W}': NAN for W in (5, 15, 30) for k in ('raw', 'std')}
    for W in (5, 15, 30):
        if t // 60 - W < 570:
            out[f'raw{W}'] = out[f'std{W}'] = NAN
            continue
        raw = _df_window(lambda mm: _df_minute(sess, mm) if mm + 1 <= t // 60 else NAN, t, W)
        hist = []
        for d in prior_expiry(sess.root, sess.day):
            if not has_flow(sess.root, d):
                continue
            ser = _df_prior_series(sess.root, d)
            x = _df_window(lambda mm: ser.get(mm, NAN), t, W)
            if np.isfinite(x):
                hist.append(x)
        rms = math.sqrt(np.mean(np.square(hist))) if len(hist) >= MINPRIOR else NAN
        out[f'raw{W}'] = raw
        out[f'std{W}'] = raw / rms if np.isfinite(raw) and np.isfinite(rms) and rms > 0 else NAN
    return out


# ------------------------------------------------------------------ board per-snapshot quantities (C3, C7)

def _near_atm(sm, call):
    F, T = float(sm.F.iloc[0]), float(sm.Tyr.iloc[0])
    ok = (sm.okc if call else sm.okp).values
    ivr = (sm.ivc if call else sm.ivp).values
    good = ok & np.isfinite(ivr)
    d = np.abs(bs.delta(F, sm.k.values, T, np.where(good, ivr, 0.2), call))
    return good & (d >= 0.20) & (d <= 0.50)


def _snap(sess, mm):
    """(c3 imbalance, c7 median spread/mid) of the snapshot stamped mm. Cached on the session."""
    cache = sess.__dict__.setdefault('_snapc', {})
    if mm in cache:
        return cache[mm]
    sm = sess.smile(mm * 60)
    res = (NAN, NAN)
    if sm is not None:
        nc, npt = _near_atm(sm, True), _near_atm(sm, False)
        imb = NAN
        if nc.any() and npt.any():
            bc, ac = sm.cbs.values[nc].astype(float).sum(), sm.cas.values[nc].astype(float).sum()
            bp, ap = sm.pbs.values[npt].astype(float).sum(), sm.pas.values[npt].astype(float).sum()
            if bc + ac > 0 and bp + ap > 0:
                imb = (bc - ac) / (bc + ac) - (bp - ap) / (bp + ap)
        sp = []
        if nc.any():
            sp.append((sm.ca.values[nc] - sm.cb.values[nc]) / sm.cmid.values[nc])
        if npt.any():
            sp.append((sm.pa.values[npt] - sm.pb.values[npt]) / sm.pmid.values[npt])
        spr = float(np.median(np.concatenate(sp))) if sp else NAN
        res = (imb, spr)
    cache[mm] = res
    return res


@feature('c3', 'CALC')
def c3(sess, t):
    out = {}
    m = t // 60
    for W in (5, 15, 30):
        v = np.array([_snap(sess, x)[0] for x in range(m - W + 1, m + 1) if x >= 570], float)
        out[f'a{W}'] = float(np.nanmean(v)) if np.isfinite(v).sum() >= W / 2 else NAN
    out['now'] = _snap(sess, m)[0]
    return out


def _c7_prior(root, day, mm):
    """Median near-ATM spread/mid of a completed earlier session at minute mm (store first, else computed for the
    grid minutes of that session at once)."""
    key = (root, day)
    d = STORE['c7'].get(key)
    if d is None:
        from lib.panel import grid, session
        s = session(root, day)
        d = STORE['c7'][key] = {t // 60: _snap(s, t // 60)[1] for t in grid(day)}
    return d.get(mm, NAN)


@feature('c7', 'CALC')
def c7(sess, t):
    mm = t // 60
    v = _snap(sess, mm)[1]
    hist = [_c7_prior(sess.root, d, mm) for d in prior_expiry(sess.root, sess.day)]
    hist = [x for x in hist if np.isfinite(x)]
    if len(hist) < MINPRIOR or not np.isfinite(v):
        return {'spr': v, 'ratio': NAN}
    med = float(np.median(hist))
    return {'spr': v, 'ratio': v / med if med > 0 else NAN}


# ------------------------------------------------------------------ C4 residual IV change

@functools.lru_cache(maxsize=4)
def _panel_iv(root):
    p = pd.read_parquet(os.path.join(DATA, 'panel', f'{root}.parquet'), columns=['day', 't', 'S', 'iv_atm'])
    p = p[p.day < '2024-01-01']                    # only DISCOVERY sessions are ever used as "prior" days here
    return {d: g.set_index('t')[['S', 'iv_atm']] for d, g in p.groupby('day')}


@functools.lru_cache(maxsize=4096)
def _c4_beta(root, day, L):
    pv = _panel_iv(root)
    xs, ys, nd = [], [], 0
    for d in prior_expiry(root, day):
        g = pv.get(d)
        if g is None:
            continue
        a = g.reindex(g.index - 60 * L)
        dI = g.iv_atm.values - a.iv_atm.values
        dS = np.log(g.S.values / a.S.values)
        ok = np.isfinite(dI) & np.isfinite(dS)
        if ok.sum():
            nd += 1
            xs.append(dS[ok])
            ys.append(dI[ok])
    if nd < MINPRIOR:
        return None
    x, y = np.concatenate(xs), np.concatenate(ys)
    if len(x) < 50:
        return None
    X = np.column_stack([np.ones(len(x)), x])
    a, b = np.linalg.lstsq(X, y, rcond=None)[0]
    return float(a), float(b)


@feature('c4', 'CALC')
def c4(sess, t):
    out = {}
    iv1, s1 = sess.iv_atm(t), sess.spot(t)
    for L in (15, 30):
        t0 = t - 60 * L
        iv0, s0 = sess.iv_atm(t0), sess.spot(t0)
        beta = _c4_beta(sess.root, sess.day, L)
        if beta is None or not all(np.isfinite(x) for x in (iv0, iv1, s0, s1)):
            out[f'r{L}'] = NAN
            continue
        out[f'r{L}'] = (iv1 - iv0) - beta[0] - beta[1] * math.log(s1 / s0)
    return out


# ------------------------------------------------------------------ C5 skew change

def _skew25(sess, t):
    cache = sess.__dict__.setdefault('_skc', {})
    m = t // 60
    if m in cache:
        return cache[m]
    sm = sess.smile(t)
    val = NAN
    if sm is not None:
        F, T = float(sm.F.iloc[0]), float(sm.Tyr.iloc[0])
        k = sm.k.values
        res = []
        for call in (False, True):
            ivr = (sm.ivc if call else sm.ivp).values
            ok = (sm.okc if call else sm.okp).values & np.isfinite(ivr) & ((k > F) if call else (k < F))
            if ok.sum() < 2:
                res.append(NAN)
                continue
            d = np.abs(bs.delta(F, k[ok], T, ivr[ok], call))
            o = np.argsort(d)
            d, v = d[o], ivr[ok][o]
            res.append(float(np.interp(0.25, d, v)) if d[0] <= 0.25 <= d[-1] else NAN)
        val = res[0] - res[1]
    cache[m] = val
    return val


@feature('c5', 'CALC')
def c5(sess, t):
    s1 = _skew25(sess, t)
    return {f'd{L}': s1 - _skew25(sess, t - 60 * L) for L in (15, 30)}


# ------------------------------------------------------------------ C6 OI change

@feature('c6', 'OBS')
def c6(sess, t):
    out = {f'{k}{p}': NAN for p in (1, 2, 5) for k in ('raw', 'norm')}
    b = sess.bars_upto(t)
    b = b[b.m.values == 570]
    if not len(b):
        return out
    op = float(b.o.iloc[0])
    oD = load_oi(sess.root, sess.day, 0)
    prv = prev_sessions(sess.day, 1)
    if oD is None or not len(oD) or not prv:
        return out
    gap = (pd.Timestamp(sess.day) - pd.Timestamp(prv[0])).days
    oP = load_oi(sess.root, prv[0], 31)
    if oP is None:
        return out
    oP = oP[oP.e == gap]
    if not len(oP):
        return out
    a = oD.groupby(['k', 'r'])['oi'].sum()
    z = oP.groupby(['k', 'r'])['oi'].sum()
    j = pd.concat([a.rename('d'), z.rename('p')], axis=1).fillna(0).reset_index()
    j['k'] = j.k.astype(float)
    for p in (1, 2, 5):
        x = j[np.abs(j.k / op - 1) <= p / 100]
        dput = (x.d - x.p)[x.r == 0].sum()
        dcall = (x.d - x.p)[x.r == 1].sum()
        tot = x.d.sum()
        out[f'raw{p}'] = float(dput - dcall)
        out[f'norm{p}'] = float(dput - dcall) / tot if tot > 0 else NAN
    return out


# ------------------------------------------------------------------ B6 control for X11

@feature('b6ctl', 'CALC')
def b6ctl(sess, t):
    s, s5, s15 = sess.spot(t), sess.spot(t - 300), sess.spot(t - 900)
    iv = sess.iv_atm(t)
    if t - 900 < 571 * 60 or not all(np.isfinite(x) for x in (s, s5, s15, iv)) or iv <= 0:
        return {'z5': NAN, 'b6': NAN}
    r5, r15 = math.log(s / s5), math.log(s / s15)
    z5 = r5 / (iv * math.sqrt(5 / YEAR_MIN))
    b6 = 0.0
    if abs(z5) > 2 and np.sign(r5) == np.sign(r15) and abs(r5) / 5 > abs(r15) / 15:
        b6 = float(np.sign(z5))
    return {'z5': z5, 'b6': b6}


C_FEATURES = ('c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'b6ctl')
FLOW_FEATURES = ('c1', 'c2')
