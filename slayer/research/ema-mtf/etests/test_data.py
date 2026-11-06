"""SIP trade bars, positioning signs, BS helpers, split guards."""
from __future__ import annotations

import numpy as np
import pandas as pd

from edata import sip
from edata.common import LockedError, fetchable, guard, sessions_back
from engine import bs
from engine.positioning import book


def test_sip_bar_rules():
    t = pd.DataFrame({'exp': 20240419, 'strike': 500_000, 'right': 1,
                      'ms': [34_200_100, 34_210_000, 34_220_000, 34_230_000, 34_240_000, 34_290_000, 34_300_000],
                      'px': [100, 120, 90, 300, 110, 105, 50], 'size': [1, 2, 3, 4, 5, 6, 7],
                      'cond': [18, 18, 18, 40, 2, 18, 18]})
    b = sip.minute_bars(t)
    r0 = b[b.m == 0].iloc[0]
    # cancel (40) dropped; out-of-sequence (2) counts in H/L and volume but not O/C
    assert (r0.o, r0.c, r0.h, r0.l) == (100, 90, 120, 90)
    assert r0.v == 1 + 2 + 3 + 5 and r0.n == 4
    r1 = b[b.m == 1].iloc[0]
    assert (r1.o, r1.c, r1.v) == (105, 50, 13)
    assert len(sip.minute_bars(t[t.cond == 2])) == 1 and sip.minute_bars(t[t.cond == 2]).c.iloc[0] == -1


def test_bs_iv_roundtrip_and_greeks_signs():
    S, K, T = 500.0, np.array([480, 500, 520.0]), 30 / 365
    for call in (True, False):
        p = bs.price(S, K, T, 0.2, call)
        iv = bs.implied_vol(p, S, K, T, call)
        assert np.allclose(iv, 0.2, atol=1e-6)
    g = bs.greeks(S, K, T, 0.2, True)
    assert (g['gamma'] > 0).all() and (np.diff(g['delta']) < 0).all()


def test_dealer_sign_calls_long_puts_short():
    ch = pd.DataFrame({'exp': [20240419] * 2, 'strike': [500_000] * 2, 'right': [1, -1], 'oi': [1000, 0], 'iv': [0.2, 0.2],
                       'am': False})
    a, _ = book(ch, 500.0, 20240401, 36_000_000)
    assert a['inf_net_gex_all'] > 0
    ch2 = ch.assign(oi=[0, 1000])
    b, _ = book(ch2, 500.0, 20240401, 36_000_000)
    assert b['inf_net_gex_all'] < 0 and abs(a['inf_net_gex_all'] + b['inf_net_gex_all']) < 1e-6 * abs(a['inf_net_gex_all'])
    # GEX $ per 1% = gamma x OI x 100 x S^2 x 1%
    T = bs.years_to_pm_expiry(20240401, 36_000_000, 20240419)
    g = bs.greeks(500.0, 500.0, T, 0.2, True)['gamma']
    assert abs(a['inf_net_gex_all'] - g * 1000 * 100 * 500 ** 2 * 0.01) < 1e-6 * a['inf_net_gex_all']
    # a book with call OI above spot and put OI below has a flip between
    ch3 = pd.DataFrame({'exp': 20240419, 'strike': [480_000, 520_000], 'right': [-1, 1], 'oi': [1000, 1000], 'iv': 0.2, 'am': False})
    c, _ = book(ch3, 500.0, 20240401, 36_000_000)
    assert 480 < c['inf_gamma_flip'] < 520


def test_locked_sessions_are_never_fetchable():
    for d in ('20220615', '20220801', '20240815', '20250210', '20260115', '20260702', '20261020'):
        assert not fetchable(d), d
        try:
            guard(d)
            raise AssertionError(d)
        except LockedError:
            pass
    for d in ('20240301', '20221003', '20250415'):
        assert fetchable(d)


def test_history_stops_at_a_locked_gap():
    import edata.common as C
    orig = C.sessions_all
    try:
        days = [d.strftime('%Y%m%d') for d in pd.bdate_range('2022-09-01', '2022-10-20')]
        C.sessions_all.cache_clear() if hasattr(C.sessions_all, 'cache_clear') else None
        C.sessions_all = lambda: days
        h = sessions_back('20221014', 62)
        assert h[0] >= '20221001' and all(d >= '20221001' for d in h)
    finally:
        C.sessions_all = orig
