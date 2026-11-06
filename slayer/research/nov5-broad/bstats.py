"""NOV6 statistics (PREREG.md): per variant n, skips, win, average win / loss, net expectancy with a session-clustered
95% CI, gross, median, $ per $ risked; by root, year group, day type, expiry distance; side-shuffle percentile; the R3
random-day reference; synthetic-null percentile and FDR (bnullsyn.py output); PBO (CSCV) over the DEV variants;
deflated Sharpe at the ledger's trial count.

  python3 bstats.py dev    -> results/DEV.md
"""
import glob, json, math, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2'))
from eval.metrics import cluster_ci_mean, deflated_sharpe, pbo_cscv, ledger_trials  # noqa: E402
import bload as B  # noqa: E402
from mdt import md  # noqa: E402

RES = os.path.join(B.OUT, 'res')
DEV_VARIANTS = ['R1-XB-L', 'R1-XB-S', 'R1-XR-L', 'R1-XR-S', 'R2-XB-L', 'R2-XB-S', 'R2-XR-L', 'R2-XR-S',
                'R3-XP-L', 'R3-XP-S', 'R4-XB-L', 'R4-XB-S']
NOV6_TRIALS = 14


def load_rows(tag):
    rows = []
    for f in sorted(glob.glob(os.path.join(RES, tag, '*.json'))):
        rows += json.load(open(f))
    df = pd.DataFrame(rows)
    if len(df):
        df['sess'] = df.root + '_' + df.day
    return df


def stats(df):
    t = df[df.ret_net.notna()] if 'ret_net' in df else df.iloc[0:0]
    n = len(t)
    if not n:
        return {'n': 0, 'skips': int(len(df))}
    r = t.ret_net.values.astype(float)
    lo, hi = cluster_ci_mean(r, t.day.values)
    w, l = r[r > 0], r[r <= 0]
    sd = r.std(ddof=1) if n > 1 else np.nan
    return {'n': n, 'skips': int(len(df) - n), 'sessions': int(t.day.nunique()), 'win': float((r > 0).mean()),
            'avg_win': float(w.mean()) if len(w) else np.nan, 'avg_loss': float(l.mean()) if len(l) else np.nan,
            'exp': float(r.mean()), 'lo': lo, 'hi': hi, 'gross': float(t.ret_gross.mean()), 'median': float(np.median(r)),
            'usd_per_usd': float(t.pnl_net.sum() / t.cost.sum()), 'pnl': float(t.pnl_net.sum()),
            'sr': float(r.mean() / sd) if sd and sd > 0 else np.nan}


def side_shuffle(real, flip, n=2000, seed=11):
    key = ['root', 'day', 'rule', 't', 'exit_rule', 'expr']
    a = real[real.ret_net.notna()][key + ['ret_net']]
    b = flip[flip.ret_net.notna()][key + ['ret_net']]
    m = a.merge(b, on=key, suffixes=('_r', '_f'))
    if len(m) < 5:
        return np.nan, len(m), np.nan
    rng = np.random.default_rng(seed)
    coin = rng.integers(0, 2, (n, len(m))).astype(bool)
    sims = np.where(coin, m.ret_net_r.values, m.ret_net_f.values).mean(1)
    return float((m.ret_net_r.mean() > sims).mean()), len(m), float(m.ret_net_f.mean())


def f(v, pct=True, p=1):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return '-'
    return f'{100 * v:+.{p}f}%' if pct else f'{v:.{p}f}'


def year_group(day):
    y = day[:4]
    return '2020-21' if y in ('2020', '2021') else y


_DT = {}


def day_type(root, day):
    k = (root, day)
    if k not in _DT:
        sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2', 'edge'))
        import sim as esim
        b = esim.day_bars(root, day)
        b = b[(b.m >= 575) & (b.m <= 955)]
        if len(b) < 100:
            _DT[k] = '?'
        else:
            lr = np.diff(np.log(b.c.values))
            rv = lr.std(ddof=1) * math.sqrt(390 * 252)
            o, c, hi, lo = b.o.iloc[0], b.c.iloc[-1], b.h.max(), b.l.min()
            mv = c / o - 1
            pos = (c - lo) / (hi - lo) if hi > lo else 0.5
            if rv >= 0.25:
                _DT[k] = 'high_vol'
            elif abs(mv) >= 0.006 and ((mv > 0 and pos >= 0.75) or (mv < 0 and pos <= 0.25)):
                _DT[k] = 'trend'
            else:
                _DT[k] = 'flat'
    return _DT[k]


def syn_summary():
    f_ = os.path.join(B.OUT, 'syn', 'summary.json')
    return json.load(open(f_)) if os.path.exists(f_) else {}


