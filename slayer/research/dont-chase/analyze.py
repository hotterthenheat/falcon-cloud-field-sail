"""Score the "don't chase" filter on Model 1's calls (calls.py + fetch1s.py). See LOG.md for the pre-registration.

    python3 -I analyze.py dev            # the 9 variants on development, and the frozen choice
    python3 -I analyze.py holdout X Y    # the frozen filter once on H1 and H2 (X, Y in percent)
"""
import json, os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch1s import req_path, cached

HERE = os.path.dirname(os.path.abspath(__file__))
GRID = [(x, y) for x in (0.5, 0.8, 1.2) for y in (10, 20, 30)]

def block(day):
    m = day[:7]
    if m == '2022-06' or m == '2024-08' or ('2026-10-05' <= day <= '2026-10-30'): return 'H1'
    if m in ('2022-07', '2022-08', '2022-09', '2025-01', '2025-02', '2025-03'): return 'H2'
    return 'dev'

def seconds(c, a, b):
    got = cached(req_path(c, a, b))
    if got is None or got.get('status') not in (200, 472): return None
    if got['status'] == 472 or not got.get('body'): return []
    doc = json.loads(got['body'])
    out = []
    import datetime
    from zoneinfo import ZoneInfo
    NY = ZoneInfo('America/New_York')
    for blk in doc.get('response', []):
        for q in blk.get('data', []):
            t = int(datetime.datetime.fromisoformat(q['timestamp']).replace(tzinfo=NY).timestamp() * 1000)
            if a < t <= b and t % 60000 != 0: out.append((t, float(q['bid']), float(q['ask'])))
    return sorted(out)

def outcome(c):
    st = c.get('settle')
    if not st or not st.get('exit'): return None
    paid, stop, tgt = st['paid'], st['stop'], st['tgt']
    t, px, why = st['exit']
    unread = False
    if st['windows'] and why in ('Stop', 'TP'):
        a, b = st['windows'][-1]
        sec = seconds(c, a, b)
        if sec is None: unread = True
        else:
            for ts, bid, ask in sec:
                if not (ask > 0 and bid >= 0 and ask >= bid): continue
                if bid <= stop: why, px = 'Stop', bid; break
                if bid >= tgt: why, px = 'TP', tgt; break
    win = why == 'TP'
    return {'win': win, 'ret': px / paid - 1, 'why': why, 'unread': unread}

def load():
    rows = []
    for l in open(os.path.join(HERE, 'data', 'calls.jsonl')):
        c = json.loads(l)
        o = outcome(c)
        if o is None or c.get('move') is None or c.get('pos') is None: continue
        c.update(o); c['block'] = block(c['day']); rows.append(c)
    return rows

def chase(c, x, y):
    return c['move'] > x / 100 and c['pos'] >= 1 - y / 100

def boot(rows, f, n=2000, seed=7):
    by = {}
    for r in rows: by.setdefault(r['day'], []).append(r)
    days = sorted(by)
    rnd = random.Random(seed); vals = []
    for _ in range(n):
        s = [r for d in (rnd.choice(days) for _ in days) for r in by[d]]
        v = f(s)
        if v is not None: vals.append(v)
    vals.sort()
    return vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]

def wr(s): return sum(r['win'] for r in s) / len(s) if s else None
def mr(s): return sum(r['ret'] for r in s) / len(s) if s else None

def line(name, s):
    if not s: return f'| {name} | 0 | | |'
    w = boot(s, wr); m = boot(s, mr)
    return f"| {name} | {len(s)} | {100*wr(s):.1f}% [{100*w[0]:.1f}, {100*w[1]:.1f}] | {100*mr(s):+.1f}% [{100*m[0]:+.1f}, {100*m[1]:+.1f}] |"

def paired(rows, x, y):
    """Per session: the filtered book's summed return minus the unfiltered (= minus the removed calls' returns);
    and the difference in return per call, kept minus removed."""
    tot = lambda s: -sum(r['ret'] for r in s if chase(r, x, y)) / max(1, len({r['day'] for r in s}))
    def gap(s):
        k = [r['ret'] for r in s if not chase(r, x, y)]; d = [r['ret'] for r in s if chase(r, x, y)]
        return (sum(k) / len(k) - sum(d) / len(d)) if k and d else None
    return tot(rows), boot(rows, tot), gap(rows), boot(rows, gap)

