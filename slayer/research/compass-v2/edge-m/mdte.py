"""EDGE-M (specs/PREREG.md): EDGE's E1/E2 triggers expressed through 0 / 1 / 2-3 DTE long calls and puts.

  python3 mdte.py run            fetch (1 request in flight) + simulate every trigger, both sides, every bucket
  python3 mdte.py run --nofetch

Reuses edge/sim.py (run_trade, bootstrap, BS) and edge/hyp.py (trig_e1, trig_e2, under_rule_e2) unchanged.
Reads EDGE's store (v2data/edge, read-only); writes only under v2data/edge-m/.
"""
import io, json, math, os, sys, time, urllib.request
import numpy as np
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
import sim
import hyp
import fetch as F

MROOT = '/home/user/falcon-cloud-field-sail/v2data/edge-m'
BASE = 'http://127.0.0.1:25503/v3'
BAND = {'SPY': 14, 'QQQ': 14, 'IWM': 14, 'SPXW': 24}
H_MIN = {'E1': 33.5, 'E2': 120.0}
TGT = {'E1': 0.35, 'E2': 0.30}
LO, HI, SPR_MAX = 0.30, 0.45, 0.05
ON_EXIT = 86400 + 9 * 3600 + 45 * 60  # 09:45:00 next session on the concatenated clock
SESS = F.sessions()
SIDX = {d: i for i, d in enumerate(SESS)}
NREQ = [0]


def get(url, tries=4):
    for k in range(tries):
        try:
            NREQ[0] += 1
            with urllib.request.urlopen(BASE + url, timeout=240) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                return ''
            time.sleep(3 * (k + 1))
        except Exception:
            time.sleep(5 * (k + 1))
    return None


# ---------------------------------------------------------------- expiries / sessions


def next_session(d, n=1):
    i = SIDX.get(d)
    return SESS[i + n] if i is not None and i + n < len(SESS) else None


def expiry_for(root, d, bucket):
    """(expiry date, n trading sessions after d) for a bucket '0', '1', '23'; None if the root has none."""
    ex = F.expirations(root)
    if bucket == '0':
        return (d, 0) if d in ex else None
    if bucket == '1':
        e = next_session(d, 1)
        return (e, 1) if e and e in ex else None
    for n in (2, 3):
        e = next_session(d, n)
        if e and e in ex:
            return (e, n)
    return None


def T_of(t_sec, n):
    return (max(960 - t_sec / 60.0, 1.0) + 390 * n) / sim.YEAR_MIN


# ---------------------------------------------------------------- boards


def board_m(root, d, exp, minute):
    """The 1-minute quotes of expiry exp stamped at `minute` (= (t-60)//60) on day d. 0DTE: EDGE's chain store."""
    if exp == d:
        c = sim.chain(root, d)
        if c is None or not len(c):
            return None
        b = c[c.m == minute]
        return b if len(b) else None
    f = os.path.join(MROOT, 'board', root, f'{d}_{exp}.parquet')
    if not os.path.exists(f):
        if NOFETCH:
            return None
        y, ye = d.replace('-', ''), exp.replace('-', '')
        t = get(f'/option/history/quote?symbol={root}&expiration={ye}&date={y}&interval=1m&strike_range={BAND[root]}'
                f'&start_time=09:59:00&end_time=15:24:00&format=csv')
        if t is None:
            return None
        os.makedirs(os.path.dirname(f), exist_ok=True)
        if not t.strip() or not t.startswith('symbol'):
            pd.DataFrame({'m': pd.Series(dtype='int16')}).to_parquet(f)
        else:
            df = pd.read_csv(io.StringIO(t))
            ts = pd.to_datetime(df['timestamp'])
            out = pd.DataFrame({'m': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'), 'k': df['strike'].astype('float32'),
                                'r': (df['right'].str.upper().str[0] == 'C').astype('int8'), 'bid': df['bid'].astype('float32'),
                                'ask': df['ask'].astype('float32'), 'bs': df['bid_size'].astype('int32'), 'as': df['ask_size'].astype('int32')})
            out[out.m.isin([599, 924])].to_parquet(f, compression='zstd')
    b = pd.read_parquet(f)
    b = b[b.m == minute] if len(b) else b
    return b if len(b) else None


def select_m(b, S, T, call, tgt):
    """Gate per PREREG: |delta| 0.30-0.45 nearest tgt, spread <= 5% of mid, bid/ask size >= 1, ask <= 0.6 EM."""
    if b is None or not np.isfinite(S):
        return None
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
    side = b.r.values == (1 if call else 0)
    dl = np.abs(sim.bs_delta(S, b.k.values, T, np.where(np.isfinite(iv), iv, v_atm), b.r.values == 1))
    spr = (b.ask.values - b.bid.values) / mid
    ok = (side & np.isfinite(iv) & (dl >= LO) & (dl <= HI) & (spr <= SPR_MAX) & (b.ask.values <= 0.6 * em)
          & (b.bs.values >= 1) & (b['as'].values >= 1))
    if not ok.any():
        return None
    i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - tgt))]
    k, v, m = float(b.k.values[i]), float(iv[i]), float(mid[i])
    dT = 1.0 / sim.YEAR_MIN
    p0 = float(sim.bs_price(S, k, T, v, call))
    p1 = float(sim.bs_price(S, k, max(T - dT, 1e-9), v, call))
    return {'k': k, 'call': bool(call), 'delta': float(dl[i]), 'iv': v, 'atm_iv': v_atm, 'em': em, 'S': S, 'T': T,
            'bid0': float(b.bid.values[i]), 'ask0': float(b.ask.values[i]), 'mid0': m, 'spr0': float(spr[i]),
            'theta_h': (p0 - p1) * 60 / m}


