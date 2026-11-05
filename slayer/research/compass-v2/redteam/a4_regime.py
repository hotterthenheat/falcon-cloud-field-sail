"""Attack 4 (regime luck) and 5 (multiple testing) on the locked results as scored (spec-literal and protocol-exec)."""
import sys, os, json, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rt
sys.path.insert(0, '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2')
from eval.metrics import deflated_sharpe, basic, cluster_ci_mean  # noqa: E402

L = rt.locked_calls(); E = rt.locked_exec()
t = pd.DataFrame(L['calls']); e = pd.DataFrame(E['calls'])
t = t.merge(e[['day', 'mark', 'ret_net', 'ret_gross', 'reason', 'entry_ask_size']], on=['day', 'mark'])
# context from the rows at the mark: ATM IV (c28), overnight move (c33), weekday (c4), spread (c11)
ctx = []
for c in L['calls']:
    x = rt.spxw_overnight(c['day'])
    r = x[(x['mark'] == c['mark']) & (x['contract'] == c['contract'])].iloc[0]
    ctx.append(dict(day=c['day'], mark=c['mark'], atm_iv=float(r['c28']), move=float(r['c33']), weekday=int(r['c4']), rel_spread=float(r['c11'])))
t = t.merge(pd.DataFrame(ctx), on=['day', 'mark'])
t['year'] = t.day.str.slice(0, 4)
pd.set_option('display.width', 250)


def line(g, label, col='ret_net'):
    r = g[col].to_numpy(float)
    lo, hi = cluster_ci_mean(r, g.day.to_numpy(), 4000)
    return f"{label:28s} n={len(g):3d} win(TP) {100*(g.reason=='tp').mean():5.1f}%  exp {100*r.mean():+6.1f}% [{100*lo:+.1f}, {100*hi:+.1f}]  (spec-literal {100*g.ret.mean():+.1f}%)"


print('=== protocol-exec returns (net) ===')
print(line(t, 'ALL'))
s = t.sort_values('ret_net', ascending=False)
print(line(s.iloc[3:], 'drop top 3 trades'))
print(line(s.iloc[5:], 'drop top 5 trades'))
print(line(t[t.year != '2022'], 'ex-2022'))
print(line(t[t.year != '2026'], 'ex-2026'))
print(line(t[~t.year.isin(['2022', '2026'])], 'ex-2022 & ex-2026 (2024+2025)'))
for y, g in t.groupby('year'):
    print(line(g, f'year {y}'))
print('\n--- by ATM IV at the mark (vol regime proxy; VIX not fetched) ---')
t['iv_bin'] = pd.qcut(t.atm_iv, 3, labels=['low', 'mid', 'high'])
for k, g in t.groupby('iv_bin', observed=True):
    print(line(g, f'ATM IV {k} ({g.atm_iv.min():.2f}-{g.atm_iv.max():.2f})'))
print('\n--- by overnight move size |c33| at the mark ---')
t['mv_bin'] = pd.qcut(t.move.abs(), 3, labels=['small', 'mid', 'large'])
for k, g in t.groupby('mv_bin', observed=True):
    print(line(g, f'|move| {k} ({100*g.move.abs().min():.2f}-{100*g.move.abs().max():.2f}%)'))
print('\n--- by weekday (0=Sun) ---')
for k, g in t.groupby('weekday'):
    print(line(g, f'weekday {k}'))
print('\n--- by side ---')
t['side'] = t.contract.str.slice(-1)
for k, g in t.groupby('side'):
    print(line(g, f'side {k}'))
print('\n--- by mark hour ---')
t['hour'] = t.mark.str.slice(0, 2)
for k, g in t.groupby('hour'):
    print(line(g, f'mark {k}:xx'))

print('\n=== Attack 5: deflated Sharpe with the locked result ===')
for col, lab in (('ret_net', 'exec net'), ('ret', 'spec-literal')):
    b = basic(t[col].to_numpy(float))
    for N in (1, 156, 156 + 27, 400):
        d = deflated_sharpe(b['sharpe_trade'], b['n'], N, None, b['skew'], b['kurt'])
        print(f"{lab:13s} SR/trade {b['sharpe_trade']:.3f} skew {b['skew']:+.2f} kurt {b['kurt']:.1f} n={b['n']}  N_trials={N:3d}: SR0 {d['sr0']:.3f} DSR {d['dsr']:.3f}")
t.to_csv('a4_regime.csv', index=False)
