"""NOV6 variance-clock synthetic zero-drift null (PREREG.md). Does the pipeline find an "edge" where there is none?

Per DEV root-session with a same-day expiry (x = 0) that the real DEV run built:
  v(m)   = c x (the real day's 5-minute RMS of 1-minute log returns)^2, c set so sum_{m >= 575} v(m) = sig[575]^2 T(575)
           (the generator's remaining-day variance equals the real 09:35 ATM implied variance: no variance premium)
  S      from the real open, 10-second steps, log-return N(-var/2, var), var = v(m)/6 (zero drift, a martingale)
  price  Black-Scholes with total variance W(t) = the generator's REMAINING variance from t to 16:00 (prorated inside
         the minute): a variance clock, so every option mid is a martingale under the generator (checked below)
  board  the real strike grid, quotes = mid -+ h mid (h = the root's real median relative half-spread at the picks),
         bid floored at 0, ticks of $0.01, held for 10 seconds; sig[j] = sqrt(W(60 j) / T_j) (the flat-smile ATM IV)
  flow / vol index: the real ones (R3 / R4 inputs)
Triggers, picks, packages and exits: the same code as the real run (brunner.simulate_event with the synthetic paths).

  python3 bnullsyn.py run N        N runs (seeds 1..N) -> v2data/nov5-broad/syn/sess/<root>_<day>.json, resumable
  python3 bnullsyn.py summary      -> v2data/nov5-broad/syn/summary.json (per variant: beats, FDR) + martingale check
"""
import glob, json, math, os, sys, time, zlib
import numpy as np
import pandas as pd
from scipy.special import ndtr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import brunner as RN  # noqa: E402
import brules as RU  # noqa: E402
import bload as B  # noqa: E402
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2'))
from eval.metrics import cluster_ci_mean  # noqa: E402

SYN = os.path.join(B.OUT, 'syn')
YEAR_MIN = 390.0 * 252
STEP = 10


def bs(S, K, W, call):
    sq = np.sqrt(np.maximum(W, 1e-14))
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    c = S * ndtr(d1) - K * ndtr(d1 - sq)
    return np.where(call, c, c - S + K)


