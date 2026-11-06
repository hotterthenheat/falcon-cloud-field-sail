#!/bin/sh
# NOV5 fetch driver (sequential: one terminal request in flight). Resumable: re-run after a restart.
cd "$(dirname "$0")"
python3 -c "
import glob, os, pandas as pd
n = 0
for f in glob.glob('/home/user/falcon-cloud-field-sail/v2data/nov5-tape/2026110*/g1m_*_parts/*.parquet'):
    if len(pd.read_parquet(f)) == 0:
        os.remove(f); n += 1
print('removed empty', n, flush=True)
"
python3 fetch_tape.py base 20261105
python3 fetch_tape.py term 20261105
python3 fetch_tape.py base 20261104
python3 fetch_tape.py term 20261104
echo DONE_A
