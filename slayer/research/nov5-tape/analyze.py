"""NOV5 statistics per registered variant (PREREG.md): n, skips, win rate, average win / loss, expectancy net (session-
clustered 95% CI), gross, median, $ per $ risked, by year and side; side-shuffle percentile; synthetic-null percentile
and FDR; PBO (CSCV over the 16 variants' per-session means); deflated Sharpe at the ledger's trial count.

  python3 analyze.py study 20261104      one study day (every variant, real side and the opposite side)
  python3 analyze.py dev                 DEV -> results/DEV.md
"""
import glob, json, math, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2'))
from eval.metrics import cluster_ci_mean, deflated_sharpe, pbo_cscv, ledger_trials  # noqa: E402
import runner as RN  # noqa: E402
import load  # noqa: E402

RES = os.path.join(HERE, 'results')
LEDGER = os.path.join(HERE, '..', '..', '..', 'research-v2-ledger.md')
EDGE_G_TRIALS = 21   # EDGE-G's registered variants live on another branch's ledger copy; counted here as well


def load_rows(tag):
    rows = []
    for f in sorted(glob.glob(os.path.join(RN.RESD, tag, '*.json'))):
        rows += json.load(open(f))
    return pd.DataFrame(rows)


def stats(df, sessions):
    t = df[df.ret_net.notna()] if 'ret_net' in df else df.iloc[0:0]
    n = len(t)
    if not n:
        return {'n': 0, 'skips': int(len(df))}
    r = t.ret_net.values
    lo, hi = cluster_ci_mean(r, t.day.values, extra_clusters=())
    w = r[r > 0]; l = r[r <= 0]
    sd = r.std(ddof=1) if n > 1 else np.nan
    return {'n': n, 'skips': int(len(df) - n), 'sessions': int(t.day.nunique()), 'win': float((r > 0).mean()),
            'avg_win': float(w.mean()) if len(w) else np.nan, 'avg_loss': float(l.mean()) if len(l) else np.nan,
            'exp': float(r.mean()), 'lo': lo, 'hi': hi, 'gross': float(t.ret_gross.mean()), 'median': float(np.median(r)),
            'usd_per_usd': float(t.pnl_net.sum() / t.cost.sum()), 'pnl': float(t.pnl_net.sum()), 'sr': float(r.mean() / sd) if sd > 0 else np.nan}


def side_shuffle(real, flip, n=2000, seed=11):
    """Percentile of the real mean among coin-flip side assignments (same triggers, same exit, both sides real)."""
    key = ['day', 'rule', 't', 'cell', 'exit_rule']
    a = real[real.ret_net.notna()][key + ['ret_net']]
    b = flip[flip.ret_net.notna()][key + ['ret_net']]
    m = a.merge(b, on=key, suffixes=('_r', '_f'))
    if len(m) < 5:
        return np.nan, len(m)
    rng = np.random.default_rng(seed)
    coin = rng.integers(0, 2, (n, len(m))).astype(bool)
    sims = np.where(coin, m.ret_net_r.values, m.ret_net_f.values).mean(1)
    return float((m.ret_net_r.mean() > sims).mean()), len(m)


def fmt(v, p=1, pct=True):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return '-'
    return f'{100 * v:+.{p}f}%' if pct else f'{v:.{p}f}'


