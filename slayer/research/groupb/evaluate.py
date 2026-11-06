"""Group B holdout: the current trees (version 1 inputs, the shipped files at 0.7067 / 0.50), the version 1 retrain
(the control) and the version 2 retrain, each run through the books' own seats on the locked holdout's rows, scored once.

Seats (compassModel scoreRows, the late path every built mark takes): in each scoring pass (one name and sleeve at one
mark) the candidates are the rows inside the session's entry minutes that clear the line (the model's own NaN-unsafe
columns defined), carry no theta burn (the model's version's gate), and pass Book A's gates (the strike span) or Book
B's (the far band, ask <= 1.00, at most half its ask 30 minutes earlier); per root, a drive (|return from the open| >=
0.35%) calls only its own side's best, a flat root with both sides clearing calls neither, else the best; drive roots
first, then the highest score; one call a root and sleeve a session, one call a contract.
A call's outcome (research/groupb/build.ts): win = the bid reached the 1.50x take-profit before the 0.4678x stop by the
session's flat (the owner's definition); return = exit / fill - 1 under the book's exit (Book A: the 1.50x take-profit
unless the Runner score clears its line, then the ratchet; Book B: the ratchet). One-minute NBBO, no fees.
Intervals: 95%, whole-session bootstrap (2,000 resamples); Wilson beside the win rate.
Overfitting (research/challenger/overfit.py, Bailey et al.): PBO by CSCV over the family (3 models x 5 operating
points), 16 blocks of holdout sessions in time order; deflated Sharpe of each model's per-call returns with N = the
family size and the family's Sharpe variance.

  GB_DATA=... python -I research/groupb/evaluate.py --set h1 [--set h2]
"""
import argparse, itertools, json, math, os, re, sys
from statistics import NormalDist
import numpy as np
import lightgbm as lgb
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rows as R

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, '..', '..', 'public', 'models')
DRIVE = 0.0035
N01 = NormalDist()
EULER = 0.5772156649015329


def nan_unsafe(path):
    """compassModel's rule (lgbm.ts nanUnsafeColumns): a column some split reads with missing type none whose training
    range excludes 0."""
    txt = open(path).read()
    infos = re.search(r'^feature_infos=(.*)$', txt, re.M).group(1).split()
    ranges = []
    for s in infos:
        if s == 'none':
            ranges.append(None)
            continue
        a, b = s.strip('[]').split(':')
        ranges.append((float(a), float(b)))
    kinds = {}
    for feats, dts in zip(re.findall(r'^split_feature=(.*)$', txt, re.M), re.findall(r'^decision_type=(.*)$', txt, re.M)):
        for f, d in zip(feats.split(), dts.split()):
            kinds.setdefault(int(f), set()).add((int(d) >> 2) & 3)
    return sorted(c for c, k in kinds.items() if 0 in k and ranges[c] is not None and not (ranges[c][0] <= 0 <= ranges[c][1]))


def score(path, X):
    p = lgb.Booster(model_file=path).predict(X)
    bad = nan_unsafe(path)
    if bad:
        p = np.where(np.isnan(X[:, bad]).any(axis=1), np.nan, p)
    return p


