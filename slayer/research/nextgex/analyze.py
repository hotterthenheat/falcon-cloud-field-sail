"""NEXTGEX analysis: the pre-registered statistics of PREREG.md on the tables build.py wrote.

    python3 -I analyze.py            # all roots, DISCOVERY + CALIBRATION, writes results/RESULTS.json
"""
import json, math, os, sys
import numpy as np
import pandas as pd

V2 = '/home/user/falcon-cloud-field-sail/v2data/nextgex'
HERE = os.path.dirname(os.path.abspath(__file__))
B = 2000
RNG = np.random.default_rng(20261107)
YG = {'2020-21': ('2020', '2021'), '2022': ('2022',), '2023': ('2023',)}


PHASE = os.environ.get('NEXTGEX_PHASE', 'ALL')


def split(df):
    assert (df.day < '2025-01-01').all()
    if PHASE == 'DISC':  # DISCOVERY-only pass: the CALIBRATION slot repeats DISCOVERY (in-sample, not a look)
        d = df[df.day < '2024-01-01']
        return d, d
    return df[df.day < '2024-01-01'], df[(df.day >= '2024-01-01') & (df.day < '2025-01-01')]


def ci(a):
    a = np.asarray(a, float)
    a = a[np.isfinite(a)]
    return [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))] if len(a) else [np.nan, np.nan]


def wmat(n_days, n=B):
    """Day-resampling multiplicities, one row per bootstrap draw."""
    return RNG.multinomial(n_days, np.full(n_days, 1.0 / n_days), size=n).astype(float)


def ratio_stat(df, ycol='y', pcol='p'):
    """R = sum(y) / sum(p), day-clustered bootstrap. Returns point, CI, one-sided p (R >= 1), n."""
    d = df[np.isfinite(df[pcol])]
    g = d.groupby('day')[[ycol, pcol]].sum()
    pt = g[ycol].sum() / g[pcol].sum()
    W = wmat(len(g))
    bs = (W @ g[ycol].values) / (W @ g[pcol].values)
    return {'R': float(pt), 'ci': ci(bs), 'p_one': float((bs >= 1).mean()), 'n_pts': int(len(d)),
            'n_days': int(len(g)), 'freq': float(d[ycol].mean()), 'priced': float(d[pcol].mean())}


def diff_stat(df, f):
    """Generic day-clustered bootstrap of a statistic f(frame)."""
    days = df.day.unique()
    grp = {d: x for d, x in df.groupby('day')}
    pt = f(df)
    bs = []
    for _ in range(B):
        s = RNG.choice(days, len(days), replace=True)
        bs.append(f(pd.concat([grp[d] for d in s], ignore_index=True)))
    return float(pt), ci(bs), np.array(bs)


# ------------------------------------------------------------------ concept 1


def logit(p):
    p = np.clip(p, 0.002, 0.998)
    return np.log(p / (1 - p))


def fit_logit(X, y, it=50):
    w = np.zeros(X.shape[1])
    for _ in range(it):
        eta = X @ w
        mu = 1 / (1 + np.exp(-eta))
        W = mu * (1 - mu) + 1e-9
        H = X.T @ (X * W[:, None]) + 1e-8 * np.eye(X.shape[1])
        g = X.T @ (y - mu)
        step = np.linalg.solve(H, g)
        w += step
        if np.abs(step).max() < 1e-10:
            break
    return w


def design(d):
    L = logit(d.p.values)
    side = (d.z.values > 0).astype(float)
    return np.column_stack([np.ones(len(d)), L, side, L * side])


