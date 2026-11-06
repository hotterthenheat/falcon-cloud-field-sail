"""NOV5 runner: triggers (rules.py) -> contract pick -> 1-second path -> exits (devsim.py), on a study day or on DEV.

  python3 runner.py study 20261105            in-sample day (1-minute board paths if the 1-second store is missing)
  python3 runner.py study 20261104            first out-of-sample day
  python3 runner.py devbook                   build the DEV point-in-time books (walls each minute), resumable
  python3 runner.py dev [max_minutes]         DEV: every registered variant, fetch paths (1 request in flight)
  python3 runner.py dev --nofetch             simulate from cache only

Variants (PREREG.md): rule x exit x cell. Results: v2data/nov5-tape/res/<split>/<day>.json (atomic, resumable).
"""
import datetime as dt, json, math, os, sys, time
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'edgeg'))
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2', 'edge'))
import rules as RU  # noqa: E402
import devsim as DS  # noqa: E402
import load  # noqa: E402

DATA = '/home/user/falcon-cloud-field-sail/v2data'
OUT = os.path.join(DATA, 'nov5-tape')
DEVBOOK = os.path.join(OUT, 'devbook')
RESD = os.path.join(OUT, 'res')
CELLS = {'D30': 0.30, 'D15': 0.15}
EXITS = {'N1': ('XB', 'XE', 'XW'), 'N2': ('XB', 'XE', 'XW'), 'N3': ('XB', 'XE')}
WIN = 92 * 60
PRE = 30 * 60
READ_FROM, READ_TO = 9 * 3600 + 59 * 60, 14 * 3600 + 30 * 60


def variants():
    return [f'{r}-{x}-{c}' for r in EXITS for x in EXITS[r] for c in CELLS]


# ---------------------------------------------------------------- days


def study_day(D):
    bk = pd.read_parquet(os.path.join(load.ddir(D), 'book.parquet'))
    return RU.Day(D, load.bars(D), load.chain(D)[['m', 'k', 'r', 'bid', 'ask']], bk)


def dev_book(day):
    """Point-in-time book on a DEV session, EDGE-G definitions (vendored edgeg/book.py): S, atm, net (house sign at S),
    wall_up / wall_dn (walls_at), one read a minute 09:59..14:30."""
    import book as B
    f = os.path.join(DEVBOOK, f'{day}.parquet')
    if os.path.exists(f):
        return pd.read_parquet(f)
    try:
        st = B.load_static('SPXW', day)
    except B.Pending:
        return None
    rows = []
    if st is not None:
        for t in range(READ_FROM, READ_TO + 1, 60):
            rd = B.read_legs(st, 'SPXW', day, t)
            if rd is None:
                continue
            w = B.walls_at(rd['legs'], rd['S'])
            rows.append({'t': t, 'S': rd['S'], 'atm': rd['atm'], 'net_all': float(rd['legs']['g0'].sum()),
                         'wall_up': np.nan if w['wall_up'] is None else w['wall_up'],
                         'wall_dn': np.nan if w['wall_dn'] is None else w['wall_dn']})
    df = pd.DataFrame(rows, columns=['t', 'S', 'atm', 'net_all', 'wall_up', 'wall_dn'])
    os.makedirs(DEVBOOK, exist_ok=True)
    df.to_parquet(f + '.tmp', index=False)
    os.replace(f + '.tmp', f)
    return df


def dev_day(day):
    import sim as esim
    bk = dev_book(day)
    if bk is None or not len(bk):
        return None
    bars = esim.day_bars('SPXW', day)
    ch = esim.chain('SPXW', day)
    if ch is None or len(bars) < 300:
        return None
    return RU.Day(day, bars[['m', 'o', 'h', 'l', 'c']], ch[['m', 'k', 'r', 'bid', 'ask']], bk)


# ---------------------------------------------------------------- one session


def board1m_path(D, k, call, start, end):
    """Study-day fallback when the 1-second store is missing: the 1-minute board's NBBO held for the minute (labelled)."""
    c = load.chain(D)
    c = c[(c.k == k) & (c.r == (1 if call else 0))].sort_values('m')
    s = c.m.values.astype(np.int64) * 60
    grid = np.arange(start, end + 1)
    j = np.searchsorted(s, grid, side='right') - 1
    jj = np.maximum(j, 0)
    out = {'s0': start, 'src': 'board1m'}
    for name, arr in (('bid', c.bid.values), ('ask', c.ask.values)):
        out[name] = np.where(j >= 0, arr[jj], 0.0).astype(float)
    out['bs'] = np.where(j >= 0, 10.0, 0.0)
    out['as'] = np.where(j >= 0, 10.0, 0.0)
    return out