def report(rows, x, y, label):
    kept = [r for r in rows if not chase(r, x, y)]; cut = [r for r in rows if chase(r, x, y)]
    print(f'\n### {label}: X = {x}%, Y = {y}%  ({len({r["day"] for r in rows})} sessions)')
    print('| book | calls | win [95% session bootstrap] | return/call [95%] |\n|---|---:|---:|---:|')
    print(line('Model 1, no filter', rows)); print(line("Model 1, don't chase", kept)); print(line('removed calls', cut))
    t, tci, g, gci = paired(rows, x, y)
    print(f'removed {len(cut)} of {len(rows)} ({100*len(cut)/max(1,len(rows)):.0f}%); paired gain to the book a session '
          f'(sum of returns) {100*t:+.1f}% [{100*tci[0]:+.1f}, {100*tci[1]:+.1f}]; kept minus removed, return/call '
          + (f'{100*g:+.1f} pts [{100*gci[0]:+.1f}, {100*gci[1]:+.1f}]' if g is not None else 'n/a'))
    unread = sum(r['unread'] for r in rows)
    print(f'1-second exit window not answered (left on its minute exit): {unread}')
    # the trend-day split
    print('| split (underlying open->close, call side) | calls | removed | removed win | kept win | removed ret | kept ret |\n|---|---:|---:|---:|---:|---:|---:|')
    def side(r):
        d = r.get('dayRet');
        if d is None: return 'unknown'
        d = d if r['right'] == 'C' else -d
        return 'with the call > +0.5%' if d > 0.005 else ('against < -0.5%' if d < -0.005 else 'flat +/-0.5%')
    def trend(r):
        d = r.get('dayRet'); return 'unknown' if d is None else ('trend day |move| >= 1%' if abs(d) >= 0.01 else 'not a trend day')
    for key in (side, trend):
        groups = {}
        for r in rows: groups.setdefault(key(r), []).append(r)
        for gname in sorted(groups):
            s = groups[gname]; k = [r for r in s if not chase(r, x, y)]; cc = [r for r in s if chase(r, x, y)]
            f = lambda v: '' if v is None else f'{100*v:.0f}%'
            fr = lambda v: '' if v is None else f'{100*v:+.1f}%'
            print(f'| {gname} | {len(s)} | {len(cc)} | {f(wr(cc))} | {f(wr(k))} | {fr(mr(cc))} | {fr(mr(k))} |')
    calls = [r for r in rows if r['right'] == 'C']; puts = [r for r in rows if r['right'] == 'P']
    for nm, s in (('calls (C)', calls), ('puts (P)', puts)):
        cc = [r for r in s if chase(r, x, y)]; k = [r for r in s if not chase(r, x, y)]
        print(f'{nm}: {len(s)}, removed {len(cc)}; removed win {100*(wr(cc) or 0):.0f}% ret {100*(mr(cc) or 0):+.1f}%; kept win {100*(wr(k) or 0):.0f}% ret {100*(mr(k) or 0):+.1f}%')

def main():
    rows = load()
    mode = sys.argv[1] if len(sys.argv) > 1 else 'dev'
    if mode == 'dev':
        dev = [r for r in rows if r['block'] == 'dev']
        print(f'development: {len(dev)} calls, {len({r["day"] for r in dev})} sessions; '
              f'win {100*wr(dev):.1f}%, return/call {100*mr(dev):+.1f}%')
        print('| X % | Y % | removed | removed win | removed ret | kept calls | kept win | kept ret |\n|---:|---:|---:|---:|---:|---:|---:|---:|')
        best = None
        for x, y in GRID:
            k = [r for r in dev if not chase(r, x, y)]; c = [r for r in dev if chase(r, x, y)]
            print(f'| {x} | {y} | {len(c)} | {100*(wr(c) or 0):.1f}% | {100*(mr(c) or 0):+.1f}% | {len(k)} | {100*wr(k):.2f}% | {100*mr(k):+.2f}% |')
            if best is None or wr(k) > best[0]: best = (wr(k), x, y)
        base = wr([r for r in dev if not chase(r, 0.8, 20)])
        fx, fy = (best[1], best[2]) if best[0] - base >= 0.01 else (0.8, 20)
        print(f'\nFROZEN (selection rule): X = {fx}%, Y = {fy}%  (best dev kept win {100*best[0]:.2f}% at {best[1]}/{best[2]}; 0.8/20 {100*base:.2f}%)')
        report(dev, fx, fy, 'Development')
    else:
        x, y = float(sys.argv[2]), float(sys.argv[3])
        for b in ('H1', 'H2'):
            s = [r for r in rows if r['block'] == b]
            if s: report(s, x, y, f'Holdout {b}')

if __name__ == '__main__':
    main()