def concept1(root, odds, otm):
    out = {}
    disc, cal = split(odds)
    one = lambda x: x[np.abs(x.z) == 1.0]
    out['H1.1'] = {'DISCOVERY': ratio_stat(one(disc)), 'CALIBRATION': ratio_stat(one(cal))}
    out['H1.1']['years'] = {k: ratio_stat(one(disc[disc.day.str[:4].isin(v)])) for k, v in YG.items()}
    out['H1.1']['by_time'] = {str(t): {'DISCOVERY': ratio_stat(one(disc[disc.t == t])),
                                       'CALIBRATION': ratio_stat(one(cal[cal.t == t]))} for t in sorted(odds.t.unique())}
    if 'p_app' in odds:
        out['H1.1']['sens_app_smile'] = {'DISCOVERY': ratio_stat(one(disc), pcol='p_app'),
                                         'CALIBRATION': ratio_stat(one(cal), pcol='p_app')}
    # H1.2: where the wedge sits
    h12 = {}
    for nm, part in (('DISCOVERY', disc), ('CALIBRATION', cal)):
        h12[nm] = {str(z): ratio_stat(part[part.z == z]) for z in sorted(odds.z.unique())}
        sub = one(part)
        sub = sub[np.isfinite(sub.p)]
        g = sub.assign(yu=sub.y * (sub.z > 0), pu=sub.p * (sub.z > 0), yd=sub.y * (sub.z < 0),
                       pd_=sub.p * (sub.z < 0)).groupby('day')[['yu', 'pu', 'yd', 'pd_']].sum()
        W = wmat(len(g))
        bs = (W @ g.yu.values) / (W @ g.pu.values) - (W @ g.yd.values) / (W @ g.pd_.values)
        pt = g.yu.sum() / g.pu.sum() - g.yd.sum() / g.pd_.sum()
        h12[nm]['R(+1)-R(-1)'] = {'pt': float(pt), 'ci': ci(bs)}
    out['H1.2'] = h12
    # H1.3: correction fitted on DISCOVERY, Brier on CALIBRATION
    h13 = {'by_time': {}}
    cal_rows = []
    for t in sorted(odds.t.unique()):
        dtr = disc[(disc.t == t) & np.isfinite(disc.p)]
        dte = cal[(cal.t == t) & np.isfinite(cal.p)].copy()
        w = fit_logit(design(dtr), dtr.y.values)
        dte['pc'] = 1 / (1 + np.exp(-(design(dte) @ w)))
        h13['by_time'][str(t)] = {'coef': w.tolist(), 'n_train': int(len(dtr)), 'n_test': int(len(dte))}
        cal_rows.append(dte)
    ct = pd.concat(cal_rows, ignore_index=True)
    ct['b_raw'] = (ct.p - ct.y) ** 2
    ct['b_cor'] = (ct.pc - ct.y) ** 2
    pc = np.clip(ct.p, 1e-4, 1 - 1e-4)
    cc = np.clip(ct.pc, 1e-4, 1 - 1e-4)
    ct['l_raw'] = ct.y * np.log(pc) + (1 - ct.y) * np.log(1 - pc)
    ct['l_cor'] = ct.y * np.log(cc) + (1 - ct.y) * np.log(1 - cc)
    g = ct.groupby('day')[['b_raw', 'b_cor', 'l_raw', 'l_cor']].sum()
    n = ct.groupby('day').size()
    bs, ls = [], []
    for _ in range(B):
        s = RNG.integers(0, len(g), len(g))
        bs.append((g.b_raw.values[s].sum() - g.b_cor.values[s].sum()) / n.values[s].sum())
        ls.append((g.l_cor.values[s].sum() - g.l_raw.values[s].sum()) / n.values[s].sum())
    bs = np.array(bs)
    h13['brier_raw'] = float(ct.b_raw.mean())
    h13['brier_cor'] = float(ct.b_cor.mean())
    h13['brier_gain'] = float(ct.b_raw.mean() - ct.b_cor.mean())
    h13['brier_gain_ci'] = ci(bs)
    h13['brier_gain_rel'] = h13['brier_gain'] / h13['brier_raw']
    h13['p_one'] = float((bs <= 0).mean())
    h13['logscore_gain'] = float(ct.l_cor.mean() - ct.l_raw.mean())
    h13['logscore_gain_ci'] = ci(ls)
    h13['n_pts'], h13['n_days'] = int(len(ct)), int(len(g))
    # reliability table on CALIBRATION: priced vs corrected vs realised, by priced-probability bin
    ct['bin'] = pd.cut(ct.p, [0, .02, .05, .1, .2, .3, .5])
    rel = ct.groupby('bin', observed=True).agg(n=('y', 'size'), priced=('p', 'mean'), corrected=('pc', 'mean'),
                                                real=('y', 'mean'))
    h13['reliability_CAL'] = rel.reset_index().astype({'bin': str}).to_dict('records')
    # same table on DISCOVERY with the raw priced odds only (what the map was fitted to)
    disc2 = disc[np.isfinite(disc.p)].copy()
    disc2['bin'] = pd.cut(disc2.p, [0, .02, .05, .1, .2, .3, .5])
    h13['reliability_DISC'] = disc2.groupby('bin', observed=True).agg(n=('y', 'size'), priced=('p', 'mean'),
                                                                      real=('y', 'mean')).reset_index().astype(
        {'bin': str}).to_dict('records')
    # the frozen map, for the prototype (pooled over times as well, for a time not on the grid)
    dall = disc[np.isfinite(disc.p)]
    h13['map_pooled'] = fit_logit(design(dall), dall.y.values).tolist()
    dcal = odds[np.isfinite(odds.p)]
    h13['map_disc_plus_cal_by_time'] = {str(t): fit_logit(design(dcal[dcal.t == t]), dcal[dcal.t == t].y.values).tolist()
                                        for t in sorted(odds.t.unique())}
    out['H1.3'] = h13
    # H1.4 PIT
    pit = {}
    for nm, part in (('DISCOVERY', disc), ('CALIBRATION', cal)):
        u = part.drop_duplicates(['day', 't']).u.dropna()
        h = np.histogram(u, bins=np.linspace(0, 1, 11))[0]
        pit[nm] = {'n': int(len(u)), 'deciles': (h / max(1, len(u))).round(4).tolist(),
                   'outer_two_deciles': float(((u < .1) | (u > .9)).mean()),
                   'quoted_range_cover': float(part.drop_duplicates(['day', 't']).u.notna().mean())}
    out['H1.4'] = pit
    # H1.5 payoff-to-premium
    h15 = {}
    od, oc = split(otm)
    for nm, part in (('DISCOVERY', od), ('CALIBRATION', oc)):
        h15[nm] = {}
        for z in sorted(otm.z.unique()):
            x = part[(part.z == z) & np.isfinite(part['mid']) & (part['mid'] > 0)]
            if not len(x):
                continue
            g2 = x.groupby('day')[['pay', 'mid', 'ask']].sum()
            pm = g2.pay.sum() / g2['mid'].sum()
            pa = g2.pay.sum() / g2['ask'].sum()
            b1 = []
            for _ in range(B):
                s = RNG.integers(0, len(g2), len(g2))
                b1.append(g2.pay.values[s].sum() / g2['mid'].values[s].sum())
            h15[nm][str(z)] = {'pay_per_mid': float(pm), 'ci': ci(b1), 'pay_per_ask': float(pa), 'n': int(len(x)),
                               'mean_mid': float(x['mid'].mean())}
    out['H1.5'] = h15
    # null calibration: closes drawn from each session-time's own priced distribution
    with open(os.path.join(V2, f'{root}_curves.json')) as fh:
        curves = {(c['day'], c['t']): c for c in json.load(fh)}
    dd = one(disc)
    dd = dd[np.isfinite(dd.p)]
    cK = np.where(dd.z < 0, dd.p, 1 - dd.p)  # priced CDF at K
    keys = list(zip(dd.day, dd.t))
    ukeys = sorted(set(keys))
    kidx = {k: i for i, k in enumerate(ukeys)}
    ki = np.array([kidx[k] for k in keys])
    cover, Rs = 0, []
    nnull = 200
    for r in range(nnull):
        u = RNG.random(len(ukeys))[ki]
        ysim = np.where(dd.z < 0, (u <= cK), (u > cK)).astype(float)
        tmp = dd.assign(y=ysim)
        g3 = tmp.groupby('day')[['y', 'p']].sum()
        Rs.append(g3.y.sum() / g3.p.sum())
        if r < 40:  # bootstrap coverage on a subset (cost)
            bb = []
            for _ in range(500):
                s = RNG.integers(0, len(g3), len(g3))
                bb.append(g3.y.values[s].sum() / g3.p.values[s].sum())
            lo, hi = np.percentile(bb, [2.5, 97.5])
            cover += int(lo <= 1 <= hi)
    out['null'] = {'runs': nnull, 'R_mean': float(np.mean(Rs)), 'R_p2.5_p97.5': ci(Rs),
                   'ci_covers_1_share(40 runs)': cover / 40}
    return out


