"""EDGE-V: V1 VWAP-PULLBACK (calls) / V1P (puts) per specs/PREREG.md (registered @ c9cdf5e).

  python3 v1.py run DEV [--nofetch]     1-second execution for every variant (fetches 1-s NBBO, one request)
  python3 v1.py nulls DEV               M1 real + random-minute + shuffled-side nulls
  python3 v1.py syn DEV [reps]          synthetic zero-drift null (SPY variants)
Data visible at decision t = (m+1)*60: bars 09:30..m (closed), the chain board stamped <= t - 60, 1-s quotes >= t.
"""
import io, json, math, os, sys, time, urllib.request
import numpy as np
import pandas as pd
from scipy.special import ndtr
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
import sim as ES      # EDGE interim simulator (read-only store, stats helpers)
import fetch as EF

VROOT = '/home/user/falcon-cloud-field-sail/v2data/edge-v'
BASE = 'http://127.0.0.1:25503/v3'
FEE = 0.65
LAT = 2
YEAR_MIN = 252 * 390.0
M_FIRST, M_LAST = 599, 869          # bars whose close is the decision at 10:00:00 .. 14:30:00
FLAT = 15 * 3600 + 50 * 60
HOLD = 3600
ROOTS = ('SPY', 'QQQ', 'SPXW')
TRIG_SYM = {'SPY': 'SPY', 'QQQ': 'QQQ', 'SPXW': 'SPY'}
ASK_BAND = {'SPY': (0.15, 0.80), 'QQQ': (0.15, 0.80), 'SPXW': (1.50, 8.00)}
XS = ('X1', 'X2')
MODES = ('A', 'B')
SIDES = ('C', 'P')


def variants():
    return [f'{r}-{s}-{x}-{e}' for r in ROOTS for s in SIDES for x in XS for e in MODES]


# ---------------------------------------------------------------- underlying + VWAP

_VB = {}


def vbars(sym, day):
    k = (sym, day[:7])
    if k not in _VB:
        f = os.path.join(VROOT, 'bars', sym, f'{day[:7]}.parquet')
        b = pd.read_parquet(f) if os.path.exists(f) else pd.DataFrame(columns=['d', 'm', 'o', 'h', 'l', 'c', 'v'])
        _VB[k] = b[(b.c > 0) & (b.o > 0) & (b.h > 0) & (b.l > 0)] if len(b) else b
    b = _VB[k]
    return b[b.d == day].sort_values('m').reset_index(drop=True)


def add_vwap(b):
    """VWAP at the close of each bar, using that bar and earlier ones only (all closed by (m+1)*60)."""
    b = b.copy()
    tp = (b.h.values + b.l.values + b.c.values) / 3
    v = b.v.values.astype(float)
    cv = np.cumsum(v)
    b['vwap'] = np.where(cv > 0, np.cumsum(tp * v) / np.maximum(cv, 1), np.nan)
    return b


def xval(x, c):
    return 1.0 if x == 'X1' else 0.0015 * c


def trigger(b, side, x, guard=True):
    """First bar m in [M_FIRST, M_LAST] satisfying the side's rule. b = add_vwap(bars) (only bars <= m are read).
    guard: skip half-days (< 300 bars; the exchange calendar, known in advance) - the only whole-day read."""
    if (guard and len(b) < 300) or not len(b) or int(b.m.iloc[0]) != 570:
        return None
    O = float(b.o.iloc[0])
    ms, c, vw = b.m.values, b.c.values, b.vwap.values
    for i in np.flatnonzero((ms >= M_FIRST) & (ms <= M_LAST)):
        X = xval(x, c[i])
        if side == 'C' and c[i] <= vw[i] - X and c[i] > O:
            return {'m': int(ms[i]), 't': int(ms[i] + 1) * 60, 'c': float(c[i]), 'V': float(vw[i]), 'D': float(vw[i] - c[i]),
                    'X': X, 'Lo': float(b.l.values[i]), 'Hi': float(b.h.values[i]), 'O': O}
        if side == 'P' and c[i] >= vw[i] + X and c[i] < O:
            return {'m': int(ms[i]), 't': int(ms[i] + 1) * 60, 'c': float(c[i]), 'V': float(vw[i]), 'D': float(c[i] - vw[i]),
                    'X': X, 'Lo': float(b.l.values[i]), 'Hi': float(b.h.values[i]), 'O': O}
    return None


