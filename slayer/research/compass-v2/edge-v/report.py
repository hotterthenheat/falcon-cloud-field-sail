"""EDGE-V report: 1-s results per variant + M1 nulls + synthetic null + PBO/DSR -> results/V1_<SET>.md/.json

  python3 report.py DEV [N_TRIALS]
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import v1
import sim as ES

which = sys.argv[1]
NT = int(sys.argv[2]) if len(sys.argv) > 2 else 334
have = json.load(open(os.path.join(v1.VROOT, f'trades_{which}.json')))
def load(n):
    f = os.path.join(v1.VROOT, n)
    return json.load(open(f)) if os.path.exists(f) else {}
m1 = load(f'nulls_m1_{which}.json')
syn = load(f'nulls_syn_{which}.json')

rows, out, sharpes = [], {}, []
days_all = sorted(set(r['day'] for r in have.values()))
mat = np.full((len(days_all), len(v1.variants())), np.nan)
di = {d: i for i, d in enumerate(days_all)}
for j, v in enumerate(v1.variants()):
    root, side, x, mode = v.split('-')
    tr = v1.trades_of(have, v)
    trig = sum(1 for r in have.values() if r['root'] == root and r.get('trig', {}).get(f'{side}-{x}'))
    nosel = sum(1 for r in have.values() if r['root'] == root and r.get('trig', {}).get(f'{side}-{x}') and not r.get('sel', {}).get(f'{side}-{x}'))
    s = ES.summary(tr, v)
    for t in tr:
        mat[di[t['day']], j] = t['ret_fee']
    if s.get('n', 0) > 2:
        sharpes.append(s['sharpe'])
    s['dbl'] = float(np.mean([t['dbl'] for t in tr])) if tr else np.nan
    s['why'] = {w: sum(1 for t in tr if t['why'] == w) for w in ('double', 'target', 'trail', 'stop', 'time')}
    yrs = {}
    for t in tr:
        yrs.setdefault(t['day'][:4], []).append(t['ret_fee'])
    s['by_year'] = {y: (len(a), float(np.mean(a))) for y, a in sorted(yrs.items())}
    s['triggered_sessions'], s['no_contract'] = trig, nosel
    s['m1'] = m1.get(v)
    s['syn'] = {k: val for k, val in syn.get(v, {}).items() if k != 'exps'} if v in syn else None
    if v in syn and s.get('n'):
        s['syn']['real_beats'] = float(np.mean(np.array(syn[v]['exps']) < s['exp']))
    out[v] = s
sr_var = float(np.var(sharpes, ddof=1)) if len(sharpes) > 1 else 0.0
for v, s in out.items():
    s['dsr'] = ES.dsr(s['sharpe'], s['n'], NT, sr_var, s.get('skew', 0) or 0, s.get('kurt', 3) or 3) if s.get('n', 0) > 2 else np.nan
pbo = ES.pbo(mat, 16)

L = [f'# V1 VWAP-PULLBACK / V1P on {which} (1-second NBBO fills, +2 s, ask in / bid out, fee $0.65/side)', '',
     f'PBO (CSCV, 24 variants, {len(days_all)} sessions) = {pbo:.2f}; DSR trial count N = {NT}; Sharpe variance across variants {sr_var:.4f}', '',
     '| variant | trig sess | no contract | trades | win | exp net [95% sess-clustered] | no fee | payoff | dbl (1-s) | M1 real exp | M1 dbl | rand-min null mean / dbl / real beats | shuffled-side mean / beats | syn null mean / FDR / beats | DSR |',
     '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for v, s in out.items():
    if not s.get('n'):
        L.append(f"| {v} | {s['triggered_sessions']} | {s['no_contract']} | 0 | | | | | | | | | | | |")
        continue
    m = s['m1'] or {}
    r, sh, rm = m.get('rand') or {}, m.get('shuf') or {}, m.get('real_m1') or {}
    sy = s['syn'] or {}
    f = lambda a: f'{100 * a:+.1f}%' if a is not None and np.isfinite(a) else '-'
    p = lambda a: f'{100 * a:.0f}%' if a is not None and np.isfinite(a) else '-'
    L.append(f"| {v} | {s['triggered_sessions']} | {s['no_contract']} | {s['n']} | {p(s['win'])} | {f(s['exp'])} [{f(s['exp_lo'])}, {f(s['exp_hi'])}] | "
             f"{f(s['exp_nofee'])} | {s['payoff']:.2f} | {p(s['dbl'])} | {f(rm.get('exp'))} | {p(rm.get('dbl'))} | "
             f"{f(r.get('mean'))} / {p(r.get('dbl_mean'))} / {p(r.get('beats'))} | {f(sh.get('mean'))} / {p(sh.get('beats'))} | "
             f"{f(sy.get('mean'))} / {p(sy.get('fdr'))} / {p(sy.get('real_beats'))} | {s['dsr']:.2f} |")
L += ['', 'Null false-pass rates (CI>0 among null draws): ' + ', '.join(
    f"{v}: rand {100 * (out[v]['m1'] or {}).get('rand', {}).get('fdr', np.nan):.1f}% shuf {100 * (out[v]['m1'] or {}).get('shuf', {}).get('fdr', np.nan):.1f}%"
    for v in out if out[v].get('m1')), '', 'By year (n, net mean) and exit reasons:', '']
for v, s in out.items():
    if s.get('n'):
        L.append(f"- {v}: " + ', '.join(f"{y}: n{n} {100 * e:+.0f}%" for y, (n, e) in s['by_year'].items()) + f"; exits {s['why']}")
os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results'), exist_ok=True)
base = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results', f'V1_{which}')
open(base + '.md', 'w').write('\n'.join(L) + '\n')
json.dump({'pbo': pbo, 'n_trials': NT, 'variants': out}, open(base + '.json', 'w'), indent=1, default=float)
print('\n'.join(L))
