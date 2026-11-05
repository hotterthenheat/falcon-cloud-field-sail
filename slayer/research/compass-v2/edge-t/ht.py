"""EDGE-T: H1 opening drive, H2 trend day (live RULES.md), H3 exit factorial (specs/PREREG.md @ 0bfff6f).

  python3 ht.py run [max_minutes]     materialise DEV (fetches 1-second NBBO, one request in flight)
  python3 ht.py run --nofetch         recompute from the cache only

Reuses EDGE's chain store, bars and Black-Scholes helpers (edge/sim.py, read only). Own 1-second cache:
v2data/edge-t/q1s/<root>/<day>/<strike><C|P>.npz = change rows (int cents) from a start second to 15:51:00.
A decision at t sees bars that closed (start <= t - 60), the chain board stamped minute (t - 60)//60 and 1-second
quotes stamped <= the decision second. Results: v2data/edge-t/dev.json.
"""
import json, math, os, sys, time, urllib.request, io
import numpy as np
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
import sim  # noqa: E402
import fetch as F  # noqa: E402

OUT = '/home/user/falcon-cloud-field-sail/v2data/edge-t'
QDIR = os.path.join(OUT, 'q1s')
BASE = 'http://127.0.0.1:25503/v3'
ROOTS = ('SPXW', 'SPY', 'QQQ')
END_S = 15 * 3600 + 51 * 60          # paths are fetched to 15:51:00
FLAT_S = 15 * 3600 + 50 * 60         # RULES.md flat decision 15:50:00
H1_START = 9 * 3600 + 31 * 60        # every H1 path starts 09:31:00
H1_T = [9 * 3600 + m * 60 for m in range(31, 36)]
H1_K = (0.30, 0.60)
DELTAS = (0.20, 0.35)
H2_MARKS = [9 * 3600 + 45 * 60 + 300 * i for i in range(0, 69)]  # 09:45 .. 15:25
assert H2_MARKS[-1] == 15 * 3600 + 25 * 60
STOP, ARM, TRAIL = 0.35, 0.50, 0.25
REVERSAL = 0.004
SANE_SPR = 0.12
NOFETCH = False
STATS = {'fetch': 0, 'fetch_s': 0.0, 'cache': 0}


def locked_month(month):
    return F.is_locked(month + '-15') and F.is_locked(month + '-01') and F.is_locked(month + '-28')


def day_bars(sym_root, day):
    """Bars of a non-locked day (never opens a locked day or a wholly locked month file)."""
    if F.is_locked(day) or locked_month(day[:7]):
        raise AssertionError(f'locked day read: {day}')
    return sim.day_bars(sym_root, day)


_CAL = None


def calendar():
    global _CAL
    if _CAL is None:
        days = set(F.sessions())
        d = os.path.join(sim.ROOT, 'bars', 'SPX')
        for f in os.listdir(d):  # 2021-12 (the month before DEV's 2022-01) is not in sessions.json
            if f[:4] == '2021' and not locked_month(f[:7]):
                days |= set(pd.read_parquet(os.path.join(d, f)).d.unique())
        _CAL = sorted(days)
    return _CAL


def prior_session(day):
    c = calendar()
    i = int(np.searchsorted(c, day))
    return c[i - 1] if i > 0 else None


def sigma_prev(root, day):
    p = prior_session(day)
    if p is None or F.is_locked(p):
        return np.nan
    b = day_bars(root, p)
    if len(b) < 300:
        return np.nan
    return float(np.sqrt(np.sum(np.diff(np.log(b.c.values)) ** 2)))


# ---------------------------------------------------------------- contract selection (board at t - 60)


def select(root, day, t, call, target, S):
    b = sim.board(root, day, t)
    if b is None or not np.isfinite(S):
        return None
    T = max(960 - t / 60.0, 1.0) / sim.YEAR_MIN
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    if not len(b):
        return None
    mid = (b.bid.values + b.ask.values) / 2
    iv = sim.implied_vol(mid, S, b.k.values, T, b.r.values == 1)
    katm = b.k.values[np.argmin(np.abs(b.k.values - S))]
    atm = iv[(b.k.values == katm) & np.isfinite(iv)]
    if not len(atm):
        return None
    v_atm = float(np.mean(atm))
    em = S * v_atm * math.sqrt(T)
    dl = np.abs(sim.bs_delta(S, b.k.values, T, np.where(np.isfinite(iv), iv, v_atm), b.r.values == 1))
    ok = (b.r.values == (1 if call else 0)) & np.isfinite(iv) & (dl >= 0.15) & (dl <= 0.50) & (b.ask.values <= 0.6 * em)
    if not ok.any():
        return None
    i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - target))]
    return {'k': float(b.k.values[i]), 'call': bool(call), 'delta': float(dl[i]), 'iv': float(iv[i]), 'atm_iv': v_atm,
            'S': float(S), 'bid0': float(b.bid.values[i]), 'ask0': float(b.ask.values[i]),
            'spr0': float((b.ask.values[i] - b.bid.values[i]) / mid[i])}


