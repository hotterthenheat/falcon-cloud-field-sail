"""EDGE-D data: SPXW quotes around scheduled releases, built ONLY from the terminal (never the challenger replay).

    python3 fetch_events.py --plan plan.csv        # plan rows: date,event,release_et,kind(event|control)

Per day D with release clock T (08:30 or 14:00):
  chain1m  bulk 1-minute NBBO of the whole first expiration >= D from T-10m to T+7m (selection + implied move only).
           Decision-time rule: a snapshot used at decision t keeps ONLY rows stamped <= t (asserted in build.py).
  legs     1-second NBBO (bid, ask, sizes) from T-10m to the session flat for: the ATM call+put at T-5m (parity
           forward from the chain rows stamped <= T-5m), and a band of strikes around the forward at T+6m
           (3 per side, for 0.25-0.40 delta picks of both signs).
Ints: cents, ms since midnight ET. <=1 terminal request in flight (sequential).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

OUT = os.environ.get('EDGE_D_DATA', '/home/user/falcon-cloud-field-sail/v2data/edge-d')
BASE = 'http://127.0.0.1:25503/v3'


def clock(s):
    h, m, *r = s.split(':')
    return (int(h) * 60 + int(m)) * 60000 + (int(r[0]) * 1000 if r else 0)


def fmt(ms):
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}'


def get(path, params, timeout=300, retries=3):
    url = f'{BASE}{path}?' + urllib.parse.urlencode({**params, 'format': 'csv'})
    last = None
    for a in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                b = r.read()
            if b.startswith(b'io exception') or b.startswith(b'Too many'):
                last = b[:80]
                time.sleep(1 + a)
                continue
            return b
        except Exception as e:  # noqa
            last = repr(e)
            time.sleep(2 + 2 * a)
    raise RuntimeError(f'{path} {params}: {last}')


def csv(path, params, **kw):
    b = get(path, params, **kw)
    if not b.strip() or b.startswith(b'No data'):
        return None
    df = pd.read_csv(io.BytesIO(b))
    return df if len(df) else None


def ms_of(s):
    v = s.astype(str).str
    return (v[11:13].astype(int) * 3600000 + v[14:16].astype(int) * 60000 + v[17:19].astype(int) * 1000
            + v[20:23].str.ljust(3, '0').replace('', '0').astype(int)).astype('int64').values


_exp = None


def expirations():
    global _exp
    if _exp is None:
        df = csv('/option/list/expirations', {'symbol': 'SPXW'})
        _exp = sorted(df.expiration.astype(str).str.replace('-', '').tolist())
    return _exp


def norm_quotes(q, exp):
    return pd.DataFrame({'exp': np.int32(int(exp)), 'strike': np.round(q.strike.values * 1000).astype('int32'),
                         'right': np.where(q.right.astype(str).str.upper().str.startswith('C'), 1, -1).astype('int8'),
                         'ms': ms_of(q.timestamp), 'bid': np.round(q.bid.values * 100).astype('int32'),
                         'ask': np.round(q.ask.values * 100).astype('int32'),
                         'bs': q.bid_size.astype('int32').values, 'as': q.ask_size.astype('int32').values})


def forward(chain, t_ms):
    """Parity forward from the chain rows stamped <= t_ms (the latest row per contract): K + C - P at the strike with
    the smallest |C - P|. Returns (F, atm_strike_milli, rows_used). Raises if any later row sneaks in."""
    rows = chain[chain.ms <= t_ms]
    assert rows.ms.max() <= t_ms, 'later quote read'
    last = rows.sort_values('ms').groupby(['strike', 'right']).tail(1)
    last = last[(last.bid > 0) & (last.ask > 0)]
    mid = last.assign(mid=(last.bid + last.ask) / 200).pivot_table(index='strike', columns='right', values='mid')
    if mid.empty or 1 not in mid or -1 not in mid:
        return None
    mid = mid.dropna()
    if mid.empty:
        return None
    d = (mid[1] - mid[-1])
    k = int(d.abs().idxmin())
    F = k / 1000 + float(d.loc[k])
    atm = int(mid.index[np.argmin(np.abs(mid.index.values / 1000 - F))])
    return F, atm, len(last)


def dump(obj, path):
    tmp = path + '.tmp'
    json.dump(obj, open(tmp, 'w'), default=lambda o: int(o) if isinstance(o, (np.integer,)) else float(o))
    os.replace(tmp, path)


def drift_targets(ch, strikes, atm, Fd, D, exp, t_entry):
    """Strikes whose Black-Scholes |delta| on the drift forward Fd is nearest 0.30 (band 0.25-0.40), +-1 strike, both
    rights. Vol = ATM straddle mid at t_entry / (0.8 * F * sqrt(tau)) (rows stamped <= t_entry only)."""
    import datetime as dt
    from scipy.stats import norm
    rows = ch[ch.ms <= t_entry]
    last = rows.sort_values('ms').groupby(['strike', 'right']).tail(1)
    c = last[(last.strike == atm) & (last.right == 1)]; p = last[(last.strike == atm) & (last.right == -1)]
    if c.empty or p.empty:
        return set()
    strad = (c.bid.iloc[0] + c.ask.iloc[0] + p.bid.iloc[0] + p.ask.iloc[0]) / 200
    d0 = dt.date(int(D[:4]), int(D[4:6]), int(D[6:])); d1 = dt.date(int(exp[:4]), int(exp[4:6]), int(exp[6:]))
    tau = max((d1 - d0).days * 86400 + (16 * 3600 - 8.6 * 3600), 1800) / (365 * 86400)
    vol = max(strad / (0.8 * Fd * math.sqrt(tau)), 0.03)
    out = set()
    ks = np.array(strikes) / 1000
    d1v = (np.log(Fd / ks) + 0.5 * vol * vol * tau) / (vol * math.sqrt(tau))
    for right in (1, -1):
        dl = norm.cdf(d1v) if right == 1 else 1 - norm.cdf(d1v)
        ok = np.where((dl >= 0.22) & (dl <= 0.43))[0]
        i = int(ok[np.argmin(np.abs(dl[ok] - 0.30))]) if len(ok) else int(np.argmin(np.abs(dl - 0.30)))
        for j in (i - 1, i, i + 1):
            if 0 <= j < len(strikes):
                out.add((int(strikes[j]), right))
    return out


def topup(min_day='20220101'):
    """Add the delta-chosen drift legs to days fetched with the old +-band rule (missing legs only)."""
    for D in sorted(os.listdir(OUT)):
        mp = os.path.join(OUT, D, 'meta.json')
        if D < min_day or not os.path.isfile(mp):
            continue
        m = json.load(open(mp))
        if m.get('status') != 'ok' or m.get('F_drift') is None or m.get('topup'):
            continue
        T = clock(m['release_et']); exp = m['exp']
        ch = pd.read_parquet(os.path.join(OUT, D, 'chain1m.parquet'))
        strikes = sorted(ch.strike.unique())
        want = drift_targets(ch, strikes, int(m['atm_entry']), m['F_drift'], D, exp, T - 5 * 60000)
        have = {tuple(x) for x in m['legs']}
        need = sorted(want - have)
        flat = min(T + 120 * 60000, clock('15:55'))
        legs = []
        for k, r in need:
            q = csv('/option/history/quote', {'symbol': 'SPXW', 'expiration': exp, 'strike': f'{k / 1000:g}',
                                              'right': 'call' if r == 1 else 'put', 'date': D, 'interval': '1s',
                                              'start_time': fmt(T - 10 * 60000), 'end_time': fmt(flat + 60000)})
            if q is not None:
                legs.append(norm_quotes(q, exp))
        if legs:
            old = pd.read_parquet(os.path.join(OUT, D, 'legs1s.parquet'))
            write(pd.concat([old] + legs, ignore_index=True).sort_values(['strike', 'right', 'ms'], kind='stable'),
                  os.path.join(OUT, D, 'legs1s.parquet'))
        m['legs'] = sorted([list(x) for x in have | set(need)]); m['topup'] = True; m['n_leg_files'] = m.get('n_leg_files', 0) + len(legs)
        dump(m, mp)
        print(D, 'topup', len(need), 'legs', flush=True)


def write(df, path):
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), path, compression='zstd', compression_level=9)


def fetch_day(D, event, T_str, kind, band=3):
    out = os.path.join(OUT, D)
    if os.path.exists(os.path.join(out, 'meta.json')):
        return 'skip'
    os.makedirs(out, exist_ok=True)
    T = clock(T_str)
    exps = [e for e in expirations() if e >= D]
    if not exps:
        return 'noexp'
    exp = exps[0]
    t_entry, t_drift = T - 5 * 60000, T + 6 * 60000
    flat = min(T + 120 * 60000, clock('15:55'))
    t0 = time.time()
    ch = csv('/option/history/quote', {'symbol': 'SPXW', 'expiration': exp, 'strike': '*', 'right': 'both', 'date': D,
                                       'interval': '1m', 'start_time': fmt(T - 10 * 60000), 'end_time': fmt(T + 7 * 60000)})
    if ch is None:
        dump({'date': D, 'status': 'nochain', 'exp': exp}, os.path.join(out, 'meta.json'))
        return 'nochain'
    ch = norm_quotes(ch, exp)
    write(ch, os.path.join(out, 'chain1m.parquet'))
    fe = forward(ch, t_entry)
    fd = forward(ch, t_drift)
    if fe is None:
        dump({'date': D, 'status': 'noforward', 'exp': exp}, os.path.join(out, 'meta.json'))
        return 'noforward'
    F0, atm, nq = fe
    strikes = sorted(ch.strike.unique())
    want = {(atm, 1), (atm, -1)}
    if fd is not None:
        want |= drift_targets(ch, strikes, atm, fd[0], D, exp, t_entry)
    legs = []
    for k, r in sorted(want):
        q = csv('/option/history/quote', {'symbol': 'SPXW', 'expiration': exp, 'strike': f'{k / 1000:g}',
                                          'right': 'call' if r == 1 else 'put', 'date': D, 'interval': '1s',
                                          'start_time': fmt(T - 10 * 60000), 'end_time': fmt(flat + 60000)})
        if q is not None:
            legs.append(norm_quotes(q, exp))
    if legs:
        write(pd.concat(legs, ignore_index=True).sort_values(['strike', 'right', 'ms'], kind='stable'),
              os.path.join(out, 'legs1s.parquet'))
    meta = {'date': D, 'event': event, 'release_et': T_str, 'kind': kind, 'exp': exp, 'dte': 0 if exp == D else None,
            'status': 'ok', 'F_entry': F0, 'atm_entry': int(atm), 'n_chain_contracts_at_entry': nq,
            'F_drift': fd[0] if fd else None, 'atm_drift': int(fd[1]) if fd else None,
            'legs': sorted([[int(k), int(r)] for k, r in want]), 'n_leg_files': len(legs), 'secs': round(time.time() - t0, 1)}
    dump(meta, os.path.join(out, 'meta.json'))
    return f"ok F={F0:.1f} atm={atm // 1000} legs={len(legs)} {meta['secs']}s"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan')
    ap.add_argument('--topup', action='store_true')
    a = ap.parse_args()
    if a.topup:
        topup()
        return
    plan = pd.read_csv(a.plan, dtype=str)
    os.makedirs(OUT, exist_ok=True)
    for r in plan.itertuples():
        try:
            msg = fetch_day(r.date, r.event, r.release_et, r.kind)
        except Exception as e:  # noqa
            msg = f'ERR {e!r}'
        print(r.date, r.event, r.kind, msg, flush=True)


if __name__ == '__main__':
    main()
