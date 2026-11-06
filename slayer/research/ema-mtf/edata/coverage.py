"""Warm-up feasibility study: how many bars of its OWN chart a contract actually has when a trader would look at it.

    python3 -m edata.coverage            (from slayer/research/ema-mtf; resumable, one parquet per root-session)

Sample (fixed before any measurement, see reports/DATA_COVERAGE.md): 12 DEV sessions rotating weekdays, roots SPY,
QQQ, IWM, SPXW (PM weekly/daily root) and SPX (AM monthly root); per DTE bucket the expiration with the largest
prior-close open interest; per expiration the strikes nearest |delta| 0.15, 0.30, 0.50 for calls and puts at 10:00
(terminal greeks/first_order). Per contract: its listing (option/list/dates quote and trade), every 1-minute
trade-print OHLC bar over the last 62 fetchable sessions plus the session itself (option/history/ohlc), and the
1-minute NBBO snapshots of the most recent <= 1 month (option/history/quote) to measure two-sided quote coverage.
A LOCKED session ends the history (never fetched). Stored: one row per contract-day with the minute masks of
non-empty trade bars and of valid two-sided quotes (390 bits each), so any timeframe's bar count can be rebuilt.
"""
from __future__ import annotations

import concurrent.futures as cf
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import (BUCKETS, EMA_DATA, NoData, bucket_of, check_disk, csv, day_of, dte, expirations, guard,  # noqa: E402
                         fetchable, ms_of_day, right_code, sessions_all, sessions_back, write_parquet)

OUT = os.path.join(EMA_DATA, 'coverage')
# Sample, as run. The first three sessions were measured in full (|delta| 0.15/0.30/0.50, 1-minute quotes of the last
# month). The shared terminal then slowed to ~5-10 s a request (other workers' load, a terminal restart at 04:21), so
# the remaining sessions were cut BEFORE any of them was measured to: 4 sessions, |delta| 0.30/0.50 (the strategy's
# band), no quote request (two-sided quote share measured 99-100% on the first 402 contracts; listed quote days
# from option/list/dates/quote are taken as quoted all day for those -- stated as an assumption in the report).
DATES_FULL = ['20220316', '20220510', '20221117']
DATES_LITE = ['20230329', '20231019', '20240423', '20241118']
DATES = DATES_FULL + DATES_LITE
ROOTS = ['SPY', 'QQQ', 'IWM', 'SPXW', 'SPX']
TARGETS = (0.15, 0.30, 0.50)
TARGETS_LITE = (0.30, 0.50)
HIST = 62
M0 = 9 * 60 + 30   # minute of day of the first RTH bar


def iso(d):
    return f'{d[:4]}-{d[4:6]}-{d[6:]}'


def pick_expirations(root, D):
    """Per bucket: the listed expiration (DTE <= 400) with the largest open interest on D's morning report."""
    exps = [e for e in expirations(root) if e >= D and dte(D, e) <= 400]
    try:
        oi = csv('/option/history/open_interest', {'symbol': root, 'expiration': '*', 'date': D}, timeout=300)
        oi['e'] = oi.expiration.astype(str).str.replace('-', '')
        tot = oi.groupby('e').open_interest.sum()
    except NoData:
        tot = pd.Series(dtype=float)
    out = {}
    for name, lo, hi in BUCKETS:
        # only expirations listed on D (open interest on its morning report): the calendar list also holds
        # expirations created later, which a trader on D could not see
        cand = [e for e in exps if lo <= dte(D, e) <= hi and float(tot.get(e, 0.0)) > 0]
        if not cand:
            continue
        best = max(cand, key=lambda e: (float(tot.get(e, 0.0)), -dte(D, e)))
        out[name] = (best, float(tot.get(best, 0.0)), len(cand))
    return out


def pick_contracts(root, D, e):
    try:
        g = csv('/option/history/greeks/first_order', {'symbol': root, 'expiration': e, 'strike': '*', 'right': 'both',
                                                        'date': D, 'interval': '1m', 'start_time': '10:00:00',
                                                        'end_time': '10:00:00'}, timeout=300)
    except NoData:
        return []
    g = g[(g.bid > 0) & (g.ask > 0)]
    g = g.assign(r=right_code(g.right), ad=g.delta.abs())
    out = []
    for r in (1, -1):
        x = g[g.r == r]
        for t in TARGETS:
            if not len(x):
                continue
            i = (x.ad - t).abs().idxmin()
            if abs(x.ad[i] - t) <= 0.10:
                out.append((float(x.strike[i]), r, t, float(x.delta[i]), float(x.underlying_price[i])))
    return sorted(set(out))


def runs(days):
    """Split a sorted list of fetchable sessions into <= 1-calendar-month contiguous ranges (terminal cap)."""
    out, cur = [], []
    for d in days:
        if cur and (pd.Timestamp(d) - pd.Timestamp(cur[0])).days > 27:
            out.append(cur)
            cur = []
        cur.append(d)
    if cur:
        out.append(cur)
    return out


