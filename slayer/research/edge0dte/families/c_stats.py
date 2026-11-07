"""Family C Stage-1 statistics on DISCOVERY (<= 2023-12-31) only. Raw results; no FDR, no pass/fail.

  cd slayer/research/edge0dte && python3 -m families.c_stats

Inputs: the feature table (families.c_build) joined to the panel's DISCOVERY rows (Z_h, V_h and the controls
z_prev30, rv_ratio30, etf_vol_ratio30). Output: results/stage1/C.parquet + C.csv (one row per row_id x root x outcome x
horizon x parameter) and results/stage1/C_sessions.json (sessions used per root and row).

Statistic per cell (PROTOCOL section 4):
  sign-aligned rows  value_i = d_i * (y_i - mu_t), y = Z_h (or ln V_h), d = predicted direction (+1/-1) of the row,
                     mu_t = mean of y at the same decision time over the rows where the feature is observable;
                     effect = mean(value) over rows with d != 0; CI/p = day-clustered bootstrap (2000 resamples of days).
  unsigned V rows    value_i = ln V_i - mu_t over event rows (C7).
  IC                 Spearman rank correlation of the continuous feature with (y - mu_t) over the observable rows,
                     95% CI / p from a day-clustered bootstrap (2000) of the rank correlation (full-sample ranks).
  incremental rows   (X3, X11) OLS of Z_h on the feature plus controls with CR1 day-clustered errors
                     (lib.stats.ols_cluster); effect = coefficient, CI = coef +/- t(G-1, 0.975) se, p from the t test.
expected_sign is the registry's predicted sign of `effect` (and of IC).
"""
import json
import os

import numpy as np
import pandas as pd
from scipy import stats as st

from families.c_build import load
from lib.config import DATA
from lib.stats import boot_mean, ols_cluster

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTD = os.path.join(HERE, 'results', 'stage1')
HS = ('15', '30', '60', 'close')
YEARS = (('2020_21', ('2020', '2021')), ('2022', ('2022',)), ('2023', ('2023',)))
NB = 2000


def ic_boot(x, y, day, n_boot=NB, seed=1):
    x, y, day = np.asarray(x, float), np.asarray(y, float), np.asarray(day)
    ok = np.isfinite(x) & np.isfinite(y)
    x, y, day = x[ok], y[ok], day[ok]
    if len(x) < 30:
        return (np.nan,) * 4
    rx, ry = st.rankdata(x), st.rankdata(y)
    u, inv = np.unique(day, return_inverse=True)
    G = len(u)
    agg = [np.bincount(inv, weights=w, minlength=G) for w in (np.ones(len(rx)), rx, ry, rx * rx, ry * ry, rx * ry)]
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, G, (n_boot, G))

    def corr(n, a, b, aa, bb, ab):
        cov = ab / n - a * b / n / n
        return cov / np.sqrt((aa / n - (a / n) ** 2) * (bb / n - (b / n) ** 2))
    full = float(corr(*[a.sum() for a in agg]))
    bs = corr(*[a[idx].sum(1) for a in agg])
    bs = bs[np.isfinite(bs)]
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return full, float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), float(max(p, 1 / n_boot))


def year_of(day):
    return np.array([d[:4] for d in day])


def per_year(val, day, mask):
    out = {}
    yr = year_of(day)
    for lab, ys in YEARS:
        m = mask & np.isin(yr, ys) & np.isfinite(val)
        out[f'eff_{lab}'] = float(val[m].mean()) if m.any() else np.nan
        out[f'n_{lab}'] = int(m.sum())
        out[f'sess_{lab}'] = int(len(np.unique(day[m])))
    return out


