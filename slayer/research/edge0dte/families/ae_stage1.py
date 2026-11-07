"""EDGE0DTE Stage 1, family AE (A1-A7, E1-E4, X4, X7-X10): raw statistics, DISCOVERY only. No FDR, no pass/fail.

  cd slayer/research/edge0dte && python3 -m families.ae_stage1 [ROOT ...]
  -> results/stage1/AE.parquet (+ .csv) and results/stage1/AE.md

Inputs: the FOUNDATION panel (Z, V, buckets; filtered to split == DISCOVERY on load, 2024+ rows are dropped before
anything is read from them) and stage1_AE/{ROOT}.parquet (families.ae_build features at the same grid times).

Effect (PROTOCOL section 4, Stage-1 contract):
  Z rows   effect = mean over events of s_i * (Z_i - mu_b(i)),  s_i = the feature's direction (+1/-1), mu_b = the
           unconditional mean of Z at the same 30-minute time-of-day bucket over all DISCOVERY grid rows of the root
  V rows   effect = mean over events of (ln V_i - mu_b(i)), mu_b = unconditional mean of ln V in the bucket
  X rows / A1 (difference tests) effect = effect(group predicted stronger) - effect(other group)
CI and p: day-clustered bootstrap, 2000 resamples of DISCOVERY days, the unconditional bucket means re-estimated in
every resample (joint bootstrap). p two-sided = 2 min(P*(<=0), P*(>=0)), floored at 1/2000. E3 (registered as
incremental): p from OLS of (Z - mu_b) on the hedge direction sign and the prior-15-minute Z, CR1 day-clustered.
IC: Spearman rank correlation of the continuous feature with the demeaned outcome; CI = day-clustered bootstrap (2000)
of the Pearson correlation of the full-sample ranks (ranks are not recomputed inside a resample).
Point-in-time scaling (A5, A6, E1-E4 IC, D4 of X7): a value at day D is scaled / ranked against the same root's values
in the same 30-minute bucket over the PRIOR 20 expiry sessions of that root (>= 10 sessions and >= 30 values needed;
day D itself excluded). Scale = root mean square about zero (flows have a meaningful zero), not demeaned.
"""
import os
for _v in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(_v, '1')                 # shared box: one BLAS thread per process (no oversubscription)
import json  # noqa: E402
import sys  # noqa: E402

import numpy as np
import pandas as pd

from lib.config import DATA, HORIZONS, bucket as tbucket
from lib.stats import ols_cluster
from scipy import stats as st

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'results', 'stage1')
AE = os.path.join(DATA, 'stage1_AE')
NB = 2000
YEARS = (('2020-21', ('2020', '2021')), ('2022', ('2022',)), ('2023', ('2023',)))
T0945, T1300 = 35100, 46800
HS = [str(h) for h in HORIZONS]


# ------------------------------------------------------------------ point-in-time scaling / ranking

def _pit_frames(df, col, win=20):
    days = np.array(sorted(df.day.unique()))
    pos = {d: i for i, d in enumerate(days)}
    return days, pos


def pit_scale(df, col, win=20, min_days=10, min_vals=30):
    """RMS of col over the prior `win` sessions (of df) in the same bucket; Series aligned to df.index."""
    out = pd.Series(np.nan, index=df.index)
    days, pos = _pit_frames(df, col)
    x = df[col].astype(float)
    for b, g in df.groupby('bucket'):
        v = x.loc[g.index]
        ok = np.isfinite(v.values)
        di = g.day.map(pos).values
        ss = np.bincount(di[ok], weights=v.values[ok] ** 2, minlength=len(days))
        cn = np.bincount(di[ok], minlength=len(days)).astype(float)
        has = np.bincount(di, minlength=len(days)) > 0
        cs, cc, ch = (np.concatenate([[0], np.cumsum(a)]) for a in (ss, cn, has.astype(float)))
        i = np.arange(len(days))
        lo = np.maximum(i - win, 0)
        rs, rc, rh = cs[i] - cs[lo], cc[i] - cc[lo], ch[i] - ch[lo]       # days lo .. i-1 (prior only)
        with np.errstate(invalid='ignore', divide='ignore'):
            sc = np.where((rh >= min_days) & (rc >= min_vals), np.sqrt(rs / rc), np.nan)
        out.loc[g.index] = sc[di]
    return out


