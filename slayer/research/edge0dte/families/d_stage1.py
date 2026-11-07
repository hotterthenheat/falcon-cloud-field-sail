"""EDGE0DTE Stage 1, family D (volatility): registry rows D1-D6 on U1 (SPXW primary; SPY, QQQ, IWM replication),
DISCOVERY sessions only (<= 2023-12-31). No outcome of 2024 (CALIBRATION), 2025 (HOLDOUT) or 2026 is read: the panel
is read with a split == DISCOVERY filter, so CALIBRATION rows never enter memory.

  cd slayer/research/edge0dte && python3 -m families.d_stage1 [features|run|derive|report|all] [ROOT ...]

Steps
  features  bulk family-D features per root (families/d_vol.py) -> v2data/edge0dte/stage1/D_features_{ROOT}.parquet,
            then a cross-check: the registered @feature functions (leakage-tested) recomputed through lib.panel on 25
            random sessions per root must equal the bulk values exactly (else stop).
  run       all tests -> results/stage1/D.parquet (+ .csv)
  report    results/stage1/D.md
Tests (REGISTRY D; PROTOCOL section 4)
  conditional rows (D1-D4): effect = mean over the condition of d * (y - mu_t(y)), y = ln V (D1, D2, D4) or Z (D3),
      mu_t = the unconditional DISCOVERY mean of y at the same grid time t (all sessions of the root), d = +1/-1 the
      registry direction (sign-aligned Z for D3). CI and p: day-clustered bootstrap (2,000 resamples of days) in which
      mu_t is re-estimated inside every resample (the baseline's own uncertainty is included).
  level rows (D5, D6): effect = mean ln V in the bucket / at the time, tested against 0 (subtracting the same-time mean
      would be identically zero); day-clustered bootstrap (lib.stats.boot_mean).
  IC: Spearman of the continuous feature vs y - mu_t, day-clustered bootstrap CI (lib.stats.spearman_ic) - one IC per
      (feature, root, h), threshold-free, repeated on every parameter row of that feature.
  per period (2020-21 pooled, 2022, 2023): the same statistic with mu_t re-estimated within the period.
  economic size: E[V] - 1 and E[Z^2] - 1 inside the condition (day-clustered CIs), next to the HURDLE.md hurdles
      (v2data/edge0dte/hurdle.parquet: E[V]-1 long, E[V]-1 short-below, supplementary E[Z^2]-1 long; |E[za]| for Z).
  null calibration (conditional rows, V2 house rule 11): day-permutation null (1,000 permutations of whole days'
      condition vectors, time-of-day aligned) -> permutation p; and the pipeline's false-positive rate: the bootstrap
      test run on 100 permuted versions of every SPXW primary conditional cell (500 resamples each).
No FDR is applied here and no pass/fail is declared (the aggregator does that across all families).
"""
import json
import os
import sys
import time

import numpy as np
import pandas as pd

from families import d_vol
from lib import panel as P
from lib.config import DATA, ROOTS, bucket
from lib.stats import _boot_idx, boot_mean, spearman_ic

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'results', 'stage1')
FEAT = os.path.join(DATA, 'stage1')
HS = ('15', '30', '60', 'close')
PERIODS = (('2020-21', ('2020', '2021')), ('2022', ('2022',)), ('2023', ('2023',)))
NB = 2000
N_PERM = 1000
N_NULL = 100
NB_NULL = 500


# ------------------------------------------------------------------ data

SPLITS_ALLOWED = ('DISCOVERY', 'CALIBRATION')      # HOLDOUT / LOCKED panels are never read by this module


def load_panel(root, split='DISCOVERY'):
    """split: the panel split filter (default DISCOVERY; 'CALIBRATION' only for the aggregator's one frozen look,
    families/agg_calibration.py). Definitions are unchanged; only the session filter moves."""
    if split not in SPLITS_ALLOWED:
        raise ValueError(f'split {split!r} refused (allowed: {SPLITS_ALLOWED})')
    cols = ['root', 'day', 't', 'split', 'bucket', 'iv_atm'] + [f'{o}_{h}' for o in ('Z', 'V') for h in HS]
    f = os.path.join(DATA, 'panel', f'{root}.parquet')
    p = pd.read_parquet(f, columns=cols, filters=[('split', '==', split)])
    assert (p.split == split).all() and p.day.max() <= '2024-12-31', f'non-{split} rows loaded'
    if split == 'DISCOVERY':
        assert p.day.max() <= '2023-12-31', 'non-DISCOVERY rows loaded'
    return p.reset_index(drop=True)


