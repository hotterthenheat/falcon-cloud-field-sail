"""EDGE0DTE Stage-1 aggregator, step 2: the ONE CALIBRATION (2024) look, frozen by frozen/STAGE1_CALIBRATION_SPEC.md.

Cells looked at (and nothing else):
  (a) the Step-1 DISCOVERY survivors (results/STAGE1_DISCOVERY.md), all family D, SPXW:
        D2 compression (d_rv30_rel < 0.5)       ln V, h = 60       registered ln V < 0
        D2 compression (d_rv30_rel < 0.5)       ln V, h = close    registered ln V < 0
        D4 high (d_iv_rv60 >= DISCOVERY top-tercile cut 2.056208976593107, D_cutoffs.json)   ln V, h = 60
        D5 bucket 14:30 (decisions 14:30-14:55)  ln V, h = 60       registered two-sided; DISCOVERY sign < 0
  (b) REGISTRY_ADDENDUM_3: B8R (h = 30, 60) and X12R (h = 60, close).

The tests reuse the family code unchanged; only the session filter moves to CALIBRATION through a parameter
(d_stage1.load_panel / d_stage1.features `split`, bf_stage1.discovery_days / run_events / bucket_means `which`,
bf_stage1.events_day `keep` = only the B1 OR30 and B8 z2 events get outcomes). Same-time / same-bucket means mu are
re-estimated inside the sample that is tested (as the D family's per-period effects do). Hurdles, tercile cuts and
VIX-tercile rules are the frozen DISCOVERY ones.

  python3 -m families.agg_calibration validate          # DISCOVERY only: the same code must reproduce D.parquet/BF.parquet
  python3 -m families.agg_calibration dfeat ROOT...      # CALIBRATION D features (guarded)
  python3 -m families.agg_calibration events ROOT...     # CALIBRATION B1/B8 events with outcomes (guarded)
  python3 -m families.agg_calibration run                # the look -> results/stage1/STAGE1_CALIBRATION.parquet + md

Every CALIBRATION step refuses to run unless sha256(frozen/STAGE1_CALIBRATION_SPEC.md) is in v2data/locked_looks.jsonl.
2025 / 2026 are never read (the family loaders refuse any split but DISCOVERY / CALIBRATION).
"""
import hashlib
import json
import os
import sys

import numpy as np
import pandas as pd

from families import bf_stage1 as BFS
from families import d_stage1 as DS
from families import d_vol
from lib.config import LOCKED_LOOKS, bucket
from lib.stats import boot_diff, boot_mean

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = os.path.join(HERE, 'frozen', 'STAGE1_CALIBRATION_SPEC.md')
RES = os.path.join(HERE, 'results')
S1 = os.path.join(RES, 'stage1')
ROOTS = ('SPXW', 'SPY', 'QQQ', 'IWM')
REP = ('SPY', 'QQQ', 'IWM')
KEEP = {('B8', 'z2'), ('B1', 'OR30')}
NB = 2000

# (id, row, arm, h, kind, threshold/bucket, registered direction)
SURVIVORS = [
    ('D2|compression|60', 'D2', 'compression', '60', 'cond', 0.5, -1),
    ('D2|compression|close', 'D2', 'compression', 'close', 'cond', 0.5, -1),
    ('D4|high|60', 'D4', 'high', '60', 'cond', 'tercile', -1),
    ('D5|14:30|60', 'D5', '14:30', '60', 'level', '14:30', -1),
]
A3 = [('B8R|30', 'B8R', '30'), ('B8R|60', 'B8R', '60'), ('X12R|60', 'X12R', '60'), ('X12R|close', 'X12R', 'close')]


# ------------------------------------------------------------------ guard

def spec_sha():
    return hashlib.sha256(open(SPEC, 'rb').read()).hexdigest()


def require_registered():
    sha = spec_sha()
    ok = False
    if os.path.exists(LOCKED_LOOKS):
        for line in open(LOCKED_LOOKS):
            try:
                ok |= json.loads(line).get('sha256') == sha
            except ValueError:
                pass
    if not ok:
        raise SystemExit(f'CALIBRATION refused: spec sha256 {sha} is not in {LOCKED_LOOKS}')
    return sha


# ------------------------------------------------------------------ family D cells

def d_panel(root, which):
    p = DS.load_panel(root, which)
    f = pd.read_parquet(DS.feature_path(root, which))
    assert (f.day.values == p.day.values).all() and (f.t.values == p.t.values).all()
    for c in d_vol.D_FEATURES:
        p[c] = f[c].values
    return p


