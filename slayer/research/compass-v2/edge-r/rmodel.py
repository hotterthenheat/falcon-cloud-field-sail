"""EDGE-R: Compass Model Risk (book R) on history. specs/PREREG.md @ 74ad403.

Data (read only): v2data/edge/{bars,chain,exp_*.json}, edge-t/q1s, edge-m/q1s. Own: v2data/edge-r/{bars,board,q1s}.
Every time is seconds since midnight ET of the session (`s`); bar m = minute-of-day stamp, closes at (m+1)*60.
A decision at s sees bars m <= s//60 - 1, the board stamped s//60 (NBBO in force at that minute's start <= s) and
1-second quotes stamped <= the fill/exit second. Nothing here reads a LOCKED day (assert_open).
"""
import io
import json
import math
import os
import re
import sys

import numpy as np
import pandas as pd
from scipy.special import ndtr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.insert(0, HERE)
import fetch as F  # noqa: E402  (EDGE's splits, sessions, expiry lists; read only)
import term  # noqa: E402

V2 = '/home/user/falcon-cloud-field-sail/v2data'
EDGE = os.path.join(V2, 'edge')
OUT = term.OUT
SLAYER = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
TICKERS = ('SPXW', 'SPY', 'QQQ')          # COMPASS_TICKERS order (0, 2, 3)
ROOT_OF = {'SPXW': 'SPXW', 'SPY': 'SPY', 'QQQ': 'QQQ'}
UNDER = {'SPXW': ('index', 'SPX'), 'SPY': ('stock', 'SPY'), 'QQQ': ('stock', 'QQQ')}
BAND = {'SPY': 14, 'QQQ': 14, 'SPXW': 24}
NO_OVERNIGHT = {'SPY', 'QQQ'}

# modelRisk.ts / compassParams.ts
TAIL_FIRST = 30
TAIL_FADE_MIN = 30
TAIL_MONEY = 0.015
TAIL_SPREAD = 0.04
TAIL_SCORE_BAND = 0.05
BID_MIN = 0.15
SPREAD_MAX = 0.08
R = 0.042
SESSION_MIN = 390
YEAR_SESSIONS = 252
IV_LO, IV_HI, IV_BISECTS = 0.01, 8.0, 60
PROBE = 12
SPAN = 4                                  # strikeSpan(index=true)

# execution
LAT = 2
FEE = 0.65
OPEN_S = 9 * 3600 + 30 * 60               # 09:30:00
CLOSE0_S = 16 * 3600                      # expiring contracts stop at 16:00:00
CLOSE17_S = 16 * 3600 + 15 * 60           # non-expiring SPY/QQQ/SPXW to 16:15:00
STOP_FRAC = 0.65                          # R2: sane bid <= 0.65 x fill
SANE_SPR = 0.12

# R1
DIR_MOVE = 0.010

# ---------------------------------------------------------------- calendar


def _cal_lists():
    txt = open(os.path.join(SLAYER, 'shared', 'marketCalendar.mjs')).read()
    def grab(name):
        m = re.search(name + r'\s*=\s*\[(.*?)\]', txt, re.S)
        return set(re.findall(r"'(\d{4}-\d{2}-\d{2})'", m.group(1))) if m else set()
    return grab('HOLIDAY_DATES'), grab('EARLY_CLOSE_DATES')


HOLIDAYS, EARLY = _cal_lists()


def weekday_dte(day, exp):
    a = pd.Timestamp(day)
    b = pd.Timestamp(exp)
    if b < a:
        return -1
    n = 0
    d = a + pd.Timedelta(days=1)
    while d <= b:
        if d.weekday() < 5 and d.strftime('%Y-%m-%d') not in HOLIDAYS:
            n += 1
        d += pd.Timedelta(days=1)
    return n


def assert_open(day):
    if F.is_locked(day):
        raise AssertionError(f'LOCKED day read refused: {day}')


_SESS = None


def sessions_all():
    """Trading days: EDGE's sessions.json plus every day in EDGE's SPX bar files (non-locked months)."""
    global _SESS
    if _SESS is None:
        ds = set(F.sessions())
        d = os.path.join(EDGE, 'bars', 'SPX')
        for f in os.listdir(d):
            ds |= set(pd.read_parquet(os.path.join(d, f), columns=['d']).d.unique())
        _SESS = sorted(ds)
    return _SESS


def next_session(day):
    c = sessions_all()
    i = int(np.searchsorted(c, day, side='right'))
    if i < len(c):
        return c[i]
    d = pd.Timestamp(day) + pd.Timedelta(days=1)
    while d.weekday() >= 5 or d.strftime('%Y-%m-%d') in HOLIDAYS:
        d += pd.Timedelta(days=1)
    return d.strftime('%Y-%m-%d')