def pit_pct(df, col, win=20, min_days=10, min_vals=30):
    """Share of the prior `win` sessions' same-bucket values strictly below the current value (ties count half)."""
    out = pd.Series(np.nan, index=df.index)
    days, pos = _pit_frames(df, col)
    for b, g in df.groupby('bucket'):
        di = g.day.map(pos).values
        v = g[col].astype(float).values
        per = {}
        for d, x in zip(di, v):
            if np.isfinite(x):
                per.setdefault(d, []).append(x)
        res = np.full(len(g), np.nan)
        for j, (d, x) in enumerate(zip(di, v)):
            if not np.isfinite(x):
                continue
            prior = [per[k] for k in range(max(d - win, 0), d) if k in per]
            if len(prior) < min_days:
                continue
            ref = np.sort(np.concatenate(prior))
            if len(ref) < min_vals:
                continue
            lo = np.searchsorted(ref, x, 'left')
            hi = np.searchsorted(ref, x, 'right')
            res[j] = (lo + 0.5 * (hi - lo)) / len(ref)
        out.loc[g.index] = res
    return out


# ------------------------------------------------------------------ joint day-clustered bootstrap

class Boot:
    def __init__(self, days, buckets, n_boot=NB, seed=1):
        self.days = np.array(sorted(days), dtype=object)
        self.buckets = np.array(sorted(buckets), dtype=object)
        self.year_of = np.array([d[:4] for d in self.days], dtype=object)
        D = len(self.days)
        rng = np.random.default_rng(seed)
        idx = rng.integers(0, D, (n_boot, D))
        self.W = np.zeros((n_boot, D))
        for r in range(n_boot):
            self.W[r] = np.bincount(idx[r], minlength=D)
        self.unc = {}

    def di(self, day):
        day = np.asarray(day, dtype=object)
        i = np.searchsorted(self.days, day)
        assert len(day) == 0 or (self.days[np.minimum(i, len(self.days) - 1)] == day).all()
        return i.astype(int)

    def bi(self, bkt):
        bkt = np.asarray(bkt, dtype=object)
        i = np.searchsorted(self.buckets, bkt)
        assert len(bkt) == 0 or (self.buckets[np.minimum(i, len(self.buckets) - 1)] == bkt).all()
        return i.astype(int)

    def set_unconditional(self, key, day, bkt, y):
        ok = np.isfinite(y)
        di = self.di(day[ok])
        bi = self.bi(bkt[ok])
        D, B = len(self.days), len(self.buckets)
        S = np.zeros((D, B))
        C = np.zeros((D, B))
        np.add.at(S, (di, bi), y[ok])
        np.add.at(C, (di, bi), 1.0)
        with np.errstate(invalid='ignore', divide='ignore'):
            mu = S.sum(0) / C.sum(0)
            mub = (self.W @ S) / (self.W @ C)
        self.unc[key] = (mu, mub)

    def mu_of(self, key, bkt):
        mu = self.unc[key][0]
        return mu[self.bi(bkt)]

    def _parts(self, key, day, bkt, y, s, dmask=None):
        """per-day sums for an event set; returns point (num, den) and bootstrap (num, den)."""
        ok = np.isfinite(y) & np.isfinite(s) & (s != 0)
        day, bkt, y, s = day[ok], bkt[ok], y[ok], s[ok]
        D, B = len(self.days), len(self.buckets)
        if dmask is not None:
            keep = np.isin(day, dmask)
            day, bkt, y, s = day[keep], bkt[keep], y[keep], s[keep]
        di = self.di(day)
        bi = self.bi(bkt)
        Esy = np.bincount(di, weights=s * y, minlength=D)
        En = np.bincount(di, minlength=D).astype(float)
        Es = np.zeros((D, B))
        np.add.at(Es, (di, bi), s)
        mu, mub = self.unc[key]
        mu0 = np.nan_to_num(mu)
        num = Esy.sum() - (mu0 * Es.sum(0)).sum()
        den = En.sum()
        bnum = self.W @ Esy - np.nansum(np.nan_to_num(mub) * (self.W @ Es), 1)
        bden = self.W @ En
        return num, den, bnum, bden, len(y), len(np.unique(day))

    def effect(self, key, day, bkt, y, s, boot=True):
        num, den, bnum, bden, n, nd = self._parts(key, day, bkt, y, s)
        if den == 0:
            return dict(effect=np.nan, ci_lo=np.nan, ci_hi=np.nan, p=np.nan, n=0, nd=0)
        with np.errstate(invalid='ignore', divide='ignore'):
            bs = bnum / bden
        return _summ(num / den, bs, n, nd)

    def diff(self, key, day, bkt, y, s, g1):
        """effect(g1) - effect(~g1) (both groups demeaned by the same bucket means)."""
        a = self._parts(key, day[g1], bkt[g1], y[g1], s[g1])
        b = self._parts(key, day[~g1], bkt[~g1], y[~g1], s[~g1])
        if a[1] == 0 or b[1] == 0:
            return dict(effect=np.nan, ci_lo=np.nan, ci_hi=np.nan, p=np.nan, n=a[4] + b[4], nd=0, n1=a[4], n0=b[4])
        with np.errstate(invalid='ignore', divide='ignore'):
            bs = a[2] / a[3] - b[2] / b[3]
        r = _summ(a[0] / a[1] - b[0] / b[1], bs, a[4] + b[4], len(np.unique(np.concatenate([day[g1], day[~g1]]))))
        r.update(n1=a[4], n0=b[4], e1=a[0] / a[1], e0=b[0] / b[1])
        return r


