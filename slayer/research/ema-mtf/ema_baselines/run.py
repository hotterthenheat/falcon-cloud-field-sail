"""The six pre-registered baselines (STRATEGY_SPEC section 14) on the DEV panel, executable simulator.

    python3 -m ema_baselines.run --block A [--roots SPY,QQQ,IWM,SPXW]   -> results/baselines_<block>.parquet
    python3 -m ema_baselines.report                                      -> reports/BASELINES.md

BL1 buy-and-hold grid, BL2 random entries, BL3 underlying-only EMA cross, BL4 option-only EMA cross (own 5m MID chart),
BL5 combined (BL4 + underlying 5m EMA state), BL6 plain directional (side of the last-30-minute underlying return at
BL3's times). Contract: |delta| nearest 0.40 in [0.30, 0.50] of the bucket's representative expiration(s), spread <=
8% of mid, ask size >= 1. Exit XT30 (hold 30 minutes, primary) and X3S (5m MID close < EMA9 or -30% of the entry
fill on the mid, secondary); flat at 15:55. One position at a time per (baseline, exit, root, bucket).
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA, split_of  # noqa: E402
from edata.store import Panel, und_bars  # noqa: E402
from engine.bars import asof_index, asof_row, mid_bars  # noqa: E402
from engine.bs import greeks, implied_vol, years_to_pm_expiry  # noqa: E402
from engine.ema import ema_table, resample  # noqa: E402
from engine.execution import ExecConfig, Simulator, Trade  # noqa: E402
from engine.underlying import rth_minutes  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'results')
UND_SYM = {'SPY': 'SPY', 'QQQ': 'QQQ', 'IWM': 'IWM', 'SPXW': 'SPX'}
BUCKETS = ('0', '1-7', '8-30', '31-90', '91-200')
M_FIRST, M_LAST = 14, 329          # decision closes 09:45 .. 15:00
TARGET, BAND, MAX_SPREAD = 0.40, (0.30, 0.50), 0.08
HOLD = 30


def seed_of(*parts) -> int:
    return int(hashlib.sha256('|'.join(map(str, parts)).encode()).hexdigest()[:12], 16)


class XTime:
    name = 'XT30'

    def __init__(self, minutes=HOLD):
        self.minutes = minutes

    def start(self, info):
        pass

    def check(self, v):
        return 'time' if v['bars'] >= self.minutes else None


class X3S:
    """5m MID close < EMA9 on the contract's own chart (a bar completed after entry), or MID <= 70% of the entry fill."""
    name = 'X3S'

    def __init__(self, bars, idx, contract):
        self.bars, self.idx, self.c = bars, idx, contract

    def start(self, info):
        self.entry = info
        self.k0 = int(info['session']) * 100_000_000 + (570 + info['m'] + 1) * 60_000

    def check(self, v):
        if v['mid'] == v['mid'] and v['mid'] <= 0.7 * self.entry['entry_px']:
            return 'stop30'
        i = asof_row(self.bars, self.idx, self.c, v['session'], v['now_ms'])
        if i is None:
            return None
        r = self.bars.iloc[i]
        if int(r.session) * 100_000_000 + int(r.known_ms) <= self.k0:
            return None
        if r.seen9 >= 9 and r.c < r.ema9:
            return 'below9'
        return None


class Day:
    """Everything a baseline needs on one (root, session): candidate contracts per bucket at each decision close."""

    def __init__(self, panel: Panel, plan: dict, D: str, und1: pd.DataFrame):
        self.D, self.p = D, panel
        sel = plan['select'][D]
        self.exps = {b: [int(e) for e in sel.get(b, [])] for b in BUCKETS}
        u = und1[und1.session == int(D)].set_index('m').c
        self.S = u
        q = panel.q0(D)
        allx = sorted({e for v in self.exps.values() for e in v})
        q = q[q.exp.isin(allx) & (q.m >= M_FIRST) & (q.m <= M_LAST) & (q.bid > 0) & (q.ask >= q.bid) & (q['as'] > 0)]
        q = q.assign(mid=(q.bid + q.ask) / 200.0)
        q = q[(q.ask - q.bid) / 100.0 <= MAX_SPREAD * q.mid]
        S = u.reindex(q.m.to_numpy()).to_numpy()
        ms = (570 + q.m.to_numpy() + 1) * 60_000
        T = years_to_pm_expiry(int(D), ms, q.exp.to_numpy())
        K = q.strike.to_numpy() / 1000
        call = q.right.to_numpy() == 1
        iv = implied_vol(q.mid.to_numpy(), S, K, T, call)
        dl = greeks(S, K, T, np.where(np.isfinite(iv), iv, 0.2), call)['delta']
        q = q.assign(iv=iv, delta=np.where(np.isfinite(iv), dl, np.nan))
        q = q[np.abs(q.delta) >= BAND[0]]
        self.q = q[np.abs(q.delta) <= BAND[1]]
        self._by_m = {m: x for m, x in self.q.groupby('m')}

    def pick(self, m: int, bucket: str, right: int, among=None):
        x = self._by_m.get(m)
        if x is None:
            return None
        x = x[x.exp.isin(self.exps[bucket]) & (x.right == right)]
        if among is not None:
            keys = set(among)
            x = x[[(int(e), int(k), int(r)) in keys for e, k, r in zip(x.exp, x.strike, x.right)]]
        if not len(x):
            return None
        d = (x.delta.abs() - TARGET).abs()
        r = x.iloc[np.lexsort((x.ask.to_numpy(), d.to_numpy()))[0]]
        return int(r.exp), int(r.strike), int(r.right), float(r.delta)