def feature_path(root, split='DISCOVERY'):
    return os.path.join(FEAT, f'D_features_{root}.parquet' if split == 'DISCOVERY' else f'D_features_{root}_{split}.parquet')


def features(root, split='DISCOVERY'):
    os.makedirs(FEAT, exist_ok=True)
    out = feature_path(root, split)
    p = load_panel(root, split)[['root', 'day', 't', 'iv_atm']]
    t0 = time.time()
    f = d_vol.bulk_features(root, p)
    df = pd.concat([p[['root', 'day', 't']], f], axis=1)
    print(root, 'bulk features', len(df), f'{time.time() - t0:.0f}s', flush=True)
    # cross-check against the registered (leakage-tested) feature functions
    rng = np.random.default_rng(99)
    days = sorted(rng.choice(sorted(p.day.unique()), 25, replace=False))
    sub = p[p.day.isin(days)]
    chk = P.add_features(sub[['root', 'day', 't']].copy(), list(d_vol.D_FEATURES))
    rep = {'root': root, 'rows': int(len(chk)), 'days': len(days)}
    for c in d_vol.D_FEATURES:
        a, b = chk[c].values.astype(float), df.loc[sub.index, c].values.astype(float)
        same = (np.isnan(a) & np.isnan(b)) | (a == b)
        rep[c] = {'equal': int(same.sum()), 'finite': int(np.isfinite(a).sum()),
                  'max_abs_diff': float(np.nanmax(np.abs(a - b))) if np.isfinite(a - b).any() else 0.0}
        if not same.all():
            raise SystemExit(f'bulk/registered mismatch {root} {c}: {rep[c]}')
    df.to_parquet(out)
    json.dump(rep, open(os.path.join(FEAT, f'D_crosscheck_{root}.json' if split == 'DISCOVERY'
                                     else f'D_crosscheck_{root}_{split}.json'), 'w'), indent=1)
    print(root, 'cross-check', rep, flush=True)


# ------------------------------------------------------------------ statistics