def _summ(m, bs, n, nd):
    bs = bs[np.isfinite(bs)]
    if not len(bs):
        return dict(effect=m, ci_lo=np.nan, ci_hi=np.nan, p=np.nan, n=n, nd=nd)
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return dict(effect=float(m), ci_lo=float(np.percentile(bs, 2.5)), ci_hi=float(np.percentile(bs, 97.5)),
                p=float(max(p, 1.0 / NB)), n=int(n), nd=int(nd))


def ic_fast(x, y, day, boot):
    """Spearman IC; CI from a day-clustered bootstrap of the Pearson correlation of the full-sample ranks."""
    ok = np.isfinite(x) & np.isfinite(y)
    if ok.sum() < 30:
        return (np.nan,) * 4
    rx, ry = st.rankdata(x[ok]), st.rankdata(y[ok])
    di = boot.di(day[ok])
    D = len(boot.days)
    stats = [np.bincount(di, weights=w, minlength=D) for w in (np.ones_like(rx), rx, ry, rx * ry, rx * rx, ry * ry)]
    M = np.vstack(stats).T                                   # D x 6
    B = boot.W @ M
    n, sx, sy, sxy, sxx, syy = B.T
    with np.errstate(invalid='ignore', divide='ignore'):
        r = (n * sxy - sx * sy) / np.sqrt((n * sxx - sx ** 2) * (n * syy - sy ** 2))
    full = float(np.corrcoef(rx, ry)[0, 1])
    r = r[np.isfinite(r)]
    p = 2 * min((r <= 0).mean(), (r >= 0).mean())
    return full, float(np.percentile(r, 2.5)), float(np.percentile(r, 97.5)), float(max(p, 1.0 / NB))


# ------------------------------------------------------------------ data

def load(root):
    p = pd.read_parquet(os.path.join(DATA, 'panel', f'{root}.parquet'))
    p = p[p.split == 'DISCOVERY'].reset_index(drop=True)         # CALIBRATION rows dropped before any use
    assert p.day.max() <= '2023-12-31'
    f = pd.read_parquet(os.path.join(AE, f'{root}.parquet'))
    f = f[f.day <= '2023-12-31']
    df = p.merge(f.drop(columns=['root']), on=['day', 't'], how='left')
    a3 = pd.read_parquet(os.path.join(AE, f'{root}.a3m.parquet'))
    a3 = a3[a3.day <= '2023-12-31'].reset_index(drop=True)
    for h in HS:
        v = df[f'V_{h}'].values
        df[f'L_{h}'] = np.where(v > 0, np.log(np.where(v > 0, v, 1)), np.nan)
    df['year'] = df.day.str[:4]
    for x in (df, a3):
        x['day'] = np.asarray(x['day'].values, dtype=object)
        x['bucket'] = np.asarray(x['bucket'].values, dtype=object)
    return df, a3


