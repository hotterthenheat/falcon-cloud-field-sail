"""Stage 3 sensitivity and ablation (PREREG section 6) for one Stage-2 variant, on the same data and simulator.

Sensitivity (each is one look):
  lat_L0 / lat_L60        0 s / 60 s latency
  slip1                   +1 tick against us on both sides
  fee065 / fee165         SPXW fee $0.65 / $1.65 per contract per side (ETFs unchanged)
  delta030 / delta050     |delta| target 0.30 / 0.50 (band unchanged)
  ema_<f>_<s>             entry EMA lengths one step either side in the brief's list (9 -> 5/15, 21 -> 20/50)
  exit_ema<n>             exit-3 EMA one step either side (9 -> 5/15), for variants whose exit is 3
  strict                  warm-up 2N (seen >= 2 x the longest entry EMA)
  trade                   entry trigger on the TRADE chart where dense (exits still read MID: STRATEGY_SPEC section 3)
Survival rule: expectancy > 0 at slip1 and at lat_L60, and > 0 in >= 70% of the parameter neighbours (delta, EMA,
exit EMA, strict, trade).
Ablation: remove one component at a time (each timeframe of the MTF set, the VWAP leg, the GEX leg, the underlying
confirmation, the option-chart trigger -> the underlying-only version); paired session-clustered difference.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from stage2.sim import Cfg
from stage2.variants import pick_entries, trigger_mask

NEIGHBOURS = {9: (5, 15), 21: (20, 50), 20: (15, 21), 50: (21, 100)}


def _cross(t5: pd.DataFrame, f: int, s: int, strict: bool = False) -> np.ndarray:
    k = t5[['exp', 'strike', 'right']].to_numpy()
    first = np.r_[True, (k[1:] != k[:-1]).any(1)]
    ef, es = t5[f'ema{f}'].to_numpy(), t5[f'ema{s}'].to_numpy()
    pf, ps = np.r_[np.nan, ef[:-1]], np.r_[np.nan, es[:-1]]
    pf[first], ps[first] = np.nan, np.nan
    seen = pd.Series(np.ones(len(t5))).groupby(np.cumsum(first)).cumsum().to_numpy()   # MID bars are all valid closes
    need = (2 if strict else 1) * max(f, s)
    return (pf <= ps) & (ef > es) & (seen >= need)


def cross_on_candidates(data, f: int, s: int, strict=False) -> np.ndarray:
    """Model B with lengths (f, s) on the 5m MID chart, at the bar that closed at each candidate's decision."""
    from stage1.features import asof_join
    t5 = data.t5
    x = t5[['exp', 'strike', 'right', 'session', 'known_ms']].assign(sX=_cross(t5, f, s, strict))
    j = asof_join(data.cand, x, ['sX'], '')
    fresh = j['kms'].to_numpy() == data.cand.session.to_numpy(np.int64) * 100_000_000 + data.cand.dec_ms.to_numpy(np.int64)
    return fresh & (j['sX'].to_numpy() == True)  # noqa: E712


def trade_cross_on_candidates(data, f=9, s=21) -> np.ndarray:
    """Model B on the 5m TRADE chart where the density rule holds (>= 80% of the last 2 x 21 wall-clock bars printed)."""
    from engine.bars import add_emas
    from stage1.events import trade_density
    from stage1.features import asof_join
    from stage2.tables import trade_ohlc
    tt = trade_ohlc(data.src, data.days, data.keys, 5)
    if not len(tt):
        return np.zeros(len(data.cand), bool)
    tt = add_emas(tt, (f, s))
    k = tt[['exp', 'strike', 'right']].to_numpy()
    first = np.r_[True, (k[1:] != k[:-1]).any(1)]
    ef, es = tt[f'ema{f}'].to_numpy(), tt[f'ema{s}'].to_numpy()
    pf, ps = np.r_[np.nan, ef[:-1]], np.r_[np.nan, es[:-1]]
    pf[first], ps[first] = np.nan, np.nan
    tt['sX'] = (pf <= ps) & (ef > es) & (tt[f'seen{s}'].to_numpy() >= s)
    j = asof_join(data.cand, tt, ['sX'], '')
    fresh = j['kms'].to_numpy() == data.cand.session.to_numpy(np.int64) * 100_000_000 + data.cand.dec_ms.to_numpy(np.int64)
    qsess = data.cm[['exp', 'strike', 'right', 'session']].drop_duplicates()
    dens = trade_density(data.cand, tt, qsess, 5, [21])[21]
    return fresh & (j['sX'].to_numpy() == True) & (dens >= 0.8)  # noqa: E712