def seat_calls(df, p1, prun, line, rline, burns):
    """The books' late-path seats; returns (row index, book, ride) of each call in order."""
    ok = np.isfinite(p1) & (p1 >= line) & ~burns & ((df.aGeom.values == 1) | (df.bGeom.values == 1))
    idx = np.flatnonzero(ok)
    if not len(idx):
        return []
    sub = df.iloc[idx]
    order = np.lexsort((sub['order'].values, sub['day'].values))
    idx = idx[order]
    days, passes = df['day'].values[idx], df['pass'].values[idx]
    cut = np.flatnonzero((days[1:] != days[:-1]) | (passes[1:] != passes[:-1])) + 1
    tick, sleeve, cid = df['ticker'].values, df['sleeve'].values, df['id'].values
    call, ret, ageo = df['right'].values == 'C', df['retOpen'].values, df['aGeom'].values == 1
    out, held, ids, cur = [], set(), set(), None
    for seg in np.split(idx, cut):
        d = df['day'].values[seg[0]]
        if d != cur:
            cur, held, ids = d, set(), set()
        cands = []
        for book in ('A', 'B'):
            pool = [i for i in seg if ageo[i] == (book == 'A')]
            by = {}
            for i in pool:
                by.setdefault(tick[i], []).append(i)
            for t, lst in by.items():
                r0 = next((ret[i] for i in lst if np.isfinite(ret[i])), np.nan)
                drive = bool(np.isfinite(r0) and abs(r0) >= DRIVE)
                if drive:
                    side = [i for i in lst if call[i] == (r0 > 0)]
                    if not side:
                        continue
                    best = side[0]
                    for i in side[1:]:
                        if p1[i] > p1[best]:
                            best = i
                else:
                    if any(call[i] for i in lst) and any(not call[i] for i in lst):
                        continue
                    best = lst[0]
                    for i in lst[1:]:
                        if p1[i] > p1[best]:
                            best = i
                cands.append((drive, p1[best], len(cands), best, book))
        cands.sort(key=lambda c: (-int(c[0]), -c[1], c[2]))
        any_drive = any(c[0] for c in cands)
        for drive, _, _, i, book in cands:
            if any_drive and not drive:
                continue
            key = f'{sleeve[i]}|{tick[i]}'
            if key in held or cid[i] in ids:
                continue
            held.add(key)
            ids.add(cid[i])
            ride = book == 'B' or (np.isfinite(prun[i]) and prun[i] >= rline)
            out.append((i, book, ride))
    return out


def outcomes(df, calls):
    rec = []
    for i, book, ride in calls:
        r = df['retR'].values[i] if ride else df['retA'].values[i]
        rec.append(dict(day=df['day'].values[i], i=int(i), book=book, ride=bool(ride), win=df['win'].values[i], ret=r,
                        session=df['session'].values[i], sleeve=df['sleeve'].values[i], dte=int(df['dte'].values[i]),
                        regularDay=int(df['regularDay'].values[i]), ticker=df['ticker'].values[i], mark=df['mark'].values[i],
                        id=df['id'].values[i], tm=float(df['tm'].values[i])))
    return rec


def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def boot(rec, days, n=2000, seed=7):
    """Session-block bootstrap of the win rate and the return per call (settled calls)."""
    by = {d: [] for d in days}
    for r in rec:
        if np.isfinite(r['win']) and np.isfinite(r['ret']):
            by.setdefault(r['day'], []).append((r['win'], r['ret']))
    ds = sorted(by)
    W = [np.array([w for w, _ in by[d]]) for d in ds]
    T = [np.array([t for _, t in by[d]]) for d in ds]
    def f(sel):
        nn = sum(len(W[i]) for i in sel)
        return (sum(W[i].sum() for i in sel) / nn, sum(T[i].sum() for i in sel) / nn) if nn else (np.nan, np.nan)
    pt = f(range(len(ds)))
    rng = np.random.default_rng(seed)
    bs = np.array([f(rng.integers(0, len(ds), len(ds))) for _ in range(n)])
    lo, hi = np.nanpercentile(bs, [2.5, 97.5], axis=0)
    k = sum(len(w) for w in W)
    return dict(n=int(k), win=pt[0], win_lo=lo[0], win_hi=hi[0], ret=pt[1], ret_lo=lo[1], ret_hi=hi[1],
                wilson=wilson(sum(w.sum() for w in W), k), unsettled=int(sum(1 for r in rec if not (np.isfinite(r['win']) and np.isfinite(r['ret'])))))


