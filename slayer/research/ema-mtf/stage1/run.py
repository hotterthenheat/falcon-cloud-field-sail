"""Stage 1 (PREREG section 4): S1A / S1B / S1C with Holm, the sign rules, the controls and the null calibration.

    python3 -m stage1.run analyse          -> v2data/ema/results/stage1/s1_results.pkl  (needs events_{A,B}_*.parquet)
    python3 -m stage1.run perm             -> 200 permutation-null runs of the S1A pipeline (s1_perm.parquet)
    python3 -m stage1.run synth --seeds 0-19   -> synthetic zero-drift null runs (resumable, one file per seed)
    python3 -m stage1.report               -> reports/STAGE1.md

Interpretation choices are fixed in specs/PREREG.md section 9b (amendment A2), committed before this ran on real data.
"""
from __future__ import annotations

import argparse
import glob
import os
import pickle
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA  # noqa: E402
from edata.store import Panel  # noqa: E402
from stage1 import stats as ST  # noqa: E402
from stage1.events import BUCKETS, TFS, build  # noqa: E402
from stage1.features import FEATURES  # noqa: E402

OUT = os.path.join(EMA_DATA, 'results', 'stage1')
ROOTS = ('SPY', 'QQQ', 'IWM', 'SPXW')
BLOCKS = ('A', 'B')
S1C = ('c_vwap', 'c_und5', 'c_rsi', 'c_rvol', 'c_or', 'c_pdhl', 'c_pm', 'c_bos', 'c_gex', 'c_wall', 'c_pcoi', 'c_ativ',
       'c_crvol', 'c_uw')
S1C_LABEL = {'c_vwap': 'VWAP side', 'c_und5': 'underlying 5m state +1', 'c_rsi': 'RSI14(5m und) > 50 (trade dir.)',
             'c_rvol': 'cumulative RVOL > 1.5', 'c_or': '15-min opening-range break', 'c_pdhl': 'PDH/PDL break',
             'c_pm': 'premarket H/L break', 'c_bos': '5m BOS within 3 bars', 'c_gex': 'net GEX < 0 (inferred)',
             'c_wall': 'no wall against within 0.3% (inferred)', 'c_pcoi': 'P/C OI ratio > 20-session median (obs.)',
             'c_ativ': 'ATM IV up over 60 min (obs.)', 'c_crvol': 'contract RVOL > 2 (obs.)',
             'c_uw': 'UW ask-side flow, trade dir., 15 min (obs.)'}
S1A_TESTS = [(F, tf) for tf in TFS for F in FEATURES]          # 40


def eval_sessions(blocks=BLOCKS) -> dict:
    out = {}
    for b in blocks:
        s = set()
        for r in ROOTS:
            try:
                s |= set(Panel(r).plan(b)['eval'])
            except FileNotFoundError:
                pass
        out[b] = sorted(s)
    return out


def load_events(blocks=BLOCKS, pattern='events_{b}_{r}.parquet', base=OUT) -> pd.DataFrame:
    parts = []
    for b in blocks:
        for r in ROOTS:
            p = os.path.join(base, pattern.format(b=b, r=r))
            if os.path.exists(p):
                parts.append(pd.read_parquet(p))
    return pd.concat(parts, ignore_index=True)


class Design:
    """Codes shared by every test: sessions (clusters), the S1A strata per timeframe, the S1C strata."""

    def __init__(self, ev: pd.DataFrame, sessions_by_block: dict):
        self.ev = ev
        allses = sorted({s for v in sessions_by_block.values() for s in v})
        self.K = len(allses)
        code = {int(s): i for i, s in enumerate(allses)}
        self.ses = ev.session.map(code).to_numpy(np.int64)
        self.block_K = {b: len(v) for b, v in sessions_by_block.items()}
        self.block_code = {}
        for b, v in sessions_by_block.items():
            c = {int(s): i for i, s in enumerate(v)}
            self.block_code[b] = ev.session.map(c).fillna(-1).to_numpy(np.int64)
        self.block = ev.block.to_numpy()
        rbr = ev.root.astype(str) + '|' + ev.bucket.astype(str) + '|' + ev.right.astype(str)
        self.rbr, self.rbr_names = pd.factorize(rbr)
        self.J0 = len(self.rbr_names)
        self.strata = {}
        for tf in TFS:
            u = ev[f'ust_{tf}'].to_numpy()
            s = self.rbr * 3 + np.where(np.isfinite(u), u + 1, 0).astype(np.int64)
            self.strata[tf] = np.where(np.isfinite(u), s, -1)
        self.W = ST.boot_weights(self.K)
        self.Wb = {b: ST.boot_weights(k) for b, k in self.block_K.items()}

    def d(self, y, f, strata, J, boot=True, block=None):
        ok = strata >= 0
        if block is not None:
            ok = ok & (self.block == block)
            ses, K, W = self.block_code[block], self.block_K[block], self.Wb[block] if boot else None
        else:
            ses, K, W = self.ses, self.K, self.W if boot else None
        return ST.delta(np.asarray(y)[ok], np.asarray(f)[ok], strata[ok], ses[ok], K, W, J)