def d_cells(root, which, H, cuts):
    p = d_panel(root, which)
    day, t = p.day.values, p.t.values.astype(int)
    out = []
    for cid, row, arm, h, kind, par, e in SURVIVORS:
        v = p[f'V_{h}'].values
        lnv = np.where(v > 0, np.log(np.where(v > 0, v, 1.0)), np.nan)
        lnv[~np.isfinite(v)] = np.nan
        r = dict(cell=cid, family='D', row_id=row, arm=arm, root=root, outcome='V', horizon=h, split=which,
                 expected_sign=e)
        if kind == 'cond':
            if row == 'D2':
                cond = np.isfinite(p.d_rv30_rel.values) & (p.d_rv30_rel.values < par)
            else:
                hi_c = cuts[root]['d_iv_rv60']['tercile'][1]
                cond = np.isfinite(p.d_iv_rv60.values) & (p.d_iv_rv60.values >= hi_c)
                r['cut'] = hi_c
            g = DS.Grid(day, t, lnv)
            d = np.where(cond, 1.0, 0.0)[g.ok]
            eff, lo, hi, pv = g.boot(d)
            r.update(n_obs=int(d.sum()), n_sess=int(len(np.unique(g.day[d != 0]))))
            mask = cond & np.isfinite(v)
            bks = p.bucket.values[mask]
            r['hurdle_short'] = DS.hmix(H, root, h, bks, 'hv_short')
            r['hurdle_src'] = 'hv_short weighted by the cell time-of-day mix (DISCOVERY HURDLE.md cells)'
        else:
            mask = (p.bucket.values == par) & np.isfinite(lnv)
            eff, lo, hi, pv = boot_mean(lnv[mask], day[mask], n_boot=NB)
            r.update(n_obs=int(mask.sum()), n_sess=int(len(np.unique(day[mask]))))
            tm = DS.hget(H, root, h, par, 'times')
            hb = par if np.isfinite(tm) and tm >= 100 else 'all'
            r['hurdle_short'] = DS.hget(H, root, h, hb, 'hv_short')
            r['hurdle_src'] = f'hv_short bucket {hb} ({tm:.0f} times)'
        r.update(effect=eff, ci_lo=lo, ci_hi=hi, p_value=pv)
        if mask.any():
            m, a, b, _ = boot_mean(v[mask] - 1, day[mask], n_boot=NB)
            r.update(econ=m, econ_lo=a, econ_hi=b)
        out.append(r)
    return out


# ------------------------------------------------------------------ family BF cells (Addendum 3)

def bf_cells(root, which, H, ev=None):
    if ev is None:
        ev = pd.read_parquet(BFS.ev_path(root, which))
    lim = '2023-12-31' if which == 'DISCOVERY' else '2024-12-31'
    assert ev.day.max() <= lim and ev.day.min() >= ('2020-01-01' if which == 'DISCOVERY' else '2024-01-01')
    mu = BFS.bucket_means(root, which)
    ev = ev.copy()
    ev['bucket'] = ev.t.map(bucket)
    out = []
    for cid, row, h in A3:
        hk = int(h) if h.isdigit() else h                           # bucket_means keys are lib.config.HORIZONS
        x_all = ev.dir * (ev[f'Z_{h}'] - ev.bucket.map(mu[hk]))
        r = dict(cell=cid, family='BF', row_id=row, arm='', root=root, outcome='Z', horizon=h, split=which,
                 expected_sign=1)
        if row == 'B8R':
            s = ((ev.row == 'B8') & (ev.param == 'z2')).values
            x = -x_all.values[s].astype(float)                      # in the direction of the shock
            raw = -(ev.dir * ev[f'Z_{h}']).values[s].astype(float)
            dd, bk = ev.day.values[s], ev.bucket.values[s]
            ok = np.isfinite(x)
            eff, lo, hi, pv = boot_mean(x[ok], dd[ok], n_boot=NB)
            r.update(n_obs=int(ok.sum()), n_sess=int(len(set(dd[ok]))), econ=float(np.mean(raw[ok])))
            r['hurdle_z'], r['hurdle_z_all'] = BFS.hurdle_for(H, root, bk[ok], hk)
        else:
            s = ((ev.row == 'B1') & (ev.param == 'OR30')).values
            terc = ev.vix_terc.values[s].astype(float)
            x = x_all.values[s].astype(float)
            raw = (ev.dir * ev[f'Z_{h}']).values[s].astype(float)
            dd, bk = ev.day.values[s], ev.bucket.values[s]
            with np.errstate(invalid='ignore'):
                a, b = terc == 0, terc == 2                          # low VIX tercile (predicted stronger) vs high
            sel = (a | b) & np.isfinite(x)
            ga = a[sel]
            r.update(n_obs=int(sel.sum()), n_sess=int(len(set(dd[sel]))), n_low=int(ga.sum()), n_high=int((~ga).sum()))
            if ga.sum() >= 2 and (~ga).sum() >= 2:
                eff, lo, hi, pv = boot_diff(x[sel], dd[sel], ga, n_boot=NB)
                r.update(eff_low=float(np.mean(x[sel][ga])), eff_high=float(np.mean(x[sel][~ga])),
                         econ=float(np.mean(raw[sel][ga])))
            else:
                eff = lo = hi = pv = np.nan
            r['hurdle_z'], r['hurdle_z_all'] = BFS.hurdle_for(H, root, bk[sel][ga], hk)
        r.update(effect=eff, ci_lo=lo, ci_hi=hi, p_value=pv)
        out.append(r)
    return out


