"""EDGE-K DEV tables (specs/PREREG.md): python3 analyze_k.py -> results/DEV.md + results/summary.json"""
import glob, json, math, os, sys
import numpy as np
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
from eval.metrics import cluster_ci_mean, pbo_cscv, ledger_trials, deflated_sharpe  # noqa: E402

V2 = '/home/user/falcon-cloud-field-sail/v2data/edge-k'
FEE = 0.65
NAMES = {'K': 'K chooser (abstains if max ER <= 0)', 'Kf': 'K-forced (argmax ER always)', 'Kr': 'K-root (no XSP, forced)',
         'A': 'A registered 0.35-delta', 'B': 'B at-the-money', 'C': 'C cheapest two-sided', 'D': 'D Compass style (ITM 4)'}


def load():
    rows, sigs = [], []
    for f in sorted(glob.glob(os.path.join(V2, 'res', '*.json'))):
        for ch in json.load(open(f)):
            s = ch['sig']
            sid = f"{s['set']}|{s['root']}|{s['day']}"
            sigs.append({'sid': sid, 'set': s['set'], 'root': s['root'], 'day': s['day'], 'er_max': ch.get('er_max'),
                         'er0r': ch.get('er0_max_real'), 'er0o': ch.get('er0_max_opp'), 'nF': ch.get('n_F'), 'nmini': ch.get('n_mini'),
                         'edge2': ch.get('edge_two_sided'), 'kappa': (ch.get('model') or {}).get('kappa'),
                         'sig_f': (ch.get('model') or {}).get('sig_f')})
            for name, p in ch['picks'].items():
                o = p.get('out') or {}
                r = {'sid': sid, 'set': s['set'], 'root': s['root'], 'day': s['day'], 'year': s['day'][:4], 'picker': name,
                     'proot': p['root'], 'k': p['k'], 'call': p['call'], 'ask0': p['ask'], 'delta': p.get('delta'),
                     'er': p.get('er'), 'er0': p.get('er0'), 'itm': p.get('itm'), 'skip': o.get('skip')}
                if 'ret_fee' in o:
                    r.update(fill=o['fill'], exit=o['exit'], ret=o['ret'], ret_fee=o['ret_fee'], why=o['why'],
                             pnl=(o['exit'] - o['fill']) * 100 - 2 * FEE, risk=o['fill'] * 100 + FEE)
                rows.append(r)
    T = pd.DataFrame(rows)
    S = pd.DataFrame(sigs)
    # K = Kf where the chooser's max ER > 0
    k = T[T.picker == 'Kf'].merge(S[['sid', 'er_max']], on='sid')
    k = k[k.er_max > 0].drop(columns='er_max').assign(picker='K')
    T = pd.concat([T, k], ignore_index=True)
    return T, S


def ci(v, cl):
    v = np.asarray(v, float)
    if len(v) < 2:
        return (np.nan, np.nan)
    return cluster_ci_mean(v, cl, n_boot=2000)


def row(T, S, name, setname):
    x = T[(T.picker == name) & (T.set == setname)]
    tr = x[x.ret_fee.notna()]
    n_sig = int((S.set == setname).sum())
    lo, hi = ci(tr.ret_fee, tr.day)
    lo0, hi0 = ci(tr.ret, tr.day)
    prem = tr.fill * 100
    return {'picker': name, 'n_signals': n_sig, 'picked': len(x), 'traded': len(tr), 'skipped': int(x.skip.notna().sum()),
            'abstain': n_sig - len(x), 'exp': tr.ret_fee.mean(), 'lo': lo, 'hi': hi, 'exp0': tr.ret.mean(), 'lo0': lo0, 'hi0': hi0,
            'dpd': tr.pnl.sum() / tr.risk.sum() if len(tr) else np.nan, 'hit': (tr.ret_fee > 0).mean() if len(tr) else np.nan,
            'pnl': tr.pnl.sum(), 'prem_med': prem.median(), 'prem_q': [float(prem.quantile(q)) for q in (0.1, 0.25, 0.5, 0.75, 0.9)] if len(tr) else [],
            'delta_med': tr.delta.median(), 'sessions': tr.day.nunique()}