def pbo(mats, metric, blocks=16, min_calls=5):
    T = len(mats[0][0])
    N = len(mats)
    edges = np.linspace(0, T, blocks + 1).astype(int)
    blk = [np.arange(edges[i], edges[i + 1]) for i in range(blocks)]
    def perf(sel):
        out = np.full(N, -np.inf)
        for j, (c, w, r) in enumerate(mats):
            n = c[sel].sum()
            if n >= min_calls:
                out[j] = (w[sel].sum() if metric == 'win' else r[sel].sum()) / n
        return out
    lams = []
    for combo in itertools.combinations(range(blocks), blocks // 2):
        ins = np.concatenate([blk[i] for i in combo])
        oos = np.concatenate([blk[i] for i in range(blocks) if i not in combo])
        pi, po = perf(ins), perf(oos)
        if not np.isfinite(pi).any():
            continue
        best = int(np.argmax(pi))
        valid = np.isfinite(po)
        if not valid[best] or valid.sum() < 2:
            continue
        rank = 1 + np.sum(po[valid] < po[best]) + 0.5 * (np.sum(po[valid] == po[best]) - 1)
        omega = rank / (valid.sum() + 1)
        lams.append(math.log(omega / (1 - omega)))
    lams = np.array(lams)
    return (float(np.mean(lams <= 0)) if len(lams) else np.nan), len(lams)


def deflated_sharpe(returns, n_trials, sr_var):
    r = np.asarray(returns, float)
    r = r[np.isfinite(r)]
    T = len(r)
    if T < 3 or r.std(ddof=1) == 0:
        return np.nan, np.nan, np.nan
    sr = r.mean() / r.std(ddof=1)
    z = (r - r.mean()) / r.std(ddof=0)
    skew, kurt = float(np.mean(z ** 3)), float(np.mean(z ** 4))
    n = max(2, int(n_trials))
    sr0 = math.sqrt(max(sr_var, 0.0)) * ((1 - EULER) * N01.inv_cdf(1 - 1 / n) + EULER * N01.inv_cdf(1 - 1 / (n * math.e)))
    den = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr * sr))
    return N01.cdf((sr - sr0) * math.sqrt(T - 1) / den), sr, sr0


def paired(a, b, days, n=2000, seed=11):
    """(a - b) in win rate and in return per call, the same resampled sessions for both."""
    def by(rec):
        out = {d: [] for d in days}
        for r in rec:
            if np.isfinite(r['win']) and np.isfinite(r['ret']):
                out.setdefault(r['day'], []).append((r['win'], r['ret']))
        return [np.array(out[d], float).reshape(-1, 2) for d in days]
    A, B = by(a), by(b)
    def f(arrs, sel):
        nn = sum(len(arrs[i]) for i in sel)
        if not nn:
            return np.array([np.nan, np.nan])
        return np.array([sum(arrs[i][:, 0].sum() for i in sel), sum(arrs[i][:, 1].sum() for i in sel)]) / nn
    pt = f(A, range(len(days))) - f(B, range(len(days)))
    rng = np.random.default_rng(seed)
    bs = []
    for _ in range(n):
        sel = rng.integers(0, len(days), len(days))
        bs.append(f(A, sel) - f(B, sel))
    lo, hi = np.nanpercentile(np.array(bs), [2.5, 97.5], axis=0)
    return dict(win=pt[0], win_lo=lo[0], win_hi=hi[0], ret=pt[1], ret_lo=lo[1], ret_hi=hi[1])


def per_session(rec, days):
    c = np.zeros(len(days)); w = np.zeros(len(days)); r = np.zeros(len(days))
    pos = {d: k for k, d in enumerate(days)}
    for x in rec:
        if np.isfinite(x['win']) and np.isfinite(x['ret']):
            k = pos[x['day']]
            c[k] += 1; w[k] += x['win']; r[k] += x['ret']
    return c, w, r


def pct(v, dp=0):
    return '—' if not np.isfinite(v) else f'{100 * v:.{dp}f}%'


