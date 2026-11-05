"""Attack 1/3/5/8: rebuild K5 from the raw overnight chain (fetch_chain.py: +-40 strikes, 1-minute NBBO, 00:00-09:30)
with THREE candidate universes, everything else as the spec:
  gate='open'  : the as-tested Book A gate, strike within 4 strikes (20 pts) of the ATM at day D's 09:30 OPEN
                 (what the replay's tapeOf returned for every pre-open mark: retOpen == 0 on every overnight row).
                 Reproduces the locked calls.
  gate='spot'  : the same gate measured from the parity spot AT THE MARK (what a live engine would see).
  gate='none'  : no strike gate: every 0.10-0.20 |delta| contract on the side of the overnight move.
Signal, strike choice, fill (ask one minute after the mark), hard exit (1.50x / 0.4678x on the bid, flat 09:20) are the
spec's. Also: side-shuffled nulls, the anti-signal, a synthetic zero-drift null, and the CSCV neighbourhood
(delta band x TP x stop, 27 configurations) for PBO.
"""
import os, sys, json, math, time
import numpy as np, pandas as pd
from scipy.stats import norm
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rt

CH = '/home/user/falcon-cloud-field-sail/v2data/redteam/chain1m'
R = 0.042
MARKS = list(range(0, 360, 5))          # 00:00 .. 05:55 (c1 225..584 on the 5-minute scan grid)
FLAT = 9 * 60 + 20                      # 09:20
TP, SL = 1.5, 0.4678
GATES = ('open', 'spot', 'none')
BANDS = {'d10': (0.05, 0.15, 0.10), 'd15': (0.10, 0.20, 0.15), 'd20': (0.15, 0.25, 0.20)}
TPS = (1.4, 1.5, 1.6)
SLS = (0.45, 0.4678, 0.6)
_bars_cache = {}


def bars_month(month):
    if month not in _bars_cache:
        import gzip, io
        f = os.path.join(rt.CHAL, 'data', 'bars', 'SPX', f'{month}.csv.gz')
        _bars_cache[month] = pd.read_csv(io.StringIO(gzip.open(f, 'rt').read()), header=None, names=['key', 'o', 'h', 'l', 'c', 'v']) if os.path.exists(f) else pd.DataFrame(columns=['key', 'o', 'h', 'l', 'c', 'v'])
    return _bars_cache[month]


def spx_day(day):
    b = bars_month(day[:7])
    return b[b.key.str.startswith(day)]


def prior_close(day):
    d = pd.Timestamp(day)
    for k in range(1, 8):
        p = (d - pd.Timedelta(days=k)).strftime('%Y-%m-%d')
        b = spx_day(p)
        b = b[b.key.str.slice(11, 16) <= '16:00']
        if len(b):
            return float(b.c.iloc[-1]), p
    return np.nan, None


def open_of(day):
    b = spx_day(day)
    o = b[b.key.str.endswith('09:30')]
    return float(o.o.iloc[0]) if len(o) else np.nan


def close_of(day):
    b = spx_day(day)
    b = b[b.key.str.slice(11, 16) <= '16:00']
    return float(b.c.iloc[-1]) if len(b) else np.nan


