"""The option contract's own chart (specs/STRATEGY_SPEC.md section 3): three price series of one contract over its
stored life, each resampled to 1/5/15/30/60-minute bars with EMA 5..200 states, all stamped with the time they become
known.

  MID       NBBO mid at each bar END (the 1-minute snapshot stamped at the end; invalid/one-sided quote -> no bar).
            Close-only bars (a 1-minute snapshot has no intrabar high/low). The executable reference series.
  TRADE     trade-print OHLC (SIP rules, edata/sip.py) of the minutes that printed; empty minutes print NO bar, so
            the EMA advances only on bars that exist -- what a charting app shows.
  TRADE_FF  the trade close carried forward through empty minutes (one bar per minute once the first print exists):
            the alternative some platforms draw; included to measure how much the choice matters.

Resolution: a contract-session stored at 15-minute snapshots (warm-up 'coarse' tier) feeds only the 15/30/60-minute
MID bars; its 1- and 5-minute MID bars start at the first 1-minute session. Trade bars are 1-minute everywhere.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.ema import EMA_LENGTHS, TIMEFRAMES, ema_table, resample

SERIES = ('mid', 'trade', 'trade_ff')


def contract_minutes(panel, exp: int, strike: int, right: int, days) -> pd.DataFrame:
    """One row per (session, m) with quotes and trade bar fields; NaN where absent. Prices in dollars."""
    rows = []
    for D in days:
        res = panel.resolution(D, exp)
        if res is None:
            continue
        q = panel.q0(D)
        if len(q):
            q = q[(q.exp == exp) & (q.strike == strike) & (q.right == right)]
        t = panel.tb(D)
        if len(t):
            t = t[(t.exp == exp) & (t.strike == strike) & (t.right == right)]
        if not len(q) and not len(t):
            continue
        grid = pd.DataFrame({'m': np.arange(390, dtype=int)})
        if len(q):
            qq = q[['m', 'bid', 'ask', 'bs', 'as']].astype({'m': int})
            grid = grid.merge(qq, on='m', how='left')
        else:
            for c in ('bid', 'ask', 'bs', 'as'):
                grid[c] = np.nan
        if len(t):
            tt = t[['m', 'o', 'h', 'l', 'c', 'v', 'n']].astype({'m': int})
            grid = grid.merge(tt, on='m', how='left')
        else:
            for c in ('o', 'h', 'l', 'c', 'v', 'n'):
                grid[c] = np.nan
        grid['session'] = int(D)
        grid['res'] = res
        rows.append(grid)
    if not rows:
        return pd.DataFrame()
    df = pd.concat(rows, ignore_index=True)
    for c in ('bid', 'ask', 'o', 'h', 'l', 'c'):
        df[c] = df[c].astype(float) / 100
    for c in ('o', 'h', 'l', 'c'):
        df.loc[df[c] < 0, c] = np.nan
    ok = (df.bid > 0) & (df.ask >= df.bid)
    df['mid'] = np.where(ok, (df.bid + df.ask) / 2, np.nan)
    df['spread'] = np.where(ok, df.ask - df.bid, np.nan)
    return df


class ContractChart:
    def __init__(self, minutes: pd.DataFrame, lengths=EMA_LENGTHS, tfs=TIMEFRAMES):
        self.min = minutes
        self.lengths, self.tfs = tuple(lengths), tuple(tfs)
        self.tables = {}
        for s in SERIES:
            for tf in tfs:
                self.tables[(s, tf)] = ema_table(resample(self.series_1m(s, tf), tf), self.lengths)
        self._keys = {k: t.session.to_numpy(np.int64) * 100_000_000 + t.known_ms.to_numpy(np.int64) for k, t in self.tables.items()}

    def series_1m(self, s: str, tf: int) -> pd.DataFrame:
        d = self.min
        if not len(d):
            return pd.DataFrame(columns=['session', 'm', 'c'])
        if s == 'mid':
            x = d[['session', 'm', 'mid', 'res']].rename(columns={'mid': 'c'})
            x = x[x.res <= tf] if tf < 15 else x
            if tf < 15:
                # 1/5-minute bars start at the contract's first 1-minute session (coarse sessions are a prefix)
                first = x.session[x.res == 1].min() if (x.res == 1).any() else None
                x = x[x.session >= first] if first is not None else x.iloc[:0]
            return x[['session', 'm', 'c']]
        if s == 'trade':
            return d[['session', 'm', 'o', 'h', 'l', 'c', 'v', 'n']]
        if s == 'trade_ff':
            x = d[['session', 'm', 'c']].copy()
            x['c'] = x.c.ffill()
            return x
        raise KeyError(s)

    def at(self, series: str, tf: int, session: int, ms: int) -> dict | None:
        """The last bar of (series, tf) known at (session, ms) with its EMA state."""
        k = int(session) * 100_000_000 + int(ms)
        i = int(np.searchsorted(self._keys[(series, tf)], k, side='right')) - 1
        if i < 0:
            return None
        return self.tables[(series, tf)].iloc[i].to_dict()

    def history(self, series: str, tf: int, session: int, ms: int, n: int) -> pd.DataFrame:
        """The last n bars known at (session, ms)."""
        k = int(session) * 100_000_000 + int(ms)
        i = int(np.searchsorted(self._keys[(series, tf)], k, side='right'))
        return self.tables[(series, tf)].iloc[max(0, i - n):i]