def per_signal_value(T, S, setname, name):
    """Per-signal net return with abstain/skip = 0 (the value of acting on every signal with this picker)."""
    sids = S[S.set == setname][['sid', 'day']]
    x = T[(T.picker == name) & (T.set == setname) & T.ret_fee.notna()][['sid', 'ret_fee', 'pnl']]
    m = sids.merge(x, on='sid', how='left').fillna({'ret_fee': 0.0, 'pnl': 0.0})
    lo, hi = ci(m.ret_fee, m.day)
    return m.ret_fee.mean(), lo, hi, m.pnl.sum()


def paired(T, setname, a, b):
    x = T[(T.set == setname) & (T.picker == a) & T.ret_fee.notna()][['sid', 'day', 'ret_fee']]
    y = T[(T.set == setname) & (T.picker == b) & T.ret_fee.notna()][['sid', 'ret_fee']]
    m = x.merge(y, on='sid', suffixes=('_a', '_b'))
    if len(m) < 2:
        return len(m), np.nan, np.nan, np.nan, np.nan
    d = m.ret_fee_a - m.ret_fee_b
    lo, hi = ci(d, m.day)
    same = (T[(T.set == setname) & (T.picker == a)].set_index('sid')[['proot', 'k']]
            .join(T[(T.set == setname) & (T.picker == b)].set_index('sid')[['proot', 'k']], rsuffix='_b', how='inner'))
    return len(m), d.mean(), lo, hi, float(((same.proot == same.proot_b) & (same.k == same.k_b)).mean())


def null_random(T, setname, draws=2000, fdr_draws=200, seed=11):
    R = T[(T.set == setname) & T.picker.isin(['R0', 'R1', 'R2']) & T.ret_fee.notna()]
    g = R.groupby('sid')
    sids = list(g.groups)
    vals = [g.get_group(s).ret_fee.values for s in sids]
    days = np.array([g.get_group(s).day.iloc[0] for s in sids])
    rng = np.random.default_rng(seed)
    means, passes = [], 0
    for i in range(draws):
        v = np.array([x[rng.integers(len(x))] for x in vals])
        means.append(v.mean())
        if i < fdr_draws:
            lo, hi = cluster_ci_mean(v, days, n_boot=400, seed=i)
            passes += lo > 0
    kf = T[(T.set == setname) & (T.picker == 'Kf') & T.ret_fee.notna() & T.sid.isin(sids)].ret_fee.mean()
    k = T[(T.set == setname) & (T.picker == 'K') & T.ret_fee.notna()].ret_fee.mean()
    means = np.array(means)
    return {'n': len(sids), 'null_mean': float(means.mean()), 'null_p95': float(np.percentile(means, 95)),
            'kf': float(kf), 'kf_beats': float((means < kf).mean()), 'k': float(k), 'k_beats': float((means < k).mean()),
            'fdr': passes / fdr_draws}


def null_shuffle(T, S, setname, draws=200, seed=12):
    s = S[S.set == setname].set_index('sid')
    a = T[(T.set == setname) & (T.picker == 'K0r') & T.ret_fee.notna()].set_index('sid')
    b = T[(T.set == setname) & (T.picker == 'K0o') & T.ret_fee.notna()].set_index('sid')
    rng = np.random.default_rng(seed)
    means, passes, ns = [], 0, []
    for i in range(draws):
        coin = rng.random(len(s)) < 0.5
        v, d = [], []
        for (sid, r), c in zip(s.iterrows(), coin):
            if c and sid in a.index and (r.er0r or 0) > 0:
                v.append(a.loc[sid, 'ret_fee']); d.append(r.day)
            elif not c and sid in b.index and (r.er0o or 0) > 0:
                v.append(b.loc[sid, 'ret_fee']); d.append(r.day)
        ns.append(len(v))
        if len(v) >= 2:
            means.append(np.mean(v))
            lo, hi = cluster_ci_mean(v, d, n_boot=300, seed=i)
            passes += lo > 0
        else:
            means.append(0.0)
    k = T[(T.set == setname) & (T.picker == 'K') & T.ret_fee.notna()].ret_fee.mean()
    means = np.array(means)
    return {'null_mean': float(means.mean()), 'null_p95': float(np.percentile(means, 95)), 'n_mean': float(np.mean(ns)),
            'k': float(k), 'k_beats': float((means < k).mean()), 'fdr': passes / draws}