def s1a_one(D: Design, ev, F, tf, prefix='f', yh=('Y15', 'Y30', 'Y60'), controls=True) -> dict:
    f = ev[f'{prefix}_{F}_{tf}'].to_numpy(float)
    st = D.strata[tf]
    J = D.J0 * 3
    r = {'feature': F, 'tf': tf, 'series': prefix}
    for y in yh:
        res = D.d(ev[y].to_numpy(float), f, st, J, boot=(y == 'Y30'))
        r[y] = res
    r['Ymid30'] = D.d(ev['Ymid30'].to_numpy(float), f, st, J, boot=False)
    y30 = ev['Y30'].to_numpy(float)
    for b in BLOCKS:
        if (D.block == b).any():
            r[f'block_{b}'] = D.d(y30, f, st, J, boot=True, block=b)
    allmean = np.nanmean(y30)
    r['mean_all'] = float(allmean)
    r['beats_random'] = bool(r['Y30']['mean1'] > allmean)
    if controls and prefix == 'f':
        p = ev[f'p_{F}_{tf}'].to_numpy(float)
        st2 = np.where(np.isfinite(p) & (st >= 0), st * 2 + np.nan_to_num(p).astype(np.int64), -1)
        r['reprice'] = D.d(y30, f, st2, J * 2, boot=True)
        r['pstar_alone'] = D.d(y30, p, st, J, boot=True)
        r['trade'] = D.d(y30, ev[f't_{F}_{tf}'].to_numpy(float), st, J, boot=True)
        # by cell (point estimates + CI for the brief's breakdowns)
        r['by_bucket'] = {bk: D.d(np.where(ev.bucket == bk, y30, np.nan), f, st, J, boot=True) for bk in BUCKETS}
        r['by_root'] = {rt: D.d(np.where(ev.root == rt, y30, np.nan), f, st, J, boot=True) for rt in ROOTS}
        r['by_right'] = {rr: D.d(np.where(ev.right == rr, y30, np.nan), f, st, J, boot=True) for rr in (1, -1)}
    return r


def s1a_pass(rows: list) -> list:
    p = np.array([r['Y30']['p'] for r in rows])
    hp = ST.holm(p)
    q = ST.bh(p)
    for r, h, qq in zip(rows, hp, q):
        r['holm'], r['bh'] = float(h), float(qq)
        r['rules'] = {
            'ci_gt_0': bool(r['Y30']['ci'][0] > 0),
            'holm_lt_0.05': bool(h < 0.05),
            'block_A_gt_0': bool(r.get('block_A', {}).get('delta', np.nan) > 0),
            'block_B_gt_0': bool(r.get('block_B', {}).get('delta', np.nan) > 0),
            'h15_h60_gt_0': bool(r['Y15']['delta'] > 0 and r['Y60']['delta'] > 0),
            'beats_random': r['beats_random'],
        }
        r['pass'] = all(r['rules'].values())
    return rows