def dev_days():
    ds = [d for d in F.want_days('DEV') if d < '2025-01-01' and not F.is_locked(d) and d not in EARLY]
    rng = np.random.default_rng(20261105)
    return [ds[i] for i in rng.permutation(len(ds))]


_EXP = {}


def expiries(root):
    if root not in _EXP:
        _EXP[root] = sorted(json.load(open(os.path.join(EDGE, f'exp_{root}.json'))))
    return _EXP[root]


def book_expiry(root, day, book):
    if book == '0':
        return day if day in set(expiries(root)) else None
    for e in expiries(root):
        if e <= day:
            continue
        n = weekday_dte(day, e)
        if 1 <= n <= 7:
            return e
        if n > 7:
            break
    return None


# ---------------------------------------------------------------- bars


_BM = {}


def _month_bars(kind, sym, month):
    k = (kind, sym, month)
    if k in _BM:
        return _BM[k]
    own = os.path.join(OUT, 'bars', sym, f'{month}.parquet')
    if os.path.exists(own):
        b = pd.read_parquet(own)
        src = 'ext'
    else:
        f = os.path.join(EDGE, 'bars', sym, f'{month}.parquet')
        b = pd.read_parquet(f) if os.path.exists(f) else pd.DataFrame(columns=['d', 'm', 'o', 'h', 'l', 'c'])
        src = 'rth'
    b = b[b.c > 0]
    _BM[k] = (b, src)
    if len(_BM) > 24:
        _BM.pop(next(iter(_BM)))
    return _BM[k]


def _atomic_parquet(df, f):
    df.to_parquet(f + '.part', compression='zstd', engine='pyarrow')
    os.replace(f + '.part', f)


def fetch_month_bars(sym, month):
    """SPY/QQQ stock bars 04:00-20:00, SPX index bars 00:00-23:59, for a month (the code's spans)."""
    f = os.path.join(OUT, 'bars', sym, f'{month}.parquet')
    if os.path.exists(f):
        return 'have'
    if any(F.is_locked(f'{month}-{d:02d}') for d in range(1, 32)):
        return 'locked'      # a month holding any LOCKED day is never requested
    y, m = int(month[:4]), int(month[5:7])
    end = (pd.Timestamp(y, m, 1) + pd.offsets.MonthEnd(0))
    kind, span = ('index', 'start_time=00:00:00&end_time=23:59:59') if sym == 'SPX' else ('stock', 'start_time=04:00:00&end_time=20:00:00')
    t = term.get(f'/{kind}/history/ohlc?symbol={sym}&start_date={y}{m:02d}01&end_date={end:%Y%m%d}&interval=1m'
                 f'&{span}&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not t.strip():
        _atomic_parquet(pd.DataFrame(columns=['d', 'm', 'o', 'h', 'l', 'c']), f)
        return 'empty'
    df = pd.read_csv(io.StringIO(t))
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'d': ts.dt.strftime('%Y-%m-%d'), 'm': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'),
                        'o': df['open'].astype(float), 'h': df['high'].astype(float), 'l': df['low'].astype(float),
                        'c': df['close'].astype(float)})
    out = out[~out.d.map(F.is_locked)]                      # never store a locked day
    _atomic_parquet(out, f)
    return 'ok'


def day_closes(tk, day):
    """1440 closes (nan = no print) of the ticker's underlying on `day`; plus the source tag."""
    assert_open(day)
    kind, sym = UNDER[tk]
    b, src = _month_bars(kind, sym, day[:7])
    x = b[b.d == day]
    c = np.full(1440, np.nan)
    c[x.m.values.astype(int)] = x.c.values
    return c, src


def spx_open(day):
    c, _ = day_closes('SPXW', day)
    b, _ = _month_bars('index', 'SPX', day[:7])
    x = b[(b.d == day) & (b.m == 570)]
    return float(x.o.iloc[0]) if len(x) else np.nan


def trail_range(c, m):
    """high/low of the last 30 closes strictly before bar m (nan-skipping); None if < 30."""
    prior = c[:m]
    v = prior[np.isfinite(prior)]
    if len(v) < TAIL_FIRST:
        return None
    w = v[-TAIL_FIRST:]
    return float(w.max()), float(w.min())


def break_side(px, hi, lo):
    if not (px > 0 and hi > 0 and lo > 0):
        return None
    if px > hi:
        return 'P'
    if px < lo:
        return 'C'
    return None


