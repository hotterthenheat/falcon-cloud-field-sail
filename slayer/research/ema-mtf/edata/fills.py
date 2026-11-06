"""Fill quotes for latency 'L2': the 1-second NBBO of a traded contract-day, fetched on demand, cached per contract-day.

    fb = FillBook('SPY')                      # Simulator(panel, ExecConfig(latency='L2'), fills=fb)
    fb.quote_at('20240417', (20240417, 500000, 1), ms)   # NBBO in force at ms (dollars, sizes)
    fb.prefetch([(D, (exp, strike, right)), ...])        # fetch many first (resumable)

A 1-second interval row stamped T is the NBBO in force at T (compass-v2 validation/interval_semantics.py: 100% against
the tick tape). Unlike the 1-minute grid, a 1-second grid has a row at every second, so T = bar end + 2 s is exact.
Stored de-duplicated to state changes: v2data/ema/fills/{root}/{D}/{exp}_{strike}_{right}.parquet.
"""
from __future__ import annotations

import os
from functools import lru_cache

import numpy as np
import pandas as pd

from edata.common import EMA_DATA, NoData, cents, check_disk, csv, guard, ms_of_day, write_parquet

FILLS = os.path.join(EMA_DATA, 'fills')


class FillBook:
    def __init__(self, root: str, fetch: bool = True):
        self.root, self.fetch = root, fetch

    def _path(self, D, c):
        return os.path.join(FILLS, self.root, str(D), f'{c[0]}_{c[1]}_{c[2]}.parquet')

    def _get(self, D, c) -> dict | None:
        return _load(self.root, str(D), tuple(int(x) for x in c), self.fetch)

    def quote_at(self, D, c, ms: int):
        q = self._get(D, c)
        if q is None or not len(q['ms']):
            return None
        i = int(np.searchsorted(q['ms'], ms, side='right')) - 1
        if i < 0:
            return None
        return (q['bid'][i] / 100, q['ask'][i] / 100, int(q['bs'][i]), int(q['as'][i]))

    def prefetch(self, items):
        for D, c in sorted(set(items)):
            self._get(D, c)


@lru_cache(maxsize=4096)
def _load(root, D, c, fetch):
    p = os.path.join(FILLS, root, D, f'{c[0]}_{c[1]}_{c[2]}.parquet')
    if os.path.exists(p):
        df = pd.read_parquet(p)
    elif not fetch:
        return None
    else:
        guard(D)
        check_disk()
        try:
            q = csv('/option/history/quote', {'symbol': root, 'expiration': str(c[0]), 'strike': f'{c[1] / 1000:g}',
                                              'right': 'call' if c[2] == 1 else 'put', 'date': D, 'interval': '1s'}, timeout=300)
            df = pd.DataFrame({'ms': ms_of_day(q.timestamp), 'bid': cents(q.bid), 'ask': cents(q.ask),
                               'bs': q.bid_size.astype('int32'), 'as': q.ask_size.astype('int32')})
            chg = np.r_[True, (np.diff(df[['bid', 'ask', 'bs', 'as']].to_numpy(), axis=0) != 0).any(1)]
            df = df[chg]
        except NoData:
            df = pd.DataFrame({'ms': pd.Series(dtype='int32'), 'bid': pd.Series(dtype='int32'), 'ask': pd.Series(dtype='int32'),
                               'bs': pd.Series(dtype='int32'), 'as': pd.Series(dtype='int32')})
        write_parquet(df, p)
    return {k: df[k].to_numpy().astype(np.int64 if k == 'ms' else df[k].dtype) for k in ('ms', 'bid', 'ask', 'bs', 'as')}