class Synth:
    def __init__(self, d, seed, h):
        self.h = h
        b = d.bars
        c = d.c
        lr = np.diff(np.log(np.r_[d.open, c[:390]]))
        lr = np.where(np.isfinite(lr), lr, 0.0)
        blk = np.repeat(np.sqrt(np.add.reduceat(lr ** 2, np.arange(0, 390, 5)) / 5), 5)[:390]
        blk = np.maximum(blk, 1e-6)
        s0 = d.s(575)
        if not np.isfinite(s0):
            raise ValueError('no 09:35 sig')
        target = s0 * s0 * (960 - 575) / YEAR_MIN
        v = blk ** 2
        cfac = target / v[5:].sum()
        self.v = v * cfac                                    # per minute m = 570 + i
        rng = np.random.default_rng(seed)
        n = 390 * 6
        var = np.repeat(self.v / 6, 6)
        z = rng.standard_normal(n)
        lp = np.log(d.open) + np.r_[0, np.cumsum(-var / 2 + np.sqrt(var) * z)]
        self.t10 = 570 * 60 + STEP * np.arange(n + 1)        # 10-second stamps 09:30:00 .. 16:00:00
        self.S10 = np.exp(lp)
        cumv = np.r_[0, np.cumsum(var)]
        self.Wrem = cumv[-1] - cumv                          # remaining variance at each 10-second stamp
        S1 = self.S10[:-1].reshape(390, 6)
        self.bars = pd.DataFrame({'m': np.arange(570, 960), 'o': S1[:, 0], 'h': np.maximum(S1.max(1), self.S10[6::6]),
                                  'l': np.minimum(S1.min(1), self.S10[6::6]), 'c': self.S10[6::6]})
        ks = np.unique(d.board.k.values.astype(float))
        S_open = d.open
        self.ks = ks[(ks > S_open * 0.85) & (ks < S_open * 1.15)]
        ms = np.arange(571, 960)
        ii = (ms * 60 - self.t10[0]) // STEP
        nk = len(self.ks)
        M = np.repeat(ms, 2 * nk)
        K = np.tile(np.r_[self.ks, self.ks], len(ms))
        R = np.tile(np.r_[np.ones(nk, int), np.zeros(nk, int)], len(ms))
        Sx = np.repeat(self.S10[ii], 2 * nk)
        Wx = np.repeat(self.Wrem[ii], 2 * nk)
        mid = bs(Sx, K, Wx, R == 1)
        bid = np.maximum(np.round(mid * (1 - h) / 0.01) * 0.01, 0.0)
        ask = np.maximum(np.round(mid * (1 + h) / 0.01) * 0.01, bid + 0.01)
        self.board = pd.DataFrame({'m': M, 'k': K, 'r': R, 'bid': bid, 'ask': ask})
        # flat-smile ATM IV per stamp on the trading clock
        self.sig = np.full(RU.M1 - RU.M0 + 2, np.nan)
        for m in range(571, 960):
            i = (m * 60 - self.t10[0]) // STEP
            self.sig[m - RU.M0] = math.sqrt(self.Wrem[i] / ((960 - m) / YEAR_MIN))

    def path(self, k, call, start, end):
        grid = np.arange(start, end + 1)
        j = np.clip((grid - self.t10[0]) // STEP, 0, len(self.t10) - 1)
        mid = bs(self.S10[j], k, self.Wrem[j], call)
        bid = np.maximum(np.round(mid * (1 - self.h) / 0.01) * 0.01, 0.0)
        ask = np.maximum(np.round(mid * (1 + self.h) / 0.01) * 0.01, bid + 0.01)
        return {'s0': start, 'src': 'syn', 'bid': bid, 'ask': ask, 'bs': np.full(len(grid), 10.0),
                'as': np.full(len(grid), 10.0)}

    def mid30(self, delta=0.30):
        """Martingale check: mean mid(t + 30 min) / mid(t) - 1 of the 0.30-delta call and put at each half hour."""
        out = []
        for m in range(600, 931, 30):
            i = (m * 60 - self.t10[0]) // STEP
            S, W = self.S10[i], self.Wrem[i]
            j = i + 180
            for call in (True, False):
                sq = math.sqrt(W)
                # strike with BS |delta| = 0.30 under the generator
                from scipy.stats import norm
                d1 = norm.ppf(delta) if call else -norm.ppf(delta)
                K = S * math.exp(0.5 * W - d1 * sq)
                p0 = float(bs(S, K, W, call))
                p1 = float(bs(self.S10[j], K, self.Wrem[j], call))
                if p0 > 0:
                    out.append((m, p1 / p0 - 1))
        return out


def half_spreads():
    real = []
    for f in glob.glob(os.path.join(RN.RES, 'dev', '*.json')):
        real += json.load(open(f))
    df = pd.DataFrame(real)
    df = df[df.get('bid0', pd.Series(dtype=float)).notna()] if len(df) else df
    out = {}
    for r, g in df.groupby('root'):
        out[r] = float(np.median((g.ask0 - g.bid0) / (g.ask0 + g.bid0)))
    return out


def run(nruns):
    os.makedirs(SYN, exist_ok=True)
    hs = half_spreads()
    sess = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(RN.RES, 'dev', '*.json')))
    RN.DS.NOFETCH = True
    t0 = time.time()
    # session outer, runs inner (the real day's inputs are built once); one file per session: resumable
    for i, s in enumerate(sess):
        f = os.path.join(SYN, 'sess', f'{s}.json')
        if os.path.exists(f):
            continue
        root, day = s.split('_')
        d = RN.dev_day(root, day)
        rows, mart = [], []
        if d is not None and d.x == 0 and root in hs:
            for seed in range(1, nruns + 1):
                try:
                    sy = Synth(d, seed * 100003 + zlib.crc32(s.encode()) % 100003, hs[root])
                except ValueError:
                    break
                sd = RU.Day(root, day, sy.bars, sy.board, x=0, volix=d.volix, flow=d.flow, sig=sy.sig)
                sd.exp, sd.study_D, sd.synth = d.exp, None, sy
                for ev in RU.events(sd, ('R1', 'R2', 'R3', 'R4')):
                    for r in RN.simulate_event(sd, ev, ev['side']):
                        if 'ret_net' in r:
                            rows.append({'seed': seed, 'root': root, 'day': day,
                                         'variant': f"{ev['rule']}-{r['exit_rule']}-{r['expr']}", 'ret_net': r['ret_net']})
                if seed <= 3:
                    mart += [(root, m, x) for m, x in sy.mid30()]
        RN.atomic_json({'rows': rows, 'mart': mart}, f)
        if i % 50 == 0:
            print(time.strftime('%H:%M:%S'), 'session', i, len(sess), f'{time.time() - t0:.0f}s', flush=True)
    print('syn done', flush=True)


def summary():
    real = []
    for f in glob.glob(os.path.join(RN.RES, 'dev', '*.json')):
        real += json.load(open(f))
    real = pd.DataFrame(real)
    real = real[real.ret_net.notna()]
    out, mart, allrows = {}, [], []
    for f in glob.glob(os.path.join(SYN, 'sess', '*.json')):
        z = json.load(open(f))
        mart += z['mart']
        allrows += z['rows']
    per = {}
    A = pd.DataFrame(allrows)
    for seed, df in (A.groupby('seed') if len(A) else []):
        for v, g in df.groupby('variant'):
            lo, hi = cluster_ci_mean(g.ret_net.values, g.day.values)
            per.setdefault(v, []).append((g.ret_net.mean(), lo, len(g)))
    for v, lst in per.items():
        means = np.array([x[0] for x in lst])
        r = real[real.variant == v].ret_net
        out[v] = {'runs': len(lst), 'session_files': len(glob.glob(os.path.join(SYN, 'sess', '*.json'))), 'null_mean': float(means.mean()), 'null_p95': float(np.percentile(means, 95)),
                  'mean_n': float(np.mean([x[2] for x in lst])),
                  'fdr': float(np.mean([x[1] > 0 for x in lst])),
                  'beats': float((r.mean() > means).mean()) if len(r) else float('nan')}
    if mart:
        m = pd.DataFrame(mart, columns=['root', 'm', 'ret'])
        g = m.groupby('m').ret.agg(['mean', 'size']).reset_index()
        out['_martingale'] = [{'half hour': f'{int(a) // 60:02d}:{int(a) % 60:02d}', 'mean 30-min mid return': f'{100 * b:+.2f}%',
                               'n': int(c)} for a, b, c in g.values]
    json.dump(out, open(os.path.join(SYN, 'summary.json'), 'w'), indent=1)
    print(json.dumps(out, indent=1)[:4000])


if __name__ == '__main__':
    if sys.argv[1] == 'run':
        run(int(sys.argv[2]))
    else:
        summary()