class Grid:
    """Rows of one outcome with finite y, indexed by (day, time) for the day-clustered statistics."""

    def __init__(self, day, t, y):
        ok = np.isfinite(y)
        self.ok = ok
        self.day, self.t, self.y = day[ok], t[ok], y[ok]
        self.ud, self.di = np.unique(self.day, return_inverse=True)
        self.ut, self.ti = np.unique(self.t, return_inverse=True)
        nd, nt = len(self.ud), len(self.ut)
        self.S = np.zeros((nd, nt))
        self.C = np.zeros((nd, nt))
        np.add.at(self.S, (self.di, self.ti), self.y)
        np.add.at(self.C, (self.di, self.ti), 1.0)
        self.mu = self.S.sum(0) / self.C.sum(0)
        self.resid = self.y - self.mu[self.ti]

    def mats(self, d):
        nd, nt = self.S.shape
        CS, CD, CN = (np.zeros((nd, nt)) for _ in range(3))
        np.add.at(CS, (self.di, self.ti), d * self.y)
        np.add.at(CD, (self.di, self.ti), d)
        np.add.at(CN, (self.di, self.ti), np.abs(d))
        return CS, CD, CN

    def effect(self, d):
        n = np.abs(d).sum()
        return float(np.sum(d * self.resid) / n) if n else np.nan

    def boot(self, d, n_boot=NB, seed=1):
        """(effect, lo, hi, p) with mu_t re-estimated in every day resample."""
        if not np.abs(d).sum():
            return (np.nan,) * 4
        CS, CD, CN = self.mats(d)
        nd = len(self.ud)
        idx = _boot_idx(nd, n_boot, seed)
        W = np.zeros((n_boot, nd))
        np.add.at(W, (np.repeat(np.arange(n_boot), nd), idx.ravel()), 1.0)
        WS, WC, WCS, WCD, WCN = W @ self.S, W @ self.C, W @ CS, W @ CD, W @ CN
        with np.errstate(invalid='ignore', divide='ignore'):
            mu = WS / WC
            adj = np.where(WCD != 0, WCD * mu, 0.0)
            bs = (WCS.sum(1) - adj.sum(1)) / WCN.sum(1)
        bs = bs[np.isfinite(bs)]
        e = self.effect(d)
        p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
        return e, float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), float(max(p, 1.0 / n_boot))

    def perm(self, d, n_perm=N_PERM, seed=5, with_boot=0):
        """Day-permutation null: whole days' condition vectors moved to other days at the same grid times."""
        nd, nt = self.S.shape
        D = np.zeros((nd, nt))
        D[self.di, self.ti] = d
        R = np.full((nd, nt), np.nan)
        R[self.di, self.ti] = self.resid
        fin = np.isfinite(R)
        R0 = np.nan_to_num(R)
        rng = np.random.default_rng(seed)
        e0 = self.effect(d)
        null, null_p = [], []
        for k in range(n_perm):
            Dp = D[rng.permutation(nd)] * fin
            n = np.abs(Dp).sum()
            null.append(np.sum(Dp * R0) / n if n else np.nan)
            if k < with_boot:
                null_p.append(self.boot(Dp[self.di, self.ti], n_boot=NB_NULL, seed=100 + k)[3])
        null = np.array(null)
        null = null[np.isfinite(null)]
        pp = (1 + np.sum(np.abs(null) >= abs(e0))) / (1 + len(null)) if np.isfinite(e0) else np.nan
        return float(pp), null_p


def period_of(day):
    y = day[:4]
    for name, ys in PERIODS:
        if y in ys:
            return name
    return None


def hurdle_table():
    h = pd.read_parquet(os.path.join(DATA, 'hurdle.parquet'))
    return {(r.root, r.h, r.bucket): r for r in h.itertuples()}


def hget(H, root, h, b, k):
    r = H.get((root, h, b))
    v = getattr(r, k, np.nan) if r is not None else np.nan
    return float(v) if v is not None and np.isfinite(v) else np.nan


def hmix(H, root, h, buckets, k):
    """Hurdle weighted by the cell's own time-of-day composition (NaN if any bucket hurdle is missing)."""
    if not len(buckets):
        return np.nan
    vc = pd.Series(buckets).value_counts(normalize=True)
    vals = [hget(H, root, h, b, k) for b in vc.index]
    return float(np.dot(vc.values, vals)) if np.all(np.isfinite(vals)) else np.nan


# ------------------------------------------------------------------ run

def cutoffs(f, q):
    v = f[np.isfinite(f)]
    return float(np.quantile(v, q)), float(np.quantile(v, 1 - q))


