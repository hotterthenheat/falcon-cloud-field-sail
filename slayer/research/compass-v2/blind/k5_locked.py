"""BLIND SCORER — K5 (frozen spec c45a7d2:slayer/research/compass-v2/edge/specs/K5.spec.md) on the LOCKED TEST, once.

Locked test (V2_PROTOCOL item 6): H1 (Jun 2022, Aug 2024, 2026-10-05..30) ∪ H2 (2022-07-01..09-30, 2025-01-02..03-31)
∪ every built session from 2026-07-01. Rows: the challenger's built sessions (read-only, cache=False), SPXW overnight.

The rule and exit are the spec's, literally: the candidate function is imported unchanged from the challenger's
candidates.py (k5_overnight_spx_hard); the exit is the frozen hard-stop rule on the one-minute path (hit50 /
worstPre / flatBid) exactly as chal.Sessions (vendored from commit c45a7d2 as chal_c45a7d2.py) computes it.
Fees: $0.65/contract/side, as the spec's scorer (k5_h2.py at c45a7d2) applies them.

    BLIND_SCORER=1 python3 k5_locked.py            # refuses if results/K5-LOCKED.json exists (one look)
"""
import json, os, sys, hashlib
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import chal_c45a7d2 as chal          # vendored verbatim from c45a7d2:slayer/research/compass-v2/edge/chal.py
import candidates as K               # the challenger's frozen file (chal put its dir on sys.path)
C = chal.C
B = chal.B

FOUNDATION = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2'
sys.path.insert(0, FOUNDATION)
from eval.metrics import basic, cluster_ci_mean, max_drawdown  # noqa: E402  (the foundation's eval code)

OUT = os.path.join(HERE, 'results')
FEE = 0.65 * 2  # $ per contract round trip


def is_locked(d):
    return B.is_holdout(d) or B.is_holdout2(d) or d >= '2026-07-01'


def block(d):
    if d.startswith('2022-06'):
        return 'H1-2022-06'
    if '2022-07-01' <= d <= '2022-09-30':
        return 'H2-2022Q3'
    if d.startswith('2024-08'):
        return 'H1-2024-08'
    if '2025-01-02' <= d <= '2025-03-31':
        return 'H2-2025Q1'
    if '2026-10-05' <= d <= '2026-10-30':
        return 'H1-2026-10'
    return '2026-07-01..10-02'


def regime(d):
    if d < '2023':
        return '2022'
    if d < '2025':
        return '2024'
    if d < '2026':
        return '2025-Q1'
    return '2026-H2'


def calls_table(S):
    """Identical to k5_h2.calls_table at c45a7d2."""
    idx, ex = K.k5_overnight_spx_hard(S, np.ones(len(S.df), bool))
    rows = []
    for i in idx:
        f = S.fill[i]
        if not (f > 0) or not np.isfinite(S.pnl_hard[i]):
            continue
        r = S.pnl_hard[i] / (f * 100)
        rows.append({'day': str(S.df.at[i, 'day']), 'contract': str(S.df.at[i, 'contract']), 'mark': str(S.df.at[i, 'mark']),
                     'delta': float(S.df.at[i, 'c14']), 'fill': float(f), 'win': bool(S.win_hard[i]), 'ret': float(r),
                     'ret_fee': float((S.pnl_hard[i] - FEE) / (f * 100 + 0.65)), 'usd': float(S.pnl_hard[i]),
                     'usd_fee': float(S.pnl_hard[i] - FEE), 'hit50': int(S.df.at[i, 'hit50']),
                     'worstPre': float(S.df.at[i, 'worstPre']), 'flatBid': float(S.df.at[i, 'flatBid'])})
    return rows


