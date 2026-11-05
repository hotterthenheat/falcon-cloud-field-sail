"""
Nov 4 research: the pre-entry signature (medians of features stamped at or before the mark) of
  (a) the amazing entries: the first enterable mark of each contract from which it ran >= 2x,
  (b) every enterable contract-mark (the random comparison),
  (c) Compass's own calls in the replay (matched to their contract-mark rows by root, expiry, strike, right, mark).

  python3 -I research/nov4/signature.py 2026-11-04 [replay json]
"""
import json, os, sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import study as S

COLS = [('m', 'minutes after 09:30'), ('dte', 'DTE'), ('absdelta', '|delta|'), ('ask', 'ask $'), ('prem_em', 'premium / expected move'),
        ('spread', 'spread / mid'), ('rv_iv', 'realised 30m / ATM IV'), ('s_r15', 'underlying 15m, side-signed'),
        ('s_open', 'underlying since open, side-signed'), ('s_vwap', 'vs VWAP, side-signed'), ('s_rangepos', 'position in day range (side)'),
        ('c_volrate', 'contract vol rate 15m / session'), ('c_aggr15', 'contract prints vs mid (half-spreads)'),
        ('ch_flow', 'chain net aggressive premium, side'), ('ch_burst', 'chain premium burst 15m'), ('c_volu_oi', 'volume so far / OI'),
        ('oi_chg', 'OI change prior day'), ('flip', 'gamma flip distance, side'), ('gex_sign', 'net gamma sign')]


def compass_rows(df, replay):
    doc = json.load(open(replay))
    out = []
    for c in doc['calls']:
        root = c['ticker']
        word = c['contract'].split(' ')[1]
        k, right = float(word[:-1]), word[-1]
        from datetime import datetime, timezone, timedelta
        mk = c.get('mark') or c['firedAt']
        t = datetime.fromtimestamp(mk / 1000, tz=timezone.utc) - timedelta(hours=5)  # EST after 2026-11-01
        m = t.hour * 60 + t.minute - 570
        r = df[(df.root == root) & (df.exp == c['expiry']) & (df.strike == k) & (df.right == right) & (df.m == m)]
        out.append(dict(book=c['book'], contract=c['contract'], expiry=c['expiry'], m=m, row=r.index[0] if len(r) else None))
    return out


if __name__ == '__main__':
    day = sys.argv[1]
    df = S.load([day])
    df['cid'] = df.root + ' ' + df.exp + ' ' + df.strike.astype(str) + df.right
    am = df[(df.ran >= 2)].sort_values('m').groupby('cid').head(1)
    groups = {'amazing (ran>=2x)': am, 'all enterable': df, 'all enterable 0.20-0.45 delta': df[S._band(df)]}
    if len(sys.argv) > 2:
        cr = compass_rows(df, sys.argv[2])
        idx = [c['row'] for c in cr if c['row'] is not None]
        groups['Compass calls (A/B, matched)'] = df.loc[idx]
        print('Compass calls matched to rows:', len(idx), 'of', len(cr), '(Book C fires at 15:20, outside the 09:35-15:00 marks; a Book A/B call off the band is unmatched)')
    print(f'{"feature":40s}' + ''.join(f'{g[:22]:>24s}' for g in groups))
    for c, label in COLS:
        print(f'{label:40s}' + ''.join(f'{g[c].median():>24.4g}' for g in groups.values()))
    print(f'{"n":40s}' + ''.join(f'{len(g):>24d}' for g in groups.values()))
    print(f'{"win (1.5x before stop) rate":40s}' + ''.join(f'{g.win.mean():>24.0%}' for g in groups.values()))
