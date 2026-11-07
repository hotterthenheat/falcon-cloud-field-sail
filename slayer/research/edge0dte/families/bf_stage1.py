"""EDGE0DTE Stage 1, family BF (B1-B8, F1-F9, X1/X2/X5/X6/X12), DISCOVERY only (sessions <= 2023-12-31).

  cd slayer/research/edge0dte
  python3 -m families.bf_stage1 events SPXW SPY      # event table per root -> v2data/edge0dte/stage1/BF_events_<root>.parquet
  python3 -m families.bf_stage1 stats                # -> results/stage1/BF.parquet, BF.csv, BF.md

Events (families/bf.py) are restricted to the decision window of the grid: 09:45 <= t <= close - 30 min. Several
events of one (row, param) at the same (day, t) are merged: same direction -> one event; opposite directions -> dropped.
Outcomes: lib.outcomes.zv at the event time (identical to the panel's Z at grid times).

Effect (OUTPUT CONTRACT): mean over events of dir * (Z_h - mu_root(bucket(t), h)), mu = the unconditional DISCOVERY mean
of Z_h of that root over all grid times of the same 30-minute bucket (lib.config.bucket; from the FOUNDATION panel).
CI / p: day-clustered bootstrap (2,000 resamples of days, lib.stats.boot_mean). Conditional tests X: difference of the
same quantity between the two regimes, lib.stats.boot_diff (days resampled, both regimes move together).
Hurdle: |E[za]| hz of HURDLE.md for the root, each event's 30-minute bucket and h, averaged over the row's events
(bucket cell missing -> the root's pooled 'all' cell); hurdle_all = the pooled cell.
"""
import json
import math
import os
import sys
import time

import numpy as np
import pandas as pd

from lib import cal, dealer, panel
from lib.config import DATA, HORIZONS, YEAR_MIN, bucket, split
from lib.data import bars as load_bars, chain as load_chain
from lib.outcomes import zv
from lib.stats import boot_diff, boot_mean, spearman_ic

from families import bf

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = os.path.dirname(HERE)
OUT_EV = os.path.join(DATA, 'stage1')
OUT_RES = os.path.join(EDGE, 'results', 'stage1')
ROOTS = ('SPXW', 'SPY', 'QQQ', 'IWM')
T0 = 9 * 3600 + 45 * 60
HZ = {'B6': (15, 30), 'B7': ('close',), 'B8': (30, 60), 'F4': (15, 30), 'F7': (15, 30), 'F8': (15, 30), 'F9': (15, 30)}
COND_ROWS = {('B4', 'all5'), ('B2', 'W30'), ('B3b', 'tol0.1'), ('F5', 'pdhl+swing'), ('B1', 'OR30')}


def discovery_days(root):
    return [d for d in cal.expiry_sessions(root) if split(d) == 'DISCOVERY']


def merge(evs):
    by = {}
    for e in evs:
        by.setdefault((e['row'], e['param'], e['t']), []).append(e)
    out = []
    for k, g in by.items():
        s = sum(x['dir'] for x in g)
        if s == 0:
            continue
        e = dict(next(x for x in g if x['dir'] == np.sign(s)))
        e['dir'] = int(np.sign(s))
        e['n_merged'] = len(g)
        out.append(e)
    return out


def events_day(root, day):
    sess = panel.session(root, day)
    cm = sess.close
    evs = [e for e in bf.day_events(sess) if T0 <= e['t'] <= cm * 60 - 1800]
    evs = merge(evs)
    zcache, xcache = {}, {}
    x0945 = dealer.exposures(sess, T0)['gex_total']
    rows = []
    for e in evs:
        t = e['t']
        if t not in zcache:
            iv = sess.iv_atm(t)
            zcache[t] = {'iv': iv, **{f'Z_{h}': zv(sess, t, h, iv)['Z'] for h in HORIZONS}}
        r = {'root': root, 'day': day, 't': t, 'row': e['row'], 'param': e['param'], 'dir': e['dir'],
             'n_merged': e.get('n_merged', 1), **zcache[t]}
        for k in ('r', 'z60', 'z5', 'move_z', 'rng_atr', 'gap_sz', 'src'):
            if k in e:
                r[k] = e[k]
        if (e['row'], e['param']) in COND_ROWS:
            if t not in xcache:
                xcache[t] = bf.x_conditions(sess, t)
            xc = xcache[t]
            r.update({'gex': xc['gex'], 'gex0945': x0945, 'vix': xc['vix'], 'vix_terc': xc['vix_terc'],
                      'call_wall': xc['call_wall'], 'put_wall': xc['put_wall']})
            if e['row'] == 'F5':
                wall = xc['call_wall'] if e['dir'] < 0 else xc['put_wall']
                iv = zcache[t]['iv']
                if not np.isfinite(xc['gex']) or not np.isfinite(iv):
                    r['at_wall'] = np.nan
                elif not np.isfinite(wall):
                    r['at_wall'] = 0.0
                else:
                    s30 = iv * math.sqrt(30 / YEAR_MIN)
                    r['at_wall'] = float(any(abs(math.log(lv / wall)) <= 0.25 * s30 for lv in e['levels']))
                r['levels'] = json.dumps([float(x) for x in e['levels']])
        rows.append(r)
    return rows


