"""EDGE-D2 features and labels (PREREG "Features", "Targets"). Strictly point in time; DEV only.

  python3 features_d2.py daily          -> v2data/edge-d2/daily.parquet  (Model P features, Y1/Y2 labels, every DEV session)
  python3 features_d2.py board [nw]     -> v2data/edge-d2/board/<D>.json (Models O/F features + IM for Y3; resumable)
  python3 features_d2.py merge          -> v2data/edge-d2/features.parquet
"""
import datetime as dt, json, math, os, sys
import numpy as np
import pandas as pd
from common_d2 import EDGE, HERE, OUT, YEAR_MIN, assert_dev, daily, split_of

LOOKBACK = 21
BAR_DIR = os.path.join(EDGE, 'bars', 'SPX')


def month_all_dev(mon):
    y, m = int(mon[:4]), int(mon[5:7])
    d = dt.date(y, m, 1)
    while d.month == m:
        if d.weekday() < 5 and split_of(d.isoformat()) != 'DEV':
            return False
        d += dt.timedelta(days=1)
    return True


_BARS = {}


def bars_of(day):
    """SPX 1-minute bars of a DEV day from EDGE's cache; month files holding any non-DEV weekday are never opened."""
    assert_dev(day)
    mon = day[:7]
    if mon not in _BARS:
        f = os.path.join(BAR_DIR, f'{mon}.parquet')
        _BARS[mon] = pd.read_parquet(f) if (os.path.exists(f) and month_all_dev(mon)) else None
    b = _BARS[mon]
    if b is None:
        return None
    x = b[(b.d == day) & (b.o > 0) & (b.c > 0)].sort_values('m')
    return x if len(x) >= 300 else None


def lookback_ok(days, i):
    if i < LOOKBACK:
        return False
    w = days[i - LOOKBACK:i + 1]
    a, b = dt.date.fromisoformat(w[0]), dt.date.fromisoformat(w[-1])
    for x, y in zip(w[:-1], w[1:]):
        if (dt.date.fromisoformat(y) - dt.date.fromisoformat(x)).days > 5:
            return False
    d = a
    while d <= b:
        if d.weekday() < 5 and split_of(d.isoformat()) != 'DEV':
            return False
        d += dt.timedelta(days=1)
    return True


def opex_days(days):
    """Monthly opex: the third Friday, or the session before it when that Friday is not a session."""
    s = set(days)
    out = set()
    for y in range(2017, 2026):
        for m in range(1, 13):
            d = dt.date(y, m, 1)
            fr = [d + dt.timedelta(days=k) for k in range(31) if (d + dt.timedelta(days=k)).month == m and (d + dt.timedelta(days=k)).weekday() == 4]
            f3 = fr[2]
            if f3.isoformat() in s:
                out.add(f3.isoformat())
            else:
                th = f3 - dt.timedelta(days=1)
                out.add(th.isoformat())
    return out