def run_root(root, H, CUT):
    p = load_panel(root)
    f = pd.read_parquet(os.path.join(FEAT, f'D_features_{root}.parquet'))
    assert (f.day.values == p.day.values).all() and (f.t.values == p.t.values).all()
    for c in d_vol.D_FEATURES:
        p[c] = f[c].values
    day, t = p.day.values, p.t.values.astype(int)
    per = np.array([period_of(d) for d in day])
    rows = []
    ic_cache = {}

    lnV, Vraw, Z, Z2 = {}, {}, {}, {}
    for h in HS:
        v = p[f'V_{h}'].values
        lnV[h] = np.where(v > 0, np.log(np.where(v > 0, v, 1.0)), np.nan)
        lnV[h][~np.isfinite(v)] = np.nan
        Vraw[h] = v
        Z[h] = p[f'Z_{h}'].values
        Z2[h] = Z[h] ** 2

    grids = {('V', h): Grid(day, t, lnV[h]) for h in HS}
    grids.update({('Z', h): Grid(day, t, Z[h]) for h in HS})

    # tercile / quintile cutoffs (DISCOVERY pooled, frozen for CALIBRATION)
    CUT[root] = {}
    for fcol in ('d_semivar60', 'd_iv_rv60'):
        CUT[root][fcol] = {'tercile': cutoffs(p[fcol].values, 1 / 3), 'quintile': cutoffs(p[fcol].values, 0.2)}

    def econ(mask, h):
        """E[V]-1 and E[Z^2]-1 inside the condition (day-clustered CIs), and the same-time unconditional E[V]-1."""
        out = {}
        if not mask.any():
            return out
        m, lo, hi, _ = boot_mean(Vraw[h][mask] - 1, day[mask], n_boot=NB)
        out.update(ev_m1=m, ev_m1_lo=lo, ev_m1_hi=hi)
        m, lo, hi, _ = boot_mean(Z2[h][mask] - 1, day[mask], n_boot=NB)
        out.update(ez2_m1=m, ez2_m1_lo=lo, ez2_m1_hi=hi)
        # time-matched unconditional E[V]-1 (mean V at each of the condition's times, weighted like the condition)
        vt = pd.Series(Vraw[h]).groupby(t).mean()
        okv = mask & np.isfinite(Vraw[h])
        out['ev_m1_uncond'] = float(vt.reindex(t[okv]).mean() - 1) if okv.any() else np.nan
        out['frac_V_below_1'] = float(np.mean(Vraw[h][okv] < 1)) if okv.any() else np.nan
        out['median_V'] = float(np.median(Vraw[h][okv])) if okv.any() else np.nan
        return out

    def ic_of(fcol, outcome, h):
        k = (fcol, outcome, h)
        if k not in ic_cache:
            g = grids[(outcome, h)]
            x = p[fcol].values[g.ok]
            if fcol == 'd_rv30_rel':
                x = np.log(x)
            ic_cache[k] = spearman_ic(x, g.resid, g.day, n_boot=NB)
        return ic_cache[k]

    def cond_row(row_id, arm, outcome, h, kind, param, d_full, exp_sign, fcol, exp_ic, side, primary, perm=True):
        g = grids[(outcome, h)]
        d = d_full[g.ok].astype(float)
        mask_full = d_full != 0
        r = dict(row_id=row_id, arm=arm, root=root, outcome=outcome, horizon=h, param_kind=kind, param=str(param),
                 in_fdr_family=bool(primary and kind == 'P' and root == 'SPXW'), primary_arm=bool(primary),
                 expected_sign=exp_sign, econ_side=side, effect_kind='cond_minus_same_time_mean',
                 n_obs=int(np.abs(d).sum()), n_sessions=int(len(np.unique(g.day[d != 0]))))
        e, lo, hi, pv = g.boot(d)
        r.update(effect=e, ci_lo=lo, ci_hi=hi, p_value=pv, p_method='day-cluster bootstrap 2000 (mu_t re-estimated)')
        if np.abs(d).sum():
            cm = np.sum(d * g.y) / np.abs(d).sum()
            r['cond_mean'] = float(cm)                 # sign-aligned raw mean Z (D3) or mean ln V (aligned by d)
            r['uncond_mean_matched'] = float(cm - e)
        ic = ic_of(fcol, outcome, h)
        r.update(ic=ic[0], ic_lo=ic[1], ic_hi=ic[2], ic_p=ic[3], expected_ic_sign=exp_ic, ic_feature=fcol)
        for name, _ys in PERIODS:
            sel = per == name
            gp = Grid(day[sel], t[sel], (lnV[h] if outcome == 'V' else Z[h])[sel])
            dp = d_full[sel][gp.ok].astype(float)
            ep = gp.boot(dp) if np.abs(dp).sum() else (np.nan,) * 4
            r[f'eff_{name}'], r[f'lo_{name}'], r[f'hi_{name}'] = ep[0], ep[1], ep[2]
            r[f'n_{name}'] = int(np.abs(dp).sum())
            r[f'sess_{name}'] = int(len(np.unique(gp.day[dp != 0])))
        if perm and np.abs(d).sum():
            pp, nullp = g.perm(d, with_boot=N_NULL if (primary and kind == 'P' and root == 'SPXW') else 0)
            r['perm_p'] = pp
            r['null_boot_p'] = json.dumps([round(x, 4) for x in nullp]) if nullp else ''
        r.update(econ(mask_full & np.isfinite(Vraw[h]), h))
        hb = 'all'
        r['hurdle_bucket'] = hb
        r['hurdle_times'] = hget(H, root, h, hb, 'times')
        r['hurdle_z'] = hget(H, root, h, hb, 'hz')
        r['hurdle_z_lo'], r['hurdle_z_hi'] = hget(H, root, h, hb, 'hz_lo'), hget(H, root, h, hb, 'hz_hi')
        for k in ('hv_long', 'hv_long_lo', 'hv_long_hi', 'hv_short', 'hv_short_lo', 'hv_short_hi', 'hz2_long'):
            r[k] = hget(H, root, h, hb, k)
        bks = p.bucket.values[mask_full & np.isfinite((Z if outcome == 'Z' else Vraw)[h])]
        r['hurdle_z_mix'] = hmix(H, root, h, bks, 'hz')
        r['hv_long_mix'] = hmix(H, root, h, bks, 'hv_long')
        r['hv_short_mix'] = hmix(H, root, h, bks, 'hv_short')
        r['hz2_long_mix'] = hmix(H, root, h, bks, 'hz2_long')
        rows.append(r)

    def level_row(row_id, arm, h, kind, param, mask, primary, hb, exp_sign):
        y = lnV[h]
        ok = mask & np.isfinite(y)
        r = dict(row_id=row_id, arm=arm, root=root, outcome='V', horizon=h, param_kind=kind, param=str(param),
                 in_fdr_family=bool(primary and kind == 'P' and root == 'SPXW'), primary_arm=bool(primary),
                 expected_sign=exp_sign, econ_side='both' if exp_sign == 0 else 'short', effect_kind='mean_lnV_vs_0',
                 n_obs=int(ok.sum()), n_sessions=int(len(np.unique(day[ok]))))
        if ok.any():
            e, lo, hi, pv = boot_mean(y[ok], day[ok], n_boot=NB)
            r.update(effect=e, ci_lo=lo, ci_hi=hi, p_value=pv, p_method='day-cluster bootstrap 2000 (boot_mean)',
                     cond_mean=e, uncond_mean_matched=0.0)
        else:
            r.update(effect=np.nan, ci_lo=np.nan, ci_hi=np.nan, p_value=np.nan, p_method='-',
                     na_reason=f'no finite ln V for this time/horizon (horizon passes the close)')
        for name, _ys in PERIODS:
            s = ok & (per == name)
            ep = boot_mean(y[s], day[s], n_boot=NB) if s.any() else (np.nan,) * 4
            r[f'eff_{name}'], r[f'lo_{name}'], r[f'hi_{name}'] = ep[0], ep[1], ep[2]
            r[f'n_{name}'] = int(s.sum())
            r[f'sess_{name}'] = int(len(np.unique(day[s])))
        r.update(econ(ok, h))
        r['hurdle_bucket'] = hb
        r['hurdle_times'] = hget(H, root, h, hb, 'times') if hb != 'mix' else np.nan
        for k in ('hv_long', 'hv_long_lo', 'hv_long_hi', 'hv_short', 'hv_short_lo', 'hv_short_hi', 'hz2_long'):
            r[k] = hget(H, root, h, hb, k) if hb != 'mix' else np.nan
        bks = p.bucket.values[ok]
        r['hv_long_mix'] = hmix(H, root, h, bks, 'hv_long')
        r['hv_short_mix'] = hmix(H, root, h, bks, 'hv_short')
        r['hz2_long_mix'] = hmix(H, root, h, bks, 'hz2_long')
        if hb == 'mix':                                 # 60-min buckets: the two 30-min bucket hurdles, n-weighted
            r['hv_long'], r['hv_short'], r['hz2_long'] = r['hv_long_mix'], r['hv_short_mix'], r['hz2_long_mix']
        rows.append(r)

    rel = p.d_rv30_rel.values
    sv = p.d_semivar60.values
    ir = p.d_iv_rv60.values
    for h in HS:
        print(root, 'h', h, flush=True)
        # D1 RV expansion -> ln V > 0
        for kind, thr in (('P', 2.0), ('G', 1.5), ('G', 3.0)):
            d = np.where(np.isfinite(rel) & (rel > thr), 1.0, 0.0)
            cond_row('D1', 'expansion', 'V', h, kind, thr, d, +1, 'd_rv30_rel', +1, 'long', True)
        # D2 RV compression -> ln V < 0
        for kind, thr in (('P', 0.5), ('G', 0.4), ('G', 0.67)):
            d = np.where(np.isfinite(rel) & (rel < thr), 1.0, 0.0)
            cond_row('D2', 'compression', 'V', h, kind, thr, d, -1, 'd_rv30_rel', +1, 'short', True)
        # D3 signed semivariance: top -> Z < 0, bottom -> Z > 0 (sign-aligned)
        for kind, qn in (('P', 'tercile'), ('G', 'quintile')):
            lo_c, hi_c = CUT[root]['d_semivar60'][qn]
            top = np.isfinite(sv) & (sv >= hi_c)
            bot = np.isfinite(sv) & (sv <= lo_c)
            cond_row('D3', 'top-bottom', 'Z', h, kind, qn, np.where(top, -1.0, np.where(bot, 1.0, 0.0)), +1,
                     'd_semivar60', -1, 'dir', True)
            cond_row('D3', 'top', 'Z', h, kind, qn, np.where(top, -1.0, 0.0), +1, 'd_semivar60', -1, 'dir', False)
            cond_row('D3', 'bottom', 'Z', h, kind, qn, np.where(bot, 1.0, 0.0), +1, 'd_semivar60', -1, 'dir', False)
        # D4 implied over realized: low -> ln V > 0, high -> ln V < 0
        for kind, qn in (('P', 'tercile'), ('G', 'quintile')):
            lo_c, hi_c = CUT[root]['d_iv_rv60'][qn]
            low = np.isfinite(ir) & (ir <= lo_c)
            high = np.isfinite(ir) & (ir >= hi_c)
            cond_row('D4', 'low', 'V', h, kind, qn, np.where(low, 1.0, 0.0), +1, 'd_iv_rv60', -1, 'long', True)
            cond_row('D4', 'high', 'V', h, kind, qn, np.where(high, 1.0, 0.0), -1, 'd_iv_rv60', -1, 'short', True)
        # D5 seasonality: each bucket its own two-sided test of ln V != 0
        b30 = p.bucket.values
        for b in sorted(set(b30)):
            level_row('D5', b, h, 'P', '30-min', b30 == b, True, b, 0)
        m = t // 60
        b60 = np.array([f'{x // 60:02d}:{x % 60:02d}' for x in 570 + (m - 570) // 60 * 60])
        for b in sorted(set(b60)):
            level_row('D5', b, h, 'G', '60-min', b60 == b, True, 'mix', 0)
    # D6 unconditional variance premium at h = close
    for kind, tt in (('P', 35100), ('G', 36000), ('G', 37800), ('G', 43200)):
        lab = f'{tt // 3600:02d}:{tt % 3600 // 60:02d}'
        level_row('D6', lab, 'close', kind, lab, t == tt, True, bucket(tt), -1)
    return rows


def run(roots):
    os.makedirs(RES, exist_ok=True)
    H = hurdle_table()
    CUT = {}
    allrows = []
    for root in roots:
        t0 = time.time()
        allrows += run_root(root, H, CUT)
        print(root, 'done', f'{time.time() - t0:.0f}s', flush=True)
    df = pd.DataFrame(allrows)
    df = derive(df, H)
    df.to_parquet(os.path.join(RES, 'D.parquet'))
    df.to_csv(os.path.join(RES, 'D.csv'), index=False)
    json.dump(CUT, open(os.path.join(RES, 'D_cutoffs.json'), 'w'), indent=1)
    print('rows', len(df))


def derive(df, H=None):
    """Descriptive flags only (no FDR, no pass/fail). Hurdles used for the flags: the row's own hurdle cell when it rests
    on >= 100 decision times; otherwise (SPY/QQQ/IWM buckets sampled with 30 times, where single hurdles swing to
    impossible values such as a short-below of +10) the root's pooled 'all' hurdle at the same h (hurdle_source)."""
    df = df.copy()
    H = hurdle_table() if H is None else H
    src, used = [], {k: [] for k in ('hz', 'hv_long', 'hv_short', 'hz2_long')}
    for r in df.itertuples():
        if r.row_id == 'D5' and r.param_kind == 'G':
            b0 = int(r.arm[:2]) * 60 + int(r.arm[3:])
            parts = [f'{x // 60:02d}:{x % 60:02d}' for x in (b0, b0 + 30) if x <= 930]
            times = min(hget(H, r.root, r.horizon, b, 'times') for b in parts)
        else:
            times = r.hurdle_times
        ok = np.isfinite(times) and times >= 100
        src.append(r.hurdle_bucket if ok else 'all (fallback: cell < 100 times)')
        own = {'hz': getattr(r, 'hurdle_z', np.nan), 'hv_long': r.hv_long, 'hv_short': r.hv_short, 'hz2_long': r.hz2_long}
        for k in used:
            used[k].append(own[k] if ok else hget(H, r.root, r.horizon, 'all', k))
    df['hurdle_source'] = src
    for k, v in used.items():
        df[f'{k}_used'] = v
    df['ci_excludes_0'] = (df.ci_lo > 0) | (df.ci_hi < 0)
    df['sign_as_expected'] = np.where(df.expected_sign == 0, np.nan, np.sign(df.effect) == df.expected_sign)
    yrs = ['2020-21', '2022', '2023']
    same = sum(((np.sign(df[f'eff_{y}']) == np.sign(df.effect)) & (df[f'sess_{y}'] >= 30)).astype(int) for y in yrs)
    df['n_periods_same_sign_n30'] = same
    # economic size: Z rows effect vs |E[za]| hurdle; V rows E[V]-1 inside the condition vs the side's hurdle
    z = df.outcome == 'Z'
    lng = (df.outcome == 'V') & (df.econ_side == 'long')
    sht = (df.outcome == 'V') & (df.econ_side == 'short')
    both = (df.outcome == 'V') & (df.econ_side == 'both')
    hz, hl, hs = df.hz_used, df.hv_long_used, df.hv_short_used
    df['beyond_hurdle_point'] = np.select(
        [z, lng, sht, both],
        [df.effect >= hz, df.ev_m1 > hl, df.ev_m1 < hs, (df.ev_m1 > hl) | (df.ev_m1 < hs)], False)
    df['beyond_hurdle_ci'] = np.select(
        [z, lng, sht, both],
        [df.ci_lo >= hz, df.ev_m1_lo > hl, df.ev_m1_hi < hs, (df.ev_m1_lo > hl) | (df.ev_m1_hi < hs)], False)
    df['z2_beyond_long_suppl'] = df.ez2_m1 > df.hz2_long_used
    return df


# ------------------------------------------------------------------ report

def report():
    from families.d_report import write
    write(pd.read_parquet(os.path.join(RES, 'D.parquet')), RES)


def main():
    args = sys.argv[1:]
    step = args[0] if args else 'all'
    roots = [a for a in args[1:] if a in ROOTS] or list(ROOTS)
    if step in ('features', 'all'):
        for r in roots:
            features(r)
    if step in ('run', 'all'):
        run(roots)
    if step == 'derive':                                  # re-apply the descriptive flags to an existing D.parquet
        df = derive(pd.read_parquet(os.path.join(RES, 'D.parquet')))
        df.to_parquet(os.path.join(RES, 'D.parquet'))
        df.to_csv(os.path.join(RES, 'D.csv'), index=False)
    if step in ('report', 'all', 'derive'):
        report()


if __name__ == '__main__':
    main()