# ------------------------------------------------------------------ concept 2


def prep_flies(fl, feat='oi'):
    fl = fl[np.isfinite(fl.q)].copy()
    fl['e'] = fl.g - fl.q
    fl['lx'] = np.log1p(fl[feat])
    gs = fl.groupby(['day', 't']).lx
    fl['x'] = (fl.lx - gs.transform('mean')) / gs.transform('std')
    fl = fl[np.isfinite(fl.x)]
    fl['cell'] = (fl.k >= fl.F).astype(int) * 10 + np.minimum((fl.dist.abs() / 0.25).astype(int), 5)
    return fl


def beta(fl):
    xd = fl.x - fl.groupby('cell').x.transform('mean')
    ed = fl.e - fl.groupby('cell').e.transform('mean')
    return float((xd * ed).sum() / (xd * xd).sum())


def beta_t(fl):
    """beta and its day-clustered (CR0) t statistic."""
    xd = (fl.x - fl.groupby('cell').x.transform('mean')).values
    ed = (fl.e - fl.groupby('cell').e.transform('mean')).values
    b = (xd * ed).sum() / (xd * xd).sum()
    r = ed - b * xd
    sc = pd.Series(xd * r).groupby(fl.day.values).sum().values
    se = math.sqrt((sc ** 2).sum()) / (xd * xd).sum()
    return b, b / se


