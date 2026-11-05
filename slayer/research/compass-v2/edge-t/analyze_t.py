"""EDGE-T DEV tables: H1 (4), H2 (2), H3 (8 cells), shuffled-side null, trend-day split, PBO, DSR, artefacts.

  python3 analyze_t.py [dev.json] > results/DEV.md   (synthetic-null numbers are read from results/synthetic_null.json)
"""
import json, math, os, sys
import numpy as np
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.append(os.path.join(HERE, '..'))  # for eval.metrics only; edge/sim.py must win over the foundation's sim/
import sim  # noqa: E402
import ht  # noqa: E402

H1V = [f'k{k:.2f}-d{d:.2f}' for k in ht.H1_K for d in ht.DELTAS]
H2V = [f'd{d:.2f}' for d in (0.35, 0.20)]
H3V = [ht.cell_name(*c) for c in ht.H3_CELLS]
BASE_CELL = 'H3-TR-off-sane'


def load(f):
    return {k: v for k, v in json.load(open(f)).items() if v}


def _t(rec, side_rec, res_key, extra):
    r = side_rec['res'][res_key]
    spx = rec['spx']
    t = dict(r)
    t.update(day=rec['day'], root=rec['root'], call=side_rec['sel']['call'], delta=side_rec['sel']['delta'],
             spr0=side_rec['sel']['spr0'], spx_move=spx['move'], O=spx['O'], C=spx['C'], c944=spx['c944'], **extra)
    t['pnl'] = (t['exit'] - t['fill']) * 100 - 2 * sim.FEE
    return t


def h1_pairs(have, v, res_key='RT'):
    out = []
    for rec in have.values():
        x = rec['h1'].get(v)
        if not x:
            continue
        r, o = x['real'], x['opp']
        rt = _t(rec, r, res_key, {'t': x['t']}) if r.get('res') and res_key in r['res'] else None
        ot = _t(rec, o, res_key, {'t': x['t']}) if o.get('res') and res_key in o['res'] else None
        out.append((rt, ot, rec, x))
    return out


def h2_pairs(have, v):
    out = []
    for rec in have.values():
        for x in rec['h2'].get(v, []):
            r, o = x['real'], x['opp']
            rt = _t(rec, r, 'RT', {'t': x['t']}) if r.get('res') else None
            ot = _t(rec, o, 'RT', {'t': x['t']}) if o.get('res') else None
            out.append((rt, ot, rec, x))
    return out


def shuffle(pairs, draws=200, seed=0):
    pp = [(a['day'], a['ret_fee'], b['ret_fee']) for a, b, _, _ in pairs if a and b]
    if len(pp) < 5:
        return None
    rng = np.random.default_rng(seed)
    real = sim.boot([{'day': d, 'ret_fee': a} for d, a, b in pp], 'ret_fee', n=10)[0]
    exps, passes = [], 0
    for _ in range(draws):
        coin = rng.random(len(pp)) < 0.5
        tr = [{'day': d, 'ret_fee': (a if c else b)} for (d, a, b), c in zip(pp, coin)]
        e, lo, hi = sim.boot(tr, 'ret_fee', n=300, seed=int(rng.integers(1e9)))
        exps.append(e)
        passes += lo > 0
    return {'pairs': len(pp), 'real': real, 'null_mean': float(np.mean(exps)), 'null_p95': float(np.percentile(exps, 95)),
            'beats': float(np.mean(np.array(exps) < real)), 'fdr': passes / draws}


def bucket(t):
    m = abs(t['spx_move'])
    b = '<0.5%' if m < 0.005 else ('0.5-1.5%' if m <= 0.015 else '>1.5%')
    held = None if t['c944'] is None else bool(np.sign(t['c944'] - t['O']) == np.sign(t['C'] - t['O']))
    aligned = (t['C'] > t['O']) == t['call']
    return b, held, bool(aligned)