def spct(v, dp=1):
    return '—' if not np.isfinite(v) else f'{100 * v:+.{dp}f}%'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--set', action='append', default=[])
    a = ap.parse_args()
    meta = json.load(open(os.path.join(R.DATA, 'models', 'meta.json')))
    M = os.path.join(R.DATA, 'models')
    models = {
        'current (v1 inputs, shipped trees)': dict(version=1, entry=os.path.join(PUBLIC, 'model_entry_all6months.txt'), runner=os.path.join(PUBLIC, 'model_runner_all6months.txt'), line=0.7067, rline=0.5, live=True),
        'retrained, v1 inputs (control)': dict(version=1, entry=os.path.join(M, 'v1r_entry.txt'), runner=os.path.join(M, 'v1r_runner.txt'), line=meta['models']['v1r']['line'], rline=meta['models']['v1r']['runner_line']),
        'retrained, v2 inputs (Group B)': dict(version=2, entry=os.path.join(M, 'v2_entry.txt'), runner=os.path.join(M, 'v2_runner.txt'), line=meta['models']['v2']['line'], rline=meta['models']['v2']['runner_line']),
    }
    report = {'sets': {}}
    lines_md = []
    for s in a.set:
        pick, block = {'h1': (R.is_h1, R.h1_block), 'h2': (R.is_h2, R.h2_block), 'dev': (lambda d: d in R.train_days(), lambda d: 'dev ' + d[:7])}[s]
        days = [d for d in R.built() if pick(d)]
        if not days:
            continue
        need = R.feature_cols() + ['day', 'sleeve', 'ticker', 'id', 'right', 'mark', 'session', 'pass', 'order', 'aGeom', 'bGeom', 'burns1', 'burns2', 'dte', 'tm', 'retOpen', 'regularDay', 'p1', 'prun', 'win', 'retA', 'retR']
        df = R.load(days, need, objects=True)
        print(f'{s}: {len(days)} sessions, {len(df)} rows', flush=True)
        X = {1: R.X(df, 1), 2: R.X(df, 2)}
        res = {}
        scores = {}
        fam = []
        for name, m in models.items():
            if m.get('live'):
                p1, prun = df['p1'].values.astype(float), df['prun'].values.astype(float)
            else:
                p1, prun = score(m['entry'], X[m['version']]), score(m['runner'], X[m['version']])
            burns = df[f"burns{m['version']}"].values == 1
            scores[name] = (p1, prun)
            rec = outcomes(df, seat_calls(df, p1, prun, m['line'], m['rline'], burns))
            st = boot(rec, days)
            blocks = {b: boot([r for r in rec if block(r['day']) == b], [d for d in days if block(d) == b]) for b in sorted({block(d) for d in days})}
            beh = dict(overnight=sum(r['session'] == 'overnight' for r in rec), pre=sum(r['session'] == 'pre' for r in rec), curb=sum(r['session'] == 'curb' for r in rec),
                       regular=sum(r['session'] == 'regular' for r in rec), half_day=sum(1 for r in rec if r['session'] == 'regular' and not r['regularDay']),
                       weekly=sum(r['dte'] >= 1 for r in rec), odte=sum(r['dte'] == 0 for r in rec), book_b=sum(r['book'] == 'B' for r in rec), ride=sum(r['ride'] for r in rec))
            res[name] = dict(all=st, blocks=blocks, behaviour=beh, line=m['line'], rline=m['rline'], calls=rec)
            # the family for PBO: this model at five operating points (the line moved to call 0.5x .. 2x as often)
            ok = np.isfinite(p1) & ~burns & ((df.aGeom.values == 1) | (df.bGeom.values == 1))
            base = float(np.mean(p1[ok] >= m['line'])) if ok.any() else 0
            for mult in (0.5, 0.75, 1.0, 1.5, 2.0):
                ln = m['line'] if mult == 1.0 or base == 0 else float(np.quantile(p1[ok], max(0.0, 1 - base * mult)))
                fam.append((f'{name} x{mult}', outcomes(df, seat_calls(df, p1, prun, ln, m['rline'], burns))))
        mats = [per_session(rc, days) for _, rc in fam]
        p_win, ns = pbo(mats, 'win')
        p_ret, _ = pbo(mats, 'ret')
        srs = []
        for _, rc in fam:
            rr = np.array([x['ret'] for x in rc if np.isfinite(x['ret'])])
            if len(rr) >= 5 and rr.std(ddof=1) > 0:
                srs.append(rr.mean() / rr.std(ddof=1))
        sr_var = float(np.var(srs, ddof=1)) if len(srs) > 1 else 0.0
        for name in res:
            rr = [x['ret'] for x in res[name]['calls']]
            res[name]['dsr'] = deflated_sharpe(rr, len(fam), sr_var)
        names = list(res)
        cur, ctl, new = names
        pairs = {f'{new} - {cur}': paired(res[new]['calls'], res[cur]['calls'], days), f'{new} - {ctl}': paired(res[new]['calls'], res[ctl]['calls'], days),
                 f'{ctl} - {cur}': paired(res[ctl]['calls'], res[cur]['calls'], days)}
        # Model 2 on its own: the new Hit score's calls, ridden by the new Runner score against by the current one
        old_prun = scores[cur][1]
        rides = []
        for r in res[new]['calls']:
            i = r['i']
            old_ride = r['book'] == 'B' or (np.isfinite(old_prun[i]) and old_prun[i] >= 0.5)
            rides.append(dict(day=r['day'], win=r['win'], new=r['ret'], old=df['retR'].values[i] if old_ride else df['retA'].values[i]))
        runner = paired([dict(day=x['day'], win=x['win'], ret=x['new']) for x in rides], [dict(day=x['day'], win=x['win'], ret=x['old']) for x in rides], days)
        report['sets'][s] = dict(days=days, pbo_win=p_win, pbo_ret=p_ret, splits=ns, family=len(fam), pairs=pairs, runner=runner, models={k: {kk: vv for kk, vv in v.items() if kk != 'calls'} for k, v in res.items()})
        with open(os.path.join(R.DATA, f'calls-{s}.json'), 'w') as f:
            json.dump({k: v['calls'] for k, v in res.items()}, f, default=float)
        lines_md.append(f'\n### {s.upper()}: {len(days)} sessions ({", ".join(sorted({block(d) for d in days}))})\n')
        lines_md.append('| model | line / runner line | calls | win [95% session bootstrap] | Wilson | return/call [95%] | DSR (SR vs SR0) |')
        lines_md.append('|---|---|---:|---|---|---|---|')
        for name, v in res.items():
            st = v['all']
            dsr = v['dsr']
            lines_md.append(f"| {name} | {v['line']:.4f} / {v['rline']:.4f} | {st['n']} | {pct(st['win'])} [{pct(st['win_lo'])}, {pct(st['win_hi'])}] | [{pct(st['wilson'][0])}, {pct(st['wilson'][1])}] | {spct(st['ret'])} [{spct(st['ret_lo'])}, {spct(st['ret_hi'])}] | {dsr[0]:.2f} ({dsr[1]:.2f} vs {dsr[2]:.2f}) |")
        lines_md.append('\n| paired, same sessions | win difference [95%] | return/call difference [95%] |')
        lines_md.append('|---|---|---|')
        for k, v in pairs.items():
            lines_md.append(f"| {k} | {spct(v['win'], 0)} [{spct(v['win_lo'], 0)}, {spct(v['win_hi'], 0)}] | {spct(v['ret'])} [{spct(v['ret_lo'])}, {spct(v['ret_hi'])}] |")
        lines_md.append(f"| Model 2 alone: {new} calls, its Runner score rides minus the current Runner score rides | — | {spct(runner['ret'])} [{spct(runner['ret_lo'])}, {spct(runner['ret_hi'])}] |")
        lines_md.append(f'\nPBO over the family ({len(fam)} configurations, CSCV 16 blocks, {ns} splits): win rate {p_win:.2f}, return per call {p_ret:.2f}.\n')
        lines_md.append('| model | block | calls | win [95%] | return/call [95%] |')
        lines_md.append('|---|---|---:|---|---|')
        for name, v in res.items():
            for b, st in v['blocks'].items():
                lines_md.append(f"| {name} | {b} | {st['n']} | {pct(st['win'])} [{pct(st['win_lo'])}, {pct(st['win_hi'])}] | {spct(st['ret'])} [{spct(st['ret_lo'])}, {spct(st['ret_hi'])}] |")
        lines_md.append('\n| model | regular | overnight | pre-market | curb | half-day | 0DTE | 1–7 DTE | Book B | rode |')
        lines_md.append('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
        for name, v in res.items():
            b = v['behaviour']
            lines_md.append(f"| {name} | {b['regular']} | {b['overnight']} | {b['pre']} | {b['curb']} | {b['half_day']} | {b['odte']} | {b['weekly']} | {b['book_b']} | {b['ride']} |")
    text = '\n'.join(lines_md)
    print(text)
    with open(os.path.join(R.DATA, 'holdout.md'), 'w') as f:
        f.write(text)
    with open(os.path.join(R.DATA, 'holdout.json'), 'w') as f:
        json.dump(report, f, indent=1, default=float)


if __name__ == '__main__':
    main()