def beta_boot(fl):
    """beta with cell fixed effects re-estimated in every resample, from per-(day, cell) sufficient statistics."""
    t = fl.assign(n=1.0, xx=fl.x * fl.x, xe=fl.x * fl.e).groupby(['day', 'cell'])[['n', 'x', 'e', 'xx', 'xe']].sum()
    arr = {c: t[c].unstack(fill_value=0.0) for c in ['n', 'x', 'e', 'xx', 'xe']}
    W = wmat(arr['n'].shape[0])
    N, X, E, XX, XE = (W @ arr[c].values for c in ['n', 'x', 'e', 'xx', 'xe'])
    with np.errstate(invalid='ignore', divide='ignore'):
        num = np.nansum(XE - np.where(N > 0, X * E / N, 0), axis=1)
        den = np.nansum(XX - np.where(N > 0, X * X / N, 0), axis=1)
    return num / den


def concept2(root, flies, curves):
    out = {}
    res = {}
    for feat in ('oi', 'goi'):
        for t in sorted(flies.t.unique()):
            fl = prep_flies(flies[flies.t == t], feat)
            disc, cal = split(fl)
            cell = {}
            for nm, part in (('DISCOVERY', disc), ('CALIBRATION', cal)):
                bs = beta_boot(part)
                floor = float(part[part.dist.abs() <= 0.5].q.mean())
                cell[nm] = {'beta': beta(part), 'ci': ci(bs), 'p_one': float((bs <= 0).mean()), 'n_flies': int(len(part)),
                            'n_days': int(part.day.nunique()), 'floor_10pct_q': 0.1 * floor,
                            'mean_e': float(part.e.mean()), 'mean_q': float(part.q.mean()), 'mean_g': float(part.g.mean())}
            if feat == 'oi' and t == 840:
                cell['years'] = {k: {'beta': beta(disc[disc.day.str[:4].isin(v)]),
                                     'ci': ci(beta_boot(disc[disc.day.str[:4].isin(v)]))} for k, v in YG.items()}
                # permutation null
                nb, npass = [], 0
                for r in range(200):
                    p = disc.copy()
                    key = RNG.random(len(p))
                    order = np.lexsort((key, p.day.values))
                    base = np.lexsort((np.arange(len(p)), p.day.values))
                    xv = np.empty(len(p))
                    xv[base] = p.x.values[order]
                    p['x'] = xv
                    b, tt = beta_t(p)
                    nb.append(b)
                    npass += int(tt > 1.645)
                cell['perm_null'] = {'p95': float(np.percentile(nb, 95)), 'real_beats_p95': bool(cell['DISCOVERY']['beta'] > np.percentile(nb, 95)),
                                     'null_pass_rate_one_sided_5pct': npass / 200}
                cell['DISCOVERY']['t_cr0'] = beta_t(disc)[1]
            res[f'{feat}@{t}'] = cell
    out['H2.1_and_H2.3'] = res
    # H2.2: the largest-OI strike within 1 s at 14:00
    fl = prep_flies(flies[flies.t == 840], 'oi')
    rows = []
    for (d, t), x in fl.groupby(['day', 't']):
        y = x[x.dist.abs() <= 1]
        if not len(y):
            continue
        ks = y.loc[y.oi.idxmax()]
        c = curves.get((d, t))
        pr = np.nan
        if c:
            xs, ys = np.array(c['xs']), np.array(c['ys'])
            lo, hi = ks.k - ks.w / 2, ks.k + ks.w / 2
            if xs[0] <= lo and hi <= xs[-1]:
                pr = float(np.interp(hi, xs, ys) - np.interp(lo, xs, ys))
        rows.append(dict(day=d, k=ks.k, cell=ks.cell, e=ks.e, q=ks.q, g=ks.g, hit=float(abs(ks.ST - ks.k) <= ks.w / 2),
                         pr=pr, oi_share=ks.oi / x.oi.sum(), dist=ks.dist))
    kst = pd.DataFrame(rows)
    cellmean = fl.groupby('cell').e.mean()  # includes K* rows; a conservative contrast
    kst['e_vs_cell'] = kst.e - kst.cell.map(cellmean)
    h22 = {}
    for nm, part in zip(('DISCOVERY', 'CALIBRATION'), split(kst)):
        g = part.groupby('day').e_vs_cell.agg(['sum', 'size'])
        W = wmat(len(g))
        pt, c = float(part.e_vs_cell.mean()), ci((W @ g['sum'].values) / (W @ g['size'].values))
        pp = part[np.isfinite(part.pr)]
        h22[nm] = {'n_days': int(len(part)), 'e_vs_cell': pt, 'ci': c, 'mean_q': float(part.q.mean()),
                   'mean_g': float(part.g.mean()), 'hit_rate': float(pp.hit.mean()), 'priced_hit': float(pp.pr.mean()),
                   'hit_ratio': ratio_stat(pp.rename(columns={'hit': 'y', 'pr': 'p'}))}
    out['H2.2'] = h22
    return out