def table(df, flip=None, syn=None, sessions=None, n_trials=None):
    L = ['| variant | n (skips) | sessions | win | avg win | avg loss | expectancy net [95% CI] | gross | median | $/$ | side-shuffle beats | synthetic beats / FDR | DSR |',
         '|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|']
    out = {}
    for v in RN.variants():
        x = df[df.variant == v]
        s = stats(x, sessions)
        out[v] = s
        if not s['n']:
            L.append(f"| {v} | 0 ({s['skips']}) | | | | | | | | | | | |")
            continue
        sh = '-'
        if flip is not None and len(flip):
            p, m = side_shuffle(x, flip[flip.variant == v])
            sh = f'{100 * p:.0f}% (n {m})' if np.isfinite(p) else '-'
        sy = '-'
        if syn is not None and v in syn:
            sy = f"{100 * (s['exp'] > np.array(syn[v]['means'])).mean():.0f}% / {100 * syn[v]['fdr']:.0f}%"
        ds = '-'
        if n_trials and s['n'] >= 3 and np.isfinite(s['sr']):
            ds = f"{deflated_sharpe(s['sr'], s['n'], n_trials)['dsr']:.2f}"
        L.append(f"| {v} | {s['n']} ({s['skips']}) | {s['sessions']} | {100 * s['win']:.0f}% | {fmt(s['avg_win'])} | {fmt(s['avg_loss'])} | "
                 f"{fmt(s['exp'])} [{fmt(s['lo'])}, {fmt(s['hi'])}] | {fmt(s['gross'])} | {fmt(s['median'])} | {fmt(s['usd_per_usd'])} | {sh} | {sy} | {ds} |")
    return '\n'.join(L), out


def study(D):
    df = pd.DataFrame(json.load(open(os.path.join(RN.RESD, 'study', f'{D}.json'))))
    L = [f'# NOV5 rules on {D[:4]}-{D[4:6]}-{D[6:]}\n']
    if not len(df):
        d = RN.study_day(D)
        L.append('**No registered rule triggered on this day: 0 trades in all 16 variants.**\n')
        L.append('Why (the rules\' preconditions, read every 30 minutes from the same point-in-time book):\n')
        L.append('| time | SPX | 0DTE ATM IV | book net (house; > 0 = dealers short) | wall below | wall above | ln(S/open) / (EM_30/S) |')
        L.append('|---|---:|---:|---:|---:|---:|---:|')
        for t in range(10 * 3600, 14 * 3600 + 31 * 60, 1800):
            r, S = d.bk(t), d.S(t)
            if r is None:
                continue
            L.append(f'| {load.clock(t)} | {S:.1f} | {r.atm:.3f} | {r.net_all:+.2e} | {r.wall_dn:.0f} | {r.wall_up:.0f} | '
                     f'{math.log(S / d.open) / (RN.RU.em(S, r.atm, 30) / S):+.2f} |')
        txt = '\n'.join(L) + '\n'
        open(os.path.join(RES, f'RULES_{D}.md'), 'w').write(txt)
        return txt
    real, flip = df[df.sideset == 'real'], df[df.sideset == 'flip']
    src = real.src.value_counts().to_dict() if 'src' in real else {}
    L.append(f'Path sources: {src} (board1m = 1-minute board held for the minute; otherwise 1-second NBBO).\n')
    L.append('## Every trade (real side)\n')
    L.append('| variant | trigger | side | SPX | contract | delta | fill (ask) | exit (bid) | exit reason | entry | exit | net | $ |')
    L.append('|---|---|---|---:|---|---:|---:|---:|---|---|---|---:|---:|')
    for _, x in real.iterrows():
        if pd.isna(x.get('ret_net')):
            L.append(f"| {x.variant} | {load.clock(x.t)} | {'call' if x.ev_side > 0 else 'put'} | {x.S:.1f} | {x.get('k', np.nan):g}{'C' if x.get('call') else 'P'} | | | | skip: {x.get('skip')} | | | | |")
            continue
        L.append(f"| {x.variant} | {load.clock(x.t)} | {'call' if x.ev_side > 0 else 'put'} | {x.S:.1f} | {x.k:g}{'C' if x.call else 'P'} | {x.delta:.2f} | "
                 f"{x.fill:.2f} | {x.exit:.2f} | {x.reason} | {load.clock(x.entry_s)} | {load.clock(x.exit_s)} | {fmt(x.ret_net)} | {x.pnl_net:,.0f} |")
    L.append('\n## Opposite side at the same triggers (what the coin would have done)\n')
    L.append('| variant | trigger | contract | fill | exit | reason | net |')
    L.append('|---|---|---|---:|---:|---|---:|')
    for _, x in flip.iterrows():
        if pd.isna(x.get('ret_net')):
            continue
        L.append(f"| {x.variant} | {load.clock(x.t)} | {x.k:g}{'C' if x.call else 'P'} | {x.fill:.2f} | {x.exit:.2f} | {x.reason} | {fmt(x.ret_net)} |")
    tb, _ = table(real, flip)
    L.append('\n## Per variant\n')
    L.append(tb)
    txt = '\n'.join(L) + '\n'
    open(os.path.join(RES, f'RULES_{D}.md'), 'w').write(txt)
    return txt


