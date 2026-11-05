"""LOCKED-2 session list for K5 (OOS2 worker). Every NYSE session (SPY daily bars, the challenger's calendar) in the
candidate periods that NO K5 research ever touched, minus every session any v2 worker has pulled SPXW option quotes for.

    python3 make_locked2.py      -> LOCKED2.json (+ prints the table for PREREG.md)

Periods (checked on the terminal 2026-11-05, one SPXW 0DTE contract per month, 00:00-06:00 ET quotes present):
  2022-11-01..2022-12-30, 2023-01-03..2023-12-29, 2024-01-02..2024-07-12, 2024-09-03..2024-12-31,
  2025-04-01..2025-11-12, 2026-01-02..2026-06-29, 2026-11-02..2026-11-04.
"""
import glob, json, os

CHAL = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger/data'
V2 = '/home/user/falcon-cloud-field-sail/v2data'
HERE = os.path.dirname(os.path.abspath(__file__))

PERIODS = [('2022-01-26', '2022-02-15'), ('2022-11-01', '2022-12-30'), ('2023-01-03', '2023-12-29'), ('2024-01-02', '2024-07-12'), ('2024-09-03', '2024-12-31'),
           ('2025-04-01', '2025-11-12'), ('2026-01-02', '2026-06-29'), ('2026-11-02', '2026-11-04')]

# every session K5 research (challenger DEV, H1, H2, the 2026-07-01.. block) ever had rows for: the challenger's cache
k5_used = sorted(os.path.basename(f)[:10] for f in glob.glob(os.path.join(CHAL, 'rows', '*.calls.json')))
k5_raw = sorted(f'{d[:4]}-{d[4:6]}-{d[6:]}' for d in os.listdir(os.path.join(CHAL, 'raw')) if d.isdigit())
# other v2 workers' per-session SPXW quote pulls (foundation samples, validation): excluded for cleanliness
other = set()
for sub in ('sessions', 'validation'):
    for d in os.listdir(os.path.join(V2, sub)):
        if d.isdigit() and os.path.exists(os.path.join(V2, sub, d, 'SPXW_quotes.parquet')):
            other.add(f'{d[:4]}-{d[4:6]}-{d[6:]}')
# EDGE's regular-hours SPXW chains (E1-E3 DEV/VAL; minute >= 09:30 only, no overnight quotes): tier B, kept
edge = {os.path.basename(f)[:10] for f in glob.glob(os.path.join(V2, 'edge', 'chain', 'SPXW', '*.parquet'))}

cal = []
for y in range(2022, 2027):
    cal += json.load(open(os.path.join(CHAL, 'meta', f'sessions_{y}.json')))
cal += ['2026-11-02', '2026-11-03', '2026-11-04']   # the 2026 calendar file ends 2026-10-30
cal = sorted(set(cal))

used = set(k5_used) | set(k5_raw)
locked2, excluded = [], []
for s, e in PERIODS:
    for d in cal:
        if not (s <= d <= e):
            continue
        if d in used:
            excluded.append((d, 'K5 research cache'))
        elif d in other:
            excluded.append((d, 'another v2 worker pulled SPXW quotes (foundation sample / validation)'))
        else:
            locked2.append({'day': d, 'tier': 'B' if d in edge else 'A'})


def period_of(d):
    for s, e in PERIODS:
        if s <= d <= e:
            return f'{s}..{e}'


by = {}
for r in locked2:
    k = period_of(r['day'])
    by.setdefault(k, {'A': 0, 'B': 0})[r['tier']] += 1
lines = ['| period | sessions | tier A (no v2 worker touched) | tier B (EDGE regular-hours chains only) |', '|---|---:|---:|---:|']
for k, v in by.items():
    lines.append(f'| {k} | {v["A"] + v["B"]} | {v["A"]} | {v["B"]} |')
lines.append(f'| **total** | **{len(locked2)}** | {sum(v["A"] for v in by.values())} | {sum(v["B"] for v in by.values())} |')
table = '\n'.join(lines)
print(table)
print('excluded inside the periods:', len(excluded))
for d, why in excluded:
    print('  ', d, why)
json.dump({'sessions': locked2, 'n': len(locked2), 'periods': PERIODS, 'excluded_inside_periods': excluded,
           'k5_used_sessions': sorted(used), 'k5_used_n': len(used)}, open(os.path.join(HERE, 'LOCKED2.json'), 'w'), indent=0)