def derive(df):
    """Per OI variant ('p', 'g7'): the day's 09:45 GEX, wall distances, scaled flows, percentiles."""
    for v in ('p', 'g7'):
        c = f'ae_{v}_'
        g0 = df[df.t == T0945].set_index('day')[c + 'gex_total']
        df[f'gex0945_{v}'] = df.day.map(g0)
        S, s30 = df[c + 'S'], df[c + 'sig30']
        df[f'cw_{v}'] = (df[c + 'call_wall'] - S) / (S * s30)
        df[f'pw_{v}'] = (S - df[c + 'put_wall']) / (S * s30)
        df[f'side_{v}'] = np.sign(S - df[c + 'flip'])
        df[f'pin_{v}'] = np.sign(df[c + 'pin_k'] - S)
        df[f'conc_pct_{v}'] = pit_pct(df, c + 'gex_conc')
        df[f'dgex_z_{v}'] = df[c + 'dgex_spot'] / pit_scale(df, c + 'dgex_spot')
        df[f'H_{v}'] = df[c + 'charm_flow'] + df[c + 'vanna_flow_30'] + df[c + 'gamma_flow_15']
        df[f'H2_{v}'] = df[c + 'vanna_flow_30'] + df[c + 'gamma_flow_15']
        for col in ('charm_flow', 'vanna_flow_15', 'vanna_flow_30', 'vanna_flow_60', 'gamma_flow_5', 'gamma_flow_15',
                    'gamma_flow_30'):
            df[f'{col}_z_{v}'] = df[c + col] / pit_scale(df, c + col)
        for col in ('H', 'H2'):
            df[f'{col}_z_{v}'] = df[f'{col}_{v}'] / pit_scale(df, f'{col}_{v}')
        df[f'gex_t_{v}'] = df[c + 'gex_total']
    df['d4_pct'] = pit_pct(df, 'ae_calc_d4_ivrv')
    return df


# ------------------------------------------------------------------ tests

def hurdles(hd, root, h, bkts):
    a = hd[(hd.root == root) & (hd.h == h)].set_index('bucket')
    out = {}
    ub, cnt = np.unique(np.asarray(bkts, dtype=object).astype(str), return_counts=True) if len(bkts) else ([], [])
    for k in ('hz', 'hv_long', 'hv_short'):
        col = a[k].to_dict()
        out[f'{k}_all'] = float(col['all']) if 'all' in col else np.nan
        vals = np.concatenate([np.repeat(col[b], c) for b, c in zip(ub, cnt) if b in col and np.isfinite(col[b])] or [[]])
        out[f'{k}_bucket'] = float(np.median(vals)) if len(vals) else np.nan
    return out