# ------------------------------------------------------------------ validation on DISCOVERY (no 2024 data)

def validate():
    H = DS.hurdle_table()
    HB = BFS.hurdle_table()
    cuts = json.load(open(os.path.join(S1, 'D_cutoffs.json')))
    D = pd.read_parquet(os.path.join(S1, 'D.parquet'))
    B = pd.read_parquet(os.path.join(S1, 'BF.parquet'))
    bad = 0
    for root in ROOTS:
        for r in d_cells(root, 'DISCOVERY', H, cuts):
            q = D[(D.root == root) & (D.row_id == r['row_id']) & (D.arm == r['arm']) & (D.horizon == r['horizon'])
                  & (D.param_kind == 'P')].iloc[0]
            same = all(np.isclose(r[k], q[k2], rtol=0, atol=1e-12) for k, k2 in
                       (('effect', 'effect'), ('ci_lo', 'ci_lo'), ('ci_hi', 'ci_hi'), ('p_value', 'p_value'),
                        ('econ', 'ev_m1'))) and r['n_obs'] == q.n_obs
            hk = 'hv_short_mix' if r['row_id'] != 'D5' else 'hv_short_used'
            same &= bool(np.isclose(r['hurdle_short'], q[hk], atol=1e-12, equal_nan=True))
            bad += not same
            print('D', root, r['cell'], 'OK' if same else 'MISMATCH', round(r['effect'], 6), round(q.effect, 6),
                  round(r['hurdle_short'], 4), round(q[hk], 4))
        ev = pd.read_parquet(BFS.ev_path(root, 'DISCOVERY'))
        for r in bf_cells(root, 'DISCOVERY', HB, ev):
            reg = 'B8' if r['row_id'] == 'B8R' else 'X12'
            q = B[(B.root == root) & (B.row_id == reg) & (B.horizon == r['horizon']) & (B.param_role == 'P')].iloc[0]
            same = (np.isclose(r['effect'], -q.effect, atol=1e-12) and np.isclose(r['ci_lo'], -q.ci_hi, atol=1e-12)
                    and np.isclose(r['ci_hi'], -q.ci_lo, atol=1e-12) and np.isclose(r['p_value'], q.p_value, atol=1e-12)
                    and r['n_obs'] == q.n_obs)
            if reg == 'B8':
                same &= np.isclose(r['econ'], -q.mean_za_raw, atol=1e-12) and np.isclose(r['hurdle_z'], q.hurdle, atol=1e-12)
            bad += not same
            print('BF', root, r['cell'], 'OK' if same else 'MISMATCH', round(r['effect'], 6), round(-q.effect, 6),
                  r['ci_lo'], -q.ci_hi, r['p_value'], q.p_value)
    # events_day(keep=...) reproduces the DISCOVERY event rows of B1 OR30 / B8 z2 on sampled SPXW days
    ev = pd.read_parquet(BFS.ev_path('SPXW', 'DISCOVERY'))
    for day in ('2020-06-12', '2022-03-16', '2023-10-27'):
        new = pd.DataFrame(BFS.events_day('SPXW', day, KEEP))
        old = ev[(ev.day == day) & ev.apply(lambda r: (r.row, r.param) in KEEP, axis=1)]
        k = ['row', 'param', 't', 'dir']
        a = new.sort_values(k).reset_index(drop=True)
        b = old.sort_values(k).reset_index(drop=True)
        same = len(a) == len(b) and (a[k].values == b[k].values).all() and np.allclose(
            a[[f'Z_{h}' for h in ('15', '30', '60', 'close')]].values.astype(float),
            b[[f'Z_{h}' for h in ('15', '30', '60', 'close')]].values.astype(float), equal_nan=True)
        if len(a):
            same &= np.allclose(a.vix_terc.values.astype(float), b.vix_terc.values.astype(float), equal_nan=True)
        bad += not same
        print('events_day keep', day, len(a), len(b), 'OK' if same else 'MISMATCH')
    print('VALIDATION', 'PASS' if bad == 0 else f'FAIL ({bad})')
    return bad


# ------------------------------------------------------------------ the look