def exit_bar(c, m_entry, line, side):
    """exitAt: first later close back through the line, or the first close at a bar >= entry + 30."""
    dl = m_entry + TAIL_FADE_MIN
    idx = np.flatnonzero(np.isfinite(c[m_entry + 1:])) + m_entry + 1 if m_entry >= -1 else []
    for m in idx:
        x = c[m]
        if (x >= line) if side == 'C' else (x <= line):
            return int(m), 'back'
        if m >= dl:
            return int(m), 'held'
    return None


# ---------------------------------------------------------------- boards


_BD = {}


def _board_df(root, day, exp):
    k = (root, day, exp)
    if k in _BD:
        return _BD[k]
    parts = []
    if exp == day:
        f = os.path.join(EDGE, 'chain', root, f'{day}.parquet')
        if os.path.exists(f):
            parts.append(pd.read_parquet(f))
    f2 = os.path.join(OUT, 'board', root, f'{day}_{exp}.parquet')
    if os.path.exists(f2):
        parts.append(pd.read_parquet(f2))
    df = pd.concat([p for p in parts if len(p)]) if any(len(p) for p in parts) else None
    g = {}
    if df is not None:
        df = df.drop_duplicates(['m', 'k', 'r'], keep='last')
        for (m, r), x in df.groupby(['m', 'r']):
            x = x.sort_values('k')
            g[(int(m), int(r))] = (x.k.values.astype(float), x.bid.values.astype(float), x.ask.values.astype(float))
    _BD[k] = g
    if len(_BD) > 12:
        _BD.pop(next(iter(_BD)))
    return g


def fetch_board(root, day, exp, start='09:30:00', end='16:15:00', tag=''):
    """The expiry's 1-minute NBBO board (strike_range BAND) from start to end."""
    assert_open(day)
    f = os.path.join(OUT, 'board', root, f'{day}_{exp}{tag}.parquet')
    if os.path.exists(f):
        return 'have'
    y, e = day.replace('-', ''), exp.replace('-', '')
    t = term.get(f'/option/history/quote?symbol={root}&expiration={e}&date={y}&interval=1m&strike_range={BAND[root]}'
                 f'&start_time={start}&end_time={end}&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not t.strip() or not t.startswith('symbol'):
        _atomic_parquet(pd.DataFrame(columns=['m', 'k', 'r', 'bid', 'ask', 'bs', 'as']), f)
        return 'empty'
    df = pd.read_csv(io.StringIO(t))
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'m': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'), 'k': df['strike'].astype('float32'),
                        'r': (df['right'].str.upper().str[0] == 'C').astype('int8'), 'bid': df['bid'].astype('float32'),
                        'ask': df['ask'].astype('float32'), 'bs': df['bid_size'].astype('int32'),
                        'as': df['ask_size'].astype('int32')})
    _atomic_parquet(out, f)
    _BD.pop((root, day, exp), None)
    return 'ok'


def board_at(root, day, exp, stamp, call):
    return _board_df(root, day, exp).get((int(stamp), 1 if call else 0))


# ---------------------------------------------------------------- Black-Scholes (compassFeatures.bsStates, r = 0.042)


def bs_px(S, K, T, sig, call):
    vol = sig * np.sqrt(T)
    d1 = (np.log(S / K) + (R + 0.5 * sig * sig) * T) / vol
    d2 = d1 - vol
    df = np.exp(-R * T)
    return np.where(call, S * ndtr(d1) - K * df * ndtr(d2), K * df * ndtr(-d2) - S * ndtr(-d1))


def iv_states(price, S, K, T, call):
    price = np.asarray(price, float)
    K = np.asarray(K, float)
    lo = np.full(price.shape, IV_LO)
    hi = np.full(price.shape, IV_HI)
    ok = (bs_px(S, K, T, lo, call) <= price) & (bs_px(S, K, T, hi, call) >= price) & (price > 0)
    for _ in range(IV_BISECTS):
        mid = 0.5 * (lo + hi)
        up = bs_px(S, K, T, mid, call) > price
        hi = np.where(up, mid, hi)
        lo = np.where(up, lo, mid)
    return np.where(ok, 0.5 * (lo + hi), np.nan)


