"""Warm-up feasibility tables from the coverage study (edata/coverage.py) -> markdown on stdout.

    python3 -m edata.coverage_report > /tmp/x.md

As-of point: the sampled session D at 10:30 ET (bars ending <= 10:30 of D plus the stored history).
MID bars: a tf bar exists when the 1-minute snapshot at its end is two-sided. Two-sided quote minutes were measured
for the last <= 27 calendar days (one request per contract); for earlier listed sessions the contract's measured
two-sided share is applied (stated as an estimate; listed = the terminal's quote-date list).
TRADE bars: a tf bar exists when at least one SIP-eligible print fell in it (all sessions measured).
Warm (primary) = bars >= N; strict = bars >= 2N.  Cell verdicts: TESTABLE >= 80% of sampled contracts warm,
PARTIAL 20-80%, UNTESTABLE < 20%.
"""
from __future__ import annotations

import glob
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA  # noqa: E402

TFS = (1, 5, 15, 30, 60)
NS = (5, 9, 15, 20, 21, 50, 100, 200)
ASOF_M = 60          # bars ending <= 10:30 -> minutes 0..59 of D
BUCKET_ORDER = ['0', '1-7', '8-30', '31-90', '91+']


def bits(b: bytes) -> np.ndarray:
    if not b:
        return np.zeros(390, bool)
    return np.unpackbits(np.frombuffer(b, np.uint8))[:390].astype(bool)


