"""EDGE-M tables: cost table (0/1/2-3 DTE on the same marks), every variant M1-M6 on DEV, shuffled-side null, PBO,
DSR at N = 306, payoff per unit underlying move, splits by year / root / exit.

  python3 analyze_m.py [results file] > ../edge-m/results/DEV.md
"""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.insert(0, HERE)
import sim
import mdte

N_TRIALS = 306
BUCKET = {'M1': '0', 'M2': '1', 'M3': '23', 'M4': '23', 'M5': '1', 'M6': '23'}
DESC = {'M1': 'E1 0DTE X2s (control)', 'M2': 'E1 1DTE X2s', 'M3': 'E1 2-3DTE X2s', 'M4': 'E1 2-3DTE overnight->09:45',
        'M5': 'E2 1DTE Y2s', 'M6': 'E2 2-3DTE Y2s'}


def load(f=None):
    f = f or os.path.join(mdte.MROOT, 'results_DEV.json')
    return json.load(open(f))


def trades(have, v, side='real'):
    out = []
    H, b = mdte.HOF[v], BUCKET[v]
    for rec in have.values():
        if not rec or rec['H'] != H:
            continue
        s = rec['b'].get(b, {}).get(side)
        if not s or not s.get('res') or v not in s['res']:
            continue
        t = dict(s['res'][v])
        t.update(day=rec['day'], root=rec['root'], call=s['sel']['call'], delta=s['sel']['delta'], spr0=s['sel']['spr0'],
                 theta_h=s['sel']['theta_h'], rho=s.get('rho'), n_exp=s['n'], k=s['sel']['k'], iv0=s['sel']['iv'])
        out.append(t)
    return out


def shuffle_null(have, v, draws=200, seed=0):
    H, b = mdte.HOF[v], BUCKET[v]
    pairs = []
    for rec in have.values():
        if not rec or rec['H'] != H:
            continue
        r, o = rec['b'].get(b, {}).get('real'), rec['b'].get(b, {}).get('opp')
        if r and o and v in (r.get('res') or {}) and v in (o.get('res') or {}):
            pairs.append((rec['day'], r['res'][v]['ret_fee'], o['res'][v]['ret_fee']))
    if not pairs:
        return None
    rng = np.random.default_rng(seed)
    exps, passes = [], 0
    for _ in range(draws):
        coin = rng.random(len(pairs)) < 0.5
        tr = [{'day': d, 'ret_fee': (a if c else bb)} for (d, a, bb), c in zip(pairs, coin)]
        e, lo, hi = sim.boot(tr, 'ret_fee', n=400, seed=int(rng.integers(1e9)))
        exps.append(e)
        passes += lo > 0
    e_real = float(np.mean([a for _, a, _ in pairs]))
    return {'n': len(pairs), 'real': e_real, 'null_mean': float(np.mean(exps)), 'null_p95': float(np.percentile(exps, 95)),
            'beats': float(np.mean(np.array(exps) < e_real)), 'fdr': passes / draws}


def payoff_per_move(tr):
    r = np.array([t['ret'] for t in tr])
    u = np.array([t['ur'] for t in tr])
    ok = np.isfinite(u)
    r, u = r[ok], u[ok]
    if len(r) < 5 or np.var(u) == 0:
        return np.nan, np.nan
    slope = float(np.cov(r, u)[0, 1] / np.var(u, ddof=1))
    big = np.abs(u) > 0.0005
    med = float(np.median(r[big] / u[big])) if big.sum() > 5 else np.nan
    return slope, med


