"""EMA engine: seeding, NaN handling, resampling, bar-close timing, no repaint."""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.ema import asof_htf, ema, ema_fast, ema_table, resample, MTFState


def test_ema_fast_equals_reference_with_gaps():
    rng = np.random.default_rng(0)
    x = rng.normal(10, 1, 3000)
    x[rng.random(3000) < 0.3] = np.nan
    for n in (5, 9, 21, 200):
        a, sa = ema(x, n)
        b, sb = ema_fast(x, n)
        assert np.array_equal(sa, sb)
        ok = ~np.isnan(a)
        assert np.array_equal(ok, ~np.isnan(b)), n
        assert np.allclose(a[ok], b[ok], rtol=0, atol=1e-10), n


def test_sma_seed_and_first_defined_bar():
    x = np.arange(1, 11, dtype=float)
    e, seen = ema(x, 5)
    assert np.isnan(e[:4]).all() and e[4] == 3.0          # mean(1..5)
    a = 2 / 6
    assert abs(e[5] - (a * 6 + (1 - a) * 3.0)) < 1e-12
    assert seen[4] == 5


def test_nan_bars_do_not_advance_the_ema():
    x = np.array([1, 2, 3, np.nan, np.nan, 4, 5], float)
    e, seen = ema(x, 3)
    assert e[3] == e[2] == e[4] == 2.0 and seen[4] == 3
    assert abs(e[5] - (0.5 * 4 + 0.5 * 2.0)) < 1e-12


def test_resample_alignment_and_known_time():
    df = pd.DataFrame({'session': 20240301, 'm': np.arange(390), 'c': np.arange(390, dtype=float)})
    for tf, nb in ((1, 390), (5, 78), (15, 26), (30, 13), (60, 7)):
        r = resample(df, tf)
        assert len(r) == nb, tf
        # the close of tf bar b is the 1-minute close of minute min((b+1)*tf, 390) - 1, known at its end
        assert (r.c.to_numpy() == np.minimum((r.b.to_numpy() + 1) * tf, 390) - 1).all()
        assert (r.known_ms.to_numpy() == (570 + np.minimum((r.b.to_numpy() + 1) * tf, 390)) * 60_000).all()
    h = resample(df, 60)
    assert h.known_ms.iloc[-1] == 16 * 3_600_000 and h.c.iloc[-1] == 389


def test_htf_asof_never_uses_the_forming_bar():
    df = pd.DataFrame({'session': 20240301, 'm': np.arange(390), 'c': np.arange(390, dtype=float)})
    h = ema_table(resample(df, 15), (5,))
    # decision at 09:44:59.999 -> only the bar ending 09:45 is NOT known yet -> nothing
    r = asof_htf([20240301], [9 * 3_600_000 + 44 * 60_000 + 59_999], h, ['c'])
    assert np.isnan(r.c.iloc[0])
    r = asof_htf([20240301], [9 * 3_600_000 + 45 * 60_000], h, ['c'])
    assert r.c.iloc[0] == 14
    st = MTFState(df)
    assert st.at(20240301, 10 * 3_600_000 + 29 * 60_000, 60) is None
    assert st.at(20240301, 10 * 3_600_000 + 30 * 60_000, 60)['c'] == 59


def test_ema_carries_across_sessions():
    a = pd.DataFrame({'session': 20240301, 'm': np.arange(390), 'c': 1.0})
    b = pd.DataFrame({'session': 20240304, 'm': np.arange(390), 'c': 2.0})
    t = ema_table(resample(pd.concat([a, b]), 60), (5,))
    assert t.seen5.iloc[-1] == 14 and 1.0 < t.ema5.iloc[7] < 2.0