def target_exit(d, ev, t_end):
    """XW decision second: the first closed bar after the entry whose extreme reaches the target wall (low <= target +
    0.10 EM_1h for puts, high >= target - 0.10 EM_1h for calls)."""
    tgt = ev.get('target')
    if tgt is None or not np.isfinite(tgt):
        return None
    b = 0.10 * RU.em(ev['S'], ev['atm'], 60)
    for m in range(ev['t'] // 60, t_end // 60):
        o, h, l, c = d._bar.get(m, (np.nan,) * 4)
        if not np.isfinite(c):
            continue
        if (ev['side'] < 0 and l <= tgt + b) or (ev['side'] > 0 and h >= tgt - b):
            return (m + 1) * 60
    return None


def simulate_event(d, ev, cell, exits, side_override=None, study=False):
    side = ev['side'] if side_override is None else side_override
    t = int(ev['t'])
    pk, why = DS.pick_on_board(d.board, d.bars, d.day if '-' in d.day else f'{d.day[:4]}-{d.day[4:6]}-{d.day[6:]}', t,
                               side > 0, CELLS[cell])
    if pk is None:
        return [{'skip': why, 'exit_rule': x} for x in exits]
    start, end = max(t - PRE, 9 * 3600 + 31 * 60), min(t + WIN, DS.END_CAP)
    day = d.day if '-' in d.day else f'{d.day[:4]}-{d.day[4:6]}-{d.day[6:]}'
    p = DS.path('SPXW', day, day, pk['k'], pk['call'], start, end)
    if p is None and study:
        p = board1m_path(d.day.replace('-', ''), pk['k'], pk['call'], start, end)
    if p is None:
        return [{'skip': 'no path', 'exit_rule': x, **pk} for x in exits]
    out = []
    for x in exits:
        if x == 'XW':
            tw = target_exit(d, {**ev, 'side': side}, min(t + 5400, DS.FLAT_S))
            r = DS.simulate(p, t, 'XA_W', pk, ev['S'], ev['atm'], ev['rv'], t_target=tw)
        else:
            r = DS.simulate(p, t, x, pk, ev['S'], ev['atm'], ev['rv'])
        out.append({'exit_rule': x, **pk, **r})
    return out


def run_day(d, sides=('real',), study=False):
    rows = []
    for ev in RU.events(d):
        for cell in CELLS:
            for sd in sides:
                so = None if sd == 'real' else -ev['side']
                for r in simulate_event(d, ev, cell, EXITS[ev['rule']], so, study):
                    rows.append({'day': d.day, 'rule': ev['rule'], 't': int(ev['t']), 'ev_side': int(ev['side']),
                                 'sideset': sd, 'cell': cell, 'S': ev['S'], 'atm': ev['atm'], 'wall': ev.get('wall', np.nan),
                                 'target': ev.get('target', np.nan),
                                 'variant': f"{ev['rule']}-{r['exit_rule']}-{cell}", **r})
    return rows


def atomic_json(obj, f):
    os.makedirs(os.path.dirname(f), exist_ok=True)
    with open(f + '.tmp', 'w') as fh:
        json.dump(obj, fh, default=float)
    os.replace(f + '.tmp', f)


def main():
    cmd = sys.argv[1]
    if cmd == 'study':
        D = sys.argv[2]
        DS.NOFETCH = '--fetch' not in sys.argv
        rows = run_day(study_day(D), sides=('real', 'flip'), study=True)
        atomic_json(rows, os.path.join(RESD, 'study', f'{D}.json'))
        df = pd.DataFrame(rows)
        pd.set_option('display.width', 250)
        cols = ['variant', 'sideset', 't', 'ev_side', 'k', 'call', 'delta', 'fill', 'exit', 'reason', 'entry_s', 'exit_s',
                'ret_net', 'pnl_net', 'src', 'skip']
        print(df[[c for c in cols if c in df.columns]].assign(
            t=lambda x: [load.clock(v) for v in x.t],
            entry_s=lambda x: [load.clock(v) if pd.notna(v) else '' for v in x.get('entry_s', [np.nan] * len(x))],
            exit_s=lambda x: [load.clock(v) if pd.notna(v) else '' for v in x.get('exit_s', [np.nan] * len(x))]).to_string())
        return
    import common as EC
    days = EC.dev_sessions('DEV')
    if cmd == 'devbook':
        t0 = time.time()
        n = {'ok': 0, 'pending': 0, 'none': 0}
        for i, day in enumerate(days):
            if not os.path.exists(os.path.join(DATA, 'edge', 'chain', 'SPXW', f'{day}.parquet')):
                n['none'] += 1
                continue
            b = dev_book(day)
            n['ok' if b is not None else 'pending'] += 1
            if i % 50 == 0:
                print(time.strftime('%H:%M:%S'), i, len(days), n, f'{time.time() - t0:.0f}s', flush=True)
        print('devbook done', n, flush=True)
        return
    if cmd == 'dev':
        DS.NOFETCH = '--nofetch' in sys.argv
        lim = [a for a in sys.argv[2:] if a.replace('.', '').isdigit()]
        tmax = float(lim[0]) * 60 if lim else 1e12
        sides = ('real', 'flip') if '--flip' in sys.argv else ('real',)
        tag = 'dev_flip' if '--flip' in sys.argv else 'dev'
        rng = np.random.default_rng(20261106)
        order = [days[i] for i in rng.permutation(len(days))]
        t0 = time.time()
        n = 0
        for day in order:
            f = os.path.join(RESD, tag, f'{day}.json')
            if os.path.exists(f):
                continue
            if EC.split_of(day) != 'DEV':
                raise AssertionError(day)
            if not os.path.exists(os.path.join(DATA, 'edge', 'chain', 'SPXW', f'{day}.parquet')):
                continue
            d = dev_day(day)
            if d is None:
                continue
            rows = run_day(d, sides=sides)
            atomic_json(rows, f)
            n += 1
            if n % 10 == 0:
                print(time.strftime('%H:%M:%S'), tag, n, DS.PSTATS, flush=True)
            if time.time() - t0 > tmax:
                print('time cut', n, flush=True)
                break
        print('done', tag, n, DS.PSTATS, flush=True)


if __name__ == '__main__':
    main()