def summarize(rows, days, label):
    out = {'label': label, 'sessions': len(days), 'n': len(rows)}
    if not rows:
        return out
    t = pd.DataFrame(rows).sort_values(['day', 'mark']).reset_index(drop=True)
    ses = t['day'].astype(str).to_numpy()
    for key, name in (('ret', 'no_fee'), ('ret_fee', 'fee')):
        r = t[key].to_numpy(float)
        b = basic(r)
        lo, hi = cluster_ci_mean(r, ses, 4000, seed=7, extra_clusters=days)
        wlo, whi = cluster_ci_mean(t['win'].astype(float).to_numpy(), ses, 4000, seed=7, extra_clusters=days)
        out[name] = {'expectancy': b['expectancy'], 'ci_expectancy': [lo, hi],
                     'win_rate': float(t['win'].mean()), 'ci_win_rate': [wlo, whi],
                     'win_rate_ret_gt0': b['win_rate'],
                     'avg_win': float(r[t['win']].mean()) if t['win'].any() else float('nan'),
                     'avg_loss': float(r[~t['win']].mean()) if (~t['win']).any() else float('nan'),
                     'payoff': b['payoff'], 'median': b['median'], 'sd': b['sd'], 'sharpe_trade': b['sharpe_trade'],
                     'max_dd_ret_units': max_drawdown(r),
                     'usd_per_contract': float(t['usd' if key == 'ret' else 'usd_fee'].mean()),
                     'max_dd_usd_per_contract': max_drawdown(t['usd' if key == 'ret' else 'usd_fee'].to_numpy(float))}
    out['wins'] = int(t['win'].sum())
    out['stops'] = int(((~t['win']) & (t['worstPre'] <= 1 - 0.5322)).sum())
    out['flats'] = int(((~t['win']) & (t['worstPre'] > 1 - 0.5322)).sum())
    return out


def fmt(s):
    if not s.get('n'):
        return f"{s['label']}: {s['sessions']} sessions, 0 calls"
    a, f = s['no_fee'], s['fee']
    return (f"{s['label']}: {s['sessions']} sessions, n={s['n']} (wins {s['wins']}, stops {s['stops']}, flats {s['flats']})\n"
            f"  win rate {100*a['win_rate']:.1f}% [{100*a['ci_win_rate'][0]:.1f}, {100*a['ci_win_rate'][1]:.1f}]\n"
            f"  expectancy/trade no fee {100*a['expectancy']:+.1f}% [{100*a['ci_expectancy'][0]:+.1f}, {100*a['ci_expectancy'][1]:+.1f}]"
            f"  | fee {100*f['expectancy']:+.1f}% [{100*f['ci_expectancy'][0]:+.1f}, {100*f['ci_expectancy'][1]:+.1f}]\n"
            f"  avg win {100*a['avg_win']:+.1f}%, avg loss {100*a['avg_loss']:+.1f}%, payoff {a['payoff']:.2f} (fee {f['payoff']:.2f})\n"
            f"  $/contract no fee {a['usd_per_contract']:+.0f} (fee {f['usd_per_contract']:+.0f});"
            f" max DD (cum. return units) {100*a['max_dd_ret_units']:+.0f}% (fee {100*f['max_dd_ret_units']:+.0f}%),"
            f" max DD $/contract {a['max_dd_usd_per_contract']:+.0f} (fee {f['max_dd_usd_per_contract']:+.0f})")


def main():
    if os.environ.get('BLIND_SCORER') != '1':
        sys.exit('locked look reserved for the blind scorer (BLIND_SCORER=1)')
    os.makedirs(OUT, exist_ok=True)
    res = os.path.join(OUT, 'K5-LOCKED.json')
    if os.path.exists(res):
        sys.exit(f'K5 already scored on the locked test ({res}); not looking again')
    spec = os.path.join(HERE, 'K5.spec.c45a7d2.md')
    spec_sha = hashlib.sha256(open(spec, 'rb').read()).hexdigest()
    days = [d for d in C.days_built() if is_locked(d)]
    S = chal.Sessions(days, roots=['SPXW'], session='overnight')
    rows = calls_table(S)
    parts = [summarize(rows, days, 'K5 LOCKED TEST (H1 ∪ H2 ∪ 2026-07-01+), one look')]
    for name, fn in (('block', block), ('regime', regime)):
        keys = sorted({fn(d) for d in days})
        for k in keys:
            dd = [d for d in days if fn(d) == k]
            parts.append(summarize([r for r in rows if fn(r['day']) == k], dd, f'{name} {k}'))
    txt = '\n'.join(fmt(p) for p in parts)
    print(txt)
    print(f'\nsessions built: {len(days)}; spec sha256 {spec_sha}')
    json.dump({'spec_commit': 'c45a7d2e51d7429f3e6eaf7cb8026405bec91d33', 'spec_sha256': spec_sha, 'days': days,
               'calls': rows, 'summary': parts, 'text': txt}, open(res, 'w'), indent=1, default=float)


if __name__ == '__main__':
    main()