def mask_rows(df, col_ok):
    """{day: (count, 49-byte bitmask)} of minutes 0..389 where col_ok."""
    res = {}
    if not len(df):
        return res
    m = (ms_of_day(df.timestamp) // 60000 - M0).astype(int)
    d = day_of(df.timestamp)
    ok = col_ok & (m >= 0) & (m < 390)
    for day in np.unique(d):
        sel = ok & (d == day)
        bits = np.zeros(392, bool)
        bits[m[sel]] = True
        res[int(day)] = (int(bits.sum()), np.packbits(bits).tobytes())
    return res


def one_contract(root, D, e, k, r, hist, lite=False):
    base = {'symbol': root, 'expiration': e, 'strike': f'{k:g}', 'right': 'call' if r == 1 else 'put'}
    meta = {}
    for kind in (('quote',) if lite else ('quote', 'trade')):
        try:
            ds = csv(f'/option/list/dates/{kind}', base, timeout=120)
            v = sorted(ds.iloc[:, 0].astype(str).str.replace('-', ''))
            meta[f'first_{kind}'] = v[0]
            meta[f'n_{kind}_days_listed'] = sum(1 for x in v if x <= D)
        except NoData:
            meta[f'first_{kind}'] = None
            meta[f'n_{kind}_days_listed'] = 0
    days = [d for d in hist if (meta['first_quote'] or '99999999') <= d] + [D]
    trade, vol = {}, {}
    for rng in runs(days):
        try:
            o = csv('/option/history/ohlc', {**base, 'start_date': rng[0], 'end_date': rng[-1], 'interval': '1m'}, timeout=300)
        except NoData:
            continue
        trade.update(mask_rows(o, (o['count'].values > 0)))
        dd = day_of(o.timestamp)
        for day in np.unique(dd):
            vol[int(day)] = int(o.volume.values[dd == day].sum())
    qdays = [d for d in days if (pd.Timestamp(D) - pd.Timestamp(d)).days <= 27]
    quote = {}
    try:
        if lite:
            raise NoData('lite: no quote request')
        q = csv('/option/history/quote', {**base, 'start_date': qdays[0], 'end_date': qdays[-1], 'interval': '1m'}, timeout=300)
        # a snapshot at T closes the bar ending at T: shift by one minute so mask index = bar index
        q = q.assign(timestamp=(pd.to_datetime(q.timestamp) - pd.Timedelta(minutes=1)).dt.strftime('%Y-%m-%dT%H:%M:%S.000'))
        ok = (q.bid.values > 0) & (q.ask.values >= q.bid.values) & (q.ask.values > 0)
        quote = mask_rows(q, ok)
    except NoData:
        pass
    rows = []
    for d in days:
        di = int(d)
        nt, mt = trade.get(di, (0, b''))
        nq, mq = quote.get(di, (-1, b'')) if d in qdays else (-1, b'')
        rows.append({'day': di, 'n_trade_min': nt, 'trade_mask': mt, 'volume': vol.get(di, 0), 'n_quote_min': nq,
                     'quote_mask': mq})
    return meta, rows


def do(root, D):
    path = os.path.join(OUT, f'{root}_{D}.parquet')
    if os.path.exists(path):
        return 'done'
    guard(D)
    check_disk()
    t0 = time.time()
    hist = sessions_back(D, HIST)
    sel = pick_expirations(root, D)
    jobs = []
    for b, (e, oi, ncand) in sel.items():
        for (k, r, t, dl, S) in pick_contracts(root, D, e):
            if D in DATES_LITE and t not in TARGETS_LITE:
                continue
            jobs.append((b, e, oi, ncand, k, r, t, dl, S))
    out = []

    def run(j):
        b, e, oi, ncand, k, r, t, dl, S = j
        meta, rows = one_contract(root, D, e, k, r, hist, lite=D in DATES_LITE)
        return [{'root': root, 'session': D, 'bucket': b, 'exp': e, 'dte': dte(D, e), 'exp_oi': oi, 'n_exp_in_bucket': ncand,
                 'strike': k, 'right': r, 'target_delta': t, 'delta_1000': dl, 'und_1000': S, 'hist_sessions': len(hist),
                 **meta, **row} for row in rows]

    with cf.ThreadPoolExecutor(2) as ex:
        for rs in ex.map(run, jobs):
            out += rs
    df = pd.DataFrame(out)
    if not len(df):
        df = pd.DataFrame({'root': [root], 'session': [D], 'bucket': ['none']})
    n = write_parquet(df, path)
    print(root, D, f'{len(jobs)} contracts, {len(df)} contract-days, {n/1e3:.0f} kB, {time.time()-t0:.0f}s', flush=True)
    return 'ok'


def main():
    sessions_all()
    for D in DATES:
        assert fetchable(D), D
    for D in DATES:
        for root in ROOTS:
            try:
                do(root, D)
            except SystemExit:
                raise
            except Exception as ex:  # noqa: BLE001
                print(root, D, 'FAILED', repr(ex)[:300], flush=True)


if __name__ == '__main__':
    main()
