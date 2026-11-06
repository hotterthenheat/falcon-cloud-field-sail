"""Exploration (in-sample, 2026-11-05): the SPX path against 0DTE ATM IV and VIX per minute (nov5-tape features)."""
import os, sys
import numpy as np
import pandas as pd

D = sys.argv[1] if len(sys.argv) > 1 else '20261105'
F = pd.read_parquet(f'/home/user/falcon-cloud-field-sail/v2data/nov5-tape/{D}/features.parquet')
F['hm'] = [f'{int(t)//3600:02d}:{int(t)%3600//60:02d}' for t in F['T']]
F['iv_n'] = F.atm_iv / F.atm_iv.rolling(30, min_periods=5).median()
cols = ['hm', 'S', 'from_open', 'r15', 'atm_iv', 'atm_iv_1d', 'vix', 'vix_chg15', 'skew25', 'iv_p10', 'rv30', 'netprem_p15', 'netprem_c15']
pd.set_option('display.width', 250); pd.set_option('display.max_columns', 30); pd.set_option('display.max_rows', 500)
step = int(sys.argv[2]) if len(sys.argv) > 2 else 3
print(F[cols].iloc[::step].round(4).to_string())
