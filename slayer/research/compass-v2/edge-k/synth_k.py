"""EDGE-K N3 synthetic zero-drift null (specs/PREREG.md): python3 synth_k.py [runs] -> results/synthetic_null.json

Every fetched pick of every signal is re-scored on a zero-drift underlying (10-s grid, the real day's 5-minute RMS
1-minute-return profile, EDGE-T A2 convention), the same path for every pick of a signal in a run; option prices are
Black-Scholes in calendar time (EDGE's T) at the contract's entry IV; bid/ask = mid -+ the entry half-spread; the set's
exits (S1 RT, S2 X2) on the 10-s grid; fee $0.65/side. Picks whose real fill was skipped stay skipped.
"""
import glob, json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
import model as M  # noqa: E402
import sim  # noqa: E402
from eval.metrics import cluster_ci_mean  # noqa: E402

V2 = M.OUT
PK = ('Kf', 'A', 'B', 'C', 'D')


def profile5(und, day):
    r, _ = M.returns(und)[day]
    rr = r.copy()
    rr[0] = 0.0 if not np.isfinite(rr[0]) else rr[0]
    blk = np.sqrt(np.array([np.mean(rr[i:i + 5] ** 2) for i in range(0, 390, 5)]))
    return np.repeat(blk, 5)  # per-minute sd


def outcome_paths(setname, lS, secs, cd, iv, h0, scale):
    cfg = M.SET[setname]
    T = np.maximum(960 - secs / 60.0, 0.5) / sim.YEAR_MIN
    S = np.exp(lS) * scale
    mid = M.bs_mid(S, cd['k'], (iv ** 2) * T[None, :], cd['call'])
    bid, ask = np.maximum(mid - h0, 0), mid + h0
    fill = ask[:, 0]
    b = bid[:, 1:]
    peak = np.maximum(np.maximum.accumulate(b, 1), bid[:, :1])
    hit = b <= cfg['stop'] * fill[:, None]
    if cfg['kind'] == 'RT':
        hit |= (peak >= cfg['arm'] * fill[:, None]) & (b <= cfg['trail'] * peak)
    else:
        hit |= (np.maximum.accumulate(b, 1) >= cfg['arm'] * fill[:, None]) & (b <= cfg['trail'] * peak)
    j = np.where(hit.any(1), hit.argmax(1), b.shape[1] - 1)
    bx = b[np.arange(b.shape[0]), j]
    return (100 * bx - 0.65) / (100 * fill + 0.65) - 1


def main(runs=100):
    out = {}
    for setname in ('S1', 'S2'):
        cfg = M.SET[setname]
        res = {p: [[] for _ in range(runs)] for p in PK + ('K',)}
        days = {p: [] for p in PK + ('K',)}
        pairs = [[] for _ in range(runs)]
        pdays = []
        for f in sorted(glob.glob(os.path.join(V2, 'res', '*.json'))):
            for ch in json.load(open(f)):
                s = ch['sig']
                if s['set'] != setname:
                    continue
                und = M.UND[s['root']]
                if s['day'] not in M.returns(und):
                    continue
                sd = profile5(und, s['day'])
                secs = np.arange(s['t'], cfg['flat_s'] + 1, 10).astype(float)
                m = np.clip((secs[1:] - 1) // 60 - 570, 0, 389).astype(int)
                rng = np.random.default_rng(M.fold(s['day']) * 100003 + int(s['t']) + hash(s['root']) % 997)
                inc = rng.standard_normal((runs, len(m))) * sd[m][None, :] * math.sqrt(10 / 60.0)
                inc -= 0.5 * (sd[m][None, :] ** 2) * (10 / 60.0)
                lS = math.log(s['S']) + np.c_[np.zeros(runs), np.cumsum(inc, 1)]
                got = {}
                for p in PK:
                    pk = ch['picks'].get(p)
                    if not pk or 'ret_fee' not in (pk.get('out') or {}) or not pk.get('iv'):
                        continue
                    h0 = pk.get('h0', (pk['ask'] - pk['bid']) / 2)
                    scale = 0.1 if pk['root'] == 'XSP' else 1.0
                    r = outcome_paths(setname, lS, secs, pk, pk['iv'], h0, scale)
                    got[p] = r
                    for i in range(runs):
                        res[p][i].append(r[i])
                    days[p].append(s['day'])
                if 'Kf' in got and (ch.get('er_max') or 0) > 0:
                    for i in range(runs):
                        res['K'][i].append(got['Kf'][i])
                    days['K'].append(s['day'])
                if 'Kf' in got and 'A' in got:
                    for i in range(runs):
                        pairs[i].append(got['Kf'][i] - got['A'][i])
                    pdays.append(s['day'])
        o = {}
        for p in PK + ('K',):
            if not days[p]:
                continue
            means = [float(np.mean(res[p][i])) for i in range(runs)]
            passes = sum(cluster_ci_mean(res[p][i], days[p], n_boot=300, seed=i)[0] > 0 for i in range(runs))
            o[p] = {'n': len(days[p]), 'mean': float(np.mean(means)), 'p5': float(np.percentile(means, 5)),
                    'p95': float(np.percentile(means, 95)), 'fdr': passes / runs}
        if pdays:
            dm = [float(np.mean(pairs[i])) for i in range(runs)]
            passes = sum(cluster_ci_mean(pairs[i], pdays, n_boot=300, seed=i)[0] > 0 for i in range(runs))
            o['Kf-A'] = {'n': len(pdays), 'mean': float(np.mean(dm)), 'p95': float(np.percentile(dm, 95)), 'fdr': passes / runs}
        out[setname] = o
        print(setname, json.dumps(o, indent=1), flush=True)
    json.dump(out, open(os.path.join(HERE, 'results', 'synthetic_null.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 100)