def holm(ps):
    order = np.argsort(ps)
    m = len(ps)
    adj = np.empty(m)
    run = 0
    for i, j in enumerate(order):
        run = max(run, (m - i) * ps[j])
        adj[j] = min(1, run)
    return adj.tolist()


def main(roots):
    allres = {}
    for root in roots:
        odds = pd.read_parquet(os.path.join(V2, f'{root}_odds.parquet'))
        otm = pd.read_parquet(os.path.join(V2, f'{root}_otm.parquet'))
        flies = pd.read_parquet(os.path.join(V2, f'{root}_flies.parquet'))
        if PHASE == 'DISC':
            odds, otm, flies = (x[x.day < '2024-01-01'] for x in (odds, otm, flies))
        with open(os.path.join(V2, f'{root}_curves.json')) as fh:
            curves = {(c['day'], c['t']): c for c in json.load(fh)}
        r = {'concept1': concept1(root, odds, otm), 'concept2': concept2(root, flies, curves)}
        allres[root] = r
        print(root, 'done', flush=True)
    s = allres['SPXW']
    ps = [s['concept1']['H1.1']['DISCOVERY']['p_one'], s['concept1']['H1.3']['p_one'],
          s['concept2']['H2.1_and_H2.3']['oi@840']['DISCOVERY']['p_one']]
    allres['holm'] = {'tests': ['H1.1 DISC', 'H1.3 CAL', 'H2.1 DISC'], 'p_one': ps, 'holm': holm(ps)}
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    name = 'RESULTS_DISC_ONLY.json' if PHASE == 'DISC' else 'RESULTS.json'
    with open(os.path.join(HERE, 'results', name), 'w') as fh:
        json.dump(allres, fh, indent=1, default=float)


if __name__ == '__main__':
    main(sys.argv[1:] or ['SPXW', 'SPY', 'QQQ', 'IWM'])
