"""Stage-1 decision events (PREREG section 4.1) with every feature the Stage-1 families test, on one (root, block).

    python3 -m stage1.events --block A --roots SPY,QQQ,IWM,SPXW      -> v2data/ema/results/stage1/events_<block>_<root>.parquet

Event = (eval session, decision close m with (m+1) % 5 == 0 and 09:45 <= close <= 15:00, bucket, right): the tradable
contract per STRATEGY_SPEC section 7 at that close (|delta| nearest 0.40 in [0.30, 0.50], spread <= 8% of mid, ask size
>= 1, the bucket's representative expiration(s)); none -> no event.

Columns
  keys        root block session m dec_ms bucket right exp strike dte delta iv
  outcomes    Y15 Y30 Y60 (executable net return at L0c: ask + measured 2 s drift in, bid - drift out at the close h
              minutes later or the 15:55 flat, fees; engine/execution.py semantics, etests/test_stage1.py checks
              equality with the Simulator), Ymid15/30/60 (mid-to-mid, reported only), G30 (gross), entry_spread, status
  S1A         f_{F}_{tf} for F in S A B C D H L50 L200, tf in 1 5 15 30 60   (own MID chart, last completed tf bar)
  S1B         st_{tf} (option MID state -1/0/+1), ust_{tf} (underlying state, sign-aligned to the trade: x right)
  control     p_{F}_{tf} the same feature on the Black-Scholes reprice path P* (IV frozen at the session's 10:00)
  TRADE arm   t_{F}_{tf} the feature on the TRADE series where the density rule holds (>= 80% of the last 2N
              wall-clock tf bars printed; N = the feature's longest EMA), else NaN
  S1C         c_vwap c_und5 c_rsi c_rvol c_or c_pdhl c_pm c_bos c_gex c_wall c_pcoi c_ativ c_crvol c_uw (1/0/NaN)

No value at a decision uses anything stamped after it: every table is as-of joined on (session, known_ms) <=
(session, decision ms) (etests/test_stage1.py: noise-after-decision test + canary).
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA, split_of  # noqa: E402
from edata.store import Panel, und_bars  # noqa: E402
from engine.bars import add_emas  # noqa: E402
from engine.bs import greeks, implied_vol, price as bs_price, years_to_pm_expiry  # noqa: E402
from engine.ema import ema_table, resample  # noqa: E402
from engine.execution import FLAT_M, fee_per_contract  # noqa: E402
from engine.signals import state as sig_state  # noqa: E402
from stage1.features import FEATURES, KEY, LENGTHS, WARM_N, asof_join, features  # noqa: E402

OUT = os.path.join(EMA_DATA, 'results', 'stage1')
UND_SYM = {'SPY': 'SPY', 'QQQ': 'QQQ', 'IWM': 'IWM', 'SPXW': 'SPX'}
BUCKETS = ('0', '1-7', '8-30', '31-90', '91-200')
DEC_M = tuple(m for m in range(14, 330) if (m + 1) % 5 == 0)     # 09:45 .. 15:00 closes (64 a session)
HORIZONS = (15, 30, 60)
TFS = (1, 5, 15, 30, 60)
TARGET, BAND, MAX_SPREAD = 0.40, (0.30, 0.50), 0.08
DRIFT_BUY, DRIFT_SELL = 0.0017, 0.0005
M0 = 570


def dec_ms_of(m):
    return (M0 + np.asarray(m, np.int64) + 1) * 60_000


def ckey(exp, strike, right):
    return (np.asarray(exp, np.int64) - 20_000_000) * 100_000_000 + np.asarray(strike, np.int64) * 2 + (np.asarray(right) > 0)


# ----------------------------------------------------------------------------------------------- data access
class Source:
    """Where quotes and underlying minutes come from (the real panel, or stage1.synth.SynthSource)."""

    def __init__(self, root: str, panel: Panel | None = None):
        self.root = root
        self.p = panel or Panel(root)
        self.sym = UND_SYM[root]

    def q0(self, D):
        return self.p.q0(D)

    def tb(self, D):
        return self.p.tb(D)

    def tiers(self, D):
        return self.p.manifest(D)['tiers']

    def und_m1(self, days) -> pd.DataFrame:
        from engine.underlying import rth_minutes
        return rth_minutes(self.sym, days)


# ----------------------------------------------------------------------------------------------- selection
def select_events(src: Source, plan: dict, D: str, u1: pd.Series) -> pd.DataFrame:
    """The tradable contract per (decision m, bucket, right) on eval session D. u1: underlying close by m."""
    sel = plan['select'][D]
    exps = {b: [int(e) for e in sel.get(b, [])] for b in BUCKETS}
    allx = sorted({e for v in exps.values() for e in v})
    q = src.q0(D)
    if not len(q) or not allx:
        return pd.DataFrame()
    q = q[q.exp.isin(allx) & q.m.isin(DEC_M) & (q.bid > 0) & (q.ask >= q.bid) & (q['as'] > 0)]
    mid = (q.bid.to_numpy() + q.ask.to_numpy()) / 200.0
    q = q[(q.ask.to_numpy() - q.bid.to_numpy()) / 100.0 <= MAX_SPREAD * mid]
    mid = (q.bid.to_numpy() + q.ask.to_numpy()) / 200.0
    S = u1.reindex(q.m.to_numpy()).to_numpy()
    T = years_to_pm_expiry(int(D), dec_ms_of(q.m.to_numpy()), q.exp.to_numpy())
    K = q.strike.to_numpy() / 1000
    call = q.right.to_numpy() == 1
    iv = implied_vol(mid, S, K, T, call)
    dl = greeks(S, K, T, np.where(np.isfinite(iv), iv, 0.2), call)['delta']
    dl = np.where(np.isfinite(iv), dl, np.nan)
    q = q.assign(iv=iv, delta=dl, ad=np.abs(dl))
    q = q[(q.ad >= BAND[0]) & (q.ad <= BAND[1])]
    rows = []
    for b, es in exps.items():
        if not es:
            continue
        x = q[q.exp.isin(es)]
        if not len(x):
            continue
        x = x.assign(dist=(x.ad - TARGET).abs()).sort_values(['m', 'right', 'dist', 'ask'], kind='stable')
        x = x.drop_duplicates(['m', 'right'], keep='first')
        rows.append(x.assign(bucket=b))
    if not rows:
        return pd.DataFrame()
    ev = pd.concat(rows, ignore_index=True)
    ev = ev[['m', 'bucket', 'right', 'exp', 'strike', 'delta', 'iv']].copy()
    ev['session'] = int(D)
    ev['dec_ms'] = dec_ms_of(ev.m.to_numpy())
    ev['dte'] = (pd.to_datetime(ev.exp.astype(str)) - pd.Timestamp(D)).dt.days.to_numpy()
    return ev


# ----------------------------------------------------------------------------------------------- outcomes
def day_grids(q: pd.DataFrame, keys: np.ndarray):
    """Arrays [contract, m] (m = 0..389) of bid, ask (dollars), bid size, ask size for the contracts in `keys`."""
    k = ckey(q.exp.to_numpy(), q.strike.to_numpy(), q.right.to_numpy())
    pos = {int(v): i for i, v in enumerate(keys)}
    sel = np.isin(k, keys)
    q, k = q[sel], k[sel]
    ci = np.array([pos[int(v)] for v in k], np.int64)
    m = q.m.to_numpy().astype(np.int64)
    ok = (m >= 0) & (m < 390)
    n = len(keys)
    B = np.full((n, 390), np.nan)
    A = np.full((n, 390), np.nan)
    BS = np.zeros((n, 390), np.int64)
    AS = np.zeros((n, 390), np.int64)
    B[ci[ok], m[ok]] = q.bid.to_numpy()[ok] / 100.0
    A[ci[ok], m[ok]] = q.ask.to_numpy()[ok] / 100.0
    BS[ci[ok], m[ok]] = q.bs.to_numpy()[ok]
    AS[ci[ok], m[ok]] = q['as'].to_numpy()[ok]
    return B, A, BS, AS


def outcomes(ev: pd.DataFrame, root: str, B, A, BS, AS, ci: np.ndarray, und_last: float, horizons=HORIZONS) -> dict:
    """Executable XT_h outcomes at L0c for events of one session (engine/execution.py Simulator + XTime semantics)."""
    n = len(ev)
    m = ev.m.to_numpy().astype(np.int64)
    b0, a0, as0 = B[ci, m], A[ci, m], AS[ci, m]
    mid0 = (b0 + a0) / 2
    bid_in = np.maximum(b0 - DRIFT_SELL * mid0, 0.0)
    ask_in = a0 + DRIFT_BUY * mid0
    midin = (bid_in + ask_in) / 2
    ok = (bid_in > 0) & (ask_in >= bid_in) & ((ask_in - bid_in) / midin <= MAX_SPREAD) & (as0 > 0)
    ok &= np.isfinite(b0) & np.isfinite(a0)
    fee = fee_per_contract(root)
    out = {'status_ok': ok, 'entry_px': np.where(ok, ask_in, np.nan), 'entry_mid': np.where(ok, midin, np.nan),
           'entry_spread': np.where(ok, (ask_in - bid_in) / midin, np.nan)}
    K = ev.strike.to_numpy() / 1000
    call = ev.right.to_numpy() == 1
    intr = np.maximum(0.0, np.where(call, und_last - K, K - und_last)) if und_last == und_last else np.zeros(n)
    for h in horizons:
        xm = np.minimum(m + h, FLAT_M)
        px_out = np.full(n, np.nan)
        mid_out = np.full(n, np.nan)
        todo = ok.copy()
        j = xm.copy()
        while todo.any():
            live = todo & (j <= FLAT_M + 5)
            if not live.any():
                break
            jj = np.minimum(j, 389)
            bb, aa, bs = B[ci, jj], A[ci, jj], BS[ci, jj]
            mm = (bb + aa) / 2
            bo = np.maximum(bb - DRIFT_SELL * mm, 0.0)
            ao = aa + DRIFT_BUY * mm
            valid = live & np.isfinite(bb) & (bo > 0) & (ao >= bo)
            first_mid = valid & np.isnan(mid_out)
            mid_out[first_mid] = ((bo + ao) / 2)[first_mid]
            fill = valid & (bs > 0)
            px_out[fill] = bo[fill]
            todo &= ~fill
            j = j + 1
            todo &= j <= FLAT_M + 5
        forced = ok & np.isnan(px_out)
        px_out[forced] = intr[forced]
        px_in = out['entry_px']
        gross = (px_out - px_in) * 100
        out[f'Y{h}'] = np.where(ok, (gross - 2 * fee) / (px_in * 100 + fee), np.nan)
        out[f'G{h}'] = np.where(ok, (px_out - px_in) / px_in, np.nan)
        out[f'Ymid{h}'] = np.where(ok, mid_out / out['entry_mid'] - 1, np.nan)
        out[f'forced{h}'] = forced
    return out


# ----------------------------------------------------------------------------------------------- bar tables
def contract_minutes(src: Source, days, keys: np.ndarray) -> pd.DataFrame:
    """Every stored q0 row of the event contracts (all days): exp strike right session m bid ask fine."""
    parts = []
    for D in days:
        q = src.q0(D)
        if not len(q):
            continue
        k = ckey(q.exp.to_numpy(), q.strike.to_numpy(), q.right.to_numpy())
        x = q[np.isin(k, keys)]
        if not len(x):
            continue
        fine = {int(e) for e, t in src.tiers(D).items() if t != 'coarse'}
        parts.append(pd.DataFrame({'exp': x.exp.to_numpy(), 'strike': x.strike.to_numpy(), 'right': x.right.to_numpy(),
                                   'session': np.int32(D), 'm': x.m.to_numpy().astype(np.int16), 'bid': x.bid.to_numpy(),
                                   'ask': x.ask.to_numpy(), 'fine': x.exp.isin(fine).to_numpy()}))
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def mid_tables(cm: pd.DataFrame, tf: int) -> pd.DataFrame:
    """MID close-only bars of tf (engine/bars.py mid_bars semantics) for the contracts in cm, with EMAs."""
    m = cm.m.to_numpy()
    keep = (((m + 1) % tf == 0) | (m == 389)) & (cm.bid.to_numpy() > 0) & (cm.ask.to_numpy() >= cm.bid.to_numpy())
    if tf < 15:
        keep &= cm.fine.to_numpy()
    x = cm[keep]
    df = pd.DataFrame({'exp': x.exp.to_numpy(), 'strike': x.strike.to_numpy(), 'right': x.right.to_numpy(),
                       'session': x.session.to_numpy(), 'b': (x.m.to_numpy() // tf).astype(np.int16),
                       'm_end': x.m.to_numpy(), 'c': (x.bid.to_numpy() + x.ask.to_numpy()) / 200.0})
    df = df.sort_values(KEY + ['session', 'b'], kind='stable').reset_index(drop=True)
    df['known_ms'] = ((M0 + np.minimum((df.b.to_numpy().astype(np.int64) + 1) * tf, 390)) * 60_000).astype(np.int64)
    return df


def with_features(df: pd.DataFrame) -> pd.DataFrame:
    df = add_emas(df.copy(), LENGTHS)
    f = features(df)
    return pd.concat([df[KEY + ['session', 'b', 'known_ms', 'c']], f], axis=1)


def frozen_iv(cm: pd.DataFrame, u1_all: pd.DataFrame) -> pd.DataFrame:
    """Per (contract, session): the MID-implied vol at the first valid bar end at or after 10:00 (m >= 29) and its m.
    P* uses it from that bar on; earlier bars of the session use the previous stored session's value (no look-ahead)."""
    x = cm[(cm.m >= 29) & (cm.bid > 0) & (cm.ask >= cm.bid)]
    x = x.sort_values(KEY + ['session', 'm'], kind='stable').drop_duplicates(KEY + ['session'], keep='first')
    S = und_close_at(u1_all, x.session.to_numpy(), x.m.to_numpy())
    T = years_to_pm_expiry_vec(x.session.to_numpy(), dec_ms_of(x.m.to_numpy()), x.exp.to_numpy())
    mid = (x.bid.to_numpy() + x.ask.to_numpy()) / 200.0
    iv = implied_vol(mid, S, x.strike.to_numpy() / 1000, T, x.right.to_numpy() == 1)
    return pd.DataFrame({'exp': x.exp.to_numpy(), 'strike': x.strike.to_numpy(), 'right': x.right.to_numpy(),
                         'session': x.session.to_numpy(), 'm_freeze': x.m.to_numpy(), 'ivf': iv})