def dev_report():
    real, flip = load_rows('dev'), load_rows('dev_flip')
    ref = load_rows('dev_r3ref')
    n_sess = len(glob.glob(os.path.join(RES, 'dev', '*.json')))
    trials = ledger_trials()
    syn = syn_summary()
    L = ['# NOV6 rules on DEV (sessions before 2025; SPXW/SPY/QQQ/IWM; 1-second NBBO, ask in / bid out +2 s, '
         '$0.65 per contract per side per leg)\n',
         f'Root-sessions run: {n_sess}; DEV days with at least one trigger: {real.day.nunique() if len(real) else 0}. '
         f'Ledger trials for DSR: {trials}. L = long 0.30-delta (R3: ATM straddle); S = debit spread (R3: reverse iron fly).\n']
    rows, M = [], {}
    sess_all = sorted(set(real.sess)) if len(real) else []
    for v in DEV_VARIANTS:
        x = real[real.variant == v] if len(real) else real
        s = stats(x)
        shuf = side_shuffle(x, flip[flip.variant == v]) if len(flip) and not v.startswith('R3') else (np.nan, 0, np.nan)
        if v == 'R3-XP-L' and len(ref):
            rr = ref[ref.ret_net.notna()].ret_net.values
            if len(rr) and s.get('n', 0):
                rng = np.random.default_rng(13)
                sims = rng.choice(rr, (2000, s['n'])).mean(1)
                shuf = (float((s['exp'] > sims).mean()), len(rr), float(rr.mean()))
        sy = syn.get(v, {})
        dsr = deflated_sharpe(s['sr'], s['n'], trials)['dsr'] if s.get('n', 0) > 2 and np.isfinite(s.get('sr', np.nan)) else np.nan
        rows.append({'variant': v, 'n (skips)': f"{s.get('n', 0)} ({s.get('skips', 0)})", 'sessions': s.get('sessions', 0),
                     'win': f(s.get('win'), p=0) if s.get('n') else '-', 'avg win': f(s.get('avg_win')),
                     'avg loss': f(s.get('avg_loss')),
                     'expectancy net [95% CI]': f"{f(s.get('exp'))} [{f(s.get('lo'))}, {f(s.get('hi'))}]" if s.get('n') else '-',
                     'gross': f(s.get('gross')), 'median': f(s.get('median')), '$/$': f(s.get('usd_per_usd')),
                     'shuffle / ref beats': f'{100 * shuf[0]:.0f}% (n {shuf[1]}, other {f(shuf[2])})' if np.isfinite(shuf[0]) else '-',
                     'synthetic beats / FDR': f"{sy.get('beats', float('nan')) * 100:.0f}% / {sy.get('fdr', float('nan')) * 100:.0f}%" if sy else '-',
                     'DSR': f'{dsr:.2f}' if np.isfinite(dsr) else '-'})
        if s.get('n'):
            ps = x[x.ret_net.notna()].groupby('sess').ret_net.mean()
            M[v] = ps
    L.append(md(pd.DataFrame(rows)))
    if len(M) >= 2:
        allsess = sorted(set().union(*[set(m.index) for m in M.values()]))
        mat = np.column_stack([M[v].reindex(allsess).fillna(0).values for v in M])
        order = np.argsort([s.split('_')[1] for s in allsess])
        pbo = pbo_cscv(mat[order], 16)
        L.append(f"\nPBO (CSCV, 16 blocks, {mat.shape[1]} variants, per root-session means, zero when no trade): "
                 f"**{pbo['pbo']:.2f}**\n")
    # breakdowns
    if len(real):
        t = real[real.ret_net.notna()].copy()
        t['yg'] = [year_group(d) for d in t.day]
        t['dtype'] = [day_type(r, d) for r, d in zip(t.root, t.day)]
        t['xd'] = np.where(t.x == 0, 'same-day', 'later expiry')
        for col, title in (('yg', 'year'), ('root', 'root'), ('dtype', 'day type'), ('xd', 'expiry')):
            g = t.groupby(['variant', col]).ret_net.agg(['mean', 'size']).reset_index()
            p = g.assign(c=[f"{f(m)} ({n})" for m, n in zip(g['mean'], g['size'])]).pivot(index='variant', columns=col, values='c')
            L.append(f'\n## By {title} (net expectancy, n)\n')
            L.append(md(p.reset_index().fillna('')))
        sk = real[real.ret_net.isna()]
        if len(sk) and 'skip' in sk:
            g = sk.groupby(['variant', 'skip']).size().reset_index(name='n')
            L.append('\n## Skips\n')
            L.append(md(g))
    if syn.get('_martingale'):
        L.append('\n## Synthetic generator check (variance clock): mean 30-minute mid-to-mid return of 0.30-delta options\n')
        L.append(md(pd.DataFrame(syn['_martingale'])))
    txt = '\n'.join(L) + '\n'
    open(os.path.join(HERE, 'results', 'DEV.md'), 'w').write(txt)
    print(txt)


if __name__ == '__main__':
    if sys.argv[1] == 'dev':
        dev_report()
