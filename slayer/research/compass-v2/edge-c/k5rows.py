"""K5 on the challenger's rows, restricted to the v2 DEV days (never a locked day; cache=False, nothing written there),
with the rows' greeks attribution (S4c) and the gate diagnostics needed to compare with EDGE-C's own engine.
Standalone: imports the challenger's modules only (its `common` must not be shadowed by edge-c/common.py).

  python3 k5rows.py            -> results/k5rows_dev_calls.csv, results/s4c_attrib.json, results/k5rows_gates.csv
"""
import json
import os
import sys

import numpy as np
import pandas as pd

CHAL = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger'
sys.path.insert(0, CHAL)
import common as CC  # noqa: E402  (the challenger's)
import books as B  # noqa: E402
import candidates as K  # noqa: E402

OUT = '/home/user/falcon-cloud-field-sail/v2data/edge-c/results'
os.makedirs(OUT, exist_ok=True)
H1 = [('2022-06-01', '2022-06-30'), ('2024-08-01', '2024-08-31'), ('2026-10-05', '2026-10-30')]
H2 = [('2022-07-01', '2022-09-30'), ('2025-01-01', '2025-03-31')]


def is_dev(d):
    if any(a <= d <= b for a, b in H1 + H2) or d >= '2026-07-01':
        return False
    return d < '2025-01-01'


days = [d for d in CC.days_built() if is_dev(d)]
print('DEV built days', len(days), days[0], days[-1], flush=True)
parts = []
for d in days:
    x = CC.load_day(d, cache=False)
    x = x[(x['ticker'].astype(str) == 'SPXW') & (x['session'].astype(str) == 'overnight')]
    x = x[[c for c in x.columns if not (c.startswith('x') and c[1:].isdigit())]]
    parts.append(x)
df = pd.concat(parts, ignore_index=True)
for c in ('day', 'sleeve', 'ticker', 'contract', 'expiry', 'right', 'mark', 'session', 'whyA', 'whyR'):
    if c in df.columns:
        df[c] = df[c].astype(str).astype('category')
print('overnight SPXW rows', len(df), 'nights with rows', df.day.nunique(), flush=True)


class S(B.Sessions):
    def __init__(self):
        self.days = days
        self.df = df.reset_index(drop=True)
        self.fill = self.df['fill'].values.astype(float)
        self.pnl_prun, _ = CC.call_pnl(self.df, 'prun')
        self.pnl_ride, _ = CC.call_pnl(self.df, 'all')
        self.pnl_tp, _ = CC.call_pnl(self.df, 'none')
        self.engine = {}
        self.win = self.df['whyA'].astype(str).str.startswith('Take profit').values
        stop = 1 - 0.5322
        h50 = self.df['hit50'].values == 1
        wp = self.df['worstPre'].values.astype(float)
        fb = self.df['flatBid'].values.astype(float)
        self.win_hard = h50 & (wp > stop)
        r = np.where(self.win_hard, 0.5, np.where(wp <= stop, -0.5322, fb - 1))
        self.pnl_hard = r * self.fill * 100


s = S()
d = s.df
# ---- gate diagnostics: the K5-window rows (00:00-05:59, |delta| 0.10-0.20, move side) by night
win_rows = d[(d.c1 >= 225) & (d.c1 <= 584) & (d.c14 >= 0.10) & (d.c14 <= 0.20)]
g = win_rows.groupby('day', observed=True).agg(rows=('c1', 'size'), side_rows=('c33', lambda v: int((v > 0).sum())),
                                              first_mark=('mark', 'first'), a_gate=('aGate', 'mean'), b_gate=('bGate', 'mean'),
                                              med_ask=('ask', 'median'), med_spread=('ask', lambda v: np.nan))
nights_any = d.groupby('day', observed=True).size()
print('nights with any overnight row', len(nights_any), '; with K5-window 0.10-0.20 rows', len(g), '; with a move-side row',
      int((g.side_rows > 0).sum()), flush=True)
