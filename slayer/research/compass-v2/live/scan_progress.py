#!/usr/bin/env python3
"""LIVE-SCAN watchdog: every 30 min checks disk (df + our data size); at 10:30, 11:30, ... 15:30 and 16:00 appends a
progress line to v2data/live/scan/PROGRESS.md: movers so far, terminal health, coverage (names refreshed and the
average refresh interval), disk. Writes THIN to the day folder if our data passes 1.2 GB (the collector budget is 1.5)."""
import json, os, shutil, subprocess, sys, time, datetime as dt
from collections import defaultdict
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
DAY = sys.argv[1] if len(sys.argv) > 1 else dt.datetime.now(ET).strftime('%Y-%m-%d')
ROOT = '/home/user/falcon-cloud-field-sail/v2data/live/scan'
OUT = f'{ROOT}/{DAY}'
PROG = f'{ROOT}/PROGRESS.md'

def du(p):
    tot = 0
    for dp, _, fs in os.walk(p):
        for f in fs:
            try: tot += os.path.getsize(os.path.join(dp, f))
            except Exception: pass
    return tot

def disk_line():
    free = shutil.disk_usage('/').free
    ours = du(ROOT)
    if ours > 1.2e9: open(f'{OUT}/THIN', 'w').write('over 1.2 GB\n')
    return f'disk free {free / 1e9:.2f} GB, scan data {ours / 1e6:.1f} MB of 1500 MB budget'

def progress(now_tag):
    mv = []
    try:
        mv = [json.loads(l) for l in open(f'{OUT}/movers.jsonl')]
    except Exception:
        pass
    by_t = defaultdict(set); by_u = defaultdict(set)
    for e in mv:
        by_t[e['threshold']].add(e['contract'])
        if e['threshold'] == 1.5: by_u[e['sym']].add(e['contract'])
    top = sorted(by_u.items(), key=lambda kv: -len(kv[1]))[:6]
    cov = []
    try:
        cov = [json.loads(l) for l in open(f'{OUT}/coverage.jsonl')]
    except Exception:
        pass
    last60 = [c for c in cov if c['minute'] > (dt.datetime.now(ET) - dt.timedelta(minutes=60)).strftime('%H%M')]
    seen = defaultdict(list)
    for c in cov:
        m = int(c['minute'][:2]) * 60 + int(c['minute'][2:])
        for s in c.get('refreshed', []): seen[s].append(m)
    gaps = []
    for s, ms in seen.items():
        ms = sorted(ms)
        if len(ms) > 1: gaps.append((ms[-1] - ms[0]) / (len(ms) - 1))
    names60 = set()
    for c in last60: names60.update(c.get('refreshed', []))
    h = cov[-1]['health'] if cov else {}
    secs = [c['secs'] for c in last60]
    tierA_gaps = [g for s, g in [(s, (sorted(ms)[-1] - sorted(ms)[0]) / max(1, len(ms) - 1)) for s, ms in seen.items()] if s in ('SPY', 'NVDA')]
    line = (f'- {DAY} {now_tag} ET: movers (distinct contracts) 1.5x={len(by_t[1.5])} 2x={len(by_t[2.0])} 5x={len(by_t[5.0])}; '
            f'top 1.5x names {", ".join(f"{k} {len(v)}" for k, v in top)}. '
            f'Terminal: {len(last60)} cycles last hour, cycle secs avg {sum(secs) / max(1, len(secs)):.1f} max {max(secs) if secs else 0:.0f}, '
            f'health ok={h.get("ok")} retry={h.get("retry")} err={h.get("err")} slow={h.get("slow")}. '
            f'Coverage: {len(names60)} names refreshed last hour ({len(seen)} today), avg refresh interval '
            f'{sum(gaps) / max(1, len(gaps)):.1f} min (tier A {sum(tierA_gaps) / max(1, len(tierA_gaps)):.1f} min); '
            f'{disk_line()}.\n')
    with open(PROG, 'a') as f:
        f.write(line)

def main():
    if not os.path.exists(PROG):
        open(PROG, 'w').write('# LIVE-SCAN progress (append-only)\n\n')
    marks = ['1030', '1130', '1230', '1330', '1430', '1530', '1601']
    done = set()
    lastdisk = 0
    while True:
        now = dt.datetime.now(ET); tag = now.strftime('%H%M')
        if time.time() - lastdisk > 1800:
            with open(f'{OUT}/disk.log', 'a') as f:
                f.write(now.strftime('%H:%M ') + disk_line() + '\n')
            lastdisk = time.time()
        for m in marks:
            if tag >= m and m not in done:
                done.add(m)
                if tag <= str(int(m) + 5).zfill(4):
                    progress(m)
        if tag > '1606': break
        time.sleep(20)

if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[2] == 'now':
        progress(dt.datetime.now(ET).strftime('%H%M'))
    else:
        main()
