"""E1-E3 (specs/PREREG.md): triggers, both sides' contracts on 1-second quotes, every pre-registered variant.

  python3 hyp.py E1 DEV        materialise (fetches 1-second quotes, one request in flight) and print the tables
  python3 hyp.py E1 DEV --nofetch

Per trigger both sides are simulated (the real side and the opposite), so the shuffled-signal null needs no new data.
Results cached in v2data/edge/results/<H>_<SET>.json.
"""
import json, math, os, sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim
import fetch as F

OUTD = os.path.join(sim.ROOT, 'results')
RULE_X1 = {'stop': 0.5}
RULE_TR = {'stop': 0.5, 'trail_arm': 1.25, 'trail': 0.75}


def gex(root, day, S, iv):
    f = os.path.join(sim.ROOT, 'oi', root, f'{day}.parquet')
    if not os.path.exists(f) or not np.isfinite(S) or not np.isfinite(iv):
        return np.nan
    o = pd.read_parquet(f)
    if not len(o):
        return np.nan
    o = o[(o.e <= 30) & (np.abs(o.k / S - 1) <= 0.10)]
    T = (np.maximum(o.e.values, 0) * 390 + 360) / sim.YEAR_MIN  # the 0DTE: ~6 h left at 10:00
    g = sim.bs_gamma(S, o.k.values, T, iv)
    sign = np.where(o.r.values == 1, 1.0, -1.0)
    gx = float(np.sum(sign * g * o.oi.values) * S * S * 0.01)
    gross = float(np.sum(g * o.oi.values) * S * S * 0.01)
    return gx / gross if gross > 0 else np.nan


def atm_iv(root, day, t_sec, S):
    b = sim.board(root, day, t_sec)
    if b is None:
        return np.nan
    T = max(960 - t_sec / 60.0, 1.0) / sim.YEAR_MIN
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    if not len(b):
        return np.nan
    k = b.k.values[np.argmin(np.abs(b.k.values - S))]
    x = b[b.k == k]
    v = sim.implied_vol((x.bid.values + x.ask.values) / 2, S, x.k.values, T, x.r.values == 1)
    v = v[np.isfinite(v)]
    return float(v.mean()) if len(v) else np.nan


# ---------------------------------------------------------------- triggers


def trig_e1(root, day):
    bars = sim.day_bars(root, day)
    if len(bars) < 300:
        return None
    pc, sd = sim.prior_close_and_vol(root, day)
    t = 15 * 3600 + 25 * 60
    S = sim.spot_at(bars, t)
    if not (np.isfinite(pc) and np.isfinite(sd) and np.isfinite(S)):
        return None
    r = math.log(S / pc)
    z = abs(r) / sd
    if z < 0.5:
        return None
    w = bars[(bars.m >= 900) & (bars.m <= 924)].c.values
    s1m = float(np.std(np.diff(np.log(w)), ddof=1)) if len(w) > 5 else np.nan
    return {'t': t, 't_end': 15 * 3600 + 58 * 60 + 30, 'up': r > 0, 'z': z, 'S': S, 'sd': sd, 's1m': s1m,
            'band': (0.25, 0.50, 0.35), 'bars': None}


def trig_e2(root, day):
    bars = sim.day_bars(root, day)
    if len(bars) < 300:
        return None
    pc, sd = sim.prior_close_and_vol(root, day)
    t = 10 * 3600
    mb = bars[(bars.m >= 570) & (bars.m <= 599)]
    if len(mb) < 25 or not np.isfinite(sd):
        return None
    O = float(mb.o.iloc[0])
    S = float(mb.c.iloc[-1])
    m = math.log(S / O)
    X = float(mb.h.max()) if m > 0 else float(mb.l.min())
    if X == O:
        return None
    pull = (X - S) / (X - O)
    a = abs(m) / sd
    if a < 0.35 or pull < 0.25:
        return None
    return {'t': t, 't_end': 12 * 3600, 'up': m < 0, 'z': a, 'S': S, 'sd': sd, 'O': O, 'X': X, 'm': m, 'pull': pull,
            'band': (0.20, 0.45, 0.30)}