def tf_bar_flags(mask: np.ndarray, tf: int, end_only: bool) -> np.ndarray:
    """Per tf bar of a session: exists? TRADE: any print inside; MID: valid snapshot at the end minute."""
    nb = -(-390 // tf)
    out = np.zeros(nb, bool)
    for b in range(nb):
        a, e = b * tf, min((b + 1) * tf, 390)
        out[b] = mask[e - 1] if end_only else mask[a:e].any()
    return out


def contract_counts(g: pd.DataFrame) -> dict:
    """g: rows of one contract (one per stored day, the sampled session last)."""
    D = int(g.session.iloc[0])
    g = g.sort_values('day')
    hist, today = g[g.day < D], g[g.day == D]
    meas = g[g.n_quote_min >= 0]
    qfrac = float(meas.n_quote_min.sum() / (390 * len(meas))) if len(meas) else np.nan
    res = {'life_sessions': len(hist), 'qfrac': qfrac}
    last5 = hist.tail(5)
    res['trade_min_per_day_last5'] = float(last5.n_trade_min.mean()) if len(last5) else 0.0
    tmask_today = bits(today.trade_mask.iloc[0]) if len(today) else np.zeros(390, bool)
    res['trade_empty_share_today_to_1030'] = 1 - float(tmask_today[:ASOF_M].mean())
    res['trade_empty_share_last5'] = 1 - float(last5.n_trade_min.sum() / (390 * max(len(last5), 1)))
    for tf in TFS:
        nb_day = -(-390 // tf)
        tr_flags = [tf_bar_flags(bits(r.trade_mask), tf, False) for r in hist.itertuples()]
        cut = ASOF_M // tf
        tt = tf_bar_flags(tmask_today, tf, False)[:cut]
        trade_seq = np.concatenate(tr_flags + [tt]) if tr_flags else tt
        res[f'trade_bars_{tf}'] = int(trade_seq.sum())
        # MID: measured days exact, unmeasured listed days estimated at the contract's measured share
        mid = 0.0
        for r in hist.itertuples():
            if r.n_quote_min >= 0:
                mid += tf_bar_flags(bits(r.quote_mask), tf, True).sum()
            else:
                mid += nb_day * (qfrac if qfrac == qfrac else 1.0)
        if len(today):
            qm = bits(today.quote_mask.iloc[0]) if today.n_quote_min.iloc[0] >= 0 else np.ones(390, bool)
            mid += tf_bar_flags(qm, tf, True)[:cut].sum()
        res[f'mid_bars_{tf}'] = float(mid)
        # trade density over the last 2N wall-clock tf bars (TRADE-eligibility rule, STRATEGY_SPEC section 3)
        for n in (21, 50, 200):
            w = trade_seq[-2 * n:] if len(trade_seq) >= 2 * n else None
            res[f'dense_{tf}_{n}'] = bool(w is not None and w.mean() >= 0.8)
            # wall-clock span (sessions) of the last N trade bars
        idx = np.flatnonzero(trade_seq)
        for n in (21, 200):
            res[f'trade_span_sessions_{tf}_{n}'] = ((len(trade_seq) - idx[-n]) / nb_day) if len(idx) >= n else np.nan
    return res


def load() -> pd.DataFrame:
    fs = sorted(glob.glob(os.path.join(EMA_DATA, 'coverage', '*.parquet')))
    df = pd.concat([pd.read_parquet(f) for f in fs], ignore_index=True)
    return df[df.bucket != 'none']


def per_contract(df: pd.DataFrame) -> pd.DataFrame:
    keys = ['root', 'session', 'bucket', 'exp', 'strike', 'right', 'target_delta']
    rows = []
    for k, g in df.groupby(keys, sort=False):
        r = dict(zip(keys, k))
        r.update({'dte': int(g.dte.iloc[0]), 'hist_sessions': int(g.hist_sessions.iloc[0]),
                  'first_quote': g.first_quote.iloc[0], 'first_trade': g.first_trade.iloc[0]})
        r.update(contract_counts(g))
        rows.append(r)
    return pd.DataFrame(rows)


def verdict(p: float) -> str:
    return 'T' if p >= 0.8 else ('P' if p >= 0.2 else 'U')


def md_grid(pc: pd.DataFrame, series: str, mult: float) -> str:
    lines = []
    head = '| bucket | TF | ' + ' | '.join(f'EMA{n}' for n in NS) + ' |'
    lines += [head, '|' + '---|' * (len(NS) + 2)]
    for b in BUCKET_ORDER:
        x = pc[pc.bucket == b]
        if not len(x):
            continue
        for tf in TFS:
            cells = []
            for n in NS:
                p = float((x[f'{series}_bars_{tf}'] >= mult * n).mean())
                cells.append(f'{verdict(p)} {100 * p:.0f}%')
            lines.append(f'| {b} (n={len(x)}) | {tf}m | ' + ' | '.join(cells) + ' |')
    return '\n'.join(lines)


def main():
    df = load()
    pc = per_contract(df)
    pc.to_parquet(os.path.join(EMA_DATA, 'coverage_per_contract.parquet'))
    print(f'# coverage tables ({len(pc)} contracts, {pc.session.nunique()} sessions, roots {sorted(pc.root.unique())})\n')
    print('## life and print density (medians)\n')
    t = pc.groupby(['root', 'bucket']).agg(n=('strike', 'size'), dte=('dte', 'median'), life=('life_sessions', 'median'),
                                          qfrac=('qfrac', 'median'), tmin=('trade_min_per_day_last5', 'median'),
                                          empty5=('trade_empty_share_last5', 'median'),
                                          empty_today=('trade_empty_share_today_to_1030', 'median')).reset_index()
    t['bucket'] = pd.Categorical(t.bucket, BUCKET_ORDER, ordered=True)
    t = t.sort_values(['root', 'bucket'])
    print('| root | bucket | n | DTE | stored life (sessions, cap 62) | 2-sided quote share | trade minutes/day (last 5) | empty 1m trade bars (last 5) | empty 1m trade bars (D to 10:30) |')
    print('|---|---|---|---|---|---|---|---|---|')
    for r in t.itertuples():
        print(f'| {r.root} | {r.bucket} | {r.n} | {r.dte:.0f} | {r.life:.0f} | {100 * r.qfrac:.1f}% | {r.tmin:.0f} | {100 * r.empty5:.0f}% | {100 * r.empty_today:.0f}% |')
    for series, lab in (('mid', 'MID (NBBO mid at bar end)'), ('trade', 'TRADE (non-empty print bars)')):
        for mult, ml in ((1, 'primary: bars >= N'), (2, 'strict: bars >= 2N')):
            print(f'\n## warm at D 10:30 -- {lab}, {ml} (all roots pooled; T >= 80%, P 20-80%, U < 20%)\n')
            print(md_grid(pc, series, mult))
    print('\n## per root: share warm, MID primary, selected cells\n')
    print('| root | bucket | 1m EMA200 | 5m EMA200 | 15m EMA50 | 15m EMA200 | 30m EMA200 | 60m EMA50 | 60m EMA200 | 60m EMA200 strict |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for (root, b), x in pc.groupby(['root', 'bucket']):
        f = lambda s, tf, n, m=1: f"{100 * float((x[f'{s}_bars_{tf}'] >= m * n).mean()):.0f}%"
        print(f"| {root} | {b} | {f('mid',1,200)} | {f('mid',5,200)} | {f('mid',15,50)} | {f('mid',15,200)} | {f('mid',30,200)} | {f('mid',60,50)} | {f('mid',60,200)} | {f('mid',60,200,2)} |")
    print('\n## per root: share warm, TRADE primary, selected cells\n')
    print('| root | bucket | 1m EMA21 | 1m EMA200 | 5m EMA21 | 5m EMA200 | 15m EMA50 | 60m EMA21 | 60m EMA200 | dense 5m (2x21 bars) | dense 1m (2x21) | median span of last 21 1m prints (sessions) |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (root, b), x in pc.groupby(['root', 'bucket']):
        f = lambda s, tf, n: f"{100 * float((x[f'{s}_bars_{tf}'] >= n).mean()):.0f}%"
        print(f"| {root} | {b} | {f('trade',1,21)} | {f('trade',1,200)} | {f('trade',5,21)} | {f('trade',5,200)} | {f('trade',15,50)} | {f('trade',60,21)} | {f('trade',60,200)} | "
              f"{100 * x['dense_5_21'].mean():.0f}% | {100 * x['dense_1_21'].mean():.0f}% | {x['trade_span_sessions_1_21'].median():.2f} |")
    print('\n## LOCKED-truncated history (2022-11-17: history starts 2022-10-03)\n')
    x = pc[pc.session == '20221117']
    if len(x):
        print(f"hist sessions available: {sorted(x.hist_sessions.unique())}; 60m EMA200 MID warm: {100 * float((x.mid_bars_60 >= 200).mean()):.0f}%")


if __name__ == '__main__':
    main()
