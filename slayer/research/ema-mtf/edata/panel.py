"""The EMA-MTF DEV panel: every contract's own 1-minute chart over its recent life, plus fill quotes, underlying bars,
open interest and the positioning book.

    python3 -m edata.panel --block A          (resumable: one atomic directory per root-session)
    python3 -m edata.panel --block A --plan   (only the expiration plan)

Blocks (DEV only; LOCKED is never fetched; see specs/STRATEGY_SPEC.md section 9):
  A  eval 2024-03-01..2024-05-31, warm-up history from 62 sessions before
  B  eval 2022-03-01..2022-05-31, warm-up history from 62 sessions before

Per root R in SPY, QQQ, IWM, SPXW and session D:
  oi.parquet   option/history/open_interest expiration=* (the morning report = prior close), every expiration
  q0.parquet   1-minute NBBO snapshots stamped at each bar END (09:31..16:00), expiration=*, strike_range=N(R):
               the NBBO-mid chart and the decision quote. m = index of the bar that the snapshot closes.
               Tiered: 'use'/'full' expirations at 1 minute; 'coarse' expirations at 15 minutes (m = 14, 29, ...).
  q2.parquet   the same snapshots 2 s after each bar end (start_time 09:30:02): the fill quote of an order sent at a
               bar close with the default 2 s latency. Eval sessions, 'use' expirations only (m = -1 is 09:30:02).
  tb.parquet   1-minute trade-print OHLC bars built from every OPRA print (option/history/trade expiration=*), SIP rules
               (edata/sip.py): cancels dropped, O/C from last-eligible prints, H/L from high/low-eligible prints,
               volume from volume-eligible prints. Only non-empty minutes are stored.
  gx.parquet   positioning book every 30 minutes (option/history/greeks/first_order expiration=*, all expirations,
               x prior-close OI), eval sessions only: engine/positioning.py aggregates + per-strike profile.
Underlying und/{SYM}/{D}.parquet: 1-minute OHLCV 04:00-16:00 (stocks; SPX index 09:30-16:00, no volume).

Expiration tiers per (D, E), from the block plan: an eval session USES the same-day expiration, every listed
expiration with 1-7 DTE, and the largest-open-interest expiration of each of 8-30, 31-90, 91-200 DTE (prior close).
FULL = within the 6 sessions before E's first use, or between its first and last use; COARSE = any other session
of E's life inside the block's range (warm-up for 15m/30m/1h EMAs). Prices int32 cents; ms of day ET.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import shutil
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import (EMA_DATA, NoData, check_disk, cents, csv, day_of, dte, guard, ms_of_day, right_code,  # noqa: E402
                          sessions_all, sessions_back, write_json, write_parquet)
from edata import sip  # noqa: E402

PANEL = os.path.join(EMA_DATA, 'panel')
UND_DIR = os.path.join(EMA_DATA, 'und')
ROOTS = ('SPY', 'QQQ', 'IWM', 'SPXW')
STRIKE_RANGE = {'SPY': 15, 'QQQ': 12, 'IWM': 8, 'SPXW': 30}
UND = {'SPY': ('stock', 'SPY'), 'QQQ': ('stock', 'QQQ'), 'IWM': ('stock', 'IWM'), 'SPXW': ('index', 'SPX')}
BLOCKS = {'A': ('20240301', '20240531'), 'B': ('20220301', '20220531')}
HIST = 62
FULL_BEFORE = 6
M0 = 9 * 60 + 30
REP_BUCKETS = (('8-30', 8, 30), ('31-90', 31, 90), ('91-200', 91, 200))


def block_days(block):
    a, b = BLOCKS[block]
    al = sessions_all()
    ev = [d for d in al if a <= d <= b]
    for d in ev:
        guard(d)
    hist = sessions_back(ev[0], HIST)
    return hist, ev


def oi_path(root, D):
    return os.path.join(PANEL, root, 'oi', f'{D}.parquet')


def get_oi(root, D) -> pd.DataFrame:
    p = oi_path(root, D)
    if os.path.exists(p):
        return pd.read_parquet(p)
    guard(D)
    try:
        o = csv('/option/history/open_interest', {'symbol': root, 'expiration': '*', 'date': D}, timeout=600)
        df = pd.DataFrame({'exp': o.expiration.astype(str).str.replace('-', '').astype('int32'),
                           'strike': np.round(o.strike.values * 1000).astype('int32'), 'right': right_code(o.right),
                           'oi': o.open_interest.astype('int32')})
    except NoData:
        df = pd.DataFrame({'exp': pd.Series(dtype='int32'), 'strike': pd.Series(dtype='int32'),
                           'right': pd.Series(dtype='int8'), 'oi': pd.Series(dtype='int32')})
    df = df.sort_values(['exp', 'strike', 'right']).reset_index(drop=True)
    write_parquet(df, p)
    return df


def select_exps(root, D, oi: pd.DataFrame) -> dict:
    """bucket -> [expirations used on D] (listed = present with OI > 0 on D's morning report, or expiring on D)."""
    tot = oi.groupby('exp').oi.sum()
    listed = sorted(int(e) for e, v in tot.items() if v > 0 and str(e) >= D)
    sel = {}
    if int(D) in tot.index:
        sel['0'] = [int(D)]
    sel['1-7'] = [e for e in listed if 1 <= dte(D, str(e)) <= 7]
    for name, lo, hi in REP_BUCKETS:
        cand = [e for e in listed if lo <= dte(D, str(e)) <= hi]
        if cand:
            sel[name] = [max(cand, key=lambda e: (float(tot.get(e, 0)), -e))]
    return sel


def make_plan(root, block):
    p = os.path.join(PANEL, root, f'plan_{block}.json')
    if os.path.exists(p):
        return json.load(open(p))
    hist, ev = block_days(block)
    sel = {}
    for D in ev:
        sel[D] = select_exps(root, D, get_oi(root, D))
    use = {}
    for D, s in sel.items():
        for b, es in s.items():
            for e in es:
                use.setdefault(str(e), []).append(D)
    days = hist + ev
    tiers = {}
    for D in days:
        t = {}
        i = days.index(D)
        for e, ds in use.items():
            if e < D:
                continue
            f, l = ds[0], ds[-1]
            if D in ds:
                t[e] = 'use'
            elif f <= D <= l or (D < f and days.index(f) - i <= FULL_BEFORE):
                t[e] = 'full'
            else:
                t[e] = 'coarse'
        tiers[D] = t
    plan = {'root': root, 'block': block, 'hist': hist, 'eval': ev, 'select': sel, 'use': use, 'tiers': tiers,
            'strike_range': STRIKE_RANGE[root]}
    write_json(plan, p)
    return plan


def _quotes(root, D, max_dte, interval, start_time=None):
    params = {'symbol': root, 'expiration': '*', 'strike': '*', 'right': 'both', 'date': D, 'interval': interval,
              'max_dte': max_dte, 'strike_range': STRIKE_RANGE[root]}
    if start_time:
        params['start_time'] = start_time
    q = csv('/option/history/quote', params, timeout=900)
    ms = ms_of_day(q.timestamp)
    return pd.DataFrame({'exp': q.expiration.astype(str).str.replace('-', '').astype('int32'),
                         'strike': np.round(q.strike.values * 1000).astype('int32'), 'right': right_code(q.right),
                         'ms': ms, 'bid': cents(q.bid), 'ask': cents(q.ask), 'bs': q.bid_size.astype('int32'),
                         'as': q.ask_size.astype('int32')})


def _bar_of_snapshot(ms: np.ndarray, offset_ms: int) -> np.ndarray:
    """Snapshot stamped at (bar end + offset) -> bar index m; 09:30:00(+offset) -> -1."""
    return ((ms - offset_ms) // 60000 - M0 - 1).astype('int16')


def fetch_root_day(root, D, plan, is_eval):
    out_dir = os.path.join(PANEL, root, D)
    if os.path.exists(os.path.join(out_dir, '_manifest.json')):
        return None
    guard(D)
    check_disk()
    t0 = time.time()
    tiers = plan['tiers'][D]
    if not tiers:
        return None
    tmp = out_dir + '.tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    man = {'root': root, 'session': D, 'eval': is_eval, 'tiers': tiers, 'files': {}, 'rows': {}, 'timing': {}}
    keep = {int(e) for e in tiers}
    max_dte = max(dte(D, e) for e in tiers) + 1
    fine = {int(e) for e, t in tiers.items() if t in ('use', 'full')}
    use = {int(e) for e, t in tiers.items() if t == 'use'}

    def q0():
        iv = '1m' if fine else '15m'
        q = _quotes(root, D, max_dte, iv)
        q = q[q.exp.isin(keep)]
        q['m'] = _bar_of_snapshot(q.ms.to_numpy(), 0)
        q = q[q.m >= 0]
        if fine:
            coarse = ~q.exp.isin(fine)
            q = q[~coarse | ((q.m + 1) % 15 == 0)]
        return q.drop(columns='ms')

    def q2():
        if not use:
            return None
        q = _quotes(root, D, max(dte(D, str(e)) for e in use) + 1, '1m', start_time='09:30:02')
        q = q[q.exp.isin(use)]
        q['m'] = _bar_of_snapshot(q.ms.to_numpy(), 2000)
        return q.drop(columns='ms')

    def trades():
        try:
            t = csv('/option/history/trade', {'symbol': root, 'expiration': '*', 'strike': '*', 'right': 'both', 'date': D,
                                               'max_dte': max_dte, 'strike_range': STRIKE_RANGE[root]}, timeout=900)
        except NoData:
            return None
        t = pd.DataFrame({'exp': t.expiration.astype(str).str.replace('-', '').astype('int32'),
                          'strike': np.round(t.strike.values * 1000).astype('int32'), 'right': right_code(t.right),
                          'ms': ms_of_day(t.timestamp), 'px': cents(t.price), 'size': t['size'].astype('int32'),
                          'cond': t.condition.astype('int16')})
        t = t[t.exp.isin(keep)]
        return sip.minute_bars(t)

    jobs = {'q0': q0, 'q2': q2 if is_eval else (lambda: None), 'tb': trades}
    with cf.ThreadPoolExecutor(2) as ex:
        futs = {k: ex.submit(f) for k, f in jobs.items()}
        res = {}
        for k, fu in futs.items():
            try:
                res[k] = fu.result()
            except NoData:
                res[k] = None
    for k, df in res.items():
        if df is None or not len(df):
            continue
        df = df.sort_values(['exp', 'strike', 'right', 'm']).reset_index(drop=True)
        man['files'][k] = write_parquet(df, os.path.join(tmp, f'{k}.parquet'))
        man['rows'][k] = len(df)
    if is_eval:
        try:
            from engine.positioning import book_from_terminal
            gx, prof = book_from_terminal(root, D, get_oi(root, D))
            if gx is not None:
                man['files']['gx'] = write_parquet(gx, os.path.join(tmp, 'gx.parquet'))
                man['files']['gxp'] = write_parquet(prof, os.path.join(tmp, 'gxp.parquet'))
        except NoData:
            pass
    man['seconds'] = round(time.time() - t0, 1)
    man['bytes'] = sum(man['files'].values())
    write_json(man, os.path.join(tmp, '_manifest.json'))
    shutil.rmtree(out_dir, ignore_errors=True)
    os.replace(tmp, out_dir)
    return man


def fetch_und(sym, kind, D):
    p = os.path.join(UND_DIR, sym, f'{D}.parquet')
    if os.path.exists(p):
        return
    guard(D)
    if kind == 'stock':
        o = csv('/stock/history/ohlc', {'symbol': sym, 'date': D, 'interval': '1m', 'start_time': '04:00:00',
                                         'end_time': '16:00:00'}, timeout=300)
    else:
        o = csv('/index/history/ohlc', {'symbol': sym, 'start_date': D, 'end_date': D, 'interval': '1m'}, timeout=300)
    mod = (ms_of_day(o.timestamp) // 60000).astype('int16')
    df = pd.DataFrame({'mod': mod, 'o': np.round(o.open.values * 10000).astype('int64'),
                       'h': np.round(o.high.values * 10000).astype('int64'), 'l': np.round(o.low.values * 10000).astype('int64'),
                       'c': np.round(o.close.values * 10000).astype('int64'),
                       'v': o.volume.astype('int64') if 'volume' in o else 0, 'n': o['count'].astype('int64') if 'count' in o else 0})
    df = df[df['mod'] < 16 * 60]
    write_parquet(df, p)


def run_block(block, roots=ROOTS):
    for root in roots:
        plan = make_plan(root, block)
        print(root, block, 'plan:', len(plan['use']), 'expirations used,', len(plan['hist']), 'history +', len(plan['eval']),
              'eval sessions', flush=True)
    for root in roots:
        plan = make_plan(root, block)
        kind, sym = UND[root]
        for D in plan['hist'] + plan['eval']:
            try:
                fetch_und(sym, kind, D)
                if root == 'SPXW':
                    fetch_und('SPY', 'stock', D)
                man = fetch_root_day(root, D, plan, D in plan['eval'])
                if man:
                    print(root, D, 'eval' if man['eval'] else 'hist', f"{man['bytes']/1e6:.2f} MB", man['rows'], f"{man['seconds']}s",
                          flush=True)
            except SystemExit:
                raise
            except Exception as ex:  # noqa: BLE001
                print(root, D, 'FAILED', repr(ex)[:300], flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--block', required=True)
    ap.add_argument('--roots', default=','.join(ROOTS))
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--one', help='ROOT:YYYYMMDD (test one root-session)')
    a = ap.parse_args()
    roots = a.roots.split(',')
    if a.one:
        r, D = a.one.split(':')
        plan = make_plan(r, a.block)
        print(fetch_root_day(r, D, plan, D in plan['eval']))
        return
    if a.plan:
        for r in roots:
            p = make_plan(r, a.block)
            print(r, {D: p['select'][D] for D in p['eval'][:3]}, len(p['use']))
        return
    run_block(a.block, roots)


if __name__ == '__main__':
    main()