def calibration(T, setname):
    x = T[(T.set == setname) & T.er.notna() & T.ret_fee.notna() & (T.picker != 'K')].drop_duplicates(['sid', 'proot', 'k', 'call'])
    if len(x) < 20:
        return []
    x = x.assign(q=pd.qcut(x.er, 10, labels=False, duplicates='drop'))
    out = []
    for q, g in x.groupby('q'):
        lo, hi = ci(g.ret_fee, g.day)
        out.append((int(q), len(g), g.er.mean(), g.ret_fee.mean(), lo, hi))
    c = np.corrcoef(x.er, x.ret_fee)[0, 1]
    return out, float(c), len(x)


def pct(x, d=1):
    return 'n/a' if x is None or not np.isfinite(x) else f'{100 * x:+.{d}f}%'


def main():
    T, S = load()
    L = ['# EDGE-K DEV results (specs/PREREG.md @ a0e1dc6)', '',
         f'Sessions with results: {T.day.nunique()}; signals: S1 {int((S.set == "S1").sum())}, S2 {int((S.set == "S2").sum())}.', '']
    summ = {'sets': {}}
    trials = ledger_trials()
    for st in ('S1', 'S2'):
        L += [f'## {st} ' + ('(EDGE-T H1-k0.30 opening drive, RT exits)' if st == 'S1' else '(EDGE E1-z0.5 momentum into the close, X2 exits)'), '',
              '| picker | traded / picked / signals | skipped at fill | abstain | exp net [95%] | no fee | $ per $ risked | hit | P&L $ | premium $ p10/p25/p50/p75/p90 | med delta |',
              '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|']
        R = {}
        for name in ('K', 'Kf', 'Kr', 'A', 'B', 'C', 'D'):
            r = row(T, S, name, st)
            R[name] = r
            q = '/'.join(f'{v:.0f}' for v in r['prem_q'])
            L.append(f"| {NAMES[name]} | {r['traded']} / {r['picked']} / {r['n_signals']} | {r['skipped']} | {r['abstain']} | "
                     f"{pct(r['exp'])} [{pct(r['lo'])}, {pct(r['hi'])}] | {pct(r['exp0'])} | {pct(r['dpd'])} | {pct(r['hit'], 0)} | "
                     f"{r['pnl']:+,.0f} | {q} | {r['delta_med']:.2f} |")
        L += ['', 'Per-signal value (every signal; abstain or skipped fill = 0):', '', '| picker | mean per signal [95%] | total P&L $ |', '|---|---:|---:|']
        for name in ('K', 'Kf', 'A', 'B', 'C', 'D'):
            m, lo, hi, p = per_signal_value(T, S, st, name)
            L.append(f'| {name} | {pct(m, 2)} [{pct(lo, 2)}, {pct(hi, 2)}] | {p:+,.0f} |')
        L += ['', 'Paired, same signals both traded: K-forced minus X (net return per trade):', '',
              '| vs | n pairs | mean diff [95%] | same contract |', '|---|---:|---:|---:|']
        PR = {}
        for b in ('A', 'B', 'C', 'D', 'Kr'):
            n, d, lo, hi, same = paired(T, st, 'Kf', b)
            PR[b] = (n, d, lo, hi, same)
            L.append(f'| {b} | {n} | {pct(d, 2)} [{pct(lo, 2)}, {pct(hi, 2)}] | {pct(same, 0)} |')
        # abstention
        ab = T[(T.set == st) & (T.picker == 'Kf') & T.ret_fee.notna()].merge(S[['sid', 'er_max']], on='sid')
        a0 = ab[ab.er_max <= 0]
        a1 = ab[ab.er_max > 0]
        lo, hi = ci(a0.ret_fee, a0.day)
        lo1, hi1 = ci(a1.ret_fee, a1.day)
        L += ['', f'Abstention: K-forced on the signals K abstains on: n {len(a0)}, {pct(a0.ret_fee.mean())} [{pct(lo)}, {pct(hi)}], '
              f'$ {a0.pnl.sum():+,.0f}; on the signals K trades: n {len(a1)}, {pct(a1.ret_fee.mean())} [{pct(lo1)}, {pct(hi1)}].']
        for b in ('A', 'B', 'D'):
            xb = T[(T.set == st) & (T.picker == b) & T.ret_fee.notna()].merge(S[['sid', 'er_max']], on='sid')
            L.append(f'- {b} on K-abstain signals: n {int((xb.er_max <= 0).sum())}, {pct(xb[xb.er_max <= 0].ret_fee.mean())}; '
                     f'on K-trade signals: n {int((xb.er_max > 0).sum())}, {pct(xb[xb.er_max > 0].ret_fee.mean())}')
        # mini
        kf = T[(T.set == st) & (T.picker == 'Kf')]
        kk = T[(T.set == st) & (T.picker == 'K')]
        spx = S[(S.set == st) & (S.root == 'SPXW')]
        if len(spx):
            L += ['', f'Mini: SPXW signals {len(spx)}, with an XSP board/candidates {int((spx.nmini > 0).sum())}; K-forced picks XSP on '
                  f'{int((kf.proot == "XSP").sum())} of {int((kf.root == "SPXW").sum())}; K (traded) on XSP {int((kk.proot == "XSP").sum())} of '
                  f'{int((kk.root == "SPXW").sum())}.']
            n, d, lo, hi, same = PR['Kr']
            L.append(f'- K-forced vs K-root (the mini effect, pairs where both traded): n {n}, {pct(d, 2)} [{pct(lo, 2)}, {pct(hi, 2)}]')
        # price distribution and moneyness of K's picks
        for name in ('K', 'Kf'):
            x = T[(T.set == st) & (T.picker == name)]
            if len(x):
                prem = x.ask0 * 100
                L.append(f'- {name} pick premium (board ask x 100) $: ' + ', '.join(f'p{int(q * 100)} {prem.quantile(q):,.0f}' for q in (0.05, 0.25, 0.5, 0.75, 0.95))
                         + f'; |delta| p25/p50/p75 {x.delta.quantile(.25):.2f}/{x.delta.median():.2f}/{x.delta.quantile(.75):.2f}; share > $1,000: {pct((prem > 1000).mean(), 0)}')
        # by year / root for K, Kf, A
        L += ['', '| by | K n | K exp | Kf n | Kf exp | A n | A exp | D n | D exp |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
        for col in ('year', 'root'):
            for v in sorted(T[T.set == st][col].unique()):
                cells = []
                for name in ('K', 'Kf', 'A', 'D'):
                    x = T[(T.set == st) & (T.picker == name) & T.ret_fee.notna() & (T[col] == v)]
                    cells += [str(len(x)), pct(x.ret_fee.mean())]
                L.append(f'| {col} {v} | ' + ' | '.join(cells) + ' |')
        # calibration
        cal = calibration(T, st)
        if cal:
            rows, cc, nn = cal
            L += ['', f'Model calibration (every distinct fetched pick, n {nn}; corr(ER, realised) {cc:+.3f}):', '',
                  '| ER decile | n | mean ER | realised [95%] |', '|---:|---:|---:|---:|']
            for q, n, e, r, lo, hi in rows:
                L.append(f'| {q} | {n} | {pct(e)} | {pct(r)} [{pct(lo)}, {pct(hi)}] |')
        # exit reasons
        for name in ('K', 'A'):
            x = T[(T.set == st) & (T.picker == name) & T.ret_fee.notna()]
            if len(x):
                L.append(f'- {name} exits: ' + ', '.join(f'{k} {v}' for k, v in x.why.value_counts().items()))
        # nulls
        nr = null_random(T, st)
        ns = null_shuffle(T, S, st)
        L += ['', f"N1 random contract (3 per signal, {nr['n']} signals, 2,000 draws): null mean {pct(nr['null_mean'])}, p95 {pct(nr['null_p95'])}; "
              f"K-forced {pct(nr['kf'])} beats {pct(nr['kf_beats'], 0)}; K {pct(nr['k'])} beats {pct(nr['k_beats'], 0)}; null FDR {pct(nr['fdr'], 1)}",
              f"N2 shuffled side (kappa = 0 chooser, side by coin, 200 draws; mean {ns['n_mean']:.0f} trades/draw): null mean {pct(ns['null_mean'])}, "
              f"p95 {pct(ns['null_p95'])}; K beats {pct(ns['k_beats'], 0)}; null FDR {pct(ns['fdr'], 1)}"]
        # PBO / DSR
        names = ['Kf', 'Kr', 'A', 'B', 'C', 'D']
        piv = T[(T.set == st) & T.picker.isin(names) & T.ret_fee.notna()].pivot_table(index='day', columns='picker', values='ret_fee', aggfunc='mean')
        piv = piv.reindex(columns=names).sort_index().fillna(0.0)
        pb = pbo_cscv(piv.values, n_blocks=16)['pbo'] if len(piv) >= 16 else np.nan
        kx = T[(T.set == st) & (T.picker == 'K') & T.ret_fee.notna()].ret_fee
        sr = kx.mean() / kx.std(ddof=1) if len(kx) > 2 else np.nan
        srs = [T[(T.set == st) & (T.picker == n) & T.ret_fee.notna()].ret_fee for n in names]
        srv = float(np.var([s.mean() / s.std(ddof=1) for s in srs if len(s) > 2]))
        dsr = deflated_sharpe(sr, len(kx), trials, srv) if np.isfinite(sr) else np.nan
        L += [f'PBO (CSCV, 16 blocks, {len(names)} pickers): {pb:.2f}; K Sharpe/trade {sr:.3f}, DSR at N = {trials}: {dsr:.3f}', '']
        summ['sets'][st] = {'rows': R, 'paired': PR, 'null_random': nr, 'null_shuffle': ns, 'pbo': pb, 'dsr': dsr,
                            'abstain_kf': [len(a0), a0.ret_fee.mean(), lo, hi]}
    # coverage diagnostic
    L += [f"Board coverage: outermost stored side strike still two-sided on {pct(S.edge2.mean(), 0)} of signals (S1 "
          f"{pct(S[S.set == 'S1'].edge2.mean(), 0)}, S2 {pct(S[S.set == 'S2'].edge2.mean(), 0)}).",
          f"Skip reasons: " + ', '.join(f'{k} {v}' for k, v in T[T.picker.isin(['Kf', 'A', 'B', 'C', 'D'])].skip.value_counts().items())]
    open(os.path.join(HERE, 'results', 'DEV.md'), 'w').write('\n'.join(L) + '\n')
    json.dump(summ, open(os.path.join(HERE, 'results', 'summary.json'), 'w'), default=lambda x: None if x is None or (isinstance(x, float) and not math.isfinite(x)) else float(x) if isinstance(x, (np.floating, np.integer)) else str(x), indent=1)
    print('\n'.join(L))


if __name__ == '__main__':
    main()
