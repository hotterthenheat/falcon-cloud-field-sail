"""Exploration (in-sample, the study day only): a root's features every N minutes. python3 explore_root.py D ROOT N"""
import os, sys
import pandas as pd

D, root = sys.argv[1], sys.argv[2]
step = int(sys.argv[3]) if len(sys.argv) > 3 else 5
F = pd.read_parquet(f'/home/user/falcon-cloud-field-sail/v2data/nov5-broad/{D}/{root}/features.parquet')
F['hm'] = [f'{int(t)//3600:02d}:{int(t)%3600//60:02d}' for t in F['T']]
cols = [c for c in ['hm', 'S', 'from_open', 'r15', 'atm_iv', 'atm_iv_next', 'skew25', 'rv30', 'netprem_p15', 'netprem_c15',
                    'uw_chase_p15', 'uw_chase_c15', 'mic_spr', 'mic_size', 'mic_chg'] if c in F.columns]
pd.set_option('display.width', 250); pd.set_option('display.max_columns', 30); pd.set_option('display.max_rows', 500)
X = F[cols].copy()
for c in ('netprem_p15', 'netprem_c15', 'uw_chase_p15', 'uw_chase_c15'):
    if c in X:
        X[c] = (X[c] / 1e6).round(2)
print(X.iloc[::step].round(4).to_string())