def signed_cell(df, ycol, d, xcont, obs, log=False):
    """d: predicted direction per row (+1/-1, 0 = no signal); obs: rows where the feature is observable."""
    y = df[ycol].values.astype(float)
    if log:
        y = np.where(y > 0, np.log(np.where(y > 0, y, 1)), np.nan)
    ok = obs & np.isfinite(y)
    mu = pd.Series(np.where(ok, y, np.nan)).groupby(df.t.values).transform('mean').values
    adj = y - mu
    ev = ok & np.isfinite(d) & (d != 0)
    val = np.where(ev, d * adj, np.nan)
    day = df.day.values
    m, lo, hi, p = boot_mean(val[ev], day[ev], n_boot=NB)
    out = {'n_obs': int(ev.sum()), 'n_sessions': int(len(np.unique(day[ev]))), 'effect': m, 'ci_lo': lo, 'ci_hi': hi,
           'p_value': p, 'p_source': 'day-cluster bootstrap', 'cond_mean_raw': float(np.nanmean(d[ev] * y[ev])) if ev.any() else np.nan}
    if xcont is not None:
        ic, ilo, ihi, ip = ic_boot(np.where(ok, xcont, np.nan), adj, day)
        out.update(ic=ic, ic_lo=ilo, ic_hi=ihi, ic_p=ip)
    out.update(per_year(val, day, ev))
    return out, ev


def ols_cell(df, ycol, xname, ctrl):
    y = df[ycol].values.astype(float)
    b = pd.get_dummies(df.bucket, drop_first=True, dtype=float)
    X = np.column_stack([df[xname].values.astype(float)] + [df[c].values.astype(float) for c in ctrl] + [b.values])
    names = [xname] + list(ctrl) + [f'b{c}' for c in b.columns]
    day = df.day.values
    r = ols_cluster(y, X, day, names=names)
    ok = np.isfinite(y) & np.all(np.isfinite(X), 1)
    tq = st.t.ppf(0.975, max(r['n_clusters'] - 1, 1))
    beta, se = float(r['beta'][1]), float(r['se'][1])
    out = {'n_obs': int(r['n']), 'n_sessions': int(r['n_clusters']), 'effect': beta, 'ci_lo': beta - tq * se,
           'ci_hi': beta + tq * se, 'p_value': float(r['p'][1]), 'p_source': 'OLS CR1 day-clustered t',
           'ols_se': se, 'ols_r2': float(r['r2']),
           'effect_za_equiv': beta * float(np.mean(np.abs(df[xname].values[ok]))),
           'ols_controls': ','.join(ctrl) + ',bucket FE'}
    yr = year_of(day)
    for lab, ys in YEARS:
        m = ok & np.isin(yr, ys)
        if len(np.unique(day[m])) >= 30 and np.count_nonzero(X[m, 0]) >= 2:
            rr = ols_cluster(y[m], X[m], day[m], names=names)
            out[f'eff_{lab}'] = float(rr['beta'][1])
        else:
            out[f'eff_{lab}'] = np.nan
        out[f'n_{lab}'] = int(m.sum())
        out[f'sess_{lab}'] = int(len(np.unique(day[m])))
    return out, ok


def load_root(root):
    f = load(root)
    p = pd.read_parquet(os.path.join(DATA, 'panel', f'{root}.parquet'))
    p = p[p.split == 'DISCOVERY'].drop(columns=['root'])
    df = f.merge(p, on=['day', 't'], how='inner')
    assert df.day.max() < '2024-01-01' and (df.split == 'DISCOVERY').all()
    df = df.sort_values(['day', 't']).reset_index(drop=True)
    for c in ('etf_vol_ratio30', 'rv_ratio30'):
        df['ln_' + c] = np.log(df[c].where(df[c] > 0))
    return df