def build_daily():
    d = daily()
    days = d.day.tolist()
    cal = pd.read_csv(os.path.join(HERE, 'macro_calendar.csv'), dtype=str)
    cal['day'] = cal.date.str[:4] + '-' + cal.date.str[4:6] + '-' + cal.date.str[6:]
    cpinfp = set(cal[cal.event.isin(['CPI', 'NFP'])].day)
    fomc = set(cal[cal.event == 'FOMC'].day)
    opex = opex_days(days)
    C, O, H, L = d.close.values, d.open.values, d.high.values, d.low.values
    V, V9 = d.vix.values, d.vix9d.values
    lr = np.r_[np.nan, np.log(C[1:] / C[:-1])]
    rows = []
    for i, day in enumerate(days):
        if not lookback_ok(days, i):
            continue
        assert_dev(day)
        r5, r20 = lr[i - 5:i], lr[i - 20:i]
        rec = {'day': day,
               'lvix': math.log(V[i - 1]) if V[i - 1] > 0 else np.nan,
               'dvix': math.log(V[i - 1] / V[i - 2]) if V[i - 1] > 0 and V[i - 2] > 0 else np.nan,
               'vts': V9[i - 1] / V[i - 1] if (V9[i - 1] == V9[i - 1]) and V[i - 1] > 0 else np.nan,
               'gap': abs(math.log(O[i] / C[i - 1])) * 100,
               'lrange': math.log(max(H[i - 1] / L[i - 1] - 1, 1e-5)),
               'lrv5': math.log(math.sqrt(252 * np.mean(r5 ** 2)) + 1e-6),
               'lrv20': math.log(math.sqrt(252 * np.mean(r20 ** 2)) + 1e-6),
               'cpinfp': int(day in cpinfp), 'fomc': int(day in fomc)}
        wd = dt.date.fromisoformat(day).weekday()
        for k, nm in enumerate(('dow_mon', 'dow_tue', 'dow_wed', 'dow_thu')):
            rec[nm] = int(wd == k)
        rec['opex'] = int(day in opex)
        # labels: 1-minute bars where cached (09:30 open .. 15:59 close), else EOD
        b = bars_of(day)
        if b is not None and int(b.m.iloc[0]) == 570:
            o, c, h, l = float(b.o.iloc[0]), float(b[b.m <= 959].c.iloc[-1]), float(b[b.m <= 959].h.max()), float(b[b.m <= 959].l.min())
            rec['lab_src'] = 'bars'
        else:
            o, c, h, l = O[i], C[i], H[i], L[i]
            rec['lab_src'] = 'eod'
        rec.update({'O': o, 'C': c, 'H': h, 'L': l, 'oc': abs(c / o - 1), 'hl': (h - l) / o,
                    'eod_oc': abs(C[i] / O[i] - 1), 'eod_open': O[i]})
        # previous session's |o->c| (for B-YB) with the same source rule
        pb = bars_of(days[i - 1]) if split_of(days[i - 1]) == 'DEV' else None
        if pb is not None and int(pb.m.iloc[0]) == 570:
            rec['prev_oc'] = abs(float(pb[pb.m <= 959].c.iloc[-1]) / float(pb.o.iloc[0]) - 1)
        else:
            rec['prev_oc'] = abs(C[i - 1] / O[i - 1] - 1)
        rows.append(rec)
    df = pd.DataFrame(rows)
    df['Y1'] = (df.oc > 0.015).astype(int)
    df['Y2'] = (df.oc > 0.010).astype(int)
    f = os.path.join(OUT, 'daily.parquet')
    df.to_parquet(f + '.tmp', index=False)
    os.replace(f + '.tmp', f)
    return df


# ---------------------------------------------------------------- board features (Models O, F)
def _atm(board, S, T):
    import sim
    b = board[(board.bid > 0) & (board.ask > board.bid)]
    if not len(b):
        return None
    ks = np.array(sorted(set(b[b.r == 1].k) & set(b[b.r == 0].k)), float)
    if not len(ks):
        return None
    k = float(ks[int(np.argmin(np.abs(ks - S)))])
    c = b[(b.k == k) & (b.r == 1)].iloc[0]
    p = b[(b.k == k) & (b.r == 0)].iloc[0]
    cm, pm = (float(c.bid) + float(c.ask)) / 2, (float(p.bid) + float(p.ask)) / 2
    iv = sim.implied_vol(np.array([cm, pm]), S, np.array([k, k]), T, np.array([True, False]))
    iv = [float(v) for v in iv if np.isfinite(v) and 0.01 < v < 5]
    return {'k': k, 'cm': cm, 'pm': pm, 'iv': float(np.mean(iv)) if iv else np.nan}


