"""Housekeeping for the 1.5 GB budget: (1) rows csv.gz -> parquet (convert_rows.once), (2) the raw cache of every
BUILT day (its rows parquet and calls.json exist, no fresh lock) is re-packed: the gzip members are inflated and the
whole day written as raw/<ymd>.tar.xz (xz -9, ~2/3 of the gzip size); the files are removed but raw/<ymd>/_done.json
stays so the fetcher never re-asks the day. To rebuild a packed day: tar -xJf raw/<ymd>.tar.xz -C raw/ first.
Prints counts only."""
import glob, gzip, io, os, sys, tarfile, time, lzma

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert_rows  # noqa: E402

DATA = convert_rows.DATA


def pack_day(ymd):
    d = os.path.join(DATA, 'raw', ymd)
    files = sorted(f for f in os.listdir(d) if f != '_done.json')
    if not files:
        return 0
    out = os.path.join(DATA, 'raw', f'{ymd}.tar.xz')
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tar:
        for f in files:
            p = os.path.join(d, f)
            data = open(p, 'rb').read()
            name = f
            if f.endswith('.gz'):
                data = gzip.decompress(data)
                name = f[:-3]
            ti = tarfile.TarInfo(f'{ymd}/{name}')
            ti.size = len(data)
            ti.mtime = int(os.path.getmtime(p))
            tar.addfile(ti, io.BytesIO(data))
    with lzma.open(out + '.tmp', 'wb', preset=9) as z:
        z.write(buf.getvalue())
    os.replace(out + '.tmp', out)
    for f in files:
        os.remove(os.path.join(d, f))
    return 1


def once():
    n = convert_rows.once()
    p = 0
    for d in sorted(glob.glob(os.path.join(DATA, 'raw', '[0-9]' * 8))):
        ymd = os.path.basename(d)
        day = f'{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}'
        rows = os.path.join(DATA, 'rows')
        lock = os.path.join(rows, f'{day}.lock')
        if not (os.path.exists(os.path.join(rows, f'{day}.parquet')) and os.path.exists(os.path.join(rows, f'{day}.calls.json'))):
            continue
        if os.path.exists(lock) and time.time() - os.path.getmtime(lock) < 40 * 60:
            continue
        if os.path.exists(os.path.join(DATA, 'raw', f'{ymd}.tar.xz')):
            continue
        p += pack_day(ymd)
    # the 1.5 GB budget: the rows are the deliverable; when the cache passes 1.4 GB the oldest raw archives go
    # (re-fetchable with the same pipeline; _done.json stays)
    t = 0
    while total_bytes() > BUDGET:
        arcs = sorted(glob.glob(os.path.join(DATA, 'raw', '*.tar.xz')), key=os.path.getmtime)
        if not arcs:
            break
        os.remove(arcs[0])
        t += 1
    if t:
        print(time.strftime('%FT%TZ', time.gmtime()), 'budget: removed', t, 'raw archives', flush=True)
    return n, p


BUDGET = 1.4e9


def total_bytes():
    return sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(DATA) for f in fs)


if __name__ == '__main__':
    while True:
        n, p = once()
        if n or p:
            print(time.strftime('%FT%TZ', time.gmtime()), 'converted', n, 'packed', p, flush=True)
        if os.environ.get('OOS2_LOOP') != '1':
            break
        time.sleep(600)