def sensitivity_specs(v: dict) -> list[dict]:
    """The looks for variant v: (name, kind, settings)."""
    out = [{'name': 'lat_L0', 'cfg': {'latency': 'L0'}}, {'name': 'lat_L60', 'cfg': {'latency': 'L60'}},
           {'name': 'slip1', 'cfg': {'slip_ticks': 1}}, {'name': 'fee065', 'cfg': {'fee_spxw': 0.65}},
           {'name': 'fee165', 'cfg': {'fee_spxw': 1.65}}, {'name': 'delta030', 'target': 0.30, 'neighbour': True},
           {'name': 'delta050', 'target': 0.50, 'neighbour': True}]
    if v['entry'] in ('B', 'F', 'G'):
        for f2 in NEIGHBOURS[9]:
            out.append({'name': f'ema_{f2}_21', 'cross': (f2, 21), 'neighbour': True})
        for s2 in NEIGHBOURS[21]:
            out.append({'name': f'ema_9_{s2}', 'cross': (9, s2), 'neighbour': True})
        out.append({'name': 'strict', 'cross': (9, 21), 'strict': True, 'neighbour': True})
        out.append({'name': 'trade', 'trade': True, 'neighbour': True})
    if v['exit'] == 'X3':
        for n in NEIGHBOURS[9]:
            out.append({'name': f'exit_ema{n}', 'exit': f'X3e{n}', 'neighbour': True})
    return out


def run_look(R, v: dict, spec: dict) -> pd.DataFrame:
    cand = R.d.cand
    mask = trigger_mask(cand, v)
    if 'cross' in spec or spec.get('trade'):
        base_b = cand.sB.to_numpy(bool)
        new_b = trade_cross_on_candidates(R.d) if spec.get('trade') else cross_on_candidates(R.d, *spec['cross'], strict=spec.get('strict', False))
        # replace the B trigger inside the variant's rule: mask = rule(B) -> rule(B'), other legs unchanged
        cand2 = cand.assign(sB=new_b)
        mask = trigger_mask(cand2, v)
        del base_b
    ent = pick_entries(cand, mask, target=spec.get('target', 0.40))
    c = dict(spec.get('cfg', {}))
    fee = None
    if 'fee_spxw' in c:
        fee = c.pop('fee_spxw') if R.d.root == 'SPXW' else None
    cfg = Cfg(fee=fee, **c)
    ex = spec.get('exit', v['exit'])
    return pd.DataFrame(R.run_entries(ent, ex, f"{v['id']}|{spec['name']}", cfg=cfg))


def survival(base_exp: float, looks: dict) -> dict:
    nb = [k for k, s in looks.items() if s.get('neighbour')]
    pos = [k for k in nb if looks[k]['exp'] > 0]
    return {'slip1_gt_0': looks.get('slip1', {}).get('exp', -1) > 0, 'L60_gt_0': looks.get('lat_L60', {}).get('exp', -1) > 0,
            'neighbours_pos_share': len(pos) / len(nb) if nb else np.nan,
            'survives': looks.get('slip1', {}).get('exp', -1) > 0 and looks.get('lat_L60', {}).get('exp', -1) > 0 and
            (len(pos) / len(nb) >= 0.7 if nb else False)}


def ablations(v: dict) -> list[dict]:
    """One component removed at a time (PREREG section 6). Each returns a variant dict."""
    out = []
    if v.get('mtf'):
        from stage2.variants import MTF_SETS
        out.append({**v, 'mtf': None, 'id': v['id'] + '|no_mtf'})
    if v['entry'] == 'F':
        out.append({**v, 'entry': 'B', 'id': v['id'] + '|no_vwap'})
    if v['entry'] == 'G':
        out.append({**v, 'entry': 'B', 'id': v['id'] + '|no_gex'})
    if v['entry'] in ('B', 'F', 'G'):
        out.append({**v, 'entry': 'BL3', 'mtf': None, 'id': v['id'] + '|underlying_only'})
    return out