def main():
    hz = pd.read_parquet(os.path.join(DATA, 'hurdle.parquet'))
    hz = hz[hz.bucket == 'all'].set_index(['root', 'h'])
    rows, used = [], {}

    def add(base, res, ev, df, root):
        h = base['horizon']
        hk = (root, h)
        base.update(res)
        if hk in hz.index:
            base.update(hurdle_z=float(hz.loc[hk, 'hz']), hurdle_v_long=float(hz.loc[hk, 'hv_long']),
                        hurdle_v_short=float(hz.loc[hk, 'hv_short']))
        rows.append(base)
        key = f"{base['row_id']}|{base['param']}"
        used.setdefault(root, {}).setdefault(key, sorted(set(df.day.values[ev])))

    for root in os.environ.get('C_ROOTS', 'SPXW,SPY,QQQ,IWM').split(','):
        df = load_root(root)
        print(root, len(df), df.day.nunique(), flush=True)
        flowroot = root in ('SPXW', 'SPY')
        d0 = dict(root=root, kind='primary' if root == 'SPXW' else 'replication')

        # ---------------- C1 unusual volume (flow)
        if flowroot:
            rc, rp = df.c1_rc.values, df.c1_rp.values
            obs = np.isfinite(rc) & np.isfinite(rp)
            with np.errstate(divide='ignore', invalid='ignore'):
                xc = np.where((rc > 0) & (rp > 0), np.log(rc / rp), np.nan)
            for pk, thr in (('P', 3), ('G', 2), ('G', 5)):
                d = np.where(obs & (np.maximum(rc, rp) > thr), np.where(rc > rp, 1.0, -1.0), 0.0)
                for h in HS:
                    res, ev = signed_cell(df, f'Z_{h}', d, xc, obs)
                    add(dict(d0, row_id='C1', outcome='Z', horizon=h, param_kind=pk, param=f'ratio>{thr}',
                             expected_sign=1, label='CALC (flow OBS)', test='event, sign-aligned'), res, ev, df, root)

        # ---------------- C2 aggressive delta flow (flow)
        if flowroot:
            for pk, W in (('P', 15), ('G', 5), ('G', 30)):
                x = df[f'c2_std{W}'].values
                obs = np.isfinite(x)
                d = np.where(obs, np.sign(x), 0.0)
                for h in HS:
                    res, ev = signed_cell(df, f'Z_{h}', d, x, obs)
                    add(dict(d0, row_id='C2', outcome='Z', horizon=h, param_kind=pk, param=f'{W}min',
                             expected_sign=1, label='CALC (flow OBS, board delta CALC)', test='sign of flow, sign-aligned'),
                        res, ev, df, root)

        # ---------------- C3 board size imbalance (h = 15 only)
        for pk, W in (('P', 15), ('G', 5), ('G', 30)):
            x = df[f'c3_a{W}'].values
            obs = np.isfinite(x)
            res, ev = signed_cell(df, 'Z_15', np.where(obs, np.sign(x), 0.0), x, obs)
            add(dict(d0, row_id='C3', outcome='Z', horizon='15', param_kind=pk, param=f'{W}min avg',
                     expected_sign=1, label='OBS sizes / CALC', test='sign of imbalance, sign-aligned'), res, ev, df, root)

        # ---------------- C4 residual IV change: Z (residual up -> Z < 0), V (residual up -> ln V > 0)
        for pk, L in (('P', 15), ('G', 30)):
            x = df[f'c4_r{L}'].values
            obs = np.isfinite(x)
            d = np.where(obs, np.sign(x), 0.0)
            for h in HS:
                res, ev = signed_cell(df, f'Z_{h}', d, x, obs)
                add(dict(d0, row_id='C4', outcome='Z', horizon=h, param_kind=pk, param=f'{L}min', expected_sign=-1,
                         label='CALC', test='sign of residual, sign-aligned'), res, ev, df, root)
                res, ev = signed_cell(df, f'V_{h}', d, x, obs, log=True)
                vv = df[f'V_{h}'].values
                res['cond_V_minus1'] = float(np.nanmean(vv[ev & (d > 0)])) - 1
                res['uncond_V_minus1'] = float(np.nanmean(vv[ev])) - 1
                add(dict(d0, row_id='C4', outcome='V', horizon=h, param_kind=pk, param=f'{L}min', expected_sign=1,
                         label='CALC', test='sign of residual, sign-aligned ln V'), res, ev, df, root)

        # ---------------- C5 skew change (skew up -> Z < 0)
        for pk, L in (('P', 15), ('G', 30)):
            x = df[f'c5_d{L}'].values
            obs = np.isfinite(x)
            d = np.where(obs, np.sign(x), 0.0)
            for h in HS:
                res, ev = signed_cell(df, f'Z_{h}', d, x, obs)
                add(dict(d0, row_id='C5', outcome='Z', horizon=h, param_kind=pk, param=f'{L}min', expected_sign=-1,
                         label='CALC', test='sign of skew change, sign-aligned'), res, ev, df, root)

        # ---------------- C6 OI change, one observation per session at 09:45, h = close
        g6 = df[df.t == 35100].reset_index(drop=True)
        for pk, pc in (('P', 2), ('G', 1), ('G', 5)):
            x = g6[f'c6_raw{pc}'].values
            obs = np.isfinite(x)
            res, ev = signed_cell(g6, 'Z_close', np.where(obs, np.sign(x), 0.0), g6[f'c6_norm{pc}'].values, obs)
            add(dict(d0, row_id='C6', outcome='Z', horizon='close', param_kind=pk, param=f'+/-{pc}% of open',
                     expected_sign=1, label='OBS (OI) / CALC', test='sign of put-minus-call OI build at 09:45, sign-aligned'),
                res, ev, g6, root)

        # ---------------- C7 liquidity: wide spread ratio -> ln V > 0
        x = df.c7_ratio.values
        obs = np.isfinite(x)
        for pk, thr in (('P', 1.5), ('G', 1.25), ('G', 2.0)):
            ind = np.where(obs & (x > thr), 1.0, 0.0)
            for h in HS:
                res, ev = signed_cell(df, f'V_{h}', ind, x, obs, log=True)
                vv = df[f'V_{h}'].values
                res['cond_V_minus1'] = float(np.nanmean(vv[ev])) - 1 if ev.any() else np.nan
                res['uncond_V_minus1'] = float(np.nanmean(vv[obs])) - 1
                add(dict(d0, row_id='C7', outcome='V', horizon=h, param_kind=pk, param=f'ratio>{thr}', expected_sign=1,
                         label='CALC', test='event, ln V minus time-of-day mean'), res, ev, df, root)

        # ---------------- X3: C2 flow incremental over prior return, ETF volume, prior RV (+ bucket FE)
        ctrl = ['z_prev30', 'ln_etf_vol_ratio30', 'ln_rv_ratio30']
        if flowroot:
            for pk, W in (('P', 15), ('G', 5), ('G', 30)):
                for h in HS:
                    res, ok = ols_cell(df, f'Z_{h}', f'c2_std{W}', ctrl)
                    add(dict(d0, row_id='X3', outcome='Z', horizon=h, param_kind=pk, param=f'C2 {W}min',
                             expected_sign=1, label='CALC', test='incremental OLS'), res, ok, df, root)

        # ---------------- X11: C1 unusual volume incremental over B6 momentum and ETF volume (+ prior return, RV, FE)
        if flowroot:
            rc, rp = df.c1_rc.values, df.c1_rp.values
            obs = np.isfinite(rc) & np.isfinite(rp)
            for pk, thr in (('P', 3), ('G', 2), ('G', 5)):
                df['c1_sig'] = np.where(obs, np.where(np.maximum(rc, rp) > thr, np.where(rc > rp, 1.0, -1.0), 0.0), np.nan)
                for h in HS:
                    res, ok = ols_cell(df, f'Z_{h}', 'c1_sig', ['b6ctl_b6', 'b6ctl_z5'] + ctrl)
                    res['n_events'] = int(((df.c1_sig != 0) & ok).sum())
                    res['effect_za_equiv'] = res['effect']          # +/-1 event regressor: Z per event
                    add(dict(d0, row_id='X11', outcome='Z', horizon=h, param_kind=pk, param=f'C1 ratio>{thr}',
                             expected_sign=1, label='CALC', test='incremental OLS'), res, ok, df, root)
        del df

    out = pd.DataFrame(rows)
    if os.environ.get('C_DRYRUN'):
        print(out.head(40).T)
        return
    os.makedirs(OUTD, exist_ok=True)
    out.to_parquet(os.path.join(OUTD, 'C.parquet'), index=False)
    out.to_csv(os.path.join(OUTD, 'C.csv'), index=False)
    sess = {r: {k: {'n': len(v), 'first': v[0] if v else None, 'last': v[-1] if v else None} for k, v in d.items()}
            for r, d in used.items()}
    json.dump(sess, open(os.path.join(OUTD, 'C_sessions.json'), 'w'), indent=1)
    print(out.shape)


if __name__ == '__main__':
    main()