class Runner:
    def __init__(self, root, df, a3, hd):
        self.root, self.df, self.a3, self.hd = root, df, a3, hd
        self.boot = Boot(df.day.unique(), set(df.bucket.unique()) | set(a3.bucket.unique()))
        for h in HS:
            self.boot.set_unconditional(('Z', h), df.day.values, df.bucket.values, df[f'Z_{h}'].values.astype(float))
            self.boot.set_unconditional(('V', h), df.day.values, df.bucket.values, df[f'L_{h}'].values.astype(float))
        self.rows = []

    def _years(self, kind, h, day, bkt, y, s, g1=None):
        out = {}
        yrs = self.boot.year_of[self.boot.di(day)]
        for name, ys in YEARS:
            m = np.isin(yrs, ys)
            if g1 is None:
                num, den, _, _, n, nd = self.boot._parts((kind, h), day[m], bkt[m], y[m], s[m])
                e = num / den if den else np.nan
            else:
                a = self.boot._parts((kind, h), day[m & g1], bkt[m & g1], y[m & g1], s[m & g1])
                b = self.boot._parts((kind, h), day[m & ~g1], bkt[m & ~g1], y[m & ~g1], s[m & ~g1])
                e = a[0] / a[1] - b[0] / b[1] if a[1] and b[1] else np.nan
                n, nd = a[4] + b[4], len(np.unique(day[m & np.isfinite(y) & np.isfinite(s) & (s != 0)]))
            out[f'eff_{name}'], out[f'n_{name}'], out[f'sess_{name}'] = e, n, nd
        return out

    def add(self, row_id, kind, h, param, role, ev, sgn, exp_sign, desc, g1=None, ic=None, ols=None, note='',
            y=None, day=None, bkt=None):
        """ev: boolean mask on self.df (or explicit arrays via y/day/bkt); sgn: direction (Z) or ones (V)."""
        if y is None:
            sub = self.df[ev]
            y = sub[f'{"Z" if kind == "Z" else "L"}_{h}'].values.astype(float)
            day, bkt = sub.day.values, sub.bucket.values
            sgn = np.asarray(sgn, float)[ev.values] if len(sgn) == len(self.df) else np.asarray(sgn, float)
            g1 = None if g1 is None else np.asarray(g1, bool)[ev.values]
            raw_v = sub[f'V_{h}'].values.astype(float) if kind == 'V' else None
        else:
            raw_v = None
        valid = np.isfinite(y) & np.isfinite(sgn) & (sgn != 0)
        if g1 is not None:
            r = self.boot.diff((kind, h), day, bkt, y, sgn, g1)
            yr = self._years(kind, h, day, bkt, y, sgn, g1)
            strong = g1 & valid
        else:
            r = self.boot.effect((kind, h), day, bkt, y, sgn)
            yr = self._years(kind, h, day, bkt, y, sgn)
            strong = valid
        hu = hurdles(self.hd, self.root, h, list(bkt[strong]))
        if kind == 'Z':
            cond_raw = float(np.mean(sgn[strong] * y[strong])) if strong.any() else np.nan
        else:
            cond_raw = float(np.nanmean(raw_v[strong] - 1)) if raw_v is not None and strong.any() else np.nan
        rec = dict(family='AE', row_id=row_id, root=self.root, outcome=kind, horizon=h, param=param, param_role=role,
                   in_fdr_family=bool(self.root == 'SPXW' and role == 'P'), label='MODEL' if row_id[0] in 'AEX' else 'CALC',
                   desc=desc, n_obs=r['n'], n_sessions=r['nd'], effect=r['effect'], ci_lo=r['ci_lo'], ci_hi=r['ci_hi'],
                   p_value=r['p'], p_method='boot2000_day', expected_sign=exp_sign, n_g1=r.get('n1', np.nan),
                   n_g0=r.get('n0', np.nan), eff_g1=r.get('e1', np.nan), eff_g0=r.get('e0', np.nan), cond_raw=cond_raw,
                   ic=np.nan, ic_lo=np.nan, ic_hi=np.nan, ic_p=np.nan, ic_expected_sign=np.nan, ols_beta=np.nan,
                   ols_se=np.nan, ols_p=np.nan, boot_p=r['p'], note=note)
        rec.update(yr)
        rec.update(hu)
        if ic is not None:
            x, yy, dd, es = ic
            rec['ic'], rec['ic_lo'], rec['ic_hi'], rec['ic_p'] = ic_fast(x, yy, dd, self.boot)
            rec['ic_expected_sign'] = es
        if ols is not None:
            o = ols
            rec['ols_beta'], rec['ols_se'], rec['ols_p'] = o['beta'][1], o['se'][1], o['p'][1]
            rec['p_value'], rec['p_method'] = o['p'][1], 'ols_cluster_CR1_day'
        self.rows.append(rec)

    # helpers
    def zadj(self, h):
        d = self.df
        return d[f'Z_{h}'].values - self.boot.mu_of(('Z', h), d.bucket.values)

    def ladj(self, h):
        d = self.df
        return d[f'L_{h}'].values - self.boot.mu_of(('V', h), d.bucket.values)