def trigger_nolen(b, side, x):
    return trigger(b, side, x, guard=False)


def under_rule(b, tr, side, mode):
    """Underlying exits on bar mm-1 (closed at mm*60). Calls: target close >= V + D/2 (mode A), stop close <= Lo - X/2.
    `side` is the option side actually held (shuffled-side null holds the opposite side with mirrored geometry)."""
    closes = dict(zip(b.m.values.tolist(), b.c.values.tolist()))
    c0, D, X = tr['c'], tr['D'], tr['X']
    trig_call = tr.get('side', side) == 'C'
    if side == ('C' if trig_call else 'P'):   # held side = the trigger's side
        if side == 'C':
            tgt, stp = (lambda c: c >= tr['V'] + D / 2), (lambda c: c <= tr['Lo'] - X / 2)
        else:
            tgt, stp = (lambda c: c <= tr['V'] - D / 2), (lambda c: c >= tr['Hi'] + X / 2)
    else:                                       # mirrored about the entry (null 2)
        if side == 'C':
            tgt, stp = (lambda c: c >= c0 + 1.5 * D), (lambda c: c <= tr['Lo'] - X / 2)
        else:
            tgt, stp = (lambda c: c <= c0 - 1.5 * D), (lambda c: c >= tr['Hi'] + X / 2)

    def rule(mm):
        c = closes.get(mm - 1)
        if c is None:
            return None
        if stp(c):
            return 'stop'
        if mode == 'A' and tgt(c):
            return 'target'
        return None
    return rule


# ---------------------------------------------------------------- chain board (vectorised greeks)

_BD = {}


def board_all(root, day, spot_bars):
    """The whole day's 1-minute chain with IV/|delta| at each row's use time t = (m+1)*60 + 60? No: a row stamped m is
    used at decision t = (m+1)*60 (stamped <= t - 60), with spot = close of bar m (closed at t)."""
    k = (root, day)
    if k in _BD:
        return _BD[k]
    c = ES.chain(root, day)
    if c is None or not len(c):
        _BD[k] = None
        return None
    c = c[(c.bid > 0) & (c.ask > c.bid)].copy()
    sp = dict(zip(spot_bars.m.values.tolist(), spot_bars.c.values.tolist()))
    c['S'] = c.m.map(sp)
    c = c[np.isfinite(c.S)]
    t = (c.m.values.astype(float) + 1) * 60
    T = np.maximum(960 - t / 60.0, 1.0) / YEAR_MIN
    mid = (c.bid.values + c.ask.values) / 2
    call = c.r.values == 1
    c['iv'] = iv_vec(mid, c.S.values, c.k.values, T, call)
    c['dl'] = np.abs(delta_vec(c.S.values, c.k.values, T, np.nan_to_num(c.iv.values, nan=0.2), call))
    c['spr'] = (c.ask.values - c.bid.values) / mid
    _BD[k] = c
    if len(_BD) > 24:
        _BD.pop(next(iter(_BD)))
    return c


def bs_vec(S, K, T, v, call):
    sq = v * np.sqrt(T)
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    cpx = S * ndtr(d1) - K * ndtr(d1 - sq)
    return np.where(call, cpx, cpx - S + K)


def delta_vec(S, K, T, v, call):
    sq = v * np.sqrt(T)
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    n = ndtr(d1)
    return np.where(call, n, n - 1)


def iv_vec(price, S, K, T, call, it=40):
    a = np.full(price.shape, 0.01)
    b = np.full(price.shape, 5.0)
    for _ in range(it):
        m = 0.5 * (a + b)
        up = bs_vec(S, K, T, m, call) > price
        b = np.where(up, m, b)
        a = np.where(up, a, m)
    intrinsic = np.where(call, np.maximum(S - K, 0), np.maximum(K - S, 0))
    return np.where(price > intrinsic + 1e-4, 0.5 * (a + b), np.nan)


