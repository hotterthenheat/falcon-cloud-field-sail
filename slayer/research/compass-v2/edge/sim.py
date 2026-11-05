"""EDGE event simulator (interim, until FOUNDATION's sim lands): V2_PROTOCOL execution on 1-second NBBO.

Data visible at a decision time t (seconds of the ET day): underlying 1-minute bars that have closed (bar start
<= t - 60), chain 1-minute quotes stamped <= t - 60, 1-second NBBO stamped <= the decision second. Buy the ask of the
first 1-second quote stamped >= t + 2 with bid > 0, ask > 0 and ask size >= 1; sell the bid of the first 1-second
quote stamped >= exit decision + 2. Fee $0.65 per contract per side.
"""
import json, math, os, time, urllib.request
import numpy as np
import pandas as pd

ROOT = '/home/user/falcon-cloud-field-sail/v2data/edge'
BASE = 'http://127.0.0.1:25503/v3'
UNDER = {'SPY': 'SPY', 'QQQ': 'QQQ', 'IWM': 'IWM', 'SPXW': 'SPX'}
FEE = 0.65
LAT = 2
YEAR_MIN = 252 * 390.0

# ---------------------------------------------------------------- underlying


_BARS = {}


def bars_month(sym, month):
    k = (sym, month)
    if k not in _BARS:
        f = os.path.join(ROOT, 'bars', sym, f'{month}.parquet')
        b = pd.read_parquet(f) if os.path.exists(f) else pd.DataFrame(columns=['d', 'm', 'o', 'h', 'l', 'c'])
        _BARS[k] = b[(b.c > 0) & (b.o > 0) & (b.h > 0) & (b.l > 0)] if len(b) else b
    return _BARS[k]


def day_bars(root, day):
    b = bars_month(UNDER[root], day[:7])
    return b[b.d == day].sort_values('m').reset_index(drop=True)


_DAILY = {}


def daily_closes(root):
    """The 15:59 bar close of every session in the bar files (used only for prior-session values)."""
    if root not in _DAILY:
        d = os.path.join(ROOT, 'bars', UNDER[root])
        parts = [pd.read_parquet(os.path.join(d, f)) for f in sorted(os.listdir(d))] if os.path.isdir(d) else []
        if not parts:
            _DAILY[root] = pd.Series(dtype=float)
        else:
            b = pd.concat(parts)
            b = b[(b.m <= 959) & (b.c > 0)].sort_values(['d', 'm'])
            _DAILY[root] = b.groupby('d')['c'].last()
    return _DAILY[root]


def prior_close_and_vol(root, day, n=20):
    s = daily_closes(root)
    prev = s[s.index < day]
    if len(prev) < n + 1:
        return np.nan, np.nan
    r = np.diff(np.log(prev.values[-(n + 1):]))
    return float(prev.values[-1]), float(np.std(r, ddof=1))


# ---------------------------------------------------------------- Black-Scholes


def _ncdf(x):
    return 0.5 * (1 + np.vectorize(math.erf)(np.asarray(x, float) / math.sqrt(2)))


def bs_price(S, K, T, v, call):
    S, K, T, v = (np.asarray(a, float) for a in (S, K, T, v))
    sq = v * np.sqrt(np.maximum(T, 1e-9))
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    d2 = d1 - sq
    c = S * _ncdf(d1) - K * _ncdf(d2)
    return np.where(call, c, c - S + K)


def bs_delta(S, K, T, v, call):
    sq = np.asarray(v, float) * np.sqrt(np.maximum(np.asarray(T, float), 1e-9))
    d1 = (np.log(np.asarray(S, float) / np.asarray(K, float)) + 0.5 * sq * sq) / sq
    n = _ncdf(d1)
    return np.where(call, n, n - 1)


def bs_gamma(S, K, T, v):
    sq = np.asarray(v, float) * np.sqrt(np.maximum(np.asarray(T, float), 1e-9))
    d1 = (np.log(np.asarray(S, float) / np.asarray(K, float)) + 0.5 * sq * sq) / sq
    return np.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (np.asarray(S, float) * sq)


