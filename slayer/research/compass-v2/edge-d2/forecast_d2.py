"""EDGE-D2 Part 1: the big-day forecast (PREREG "Model", "Part 1 statistics").

  python3 forecast_d2.py run      -> v2data/edge-d2/preds.parquet (OOS predictions, every model / baseline / target)
  python3 forecast_d2.py null N   -> v2data/edge-d2/null_preds_<k>.npz (shuffled-label walk-forwards; resumable by block)
  python3 forecast_d2.py report   -> results/PART1.md, results/part1.json
"""
import glob, json, math, os, sys, warnings
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from common_d2 import HERE, OUT

warnings.filterwarnings('ignore')
P_FEAT = ['lvix', 'dvix', 'vts', 'gap', 'lrange', 'lrv5', 'lrv20', 'cpinfp', 'fomc', 'dow_mon', 'dow_tue', 'dow_wed',
          'dow_thu', 'opex']
O_FEAT = P_FEAT + ['livr', 'lim', 'gshort', 'fdist']
F_FEAT = O_FEAT + ['mv30', 'rvr30']
MODELS = {'P': P_FEAT, 'O': O_FEAT, 'F': F_FEAT, 'B-VIX': ['lvix'], 'B-IM': ['lim']}
FIRST_Q = {'P': '2020Q1', 'B-VIX': '2020Q1', 'B-YB': '2020Q1', 'O': '2023Q1', 'F': '2023Q1', 'B-IM': '2023Q1'}
TARGETS = ('Y1', 'Y2', 'Y3')
RES = os.path.join(HERE, 'results')


def load():
    f = pd.read_parquet(os.path.join(OUT, 'features.parquet'))
    f = f[f.day >= '2018-01-02'].copy()
    f['q'] = pd.PeriodIndex(pd.to_datetime(f.day), freq='Q').astype(str)
    f['ybig'] = (f.prev_oc > 0.015).astype(float)
    return f.reset_index(drop=True)


def sample(f, model, target):
    """Sample days of a model x target. Y3 needs the open's implied move -> board sample (and its 2023Q1 schedule)."""
    if model in ('O', 'F', 'B-IM') or target == 'Y3':
        s = f[f.board & f.im.notna()]
        if model == 'F':
            s = s[s.mv30.notna() & s.rvr30.notna()]
    else:
        s = f
    s = s[s[target].notna()]
    return s


def first_q(model, target):
    return '2023Q1' if target == 'Y3' else FIRST_Q[model]


def walk_forward(s, feats, y, first):
    """Anchored, by quarter. Returns p_hat and tau (2 x training base rate) for every day in quarters >= first."""
    X = s[feats].values.astype(float)
    q = s.q.values
    p = np.full(len(s), np.nan)
    tau = np.full(len(s), np.nan)
    base = np.full(len(s), np.nan)
    for Q in sorted(set(q)):
        if Q < first:
            continue
        tr, te = q < Q, q == Q
        if tr.sum() < 50 or y[tr].sum() < 3 or y[tr].sum() == tr.sum():
            continue
        Xtr, Xte = X[tr].copy(), X[te].copy()
        med = np.nanmedian(Xtr, axis=0)
        med = np.where(np.isfinite(med), med, 0.0)
        for j in range(X.shape[1]):
            Xtr[np.isnan(Xtr[:, j]), j] = med[j]
            Xte[np.isnan(Xte[:, j]), j] = med[j]
        mu, sd = Xtr.mean(0), Xtr.std(0)
        sd = np.where(sd > 0, sd, 1.0)
        m = LogisticRegression(C=1.0, max_iter=1000).fit((Xtr - mu) / sd, y[tr])
        p[te] = m.predict_proba((Xte - mu) / sd)[:, 1]
        br = y[tr].mean()
        base[te] = br
        tau[te] = 2 * br
    return p, tau, base


def last_coefs(s, feats, y):
    X = s[feats].values.astype(float)
    med = np.nanmedian(X, axis=0)
    for j in range(X.shape[1]):
        X[np.isnan(X[:, j]), j] = med[j] if np.isfinite(med[j]) else 0
    mu, sd = X.mean(0), X.std(0)
    sd = np.where(sd > 0, sd, 1.0)
    m = LogisticRegression(C=1.0, max_iter=1000).fit((X - mu) / sd, y)
    return dict(zip(feats, m.coef_[0].tolist()))


