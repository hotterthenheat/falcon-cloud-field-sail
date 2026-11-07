"""NEXTGEX feature builder (PREREG.md sections 0-2). Reads the local 0DTE boards, OI and 1-minute bars; writes one
small parquet per root with the per-(session, decision time) priced odds, OTM strike prices and butterfly rows.

Never scores a session on or after 2025-01-01 (asserted). Labels: quotes / OI / bars OBS, everything derived CALC,
the outcome S_T OBS-proxy (15:59-bar close).

    python3 -I build.py SPXW SPY QQQ IWM
"""
import math, os, sys, json
from multiprocessing import Pool
import numpy as np
import pandas as pd

V2 = '/home/user/falcon-cloud-field-sail/v2data'
OUT = os.path.join(V2, 'nextgex')
UNDER = {'SPXW': 'SPX', 'SPY': 'SPY', 'QQQ': 'QQQ', 'IWM': 'IWM'}
CUTOFF = '2025-01-01'
EARLY = {'2020-11-27', '2020-12-24', '2021-11-26', '2022-11-25', '2023-07-03', '2023-11-24', '2024-07-03', '2024-11-29',
         '2024-12-24'}
TIMES = [600, 720, 840, 900]          # 10:00, 12:00, 14:00, 15:00 ET in minutes of day
FLY_TIMES = [720, 840, 900]
ZGRID = [-2.5, -2.0, -1.5, -1.0, -0.5, 0.5, 1.0, 1.5, 2.0, 2.5]
YEAR_MIN = 252 * 390.0
SQ = math.sqrt(math.pi / 2)


def ncdf(x):
    return 0.5 * (1 + np.vectorize(math.erf)(np.asarray(x, float) / math.sqrt(2)))


def sessions(root):
    out = {}
    for base in ('edge', 'edge0dte'):
        cd, od = os.path.join(V2, base, 'chain', root), os.path.join(V2, base, 'oi', root)
        if not os.path.isdir(cd):
            continue
        for f in os.listdir(cd):
            d = f[:-8]
            if d < CUTOFF and d not in EARLY and os.path.exists(os.path.join(od, f)):
                out[d] = (os.path.join(cd, f), os.path.join(od, f))
    return dict(sorted(out.items()))


_BARS = {}


def day_bars(sym, day):
    k = (sym, day[:7])
    if k not in _BARS:
        parts = []
        for base in ('edge0dte', 'edge'):
            f = os.path.join(V2, base, 'bars', sym, f'{day[:7]}.parquet')
            if os.path.exists(f):
                parts.append(pd.read_parquet(f))
                break
        b = parts[0] if parts else pd.DataFrame(columns=['d', 'm', 'c'])
        _BARS[k] = b[(b.c > 0)] if len(b) else b
    b = _BARS[k]
    return b[b.d == day].sort_values('m')


def mids(bd):
    """Per strike: call / put mid (house rule) and the strict mid (both sides quoted) used for parity."""
    bd = bd.copy()
    ok = (bd.ask > 0) & (bd.bid >= 0) & (bd.ask >= bd.bid)
    bd['mid'] = np.where(ok, np.where(bd.bid > 0, (bd.bid + bd.ask) / 2, bd.ask / 2), np.nan)
    bd.loc[(bd.bid > 0) & (bd.ask == bd.bid), 'mid'] = bd.bid  # locked
    bd['smid'] = np.where((bd.bid > 0) & (bd.ask > bd.bid), (bd.bid + bd.ask) / 2, np.nan)
    c = bd[bd.r == 1].set_index('k')
    p = bd[bd.r == 0].set_index('k')
    ks = np.array(sorted(set(c.index) | set(p.index)), float)
    g = pd.DataFrame(index=ks)
    g['cm'], g['pm'] = c.mid.reindex(ks), p.mid.reindex(ks)
    g['cs'], g['ps'] = c.smid.reindex(ks), p.smid.reindex(ks)
    g['ca'], g['pa'] = c.ask.reindex(ks), p.ask.reindex(ks)
    return g


def pav(y):
    """Pool-adjacent-violators, non-decreasing, equal weights."""
    y = list(map(float, y))
    blocks = [[v, 1] for v in y]
    out = []
    for b in blocks:
        out.append(b)
        while len(out) > 1 and out[-2][0] > out[-1][0]:
            v2, n2 = out.pop()
            v1, n1 = out.pop()
            out.append([(v1 * n1 + v2 * n2) / (n1 + n2), n1 + n2])
    r = []
    for v, n in out:
        r += [v] * n
    return np.array(r)