def board_one(day):
    f = os.path.join(OUT, 'board', f'{day}.json')
    if os.path.exists(f):
        return 'have'
    assert_dev(day)
    sys.path.insert(0, os.path.join(HERE, '..', 'edge-g'))
    import book, gex, sim
    out = {'day': day, 'ok': 0}
    bars = bars_of(day)
    ch = sim.chain('SPXW', day)
    if bars is None or ch is None or int(bars.m.iloc[0]) != 570:
        out['why'] = 'no bars/chain'
    else:
        m = 574
        bq = bars[bars.m <= m - 1]
        bS = bars[bars.m <= m]
        if not len(bq) or int(bS.m.iloc[-1]) != m:
            out['why'] = 'no 09:34 bar'
        else:
            S_q, S = float(bq.c.iloc[-1]), float(bS.c.iloc[-1])
            O = float(bars.o.iloc[0])
            T0 = (960 - m) / YEAR_MIN
            a0 = _atm(ch[ch.m == m], S_q, T0)
            if a0 is None or not np.isfinite(a0['iv']):
                out['why'] = 'no 0DTE atm'
            else:
                out.update({'ok': 1, 'S': S, 'S_q': S_q, 'O': O, 'iv0': a0['iv'], 'im': (a0['cm'] + a0['pm']) / S_q})
                # next expiry board (edge-r), stamp 09:34
                ex = book.next_expiry('SPXW', day)
                fb = os.path.join(sim.ROOT, '..', 'edge-r', 'board', 'SPXW', f'{day}_{ex}.parquet') if ex else None
                if fb and os.path.exists(fb):
                    nb = pd.read_parquet(fb)
                    T1 = ((960 - m) + 390.0 * book.nsess(day, ex)) / YEAR_MIN
                    a1 = _atm(nb[nb.m == m], S_q, T1)
                    out['iv1'] = a1['iv'] if a1 else np.nan
                    out['exp1'] = ex
                else:
                    out['iv1'] = np.nan
                # dealer gamma at 09:35 (EDGE-G book)
                try:
                    st = book.load_static('SPXW', day)
                    rd = book.read_legs(st, 'SPXW', day, 575 * 60) if st else None
                    if rd is not None:
                        fr = gex.repriced_flip(rd['legs'], rd['S'], fast=True)
                        out['net'] = float(fr['netAtSpot'])
                        out['flip'] = None if fr['flip'] is None else float(fr['flip'])
                        out['book_S'] = rd['S']
                    else:
                        out['book_why'] = 'no legs'
                except Exception as e:  # Pending input or missing OI
                    out['book_why'] = f'{type(e).__name__}: {e}'[:200]
                # first 30 minutes (Model F; visible at 10:00)
                b30 = bars[(bars.m >= 570) & (bars.m <= 599)]
                if len(b30) >= 25 and int(b30.m.iloc[-1]) == 599:
                    out['S10'] = float(b30.c.iloc[-1])
                    r = np.diff(np.log(b30.c.values.astype(float)))
                    out['rv30'] = float(np.sqrt(np.mean(r ** 2)) * math.sqrt(YEAR_MIN))
    os.makedirs(os.path.dirname(f), exist_ok=True)
    with open(f + '.tmp', 'w') as fh:
        json.dump(out, fh)
    os.replace(f + '.tmp', f)
    return out.get('why', 'ok')


def board_days():
    d = sorted(x[:10] for x in os.listdir(os.path.join(EDGE, 'chain', 'SPXW')) if x.endswith('.parquet'))
    return [x for x in d if split_of(x) == 'DEV']


def build_board(nw=2):
    from multiprocessing import Pool
    days = board_days()
    with Pool(nw) as p:
        res = p.map(board_one, days, chunksize=4)
    print(pd.Series(res).value_counts().to_dict())


def merge():
    d = pd.read_parquet(os.path.join(OUT, 'daily.parquet'))
    rows = []
    for day in board_days():
        f = os.path.join(OUT, 'board', f'{day}.json')
        if os.path.exists(f):
            rows.append(json.load(open(f)))
    b = pd.DataFrame(rows)
    b = b[b.ok == 1].copy()
    b['livr'] = np.log(b.iv0 / b.iv1)
    b['lim'] = np.log(b.im)
    b['has_book'] = b.net.notna() if 'net' in b else False
    b['gshort'] = (b.net > 0).astype(float).where(b.has_book)
    em_day = b.S * b.iv0 * math.sqrt(1 / 252)
    fd = (b.S - b.flip.astype(float)).abs() / em_day
    b['fdist'] = np.where(b.flip.isna(), 3.0, np.minimum(fd, 3.0))
    b.loc[~b.has_book, 'fdist'] = np.nan
    b['mv30'] = np.abs(np.log(b.S10 / b.O)) / (b.iv0 * math.sqrt(30 / YEAR_MIN))
    b['rvr30'] = b.rv30 / b.iv0
    keep = ['day', 'iv0', 'iv1', 'im', 'livr', 'lim', 'has_book', 'gshort', 'fdist', 'mv30', 'rvr30', 'net', 'flip', 'S']
    m = d.merge(b[keep], on='day', how='left')
    m['board'] = m.iv0.notna() & m.has_book.fillna(False).astype(bool)
    m['Y3'] = np.where(m.im.notna(), (m.hl > 2 * m.im).astype(float), np.nan)
    f = os.path.join(OUT, 'features.parquet')
    m.to_parquet(f + '.tmp', index=False)
    os.replace(f + '.tmp', f)
    print(len(m), 'days;', int(m.board.sum()), 'board days;', int(m.iv0.notna().sum()), 'with 0DTE atm;',
          int(m.iv1.notna().sum()), 'with next expiry;', 'label source', m.lab_src.value_counts().to_dict())


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'daily':
        df = build_daily()
        print(len(df), df.day.min(), df.day.max(), df.lab_src.value_counts().to_dict())
    elif cmd == 'board':
        build_board(int(sys.argv[2]) if len(sys.argv) > 2 else 2)
    elif cmd == 'one':
        print(board_one(sys.argv[2]))
    elif cmd == 'merge':
        merge()
