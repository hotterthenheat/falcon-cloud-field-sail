"""Build a foundation MemSession for one fetched EDGE-D day (edge-d/fetch_events.py output).

Quotes: the 1-second NBBO of the fetched legs (cents). Underlying 'SPX': the parity forward of the ATM pair at 1 s,
F = K + C_mid - P_mid (SPX prints nothing pre-open). Greeks (1-minute rows, stamped at the minute, from rows stamped
<= that minute only): Black-Scholes delta/IV on F for every fetched leg, IV inverted from the leg's own mid.
Decision-time guard: build_snapshot(day, t) raises if any row later than t would be used.
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
import pandas as pd
from scipy.optimize import brentq
from scipy.stats import norm

FOUND = os.environ.get('V2_FOUNDATION',
                       '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2')
sys.path.insert(0, FOUND)
from data.store import Contract  # noqa: E402
from sim.memsession import MemSession  # noqa: E402
from sim.engine import clock  # noqa: E402

DATA = os.environ.get('EDGE_D_DATA', '/home/user/falcon-cloud-field-sail/v2data/edge-d')


class LaterQuoteRead(Exception):
    pass


def meta(day):
    p = os.path.join(DATA, day, 'meta.json')
    return json.load(open(p)) if os.path.exists(p) else None


def days(kind=None, status='ok'):
    out = []
    for d in sorted(os.listdir(DATA)):
        m = meta(d)
        if m and m.get('status') == status and (kind is None or m.get('kind') == kind):
            out.append(d)
    return out


def _tau(ms, day, exp):
    """Years to the expiry's 16:00 ET (calendar days between + fraction of today, 365-day year)."""
    d0 = pd.Timestamp(day); d1 = pd.Timestamp(str(exp))
    secs = (d1 - d0).days * 86400 + (clock('16:00') - ms) / 1000
    return max(secs, 60) / (365 * 86400)


def bs_price(F, K, tau, vol, right):
    if vol <= 0 or tau <= 0:
        return max(0.0, right * (F - K))
    sq = vol * math.sqrt(tau)
    d1 = (math.log(F / K) + 0.5 * sq * sq) / sq
    d2 = d1 - sq
    if right == 1:
        return F * norm.cdf(d1) - K * norm.cdf(d2)
    return K * norm.cdf(-d2) - F * norm.cdf(-d1)


def bs_delta(F, K, tau, vol, right):
    if vol <= 0 or tau <= 0:
        return float(right) if right * (F - K) > 0 else 0.0
    sq = vol * math.sqrt(tau)
    d1 = (math.log(F / K) + 0.5 * sq * sq) / sq
    return norm.cdf(d1) if right == 1 else norm.cdf(d1) - 1.0


def implied_vol(px, F, K, tau, right):
    intr = max(0.0, right * (F - K))
    if px <= intr + 1e-9:
        return float('nan')
    try:
        return brentq(lambda v: bs_price(F, K, tau, v, right) - px, 1e-4, 5.0, xtol=1e-6, maxiter=100)
    except ValueError:
        return float('nan')


def forward_series(legs, atm, step_ms=1000):
    """Parity forward of the ATM pair on a 1-s grid: F(t) = K + C_mid(t) - P_mid(t) from quotes stamped <= t."""
    c = legs[(legs.strike == atm) & (legs.right == 1)].sort_values('ms')
    p = legs[(legs.strike == atm) & (legs.right == -1)].sort_values('ms')
    if c.empty or p.empty:
        return None
    t0 = int(max(c.ms.min(), p.ms.min())) // 1000 * 1000 + 1000
    t1 = int(min(c.ms.max(), p.ms.max()))
    grid = np.arange(t0, t1 + 1, step_ms, dtype=np.int64)

    def mid_asof(q):
        i = np.searchsorted(q.ms.values, grid, side='right') - 1
        ok = i >= 0
        b = q.bid.values[np.maximum(i, 0)] / 100.0; a = q.ask.values[np.maximum(i, 0)] / 100.0
        m = np.where(ok & (b > 0) & (a >= b), (a + b) / 2, np.nan)
        return pd.Series(m).ffill().values
    F = atm / 1000 + mid_asof(c) - mid_asof(p)
    keep = np.isfinite(F)
    return {'ms': grid[keep], 'px': F[keep]}