def run_events(root):
    os.makedirs(OUT_EV, exist_ok=True)
    days = discovery_days(root)
    rows, skipped = [], []
    t0 = time.time()
    for i, d in enumerate(days):
        if load_chain(root, d) is None or not len(load_bars(root, d)):
            skipped.append((d, 'no board or bars'))
            continue
        try:
            rows += events_day(root, d)
        except Exception as ex:                       # report, never hide
            skipped.append((d, f'error {type(ex).__name__}: {ex}'))
        if i % 50 == 0:
            print(root, i, len(days), d, f'{time.time() - t0:.0f}s', len(rows), flush=True)
    df = pd.DataFrame(rows)
    for c in df.columns:
        if df[c].dtype == float and c not in ('iv',):
            df[c] = df[c].astype('float64')
    df.to_parquet(os.path.join(OUT_EV, f'BF_events_{root}.parquet'), index=False)
    json.dump({'root': root, 'days': len(days), 'skipped': skipped},
              open(os.path.join(OUT_EV, f'BF_events_{root}.meta.json'), 'w'), indent=1)
    print(root, 'done', len(df), 'events', len(skipped), 'skipped', f'{time.time() - t0:.0f}s', flush=True)


# ------------------------------------------------------------------ statistics

YEARS = (('2020-21', lambda d: d < '2022-01-01'), ('2022', lambda d: '2022' <= d < '2023'), ('2023', lambda d: '2023' <= d < '2024'))


def bucket_means(root):
    p = pd.read_parquet(os.path.join(DATA, 'panel', f'{root}.parquet'),
                        columns=['day', 't', 'split', 'bucket'] + [f'Z_{h}' for h in HORIZONS])
    p = p[p.split == 'DISCOVERY']
    assert p.day.max() <= '2023-12-31'
    return {h: p.groupby('bucket')[f'Z_{h}'].mean().to_dict() for h in HORIZONS}


def hurdle_table():
    h = pd.read_parquet(os.path.join(DATA, 'hurdle.parquet'))
    return {(r.root, r.bucket, str(r.h)): r.hz for r in h.itertuples()}


def hurdle_for(H, root, buckets, h):
    allv = H.get((root, 'all', str(h)), np.nan)
    vals = []
    for b in buckets:
        v = H.get((root, b, str(h)), np.nan)
        vals.append(v if np.isfinite(v) else allv)
    vals = np.array(vals, float)
    return (float(np.nanmean(vals)) if np.isfinite(vals).any() else np.nan), allv


def year_cols(x, day, g=None):
    out = {}
    for yname, f in YEARS:
        m = np.array([f(d) for d in day]) & np.isfinite(x)
        if g is None:
            out[f'effect_{yname}'] = float(np.mean(x[m])) if m.any() else np.nan
        else:
            a, b = m & g, m & ~g
            out[f'effect_{yname}'] = float(np.mean(x[a]) - np.mean(x[b])) if a.any() and b.any() else np.nan
        out[f'n_{yname}'] = int(m.sum())
        out[f'nsess_{yname}'] = int(len(set(day[m])))
    return out


def label(row, root):
    if row in ('X1', 'X2', 'X5', 'X6'):
        return 'MODEL (GEX/walls, lib.dealer) x CALC'
    if row == 'X12':
        return 'OBS VIX x CALC'
    if row.startswith('B3') and root == 'SPXW':
        return 'CALC (SPY VWAP proxy, OBS SPY volume)'
    return 'CALC'