def trend_table(trades):
    rows = []
    tot = sum(t['pnl'] for t in trades)
    df = pd.DataFrame([dict(zip(('move', 'held', 'aligned'), bucket(t)), ret=t['ret_fee'], pnl=t['pnl'], day=t['day']) for t in trades])
    if not len(df):
        return '(no trades)'
    lines = ['| split | n | sessions | win | exp net | sum $ net (1 lot) |', '|---|---:|---:|---:|---:|---:|']
    for name, g in [('all', df)] + [(f'SPX |O→C| {b}', df[df.move == b]) for b in ('<0.5%', '0.5-1.5%', '>1.5%')] + \
            [('first 15 min direction held', df[df.held == True]), ('first 15 min direction failed', df[df.held == False])] + \
            [('trade side = day direction', df[df.aligned]), ('trade side against day direction', df[~df.aligned])] + \
            [(f'{b}, side {"with" if a else "against"} day', df[(df.move == b) & (df.aligned == a)]) for b in ('<0.5%', '0.5-1.5%', '>1.5%') for a in (True, False)]:
        if not len(g):
            lines.append(f'| {name} | 0 | | | | |')
            continue
        e, lo, hi = sim.boot(g.to_dict('records'), 'ret', n=1000)
        lines.append(f'| {name} | {len(g)} | {g.day.nunique()} | {100 * (g.ret > 0).mean():.0f}% | {100 * e:+.1f}% [{100 * lo:+.1f}, {100 * hi:+.1f}] | {g.pnl.sum():+,.0f} |')
    return '\n'.join(lines)


def med(trades):
    return float(np.median([t['ret_fee'] for t in trades])) if trades else np.nan


def row(label, trades, sh, syn):
    s = sim.summary(trades, label)
    if not s.get('n'):
        return f'| {label} | 0 | | | | | | | | |', s
    shs = f"{100 * sh['beats']:.0f}% ({100 * sh['fdr']:.1f}%)" if sh else '-'
    parts = []
    for mode in ('flat', 'profile'):
        sy = (syn.get(mode) or {}).get(label)
        parts.append(f"{100 * sy['beats']:.0f}% ({100 * sy['fdr']:.0f}%, n̄ {sy['n_mean']:.0f})" if sy and sy.get('beats') is not None
                     else (f"- (n̄ {sy['n_mean']:.0f})" if sy else '-'))
    sys_ = ' / '.join(parts)
    return (f"| {label} | {s['n']} | {s['sessions']} | {100 * s['win']:.0f}% | {100 * s['exp']:+.1f}% [{100 * s['exp_lo']:+.1f}, {100 * s['exp_hi']:+.1f}] | "
            f"{100 * s['exp_nofee']:+.1f}% | {100 * med(trades):+.1f}% | {s['payoff']:.2f} | {shs} | {sys_} |"), s