def run():
    f = load()
    out = []
    for target in TARGETS:
        for model in list(MODELS) + ['B-YB']:
            if model == 'B-YB' and target == 'Y3':
                pass
            if model == 'B-IM' and target not in TARGETS:
                continue
            s = sample(f, 'P' if model == 'B-YB' else model, target).copy()
            y = s[target].values.astype(int)
            fq = first_q(model, target)
            if model == 'B-YB':
                p = s.ybig.values.astype(float)
                p = np.where(s.q.values >= fq, p, np.nan)
                tau = np.where(np.isfinite(p), 0.5, np.nan)
                base = np.full(len(s), np.nan)
            else:
                p, tau, base = walk_forward(s, MODELS[model], y, fq)
            d = pd.DataFrame({'day': s.day.values, 'q': s.q.values, 'model': model, 'target': target, 'y': y, 'p': p,
                              'tau': tau, 'base': base})
            out.append(d[d.p.notna()])
    pr = pd.concat(out, ignore_index=True)
    pr['flag'] = (pr.p >= pr.tau).astype(int)
    pr.to_parquet(os.path.join(OUT, 'preds.parquet'), index=False)
    print(pr.groupby(['target', 'model']).size())


NULL_MODELS = ('P', 'O', 'F', 'B-VIX')


def null(n=200, block=20):
    """Shuffled-day labels: labels permuted across the sample days, full walk-forward refit. Stores p and flag."""
    f = load()
    os.makedirs(os.path.join(OUT, 'null'), exist_ok=True)
    for b0 in range(0, n, block):
        fo = os.path.join(OUT, 'null', f'null_{b0:04d}.npz')
        if os.path.exists(fo):
            continue
        res = {}
        for target in TARGETS:
            for model in NULL_MODELS:
                s = sample(f, model, target)
                y = s[target].values.astype(int)
                fq = first_q(model, target)
                P, F = [], []
                for k in range(b0, b0 + block):
                    rng = np.random.default_rng(1000 + k)
                    yy = rng.permutation(y)
                    p, tau, _ = walk_forward(s, MODELS[model], yy, fq)
                    P.append(p.astype(np.float32)); F.append((p >= tau).astype(np.int8))
                    res[f'{model}|{target}|y|{k}'] = yy.astype(np.int8)
                res[f'{model}|{target}|p'] = np.array(P)
                res[f'{model}|{target}|flag'] = np.array(F)
                res[f'{model}|{target}|days'] = s.day.values.astype('U10')
        np.savez_compressed(fo + '.tmp.npz', **res)
        os.replace(fo + '.tmp.npz', fo)
        print('null block', b0, flush=True)


# ---------------------------------------------------------------- statistics
def month_blocks(days):
    return np.array([d[:7] for d in days])


def boot_auc(y, p, days, n=2000, seed=7, p2=None):
    mb = month_blocks(days)
    um = np.unique(mb)
    idx = {m: np.flatnonzero(mb == m) for m in um}
    rng = np.random.default_rng(seed)
    v = []
    for _ in range(n):
        ii = np.concatenate([idx[m] for m in rng.choice(um, len(um))])
        yy = y[ii]
        if yy.min() == yy.max():
            continue
        a = roc_auc_score(yy, p[ii])
        if p2 is not None:
            a -= roc_auc_score(yy, p2[ii])
        v.append(a)
    return float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))


def metrics(d):
    y, p = d.y.values, d.p.values
    out = {'n': int(len(d)), 'pos': int(y.sum()), 'base': float(y.mean())}
    if y.min() == y.max():
        return out
    out['auc'] = float(roc_auc_score(y, p))
    out['auc_lo'], out['auc_hi'] = boot_auc(y, p, d.day.values)
    if d.model.iloc[0] != 'B-YB':
        out['brier'] = float(np.mean((p - y) ** 2))
        out['brier_clim'] = float(np.mean((d.base.values - y) ** 2))
        out['bss'] = 1 - out['brier'] / out['brier_clim']
    fl = d.flag.values.astype(bool)
    out['flag_rate'] = float(fl.mean())
    out['precision'] = float(y[fl].mean()) if fl.any() else float('nan')
    out['recall'] = float(fl[y == 1].mean())
    return out


def calib(d, nb=10):
    if d.model.iloc[0] == 'B-YB':
        return []
    q = pd.qcut(d.p.rank(method='first'), nb, labels=False)
    return [{'dec': int(k), 'p_mean': float(g.p.mean()), 'obs': float(g.y.mean()), 'n': int(len(g))} for k, g in d.groupby(q)]