def holm(p):
    p = np.asarray(p, float)
    o = np.argsort(p)
    m = len(p)
    adj = np.empty(m)
    run = 0.0
    for i, j in enumerate(o):
        run = max(run, min(1.0, (m - i) * p[j]))
        adj[j] = run
    return adj


def look():
    sha = require_registered()
    H = DS.hurdle_table()
    HB = BFS.hurdle_table()
    cuts = json.load(open(os.path.join(S1, 'D_cutoffs.json')))
    disc = pd.read_parquet(os.path.join(S1, 'STAGE1_DISCOVERY.parquet'))
    rows = []
    for root in ROOTS:                                  # one root at a time (memory)
        rows += d_cells(root, 'CALIBRATION', H, cuts)
        rows += bf_cells(root, 'CALIBRATION', HB)
    df = pd.DataFrame(rows)
    df['spec_sha256'] = sha
    # ---- survivors: PROTOCOL section 4
    verdict = []
    for cid, row, arm, h, kind, par, e in SURVIVORS:
        q = disc[(disc.row_id == row) & (disc.arm == arm) & (disc.horizon == h)].iloc[0]
        r = df[(df.cell == cid) & (df.root == 'SPXW')].iloc[0]
        d0 = float(q.effect)
        wrong_half = -0.5 * d0                              # the wrong-sign value of half the discovery effect
        flip = np.sign(r.effect) != np.sign(d0)
        incl = (r.ci_lo <= wrong_half <= r.ci_hi)
        reps = {rt: float(df[(df.cell == cid) & (df.root == rt)].effect.iloc[0]) for rt in REP}
        verdict.append(dict(cell=cid, rule='PROTOCOL s4', disc_effect=d0, disc_ci_lo=q.ci_lo, disc_ci_hi=q.ci_hi,
                            wrong_half=wrong_half, sign_flip=bool(flip), ci_includes_wrong_half=bool(incl),
                            ci_excludes_0=bool(r.ci_hi < 0 or r.ci_lo > 0),
                            ci_beyond_half=bool(r.ci_hi < 0.5 * d0) if d0 < 0 else bool(r.ci_lo > 0.5 * d0),
                            hurdle_info=bool(r.econ < r.hurdle_short),
                            rep_same=int(sum(np.sign(v) == np.sign(d0) for v in reps.values() if np.isfinite(v))),
                            **{f'rep_{k}': v for k, v in reps.items()},
                            passed=bool(not flip and not incl)))
    # ---- Addendum 3: Holm over the 4 SPXW tests at 0.05
    sp = df[(df.root == 'SPXW') & df.cell.isin([c for c, _, _ in A3])].set_index('cell').loc[[c for c, _, _ in A3]]
    adj = holm(sp.p_value.values)
    for (cid, row, h), pa in zip(A3, adj):
        r = sp.loc[cid]
        reps = {rt: float(df[(df.cell == cid) & (df.root == rt)].effect.iloc[0]) for rt in REP}
        nrep = int(sum(np.isfinite(v) and v > 0 for v in reps.values()))
        sig = bool(pa <= 0.05 and r.effect > 0 and r.ci_lo > 0)
        hz = bool(np.isfinite(r.effect) and r.effect >= r.hurdle_z)
        verdict.append(dict(cell=cid, rule='ADDENDUM 3', p_holm=float(pa), holm_sig_stated_sign=sig, hurdle_pass=hz,
                            hurdle_raw_info=bool(np.isfinite(r.econ) and r.econ >= r.hurdle_z), rep_same=nrep,
                            **{f'rep_{k}': v for k, v in reps.items()}, passed=bool(sig and hz and nrep >= 2)))
    V = pd.DataFrame(verdict)
    df.to_parquet(os.path.join(S1, 'STAGE1_CALIBRATION.parquet'), index=False)
    df.to_csv(os.path.join(S1, 'STAGE1_CALIBRATION.csv'), index=False)
    V.to_parquet(os.path.join(S1, 'STAGE1_CALIBRATION_verdict.parquet'), index=False)
    V.to_csv(os.path.join(S1, 'STAGE1_CALIBRATION_verdict.csv'), index=False)
    pd.set_option('display.width', 250)
    print(df.drop(columns=['spec_sha256']).round(4).to_string())
    print(V.round(4).to_string())


def main():
    cmd = sys.argv[1]
    if cmd == 'validate':
        sys.exit(validate())
    if cmd == 'dfeat':
        require_registered()
        for r in sys.argv[2:]:
            DS.features(r, 'CALIBRATION')
    elif cmd == 'events':
        require_registered()
        for r in sys.argv[2:]:
            BFS.run_events(r, 'CALIBRATION', KEEP)
    elif cmd == 'run':
        look()


if __name__ == '__main__':
    main()