HEAD = ('| variant | n | sessions | win | expectancy net [95% session CI] | no fee | median | payoff | shuffle: real beats (FDR) | synthetic flat (registered) / 5-min profile (A2): real beats (FDR, mean null n) |\n'
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')


def by(trades, key):
    out = []
    for k in sorted(set(t[key] for t in trades)):
        g = [t for t in trades if t[key] == k]
        e, lo, hi = sim.boot(g, 'ret_fee', n=1000)
        out.append(f'{k} n{len(g)} {100 * e:+.1f}% [{100 * lo:+.1f},{100 * hi:+.1f}]')
    return '; '.join(out)


def session_matrix(tr_by_v):
    days = sorted(set(t['day'] for v in tr_by_v.values() for t in v))
    M = np.full((len(days), len(tr_by_v)), np.nan)
    ix = {d: i for i, d in enumerate(days)}
    for j, v in enumerate(tr_by_v.values()):
        acc = {}
        for t in v:
            acc.setdefault(t['day'], []).append(t['ret_fee'])
        for d, a in acc.items():
            M[ix[d], j] = np.mean(a)
    return M


def main():
    f = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ht.OUT, 'dev.json')
    have = load(f)
    synf = os.path.join(HERE, 'results', 'synthetic_null.json')
    syn = json.load(open(synf)) if os.path.exists(synf) else {}
    from eval.metrics import ledger_trials
    N = ledger_trials()
    out = ['# EDGE-T DEV results', '',
           f'Store: {os.path.basename(f)}; root-sessions with a chain and bars: {len(have)}; sessions: {len(set(r["day"] for r in have.values()))}. '
           f'Net = $0.65/contract/side; win = net > 0; 95% CI = session-clustered bootstrap. Ledger trials N = {N}.', '']
    allv, shs = {}, {}
    # ---------------- H1
    out += ['## H1 OPENING DRIVE', '', HEAD]
    counts = []
    for v in H1V:
        pairs = h1_pairs(have, v)
        tr = [a for a, b, _, _ in pairs if a]
        sh = shuffle(pairs)
        line, s = row(f'H1-{v}', tr, sh, syn)
        out.append(line)
        allv[f'H1-{v}'] = tr
        shs[f'H1-{v}'] = (s, sh)
        n_trig = len(pairs)
        n_nosel = sum(1 for _, _, _, x in pairs if not x['real'].get('sel'))
        n_skip = sum(1 for _, _, _, x in pairs if x['real'].get('skip'))
        n_miss = sum(1 for _, _, _, x in pairs if x['real'].get('missing'))
        counts.append(f'H1-{v}: {n_trig} triggers, {n_nosel} no contract, {n_skip} skipped (fill quote not sane), {n_miss} no 1-s data, {len(tr)} trades')
    out += [''] + ['- ' + c for c in counts] + ['']
    # ---------------- H2
    out += ['', '## H2 TREND DAY (RULES.md; Compass top score replaced by fixed delta)', '', HEAD]
    for v in H2V:
        pairs = h2_pairs(have, v)
        tr = [a for a, b, _, _ in pairs if a]
        sh = shuffle(pairs)
        line, s = row(f'H2-{v}', tr, sh, syn)
        out.append(line)
        allv[f'H2-{v}'] = tr
        shs[f'H2-{v}'] = (s, sh)
    tdays = sorted(set(r['day'] for r in have.values() if r.get('h2_marks')))
    out += ['', f'- Sessions with >= 1 trigger mark: {len(tdays)} ({", ".join(tdays[:60])}{" ..." if len(tdays) > 60 else ""})']
    for v in H2V:
        pairs = h2_pairs(have, v)
        out.append(f'- H2-{v}: {len(pairs)} entry attempts, {sum(1 for _, _, _, x in pairs if not x["real"].get("sel"))} no contract, '
                   f'{sum(1 for _, _, _, x in pairs if x["real"].get("skip"))} skipped (not sane), {len([a for a, *_ in pairs if a])} trades; exits '
                   + str(pd.Series([a['why'] for a, *_ in pairs if a]).value_counts().to_dict()))
    # ---------------- H3
    out += ['', '## H3 EXIT RULES (entries: H1-k0.30-d0.35 real side; same fills, 8 exit cells)', '', HEAD]
    base = {}
    for c in H3V:
        pairs = h1_pairs(have, 'k0.30-d0.35', c)
        tr = [a for a, b, _, _ in pairs if a]
        sh = shuffle(pairs)
        line, s = row(c, tr, sh, syn)
        out.append(line)
        allv[c] = tr
        shs[c] = (s, sh)
    bkey = {(t['root'], t['day']): t for t in allv[BASE_CELL]}
    out += ['', f'Paired difference vs the base cell {BASE_CELL} (= H1-k0.30-d0.35), per trade, net:', '',
            '| cell | n | mean diff [95% session CI] | trades changed | exits |', '|---|---:|---:|---:|---|']
    for c in H3V:
        d = [{'day': t['day'], 'x': t['ret_fee'] - bkey[(t['root'], t['day'])]['ret_fee']} for t in allv[c] if (t['root'], t['day']) in bkey]
        e, lo, hi = sim.boot(d, 'x', n=2000)
        ch = sum(1 for x in d if abs(x['x']) > 1e-9)
        ex = pd.Series([t['why'] for t in allv[c]]).value_counts().to_dict()
        out.append(f'| {c} | {len(d)} | {100 * e:+.2f}% [{100 * lo:+.2f}, {100 * hi:+.2f}] | {ch} | {ex} |')
    # TP left on the table
    tp = [t for t in allv['H3-TP-off-sane'] if t['why'] == 'tp']
    if tp:
        pm = np.array([t['post_max'] for t in tp if t['post_max'] is not None])
        out += ['', f'- TP exits (H3-TP-off-sane): {len(tp)}; the sane bid later reached >= +100% of fill on {np.mean(pm >= 1.0) * 100:.0f}%, '
                f'>= +150% on {np.mean(pm >= 1.5) * 100:.0f}%, median later max {100 * np.median(pm):+.0f}% (the same trades under TR: '
                f'{100 * np.mean([bkey[(t["root"], t["day"])]["ret_fee"] for t in tp]):+.1f}% mean net vs TP\'s {100 * np.mean([t["ret_fee"] for t in tp]):+.1f}%)']
    rv = [t for t in allv['H3-TR-rev-sane'] if t['why'] == 'reversal']
    if rv:
        out.append(f'- Reversal exits (H3-TR-rev-sane): {len(rv)}; mean net {100 * np.mean([t["ret_fee"] for t in rv]):+.1f}% vs the same trades under the base '
                   f'{100 * np.mean([bkey[(t["root"], t["day"])]["ret_fee"] for t in rv]):+.1f}%; later sane max >= fill +10% on '
                   f'{100 * np.mean([(t["post_max"] or -1) >= 0.10 for t in rv]):.0f}%')
    # raw vs sane artefacts
    raw = {(t['root'], t['day']): t for t in allv['H3-TR-off-raw']}
    diff = [(raw[k], bkey[k]) for k in raw if k in bkey and raw[k]['exit_s'] != bkey[k]['exit_s']]
    early = [(a, b) for a, b in diff if a['exit_s'] < b['exit_s'] and a['why'] == 'stop']
    at10 = [a for a, b in early if 36000 <= a['exit_s'] - 2 <= 36006]
    out += [f'- Raw vs sane (TR, no reversal): {len(diff)} of {len(raw)} trades exit at a different time; {len(early)} raw stops fire earlier than the sane '
            f'path (mean net raw {100 * np.mean([a["ret_fee"] for a, b in early]) if early else float("nan"):+.1f}% vs sane {100 * np.mean([b["ret_fee"] for a, b in early]) if early else float("nan"):+.1f}%); '
            f'{len(at10)} of those decided 10:00:00-10:00:06 ET']
    # ---------------- trend dependence
    out += ['', '## Trend-day dependence (descriptive; buckets use the day\'s outcome)', '']
    for v in ['H1-k0.30-d0.35', 'H1-k0.30-d0.20', 'H1-k0.60-d0.35', 'H1-k0.60-d0.20', 'H2-d0.35', 'H2-d0.20']:
        out += [f'### {v}', '', trend_table(allv[v]), '']
    out += ['### H3 cells by SPX day bucket (exp net)', '', '| cell | <0.5% | 0.5-1.5% | >1.5% | held | failed |', '|---|---:|---:|---:|---:|---:|']
    for c in H3V:
        tr = allv[c]
        cells = []
        for fn in (lambda t: bucket(t)[0] == '<0.5%', lambda t: bucket(t)[0] == '0.5-1.5%', lambda t: bucket(t)[0] == '>1.5%',
                   lambda t: bucket(t)[1] is True, lambda t: bucket(t)[1] is False):
            g = [t for t in tr if fn(t)]
            cells.append(f'{100 * np.mean([t["ret_fee"] for t in g]):+.1f}% (n{len(g)})' if g else '-')
        out.append(f'| {c} | ' + ' | '.join(cells) + ' |')
    # ---------------- by root / year
    out += ['', '## By root and year (net)', '']
    for v, tr in allv.items():
        if tr:
            for t in tr:
                t['y'] = t['day'][:4]
            out.append(f'- {v}: roots {by(tr, "root")} | years {by(tr, "y")}')
    # ---------------- PBO / DSR
    srs = {v: shs[v][0].get('sharpe', np.nan) for v in shs if shs[v][0].get('n')}
    sr_var = float(np.nanvar(list(srs.values()), ddof=1)) if len(srs) > 2 else 0.01
    out += ['', '## Overfit control', '']
    for fam, vs in (('H1', [f'H1-{v}' for v in H1V]), ('H2', [f'H2-{v}' for v in H2V]), ('H3', H3V)):
        M = session_matrix({v: allv[v] for v in vs})
        out.append(f'- PBO (CSCV, 16 blocks) {fam} ({len(vs)} configs, {M.shape[0]} sessions): {sim.pbo(M):.2f}')
    out.append(f'- DSR at N = {N} trials (var of per-trade Sharpe across EDGE-T variants {sr_var:.4f}):')
    for v, (s, sh) in shs.items():
        if s.get('n'):
            out.append(f'  - {v}: Sharpe/trade {s["sharpe"]:+.3f}, DSR {sim.dsr(s["sharpe"], s["n"], N, sr_var, s["skew"], s["kurt"]):.3f}')
    # ---------------- bar
    out += ['', '## Protocol bar (DEV gate to VALIDATION: n >= 150, CI > 0, beats >= 95% of both nulls)', '']
    for v, (s, sh) in shs.items():
        if not s.get('n'):
            continue
        bs_ = [((syn.get(m) or {}).get(v) or {}).get('beats') for m in ('flat', 'profile')]
        sb = min(b for b in bs_ if b is not None) if any(b is not None for b in bs_) else None
        ok = bool(s['n'] >= 150 and s['exp_lo'] > 0 and sh and sh['beats'] >= 0.95 and sb is not None and sb >= 0.95)
        out.append(f'- {v}: {"PASS" if ok else "FAIL"} (n {s["n"]}, CI low {100 * s["exp_lo"]:+.1f}%, shuffle {100 * sh["beats"] if sh else float("nan"):.0f}%, '
                   f'synthetic {100 * sb if sb is not None else float("nan"):.0f}%)')
    print('\n'.join(x for x in out if x is not None))
    json.dump({v: {k: (float(x) if isinstance(x, (int, float, np.floating)) else x) for k, x in s.items()} for v, (s, sh) in shs.items()},
              open(os.path.join(HERE, 'results', 'summary.json'), 'w'), indent=1, default=str)


if __name__ == '__main__':
    main()
