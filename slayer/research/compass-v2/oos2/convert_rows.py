"""Convert built rows csv.gz -> float32 zstd parquet, exactly as the challenger's common.load_day does on first load
(the 56 live inputs x0..x55 dropped, c*/at* columns float32, text columns as strings), then remove the csv. Prints
counts only: no row content is read by a person. Loops while the builder runs (OOS2_LOOP=1)."""
import glob, os, time
import numpy as np
import pandas as pd

DATA = os.environ.get('CHAL_DATA', '/home/user/falcon-cloud-field-sail/v2data/oos2')


def convert(src):
    pq = src[:-len('.csv.gz')] + '.parquet'
    df = pd.read_csv(src, low_memory=False)
    for c in ('whyA', 'whyR'):
        df[c] = df[c].fillna('').astype(str).str.strip('"')
    for c in ('day', 'sleeve', 'ticker', 'contract', 'expiry', 'right', 'mark', 'session'):
        df[c] = df[c].fillna('').astype(str)
    df = df.drop(columns=[c for c in df.columns if c.startswith('x') and c[1:].isdigit()])
    for c in df.columns:
        if c.startswith('x') or c.startswith('c') and c[1:].isdigit() or c.startswith('at'):
            df[c] = df[c].astype(np.float32)
    df.to_parquet(pq + '.tmp', compression='zstd')
    os.replace(pq + '.tmp', pq)
    os.remove(src)
    return len(df)


def once():
    n = 0
    for src in sorted(glob.glob(os.path.join(DATA, 'rows', '*.csv.gz'))):
        day = os.path.basename(src)[:10]
        if not os.path.exists(os.path.join(DATA, 'rows', f'{day}.calls.json')):
            continue  # still being written
        convert(src)
        n += 1
    return n


if __name__ == '__main__':
    while True:
        n = once()
        if n:
            print(time.strftime('%FT%TZ', time.gmtime()), 'converted', n, flush=True)
        if os.environ.get('OOS2_LOOP') != '1':
            break
        time.sleep(300)