def build_session(day):
    m = meta(day)
    legs = pd.read_parquet(os.path.join(DATA, day, 'legs1s.parquet'))
    exp = int(m['exp'])
    und = forward_series(legs, int(m['atm_entry']))
    if und is None or len(und['ms']) < 60:
        return None
    quotes = {}
    for (k, r), g in legs.groupby(['strike', 'right']):
        g = g.sort_values('ms')
        quotes[Contract('SPXW', exp, int(k), int(r))] = {
            'ms': g.ms.values.astype(np.int64), 'bid': g.bid.values.astype(np.int64), 'ask': g.ask.values.astype(np.int64),
            'bs': g.bs.values.astype(np.int64), 'as': g['as'].values.astype(np.int64)}
    # greeks per minute from rows stamped <= the minute (as-of): delta/IV on F(minute) with each leg's own mid
    mins = np.arange(int(und['ms'][0]) // 60000 * 60000 + 60000, int(und['ms'][-1]) + 1, 60000, dtype=np.int64)
    Fi = np.searchsorted(und['ms'], mins, side='right') - 1
    rows = []
    for c, q in quotes.items():
        i = np.searchsorted(q['ms'], mins, side='right') - 1
        for j, t in enumerate(mins):
            if i[j] < 0 or Fi[j] < 0:
                continue
            assert q['ms'][i[j]] <= t and und['ms'][Fi[j]] <= t, 'later quote read'
            b, a = q['bid'][i[j]] / 100, q['ask'][i[j]] / 100
            if not (b > 0 and a >= b):
                continue
            F = float(und['px'][Fi[j]]); tau = _tau(int(t), day, exp)
            iv = implied_vol((a + b) / 2, F, c.k, tau, c.right)
            if not np.isfinite(iv):
                continue
            rows.append((exp, c.strike, c.right, int(t), bs_delta(F, c.k, tau, iv, c.right), iv, F))
    gk = pd.DataFrame(rows, columns=['exp', 'strike', 'right', 'ms', 'delta', 'iv', 'und'])
    s = MemSession(day, quotes, greeks={'SPXW': gk}, underlying={'SPX': und}, expirations={'SPXW': [exp]})
    s.edge_meta = m
    return s


def straddle_implied(day, t_ms):
    """ATM straddle mid and parity forward from the 1-minute chain rows stamped <= t_ms (raises if later rows exist)."""
    m = meta(day)
    ch = pd.read_parquet(os.path.join(DATA, day, 'chain1m.parquet'))
    rows = ch[ch.ms <= t_ms]
    if rows.ms.max() > t_ms:
        raise LaterQuoteRead(day)
    last = rows.sort_values('ms').groupby(['strike', 'right']).tail(1)
    atm = int(m['atm_entry'])
    c = last[(last.strike == atm) & (last.right == 1)]; p = last[(last.strike == atm) & (last.right == -1)]
    if c.empty or p.empty:
        return None
    cm = (c.bid.iloc[0] + c.ask.iloc[0]) / 200; pm = (p.bid.iloc[0] + p.ask.iloc[0]) / 200
    return {'straddle_mid': cm + pm, 'F': atm / 1000 + cm - pm, 'atm': atm / 1000,
            'spread_frac': ((c.ask.iloc[0] - c.bid.iloc[0]) + (p.ask.iloc[0] - p.bid.iloc[0])) / 100 / (cm + pm)}


if __name__ == '__main__':
    d = sys.argv[1]
    s = build_session(d)
    print(d, s.edge_meta['event'], len(s.contracts('SPXW')), 'contracts; F grid', len(s.underlying('SPX')['ms']),
          'greeks rows', len(s.greeks('SPXW')))
    g = s.greeks('SPXW'); print(g[g.ms == clock('08:36')].sort_values('strike')[['strike', 'right', 'delta', 'iv', 'und']].to_string())
    print(straddle_implied(d, clock('08:25')))