def stats():
    os.makedirs(OUT_RES, exist_ok=True)
    H = hurdle_table()
    out = []
    for root in ROOTS:
        f = os.path.join(OUT_EV, f'BF_events_{root}.parquet')
        if not os.path.exists(f):
            print('missing', f)
            continue
        ev = pd.read_parquet(f)
        assert ev.day.max() <= '2023-12-31' and (ev.day.map(split) == 'DISCOVERY').all()
        mu = bucket_means(root)
        ev['bucket'] = ev.t.map(bucket)
        for h in HORIZONS:
            ev[f'x_{h}'] = ev.dir * (ev[f'Z_{h}'] - ev.bucket.map(mu[h]))
        # ---- base rows
        for row, params in bf.PARAMS.items():
            for role, p in params:
                g = ev[(ev.row == row) & (ev.param == p)]
                for h in HZ.get(row, HORIZONS):
                    x = g[f'x_{h}'].values.astype(float)
                    ok = np.isfinite(x)
                    rec = {'row_id': row, 'root': root, 'outcome': 'Z', 'horizon': str(h), 'param_role': role, 'param': p,
                           'n_obs': int(ok.sum()), 'n_sessions': int(g.day[ok].nunique()), 'expected_sign': 1,
                           'label': label(row, root)}
                    if ok.sum() >= 2:
                        m, lo, hi, pv = boot_mean(x[ok], g.day.values[ok])
                        rec.update({'effect': m, 'ci_lo': lo, 'ci_hi': hi, 'p_value': pv,
                                    'mean_za_raw': float(np.mean((g.dir * g[f'Z_{h}']).values[ok]))})
                        rec.update(year_cols(x[ok], g.day.values[ok]))
                        rec['hurdle'], rec['hurdle_all'] = hurdle_for(H, root, g.bucket.values[ok], h)
                    # continuous ICs
                    if row == 'B7':
                        ic = spearman_ic(g.r.values, g[f'Z_{h}'].values, g.day.values)
                        rec.update(dict(zip(('ic', 'ic_lo', 'ic_hi', 'ic_p'), ic)))
                    if row == 'B8':
                        c = ev[(ev.row == 'B8c')]
                        ic = spearman_ic(-c.z60.values, c[f'Z_{h}'].values - c.bucket.map(mu[h]).values, c.day.values)
                        rec.update(dict(zip(('ic', 'ic_lo', 'ic_hi', 'ic_p'), ic)))
                    out.append(rec)
        # ---- conditional tests
        xdefs = [
            ('X1', 'B4', 'all5', 'gex', lambda s: s < 0, lambda s: s > 0, 'GEX(t) < 0 vs > 0'),
            ('X2', 'B2', 'W30', 'gex', lambda s: s > 0, lambda s: s < 0, 'GEX(t) > 0 vs < 0'),
            ('X5', 'F5', 'pdhl+swing', 'at_wall', lambda s: s == 1, lambda s: s == 0, 'swept level within 0.25 sigma_30 of the A4 wall vs elsewhere'),
            ('X6', 'B3b', 'tol0.1', 'gex', lambda s: s > 0, lambda s: s < 0, 'GEX(t) > 0 vs < 0'),
            ('X12', 'B1', 'OR30', 'vix_terc', lambda s: s == 2, lambda s: s == 0, 'VIX(t) top vs bottom trailing-252 tercile'),
        ]
        G_COND = {'X1': 'gex0945', 'X2': 'gex0945', 'X6': 'gex0945'}
        for xid, base, bp, col, fa, fb, desc in xdefs:
            g0 = ev[(ev.row == base) & (ev.param == bp)]
            variants = [('P', col)] + ([('G', G_COND[xid])] if xid in G_COND else [])
            for role, ccol in variants:
                s = g0[ccol].values.astype(float) if ccol in g0 else np.full(len(g0), np.nan)
                with np.errstate(invalid='ignore'):
                    a, b = fa(s), fb(s)
                g = g0[a | b]
                ga = a[a | b]
                for h in HORIZONS:
                    x = g[f'x_{h}'].values.astype(float)
                    ok = np.isfinite(x)
                    rec = {'row_id': xid, 'root': root, 'outcome': 'Z', 'horizon': str(h), 'param_role': role,
                           'param': f'{base}:{bp}|{ccol}', 'n_obs': int(ok.sum()), 'n_sessions': int(g.day[ok].nunique()),
                           'expected_sign': 1, 'label': label(xid, root), 'regimes': desc}
                    na, nb = int((ok & ga).sum()), int((ok & ~ga).sum())
                    rec.update({'n_a': na, 'n_b': nb})
                    if na >= 2 and nb >= 2:
                        m, lo, hi, pv = boot_diff(x[ok], g.day.values[ok], ga[ok])
                        rec.update({'effect': m, 'ci_lo': lo, 'ci_hi': hi, 'p_value': pv,
                                    'effect_a': float(np.mean(x[ok & ga])), 'effect_b': float(np.mean(x[ok & ~ga]))})
                        rec.update(year_cols(x[ok], g.day.values[ok], ga[ok]))
                        rec['hurdle'], rec['hurdle_all'] = hurdle_for(H, root, g.bucket.values[ok & ga], h)
                    out.append(rec)
    df = pd.DataFrame(out)
    df['hurdle_kind'] = '|E[za]| (HURDLE.md hz, event-weighted over buckets)'
    df['ci_excludes_0'] = (df.ci_lo > 0) | (df.ci_hi < 0)
    df['effect_beyond_hurdle'] = df.effect.abs() > df.hurdle.abs()
    df.to_parquet(os.path.join(OUT_RES, 'BF.parquet'), index=False)
    df.to_csv(os.path.join(OUT_RES, 'BF.csv'), index=False)
    print(len(df), 'rows ->', OUT_RES)
    return df


if __name__ == '__main__':
    if sys.argv[1] == 'events':
        for r in sys.argv[2:]:
            run_events(r)
    elif sys.argv[1] == 'stats':
        stats()
