"""GEX / DEX / vanna / charm positioning book, keeping OBSERVED facts apart from INFERRED dealer hedging.

Definitions are Pinpoint's (slayer/src/data/book/scale.ts, slayer/src/core/dealerSign.ts, slayer/src/data/liveHigher.ts,
slayer/src/core/settle.ts), restated in dealer sign (positive = dealers long the greek):
  dealer side      +1 per call contract of open interest, -1 per put (the one model: dealers long calls, short puts)
  GEX  ($ per 1%)  side x gamma x OI x 100 x S^2 x 0.01
  DEX  ($ delta)   side x delta x OI x 100 x S
  vanna ($delta per vol point)  side x vanna x S x OI        (vanna per 1.00 vol x 0.01 x 100 shares x S)
  charm ($delta per session)    side x (charm / 252) x 100 x S x OI
  SPX: the AM monthly root (SPX) counts until 09:30 ET of its date, then it is gone; adjusted roots are never counted.
Clock: calendar years to 16:00 ET (PM) or 09:30 ET (AM) of the expiration date with a 60-minute floor, the vendor's
IV (option/history/greeks/first_order, the terminal's calendar-clock solve). Gamma depends on sigma*sqrt(T) only, so a
calendar-clock IV on the calendar clock gives the same gamma as Pinpoint's trading-clock pair (variance kept).

OBSERVED (measured, no model): open interest by strike/expiry/right (prior close), call/put OI near spot, put/call
OI ratio, the IV surface the vendor solved. INFERRED (needs the dealer-side assumption): every dealer-signed exposure,
the gamma flip, the walls, and the hedge-flow estimates (hedge_1pct = -net GEX: what dealers must trade per +1% move
to stay flat; charm_flow_to_close = net charm x share of the session left). Strategies that use positioning are
tested on both kinds separately (specs/PREREG.md).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.bs import greeks, years_to_pm_expiry

FLIP_GRID = np.linspace(0.95, 1.05, 101)


def _years(session, ms, exp, am: np.ndarray):
    t_pm = years_to_pm_expiry(session, ms, exp)
    # AM: to 09:30 of the date = 6.5 h less than to 16:00
    t_am = np.maximum(t_pm - 390 / (365 * 1440), 60 / (365 * 1440))
    return np.where(am, t_am, t_pm)


def book(chain: pd.DataFrame, spot: float, session: int, ms: int) -> tuple[dict, pd.DataFrame]:
    """chain: exp, strike (x1000), right (+1/-1), oi, iv, am (bool). Returns (aggregates, per-strike profile)."""
    c = chain[(chain.oi > 0) & (chain.iv > 0) & np.isfinite(chain.iv)].copy()
    agg = {'session': int(session), 'ms': int(ms), 'spot': float(spot)}
    if not len(c) or not spot > 0:
        return agg, pd.DataFrame()
    K = c.strike.to_numpy() / 1000
    T = _years(session, ms, c.exp.to_numpy(), c.am.to_numpy(bool))
    call = c.right.to_numpy() == 1
    g = greeks(spot, K, T, c.iv.to_numpy(), call)
    side = np.where(call, 1.0, -1.0)
    oi = c.oi.to_numpy(float)
    gex = side * g['gamma'] * oi * 100 * spot * spot * 0.01
    dex = side * g['delta'] * oi * 100 * spot
    vanna = side * g['vanna'] * spot * oi
    charm = side * (g['charm'] / 252) * 100 * spot * oi
    c = c.assign(gex=gex, dex=dex, vanna=vanna, charm=charm, dte=(pd.to_datetime(c.exp.astype(str)) - pd.Timestamp(str(session))).dt.days)
    near = np.abs(K / spot - 1) <= 0.05
    # ---- observed
    agg.update({
        'obs_call_oi': float(oi[call].sum()), 'obs_put_oi': float(oi[~call].sum()),
        'obs_pc_oi_ratio': float(oi[~call].sum() / max(oi[call].sum(), 1)),
        'obs_call_oi_near': float(oi[call & near].sum()), 'obs_put_oi_near': float(oi[~call & near].sum()),
        'obs_atm_iv': float(np.nanmedian(c.iv.to_numpy()[np.abs(K / spot - 1) <= 0.01])) if (np.abs(K / spot - 1) <= 0.01).any() else np.nan,
    })
    # ---- inferred (dealer model)
    for lab, msk in (('all', np.ones(len(c), bool)), ('0dte', c.dte.to_numpy() == 0), ('le7', c.dte.to_numpy() <= 7)):
        agg[f'inf_net_gex_{lab}'] = float(gex[msk].sum())
        agg[f'inf_call_gex_{lab}'] = float(gex[msk & call].sum())
        agg[f'inf_put_gex_{lab}'] = float(gex[msk & ~call].sum())
    agg['inf_net_dex'] = float(dex.sum())
    agg['inf_net_vanna'] = float(vanna.sum())
    agg['inf_net_charm'] = float(charm.sum())
    agg['inf_abs_gex'] = float(np.abs(gex).sum())
    agg['inf_hedge_1pct'] = -agg['inf_net_gex_all']
    left = max(0.0, (16 * 60 - ms / 60000) / 390)
    agg['inf_charm_flow_to_close'] = agg['inf_net_charm'] * left
    prof = c.groupby('strike').agg(gex=('gex', 'sum'), call_gex=('gex', lambda x: x[c.loc[x.index, 'right'] == 1].sum()),
                                   put_gex=('gex', lambda x: x[c.loc[x.index, 'right'] == -1].sum()), oi=('oi', 'sum')).reset_index()
    ks = prof.strike.to_numpy() / 1000
    above, below = ks >= spot, ks <= spot
    agg['inf_call_wall'] = float(ks[above][np.argmax(prof.call_gex.to_numpy()[above])]) if above.any() else np.nan
    agg['inf_put_wall'] = float(ks[below][np.argmin(prof.put_gex.to_numpy()[below])]) if below.any() else np.nan
    agg['inf_gamma_flip'] = gamma_flip(c, spot, session, ms)
    prof = prof[np.abs(ks / spot - 1) <= 0.05].assign(session=int(session), ms=int(ms))
    return agg, prof


def gamma_flip(c: pd.DataFrame, spot: float, session: int, ms: int) -> float:
    """Spot level where the re-priced net dealer GEX changes sign, nearest to spot within +-5% (NaN if none)."""
    K = c.strike.to_numpy() / 1000
    T = _years(session, ms, c.exp.to_numpy(), c.am.to_numpy(bool))
    call = c.right.to_numpy() == 1
    side = np.where(call, 1.0, -1.0)
    oi = c.oi.to_numpy(float)
    iv = c.iv.to_numpy()
    tot = []
    for f in FLIP_GRID:
        S = spot * f
        g = greeks(S, K, T, iv, call)['gamma']
        tot.append(float((side * g * oi).sum() * S * S))
    tot = np.array(tot)
    sgn = np.sign(tot)
    idx = np.flatnonzero(sgn[1:] != sgn[:-1])
    if not len(idx):
        return np.nan
    xs = []
    for i in idx:
        a, b = tot[i], tot[i + 1]
        w = a / (a - b) if a != b else 0.5
        xs.append(spot * (FLIP_GRID[i] + w * (FLIP_GRID[i + 1] - FLIP_GRID[i])))
    xs = np.array(xs)
    return float(xs[np.argmin(np.abs(xs - spot))])


def chain_from_greeks_csv(g: pd.DataFrame, oi: pd.DataFrame, am: bool) -> pd.DataFrame:
    from edata.common import ms_of_day, right_code
    df = pd.DataFrame({'exp': g.expiration.astype(str).str.replace('-', '').astype('int32'),
                       'strike': np.round(g.strike.values * 1000).astype('int32'), 'right': right_code(g.right),
                       'ms': ms_of_day(g.timestamp), 'iv': g.implied_vol.astype(float), 'und': g.underlying_price.astype(float)})
    df = df.merge(oi, on=['exp', 'strike', 'right'], how='inner')
    df['am'] = am
    return df


def book_from_terminal(root: str, D: str, oi: pd.DataFrame, interval: str = '30m'):
    """Fetch the whole chain's vendor IVs every `interval` and build the book at each snapshot (eval sessions)."""
    from edata.common import csv, guard, NoData
    guard(D)
    parts = []
    g = csv('/option/history/greeks/first_order', {'symbol': root, 'expiration': '*', 'strike': '*', 'right': 'both',
                                                   'date': D, 'interval': interval}, timeout=900)
    parts.append(chain_from_greeks_csv(g, oi, am=False))
    if root == 'SPXW':
        try:
            from edata.panel import get_oi
            oi_am = get_oi('SPX', D)
            ga = csv('/option/history/greeks/first_order', {'symbol': 'SPX', 'expiration': '*', 'strike': '*', 'right': 'both',
                                                            'date': D, 'interval': interval}, timeout=900)
            am = chain_from_greeks_csv(ga, oi_am, am=True)
            am = am[am.exp > int(D)]          # an AM contract dated D settled at 09:30 (gone); before D it counts
            parts.append(am)
        except NoData:
            pass
    ch = pd.concat(parts, ignore_index=True)
    aggs, profs = [], []
    for ms, x in ch.groupby('ms'):
        if ms < 9 * 3_600_000 + 30 * 60_000 + 1 or ms > 16 * 3_600_000:
            continue
        S = float(np.nanmedian(x.und[x.und > 0])) if (x.und > 0).any() else np.nan
        a, p = book(x, S, int(D), int(ms))
        aggs.append(a)
        if len(p):
            profs.append(p)
    if not aggs:
        return None, None
    return pd.DataFrame(aggs), (pd.concat(profs, ignore_index=True) if profs else pd.DataFrame())