def years_to_pm_expiry_vec(sessions, ms, exps):
    s = pd.to_datetime(np.asarray(sessions).astype(str), format='%Y%m%d')
    e = pd.to_datetime(np.asarray(exps).astype(str), format='%Y%m%d')
    days = (e - s).days.to_numpy().astype(float)
    mins = days * 1440 + (16 * 60 - np.asarray(ms, float) / 60000)
    return np.maximum(mins, 60.0) / (365 * 1440)


def und_close_at(u1_all: pd.DataFrame, sessions, m) -> np.ndarray:
    """Underlying close of 1-minute bar m (ends 09:31+m) of each session; the last earlier bar if missing."""
    k = u1_all.session.to_numpy(np.int64) * 1000 + u1_all.m.to_numpy(np.int64)
    o = np.argsort(k, kind='stable')
    k, c = k[o], u1_all.c.to_numpy(float)[o]
    q = np.asarray(sessions, np.int64) * 1000 + np.asarray(m, np.int64)
    i = np.searchsorted(k, q, side='right') - 1
    res = np.where(i >= 0, c[np.clip(i, 0, None)], np.nan)
    # only the same session counts
    same = (i >= 0) & (k[np.clip(i, 0, None)] // 1000 == np.asarray(sessions, np.int64))
    return np.where(same, res, np.nan)


def reprice_table(mt: pd.DataFrame, ivf: pd.DataFrame, u1_all: pd.DataFrame, tf: int) -> pd.DataFrame:
    """P* bars: the MID table's bar grid with c replaced by the Black-Scholes price at the underlying's close of the
    bar's last minute, the contract's frozen IV and the time to expiry at the bar end (STRATEGY_SPEC 4.1 point 2)."""
    d = mt[KEY + ['session', 'b', 'known_ms', 'm_end']].copy()
    f = ivf.sort_values(KEY + ['session'])
    d = d.merge(f, on=KEY + ['session'], how='left')
    # previous stored session's frozen IV for bars before this session's freeze bar
    f2 = f.copy()
    f2['ivf_prev'] = f2.groupby(KEY).ivf.shift(1)
    d = d.merge(f2[KEY + ['session', 'ivf_prev']], on=KEY + ['session'], how='left')
    before = ~(d.m_end.to_numpy() >= d.m_freeze.to_numpy())          # NaN m_freeze -> before
    iv = np.where(before, d.ivf_prev.to_numpy(), d.ivf.to_numpy())
    S = und_close_at(u1_all, d.session.to_numpy(), d.m_end.to_numpy())
    T = years_to_pm_expiry_vec(d.session.to_numpy(), d.known_ms.to_numpy(), d.exp.to_numpy())
    px = bs_price(S, d.strike.to_numpy() / 1000, T, np.where(np.isfinite(iv), iv, 0.2), d.right.to_numpy() == 1)
    d['c'] = np.where(np.isfinite(iv) & np.isfinite(S), px, np.nan)
    d = d[np.isfinite(d.c.to_numpy())].drop(columns=['m_freeze', 'ivf', 'ivf_prev'])
    return d.sort_values(KEY + ['session', 'b'], kind='stable').reset_index(drop=True)


def trade_tables(src: Source, days, keys: np.ndarray, tf: int) -> pd.DataFrame:
    parts = []
    for D in days:
        t = src.tb(D)
        if not len(t):
            continue
        k = ckey(t.exp.to_numpy(), t.strike.to_numpy(), t.right.to_numpy())
        t = t[np.isin(k, keys) & (t.c.to_numpy() >= 0)]
        if len(t):
            parts.append(pd.DataFrame({'exp': t.exp.to_numpy(), 'strike': t.strike.to_numpy(), 'right': t.right.to_numpy(),
                                       'session': np.int32(D), 'b': (t.m.to_numpy() // tf).astype(np.int16),
                                       'm': t.m.to_numpy(), 'c': t.c.to_numpy() / 100.0}))
    if not parts:
        return pd.DataFrame()
    df = pd.concat(parts, ignore_index=True).sort_values(KEY + ['session', 'm'], kind='stable')
    out = df.groupby(KEY + ['session', 'b'], sort=True).agg(c=('c', 'last')).reset_index()
    out['known_ms'] = ((M0 + np.minimum((out.b.to_numpy().astype(np.int64) + 1) * tf, 390)) * 60_000).astype(np.int64)
    return out


def trade_density(ev: pd.DataFrame, tt: pd.DataFrame, qsess: pd.DataFrame, tf: int, Ns) -> dict:
    """Share of the last 2N wall-clock tf bars (of the sessions the contract was stored on) that printed, as of the
    last completed bar at each decision. qsess: exp strike right session (contract stored that session)."""
    bps = -(-390 // tf)
    qs = qsess.sort_values(KEY + ['session']).reset_index(drop=True)
    qs['ck'] = ckey(qs.exp, qs.strike, qs.right)
    qs['slot'] = np.arange(len(qs)) * bps
    first_slot = qs.groupby('ck').slot.transform('min').to_numpy()
    qs['cstart'] = first_slot
    total = len(qs) * bps
    pr = np.zeros(total + 1, np.int64)
    if len(tt):
        tk = pd.DataFrame({'ck': ckey(tt.exp, tt.strike, tt.right), 'session': tt.session.to_numpy(), 'b': tt.b.to_numpy()})
        tk = tk.merge(qs[['ck', 'session', 'slot']], on=['ck', 'session'], how='inner')
        pr[tk.slot.to_numpy() + tk.b.to_numpy().astype(np.int64)] = 1
    cs = np.r_[0, np.cumsum(pr[:-1])]                 # cs[i] = printed bars in global slots < i
    e = pd.DataFrame({'ck': ckey(ev.exp, ev.strike, ev.right), 'session': ev.session.to_numpy(), '_i': np.arange(len(ev))})
    e = e.merge(qs[['ck', 'session', 'slot', 'cstart']], on=['ck', 'session'], how='left').sort_values('_i')
    tmin = (ev.dec_ms.to_numpy() // 60_000) - M0
    blast = tmin // tf - 1                             # last completed bar of the session at the decision
    gi = e.slot.to_numpy() + blast                     # global index of that bar (may fall into the previous session)
    res = {}
    for N in Ns:
        w = 2 * N
        lo = gi - w + 1
        okw = np.isfinite(e.slot.to_numpy()) & (lo >= e.cstart.to_numpy())
        lo_i = np.where(okw, lo, 0).astype(np.int64)
        hi_i = np.where(okw, gi + 1, 0).astype(np.int64)
        dens = (cs[hi_i] - cs[lo_i]) / w
        res[N] = np.where(okw, dens, np.nan)
    return res


# ----------------------------------------------------------------------------------------------- underlying
def und_tf_tables(u1: pd.DataFrame) -> dict:
    out = {}
    for tf in TFS:
        t = ema_table(resample(u1, tf), (9, 21))
        t['state'] = np.where(t.seen21 >= 21, sig_state(t), np.nan)
        out[tf] = t
    return out


def asof_rows(tab: pd.DataFrame, sessions, ms) -> np.ndarray:
    k = tab.session.to_numpy(np.int64) * 100_000_000 + tab.known_ms.to_numpy(np.int64)
    q = np.asarray(sessions, np.int64) * 100_000_000 + np.asarray(ms, np.int64)
    return np.searchsorted(k, q, side='right') - 1


# ----------------------------------------------------------------------------------------------- S1C pieces
def s1c_features(ev: pd.DataFrame, root: str, src: Source, U, days_all, eval_days, oi_ratio: pd.Series, uw: pd.DataFrame | None,
                 tb_vol: dict) -> pd.DataFrame:
    side = ev.right.to_numpy().astype(float)
    S = ev.session.to_numpy()
    m = ev.m.to_numpy()
    dm = ev.dec_ms.to_numpy()
    res = pd.DataFrame(index=ev.index)
    u1 = U.m1
    uc = und_close_at(u1, S, m)
    # VWAP side
    vw = U.vwap.set_index(['session', 'm']).vwap
    vv = vw.reindex(pd.MultiIndex.from_arrays([S, m])).to_numpy()
    res['c_vwap'] = np.where(np.isfinite(vv) & np.isfinite(uc), (side * (uc - vv) > 0).astype(float), np.nan)
    # underlying 5m state = +1 in trade direction; RSI14 5m; BOS within last 3 bars
    t5 = U.tables[5]
    i5 = asof_rows(t5, S, dm)
    okk = i5 >= 0
    st5 = np.where(t5.seen21.to_numpy()[np.clip(i5, 0, None)] >= 21, sig_state(t5)[np.clip(i5, 0, None)], np.nan)
    res['c_und5'] = np.where(okk & np.isfinite(st5), (side * st5 == 1).astype(float), np.nan)
    r5 = t5.rsi14.to_numpy()[np.clip(i5, 0, None)]
    res['c_rsi'] = np.where(okk & np.isfinite(r5), (side * (r5 - 50) > 0).astype(float), np.nan)
    bos = t5.bos.to_numpy()
    hit = np.zeros(len(ev), bool)
    for k in range(3):
        j = np.clip(i5 - k, 0, None)
        hit |= (i5 - k >= 0) & (bos[j] == side)
    res['c_bos'] = np.where(okk, hit.astype(float), np.nan)
    # cumulative RVOL > 1.5
    rv = U.rvol.set_index(['session', 'm']).rvol_cum
    rr = rv.reindex(pd.MultiIndex.from_arrays([S, m])).to_numpy()
    res['c_rvol'] = np.where(np.isfinite(rr), (rr > 1.5).astype(float), np.nan)
    # OR15 / PDH-PDL / PM H-L breaks before the event (1-minute closes beyond the level, trade direction)
    lev = U.session_levels.set_index('session')
    mx, mn, mx15, mn15 = (np.full(len(ev), np.nan) for _ in range(4))
    for D in np.unique(S):
        x = u1[u1.session == D].set_index('m').c.reindex(np.arange(390))
        cmax = x.cummax().to_numpy()
        cmin = x.cummin().to_numpy()
        x15 = x.copy()
        x15[x15.index < 15] = np.nan
        c15max, c15min = x15.cummax().to_numpy(), x15.cummin().to_numpy()
        sel = S == D
        mm = m[sel]
        mx[sel], mn[sel], mx15[sel], mn15[sel] = cmax[mm], cmin[mm], c15max[mm], c15min[mm]
    def lv(col):
        return lev[col].reindex(S).to_numpy() if col in lev else np.full(len(ev), np.nan)
    def brk(hi_lvl, lo_lvl, hi_px, lo_px):
        v = np.where(side > 0, hi_px > hi_lvl, lo_px < lo_lvl).astype(float)
        okl = np.where(side > 0, np.isfinite(hi_lvl), np.isfinite(lo_lvl))
        return np.where(okl, np.where(np.isfinite(np.where(side > 0, hi_px, lo_px)), v, 0.0), np.nan)
    res['c_or'] = brk(lv('orh15'), lv('orl15'), mx15, mn15)
    res['c_pdhl'] = brk(lv('pdh'), lv('pdl'), mx, mn)
    res['c_pm'] = brk(lv('pmh'), lv('pml'), mx, mn)
    # positioning: latest snapshot visible (stamp + 60 s) at the decision, eval sessions (carries across sessions)
    gx = pd.concat([src.p.gx(D).assign(session=int(D)) for D in eval_days if len(src.p.gx(D))], ignore_index=True) \
        if hasattr(src, 'p') else pd.DataFrame()
    if len(gx):
        gx = gx.sort_values(['session', 'ms']).reset_index(drop=True)
        gx['known_ms'] = gx.ms + 60_000
        ig = asof_rows(gx, S, dm)
        okg = ig >= 0
        jg = np.clip(ig, 0, None)
        net = gx.inf_net_gex_all.to_numpy()[jg]
        res['c_gex'] = np.where(okg & np.isfinite(net), (net < 0).astype(float), np.nan)
        cw, pw = gx.inf_call_wall.to_numpy()[jg], gx.inf_put_wall.to_numpy()[jg]
        gap = np.where(side > 0, cw / uc - 1, 1 - pw / uc)
        nowall = (gap > 0.003) | ~np.isfinite(gap)
        res['c_wall'] = np.where(okg & np.isfinite(uc), nowall.astype(float), np.nan)
        # ATM IV up over the last 60 minutes: the visible snapshot vs the one stamped 60 minutes earlier, same session
        atm = gx.obs_atm_iv.to_numpy()
        key = dict(zip(zip(gx.session.to_numpy(), gx.ms.to_numpy()), atm))
        cur_ms = gx.ms.to_numpy()[jg]
        cur_s = gx.session.to_numpy()[jg]
        prev = np.array([key.get((s, t - 3_600_000), np.nan) for s, t in zip(cur_s, cur_ms)])
        same = cur_s == S
        res['c_ativ'] = np.where(okg & same & np.isfinite(prev) & np.isfinite(atm[jg]), (atm[jg] > prev).astype(float), np.nan)
    else:
        res['c_gex'] = res['c_wall'] = res['c_ativ'] = np.nan
    res['c_pcoi'] = pcoi_feature(ev, oi_ratio)
    # contract RVOL > 2: today's cumulative print volume to the decision / mean of its prior 5 stored sessions
    res['c_crvol'] = contract_rvol(ev, days_all, tb_vol)
    # UW ask-side flow in the trade's direction in the last 15 minutes (observed; created_at)
    res['c_uw'] = uw_feature(ev, uw)
    return res


def pcoi_feature(ev: pd.DataFrame, oi_ratio: pd.Series) -> np.ndarray:
    """Put/call OI ratio (morning report) above the median of the prior 20 TRADING sessions (all 20 stored)."""
    S = ev.session.to_numpy()
    from edata.common import sessions_all
    cal = [int(d) for d in sessions_all()]
    if len(oi_ratio):
        span = [d for d in cal if oi_ratio.index.min() <= d <= oi_ratio.index.max()]
        oc = oi_ratio.reindex(span)                    # calendar-indexed: a missing session stays missing
    else:
        oc = oi_ratio
    med = oc.shift(1).rolling(20, min_periods=20).median()   # all 20 prior trading sessions must be stored
    cur = oi_ratio.reindex(S).to_numpy()
    mdv = med.reindex(S).to_numpy()
    return np.where(np.isfinite(cur) & np.isfinite(mdv), (cur > mdv).astype(float), np.nan)


DEC_POS = {m: i for i, m in enumerate(DEC_M)}


def contract_cum_volume(src: Source, ev: pd.DataFrame, days_all, cm: pd.DataFrame) -> dict:
    """{(D, ck): cumulative eligible print volume at each decision close (64,)} for every event contract-day and the
    5 stored sessions before it; a contract-day is present only if the contract was stored (quoted) that session."""
    idx = {d: i for i, d in enumerate(days_all)}
    cks = ckey(ev.exp, ev.strike, ev.right)
    need = {}
    for D, ck in set(zip(ev.session.astype(str), cks.tolist())):
        i = idx.get(D)
        if i is None:
            continue
        for k in range(0, 6):
            if i - k >= 0:
                need.setdefault(days_all[i - k], set()).add(int(ck))
    stored = set(zip(cm.session.astype(str).to_numpy(), ckey(cm.exp, cm.strike, cm.right).tolist()))
    dec = np.array(DEC_M)
    out = {}
    for D, want in need.items():
        for ck in want:
            if (D, ck) in stored:
                out[(D, ck)] = np.zeros(len(dec))
        t = src.tb(D)
        if not len(t):
            continue
        k = ckey(t.exp.to_numpy(), t.strike.to_numpy(), t.right.to_numpy())
        sel = np.isin(k, np.fromiter(want, np.int64))
        t, k = t[sel], k[sel]
        for ck in np.unique(k):
            if (D, int(ck)) not in out:
                continue
            g = t[k == ck]
            v = np.zeros(390)
            np.add.at(v, g.m.to_numpy().astype(int), g.v.to_numpy())
            out[(D, int(ck))] = np.cumsum(v)[dec]
    return out


def contract_rvol(ev, days_all, tb_vol: dict) -> np.ndarray:
    """today's cumulative print volume to the decision / mean of the same over the contract's 5 prior stored sessions
    (all five must exist); a zero base gives 1 (RVOL > 2) if today printed, else NaN."""
    out = np.full(len(ev), np.nan)
    idx = {d: i for i, d in enumerate(days_all)}
    cks = ckey(ev.exp, ev.strike, ev.right)
    for j, (D, ck, m) in enumerate(zip(ev.session.to_numpy(), cks, ev.m.to_numpy())):
        D = str(D)
        today = tb_vol.get((D, int(ck)))
        i = idx.get(D)
        if today is None or i is None or i < 5:
            continue
        prev = [tb_vol.get((days_all[i - k], int(ck))) for k in range(1, 6)]
        if any(p is None for p in prev):
            continue
        pm = DEC_POS[int(m)]
        base = np.mean([p[pm] for p in prev])
        v = today[pm]
        out[j] = (1.0 if v > 0 else np.nan) if base == 0 else float(v / base > 2)
    return out


def uw_feature(ev, uw: pd.DataFrame | None) -> np.ndarray:
    if uw is None or not len(uw):
        return np.full(len(ev), np.nan)
    side = ev.right.to_numpy()
    S, dm = ev.session.to_numpy(), ev.dec_ms.to_numpy()
    out = np.zeros(len(ev))
    for (D, r), g in uw.groupby(['session', 'right']):
        t = np.sort(g.ms.to_numpy())
        sel = (S == D) & (side == r)
        if not sel.any():
            continue
        hi = np.searchsorted(t, dm[sel], side='right')
        lo = np.searchsorted(t, dm[sel] - 15 * 60_000, side='right')
        out[sel] = (hi - lo > 0).astype(float)
    have = np.isin(S, uw.session.unique()) | np.isin(S, uw.attrs.get('sessions', []))
    return np.where(have, out, np.nan)


def load_uw(root: str, eval_days) -> pd.DataFrame | None:
    if root == 'SPXW':
        return None
    base = os.path.join(EMA_DATA, 'uw', root)
    rows, have = [], []
    for D in eval_days:
        p = os.path.join(base, f'{D}.parquet')
        if not os.path.exists(p):
            continue
        have.append(int(D))
        d = pd.read_parquet(p)
        if not len(d) or 'type' not in d:
            continue
        ca = pd.to_datetime(d.created_at, utc=True).dt.tz_convert('America/New_York')
        ask = pd.to_numeric(d.total_ask_side_prem, errors='coerce') > pd.to_numeric(d.total_bid_side_prem, errors='coerce')
        x = pd.DataFrame({'session': int(D), 'right': np.where(d.type.str.lower() == 'call', 1, -1),
                          'ms': ((ca.dt.hour * 60 + ca.dt.minute) * 60 + ca.dt.second) * 1000 + ca.dt.microsecond // 1000,
                          'day': ca.dt.strftime('%Y%m%d').astype(int)})
        x = x[ask.to_numpy() & (x.day == int(D))]
        rows.append(x)
    if not have:
        return None
    df = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame(columns=['session', 'right', 'ms'])
    df.attrs['sessions'] = have
    return df


def oi_ratio_series(root: str, days) -> pd.Series:
    out = {}
    for D in days:
        p = os.path.join(EMA_DATA, 'panel', root, 'oi', f'{D}.parquet')
        if not os.path.exists(p):
            continue
        o = pd.read_parquet(p)
        c, pu = o.oi[o.right == 1].sum(), o.oi[o.right == -1].sum()
        if c > 0:
            out[int(D)] = pu / c
    return pd.Series(out, dtype=float).sort_index()


# ----------------------------------------------------------------------------------------------- the builder
def build(root: str, block: str, src: Source | None = None, full: bool = True, log=print) -> pd.DataFrame:
    """full=False: S1A features + outcomes + states only (the synthetic null)."""
    src = src or Source(root)
    p = src.p
    plan = p.plan(block)
    have = set(p.days())
    ev_days = [D for D in plan['eval'] if D in have and split_of(D) in ('DEV', 'VALIDATION')]
    days_all = [D for D in plan['hist'] + plan['eval'] if D in have]
    t0 = time.time()
    u1 = src.und_m1(days_all)
    uclose = {int(D): g.set_index('m').c for D, g in u1.groupby('session')}
    # 1) events + outcomes
    evs = []
    for D in ev_days:
        u = uclose.get(int(D))
        if u is None:
            continue
        e = select_events(src, plan, D, u)
        if not len(e):
            continue
        keys = np.unique(ckey(e.exp, e.strike, e.right))
        B, A, BS, AS = day_grids(src.q0(D), keys)
        ci = np.searchsorted(keys, ckey(e.exp, e.strike, e.right))
        o = outcomes(e, root, B, A, BS, AS, ci, float(u.iloc[-1]))
        evs.append(e.assign(**o))
    ev = pd.concat(evs, ignore_index=True)
    ev.insert(0, 'root', root)
    ev.insert(1, 'block', block)
    keys = np.unique(ckey(ev.exp, ev.strike, ev.right))
    log(root, block, f'{len(ev)} events, {len(keys)} contracts, outcomes in {time.time()-t0:.0f}s')
    # 2) option MID features per timeframe
    cm = contract_minutes(src, days_all, keys)
    mts = {}
    for tf in TFS:
        mt = mid_tables(cm, tf)
        mts[tf] = mt
        ft = with_features(mt)
        j = asof_join(ev, ft, list(FEATURES) + ['state'], f'o{tf}_')
        for F in FEATURES:
            ev[f'f_{F}_{tf}'] = j[f'o{tf}_{F}'].to_numpy()
        ev[f'st_{tf}'] = j[f'o{tf}_state'].to_numpy()
        ev[f'kms_{tf}'] = j[f'o{tf}_kms'].to_numpy()
    log(root, block, f'MID features in {time.time()-t0:.0f}s')
    # 3) underlying states per timeframe (sign-aligned to the trade)
    ut = und_tf_tables(u1)
    for tf in TFS:
        i = asof_rows(ut[tf], ev.session, ev.dec_ms)
        st = np.where(i >= 0, ut[tf].state.to_numpy()[np.clip(i, 0, None)], np.nan)
        ev[f'ust_{tf}'] = st * ev.right.to_numpy()
    if not full:
        return ev
    # 4) theta / reprice control
    ivf = frozen_iv(cm, u1)
    for tf in TFS:
        rt = reprice_table(mts[tf], ivf, u1, tf)
        ft = with_features(rt)
        j = asof_join(ev, ft, list(FEATURES), f'p{tf}_')
        for F in FEATURES:
            ev[f'p_{F}_{tf}'] = j[f'p{tf}_{F}'].to_numpy()
    log(root, block, f'reprice control in {time.time()-t0:.0f}s')
    # 5) TRADE replication arm (density rule)
    qsess = cm[['exp', 'strike', 'right', 'session']].drop_duplicates()
    for tf in TFS:
        tt = trade_tables(src, days_all, keys, tf)
        dens = trade_density(ev, tt, qsess, tf, sorted(set(WARM_N.values())))
        if len(tt):
            ft = with_features(tt.assign(b=tt.b.astype(np.int16)))
            j = asof_join(ev, ft, list(FEATURES), f't{tf}_')
        for F in FEATURES:
            v = j[f't{tf}_{F}'].to_numpy() if len(tt) else np.full(len(ev), np.nan)
            ev[f't_{F}_{tf}'] = np.where(dens[WARM_N[F]] >= 0.8, v, np.nan)
        ev[f'tdens21_{tf}'] = dens[21]
    log(root, block, f'TRADE arm in {time.time()-t0:.0f}s')
    # 6) S1C confirmations
    from engine.underlying import Underlying
    U = Underlying(UND_SYM[root], days_all, vol_sym='SPY' if root == 'SPXW' else None, tfs=(5,))
    oi_days = sorted({d for d in os.listdir(os.path.join(EMA_DATA, 'panel', root, 'oi'))}) if os.path.isdir(
        os.path.join(EMA_DATA, 'panel', root, 'oi')) else []
    oir = oi_ratio_series(root, [d[:8] for d in oi_days if d[:8] <= ev_days[-1]])
    uw = load_uw(root, ev_days)
    tb_vol = contract_cum_volume(src, ev, days_all, cm)
    c = s1c_features(ev, root, src, U, days_all, ev_days, oir, uw, tb_vol)
    ev = pd.concat([ev, c], axis=1)
    log(root, block, f'S1C in {time.time()-t0:.0f}s')
    return ev


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--block', required=True)
    ap.add_argument('--roots', default='SPY,QQQ,IWM,SPXW')
    ap.add_argument('--patch-pcoi', action='store_true', help='recompute c_pcoi on stored event files only')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if a.patch_pcoi:
        for root in a.roots.split(','):
            p = os.path.join(OUT, f'events_{a.block}_{root}.parquet')
            ev = pd.read_parquet(p)
            od = os.path.join(EMA_DATA, 'panel', root, 'oi')
            ev['c_pcoi'] = pcoi_feature(ev, oi_ratio_series(root, sorted(d[:8] for d in os.listdir(od))))
            ev.to_parquet(p + '.tmp')
            os.replace(p + '.tmp', p)
            print(root, a.block, 'c_pcoi coverage', float(ev.c_pcoi.notna().mean()), flush=True)
        return
    for root in a.roots.split(','):
        ev = build(root, a.block, log=lambda *x: print(*x, flush=True))
        ev.to_parquet(os.path.join(OUT, f'events_{a.block}_{root}.parquet'))
        print(root, a.block, 'written', len(ev), flush=True)


if __name__ == '__main__':
    main()