def gate_stats(b, S, T, call, tgt):
    """Cost-table marks without the 5% spread gate: the contract nearest tgt in 0.30-0.45 (any spread)."""
    if b is None:
        return None
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    if not len(b):
        return None
    mid = (b.bid.values + b.ask.values) / 2
    iv = sim.implied_vol(mid, S, b.k.values, T, b.r.values == 1)
    side = (b.r.values == (1 if call else 0)) & np.isfinite(iv)
    if not side.any():
        return None
    dl = np.abs(sim.bs_delta(S, b.k.values, T, np.where(np.isfinite(iv), iv, 0.2), b.r.values == 1))
    ok = side & (dl >= LO) & (dl <= HI)
    if not ok.any():
        return None
    i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - tgt))]
    k, v, m = float(b.k.values[i]), float(iv[i]), float(mid[i])
    dT = 1.0 / sim.YEAR_MIN
    th = (float(sim.bs_price(S, k, T, v, call)) - float(sim.bs_price(S, k, max(T - dT, 1e-9), v, call))) * 60 / m
    return {'spr': float((b.ask.values[i] - b.bid.values[i]) / m), 'theta_h': th, 'mid': m, 'delta': float(dl[i])}


# ---------------------------------------------------------------- 1-second paths


def _clock(s):
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def q1s_m(root, qday, exp, k, call, start, end):
    ks = f'{k:.3f}'.rstrip('0').rstrip('.')
    f = os.path.join(MROOT, 'q1s', root, qday, f'{exp}_{ks}{"C" if call else "P"}_{start}_{end}.npz')
    if os.path.exists(f):
        z = np.load(f)
        return {x: z[x] for x in z.files}
    if exp == qday:  # 0DTE: EDGE's 30-minute chunk cache (read-only)
        parts, a = [], start
        while a < end:
            b = min(a + hyp.CHUNK, end)
            g = os.path.join(sim.ROOT, 'q1s', root, qday, f'{ks}{"C" if call else "P"}_{a}_{b}.npz')
            if not os.path.exists(g):
                parts = None
                break
            z = np.load(g)
            parts.append({x: z[x] for x in z.files})
            a = b + 1
        if parts:
            return {x: np.concatenate([p[x] for p in parts]) for x in parts[0]}
    if NOFETCH:
        return None
    y, ye = qday.replace('-', ''), exp.replace('-', '')
    txt = get(f'/option/history/quote?symbol={root}&expiration={ye}&strike={ks}&right={"call" if call else "put"}'
              f'&start_date={y}&end_date={y}&interval=1s&start_time={_clock(start)}&end_time={_clock(end)}&format=csv')
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


# ---------------------------------------------------------------- exits


def s1m_of(H, tr, bars):
    if H == 'E1':
        return tr.get('s1m', np.nan)
    w = bars[(bars.m >= 570) & (bars.m <= 599)].c.values
    return float(np.std(np.diff(np.log(w)), ddof=1)) if len(w) > 5 else np.nan


def sigma_opt(H, sel, s1m):
    return sel['delta'] * sel['S'] * s1m * math.sqrt(H_MIN[H]) / sel['ask0']


_SREF = {}


def sigma_ref(H):
    """Median sigma_opt over EDGE's 0DTE real-side DEV selections (entry marks only)."""
    if H in _SREF:
        return _SREF[H]
    f = os.path.join(MROOT, 'sigma_ref.json')
    have = json.load(open(f)) if os.path.exists(f) else {}
    if H not in have:
        e = json.load(open(os.path.join(sim.ROOT, 'results', f'{H}_DEV.json')))
        xs = []
        for rec in e.values():
            if not rec or not rec['sides'].get('real') or not rec['sides']['real'].get('sel'):
                continue
            sel = rec['sides']['real']['sel']
            s1 = rec['trig'].get('s1m') if H == 'E1' else s1m_of('E2', rec['trig'], sim.day_bars(rec['root'], rec['day']))
            if s1 and np.isfinite(s1):
                xs.append(sigma_opt(H, sel, s1))
        have[H] = float(np.median(xs))
        os.makedirs(MROOT, exist_ok=True)
        json.dump(have, open(f, 'w'))
    _SREF[H] = have[H]
    return have[H]


def rules_for(H, sel, s1m):
    rho = float(np.clip(sigma_opt(H, sel, s1m) / sigma_ref(H), 0.1, 1.5)) if np.isfinite(s1m) else 1.0
    return rho, {'stop': 1 - 0.5 * rho, 'trail_arm': 1 + 0.25 * rho, 'trail': 1 - 0.25 * rho}