def bs_price_v(S, K, T, iv, call):
    """Vectorised Black-Scholes price; K, iv, call arrays."""
    iv = np.maximum(iv, 1e-6)
    sq = math.sqrt(T)
    d1 = (np.log(S / K) + (R + 0.5 * iv * iv) * T) / (iv * sq)
    d2 = d1 - iv * sq
    c = S * norm.cdf(d1) - K * math.exp(-R * T) * norm.cdf(d2)
    p = K * math.exp(-R * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
    return np.where(call, c, p)


def bs_delta_v(S, K, T, iv, call):
    d1 = (np.log(S / K) + (R + 0.5 * iv * iv) * T) / (np.maximum(iv, 1e-6) * math.sqrt(T))
    return np.where(call, norm.cdf(d1), norm.cdf(d1) - 1)


def implied_vol_v(mid, S, K, T, call, iters=50):
    lo = np.full(len(K), 0.01); hi = np.full(len(K), 5.0)
    ok = (bs_price_v(S, K, T, lo, call) <= mid) & (bs_price_v(S, K, T, hi, call) >= mid)
    for _ in range(iters):
        m = 0.5 * (lo + hi)
        above = bs_price_v(S, K, T, m, call) > mid
        hi = np.where(above, m, hi); lo = np.where(above, lo, m)
    return np.where(ok, 0.5 * (lo + hi), np.nan)


def parity_spot(board, T):
    c = board[board.right == 'C'].set_index('strike').mid
    p = board[board.right == 'P'].set_index('strike').mid
    j = c.index.intersection(p.index)
    if not len(j):
        return np.nan
    gap = (c[j] - p[j]).abs().sort_values()
    near = gap.index[:3]
    f = np.sort([k + (c[k] - p[k]) * math.exp(R * T) for k in near])
    return float(f[len(f) // 2] * math.exp(-R * T))


def settle(path, fill_min, tp=TP, sl=SL):
    """path: arrays (min, bid, ask) sorted; fill = ask at the first minute >= fill_min (<= 2 minutes late, as
    settleSignal's three-minute wait), exit on the bid path strictly after the fill minute through 09:20."""
    mn, bid, ask = path
    i = np.flatnonzero((mn >= fill_min) & (mn <= fill_min + 2) & (ask > 0))
    if not len(i):
        return None
    fmin, fill = int(mn[i[0]]), float(ask[i[0]])
    a = (mn > fmin) & (mn <= FLAT) & (ask > 0)
    bids = bid[a]
    if not len(bids):
        return None
    hit = np.flatnonzero(bids >= fill * tp)
    pre = bids[:hit[0]] if len(hit) else bids
    worst = pre.min() / fill if len(pre) else 1.0
    if len(hit) and worst > sl:
        return dict(fill=fill, ret=tp - 1, win=True, why='tp', fill_min=fmin)
    if worst <= sl:
        return dict(fill=fill, ret=sl - 1, win=False, why='sl', fill_min=fmin)
    return dict(fill=fill, ret=float(bids[-1] / fill - 1), win=False, why='flat', fill_min=fmin)


def day_features(day):
    """Every 5-minute mark 00:00-05:55: the board with |delta|, c33 (side of the move vs the prior close), spread gate,
    strike distance to the ATM at the open and at the mark's spot. Returns (chain, info, list of per-mark frames)."""
    f = os.path.join(CH, f'{day}.parquet')
    if not os.path.exists(f):
        return None
    chain = pd.read_parquet(f)
    pc, _ = prior_close(day)
    op = open_of(day)
    if not (pc > 0):
        return None
    valid = chain[(chain.ask > 0) & (chain.bid >= 0) & (chain.ask >= chain.bid)]
    marks = []
    for m in MARKS:
        b = valid[valid['min'] == m].copy()
        if len(b) < 6:
            continue
        b['mid'] = (b.bid + b.ask) / 2
        T = (16 * 60 - m) / 1440 / 365
        S = parity_spot(b, T)
        if not (S > 0):
            continue
        K = b.strike.to_numpy(float); call = (b.right == 'C').to_numpy(); mid = b.mid.to_numpy(float)
        ivc = implied_vol_v(mid, S, K, T, call)
        katm = K[np.abs(K - S).argmin()]
        atm = ivc[(K == katm) & np.isfinite(ivc) & (ivc > 0.011)]
        iv = float(atm.mean()) if len(atm) else np.nan
        use = np.where(np.isfinite(ivc) & (ivc > 0.011), ivc, iv if iv > 0.011 else 0.3)
        dl = np.abs(bs_delta_v(S, K, T, use, call))
        dirn = np.where(call, 1.0, -1.0)
        x = pd.DataFrame({'strike': K, 'right': b.right.to_numpy(), 'bid': b.bid.to_numpy(float), 'ask': b.ask.to_numpy(float), 'mid': mid,
                          'iv': use, 'delta': dl, 'c33': dirn * math.log(S / pc),
                          'spread_ok': (b.bid.to_numpy(float) > 0.15) & ((b.ask.to_numpy(float) - b.bid.to_numpy(float)) / mid <= 0.08 + 1e-9),
                          'dist_open': np.abs(K - round(op / 5) * 5) if op > 0 else np.nan,
                          'dist_spot': np.abs(K - round(S / 5) * 5)})
        marks.append(dict(m=m, S=S, iv=iv, x=x))
    return dict(day=day, chain=chain, prior_close=pc, open=op, close=close_of(day), marks=marks)


def contract_path(chain, strike, right):
    p = chain[(chain.strike == strike) & (chain.right == right)].sort_values('min')
    return (p['min'].to_numpy(int), p.bid.to_numpy(float), p.ask.to_numpy(float))


def select(feat, gate, band='d15'):
    """The spec's choice: the first mark with an eligible row, the strike nearest the band's centre delta; also the
    opposite side's nearest contract at that mark (anti / shuffle null)."""
    dlo, dhi, dctr = BANDS[band]
    for mk in feat['marks']:
        x = mk['x']
        base = x[(x.delta >= dlo) & (x.delta <= dhi) & x.spread_ok]
        e = base[base.c33 > 0]
        if gate == 'open':
            e = e[e.dist_open <= 20]
        elif gate == 'spot':
            e = e[e.dist_spot <= 20]
        if not len(e):
            continue
        e = e.assign(score=1 - (e.delta - dctr).abs()).sort_values('score', ascending=False)
        pick = e.iloc[0]
        path = contract_path(feat['chain'], pick.strike, pick.right)
        s = settle(path, mk['m'] + 1)
        if s is None:
            continue
        o = base[base.right != pick.right]
        anti = None
        if len(o):
            o = o.assign(score=1 - (o.delta - dctr).abs()).sort_values('score', ascending=False).iloc[0]
            sa = settle(contract_path(feat['chain'], o.strike, o.right), mk['m'] + 1)
            if sa:
                anti = dict(strike=float(o.strike), right=o.right, delta=float(o.delta), iv=float(o.iv), bid=float(o.bid), ask=float(o.ask), **sa)
        m = mk['m']
        return dict(day=feat['day'], mark=f'{m//60:02d}:{m%60:02d}', mark_min=m, strike=float(pick.strike), right=pick.right, delta=float(pick.delta),
                    iv=float(pick.iv), bid=float(pick.bid), ask=float(pick.ask), S=mk['S'], open=feat['open'], close=feat['close'],
                    prior_close=feat['prior_close'], atm_iv=mk['iv'], c33=float(pick.c33), anti=anti, **s)
    return None


def boot_ci(r, n=4000, seed=7):
    rng = np.random.default_rng(seed)
    r = np.asarray(r, float)
    if len(r) < 2:
        return (np.nan, np.nan)
    m = rng.choice(r, (n, len(r))).mean(1)
    return (float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5)))


def summarize(calls, label):
    t = pd.DataFrame([c for c in calls if c])
    if not len(t):
        return f'{label}: 0 calls'
    r = t.ret.to_numpy(float); w = t.win.to_numpy(bool)
    lo, hi = boot_ci(r); wlo, whi = boot_ci(w.astype(float))
    by = t.groupby(t.day.str.slice(0, 4)).agg(n=('ret', 'size'), win=('win', 'mean'), ret=('ret', 'mean'))
    yrs = ' | '.join(f"{y}: n={int(g.n)} win {100*g.win:.0f}% {100*g.ret:+.1f}%" for y, g in by.iterrows())
    return (f"{label}: n={len(t)}, win {100*w.mean():.1f}% [{100*wlo:.1f}, {100*whi:.1f}], expectancy {100*r.mean():+.1f}% [{100*lo:+.1f}, {100*hi:+.1f}], "
            f"exits {t.why.value_counts().to_dict()}\n    {yrs}")


def synthetic_null(c, rv, n_paths=300, seed=5):
    """Zero-drift GBM of the spot from the fill minute to 09:20 at the night's realised vol; the option's bid/ask from
    Black-Scholes at the contract's own IV with the quoted half-spread; the spec's hard exit. P(win) and E[ret]."""
    rng = np.random.default_rng(seed)
    m0 = c['fill_min']; K = c['strike']; call = c['right'] == 'C'; iv = c['iv'] if c['iv'] > 0.011 else c['atm_iv']
    hs = (c['ask'] - c['bid']) / 2
    steps = FLAT - m0
    dt = 1 / 1440 / 365
    S0 = c['S']
    z = rng.standard_normal((n_paths, steps))
    S = S0 * np.exp(np.cumsum(-0.5 * rv * rv * dt + rv * math.sqrt(dt) * z, axis=1))
    T0 = (16 * 60 - m0) / 1440 / 365
    fill = bs_price_v(S0, np.array([K]), T0, np.array([iv]), np.array([call]))[0] + hs
    if not (fill > 0.15):
        return np.nan, np.nan
    Ts = np.maximum((16 * 60 - (m0 + 1 + np.arange(steps))) / 1440 / 365, 1e-7)[None, :]
    sq = np.sqrt(Ts)
    d1 = (np.log(S / K) + (R + 0.5 * iv * iv) * Ts) / (iv * sq)
    d2 = d1 - iv * sq
    disc = np.exp(-R * Ts)
    mids = S * norm.cdf(d1) - K * disc * norm.cdf(d2) if call else K * disc * norm.cdf(-d2) - S * norm.cdf(-d1)
    bids = np.maximum(mids - hs, 0)
    tp_hit = bids >= fill * TP
    sl_hit = bids <= fill * SL
    first_tp = np.where(tp_hit.any(1), tp_hit.argmax(1), steps + 1)
    first_sl = np.where(sl_hit.any(1), sl_hit.argmax(1), steps + 1)
    wins = (first_tp <= steps) & (first_tp < first_sl)
    stops = (first_sl <= steps) & ~wins
    rets = np.where(wins, TP - 1, np.where(stops, SL - 1, bids[:, -1] / fill - 1))
    return float(wins.mean()), float(rets.mean())


if __name__ == '__main__':
    days = rt.locked_days()
    t0 = time.time()
    res, cscv, marks_diag = {}, {g: {} for g in GATES}, []
    for i, d in enumerate(days):
        feat = day_features(d)
        if feat is None:
            print('no chain', d); continue
        rv = np.nan
        Ss = np.array([mk['S'] for mk in feat['marks']])
        if len(Ss) > 10:
            rv = float(np.std(np.diff(np.log(Ss))) * math.sqrt(252 * 78 * 5 / 5))   # 5-minute changes, annualised (78*5 five-minute bars a day basis)
            rv = float(np.std(np.diff(np.log(Ss))) * math.sqrt(1440 / 5 * 365))     # calendar-time annualisation (overnight quotes run around the clock)
        for mk in feat['marks']:
            x = mk['x']; b = x[(x.delta >= 0.10) & (x.delta <= 0.20) & x.spread_ok]
            marks_diag.append(dict(day=d, mark=mk['m'], S=mk['S'], open=feat['open'], close=feat['close'], prior_close=feat['prior_close'], atm_iv=mk['iv'],
                                   n_band_C=int((b.right == 'C').sum()), n_band_P=int((b.right == 'P').sum()),
                                   n_band_open_gate=int((b.dist_open <= 20).sum()), n_band_spot_gate=int((b.dist_spot <= 20).sum())))
        res[d] = {}
        for g in GATES:
            c = select(feat, g, 'd15')
            if c is not None:
                c['rv_night'] = rv
            res[d][g] = c
            # the CSCV neighbourhood: 3 delta bands x 3 TP x 3 stops, per-session return (0 = no call)
            for band in BANDS:
                cb = c if band == 'd15' else select(feat, g, band)
                for tp in TPS:
                    for sl in SLS:
                        key = f'{band}|tp{tp}|sl{sl}'
                        r = 0.0
                        if cb is not None:
                            s = settle(contract_path(feat['chain'], cb['strike'], cb['right']), cb['mark_min'] + 1, tp, sl)
                            r = s['ret'] if s else 0.0
                        cscv[g].setdefault(key, {})[d] = r
        if i % 20 == 0:
            print(f'[{i+1}/{len(days)}] {d} {time.time()-t0:.0f}s', flush=True)
    json.dump(res, open('k5_honest_calls.json', 'w'), indent=1, default=float)
    json.dump(cscv, open('k5_honest_cscv.json', 'w'), default=float)
    pd.DataFrame(marks_diag).to_csv('k5_honest_marks.csv', index=False)

    L = rt.locked_calls()
    lock = {(c['day'], c['contract']) for c in L['calls']}
    print('\n=== reproduction check: gate=open vs the 59 locked calls ===')
    rep = {(d, f"SPXW {cs['open']['strike']:g}{cs['open']['right']}") for d, cs in res.items() if cs['open']}
    print('reconstructed', len(rep), 'locked', len(lock), 'same day+contract', len(rep & lock), 'same day', len({d for d, _ in rep} & {d for d, _ in lock}))
    print('locked not reproduced:', sorted(lock - rep))
    print('reproduced not locked:', sorted(rep - lock))
    print()
    for g in GATES:
        print(summarize([cs[g] for cs in res.values()], f'gate={g}'))

    print('\n=== anti-signal (the opposite side at the same mark) ===')
    for g in GATES:
        b2 = [cs[g]['anti'] for cs in res.values() if cs[g] and cs[g]['anti']]
        print(summarize(b2, f'anti-signal (gate={g})'))

    print('\n=== side-shuffle null (1000 draws: each night keeps its mark, the side is a coin flip) ===')
    rng = np.random.default_rng(11)
    for g in GATES:
        pairs = [(cs[g], cs[g]['anti']) for cs in res.values() if cs[g] and cs[g]['anti']]
        if len(pairs) < 5:
            print(f'gate={g}: too few paired nights ({len(pairs)})'); continue
        obs_w = np.mean([p[0]['win'] for p in pairs]); obs_r = np.mean([p[0]['ret'] for p in pairs])
        ws, rs = [], []
        for _ in range(1000):
            pick = [p[int(rng.integers(0, 2))] for p in pairs]
            ws.append(np.mean([q['win'] for q in pick])); rs.append(np.mean([q['ret'] for q in pick]))
        ws, rs = np.array(ws), np.array(rs)
        print(f'gate={g} (n={len(pairs)} paired nights; observed win {100*obs_w:.1f}% ret {100*obs_r:+.1f}%): null win {100*ws.mean():.1f}% [5-95: {100*np.percentile(ws,5):.1f}, {100*np.percentile(ws,95):.1f}], '
              f'null ret {100*rs.mean():+.1f}% [{100*np.percentile(rs,5):+.1f}, {100*np.percentile(rs,95):+.1f}]; P(null win >= obs) {(ws >= obs_w).mean():.3f}; P(null ret >= obs) {(rs >= obs_r).mean():.3f}')

    print('\n=== synthetic zero-drift null (GBM at the night\'s realised vol, BS bid/ask at the contract IV, spec exit) ===')
    for g in GATES:
        cs = [c[g] for c in res.values() if c[g] and np.isfinite(c[g]['rv_night'])]
        if not cs:
            continue
        pw, pr = zip(*[synthetic_null(c, c['rv_night']) for c in cs])
        pw = np.array(pw, float); pr = np.array(pr, float)
        print(f'gate={g}: n={len(cs)}, observed win {100*np.mean([c["win"] for c in cs]):.1f}% ret {100*np.mean([c["ret"] for c in cs]):+.1f}%; '
              f'zero-drift expected win {100*np.nanmean(pw):.1f}%, expected ret {100*np.nanmean(pr):+.1f}%; median night rv {np.median([c["rv_night"] for c in cs]):.2f}')

    print('\n=== CSCV PBO over the 27-configuration neighbourhood (per-session returns, 16 blocks) ===')
    sys.path.insert(0, '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2')
    from eval.metrics import pbo_cscv
    for g in GATES:
        keys = sorted(cscv[g]); dd = sorted(days)
        M = np.array([[cscv[g][k].get(d, 0.0) for k in keys] for d in dd])
        if (M != 0).sum() == 0:
            print(f'gate={g}: no calls'); continue
        p = pbo_cscv(M, n_blocks=16, max_splits=5000)
        means = M.mean(0); frozen = keys.index('d15|tp1.5|sl0.4678')
        rank = int((means > means[frozen]).sum()) + 1
        print(f"gate={g}: PBO {p['pbo']:.3f} (splits {p['n_splits']}, logit median {p['logit_median']:+.2f}); frozen config mean/session {100*means[frozen]:+.2f}% ranks {rank}/27; "
              f"neighbourhood mean/session min {100*means.min():+.2f}% max {100*means.max():+.2f}%; configs with mean>0: {(means > 0).sum()}/27")
    print(f'\ntotal {time.time()-t0:.0f}s')
