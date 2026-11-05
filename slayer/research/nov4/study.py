"""
Nov 4 research: the "amazing trades" (contract-marks that ran >= 1.5x / 2x / 5x from an enterable ask), their
pre-entry signature against Compass's calls and against every enterable contract-mark, and the out-of-sample test
of the detection rules.

  python3 -I research/nov4/study.py describe 2026-11-04            counts and signature of one day
  python3 -I research/nov4/study.py auc 2026-11-04 2026-11-03 ...   per-feature AUC (win vs all) on the dev days
  python3 -I research/nov4/study.py test                            the frozen rules on dev and on the holdout

Development (rule choice): DEV. Holdout (scored once the rules were frozen): HOLD.
"""
import json, os, sys
import numpy as np
import pandas as pd

DATA = os.environ.get('NOV4_DATA', '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad/nov4data')
HERE = os.path.dirname(os.path.abspath(__file__))
DEV = ['2026-11-04', '2026-11-03', '2026-11-02']
HOLD = ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
        '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']

FEATS = ['m', 'dte', 'absdelta', 'spread', 'ask', 'iv_rel', 'rv_iv', 'dist_strikes', 'otm_em', 'prem_em',
         's_r5', 's_r15', 's_r30', 's_open', 's_gap', 's_vwap', 's_rangepos', 'u_range',
         'c_volrate', 'c_prem15', 'c_aggr15', 'c_volu_oi', 'oi_chg', 'c_mid15', 'ch_flow', 'ch_burst', 'gex_sign', 'flip', 'flip_abs']


def load(days):
    out = []
    for d in days:
        f = os.path.join(DATA, f'rows_{d}.parquet')
        if os.path.exists(f):
            out.append(pd.read_parquet(f))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def clock(m):
    m = int(m) + 570
    return f'{m // 60:02d}:{m % 60:02d}'


def tod(m):
    return '09:35-10:30' if m <= 60 else '10:35-12:00' if m <= 150 else '12:05-14:00' if m <= 270 else '14:05-15:00'


def dbucket(d):
    if not np.isfinite(d):
        return 'n/a'
    return '<0.10' if d < 0.10 else '0.10-0.25' if d < 0.25 else '0.25-0.40' if d < 0.40 else '0.40-0.60' if d < 0.60 else '>=0.60'


def move_type(r):
    """What the underlying had been doing before the entry (signed for the contract's side), no look-ahead."""
    x = r.s_r15 if np.isfinite(r.s_r15) else r.s_open  # the last 15 minutes (since the open before 09:45)
    if not np.isfinite(x):
        return 'n/a'
    if x > 0.0015:
        return 'continuation (underlying already moving its way)'
    if x < -0.0015:
        return 'reversal (underlying moving against it)'
    return 'from flat (|move| < 0.15%)'


def amazing(df):
    """One row per contract: its first enterable mark from which it ran >= 1.5x (and the best multiple from any mark)."""
    df = df.copy()
    df['cid'] = df.root + ' ' + df.exp + ' ' + df.strike.astype(str) + df.right
    best = df.groupby('cid').ran.max().rename('best_ran')
    first = df[df.ran >= 1.5].sort_values('m').groupby('cid').head(1).set_index('cid')
    first = first.join(best)
    return first


def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (c - h, c + h)


def boot_mean(x, cluster, B=4000, seed=7):
    """95% interval of the mean, resampling whole sessions."""
    rng = np.random.default_rng(seed)
    x = np.asarray(x, float)
    cl = np.asarray(cluster)
    keys = np.unique(cl)
    groups = [x[cl == k] for k in keys]
    if len(keys) < 2:
        return (np.nan, np.nan)
    ms = []
    for _ in range(B):
        pick = rng.integers(0, len(keys), len(keys))
        v = np.concatenate([groups[i] for i in pick])
        ms.append(v.mean())
    return tuple(np.percentile(ms, [2.5, 97.5]))


def auc(y, s):
    ok = np.isfinite(s)
    y, s = np.asarray(y)[ok], np.asarray(s)[ok]
    n1, n0 = y.sum(), (1 - y).sum()
    if n1 == 0 or n0 == 0:
        return np.nan
    r = pd.Series(s).rank().values
    return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)


def summarize(calls, label):
    n = len(calls)
    if n == 0:
        return f'{label}: n=0'
    k = int(calls.win.sum())
    lo, hi = wilson(k, n)
    blo, bhi = boot_mean(calls.ret.values, calls.day.values)
    return (f'{label}: n={n} sessions={calls.day.nunique()} win={k / n:.0%} [{lo:.0%},{hi:.0%}] '
            f'ret/call={calls.ret.mean():+.1%} [{blo:+.1%},{bhi:+.1%}]')



# ---- the detection rules (frozen before the holdout was scored; see LOG.md for the test count) ----
def _band(df, lo=0.20, hi=0.45):
    return (df.absdelta >= lo) & (df.absdelta <= hi)