def trig_e3(root, day):
    bars = sim.day_bars(root, day)
    if len(bars) < 300:
        return None
    orb = bars[(bars.m >= 570) & (bars.m <= 599)]
    if len(orb) < 25:
        return None
    hi, lo = float(orb.h.max()), float(orb.l.min())
    S0 = float(orb.c.iloc[-1])
    later = bars[(bars.m >= 600) & (bars.m <= 779)]
    out = later[(later.c > hi) | (later.c < lo)]
    if not len(out):
        return None
    m = int(out.m.iloc[0])
    c = float(out.c.iloc[0])
    t = (m + 1) * 60
    iv = atm_iv(root, day, 600 * 60, S0)
    g = gex(root, day, S0, iv)
    return {'t': t, 't_end': 15 * 3600 + 30 * 60, 'up': c > hi, 'z': np.nan, 'S': c, 'hi': hi, 'lo': lo, 'gex': g,
            'band': (0.25, 0.50, 0.35)}


def pin_strike(root, day, S):
    f = os.path.join(sim.ROOT, 'oi', root, f'{day}.parquet')
    if not os.path.exists(f) or not np.isfinite(S):
        return np.nan
    o = pd.read_parquet(f)
    if not len(o):
        return np.nan
    o = o[(o.e == 0) & (np.abs(o.k / S - 1) <= 0.03)]
    if not len(o):
        return np.nan
    g = o.groupby('k')['oi'].sum()
    return float(g.idxmax())


def trig_e6(root, day):
    bars = sim.day_bars(root, day)
    if len(bars) < 300:
        return None
    t = 15 * 3600
    S = sim.spot_at(bars, t)
    K = pin_strike(root, day, S)
    iv = atm_iv(root, day, t, S)
    if not (np.isfinite(K) and np.isfinite(iv)):
        return None
    T = 60 / sim.YEAR_MIN
    d = (K - S) / (S * iv * math.sqrt(T))
    if abs(d) < 0.5 or abs(d) > 2.0:
        return None
    return {'t': t, 't_end': 15 * 3600 + 50 * 60, 'up': K > S, 'z': abs(d), 'S': S, 'K': K, 'band': (0.25, 0.50, 0.35)}


TRIG = {'E1': trig_e1, 'E2': trig_e2, 'E3': trig_e3, 'E6': trig_e6}


def under_rule_e6(bars, tr):
    closes = dict(zip(bars.m.values.tolist(), bars.c.values.tolist()))
    K, up = tr['K'], tr['up']

    def rule(mm):
        c = closes.get(mm - 1)
        if c is None:
            return False
        return c >= K if up else c <= K
    return rule


# ---------------------------------------------------------------- variants


def under_rule_e2(bars, tr, real_side):
    """Y1's underlying exits for the contract on side real_side (True = the reversal side, the trigger's)."""
    O, X = tr['O'], tr['X']
    L = O + 0.5 * (X - O)
    closes = dict(zip(bars.m.values.tolist(), bars.c.values.tolist()))
    up_move = tr['m'] > 0

    def rule(mm):  # bar mm-1 closed at mm*60
        c = closes.get(mm - 1)
        if c is None:
            return False
        retraced = c <= L if up_move else c >= L
        beyond = c > X if up_move else c < X
        return retraced or beyond  # for either side the trade's thesis is resolved
    return rule


def under_rule_e3(bars, tr):
    mid = 0.5 * (tr['hi'] + tr['lo'])
    closes = dict(zip(bars.m.values.tolist(), bars.c.values.tolist()))
    up = tr['up']

    def rule(mm):
        c = closes.get(mm - 1)
        if c is None:
            return False
        return c < mid if up else c > mid
    return rule