def priced_cdf(g, F):
    ks = g.index.values
    xs, ys = [], []
    for i in range(len(ks) - 1):
        k1, k2 = ks[i], ks[i + 1]
        w = k2 - k1
        up = (g.cm.iat[i] - g.cm.iat[i + 1]) / w if np.isfinite(g.cm.iat[i]) and np.isfinite(g.cm.iat[i + 1]) else np.nan
        dn = (g.pm.iat[i + 1] - g.pm.iat[i]) / w if np.isfinite(g.pm.iat[i]) and np.isfinite(g.pm.iat[i + 1]) else np.nan
        if k1 >= F:
            v = 1 - up
        elif k2 <= F:
            v = dn
        else:
            v = np.nanmean([1 - up, dn]) if np.isfinite(up) or np.isfinite(dn) else np.nan
        if np.isfinite(v):
            xs.append((k1 + k2) / 2)
            ys.append(v)
    if len(xs) < 4:
        return None, None
    return np.array(xs), np.clip(pav(ys), 0, 1)


def interp_cdf(xs, ys, k):
    if k < xs[0] or k > xs[-1]:
        return np.nan
    return float(np.interp(k, xs, ys))


def app_smile_cdf(g, F, s, T, kq):
    """Sensitivity only: app-style smile (quadratic in log-moneyness of OTM IV) -> P(S_T <= kq)."""
    ks = g.index.values
    sig_atm = (s / F) / math.sqrt(T)
    pts = []
    for k in ks:
        mid = g.pm.get(k) if k < F else g.cm.get(k)
        if not (mid is not None and np.isfinite(mid) and mid > 0):
            continue
        call = k >= F
        lo, hi = 0.01, 5.0
        for _ in range(40):
            m = 0.5 * (lo + hi)
            sq = m * math.sqrt(T)
            d1 = (math.log(F / k) + 0.5 * sq * sq) / sq
            c = F * 0.5 * (1 + math.erf(d1 / math.sqrt(2))) - k * 0.5 * (1 + math.erf((d1 - sq) / math.sqrt(2)))
            p = c if call else c - F + k
            if p > mid:
                hi = m
            else:
                lo = m
        iv = 0.5 * (lo + hi)
        if 0.011 < iv < 4.9:
            x = math.log(k / F)
            pts.append((x, iv, math.exp(-((x / (sig_atm * math.sqrt(T))) ** 2) / 2) + 0.05))
    if len(pts) < 3:
        return np.nan
    X = np.array(pts)
    c2, c1, c0 = np.polyfit(X[:, 0], X[:, 1], 2, w=np.sqrt(X[:, 2]))
    xlo, xhi = X[:, 0].min(), X[:, 0].max()

    def vol(k):
        x = math.log(k / F)
        q = lambda u: c0 + c1 * u + c2 * u * u
        dq = lambda u: c1 + 2 * c2 * u
        v = q(xlo) + dq(xlo) * (x - xlo) if x < xlo else q(xhi) + dq(xhi) * (x - xhi) if x > xhi else q(x)
        return max(0.5 * sig_atm, v)

    def C(k):
        v = vol(k)
        sq = v * math.sqrt(T)
        d1 = (math.log(F / k) + 0.5 * sq * sq) / sq
        return F * 0.5 * (1 + math.erf(d1 / math.sqrt(2))) - k * 0.5 * (1 + math.erf((d1 - sq) / math.sqrt(2)))

    e = kq * 1e-4
    return float(min(1, max(0, 1 + (C(kq + e) - C(kq - e)) / (2 * e))))