def report():
    pr = pd.read_parquet(os.path.join(OUT, 'preds.parquet'))
    f = load()
    os.makedirs(RES, exist_ok=True)
    J = {}
    L = ['# EDGE-D2 Part 1: forecasting a big-move day (DEV, out-of-sample walk-forward predictions only)', '',
         'PREREG `edge-d2/PREREG.md` @ bc38f68. Logistic regression (L2, C=1), anchored walk-forward by quarter; '
         'forecast-positive = p_hat >= 2 x the training base rate. AUC CIs: month-block bootstrap (2,000). '
         'Brier skill vs the training base rate. Y1 |o->c| > 1.5%, Y2 > 1.0%, Y3 high-low > 2x the 09:34 implied move.', '']
    # null summaries
    nulls = {}
    for fn in sorted(glob.glob(os.path.join(OUT, 'null', 'null_*.npz'))):
        z = np.load(fn)
        for key in z.files:
            if key.endswith('|p'):
                model, target, _ = key.split('|')
                days = z[f'{model}|{target}|days']
                P = z[key]
                b0 = int(os.path.basename(fn)[5:9])
                for j in range(P.shape[0]):
                    yy = z[f'{model}|{target}|y|{b0 + j}']
                    ok = np.isfinite(P[j])
                    if ok.sum() > 10 and yy[ok].min() != yy[ok].max():
                        a = roc_auc_score(yy[ok], P[j][ok])
                        nulls.setdefault(f'{model}|{target}', []).append(a)
    for target in TARGETS:
        L += [f'## Target {target}', '', '| model | OOS days | positives (base rate) | AUC [95% CI] | shuffled-null AUC p95 (real beats) | Brier (clim) | Brier skill | flagged | precision | recall |',
              '|---|---:|---:|---|---|---|---:|---:|---:|---:|']
        for model in ['P', 'B-VIX', 'B-YB', 'O', 'B-IM', 'F']:
            d = pr[(pr.target == target) & (pr.model == model)]
            if not len(d):
                continue
            m = metrics(d)
            nl = nulls.get(f'{model}|{target}')
            if nl is not None and 'auc' in m:
                m['null_p95'] = float(np.percentile(nl, 95)); m['null_beats'] = float(np.mean(np.array(nl) < m['auc'])); m['null_n'] = len(nl)
            J[f'{model}|{target}'] = m
            nls = f"{m['null_p95']:.3f} ({100 * m['null_beats']:.0f}%, {m['null_n']} runs)" if 'null_p95' in m else '-'
            br = f"{m['brier']:.4f} ({m['brier_clim']:.4f})" if 'brier' in m else '-'
            bss = f"{100 * m['bss']:+.1f}%" if 'bss' in m else '-'
            L.append(f"| {model} | {m['n']} | {m['pos']} ({100 * m['base']:.1f}%) | {m.get('auc', float('nan')):.3f} [{m.get('auc_lo', float('nan')):.3f}, {m.get('auc_hi', float('nan')):.3f}] | {nls} | {br} | {bss} | "
                     f"{100 * m.get('flag_rate', float('nan')):.0f}% | {100 * m.get('precision', float('nan')):.1f}% | {100 * m.get('recall', float('nan')):.0f}% |")
        L.append('')
        # paired AUC differences
        L += ['Paired AUC difference (same OOS days), month-block bootstrap:', '']
        for a, b in (('P', 'B-VIX'), ('P', 'B-YB'), ('O', 'B-VIX'), ('O', 'B-IM'), ('O', 'P'), ('F', 'O'), ('F', 'B-IM')):
            da = pr[(pr.target == target) & (pr.model == a)][['day', 'y', 'p']]
            db = pr[(pr.target == target) & (pr.model == b)][['day', 'p']].rename(columns={'p': 'p2'})
            j = da.merge(db, on='day')
            if len(j) < 30 or j.y.min() == j.y.max():
                continue
            diff = roc_auc_score(j.y, j.p) - roc_auc_score(j.y, j.p2)
            lo, hi = boot_auc(j.y.values, j.p.values, j.day.values, p2=j.p2.values)
            J[f'diff|{a}-{b}|{target}'] = {'n': len(j), 'diff': diff, 'lo': lo, 'hi': hi}
            L.append(f'- {a} minus {b}: {diff:+.3f} [{lo:+.3f}, {hi:+.3f}] on {len(j)} days')
        L.append('')
    # by year (Y1)
    L += ['## By year (Y1): AUC / base rate / precision at the threshold / recall / flagged', '',
          '| model | ' + ' | '.join(str(y) for y in range(2020, 2025)) + ' |', '|---|' + '---|' * 5]
    for model in ['P', 'B-VIX', 'B-YB', 'O', 'B-IM', 'F']:
        d = pr[(pr.target == 'Y1') & (pr.model == model)]
        cells = []
        for yr in range(2020, 2025):
            x = d[d.day.str[:4] == str(yr)]
            if len(x) < 20:
                cells.append('-')
                continue
            fl = x.flag.astype(bool)
            a = roc_auc_score(x.y, x.p) if x.y.min() != x.y.max() else float('nan')
            cells.append(f'{a:.2f} / {100 * x.y.mean():.0f}% / {100 * x.y[fl].mean() if fl.any() else float("nan"):.0f}% / '
                         f'{100 * fl[x.y == 1].mean() if (x.y == 1).any() else float("nan"):.0f}% / {100 * fl.mean():.0f}%')
        L.append(f'| {model} | ' + ' | '.join(cells) + ' |')
    # calibration
    L += ['', '## Calibration (Y1, deciles of p_hat: mean p_hat -> observed rate, n)', '']
    for model in ['P', 'O', 'F']:
        d = pr[(pr.target == 'Y1') & (pr.model == model)]
        cb = calib(d)
        J[f'calib|{model}'] = cb
        L.append(f'- {model}: ' + '; '.join(f"{100 * c['p_mean']:.0f}%->{100 * c['obs']:.0f}% ({c['n']})" for c in cb))
    # what carries it: last-fit coefficients and drop-one OOS AUC
    L += ['', '## What carries it (Y1): standardised coefficients of the fit on all sample days; drop-one-feature change in OOS AUC', '']
    for model in ['P', 'O', 'F']:
        s = sample(f, model, 'Y1')
        y = s.Y1.values.astype(int)
        co = last_coefs(s, MODELS[model], y)
        base_p, _, _ = walk_forward(s, MODELS[model], y, first_q(model, 'Y1'))
        ok = np.isfinite(base_p)
        a0 = roc_auc_score(y[ok], base_p[ok])
        drops = {}
        for ft in MODELS[model]:
            p2, _, _ = walk_forward(s, [x for x in MODELS[model] if x != ft], y, first_q(model, 'Y1'))
            drops[ft] = float(roc_auc_score(y[ok], p2[ok]) - a0)
        J[f'coef|{model}'] = co
        J[f'drop|{model}'] = drops
        L += [f'**{model}** (OOS AUC {a0:.3f})', '', '| feature | coef (std) | AUC change if dropped |', '|---|---:|---:|']
        for ft in sorted(MODELS[model], key=lambda z: -abs(co[z])):
            L.append(f'| {ft} | {co[ft]:+.2f} | {drops[ft]:+.3f} |')
        L.append('')
    # P restricted to the O days (apples to apples)
    d = pr[(pr.target == 'Y1')]
    j = d[d.model == 'P'].merge(d[d.model == 'O'][['day']], on='day')
    if len(j) > 30:
        L.append(f'Model P on Model O\'s OOS days (2023-24, n {len(j)}): AUC {roc_auc_score(j.y, j.p):.3f}, base rate {100 * j.y.mean():.1f}%.')
    # label-source QA
    q = f[(f.lab_src == 'bars')]
    agree = ((q.eod_oc > 0.015) == (q.oc > 0.015)).mean()
    L += ['', f'Data QA: on the {len(q)} days with 1-minute bars, Y1 from the bars and from the EOD open/close agree on '
          f'{100 * agree:.1f}% of days; median |EOD open / 09:30 bar open - 1| = {1e4 * np.median(np.abs(q.eod_open / q.O - 1)):.1f} bp.']
    open(os.path.join(RES, 'PART1.md'), 'w').write('\n'.join(L) + '\n')
    json.dump(J, open(os.path.join(RES, 'part1.json'), 'w'), indent=1, default=float)
    print('\n'.join(L))


if __name__ == '__main__':
    c = sys.argv[1]
    if c == 'run':
        run()
    elif c == 'null':
        null(int(sys.argv[2]) if len(sys.argv) > 2 else 200)
    elif c == 'report':
        report()
