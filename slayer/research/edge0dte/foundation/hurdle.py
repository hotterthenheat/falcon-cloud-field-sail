"""FOUNDATION task 4: the hurdle (PROTOCOL section 5), DISCOVERY only -> results/HURDLE.md, v2data/edge0dte/hurdle.parquet

Input: trades.parquet (foundation.trades): executable round trips (1-second NBBO, ask in / bid out at the first valid
quote >= t + 2 s, $0.65/contract/side) of the 0.30-delta call, the 0.30-delta put and the ATM straddle, held to h.

Per root x 30-min bucket x h (and pooled over buckets):
  cost       round-trip cost / premium = (entry half-spread + exit half-spread + fees) / premium (median, mean)
  direction  OLS over single options (calls and puts pooled), day-clustered:
                 ret_net = a + b * za + c * (V - 1)          za = sign-aligned Z (call +Z, put -Z)
             hurdle E[za]* = -(a + c * (mean V - 1)) / b : the sign-aligned mean Z a long 0.30-delta option needs for
             zero expected net P&L when realized variance stays at its average for that cell
  volatility OLS over straddles:  ret_net = a + c * (V - 1);  long hurdle (E[V] - 1)* = -a / c
             short-premium (iron-fly proxy): OLS ret_mid = a_m + c_m (V - 1); a short straddle pays the same
             round-trip cost, so it breaks even at (E[V] - 1)* = -(a_m + mean cost) / c_m (V must be BELOW 1 + this)
  CIs: day-clustered bootstrap (500 resamples of days) of each hurdle.
"""
import os

import numpy as np
import pandas as pd

from lib.config import DATA
from lib.stats import ols_cluster

OUT = os.path.join(os.path.dirname(__file__), '..', 'results', 'HURDLE.md')
NB = 500


def _fit(y, X):
    X1 = np.column_stack([np.ones(len(y)), X])
    b, *_ = np.linalg.lstsq(X1, y, rcond=None)
    return b


def dir_hurdle(d):
    y, za, v = d.ret.values, d.za.values, d.V.values - 1
    b = _fit(y, np.column_stack([za, v]))
    return -(b[0] + b[2] * np.mean(v)) / b[1] if b[1] > 0 else np.nan, b


def vol_hurdle(d):
    b = _fit(d.ret.values, d.V.values[:, None] - 1)
    bm = _fit(d.ret_mid.values, d.V.values[:, None] - 1)
    long_h = -b[0] / b[1] if b[1] > 0 else np.nan
    short_h = -(bm[0] + d.cost_rt.mean()) / bm[1] if bm[1] > 0 else np.nan
    return long_h, short_h, b, bm


def boot(d, fn, nb=NB, seed=3):
    days = d.day.values
    u, inv = np.unique(days, return_inverse=True)
    rows = [np.flatnonzero(inv == i) for i in range(len(u))]
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(nb):
        ix = np.concatenate([rows[i] for i in rng.integers(0, len(u), len(u))])
        try:
            out.append(fn(d.iloc[ix]))
        except Exception:
            continue
    return np.array(out, float)


def cell(d):
    s = d[d.struct.isin(['call', 'put'])].dropna(subset=['ret', 'za', 'V'])
    st = d[d.struct == 'straddle'].dropna(subset=['ret', 'ret_mid', 'V'])
    r = {'n_single': len(s), 'n_straddle': len(st), 'days': d.day.nunique(),
         'skip_rate': float(d.skip.notna().mean()) if len(d) else np.nan}
    if len(s) >= 30:
        r['cost_single_med'] = float(s.cost_rt.median())
        r['cost_single_mean'] = float(s.cost_rt.mean())
        r['ret_single'] = float(s.ret.mean())
        h, b = dir_hurdle(s)
        r.update({'hz': h, 'a': b[0], 'b': b[1], 'c': b[2], 'meanV': float(s.V.mean()), 'mean_za': float(s.za.mean())})
        ols = ols_cluster(s.ret.values, np.column_stack([s.za.values, s.V.values - 1]), s.day.values, names=['za', 'V-1'])
        r['b_se'] = float(ols['se'][1])
        bs = boot(s, lambda x: dir_hurdle(x)[0])
        bs = bs[np.isfinite(bs)]
        if len(bs) > 50:
            r['hz_lo'], r['hz_hi'] = np.percentile(bs, [2.5, 97.5])
    if len(st) >= 30:
        r['cost_straddle_med'] = float(st.cost_rt.median())
        r['cost_straddle_mean'] = float(st.cost_rt.mean())
        r['ret_straddle'] = float(st.ret.mean())
        r['meanV_straddle'] = float(st.V.mean())
        lh, sh, b, bm = vol_hurdle(st)
        r.update({'hv_long': lh, 'hv_short': sh, 'av': b[0], 'cv': b[1]})
        # supplementary (not the PROTOCOL definition): an unhedged straddle is paid by the terminal move, so also
        # regress on Z^2 - 1 (Z^2 = squared end-point move in implied units)
        bz = _fit(st.ret.values, st.Z.values[:, None] ** 2 - 1)
        r['hz2_long'] = -bz[0] / bz[1] if bz[1] > 0 else np.nan
        r['corr_V_Z2'] = float(np.corrcoef(st.V.values, st.Z.values ** 2)[0, 1])
        bs = boot(st, lambda x: np.array(vol_hurdle(x)[:2]))
        if len(bs):
            for j, k in enumerate(('hv_long', 'hv_short')):
                v = bs[:, j][np.isfinite(bs[:, j])]
                if len(v) > 50:
                    r[k + '_lo'], r[k + '_hi'] = np.percentile(v, [2.5, 97.5])
    return r


