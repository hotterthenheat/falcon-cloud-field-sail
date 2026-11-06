"""Underlying confirmation features (specs/STRATEGY_SPEC.md section 5). Every feature row carries known_ms (the end
of the last bar it uses); a decision at time t may read only rows with (session, known_ms) <= (t's session, t).

From 1-minute bars (stock: 04:00-16:00 with volume; SPX index: 09:30-16:00, no volume -> SPY's volume, VWAP and
premarket are used as proxies, scaled by the SPX/SPY ratio of the same minute):
  EMAs 5..200 on 1/5/15/30/60-minute closes (continuous across sessions, RTH only)
  VWAP           session VWAP from 09:30 of typical price (h+l+c)/3, and the close's distance to it in %
  RVOL           volume of the bar / mean volume of the same minute-of-day bar over the prior 20 sessions; and
                 cumulative RVOL (session volume so far / mean of the prior 20 sessions' volume to the same minute)
  RSI(14)        Wilder, on each timeframe's closes
  ORH/ORL        opening-range high/low of the first 5/15/30 minutes (known at 09:35 / 09:45 / 10:00)
  PDH/PDL/PDC    prior RTH session high/low/close;  PMH/PML premarket (04:00-09:29) high/low
  structure      swing high/low = pivot with k=2 lower highs/higher lows on each side, confirmed (known) k bars after
                 the pivot; BOS up/down = a close beyond the last confirmed swing high/low; MSS = a BOS against the
                 direction of the previous BOS (a change of structure)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from edata.store import und_bars
from engine.ema import EMA_LENGTHS, TIMEFRAMES, ema_table, resample

M0 = 9 * 60 + 30
PX = 10000.0


def rth_minutes(sym: str, days) -> pd.DataFrame:
    rows = []
    for D in days:
        b = und_bars(sym, D)
        if not len(b):
            continue
        b = b[(b['mod'] >= M0) & (b['mod'] < 16 * 60)].copy()
        b['m'] = b['mod'] - M0
        b['session'] = int(D)
        rows.append(b)
    if not rows:
        return pd.DataFrame()
    df = pd.concat(rows, ignore_index=True)
    for c in ('o', 'h', 'l', 'c'):
        df[c] = df[c] / PX
    df = df[df.c > 0]
    return df[['session', 'm', 'o', 'h', 'l', 'c', 'v', 'n']]


def rsi(close: np.ndarray, n: int = 14) -> np.ndarray:
    d = np.diff(close, prepend=np.nan)
    up, dn = np.where(d > 0, d, 0.0), np.where(d < 0, -d, 0.0)
    out = np.full(len(close), np.nan)
    if len(close) <= n:
        return out
    au, ad = up[1:n + 1].mean(), dn[1:n + 1].mean()
    for i in range(n + 1, len(close)):
        au = (au * (n - 1) + up[i]) / n
        ad = (ad * (n - 1) + dn[i]) / n
        out[i] = 100.0 if ad == 0 else 100 - 100 / (1 + au / ad)
    return out


def structure(bars: pd.DataFrame, k: int = 2) -> pd.DataFrame:
    """Adds swing_high/swing_low (last CONFIRMED pivot levels as of each bar), bos (+1/-1/0), mss (+1/-1/0), trend."""
    h, l, c = bars.h.to_numpy(), bars.l.to_numpy(), bars.c.to_numpy()
    n = len(bars)
    sh, sl = np.full(n, np.nan), np.full(n, np.nan)
    bos, mss, trend = np.zeros(n, int), np.zeros(n, int), np.zeros(n, int)
    last_h, last_l, tr = np.nan, np.nan, 0
    for i in range(n):
        p = i - k                        # pivot candidate confirmed at bar i
        if p - k >= 0:
            if h[p] == h[p - k:i + 1].max() and (h[p - k:p] < h[p]).all() and (h[p + 1:i + 1] < h[p]).all():
                last_h = h[p]
            if l[p] == l[p - k:i + 1].min() and (l[p - k:p] > l[p]).all() and (l[p + 1:i + 1] > l[p]).all():
                last_l = l[p]
        b = 0
        if last_h == last_h and c[i] > last_h:
            b = 1
            last_h = np.nan              # a level is broken once
        elif last_l == last_l and c[i] < last_l:
            b = -1
            last_l = np.nan
        if b:
            mss[i] = b if (tr != 0 and b != tr) else 0
            tr = b
        bos[i], trend[i] = b, tr
        sh[i], sl[i] = last_h, last_l
    return bars.assign(swing_high=sh, swing_low=sl, bos=bos, mss=mss, trend=trend)


class Underlying:
    """All confirmation features of one symbol over a list of sessions (history first)."""

    def __init__(self, sym: str, days, vol_sym: str | None = None, lengths=EMA_LENGTHS, tfs=TIMEFRAMES):
        self.sym = sym
        self.days = list(days)
        self.m1 = rth_minutes(sym, self.days)
        self.vol_sym = vol_sym or sym
        vol = self.m1 if self.vol_sym == sym else rth_minutes(self.vol_sym, self.days)
        self.tables = {}
        for tf in tfs:
            t = ema_table(resample(self.m1, tf), lengths)
            t['rsi14'] = rsi(t.c.to_numpy())
            t = structure(t)
            self.tables[tf] = t
        self.session_levels = self._levels()
        self.vwap = self._vwap(vol)
        self.rvol = self._rvol(vol)
        self._keys = {tf: t.session.to_numpy(np.int64) * 100_000_000 + t.known_ms.to_numpy(np.int64) for tf, t in self.tables.items()}

    def _levels(self) -> pd.DataFrame:
        rows = []
        prev, prev_D = None, None
        for D in self.days:
            x = self.m1[self.m1.session == int(D)]
            pre = und_bars(self.sym if self.sym != 'SPX' else 'SPY', D)
            pre = pre[(pre['mod'] >= 4 * 60) & (pre['mod'] < M0)] if len(pre) else pre
            r = {'session': int(D)}
            if prev is not None and len(prev):
                r.update({'pdh': prev.h.max(), 'pdl': prev.l.min(), 'pdc': prev.c.iloc[-1]})
            if len(pre):
                pmh, pml = pre.h.max() / PX, pre.l.min() / PX
                if self.sym == 'SPX':
                    # SPX prints no premarket: SPY's premarket x (prior SPX close / prior SPY close)
                    sp = und_bars('SPY', prev_D) if prev_D else pd.DataFrame()
                    sp = sp[(sp['mod'] >= M0) & (sp['mod'] < 16 * 60)] if len(sp) else sp
                    ratio = r['pdc'] / (sp.c.iloc[-1] / PX) if len(sp) and 'pdc' in r else np.nan
                    pmh, pml = pmh * ratio, pml * ratio
                r.update({'pmh': pmh, 'pml': pml})
            for w in (5, 15, 30):
                y = x[x.m < w]
                if len(y) == w:
                    r.update({f'orh{w}': y.h.max(), f'orl{w}': y.l.min(), f'or{w}_known_ms': (M0 + w) * 60_000})
            rows.append(r)
            prev, prev_D = x, D
        return pd.DataFrame(rows)

    def _vwap(self, vol: pd.DataFrame) -> pd.DataFrame:
        v = vol.copy()
        v['tp'] = (v.h + v.l + v.c) / 3
        v['pv'] = v.tp * v.v
        g = v.groupby('session')
        v['vwap'] = g.pv.cumsum() / g.v.cumsum().replace(0, np.nan)
        v['known_ms'] = (M0 + v.m + 1) * 60_000
        out = v[['session', 'm', 'known_ms', 'vwap', 'c']]
        if self.vol_sym != self.sym:
            # scale the proxy's VWAP by this symbol's close / the proxy's close at the same minute
            own = self.m1[['session', 'm', 'c']].rename(columns={'c': 'own_c'})
            out = out.merge(own, on=['session', 'm'], how='inner')
            out['vwap'] = out.vwap * out.own_c / out.c
            out = out.drop(columns=['own_c'])
        return out.drop(columns=['c'])

    def _rvol(self, vol: pd.DataFrame, look: int = 20) -> pd.DataFrame:
        v = vol[['session', 'm', 'v']].copy()
        piv = v.pivot_table(index='session', columns='m', values='v', aggfunc='sum').sort_index()
        cum = piv.fillna(0).cumsum(axis=1)
        base = piv.rolling(look, min_periods=look).mean().shift(1)
        cbase = cum.rolling(look, min_periods=look).mean().shift(1)
        r = (piv / base).stack().rename('rvol').to_frame()
        cr = (cum / cbase).stack().rename('rvol_cum').to_frame()
        out = r.join(cr, how='outer').reset_index()
        out['known_ms'] = (M0 + out.m + 1) * 60_000
        return out

    def at(self, tf: int, session: int, ms: int) -> dict | None:
        k = int(session) * 100_000_000 + int(ms)
        i = int(np.searchsorted(self._keys[tf], k, side='right')) - 1
        return None if i < 0 else self.tables[tf].iloc[i].to_dict()