def one(args):
    root, day, cf, of = args
    assert day < CUTOFF, day
    try:
        ch = pd.read_parquet(cf)
        oi = pd.read_parquet(of)
    except Exception as ex:  # noqa
        return {'skip': (day, f'read {ex}')}
    oi = oi[oi.e == 0].groupby('k').oi.sum()
    bars = day_bars(UNDER[root], day)
    if not len(bars) or bars.m.max() < 959:
        return {'skip': (day, 'no full bars')}
    ST = float(bars[bars.m == 959].c.iloc[0]) if (bars.m == 959).any() else float(bars.c.iloc[-1])
    odds, otm, flies, curves, skips = [], [], [], [], []
    for tm in TIMES:
        m = tm - 1
        bd = ch[ch.m == m]
        x = bars[bars.m <= m]
        if not len(bd) or not len(x):
            skips.append((day, tm, 'no board/bars'))
            continue
        S = float(x.c.iloc[-1])
        g = mids(bd)
        par = g[np.isfinite(g.cs) & np.isfinite(g.ps)]
        if len(par) < 3:
            skips.append((day, tm, 'no parity'))
            continue
        near = par.iloc[np.argsort(np.abs(par.index.values - S))[:5]]
        F = float(np.median(near.cs - near.ps + near.index.values))
        ka = g.index.values[np.argmin(np.abs(g.index.values - F))]
        strad = g.cm.get(ka) + g.pm.get(ka)
        if not np.isfinite(strad) or strad <= 0:
            skips.append((day, tm, 'no straddle'))
            continue
        s = float(strad * SQ)
        T = (960 - tm) / YEAR_MIN
        xs, ys = priced_cdf(g, F)
        if xs is None:
            skips.append((day, tm, 'no cdf'))
            continue
        curves.append({'day': day, 't': tm, 'xs': xs.tolist(), 'ys': ys.tolist()})
        u = interp_cdf(xs, ys, ST)
        for z in ZGRID:
            K = F * math.exp(z * s / F)
            c = interp_cdf(xs, ys, K)
            p = (c if z < 0 else 1 - c) if np.isfinite(c) else np.nan
            y = float(ST <= K) if z < 0 else float(ST > K)
            row = dict(day=day, t=tm, z=z, K=K, F=F, S=S, s=s, p=p, y=y, ST=ST, u=u, kmin=xs[0], kmax=xs[-1])
            if abs(z) == 1.0:
                ca = app_smile_cdf(g, F, s, T, K)
                row['p_app'] = (ca if z < 0 else 1 - ca) if np.isfinite(ca) else np.nan
            odds.append(row)
            # H1.5: the listed OTM strike nearest K_z
            side = g[np.isfinite(g.pm)] if z < 0 else g[np.isfinite(g.cm)]
            side = side[side.index.values < F] if z < 0 else side[side.index.values > F]
            if len(side):
                kk = side.index.values[np.argmin(np.abs(side.index.values - K))]
                if abs(math.log(kk / K)) <= 0.25 * s / F:
                    mid = side.pm.get(kk) if z < 0 else side.cm.get(kk)
                    ask = side.pa.get(kk) if z < 0 else side.ca.get(kk)
                    pay = max(kk - ST, 0) if z < 0 else max(ST - kk, 0)
                    otm.append(dict(day=day, t=tm, z=z, k=kk, mid=mid, ask=ask, pay=pay))
        if tm in FLY_TIMES:
            ks = g.index.values
            sig = (s / F) / math.sqrt(T)
            for i in range(1, len(ks) - 1):
                k, w = ks[i], ks[i] - ks[i - 1]
                if abs((ks[i + 1] - k) - w) > 1e-6 or abs(k - F) > 1.5 * s:
                    continue
                X = g.cm if k >= F else g.pm
                a, b, c = X.iat[i - 1], X.iat[i], X.iat[i + 1]
                if not (np.isfinite(a) and np.isfinite(b) and np.isfinite(c)):
                    continue
                q = (a - 2 * b + c) / w
                gpay = max(0.0, 1 - abs(ST - k) / w)
                o = float(oi.get(k, 0))
                sq = sig * math.sqrt(T)
                d1 = (math.log(F / k) + 0.5 * sq * sq) / sq
                gam = math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (F * sq)
                flies.append(dict(day=day, t=tm, k=k, w=w, F=F, s=s, q=q, g=gpay, oi=o, goi=o * gam * F * F * 0.01,
                                  dist=(k - F) / s, ST=ST))
    return {'odds': odds, 'otm': otm, 'flies': flies, 'curves': curves, 'skips': skips}


def main(roots):
    os.makedirs(OUT, exist_ok=True)
    for root in roots:
        ss = sessions(root)
        jobs = [(root, d, cf, of) for d, (cf, of) in ss.items()]
        res = {'odds': [], 'otm': [], 'flies': [], 'curves': [], 'skips': []}
        with Pool(2) as pool:
            for r in pool.imap(one, jobs, chunksize=4):
                if 'skip' in r:
                    res['skips'].append(r['skip'])
                    continue
                for k in res:
                    res[k] += r[k]
        for k in ('odds', 'otm', 'flies'):
            pd.DataFrame(res[k]).to_parquet(os.path.join(OUT, f'{root}_{k}.parquet'), compression='zstd')
        with open(os.path.join(OUT, f'{root}_curves.json'), 'w') as fh:
            json.dump(res['curves'], fh)
        with open(os.path.join(OUT, f'{root}_skips.json'), 'w') as fh:
            json.dump(res['skips'], fh)
        print(root, 'sessions', len(ss), 'odds rows', len(res['odds']), 'flies', len(res['flies']), 'skips',
              len(res['skips']), flush=True)


if __name__ == '__main__':
    main(sys.argv[1:] or ['SPXW'])