def select(root, day, t, side, spot_bars):
    c = board_all(root, day, spot_bars)
    if c is None:
        return None
    b = c[(c.m == (t - 60) // 60) & (c.r == (1 if side == 'C' else 0))]
    lo, hi = ASK_BAND[root]
    ok = (np.isfinite(b.iv.values) & (b.dl.values >= 0.15) & (b.dl.values <= 0.25) & (b.ask.values >= lo)
          & (b.ask.values <= hi) & (b.spr.values <= 0.10) & (b['as'].values >= 1))
    if not ok.any():
        return None
    x = b[ok]
    i = int(np.argmin(np.abs(x.dl.values - 0.20)))
    r = x.iloc[i]
    return {'k': float(r.k), 'call': side == 'C', 'delta': float(r.dl), 'iv': float(r.iv), 'bid0': float(r.bid),
            'ask0': float(r.ask), 'spr0': float(r.spr), 'S': float(r.S)}


def m1_path(root, day, k, call):
    c = ES.chain(root, day)
    x = c[(c.k == k) & (c.r == (1 if call else 0))].sort_values('m')
    return {'s': (x.m.values.astype(np.int64) * 60), 'bid': x.bid.values.astype(float), 'ask': x.ask.values.astype(float),
            'as': x['as'].values.astype(np.int64)}


# ---------------------------------------------------------------- 1-second quotes

def _clock(s):
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def q1s(root, day, k, call, start, end):
    ks = f'{k:.3f}'.rstrip('0').rstrip('.')
    f = os.path.join(VROOT, 'q1s', root, day, f'{ks}{"C" if call else "P"}_{start}_{end}.npz')
    if os.path.exists(f):
        z = np.load(f)
        return {x: z[x] for x in z.files}
    if os.environ.get('NOFETCH'):
        return None
    y = day.replace('-', '')
    url = (f'{BASE}/option/history/quote?symbol={root}&expiration={y}&strike={ks}&right={"call" if call else "put"}'
           f'&start_date={y}&end_date={y}&interval=1s&start_time={_clock(start)}&end_time={_clock(end)}&format=csv')
    txt = None
    for a in range(4):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
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
        df = pd.read_csv(io.StringIO(txt))
        ts = pd.to_datetime(df['timestamp'])
        out = {'s': (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).values.astype(np.int32),
               'bid': df['bid'].values.astype(np.float32), 'ask': df['ask'].values.astype(np.float32),
               'bs': df['bid_size'].values.astype(np.int32), 'as': df['ask_size'].values.astype(np.int32)}
    np.savez_compressed(f, **out)
    return out


# ---------------------------------------------------------------- one trade (any quote grid)

def run(path, t, t_end, mode, ur, max_wait=60):
    """Enter at the ask of the first quote >= t + LAT (bid, ask > 0, ask size >= 1) within max_wait s. Walk the path;
    decision d on the first exit rule; exit at the bid of the first quote >= d + LAT. Underlying rules are evaluated on
    each bar as it closes (bar mm-1 at mm*60 <= current quote second)."""
    s, bid, ask, asz = path['s'], path['bid'], path['ask'], path['as']
    if not len(s):
        return None
    ok = (s >= t + LAT) & (bid > 0) & (ask > 0) & (asz >= 1)
    if not ok.any():
        return None
    i0 = int(np.flatnonzero(ok)[0])
    if s[i0] > t + max_wait:
        return None
    fill = float(ask[i0])
    peak, armed, decide, why = float(bid[i0]), False, None, 'time'
    last_min = int(s[i0]) // 60
    win = s <= t_end
    dbl = bool(np.any(bid[i0:][win[i0:]] >= 2 * fill))
    for j in range(i0 + 1, len(s)):
        sj = int(s[j])
        if sj >= t_end:
            decide, why = t_end, 'time'
            break
        if ur is not None and sj // 60 > last_min:
            for mm in range(last_min + 1, sj // 60 + 1):
                assert mm * 60 <= sj, 'look-ahead: bar not closed'
                r = ur(mm)
                if r:
                    decide, why = mm * 60, r
                    break
            last_min = sj // 60
            if decide is not None:
                break
        b = float(bid[j])
        if b <= 0:
            continue
        if mode == 'A' and b >= 2 * fill:
            decide, why = sj, 'double'
            break
        if mode == 'B':
            peak = max(peak, b)
            armed = armed or b >= 2 * fill
            if armed and b <= 0.7 * peak:
                decide, why = sj, 'trail'
                break
    if decide is None:
        decide = t_end
    k = np.flatnonzero((s >= decide + LAT) & (bid > 0))
    xb = float(bid[k[0]]) if len(k) else 0.0
    xs = int(s[k[0]]) if len(k) else int(s[-1])
    return {'fill': fill, 'fill_s': int(s[i0]), 'exit': xb, 'exit_s': xs, 'why': why, 'dbl': dbl,
            'ret': xb / fill - 1, 'ret_fee': (xb * 100 - FEE) / (fill * 100 + FEE) - 1}


def t_end_of(t):
    return min(t + HOLD, FLAT)


# ---------------------------------------------------------------- materialise triggers + 1-s trades

def session_triggers(root, day):
    tb = vbars(TRIG_SYM[root], day)
    if len(tb) < 300:
        return None, None, None
    tb = add_vwap(tb)
    spot = tb if root != 'SPXW' else ES.day_bars('SPXW', day)
    out = {}
    for side in SIDES:
        for x in XS:
            tr = trigger(tb, side, x)
            if tr:
                tr['side'] = side
            out[f'{side}-{x}'] = tr
    return tb, spot, out


def days_for(root, which):
    ex = EF.expirations(root)
    return [d for d in EF.want_days(which) if d in ex and ES.chain(root, d) is not None]


def materialise(which, fetch=True):
    f = os.path.join(VROOT, f'trades_{which}.json')
    have = json.load(open(f)) if os.path.exists(f) else {}
    n = 0
    for root in (os.environ.get('V_ROOTS', ','.join(ROOTS)).split(',')):
        for d in days_for(root, which):
            key = f'{root}|{d}'
            if key in have and not have[key].get('missing'):
                continue
            tb, spot, trs = session_triggers(root, d)
            rec = {'root': root, 'day': d, 'trig': {}, 'sel': {}, 'res': {}}
            if tb is None:
                rec['nobars'] = True
                have[key] = rec
                continue
            missing = False
            for sx, tr in trs.items():
                rec['trig'][sx] = tr
                if not tr:
                    continue
                side = sx[0]
                sel = select(root, d, tr['t'], side, spot)
                rec['sel'][sx] = sel
                if not sel:
                    continue
                te = t_end_of(tr['t'])
                q = q1s(root, d, sel['k'], sel['call'], tr['t'], te + 30) if fetch else None
                if q is None:
                    missing = True
                    continue
                for mode in MODES:
                    rec['res'][f'{sx}-{mode}'] = run(q, tr['t'], te, mode, under_rule(tb, tr, side, mode))
                n += 1
            rec['missing'] = missing
            have[key] = rec
            if n and n % 25 == 0:
                json.dump(have, open(f, 'w'))
                print(f'{which}: {n} trades fetched, at {root} {d}', flush=True)
    json.dump(have, open(f, 'w'))
    return have


def trades_of(have, v):
    root, side, x, mode = v.split('-')
    out = []
    for rec in have.values():
        if rec['root'] != root:
            continue
        r = rec.get('res', {}).get(f'{side}-{x}-{mode}')
        if r:
            out.append({**r, 'day': rec['day']})
    return out


if __name__ == '__main__':
    cmd, which = sys.argv[1], sys.argv[2]
    if cmd == 'run':
        materialise(which, fetch='--nofetch' not in sys.argv)
