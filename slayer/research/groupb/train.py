"""Group B retrain: the Hit score (Model 1) and the Runner score (Model 2) on the rebuilt rows of the current trees'
own training window (rows.train_days), with the current trees' family and hyper-parameters (public/models/
model_*_all6months.txt: gbdt, binary, 300 trees, learning rate 0.05, 31 leaves, 200 rows a leaf, bagging 0.8 every
iteration, feature fraction 0.8, seed 7), once on version 1's inputs (the control: what a retrain alone does) and once
on version 2's (the fix).

Labels (the current trees' own rows are not in the repository; these are the owner's definitions):
  Model 1  win  — the bid reached the 1.50x take-profit before the 0.4678x stop, by the session's flat;
  Model 2  win2 — the bid reached 2.00x before the stop, by the flat.
Every row the scan scored inside its session's entry minutes with a fill is a training row (both sleeves, every session).

The line each retrained tree calls at is set here, on the training sessions only, to the current trees' operating
point: the share of the books' candidate rows (Book A's or Book B's gates, no theta burn) the current Hit score puts
at or over 0.7067, and among those the share the Runner score puts at or over 0.50. Nothing is chosen on a holdout.

  GB_DATA=... python -I research/groupb/train.py
"""
import json, os, sys, time
import numpy as np
import lightgbm as lgb
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rows as R

P1_MIN, PRUN_MIN = 0.7067, 0.5
PARAMS = dict(objective='binary', boosting='gbdt', learning_rate=0.05, num_leaves=31, min_data_in_leaf=200,
              min_sum_hessian_in_leaf=1e-3, bagging_fraction=0.8, bagging_freq=1, feature_fraction=0.8, seed=7,
              num_threads=int(os.environ.get('GB_THREADS', '2')), verbose=-1, deterministic=True, force_row_wise=True)
ROUNDS = 300
OUT = os.path.join(R.DATA, 'models')


def main():
    days = R.train_days()
    print(f'{len(days)} training sessions {days[0]} .. {days[-1]}', flush=True)
    cols = R.feature_cols() + ['aGeom', 'bGeom', 'burns1', 'burns2', 'p1', 'prun', 'win', 'win2']
    df = R.load(days, cols)
    df = df[df['win'].notna()].reset_index(drop=True)
    print(f'{len(df)} training rows; win {df.win.mean():.3f}, win2 {df.win2.mean():.3f}', flush=True)
    os.makedirs(OUT, exist_ok=True)
    gated = (df.aGeom.values == 1) | (df.bGeom.values == 1)
    # the current trees' operating point on these sessions
    live_ok = gated & (df.burns1.values == 0) & np.isfinite(df.p1.values)
    share = float(np.mean(df.p1.values[live_ok] >= P1_MIN))
    over = live_ok & (df.p1.values >= P1_MIN)
    run_share = float(np.mean(np.nan_to_num(df.prun.values[over], nan=-1) >= PRUN_MIN)) if over.any() else 0.0
    print(f'current trees: {share:.4f} of {live_ok.sum()} candidate rows at or over the line; {run_share:.3f} of those ride', flush=True)
    meta = {'days': days, 'rows': int(len(df)), 'params': PARAMS, 'rounds': ROUNDS, 'live_share': share, 'live_run_share': run_share, 'models': {}}
    for version in (1, 2):
        X = R.X(df, version)
        burns = df[f'burns{version}'].values == 1
        tag = 'v1r' if version == 1 else 'v2'
        lines = {}
        for target, label in (('entry', 'win'), ('runner', 'win2')):
            t0 = time.time()
            ds = lgb.Dataset(X, label=df[label].values.astype(np.float32), free_raw_data=True)
            bst = lgb.train(PARAMS, ds, num_boost_round=ROUNDS)
            path = os.path.join(OUT, f'{tag}_{target}.txt')
            bst.save_model(path)
            print(f'{tag} {target}: {time.time() - t0:.0f} s -> {path}', flush=True)
            if target == 'entry':
                p = bst.predict(X)
                ok = gated & ~burns
                lines['p1'] = float(np.quantile(p[ok], 1 - share))
                over_v = ok & (p >= lines['p1'])
                lines['_over'] = over_v
            else:
                q = bst.predict(X)
                over_v = lines.pop('_over')
                lines['prun'] = float(np.quantile(q[over_v], 1 - run_share)) if over_v.any() and run_share > 0 else 1.0
        meta['models'][tag] = {'version': version, 'line': lines['p1'], 'runner_line': lines['prun']}
        print(f'{tag}: line {lines["p1"]:.4f}, runner line {lines["prun"]:.4f}', flush=True)
        del X
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)


if __name__ == '__main__':
    main()