def contract_rank(S, K, minute, dte, mid, call):
    cash = max(0, minute - 570)
    T = (max(0, SESSION_MIN - cash) + max(0, dte) * SESSION_MIN) / (SESSION_MIN * YEAR_SESSIONS)
    n = len(K)
    if not (T > 0):
        return np.full(n, np.nan), np.full(n, np.nan)
    iv = iv_states(mid, S, K, T, call)
    vol = iv * math.sqrt(T)
    with np.errstate(invalid='ignore', divide='ignore'):
        d1 = (np.log(S / K) + (R + 0.5 * iv * iv) * T) / vol
        d2 = d1 - vol
        df = math.exp(-R * T)
        pdf = np.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
        gamma = pdf / (S * vol)
        carry = R * K * df * ndtr(d2 if call else -d2)
        theta = -(S * pdf * iv) / (2 * math.sqrt(T)) + (-carry if call else carry)
        score = np.where((theta < 0) & (gamma > 0) & np.isfinite(iv), gamma / np.abs(theta), np.nan)
    return score, iv


def atm_strike(strikes, spot):
    best, dist = np.nan, np.inf
    for k in strikes:
        d = abs(k - spot)
        if d < dist - 1e-9 or (abs(d - dist) <= 1e-9 and (np.isnan(best) or k < best)):
            dist, best = d, k
    return best


def rank_book(rows, spot, minute, dte, call):
    """rankBook on one board side: rows = (k, bid, ask) sorted by strike. Returns the pick or None."""
    if rows is None:
        return None
    k_all, bid_all, ask_all = rows
    if not len(k_all) or not (spot > 0):
        return None
    ai = int(np.argmin(np.abs(k_all - spot) + (k_all > spot) * 1e-12))
    lo, hi = max(0, ai - PROBE), min(len(k_all), ai + PROBE + 1)
    k, b, a = k_all[lo:hi], bid_all[lo:hi], ask_all[lo:hi]
    mid = (a + b) / 2
    ok = (b > BID_MIN) & (a > 0) & (a >= b) & (mid > 0) & ((a - b) / np.maximum(mid, 1e-12) <= SPREAD_MAX + 1e-9)
    k, b, a, mid = k[ok], b[ok], a[ok], mid[ok]
    if not len(k):
        return None
    strikes = np.unique(k)
    atm = atm_strike(strikes, spot)
    ia = int(np.flatnonzero(np.abs(strikes - atm) < 1e-9)[0])
    sidx = np.searchsorted(strikes, k)
    keep = (np.abs(sidx - ia) <= SPAN) & (np.abs(k - spot) / spot <= TAIL_MONEY + 1e-12) & \
        ((a - b) / mid <= TAIL_SPREAD + 1e-12)
    if not keep.any():
        return None
    k, b, a, mid = k[keep], b[keep], a[keep], mid[keep]
    score, iv = contract_rank(spot, k, minute, dte, mid, call)
    best = None
    for i in range(len(k)):
        if not np.isfinite(score[i]):
            continue
        dist = abs(k[i] - spot) / spot
        if best is None:
            take = score[i] > 0
        else:
            rel = score[i] / best['score']
            take = True if rel > 1 + TAIL_SCORE_BAND else (False if rel < 1 - TAIL_SCORE_BAND else dist < best['dist'] - 1e-12)
        if take:
            best = {'k': float(k[i]), 'bid': float(b[i]), 'ask': float(a[i]), 'score': float(score[i]),
                    'iv': float(iv[i]), 'dist': float(dist)}
    return best


# ---------------------------------------------------------------- 1-second quotes


def _ks(k):
    return f'{k:.3f}'.rstrip('0').rstrip('.')


