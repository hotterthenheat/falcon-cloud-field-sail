"""Measure how far back each data type reaches on this key (terminal + UW). One request at a time.

    python3 -m data.depth  -> data/DEPTH.md

For each (route, symbol) it asks the terminal for the dates it has (list/dates where offered) and spot-checks the
earliest years with a tiny real request (one contract, one minute window) so 'listed' means 'answers'.
"""
from __future__ import annotations

import io
import os
import sys

import pandas as pd

from data.clients import NoData, theta_get, uw_get

HERE = os.path.dirname(os.path.abspath(__file__))


def ok(path, params):
    try:
        b = theta_get(path, params, timeout=120, retries=2)
        n = b.count(b'\n') - 1
        return f'yes ({n} rows)' if n > 0 else 'empty'
    except NoData:
        return 'no data'
    except Exception as e:  # noqa: BLE001
        return 'ERR ' + str(e)[:80]


def first_expiry_on_or_after(root, day):
    df = pd.read_csv(io.BytesIO(theta_get('/option/list/expirations', {'symbol': root})))
    e = sorted(df.expiration.astype(str).str.replace('-', ''))
    e = [x for x in e if x >= day]
    return e[0] if e else None


def atm_strike(root, exp, day):
    df = pd.read_csv(io.BytesIO(theta_get('/option/list/strikes', {'symbol': root, 'expiration': exp})))
    ks = sorted(df.strike.astype(float))
    return ks[len(ks) // 2]


def main():
    rows = []
    probe_days = {'SPXW': ['20120104', '20140106', '20160106', '20180103', '20200106', '20220103'],
                  'SPY': ['20120604', '20130102', '20140102', '20160104', '20200102'],
                  'QQQ': ['20120604', '20140102', '20160104', '20200102']}
    for root, days in probe_days.items():
        for d in days:
            try:
                e = first_expiry_on_or_after(root, d)
            except Exception as ex:  # noqa: BLE001
                rows.append({'data': 'option NBBO', 'symbol': root, 'date': d, 'answers': 'ERR ' + str(ex)[:60]})
                continue
            # the whole chain of the nearest expiry, 10:00-10:02: 'no data' then really means none that day
            base = {'symbol': root, 'expiration': e, 'strike': '*', 'right': 'both', 'date': d,
                    'start_time': '10:00:00', 'end_time': '10:02:00'}
            rows.append({'data': 'option NBBO tick', 'symbol': root, 'date': d,
                         'answers': ok('/option/history/quote', {**base, 'interval': 'tick'})})
            rows.append({'data': 'option trades (trade_quote)', 'symbol': root, 'date': d,
                         'answers': ok('/option/history/trade_quote', {k2: v for k2, v in base.items()})})
            rows.append({'data': 'option greeks 1m', 'symbol': root, 'date': d,
                         'answers': ok('/option/history/greeks/first_order', {**base, 'interval': '1m'})})
            rows.append({'data': 'option OI', 'symbol': root, 'date': d,
                         'answers': ok('/option/history/open_interest', {'symbol': root, 'expiration': e, 'date': d})})
    for sym, days in {'SPY': ['20120104', '20160105', '20180102', '20200102'], 'QQQ': ['20120104', '20160104']}.items():
        for d in days:
            rows.append({'data': 'stock NBBO tick', 'symbol': sym, 'date': d,
                         'answers': ok('/stock/history/quote', {'symbol': sym, 'date': d, 'interval': 'tick', 'start_time': '10:00:00', 'end_time': '10:00:05'})})
            rows.append({'data': 'stock trades', 'symbol': sym, 'date': d,
                         'answers': ok('/stock/history/trade', {'symbol': sym, 'date': d, 'start_time': '10:00:00', 'end_time': '10:00:05'})})
    for sym in ('SPY', 'QQQ'):
        for kind in ('quote', 'trade'):
            try:
                df = pd.read_csv(io.BytesIO(theta_get(f'/stock/list/dates/{kind}', {'symbol': sym})))
                c = df.columns[-1]
                rows.append({'data': f'stock {kind} dates listed', 'symbol': sym, 'date': f'{df[c].min()}..{df[c].max()}',
                             'answers': f'{len(df)} dates'})
            except Exception as ex:  # noqa: BLE001
                rows.append({'data': f'stock {kind} dates listed', 'symbol': sym, 'date': '-', 'answers': 'ERR ' + str(ex)[:60]})
    for d in ['20120104', '20160104', '20170103', '20180102', '20190102', '20200102']:
        rows.append({'data': 'index price 1s', 'symbol': 'SPX', 'date': d,
                     'answers': ok('/index/history/price', {'symbol': 'SPX', 'date': d, 'interval': '1s', 'start_time': '10:00:00', 'end_time': '10:01:00'})})
    for path, p, lab in [('/api/option-trades/flow-alerts', {'ticker_symbol': 'SPY', 'limit': 1, 'older_than': '2023-12-07T00:00:00Z'}, 'UW flow alerts'),
                         ('/api/option-trades/flow-alerts', {'ticker_symbol': 'SPY', 'limit': 1, 'older_than': '2023-12-05T00:00:00Z'}, 'UW flow alerts'),
                         ('/api/stock/SPX/spot-exposures', {'date': '2023-12-06'}, 'UW spot GEX (per minute)'),
                         ('/api/stock/SPX/spot-exposures', {'date': '2023-12-05'}, 'UW spot GEX (per minute)'),
                         ('/api/stock/SPY/greek-exposure', {}, 'UW daily greek exposure (no date: last ~250 days)')]:
        try:
            d = uw_get(path, p)
            n = len(d.get('data', d)) if isinstance(d, dict) else len(d)
            ans = f'yes ({n} rows)' if n else 'empty'
        except Exception as e:  # noqa: BLE001
            ans = 'refused: ' + str(e)[60:160]
        rows.append({'data': lab, 'symbol': p.get('ticker_symbol', path.split('/')[3]), 'date': p.get('older_than', p.get('date', '-')), 'answers': ans})
    df = pd.DataFrame(rows)
    from eval.report import md_table
    open(os.path.join(HERE, 'DEPTH.md'), 'w').write('# History depth on this key (measured)\n\n' + md_table(df) + '\n')
    print(md_table(df))


if __name__ == '__main__':
    sys.exit(main())