def implied_vol(price, S, K, T, call, lo=0.01, hi=5.0, it=50):
    price, K = np.asarray(price, float), np.asarray(K, float)
    call = np.asarray(call, bool)
    a = np.full(price.shape, lo)
    b = np.full(price.shape, hi)
    for _ in range(it):
        m = 0.5 * (a + b)
        p = bs_price(S, K, T, m, call)
        up = p > price
        b = np.where(up, m, b)
        a = np.where(up, a, m)
    v = 0.5 * (a + b)
    intrinsic = np.where(call, np.maximum(S - K, 0), np.maximum(K - S, 0))
    return np.where(price > intrinsic + 1e-4, v, np.nan)


# ---------------------------------------------------------------- chain board


_CH = {}


def chain(root, day):
    k = (root, day)
    if k not in _CH:
        f = os.path.join(ROOT, 'chain', root, f'{day}.parquet')
        _CH[k] = pd.read_parquet(f) if os.path.exists(f) else None
        if len(_CH) > 16:
            _CH.pop(next(iter(_CH)))
    return _CH[k]


def board(root, day, t_sec):
    """Quotes of the 1-minute stamp (t - 60 s) floored to the minute: all stamped <= t - 60."""
    c = chain(root, day)
    if c is None or not len(c):
        return None
    m = (t_sec - 60) // 60
    b = c[c.m == m]
    return b if len(b) else None


def spot_at(bars, t_sec):
    """The close of the last bar that has closed by t (bar start <= t - 60)."""
    m = (t_sec - 60) // 60
    x = bars[bars.m <= m]
    return float(x.c.iloc[-1]) if len(x) else np.nan


def select(root, day, t_sec, call, lo, hi, target, S):
    """The contract on the side `call` nearest |delta| = target within [lo, hi] passing the gates, from the board
    stamped <= t - 60. Returns dict or None."""
    b = board(root, day, t_sec)
    if b is None or not np.isfinite(S):
        return None
    T = max(960 - t_sec / 60.0, 1.0) / YEAR_MIN
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    if not len(b):
        return None
    mid = (b.bid.values + b.ask.values) / 2
    iv = implied_vol(mid, S, b.k.values, T, b.r.values == 1)
    # ATM IV: the strike nearest S, both rights
    katm = b.k.values[np.argmin(np.abs(b.k.values - S))]
    atm = iv[(b.k.values == katm) & np.isfinite(iv)]
    if not len(atm):
        return None
    v_atm = float(np.mean(atm))
    em = S * v_atm * math.sqrt(T)
    side = b.r.values == (1 if call else 0)
    dl = np.abs(bs_delta(S, b.k.values, T, np.where(np.isfinite(iv), iv, v_atm), b.r.values == 1))
    spr = (b.ask.values - b.bid.values) / mid
    ok = side & np.isfinite(iv) & (dl >= lo) & (dl <= hi) & (spr <= 0.08) & (b.ask.values <= 0.6 * em)
    if not ok.any():
        return None
    i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - target))]
    return {'root': root, 'day': day, 'k': float(b.k.values[i]), 'call': bool(call), 'delta': float(dl[i]), 'iv': float(iv[i]),
            'atm_iv': v_atm, 'em': em, 'S': S, 'bid0': float(b.bid.values[i]), 'ask0': float(b.ask.values[i]), 'spr0': float(spr[i])}


# ---------------------------------------------------------------- 1-second quotes


def _clock(s):
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def q1s(root, day, k, call, start, end):
    """1-second NBBO for one contract, seconds [start, end]; cached (npz) under v2data/edge/q1s/."""
    ks = f'{k:.3f}'.rstrip('0').rstrip('.')
    f = os.path.join(ROOT, 'q1s', root, day, f'{ks}{"C" if call else "P"}_{start}_{end}.npz')
    if os.path.exists(f):
        z = np.load(f)
        return {x: z[x] for x in z.files}
    y = day.replace('-', '')
    url = (f'{BASE}/option/history/quote?symbol={root}&expiration={y}&strike={ks}&right={"call" if call else "put"}'
           f'&start_date={y}&end_date={y}&interval=1s&start_time={_clock(start)}&end_time={_clock(end)}&format=csv')
    txt = None
    for a in range(4):
        try:
            with urllib.request.urlopen(url, timeout=240) as r:
                txt = r.read().decode()
            break
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                txt = ''
                break
            time.sleep(3 * (a + 1))
        except Exception:
            time.sleep(5 * (a + 1))
    if txt is None:
        return None
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not txt.strip() or not txt.startswith('symbol'):
        out = {x: np.zeros(0) for x in ('s', 'bid', 'ask', 'bs', 'as')}
    else:
        import io
        df = pd.read_csv(io.StringIO(txt))
        ts = pd.to_datetime(df['timestamp'])
        out = {'s': (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).values.astype(np.int32),
               'bid': df['bid'].values.astype(np.float32), 'ask': df['ask'].values.astype(np.float32),
               'bs': df['bid_size'].values.astype(np.int32), 'as': df['ask_size'].values.astype(np.int32)}
    np.savez_compressed(f, **out)
    return out