class Quotes:
    """Dense per-second NBBO (bid, ask, bs, as in $ / contracts) for [a, b] on `day`. Cache order: own segments,
    EDGE-T q1s (0DTE, start..15:51:00), EDGE-M q1s (dense windows), else fetch [a, b] (if fetch allowed)."""

    def __init__(self, fetch=True):
        self.fetch = fetch
        self.miss = 0
        self.hits = {'own': 0, 'edge-t': 0, 'edge-m': 0, 'fetch': 0}

    def _own(self, root, day, exp, k, right):
        d = os.path.join(OUT, 'q1s', root, day)
        pre = f'{exp}_{_ks(k)}{right}_'
        if not os.path.isdir(d):
            return []
        out = []
        for f in os.listdir(d):
            if f.startswith(pre) and f.endswith('.npz'):
                a, b = f[len(pre):-4].split('_')
                out.append((int(a), int(b), os.path.join(d, f)))
        return out

    def path(self, root, day, exp, k, right, a, b):
        assert_open(day)
        a, b = int(a), int(b)
        if b < a:
            b = a
        for (sa, sb, f) in self._own(root, day, exp, k, right):
            if sa <= a and b <= sb:
                self.hits['own'] += 1
                return self._dense(np.load(f), a, b, change=True)
        if exp == day:
            f = os.path.join(V2, 'edge-t', 'q1s', root, day, f'{_ks(k)}{right}.npz')
            if os.path.exists(f):
                z = np.load(f)
                if len(z['s']) and int(z['start']) <= a and b <= 15 * 3600 + 51 * 60:
                    self.hits['edge-t'] += 1
                    return self._dense(z, a, b, change=True, cents=True)
        d = os.path.join(V2, 'edge-m', 'q1s', root, day)
        if os.path.isdir(d):
            pre = f'{exp}_{_ks(k)}{right}_'
            for f in os.listdir(d):
                if f.startswith(pre):
                    sa, sb = (int(x) for x in f[len(pre):-4].split('_'))
                    if sa <= a and b <= sb:
                        self.hits['edge-m'] += 1
                        return self._dense(np.load(os.path.join(d, f)), a, b, change=True)
        if not self.fetch:
            self.miss += 1
            return None
        return self._get(root, day, exp, k, right, a, b)

    @staticmethod
    def _clock(s):
        return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'

    def _get(self, root, day, exp, k, right, a, b):
        y, e = day.replace('-', ''), exp.replace('-', '')
        url = (f'/option/history/quote?symbol={root}&expiration={e}&strike={_ks(k)}&right={"call" if right == "C" else "put"}'
               f'&start_date={y}&end_date={y}&interval=1s&start_time={self._clock(a)}&end_time={self._clock(b)}&format=csv')
        txt = term.get(url)
        if txt is None:
            self.miss += 1
            return None
        self.hits['fetch'] += 1
        if not txt.strip() or not txt.startswith('symbol'):
            z = {'s': np.zeros(0, np.int32), 'bid': np.zeros(0, np.int32), 'ask': np.zeros(0, np.int32),
                 'bs': np.zeros(0, np.int32), 'as': np.zeros(0, np.int32)}
        else:
            df = pd.read_csv(io.StringIO(txt))
            ts = pd.to_datetime(df['timestamp'])
            s = (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).values.astype(np.int32)
            bid = np.round(df['bid'].values * 100).astype(np.int32)
            ask = np.round(df['ask'].values * 100).astype(np.int32)
            bs = df['bid_size'].values.astype(np.int32)
            asz = df['ask_size'].values.astype(np.int32)
            keep = np.ones(len(s), bool)
            keep[1:] = (bid[1:] != bid[:-1]) | (ask[1:] != ask[:-1]) | (bs[1:] != bs[:-1]) | (asz[1:] != asz[:-1])
            z = {'s': s[keep], 'bid': bid[keep], 'ask': ask[keep], 'bs': bs[keep], 'as': asz[keep]}
        d = os.path.join(OUT, 'q1s', root, day)
        os.makedirs(d, exist_ok=True)
        fn = os.path.join(d, f'{exp}_{_ks(k)}{right}_{a}_{b}.npz')
        with open(fn + '.part', 'wb') as fh:      # atomic: a restart never leaves a truncated cache file
            np.savez_compressed(fh, **z)
        os.replace(fn + '.part', fn)
        return self._dense(z, a, b, change=True, cents=True)

    @staticmethod
    def _dense(z, a, b, change=True, cents=None):
        s = np.asarray(z['s'])
        if not len(s):
            return None
        bid = np.asarray(z['bid'], float)
        ask = np.asarray(z['ask'], float)
        if cents is None:
            cents = np.asarray(z['bid']).dtype.kind == 'i'
        if cents:
            bid, ask = bid / 100.0, ask / 100.0
        grid = np.arange(a, b + 1)
        j = np.searchsorted(s, grid, side='right') - 1
        okj = j >= 0
        jj = np.maximum(j, 0)
        out = {'s0': a, 's1': b}
        for x, v in (('bid', bid), ('ask', ask), ('bs', np.asarray(z['bs'], float)), ('as', np.asarray(z['as'], float))):
            out[x] = np.where(okj, v[jj], 0.0)
        return out


def q_at(p, sec, x):
    i = int(sec) - p['s0']
    if i < 0 or i > p['s1'] - p['s0']:
        raise IndexError(f'quote read outside the fetched window: {sec} not in [{p["s0"]}, {p["s1"]}]')
    return float(p[x][i])


def sane(b, a, bs, asz):
    mid = (b + a) / 2
    return (b > 0) & (a > 0) & (mid > 0) & ((a - b) <= SANE_SPR * np.maximum(mid, 1e-9)) & (bs >= 2) & (asz >= 2)