# ---------------------------------------------------------------- 1-second paths


def _clock(s):
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def _fname(root, day, k, call):
    ks = f'{k:.3f}'.rstrip('0').rstrip('.')
    return os.path.join(QDIR, root, day, f'{ks}{"C" if call else "P"}.npz'), ks


def disk_free_gb():
    st = os.statvfs(OUT)
    return st.f_bavail * st.f_frsize / 1e9


def path(root, day, k, call, start):
    """Dense per-second arrays from `start` to END_S (the quote in force each second) or None."""
    f, ks = _fname(root, day, k, call)
    z = None
    if os.path.exists(f):
        z = dict(np.load(f))
        if int(z['start']) > start:
            z = None
        else:
            STATS['cache'] += 1
    if z is None:
        if NOFETCH:
            return None
        if disk_free_gb() < 1.5:
            raise SystemExit('disk free < 1.5 GB: stop fetching')
        y = day.replace('-', '')
        url = (f'{BASE}/option/history/quote?symbol={root}&expiration={y}&strike={ks}&right={"call" if call else "put"}'
               f'&start_date={y}&end_date={y}&interval=1s&start_time={_clock(start)}&end_time={_clock(END_S)}&format=csv')
        t0 = time.time()
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
        STATS['fetch'] += 1
        STATS['fetch_s'] += time.time() - t0
        if txt is None:
            return None
        if not txt.strip() or not txt.startswith('symbol'):
            z = {'s': np.zeros(0, np.int32), 'bid': np.zeros(0, np.int32), 'ask': np.zeros(0, np.int32),
                 'bs': np.zeros(0, np.int32), 'as': np.zeros(0, np.int32), 'start': np.int32(start)}
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
            z = {'s': s[keep], 'bid': bid[keep], 'ask': ask[keep], 'bs': bs[keep], 'as': asz[keep], 'start': np.int32(start),
                 'last': np.int32(s[-1] if len(s) else start)}
        os.makedirs(os.path.dirname(f), exist_ok=True)
        np.savez_compressed(f, **z)
    if not len(z['s']):
        return None
    s0 = int(z['start'])
    grid = np.arange(s0, END_S + 1)
    j = np.searchsorted(z['s'], grid, side='right') - 1
    okj = j >= 0
    jj = np.maximum(j, 0)
    out = {'s0': s0}
    for x in ('bid', 'ask', 'bs', 'as'):
        out[x] = np.where(okj, z[x][jj], 0).astype(np.float64)
    out['bid'] /= 100.0
    out['ask'] /= 100.0
    return out


def at(p, sec, x):
    i = sec - p['s0']
    i = min(max(i, 0), len(p[x]) - 1)
    return p[x][i]


def sane_arr(bid, ask, bs, asz):
    mid = (bid + ask) / 2
    return (bid > 0) & (ask > 0) & (mid > 0) & ((ask - bid) <= SANE_SPR * np.maximum(mid, 1e-9)) & (bs >= 2) & (asz >= 2)


# ---------------------------------------------------------------- one trade


def enter(p, t):
    e = t + 2
    b, a, bs, asz = (at(p, e, x) for x in ('bid', 'ask', 'bs', 'as'))
    if not bool(sane_arr(np.array([b]), np.array([a]), np.array([bs]), np.array([asz]))[0]):
        return None, {'skip': 'insane', 'q': [float(b), float(a), int(bs), int(asz)]}
    return {'fill': float(a), 'fill_s': e, 'bid0': float(b)}, None