def variants(H, tr, sel, bars):
    """{variant name: (rules, under_rule or None, eligible)} for one trigger and one selected contract."""
    v = {}
    if H == 'E1':
        tp = sel['delta'] * tr['S'] * tr['s1m'] * math.sqrt(35) if np.isfinite(tr.get('s1m', np.nan)) else None
        for z in (0.5, 1.0):
            ok = tr['z'] >= z
            v[f'z{z}-X1'] = (RULE_X1, None, ok)
            v[f'z{z}-X2'] = (RULE_TR, None, ok)
            v[f'z{z}-X3'] = ({'stop': 0.5, 'tp_abs': tp}, None, ok and tp is not None)
    elif H == 'E2':
        ur = under_rule_e2(bars, tr, True)
        for a in (0.35, 0.60):
            ok = tr['z'] >= a
            v[f'a{a}-Y1'] = (RULE_X1, ur, ok)
            v[f'a{a}-Y2'] = (RULE_TR, ur, ok)
    elif H == 'E6':
        ur = under_rule_e6(bars, tr)
        v['P1'] = (RULE_X1, ur, True)
        v['P2'] = (RULE_TR, ur, True)
    elif H == 'E3':
        ur = under_rule_e3(bars, tr)
        g = tr['gex']
        v['gex<0-Z1'] = (RULE_X1, ur, np.isfinite(g) and g < 0)
        v['gex<0-Z2'] = (RULE_TR, ur, np.isfinite(g) and g < 0)
        v['gex>=0-Z1 (contrast)'] = (RULE_X1, ur, np.isfinite(g) and g >= 0)
        v['gex>=0-Z2 (contrast)'] = (RULE_TR, ur, np.isfinite(g) and g >= 0)
    return v


CHUNK = 1800


def chunked(root, d, sel, call, tr, bars, vs):
    """Fetch the 1-second path in 30-minute chunks, only as far as some variant still holds the position: a trade's
    decisions use only quotes up to each decision, so extending the path never changes an earlier exit."""
    end = tr['t_end'] + 30
    a = int(tr['t'])
    parts, res = [], {}
    pending = dict(vs)
    while pending and a < end:
        b = min(a + CHUNK, end)
        q = sim.q1s(root, d, sel['k'], call, a, b)
        if q is None:
            return res, None
        parts.append(q)
        path = {x: np.concatenate([p[x] for p in parts]) for x in parts[0]}
        last = int(path['s'][-1]) if len(path['s']) else b
        for name, (rules, ur, ok) in list(pending.items()):
            out = sim.run_trade(path, tr['t'], tr['t_end'], rules, bars, ur)
            if out is None and b >= end:
                pending.pop(name)
                continue
            if out is None:
                continue
            closed = out['exit_s'] < last - 1 or b >= end
            if closed:
                res[name] = out
                pending.pop(name)
        a = b + 1
    return res, path if parts else None


def materialise(H, which, fetch_ok=True):
    os.makedirs(OUTD, exist_ok=True)
    f = os.path.join(OUTD, f'{H}_{which}{os.environ.get("EDGE_SUFFIX", "")}.json')
    have = json.load(open(f)) if os.path.exists(f) else {}
    days = F.want_days(which)
    if os.environ.get('EDGE_FROM'):  # a second worker over a disjoint later range, newest first (merged after)
        days = [d for d in days if d >= os.environ['EDGE_FROM']][::-1]
    if os.environ.get('EDGE_TO'):
        days = [d for d in days if d < os.environ['EDGE_TO']]
    n_new = 0
    for d in days:
        for root in F.ROOTS:
            key = f'{root}|{d}'
            if key in have:
                continue
            if d not in F.expirations(root) or sim.chain(root, d) is None:
                continue
            tr = TRIG[H](root, d)
            if tr is None:
                have[key] = None
                continue
            bars = sim.day_bars(root, d)
            rec = {'root': root, 'day': d, 'trig': {k: (bool(x) if isinstance(x, (bool, np.bool_)) else (float(x) if isinstance(x, (int, float, np.floating)) else x)) for k, x in tr.items() if k not in ('band', 'bars')}, 'sides': {}}
            lo, hi, tgt = tr['band']
            for side_name, call in (('real', tr['up']), ('opp', not tr['up'])):
                sel = sim.select(root, d, tr['t'], call, lo, hi, tgt, tr['S'])
                if sel is None:
                    rec['sides'][side_name] = None
                    continue
                vs = {n: x for n, x in variants(H, tr, sel, bars).items() if x[2]}
                res, f1 = chunked(root, d, sel, call, tr, bars, vs) if fetch_ok else ({}, None)
                if f1 is None:
                    rec['sides'][side_name] = {'sel': sel, 'res': None, 'missing': True}
                    continue
                rec['sides'][side_name] = {'sel': sel, 'res': res}
                n_new += 1
            have[key] = rec
            if n_new and n_new % 40 == 0:
                json.dump(have, open(f, 'w'))
                print(f'{H} {which}: {sum(1 for x in have.values() if x)} triggers, at {d}', flush=True)
    json.dump(have, open(f, 'w'))
    return have


