"""D3 EARNINGS-STRADDLE (PREREG amendment A3 @ 997f8ce). Long premium only.

    python3 d3.py fetch      # UW calendar + ThetaData quotes (sequential: <= 1 terminal request in flight)
    python3 d3.py eval       # results/D3_{DEV,VALIDATION}.json

Per event (postmarket report on day D) and per control (same name, D - 14 calendar days):
  stock NBBO 1m on D (rows <= 15:55:00 only -> strike) and on the next session N (09:35, 10:00, 15:55 marks);
  ATM call + put of the first expiration > D: 1-s NBBO 15:55:00-15:55:10 on D (fill at the ask in force 15:55:02) and
  1-s windows at 09:35, 10:00, 15:55 on N (sell at the bid in force at +2 s). Cents, ms of day.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import FOUND  # noqa: E402
sys.path.insert(0, FOUND)
from data.clients import uw_get  # noqa: E402
from data.splits import split_of  # noqa: E402
from eval.metrics import cluster_ci_mean  # noqa: E402
from fetch_events import csv, ms_of, clock  # noqa: E402

OUT = '/home/user/falcon-cloud-field-sail/v2data/edge-d/d3'
NAMES = 'AAPL MSFT AMZN GOOGL META NVDA TSLA NFLX AMD INTC CRM ADBE ORCL QCOM MU'.split()
FEE = 0.65
EXITS = {'Y1': '09:35:00', 'Y2': '10:00:00', 'Y3': '15:55:00'}


class LaterQuoteRead(Exception):
    pass


def ymd(d):
    return d.strftime('%Y%m%d')


def calendar():
    p = os.path.join(OUT, 'calendar.csv')
    if os.path.exists(p):
        return pd.read_csv(p, dtype=str)
    rows = []
    for t in NAMES:
        r = uw_get(f'/api/earnings/{t}')
        for x in (r.get('data', r) if isinstance(r, dict) else r):
            rd = (x.get('report_date') or '').replace('-', '')
            if '20220101' <= rd <= '20251231':
                rows.append((t, rd, x.get('report_time')))
    df = pd.DataFrame(rows, columns=['ticker', 'date', 'report_time']).drop_duplicates()
    df.to_csv(p, index=False)
    return df


_exps = {}


def expirations(t):
    if t not in _exps:
        df = csv('/option/list/expirations', {'symbol': t})
        _exps[t] = sorted(df.expiration.astype(str).str.replace('-', '').tolist()) if df is not None else []
    return _exps[t]


def stock_1m(t, D, a, b):
    q = csv('/stock/history/quote', {'symbol': t, 'date': D, 'interval': '1m', 'start_time': a, 'end_time': b})
    if q is None:
        return None
    return pd.DataFrame({'ms': ms_of(q.timestamp), 'bid': q.bid.values, 'ask': q.ask.values})


def leg_1s(t, exp, k, right, D, a, b):
    try:
        q = csv('/option/history/quote', {'symbol': t, 'expiration': exp, 'strike': f'{k:g}', 'right': right, 'date': D,
                                          'interval': '1s', 'start_time': a, 'end_time': b})
    except RuntimeError as e:         # 472 no data for this contract/window = no quote (no trade at entry)
        if '472' not in str(e):
            raise
        q = None
    if q is None:
        return None
    return pd.DataFrame({'ms': ms_of(q.timestamp), 'bid': np.round(q.bid.values * 100).astype(int),
                         'ask': np.round(q.ask.values * 100).astype(int), 'bs': q.bid_size.values, 'as': q.ask_size.values})


def asof(df, t, decision=None):
    """Row in force at t (stamped <= t). decision: the decision clock; reading a row stamped later raises."""
    r = df[df.ms <= t]
    if r.empty:
        return None
    row = r.iloc[-1]
    if decision is not None and row.ms > decision:
        raise LaterQuoteRead(f'{row.ms} > {decision}')
    return row


def next_session(t, D):
    d = dt.date(int(D[:4]), int(D[4:6]), int(D[6:]))
    for i in range(1, 6):
        n = d + dt.timedelta(days=i)
        if n.weekday() >= 5:
            continue
        try:
            s = stock_1m(t, ymd(n), '09:30:00', '09:31:00')
        except RuntimeError:          # 472 no data: market holiday (e.g. Good Friday)
            s = None
        if s is not None and len(s) and (s.bid > 0).any():
            return ymd(n)
    return None


def one(t, D, kind):
    key = f'{t}_{D}_{kind}'
    p = os.path.join(OUT, key + '.json')
    if os.path.exists(p):
        return json.load(open(p))
    res = {'ticker': t, 'date': D, 'kind': kind, 'status': 'ok'}
    try:
        exp = next((e for e in expirations(t) if e > D), None)
        N = next_session(t, D)
        if exp is None or N is None:
            res['status'] = 'noexp_or_nosession'
            raise StopIteration
        res.update(exp=exp, next=N)
        dec = clock('15:55:00')
        s0 = stock_1m(t, D, '15:50:00', '15:55:00')
        if s0 is None:
            res['status'] = 'nostock'
            raise StopIteration
        r0 = asof(s0, dec, decision=dec)
        S0 = (r0.bid + r0.ask) / 2
        sk = csv('/option/list/strikes', {'symbol': t, 'expiration': exp})
        ks = np.array(sorted(sk.strike.astype(float).unique()))
        K = float(ks[np.argmin(np.abs(ks - S0))])
        res.update(S0=S0, K=K)
        legs = {}
        for right in ('call', 'put'):
            q = leg_1s(t, exp, K, right, D, '15:55:00', '15:55:10')
            f = asof(q, dec + 2000) if q is not None else None
            if f is None or f.ask <= 0 or f.bid <= 0:
                res['status'] = 'noquote_entry'
                raise StopIteration
            legs[right] = {'entry_bid': int(f.bid), 'entry_ask': int(f.ask), 'entry_as': int(f['as'])}
        sN = stock_1m(t, N, '09:30:00', '15:56:00')
        for v, c in EXITS.items():
            tm = clock(c)
            rs = asof(sN, tm) if sN is not None else None
            res[f'S_{v}'] = float((rs.bid + rs.ask) / 2) if rs is not None else None
            for right in ('call', 'put'):
                q = leg_1s(t, exp, K, right, N, c, c[:6] + '10')
                x = asof(q, tm + 2000) if q is not None else None
                legs[right][f'bid_{v}'] = int(x.bid) if x is not None else None
        res['legs'] = legs
    except StopIteration:
        pass
    except Exception as e:  # noqa
        res['status'] = f'err {e!r}'[:200]
    json.dump(res, open(p, 'w'), default=float)
    return res


def plan():
    cal = calendar()
    ev = cal[cal.report_time == 'postmarket']
    rows = []
    for r in ev.itertuples():
        sp = split_of(r.date)
        if sp not in ('DEV', 'VALIDATION'):
            continue
        rows.append((r.ticker, r.date, 'event', sp))
        d = dt.date(int(r.date[:4]), int(r.date[4:6]), int(r.date[6:])) - dt.timedelta(days=14)
        while d.weekday() >= 5:
            d -= dt.timedelta(days=1)
        c = ymd(d)
        near = cal[(cal.ticker == r.ticker)].date.map(lambda x: abs((pd.Timestamp(x) - pd.Timestamp(c)).days) <= 3).any()
        if not near and split_of(c) == sp:
            rows.append((r.ticker, c, 'control', sp))
    return pd.DataFrame(rows, columns=['ticker', 'date', 'kind', 'split'])


def fetch():
    os.makedirs(OUT, exist_ok=True)
    pl = plan()
    print(pl.groupby(['split', 'kind']).size().to_dict(), flush=True)
    for i, r in enumerate(pl.itertuples()):
        x = one(r.ticker, r.date, r.kind)
        if i % 20 == 0:
            print(i, r.ticker, r.date, r.kind, x['status'], flush=True)


def trades():
    pl = plan()
    out = []
    for r in pl.itertuples():
        p = os.path.join(OUT, f'{r.ticker}_{r.date}_{r.kind}.json')
        if not os.path.exists(p):
            continue
        x = json.load(open(p))
        if x['status'] != 'ok':
            continue
        if split_of(x['next']) != r.split:
            continue
        L = x['legs']
        c, pu = L['call'], L['put']
        mid = (c['entry_bid'] + c['entry_ask'] + pu['entry_bid'] + pu['entry_ask']) / 200
        spread_ok = all((l['entry_ask'] - l['entry_bid']) <= 0.08 * (l['entry_ask'] + l['entry_bid']) / 2 for l in (c, pu))
        size_ok = min(c['entry_as'], pu['entry_as']) >= 1
        ask = (c['entry_ask'] + pu['entry_ask']) / 100
        for v in EXITS:
            if c.get(f'bid_{v}') is None or pu.get(f'bid_{v}') is None:
                continue
            bid = (c[f'bid_{v}'] + pu[f'bid_{v}']) / 100
            gross = (bid - ask) / ask
            net = ((bid - ask) * 100 - 4 * FEE) / (ask * 100)
            out.append({'ticker': r.ticker, 'session': x['date'], 'kind': r.kind, 'split': r.split, 'variant': v,
                        'ret_gross': gross, 'ret_net': net, 'spread_ok': spread_ok and size_ok,
                        'implied_frac': mid / x['S0'],
                        'real_over_impl': abs((x.get(f'S_{v}') or np.nan) - x['S0']) / mid, 'exp': x['exp'], 'next': x['next']})
    return pd.DataFrame(out)


def evaluate():
    tr = trades()
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    tr.to_csv(os.path.join(HERE, 'results', 'D3_trades.csv'), index=False)
    for sp in ('DEV', 'VALIDATION'):
        res = {'family': 'D3', 'split': sp}
        for kind in ('event', 'control'):
            for v in EXITS:
                x = tr[(tr.split == sp) & (tr.kind == kind) & (tr.variant == v) & tr.spread_ok]
                allx = tr[(tr.split == sp) & (tr.kind == kind) & (tr.variant == v)]
                if len(x) == 0:
                    res[f'{v}_{kind}'] = {'n': 0, 'n_before_spread_filter': int(len(allx))}
                    continue
                ci = cluster_ci_mean(x.ret_net.to_numpy(float), x.session.astype(str).to_numpy(), 4000)
                cw = cluster_ci_mean((x.ret_net > 0).astype(float).to_numpy(), x.session.astype(str).to_numpy(), 2000)
                res[f'{v}_{kind}'] = {'n': int(len(x)), 'n_before_spread_filter': int(len(allx)), 'n_names': int(x.ticker.nunique()),
                                      'expectancy': float(x.ret_net.mean()), 'ci_expectancy': ci, 'gross': float(x.ret_gross.mean()),
                                      'win_rate': float((x.ret_net > 0).mean()), 'ci_win': cw, 'median': float(x.ret_net.median()),
                                      'real_over_impl_median': float(x.real_over_impl.median()),
                                      'implied_frac_median': float(x.implied_frac.median()),
                                      'by_year': {y: [int(len(g)), float(g.ret_net.mean())] for y, g in x.groupby(x.session.str[:4])}}
        json.dump(res, open(os.path.join(HERE, 'results', f'D3_{sp}.json'), 'w'), indent=1, default=float)
        print(sp, json.dumps({k: {kk: v[kk] for kk in ('n', 'n_before_spread_filter', 'expectancy', 'ci_expectancy', 'win_rate', 'real_over_impl_median') if kk in v}
                               for k, v in res.items() if isinstance(v, dict)}, default=float))


if __name__ == '__main__':
    {'fetch': fetch, 'eval': evaluate}[sys.argv[1]]()