def under_at(root, day, s):
    """Underlying close of the last 1-min bar closed by second s (s >= 86400 -> next session)."""
    if s >= 86400:
        day, s = next_session(day), s - 86400
    b = sim.day_bars(root, day)
    x = b[b.m <= s // 60 - 1]
    return float(x.c.iloc[-1]) if len(x) else np.nan


VARS = {'E1': {'0': ['M1'], '1': ['M2'], '23': ['M3', 'M4']}, 'E2': {'1': ['M5'], '23': ['M6']}}
ALL = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']
HOF = {'M1': 'E1', 'M2': 'E1', 'M3': 'E1', 'M4': 'E1', 'M5': 'E2', 'M6': 'E2', 'M7': 'E2', 'M8': 'E1'}


def do_side(H, root, d, tr, bars, bucket, call, s1m):
    ex = expiry_for(root, d, bucket)
    if ex is None:
        return {'noexp': True}
    exp, n = ex
    minute = (tr['t'] - 60) // 60
    b = board_m(root, d, exp, minute)
    T = T_of(tr['t'], n)
    cost = gate_stats(b, tr['S'], T, call, TGT[H])
    sel = select_m(b, tr['S'], T, call, TGT[H])
    out = {'exp': exp, 'n': n, 'cost': cost, 'sel': sel, 'res': {}}
    if sel is None:
        return out
    rho, rules = rules_for(H, sel, s1m)
    out['rho'] = rho
    ur = hyp.under_rule_e2(bars, tr, True) if H == 'E2' else None
    q = q1s_m(root, d, exp, sel['k'], call, int(tr['t']), int(tr['t_end']) + 30)
    if q is None:
        out['missing'] = True
        return out
    for v in VARS[H][bucket]:
        if v == 'M4':
            nd = next_session(d)
            if nd is None or F.is_locked(nd) or nd > exp:
                continue
            q2 = q1s_m(root, nd, exp, sel['k'], call, 9 * 3600 + 30 * 60, 9 * 3600 + 47 * 60)
            if q2 is None:
                out['missing'] = True
                continue
            day_end = q['s'] < 16 * 3600
            path = {x: np.concatenate([q[x][day_end], q2[x] + (86400 if x == 's' else 0)]) for x in q}
            r = sim.run_trade(path, tr['t'], ON_EXIT, {'stop': rules['stop']}, None, None)
        else:
            r = sim.run_trade(q, tr['t'], tr['t_end'], rules, bars, ur)
        if r is None:
            continue
        u0, u1 = under_at(root, d, r['fill_s']), under_at(root, d, r['exit_s'])
        r['ur'] = (math.log(u1 / u0) * (1 if call else -1)) if np.isfinite(u0) and np.isfinite(u1) else np.nan
        out['res'][v] = r
    return out


def jsonable(x):
    if isinstance(x, dict):
        return {k: jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    if isinstance(x, (np.bool_, bool)):
        return bool(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        return float(x)
    return x


def jobs():
    dev = F.want_days('DEV')
    e1_days = set(dev[::2])
    js = [('E2', r, d) for d in dev for r in F.ROOTS] + [('E1', r, d) for d in sorted(e1_days) for r in F.ROOTS]
    rng = np.random.default_rng(0)
    e2 = [j for j in js if j[0] == 'E2']
    e1 = [j for j in js if j[0] == 'E1']
    rng.shuffle(e1)  # random order: a partial run is a random subsample
    return e2 + e1


def run():
    os.makedirs(MROOT, exist_ok=True)
    f = os.path.join(MROOT, 'results_DEV.json')
    have = json.load(open(f)) if os.path.exists(f) else {}
    t0, k = time.time(), 0
    for H, root, d in jobs():
        key = f'{H}|{root}|{d}'
        if key in have:
            continue
        if d not in F.expirations(root) or sim.chain(root, d) is None:
            continue
        tr = hyp.TRIG[H](root, d)
        if tr is None:
            have[key] = None
            continue
        bars = sim.day_bars(root, d)
        s1m = s1m_of(H, tr, bars)
        rec = {'H': H, 'root': root, 'day': d, 'trig': {x: v for x, v in tr.items() if x not in ('band', 'bars')}, 's1m': s1m, 'b': {}}
        for bucket in VARS[H]:
            rec['b'][bucket] = {side: do_side(H, root, d, tr, bars, bucket, call, s1m)
                                for side, call in (('real', tr['up']), ('opp', not tr['up']))}
        have[key] = jsonable(rec)
        k += 1
        if k % 20 == 0:
            json.dump(have, open(f, 'w'))
            print(f'{k} triggers, {NREQ[0]} requests, {time.time() - t0:.0f}s, last {key}', flush=True)
    json.dump(have, open(f, 'w'))
    print('done', k, NREQ[0], f'{time.time() - t0:.0f}s', flush=True)
    return have


NOFETCH = '--nofetch' in sys.argv

if __name__ == '__main__':
    if sys.argv[1] == 'run':
        run()