def trades(have, variant, side='real'):
    out = []
    for key, rec in have.items():
        if not rec:
            continue
        s = rec['sides'].get(side)
        if not s or not s.get('res') or variant not in s['res']:
            continue
        t = dict(s['res'][variant])
        t.update(day=rec['day'], root=rec['root'], call=s['sel']['call'], delta=s['sel']['delta'])
        out.append(t)
    return out


def variant_names(H):
    return {'E1': [f'z{z}-{x}' for z in (0.5, 1.0) for x in ('X1', 'X2', 'X3')],
            'E2': [f'a{a}-{y}' for a in (0.35, 0.60) for y in ('Y1', 'Y2')],
            'E6': ['P1', 'P2'],
            'E3': ['gex<0-Z1', 'gex<0-Z2', 'gex>=0-Z1 (contrast)', 'gex>=0-Z2 (contrast)']}[H]


def shuffle_null(have, variant, draws=200, seed=0):
    """Same triggers and times, side by a fair coin. Returns the null expectancies and the fraction that 'pass'."""
    rng = np.random.default_rng(seed)
    pairs = []
    for rec in have.values():
        if not rec:
            continue
        r, o = rec['sides'].get('real'), rec['sides'].get('opp')
        if not r or not o or not r.get('res') or not o.get('res') or variant not in r['res'] or variant not in o['res']:
            continue
        pairs.append((rec['day'], r['res'][variant]['ret_fee'], o['res'][variant]['ret_fee']))
    if not pairs:
        return None
    exps, passes = [], 0
    for _ in range(draws):
        coin = rng.random(len(pairs)) < 0.5
        tr = [{'day': d, 'ret_fee': (a if c else b)} for (d, a, b), c in zip(pairs, coin)]
        e, lo, hi = sim.boot(tr, 'ret_fee', n=400, seed=int(rng.integers(1e9)))
        exps.append(e)
        passes += (lo > 0)
    real = [{'day': d, 'ret_fee': a} for d, a, b in pairs]
    e_real = sim.boot(real, 'ret_fee', n=10)[0]
    return {'n_pairs': len(pairs), 'real': e_real, 'null_mean': float(np.mean(exps)), 'null_p95': float(np.percentile(exps, 95)),
            'beats': float(np.mean(np.array(exps) < e_real)), 'fdr': passes / draws}


def report(H, which, have):
    lines = [f'## {H} on {which}', '', sim.HEAD]
    rows = {}
    for v in variant_names(H):
        tr = trades(have, v)
        s = sim.summary(tr, v)
        rows[v] = (s, tr)
        lines.append(sim.fmt(s))
    lines += ['', 'Shuffled-signal null (same triggers/times, side by coin, 200 draws):', '',
              '| variant | pairs | real exp | null mean | null p95 | real beats null | null FDR |', '|---|---:|---:|---:|---:|---:|---:|']
    for v in variant_names(H):
        z = shuffle_null(have, v)
        if z:
            lines.append(f"| {v} | {z['n_pairs']} | {100 * z['real']:+.1f}% | {100 * z['null_mean']:+.1f}% | {100 * z['null_p95']:+.1f}% | {100 * z['beats']:.0f}% | {100 * z['fdr']:.1f}% |")
    return '\n'.join(lines), rows


if __name__ == '__main__':
    H, which = sys.argv[1], sys.argv[2]
    have = materialise(H, which, fetch_ok='--nofetch' not in sys.argv)
    print(report(H, which, have)[0])