def fmt(x, pct=False, nd=2):
    if x is None or not np.isfinite(x):
        return '-'
    return f'{100 * x:.1f}%' if pct else f'{x:+.{nd}f}'


def ci(r, k, pct=False):
    if k not in r or not np.isfinite(r.get(k, np.nan)):
        return '-'
    lo, hi = r.get(k + '_lo', np.nan), r.get(k + '_hi', np.nan)
    if pct:
        return f'{100 * r[k]:+.1f}% [{100 * lo:+.1f}, {100 * hi:+.1f}]' if np.isfinite(lo) else f'{100 * r[k]:+.1f}%'
    return f'{r[k]:+.2f} [{lo:+.2f}, {hi:+.2f}]' if np.isfinite(lo) else f'{r[k]:+.2f}'


def main():
    tr = pd.read_parquet(os.path.join(DATA, 'trades.parquet'))
    tr = tr[(tr.split == 'DISCOVERY') & tr.purpose.isin(['base', 'hurdle'])].copy()
    res = []
    for root, g in tr.groupby('root'):
        for h, gh in g.groupby('h'):
            for b, gb in list(gh.groupby('bucket')) + [('all', gh)]:
                r = cell(gb)
                r.update({'root': root, 'h': h, 'bucket': b, 'times': gb.drop_duplicates(['day', 't']).shape[0]})
                res.append(r)
    res = pd.DataFrame(res)
    res.to_parquet(os.path.join(DATA, 'hurdle.parquet'))
    hord = {'15': 0, '30': 1, '60': 2, 'close': 3}
    L = ['# EDGE0DTE hurdle (PROTOCOL section 5) - DISCOVERY only', '',
         __doc__.split('\n', 2)[2].strip(), '',
         'Sample (fixed before any fill was seen, foundation/q1s_plan.py): SPXW every DISCOVERY expiry session at 10:00, '
         '12:00 and 14:00 plus 100 sessions per other 30-min bucket at a random grid time; SPY/QQQ/IWM 30 sessions per '
         'bucket. Bucket "09:30" holds the 09:45-09:55 decision times. Exit decision min(t + h, close - 2 min); '
         '"close" = 15:58:00 decision (the Stage-1 Z/V at h=close run to 16:00). Labels: fills OBS; returns, Z, V, '
         'hurdles CALC.', '',
         'Reading: hz = sign-aligned E[Z] a Stage-1 directional effect must reach before a long 0.30-delta option can '
         'make money after costs; hv_long = E[V]-1 a long straddle needs; hv_short = E[V]-1 below which a short '
         'straddle (iron-fly proxy, before the wing cost) makes money. A Stage-1 effect smaller than its hurdle cannot '
         'be an option edge.', '']
    total = tr.drop_duplicates(['root', 'day', 't'])
    L += ['## Sample', '', '| root | decision times | sessions | single-option round trips | straddle round trips | skipped |',
          '|---|---:|---:|---:|---:|---:|']
    for root, g in tr.groupby('root'):
        L.append(f"| {root} | {g.drop_duplicates(['day', 't']).shape[0]} | {g.day.nunique()} | "
                 f"{(g.struct != 'straddle').sum()} | {(g.struct == 'straddle').sum()} | {g.skip.notna().sum()} "
                 f"({100 * g.skip.notna().mean():.1f}%) |")
    sk = tr[tr.skip.notna()].groupby(['root', 'skip']).size()
    L += ['', 'Skip reasons: ' + ', '.join(f'{a} {b}: {n}' for (a, b), n in sk.items()), '']
    for root in ['SPXW', 'SPY', 'QQQ', 'IWM']:
        rr = res[res.root == root]
        if not len(rr):
            continue
        L += [f'## {root}', '',
              '| bucket | h | times | cost 0.30d (median / mean) | cost straddle (median / mean) | net ret 0.30d | hurdle E[za] [95%] | b (ret per Z) | net ret straddle | hurdle E[V]-1 long [95%] | E[V]-1 short below [95%] |',
              '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        rr = rr.assign(_h=rr.h.map(hord), _b=rr.bucket.map(lambda x: 'zz' if x == 'all' else x)).sort_values(['_b', '_h'])
        for _, r in rr.iterrows():
            r = r.to_dict()
            L.append(f"| {r['bucket']} | {r['h']} | {r['times']} | {fmt(r.get('cost_single_med'), True)} / {fmt(r.get('cost_single_mean'), True)} | "
                     f"{fmt(r.get('cost_straddle_med'), True)} / {fmt(r.get('cost_straddle_mean'), True)} | {fmt(r.get('ret_single'), True)} | "
                     f"{ci(r, 'hz')} | {fmt(r.get('b'), True)} | {fmt(r.get('ret_straddle'), True)} | {ci(r, 'hv_long')} | {ci(r, 'hv_short')} |")
        L.append('')
    L += ['## Summary: pooled over buckets', '', '| root | h | cost 0.30d median | cost straddle median | hurdle E[za] | hurdle E[V]-1 long | E[V]-1 short below | suppl.: E[Z^2]-1 long | corr(V, Z^2) |',
          '|---|---|---:|---:|---:|---:|---:|---:|---:|']
    for _, r in res[res.bucket == 'all'].assign(_h=lambda x: x.h.map(hord)).sort_values(['root', '_h']).iterrows():
        r = r.to_dict()
        L.append(f"| {r['root']} | {r['h']} | {fmt(r.get('cost_single_med'), True)} | {fmt(r.get('cost_straddle_med'), True)} | "
                 f"{ci(r, 'hz')} | {ci(r, 'hv_long')} | {ci(r, 'hv_short')} | {fmt(r.get('hz2_long'))} | {fmt(r.get('corr_V_Z2'))} |")
    open(OUT, 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L[-30:]))


if __name__ == '__main__':
    main()