# ---------------------------------------------------------------- one trade


def run_trade(q, t_sec, t_end, rules, bars=None, under_rule=None):
    """Enter at the ask of the first quote >= t + LAT (bid > 0, ask > 0, ask size >= 1); walk the 1-second path;
    exit on the first rule that fires (decision second d), at the bid of the first quote >= d + LAT.
    rules: dict(stop=0.5, trail_arm=1.25, trail=0.75, tp_abs=None). under_rule(minute_closed) -> bool (exit)."""
    s, bid, ask, asz = q['s'], q['bid'], q['ask'], q['as']
    if not len(s):
        return None
    ok = (s >= t_sec + LAT) & (bid > 0) & (ask > 0) & (asz >= 1)
    if not ok.any():
        return None
    i0 = int(np.flatnonzero(ok)[0])
    if s[i0] > t_sec + 60:
        return None
    fill = float(ask[i0])
    peak = float(bid[i0])
    armed = False
    decide, why = None, 'time'
    last_min = (int(s[i0]) // 60)
    for j in range(i0 + 1, len(s)):
        sj = int(s[j])
        if sj >= t_end:
            decide, why = t_end, 'time'
            break
        b = float(bid[j])
        if under_rule is not None and sj // 60 > last_min:
            # bars that closed at a minute boundary in (last_min, sj]
            for mm in range(last_min + 1, sj // 60 + 1):
                # the bar evaluated is bar mm-1 (closed at mm*60); never one still forming at the current second
                if mm * 60 > sj:
                    raise AssertionError('look-ahead: underlying bar not closed at the decision second')
                if under_rule(mm):
                    decide, why = mm * 60, 'under'
                    break
            last_min = sj // 60
            if decide is not None:
                break
        if b <= 0:
            continue
        if rules.get('stop') and b <= rules['stop'] * fill:
            decide, why = sj, 'stop'
            break
        if rules.get('tp_abs') and b >= fill + rules['tp_abs']:
            decide, why = sj, 'tp'
            break
        if rules.get('trail'):
            peak = max(peak, b)
            if b >= rules['trail_arm'] * fill:
                armed = True
            if armed and b <= rules['trail'] * peak:
                decide, why = sj, 'trail'
                break
    if decide is None:
        decide = t_end
    k = np.flatnonzero(s >= decide + LAT)
    xb = float(bid[k[0]]) if len(k) else float(bid[-1])
    xs = int(s[k[0]]) if len(k) else int(s[-1])
    ret = xb / fill - 1
    ret_fee = (xb * 100 - FEE) / (fill * 100 + FEE) - 1
    return {'fill': fill, 'fill_s': int(s[i0]), 'exit': xb, 'exit_s': xs, 'why': why, 'ret': ret, 'ret_fee': ret_fee}


# ---------------------------------------------------------------- statistics


def boot(trades, key='ret_fee', n=2000, seed=1):
    """Session-clustered bootstrap of the mean per trade."""
    if not trades:
        return np.nan, np.nan, np.nan
    by = {}
    for t in trades:
        by.setdefault(t['day'], []).append(t[key])
    arrs = [np.asarray(v, float) for v in by.values()]
    sums = np.array([a.sum() for a in arrs])
    cnts = np.array([len(a) for a in arrs])
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(arrs), (n, len(arrs)))
    bs = sums[idx].sum(1) / cnts[idx].sum(1)
    return float(sums.sum() / cnts.sum()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def summary(trades, label=''):
    n = len(trades)
    if not n:
        return {'label': label, 'n': 0}
    r = np.array([t['ret_fee'] for t in trades])
    e, lo, hi = boot(trades, 'ret_fee')
    e0, lo0, hi0 = boot(trades, 'ret')
    w, wlo, whi = boot([{**t, 'w': float(t['ret_fee'] > 0)} for t in trades], 'w')
    wins, losses = r[r > 0], r[r <= 0]
    payoff = (wins.mean() / -losses.mean()) if len(wins) and len(losses) and losses.mean() < 0 else np.nan
    sh = r.mean() / r.std(ddof=1) if n > 2 and r.std() > 0 else np.nan
    return {'label': label, 'n': n, 'sessions': len(set(t['day'] for t in trades)), 'win': w, 'win_lo': wlo, 'win_hi': whi,
            'exp': e, 'exp_lo': lo, 'exp_hi': hi, 'exp_nofee': e0, 'exp_nofee_lo': lo0, 'exp_nofee_hi': hi0,
            'payoff': payoff, 'sharpe': sh, 'skew': float(pd.Series(r).skew()) if n > 3 else np.nan,
            'kurt': float(pd.Series(r).kurt() + 3) if n > 3 else np.nan}


def fmt(s):
    if not s.get('n'):
        return f"| {s['label']} | 0 | | | | | |"
    return (f"| {s['label']} | {s['n']} | {100 * s['win']:.0f}% [{100 * s['win_lo']:.0f}, {100 * s['win_hi']:.0f}] | "
            f"{100 * s['exp']:+.1f}% [{100 * s['exp_lo']:+.1f}, {100 * s['exp_hi']:+.1f}] | "
            f"{100 * s['exp_nofee']:+.1f}% | {s['payoff']:.2f} | {s['sharpe']:.3f} |")


HEAD = '| variant | n | win (net>0) [95%] | expectancy net of fee [95%] | no fee | payoff | Sharpe/trade |\n|---|---:|---:|---:|---:|---:|---:|'


def dsr(sharpe, n, n_trials, sr_var, skew=0.0, kurt=3.0):
    """Deflated Sharpe ratio (Bailey & Lopez de Prado 2014) of a per-trade Sharpe over n trades, against the
    expected maximum of n_trials trials with variance sr_var of their Sharpe ratios."""
    from statistics import NormalDist
    N = NormalDist()
    g = 0.5772156649
    if n_trials < 2 or not np.isfinite(sharpe):
        return np.nan
    e_max = math.sqrt(max(sr_var, 1e-12)) * ((1 - g) * N.inv_cdf(1 - 1 / n_trials) + g * N.inv_cdf(1 - 1 / (n_trials * math.e)))
    den = math.sqrt(max(1e-12, 1 - skew * sharpe + (kurt - 1) / 4 * sharpe ** 2))
    return N.cdf((sharpe - e_max) * math.sqrt(n - 1) / den)


def pbo(matrix, n_blocks=16):
    """CSCV probability of backtest overfitting. matrix: sessions x variants of per-session mean returns (NaN = no
    trade). Splits the sessions into n_blocks blocks, all C(n, n/2) halves (capped by sampling)."""
    import itertools
    M = np.asarray(matrix, float)
    if M.shape[1] < 2:
        return np.nan
    blocks = np.array_split(np.arange(M.shape[0]), n_blocks)
    combos = list(itertools.combinations(range(n_blocks), n_blocks // 2))
    rng = np.random.default_rng(0)
    if len(combos) > 3000:
        combos = [combos[i] for i in rng.choice(len(combos), 3000, replace=False)]
    bad = 0
    tot = 0
    for c in combos:
        ins = np.concatenate([blocks[i] for i in c])
        oos = np.concatenate([blocks[i] for i in range(n_blocks) if i not in c])
        pi = np.nanmean(M[ins], 0)
        po = np.nanmean(M[oos], 0)
        if not np.isfinite(pi).any() or not np.isfinite(po).any():
            continue
        best = int(np.nanargmax(pi))
        rank = (np.sum(po[np.isfinite(po)] < po[best]) + 0.5) / (np.isfinite(po).sum() + 1)
        tot += 1
        bad += rank <= 0.5
    return bad / tot if tot else np.nan