def dev():
    real = load_rows('dev')
    flip = load_rows('dev_flip')
    flip = flip[flip.sideset == 'flip'] if len(flip) else flip
    synf = os.path.join(RN.OUT, 'syn', 'summary.json')
    syn = json.load(open(synf)) if os.path.exists(synf) else None
    n_trials = ledger_trials(LEDGER) + EDGE_G_TRIALS
    days = sorted(real.day.unique())
    tb, st = table(real, flip, syn, days, n_trials)
    # PBO over the variants' per-session mean net return (sessions without a trade of a variant = 0)
    M = np.zeros((len(days), len(RN.variants())))
    di = {d: i for i, d in enumerate(days)}
    for j, v in enumerate(RN.variants()):
        x = real[(real.variant == v) & real.ret_net.notna()]
        g = x.groupby('day').ret_net.mean()
        for d, val in g.items():
            M[di[d], j] = val
    pb = pbo_cscv(M, 16)
    L = ['# NOV5 rules on DEV (sessions before 2025, 1-second NBBO, ask in / bid out +2 s, $0.65/side)\n',
         f'Sessions with a result file: {len(days)} (first {days[0]}, last {days[-1]}). Trial count for DSR: {n_trials} '
         f'(ledger) . PBO (CSCV, 16 blocks, {len(RN.variants())} variants): {pb["pbo"]:.2f}.\n', tb]
    # by year and side for each variant with n >= 30
    L.append('\n## By year and side (net expectancy, n)\n')
    real = real.assign(year=real.day.str[:4], side=np.where(real.ev_side > 0, 'call', 'put'))
    yrs = sorted(real.year.unique())
    L.append('| variant | ' + ' | '.join(yrs) + ' | calls | puts |')
    L.append('|---|' + '---:|' * (len(yrs) + 2))
    for v in RN.variants():
        x = real[(real.variant == v) & real.ret_net.notna()]
        if len(x) < 10:
            continue
        cells = [f"{100 * x[x.year == y].ret_net.mean():+.1f}% ({(x.year == y).sum()})" if (x.year == y).any() else '-' for y in yrs]
        cells += [f"{100 * x[x.side == s].ret_net.mean():+.1f}% ({(x.side == s).sum()})" if (x.side == s).any() else '-' for s in ('call', 'put')]
        L.append(f'| {v} | ' + ' | '.join(cells) + ' |')
    L.append('\n## Skip reasons\n')
    sk = real[real.ret_net.isna()].groupby(['variant', 'skip']).size().unstack(fill_value=0) if 'skip' in real else None
    if sk is not None and len(sk):
        L.append('| variant | ' + ' | '.join(sk.columns) + ' |')
        L.append('|---|' + '---:|' * len(sk.columns))
        for v, row in sk.iterrows():
            L.append(f'| {v} | ' + ' | '.join(str(int(x)) for x in row.values) + ' |')
    txt = '\n'.join(L) + '\n'
    open(os.path.join(RES, 'DEV.md'), 'w').write(txt)
    json.dump({'stats': st, 'pbo': pb, 'n_trials': n_trials}, open(os.path.join(RES, 'dev_summary.json'), 'w'), default=float, indent=1)
    return txt


if __name__ == '__main__':
    if sys.argv[1] == 'study':
        print(study(sys.argv[2]))
    else:
        print(dev())