RULES = {
    # FROZEN 2026-11-05 ~04:40 UTC after variants.py, before any holdout row was built.
    # R1: the chain's aggressive premium (prints above the mid minus prints below, last 15 min) leans the contract's way
    'R1 flow-aligned 0DTE': dict(mask=lambda d: (d.sleeve == 'odte') & _band(d) & (d.ch_flow >= 0.10) & (d.c_aggr15 > 0) & (d.c_volrate >= 1) & d.m.between(15, 240), target=0.30),
    # R2: the underlying is realising more than the options imply, early, weekly contracts on the flow's side
    'R2 hot-tape weekly': dict(mask=lambda d: (d.sleeve == 'weekly') & _band(d) & (d.rv_iv >= 1.2) & (d.ch_flow >= 0.10) & d.m.between(15, 90), target=0.30),
    # R3: the nearest gamma flip of the expiry's open interest lies on the contract's side, and the flow agrees
    'R3 gamma-flip side 0DTE': dict(mask=lambda d: (d.sleeve == 'odte') & _band(d) & (d.flip > 0) & (d.ch_flow > 0) & d.m.between(15, 240), target=0.30),
    # R4: the opening fade: the underlying ran >= 0.5% against the contract since the open and the last 5 min turned back
    'R4 opening reversal 0DTE': dict(mask=lambda d: (d.sleeve == 'odte') & _band(d) & (d.s_open <= -0.005) & (d.s_r5 > 0) & (d.ch_flow > 0) & d.m.between(15, 60), target=0.30),
}


def calls_of(df, rule):
    """One call a root and sleeve a session: the first mark the rule fires, the contract nearest the target delta."""
    hit = df[rule['mask'](df)].copy()
    if hit.empty:
        return hit
    hit['dd'] = (hit.absdelta - rule['target']).abs()
    hit = hit.sort_values(['day', 'root', 'sleeve', 'm', 'dd'])
    return hit.groupby(['day', 'root', 'sleeve']).head(1)


if __name__ == '__main__':
    cmd = sys.argv[1]
    days = [a for a in sys.argv[2:] if len(a) == 10]
    if cmd == 'describe':
        df = load(days)
        df['cid'] = df.root + ' ' + df.exp + ' ' + df.strike.astype(str) + df.right
        print('enterable contract-marks', len(df), 'contracts', df.cid.nunique(), 'base win rate', f'{df.win.mean():.1%}', 'mean ret', f'{df.ret.mean():+.1%}')
        A = amazing(df)
        for x in (1.5, 2, 5):
            print(f'contracts that ran >= {x}x from some enterable ask: {int((A.best_ran >= x).sum())}  '
                  f'(contract-marks {int((df.ran >= x).sum())}); reached 1.5x before the stop (win) from some mark: {df[df.win == 1].cid.nunique()}')
        A['dband'] = A.absdelta.map(dbucket)
        A['tod'] = A.m.map(tod)
        A['move'] = [move_type(r) for r in A.itertuples()]
        A['tier'] = np.where(A.best_ran >= 5, '>=5x', np.where(A.best_ran >= 2, '2-5x', '1.5-2x'))
        for col in ('root', 'dte', 'dband', 'tod', 'move', 'right'):
            print(f'\nby {col}:')
            print(pd.crosstab(A[col], A.tier, margins=True).to_string())
    elif cmd == 'auc':
        df = load(days)
        print(f'{"feature":14s} AUC(win)  AUC(ran>=2)  median win  median all')
        for f in FEATS:
            print(f'{f:14s} {auc(df.win.values, df[f].values):.3f}    {auc((df.ran >= 2).astype(int).values, df[f].values):.3f}     '
                  f'{df[df.win == 1][f].median():+.4g}   {df[f].median():+.4g}')
    elif cmd == 'rules':
        df = load(days)
        base = df[_band(df) & df.m.between(15, 240)]
        for sl in ('odte', 'weekly'):
            b = base[base.sleeve == sl]
            print(summarize(b, f'baseline every enterable {sl} 0.20-0.45 delta contract-mark'))
            # random enterable contracts, one a root a session (as the rules call), 300 draws
            wins, rets = [], []
            for k in range(300):
                pick = b.sample(frac=1, random_state=k).groupby(['day', 'root']).head(1)
                wins.append(pick.win.mean()); rets.append(pick.ret.mean())
            print(f'   random one-a-root draw ({sl}): n~{len(pick)} win={np.mean(wins):.0%} (draws 2.5-97.5%: {np.percentile(wins, 2.5):.0%}-{np.percentile(wins, 97.5):.0%}) ret={np.mean(rets):+.1%}')
        for name, rule in RULES.items():
            c = calls_of(df, rule)
            print(summarize(c, name))
            if len(c):
                print('   by day:', ' '.join(f'{d[5:]}:{g.win.mean():.0%}/{len(g)}' for d, g in c.groupby('day')))