def run_root(root, hd):
    df, a3 = load(root)
    df = derive(df)
    R = Runner(root, df, a3, hd)
    d = df
    ones = np.ones(len(d))
    allr = pd.Series(True, index=d.index)
    V = [('p', 'P'), ('g7', 'G:oi7')]

    def role(param):
        return 'P' if param == 'P' else 'G'

    # ---------------- A1
    for v, pn in V:
        g = d[f'gex0945_{v}']
        ok = g.notna() & (g != 0)
        for h in HS:
            R.add('A1', 'V', h, pn, role(pn), ok, ones, +1, 'GEX(09:45)<0 minus >0, ln V, all grid times',
                  g1=(g < 0).values)
            R.add('A1', 'V', h, pn + '|09:45 only', 'diag', ok & (d.t == T0945), ones, +1,
                  'GEX(09:45)<0 minus >0, ln V, 09:45 decision only', g1=(g < 0).values)
            zp = np.sign(d.z_prev30)
            s = np.where(g < 0, zp, -zp)
            ok2 = ok & d.z_prev30.notna()
            R.add('A1', 'Z', h, pn, role(pn), ok2, s, +1,
                  'prior-30-min direction continues when GEX(09:45)<0, reverts when >0 (s = sign(z_prev30) * -sign(GEX))')
            R.add('A1', 'Z', h, pn + '|GEX<0 continuation', 'diag', ok2 & (g < 0), zp, +1, 'continuation leg only')
            R.add('A1', 'Z', h, pn + '|GEX>0 reversal', 'diag', ok2 & (g > 0), -zp, +1, 'reversal leg only')
    # ---------------- A2
    for v, pn in V:
        fd = d[f'ae_{v}_flip_dist']
        have = d[f'ae_{v}_gex_total'].notna()
        absd = np.where(fd.notna(), fd.abs(), np.where(have, 3.0, np.nan))       # no flip within +/-3 sigma -> 3
        for thr in ((0.5, 0.25, 1.0) if v == 'p' else (0.5,)):
            param = pn if thr == 0.5 else f'G:{thr}'
            ev = pd.Series(absd < thr, index=d.index) & have
            for h in HS:
                R.add('A2', 'V', h, param, role(param), ev, ones, +1, f'|S-flip|/sigma_close < {thr}',
                      ic=(absd, R.ladj(h), d.day.values, -1) if thr == 0.5 else None)
    # ---------------- A3
    for v, pn in V:
        side = d[f'side_{v}']
        prev = d.groupby('day')[f'side_{v}'].shift(1)
        prevt = d.groupby('day').t.shift(1)
        ev = (side != 0) & (prev != 0) & side.notna() & prev.notna() & (side != prev) & (d.t - prevt == 300)
        for h in HS:
            R.add('A3', 'Z', h, pn, role(pn), ev, side.values, +1, '5-min close crosses the flip; Z in crossing direction')
        if v == 'p':
            q = d[(d.t % 900 == 0)].copy()
            q['prev'] = q.groupby('day')[f'side_{v}'].shift(1)
            q['prevt'] = q.groupby('day').t.shift(1)
            ev15 = pd.Series(False, index=d.index)
            ev15.loc[q.index] = ((q[f'side_{v}'] != 0) & (q.prev != 0) & q[f'side_{v}'].notna() & q.prev.notna()
                                 & (q[f'side_{v}'] != q.prev) & (q.t - q.prevt == 900)).values
            for h in HS:
                R.add('A3', 'Z', h, 'G:15-min', 'G', ev15, side.values, +1, '15-min close crosses the flip')
            e = a3[a3.oi == 'p']
            for h in HS:
                R.add('A3', 'Z', h, 'G:1-min', 'G', None, e.dir.values.astype(float), +1,
                      '1-min close crosses the flip of the latest 5-min grid time', y=e[f'Z_{h}'].values.astype(float),
                      day=e.day.values, bkt=e.bucket.values, note='flip recomputed every 5 min (MODEL-G approximation)')
    # ---------------- A4
    for v, pn in V:
        cw, pw = d[f'cw_{v}'], d[f'pw_{v}']
        for thr in ((0.5, 0.25, 1.0) if v == 'p' else (0.5,)):
            param = pn if thr == 0.5 else f'G:{thr}'
            near_c = cw <= thr
            near_p = pw <= thr
            s = np.where(near_c & (~near_p | (cw <= pw)), 1.0, np.where(near_p, -1.0, 0.0))
            ev = near_c | near_p
            for h in HS:
                R.add('A4', 'Z', h, param, role(param), ev, s, -1,
                      f'within {thr} sigma_30 of the call wall (s=+1) or put wall (s=-1), nearer wall; Z toward the wall')
    # ---------------- A5
    for v, pn in V:
        pc = d[f'conc_pct_{v}']
        for cut, param in ((2 / 3, pn), (0.8, 'G:quintile')) if v == 'p' else ((2 / 3, pn),):
            ev = pc > cut
            for h in HS:
                R.add('A5', 'V', h, param, role(param), ev, ones, -1,
                      f'gamma concentration (Herfindahl |GEX| within 2 sigma_close) above the {cut:.2f} PIT percentile',
                      ic=(pc.values, R.ladj(h), d.day.values, -1) if param == pn else None)
    # ---------------- A6
    for v, pn in V:
        z = d[f'dgex_z_{v}']
        for thr in ((1.0, 0.5, 2.0) if v == 'p' else (1.0,)):
            param = pn if thr == 1.0 else f'G:{thr}sd'
            ev = z < -thr
            for h in HS:
                R.add('A6', 'V', h, param, role(param), ev, ones, +1,
                      f'spot-driven GEX change since 09:45 (fraction of gross gamma, PIT-scaled) < -{thr} sd',
                      ic=(z.values, R.ladj(h), d.day.values, -1) if thr == 1.0 else None)
    # ---------------- A7 / X8
    for v, pn in V:
        pin = d[f'pin_{v}']
        g = d[f'gex0945_{v}']
        for start, param in ((14 * 3600, pn), (13 * 3600, 'G:13:00'), (15 * 3600, 'G:15:00')) if v == 'p' else ((14 * 3600, pn),):
            ev = (d.t >= start) & (pin != 0) & pin.notna()
            R.add('A7', 'Z', 'close', param, role(param), ev, pin.values, +1,
                  'after the start time: Z toward the largest-|GEX| strike within 1 sigma_close, h=close')
            ok = ev & g.notna() & (g != 0)
            R.add('X8', 'Z', 'close', param, role(param), ok, pin.values, +1, 'A7 pin: GEX(09:45)>0 minus <0',
                  g1=(g > 0).values)
    # ---------------- E1 / X10
    for v, pn in V:
        cf = d[f'ae_{v}_charm_flow']
        cz = d[f'charm_flow_z_{v}']
        g = d[f'gex0945_{v}']
        for start, param in ((T1300, pn), (12 * 3600, 'G:12:00'), (14 * 3600, 'G:14:00')) if v == 'p' else ((T1300, pn),):
            ev = (d.t >= start) & cf.notna() & (cf != 0)
            zc = R.zadj('close')
            m = (d.t >= start).values
            R.add('E1', 'Z', 'close', param, role(param), ev, np.sign(cf).values, +1,
                  'charm hedge flow t->close (dealer buying>0): Z_close in its sign, decision >= start',
                  ic=(np.where(m, cz.values, np.nan), zc, d.day.values, +1))
            ok = ev & g.notna() & (g != 0)
            R.add('X10', 'Z', 'close', param, role(param), ok, np.sign(cf).values, +1,
                  'E1 charm drift: GEX(09:45)>0 minus <0', g1=(g > 0).values)
    # ---------------- E2
    for v, pn in V:
        for L, param in ((30, pn), (15, 'G:15'), (60, 'G:60')) if v == 'p' else ((30, pn),):
            vf = d[f'ae_{v}_vanna_flow_{L}']
            ev = vf.notna() & (vf != 0)
            for h in ('30', '60'):
                R.add('E2', 'Z', h, param, role(param), ev, np.sign(vf).values, +1,
                      f'vanna hedge flow from the last {L}-min IV_atm change: Z in its sign',
                      ic=(d[f'vanna_flow_{L}_z_{v}'].values, R.zadj(h), d.day.values, +1))
    # ---------------- E3
    for v, pn in V:
        for L, param in ((15, pn), (5, 'G:5'), (30, 'G:30')) if v == 'p' else ((15, pn),):
            gf = d[f'ae_{v}_gamma_flow_{L}']
            ev = gf.notna() & (gf != 0)
            sg = np.sign(gf).values
            for h in HS:
                y = R.zadj(h)
                m = ev.values & d.ae_calc_z_prev15.notna().values
                o = ols_cluster(y[m], np.column_stack([sg[m], d.ae_calc_z_prev15.values[m]]), d.day.values[m],
                                names=['sign_gamma_flow', 'z_prev15'])
                R.add('E3', 'Z', h, param, role(param), ev, sg, +1,
                      f'gamma hedge flow -Gamma_dealer*dS over {L} min: Z in its sign; p = OLS on sign + prior-15-min Z',
                      ic=(d[f'gamma_flow_{L}_z_{v}'].values, y, d.day.values, +1), ols=o)
    # ---------------- E4
    for v, pn in V:
        for col, param in (('H', pn), ('H2', 'G:drop E1')) if v == 'p' else (('H', pn),):
            hv = d[f'{col}_{v}']
            ev = hv.notna() & (hv != 0)
            for h in HS:
                R.add('E4', 'Z', h, param, role(param), ev, np.sign(hv).values, +1,
                      'total hedge demand H = E1+E2+E3 (shares, PIT-scaled for the IC): Z in sign(H)',
                      ic=(d[f'{col}_z_{v}'].values, R.zadj(h), d.day.values, +1))
    # ---------------- X4 (B7 by GEX regime)
    last = d.groupby('day').t.transform('max')
    for v, pn in V:
        g = d[f'gex0945_{v}']
        for col, param in (('ae_calc_b7_gap', pn), ('ae_calc_b7_nogap', 'G:no gap')) if v == 'p' else (('ae_calc_b7_gap', pn),):
            r = d[col]
            ev = (d.t == last) & r.notna() & (r != 0) & g.notna() & (g != 0)
            R.add('X4', 'Z', '30', param, role(param), ev, np.sign(r).values, +1,
                  'B7 first-30-min return (+gap) -> Z of the last 30 min in that direction: GEX(09:45)<0 minus >0',
                  g1=(g < 0).values, note='decision = close - 30 min, h = 30 (= to the close)')
    # ---------------- X7 (D4 cheap implied by GEX regime)
    for v, pn in V:
        for gcol, gname in ((f'gex0945_{v}', ''), (f'gex_t_{v}', 'GEX at t')) if v == 'p' else ((f'gex0945_{v}', ''),):
            g = d[gcol]
            for cut, param in ((1 / 3, pn), (0.2, 'G:quintile')) if (v == 'p' and not gname) else ((1 / 3, pn),):
                if gname:
                    param = 'G:' + gname
                ev = (d.d4_pct <= cut) & g.notna() & (g != 0)
                for h in HS:
                    R.add('X7', 'V', h, param, role(param), ev, ones, +1,
                          f'D4 IV^2/RV60 in the lowest {cut:.2f} PIT percentile: ln V, GEX<0 minus >0', g1=(g < 0).values)
    # ---------------- X9 (D1 RV expansion by GEX regime)
    for v, pn in V:
        for gcol, gname in ((f'gex0945_{v}', ''), (f'gex_t_{v}', 'GEX at t')) if v == 'p' else ((f'gex0945_{v}', ''),):
            g = d[gcol]
            for thr in ((2.0, 1.5, 3.0) if (v == 'p' and not gname) else (2.0,)):
                param = pn if thr == 2.0 else f'G:{thr}'
                if gname:
                    param = 'G:' + gname
                ev = (d.ae_calc_d1_rvratio > thr) & g.notna() & (g != 0)
                for h in HS:
                    R.add('X9', 'V', h, param, role(param), ev, ones, +1,
                          f'D1 RV30 / prior-20-session same-time median > {thr}: ln V, GEX<0 minus >0', g1=(g < 0).values)
    out = pd.DataFrame(R.rows)
    # descriptive helper flags (NOT a pass/fail: FDR, year and replication rules are the aggregator's)
    out['ci_excl_0'] = (out.ci_lo > 0) | (out.ci_hi < 0)
    out['sign_as_expected'] = np.sign(out.effect) == out.expected_sign
    hz = out.hz_all.abs()
    bz = (out.outcome == 'Z') & (out.effect.abs() > hz)
    bv = (out.outcome == 'V') & (((out.effect > 0) & (out.cond_raw > out.hv_long_all)) |
                                 ((out.effect < 0) & (out.cond_raw < out.hv_short_all)))
    out['beyond_hurdle'] = bz | bv
    cov = dict(root=root, grid_rows=len(d), sessions=d.day.nunique(),
               feat_rows=int(d.ae_p_gex_total.notna().sum()), feat_rows_g7=int(d.ae_g7_gex_total.notna().sum()),
               flip_found=float(d.ae_p_flip.notna().mean()), gex_neg_days=int((d[d.t == T0945].gex0945_p < 0).sum()),
               gex_pos_days=int((d[d.t == T0945].gex0945_p > 0).sum()), gex_neg_days_g7=int((d[d.t == T0945].gex0945_g7 < 0).sum()),
               a3m_events=int((a3.oi == 'p').sum()))
    return out, cov


def main():
    roots = [r for r in sys.argv[1:] if not r.startswith('-')] or ['SPXW', 'SPY', 'QQQ', 'IWM']
    hd = pd.read_parquet(os.path.join(DATA, 'hurdle.parquet'))
    os.makedirs(RES, exist_ok=True)
    parts, covs = [], []
    for root in roots:
        o, c = run_root(root, hd)
        o.to_parquet(os.path.join(AE, f'result_{root}.parquet'))
        parts.append(o)
        covs.append(c)
        print(root, len(o), 'rows', c, flush=True)
    res = pd.concat(parts, ignore_index=True)
    res.to_parquet(os.path.join(RES, 'AE.parquet'))
    res.to_csv(os.path.join(RES, 'AE.csv'), index=False)
    json.dump(covs, open(os.path.join(AE, 'coverage.json'), 'w'), indent=1)
    print('wrote', len(res), 'rows')


if __name__ == '__main__':
    main()