def und_tables(sym, days):
    m1 = rth_minutes(sym, days)
    t5 = ema_table(resample(m1, 5), (9, 21))
    return m1, t5


def run_root(root: str, block: str, out_rows: list):
    p = Panel(root)
    plan = p.plan(block)
    have = set(p.days())
    ev = [D for D in plan['eval'] if D in have and split_of(D) == 'DEV']
    if not ev:
        return
    hist_fine = [D for D in plan['hist'] if D in have]
    days = hist_fine + ev
    sym = UND_SYM[root]
    t0 = time.time()
    m1, t5 = und_tables(sym, [d for d in days if len(und_bars(sym, d))])
    t5 = t5.assign(st=np.sign(t5.ema9 - t5.ema21), cross=np.sign(t5.ema9 - t5.ema21).diff().fillna(0))
    t5k = t5.session.to_numpy(np.int64) * 100_000_000 + t5.known_ms.to_numpy(np.int64)
    mb = mid_bars(p, [d for d in days if d in have], 5, lengths=(9, 21))
    mb = mb.assign(prev_d=mb.groupby(['exp', 'strike', 'right']).ema9.shift(1) - mb.groupby(['exp', 'strike', 'right']).ema21.shift(1))
    mb['xup'] = (mb.prev_d <= 0) & (mb.ema9 > mb.ema21) & (mb.seen21 >= 21)
    midx = asof_index(mb)
    xups = {(s, kms): g for (s, kms), g in mb[mb.xup].groupby(['session', 'known_ms'])}
    print(root, block, f'loaded {len(days)} sessions, {len(mb)} 5m MID bars in {time.time()-t0:.0f}s', flush=True)
    sims = {x: Simulator(p, ExecConfig(), sessions=sorted(have)) for x in ('XT30', 'X3S')}
    uclose = lambda d: float(m1[m1.session == int(d)].c.iloc[-1]) if (m1.session == int(d)).any() else np.nan

    def und_state(D, m):
        k = int(D) * 100_000_000 + (570 + m + 1) * 60_000
        i = int(np.searchsorted(t5k, k, side='right')) - 1
        return (t5.st.iloc[i], t5.cross.iloc[i], t5.known_ms.iloc[i] == (570 + m + 1) * 60_000 and t5.session.iloc[i] == int(D)) if i >= 0 else (0, 0, False)

    for D in ev:
        day = Day(p, plan, D, m1)
        u = day.S
        five = [m for m in range(M_FIRST, M_LAST + 1) if (m + 1) % 5 == 0]
        for b in BUCKETS:
            if not day.exps[b]:
                continue
            dec = {k: [] for k in ('BL1', 'BL2', 'BL3', 'BL4', 'BL5', 'BL6')}
            for m in range(29, M_LAST + 1, 30):
                dec['BL1'] += [(m, 1), (m, -1)]
            rng = np.random.default_rng(seed_of(D, root, b, 'BL2'))
            for m in sorted(rng.choice(np.arange(M_FIRST, M_LAST + 1), 6, replace=False)):
                dec['BL2'].append((int(m), 1 if rng.random() < 0.5 else -1))
            for m in five:
                st, cr, fresh = und_state(D, m)
                if fresh and cr != 0:
                    side = 1 if cr > 0 else -1
                    dec['BL3'].append((m, side))
                    if m - 30 >= 0 and m in u.index and (m - 30) in u.index:
                        r30 = u[m] - u[m - 30]
                        if r30 != 0:
                            dec['BL6'].append((m, 1 if r30 > 0 else -1))
                kms = (570 + m + 1) * 60_000
                g = xups.get((int(D), kms))
                if g is not None:
                    g = g[g.exp.isin(day.exps[b])]
                    for side in (1, -1):
                        among = [(int(e), int(k), int(r)) for e, k, r in zip(g.exp, g.strike, g.right) if r == side]
                        if among:
                            dec['BL4'].append((m, side, tuple(among)))
                            if st == side:
                                dec['BL5'].append((m, side, tuple(among)))
            for bl, items in dec.items():
                for xname, sim in sims.items():
                    busy_until = -1
                    for it in sorted(items):
                        m, side = it[0], it[1]
                        if bl != 'BL1' and m <= busy_until:
                            continue
                        c = day.pick(m, b, side, among=it[2] if len(it) > 2 else None)
                        if c is None:
                            continue
                        e, k, r, dl = c
                        ex = XTime() if xname == 'XT30' else X3S(mb, midx, (e, k, r))
                        rec = sim.run(Trade(root, e, k, r, int(D), m, tag=bl, meta={'delta': dl}), ex, und_close=uclose)
                        rec.update({'baseline': bl, 'exit': xname, 'bucket': b, 'block': block, 'dte': (pd.Timestamp(str(e)) - pd.Timestamp(D)).days})
                        out_rows.append(rec)
                        if rec.get('status') == 'filled' and bl != 'BL1':
                            busy_until = rec['exit_decision_m'] if rec['exit_decision_session'] == D else 10_000
        print(root, D, f'{sum(1 for r in out_rows if r["session"] == D and r["root"] == root)} records', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--block', required=True)
    ap.add_argument('--roots', default='SPY,QQQ,IWM,SPXW')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for root in a.roots.split(','):
        rows = []
        run_root(root, a.block, rows)
        if rows:
            df = pd.DataFrame(rows)
            df.to_parquet(os.path.join(OUT, f'baselines_{a.block}_{root}.parquet'))
            print(root, a.block, len(df), 'records written', flush=True)


if __name__ == '__main__':
    main()