def bucket_marks(rec, b):
    """(cost marks, passes the 5% gate) for bucket b at the trigger's decision minute, real side."""
    if b in rec['b']:
        s = rec['b'][b].get('real') or {}
        return s.get('cost'), s.get('sel') is not None
    tr = rec['trig']  # E2 0DTE: EDGE's chain store, same minute
    bd = mdte.board_m(rec['root'], rec['day'], rec['day'], (int(tr['t']) - 60) // 60)
    T = mdte.T_of(tr['t'], 0)
    return (mdte.gate_stats(bd, tr['S'], T, tr['up'], mdte.TGT[rec['H']]),
            mdte.select_m(bd, tr['S'], T, tr['up'], mdte.TGT[rec['H']]) is not None)


def iv_change(tr):
    """Diagnostic: implied vol at the exit (mid ~ exit bid / (1 - spr0/2)) minus the board IV at entry."""
    out = []
    for t in tr:
        u1 = mdte.under_at(t['root'], t['day'], t['exit_s'])
        es, n = t['exit_s'], t['n_exp']
        if es >= 86400:
            es, n = es - 86400, n - 1
        if not np.isfinite(u1) or t['exit'] <= 0:
            continue
        mid = t['exit'] / (1 - t['spr0'] / 2)
        v = sim.implied_vol(np.array([mid]), u1, np.array([t['k']]), mdte.T_of(es, n), np.array([t['call']]))[0]
        if np.isfinite(v):
            out.append(v - t['iv0'])
    if len(out) < 5:
        return None
    out = np.array(out)
    return float(np.median(out)), float(np.mean(out)), float(np.mean(out < 0))


def cost_table(have):
    lines = ['| trigger marks | DTE | n (all 3 DTE quoted) | median spread % of mid | median BS theta per trading hour % of mid | '
             'passes 5% gate | median premium (bp of S) |', '|---|---|---:|---:|---:|---:|---:|']
    for H, minute in (('E1', '15:24'), ('E2', '09:59')):
        rows = {b: [] for b in ('0', '1', '23')}
        for rec in have.values():
            if not rec or rec['H'] != H:
                continue
            ms = {b: bucket_marks(rec, b) for b in rows}
            if all(m[0] for m in ms.values()):
                for b in rows:
                    rows[b].append((ms[b][0], ms[b][1], rec['trig']['S']))
        for b, x in rows.items():
            if not x:
                continue
            lab = {'0': '0DTE', '1': '1DTE', '23': '2-3DTE'}[b]
            lines.append(f"| {H} ({minute}) | {lab} | {len(x)} | {100 * np.median([c['spr'] for c, _, _ in x]):.1f}% | "
                         f"{100 * np.median([c['theta_h'] for c, _, _ in x]):.1f}% | {100 * np.mean([p for _, p, _ in x]):.0f}% | "
                         f"{np.median([c['mid'] / S * 1e4 for c, _, S in x]):.0f} |")
    return '\n'.join(lines)


def main():
    have = load(sys.argv[1] if len(sys.argv) > 1 else None)
    nE1 = sum(1 for k, r in have.items() if k.startswith('E1|'))
    nE2 = sum(1 for k, r in have.items() if k.startswith('E2|'))
    tE1 = sum(1 for k, r in have.items() if k.startswith('E1|') and r)
    tE2 = sum(1 for k, r in have.items() if k.startswith('E2|') and r)
    print(f'# EDGE-M on DEV\n\nroot-sessions processed: E1 {nE1} ({tE1} triggers, sessions '
          f'{len(set(k.split("|")[2] for k in have if k.startswith("E1|")))}), E2 {nE2} ({tE2} triggers).\n')
    print('## Cost side at entry (same root-day-minute marks; contract nearest the target delta in 0.30-0.45, any spread)\n')
    print(cost_table(have))
    print('\n## Variants (net of $0.65/side; 95% session-clustered bootstrap)\n')
    print('| variant | n | win (net>0) [95%] | expectancy net [95%] | no fee | payoff | Sharpe/trade | option ret per 1% underlying (OLS) | median ratio | med spread | med theta/h | med rho |')
    print('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    rows = {}
    for v in mdte.ALL:
        tr = trades(have, v)
        s = sim.summary(tr, f'{v} {DESC[v]}')
        rows[v] = (s, tr)
        if not s.get('n'):
            print(f'| {v} {DESC[v]} | 0 |')
            continue
        sl, md = payoff_per_move(tr)
        print(sim.fmt(s) + f' {sl:.0f}% | {md:.0f}% |{100 * np.median([t["spr0"] for t in tr]):.1f}% | '
              f'{100 * np.median([t["theta_h"] for t in tr]):.1f}% | {np.median([t["rho"] for t in tr]):.2f} |')
    print('\n## Shuffled-side null (same triggers, times, marks; side by coin; 200 draws)\n')
    print('| variant | pairs | real exp | null mean | null p95 | real beats null | null FDR |\n|---|---:|---:|---:|---:|---:|---:|')
    for v in mdte.ALL:
        z = shuffle_null(have, v)
        if z:
            print(f"| {v} | {z['n']} | {100 * z['real']:+.1f}% | {100 * z['null_mean']:+.1f}% | {100 * z['null_p95']:+.1f}% | "
                  f"{100 * z['beats']:.0f}% | {100 * z['fdr']:.1f}% |")
    hv = ['M2', 'M3', 'M4', 'M5', 'M6']
    days = sorted(set(t['day'] for v in hv for t in rows[v][1]))
    di = {d: i for i, d in enumerate(days)}
    M = np.full((len(days), len(hv)), np.nan)
    for j, v in enumerate(hv):
        by = {}
        for t in rows[v][1]:
            by.setdefault(t['day'], []).append(t['ret_fee'])
        for d, x in by.items():
            M[di[d], j] = np.mean(x)
    print(f'\nPBO (CSCV, 16 blocks, M2-M6): {sim.pbo(M):.2f}')
    shs = [rows[v][0].get('sharpe', np.nan) for v in hv if rows[v][0].get('n', 0) > 3]
    var = max(float(np.nanvar(shs)) if len(shs) > 1 else 0.01, 0.002)
    print(f'DSR at N = {N_TRIALS} (Sharpe variance {var:.4f} across M2-M6):')
    for v in mdte.ALL:
        s = rows[v][0]
        if s.get('n', 0) > 3:
            print(f"  {v}: n {s['n']}, Sharpe/trade {s['sharpe']:.3f}, DSR {sim.dsr(s['sharpe'], s['n'], N_TRIALS, var, s['skew'], s['kurt']):.3f}")
    for v in mdte.ALL:
        tr = rows[v][1]
        if not tr:
            continue
        print(f'\n### {v} {DESC[v]}: by year / right / root / exit\n')
        print(sim.HEAD)
        for y in sorted(set(t['day'][:4] for t in tr)):
            print(sim.fmt(sim.summary([t for t in tr if t['day'][:4] == y], f'{v} {y}')))
        for c, lab in ((True, 'calls'), (False, 'puts')):
            print(sim.fmt(sim.summary([t for t in tr if t['call'] == c], f'{v} {lab}')))
        for r in sorted(set(t['root'] for t in tr)):
            print(sim.fmt(sim.summary([t for t in tr if t['root'] == r], f'{v} {r}')))
        why = {}
        for t in tr:
            why.setdefault(t['why'], []).append(t['ret_fee'])
        print('\n  exits: ' + ', '.join(f"{k} {len(x)} ({100 * np.mean(x):+.1f}%)" for k, x in why.items()))
        dv = iv_change(tr)
        if dv is not None:
            print(f'  implied-vol change entry->exit (exit IV backed out of the exit bid at the entry spread): median {100 * dv[0]:+.2f} vol pts, '
                  f'mean {100 * dv[1]:+.2f}; share of trades with IV down {100 * dv[2]:.0f}%')
    json.dump({v: {k: x for k, x in rows[v][0].items()} for v in mdte.ALL},
              open(os.path.join(mdte.MROOT, 'summary_DEV.json'), 'w'), default=float)


if __name__ == '__main__':
    main()
