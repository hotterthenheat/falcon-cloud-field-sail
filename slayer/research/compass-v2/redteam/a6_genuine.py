"""Attack 6: are the overnight SPXW quotes genuine Cboe GTH quotes? Exchange codes, quote activity, midnight resets,
stale-replay check (00:00-06:00 quotes identical to the 09:00 quote), holidays / early closes, on the wide chain."""
import os, sys, glob, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rt

CH = '/home/user/falcon-cloud-field-sail/v2data/redteam/chain1m'
files = sorted(glob.glob(os.path.join(CH, '*.parquet')))
rows = []
bx_night, bx_reg = {}, {}
for f in files:
    day = os.path.basename(f)[:10]
    c = pd.read_parquet(f)
    v = c[(c.ask > 0)]
    night = v[(v['min'] >= 1) & (v['min'] < 360)]
    reg = v[(v['min'] >= 9 * 60) & (v['min'] <= 9 * 60 + 29)]
    for k, cnt in night.bx.value_counts().items():
        bx_night[k] = bx_night.get(k, 0) + int(cnt)
    for k, cnt in reg.bx.value_counts().items():
        bx_reg[k] = bx_reg.get(k, 0) + int(cnt)
    # per contract: number of distinct (bid, ask) states overnight; contracts frozen all night
    g = night.groupby(['strike', 'right']).agg(states=('bid', lambda s: len(set(zip(s, night.loc[s.index, 'ask'])))), n=('bid', 'size'))
    frozen = float((g.states <= 1).mean()) if len(g) else np.nan
    # midnight: quotes at 00:00 with ask == 0 (ThetaData's date boundary)
    at0 = c[c['min'] == 0]
    zero0 = float((at0.ask <= 0).mean()) if len(at0) else np.nan
    # stale-replay: does the 03:00 board equal the 09:00 board (bid and ask) on the near-ATM strikes?
    b3 = v[v['min'] == 180].set_index(['strike', 'right'])[['bid', 'ask']]
    b9 = v[v['min'] == 540].set_index(['strike', 'right'])[['bid', 'ask']]
    j = b3.index.intersection(b9.index)
    same = float(((b3.loc[j].bid == b9.loc[j].bid) & (b3.loc[j].ask == b9.loc[j].ask)).mean()) if len(j) else np.nan
    minutes_quoted = night['min'].nunique()
    rows.append(dict(day=day, contracts=len(g), frozen_frac=frozen, zero_at_0000=zero0, same_0300_0900=same, night_minutes_quoted=minutes_quoted,
                     n_night_rows=len(night), bx_modes=night.bx.mode().iloc[0] if len(night) else -1, ax_modes=night.ax.mode().iloc[0] if len(night) else -1,
                     cond_mode=night.bc.mode().iloc[0] if len(night) else -1, weekday=pd.Timestamp(day).weekday()))
t = pd.DataFrame(rows)
pd.set_option('display.width', 250)
print(t.describe().round(3).to_string())
print('\nbid exchange codes 00:01-05:59 (rows):', dict(sorted(bx_night.items())))
print('bid exchange codes 09:00-09:29 (rows):', dict(sorted(bx_reg.items())))
print('\nnights with any contract frozen all night (fraction of contracts):', (t.frozen_frac > 0).sum(), 'of', len(t), '; max frozen fraction', t.frozen_frac.max())
print('nights where >5% of near strikes show identical 03:00 and 09:00 quotes:', (t.same_0300_0900 > 0.05).sum(), 'of', len(t))
print('night minutes quoted (of 359): min', t.night_minutes_quoted.min(), 'median', t.night_minutes_quoted.median())
print('rows with ask==0 at 00:00 (date-boundary artefact): mean fraction', round(t.zero_at_0000.mean(), 3))
print('weekday counts of locked sessions (0=Mon):', t.weekday.value_counts().sort_index().to_dict())
import calendar
# early closes / holidays in the locked set: sessions where the chain has no quotes after 13:00 are not in this 00:00-09:30 window;
# the K5 flat is 09:20 so an early close cannot touch the trade. Holidays are absent from the session list (SPY EOD calendar).
t.to_csv('a6_genuine.csv', index=False)
