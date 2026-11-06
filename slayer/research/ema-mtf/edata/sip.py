"""Trade-print OHLC bars the way a charting app builds them: SIP sale-condition eligibility (ThetaData's Trade
Conditions table, docs 'Trade Conditions' / 'OHLC & EOD', captured 2026-11-06).

  open/close  first/last print whose condition updates LAST ('x'; the '*' conditional codes are left out)
  high/low    max/min of prints whose condition updates HIGH and LOW
  volume, n   sum of sizes / count of prints whose condition counts VOLUME
  cancels (40-44), size 0 and price <= 0 dropped. Only RTH minutes 09:30-15:59 are kept (m = 0..389).
ThetaData additionally drops a print >5% away from the last verified print when the price is > $5; we do not (the
difference is measured in reports/DATA_COVERAGE.md against option/history/ohlc).
A minute with volume-eligible prints but no last-eligible print gets v/n but NaN o/c; such minutes are treated as
empty for the price chart.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

CANCEL = {40, 41, 42, 43, 44}
VOLUME = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32,
          33, 34, 35, 36, 37, 38, 39, 45, 46, 47, 52, 53, 54, 55, 58, 59, 60, 62, 63, 65, 67, 71, 75, 76, 77, 78, 79, 80,
          81, 82, 83, 86, 87, 88, 89, 95, 96, 97, 98, 99, 100, 101, 102, 105, 106, 109, 115, 124, 125, 126, 127, 128, 129,
          130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148}
HIGHLOW = {0, 2, 5, 6, 7, 8, 10, 13, 14, 15, 17, 18, 21, 22, 23, 24, 25, 29, 30, 31, 32, 34, 35, 36, 37, 38, 39, 45, 46,
           47, 52, 53, 54, 55, 56, 57, 58, 62, 63, 67, 68, 69, 71, 75, 76, 78, 79, 80, 81, 82, 83, 86, 87, 88, 95, 96, 97,
           98, 99, 100, 101, 102, 106, 117, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140,
           141, 142, 143, 144, 145, 146}
LAST = {0, 7, 10, 14, 18, 21, 22, 23, 24, 25, 29, 30, 31, 32, 34, 35, 36, 37, 38, 39, 45, 46, 47, 52, 53, 54, 55, 56, 58,
        63, 67, 71, 75, 76, 78, 79, 80, 81, 82, 83, 86, 87, 88, 95, 97, 100, 107, 108, 117, 125, 126, 127, 128, 129, 130,
        131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146}
MULTI_LEG = set(range(130, 145)) | {35, 36, 37, 38}
M0 = 9 * 60 + 30


def _isin(codes: np.ndarray, s: set) -> np.ndarray:
    lut = np.zeros(256, bool)
    lut[list(s)] = True
    c = np.clip(codes.astype(int), 0, 255)
    return lut[c]


def minute_bars(t: pd.DataFrame, single_leg_only: bool = False) -> pd.DataFrame:
    """t: exp, strike, right, ms, px (cents), size, cond -> exp, strike, right, m, o, h, l, c (cents, NaN-free ints;
    -1 where no eligible print), v, n. Only minutes with at least one volume-eligible print are returned."""
    if t is None or not len(t):
        return pd.DataFrame(columns=['exp', 'strike', 'right', 'm', 'o', 'h', 'l', 'c', 'v', 'n'])
    cond = t.cond.to_numpy()
    ok = ~_isin(cond, CANCEL) & (t['size'].to_numpy() > 0) & (t.px.to_numpy() > 0)
    if single_leg_only:
        ok &= ~_isin(cond, MULTI_LEG)
    m = t.ms.to_numpy() // 60000 - M0
    ok &= (m >= 0) & (m < 390)
    t = t[ok].assign(m=m[ok].astype('int16'))
    cond = t.cond.to_numpy()
    t = t.assign(lv=_isin(cond, LAST), hl=_isin(cond, HIGHLOW), vv=_isin(cond, VOLUME))
    t = t.sort_values(['exp', 'strike', 'right', 'm', 'ms'], kind='stable')
    key = ['exp', 'strike', 'right', 'm']
    vol = t[t.vv].groupby(key).agg(v=('size', 'sum'), n=('size', 'size'))
    last = t[t.lv].groupby(key).px.agg(o='first', c='last')
    hl = t[t.hl].groupby(key).px.agg(h='max', l='min')
    out = vol.join(last, how='outer').join(hl, how='outer').reset_index()
    for c in ('o', 'h', 'l', 'c'):
        out[c] = out[c].fillna(-1).astype('int32')
    for c in ('v', 'n'):
        out[c] = out[c].fillna(0).astype('int32')
    # a bar's high/low must contain its open/close (an O/C print that is not H/L-eligible, e.g. a '*' late print)
    has = out.c >= 0
    out.loc[has & (out.h < 0), 'h'] = out.loc[has & (out.h < 0), ['o', 'c']].max(axis=1)
    out.loc[has & (out.l < 0), 'l'] = out.loc[has & (out.l < 0), ['o', 'c']].min(axis=1)
    return out[['exp', 'strike', 'right', 'm', 'o', 'h', 'l', 'c', 'v', 'n']]
