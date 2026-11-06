"""Stage-2 data for one (root, block): every tradable contract at every 5-minute entry decision with every entry /
MTF signal of STRATEGY_SPEC sections 8-9 evaluated on THAT contract's own MID chart, plus the bar tables the exits read.

Entry decisions: 5m closes 09:35 .. 15:50 (STRATEGY_SPEC section 5: entries only for E in [09:31, 15:50]; every
Stage-2-C trigger is on the 5m chart). Tradable (section 7): the bucket's representative expiration(s), two-sided
NBBO at the decision bar end, |delta| in [0.30, 0.50] (MID-implied vol, r = q = 0), spread <= 8% of mid, ask size >= 1.

Candidate columns (one row per decision x tradable contract):
  session m dec_ms bucket exp strike right delta ask dist(|delta|-0.40)
  sA sB sC sD sH        model A-D/H fired on the 5m bar that closed at the decision (NaN-safe: False if not warm)
  sE                    model E MTF pullback 5 -> 15 (15m state +1, 5m close <= E21 in the last 3 bars, reclaim E9)
  st1 st5 st15 st30 st60   MID states -1/0/+1 at the last completed bar of each tf (NaN before E21 is warm)
  b15_age               5m bars since model B last fired on the 15m chart (0 = on the bar ending now; NaN if never)
  e5up15                15m E5 slope > 0 at the last completed 15m bar
  vwap_ok ema21_ok      underlying close on the trade's side of its session VWAP / of its 5m EMA21
  gex_neg nowall        latest visible positioning snapshot: dealer net GEX < 0; no wall against within 0.3%
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import split_of  # noqa: E402
from edata.store import Panel  # noqa: E402
from engine.bars import add_emas  # noqa: E402
from engine.bs import greeks, implied_vol, years_to_pm_expiry  # noqa: E402
from engine.signals import atr_close, state as sig_state  # noqa: E402
from stage1.events import BUCKETS, UND_SYM, Source, asof_rows, ckey, contract_minutes, mid_tables, und_close_at  # noqa: E402
from stage1.features import KEY, _lag, features, group_ids  # noqa: E402

ENTRY_M = tuple(m for m in range(4, 380) if (m + 1) % 5 == 0)        # 09:35 .. 15:50
TARGET, BAND, MAX_SPREAD = 0.40, (0.30, 0.50), 0.08
L5 = (5, 9, 15, 20, 21, 50, 100, 200)        # 5m: every EMA an entry or an exit level reads
LH = (5, 9, 21)                              # 1/15/30/60m: states and the E5 slope


def tradable(src: Source, plan: dict, D: str, u1: pd.Series, ms=ENTRY_M, buckets=BUCKETS) -> pd.DataFrame:
    sel = plan['select'][D]
    exps = {b: [int(e) for e in sel.get(b, [])] for b in buckets}
    allx = sorted({e for v in exps.values() for e in v})
    q = src.q0(D)
    if not len(q) or not allx:
        return pd.DataFrame()
    q = q[q.exp.isin(allx) & q.m.isin(ms) & (q.bid > 0) & (q.ask >= q.bid) & (q['as'] > 0)]
    mid = (q.bid.to_numpy() + q.ask.to_numpy()) / 200.0
    q = q[(q.ask.to_numpy() - q.bid.to_numpy()) / 100.0 <= MAX_SPREAD * mid]
    mid = (q.bid.to_numpy() + q.ask.to_numpy()) / 200.0
    S = u1.reindex(q.m.to_numpy()).to_numpy()
    T = years_to_pm_expiry(int(D), (570 + q.m.to_numpy() + 1) * 60_000, q.exp.to_numpy())
    K = q.strike.to_numpy() / 1000
    call = q.right.to_numpy() == 1
    iv = implied_vol(mid, S, K, T, call)
    dl = np.where(np.isfinite(iv), greeks(S, K, T, np.where(np.isfinite(iv), iv, 0.2), call)['delta'], np.nan)
    q = q.assign(delta=dl)
    q = q[(np.abs(q.delta) >= BAND[0]) & (np.abs(q.delta) <= BAND[1])]
    rows = []
    for b, es in exps.items():
        x = q[q.exp.isin(es)]
        if len(x):
            rows.append(pd.DataFrame({'m': x.m.to_numpy(), 'bucket': b, 'exp': x.exp.to_numpy(), 'strike': x.strike.to_numpy(),
                                      'right': x.right.to_numpy(), 'delta': x.delta.to_numpy(), 'ask': x.ask.to_numpy() / 100.0}))
    if not rows:
        return pd.DataFrame()
    out = pd.concat(rows, ignore_index=True)
    out['session'] = int(D)
    out['dec_ms'] = (570 + out.m.to_numpy().astype(np.int64) + 1) * 60_000
    out['dist'] = (np.abs(out.delta) - TARGET).abs()
    return out


def trade_ohlc(src: Source, days, keys: np.ndarray, tf: int) -> pd.DataFrame:
    """tf-minute TRADE bars (o/h/l/c of the eligible prints, edata/sip.py) of the given contracts; empty bars absent."""
    parts = []
    for D in days:
        t = src.tb(D)
        if not len(t):
            continue
        k = ckey(t.exp.to_numpy(), t.strike.to_numpy(), t.right.to_numpy())
        t = t[np.isin(k, keys) & (t.c.to_numpy() >= 0)]
        if len(t):
            parts.append(t.assign(session=np.int32(D), b=(t.m.to_numpy() // tf).astype(np.int16)))
    if not parts:
        return pd.DataFrame()
    df = pd.concat(parts, ignore_index=True).sort_values(KEY + ['session', 'm'], kind='stable')
    out = df.groupby(KEY + ['session', 'b'], sort=True).agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'),
                                                            c=('c', 'last')).reset_index()
    for c in ('o', 'h', 'l', 'c'):
        out[c] = out[c] / 100.0
    out['known_ms'] = ((570 + np.minimum((out.b.to_numpy().astype(np.int64) + 1) * tf, 390)) * 60_000).astype(np.int64)
    return out


def table_with(cm: pd.DataFrame, tf: int, lengths) -> pd.DataFrame:
    t = mid_tables(cm, tf)
    return add_emas(t, lengths)


def _asof(cand: pd.DataFrame, t: pd.DataFrame, cols) -> pd.DataFrame:
    from stage1.features import asof_join
    return asof_join(cand, t, cols, '')


class Stage2Data:
    def __init__(self, root: str, block: str, src: Source | None = None, log=print, buckets=BUCKETS):
        """buckets: a subset of the DTE buckets (they are independent in Stage 2: one position per (root, bucket),
        nulls drawn per (session, bucket), contract tables per contract), so a big root can be run in parts."""
        self.root, self.block = root, block
        src = src or Source(root)
        self.src = src
        p = src.p
        plan = p.plan(block)
        have = set(p.days())
        self.eval_days = [D for D in plan['eval'] if D in have and split_of(D) in ('DEV', 'VALIDATION')]
        self.days = [D for D in plan['hist'] + plan['eval'] if D in have]
        self.u1 = src.und_m1(self.days)
        uc = {int(D): g.set_index('m').c for D, g in self.u1.groupby('session')}
        self.und_last = {D: float(s.iloc[-1]) for D, s in uc.items()}
        parts = [tradable(src, plan, D, uc[int(D)], buckets=buckets) for D in self.eval_days if int(D) in uc]
        cand = pd.concat([x for x in parts if len(x)], ignore_index=True)
        keys = np.unique(ckey(cand.exp, cand.strike, cand.right))
        self.keys = keys
        log(root, block, f'{len(cand)} candidate rows, {len(keys)} contracts')
        self.cm = contract_minutes(src, self.days, keys)
        # ---- 5m table: entries A-D/H, E's LTF part, states, EMA levels, ATR
        t5 = table_with(self.cm, 5, L5)
        f5 = features(t5)
        g = group_ids(t5)
        first = np.r_[True, g[1:] != g[:-1]]
        c, e9, e21 = t5.c.to_numpy(), t5.ema9.to_numpy(), t5.ema21.to_numpy()
        touched = (pd.Series((c <= e21).astype(float)).groupby(g).rolling(3, min_periods=1).max().to_numpy() == 1)
        pc, pe9 = _lag(c, first), _lag(e9, first)
        ltfE = touched & (pc <= pe9) & (c > e9) & (t5.seen21.to_numpy() >= 21)
        atr = self._atr(t5, g)
        t5 = t5.assign(sA=f5.A.to_numpy() == 1, sB=f5.B.to_numpy() == 1, sC=f5.C.to_numpy() == 1, sD=f5.D.to_numpy() == 1,
                       sH=f5.H.to_numpy() == 1, ltfE=ltfE, state=f5.state.to_numpy(), atr=atr)
        del f5
        keep = KEY + ['session', 'b', 'known_ms', 'c'] + [f'ema{n}' for n in L5] + ['sA', 'sB', 'sC', 'sD', 'sH', 'ltfE', 'state', 'atr']
        self.t5 = t5[keep].copy()
        del t5
        # ---- higher / lower timeframe tables: states, B on 15m, E5 slope
        self.th = {}
        for tf in (1, 15, 30, 60):
            t = table_with(self.cm, tf, LH)
            st = np.where(t.seen21.to_numpy() >= 21, sig_state(t), np.nan)
            gg = group_ids(t)
            ff = np.r_[True, gg[1:] != gg[:-1]] if len(gg) else np.zeros(0, bool)
            e9h, e21h, e5h = t.ema9.to_numpy(), t.ema21.to_numpy(), t.ema5.to_numpy()
            bx = (_lag(e9h, ff) <= _lag(e21h, ff)) & (e9h > e21h) & (t.seen21.to_numpy() >= 21)
            t = t.assign(state=st, sB=bx, e5up=(e5h - _lag(e5h, ff)) > 0)
            self.th[tf] = t[KEY + ['session', 'b', 'known_ms', 'c', 'state', 'sB', 'e5up']].copy()
            del t
            import gc
            gc.collect()
        log(root, block, 'bar tables built')
        # ---- join everything onto the candidates (last completed bar at the decision)
        t5 = self.t5
        j5 = _asof(cand, t5, ['sA', 'sB', 'sC', 'sD', 'sH', 'ltfE', 'state'])
        fresh = j5['kms'].to_numpy() == cand.session.to_numpy(np.int64) * 100_000_000 + cand.dec_ms.to_numpy(np.int64)
        for s in ('sA', 'sB', 'sC', 'sD', 'sH'):
            cand[s] = fresh & (j5[s].to_numpy() == True)  # noqa: E712  (the trigger bar is the one that just closed)
        cand['st5'] = j5['state'].to_numpy()
        for tf, t in self.th.items():
            j = _asof(cand, t, ['state', 'sB', 'e5up'])
            cand[f'st{tf}'] = j['state'].to_numpy()
            if tf == 15:
                cand['e5up15'] = j['e5up'].to_numpy() == True  # noqa: E712
                cand['_st15'] = j['state'].to_numpy()
        cand['sE'] = fresh & (j5['ltfE'].to_numpy() == True) & (cand['_st15'].to_numpy() == 1)  # noqa: E712
        cand['b15_age'] = self._b15_age(cand)
        cand = cand.drop(columns=['_st15'])
        self._und_features(cand)
        self.cand = cand
        log(root, block, 'candidates joined')

    def _atr(self, t5: pd.DataFrame, g: np.ndarray) -> np.ndarray:
        """STRATEGY_SPEC exit 7: Wilder(14) true range of the contract's 5m TRADE bars where the TRADE series is dense
        (>= 80% of the last 2 x 14 wall-clock 5m bars printed), else 1.25 x Wilder mean |change| of the MID closes.
        Each value is as of the 5m MID bar it sits on (known at that bar's end)."""
        mid_atr = np.full(len(t5), np.nan)
        brk = np.r_[0, np.flatnonzero(g[1:] != g[:-1]) + 1, len(t5)]
        cvals = t5.c.to_numpy(float)
        for a, b in zip(brk[:-1], brk[1:]):
            mid_atr[a:b] = atr_close(pd.DataFrame({'c': cvals[a:b]}))
        tt = trade_ohlc(self.src, self.days, self.keys, 5)
        if not len(tt):
            return mid_atr
        gt = group_ids(tt)
        tr_atr = np.full(len(tt), np.nan)
        brk = np.r_[0, np.flatnonzero(gt[1:] != gt[:-1]) + 1, len(tt)]
        for a, b in zip(brk[:-1], brk[1:]):
            tr_atr[a:b] = atr_close(tt.iloc[a:b][['c', 'h', 'l']])
        tt = tt.assign(tatr=tr_atr)
        ev = t5[KEY + ['session']].assign(dec_ms=t5.known_ms.to_numpy())
        from stage1.events import trade_density
        qsess = self.cm[KEY + ['session']].drop_duplicates()
        dens = trade_density(ev, tt, qsess, 5, [14])[14]
        j = _asof(ev, tt, ['tatr'])
        return np.where((dens >= 0.8) & np.isfinite(j['tatr'].to_numpy()), j['tatr'].to_numpy(), mid_atr)

    def _b15_age(self, cand) -> np.ndarray:
        """5m bars since the last 15m bar on which model B fired (that bar's end <= the decision)."""
        t = self.th[15]
        t = t[t.sB.to_numpy()]
        if not len(t):
            return np.full(len(cand), np.nan)
        j = _asof(cand, t.assign(fired_kms=t.session.to_numpy(np.int64) * 100_000_000 + t.known_ms.to_numpy(np.int64)),
                  ['fired_kms'])
        k = j['fired_kms'].to_numpy()
        same = np.isfinite(k) & ((k // 100_000_000) == cand.session.to_numpy())
        age = (cand.dec_ms.to_numpy() - (k % 100_000_000)) / 300_000
        return np.where(same, age, np.nan)

    def _und_features(self, cand):
        from engine.underlying import Underlying
        U = Underlying(UND_SYM[self.root], self.days, vol_sym='SPY' if self.root == 'SPXW' else None, tfs=(5,))
        S, m, dm = cand.session.to_numpy(), cand.m.to_numpy(), cand.dec_ms.to_numpy()
        side = cand.right.to_numpy().astype(float)
        uc = und_close_at(U.m1, S, m)
        vw = U.vwap.set_index(['session', 'm']).vwap.reindex(pd.MultiIndex.from_arrays([S, m])).to_numpy()
        t5 = U.tables[5]
        i5 = asof_rows(t5, S, dm)
        e21 = np.where(i5 >= 0, t5.ema21.to_numpy()[np.clip(i5, 0, None)], np.nan)
        # underlying 5m EMA9/21 cross on the bar that closed at the decision (BL3 reference): +1 up, -1 down, 0 none
        d921 = np.sign(t5.ema9.to_numpy() - t5.ema21.to_numpy())
        cross = np.r_[0, np.where(d921[1:] != d921[:-1], d921[1:], 0)]
        jj = np.clip(i5, 0, None)
        fresh = (i5 >= 0) & (t5.known_ms.to_numpy()[jj] == dm) & (t5.session.to_numpy()[jj] == S)
        cand['ucross'] = np.where(fresh, cross[jj], 0)
        cand['vwap_ok'] = side * (uc - vw) > 0
        cand['ema21_ok'] = side * (uc - e21) > 0
        gx = [self.src.p.gx(D).assign(session=int(D)) for D in self.eval_days if len(self.src.p.gx(D))]
        if gx:
            gx = pd.concat(gx, ignore_index=True).sort_values(['session', 'ms']).reset_index(drop=True)
            gx['known_ms'] = gx.ms + 60_000
            ig = asof_rows(gx, S, dm)
            jg = np.clip(ig, 0, None)
            net = np.where(ig >= 0, gx.inf_net_gex_all.to_numpy()[jg], np.nan)
            cw = np.where(ig >= 0, gx.inf_call_wall.to_numpy()[jg], np.nan)
            pw = np.where(ig >= 0, gx.inf_put_wall.to_numpy()[jg], np.nan)
            gap = np.where(side > 0, cw / uc - 1, 1 - pw / uc)
            cand['gex_neg'] = net < 0
            cand['nowall'] = (gap > 0.003) | ~np.isfinite(gap)
        else:
            cand['gex_neg'] = False
            cand['nowall'] = False
        self.U = U