def s1b(ev: pd.DataFrame) -> dict:
    cols = [f'st_{tf}' for tf in TFS] + [f'ust_{tf}' for tf in TFS]
    x = ev[cols + ['Y30', 'root', 'bucket', 'right', 'm', 'session', 'block']].dropna()
    fe1 = pd.get_dummies(x.root.astype(str) + '|' + x.bucket.astype(str) + '|' + x.right.astype(str), drop_first=False).astype(float)
    hh = pd.get_dummies(((x.m + 1) // 30).astype(int), prefix='hh', drop_first=True).astype(float)
    X = np.c_[x[cols].to_numpy(float), fe1.to_numpy(), hh.to_numpy()]
    out = {'n': len(x)}
    res = ST.ols_cluster(x.Y30.to_numpy(float), X, x.session.to_numpy())
    k = len(TFS)
    out['beta'], out['se'], out['p'] = res['beta'][:2 * k], res['se'][:2 * k], res['p_one_sided'][:2 * k]
    out['holm'] = ST.holm(out['p'][:k])
    out['qualified_nominal'] = [bool(p < 0.05 and b > 0) for p, b in zip(out['p'][:k], out['beta'][:k])]
    out['vif'] = ST.vif(x[[f'st_{tf}' for tf in TFS]].to_numpy(float))
    out['corr'] = x[[f'st_{tf}' for tf in TFS]].corr().to_numpy()
    out['clusters'] = res['clusters']
    for b in BLOCKS:
        xb = x[x.block == b]
        if len(xb) > 100:
            Xb = X[(x.block == b).to_numpy()]
            keep = Xb.std(0) > 0
            keep[:2 * k] = True
            rb = ST.ols_cluster(xb.Y30.to_numpy(float), Xb[:, keep], xb.session.to_numpy())
            out[f'beta_{b}'] = rb['beta'][:2 * k]
            out[f'p_{b}'] = rb['p_one_sided'][:2 * k]
    return out


def s1c(D: Design, ev: pd.DataFrame) -> list:
    base = (ev['f_B_5'] == 1).to_numpy()
    J = D.J0
    rows = []
    for c in S1C:
        f = np.where(base, ev[c].to_numpy(float), np.nan)
        r = {'feature': c, 'label': S1C_LABEL[c], 'n_base': int(base.sum())}
        for y in ('Y15', 'Y30', 'Y60'):
            r[y] = D.d(ev[y].to_numpy(float), f, D.rbr, J, boot=(y == 'Y30'))
        for b in BLOCKS:
            exists = np.isfinite(f[D.block == b]).sum() > 0
            r[f'block_{b}'] = D.d(ev['Y30'].to_numpy(float), f, D.rbr, J, boot=True, block=b) if exists else None
        rows.append(r)
    p = np.array([r['Y30']['p'] for r in rows])
    hp, q = ST.holm(p), ST.bh(p)
    for r, h, qq in zip(rows, hp, q):
        r['holm'], r['bh'] = float(h), float(qq)
        blk = [r[f'block_{b}']['delta'] > 0 for b in BLOCKS if r.get(f'block_{b}') is not None]
        r['rules'] = {'ci_gt_0': bool(r['Y30']['ci'][0] > 0), 'holm_lt_0.05': bool(h < 0.05),
                      'each_block_gt_0': bool(all(blk) and len(blk) > 0)}
        r['pass'] = all(r['rules'].values())
    return rows


def analyse():
    t0 = time.time()
    ev = load_events()
    ses = eval_sessions(sorted(ev.block.unique()))
    ev = ev[ev.status_ok].reset_index(drop=True)
    D = Design(ev, ses)
    rows = [s1a_one(D, ev, F, tf) for F, tf in S1A_TESTS]
    rows = s1a_pass(rows)
    trade_rows = s1a_pass([s1a_one(D, ev, F, tf, prefix='t', controls=False) for F, tf in S1A_TESTS])
    res = {'s1a': rows, 's1a_trade': trade_rows, 's1b': s1b(ev), 's1c': s1c(D, ev), 'n_events': len(ev),
           'sessions': {b: len(v) for b, v in ses.items()}, 'K': D.K,
           'events_by': ev.groupby(['block', 'root', 'bucket']).size().to_dict(),
           'y30_all': float(ev.Y30.mean()), 'seconds': time.time() - t0}
    pickle.dump(res, open(os.path.join(OUT, 's1_results.pkl'), 'wb'))
    print('S1A passes:', [(r['feature'], r['tf']) for r in rows if r['pass']], f'{time.time()-t0:.0f}s', flush=True)
    return res


# ------------------------------------------------------------------------------------------------ nulls
def null_family(D: Design, ev: pd.DataFrame, fvals: dict, n_boot_W=None) -> dict:
    """The S1A decision rule on one set of feature columns {(F, tf): array}: delta, bootstrap p, Holm, every rule."""
    rows = []
    for (F, tf), f in fvals.items():
        st = D.strata[tf]
        J = D.J0 * 3
        r = {'feature': F, 'tf': tf, 'Y30': D.d(ev.Y30.to_numpy(float), f, st, J, boot=True),
             'Y15': D.d(ev.Y15.to_numpy(float), f, st, J, boot=False), 'Y60': D.d(ev.Y60.to_numpy(float), f, st, J, boot=False)}
        for b in BLOCKS:
            if (D.block == b).any():
                r[f'block_{b}'] = D.d(ev.Y30.to_numpy(float), f, st, J, boot=False, block=b)
        r['beats_random'] = bool(r['Y30']['mean1'] > np.nanmean(ev.Y30.to_numpy(float)))
        rows.append(r)
    rows = s1a_pass(rows)
    return {'any_holm': any(r['rules']['holm_lt_0.05'] and r['rules']['ci_gt_0'] for r in rows),
            'any_pass': any(r['pass'] for r in rows), 'n_holm': sum(r['rules']['holm_lt_0.05'] for r in rows),
            'deltas': [r['Y30']['delta'] for r in rows], 'ps': [r['Y30']['p'] for r in rows],
            'min_holm': float(np.nanmin([r['holm'] for r in rows]))}


def perm(n_runs=200, seed=20261106):
    ev = load_events()
    ses = eval_sessions(sorted(ev.block.unique()))
    ev = ev[ev.status_ok].reset_index(drop=True)
    D = Design(ev, ses)
    cell = pd.factorize(ev.session.astype(str) + '|' + ev.root + '|' + ev.bucket + '|' + ev.right.astype(str))[0]
    rng = np.random.default_rng(seed)
    out_p = os.path.join(OUT, 's1_perm.parquet')
    done = pd.read_parquet(out_p).to_dict('records') if os.path.exists(out_p) else []
    for run in range(len(done), n_runs):
        fv = {}
        for F, tf in S1A_TESTS:
            f = ev[f'f_{F}_{tf}'].to_numpy(float)
            ok = np.flatnonzero(np.isfinite(f))
            c = cell[ok]
            o1 = ok[np.argsort(c, kind='stable')]
            o2 = ok[np.lexsort((rng.random(len(ok)), c))]
            g = f.copy()
            g[o1] = f[o2]
            fv[(F, tf)] = g
        r = null_family(D, ev, fv)
        done.append({'run': run, 'any_holm': r['any_holm'], 'any_pass': r['any_pass'], 'n_holm': r['n_holm'],
                     'min_holm': r['min_holm'], 'deltas': r['deltas'], 'ps': r['ps']})
        if run % 10 == 9 or run == n_runs - 1:
            pd.DataFrame(done).to_parquet(out_p + '.tmp')
            os.replace(out_p + '.tmp', out_p)
            print('perm', run + 1, 'any_holm share', np.mean([d['any_holm'] for d in done]), flush=True)


SYN_PARTS = os.environ.get('EMA_SYN_PARTS', '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad/synth_parts')


def synth(seeds, blocks=BLOCKS, analyse_seed=True):
    """Synthetic zero-drift null: per seed, the S1A event tables of every (block, root) built on SynthSource (cached
    per part outside the data budget, resumable), then the full S1A rule on the pooled table."""
    from stage1.synth import SynthSource
    d = os.path.join(OUT, 'synth')
    os.makedirs(d, exist_ok=True)
    os.makedirs(SYN_PARTS, exist_ok=True)
    keep = ['root', 'block', 'session', 'm', 'bucket', 'right', 'status_ok', 'Y15', 'Y30', 'Y60', 'Ymid30'] + \
           [f'f_{F}_{tf}' for F, tf in S1A_TESTS] + [f'ust_{tf}' for tf in TFS]
    ses = eval_sessions()
    for seed in seeds:
        p = os.path.join(d, f'seed_{seed:03d}.pkl')
        if os.path.exists(p):
            continue
        t0 = time.time()
        parts = []
        for b in blocks:
            for r in ROOTS:
                pp = os.path.join(SYN_PARTS, f'seed{seed:03d}_{b}_{r}.parquet')
                if not os.path.exists(pp):
                    ev = build(r, b, src=SynthSource(r, seed), full=False, log=lambda *a: None)
                    ev = ev[keep]
                    ev.to_parquet(pp + '.tmp')
                    os.replace(pp + '.tmp', pp)
                    print('synth part', seed, b, r, f'{time.time()-t0:.0f}s', flush=True)
                parts.append(pp)
        if not analyse_seed or not all(os.path.exists(os.path.join(SYN_PARTS, f'seed{seed:03d}_{b}_{r}.parquet'))
                                       for b in BLOCKS for r in ROOTS):
            continue
        ev = pd.concat([pd.read_parquet(os.path.join(SYN_PARTS, f'seed{seed:03d}_{b}_{r}.parquet'))
                        for b in BLOCKS for r in ROOTS], ignore_index=True)
        ev = ev[ev.status_ok].reset_index(drop=True)
        D = Design(ev, ses)
        res = null_family(D, ev, {(F, tf): ev[f'f_{F}_{tf}'].to_numpy(float) for F, tf in S1A_TESTS})
        res.update({'seed': seed, 'n_events': len(ev), 'y30_mean': float(ev.Y30.mean()), 'ymid30_mean': float(ev.Ymid30.mean()),
                    'seconds': time.time() - t0})
        pickle.dump(res, open(p + '.tmp', 'wb'))
        os.replace(p + '.tmp', p)
        print('synth seed', seed, 'any_holm', res['any_holm'], 'any_pass', res['any_pass'], flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['analyse', 'perm', 'synth'])
    ap.add_argument('--seeds', default='0-19')
    ap.add_argument('--runs', type=int, default=200)
    ap.add_argument('--blocks', default='A,B')
    a = ap.parse_args()
    if a.what == 'analyse':
        analyse()
    elif a.what == 'perm':
        perm(a.runs)
    else:
        lo, hi = map(int, a.seeds.split('-'))
        synth(range(lo, hi + 1), blocks=tuple(a.blocks.split(',')))


if __name__ == '__main__':
    main()