g.to_csv(os.path.join(OUT, 'k5rows_gates.csv'))
# how the rows are distributed over the night (minutes since 20:15, 60-min bins) and |delta|
d['hour_bin'] = (d.c1 // 60).astype(int)
print(d.groupby('hour_bin', observed=True).size().to_string(), flush=True)
print('delta bands of overnight rows:', pd.cut(d.c14, [0, 0.1, 0.15, 0.2, 0.3, 0.5, 1]).value_counts().sort_index().to_dict(), flush=True)
print('sleeve', d.sleeve.value_counts().to_dict(), 'aGate', d.aGate.mean(), 'bGate', d.bGate.mean(), flush=True)
print('ask quantiles', d.ask.quantile([.1, .5, .9]).to_dict(), 'spread/mid median', float(((d.ask - d.bid) / d.mid).median()), flush=True)

# ---- K5 calls on DEV rows
idx, _ = K.k5_overnight_spx_hard(s, np.ones(len(d), bool))
cols = ['day', 'sleeve', 'contract', 'expiry', 'right', 'strike', 'mark', 'c1', 'c14', 'c33', 'bid', 'ask', 'fill', 'fillAt', 'hit50', 'min50',
        'worstPre', 'flatBid', 'best', 'atS0', 'atS1', 'atIv0', 'atIv1', 'atMin', 'atDelta', 'atGamma', 'atVega', 'atTheta', 'atResid']
t = d.loc[idx, [c for c in cols if c in d.columns]].copy()
t['win'] = s.win_hard[idx]
t['ret'] = s.pnl_hard[idx] / (s.fill[idx] * 100)
t['ret_fee'] = (s.pnl_hard[idx] - 1.3) / (s.fill[idx] * 100 + 0.65)
t = t[np.isfinite(t.ret)]
t.to_csv(os.path.join(OUT, 'k5rows_dev_calls.csv'), index=False)
rng = np.random.default_rng(7)
by = t.groupby('day', observed=True)['ret_fee'].agg(['sum', 'size'])
pick = rng.integers(0, len(by), (4000, len(by)))
m = by['sum'].values[pick].sum(1) / by['size'].values[pick].sum(1)
print(f"K5 on DEV rows: n={len(t)} nights={t.day.nunique()} win={t.win.mean():.3f} ret_fee={t.ret_fee.mean():+.3f} "
      f"[{np.percentile(m, 2.5):+.3f}, {np.percentile(m, 97.5):+.3f}]", flush=True)
print(t.groupby(t.day.astype(str).str[:4])[['ret_fee', 'win']].agg(['mean', 'size']).to_string(), flush=True)
print(t[['day', 'contract', 'mark', 'c14', 'c33', 'bid', 'ask', 'fill', 'win', 'ret']].to_string(), flush=True)

# ---- S4c attribution
t['mid_change'] = t[['atDelta', 'atGamma', 'atVega', 'atTheta', 'atResid']].sum(1)
rep = {'days': len(days), 'n_calls': int(len(t)), 'win_rate': float(t.win.mean()), 'ret_mean': float(t.ret.mean()),
       'ret_fee_mean': float(t.ret_fee.mean())}
for lab, mk in (('wins', t.win.astype(bool)), ('losses', ~t.win.astype(bool))):
    u = t[mk & t.atDelta.notna()]
    if not len(u):
        continue
    tot = u.mid_change
    rep[lab] = {'n': int(len(u)), 'mid_change_mean': float(tot.mean()),
                'share_median': {k: float((u[f'at{k}'] / tot).median()) for k in ('Delta', 'Gamma', 'Vega', 'Theta', 'Resid')},
                'mean': {k: float(u[f'at{k}'].mean()) for k in ('Delta', 'Gamma', 'Vega', 'Theta', 'Resid')},
                'spot_move_median_pct': float(100 * (u.atS1 / u.atS0 - 1).median()),
                'spot_move_signed_median_pct': float(100 * ((u.atS1 / u.atS0 - 1) * np.where(u.right.astype(str) == 'C', 1, -1)).median()),
                'iv_change_median': float((u.atIv1 - u.atIv0).median()), 'minutes_median': float(u.atMin.median())}
json.dump(rep, open(os.path.join(OUT, 's4c_attrib.json'), 'w'), indent=1, default=float)
print(json.dumps(rep, indent=1, default=float), flush=True)