def manage(p, ent, call, profit='TR', rev=False, quotes='sane', closes=None, flat=FLAT_S):
    """Exit decision on the RULES.md 10-second check grid (stop -35%, TR trail or TP resting limit, optional
    5-minute reversal on the underlying's closed bars); exit fill at the bid in force at decision + 2 s."""
    fill, e = ent['fill'], ent['fill_s']
    checks = np.arange(e + 10, flat, 10)
    i = checks - p['s0']
    bid, ask, bs, asz = p['bid'][i], p['ask'][i], p['bs'][i], p['as'][i]
    valid = sane_arr(bid, ask, bs, asz) if quotes == 'sane' else (bid > 0)
    cb, ct = bid[valid], checks[valid]
    decide, why = flat, 'flat'
    if len(cb):
        pk = np.maximum.accumulate(np.maximum(cb, ent['bid0']))
        hit = cb <= (1 - STOP) * fill
        if profit == 'TR':
            hit = hit | ((pk >= (1 + ARM) * fill) & (cb <= (1 - TRAIL) * pk))
        x = np.flatnonzero(hit)
        if len(x):
            decide = int(ct[x[0]])
            why = 'stop' if cb[x[0]] <= (1 - STOP) * fill else 'trail'
    if rev and closes is not None:
        for mm in range(e // 60 + 1, decide // 60 + 1):
            if mm * 60 > decide or mm * 60 <= e:
                continue
            c1, c0 = closes.get(mm - 1), closes.get(mm - 6)
            if c1 is None or c0 is None:
                continue
            r5 = c1 / c0 - 1
            if (r5 <= -REVERSAL) if call else (r5 >= REVERSAL):
                decide, why = mm * 60, 'reversal'
                break
    xs = decide + 2
    xb = float(at(p, xs, 'bid'))
    if profit == 'TP':
        tgt = math.ceil(round(fill * 1.5 * 100, 6) - 1e-6) / 100.0
        seg = p['bid'][(e + 1) - p['s0']:(xs) - p['s0']]
        y = np.flatnonzero(seg >= tgt - 1e-9)
        if len(y):
            xs, xb, why = e + 1 + int(y[0]), tgt, 'tp'
    # what the contract did after the exit (sane bids to the flat): for the "it ran later" question
    post = p['bid'][xs - p['s0']:FLAT_S - p['s0']]
    pa = p['ask'][xs - p['s0']:FLAT_S - p['s0']]
    pbs, pas = p['bs'][xs - p['s0']:FLAT_S - p['s0']], p['as'][xs - p['s0']:FLAT_S - p['s0']]
    sv = sane_arr(post, pa, pbs, pas)
    post_max = float(post[sv].max()) if sv.any() else np.nan
    hold = p['bid'][e - p['s0']:xs - p['s0'] + 1]
    return {'fill': fill, 'fill_s': e, 'exit': xb, 'exit_s': int(xs), 'why': why, 'ret': xb / fill - 1,
            'ret_fee': (xb * 100 - sim.FEE) / (fill * 100 + sim.FEE) - 1,
            'mfe': float(hold.max() / fill - 1) if len(hold) else np.nan,
            'post_max': post_max / fill - 1 if np.isfinite(post_max) else np.nan}


H3_CELLS = [(pr, rv, qu) for pr in ('TR', 'TP') for rv in (False, True) for qu in ('sane', 'raw')]


def cell_name(pr, rv, qu):
    return f"H3-{pr}-{'rev' if rv else 'off'}-{qu}"


# ---------------------------------------------------------------- triggers


def spx_day(day):
    b = day_bars('SPXW', day)
    if len(b) < 300:
        return None
    O = float(b.o.iloc[0]) if int(b.m.iloc[0]) == 570 else np.nan
    c944 = b[b.m == 584].c
    C = float(b[b.m <= 959].c.iloc[-1])
    return {'O': O, 'C': C, 'c944': float(c944.iloc[0]) if len(c944) else np.nan, 'move': C / O - 1 if np.isfinite(O) else np.nan}


def trig_h1(bars, sig):
    """{k: (t, up, S)} first decision t in 09:31..09:35 with |S(t)/O - 1| >= k sig (bars closed by t only)."""
    if len(bars) < 300 or int(bars.m.iloc[0]) != 570 or not np.isfinite(sig):
        return {}
    O = float(bars.o.iloc[0])
    out = {}
    for t in H1_T:
        S = sim.spot_at(bars, t)
        r = S / O - 1
        for k in H1_K:
            if k not in out and abs(r) >= k * sig:
                out[k] = (t, bool(r > 0), float(S))
    return out


def trig_h2(spx_bars):
    """[(t, up, S)] RULES.md trigger marks on SPX closed bars."""
    if len(spx_bars) < 300 or int(spx_bars.m.iloc[0]) != 570:
        return []
    O = float(spx_bars.o.iloc[0])
    m, h, l, c = spx_bars.m.values, spx_bars.h.values, spx_bars.l.values, spx_bars.c.values
    out = []
    for t in H2_MARKS:
        last = (t - 60) // 60
        sel = m <= last
        if not sel.any() or m[sel][-1] != last:
            continue
        spot = float(c[sel][-1])
        hi, lo = max(float(h[sel].max()), spot), min(float(l[sel].min()), spot)
        mv = spot / O - 1
        if mv <= -0.015 and spot <= lo * 1.0035:
            out.append((t, False, spot))
        elif mv >= 0.015 and spot >= hi * (1 - 0.0035):
            out.append((t, True, spot))
    return out


# ---------------------------------------------------------------- per root-session


def one_trade(root, day, t, call, target, S, start, cells=None, closes=None):
    sel = select(root, day, t, call, target, S)
    if sel is None:
        return {'sel': None}
    p = path(root, day, sel['k'], call, start)
    if p is None:
        return {'sel': sel, 'missing': True}
    ent, skip = enter(p, t)
    if ent is None:
        return {'sel': sel, 'skip': skip}
    res = {'RT': manage(p, ent, call, closes=closes)}
    for c in (cells or []):
        res[cell_name(*c)] = manage(p, ent, call, profit=c[0], rev=c[1], quotes=c[2], closes=closes)
    return {'sel': sel, 'res': res}


def do_root_session(root, day, spx):
    if day not in F.expirations(root) or sim.chain(root, day) is None or not len(sim.chain(root, day)):
        return None
    bars = day_bars(root, day)
    if len(bars) < 300:
        return None
    closes = dict(zip(bars.m.values.tolist(), bars.c.values.tolist()))
    rec = {'root': root, 'day': day, 'spx': spx, 'h1': {}, 'h2': {}}
    sig = sigma_prev(root, day)
    rec['sig'] = sig
    trig = trig_h1(bars, sig)
    for k, (t, up, S) in trig.items():
        if t == H1_T[0]:  # amendment A1: the 09:30 board is empty; a 09:31 trigger executes at 09:32
            t = H1_T[1]
            S = sim.spot_at(bars, t)
        for d in DELTAS:
            cells = H3_CELLS if (k == 0.30 and d == 0.35) else None
            rec['h1'][f'k{k:.2f}-d{d:.2f}'] = {'t': t, 'up': up, 'S': S,
                                              'real': one_trade(root, day, t, up, d, S, H1_START, cells, closes),
                                              'opp': one_trade(root, day, t, not up, d, S, H1_START, cells, closes)}
    spx_bars = day_bars('SPXW', day)
    marks = trig_h2(spx_bars)
    rec['h2_marks'] = len(marks)
    for d in DELTAS:
        trades, free_at = [], 0
        for (t, up, Sspx) in marks:
            if t < free_at:
                continue
            S = sim.spot_at(bars, t)
            real = one_trade(root, day, t, up, d, S, t)
            opp = one_trade(root, day, t, not up, d, S, t)
            trades.append({'t': t, 'up': up, 'real': real, 'opp': opp})
            if real.get('res'):
                free_at = real['res']['RT']['exit_s']
        rec['h2'][f'd{d:.2f}'] = trades
    return rec


def _clean(x):
    if isinstance(x, dict):
        return {str(k): _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    if isinstance(x, (np.bool_,)):
        return bool(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        return float(x) if np.isfinite(x) else None
    return x


def dev_days():
    ds = [d for d in F.want_days('DEV') if d < '2025-01-01' and not F.is_locked(d)]
    rng = np.random.default_rng(20261105)
    return [ds[i] for i in rng.permutation(len(ds))]


def run(max_minutes=1e9):
    f = os.path.join(OUT, 'dev.json')
    have = json.load(open(f)) if os.path.exists(f) else {}
    t0 = time.time()
    done_days = 0
    for day in dev_days():
        if time.time() - t0 > max_minutes * 60:
            print('time cut', flush=True)
            break
        if all(f'{r}|{day}' in have for r in ROOTS):
            continue
        spx = spx_day(day)
        for root in ROOTS:
            key = f'{root}|{day}'
            if key in have:
                continue
            have[key] = _clean(do_root_session(root, day, spx)) if spx else None
        done_days += 1
        if done_days % 10 == 0:
            json.dump(have, open(f, 'w'))
            n = sum(1 for d in set(k.split('|')[1] for k in have))
            print(f'{time.strftime("%H:%M:%S")} days {n} fetch {STATS["fetch"]} ({STATS["fetch_s"]:.0f}s) cache {STATS["cache"]} '
                  f'disk {disk_free_gb():.2f} GB free', flush=True)
    json.dump(have, open(f, 'w'))
    print('done', STATS, flush=True)
    return have


if __name__ == '__main__':
    if sys.argv[1] == 'run':
        NOFETCH = '--nofetch' in sys.argv
        mm = [float(a) for a in sys.argv[2:] if a[0].isdigit()]
        run(mm[0] if mm else 1e9)
